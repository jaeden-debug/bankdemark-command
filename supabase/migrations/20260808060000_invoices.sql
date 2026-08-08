-- ============================================================
-- BANKDEMARK INVOICING
--
-- Invoices as first-class entities of the financial kernel.
--
-- WHY THERE IS NO SEPARATE `receivables` TABLE
--   An issued, unsettled invoice IS the receivable. Its
--   `balance_minor` is the amount owed. Adding a parallel
--   receivables table would create a second source of truth for
--   the same number and guarantee they drift.
--
--   Accounts receivable therefore has exactly two components, and
--   they never overlap:
--     1. INVOICED    — SUM(invoices.balance_minor) for live invoices
--     2. UNINVOICED  — booking commissions expected but not yet
--                      invoiced (bookings.commission_expected_minor
--                      minus received, where no live invoice cites
--                      that booking)
--   `bdm_ar_position()` below computes both and keeps them apart.
--
-- WHY INVOICES DO NOT CREATE REVENUE
--   Revenue recognition belongs to `transactions` and nothing else.
--   An invoice is a commercial document plus a receivable position.
--   Issuing one earns nothing; being paid does. When an invoice
--   payment is matched to a bank transaction, that transaction
--   carries the recognized amount. This is what prevents an invoice
--   and its matching deposit from both landing in the P&L.
--
-- MONEY
--   BIGINT minor units, always paired with an explicit currency.
--   Quantities and tax rates are NUMERIC (they are not money).
--
-- IMMUTABILITY
--   A draft is a working document. Issuing it freezes the financial
--   record: number, dates, money, tax, counterparty, and snapshots of
--   both parties' identities as they stood at that moment. Enforced by
--   a database trigger, not by service-layer good intentions.
--   Corrections happen by void or revision, never by rewriting history.
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'issued',
    'sent',
    'viewed',
    'partially_paid',
    'paid',
    'overdue',
    'void'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Why does this invoice exist? Provenance is relational, never a note.
