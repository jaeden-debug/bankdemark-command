# ZYLX — EMBEDDED FINANCIAL INTELLIGENCE AUDIT

**Date:** 2026-08-08
**Method:** source inspection, live production database probes (rolled back), git history, deployed-route probes.
**No code was modified. No migrations were created.**

> ⚠️ **This audit is a snapshot of a moving target.** `lib/zylx/tools.ts` was modified at **01:07**, minutes before this audit ran, by a concurrent session that added six invoice tools. `components/bdm/BookingList.tsx` changed at 01:06. There is uncommitted invoicing work in the tree (`app/api/invoices/*/pdf`, `*/send`, `app/i/`, `lib/services/invoice-{document,email,public}.ts`). Anything below about tool count or invoice coverage may already be stale.

---

## 1. Executive Summary

Zylx today is a **single-page, non-streaming, text-only chat with 19 read tools and 2 proposal tools over a real financial ledger.**

The thing it gets *right* is the thing hardest to retrofit: **the LLM does not compute financial truth.** `lib/zylx/tools.ts` calls `lib/services/finance.ts`, which calls the deterministic engine in `lib/domain/ledger.ts`, whose semantics are mirrored in SQL and were verified to agree exactly. The architectural principle you called non-negotiable — *Zylx gets intelligence, BankDeMark retains authority* — is **already implemented correctly**. That is the expensive part, and it is done.

Almost everything else in your vision is absent: no vision, no documents, no graphs, no tasks, no planning, no proactive intelligence, no web research, no MCP, no contextual awareness beyond "which business is selected."

There are **three defects that matter more than any missing feature**, detailed in §18.

**Honest position: strong foundations, ~15% of the described product.**

*Re-verified at time of writing: the CRITICAL and HIGH findings in §18 are both still present in the current files.*

---

## 2. Current Architecture — CONFIRMED

```
components/bdm/ZylxChat.tsx        (client, 1 page only)
        │  POST { businessId, message, conversationId }
        ▼
app/api/zylx/chat/route.ts         (274 lines)
        │  requireBusiness() → membership verified server-side
        │  entitlement quota → fails CLOSED
        ▼
lib/zylx/prompt.ts                 (197 lines, static system prompt)
lib/zylx/tools.ts                  (19 tools)
        │  ≤5 sequential tool rounds
        ▼
lib/services/finance.ts → lib/domain/ledger.ts   ← deterministic
        ▼
Postgres (RLS-enforced, user JWT — never service role)
```

**Model:** single provider via `AI_BASE_URL` (OpenAI-compatible), `AI_MODEL` default `gpt-4o-mini`, `temperature: 0.3`, `max_tokens: 1200`. `app/api/zylx/chat/route.ts:167-189`.

**Not present anywhere:** embeddings, vector DB, RAG, summarisation, retries, timeouts, model routing, streaming, structured output beyond tool JSON.

### DEAD / LEGACY — must be removed

| Item | Evidence |
|---|---|
| Second live AI system | `app/api/command/coach/route.ts` + `app/command/coach/page.tsx`, still deployed. Streams, has **no tools**, injects static prose context, operates on the retired `financial_snapshots` model. |
| Prompt-injection vector | Legacy coach reads `ai_user_memory` and frames it as *"VERIFIED long-term memories… override generic assumptions"* (`route.ts:133-135`). Memory is written from raw user text by substring match. The new Zylx route does **not** use it (`grep -c ai_user_memory` → 0). |
| **7 backup files committed to a public repo** | `app/api/command/coach/route.ts.{bak,backup}`, `components/command/{AICoach,CommandNav,CommandShell}.tsx.backup`, `lib/command/aiContext.ts.backup`, `app/globals.css.backup`. **My error** — swept in by `git add -A`. |

---

## 3. Authentication & Tenant Isolation — CONFIRMED CORRECT

`businessId` arrives from the **client**, never from the model, and is independently verified:

```ts
const ctx = await requireBusiness(body.businessId, 'viewer');   // chat/route.ts:47
```

`lib/services/context.ts` resolves membership via `business_members`, checks role rank, then loads the business — all under the user's JWT. RLS is the backstop, not the only gate. **No service-role client is reachable from any Zylx path.**

