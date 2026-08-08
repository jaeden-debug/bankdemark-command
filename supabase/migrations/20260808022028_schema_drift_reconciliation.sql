-- ============================================================
-- SCHEMA DRIFT RECONCILIATION
--
-- Production diverged from the repo SQL because the Command schema
-- was hand-pasted into the SQL editor rather than migrated. Four
-- features were silently failing in production. This migration
-- makes the database match what the application code expects.
--
-- Audit evidence (2026-08-07):
--   ai_usage           code: used_date/count        db: usage_date/message_count
--   ai_conversations   code: summary/last_context_summary   db: (absent)
--   score_history      code: health_label/recorded_at       db: band/created_at
--   goals              code: type/target/current/notes/completed
--                      db:   goal_type/target_amount/current_amount/priority
--
-- Strategy: additive only. No column is dropped, no data is lost.
-- Generated columns / compatibility columns are added so both the
-- legacy and the new naming resolve.
-- ============================================================

-- ── ai_conversations: restore the never-applied ALTER ───────
ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS last_context_summary TEXT;

-- ── goals: add the columns the UI actually writes ───────────
-- goal_type is NOT NULL in prod, so backfill it from `type`.
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS type       TEXT,
  ADD COLUMN IF NOT EXISTS target     NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current    NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes      TEXT,
  ADD COLUMN IF NOT EXISTS completed  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.goals ALTER COLUMN goal_type DROP NOT NULL;

-- Keep the two naming conventions in sync so neither read path breaks.
CREATE OR REPLACE FUNCTION public.goals_sync_legacy_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.goal_type      := COALESCE(NEW.type, NEW.goal_type, 'custom');
  NEW.type           := COALESCE(NEW.type, NEW.goal_type, 'custom');
  NEW.target_amount  := COALESCE(NEW.target, NEW.target_amount, 0);
  NEW.target         := COALESCE(NEW.target, NEW.target_amount, 0);
  NEW.current_amount := COALESCE(NEW.current, NEW.current_amount, 0);
  NEW.current        := COALESCE(NEW.current, NEW.current_amount, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goals_sync_legacy ON public.goals;
CREATE TRIGGER goals_sync_legacy
  BEFORE INSERT OR UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.goals_sync_legacy_columns();

UPDATE public.goals
   SET type = COALESCE(type, goal_type),
       target = COALESCE(target, target_amount),
       current = COALESCE(current, current_amount)
 WHERE type IS NULL OR target IS NULL OR current IS NULL;

-- ── score_history: add the names the app reads/writes ───────
ALTER TABLE public.score_history
  ADD COLUMN IF NOT EXISTS health_label TEXT,
  ADD COLUMN IF NOT EXISTS recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE public.score_history SET health_label = band WHERE health_label IS NULL;

CREATE INDEX IF NOT EXISTS idx_score_history_recorded
  ON public.score_history(user_id, recorded_at DESC);

-- ── ai_usage: add the names the coach route uses ────────────
-- The route queries used_date/count; prod has usage_date/message_count.
-- Add both and keep them synchronised, then re-assert the unique key
-- the upsert's onConflict target depends on.
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS used_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS count     INT  NOT NULL DEFAULT 0;

UPDATE public.ai_usage
   SET used_date = usage_date, count = message_count
 WHERE used_date IS DISTINCT FROM usage_date OR count IS DISTINCT FROM message_count;

CREATE OR REPLACE FUNCTION public.ai_usage_sync_legacy_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.usage_date    := COALESCE(NEW.used_date, NEW.usage_date, CURRENT_DATE);
  NEW.used_date     := NEW.usage_date;
  NEW.message_count := GREATEST(COALESCE(NEW.count, 0), COALESCE(NEW.message_count, 0));
  NEW.count         := NEW.message_count;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_usage_sync_legacy ON public.ai_usage;
CREATE TRIGGER ai_usage_sync_legacy
  BEFORE INSERT OR UPDATE ON public.ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.ai_usage_sync_legacy_columns();

DROP INDEX IF EXISTS ai_usage_user_id_used_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_user_id_used_date_key
  ON public.ai_usage(user_id, used_date);