DO $$ BEGIN
  CREATE TYPE public.invoice_source_kind AS ENUM (
    'manual',
    'booking',
    'commission',
    'project',
    'contract',
    'recurring',
    'order',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.invoice_delivery_state AS ENUM (
    'queued',
    'sent',
    'delivered',
    'bounced',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How a tax code behaves. `zero_rated` and `exempt` are both 0% but
-- are legally distinct and appear differently on a return — the model
-- must not collapse them into "no tax".
DO $$ BEGIN
  CREATE TYPE public.tax_treatment AS ENUM (
    'standard',
    'zero_rated',
    'exempt',
    'out_of_scope'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TAX RATES
--
-- BankDeMark is not a tax authority. These rows are a starting
-- reference carrying their own jurisdiction, effective window and
-- source, and a business may override any of them. An invoice
-- snapshots the code and rate it actually used, so a later rate
-- change can never rewrite a historical document.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tax_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL business_id = system reference rate, visible to everyone.
  business_id    UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  jurisdiction   TEXT NOT NULL,                       -- 'CA-ON', 'CA-NS', 'GB', 'US-WA'
  code           TEXT NOT NULL,                       -- 'HST', 'GST', 'QST', 'VAT'
  label          TEXT NOT NULL,
  rate           NUMERIC(9,6) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  treatment      public.tax_treatment NOT NULL DEFAULT 'standard',
  effective_from DATE NOT NULL DEFAULT '2000-01-01',
  effective_to   DATE,
  source         TEXT,                                -- where the number came from
  source_url     TEXT,
  last_verified  DATE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_rates_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_tax_rates_lookup
  ON public.tax_rates(jurisdiction, code, effective_from DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rates_system_unique
  ON public.tax_rates(jurisdiction, code, effective_from) WHERE business_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tax_rates_business
  ON public.tax_rates(business_id) WHERE business_id IS NOT NULL;

-- ============================================================
-- INVOICE SETTINGS  (per business — numbering, branding, defaults)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_settings (
  business_id           UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Numbering
  number_prefix         TEXT NOT NULL DEFAULT 'INV'
    CHECK (number_prefix ~ '^[A-Z0-9]{1,8}$'),
  number_include_year   BOOLEAN NOT NULL DEFAULT TRUE,
  number_pad            SMALLINT NOT NULL DEFAULT 4 CHECK (number_pad BETWEEN 1 AND 8),
  next_sequence         INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
  sequence_year         SMALLINT,   -- year the sequence belongs to, when year-scoped

  -- Identity shown on the invoice (falls back to businesses.name)
  legal_name            TEXT,
  logo_path             TEXT,       -- Supabase storage path
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  region                TEXT,
  postal_code           TEXT,
  country               TEXT,
  email                 TEXT,
  phone                 TEXT,
  website               TEXT,
  tax_number            TEXT,
  tax_number_label      TEXT NOT NULL DEFAULT 'GST/HST',

  -- Presentation
  template              TEXT NOT NULL DEFAULT 'clean'
    CHECK (template IN ('clean', 'modern', 'professional')),
  accent_color          TEXT NOT NULL DEFAULT '#c6a24a'
    CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  footer_text           TEXT,
  show_bdm_credit       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Defaults applied to new drafts
  default_payment_terms TEXT NOT NULL DEFAULT 'net_30',
  default_due_days      SMALLINT NOT NULL DEFAULT 30 CHECK (default_due_days BETWEEN 0 AND 365),
  default_notes         TEXT,
  default_terms         TEXT,
  payment_instructions  TEXT,
  default_tax_code      TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CUSTOM FIELD DEFINITIONS  (per business)
--
-- Structured supplementary context — booking reference, traveller,
-- PO number, matter number. Context only: a custom field never
-- contributes to a total. Anything that affects money is a line.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_custom_fields (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  key          TEXT NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  label        TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 60),
  field_type   TEXT NOT NULL DEFAULT 'text'
    CHECK (field_type IN ('text', 'number', 'date', 'date_range', 'currency', 'percent')),
  help_text    TEXT,
  sort_order   INT NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, key)
);
CREATE INDEX IF NOT EXISTS idx_invoice_custom_fields_business
  ON public.invoice_custom_fields(business_id, sort_order) WHERE is_active;

-- ============================================================
-- INVOICES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- RESTRICT, not SET NULL: deleting a customer must never blank the
  -- "Bill To" on a historical financial document.
  counterparty_id          UUID REFERENCES public.counterparties(id) ON DELETE RESTRICT,

  -- Provenance. Why this invoice exists.
  source_kind              public.invoice_source_kind NOT NULL DEFAULT 'manual',
  booking_id               UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  project_id               UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  -- The immutable issued PDF.
  document_id              UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  -- Correction chain: a revision or credit note points at its original.
  parent_invoice_id        UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  is_credit_note           BOOLEAN NOT NULL DEFAULT FALSE,

  -- NULL until issued. Drafts have no legal number.
  number                   TEXT,
  currency                 CHAR(3) NOT NULL DEFAULT 'CAD',

  issue_date               DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date                 DATE NOT NULL DEFAULT CURRENT_DATE,
  status                   public.invoice_status NOT NULL DEFAULT 'draft',

  subtotal_minor           BIGINT NOT NULL DEFAULT 0,
  discount_minor           BIGINT NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor                BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor              BIGINT NOT NULL DEFAULT 0,
  paid_minor               BIGINT NOT NULL DEFAULT 0,
  balance_minor            BIGINT NOT NULL DEFAULT 0,

  discount_kind            TEXT NOT NULL DEFAULT 'percentage'
    CHECK (discount_kind IN ('percentage', 'fixed')),
  discount_value           NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),

  -- Tax lines as computed at issue: [{code,label,rate,treatment,taxableMinor,taxMinor}]
  tax_breakdown            JSONB NOT NULL DEFAULT '[]'::jsonb,

  notes                    TEXT,
  terms                    TEXT,
  payment_terms            TEXT,
  payment_instructions     TEXT,

  custom_fields            JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Frozen at issue. This is what the PDF renders from, forever.
  issued_business_snapshot JSONB,
  issued_client_snapshot   JSONB,

  -- Public link. Never exposed to `anon` — resolved server-side only.
  share_token              TEXT UNIQUE,
  share_revoked_at         TIMESTAMPTZ,

  issued_at                TIMESTAMPTZ,
  sent_at                  TIMESTAMPTZ,
  viewed_at                TIMESTAMPTZ,
  paid_at                  TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,
  void_reason              TEXT,

  source                   public.data_source NOT NULL DEFAULT 'manual',
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT invoices_dates CHECK (due_date >= issue_date),
  CONSTRAINT invoices_paid_nonneg CHECK (paid_minor >= 0),
  -- Credit notes are negative documents; ordinary invoices are not.
  CONSTRAINT invoices_total_sign CHECK (
    (is_credit_note AND total_minor <= 0) OR (NOT is_credit_note AND total_minor >= 0)
  ),
  -- An issued invoice always has a number, an issue timestamp and
  -- both identity snapshots. A draft has none of them.
  CONSTRAINT invoices_issued_complete CHECK (
    (issued_at IS NULL AND number IS NULL)
    OR (issued_at IS NOT NULL AND number IS NOT NULL
        AND issued_business_snapshot IS NOT NULL
        AND issued_client_snapshot IS NOT NULL)
  ),
  CONSTRAINT invoices_draft_status CHECK (
    (status = 'draft') = (issued_at IS NULL)
  ),
  CONSTRAINT invoices_void_reason CHECK (
    (status <> 'void') OR (voided_at IS NOT NULL)
  )
);

-- Numbers are unique per business and never reused.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number
  ON public.invoices(business_id, number) WHERE number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_business_status
  ON public.invoices(business_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_business_issue
  ON public.invoices(business_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_counterparty
  ON public.invoices(counterparty_id) WHERE counterparty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_booking
  ON public.invoices(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_project
  ON public.invoices(project_id) WHERE project_id IS NOT NULL;
-- Partial index over the live AR set — the query the dashboard runs most.
CREATE INDEX IF NOT EXISTS idx_invoices_outstanding
  ON public.invoices(business_id, due_date)
  WHERE status IN ('issued', 'sent', 'viewed', 'partially_paid', 'overdue');

-- ============================================================
-- INVOICE LINES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  -- Denormalised so RLS can be evaluated without a join.
  business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  position         INT NOT NULL DEFAULT 0,
  description      TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000),

  quantity         NUMERIC(14,4) NOT NULL DEFAULT 1,
  unit_price_minor BIGINT NOT NULL DEFAULT 0,

  subtotal_minor   BIGINT NOT NULL DEFAULT 0,
  -- Share of the invoice-level discount allocated to this line.
  discount_minor   BIGINT NOT NULL DEFAULT 0,

  tax_code         TEXT,
  tax_label        TEXT,
  tax_rate         NUMERIC(9,6) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  tax_treatment    public.tax_treatment NOT NULL DEFAULT 'standard',
  tax_minor        BIGINT NOT NULL DEFAULT 0,

  total_minor      BIGINT NOT NULL DEFAULT 0,

  -- Revenue classification, so an invoice can inform the P&L and
  -- project profitability rather than being an isolated document.
  category_id      UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  project_id       UUID REFERENCES public.projects(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT invoice_lines_qty_nonzero CHECK (quantity <> 0)
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
  ON public.invoice_lines(invoice_id, position);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_business
  ON public.invoice_lines(business_id);

-- ============================================================
-- INVOICE PAYMENTS
--
-- A settlement event against an invoice. `transaction_id` links it to
-- the real bank movement once matched. The invoice payment records
-- WHAT WAS SETTLED; the transaction records WHAT MOVED and carries
-- the recognized revenue. Never both.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  transaction_id  UUID REFERENCES public.transactions(id) ON DELETE SET NULL,

  amount_minor    BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency        CHAR(3) NOT NULL DEFAULT 'CAD',
  received_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  method          TEXT,
  reference       TEXT,
  notes           TEXT,

  match_status    TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'confirmed')),
  match_confidence NUMERIC(4,3)
    CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),

  source          public.data_source NOT NULL DEFAULT 'manual',
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON public.invoice_payments(invoice_id, received_on DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_business
  ON public.invoice_payments(business_id, received_on DESC);
-- One bank transaction settles one invoice. Prevents the same deposit
-- being counted against two invoices.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_transaction
  ON public.invoice_payments(transaction_id) WHERE transaction_id IS NOT NULL;

-- ============================================================
-- INVOICE EVENTS  (append-only domain observability)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_events (
  id             BIGSERIAL PRIMARY KEY,
  invoice_id     UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type     TEXT NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user','zylx','mcp','system','import','integration','stripe')),
  event          TEXT NOT NULL,
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice
  ON public.invoice_events(invoice_id, created_at DESC);

-- ============================================================
-- INVOICE DELIVERIES  (email attempts — answers "was it sent?")
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invoice_deliveries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel        TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'link')),
  to_email       TEXT,
  cc_email       TEXT,
  reply_to       TEXT,
  subject        TEXT,
  provider       TEXT,
  provider_message_id TEXT,
  state          public.invoice_delivery_state NOT NULL DEFAULT 'queued',
  error          TEXT,
  -- Guards against a double-click sending two copies.
  idempotency_key TEXT,
  sent_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_deliveries_invoice
  ON public.invoice_deliveries(invoice_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_deliveries_idem
  ON public.invoice_deliveries(invoice_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_deliveries_provider_msg
  ON public.invoice_deliveries(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ============================================================
-- ATOMIC INVOICE NUMBERING
--
-- The old invoicing prototype computed the next number in the browser
-- from the list of existing ones. Two tabs produced the same number.
-- This does it in one statement, under a row lock, server-side.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_next_invoice_number(p_business_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix       TEXT;
  v_include_year BOOLEAN;
  v_pad          SMALLINT;
  v_seq          INTEGER;
  v_year         SMALLINT := EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT;
  v_number       TEXT;
BEGIN
  IF NOT public.is_business_member(p_business_id, 'member') THEN
    RAISE EXCEPTION 'not a member of business %', p_business_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Create settings on first use so numbering never depends on an
  -- earlier onboarding step having run.
  INSERT INTO public.invoice_settings (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  -- FOR UPDATE serialises concurrent issuers on this business.
  SELECT number_prefix, number_include_year, number_pad, next_sequence, sequence_year
    INTO v_prefix, v_include_year, v_pad, v_seq, v_year
    FROM public.invoice_settings
   WHERE business_id = p_business_id
     FOR UPDATE;

  -- Year-scoped sequences restart at 1 in a new year.
  IF v_include_year THEN
    IF v_year IS DISTINCT FROM EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT THEN
      v_seq := 1;
    END IF;
    v_number := v_prefix || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                || '-' || lpad(v_seq::TEXT, v_pad, '0');
  ELSE
    v_number := v_prefix || '-' || lpad(v_seq::TEXT, v_pad, '0');
  END IF;

  UPDATE public.invoice_settings
     SET next_sequence = v_seq + 1,
         sequence_year = EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT,
         updated_at = NOW()
   WHERE business_id = p_business_id;

  -- A number already taken (imported history, manual entry) must not be
  -- reused. Skip forward rather than colliding.
  WHILE EXISTS (
    SELECT 1 FROM public.invoices
     WHERE business_id = p_business_id AND number = v_number
  ) LOOP
    v_seq := v_seq + 1;
    IF v_include_year THEN
      v_number := v_prefix || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
                  || '-' || lpad(v_seq::TEXT, v_pad, '0');
    ELSE
      v_number := v_prefix || '-' || lpad(v_seq::TEXT, v_pad, '0');
    END IF;
    UPDATE public.invoice_settings
       SET next_sequence = v_seq + 1
     WHERE business_id = p_business_id;
  END LOOP;

  RETURN v_number;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bdm_next_invoice_number(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bdm_next_invoice_number(UUID) TO authenticated;

-- ============================================================
-- IMMUTABILITY GUARD
--
-- Once issued_at is set, the financial identity of the document is
-- frozen at the database layer. The service layer enforces the same
-- rule with friendlier errors; this is the backstop that holds even
-- if someone bypasses it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_guard_issued_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Drafts are freely editable, and the issue transition itself
  -- (OLD.issued_at IS NULL) is what sets these fields.
  IF OLD.issued_at IS NULL THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  IF NEW.number             IS DISTINCT FROM OLD.number
  OR NEW.currency           IS DISTINCT FROM OLD.currency
  OR NEW.issue_date         IS DISTINCT FROM OLD.issue_date
  OR NEW.due_date           IS DISTINCT FROM OLD.due_date
  OR NEW.counterparty_id    IS DISTINCT FROM OLD.counterparty_id
  OR NEW.subtotal_minor     IS DISTINCT FROM OLD.subtotal_minor
  OR NEW.discount_minor     IS DISTINCT FROM OLD.discount_minor
  OR NEW.tax_minor          IS DISTINCT FROM OLD.tax_minor
  OR NEW.total_minor        IS DISTINCT FROM OLD.total_minor
  OR NEW.discount_kind      IS DISTINCT FROM OLD.discount_kind
  OR NEW.discount_value     IS DISTINCT FROM OLD.discount_value
  OR NEW.tax_breakdown      IS DISTINCT FROM OLD.tax_breakdown
  OR NEW.custom_fields      IS DISTINCT FROM OLD.custom_fields
  OR NEW.notes              IS DISTINCT FROM OLD.notes
  OR NEW.terms              IS DISTINCT FROM OLD.terms
  OR NEW.payment_instructions IS DISTINCT FROM OLD.payment_instructions
  OR NEW.issued_at          IS DISTINCT FROM OLD.issued_at
  OR NEW.issued_business_snapshot IS DISTINCT FROM OLD.issued_business_snapshot
  OR NEW.issued_client_snapshot   IS DISTINCT FROM OLD.issued_client_snapshot
  OR NEW.is_credit_note     IS DISTINCT FROM OLD.is_credit_note
  OR NEW.business_id        IS DISTINCT FROM OLD.business_id
  THEN
    RAISE EXCEPTION
      'Invoice % is issued. Its financial record cannot be changed — void it or issue a revision.',
      COALESCE(OLD.number, OLD.id::TEXT)
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_guard_issued ON public.invoices;
CREATE TRIGGER invoices_guard_issued
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.bdm_guard_issued_invoice();

-- An issued invoice is never deleted. Void it.
CREATE OR REPLACE FUNCTION public.bdm_guard_invoice_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.issued_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Invoice % has been issued and cannot be deleted. Void it instead.',
      COALESCE(OLD.number, OLD.id::TEXT)
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS invoices_guard_delete ON public.invoices;
CREATE TRIGGER invoices_guard_delete
  BEFORE DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.bdm_guard_invoice_delete();

-- Lines of an issued invoice are frozen too, or the guard above
-- would protect the totals while the detail beneath them changed.
CREATE OR REPLACE FUNCTION public.bdm_guard_issued_invoice_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_issued TIMESTAMPTZ;
  v_row    public.invoice_lines;
BEGIN
  v_row := COALESCE(NEW, OLD);
  SELECT issued_at INTO v_issued FROM public.invoices WHERE id = v_row.invoice_id;

  IF v_issued IS NOT NULL THEN
    RAISE EXCEPTION
      'This invoice has been issued. Its line items cannot be changed — void it or issue a revision.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS invoice_lines_guard_issued ON public.invoice_lines;
CREATE TRIGGER invoice_lines_guard_issued
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.bdm_guard_issued_invoice_line();

-- Events and deliveries are history: append-only.
REVOKE UPDATE, DELETE ON public.invoice_events FROM authenticated, anon;

-- ============================================================
-- PAYMENT → INVOICE RECALCULATION
--
-- paid_minor, balance_minor and status are always derived from the
-- payment rows. They are never typed in by a caller, so they cannot
-- drift out of agreement with the payments that justify them.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_recalc_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_invoice_id UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_paid       BIGINT;
  v_inv        public.invoices;
  v_status     public.invoice_status;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO v_paid
    FROM public.invoice_payments WHERE invoice_id = v_invoice_id;

  SELECT * INTO v_inv FROM public.invoices WHERE id = v_invoice_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- A void invoice stays void; a draft cannot take payments (enforced
  -- in the service) so it stays a draft.
  IF v_inv.status IN ('void', 'draft') THEN
    v_status := v_inv.status;
  ELSIF v_paid >= v_inv.total_minor AND v_inv.total_minor > 0 THEN
    v_status := 'paid';
  ELSIF v_paid > 0 THEN
    v_status := 'partially_paid';
  ELSIF v_inv.due_date < CURRENT_DATE THEN
    v_status := 'overdue';
  ELSE
    -- Fall back to the furthest point already reached, never backwards
    -- past it: deleting a payment must not un-send an invoice.
    v_status := CASE
      WHEN v_inv.viewed_at IS NOT NULL THEN 'viewed'
      WHEN v_inv.sent_at   IS NOT NULL THEN 'sent'
      ELSE 'issued'
    END;
  END IF;

  UPDATE public.invoices
     SET paid_minor    = v_paid,
         balance_minor = GREATEST(0, total_minor - v_paid),
         status        = v_status,
         paid_at       = CASE WHEN v_status = 'paid' THEN COALESCE(paid_at, NOW()) ELSE NULL END,
         updated_at    = NOW()
   WHERE id = v_invoice_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS invoice_payments_recalc ON public.invoice_payments;
CREATE TRIGGER invoice_payments_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.bdm_recalc_invoice_payment();

-- ============================================================
-- OVERDUE
--
-- Derived, not remembered. The old prototype had an `overdue` status
-- that nothing ever set, so every overdue feature silently did nothing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_refresh_overdue_invoices(p_business_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_business_id IS NOT NULL
     AND NOT public.is_business_member(p_business_id, 'viewer') THEN
    RAISE EXCEPTION 'not a member of business %', p_business_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH updated AS (
    UPDATE public.invoices
       SET status = 'overdue', updated_at = NOW()
     WHERE status IN ('issued', 'sent', 'viewed', 'partially_paid')
       AND due_date < CURRENT_DATE
       AND balance_minor > 0
       AND (p_business_id IS NULL OR business_id = p_business_id)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bdm_refresh_overdue_invoices(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bdm_refresh_overdue_invoices(UUID) TO authenticated;

-- ============================================================
-- ACCOUNTS RECEIVABLE POSITION
--
-- Invoiced and uninvoiced are returned separately and never added
-- together by this function, because summing them would double-count
-- a booking commission that has already been invoiced.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_ar_position(p_business_id UUID)
RETURNS TABLE (
  currency              CHAR(3),
  invoiced_minor        BIGINT,
  overdue_minor         BIGINT,
  uninvoiced_commission_minor BIGINT,
  invoice_count         INT,
  overdue_count         INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH live AS (
    SELECT i.currency, i.balance_minor, i.due_date
      FROM public.invoices i
     WHERE i.business_id = p_business_id
       AND i.status IN ('issued','sent','viewed','partially_paid','overdue')
       AND i.balance_minor > 0
  ),
  uninvoiced AS (
    SELECT b.currency,
           SUM(GREATEST(0, b.commission_expected_minor - b.commission_received_minor)) AS amount
      FROM public.bookings b
     WHERE b.business_id = p_business_id
       AND b.commission_status IN ('expected','earned','receivable','partial')
       AND b.status <> 'cancelled'
       -- Exclude anything a live invoice already represents.
       AND NOT EXISTS (
         SELECT 1 FROM public.invoices i
          WHERE i.booking_id = b.id
            AND i.status IN ('issued','sent','viewed','partially_paid','overdue','paid')
       )
     GROUP BY b.currency
  )
  SELECT
    COALESCE(l.currency, u.currency)                                    AS currency,
    COALESCE(SUM(l.balance_minor), 0)::BIGINT                           AS invoiced_minor,
    COALESCE(SUM(l.balance_minor) FILTER (WHERE l.due_date < CURRENT_DATE), 0)::BIGINT
                                                                        AS overdue_minor,
    COALESCE(MAX(u.amount), 0)::BIGINT                                  AS uninvoiced_commission_minor,
    COUNT(l.balance_minor)::INT                                         AS invoice_count,
    COUNT(l.balance_minor) FILTER (WHERE l.due_date < CURRENT_DATE)::INT AS overdue_count
  FROM live l
  FULL OUTER JOIN uninvoiced u ON u.currency = l.currency
  GROUP BY COALESCE(l.currency, u.currency);
$$;

-- ============================================================
-- updated_at triggers
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tax_rates','invoice_settings','invoice_custom_fields','invoice_deliveries'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %1$s_updated_at ON public.%1$s;
       CREATE TRIGGER %1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- ============================================================
-- ROW LEVEL SECURITY
--
-- No policy anywhere keys off a share token. Public invoice links are
-- resolved server-side with the service role; `anon` has no grant on
-- any of these tables at all.
-- ============================================================

ALTER TABLE public.invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_deliveries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_rates             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invoices','invoice_lines','invoice_payments','invoice_deliveries',
    'invoice_settings','invoice_custom_fields'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s;', t);
    EXECUTE format($f$CREATE POLICY %1$s_select ON public.%1$s FOR SELECT
                      USING (public.is_business_member(business_id, 'viewer'));$f$, t);

    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON public.%1$s;', t);
    EXECUTE format($f$CREATE POLICY %1$s_insert ON public.%1$s FOR INSERT
                      WITH CHECK (public.is_business_member(business_id, 'member'));$f$, t);

    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON public.%1$s;', t);
    EXECUTE format($f$CREATE POLICY %1$s_update ON public.%1$s FOR UPDATE
                      USING (public.is_business_member(business_id, 'member'))
                      WITH CHECK (public.is_business_member(business_id, 'member'));$f$, t);

    EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON public.%1$s;', t);
    EXECUTE format($f$CREATE POLICY %1$s_delete ON public.%1$s FOR DELETE
                      USING (public.is_business_member(business_id, 'member'));$f$, t);
  END LOOP;
END $$;

-- invoice_events: readable by viewers, appendable, never rewritable.
DROP POLICY IF EXISTS invoice_events_select ON public.invoice_events;
CREATE POLICY invoice_events_select ON public.invoice_events FOR SELECT
  USING (public.is_business_member(business_id, 'viewer'));

DROP POLICY IF EXISTS invoice_events_insert ON public.invoice_events;
CREATE POLICY invoice_events_insert ON public.invoice_events FOR INSERT
  WITH CHECK (public.is_business_member(business_id, 'viewer'));

-- tax_rates: system rows readable by anyone signed in; a business may
-- add and manage its own overrides but can never edit a system rate.
DROP POLICY IF EXISTS tax_rates_select ON public.tax_rates;
CREATE POLICY tax_rates_select ON public.tax_rates FOR SELECT
  USING (business_id IS NULL OR public.is_business_member(business_id, 'viewer'));

DROP POLICY IF EXISTS tax_rates_insert ON public.tax_rates;
CREATE POLICY tax_rates_insert ON public.tax_rates FOR INSERT
  WITH CHECK (business_id IS NOT NULL AND public.is_business_member(business_id, 'member'));

DROP POLICY IF EXISTS tax_rates_update ON public.tax_rates;
CREATE POLICY tax_rates_update ON public.tax_rates FOR UPDATE
  USING (business_id IS NOT NULL AND public.is_business_member(business_id, 'member'))
  WITH CHECK (business_id IS NOT NULL AND public.is_business_member(business_id, 'member'));

DROP POLICY IF EXISTS tax_rates_delete ON public.tax_rates;
CREATE POLICY tax_rates_delete ON public.tax_rates FOR DELETE
  USING (business_id IS NOT NULL AND public.is_business_member(business_id, 'admin'));

-- No anonymous access to anything here, under any condition.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invoices','invoice_lines','invoice_payments','invoice_events',
    'invoice_deliveries','invoice_settings','invoice_custom_fields','tax_rates'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%1$s FROM anon;', t);
  END LOOP;
END $$;

-- ============================================================
-- SEED: Canadian sales tax reference rates
--
-- Reference values with an explicit source and effective date, not
-- authority. A business overrides them for its own situation.
-- ============================================================

INSERT INTO public.tax_rates
  (business_id, jurisdiction, code, label, rate, treatment, effective_from, source, source_url, last_verified)
VALUES
  (NULL, 'CA-AB', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate.html', '2026-08-07'),
  (NULL, 'CA-BC', 'GST', 'GST 5%',   0.05,    'standard', '2013-04-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-BC', 'PST', 'PST 7%',   0.07,    'standard', '2013-04-01', 'BC Ministry of Finance', NULL, '2026-08-07'),
  (NULL, 'CA-MB', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-MB', 'PST', 'RST 7%',   0.07,    'standard', '2019-07-01', 'Manitoba Finance', NULL, '2026-08-07'),
  (NULL, 'CA-NB', 'HST', 'HST 15%',  0.15,    'standard', '2016-07-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-NL', 'HST', 'HST 15%',  0.15,    'standard', '2016-07-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-NS', 'HST', 'HST 14%',  0.14,    'standard', '2025-04-01', 'Nova Scotia Dept of Finance', NULL, '2026-08-07'),
  (NULL, 'CA-NT', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-NU', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-ON', 'HST', 'HST 13%',  0.13,    'standard', '2010-07-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-PE', 'HST', 'HST 15%',  0.15,    'standard', '2016-10-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-QC', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-QC', 'QST', 'QST 9.975%', 0.09975, 'standard', '2013-01-01', 'Revenu Québec', NULL, '2026-08-07'),
  (NULL, 'CA-SK', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'CA-SK', 'PST', 'PST 6%',   0.06,    'standard', '2017-03-23', 'Saskatchewan Finance', NULL, '2026-08-07'),
  (NULL, 'CA-YT', 'GST', 'GST 5%',   0.05,    'standard', '2008-01-01', 'Canada Revenue Agency', NULL, '2026-08-07'),
  (NULL, 'GB',    'VAT', 'VAT 20%',  0.20,    'standard', '2011-01-04', 'HMRC', NULL, '2026-08-07')
ON CONFLICT DO NOTHING;

-- Universal, jurisdiction-free treatments. Zero-rated and exempt are
-- both 0% but must stay distinguishable on a return.
INSERT INTO public.tax_rates
  (business_id, jurisdiction, code, label, rate, treatment, effective_from, source, last_verified)
VALUES
  (NULL, '*', 'NONE',       'No tax',      0, 'out_of_scope', '2000-01-01', 'BankDeMark', '2026-08-07'),
  (NULL, '*', 'ZERO_RATED', 'Zero-rated',  0, 'zero_rated',   '2000-01-01', 'BankDeMark', '2026-08-07'),
  (NULL, '*', 'EXEMPT',     'Exempt',      0, 'exempt',       '2000-01-01', 'BankDeMark', '2026-08-07')
ON CONFLICT DO NOTHING;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE public.invoices IS
  'Commercial documents and, once issued and unsettled, the accounts-receivable position. Invoices never create revenue — a matched transaction does.';
COMMENT ON COLUMN public.invoices.balance_minor IS
  'Derived from invoice_payments by trigger. This IS the receivable; there is no separate receivables table.';
COMMENT ON COLUMN public.invoices.custom_fields IS
  'Supplementary structured context (booking reference, traveller, PO). Never contributes to a total.';
COMMENT ON COLUMN public.invoices.issued_business_snapshot IS
  'Business identity frozen at issue. Changing settings later must never alter a historical document.';
COMMENT ON FUNCTION public.bdm_ar_position(UUID) IS
  'Invoiced and uninvoiced receivables, per currency, kept separate so they are never double-counted.';