Write path re-verifies independently: `approve/route.ts:48` calls `requireBusiness(…, 'member')`, then `createTransaction` re-checks the account with `.eq('id', accountId).eq('business_id', ctx.businessId)` (`transactions.ts:156-164`). **A model-supplied account id cannot establish authorization.** ✅

---

## 4. Context Pipeline — PARTIAL, thin

The client sends exactly three fields (`ZylxChat.tsx:60`):
```
{ businessId, message, conversationId }
```

The prompt then adds: business name, type, currency, country, region, tax jurisdiction, accounting basis, fiscal year, commission/pass-through flags, account count, transaction count, booking count, role, today's date, and plan-derived capability flags.

**Absent — every item you listed as contextual awareness:** current page · currently viewed entity · selected date range · locale · user preferences · recent activity · chart being looked at.

> "Why is this categorized this way?" → Zylx has no idea what *this* is.
> "What caused that spike?" → Zylx cannot see the graph.

**Score: 2/10.** The plumbing to fix it is trivial (widen the request body); nothing depends on new infrastructure.

---

## 5-7. Tool Inventory — 19 tools

| Tool | R/W | Deterministic | Confirm | Audit | Working |
|---|---|---|---|---|---|
| `get_business_summary` | R | ✅ | — | — | ✅ |
| `get_revenue` | R | ✅ | — | — | ✅ |
| `get_expenses` | R | ✅ | — | — | ✅ |
| `get_profit` | R | ✅ | — | — | ✅ |
| `get_cash_position` | R | ✅ | — | — | ✅ |
| `compare_periods` | R | ✅ | — | — | ✅ |
| `get_outstanding_commissions` | R | ✅ | — | — | ✅ |
| `get_brand_performance` | R | ✅ | — | — | ✅ |
| `get_project_profitability` | R | ✅ | — | — | ✅ |
| `get_tax_reserve_estimate` | R | ⚠️ ESTIMATE | — | — | ✅ |
| `find_uncategorized` | R | ✅ | — | — | ✅ |
| `find_missing_receipts` | R | ✅ | — | — | ✅ |
| `get_invoice(s)`, `get_outstanding_invoices`, `get_overdue_invoices`, `get_receivables_position` | R | ✅ | — | — | ⚠️ Added 01:07 by concurrent session; prompt guidance confirmed present |
| `propose_transaction` | **Proposal** | n/a | ✅ user | ✅ | ✅ |
| `propose_invoice_draft` | **Proposal** | n/a | ✅ user | ✅ | ✅ Re-validates every line server-side (`approve/route.ts:125-198`); creates a DRAFT only — Zylx cannot issue or send |

**Risk tiering exists but is binary** — `risk: 'read' | 'propose'` (`tools.ts:42`). Your four-tier model (read / low-risk write / financial record change / high-impact) does **not** exist. There is no bulk-operation guard, no delete tool, no idempotency key, no replay protection.

**Missing entire domains:** accounts, transaction search by merchant/text, documents, tasks, goals, budgets, forecasts, net worth, assets, liabilities, investments, audit history, connection status, application help.

> "How much did I spend at Amazon?" — **no tool can answer this.** There is no merchant search. `find_uncategorized` and `find_missing_receipts` are the only row-level tools and neither filters by text.

---

## 8. Write Capability — 2 proposals, correctly gated

`propose_transaction` mutates nothing. It resolves account/category names → ids **server-side** so the model cannot invent an id (`tools.ts:495-520`), returns a proposal, and `app/api/zylx/approve/route.ts` re-validates it as untrusted input before calling the normal service with `actor_type: 'zylx'` in `audit_log`. ✅

**Cannot do:** categorise, reclassify, mark transfer, bulk edit, attach receipt, create task/goal/budget/asset/liability, generate a report, find duplicates.

---

## 9-12. Multimodal, Documents, Graphs, Planning — MISSING

