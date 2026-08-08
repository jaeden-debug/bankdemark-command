-- ============================================================
-- P0 SECURITY HARDENING
--
-- Fixes confirmed in the 2026-08-07 audit:
--   1. `authenticated` had column-level UPDATE on profiles.plan,
--      pro_plan, stripe_customer_id, stripe_subscription_id.
--      Combined with RLS `USING (auth.uid() = id)` this let any
--      logged-in user grant themselves Pro from the browser, and
--      let them hijack another account's Stripe webhook by writing
--      that account's stripe_subscription_id.
--   2. plan lost its CHECK constraint between the repo SQL and prod.
--   3. handle_new_user() is SECURITY DEFINER, anon-executable, and
--      has a mutable search_path (Supabase advisors 0011/0028/0029).
--   4. calculator_shares has RLS enabled but zero policies.
--   5. profiles had no DELETE policy -> no account deletion path.
-- ============================================================

-- ── 1. Billing columns become server-only ───────────────────
-- Only the service role (Stripe webhook) may write these.
--
-- NOTE: `REVOKE UPDATE (col)` does NOT carve a column out of a
-- table-level GRANT UPDATE. The table-wide grant must be revoked
-- and the allowed columns re-granted explicitly.
REVOKE UPDATE, INSERT ON public.profiles FROM authenticated, anon;

GRANT UPDATE (email, first_name, age, country, region, user_type, household_type, business_owner, updated_at)
  ON public.profiles TO authenticated;

GRANT INSERT (id, email, first_name, age, country, region, user_type, household_type, business_owner)
  ON public.profiles TO authenticated;

-- ── 2. Restore + widen the plan constraint ──────────────────
-- 'pro' retained for backwards compatibility with existing webhook code.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'pro', 'starter', 'business'));

-- ── 3. Lock down SECURITY DEFINER functions ─────────────────
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, country, user_type, household_type, business_owner)
  VALUES (NEW.id, NEW.email, '', 'Canada', 'individual', 'single', FALSE)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- ── 4. calculator_shares: explicit service-role-only ────────
-- Reads and writes both go through the service role in
-- src/app/api/shares/route.js and src/app/s/[id]/page.js.
-- An explicit policy documents intent and silences advisor 0008.
DROP POLICY IF EXISTS "calculator_shares service role only" ON public.calculator_shares;
CREATE POLICY "calculator_shares service role only"
  ON public.calculator_shares FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 5. Account deletion path ────────────────────────────────
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);
