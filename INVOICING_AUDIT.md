# BANKDEMARK INVOICING AUDIT

**Audit date:** 2026-08-07
**Auditor:** forensic code + live-infrastructure review
**Subjects:**
- `/Users/jaedendoody/Documents/Claude/Projects/BankDeMarkInvoice` — "BankDeMark Invoice Command" v2.0.0
- `/Users/jaedendoody/BankDeMark-app` — "BankDeMark Command" v1.0.0 (financial kernel)

**Evidence standard:** every claim below is traced to a file, a command output, or a live API response. Anything I could not execute is labelled **UNVERIFIED**.

---

## 1. Executive Summary

### What the invoicing app actually is today

**It is a large, unfinished local prototype. It is not a product, and it is not deployed.**

Four independent facts establish this, each verified directly:

| Claim | Evidence |
|---|---|
| **It does not build.** | `npx next build` → `Failed to compile. ./app/api/invoice-command/email/send/route.ts:114:7 Type error: 'reply_to' does not exist in type 'CreateEmailOptions'`. 20+ further `tsc` errors across 12 files. |
| **It has never been connected to a database.** | `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co` and `NEXT_PUBLIC_APP_URL=http://localhost:3000` — placeholders only. |
| **No such database exists.** | Supabase account holds 4 projects: `Stalkr App`, `blackwater aquatics`, `bankdemark`, `zylx.ai`. None contains invoice tables. The `bankdemark` project (`wzgtpygrgehcprxqppia`) has no `invoices` table. |
| **It has never been deployed and is not under version control.** | No `.vercel/` directory. `git remote -v` → `fatal: not a git repository`. Vercel team `team_s4ByU1OwKv0iTfN6TS22fNgF` has 23 projects; none is an invoicing app. There is no `invoice.bankdemark.com`. |

So the premise of the audit brief — "do not assume the invoicing app is production ready because the UI exists" — is correct, and understates it. The UI exists. Nothing behind it has ever run against real data.

### The scale of what was built

79 TypeScript/TSX source files, 1,845 lines of SQL across 8 schema files, 45 API routes, 34 components, 28 pages, plus a React Native mobile app. It reaches for QuickBooks, Xero, Slack, Twilio, WooCommerce, Shopify, PayPal, Plaid, Calendly, Google Drive, invoice **financing** (`lib/invoice-command/financing/underwriting.ts`), a cross-account **client-risk network** (`lib/invoice-command/network/`), an autonomous **AR agent**, and Peppol/UBL **e-invoicing compliance**.

The core — create an invoice, generate a correct PDF, email it, record payment — is materially broken. The perimeter is elaborate. That inversion is the single most important finding about this codebase, more than any individual bug.

### The finding that changes the decision

While auditing, I verified the state of BankDeMark Command. It is the opposite situation:

```
Test Files  2 passed (2)
     Tests  38 passed (38)
npx tsc --noEmit → clean
```

Command has a **live, deployed, migrated financial kernel** (`supabase/migrations/20260808030000_financial_kernel.sql`, 735 lines, applied to project `wzgtpygrgehcprxqppia`) containing: `businesses`, `business_members`, `accounts`, `counterparties`, `projects`, `documents`, `bookings`, `transactions`, `commission_payments`, `audit_log`, `categories`, `import_batches`, `business_monthly_summary` — all with membership-scoped RLS, `REVOKE ALL ... FROM anon`, money stored as `BIGINT` minor units, and an explicit revenue-recognition model that separates `gross_amount_minor` from `recognized_amount_minor`.

**The `bookings` table already models: reference, client, supplier, gross value, commission rate, commission expected, commission received, and a `commission_status` enum of `expected → earned → receivable → partial → received`.**

The travel-advisor commission workflow is already 80% built — in Command, not in the invoicing app. The one missing primitive is the invoice document itself.

### Answer to the hypothesis

**Option C is the right product architecture — and it is validated. But the invoicing codebase is not the shared core, and cannot become it.** The shared core already exists and is running. The correct move is to add invoicing *to the kernel*, then optionally expose a standalone invoicing surface over it. Detail in §19–§20.

---

## 2. Architecture

### Invoicing app

| Layer | Finding |
|---|---|
| Repo | **None.** Not a git repository. No remote, no branch, no history. |
| Deployment | **None.** No `.vercel/`, no matching Vercel project. `vercel.json` declares a daily cron that has never run. |
| Framework | Next.js 15.0.3, React 19, App Router, TypeScript strict |
| Database | Supabase — **placeholder URL, no project provisioned** |
| Auth | Supabase Auth (`lib/supabase/client.ts`, `server.ts`) + magic-link client portal (`app/client/login/page.tsx`) |
| Email | Resend v4 (`lib/invoice-command/mailer.ts`, `app/api/invoice-command/email/send/route.ts`) |
| PDF | **Client-side only** — `jspdf` + `html2canvas` + `react-to-print`; no server rendering, no storage |
| Payments | Stripe v17 (`payments/checkout`), PayPal, Shopify, WooCommerce |
| Banking | Plaid v28 |
| Storage | Supabase Storage buckets **documented as comments only** — never created |
| Jobs | One Vercel cron → `/api/invoice-command/automation/execute` |
| Webhooks | Stripe, PayPal, Shopify, WooCommerce, Calendly inbound; user-defined outbound (`webhook_endpoints`) |
| Analytics | PostHog | Monitoring | Sentry (conditional on DSN) |
| Mobile | Expo/React Native under `mobile/` — dependencies not installed; `tsc` cannot resolve `react-native` |

**Architectural defect (structural, not a bug):** there is **no service layer**. Invoice creation, editing, status changes, and deletion all happen in the browser, writing directly to Supabase via the anon key:

```
app/invoice-command/create/page.tsx        → supabase.from("invoices").insert(...)
app/invoice-command/invoices/[id]/page.tsx → supabase.from("invoices").update({status})
                                           → supabase.from("invoices").delete()
```

No API route creates or updates an invoice. Every business rule — totals, tax, numbering, quotas, status transitions — is enforced only by client-side JavaScript, which a user controls. Consequence: no Zylx, MCP, mobile, or Command surface can reuse a single line of invoice logic without reimplementing it. This is the root cause of most of §21 and all of §32.

### Command app (for comparison)

| Layer | Finding |
|---|---|
| Repo | git, branch `main`, 4 commits |
| Deployment | Vercel `prj_e1tQEWwJCmXOsomS6haarpXRfhvS` (`bank-de-mark-app`) |
| Database | Supabase `wzgtpygrgehcprxqppia`, 26 tables, **all RLS-enabled**, 9 tracked migrations |
| Service layer | `lib/services/{finance,transactions,businesses,audit,entitlements,context,errors}.ts` |
| Domain layer | `lib/domain/{money,ledger,semantics}.ts` — pure, unit-tested |
| Tests | 38 passing (`tests/money.test.ts`, `tests/golden-financial-cases.test.ts`) |
| AI | Zylx — read-only tools + `propose_transaction` → human approval (`app/api/zylx/approve/route.ts`) |

---

## 3. Live Feature Inventory (Phase 2 route audit)

45 API routes, 28 pages. Because nothing is deployed and no database exists, **"really works" is assessed by code path, not by execution — every runtime claim in this table is UNVERIFIED at runtime.**

### Pages

| Route | Class | Auth | Data source | Code-path assessment |
|---|---|---|---|---|
| `/` → `/invoice-command` | PUBLIC | none | static | Marketing/landing. Works. |
| `/invoice-command/dashboard` | DASHBOARD | client-side `getUser()` | direct Supabase | Plausible |
| `/invoice-command/create` | INVOICES | client-side | direct Supabase insert | **Partial** — see §4 |
| `/invoice-command/invoices` | INVOICES | client-side | direct Supabase | Plausible |
| `/invoice-command/invoices/[id]` | INVOICES | client-side | direct Supabase | **Dangerous** — arbitrary status set + hard delete, §17 |
| `/invoice-command/share/[token]` | PUBLIC | none | **service-role** | Works by design; no rate limit |
| `/invoice-command/clients` | CLIENTS | client-side | direct Supabase | Plausible |
| `/invoice-command/templates` | TEMPLATES | client-side | direct Supabase | Cosmetic only, §5 |
| `/invoice-command/settings` | SETTINGS | client-side | direct Supabase | Plausible |
| `/invoice-command/{proposals,contracts,time,reports,team,referrals}` | OTHER | client-side | direct Supabase | Breadth over depth |
| `/invoice-command/{agent,automation,financing,compliance,client-intelligence,bank-sync,integrations}` | OTHER | client-side | mixed | Speculative surface area |
| `/client/login`, `/client/dashboard`, `/client/invoices/[id]` | AUTH/PORTAL | magic link | direct Supabase | `shouldCreateUser:false`; portal RLS not defined for client role — **UNVERIFIED / likely broken** |