| Capability | State | Evidence |
|---|---|---|
| Vision / images | **0** | No `image_url`, no `input_image`, no upload path in any Zylx file |
| Document intelligence | **0** | `documents` table exists (16 cols); **zero write calls** anywhere |
| OCR / extraction / provenance | **0** | `extraction_method`, `confidence`, `confirmed_by_user` — none exist |
| Graphs from Zylx | **0** | Route returns `{ message: string }`. No chart spec, no structured response envelope. |
| Forecasting | **1** | Only `get_tax_reserve_estimate`, a flat-rate multiplier with disclosed assumptions |
| Planning / goals / milestones | **0** | No `tasks`, `goals`, `plans`, `budgets`, or `milestones` table exists |
| Tasks & reminders | **0** | No table, no service, no notification system |

CSV import exists (`lib/services/imports.ts`) but is **UI-only** — Zylx cannot invoke it. "Here's my statement, import it" is not reachable.

---

## 13. Memory — PARTIAL, with a real defect

Conversation history: last 16 messages, loaded by `conversation_id` (`chat/route.ts:118-124`). No summarisation, so long threads silently truncate.

Durable memory: `ai_user_memory` exists but the **new route does not use it**. Only the legacy coach does — see §18.

🔴 **`ai_conversations` has no `business_id`.** The route validates only ownership:
```ts
.eq('id', conversationId).eq('user_id', ctx.userId)   // chat/route.ts:99-100
```
Detailed as a security finding in §18.

---

## 14-17. Multi-business, Troubleshooting, Web, Studio

**Multi-business: 4/10.** `get_brand_performance` handles brands within one entity correctly (verified: shared overhead is never allocated across brands). But **no tool aggregates across businesses** — "Compare my businesses" and "How am I doing overall?" cannot be answered. `getPortfolio()` exists in `lib/services/businesses.ts` and is **not exposed as a tool**. That is a one-file gap.

**Troubleshooting: 1/10.** No access to app docs, sync status, import status, audit log, or error state.

**Web research: 0/10 — and actively unsafe.** See §18.

**Zylx Studio: 0/10.** `zylx_studio` is an entitlement flag only. No client, no auth, no import.

**MCP: 0/10.** `mcp: true/false` in `entitlements.ts` only. No server, no SDK dependency, no transport, no scope model. Your requirement that users connect ChatGPT/Claude via MCP is **entirely unbuilt.**

---

## 18. SECURITY AUDIT

### 🔴 CRITICAL — Prompt instructs a capability that does not exist

`lib/zylx/prompt.ts:163` tells Zylx, whenever `web_search` is enabled by plan:

> *"For questions about current tax rules, rates, thresholds… use web search and cite the source and its date. Prefer official sources (CRA, Revenu Québec, IRS…)"*

**No tool declares `capability: 'web_search'`. No search tool exists.** Verified: `grep "capability: 'web_search'" lib/zylx/tools.ts` → no match.

On Starter, Business, Pro and **founder** plans, the model is instructed to research current tax rates and cite official sources, with no means of doing so. The most likely failure is a **fabricated tax rate with a fabricated CRA citation** — presented in the confident tone the prompt mandates. In a financial product this is the single worst failure mode available.

**Fix (do not implement yet): remove the RESEARCH block, or set `web_search: false` on every plan until a tool exists.**

### 🔴 HIGH — Cross-business conversation bleed

`ai_conversations` has no `business_id`; the route checks only `user_id`. A conversation started under Blackwater and continued after switching to Zylx replays Blackwater's assistant messages — containing its actual figures — into a prompt whose system context now says Zylx.

Not cross-*tenant* (same user throughout), so no other customer's data is exposed. But "each business keeps separate books, nothing mixes" is the product's core promise, and Zylx can violate it inside one account.

### 🟠 MEDIUM — Cross-business foreign keys accepted (VERIFIED EXPLOITABLE)

`category_id`, `brand_id`, `project_id`, `counterparty_id` are inserted without verifying they belong to the business (`transactions.ts:186`). RLS checks `business_id` only; the FK just requires existence.

Live probe against production (rolled back):
```
XREF_TEST >>> ACCEPTED — business A transaction now references business B category
```
No data is *read* across the boundary, so this is integrity + a weak existence oracle, not a leak. Reachable via `/api/transactions` and `/api/zylx/approve`.

### 🟠 MEDIUM — Legacy coach route: memory poisoning

