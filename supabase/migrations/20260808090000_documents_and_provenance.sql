-- ============================================================
-- DOCUMENT PIPELINE — STORAGE, PROVENANCE, EXTRACTION
--
-- A financial record created from a photograph of a receipt is a
-- different kind of claim than one a human typed. The difference must
-- survive in the data, or nobody can later audit which numbers a
-- machine guessed at.
--
-- Every transaction can now say: which document produced me, how the
-- figures were extracted, how confident that extraction was, and
-- whether a human confirmed it.
-- ============================================================

-- ── 1. Private storage bucket ───────────────────────────────
--
-- NOT public. Files are reached only through short-lived signed URLs
-- minted server-side after a membership check. A leaked path is useless
-- on its own.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  FALSE,
  15728640,  -- 15 MB
  ARRAY[
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- SVG is deliberately excluded: it is an executable document, and a
-- stored SVG is a stored XSS payload the moment anything renders it.

-- ── 2. Storage RLS — path encodes the business ───────────────
--
-- Object names are `<business_id>/<uuid>.<ext>`. The first path segment
-- is checked against membership, so a user can never read or write a
-- file belonging to a business they are not part of.
DROP POLICY IF EXISTS "documents read own business" ON storage.objects;
CREATE POLICY "documents read own business"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid, 'viewer')
  );

DROP POLICY IF EXISTS "documents write own business" ON storage.objects;
CREATE POLICY "documents write own business"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid, 'member')
  );

DROP POLICY IF EXISTS "documents delete own business" ON storage.objects;
CREATE POLICY "documents delete own business"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid, 'member')
  );

-- ── 3. Document extraction state ────────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS sha256              TEXT,
  ADD COLUMN IF NOT EXISTS page_count          INT,
  ADD COLUMN IF NOT EXISTS extraction_method   TEXT
    CHECK (extraction_method IS NULL OR extraction_method IN ('ai_vision','ai_text','manual','none')),
  ADD COLUMN IF NOT EXISTS extraction_model    TEXT,
  ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(4,3)
    CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS extracted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_error    TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

-- The same receipt uploaded twice is the same document. Dedupe on
-- content hash so a re-upload attaches rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_business_sha
  ON public.documents(business_id, sha256) WHERE sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_status
  ON public.documents(business_id, status) WHERE status <> 'matched';

-- ── 4. Transaction provenance ───────────────────────────────
--
-- `document_id` already existed as an attachment link. These say how a
-- transaction CAME TO EXIST, which is a different question.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_document_id  UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extraction_method   TEXT
    CHECK (extraction_method IS NULL OR extraction_method IN ('ai_vision','ai_text','manual','none')),
  ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(4,3)
    CHECK (extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS confirmed_by_user   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.transactions.confirmed_by_user IS
  'TRUE when a human approved the figures. Anything AI-extracted starts FALSE and must be confirmed before it is treated as settled.';

CREATE INDEX IF NOT EXISTS idx_transactions_unconfirmed
  ON public.transactions(business_id) WHERE confirmed_by_user = FALSE AND deleted_at IS NULL;

-- ── 5. Documents inherit the same cross-business FK guard ────
CREATE OR REPLACE FUNCTION public.bdm_assert_document_same_business()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_owner UUID;
BEGIN
  IF NEW.matched_transaction_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.transactions WHERE id = NEW.matched_transaction_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'transaction % belongs to another business', NEW.matched_transaction_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS documents_assert_same_business ON public.documents;
CREATE TRIGGER documents_assert_same_business
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.bdm_assert_document_same_business();

-- And transactions.source_document_id must belong to the same business.
CREATE OR REPLACE FUNCTION public.bdm_assert_same_business()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_owner UUID;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.categories WHERE id = NEW.category_id;
    IF v_owner IS NOT NULL AND v_owner <> NEW.business_id THEN
      RAISE EXCEPTION 'category % belongs to another business', NEW.category_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.brand_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.brands WHERE id = NEW.brand_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'brand % belongs to another business', NEW.brand_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.projects WHERE id = NEW.project_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'project % belongs to another business', NEW.project_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.counterparty_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.counterparties WHERE id = NEW.counterparty_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'counterparty % belongs to another business', NEW.counterparty_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.account_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.accounts WHERE id = NEW.account_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'account % belongs to another business', NEW.account_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.booking_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.bookings WHERE id = NEW.booking_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'booking % belongs to another business', NEW.booking_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.document_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.documents WHERE id = NEW.document_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'document % belongs to another business', NEW.document_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.source_document_id IS NOT NULL THEN
    SELECT business_id INTO v_owner FROM public.documents WHERE id = NEW.source_document_id;
    IF v_owner IS DISTINCT FROM NEW.business_id THEN
      RAISE EXCEPTION 'source document % belongs to another business', NEW.source_document_id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
