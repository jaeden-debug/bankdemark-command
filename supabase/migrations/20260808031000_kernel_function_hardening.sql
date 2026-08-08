-- Supabase advisors 0011/0028/0029 against the kernel's own functions.
-- A PUBLIC grant overrides a role-level REVOKE, so PUBLIC must be
-- revoked before re-granting to `authenticated` only.

ALTER FUNCTION public.bdm_revenue_types() SET search_path = '';
ALTER FUNCTION public.bdm_expense_types() SET search_path = '';
ALTER FUNCTION public.bdm_role_rank(public.business_role) SET search_path = '';

-- Trigger-only function: nothing should call it over the REST API.
REVOKE EXECUTE ON FUNCTION public.bdm_add_owner_membership() FROM PUBLIC, anon, authenticated;

-- RLS helper: needed by policies (which run as the definer anyway) and
-- by signed-in users, but never by anonymous callers.
REVOKE EXECUTE ON FUNCTION public.is_business_member(UUID, public.business_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_business_member(UUID, public.business_role) TO authenticated;
