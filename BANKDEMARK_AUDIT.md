# BANKDEMARK — FINANCIAL COMMAND CENTER AUDIT

**Audit date:** 2026-08-07
**Method:** repository read, live HTTP probes, live Supabase production database introspection (project `wzgtpygrgehcprxqppia`), production build, TypeScript type-check, live API calls.
**Standard:** nothing is called "working" without evidence. Anything not confirmed is labeled **UNVERIFIED**.

---

## 1. Executive Summary — What BankDeMark actually is today

BankDeMark today is **two loosely-coupled Next.js apps**:

1. **`bankdemark.com`** — a genuinely substantial content/SEO site: 91 sitemapped URLs, 13 client-side financial calculators, ~58 blog posts, 9 pillar pages. This is the real asset.
2. **`command.bankdemark.com`** — a **single-user, single-snapshot personal-finance calculator with a chat wrapper**. It stores one row of ~20 manually-typed numbers per user and derives ~35 ratios from it.

**It is not a business financial system, and it contains no part of the described vision's foundation.**

Verified against the production database, there is **no** table for: transactions, businesses/workspaces, financial accounts, categories/chart of accounts, receipts/documents, invoices, vendors, clients, projects, reports, tax records, reconciliation, or audit trail. Total production data: **2 user profiles, 1 financial snapshot, 0 debts, 0 goals**.

The gap is not "some features missing." The described product — business ledger, revenue recognition, transfer safety, tax prep — shares **zero schema and zero code** with what exists. The current app is a *personal* finance tool; the vision is a *business* accounting system. Different data model, different primitives.

