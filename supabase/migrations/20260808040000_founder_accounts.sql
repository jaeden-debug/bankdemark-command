-- ============================================================
-- FOUNDER ACCOUNTS
--
-- A `founder` plan that bypasses every entitlement limit, granted
-- automatically to a fixed allow-list of emails.
--
-- Two properties matter for security:
--   1. `plan` remains unwritable by users (the P0 revoke stands).
--      Only this SECURITY DEFINER trigger can set 'founder'.
--   2. The allow-list is a table, not an env var or a client check,
--      so elevation is auditable and revocable in one place.
-- ============================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'pro', 'starter', 'business', 'founder'));

CREATE TABLE IF NOT EXISTS public.founder_emails (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service-role only. Users must never read or write the allow-list.
ALTER TABLE public.founder_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founder_emails FROM anon, authenticated;

DROP POLICY IF EXISTS founder_emails_service_only ON public.founder_emails;
CREATE POLICY founder_emails_service_only ON public.founder_emails FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.founder_emails (email, note)
VALUES ('admin@zylx.ai', 'Founder account — full access, all limits bypassed')
ON CONFLICT (email) DO NOTHING;

-- ── Elevation on profile create ─────────────────────────────
CREATE OR REPLACE FUNCTION public.bdm_apply_founder_plan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.founder_emails f WHERE lower(f.email) = lower(NEW.email))
  THEN
    NEW.plan := 'founder';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_apply_founder_plan ON public.profiles;
CREATE TRIGGER profiles_apply_founder_plan
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.bdm_apply_founder_plan();

REVOKE EXECUTE ON FUNCTION public.bdm_apply_founder_plan() FROM PUBLIC, anon, authenticated;

-- Elevate any founder account that already exists.
UPDATE public.profiles p
   SET plan = 'founder'
  FROM public.founder_emails f
 WHERE lower(p.email) = lower(f.email) AND p.plan IS DISTINCT FROM 'founder';
