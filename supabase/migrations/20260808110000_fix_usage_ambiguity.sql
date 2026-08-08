-- ============================================================
-- FIX: ambiguous `used` in bdm_consume_usage
--
-- The OUT parameter `used` collided with the column of the same name
-- in the over-limit rollback UPDATE. That path runs precisely when a
-- customer hits their plan limit, so the limit refusal raised instead
-- of returning a clean "not allowed".
--
-- `#variable_conflict use_column` makes the column win inside the
-- statement bodies, which is what every reference here intends.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_consume_usage(
  p_business_id UUID,
  p_metric      TEXT,
  p_limit       INTEGER,
  p_amount      INTEGER DEFAULT 1
)
RETURNS TABLE (allowed BOOLEAN, used INTEGER, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_period DATE := date_trunc('month', (NOW() AT TIME ZONE 'UTC'))::DATE;
  v_used   INTEGER;
BEGIN
  IF NOT public.is_business_member(p_business_id, 'member') THEN
    RAISE EXCEPTION 'not a member of business %', p_business_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.usage_counters AS uc (business_id, metric, period, used)
  VALUES (p_business_id, p_metric, v_period, p_amount)
  ON CONFLICT (business_id, metric, period)
  DO UPDATE SET used = uc.used + p_amount, updated_at = NOW()
  RETURNING uc.used INTO v_used;

  IF p_limit IS NULL THEN
    RETURN QUERY SELECT TRUE, v_used, NULL::INTEGER;
    RETURN;
  END IF;

  IF v_used > p_limit THEN
    UPDATE public.usage_counters AS uc
       SET used = GREATEST(0, uc.used - p_amount)
     WHERE uc.business_id = p_business_id
       AND uc.metric = p_metric
       AND uc.period = v_period;
    RETURN QUERY SELECT FALSE, GREATEST(0, v_used - p_amount), 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_used, GREATEST(0, p_limit - v_used);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bdm_consume_usage(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bdm_consume_usage(UUID, TEXT, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.bdm_release_usage(
  p_business_id UUID, p_metric TEXT, p_amount INTEGER DEFAULT 1
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_business_member(p_business_id, 'member') THEN RETURN; END IF;
  UPDATE public.usage_counters AS uc
     SET used = GREATEST(0, uc.used - p_amount), updated_at = NOW()
   WHERE uc.business_id = p_business_id AND uc.metric = p_metric
     AND uc.period = date_trunc('month', (NOW() AT TIME ZONE 'UTC'))::DATE;
END; $$;

REVOKE EXECUTE ON FUNCTION public.bdm_release_usage(UUID, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bdm_release_usage(UUID, TEXT, INTEGER) TO authenticated;
