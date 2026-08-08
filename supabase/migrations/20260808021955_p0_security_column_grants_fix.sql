-- Corrective follow-up to 20260808021913.
-- `REVOKE UPDATE (col)` cannot carve a column out of a table-level
-- GRANT UPDATE. The table-wide grant must be revoked first, then the
-- allowed columns re-granted. Idempotent; folded into 0001 for clarity.
REVOKE UPDATE, INSERT ON public.profiles FROM authenticated, anon;

GRANT UPDATE (email, first_name, age, country, region, user_type, household_type, business_owner, updated_at)
  ON public.profiles TO authenticated;

GRANT INSERT (id, email, first_name, age, country, region, user_type, household_type, business_owner)
  ON public.profiles TO authenticated;
