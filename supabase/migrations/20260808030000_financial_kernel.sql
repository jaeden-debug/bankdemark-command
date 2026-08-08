-- ============================================================
-- BANKDEMARK FINANCIAL KERNEL
--
-- The multi-business, multi-tenant financial system of record.
-- Replaces the single-row `financial_snapshots` model, which was
-- UNIQUE(user_id) and structurally forbade both multi-business
-- and time-series. Legacy tables are left intact for migration
-- (see 0006_personal_workspace_migration).
--
-- MONEY PRECISION
--   All monetary values are BIGINT in MINOR UNITS (cents).
--   Never NUMERIC-with-float round-tripping, never JS floats.
--   Every money column is paired with an explicit currency.
--
-- SIGN CONVENTION
--   transactions.amount_minor is signed FROM THE ACCOUNT'S VIEW.
--     money into the account  -> positive
--     money out of the account -> negative
--   This makes account balance = SUM(amount_minor) exactly, and
--   makes a transfer pair net to zero without special-casing.
--
-- REVENUE RECOGNITION
--   amount_minor            = actual cash movement
--   gross_amount_minor      = headline value (e.g. a $6,000 booking)
--   recognized_amount_minor = what enters P&L (e.g. the $600 commission)
--   Only transaction types in `bdm_revenue_types()` / `bdm_expense_types()`
--   ever reach revenue/expense aggregates. Transfers, owner capital,
--   loans and credit-card payments are structurally excluded.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.business_role AS ENUM ('viewer','accountant','member','admin','owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.account_kind AS ENUM
    ('bank','cash','credit_card','loan','investment','receivable','payable','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.category_kind AS ENUM
    ('income','expense','asset','liability','equity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The semantic heart of the ledger. Adding a value here without
-- updating bdm_revenue_types()/bdm_expense_types() is a bug.
DO $$ BEGIN
  CREATE TYPE public.transaction_kind AS ENUM (
    'income',
    'expense',
    'transfer',
    'owner_contribution',
    'owner_draw',
    'loan_proceeds',
    'loan_payment',
    'credit_card_payment',
    'refund',
    'reimbursement',
    'commission',
    'pass_through',
    'asset_purchase',
    'tax_payment',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.review_state AS ENUM
    ('unreviewed','needs_review','auto_categorized','reviewed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.commission_state AS ENUM
    ('expected','earned','receivable','partial','received','reversed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.data_source AS ENUM
    ('manual','csv','zylx','mcp','stripe','shopify','paypal','square','bank_feed','system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- FINANCIAL SEMANTICS — single source of truth for aggregation
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_revenue_types()
RETURNS public.transaction_kind[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['income','commission','refund']::public.transaction_kind[];
$$;
COMMENT ON FUNCTION public.bdm_revenue_types() IS
  'Types that reach recognized revenue. `refund` carries a negative recognized amount so it reduces revenue. Transfers, owner capital, loans and pass-through are deliberately absent.';

CREATE OR REPLACE FUNCTION public.bdm_expense_types()
RETURNS public.transaction_kind[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['expense','reimbursement']::public.transaction_kind[];
$$;
COMMENT ON FUNCTION public.bdm_expense_types() IS
  'Types that reach expenses. credit_card_payment is absent: the purchase was already the expense, the payment is a transfer of liability.';

-- ============================================================
-- BUSINESSES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.businesses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name                    TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  business_type           TEXT NOT NULL DEFAULT 'other'
    CHECK (business_type IN ('travel','agency','ecommerce','saas','freelancer','retail','creator','holding','personal','other')),
  revenue_model           TEXT[] NOT NULL DEFAULT ARRAY['direct_sales']::TEXT[],
  country                 TEXT NOT NULL DEFAULT 'CA',
  region                  TEXT,
  base_currency           CHAR(3) NOT NULL DEFAULT 'CAD',
  fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  timezone                TEXT NOT NULL DEFAULT 'America/Toronto',
  tax_jurisdiction        TEXT,
  accounting_basis        TEXT NOT NULL DEFAULT 'cash' CHECK (accounting_basis IN ('cash','accrual')),
  handles_client_funds    BOOLEAN NOT NULL DEFAULT FALSE,
  earns_commissions       BOOLEAN NOT NULL DEFAULT FALSE,
  is_personal             BOOLEAN NOT NULL DEFAULT FALSE,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON public.businesses(owner_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.business_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         public.business_role NOT NULL DEFAULT 'member',
  invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_business_members_user ON public.business_members(user_id);
CREATE INDEX IF NOT EXISTS idx_business_members_business ON public.business_members(business_id);

-- ============================================================
-- RLS MEMBERSHIP HELPERS
--
-- SECURITY DEFINER so the membership lookup itself is not subject
-- to business_members' own RLS (which would recurse).
-- ============================================================

CREATE OR REPLACE FUNCTION public.bdm_role_rank(r public.business_role)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'viewer' THEN 10
    WHEN 'accountant' THEN 20
    WHEN 'member' THEN 30
    WHEN 'admin' THEN 40
    WHEN 'owner' THEN 50
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_business_member(
  p_business_id UUID,
  p_min_role public.business_role DEFAULT 'viewer'
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.business_members m
     WHERE m.business_id = p_business_id
       AND m.user_id = (SELECT auth.uid())
       AND public.bdm_role_rank(m.role) >= public.bdm_role_rank(p_min_role)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_business_member(UUID, public.business_role) FROM anon;
GRANT  EXECUTE ON FUNCTION public.is_business_member(UUID, public.business_role) TO authenticated;

-- Auto-enrol the creator as owner.
CREATE OR REPLACE FUNCTION public.bdm_add_owner_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (business_id, user_id) DO UPDATE SET role = 'owner';
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS businesses_add_owner ON public.businesses;
CREATE TRIGGER businesses_add_owner
  AFTER INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.bdm_add_owner_membership();

-- ============================================================
-- CATEGORIES  (business_id NULL = system default)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  parent_id      UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  kind           public.category_kind NOT NULL,
  tax_treatment  TEXT,
  business_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sort_order     INT NOT NULL DEFAULT 100,
  is_system      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_business_slug
  ON public.categories(business_id, slug) WHERE business_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_system_slug
  ON public.categories(slug) WHERE business_id IS NULL;

-- ============================================================
-- ACCOUNTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  account_kind         public.account_kind NOT NULL DEFAULT 'bank',
  currency             CHAR(3) NOT NULL DEFAULT 'CAD',
  institution          TEXT,
  mask                 TEXT,
  opening_balance_minor BIGINT NOT NULL DEFAULT 0,
  -- Provider-reported balance. NULL means "we have never been told".
  -- Never conflate with the ledger-derived balance.
  reported_balance_minor BIGINT,
  balance_as_of        TIMESTAMPTZ,
  source               public.data_source NOT NULL DEFAULT 'manual',
  provider             TEXT,
  external_id          TEXT,
  last_synced_at       TIMESTAMPTZ,
  last_sync_attempt_at TIMESTAMPTZ,
  sync_status          TEXT NOT NULL DEFAULT 'manual'
    CHECK (sync_status IN ('manual','ok','stale','error','disconnected')),
  sync_error           TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_accounts_business ON public.accounts(business_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_external
  ON public.accounts(business_id, provider, external_id)
  WHERE external_id IS NOT NULL;

-- ============================================================
-- COUNTERPARTIES  (customers, vendors, suppliers)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.counterparties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  kind        TEXT NOT NULL DEFAULT 'vendor' CHECK (kind IN ('customer','vendor','supplier','other')),
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_counterparties_business ON public.counterparties(business_id, kind) WHERE is_active;

-- ============================================================
-- PROJECTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id   UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  code        TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled','on_hold')),
  started_on  DATE,
  ended_on    DATE,
  budget_minor BIGINT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_business ON public.projects(business_id, status);

-- ============================================================
-- DOCUMENTS / RECEIPTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  storage_path         TEXT NOT NULL,
  doc_type             TEXT NOT NULL DEFAULT 'receipt'
    CHECK (doc_type IN ('receipt','invoice','statement','contract','other')),
  original_filename    TEXT,
  mime_type            TEXT,
  size_bytes           BIGINT,
  vendor               TEXT,
  doc_date             DATE,
  amount_minor         BIGINT,
  currency             CHAR(3),
  extracted            JSONB,
  status               TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','processing','extracted','matched','failed')),
  uploaded_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_business ON public.documents(business_id, doc_date DESC);

-- ============================================================
-- IMPORT BATCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.import_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id       UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  source           public.data_source NOT NULL DEFAULT 'csv',
  filename         TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','previewed','committed','failed','cancelled')),
  mapping          JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count        INT NOT NULL DEFAULT 0,
  imported_count   INT NOT NULL DEFAULT 0,
  duplicate_count  INT NOT NULL DEFAULT 0,
  error_count      INT NOT NULL DEFAULT 0,
  errors           JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_import_batches_business ON public.import_batches(business_id, created_at DESC);

-- ============================================================
-- BOOKINGS  (generic gross-value sales; travel is one instance)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bookings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  reference                 TEXT,
  client_id                 UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  supplier_id               UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  project_id                UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  description               TEXT,
  gross_value_minor         BIGINT NOT NULL DEFAULT 0 CHECK (gross_value_minor >= 0),
  currency                  CHAR(3) NOT NULL DEFAULT 'CAD',
  booking_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  service_date              DATE,
  -- How much of gross_value the business actually earns.
  recognition_mode          TEXT NOT NULL DEFAULT 'commission'
    CHECK (recognition_mode IN ('commission','full_gross','net_of_supplier','manual')),
  commission_rate           NUMERIC(7,4),
  commission_expected_minor BIGINT NOT NULL DEFAULT 0,
  commission_received_minor BIGINT NOT NULL DEFAULT 0,
  service_fee_minor         BIGINT NOT NULL DEFAULT 0,
  commission_status         public.commission_state NOT NULL DEFAULT 'expected',
  status                    TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('quoted','confirmed','completed','cancelled')),
  notes                     TEXT,
  created_by                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_business_date ON public.bookings(business_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_commission_status ON public.bookings(business_id, commission_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_reference
  ON public.bookings(business_id, reference) WHERE reference IS NOT NULL;

-- ============================================================
-- TRANSACTIONS — the core primitive
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id              UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  occurred_on             DATE NOT NULL,
  -- Signed cash movement from the account's perspective.
  amount_minor            BIGINT NOT NULL,
  currency                CHAR(3) NOT NULL DEFAULT 'CAD',

  description             TEXT NOT NULL DEFAULT '',
  merchant                TEXT,
  counterparty_id         UUID REFERENCES public.counterparties(id) ON DELETE SET NULL,
  category_id             UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  transaction_kind        public.transaction_kind NOT NULL DEFAULT 'expense',

  -- Revenue recognition. NULL => derive from amount_minor.
  gross_amount_minor      BIGINT,
  recognized_amount_minor BIGINT,

  project_id              UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  booking_id              UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  document_id             UUID REFERENCES public.documents(id) ON DELETE SET NULL,

  -- Transfer safety: both legs of a transfer share a group id.
  transfer_group_id       UUID,

  source                  public.data_source NOT NULL DEFAULT 'manual',
  external_id             TEXT,
  import_batch_id         UUID REFERENCES public.import_batches(id) ON DELETE SET NULL,
  -- Immutable provider/import payload. Never overwritten by reclassification.
  raw                     JSONB,
  dedupe_hash             TEXT,

  review_status           public.review_state NOT NULL DEFAULT 'unreviewed',
  ai_confidence           NUMERIC(4,3) CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_suggested_category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  notes                   TEXT,

  created_by              UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT transactions_amount_nonzero CHECK (amount_minor <> 0),
  CONSTRAINT transactions_gross_nonneg CHECK (gross_amount_minor IS NULL OR gross_amount_minor >= 0)
);

CREATE INDEX IF NOT EXISTS idx_tx_business_date
  ON public.transactions(business_id, occurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_account_date
  ON public.transactions(account_id, occurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_business_category
  ON public.transactions(business_id, category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_business_review
  ON public.transactions(business_id, review_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_business_kind
  ON public.transactions(business_id, transaction_kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_project
  ON public.transactions(project_id) WHERE project_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_booking
  ON public.transactions(booking_id) WHERE booking_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tx_transfer_group
  ON public.transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_dedupe
  ON public.transactions(account_id, dedupe_hash) WHERE dedupe_hash IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_external
  ON public.transactions(account_id, external_id) WHERE external_id IS NOT NULL AND deleted_at IS NULL;

-- Normalise recognition so aggregates never have to special-case NULLs.
CREATE OR REPLACE FUNCTION public.bdm_normalise_transaction()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  abs_amount BIGINT := abs(NEW.amount_minor);
BEGIN
  IF NEW.gross_amount_minor IS NULL THEN
    NEW.gross_amount_minor := abs_amount;
  END IF;

  IF NEW.recognized_amount_minor IS NULL THEN
    IF NEW.transaction_kind = ANY (public.bdm_revenue_types()) THEN
      -- refunds arrive as negative cash and must reduce revenue
      NEW.recognized_amount_minor := CASE
        WHEN NEW.transaction_kind = 'refund' THEN -abs_amount
        ELSE abs_amount
      END;
    ELSIF NEW.transaction_kind = ANY (public.bdm_expense_types()) THEN
      NEW.recognized_amount_minor := CASE
        WHEN NEW.transaction_kind = 'reimbursement' THEN -abs_amount
        ELSE abs_amount
      END;
    ELSE
      -- transfers, owner capital, loans, cc payments, pass-through,
      -- asset purchases and tax payments never touch P&L
      NEW.recognized_amount_minor := 0;
    END IF;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS transactions_normalise ON public.transactions;
CREATE TRIGGER transactions_normalise
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.bdm_normalise_transaction();

-- ============================================================
-- COMMISSION PAYMENTS  (money actually received against a booking)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.commission_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id     UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  amount_minor   BIGINT NOT NULL,
  currency       CHAR(3) NOT NULL DEFAULT 'CAD',
  received_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  notes          TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_payments_booking ON public.commission_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_commission_payments_business ON public.commission_payments(business_id, received_on DESC);

-- Keep booking commission totals and status derived, never hand-typed.
CREATE OR REPLACE FUNCTION public.bdm_recalc_booking_commission()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_booking_id UUID := COALESCE(NEW.booking_id, OLD.booking_id);
  v_received   BIGINT;
  v_expected   BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO v_received
    FROM public.commission_payments WHERE booking_id = v_booking_id;

  SELECT commission_expected_minor INTO v_expected
    FROM public.bookings WHERE id = v_booking_id;

  UPDATE public.bookings
     SET commission_received_minor = v_received,
         commission_status = CASE
           WHEN commission_status IN ('cancelled','reversed') THEN commission_status
           WHEN v_received <= 0 AND v_expected > 0 THEN 'receivable'
           WHEN v_received > 0 AND v_received < v_expected THEN 'partial'
           WHEN v_expected > 0 AND v_received >= v_expected THEN 'received'
           ELSE commission_status
         END,
         updated_at = NOW()
   WHERE id = v_booking_id;

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS commission_payments_recalc ON public.commission_payments;
CREATE TRIGGER commission_payments_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.commission_payments
  FOR EACH ROW EXECUTE FUNCTION public.bdm_recalc_booking_commission();

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id             BIGSERIAL PRIMARY KEY,
  business_id    UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type     TEXT NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user','zylx','mcp','system','import','integration','stripe')),
  entity         TEXT NOT NULL,
  entity_id      TEXT,
  action         TEXT NOT NULL,
  before         JSONB,
  after          JSONB,
  source         public.data_source NOT NULL DEFAULT 'manual',
  request_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_business ON public.audit_log(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log(entity, entity_id);

-- ============================================================
-- MONTHLY SUMMARY  (scale: never aggregate raw ledger in React)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.business_monthly_summary (
  business_id             UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  month                   DATE NOT NULL,
  currency                CHAR(3) NOT NULL,
  recognized_revenue_minor BIGINT NOT NULL DEFAULT 0,
  gross_volume_minor      BIGINT NOT NULL DEFAULT 0,
  expenses_minor          BIGINT NOT NULL DEFAULT 0,
  profit_minor            BIGINT NOT NULL DEFAULT 0,
  cash_in_minor           BIGINT NOT NULL DEFAULT 0,
  cash_out_minor          BIGINT NOT NULL DEFAULT 0,
  transaction_count       INT NOT NULL DEFAULT 0,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, month, currency)
);

-- ============================================================
-- updated_at triggers
-- ============================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'businesses','categories','accounts','counterparties','projects',
    'documents','bookings'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %1$s_updated_at ON public.%1$s;
       CREATE TRIGGER %1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t);
  END LOOP;
END $$;

-- ============================================================
-- ROW LEVEL SECURITY
-- Every business-owned table is isolated by membership.
-- ============================================================

ALTER TABLE public.businesses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_monthly_summary ENABLE ROW LEVEL SECURITY;

-- businesses: visible to members, mutable by admins, deletable by owner
DROP POLICY IF EXISTS businesses_select ON public.businesses;
CREATE POLICY businesses_select ON public.businesses FOR SELECT
  USING (public.is_business_member(id, 'viewer'));

DROP POLICY IF EXISTS businesses_insert ON public.businesses;
CREATE POLICY businesses_insert ON public.businesses FOR INSERT
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS businesses_update ON public.businesses;
CREATE POLICY businesses_update ON public.businesses FOR UPDATE
  USING (public.is_business_member(id, 'admin'))
  WITH CHECK (public.is_business_member(id, 'admin'));

DROP POLICY IF EXISTS businesses_delete ON public.businesses;
CREATE POLICY businesses_delete ON public.businesses FOR DELETE
  USING (public.is_business_member(id, 'owner'));

-- business_members
DROP POLICY IF EXISTS business_members_select ON public.business_members;
CREATE POLICY business_members_select ON public.business_members FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR public.is_business_member(business_id, 'viewer'));

DROP POLICY IF EXISTS business_members_write ON public.business_members;
CREATE POLICY business_members_write ON public.business_members FOR INSERT
  WITH CHECK (public.is_business_member(business_id, 'admin'));

DROP POLICY IF EXISTS business_members_update ON public.business_members;
CREATE POLICY business_members_update ON public.business_members FOR UPDATE
  USING (public.is_business_member(business_id, 'admin'))
  WITH CHECK (public.is_business_member(business_id, 'admin'));

DROP POLICY IF EXISTS business_members_delete ON public.business_members;
CREATE POLICY business_members_delete ON public.business_members FOR DELETE
  USING (public.is_business_member(business_id, 'admin'));

-- categories: system rows readable by everyone signed in
DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select ON public.categories FOR SELECT
  USING (business_id IS NULL OR public.is_business_member(business_id, 'viewer'));

DROP POLICY IF EXISTS categories_insert ON public.categories;
CREATE POLICY categories_insert ON public.categories FOR INSERT
  WITH CHECK (business_id IS NOT NULL AND public.is_business_member(business_id, 'member'));

DROP POLICY IF EXISTS categories_update ON public.categories;
CREATE POLICY categories_update ON public.categories FOR UPDATE
  USING (business_id IS NOT NULL AND public.is_business_member(business_id, 'member'))
  WITH CHECK (business_id IS NOT NULL AND public.is_business_member(business_id, 'member'));

DROP POLICY IF EXISTS categories_delete ON public.categories;
CREATE POLICY categories_delete ON public.categories FOR DELETE
  USING (business_id IS NOT NULL AND public.is_business_member(business_id, 'admin'));

-- Generic member-scoped policies for the remaining business tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','counterparties','projects','documents','import_batches',
    'bookings','transactions','commission_payments'
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

-- audit_log: readable by admins, append-only, never updatable or deletable
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT
  USING (public.is_business_member(business_id, 'accountant'));

DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT
  WITH CHECK (public.is_business_member(business_id, 'viewer'));

REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

-- monthly summary: read-only to users, written by the service layer
DROP POLICY IF EXISTS bms_select ON public.business_monthly_summary;
CREATE POLICY bms_select ON public.business_monthly_summary FOR SELECT
  USING (public.is_business_member(business_id, 'viewer'));

REVOKE INSERT, UPDATE, DELETE ON public.business_monthly_summary FROM authenticated, anon;

-- No anon access to any kernel table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'businesses','business_members','categories','accounts','counterparties',
    'projects','documents','import_batches','bookings','transactions',
    'commission_payments','audit_log','business_monthly_summary'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%1$s FROM anon;', t);
  END LOOP;
END $$;