**Mobile usability:** the app is Tailwind-responsive throughout. The invoice builder line-item row degrades to `col-span-4 / col-span-4 / col-span-3 / col-span-1` on small screens (`InvoiceBuilder.tsx:377-436`) — cramped but functional, with per-field mobile labels. No horizontal overflow found. This is the **strongest** part of the codebase.

### API routes (selected — full security detail in §13)

| Route | Auth | Verdict |
|---|---|---|
| `ai/invoice-writer`, `ai/followup-writer`, `ai/reminder-writer`, `ai/extract-receipt` | **NONE** | **DANGEROUS** — open AI proxy |
| `automation/execute` (cron) | fail-open | **DANGEROUS** — see §13 |
| `email/send` | ✅ session + `user_id` scope | Correctly scoped, but **BROKEN** — §9 |
| `payments/checkout` | intentionally public via token | No rate limit |
| `stripe/webhook` | ✅ signature verified | **BROKEN** — writes to a nonexistent table, §11 |
| `billing/*`, `developer/keys`, `agent/*` | session | Not exercised |

---

## 4. Invoice Builder (Phase 4)

`components/invoice-command/InvoiceBuilder.tsx` (645 lines) is genuinely well-built as a form. The problems are behind it.

| Field | Status | Evidence |
|---|---|---|
| Invoice number | ⚠️ **PARTIAL** | Editable; auto-generated `PREFIX-YYYY-NNNN`. Counter computed **in the browser** from all existing numbers (`create/page.tsx:78-92`). Race condition — two tabs produce the same number; `UNIQUE(user_id, invoice_number)` turns it into `alert("Error saving invoice")`. `business_profiles.invoice_counter` is never incremented. |
| Issue date / due date | ✅ WORKING | Due date auto-derives from payment terms |
| Client select | ✅ WORKING | Loads from client table, copies name/email/company/address |
| Billing email | ✅ WORKING | |
| Billing address | ⚠️ **PARTIAL** | Collapsed to a **single free-text string** on the invoice (`client_address`), while `clients` stores structured fields. Not usable for tax jurisdiction logic. |
| Business identity | ⚠️ **PARTIAL** | Read-only display of the single business profile. **No multi-business support** — §5. |
| Logo | ✅ WORKING (render) | `business.logo_url` renders in PDF. Upload target bucket **never created**. |
| Currency | ⚠️ **PARTIAL** | 4 hard-coded currencies (`CHECK (currency IN ('CAD','USD','EUR','GBP'))`) |
| Line items | ✅ WORKING | `useFieldArray`, add/remove, description/qty/rate/tax |
| Taxes | ⚠️ **PARTIAL** | Per-line only, 6 fixed types — §12 |
| Subtotal / total | ✅ WORKING | `calculations.ts` is correct, including proportional discount allocation across taxed lines |
| Notes / terms | ✅ WORKING | Collapsed behind "Notes & Terms" |
| Payment terms | ✅ WORKING | |
| Discounts | ⚠️ **PARTIAL** | **Validation bug:** `discount_value: z.number().min(0).max(100)` (`validators.ts:41`) caps *fixed-amount* discounts at 100 — a `$500` fixed discount fails validation. |
| **Custom fields** | ❌ **MISSING** | No mechanism at all. **This is the blocker for the travel-advisor use case** — §6. |
| Memo / reference | ❌ **MISSING** | No structured reference field |
| Deposit / partial | ⚠️ **PARTIAL** | Recorded after the fact; cannot be requested on the invoice |
| Status | ⚠️ **PARTIAL** | Set freely, no transition rules — §10 |

**Money is stored as `NUMERIC(12,2)` and handled in JavaScript as floats** throughout (`calculations.ts` uses `Math.round(v*100)/100`). Command stores money as `BIGINT` minor units with a `MoneyPrecisionError` guard (`lib/domain/money.ts:47`). These two models cannot be reconciled by mapping; one has to be replaced.

---

## 5. Customization (Phase 5)

| Capability | Status |
|---|---|
| Business logo, name, address, email, phone, website, tax number | ✅ WORKING (fields exist and render) |
| Invoice numbering prefix | ✅ WORKING — `CHECK (invoice_prefix ~ '^[A-Z0-9]{1,6}$')` |
| Default terms / notes / currency / payment terms | ✅ WORKING |
| Template style / colours | ⚠️ **COSMETIC ONLY** — `InvoicePDF.tsx:44-46` hard-codes three variants (`clean-light`, `modern-dark`, `pro-slate`) with fixed accent colours. `invoice_templates.config` JSONB is stored but never read. |
| Footer | ❌ **HARD-CODED** — `"Generated by BankDeMark Invoice Command"` is unconditional (`InvoicePDF.tsx:378`). A paying user cannot remove the vendor's name from their own financial document. `PLAN_LIMITS.free.branding = false` implies this was meant to be gated; it is not. |
| Payment instructions | ❌ **MISSING** — no bank/e-transfer/wire block |
| Language | ❌ **MISSING** — `next-intl` is a dependency; no locale files exist |
| **Custom fields** | ❌ **MISSING** |
| **Multiple businesses** | ❌ **STRUCTURALLY BLOCKED** — see below |

### Multi-business: not blocked by schema, blocked by code

The schema *permits* many businesses per user (`business_profiles.user_id` is a plain FK, not unique) and `invoices.business_profile_id` exists. But:

1. `create/page.tsx:57` calls `.select("*").eq("user_id", user.id).single()` — `.single()` **throws** if a user has two business profiles. Every consumer does this.
2. `share/[token]/page.tsx:56` loads the business by `.eq("user_id", invoice.user_id).single()` — it **ignores `invoice.business_profile_id` entirely**. A historical invoice's "From" block always renders whatever the user's current business profile happens to be.
3. Every other table (`clients`, `invoices`, `service_catalog`, `expenses`, `time_entries`) is scoped to `user_id`, not `business_id`. Clients cannot be separated per business.

**Verdict: the invoicing data model is single-business-per-user in practice.** Command's kernel is multi-business with role-based membership from the ground up. This is the single largest model incompatibility.

---

## 6. Travel Advisor Test (Phase 6)

Test invoice (constructed and traced through the code — **not sent**):

```
Agency:            Example Host Agency
Booking reference: ABC123
Traveller:         Jane Smith
Supplier:          Example Resort
Travel dates:      Sept 18–25
Gross booking:     $6,000
Commission rate:   10%
Commission owed:   $600
```

### Can the app represent this?

| Requirement | Result |
|---|---|
| Invoice the agency for $600 | ✅ Yes. `client = Example Host Agency`, one line item, `qty 1 × $600`, tax `none`, total `$600.00`. `calcInvoiceTotals` returns exactly `600`. |
| **Gross $6,000 referenced but NOT counted as revenue** | ⚠️ **Only by typing it into the notes field as prose.** There is no structured place for it. |
| Booking reference as a field | ❌ **NO.** Must be embedded in the line description or notes. |
| Traveller / supplier / travel dates as fields | ❌ **NO.** Same. |
| Commission rate as a field | ❌ **NO.** |
| Invoice total = $600 | ✅ Yes |
| Tax configurable | ✅ Yes — set line tax to `none` |
| Professional PDF | ⚠️ Yes, client-side only, with the BankDeMark footer |
| Agency receives clear email | ❌ **NO — the email is broken.** See §9. |

### The elegant answer, and why the app can't give it

The correct representation is: **an invoice line of $600 that carries structured references to a $6,000 booking, without the $6,000 ever entering revenue.** The invoicing app has no concept of a booking, no custom fields, and no gross-vs-recognized distinction. Everything contextual becomes unstructured prose in a `notes TEXT` column — invisible to reporting, to search, and to Zylx.

**Command's kernel already solves exactly this**, and did so deliberately:

```sql
-- 20260808030000_financial_kernel.sql
gross_amount_minor      BIGINT,   -- headline value (e.g. a $6,000 booking)
recognized_amount_minor BIGINT,   -- what enters P&L (e.g. the $600 commission)
```
```sql
CREATE TABLE public.bookings (
  reference TEXT, client_id UUID, supplier_id UUID,
  gross_value_minor BIGINT, commission_rate NUMERIC(7,4),
  commission_expected_minor BIGINT, commission_received_minor BIGINT,
  commission_status public.commission_state  -- expected→earned→receivable→partial→received
);
```

The header comment on that migration names the exact scenario: *"a $6,000 booking"* recognizing *"the $600 commission"*.

**Conclusion: the invoicing app cannot support the golden path elegantly. Command already can, except for the invoice document itself.**

---

## 7. General Business Tests (Phase 7)

| Model | Verdict |
|---|---|
| Agency — project invoice $5,000 | ✅ Works. No project linkage; profitability impossible. |
| Freelancer — 10 h × $150 | ✅ Works. `time_entries` exists with an `invoiced` flag. |
| Consultant — retainer $2,500/mo | ⚠️ `recurring_invoices` table exists; `RecurringInvoiceManager.tsx` exists; **no generation job** — the only cron runs reminders. Recurring invoices are never created. |
| SaaS / manual B2B — annual $1,200 | ✅ Works |
| Contractor — materials + labour | ✅ Works. Different tax treatment per line is supported. |

