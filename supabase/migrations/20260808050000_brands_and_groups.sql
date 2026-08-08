-- ============================================================
-- BRANDS AND BUSINESS GROUPS
--
-- Two different real structures, deliberately modelled separately
-- because they have different tax and accounting consequences.
--
-- 1. BRANDS — segments inside ONE set of books.
--    Use when the brands are trade names / DBAs of a single legal
--    entity: one bank account, one tax return. StillAwake Media
--    running Blackwater Aquatics and Just Erika as divisions.
--    Every figure stays in one ledger and is filterable by brand.
--
-- 2. GROUPS (parent_business_id) — separate books, linked.
--    Use when each brand is its own corporation with its own bank
--    account and return. Books stay fully isolated (RLS is
--    unchanged); only the portfolio view aggregates them.
--
-- Mixing these up is what makes group accounting wrong, so the
-- product asks rather than assuming.
-- ============================================================

-- ── 1. Brands: a segment dimension within one business ──────
CREATE TABLE IF NOT EXISTS public.brands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  slug        TEXT NOT NULL,
  description TEXT,
  -- What this brand mainly earns from. Free text kept short; the
  -- authoritative classification is still the category on each
  -- transaction, this is only for orientation in the UI.
  revenue_note TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_brands_business ON public.brands(business_id) WHERE is_active;

DROP TRIGGER IF EXISTS brands_updated_at ON public.brands;
CREATE TRIGGER brands_updated_at BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. Attach the brand dimension to the ledger ─────────────
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;
ALTER TABLE public.projects     ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;
ALTER TABLE public.bookings     ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES public.brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tx_brand
  ON public.transactions(business_id, brand_id) WHERE brand_id IS NOT NULL AND deleted_at IS NULL;

-- ── 3. Business groups: separate books, linked ──────────────
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS parent_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  -- How this business organises its brands. 'none' = single brand.
  ADD COLUMN IF NOT EXISTS brand_model TEXT NOT NULL DEFAULT 'none'
    CHECK (brand_model IN ('none', 'brands', 'group'));

CREATE INDEX IF NOT EXISTS idx_businesses_parent
  ON public.businesses(parent_business_id) WHERE parent_business_id IS NOT NULL;

-- A business cannot be its own parent, and the chain is one level
-- deep: a parent may not itself have a parent. Keeps roll-ups
-- unambiguous and prevents cycles.
CREATE OR REPLACE FUNCTION public.bdm_check_business_parent()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE grandparent UUID;
BEGIN
  IF NEW.parent_business_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.parent_business_id = NEW.id THEN
    RAISE EXCEPTION 'A business cannot be its own parent.';
  END IF;

  SELECT parent_business_id INTO grandparent
    FROM public.businesses WHERE id = NEW.parent_business_id;

  IF grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'Business groups are one level deep. % already belongs to a group.',
      NEW.parent_business_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.businesses WHERE parent_business_id = NEW.id) THEN
    RAISE EXCEPTION 'This business is already a parent and cannot also be a child.';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS businesses_check_parent ON public.businesses;
CREATE TRIGGER businesses_check_parent
  BEFORE INSERT OR UPDATE OF parent_business_id ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.bdm_check_business_parent();

REVOKE EXECUTE ON FUNCTION public.bdm_check_business_parent() FROM PUBLIC, anon, authenticated;

-- ── 4. RLS: brands follow the same membership rules ─────────
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brands_select ON public.brands;
CREATE POLICY brands_select ON public.brands FOR SELECT
  USING (public.is_business_member(business_id, 'viewer'));

DROP POLICY IF EXISTS brands_insert ON public.brands;
CREATE POLICY brands_insert ON public.brands FOR INSERT
  WITH CHECK (public.is_business_member(business_id, 'member'));

DROP POLICY IF EXISTS brands_update ON public.brands;
CREATE POLICY brands_update ON public.brands FOR UPDATE
  USING (public.is_business_member(business_id, 'member'))
  WITH CHECK (public.is_business_member(business_id, 'member'));

DROP POLICY IF EXISTS brands_delete ON public.brands;
CREATE POLICY brands_delete ON public.brands FOR DELETE
  USING (public.is_business_member(business_id, 'admin'));

REVOKE ALL ON public.brands FROM anon;
