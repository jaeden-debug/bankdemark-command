# Sanitised demo seed — proposal

Written 2026-08-14. **Nothing here has been implemented and no production data
has been touched.** This is the missing piece for product screenshots on the
public marketing pages.

## Why there is nothing to screenshot today

Both applications refuse to show invented figures, which is correct and is also
why there is no screenshot to take:

- `seedStarterAccounts()` (lib/services/businesses.ts) creates two **empty**
  accounts — "Business chequing" and "Business credit card" — when a business is
  created. No transactions, no invoices, no receipts. A new account screenshots
  as a set of zeroes.
- Invoice's `lib/domain/invoice-sample.ts` is real sample data, but it renders
  only inside `InvoiceDesigner.tsx` — the authenticated branding designer. It is
  deliberately never passed to a service and has no id, so it cannot be listed.
- Command's `DemoDashboard` on `/command` is a hand-built marketing
  illustration carrying an explicit "Example data" badge. It is not a screenshot
  of the product and must not be presented as one.
- There is no seed script in either repository.

Screenshotting real books is not an option: they contain client names, invoice
numbers, amounts and email addresses.

## What is needed

A dedicated demo account, seeded once, owned by us, containing nothing that
belongs to a real person or business.

**Account:** one BankDeMark user on an address we control, e.g.
`demo@bankdemark.com`. Not a customer address, not a founder's personal address.

**Business:** a fictional operator. Suggested: *Harbour & Vine Studio*, a
Canadian design studio in Ontario — plausible for GST/HST, plausible for
commission-free invoicing, and obviously not a real client.

**Counterparties:** four fictional clients with fictional domains
(`example.com` / `example.ca` only — those are reserved and can never resolve to
a real business).

### Invoice — to produce the three requested shots

| Shot | Needs |
|---|---|
| Invoice list with mixed statuses | ~8 invoices: 2 draft, 2 issued, 1 sent, 1 viewed, 1 partially paid, 1 paid, 1 overdue (issued with a past due date) |
| Issued invoice / client view | one issued invoice with 3–4 line items, a logo, and a private share link |
| Canadian tax resolved | one invoice to an Ontario client (HST) and one to a Québec client (GST + QST), so the province-driven difference is visible in a single frame |

### Command — to produce the three requested shots

| Shot | Needs |
|---|---|
| Dashboard | ~60 transactions across 3 months: income, expenses, and one matched transfer pair, so cash / money in / money out / profit are all non-zero and the transfer visibly does not inflate revenue |
| Profit & loss | the same three months, with at least two expense categories and one commission booking where booked value ≠ recognised revenue |
| CSV import review | a small CSV (~12 rows) staged at the review step, including two rows that duplicate existing transactions so the duplicate detection is visible |

## How to build it safely

1. Add `scripts/seed-demo.ts`, guarded so it refuses to run unless
   `SEED_DEMO_USER_ID` is set **and** the target business name matches the
   fictional name above. A seed script that can be pointed at any business is a
   data-loss incident waiting to happen.
2. Run it once against the demo user only. Never against a real business id.
3. Capture the screenshots, then leave the account in place so the shots can be
   retaken consistently when the UI changes.
4. Amounts should be unremarkable four-figure sums. Nothing that reads as a
   claim about revenue the product's customers achieve.

## What must not happen

- No screenshot of a real customer's books, redacted or otherwise.
- No hand-edited screenshot showing a feature that does not exist. The public
  pages currently claim only what the code does; an aspirational screenshot
  would be the first thing on them that is not true.
- No seeding into an existing business record.