**One invoice engine can serve all of these.** The line-item + tax + totals model is genuinely general-purpose. What it lacks is *structured extensibility* — the one thing that would let travel, construction, and legal each attach their own domain context. Custom fields are not a nice-to-have; they are what makes an invoice engine horizontal.

---

## 8. PDF (Phase 8)

`components/invoice-command/InvoicePDF.tsx` (390 lines).

| Aspect | Finding |
|---|---|
| Engine | **Client-side browser only** — `html2canvas` rasterises the DOM, `jspdf` wraps the bitmap |
| Typography | Inline styles, `210mm × 297mm` A4 page |
| Page breaks | ❌ **NO HANDLING.** `html2canvas` produces one tall image. A 20-line invoice will be squashed or clipped. |
| Logo quality | ⚠️ Rasterised at screen DPI |
| Long descriptions | ⚠️ No wrap/overflow control |
| Multi-page | ❌ **BROKEN** |
| Totals / taxes / footer | ✅ Correct, recomputed via `calcInvoiceTotals` |
| Print quality | ⚠️ Bitmap, not vector — text is not selectable or searchable |
| Mobile download | ⚠️ `html2canvas` on mobile Safari is unreliable — **UNVERIFIED** |
| **PDF persistence** | ❌ **NONE.** No storage bucket, no `pdf_url` column. |

### The immutability question — answered, and the answer is bad

> *If business details change later, does an old invoice regenerate with NEW details?*

**Yes. Every time.** This is the most serious correctness defect in the application.

The PDF is regenerated on demand from **live joins**:

```tsx
// InvoicePDF.tsx — recomputes from current form/DB state, every render
const totals = calcInvoiceTotals(invoice.items.map(...), ...);
```
```tsx
// share/[token]/page.tsx:56 — loads the CURRENT business profile
.from("business_profiles").select(...).eq("user_id", invoice.user_id).single()
```

Nothing is snapshotted at issuance:

| Snapshotted at issue time? | |
|---|---|
| Business identity (name, address, tax number, logo) | ❌ NO — re-read live, and via `user_id`, not even `business_profile_id` |
| Client identity | ❌ NO — `client_id` FK is `ON DELETE SET NULL`; deleting a client blanks the historical invoice |
| Line items | ✅ Yes (rows persist) — but freely editable with no trail |
| Tax rates | ❌ NO — rate stored per line, but recomputed on render |
| Totals | ⚠️ Stored, then **recomputed and displayed** — the displayed total can silently diverge from the stored one |
| Terms | ❌ NO |

**Practical consequence:** an advisor issues Invoice BDM-2026-0001, the agency pays it, six months later the advisor changes their business address or GST number — and the archived invoice, the shared link, and any regenerated PDF now show the *new* details on a *historical* financial document. For a tax-relevant record this is not a bug, it is a compliance failure. **DANGEROUS.**

---

## 9. Email (Phase 9)

Two send paths exist. Both are defective.

### Path A — `app/api/invoice-command/email/send/route.ts` (the primary, user-triggered path)

**Bug 1 — the invoice email shows the wrong amount.** Lines 96 and 103:

```ts
total: formatCurrency(invoice.total, currency as "CAD"),
subject: `Invoice ${n} from ${b} — ${formatCurrency(invoice.total, ...)} ...`
```

`invoice.total` **does not exist**. The column is `total_amount` (`bankdemark-invoice-command-schema.sql:161`). `formatCurrency(undefined)` → `Intl.NumberFormat.format(undefined)` → `"$NaN"`.

**Every invoice email would be sent with a subject line and body reading `$NaN`.** The reminder branch correctly uses `invoice.balance_due`; only the primary "send invoice" path is broken.

**Bug 2 — this route does not compile.** Line 114 uses `reply_to` where Resend v4 requires `replyTo`. This is the error that fails `next build`. So Path A is simultaneously the reason the app cannot deploy *and* the path that would send wrong amounts if it did.

### Path B — `lib/invoice-command/mailer.ts` (webhook/cron path)

Correct: uses `invoice.total_amount`, uses `replyTo`. Compiles. Only reachable from the cron and webhooks.

### Delivery audit

| Item | Status |
|---|---|
| Provider | Resend v4 |
| Sender identity | `${businessName} <${RESEND_FROM_EMAIL ?? "invoices@resend.dev"}>` — falls back to a **shared Resend sandbox domain**. No SPF/DKIM/DMARC alignment for the business ⇒ spam folder. |
| Reply-To | Path A: **silently dropped**. Path B: correct. |
| Template | `email/templates.ts` — clean HTML |
| PDF attachment | ❌ **NONE.** Link only. |
| Delivery tracking | ❌ Resend `emailId` is returned to the caller and **discarded**. Not stored. |
| Bounce handling | ❌ **NONE.** No Resend webhook. A bounced invoice is indistinguishable from a delivered one. |
| Resend | ⚠️ Possible; `email_reminder_count` incremented |
| Duplicate-send prevention | ❌ **NONE.** Clicking send twice sends twice. |

**No test send was performed** — there is no configured Resend key, no database, and sending to any external address would be an outward-facing action. Runtime behaviour is **UNVERIFIED**; the defects above are static-analysis certainties.

---

## 10. Status Model (Phase 10)

Defined (`invoices.status` CHECK): `draft, sent, viewed, paid, partially_paid, overdue, cancelled`. Against the target lifecycle, `VOID` is missing (`cancelled` is the nearest, with no semantics attached).

| Transition | How it happens | Verdict |
|---|---|---|
| → `sent` | `email/send` route (`.eq("status","draft")` guard — good) **or** the builder's "Save & Mark Sent" button, which marks it sent **without sending anything** | ⚠️ misleading |
| → `viewed` | `share/[token]/page.tsx:76` on public view | ✅ correct |
| → `paid` / `partially_paid` | DB trigger `update_invoice_paid_amount()` on `invoice_payments` | ✅ **well-designed** |
| → `overdue` | ❌ **NOTHING SETS IT.** No job, no trigger, no computed column. `isOverdue()` exists in `calculations.ts` but is only used for badge display. | ❌ **BROKEN** |
| → any, arbitrarily | `invoices/[id]/page.tsx:313` renders buttons for all 6 statuses; `handleStatusChange` writes any of them directly | ❌ **DANGEROUS** |

Two consequences worth naming:

1. **`overdue` is dead.** The dashboard's `total_overdue`, `OverdueAlerts.tsx`, the `invoice_overdue` automation trigger, and the `invoice_dashboard_summary` view all filter on `status = 'overdue'` — a value nothing ever assigns. **The entire overdue-reminder feature set cannot fire.**
2. **A user can mark an invoice `paid` with no payment record**, which desynchronises `status` from `paid_amount`/`balance_due` permanently, because the reconciling trigger only fires on `invoice_payments` changes.

**Payment tracking is manual.** Stated honestly: yes, and the manual path is the *better-built* of the two.

---

## 11. Payments (Phase 11)

### Manual — ✅ the best-engineered part of the schema

`invoice_payments` + the `update_invoice_paid_amount()` trigger correctly recomputes `paid_amount`, `balance_due`, `status`, and `paid_at` from `SUM(amount)` on INSERT/UPDATE/DELETE. Partial payments, outstanding balance, payment date, method, and notes all work. Derived, not hand-typed — the right design.

One flaw: the trigger's `ELSE v_new_status := 'sent'` branch means deleting the last payment on a *draft* invoice silently promotes it to `sent`.

### Online (Stripe) — ❌ BROKEN, and it loses money

`app/api/invoice-command/stripe/webhook/route.ts:36`:

```ts
await supabase.from("payments").insert({
  invoice_id, user_id, amount, payment_date,
  payment_method: "stripe", reference: session.payment_intent, notes: ...
});
```

**There is no `payments` table.** The table is `invoice_payments`. The columns `payment_method` and `reference` do not exist either (they are `method` and there is no `reference`). The insert fails; the error is not checked; the webhook returns 200.

**Failure mode: the customer's card is charged, Stripe reports success, and BankDeMark records nothing.** The invoice stays `sent`, `balance_due` unchanged, and the overdue automation — if it worked — would chase a client who has already paid.

The same nonexistent-table write appears in `shopify/webhook/route.ts:277` and `shopify/import/route.ts:217`.

**Idempotency: none.** No `stripe_events` table, no event-ID dedupe. A Stripe retry would double-record (once the table exists).

**Reconciliation with bank feed:** `bank_transactions.matched_invoice_id` exists as a column. No matching logic anywhere in `plaid/sync/route.ts`.

### On whether online payments are needed for V1

The brief's instinct is right, and the evidence supports it. For the travel-advisor case the agency pays by EFT/cheque on its own AP cycle — card payment is irrelevant, and a 2.9% + 30¢ fee on a $600 commission is $17.70 the advisor would simply refuse. The valuable loop is:

```
invoice agency → agency pays externally → bank feed imports +$600 → BankDeMark matches → PAID
```

