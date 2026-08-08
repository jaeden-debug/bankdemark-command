-- ============================================================
-- SYSTEM CHART OF ACCOUNTS
--
-- business_id IS NULL => available to every business.
-- Names are business-owner language; `kind` carries the accounting
-- semantics underneath. `business_types` narrows a category to the
-- models where it makes sense (empty array = show for all).
-- ============================================================

INSERT INTO public.categories (business_id, name, slug, kind, tax_treatment, business_types, sort_order, is_system)
VALUES
  -- ── Money in ─────────────────────────────────────────────
  (NULL, 'Sales',                'sales',                'income',   'taxable_revenue',  ARRAY[]::TEXT[],                      10,  TRUE),
  (NULL, 'Service Revenue',      'service-revenue',      'income',   'taxable_revenue',  ARRAY['agency','freelancer','saas','travel','creator'], 11, TRUE),
  (NULL, 'Commission Income',    'commission-income',    'income',   'taxable_revenue',  ARRAY['travel','agency','creator'],   12,  TRUE),
  (NULL, 'Service Fees',         'service-fees',         'income',   'taxable_revenue',  ARRAY['travel','agency','freelancer'],13,  TRUE),
  (NULL, 'Subscription Revenue', 'subscription-revenue', 'income',   'taxable_revenue',  ARRAY['saas','creator'],              14,  TRUE),
  (NULL, 'Product Sales',        'product-sales',        'income',   'taxable_revenue',  ARRAY['ecommerce','retail'],          15,  TRUE),
  (NULL, 'Interest & Other Income','other-income',       'income',   'taxable_revenue',  ARRAY[]::TEXT[],                      19,  TRUE),

  -- ── Money out ────────────────────────────────────────────
  (NULL, 'Cost of Goods Sold',   'cogs',                 'expense',  'cogs',             ARRAY['ecommerce','retail'],          20,  TRUE),
  (NULL, 'Advertising',          'advertising',          'expense',  'deductible',       ARRAY[]::TEXT[],                      21,  TRUE),
  (NULL, 'Software & Subscriptions','software',          'expense',  'deductible',       ARRAY[]::TEXT[],                      22,  TRUE),
  (NULL, 'Contractors',          'contractors',          'expense',  'deductible',       ARRAY[]::TEXT[],                      23,  TRUE),
  (NULL, 'Professional Services','professional-services','expense',  'deductible',       ARRAY[]::TEXT[],                      24,  TRUE),
  (NULL, 'Travel',               'travel',               'expense',  'deductible',       ARRAY[]::TEXT[],                      25,  TRUE),
  (NULL, 'Meals & Entertainment','meals',                'expense',  'partially_deductible', ARRAY[]::TEXT[],                  26,  TRUE),
  (NULL, 'Supplies',             'supplies',             'expense',  'deductible',       ARRAY[]::TEXT[],                      27,  TRUE),
  (NULL, 'Shipping & Delivery',  'shipping',             'expense',  'deductible',       ARRAY['ecommerce','retail'],          28,  TRUE),
  (NULL, 'Bank & Payment Fees',  'bank-fees',            'expense',  'deductible',       ARRAY[]::TEXT[],                      29,  TRUE),
  (NULL, 'Rent & Utilities',     'rent-utilities',       'expense',  'deductible',       ARRAY[]::TEXT[],                      30,  TRUE),
  (NULL, 'Equipment',            'equipment',            'expense',  'capital_or_deductible', ARRAY[]::TEXT[],                 31,  TRUE),
  (NULL, 'Insurance',            'insurance',            'expense',  'deductible',       ARRAY[]::TEXT[],                      32,  TRUE),
  (NULL, 'Education & Training', 'education',            'expense',  'deductible',       ARRAY[]::TEXT[],                      33,  TRUE),
  (NULL, 'Hosting & Infrastructure','infrastructure',    'expense',  'deductible',       ARRAY['saas','agency','creator'],     34,  TRUE),
  (NULL, 'Taxes & Licenses',     'taxes-licenses',       'expense',  'taxes',            ARRAY[]::TEXT[],                      35,  TRUE),
  (NULL, 'Other Expenses',       'other-expenses',       'expense',  'deductible',       ARRAY[]::TEXT[],                      39,  TRUE),

  -- ── Balance sheet ────────────────────────────────────────
  (NULL, 'Cash',                 'cash',                 'asset',    NULL,               ARRAY[]::TEXT[],                      40,  TRUE),
  (NULL, 'Money Owed To You',    'accounts-receivable',  'asset',    NULL,               ARRAY[]::TEXT[],                      41,  TRUE),
  (NULL, 'Inventory',            'inventory',            'asset',    NULL,               ARRAY['ecommerce','retail'],          42,  TRUE),
  (NULL, 'Equipment & Vehicles', 'fixed-assets',         'asset',    NULL,               ARRAY[]::TEXT[],                      43,  TRUE),
  (NULL, 'Investments',          'investments',          'asset',    NULL,               ARRAY[]::TEXT[],                      44,  TRUE),

  (NULL, 'Credit Cards',         'credit-cards',         'liability',NULL,               ARRAY[]::TEXT[],                      50,  TRUE),
  (NULL, 'Loans',                'loans',                'liability',NULL,               ARRAY[]::TEXT[],                      51,  TRUE),
  (NULL, 'Money You Owe',        'accounts-payable',     'liability',NULL,               ARRAY[]::TEXT[],                      52,  TRUE),
  (NULL, 'Taxes Owed',           'taxes-payable',        'liability','taxes',            ARRAY[]::TEXT[],                      53,  TRUE),

  (NULL, 'Owner Contributions',  'owner-contributions',  'equity',   NULL,               ARRAY[]::TEXT[],                      60,  TRUE),
  (NULL, 'Owner Draws',          'owner-draws',          'equity',   NULL,               ARRAY[]::TEXT[],                      61,  TRUE),
  (NULL, 'Client Funds (Pass-Through)','client-funds',   'liability',NULL,               ARRAY['travel','agency'],             62,  TRUE),
  (NULL, 'Transfers',            'transfers',            'asset',    NULL,               ARRAY[]::TEXT[],                      90,  TRUE)
ON CONFLICT DO NOTHING;