`app/api/command/coach/route.ts` writes `ai_user_memory` from raw user text by substring match, then re-injects it as *"VERIFIED… override generic assumptions… Prioritize these heavily."* A user can write their own persistent system instructions. Low impact today (that route has no tools) — but it is deployed, and `ai_user_memory` is user-scoped with no business scoping.

### 🟡 LOW
- No idempotency key on `/api/zylx/approve` — a double-submit creates two transactions.
- `MAX_TOOL_ROUNDS = 5` with no wall-clock timeout; a slow provider can hang the request.
- `rehype-raw` renders raw HTML from model output in the legacy `AICoach.tsx` — unreviewed.
- 7 `.backup` files in a public repo (§2).

### ✅ Verified sound
Tenant isolation · no service-role reachable from AI · model-supplied ids cannot authorize · quota fails closed on metering error (`chat/route.ts:81`) · secrets redacted in logs (`errors.ts` `SECRET_KEY` regex) · `wrapUntrusted()` helper exists in `prompt.ts` (currently unused — nothing untrusted flows in yet).

---

## 19-21. Reliability, UX, Capability Tests

**No streaming** in the new route (legacy had it) — a 5-round tool call returns nothing until complete. No retries, no timeout, no cancel. `ZylxChat.tsx` has no stop button, no retry, no edit, no copy.

**UX integration: 2/10.** Zylx exists at exactly one URL. No "Ask Zylx" on a transaction, report, graph, or error.

### Capability test results

| Question | Verdict |
|---|---|
| "How much revenue did I make last month?" | ✅ Fully working |
| "Compare this month to last month." | ✅ Fully working |
| "Which business performed best?" | ❌ Not implemented — no cross-business tool |
| "How much did I spend at Amazon?" | ❌ Not implemented — no merchant search |
| "Explain cash flow vs profit." | ✅ Working (prompt) |
| "What caused this spike?" | ❌ No context |
| "Create a task to review ads Friday." | ❌ No tasks table |
| "Add this receipt." | ❌ No vision, no document write |
| "Analyze this statement." | ❌ Importer not exposed to Zylx |
| "Graph my revenue for 12 months." | ❌ Text only |
| "What happens if revenue grows 10%?" | ❌ No scenario engine |
| "Help me build a 6-month cash reserve." | ❌ No planning |
| "Why doesn't this balance match?" | ❌ No diagnostic access |
| "What's the current CRA mileage rate?" | 🔴 **UNSAFE** — prompt instructs research it cannot perform |

**4 of 14 fully working. 1 unsafe.**

---

## 22. Intelligence Scorecard

| | Score | Evidence |
|---|---:|---|
| Financial accuracy | **9** | SQL↔TS parity verified; LLM never computes |
| Security | **6** | Isolation sound; 1 critical, 1 high, 2 medium |
| General financial knowledge | **7** | Prompt handles it well |
| Financial awareness | **6** | 19 tools over a real ledger |
| Explainability | **5** | Provenance struct exists; not surfaced in UI |
| Tool breadth | **5** | Whole domains missing |
| Reliability | **4** | No streaming/retry/timeout |
| Multi-business | **4** | Brands ✅, cross-business ❌ |
| Cost efficiency | **6** | Tool-based retrieval, no raw dumps |
| Speed | **4** | Up to 5 sequential rounds, no streaming |
| Context awareness | **2** | businessId only |
| Memory | **2** | Conversation only, business-bleed bug |
| Write capability | **2** | 2 proposals |
| UX integration | **2** | One page |
| Troubleshooting | **1** | No app context |
| Forecasting | **1** | Tax estimate only |
| Vision · Documents · Graphs · Planning · Tasks · Proactive · Web · MCP · Studio | **0** | Not built |

**Weighted: ≈2.8/10 against the vision.**

---

## 25. Quick Wins (existing infrastructure, no new tables)

1. **Delete the RESEARCH block from the prompt** — closes the critical finding in minutes.
2. **Expose `getPortfolio()` as `get_portfolio_summary`** — unlocks "compare my businesses" from a function that already exists.
3. **Add `search_transactions`** — `listTransactions()` already supports search/filter/pagination. Unlocks "how much did I spend at Amazon?"
4. **Scope conversations to a business** — add `business_id`, filter history.
5. **Widen the request body** — page, entity id, date range. Unlocks every "this"/"that" question.
6. **Add `categorize_transaction` as a proposal** — `bulkCategorize()` exists and is audited.
7. **Expose the P&L as a tool** — `generateProfitAndLoss()` already returns structured data.
8. **Turn on streaming** — the legacy route already proves the pattern.
9. **Delete the legacy coach route + 7 backup files.**