Command already has the bank feed, the transaction primitive, and `commission_payments`. **Recommendation: drop Stripe invoice payments from V1 entirely.** It is the highest-risk, highest-cost, lowest-value component in the app.

---

## 12. Tax (Phase 12/13)

| Capability | Status |
|---|---|
| Per-line tax | ✅ WORKING |
| Multiple rates on one invoice | ✅ WORKING — `calcInvoiceTotals` aggregates by `type:rate` into `taxLines[]`. Correct. |
| Invoice-wide tax | ❌ MISSING |
| Tax-inclusive pricing | ⚠️ `calcTaxAmount(…, inclusive)` and `extractTaxFromInclusive()` exist in `taxes.ts` — **never called**. Dead code. |
| GST / HST / PST / QST / VAT | ⚠️ Present as an enum; rates are **hard-coded constants** |
| Zero-rated vs exempt | ❌ MISSING — both collapse to `none`. These are legally distinct and appear differently on a GST/HST return. |

### The rates are hard-coded in three places and they disagree

```ts
// InvoiceBuilder.tsx:105 — what the UI fills in
const TAX_RATE_MAP = { GST: 0.05, HST: 0.13, PST: 0.07, QST: 0.09975, VAT: 0.2 };
```

`HST: 0.13` is Ontario. Nova Scotia is 15%, Newfoundland 15%, PEI 15%, New Brunswick 15%. **A Nova Scotia user gets a silently wrong 13% by default** — and the builder's default line item is pre-set to `tax_type: "HST", tax_rate: 0.13` for every new invoice regardless of province. `constants.CANADIAN_TAXES` holds a separate province table that the builder never consults. `VAT: 0.2` is UK-only.

Against the brief's standard — every rate should carry *jurisdiction, effective date, source, last updated* — **none of these four dimensions exists anywhere.** There is no effective-dating, so a rate change would retroactively alter historical invoices (compounding §8).

Separately, `calculations.ts:estimateIncomeTax()` hard-codes 2023 federal brackets and applies them as if federal-only, then labels the output "federal + provincial estimate". It is wrong for every province and stale by three tax years. It is displayed on the dashboard.

**The app has become a tax authority by accident, and it is an inaccurate one.** The brief says it never should. Agreed — rates must be data, jurisdiction-scoped and effective-dated, with the user able to override.

---

## 13. Security (Phase 21)

### 🔴 CRITICAL — Public RLS policy exposes every shared invoice to the internet

`bankdemark-invoice-command-schema.sql:395-397`:

```sql
CREATE POLICY "Public can read invoices by share_token"
  ON public.invoices FOR SELECT
  USING (share_token IS NOT NULL);
```

This does **not** check that the requester knows the token. It grants the `anon` role `SELECT` on **every row where a token exists**. Since `create/page.tsx:107` assigns a `share_token` to *every* invoice at creation, this is **every invoice in the system**.

With only the public anon key — which ships in the browser bundle by design — anyone can run:

```
GET /rest/v1/invoices?select=*        → every invoice, every user
GET /rest/v1/invoice_items?select=*   → every line item
```

Exposed: client names, emails, addresses, amounts, payment status, business tax numbers, and `stripe_payment_link_url`. The identical flaw is repeated for `proposals`, `proposal_items` (`USING (TRUE)`), and `contracts`.

Worse — `v2-schema.sql:141-143`:

```sql
CREATE POLICY "Public can update contract signature" ON public.contracts
  FOR UPDATE USING (share_token IS NOT NULL) WITH CHECK (TRUE);
```

**Any anonymous user can UPDATE any field of any contract**, including `body`, `signed_at`, `signature_name`, and `signature_ip`. Signed legal agreements are anonymously rewritable.

*Correct pattern, for reference:* keep tokens out of RLS entirely — do token lookups server-side with the service role (which `share/[token]/page.tsx` already does correctly) and grant `anon` nothing. Command does exactly this: `REVOKE ALL ON public.<table> FROM anon` for all 13 kernel tables.

### 🔴 CRITICAL — Unauthenticated AI endpoints

`app/api/invoice-command/ai/invoice-writer/route.ts` (and `followup-writer`, `reminder-writer`, `extract-receipt`) read `req.json()` and call OpenAI. **No `getUser()`, no session check, no rate limit, no quota.** Once deployed, these are open public proxies to the owner's OpenAI key — unbounded cost, and a free LLM for anyone who finds the URL.

`PLAN_LIMITS.free.ai_generations = 3` is defined and **never enforced anywhere**.

### 🔴 HIGH — Cron endpoint fails open

`automation/execute/route.ts:15-18`:

```ts
const secret = process.env.CRON_SECRET;
if (secret && authHeader !== `Bearer ${secret}`) return 401;
```

If `CRON_SECRET` is unset — as it is in the current env — the guard is skipped and `GET` is public. Anyone can trigger `runDailyAutomations()` repeatedly, **sending reminder emails to every client of every user, on demand**. Reputational and deliverability damage, from an unauthenticated GET.

### Remaining findings

| Area | Finding |
|---|---|
| Auth | Supabase Auth is sound; **all authorization is client-side** — every page checks `getUser()` in `useEffect`, which is a UX gate, not a security boundary. Actual enforcement rests entirely on the RLS above. |
| IDOR | Mitigated for owner-scoped tables by `auth.uid() = user_id`; **totally defeated** by the public-read policies. |
| Multi-business isolation | N/A — no multi-business support |
| Public link tokens | 96-bit, `uuidv4()`-derived — unpredictable and **not enumerable**. This part is fine; the RLS makes the token irrelevant. |
| Signed URLs | ❌ None; storage never configured |
| Email injection | ⚠️ Client-supplied `customMessage` is interpolated into HTML in `reminderEmailHtml` with no escaping |
| HTML/XSS | ⚠️ Same vector; invoice notes/terms render into the public share page |
| File uploads | N/A — never wired |
| Webhooks | Stripe signature ✅ verified. **No replay/idempotency protection.** |
| CSRF | Low risk (JSON APIs, `SameSite` cookies) |
| Rate limits | ❌ **None anywhere** — not on AI, not on public checkout, not on the share page |
| Secrets | ✅ Correctly server-side; `.env.local` holds only placeholders |
| Audit logs | ❌ None — §14 |
| Security headers | ✅ Present in `next.config.js` — but that file is **shadowed by `next.config.ts`, which Next.js loads instead.** The headers never apply. |

**Overall: not safe to expose to the internet in its current state.** Three of these are exploitable by an anonymous party with no credentials.

---

## 14. Audit Trail (Phase 19)

**There is none.**

No `invoice_events`, no `audit_log`, no history table. Not one of created / edited / sent / viewed / paid / voided / resent / deleted is recorded with actor, timestamp, before, after, or source.

What partial signals exist: `invoice_views` (anonymous view pings), `viewed_at`, `paid_at`, `email_sent_at`, `email_reminder_count`, `automation_logs` (rule runs only).

Combined with §17, this means: **a sent invoice's amounts can be edited, or the invoice hard-deleted, leaving no trace whatsoever.**

Command, by contrast, ships `audit_log` with `actor_type ∈ (user, zylx, mcp, system, import, integration, stripe)`, `before`/`after` JSONB, `request_id`, `REVOKE UPDATE, DELETE ... FROM authenticated, anon` (append-only), and a `diffRecords()` helper in `lib/services/audit.ts`. Every write in `lib/services/transactions.ts` records one.

---

## 15. UX / Mobile (Phase 20)

**The best part of the application.** Assessed by code inspection; **UNVERIFIED** at runtime (the app does not build).

| Surface | Assessment |
|---|---|
| Dashboard | Card grid, `grid-cols-1 md:grid-cols-*`. Sound. |
| Invoice list | `InvoiceTable.tsx` responsive |
| **Invoice builder** | ✅ **Good.** Sections stack cleanly; line items degrade to a 4/4/3/1 grid with per-field mobile labels; totals panel is `max-w-sm ml-auto`. |
| Client picker | Native `<select>` — best mobile choice |
| Line-item entry | ⚠️ Tightest point: qty/price/tax in ~4 columns on a 375px screen |
| Preview | Full-screen overlay |
| Send modal | ⚠️ Modal-in-overlay nesting on the detail page |
| Print preview | ⚠️ Fixed `210mm` width forces horizontal scroll on mobile |
| Horizontal overflow | None found outside the PDF preview |
| Accessibility | ⚠️ `<label>` elements are not associated with inputs via `htmlFor`/`id` |

---

## 16. Reliability & Observability (Phases 23, 15)

Can an admin answer these? Evidence-based:

| Question | Answer |
|---|---|
| Why wasn't this invoice sent? | ❌ No. Resend `emailId` discarded; no send log. |
| Why is it overdue? | ❌ No — nothing ever sets `overdue`. |
| Why didn't payment status update? | ❌ No. The Stripe webhook's failed insert is unchecked and returns 200. Silent. |
| Did the customer open it? | ⚠️ Partially — `invoice_views` records page loads (not email opens). |
| Why is the PDF wrong? | ❌ No. Nothing is persisted; there is no artifact to inspect. |

