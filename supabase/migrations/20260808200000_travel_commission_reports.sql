-- Phase 1 travel commission reports. Extends the generic booking,
-- document and commission-payment kernel; it does not create a parallel ledger.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS return_date DATE,
  ADD COLUMN IF NOT EXISTS host_agency_id UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source public.data_source NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_normalized_reference
  ON public.bookings(
    business_id,
    UPPER(regexp_replace(btrim(reference), '\s+', ' ', 'g'))
  ) WHERE reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bdm_assert_booking_host_same_business()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_owner UUID;
BEGIN
  IF NEW.host_agency_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.counterparties WHERE id = NEW.host_agency_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'host agency belongs to another business' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS bookings_host_same_business ON public.bookings;
CREATE TRIGGER bookings_host_same_business
  BEFORE INSERT OR UPDATE OF host_agency_id, business_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bdm_assert_booking_host_same_business();

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN ('receipt','invoice','statement','contract','commission_report','other'));

CREATE TABLE IF NOT EXISTS public.commission_report_lines (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id                  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  document_id                  UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  row_position                 INT NOT NULL CHECK (row_position >= 0),
  raw_booking_reference        TEXT,
  normalized_booking_reference TEXT,
  reported_amount_minor        BIGINT,
  currency                     CHAR(3),
  matched_booking_id           UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  match_status                 TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched','matched','needs_attention','approved','rejected')),
  anomaly_code                 TEXT
    CHECK (anomaly_code IS NULL OR anomaly_code IN (
      'UNKNOWN_BOOKING','AMOUNT_MISMATCH','DUPLICATE_PAYMENT',
      'DUPLICATE_REPORT_ENTRY','WRONG_CURRENCY','REPORT_TOTAL_MISMATCH','LUMP_SUM_MISMATCH'
    )),
  anomaly_detail               TEXT,
  extraction_confidence        NUMERIC(4,3)
    CHECK (extraction_confidence IS NULL OR extraction_confidence BETWEEN 0 AND 1),
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at                  TIMESTAMPTZ,
  reviewed_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (document_id, row_position)
);

