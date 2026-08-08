# BANKDEMARK COMMAND — REBUILD REPORT

**Date:** 2026-08-07
**Scope completed:** Phase A (Trust Foundation) · Phase B (Financial Kernel) · service layer · Zylx tool architecture · design system · first Command Centre screen
**Scope not started:** Phases F–J and most of C/D UI. Listed precisely in §Known Limitations.
**Verification:** `tsc --noEmit` clean · `next build` clean · 38/38 tests pass · SQL↔TS semantic parity verified against production triggers · Supabase security advisors down from 6 to 2.

---

## 1. Architecture — old vs new

| | Before | Now |
|---|---|---|
| Financial model | `financial_snapshots` — one row per user, `UNIQUE(user_id)`, ~20 typed aggregates, destructively overwritten | Transaction ledger with 15 semantic types, revenue recognition, transfer pairing, soft delete, immutable `raw` payload |
| Tenancy | One financial reality per human. Structurally impossible to have two businesses. | `businesses` + `business_members` with 5 roles; every financial table isolated by `business_id` |
| Money | JS floats over `NUMERIC` columns | `BIGINT` minor units end to end; string-based parsing; `assertSafeMinor` guards |
| Migrations | 2 tracked (both from the other repo). Command schema hand-pasted; production had drifted from the repo in 4 places | Supabase CLI linked; **8 tracked migrations; local history == remote history** |
| Errors | `await db.insert(...)` results discarded; bare `catch {}` | `ServiceError` + `unwrap`/`assertOk`; schema drift (PG `42703`) surfaces as an explicit internal error |
| AI | Static text blob; model did arithmetic in prose | 12 typed tools; backend computes, model explains; writes are proposals requiring approval |
| Entitlements | One `plan === 'pro'` check in the whole app — and it was broken | Single entitlements table; feature lists on the pricing card are *derived from* what the server enforces |
| Brand | Dark `#080C14` / `#00D084` — a different brand from bankdemark.com | Cream `#fbf7ef`, ink `#0b1220`, gold `#c6a24a`, Inter — tokens lifted from the live public site |

---

## 2. What was salvaged

**Kept and reused**
- Supabase Auth + `@supabase/ssr` middleware — the auth gating was already correct (verified live: `307 → /command?auth=required`).
- The RLS *discipline* — the old policies were well-formed; the pattern was extended to membership checks.
- Stripe webhook signature verification (`constructEvent` on the raw body, fails closed).
- `lib/command/calculations.ts` — the personal-finance maths (avalanche/snowball, FIRE, emergency runway) is correct and is retained intact for the Wealth layer in Phase H.
- The AI architecture's central idea: calculate deterministically, then explain. That principle now has real tooling behind it.
- PWA assets, Inter typography, the metric-card visual pattern.

**Retired**
- `financial_snapshots` as the source of truth (table left in place; not deleted — see §Migration).
- The hard-coded `PRO_FEATURES` list and its checkout.
- Static context injection into the AI prompt.
- The dark design tokens.

**Deliberately not deleted**
- `app/command/*` legacy routes and `public.financial_snapshots` / `goals` / `score_history` data. No user data was destroyed. A compatibility shim in `globals.css` keeps the legacy screens legible on the new tokens until they are replaced.

---

## 3. Database

**8 tracked migrations, local history identical to remote.**

| Version | What it does |
|---|---|
| `20260523042810`, `20260523043417` | Pre-existing `calculator_shares` (adopted from the public-site repo so one migration set owns the shared database) |
| `20260808021913` | P0 security hardening |
| `20260808021955` | Column-grant correction |
| `20260808022028` | Schema-drift reconciliation |
| `20260808030000` | Financial kernel |
| `20260808030100` | System chart of accounts (37 categories) |
| `20260808031000` | Kernel function hardening |

**New tables (13):** `businesses`, `business_members`, `categories`, `accounts`, `counterparties`, `projects`, `documents`, `import_batches`, `bookings`, `transactions`, `commission_payments`, `audit_log`, `business_monthly_summary`.

**Financial semantics live in the database, not only in application code.** `bdm_revenue_types()` and `bdm_expense_types()` are the single definition of what reaches P&L; `bdm_normalise_transaction()` derives recognition on write. `lib/domain/semantics.ts` mirrors them, and the two were verified to agree exactly (§Tests).