Sentry is wired conditionally; PostHog is client-side product analytics. Neither substitutes for a domain event log.

**Reliability score is anchored by one fact: it does not compile.** Everything downstream is theoretical.

---

## 17. Numbering, Immutability, Credit Notes (Phases 17, 18)

| Requirement | Status |
|---|---|
| No duplicates | ⚠️ `UNIQUE(user_id, invoice_number)` — enforced, but surfaced as a raw `alert()` |
| No accidental reuse | ⚠️ Counter derived client-side from existing numbers; `invoice_counter` never incremented |
| No race conditions | ❌ **RACE EXISTS** — two tabs compute the same next number |
| Custom prefixes (`INV-2026-001`) | ✅ Supported |
| Sent invoices immutable | ❌ **NO.** `handleStatusChange` and the edit path write freely at any status. |
| Void | ❌ Missing (`cancelled` exists with no semantics) |
| Cancel | ⚠️ Status only |
| **Credit note** | ❌ **MISSING ENTIRELY** — no table, no concept |
| Revised invoice | ❌ Missing |
| Audit trail | ❌ Missing |
| **Hard delete** | ❌ **DANGEROUS** — `invoices/[id]/page.tsx:107` `supabase.from("invoices").delete()`. `ON DELETE CASCADE` takes items, payments, and views with it. A sent, paid, tax-relevant invoice can be erased with one click and no record. |

The brief says *"avoid silently rewriting historical invoices."* The app does exactly that, and additionally permits silently destroying them.

---

## 18. Multi-currency & Client Directory (Phases 14, 15)

**Currency:** 4 hard-coded codes in a `CHECK` constraint; `formatCurrency` uses `Intl` correctly; **no base currency**, **no FX conversion**, **no FX rate storage**. The dashboard `invoice_dashboard_summary` view does `SUM(total_amount)` **across all currencies with no grouping** — a user with CAD and USD invoices sees a meaningless added-together number presented as revenue. Per the brief's rule (*"do not fabricate converted accounting values"*), this **already fabricates one**. Command's `business_monthly_summary` correctly has `currency` in its primary key.

**Clients:** ✅ Reusable, with name, company, contact, email, phone, structured address, country, tax number, notes, `total_invoiced`/`total_paid` rollups. Missing: default currency, default payment terms, multiple contacts, separate billing vs shipping address. `total_invoiced` is incremented client-side (`create/page.tsx:180`) with a read-then-write race and is never decremented — it will drift permanently.

**Should it share Command's counterparty model?** Yes. `counterparties` (`kind ∈ customer|vendor|supplier|other`, business-scoped) is the same entity with better scoping, and it already backs `bookings.client_id` and `bookings.supplier_id`.

---

## 19. Standalone vs Command Analysis (Phases 25–28)

### Data-model overlap

| Invoicing concept | Command kernel | Verdict |
|---|---|---|
| `business_profiles` | `businesses` + `business_members` | **Duplicate.** Command's is multi-business, role-scoped, currency/fiscal/jurisdiction aware. Command wins decisively. |
| `clients` | `counterparties` | **Duplicate.** Command's is business-scoped. Command wins. |
| `invoices` | *(none)* — nearest: `bookings` + AR | **GENUINE GAP.** The one thing invoicing has that the kernel lacks. |
| `invoice_items` | *(none)* | **GAP** — should carry `category_id` + `project_id` for revenue classification |
| `invoice_payments` | `transactions` + `commission_payments` | **Duplicate.** Command's is the real ledger. Command wins. |
| Invoice → revenue | `transactions.recognized_amount_minor` | Command wins — handles gross-vs-recognized, which invoicing cannot express at all |
| PDF | `documents` (`doc_type ∈ …'invoice'…`) | **Command already has the slot.** Invoicing has no persistence. |
| Invoice audit event | `audit_log` | Command wins; invoicing has nothing |
| Templates / branding | *(none)* | **GAP** — genuinely belongs to an invoicing module |
| `profiles.plan` (free/pro/lifetime) | `entitlements.ts` (free/starter/business/pro/founder) | **Duplicate.** Command's is a real, enforced entitlement service. |
| Stripe billing | `lib/stripe.ts` + `app/api/webhooks/stripe` | **Duplicate.** |

**Net: of ~11 overlapping concepts, Command has the better implementation of 9, and the remaining 2 (the invoice document, and templates/branding) do not exist in Command yet.**

### Option A — Keep completely separate

Advantages: independent SEO/positioning; invoicing-only customers; simpler onboarding; modular.
Disadvantages: duplicate businesses, clients, auth, billing, financial records; the user must manually re-enter every invoice payment into Command; two RLS models to keep correct; two entitlement systems; Zylx cannot see invoices.

**Score: 3/10.** The disadvantages are the exact failure modes the Command kernel was built to eliminate. Also: the standalone codebase would have to be fixed *and* rebuilt on a correct data model anyway — you pay the rebuild cost with none of the integration payoff.

### Option B — Merge into Command as a native module

Advantages: one business identity, one client list, invoice→receivable→payment→revenue in one ledger, Zylx understands invoices, project profitability includes billed revenue, one auth/billing/entitlement model, one audit trail.
Disadvantages: larger Command scope; no standalone acquisition funnel; a user who *only* wants invoicing must adopt a financial OS.

**Score: 8/10.** Architecturally correct. Weak only on go-to-market.

### Option C — Shared core + standalone surface

`invoice.bankdemark.com` as a focused invoicing UI, `command.bankdemark.com` as the full OS, both over the same kernel: same auth, businesses, counterparties, invoices, receivables, audit trail, entitlements, service layer.

Advantages: all of B, plus an independent acquisition funnel and a natural upgrade path (invoice-only user already has a `businesses` row and a real ledger the day they upgrade). "Invoicing" becomes a high-intent, low-friction top-of-funnel for a financial OS.
Disadvantages: two deployment surfaces; shared-service versioning discipline; some duplicated shell/nav code.

**Score: 9/10 — with one condition.**

**The condition:** Option C only works if "the shared core" means *Command's kernel*, extended with invoices. If it meant "make the existing invoicing app the shared core," it would fail, because that codebase is single-business, float-money, client-side-authorized, unaudited, and publicly readable. Those are not bugs to fix; they are the model.

The good news is that the cost difference between B and C is small: both require the same kernel work (§20 P0–P2). C adds only a second Next.js surface over the same services — deferrable until the module works inside Command.

---

## 20. Recommended Architecture

# → **OPTION C**, executed as B-then-C.

**Your hypothesis is validated as a product architecture and rejected as a code-reuse plan.**

Build invoicing as a **first-class module of the BankDeMark financial kernel**. Ship it inside Command first. Once the invoice service layer, PDF pipeline, and send flow are correct and in production, stand up `invoice.bankdemark.com` as a second, thinner UI over the identical services.

Treat the existing invoicing repository as a **design reference and salvage source, not a foundation.**

### Why, across each dimension the brief asks for

**User experience.** The advisor lives in one place. A booking becomes a commission receivable, becomes an invoice, becomes a matched bank payment, becomes recognised revenue — without re-typing the agency's name into a second product. Option A guarantees they type it twice and reconcile by hand.

**Code architecture.** Command already has the layering invoicing lacks: `domain/` (pure, tested) → `services/` (authorized, audited) → `api/` → UI. Invoicing has UI → database. Adding `lib/services/invoices.ts` alongside `transactions.ts` costs one file and inherits `requireBusiness()`, `recordAudit()`, `checkQuota()`, `ServiceError`, and money-precision guarantees for free. Keeping them separate means reimplementing all five.

**Database.** One Supabase project, one RLS model (`is_business_member()`), one migration history. Invoices become kernel tables with `business_id`, joining `counterparties`, `projects`, `bookings`, `documents`, and `transactions` by foreign key. The alternative is two databases with two `clients` tables that drift apart on day one.

**Billing.** One Stripe customer, one `profiles.plan`, one `entitlements.ts`. Invoicing becomes capabilities (`invoices_per_month`, `invoice_branding`, `invoice_send`) in the table that already exists. Two products means two subscriptions and the impossible question of what a customer of both should pay.

**SEO.** This is Option C's whole advantage over B, and it is real. "Free invoice generator" is a large, high-intent, low-trust-barrier query. `invoice.bankdemark.com` can own that funnel with its own landing page, schema, and sitemap while `command.bankdemark.com` targets bookkeeping/financial-OS intent. Two distinct entities, one backend, no duplicate content — provided the invoicing surface is genuinely a different product page and not a mirror of Command's marketing.

**Operational complexity.** Two Vercel projects, one database, one service layer, one on-call surface. Materially simpler than two full stacks. Sequencing B-then-C means you carry *zero* extra operational cost until the module is proven.

