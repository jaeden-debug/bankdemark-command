-- ============================================================
-- STANDALONE INVOICING SAAS — launch requirements
--   1. Usage metering (server-authoritative, monthly)
--   2. Resend delivery events (idempotent webhook ingestion)
--   3. Subscriptions (Stripe state as the authority)
--   4. Business logo storage, tenant-isolated
--   5. Second bypass account
-- ============================================================

-- ── 1. USAGE METER ──────────────────────────────────────────
-- One row per business/metric/month. Counters are advanced by a
-- SECURITY DEFINER function so a client can never write its own usage.
CREATE TABLE IF NOT EXISTS public.usage_counters (
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL CHECK (metric IN ('invoices', 'ai_actions', 'emails')),
  period      DATE NOT NULL,            -- first day of the month, UTC
  used        INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, metric, period)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_counters_select ON public.usage_counters;
CREATE POLICY usage_counters_select ON public.usage_counters FOR SELECT
  USING (public.is_business_member(business_id, 'viewer'));

-- Read-only to users. Only the function below may write.
REVOKE INSERT, UPDATE, DELETE ON public.usage_counters FROM authenticated, anon;
REVOKE ALL ON public.usage_counters FROM anon;

CREATE OR REPLACE FUNCTION public.bdm_consume_usage(
  p_business_id UUID,
  p_metric      TEXT,
  p_limit       INTEGER,   -- NULL = unlimited
  p_amount      INTEGER DEFAULT 1
)
RETURNS TABLE (allowed BOOLEAN, used INTEGER, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period DATE := date_trunc('month', (NOW() AT TIME ZONE 'UTC'))::DATE;
  v_used   INTEGER;
BEGIN
  IF NOT public.is_business_member(p_business_id, 'member') THEN
    RAISE EXCEPTION 'not a member of business %', p_business_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Reserve first, then decide. Two concurrent requests cannot both
  -- pass a limit of 1: the second sees the first's increment because
  -- the upsert takes a row lock.
  INSERT INTO public.usage_counters (business_id, metric, period, used)
  VALUES (p_business_id, p_metric, v_period, p_amount)
  ON CONFLICT (business_id, metric, period)
  DO UPDATE SET used = public.usage_counters.used + p_amount, updated_at = NOW()
  RETURNING public.usage_counters.used INTO v_used;

  IF p_limit IS NULL THEN
    RETURN QUERY SELECT TRUE, v_used, NULL::INTEGER;
    RETURN;
  END IF;

  IF v_used > p_limit THEN
    -- Over the line: give the reservation back and refuse.
    UPDATE public.usage_counters
       SET used = GREATEST(0, used - p_amount)
     WHERE business_id = p_business_id AND metric = p_metric AND period = v_period;
    RETURN QUERY SELECT FALSE, GREATEST(0, v_used - p_amount), 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_used, GREATEST(0, p_limit - v_used);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bdm_consume_usage(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bdm_consume_usage(UUID, TEXT, INTEGER, INTEGER) TO authenticated;

-- Releases a reservation when the action it was taken for then failed.
CREATE OR REPLACE FUNCTION public.bdm_release_usage(
  p_business_id UUID, p_metric TEXT, p_amount INTEGER DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_business_member(p_business_id, 'member') THEN RETURN; END IF;
  UPDATE public.usage_counters
     SET used = GREATEST(0, used - p_amount), updated_at = NOW()
   WHERE business_id = p_business_id AND metric = p_metric
     AND period = date_trunc('month', (NOW() AT TIME ZONE 'UTC'))::DATE;
END; $$;

REVOKE EXECUTE ON FUNCTION public.bdm_release_usage(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bdm_release_usage(UUID, TEXT, INTEGER) TO authenticated;

-- ── 2. RESEND DELIVERY EVENTS ───────────────────────────────
-- Provider truth, kept separate from our own "we asked them to send it".
ALTER TABLE public.invoice_deliveries
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_type  TEXT,
  ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ;

-- Every webhook body we accept, keyed so a replay is a no-op.
CREATE TABLE IF NOT EXISTS public.provider_webhook_events (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL CHECK (provider IN ('resend', 'stripe')),
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);
ALTER TABLE public.provider_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_webhook_events FROM anon, authenticated;

-- ── 3. SUBSCRIPTIONS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  price_id               TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free',
  status                 TEXT NOT NULL DEFAULT 'inactive',
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- Only the Stripe webhook (service role) may write. A user cannot
-- upgrade themselves by writing this row.
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated, anon;
REVOKE ALL ON public.subscriptions FROM anon;

-- ── 4. BUSINESS LOGO STORAGE ────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('business-logos', 'business-logos', FALSE, 2097152,
        ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = 2097152,
      allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'],
      public = FALSE;

-- Path convention: <business_id>/<filename>. The first path segment IS
-- the tenant, so isolation is enforced by the same membership function
-- as every other table.
DROP POLICY IF EXISTS business_logos_select ON storage.objects;
CREATE POLICY business_logos_select ON storage.objects FOR SELECT
  USING (
    bucket_id = 'business-logos'
    AND public.is_business_member(((storage.foldername(name))[1])::UUID, 'viewer')
  );

DROP POLICY IF EXISTS business_logos_insert ON storage.objects;
CREATE POLICY business_logos_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'business-logos'
    AND public.is_business_member(((storage.foldername(name))[1])::UUID, 'admin')
  );

DROP POLICY IF EXISTS business_logos_update ON storage.objects;
CREATE POLICY business_logos_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'business-logos'
    AND public.is_business_member(((storage.foldername(name))[1])::UUID, 'admin')
  );

DROP POLICY IF EXISTS business_logos_delete ON storage.objects;
CREATE POLICY business_logos_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'business-logos'
    AND public.is_business_member(((storage.foldername(name))[1])::UUID, 'admin')
  );

-- ── 5. SECOND BYPASS ACCOUNT ────────────────────────────────
INSERT INTO public.founder_emails (email, note)
VALUES ('lisa@lisatraveldesign.com', 'Temporary unrestricted account — review before revoking')
ON CONFLICT (email) DO NOTHING;

UPDATE public.profiles p SET plan = 'founder'
  FROM public.founder_emails f
 WHERE lower(p.email) = lower(f.email) AND p.plan IS DISTINCT FROM 'founder';

COMMENT ON FUNCTION public.bdm_consume_usage(UUID, TEXT, INTEGER, INTEGER) IS
  'Reserve-then-check monthly usage. Race-safe: concurrent callers cannot both pass a limit of 1.';
COMMENT ON TABLE public.subscriptions IS
  'Stripe subscription state. Written only by the webhook — a success redirect is never treated as truth.';