**Indexes:** `(business_id, occurred_on DESC)`, `(business_id, category_id)`, `(business_id, review_status)`, `(business_id, transaction_kind)`, `(account_id, occurred_on DESC)`, partial indexes on `project_id`/`booking_id`/`transfer_group_id`, unique `(account_id, dedupe_hash)` and `(account_id, external_id)`.

**RLS:** every kernel table isolated via `is_business_member(business_id, min_role)` — a `SECURITY DEFINER` helper with `search_path = ''` that resolves `auth.uid()` internally. `audit_log` is append-only (UPDATE/DELETE revoked). `business_monthly_summary` is read-only to users. `anon` has no access to any kernel table.

---

## 4. Security — what actually changed

| Finding from the audit | Status | Evidence |
|---|---|---|
| Any user could set `profiles.plan = 'pro'` | **Closed** | `information_schema.column_privileges` now shows `authenticated` with UPDATE on only `email, first_name, age, country, region, user_type, household_type, business_owner, updated_at`. `plan`, `pro_plan`, `stripe_customer_id`, `stripe_subscription_id` are gone. |
| Writable `stripe_subscription_id` → cross-account webhook downgrade | **Closed** | Same revoke. |
| `plan` had no CHECK constraint | **Closed** | `profiles_plan_check` restored, widened to the new plan ids. |
| `handle_new_user` SECURITY DEFINER, anon-executable, mutable `search_path` | **Closed** | `SET search_path = ''`; EXECUTE revoked from `anon`, `authenticated`, `PUBLIC`. |
| `calculator_shares` RLS enabled, zero policies | **Closed** | Explicit service-role-only policy. |
| No account-deletion path | **Partly closed** | DELETE policy added to `profiles`. The cascade + export flow is still to build. |

> **A correction worth recording:** the first attempt used `REVOKE UPDATE (col) …`. That does **not** carve a column out of a table-level `GRANT UPDATE` — the read-back showed the privilege still present. The fix was to revoke the table-wide grant and re-grant only the allowed columns. This is why the migration verifies with a read-back rather than trusting the statement.

**Supabase security advisors: 6 → 2.** The two remaining:
1. `is_business_member` executable by `authenticated` — **intentional and safe.** It takes no user identity parameter; it resolves `auth.uid()` internally, so a caller can only ever learn about their own membership.
2. Leaked-password protection disabled — a dashboard toggle, cannot be set by migration. **Needs you to enable it** in Supabase → Auth → Policies.

**Not yet done:** provider-secret encryption (no secrets are stored yet), CSP headers, MCP authorisation, `rehype-raw` sanitiser review, rate limiting on `/api/shares`.

---

## 5. Financial correctness — the tests that matter

`tests/golden-financial-cases.test.ts` — **26 tests, all passing.** None special-case a business name or description; they test the semantics.

| Case | Asserts |
|---|---|
| 1 · Income | +$100 → revenue $100, expense $0, profit $100 |
| 2 · Expense | −$100 → revenue $0, expense $100, profit −$100 |
| 3 · Transfer | $1,000 A→B → revenue $0, expense $0, **total net worth unchanged**; a half-recorded transfer is flagged for attention |
| 4 · Credit card | $500 purchase + $500 payment → expenses **$500, not $1,000**; card balance returns to zero |
| 5 · Travel booking | $6,000 gross / $600 commission → **booking volume $6,000, recognized revenue $600**; pass-through supplier money excluded; `full_gross` mode supported for businesses where that is correct; commission from a rate computed without float drift |
| 6 · Owner contribution | $5,000 in → revenue $0, equity +$5,000; draws reduce equity, not profit |
| 7 · Loan | $10,000 borrowed → revenue $0, cash +$10,000, liability +$10,000, **net worth unchanged** |
| 8 · Refund | $1,000 revenue − $200 refund → **$800**, and a refund never becomes an expense |
| 9 · Agency project | $5,000 revenue − $1,800 costs → $3,200 profit, 64% margin; unrelated overhead excluded |
| 10 · Cash ≠ profit | Profitable month that still loses cash |
| Guards | Mixed-currency ledger throws rather than silently summing; soft-deleted rows ignored |