**Long-term strategy.** BankDeMark's defensible position is being the system of record where every financial event — bank transaction, booking, commission, invoice, receivable — lives in one auditable ledger that Zylx can reason over. An invoice that is not a receivable in that ledger is a PDF generator, and PDF generators are a commodity. Invoicing's strategic value is precisely that it is the *origination point* of receivables. Separating it discards the only thing that makes it worth building.

### What to salvage from the invoicing repo

Genuinely reusable: `InvoicePDF.tsx` layout and typography; `email/templates.ts`; the totals algorithm in `calculations.ts` (the proportional discount-across-tax-lines logic is correct — port it to integer minor units); `constants.ts` Canadian tax tables (as seed data, then effective-date them); the `InvoiceBuilder.tsx` responsive form structure; the numbering format; the UBL/Peppol exploration as future reference.

Do not carry over: the schema, the RLS, the client-side write paths, the status model, the Stripe integration, the plan-limit constants, the financing/network/AR-agent subsystems.

---

## 21. Pricing / Tier Recommendation

No prices — Command's `entitlements.ts` already sets the structure, and invoicing should extend it rather than invent one.

**Structural recommendations, evidence-based:**

1. **Add capabilities, not a plan.** `invoices_per_month`, `invoice_send` (email delivery), `invoice_branding` (remove the BankDeMark footer), `invoice_templates`. These slot into the existing `Capability` union.

2. **Honour the rule already written in `entitlements.ts:13`:** *"financial correctness is never gated."* Applied to invoicing: **reading, exporting, and PDF-regenerating historical invoices must never be gated, and must survive downgrade.** A user who drops to Free must still be able to retrieve every invoice they ever issued. Gate *creation* and *sending*, never *access to the record*. This is a legal/tax obligation, not a pricing choice.

3. **Free gets a real, small quota** (a handful of invoices/month) — the acquisition funnel requires the product to actually work unpaid. Note the current app defines `PLAN_LIMITS.free.invoices = 5` and enforces it **nowhere**; whatever number you choose must be enforced in the service layer.

4. **Where the real cost sits** (§ below) is email and PDF, not invoice rows. Gate `invoice_send` before gating invoice count.

5. **Business/Pro tier** is where the integration story lives: invoicing + Zylx draft creation + receivable matching + automated bank reconciliation. That bundle is Command-only and is the reason to upgrade from the standalone surface.

### Cost basis (Phase 24)

| Cost | Estimate |
|---|---|
| Email (Resend) | ~$0.0004/email at volume. Cheap, but **domain verification per sending business** is the real cost — operationally, not financially. |
| PDF rendering | **$0 today** (client-side). Server-side rendering (required for attachments + immutable archives) means a headless-Chrome function: ~200–500ms and ~512MB per invoice. This is the one genuinely metered cost. |
| Storage | Negligible (~100KB/PDF) |
| Payment processing | 2.9% + 30¢ — **avoidable entirely by dropping Stripe invoice payments (§11)** |
| AI | Metered; already gated by `ai_messages_per_month` in Command |
| Infrastructure | Marginal on existing Vercel + Supabase |

**Conclusion: invoicing is not expensive enough to justify its own top tier.** It justifies capability gating on *sending* and *branding*, and belongs in paid plans as a value driver, not as a cost-recovery gate.

---

## 22. Production Readiness Scorecard

| Dimension | Score | Basis |
|---|---:|---|
| Architecture | **25** | No service layer, no repo, no deployment, client-side authorization |
| Invoice creation | **55** | Form is good; numbering races; no custom fields; discount validation bug |
| Customization | **40** | Identity fields yes; templates cosmetic; footer unremovable; no payment instructions |
| Client management | **50** | Good schema; drift-prone rollups; single-business scoping |
| PDF generation | **45** | Layout good; bitmap; no multi-page; no persistence; **no issuance snapshot** |
| Email delivery | **20** | `$NaN` amounts; does not compile; no tracking, bounces, or dedupe |
| Status tracking | **40** | Payment trigger good; `overdue` never set; arbitrary transitions |
| Payment tracking | **35** | Manual excellent; online silently loses payments |
| Tax handling | **30** | Multi-rate aggregation correct; rates hard-coded, province-wrong, undated |
| Multi-currency | **25** | Display fine; **cross-currency summing presented as revenue** |
| Security | **10** | Anonymous read of all invoices; anonymous contract rewrite; open AI proxy; fail-open cron |
| Audit trail | **5** | None. `invoice_views` only. |
| Responsive UX | **55** | Genuinely competent — the best dimension |
| Reliability | **10** | **Does not compile** |
| Observability | **20** | Sentry/PostHog wired; zero domain events |
| BankDeMark integration readiness | **15** | Model conflicts on money, tenancy, and authorization |
| Zylx integration readiness | **10** | No callable service layer to expose as tools |
| Standalone product readiness | **20** | Not deployable, not safe, core send path broken |

### **Overall: 28 / 100 — Prototype. Not production-ready. Not safe to deploy.**

---

## 23. Working Well

- `calcInvoiceTotals()` — multi-rate tax aggregation with proportional discount allocation. Correct, and worth porting.
- `update_invoice_paid_amount()` trigger — derived `paid_amount`/`balance_due`/`status`. The right pattern.
- Responsive UI throughout; the invoice builder is mobile-usable.
- `InvoicePDF.tsx` visual design — professional and clean.
- Share-token entropy (96-bit, non-enumerable).
- Zod schemas at form boundaries.
- Clean module separation in `lib/invoice-command/`.
- Correct owner-scoped RLS on the *non-public* tables.
- `share/[token]/page.tsx` correctly uses the service role for token lookup — the right pattern, undermined by the RLS policy sitting next to it.

## 24. Missing

- Custom fields / structured references *(blocks the golden path)*
- Credit notes, void, revised invoices
- Audit trail
- Invoice PDF persistence and issuance snapshot
- Multi-business support (in practice)
- Bounce/delivery tracking; duplicate-send prevention
- Payment instructions block; removable branding
- Effective-dated, jurisdiction-scoped tax rates
- Base currency and FX handling
- CSV/data export (UBL XML exists; no invoice or client CSV)
- Recurring invoice generation job
- Server-side quota enforcement
- Rate limiting anywhere
- Any invoice service layer / reusable API

## 25. Broken / Dangerous

| # | Finding | Class |
|---|---|---|
| 1 | `USING (share_token IS NOT NULL)` → anonymous read of **all** invoices + items | **DANGEROUS** |
| 2 | `Public can update contract signature ... WITH CHECK (TRUE)` → anonymous rewrite of signed contracts | **DANGEROUS** |
| 3 | AI routes have no auth or rate limit → open OpenAI proxy | **DANGEROUS** |
| 4 | Cron guard fails open when `CRON_SECRET` unset → anyone can mass-email all clients | **DANGEROUS** |
| 5 | Stripe webhook writes to nonexistent `payments` table → card payments silently lost | **DANGEROUS** |
| 6 | Historical invoices re-render with *current* business/client details | **DANGEROUS** |
| 7 | Hard `DELETE` of invoices, cascading items + payments, no trail | **DANGEROUS** |
| 8 | `next build` fails (`reply_to` vs `replyTo`) | **BROKEN** |
| 9 | Invoice email sends `$NaN` (`invoice.total` does not exist) | **BROKEN** |
| 10 | Nothing ever sets `overdue` → all overdue features are dead | **BROKEN** |
| 11 | Dashboard sums mixed currencies into one "revenue" figure | **BROKEN** |
| 12 | `HST 0.13` default for all provinces (wrong for NS/NL/PE/NB) | **BROKEN** |
| 13 | Arbitrary status changes; `paid` without a payment record | **BROKEN** |
| 14 | Invoice-number race between concurrent sessions | **BROKEN** |
| 15 | Fixed discounts capped at 100 by Zod | **BROKEN** |
| 16 | `next.config.js` (with security headers) shadowed by `next.config.ts` | **BROKEN** |
| 17 | `clients.total_invoiced` read-then-write race, never decremented | **BROKEN** |
| 18 | Recurring invoices never generate | **BROKEN** |
| 19 | Payment-trigger `ELSE 'sent'` promotes drafts on payment deletion | **BROKEN** |
| 20 | `estimateIncomeTax()` uses stale 2023 federal-only brackets, labelled "federal + provincial" | **DANGEROUS** (financial advice) |

**UNVERIFIED** (could not execute — no build, no database, no deployment): all runtime behaviour; actual email deliverability; PDF output on real devices; client-portal RLS; mobile app; every third-party integration (QuickBooks, Xero, Slack, Twilio, WooCommerce, Shopify, PayPal, Plaid, Calendly); financing and network-intelligence subsystems.

---

## 26. P0–P5 Roadmap

Every item: problem → evidence → recommendation → complexity → dependencies → files → DB → risk.

### P0 — Invoice correctness & security *(do these before anything else touches production)*

**P0.1 — Do not deploy the invoicing app. Ever, in its current form.**
Evidence: §13 findings 1–4. Recommendation: treat the repo as read-only reference. Complexity: trivial. Risk of ignoring: anonymous exposure of all client PII and amounts.