CREATE INDEX IF NOT EXISTS idx_commission_report_lines_business
  ON public.commission_report_lines(business_id, match_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_report_lines_document
  ON public.commission_report_lines(document_id, row_position);
CREATE INDEX IF NOT EXISTS idx_commission_report_lines_booking
  ON public.commission_report_lines(matched_booking_id) WHERE matched_booking_id IS NOT NULL;

ALTER TABLE public.commission_payments
  ADD COLUMN IF NOT EXISTS report_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_line_id UUID REFERENCES public.commission_report_lines(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_payments_report_line
  ON public.commission_payments(report_line_id) WHERE report_line_id IS NOT NULL;

-- Every cross-reference must remain inside one business.
CREATE OR REPLACE FUNCTION public.bdm_assert_commission_report_line_same_business()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_owner UUID;
BEGIN
  SELECT business_id INTO v_owner FROM public.documents WHERE id = NEW.document_id;
  IF v_owner IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'document belongs to another business' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.matched_booking_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.bookings WHERE id = NEW.matched_booking_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'booking belongs to another business' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS commission_report_lines_same_business ON public.commission_report_lines;
CREATE TRIGGER commission_report_lines_same_business
  BEFORE INSERT OR UPDATE ON public.commission_report_lines
  FOR EACH ROW EXECUTE FUNCTION public.bdm_assert_commission_report_line_same_business();

CREATE OR REPLACE FUNCTION public.bdm_assert_commission_payment_evidence_same_business()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_owner UUID; v_document UUID; v_booking UUID;
BEGIN
  IF NEW.report_document_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.documents WHERE id = NEW.report_document_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'report document belongs to another business' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.report_line_id IS NOT NULL THEN
    SELECT business_id, document_id, matched_booking_id
      INTO v_owner, v_document, v_booking
      FROM public.commission_report_lines WHERE id = NEW.report_line_id;
    IF v_owner IS DISTINCT FROM NEW.business_id
       OR v_document IS DISTINCT FROM NEW.report_document_id
       OR v_booking IS DISTINCT FROM NEW.booking_id THEN
      RAISE EXCEPTION 'report evidence does not match payment' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS commission_payments_evidence_same_business ON public.commission_payments;
CREATE TRIGGER commission_payments_evidence_same_business
  BEFORE INSERT OR UPDATE ON public.commission_payments
  FOR EACH ROW EXECUTE FUNCTION public.bdm_assert_commission_payment_evidence_same_business();

ALTER TABLE public.commission_report_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_report_lines_select ON public.commission_report_lines FOR SELECT
  USING (public.is_business_member(business_id, 'viewer'));
CREATE POLICY commission_report_lines_insert ON public.commission_report_lines FOR INSERT
  WITH CHECK (public.is_business_member(business_id, 'member'));
CREATE POLICY commission_report_lines_update ON public.commission_report_lines FOR UPDATE
  USING (public.is_business_member(business_id, 'member'))
  WITH CHECK (public.is_business_member(business_id, 'member'));
CREATE POLICY commission_report_lines_delete ON public.commission_report_lines FOR DELETE
  USING (public.is_business_member(business_id, 'member'));
REVOKE ALL ON public.commission_report_lines FROM anon;

-- Atomic, idempotent approval. The database revalidates every proposed
-- match against current booking truth before any payment is written.
CREATE OR REPLACE FUNCTION public.bdm_approve_commission_report(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_business UUID;
  v_date DATE;
  v_invalid INT;
  v_count INT;
BEGIN
  SELECT business_id, COALESCE(doc_date, CURRENT_DATE)
    INTO v_business, v_date
    FROM public.documents
   WHERE id = p_document_id AND doc_type = 'commission_report'
   FOR UPDATE;

  IF v_business IS NULL OR NOT public.is_business_member(v_business, 'member') THEN
    RAISE EXCEPTION 'commission report not found' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_invalid
    FROM public.commission_report_lines l
    LEFT JOIN public.bookings b ON b.id = l.matched_booking_id
   WHERE l.document_id = p_document_id
     AND l.match_status = 'matched'
     AND (
       b.id IS NULL OR l.business_id <> v_business OR
       l.currency IS DISTINCT FROM b.currency OR
       l.reported_amount_minor IS DISTINCT FROM
         GREATEST(0, b.commission_expected_minor - b.commission_received_minor) OR
       EXISTS (SELECT 1 FROM public.commission_payments p WHERE p.report_line_id = l.id)
     );

  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'report matches changed; reconcile again before approval'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.commission_payments (
    business_id, booking_id, amount_minor, currency, received_on,
    report_document_id, report_line_id, notes, created_by
  )
  SELECT l.business_id, l.matched_booking_id, l.reported_amount_minor,
         l.currency, v_date, p_document_id, l.id,
         'Approved commission report', (SELECT auth.uid())
    FROM public.commission_report_lines l
   WHERE l.document_id = p_document_id
     AND l.match_status = 'matched'
     AND l.matched_booking_id IS NOT NULL
     AND l.reported_amount_minor > 0
  ON CONFLICT (report_line_id) WHERE report_line_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.commission_report_lines
     SET match_status = 'approved', reviewed_at = NOW(), reviewed_by = (SELECT auth.uid())
   WHERE document_id = p_document_id AND match_status = 'matched';

  UPDATE public.documents
     SET status = CASE WHEN EXISTS (
           SELECT 1 FROM public.commission_report_lines
            WHERE document_id = p_document_id AND match_status = 'needs_attention'
         ) THEN 'extracted' ELSE 'matched' END,
         confirmed_by = (SELECT auth.uid()), confirmed_at = COALESCE(confirmed_at, NOW())
   WHERE id = p_document_id;

  IF v_count > 0 THEN
    INSERT INTO public.audit_log (
      business_id, actor_user_id, actor_type, entity, entity_id, action, after, source
    ) VALUES (
      v_business, (SELECT auth.uid()), 'user', 'commission_report', p_document_id::TEXT,
      'approve_matches', jsonb_build_object('payment_count', v_count), 'manual'
    );
  END IF;

  RETURN jsonb_build_object('paymentCount', v_count, 'idempotent', v_count = 0);
END; $$;

REVOKE ALL ON FUNCTION public.bdm_approve_commission_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bdm_approve_commission_report(UUID) TO authenticated;
