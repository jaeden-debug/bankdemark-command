-- ============================================================
-- ZYLX P0 — CONVERSATION SCOPING + CROSS-BUSINESS FK GUARD
--
-- Two confirmed audit findings:
--
-- 1. ai_conversations was user-scoped but not business-scoped, so a
--    thread started under Business A could be continued under Business
--    B and replay A's figures into B's prompt. Not cross-tenant, but it
--    breaks the product's core promise that books never mix.
--
-- 2. transactions accepted category_id / brand_id / project_id /
--    counterparty_id belonging to ANOTHER business. RLS only checks
--    business_id, and a plain FK only requires the row to exist.
--    Verified exploitable against production before this migration.
-- ============================================================

-- ── 1. Business-scoped conversations ────────────────────────
ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE;

-- Existing rows predate multi-business and cannot be attributed to one
-- business without guessing. They stay NULL and are treated as legacy:
-- readable in history, never loaded into a business-scoped thread.
COMMENT ON COLUMN public.ai_conversations.business_id IS
  'NULL = legacy conversation from before business scoping. Never replay these into a business-scoped chat.';

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_business
  ON public.ai_conversations(user_id, business_id, updated_at DESC);

-- Membership must hold for the business too, not just ownership of the row.
DROP POLICY IF EXISTS "Users can view own conversations" ON public.ai_conversations;
CREATE POLICY "Users can view own conversations"
  ON public.ai_conversations FOR SELECT
  USING (
    auth.uid() = user_id
    AND (business_id IS NULL OR public.is_business_member(business_id, 'viewer'))
  );

DROP POLICY IF EXISTS "Users can insert own conversations" ON public.ai_conversations;
CREATE POLICY "Users can insert own conversations"
  ON public.ai_conversations FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (business_id IS NULL OR public.is_business_member(business_id, 'viewer'))
  );

DROP POLICY IF EXISTS "Users can update own conversations" ON public.ai_conversations;
CREATE POLICY "Users can update own conversations"
  ON public.ai_conversations FOR UPDATE
  USING (
    auth.uid() = user_id
    AND (business_id IS NULL OR public.is_business_member(business_id, 'viewer'))
  );

-- ── 2. Cross-business foreign keys rejected at the database ──
--
-- Defence in depth. The service layer validates ownership too (see
-- lib/services/ownership.ts), but a trigger means no future code path,
-- import, or tool can reintroduce this by forgetting a check.
CREATE OR REPLACE FUNCTION public.bdm_assert_same_business()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.categories WHERE id = NEW.category_id;
    -- System categories (business_id IS NULL) are shared by design.
    IF v_owner IS NOT NULL AND v_owner <> NEW.business_id THEN
      RAISE EXCEPTION 'category % belongs to another business', NEW.category_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.brand_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.brands WHERE id = NEW.brand_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'brand % belongs to another business', NEW.brand_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.project_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.projects WHERE id = NEW.project_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'project % belongs to another business', NEW.project_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.counterparty_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.counterparties WHERE id = NEW.counterparty_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'counterparty % belongs to another business', NEW.counterparty_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.account_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.accounts WHERE id = NEW.account_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'account % belongs to another business', NEW.account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.booking_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.bookings WHERE id = NEW.booking_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'booking % belongs to another business', NEW.booking_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.document_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.documents WHERE id = NEW.document_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'document % belongs to another business', NEW.document_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_assert_same_business ON public.transactions;
CREATE TRIGGER transactions_assert_same_business
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.bdm_assert_same_business();

-- ── 3. Idempotency for Zylx approvals ───────────────────────
-- A stable key per approved proposal. A double-click, retry or refresh
-- returns the original record instead of creating a second one.
CREATE TABLE IF NOT EXISTS public.zylx_approvals (
  idempotency_key TEXT PRIMARY KEY,
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_kind   TEXT NOT NULL,
  result_kind     TEXT NOT NULL,
  result_id       UUID,
  result          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zylx_approvals_business
  ON public.zylx_approvals(business_id, created_at DESC);

ALTER TABLE public.zylx_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zylx_approvals FROM anon;

DROP POLICY IF EXISTS zylx_approvals_select ON public.zylx_approvals;
CREATE POLICY zylx_approvals_select ON public.zylx_approvals FOR SELECT
  USING (auth.uid() = user_id AND public.is_business_member(business_id, 'viewer'));

DROP POLICY IF EXISTS zylx_approvals_insert ON public.zylx_approvals;
CREATE POLICY zylx_approvals_insert ON public.zylx_approvals FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.is_business_member(business_id, 'member'));

REVOKE UPDATE, DELETE ON public.zylx_approvals FROM authenticated;