**P0.2 — Model invoices as kernel entities.**
Problem: no invoice primitive in the kernel. Evidence: `list_tables` on `wzgtpygrgehcprxqppia` — no `invoices`. Recommendation: new migration adding `invoices`, `invoice_lines`, `invoice_events`; `BIGINT` minor units; `business_id` scoping; `is_business_member()` RLS; `REVOKE ALL FROM anon`; snapshot columns (`issued_business_snapshot JSONB`, `issued_client_snapshot JSONB`) frozen at issue. Complexity: **M**. Depends on: nothing. Files: `supabase/migrations/2026…_invoices.sql`, `lib/db/database.types.ts`. Risk: getting the snapshot boundary wrong — mitigate with a DB trigger blocking mutation of financial fields once `issued_at IS NOT NULL`.

**P0.3 — Server-side invoice numbering.**
Problem: client-side counter races (§17). Recommendation: Postgres function `bdm_next_invoice_number(business_id)` using `UPDATE … RETURNING` on a per-business counter row. Complexity: **S**. Depends: P0.2. Risk: none if done in-transaction.

**P0.4 — Invoice service layer.**
Problem: no reusable, authorized write path (§2). Recommendation: `lib/services/invoices.ts` mirroring `transactions.ts` — `requireBusiness()`, `checkQuota()`, `recordAudit()`, `ServiceError`. Complexity: **M**. Depends: P0.2, P0.3. Files: `lib/services/invoices.ts`, `app/api/invoices/route.ts`. Risk: low — the pattern is established.

**P0.5 — Immutability + audit on issue.**
Problem: §8, §14, §17. Recommendation: `draft → issued` freezes snapshots and financial fields; corrections happen via credit note or revision, never in place; every action writes `audit_log`. Complexity: **M**. Depends: P0.2, P0.4. Risk: user friction editing a sent invoice — mitigate with an explicit "revise" flow.

**P0.6 — Port the totals engine to integer money.**
Problem: float money vs `BIGINT` kernel. Recommendation: port `calcInvoiceTotals` to minor units, add golden tests in `tests/`. Complexity: **S**. Depends: `lib/domain/money.ts`. Risk: rounding drift — mitigate by extending `tests/golden-financial-cases.test.ts`.

### P1 — Production invoice basics

**P1.1 — Custom fields.** *(Unblocks travel advisor.)* `invoices.custom_fields JSONB` + per-business field definitions; render in PDF. Complexity: **M**. Depends: P0.2.
**P1.2 — Server-side PDF + `documents` persistence.** Vector PDF (React-PDF or headless Chrome), stored once at issue, `doc_type='invoice'`. Kills §8 entirely. Complexity: **L**. Depends: P0.5.
**P1.3 — Email send with delivery tracking.** Reuse Command's send path; store Resend `emailId`; add a Resend webhook for bounce/delivered; dedupe sends. Complexity: **M**. Depends: P1.2.
**P1.4 — Status lifecycle + overdue job.** `draft/issued/sent/viewed/partially_paid/paid/overdue/void`; enforce transitions in the service; nightly overdue sweep. Complexity: **S**. Depends: P0.4.
**P1.5 — Effective-dated tax rates.** `tax_rates(jurisdiction, code, rate, effective_from, effective_to, source, updated_at)`; user-overridable; invoices store the resolved rate. Complexity: **M**.
**P1.6 — Credit notes & void.** Complexity: **M**. Depends: P0.5.
**P1.7 — Export.** Invoice CSV, client CSV, PDF bundle; never gated. Complexity: **S**.
**P1.8 — Branding controls.** Removable footer, payment-instructions block, template config actually read. Complexity: **S**.

### P2 — Shared core

**P2.1 — Entitlement capabilities** for invoicing in `entitlements.ts`, enforced in the service. **S**.
**P2.2 — Unify clients onto `counterparties`.** **S** (nothing to migrate — zero live rows).
**P2.3 — Invoice → receivable.** Issue creates a receivable position; payment resolves it via `transactions`. **M**.
**P2.4 — Public invoice view over the service role**, tokens never in RLS. **S**.

### P3 — Command integration

**P3.1 — Invoices in Command navigation.** **S**.
**P3.2 — Booking → invoice.** "Invoice this commission" from a booking; prefills agency, reference, gross, rate, amount. **M**. *This is the golden path.*
**P3.3 — Revenue classification** — `invoice_lines.category_id` + `project_id` flow into P&L and project profitability. **M**.
**P3.4 — Invoicing in reports and tax workspace.** **M**.

### P4 — Zylx invoice workflows

**P4.1 — Read tools:** `get_invoices`, `get_invoice`, `get_outstanding_invoices`, `get_overdue_invoices`, `get_client_invoice_history`. **S** — the tool pattern exists in `lib/zylx/tools.ts`.
**P4.2 — `propose_invoice_draft`** following the existing propose→approve gate. **M**. Depends: P0.4, `app/api/zylx/approve/route.ts`.
**P4.3 — Never auto-send.** Sending stays a human action with explicit approval scope. **S**. *Non-negotiable.*

### P5 — Payment & reconciliation automation

**P5.1 — Bank-feed matching** (+$600 → invoice → commission receivable). **L**.
**P5.2 — Reconciliation review queue.** **M**.
**P5.3 — Standalone `invoice.bankdemark.com`** over the same services. **L**. Depends: P0–P3 complete.
**P5.4 — MCP tools** `invoice.read` / `invoice.draft` / `invoice.send` / `invoice.payment.write`, send requiring elevated scope, never raw DB. **M**.

---

## 27. TravelDesign Future Golden Path

```
BOOKING            bookings: ref ABC123, client Example Host Agency,
                   supplier Example Resort, gross_value_minor 600000 CAD,
                   commission_rate 0.10, service_date 2026-09-18
                   → EXISTS TODAY ✅
        ↓
COMMISSION         commission_expected_minor 60000
                   commission_status 'receivable'
                   → EXISTS TODAY ✅
        ↓
INVOICE            invoices: business→agency, booking_id→ABC123,
                   line "Travel booking commission — Booking ABC123" $600.00,
                   custom_fields { traveller, supplier, travel_dates,
                                   gross_booking 6000.00, rate 10% }
                   issued_business_snapshot / issued_client_snapshot frozen
                   → MISSING — this is P0.2 + P1.1  ⛔
        ↓
SEND               server PDF → documents(doc_type='invoice') → Resend
                   → delivery + bounce tracked, audit_log entry
                   → MISSING — P1.2 + P1.3  ⛔
        ↓
PAYMENT            agency pays $600 by EFT
        ↓
BANK MATCH         bank feed imports +$600 → matched to invoice
                   → transactions: kind 'commission',
                     gross_amount_minor 600000, recognized_amount_minor 60000,
                     booking_id ABC123
                   → commission_payments row → trigger sets
                     bookings.commission_status = 'received'
                   → PRIMITIVES EXIST ✅ / matching logic MISSING — P5.1  ⛔
        ↓
REVENUE            recognized revenue += $600.  Gross $6,000 recorded,
                   never counted as revenue. Exactly what the brief asked for.
                   → EXISTS TODAY ✅
        ↓
REPORTING          business_monthly_summary, P&L, outstanding commissions,
                   project profitability — all currency-scoped
                   → EXISTS TODAY ✅
```

**Five of eight stages already work in Command. Three are missing, and all three are invoicing.** That is the whole gap, and it is why this belongs in the kernel rather than in a separate product.

---

## 28. ONE NEXT STEP

> ### Make the invoice a first-class entity of the BankDeMark financial kernel.
>
> One migration adding `invoices`, `invoice_lines`, and `invoice_events`, plus `lib/services/invoices.ts` — integer money, `business_id`-scoped RLS with no `anon` grant, server-side atomic numbering, issuance snapshots of business and client identity, immutable financial fields once issued, `booking_id` and `project_id` linkage, `custom_fields JSONB`, and an `audit_log` entry on every write.
>
> **Not** the UI. **Not** email. **Not** PDF. **Not** the standalone surface.

**Why this one:** it is the only item every other item depends on — P1 through P5, the golden path, the Zylx tools, and the standalone surface all sit on top of it. It is the single missing primitive between "Command tracks commissions" and "Command invoices for them." It is testable in isolation against the existing 38-test suite. And it decides, correctly and permanently, the two questions the old app got wrong: money precision and identity immutability.

---

## 29. EXACT NEXT CLAUDE PROMPT