`tests/money.test.ts` — **12 tests.** Includes the values binary floats get wrong: `1.005 → 101` cents (naive `Math.round(v*100)` gives 100), `8.165 → 817`, and 10,000 dimes summing to exactly `$1,000.00`.

### SQL ↔ TypeScript parity — verified against production

A rolled-back transaction ran all eight golden cases through the **real production triggers and semantics functions**:

```
revenue=150000  gross_volume=730000  expenses=60000
owner_contrib=500000  loan=1000000
cash_in=1820000 cash_out=230000
bank_balance=1490000 card_balance=100000
```

Every figure matches the TypeScript engine exactly. Critically, `expenses=60000` — the credit-card payment did **not** become a second expense. The transaction was rolled back by a deliberate `RAISE`; a follow-up count confirmed **0 businesses, 0 transactions, 0 accounts** — no test data persists in production.

---

## 6. Zylx

**Architecture:** `USER → model → tool call → backend computes → typed result + provenance → model explains`. The model is explicitly forbidden from arithmetic and is instructed to quote the `formatted` strings verbatim.

**12 tools implemented:** `get_business_summary`, `get_revenue`, `get_expenses`, `get_profit`, `get_cash_position`, `compare_periods`, `get_outstanding_commissions`, `get_project_profitability`, `get_tax_reserve_estimate`, `find_uncategorized`, `find_missing_receipts`, `propose_transaction`.

**Provenance:** every result carries `claimType` (FACT / CALCULATION / ESTIMATE / EXTERNAL_SOURCE / SUGGESTION), `period`, `currency`, `dataThrough`, `staleAccounts`, `computedAt`. The tax reserve tool returns its assumptions as data, not as prose the model might drop.

**Writes:** `propose_transaction` mutates nothing. It resolves account and category names to ids server-side (so the model can never invent an id), returns a proposal, and `/api/zylx/approve` re-validates it as untrusted input before going through the normal transaction service — with `actor_type = 'zylx'` in the audit log.

**Rate limiting now works and fails closed.** The old limiter queried `ai_usage.used_date`/`count`; production had `usage_date`/`message_count`, so the query errored, the count read as 0, and the cap never applied. The new limiter counts real `ai_messages` rows against the entitlements quota, and a metering failure returns an error rather than granting free usage.

**Prompt injection:** `wrapUntrusted()` fences external text with a random delimiter and explicit data-not-instructions framing, for use with search results, OCR and imported descriptions.

---

## 7. Entitlements & billing

Three plans (Free / Starter $19 / Business $49) plus a legacy `pro` mapped to Business so no existing customer loses access. Limits cover businesses, connected accounts, transaction volume, history, Zylx messages, web search, writes, reports, receipts, tax workspace, accountant seat, team seats, MCP, wealth layer.

**Financial correctness is never gated.** Every plan sees true numbers; limits apply to scale and automation only.

The pricing card now renders `PLAN_MARKETING` — the same data the server enforces — so a feature cannot be advertised unless it is gated. `ROADMAP_NOT_SOLD` is rendered explicitly as "not built yet — and not sold".

**Checkout is disabled** (`CHECKOUT_ENABLED = false`). Stripe still points at the old price ids and its webhook writes `plan = 'pro'`. Rather than keep taking money for capabilities that were not enforced, purchase is off until the Stripe prices are mapped to the new plan ids. **This is a deliberate revenue pause, and it needs your decision to re-enable.**

---

## 8. Design system

Tokens extracted from `bankdemark.com/src/app/globals.css`: ink `#0b1220`, gold `#c6a24a` / `#efd58a` / `#9f7b2e`, cream `#fbf7ef` / `#f7f3ea`, muted `#667085`, Inter, 24px card radius, pill controls, the glass card treatment.

Financial signal colours are deliberately muted (`#1d7a53`, `#b3261e`, `#a8730f`) — a financial dashboard should not read as a trading terminal. Money always uses tabular figures so columns align. 44px minimum control height, visible focus rings, `prefers-reduced-motion` respected, wide content scrolls inside `.bdm-scroll-x` so the page body never scrolls sideways, print styles for reports.

---

## 9. Production readiness — scored honestly

Compared against the audit's original scores.