### The five things that must be fixed before anything else

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | **Any logged-in user can grant themselves Pro for free** | 🔴 CRITICAL | `authenticated` has column-level `UPDATE` on `profiles.plan`; RLS policy is `USING (auth.uid() = id)` with no column restriction. `supabase.from('profiles').update({plan:'pro'})` succeeds from the browser. |
| 2 | **Stripe charges $19/mo, $149/yr, $299 lifetime for zero enforced features** | 🔴 CRITICAL | `grep 'plan ===' ` across the entire app returns exactly **one** gate (the AI limiter) — and that limiter is broken (#3). Every one of the 8 advertised "Pro Adds" is ungated or non-existent. |
| 3 | **Free-tier AI rate limit does not work — AI is unlimited for everyone** | 🔴 CRITICAL | Code queries `ai_usage.used_date` / `.count`; live columns are `usage_date` / `message_count`. Query errors → `currentCount = 0` → limit never trips. `ai_usage` has **0 rows** despite 58 AI messages. Uncapped OpenAI spend. |
| 4 | **Goals feature silently never saves** | 🔴 BROKEN | `GoalsPanel.tsx:186-194` inserts `type/target/current/notes/completed`; live `goals` columns are `goal_type/target_amount/current_amount/priority`. Insert result discarded (no error check). Table has 0 rows. |
| 5 | **All lead capture is broken in production (returns HTTP 500)** | 🔴 BROKEN | `POST https://bankdemark.com/api/newsletter` → `500 {"error":"Could not save email."}`. Both lead routes `appendFile()` to `process.cwd()/data/` — read-only on Vercel. |

---

## 2. Product Architecture

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│ bankdemark.com                  │     │ command.bankdemark.com           │
│ repo: bankdemark-coming-soon    │     │ repo: bankdemark-command         │
│ Next 16.2.6 / React 19.2.4 (JS) │     │ Next 14.2.5 / React 18.3 (TS)    │
│ Vercel prj_I9hyivL…             │     │ Vercel prj_e1tQEWw…              │
│ 91 sitemap URLs                 │     │ 11 routes, 4 API routes          │
│ 13 calculators, ~58 posts       │     │ Supabase Auth + RLS              │
│ Resend (contact) + JSONL (dead) │     │ OpenAI-compatible chat           │
└──────────────┬──────────────────┘     │ Stripe Checkout + webhook        │
               │                        └──────────────┬───────────────────┘
               └──────────► Supabase project `bankdemark` ◄──────────┘
                            (wzgtpygrgehcprxqppia, us-west-1, PG 17)
                            12 tables · 2 tracked migrations
```

| Layer | Reality | Status |
|---|---|---|
| Frontend | 2 Next.js apps, divergent major versions, no shared code/design system | Functional but incomplete |
| Backend | Next route handlers only. No worker, no queue, no cron. | Prototype |
| Database | Supabase Postgres 17. RLS on all 12 tables. | Functional but incomplete |
| Migrations | **Only 2 tracked** — both for `calculator_shares`. The whole Command schema was hand-pasted into the SQL editor. | 🔴 Broken — root cause of findings #3, #4, and §21 |
| Auth | Supabase Auth + `@supabase/ssr` middleware | Production ready |
| Payments | Stripe Checkout + signature-verified webhook | Partially wired |
| AI | OpenAI-compatible `/chat/completions`, streamed SSE | Functional but incomplete |
| Banking / data feeds | **None. No provider, no code, no schema.** | Missing |
| Email | Resend on contact form only. Newsletter/leads write to disk. | Broken |
| Storage | None | Missing |
| Monitoring / observability | `console.log` only | Missing |
| Admin tools | **None** | Missing |
| Cron / jobs / workers | **None** | Missing |

**Architecture map — the critical structural fact:** the two apps share a database but nothing else. There is no shared types package, no shared calculation library, no shared design system. The mortgage math on the public site and the affordability math in Command are independent implementations that disagree.

---

## 3. Public SEO / Acquisition Site — `bankdemark.com`

**Status: Functional but incomplete — the strongest asset in the portfolio.**

Verified live: `200` on `/`, `/calculators`, `/robots.txt`, `/sitemap.xml`. `www` → apex `308`. Production build succeeds. 91 URLs in sitemap, all crawlable (`Allow: /`, with `/s/`, `/share/`, `/api/`, `/_next/` disallowed — correct).

### What the site claims vs. what exists

`/pillars/command` is the money page, and it **materially overstates the product**:

| Claim on `/pillars/command` | Reality (verified in code) | Verdict |
|---|---|---|
| "creates a single source of truth for your entire financial life" | One manually-typed snapshot row | ❌ False |
| "Command solves the integration problem" | Zero integrations exist | ❌ False |
| "Investment Command Center — portfolio tracking, growth projections, **allocation analysis**" | One number: `investment_balance`. No holdings, no allocation. `grep allocation` → absent. | ❌ False |
| "FIRE Planning Engine — FIRE number, **Coast FIRE, Lean FIRE, Fat FIRE**" | `calcFIRENumber` = `annual_expenses × 25`. Coast/Lean/Fat: `grep` → **absent**. | ❌ False |
| "native Canadian registered account intelligence" | No TFSA/RRSP/FHSA logic in the app at all | ❌ False |
| "Net Worth Command Center — total assets, liabilities" | Real: `savings + investments − total_debt` | ✅ True (crude) |
| "Debt Command Center — payoff strategies" | Real: avalanche + snowball simulators | ✅ True |

**This is the most legally exposed surface in the product.** A finance site making specific, checkable feature claims that the product does not deliver.

### Structural gaps
- **No pricing page** on the public site. Pricing exists only inside the authenticated app at `/command/marketplace`. A visitor cannot learn what BankDeMark costs without signing up.
- **No business-model / industry pages** (travel advisor, ecommerce, agency, SaaS, freelancer). The entire site is positioned for *personal* finance. Nothing supports the business-owner vision.
- Positioning is "modern finance tools & money guides" — a **content publisher**, not a financial command center. Correctly reflects today; contradicts the stated vision.

---

## 4. SEO / AEO / AI Understanding

### Working
- Clean titles/descriptions/canonicals on sampled pages. Homepage canonical `https://bankdemark.com` ✅
- `FAQPage`, `HowTo`, `WebApplication`, `Offer` JSON-LD on calculator pages ✅ (verified live on `/calculators/mortgage-calculator`)
- Share pages correctly `noindex, nofollow` + robots-disallowed ✅
- 20 legacy-URL redirects configured (cleaning up an acquired/spam domain history) ✅
- `bankdemark-disavow.txt` present — someone has done real backlink hygiene ✅

### Broken / missing

| Issue | Evidence | Impact |
|---|---|---|
| 🔴 **App entry page canonicalizes to a 404 on another domain** | `command.bankdemark.com/command` emits `rel="canonical" href="https://bankdemark.com/command"`. That URL returns **404**. | Google will not index the app's signup landing page. The single most important conversion page is invisible to search. |
| 🔴 **App domain has no `robots.txt` and no `sitemap.xml`** | Both `404` on `command.bankdemark.com` | Crawlers have no guidance for the entire application surface |
| 🟠 **Homepage has zero structured data** | `curl bankdemark.com \| grep '@type'` → empty | No `Organization`, no `WebSite`, no `SoftwareApplication`. Google and AI engines have **no entity anchor for the brand itself** — only for individual calculators. |
| 🟠 No `sameAs` / entity graph | absent | Brand disambiguation impossible |
| 🟠 `BreadcrumbList` inconsistent | present on some calculator pages, absent on homepage | Weak sitelinks |

**Can Google/AI understand BankDeMark?** Partially. They can understand *individual calculators* (well-marked-up, self-describing). They **cannot** reliably understand *what BankDeMark the company is*, *who it is for*, or *whether it is free or paid* — there is no Organization entity and no public pricing page.

**Pages most likely to earn AI citations:** `/calculators/compound-interest-calculator`, `/average-net-worth-by-age-canada` (487 lines, statistics-dense), `/statistics`, `/average-retirement-savings-by-age`. These answer discrete numeric questions with structured data. *Schema does not guarantee citation — this is a likelihood ranking, not a promise.*

---

## 5. Free Tools Inventory

13 calculators, all client-side `useMemo`, all instant, all mobile-responsive, all with FAQ+HowTo+WebApplication schema and a `CommandCenterCTA`. **Structurally this is a strong acquisition engine.** But formula validation found real defects.

| Calculator | Formula verdict |
|---|---|
| Compound Interest | ✅ Correct. `P(1+r/n)^(nt)` + monthly annuity. Comments disclose the mixed compounding. |
| Debt Payoff / Credit Card | ✅ Correct amortization |
| Net Worth | ✅ Correct (assets − liabilities) |
| Investment / Retirement / FIRE | ✅ Standard FV + 25× |
| Budget / Emergency Fund | ✅ Trivially correct |
| Rent vs Buy | UNVERIFIED (not formula-checked) |
| **Mortgage** | ⚠️ **Canadian math is wrong** |
| **RRSP / TFSA** | 🔴 **Multiple defects + a runtime crash** |

### 🔴 RRSP/TFSA calculator — `RegisteredAccountCalculator.js`

1. **Share button throws a ReferenceError.** Line 76 reads `String(annualContribution ?? "")` — `annualContribution` **is not declared anywhere in the component** (the state variable is `contribution`). Lines 81-82 read `result.futureValue` and `result.totalContributions` — neither exists on `result` (it returns `projectedValue`). Clicking Share on `/calculators/rrsp-calculator` or `/calculators/tfsa-calculator` crashes. *(Build passes — this is runtime-only, inside a callback.)*
2. **Inconsistent compounding within one result.** Line 54 compounds the balance **monthly**; line 55 compounds the contribution **annually**, as a one-time lump sum. The two terms are then added. The output is not a coherent projection under any single assumption.
3. **Undated, unsourced, mismatched-vintage tax constants.** `rrspAnnualLimit = 33810` and `tfsaAnnualLimit = 7000` are hardcoded with no year label, no source, no last-updated date, in the UI or the code. They also appear to be from **different tax years**.
4. **TFSA room formula is wrong for most users.** `estimatedTFSARoom = 7000 + unused` ignores cumulative room since 2009/age 18. Understates room by tens of thousands for a typical adult.

### ⚠️ Mortgage calculator — Canadian payments are overstated

Line 63: `const monthlyRate = toNumber(rate) / 100 / 12;` — applied to **both** Canada and USA.

Canadian mortgages are compounded **semi-annually** (Interest Act). The correct rate is `Math.pow(1 + rate/200, 1/6) - 1`. The component has an `isCanada` flag and branches on it for CMHC premiums, term labels, and copy — **but not for the rate math**.

On $500k / 25yr / 5.25%: monthly compounding ≈ **$2,995/mo**, semi-annual ≈ **$2,974/mo**. ~$21/mo, ~**$6,300 over the amortization**. On a Canada-first finance brand this is a credibility problem.

Also: US "PMI Estimate" is **hardcoded to display $0** (`formatter.format(isCanada ? result.insurancePremium : 0)`) — a UI-only field.

### Other
- 🟠 `POST /api/shares` is **unauthenticated, unrate-limited, and writes via the service-role key** (bypassing RLS). Anyone can insert unlimited rows into `calculator_shares` indefinitely.
- 🟠 Marketplace links to `/blog/how-compound-interest-works` — returns `308` (redirect, not a clean link).
- ✅ No duplicate/dead calculators found. `/fire-calculator` and `/calculators/fire-calculator` both exist, both in sitemap — mild cannibalization risk.

**Strongest acquisition tools:** Compound Interest, Net Worth, Debt Payoff, FIRE. **Fix immediately:** RRSP/TFSA (crash + wrong math on tax-sensitive content), Mortgage (Canadian rate).

---

## 6. Signup, Onboarding & Acquisition Funnel

```
Google/AI → calculator page → CommandCenterCTA → command.bankdemark.com/command
          → Supabase Auth → /command/onboarding (single form, ~20 fields)
          → /command/dashboard
```

**Working:** the funnel is wired end-to-end. Public site links to `command.bankdemark.com/command`, `/command/coach`, `/command/marketplace` (verified live). Auth gating works — `/command/dashboard` unauthenticated returns `307 → /command?auth=required`. A profile row is auto-created by an `auth.users` trigger.

**Friction and dead ends:**

| Problem | Detail |
|---|---|
| 🔴 Entry page is de-indexed by its own canonical | See §4 |
| 🔴 Calculator results do **not** carry into onboarding | `CalculatorStateHydrator` and `useCalculatorShare` populate share links only. A user who just computed their net worth must retype every number. **The single biggest wasted conversion asset.** |
| 🟠 Onboarding is one ~20-field wall of numbers | `OnboardingForm.tsx` (589 lines). No progressive disclosure, no "skip for now", no import. Requires knowing fixed vs. variable expenses, average debt interest rate, and minimum payments before seeing any value. |
| 🟠 No public pricing page | Plan boundaries invisible pre-signup |
| 🟠 Cross-domain session | `bankdemark.com` → `command.bankdemark.com` is a hard context switch with different nav and different design |

**Time to first insight:** ~3-6 minutes of manual data entry, assuming the user has their numbers memorized. For a business owner, this is unachievable — none of the required fields describe a business.

---

## 7. Subscription Tiers — Claimed vs. Enforced

**Claimed** (`ProUpgradeCard.tsx`): Free / Pro $19 mo / $149 yr / $299 lifetime.

| "Pro Adds" claim | Enforced in code? | Reality |
|---|---|---|
| Unlimited AI coach with deep context | ❌ | Limiter is broken → **free users already have unlimited** |
| Advanced scenario simulations | ❌ | No such feature exists |
| Couple & family dashboard | ❌ | No such feature exists |
| Business finance module | ❌ | 2 nullable columns on the snapshot |
| Wealth & debt alerts | ❌ | No alerting system, no cron |
| **Tax planning mode** | ❌ | **No tax code exists anywhere in the app** |
| PDF export for all reports | ❌ | Free users already have `window.print()` at `ReportsPanel.tsx:72`. The "Pro PDF Export" banner at line 391 upsells a feature everyone has. |
| Priority support | ❌ | No support system |

**Verified:** `grep -rn "plan ===" app components lib` returns exactly one hit — `coach/route.ts:218` — and that gate is non-functional.

> 🔴 **A customer who pays $299 for "Lifetime" receives, technically, nothing.** This is a chargeback and consumer-protection exposure, not merely a product gap. It should be fixed or the checkout should be disabled before any marketing spend.

**Also:** `profiles.plan` lost its `CHECK (plan IN ('free','pro'))` constraint between the schema file and production — live has no check. Combined with the writable-`plan` RLS hole (§23), the plan column is fully user-controlled with arbitrary values.

---

## 8. Current Command Center (Dashboard)

`DashboardOverview.tsx` — 3 parallel queries, renders health score + ~8 metric cards + priority stack.

**Answers today:** cash flow, savings rate, emergency runway, DTI, net worth, FIRE number, debt-free estimate, health score 0-100.

**Cannot answer (no data exists):** cash on hand, revenue, expenses by category, profit, tax reserve, receivables, payables, business net worth, burn, runway, uncategorized transactions, missing receipts, items needing review, "what changed this month."

- 🔴 **The score trend chart never renders.** Query selects `score, recorded_at` and orders by `recorded_at`; the live `score_history` columns are `score, band, source, created_at`. There is no `recorded_at`. Query fails → empty. And both write sites (`OnboardingForm.tsx:217`, `EditProfilePanel.tsx:150`) insert `health_label`, which does not exist either — both wrapped in bare `try {} catch {}`. **Live table: 0 rows.**
- 🟠 Visual hierarchy is good — score-first, then metrics, then priorities. This part is well designed.
- 🟠 No freshness indicator anywhere, because there is no synced data to be stale. (Correct today; a hard blocker the moment any feed exists.)

---

## 9-10. Financial Data Model & Transaction Engine

### 🔴 There is no transaction engine. There is no `transactions` table.

Full production table list (12): `profiles`, `financial_snapshots`, `debts`, `goals`, `ai_conversations`, `ai_messages`, `ai_user_memory`, `ai_usage`, `score_history`, `email_leads`, `recommendation_events`, `calculator_shares`.

**Absent entirely:** transactions, businesses, workspaces, memberships, accounts, categories, chart of accounts, receipts, documents, invoices, vendors, customers, projects, tax records/rates, reconciliation, journal entries, audit log, reports.

Of the ~25 transaction fields the vision requires (date, amount, currency, account, merchant, category, type, tax treatment, business, project, client, vendor, receipt, source, transfer match, reconciliation, notes, AI confidence, review status), **zero exist**.

### The data model that does exist

`financial_snapshots` — `UNIQUE(user_id)`, one row per user, ~20 manually-typed numbers. It is a **point-in-time questionnaire, not a ledger**. There is no history, no time dimension, no line items. `updated_at` overwrites in place; the prior state is destroyed.

**This is the central architectural fact of the audit:** the vision's flow is `BUSINESS → ACCOUNTS → TRANSACTIONS → CLASSIFICATION → LEDGER → INTELLIGENCE`. The current system starts at "user types 20 aggregates." There is no path from one to the other by extension. **The financial core must be built new.**

---

## 11-12. Ingestion & Double-Counting / Transfer Safety

**Ingestion: nothing exists.** No bank feed, no Plaid/Flinks/MX, no Stripe/Shopify/PayPal/Square import, no CSV, no OCR, no API. The only path in is the onboarding form.

**Transfer safety: not applicable, and that is the danger.** Because there are no transactions, transfers cannot be double-counted *yet*. But there is also no schema slot for `transaction_type`, no transfer-pair concept, no account model. **The double-counting problem is unbuilt, not solved.** The moment ingestion is added without this, transfers become fake revenue and credit-card payments become double expenses.

**One live double-count already exists in the aggregate model:** `calcMonthlyCashFlow` sums `monthly_income + business_revenue`. Nothing prevents a business owner from entering their owner's-draw in `monthly_income` *and* the same money in `business_revenue`. There is no validation, no warning, no reconciliation.

---

## 13-16. Categorization, Chart of Accounts, Revenue, Expenses, Receipts

**All missing.**

- **AI categorization:** does not exist. No prompts, no rules, no merchant memory, no confidence, no learning loop, no human review queue.
- **Chart of accounts:** does not exist. No income/expense/asset/liability/equity classification. The closest thing is `RECOMMENDATION.category` — an 8-value enum used for advice copy, not accounting.
- **Revenue engine:** does not exist. One nullable `business_revenue` column, treated as a flat monthly number. **No concept of gross sales, net sales, recognized revenue, commissions, fees, refunds, discounts, chargebacks, or pass-through funds.**
  - 🔴 **The travel-advisor test fails completely.** A $6,000 booking with a $600 commission cannot be represented. There is exactly one field. Entering $6,000 inflates income 10× and corrupts every downstream metric (cash flow, savings rate, DTI, health score, FIRE number). Entering $600 loses the booking volume entirely. **There is no correct answer available to the user.**
- **Expense management:** one number, `business_expenses`. No vendors, no recurring, no receipts, no duplicates, no business/personal split, no review.
- **Receipts/documents:** no upload, no storage bucket, no OCR, no matching. Supabase Storage is not configured.

---

## 17-20. Owner Capital, Assets, Liabilities, Business Wealth

| Capability | Status |
|---|---|
| Owner contributions / draws / distributions / retained earnings | ❌ Missing — no equity concept at all |
| Shareholder loans, external investment | ❌ Missing |
| Assets: cash, AR, inventory, equipment, vehicles, intangibles | ❌ Missing — only `savings_balance` + `investment_balance` |
| Unrealized gains/losses | ❌ Missing |
| Liabilities: itemized | ⚠️ **Partial.** `debts` table is real and well-shaped (name, balance, rate, min payment, 8 types) with correct avalanche/snowball simulators. **But live row count is 0** and no UI writes to it — `DebtEngine.tsx` reads `snapshot.total_debt`. The best-built piece of the financial model is **dead code**. |
| Taxes payable / accounts payable | ❌ Missing |
| **Business net worth** | ❌ Missing. `calcNetWorth` is *personal*: `(savings + investments) − total_debt`. No business dimension, no business balance sheet. |

**Required for Business Wealth:** a business entity, an accounts table with balances + `as_of`, an assets register, a liabilities register, and a period-close concept. None exist.

---

## 21. Project / Client Profitability

❌ **Missing.** No project, client, trip, campaign, product, department, or cost-center dimension anywhere in the schema. "How profitable was Project X?" is unanswerable and unbuildable without the transaction layer.

---

## 22-23. Metrics & Reporting

### Metrics inventory — formula audit

All ~35 metrics derive from one snapshot row via `lib/command/calculations.ts` (698 lines, pure functions, deterministic — **this file is genuinely good work**).

| Metric | Formula | Verdict |
|---|---|---|
| Monthly cash flow | `(income + biz_rev) − (fixed + variable + housing + min_debt + biz_exp)` | ✅ Sound, but see §12 double-count risk |
| Savings rate | `cash_flow / total_income`, clamped ±1 | ✅ Sound |
| Emergency runway | `savings / (fixed + variable + housing)` — **excludes debt payments** | ⚠️ Optimistic. Real runway must cover minimum debt payments. Overstates for indebted users. |
| DTI | `min_debt_payment / income` | ✅ Standard |
| Net worth | `(savings + investments) − total_debt` | ✅ Correct for the inputs; ignores home equity, vehicles, business value |
| FIRE number | `annual_expenses × 25` | ✅ Standard 4% rule |
| Health score | 6 weighted components | ⚠️ **Misleading.** 10% of the score is `profile_completeness` — awarded for merely *having* a goal, retirement age, risk tolerance, and credit band, all of which have **non-null defaults**. Every user gets a free 10 points for typing nothing. |
| `calcYearsToRetirement` | `desired_retirement_age − (snapshot as any).age` | 🔴 **Returns `NaN`** — `age` is on `profiles`, not `financial_snapshots`. **Dead code** (`calcAllMetrics` computes it correctly inline), but a live landmine. |

**Financially meaningless-but-impressive metrics:** `projection_conservative/moderate/aggressive` assume the user invests `max(0, cash_flow × 0.3)` monthly for 10 years — an assumption **never disclosed to the user**. The dashboard presents these as projections of their money.

### Report engine

`ReportsPanel.tsx` — 4 client-rendered report views (Health Summary, Monthly Wealth, Debt Freedom, Emergency Fund). Export = `window.print()`.

| Vision report | Status |
|---|---|
| P&L, Balance Sheet, Cash Flow Statement | ❌ Missing |
| Revenue, Expense, Tax Summary, GST/HST/QST/VAT | ❌ Missing |
| Vendor Spending, Customer Revenue, Project Profitability, Commission | ❌ Missing |
| Receivables, Liabilities, Owner Contributions/Draws | ❌ Missing |
| Business Wealth / Net Worth | ❌ Missing (personal only) |
| Accountant Package | ❌ Missing |

**Exports:** on-screen ✅, browser print ✅, PDF ❌ (no generator), CSV ❌, XLSX ❌, accountant export ❌, API ❌. **Reports are not reproducible** — they render from live state with no snapshot, no version, no `generated_at`. The same report run tomorrow silently returns different numbers.

---

## 24-25. Tax

❌ **Completely absent.** No tax tables, no rates, no jurisdictions, no GST/HST/QST/VAT, no tax categories, no reserve calculation, no "Prepare Taxes" flow, no accountant package.

`grep -i tax` across the app returns only: disclaimer copy, an AI keyword-classifier entry, a `'tax'` enum value in a recommendation category, and a marketplace affiliate card pointing at `/best-tax-software-canada` — **which returns 404 on both domains**.

**"Tax planning mode" is sold on the Pro pricing card.** It does not exist in any form.

The only tax logic in the entire ecosystem is the public RRSP/TFSA calculator, whose constants are undated, unsourced, of mismatched vintage, and whose share button crashes (§5). **Nothing in the codebase has an effective date, a jurisdiction tag, a source citation, or a version.**

---

## 26-28. AI Assistant, Tooling & Safety

`app/api/command/coach/route.ts` (506 lines) + `lib/command/aiContext.ts`.

### Genuinely good
✅ **The core architecture is right and matches the vision's most important principle.** `calcAllMetrics()` computes deterministically **before** the LLM call; results are injected as pre-formatted text (`buildUserContext`). The model explains numbers; it does not compute them. This is exactly the CALCULATION-vs-EXPLANATION separation the vision demands.
✅ Auth-gated, 2000-char cap, streamed SSE, workspace-scoped by RLS.
✅ Strong system prompt with real legal guardrails ("not a financial advisor, tax professional, lender…").
✅ Prompt-mode classifier avoids burning tokens on "hi".

### Broken
- 🔴 **Rate limiting non-functional** (§1, finding #3) — uncapped spend.
- 🔴 **Conversation memory writes fail silently.** Route selects and updates `ai_conversations.summary` / `.last_context_summary`. **Neither column exists in production** — the `ai-memory-upgrade.sql` `ALTER TABLE` was never applied (only its `CREATE TABLE ai_user_memory` half was). Long-conversation continuity is dead.
- 🟠 **Memory extraction is a naive substring matcher.** `buildMemoryCandidate` writes to `ai_user_memory` on any message >25 chars containing "i want"/"my goal"/"i own". No dedup, no confidence, no user review, no delete UI. It will accumulate contradictory "verified long-term memories" — and the prompt tells the model these **"override generic assumptions"** and to "prioritize these memories heavily."
- 🟠 `formatMemoryContext` joins with the literal string `'\\n'` (escaped backslash-n), not a newline — memories render as one run-on line.

### AI tooling
❌ **No tool/function calling.** Zero of `get_revenue`, `get_expenses`, `get_profit`, `compare_periods`, `get_cash_position`, `get_tax_estimate`, `get_vendor_spend`, `get_project_profitability`, `get_receivables`, `get_net_worth`, `find_uncategorized`, `find_missing_receipts` exist. Context is a single static text blob.

### AI safety
| Control | Status |
|---|---|
| Deterministic calculation source | ✅ **Present — the best thing in the codebase** |
| Workspace/user isolation | ✅ Via RLS |
| Authorization | ✅ Auth required |
| Hallucination controls | ⚠️ Prompt-level only |
| FACT / CALCULATION / ESTIMATE / SUGGESTION labeling | ❌ Missing |
| Source attribution, date ranges, stale-data handling | ❌ Missing |
| Prompt-injection defense | ❌ **None.** User text flows into `ai_user_memory`, is later re-injected as "VERIFIED long-term memory… override generic assumptions." A user can write their own persistent system instructions. Low impact today (self-harm only, no tools); **becomes a real vulnerability the instant tool-calling or multi-user workspaces land.** |
| Destructive-action guardrails | N/A (no write tools) |

---

## 29-31. Integrations, Reconciliation, Multi-Business

- **Integrations:** Stripe (partially wired — see §7), OpenAI-compatible AI, Supabase, Resend (contact only). **No financial data integrations of any kind.**
- **Reconciliation:** ❌ Missing entirely. No statement balance, no matching, no discrepancy detection, no reconciliation date, no period locking.
- **Multi-business:** ❌ Missing. `financial_snapshots` is `UNIQUE(user_id)` — **the schema structurally enforces one financial reality per human**. There are no organizations, no workspaces, no memberships, no roles, no invitations, no accountant access. The vision's "one person → multiple businesses" requires dropping that unique constraint and inserting a `businesses` entity between `users` and every financial row. **Every RLS policy in the database (34 policies across 12 tables) would need rewriting** from `auth.uid() = user_id` to a membership check.
- **Portfolio view:** ❌ Missing.

---

## 32. Is BankDeMark a system of record?

**Today: neither.** It is not a dashboard over other systems (no integrations) and not a system of record (no transactions, no immutable history, no audit trail).

It is a **calculator with persistence**. The canonical record is one questionnaire row that is destructively overwritten on every edit.

---

## 33. Security

**Overall: below the bar for financial data.**

### 🔴 Critical

**1. Privilege escalation → free Pro (CONFIRMED)**
```
information_schema.column_privileges:
  grantee=authenticated, table=profiles, privs=INSERT,SELECT,UPDATE  (all 16 columns)
pg_policies:
  profiles UPDATE  USING (auth.uid() = id)   -- no column restriction
```
Any logged-in user, from the browser with the public anon key:
```js
await supabase.from('profiles').update({ plan: 'pro' }).eq('id', myUserId)
```
succeeds. `plan`, `pro_plan`, `stripe_customer_id`, and `stripe_subscription_id` are all user-writable. Writing an attacker-chosen `stripe_subscription_id` can also **hijack another account's webhook**: `invoice.payment_failed` looks up the profile by `stripe_subscription_id` and downgrades whoever matches.

**Fix:** `REVOKE UPDATE (plan, pro_plan, stripe_customer_id, stripe_subscription_id) ON public.profiles FROM authenticated, anon;`

**2. No account deletion / no data portability**
`profiles` has **no DELETE policy** (verified across all 34 policies). There is no export endpoint, no delete-account flow, no data-request path. For a Canadian product handling financial data this is a **PIPEDA problem**, not just a feature gap.

### 🟠 High
- **Unauthenticated service-role write path.** `POST /api/shares` is public, unrate-limited, and inserts via the service-role key. Unbounded DB growth by any anonymous caller.
- **`calculator_shares` has RLS enabled with zero policies** (Supabase advisor `rls_enabled_no_policy`). Currently fine — all access is service-role — but any future anon read silently returns empty.
- **`handle_new_user()` is `SECURITY DEFINER` and executable by `anon` and `authenticated`** via `/rest/v1/rpc/handle_new_user` (Supabase advisors 0028/0029).
- **`update_updated_at_column` and `handle_new_user` have mutable `search_path`** (advisor 0011) — `SECURITY DEFINER` + mutable search_path is a known escalation pattern.
- **Leaked-password protection is disabled** in Supabase Auth (HaveIBeenPwned check off).
- **No rate limiting** on `/api/checkout` or `/api/command/coach` (the coach's only limiter is broken).
- **`.env.local` contains live secrets** including `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY`, present in both working trees. `.gitignore` covers it — but no secret rotation policy and no vault.

### ✅ Working
- RLS enabled on all 12 tables, 34 policies, all correctly scoped to `auth.uid()`.
- No IDOR found — every client query is RLS-constrained; the `.eq('id', …)` filters are belt-and-braces.
- Stripe webhook signature verification is correct (`constructEvent` with raw `req.text()`), fails closed on missing secret.
- Service-role key is server-only; never reaches the client.
- Middleware auth gating verified live (`307 → /command?auth=required`).
- Input validation on the AI route (type + length).

### Not assessed — UNVERIFIED
CSV injection (no CSV export exists), file uploads (none exist), SSRF (no server-side fetch of user URLs), XSS in `react-markdown` + `rehype-raw` (**flagged: `rehype-raw` permits raw HTML in AI output — needs a sanitizer review**), backups, CSP headers, Vercel env-var scoping.

---

## 34. Audit Trail

❌ **Completely absent.** No log of who changed what, when, from what, to what, or via which source. `financial_snapshots` overwrites in place — prior values are unrecoverable. `score_history` was the one attempt at history and it is broken (§8).

For accountant trust and for AI explainability ("why does this number differ from last month?"), this is foundational and missing.

---

## 35. Reliability, Observability & Performance

**Observability: none.** No Sentry, no structured logging, no error tracking, no job status, no sync monitoring, no AI call logging, no alerts. Errors go to `console.error` and vanish into Vercel's log buffer.

Of the vision's diagnostic questions, an admin can answer **zero**. There is no admin tooling of any kind.

🔴 **Errors are actively hidden.** The four schema-drift bugs (goals, ai_usage, ai_conversations, score_history) have been silently failing in production for weeks. The pattern:
```js
await supabase.from('goals').insert(payload);   // result discarded
try { await supabase.from('score_history').insert({...}); } catch {}   // swallowed
```
**Not one of them would have reached production with error checking.** This is the single highest-leverage engineering-practice fix.

**Performance: adequate today, unmeasured at scale.**
- Dashboard: 1 auth call + 3 parallel queries. Fine.
- All aggregation is in-memory over one row — O(1).
- Debt simulator: 600-iteration loop over `n` debts, client-side. Fine for realistic n.
- 100 / 10k / 100k / 1M transactions: **not applicable — there are no transactions.** The moment they exist, none of the current patterns survive: no pagination anywhere, no materialized summaries, no cache, no aggregate indexes.
- Report generation, imports, AI latency at load: **UNVERIFIED** (not load-tested).

---

## 36. Mobile / Responsive UX

**Partially verified.** Code inspection shows consistent Tailwind responsive patterns (`grid-cols-2 lg:grid-cols-4`, `p-4 lg:p-6`, `flex-col sm:flex-row`) across dashboard, reports, goals, and marketplace. `PWAInstallPrompt.tsx` exists and a PWA manifest is committed. Public-site calculators use responsive layouts throughout.

**UNVERIFIED:** no live device or emulator testing was performed. Chart/table overflow on narrow viewports, the 20-field onboarding form on mobile, and the AI chat scroll behavior are **untested**. Given the density of the onboarding form, mobile completion is a likely drop-off point.

---

## 37. Real Business Model Tests

| Model | Result |
|---|---|
| **Travel advisor** | 🔴 **Fails.** $6,000 booking / $600 commission cannot be represented. One `business_revenue` field. Either answer corrupts every downstream metric. |
| **Ecommerce** | 🔴 **Fails.** No COGS, no inventory, no shipping, no ad spend, no gross-vs-net. |
| **Agency** | 🔴 **Fails.** No projects, no clients, no retainers, no subcontractors. |
| **SaaS** | 🔴 **Fails.** No MRR, no churn, no refunds, no payment fees, no cloud-cost tracking. |
| **Freelancer** | ⚠️ **Weakest failure.** Personal cash flow + debt + emergency fund *do* apply. But no invoices, no receivables, no quarterly tax estimate — and irregular income breaks the flat monthly model entirely. |

**Where the architecture fails, universally:** there is one revenue number and one expense number. Every business model above requires a **line-item ledger with classification**. This is not a configuration gap — it is the absence of the primitive.

---

## 38. Production Readiness Scorecard (0-100, not inflated)

| Area | Score | Note |
|---|---:|---|
| Public SEO site | **68** | Real asset; broken canonical, no Organization schema, overstated claims |
| Free tools | **58** | 13 real calculators; 1 crashes, 1 has wrong Canadian math, tax constants undated |
| Signup / onboarding | **42** | Works but high-friction; calculator→onboarding handoff wasted; entry page de-indexed |
| Multi-business architecture | **0** | Schema structurally prevents it |
| Data ingestion | **0** | Nothing exists |
| Transaction engine | **0** | No table |
| Categorization | **0** | Nothing exists |
| Revenue modeling | **3** | One nullable number |
| Expense management | **3** | One nullable number |
| Assets / investments | **8** | Two aggregate balances |
| Liabilities | **20** | Good `debts` schema + correct simulators — but 0 rows, no UI writes it |
| Business wealth | **0** | Personal net worth only |
| Reporting | **18** | 4 views, print-only, not reproducible |
| Tax preparation | **0** | Advertised, does not exist |
| AI assistant | **45** | Right architecture, broken memory, no tools |
| AI accuracy / safety | **50** | Deterministic-calc separation is genuinely good; no labeling, no injection defense |
| Integrations | **5** | Stripe only, and it grants nothing |
| Reconciliation | **0** | Nothing exists |
| Security | **28** | RLS is solid; privilege escalation + no deletion path are disqualifying |
| Reliability | **30** | Builds and type-checks clean; errors silently swallowed |
| Observability | **5** | `console.log` |
| Responsive UX | **60** | Patterns look right; **UNVERIFIED on device** |
| Billing / tiers | **12** | Charges money, enforces nothing |
| Product simplicity | **70** | Genuinely good — plain language, clean hierarchy, no jargon |

**Overall: 24 / 100** against the stated vision.
**As a personal-finance calculator with a chat layer: ~55 / 100**, held down by the billing and security defects.

---

## 39. Working Well

- `lib/command/calculations.ts` — 698 lines of pure, deterministic, well-organized financial math. Correct avalanche/snowball simulators with a minimum-only baseline for interest-saved. **Reusable as-is.**
- **AI architecture: calculate first, explain second.** Already implements the vision's hardest AI principle correctly.
- RLS on all 12 tables, 34 correctly-scoped policies. No IDOR found.
- Stripe webhook signature verification — correct, fails closed.
- Middleware auth gating — verified live.
- Public content site: 91 URLs, 13 calculators, real schema markup, disavow file, 20 legacy redirects. Real SEO work.
- Product language: "Money In," health score, priority stack. No accounting jargon. The vision's simplicity principle is already respected.
- Build + type-check both pass clean on both repos.

## 40. Working But Incomplete

- AI coach — works, but memory writes fail, no tools, no fact/estimate labeling.
- Reports — 4 views render correctly, but print-only and not reproducible.
- `debts` table — well-designed, correct simulators, **zero UI writes it**. Dead code awaiting a form.
- Stripe checkout — sessions create correctly, webhook updates the plan, but the plan grants nothing.
- Onboarding — captures the data, but is a wall and drops calculator context.
- Health score — works, but 10% is free points for defaults.

## 41. Missing

Transactions · businesses/workspaces · accounts · categories/CoA · ingestion (all forms) · classification · receipts/documents · revenue recognition · expense management · owner capital/equity · asset & liability registers · business net worth · project/client profitability · P&L, balance sheet, cash flow · tax (everything) · reconciliation · accountant mode · period locking · audit trail · AI tool-calling · data freshness · observability · admin tooling · account deletion · data export · public pricing page · business-model configuration · multi-business/portfolio

## 42. Broken / Dangerous

| # | Issue | Class |
|---|---|---|
| 1 | Any user can self-grant Pro (`profiles.plan` writable) | 🔴 Dangerous |
| 2 | Writable `stripe_subscription_id` → cross-account webhook downgrade | 🔴 Dangerous |
| 3 | Stripe charges up to $299 for zero enforced features | 🔴 Dangerous |
| 4 | AI rate limit non-functional → uncapped OpenAI spend | 🔴 Dangerous |
| 5 | No account deletion, no data export (PIPEDA) | 🔴 Dangerous |
| 6 | "Tax planning mode" sold; does not exist | 🔴 Dangerous |
| 7 | `/pillars/command` advertises portfolio allocation, Coast/Lean/Fat FIRE, integrations — none exist | 🔴 Dangerous |
| 8 | RRSP/TFSA share button throws ReferenceError | 🔴 Broken |
| 9 | RRSP/TFSA: inconsistent compounding; undated, mismatched-vintage tax constants; wrong TFSA room | 🔴 Broken |
| 10 | Mortgage: Canadian semi-annual compounding not applied | 🟠 Broken |
| 11 | Goals never save (schema drift) | 🔴 Broken |
| 12 | `score_history` never reads or writes (schema drift, both directions) | 🔴 Broken |
| 13 | `ai_conversations.summary` columns absent → conversation memory dead | 🔴 Broken |
| 14 | All lead capture returns 500 in production (filesystem writes on Vercel) | 🔴 Broken |
| 15 | App entry page canonicalizes to a 404 on another domain | 🔴 Broken |
| 16 | 8 marketplace affiliate CTAs all 404 | 🟠 Broken |
| 17 | `calcYearsToRetirement` returns `NaN` (dead code) | 🟠 Broken |
| 18 | Errors systematically swallowed (`await` discarded, bare `catch {}`) | 🔴 Dangerous practice |
| 19 | No migration system — production schema diverged from repo SQL (root cause of 11-13) | 🔴 Dangerous practice |
| 20 | Emergency runway excludes debt payments — optimistic for indebted users | 🟠 Misleading |
| 21 | Investment projections assume undisclosed 30%-of-cash-flow contributions | 🟠 Misleading |
| 22 | Health score awards 10% for non-null defaults | 🟠 Misleading |
| 23 | `/api/shares`: unauthenticated, unrate-limited, service-role writes | 🟠 Dangerous |
| 24 | `handle_new_user` SECURITY DEFINER, anon-executable, mutable search_path | 🟠 Dangerous |
| 25 | `rehype-raw` renders raw HTML from AI output — needs sanitizer review | 🟠 UNVERIFIED risk |

---

## 43. Vision Gap — How far is BankDeMark from the goal?

**Honest answer: the foundation for the described product does not exist. Roughly 85% of the vision must be built new, not extended.**

**What genuinely exists and can be kept:**
- A real content/SEO acquisition engine (91 URLs, 13 calculators)
- A correct, reusable financial math library
- Working auth + RLS discipline
- The right AI architecture (deterministic calculation, LLM explanation)
- Product language and visual hierarchy that already respect "business-owner UX over accountant UX"

**What is superficial:**
- "Financial command center" — a questionnaire with derived ratios
- "Business finance module" — two nullable columns
- "Reports" — four print views over one row
- "Pro" — a Stripe charge with no entitlements

**What must be rebuilt (not extended):**
- The entire financial data model. `financial_snapshots UNIQUE(user_id)` structurally forbids both multi-business and time-series. It cannot be extended into a ledger.
- Every RLS policy (34 of them), once a `businesses` entity sits between `users` and financial rows.

**What can be extended:**
- `lib/command/calculations.ts` → the derived-metrics layer above a real ledger
- The AI context builder → tool-calling
- The `debts` table → a general liabilities register
- The public site → business-model landing pages
- The design system and shell

**Biggest architectural gaps, in order:**
1. No transaction primitive — everything else depends on it
2. No business entity — blocks multi-business, workspaces, accountants, and every RLS policy
3. No migration discipline — already caused 4 production bugs; will cause more
4. No ingestion — without it, manual entry caps the product at hobby scale
5. No audit trail — blocks accountant trust and AI explainability

**Can it become the vision?** Yes — the SEO engine, the math library, and the AI architecture are real assets, and the AI separation-of-concerns is something most competitors get wrong. But the path is *build a new financial core beside the current app*, not *add features to it*.

**"Join BankDeMark, connect or enter your financial life, and understand the finances behind your business growth."** — Today: you can *enter* a personal financial summary and get ratios and AI commentary. You cannot *connect* anything. There is no *business*. There is no *growth* dimension (no time series). Roughly **10-15% of that sentence is delivered.**

---

## 44. P0–P5 Roadmap

Every item: problem → evidence → solution → dependencies → files → DB → security → complexity.

### P0 — FINANCIAL CORRECTNESS / SECURITY *(before any marketing spend or paid signup)*

**P0.1 — Close the Pro privilege-escalation hole** · **XS**
Problem: any user can self-grant Pro. Evidence: §33.1. Solution: `REVOKE UPDATE (plan, pro_plan, stripe_customer_id, stripe_subscription_id) ON public.profiles FROM authenticated, anon;` + re-add `CHECK (plan IN ('free','pro'))`. Deps: none. DB: migration. Security: closes escalation + webhook hijack.

**P0.2 — Stop charging for nothing** · **S**
Problem: $19/$149/$299 grants zero entitlements; "Tax planning mode" doesn't exist. Evidence: §7. Solution: either (a) disable checkout and mark Pro "Coming soon", or (b) ship a real `entitlements` gate and cut every unbuilt claim from the card. Files: `ProUpgradeCard.tsx`, `checkout/route.ts`. Deps: P0.1.

**P0.3 — Adopt migrations; reconcile the four schema drifts** · **S**
Problem: production schema ≠ repo SQL; 4 silent production bugs. Evidence: only 2 tracked migrations, both for `calculator_shares`. Solution: `supabase db pull` → baseline migration → fix `goals`, `ai_usage`, `ai_conversations`, `score_history` → CI check. Files: `supabase/migrations/`. Security: prevents recurrence.

**P0.4 — Stop swallowing errors** · **S**
Problem: every drift bug was hidden by a discarded `await` or bare `catch {}`. Evidence: §35. Solution: destructure `{ error }` on every Supabase call, surface to the user, add an ESLint rule banning empty catch blocks. Files: all of `components/command/`.

**P0.5 — Fix the calculator defects** · **S**
`RegisteredAccountCalculator.js`: fix the `annualContribution` ReferenceError and the `result.futureValue`/`totalContributions` references; unify compounding; add a `TAX_CONSTANTS` module with `{ value, taxYear, source, lastUpdated }` and surface the year in the UI; fix TFSA cumulative room. `MortgageCalculator.js`: branch `monthlyRate` on `isCanada` using `Math.pow(1 + rate/200, 1/6) - 1`; implement or remove the US PMI field.

**P0.6 — Fix lead capture** · **XS**
Replace both `appendFile` routes with the existing `email_leads` table (via service role) or Resend. Files: `app/api/email-leads/route.ts`, `src/app/api/newsletter/route.js`.

**P0.7 — Account deletion + data export** · **M**
PIPEDA. Add a DELETE policy on `profiles`, a cascade-delete edge function, and a JSON/CSV export endpoint.

**P0.8 — Fix the canonical + add robots/sitemap to the app domain** · **XS**
`app/command/page.tsx` canonical → `https://command.bankdemark.com/command`. Add `robots.ts` + `sitemap.ts`.

**P0.9 — Correct the overstated claims** · **S**
Rewrite `/pillars/command` to describe what ships. Remove allocation analysis, Coast/Lean/Fat FIRE, and integration claims. Point the 8 dead affiliate CTAs at real URLs or remove them.

**P0.10 — Supabase advisor cleanup** · **XS**
`SET search_path = ''` on both functions; `REVOKE EXECUTE ON handle_new_user FROM anon, authenticated`; add a `calculator_shares` policy; enable leaked-password protection; rate-limit `/api/shares`.

---

### P1 — CORE COMMAND CENTER *(the real product begins here)*

**P1.1 — Business entity + membership model** · **L**
New: `businesses` (name, type, currency, fiscal_year_start, tax_jurisdiction, accounting_basis, revenue_model), `business_members` (business_id, user_id, role). Rewrite **all 34 RLS policies** to membership checks. Drop `financial_snapshots UNIQUE(user_id)`. Security: this *is* tenant isolation — highest-risk change in the roadmap; needs dedicated cross-tenant tests.

**P1.2 — Accounts + transactions** · **XL**
`accounts` (business_id, name, type, currency, current_balance, balance_as_of, source, last_synced_at) and `transactions` (business_id, account_id, date, amount, currency, description, merchant, category_id, transaction_type, transfer_pair_id, counterparty_id, project_id, receipt_id, source, review_status, ai_confidence, notes, created_by). Indexes on `(business_id, date DESC)`, `(business_id, category_id)`, `(business_id, review_status)`. **Depends on P1.1.**

**P1.3 — Chart of accounts + categories** · **M**
`categories` (business_id nullable for system defaults, name, kind ∈ income/expense/asset/liability/equity, tax_treatment, parent_id). Per-business-model default sets.

**P1.4 — Transfer & double-count safety** · **M**
`transaction_type` ∈ income / expense / transfer / owner_contribution / owner_draw / loan_proceeds / loan_repayment / refund / reimbursement. Auto-match transfer pairs by amount+date+opposite sign. **Exclude non-income types from every revenue aggregate.** Golden-path tests for the transfer and credit-card-payment cases.

**P1.5 — CSV import** · **M**
Cheapest real ingestion. Column mapper, dedup by `(account, date, amount, description)` hash, preview-before-commit.

**P1.6 — Rebuild the dashboard on the ledger** · **L**
Cash, revenue, expenses, profit, uncategorized count, items needing review. Materialized monthly summary table — **do not aggregate raw transactions on page load.**

**P1.7 — Commission / pass-through revenue** · **M**
`gross_amount` + `recognized_amount` on transactions, with a per-business-model default rule. **This is what makes the travel-advisor case correct** and differentiates BankDeMark from every expense tracker.

**P1.8 — Wire the `debts` table to a UI** · **S**
The schema and simulators already exist and are correct. Just build the form.

---

### P2 — AUTOMATION
Bank feeds (Plaid/Flinks — Flinks for Canadian coverage) · Stripe/Shopify/PayPal connectors · receipt upload + OCR + matching (Supabase Storage) · AI categorization with confidence tiers (high→auto, medium→flag, low→ask) and a corrections-learning loop · merchant memory · reconciliation (statement balance, matching, discrepancies) · **audit trail table** (P2.0, should arguably be P1) · freshness (`fetched_at`/`synced_at` surfaced in the UI).

### P3 — TAX / ACCOUNTANT
Versioned `tax_rates` with `{ jurisdiction, effective_date, source, last_updated }` · GST/HST/QST · tax reserve calculation · "Prepare Taxes" readiness checklist (uncategorized, missing receipts, unreconciled accounts, transfer check, duplicate check) with **explicit uncertainty flags** · accountant invite + role · period locking · year-end package · real PDF/CSV/XLSX export.

### P4 — BUSINESS INTELLIGENCE
Projects/clients/cost centers · project profitability · business net worth (assets − liabilities) · cash forecast · P&L / balance sheet / cash flow statements · multi-business portfolio roll-up (aggregate views, **isolated books**) · AI tool-calling (`get_revenue`, `get_profit`, `find_uncategorized`, …) with FACT/CALCULATION/ESTIMATE/SUGGESTION labeling.

### P5 — ADVANCED
Anomaly detection · benchmarking · deeper integrations · automation rules · email-forwarding receipt capture · full observability (Sentry, job status, sync monitoring, admin console).

---

## 45. Quick Wins (< 1 day each, high value)

1. `REVOKE UPDATE` on billing columns — **5 minutes, closes the worst hole**
2. Fix `ai_usage` column names — stops uncapped AI spend
3. Fix `goals` insert payload — makes a shipped feature work
4. Fix `score_history` columns both ways — makes the trend chart work
5. Apply the `ai_conversations` ALTER — restores conversation memory
6. Fix the canonical URL — un-de-indexes the signup page
7. Point lead capture at `email_leads` — stops losing every lead
8. Add `robots.ts` + `sitemap.ts` to the app
9. Remove "Tax planning mode" and the 3 other phantom claims from the pricing card
10. Delete `calcYearsToRetirement` (dead `NaN` function)
11. Fix the RRSP/TFSA `annualContribution` crash
12. Add `taxYear` labels next to the RRSP/TFSA limits
13. Remove the "Pro PDF Export" upsell over a free feature
14. Fix or remove the 8 dead affiliate CTAs
15. Rate-limit `/api/shares`

## 46. Features to NOT Build Yet

Bank feeds (before the transaction model exists) · OCR (before receipt storage) · tax filing (before tax records) · accountant portal (before an audit trail) · multi-currency FX (before single-currency is correct) · forecasting (before historical data) · mobile apps (before the web product works) · investment holdings/allocation (huge scope, low relative value now) · inventory/COGS (until ecommerce is a proven segment) · anomaly detection · benchmarking · Coast/Lean/Fat FIRE variants.

## 47. Recommended Information Architecture

```
bankdemark.com (marketing + SEO)
├── /                      positioning: financial command center for small business
├── /pricing               ← NEW. public, honest, matches enforcement
├── /product/{dashboard|transactions|reports|taxes|ai}
├── /for/{travel-advisors|ecommerce|agencies|saas|freelancers}   ← NEW
├── /calculators/*         keep — this is the acquisition engine
├── /blog/*                keep
└── /pillars/*             keep, rewritten to match reality

command.bankdemark.com (app)
├── /login · /signup
├── /onboarding            business type → currency → jurisdiction → import
├── /b/{businessId}/
│   ├── dashboard · transactions · reports · taxes · ai
│   ├── accounts · settings
├── /portfolio             multi-business roll-up
└── /account               billing · export · delete
```

## 48. Recommended Command Center UX

```
[ Business switcher ▾ ]                        [ Search ]  [ ⚙ ]

  Cash on hand        Money in (MTD)      Money out (MTD)     Profit
  $48,210             $22,400             $14,850             $7,550
  3 accounts · 2h ago  ↑ 12% vs last mo    ↓ 4% vs last mo     34% margin

  ⚠ Needs your attention
     18 transactions need a category      → Review
     4 expenses missing receipts          → Add
     Business chequing not synced in 6 d  → Reconnect

  Where money went (this month)     ┃  Ask BankDeMark
  ▇▇▇▇▇ Contractors     $5,200      ┃  "Why is cash down but revenue up?"
  ▇▇▇   Software        $1,890      ┃  "How much should I set aside for tax?"
  ▇▇    Ads             $1,400      ┃  "Which projects made money?"

  [ P&L ]  [ Prepare taxes ]  [ Accountant package ]  [ Business health ]
```
Principles: freshness on every number · attention queue before charts · one-click actions at the bottom · business-owner language ("Money in," not "Revenue recognized") with correct semantics underneath.

## 49. Recommended Data Model (minimum viable financial core)

```sql
businesses(id, owner_id, name, business_type, revenue_model, currency,
           fiscal_year_start, tax_jurisdiction, accounting_basis, created_at)
business_members(business_id, user_id, role)  -- owner|admin|member|accountant

accounts(id, business_id, name, account_type, currency,
         current_balance, balance_as_of, source, external_id, last_synced_at)

categories(id, business_id NULL, name, kind, tax_treatment, parent_id)
           -- kind: income|expense|asset|liability|equity

transactions(id, business_id, account_id, date, amount, currency,
             description, merchant, category_id, transaction_type,
             gross_amount, recognized_amount,      -- commission/pass-through
             transfer_pair_id, counterparty_id, project_id, receipt_id,
             source, external_id, review_status, ai_confidence, notes,
             created_by, created_at, updated_at)

projects(id, business_id, name, client_id, status)
counterparties(id, business_id, name, kind)       -- vendor|customer
receipts(id, business_id, storage_path, extracted_json, matched_transaction_id)
audit_log(id, business_id, user_id, entity, entity_id, action,
          before_json, after_json, source, created_at)
```
Indexes: `transactions(business_id, date DESC)`, `(business_id, category_id)`, `(business_id, review_status)`, `(business_id, project_id)`, unique `(account_id, external_id)`.
RLS: every table → `EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = t.business_id AND m.user_id = auth.uid())`.

## 50. Recommended Tier Structure

Gate on **scale and automation**, never on financial correctness. A user must always be able to see their true numbers.

| | **Free** | **Starter $19/mo** | **Business $49/mo** |
|---|---|---|---|
| Businesses | 1 | 1 | 5 |
| Transactions | 250/mo | 2,000/mo | Unlimited |
| Connected accounts | 0 (CSV only) | 2 | 10 |
| History | 3 months | 2 years | Unlimited |
| AI questions | 10/mo | 200/mo | Unlimited |
| Reports | P&L, expenses | + all core reports | + custom, project P&L |
| Receipts / OCR | — | 50/mo | Unlimited |
| Tax prep | — | ✓ | ✓ |
| Accountant seat | — | — | ✓ |

**Cost basis** (order-of-magnitude — *UNVERIFIED, no live cost data was available*): bank feeds dominate at roughly $1-3/connected account/month, AI roughly $0.01-0.05/question at current `gpt-4o-mini`-class pricing, storage/OCR marginal. **A $19 tier with unlimited connected accounts would be structurally unprofitable** — hence the account caps above. Retire the $299 lifetime tier: it cannot cover recurring per-account feed costs.

---

## 51. THE ONE NEXT IMPLEMENTATION STEP

Not the ledger. **Stop the bleeding first.**

> ### Milestone: "Trustworthy Foundation"
> Close the billing/security holes, adopt migrations, reconcile the four schema drifts, and stop swallowing errors.

**Why this and not the transaction engine:** building a business ledger on top of a database where any user can grant themselves Pro, where the repo SQL doesn't match production, and where failed writes are invisible means every new feature inherits those defects. This is 1-2 days of work that makes all subsequent work trustworthy. It is also the only item on the list with active legal and financial exposure.

### Implementation prompt

```
BankDeMark Command — P0 "Trustworthy Foundation"

Repo: /Users/jaedendoody/BankDeMark-app
Supabase project: wzgtpygrgehcprxqppia (name: bankdemark)

Ship these seven items. Do not add features. Do not refactor beyond scope.
Verify each against the LIVE database before and after.

1. MIGRATION BASELINE
   Only 2 migrations are tracked (both for calculator_shares) — the entire
   Command schema was hand-applied. Run `supabase db pull` to generate a
   baseline migration matching production exactly. Commit it. Delete or
   clearly mark supabase/bankdemark-command-schema.sql and
   bankdemark-ai-memory-upgrade.sql as historical — they do NOT match prod
   and are the root cause of items 3 and 4.

2. CLOSE THE BILLING PRIVILEGE ESCALATION  (verify first, it is real)
   `authenticated` currently has column-level UPDATE on profiles.plan.
   New migration:
     REVOKE UPDATE (plan, pro_plan, stripe_customer_id, stripe_subscription_id)
       ON public.profiles FROM authenticated, anon;
     ALTER TABLE public.profiles
       ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free','pro'));
   Also: SET search_path = '' on update_updated_at_column and handle_new_user;
   REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
   add an explicit deny-all policy to calculator_shares (service-role only).
   PROVE the fix: attempt `update({plan:'pro'})` as an authenticated user and
   confirm it is now rejected.

3. FIX THE AI RATE LIMITER  (currently non-functional — AI is unlimited)
   app/api/command/coach/route.ts:222-247 queries ai_usage.used_date / .count.
   Live columns are usage_date / message_count. Fix the code to match the DB
   (do not rename the columns). Check the returned { error } on both the select
   and the upsert and log failures. Verify ai_usage rows actually appear after
   a chat message — the table currently has 0 rows despite 58 ai_messages.

4. FIX THE THREE OTHER SCHEMA DRIFTS
   a) goals — GoalsPanel.tsx:186-194 inserts type/target/current/notes/completed.
      Live columns: goal_type/target_amount/current_amount/priority (no notes,
      no completed). Add a migration for the missing columns AND align the code.
      Confirm a goal actually persists.
   b) score_history — writes send health_label (live column is `band`); the
      dashboard reads score, recorded_at (live column is `created_at`).
      Fix OnboardingForm.tsx:217, EditProfilePanel.tsx:150,
      DashboardOverview.tsx:58. Confirm the trend chart populates.
   c) ai_conversations — the route reads/writes summary and
      last_context_summary; neither column exists in production. Apply the
      ALTER from bankdemark-ai-memory-upgrade.sql as a proper migration.

5. STOP SWALLOWING ERRORS
   Every one of the bugs above hid behind a discarded `await` or a bare
   `catch {}`. Across components/command/ and app/api/: destructure { error }
   on every Supabase call, log it, and surface a user-visible message on
   failure. Remove all empty catch blocks (add no-empty to the ESLint config).

6. FIX LEAD CAPTURE  (returns 500 in production — verified live)
   app/api/email-leads/route.ts appendFile()s to process.cwd()/data — the
   Vercel filesystem is read-only. Rewrite to insert into the existing
   public.email_leads table via the service-role client. Apply the identical
   fix to src/app/api/newsletter/route.js in the bankdemark-coming-soon repo.
   Remove the user-facing string "Your email was saved locally in
   data/email-leads.jsonl" from Marketplace.tsx.

7. HONEST BILLING + SEO
   - ProUpgradeCard.tsx: remove every claim with no enforcing code —
     "Tax planning mode", "Advanced scenario simulations", "Couple & family
     dashboard", "Business finance module", "Wealth & debt alerts",
     "Priority support". Remove the "Pro PDF Export" upsell in
     ReportsPanel.tsx:391 (free users already have window.print()).
     Until real entitlements exist, either disable checkout or label Pro
     "Early access — features shipping soon" on the button itself.
   - app/command/page.tsx: canonical currently points to
     https://bankdemark.com/command, which is a 404. Change it to
     https://command.bankdemark.com/command.
   - Add app/robots.ts and app/sitemap.ts (both currently 404 on the app domain).
   - Delete calcYearsToRetirement from lib/command/calculations.ts:305 —
     it returns NaN and is unused.

VERIFICATION (required before you report done)
  - npx tsc --noEmit passes in both repos
  - npx next build passes in both repos
  - Live DB check: ai_usage gains a row after a chat; goals persists a row;
    score_history persists a row and the trend chart renders
  - An authenticated update({plan:'pro'}) is rejected
  - POST /api/newsletter returns 200 and the row lands in email_leads
  - curl the app entry page and confirm the canonical is self-referential

DO NOT: add tables for transactions/businesses, change pricing amounts,
deploy, send customer email, or touch production data beyond the migrations above.
```

---

### Coverage & limits of this audit

**Verified directly:** repository source (both repos), live production Supabase schema/policies/grants/row counts/advisors, live HTTP behavior of both domains, production builds, TypeScript type-checks, live API responses.

**UNVERIFIED — explicitly not tested:**
- Mobile/tablet rendering on real devices or emulators (code patterns inspected only)
- Stripe dashboard configuration: whether price IDs exist, whether the webhook endpoint is registered, whether the account is in live or test mode
- Vercel environment-variable presence and scoping in production
- Load/scale behavior (no data exists to load-test)
- `rehype-raw` XSS surface in AI-rendered markdown
- Backup/restore configuration
- Actual unit economics (no billing or AI cost data was available)
- Analytics/GSC/Ahrefs data (not queried)