```
Add invoices to the BankDeMark financial kernel as first-class entities.

Work in /Users/jaedendoody/BankDeMark-app only. Do not copy code from
the BankDeMarkInvoice project — it is single-business, uses float money,
authorizes in the browser, and exposes all invoices to anon via RLS.
Follow the patterns already in this repo.

READ FIRST
  supabase/migrations/20260808030000_financial_kernel.sql
  supabase/migrations/20260808031000_kernel_function_hardening.sql
  lib/domain/money.ts, lib/domain/semantics.ts
  lib/services/transactions.ts, audit.ts, context.ts, entitlements.ts, errors.ts
  tests/golden-financial-cases.test.ts

PART 1 — MIGRATION  supabase/migrations/<ts>_invoices.sql

  invoices
    id, business_id → businesses ON DELETE CASCADE
    counterparty_id → counterparties ON DELETE RESTRICT   -- never orphan a
                                                          -- historical invoice
    booking_id  → bookings   ON DELETE SET NULL
    project_id  → projects   ON DELETE SET NULL
    document_id → documents  ON DELETE SET NULL           -- issued PDF, later
    number TEXT NOT NULL, currency CHAR(3) NOT NULL
    issue_date DATE, due_date DATE
    status: draft|issued|sent|viewed|partially_paid|paid|overdue|void
    ALL money as BIGINT minor units:
      subtotal_minor, discount_minor, tax_minor, total_minor,
      paid_minor, balance_minor
    discount_kind ('percentage'|'fixed'), discount_value NUMERIC(10,4)
    notes, terms, payment_terms, payment_instructions TEXT
    custom_fields JSONB NOT NULL DEFAULT '{}'
    issued_business_snapshot JSONB   -- frozen identity at issue
    issued_client_snapshot   JSONB
    issued_at, sent_at, viewed_at, paid_at, voided_at TIMESTAMPTZ
    source public.data_source, created_by, created_at, updated_at
    UNIQUE (business_id, number)
    CHECK (total_minor >= 0), CHECK (balance_minor >= 0)

  invoice_lines
    id, invoice_id ON DELETE CASCADE, business_id (denormalised for RLS)
    position INT, description TEXT NOT NULL
    quantity NUMERIC(14,4) NOT NULL DEFAULT 1
    unit_price_minor BIGINT NOT NULL
    tax_code TEXT, tax_rate NUMERIC(7,5) NOT NULL DEFAULT 0
    tax_minor BIGINT, subtotal_minor BIGINT, total_minor BIGINT
    category_id → categories ON DELETE SET NULL   -- revenue classification
    project_id  → projects   ON DELETE SET NULL

  invoice_events  (append-only)
    id BIGSERIAL, invoice_id, business_id, actor_user_id,
    actor_type (reuse audit_log's CHECK list),
    event ('created'|'issued'|'sent'|'viewed'|'payment_recorded'|
           'voided'|'revised'|'resent'|'email_failed'),
    detail JSONB, created_at
    REVOKE UPDATE, DELETE FROM authenticated, anon

  FUNCTION bdm_next_invoice_number(p_business_id UUID) RETURNS TEXT
    Atomic per-business counter (UPDATE ... RETURNING in-transaction).
    Format: <PREFIX>-<YYYY>-<NNNN>, prefix from a per-business setting,
    default 'INV'. Must be race-free under concurrent callers.

  TRIGGER bdm_guard_issued_invoice() BEFORE UPDATE ON invoices
    Once issued_at IS NOT NULL, RAISE EXCEPTION on any change to:
      number, currency, issue_date, subtotal_minor, discount_minor,
      tax_minor, total_minor, counterparty_id,
      issued_business_snapshot, issued_client_snapshot
    Allow: status, paid_minor, balance_minor, sent_at, viewed_at,
           paid_at, voided_at, document_id, notes-free fields.
    Corrections happen via void + revision, never in place.
    Add an equivalent guard on invoice_lines for issued invoices.

  RLS — copy the kernel's generic pattern exactly:
    select   → is_business_member(business_id,'viewer')
    insert   → is_business_member(business_id,'member')
    update   → is_business_member(business_id,'member')
    delete   → is_business_member(business_id,'member')   [drafts only —
               enforce "issued invoices are never deleted" in the service]
    REVOKE ALL ON invoices, invoice_lines, invoice_events FROM anon;
    Never write an RLS policy that keys off a share token.

  Apply the migration to project wzgtpygrgehcprxqppia and regenerate
  lib/db/database.types.ts.

PART 2 — DOMAIN  lib/domain/invoice.ts

  Port the totals algorithm from
  BankDeMarkInvoice/lib/invoice-command/calculations.ts to integer
  minor units. Preserve its correct behaviour: discount applied to the
  subtotal, then allocated proportionally across lines before per-line
  tax; taxes aggregated by (tax_code, rate) into tax lines.

  computeInvoiceTotals(lines, discountKind, discountValue, currency)
    → { subtotalMinor, discountMinor, taxLines[], taxMinor, totalMinor }

  Pure, no I/O. Use parseMajorToMinor / applyRate / sumMinor from
  lib/domain/money.ts. Never use floats. Rounding: round half away from
  zero at each tax line; the sum of tax lines must equal taxMinor exactly.

PART 3 — SERVICE  lib/services/invoices.ts

  Mirror lib/services/transactions.ts precisely — same imports, error
  handling, and audit style.

    createInvoice(ctx, input)      -- draft; number assigned at issue
    updateInvoice(ctx, id, patch)  -- drafts only; ServiceError otherwise
    issueInvoice(ctx, id)          -- assigns number via
                                      bdm_next_invoice_number, freezes
                                      both snapshots, sets issued_at,
                                      status → 'issued'
    voidInvoice(ctx, id, reason)
    recordInvoicePayment(ctx, id, {amountMinor, receivedOn, method, notes})
                                   -- recomputes paid/balance/status
    listInvoices(ctx, filters)
    getInvoice(ctx, id)

  Every function: requireBusiness(businessId, 'member') for writes,
  'viewer' for reads; recordAudit() with before/after via diffRecords();
  an invoice_events row; ServiceError for all failures. Enforce a new
  'invoices_per_month' capability through checkQuota().

  Add 'invoices_per_month', 'invoice_send', and 'invoice_branding' to
  the Capability union in lib/services/entitlements.ts and give every
  plan a value. Reading and exporting existing invoices must NEVER be
  gated and must survive a downgrade.

PART 4 — TESTS  tests/invoice-totals.test.ts

  Extend the existing golden-case style. Must cover:
   - Travel advisor: one line, qty 1 × $600.00, no tax → total exactly
     60000 minor. custom_fields carries gross_booking 600000 and
     rate 0.10, and NEITHER enters any total.
   - Freelancer: 10 × $150.00 + 13% HST → 150000 subtotal, 19500 tax,
     169500 total.
   - Contractor: mixed taxable materials + non-taxable labour.
   - $500.00 FIXED discount on a $2,000.00 invoice (the old app's Zod
     schema capped fixed discounts at 100 — prove that is gone).
   - 10% discount across two lines at different tax rates: proportional
     allocation, and sum(taxLines) === taxMinor exactly.
   - Rounding: three lines at $0.335 each — no drift, no float artifacts.

  Then run: npx vitest run  and  npx tsc --noEmit
  Both must be clean before you report done.

OUT OF SCOPE for this milestone — do not build:
  UI, PDF generation, email sending, Stripe payments, the standalone
  invoice.bankdemark.com surface, Zylx tools, MCP tools.

Report back with: the migration path, the service API surface, test
results, and anything in the kernel you had to touch to make this fit.
```

---

## Answers to the Definition of Success

1. **Can it create a professional custom invoice today?** No — it does not build, and if it did, the send path emails `$NaN`.
2. **Can it support a travel advisor invoicing an agency for commission?** Only as unstructured prose. No booking reference, supplier, travel-date, or gross-value fields. Not elegantly.
3. **Can it support arbitrary SMB invoicing?** The line-item engine is genuinely general-purpose. Everything around it is not.
4. **Do PDF / email / status / payment actually work?** PDF: partially, client-side, non-immutable, no persistence. Email: broken. Status: `overdue` is dead; transitions are unguarded. Payment: manual works well; online silently loses money.
5. **Is it safe for real financial documents?** No. Anonymous read of every invoice, anonymous rewrite of signed contracts, no audit trail, and historical invoices that mutate.
6. **What is salvageable?** The totals algorithm, the PDF layout, email templates, tax constants as seed data, the responsive form structure. Roughly 15% of the codebase, as reference rather than as dependency.
7. **Which models overlap the kernel?** Nine of eleven concepts duplicate Command, which has the better implementation of all nine. Only the invoice document and template/branding config are genuinely new.
8. **Should it remain standalone?** As a *surface*, eventually yes. As a *system*, no.
9. **Should it be bundled into a premium tier?** As capabilities within the existing plans — not as its own tier. Access to historical invoices must never be gated.
10. **Can both happen on one shared core?** Yes — and the shared core already exists and is deployed. It is Command's kernel, not the invoicing app.
11. **How should Zylx create/manage drafts?** Through the existing `propose_transaction` → `/api/zylx/approve` pattern: propose a draft, the human reviews, the human sends. Zylx must never send an invoice.
12. **Shortest path to booking → commission → invoice → payment → bank match → reporting?** Five of the eight stages already work. Add the invoice entity to the kernel (§28), then booking→invoice (P3.2), then bank matching (P5.1).
```