Items 1-9 are all *wiring*, not new systems. They move Zylx from ~2.8 to roughly 5.5.

---

## 26. Missing Foundations (required before advanced intelligence is safe)

1. **Structured response envelope** — `{ text, charts[], tables[], citations[], proposals[] }`. Without this, graphs and source cards are impossible.
2. **A real risk tier** — read / low-write / financial-record / high-impact, enforced server-side, with idempotency keys.
3. **Document pipeline** — storage bucket, MIME/size validation, extraction, provenance columns (`source_document_id`, `extraction_method`, `confidence`, `confirmed_by_user`). **Nothing about vision or receipts is safe until untrusted document text is fenced** — `wrapUntrusted()` exists and is unused.
4. **Tasks/goals tables** — nothing to write to today.
5. **Per-user provider credentials** — encrypted at rest, server-only, never in prompts. Required before BYO-key or MCP.

---

## 27-29. Maximum Realistic Zylx & Recommended Architecture

With BankDeMark's *existing* engine properly exposed, Zylx could realistically reach **8/10** on financial reasoning without new financial infrastructure — because the ledger, semantics, recognition, brands, commissions, invoices and P&L already exist and are correct. The gap is almost entirely **surface area**, not intelligence.

Keep the current pattern and extend it:

```
Client sends RICH context (business, page, entity, range)
        ▼
Route: authorize → entitlements → build prompt
        ▼
Tools grouped by domain + risk tier
        ▼
Deterministic services (unchanged)
        ▼
Structured envelope: text + charts + tables + citations + proposals
        ▼
UI renders each part natively
```

**Do not** add embeddings/RAG for financial figures — the ledger is structured and queryable; vectors would make exact numbers probabilistic. Reserve embeddings strictly for document *text* search.

**On BYO keys + MCP:** the tool layer is already the right boundary. An MCP server should call the **same** `executeTool()` with a server-established identity — never expose Supabase or accept an LLM-supplied `business_id`. Get §26.5 (encrypted credentials) and §26.2 (risk tiers) in place first, or MCP becomes an unauthenticated write surface.

---

## 30. Implementation Priority

**P0 — correctness & security**
Remove the RESEARCH block · scope conversations to business · verify FK ownership server-side · delete legacy coach + backup files · idempotency on approve.

**P1 — genuinely useful**
Rich context payload · `search_transactions` · `get_portfolio_summary` · P&L tool · `categorize_transaction` proposal · streaming · "Ask Zylx" entry points on transaction/report/dashboard.

**P2 — major intelligence**
Structured response envelope + native chart rendering · risk tiers · tasks/goals tables · document pipeline + vision · scenario engine.

**P3 — proactive**
Deterministic rules engine for anomalies/duplicates/subscriptions · scheduled briefings · reconciliation assistance.

**P4 — optional**
MCP server · Zylx Studio · model routing · per-user BYO keys.

---

## 31. Decisions I need from you

1. **Web research** — remove the prompt block, or build a search tool now? (Currently unsafe either way; removal is one line.)
2. **BYO keys vs managed inference** — changes cost model, entitlements, and whether MCP is even coherent.
3. **The concurrent session.** Someone is editing Zylx *while this audit was being written*. Invoice tools landed in `tools.ts` at 01:07; I noted the system prompt didn't mention invoicing — and by the time I re-verified, `prompt.ts` had also been updated with a full INVOICES section (including a genuinely good rule: never add INVOICED and UNINVOICED receivables together). **That specific finding was stale within minutes.** We should agree who owns Zylx before either of us touches it again.
4. **Legacy `/command/*`** — delete now, or keep serving?

## 32. Recommended Next Step

**Do the P0 list — it is under a day and one item is a fabrication risk in a financial product.** Then decide question 3 before any further Zylx work, because two sessions editing the same tool registry will produce exactly the kind of drift this codebase was just rescued from.