| Subsystem | Was | Now | Note |
|---|---:|---:|---|
| Security | 28 | **74** | Escalation closed and verified; 2 known advisories; secrets/CSP/MCP auth outstanding |
| Migration discipline | 10 | **90** | CLI linked, 8 migrations, local == remote |
| Financial data model | 0 | **85** | Kernel complete; multi-currency and reconciliation deferred by design |
| Transaction engine | 0 | **80** | Schema, semantics, write service, transfer pairing, dedupe — no UI yet |
| Transfer / double-count safety | 0 | **92** | Structural, not a filter; verified in both SQL and TS |
| Revenue modelling | 3 | **82** | Commission/pass-through/gross-vs-recognized all correct |
| Money precision | 20 | **95** | Minor units end to end; float-hostile parsing tested |
| Multi-business architecture | 0 | **80** | Schema + RLS + roles done; invitations UI not built |
| Audit trail | 0 | **78** | Append-only, actor-typed, diffed; no viewer UI |
| Error handling | 15 | **85** | Typed errors; drift surfaces loudly |
| AI architecture | 45 | **78** | Tools, provenance, approval gate; no chat UI, no web search yet |
| Entitlements / billing honesty | 12 | **70** | Enforced and derived; checkout disabled pending Stripe mapping |
| Design system | 30 | **80** | Brand-aligned tokens; only one screen consumes them |
| Test coverage | 0 | **55** | 38 tests on the financial core; no RLS/integration/API tests |
| **Command Centre UI** | 18 | **22** | Dashboard + shell only |
| Onboarding | 42 | **15** | Old flow is now wrong for the new model; new one not built |
| Reports | 18 | **10** | Service layer supports them; no report engine or exports |
| Taxes | 0 | **8** | Reserve estimate tool only |
| Integrations / ingestion | 5 | **8** | Schema ready; no CSV import, no providers |
| Connections / provider secrets | 0 | **0** | Not started |
| MCP | 0 | **0** | Not started |
| Wealth layer | — | **0** | Not started (old calculators retained for it) |
| Observability | 5 | **35** | Structured redacting logs; no Sentry, no dashboards |

**Overall against the target product: 24 → 46.** The foundation is real. The product surface is not yet built.

---

## 10. Known limitations — precise

**Built and working**
- Security fixes, migrations, financial kernel, domain layer, service layer, Zylx tools + chat route + approval route, entitlements, design tokens, app shell, dashboard (including a genuine zero-data empty state with no sample figures).

**Not built — Phase C/D onward**
- Auth pages (`/auth/*`) — `app/b/[businessId]/layout.tsx` redirects to `/auth/sign-in`, **which does not exist yet**. Existing users still enter via the legacy `/command` route.
- Business onboarding flow (§7 of the brief).
- Transactions, expenses, money-in/bookings, reports, taxes, settings, Zylx chat UI pages. `/b/[businessId]/dashboard` links to these routes; **those links currently 404.**
- CSV import, connections page, provider secret storage, Brave search, Zylx Studio, MCP server, receipts/OCR, reconciliation, report engine and exports, wealth layer, personal-data migration, admin tools, public-site updates.

**Live-state caveats**
- The legacy `/command/*` screens still use the old single-snapshot model. They are on a CSS compatibility shim and are legible, but they are not the new product.
- Stripe checkout is disabled by a constant. No money is being taken.
- No live end-to-end run was performed: creating a business through the UI is not yet possible because onboarding does not exist. The kernel was exercised through SQL instead.
- Mobile/responsive is built to correct patterns but has **not** been verified on a device.

---

## 11. Exact next steps

**Needs your decision or credentials**
1. **Enable leaked-password protection** — Supabase → Authentication → Policies. One toggle; I cannot set it via migration.
2. **Stripe price mapping** — create prices for `starter` and `business`, then re-enable `CHECKOUT_ENABLED` and update the webhook to write the new plan ids. Until then no revenue is collected.
3. **Confirm the pricing** — $19 / $49 are my proposal based on the cost model in the audit, not your approved numbers.

**The next implementation milestone (no blockers)**

> **"First real business, end to end."** Auth pages → onboarding (business type, currency, jurisdiction) → starter accounts → manual transaction entry → the dashboard populating with real figures → the Zylx chat UI with the proposal-approval card.

That is the loop in §101 of your brief, and it is the smallest increment that makes the product demonstrable. Everything it depends on — kernel, services, tools, shell, dashboard — is already built and verified.
