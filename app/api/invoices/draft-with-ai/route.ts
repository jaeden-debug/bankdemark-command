// ============================================================
// DRAFT AN INVOICE FROM NATURAL LANGUAGE
//
// "Invoice Lisa Travel Design $1,500 for website work, plus tax, due
//  in 14 days."
//
// The model's ONLY job is to turn prose into structured intent. It
// never computes a total, never picks a tax rate from memory, and
// never writes to the database. Amounts are parsed with the money
// domain, tax comes from the business's configured rates, totals come
// from the invoice kernel, and the result is a DRAFT the user edits
// and issues themselves.
//
// The platform's AI key is used — a customer never supplies one.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireBusiness } from '@/lib/services/context';
import { ServiceError, logError, logEvent, toServiceError } from '@/lib/services/errors';
import { consumeUsage, releaseUsage } from '@/lib/services/access';
import {
  createInvoice,
  listTaxRates,
  getInvoiceSettings,
  type TaxRateOption,
} from '@/lib/services/invoices';
import { listCounterparties, createCounterparty } from '@/lib/services/counterparties';
import { parseMajorToMinor } from '@/lib/domain/money';
import { dueDateFor } from '@/lib/domain/invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

interface AiDraft {
  client_name?: string;
  create_client_if_missing?: boolean;
  lines?: Array<{
    description?: string;
    quantity?: number;
    unit_price_major?: number;
    taxable?: boolean;
  }>;
  due_in_days?: number;
  notes?: string;
  needs_clarification?: string;
}

const SYSTEM = `You convert a business owner's plain-English request into a structured invoice draft.

Rules:
- Extract ONLY what the user actually said. Never invent line items, amounts or clients.
- unit_price_major is the price for ONE unit, in dollars. For "5 hours at $125/hour": quantity 5, unit_price_major 125.
- For a single lump sum like "$1,500 for website work": quantity 1, unit_price_major 1500.
- taxable: true only if the user asked for tax ("plus tax", "with HST"). Otherwise false.
- due_in_days: only if stated ("due in 14 days", "net 30"). Otherwise omit it.
- Do NOT compute totals or tax amounts. The application does that.
- If the request is too vague to draft (no amount, or no idea what is being billed), set needs_clarification to a short question and omit lines.

Return JSON only.`;

const SCHEMA = {
  type: 'object',
  properties: {
    client_name: { type: 'string' },
    create_client_if_missing: { type: 'boolean' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit_price_major: { type: 'number' },
          taxable: { type: 'boolean' },
        },
        required: ['description', 'quantity', 'unit_price_major', 'taxable'],
        additionalProperties: false,
      },
    },
    due_in_days: { type: 'number' },
    notes: { type: 'string' },
    needs_clarification: { type: 'string' },
  },
  additionalProperties: false,
} as const;

/** The business's default taxable rate today, or none configured. */
function defaultTaxRate(rates: TaxRateOption[], preferredCode: string | null): TaxRateOption | null {
  if (preferredCode) {
    const preferred = rates.find((r) => r.code === preferredCode && r.rate > 0);
    if (preferred) return preferred;
  }
  return rates.find((r) => r.treatment === 'standard' && r.rate > 0) ?? null;
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  let ctxRef: Awaited<ReturnType<typeof requireBusiness>> | null = null;
  let reserved = false;

  try {
    const body = await req.json();
    if (!body?.businessId) throw new ServiceError('validation', 'Missing business.');
    const prompt = String(body?.prompt ?? '').trim();
    if (!prompt) throw new ServiceError('validation', 'Describe the invoice you want.');
    if (prompt.length > 2000) throw new ServiceError('validation', 'That request is too long.');

    const ctx = await requireBusiness(String(body.businessId), 'member');
    ctxRef = ctx;

    if (!process.env.AI_API_KEY) {
      throw new ServiceError(
        'not_configured',
        'AI drafting is not configured on this deployment (AI_API_KEY is not set).'
      );
    }

    // Metered server-side. Free plan gets one introductory draft.
    const quota = await consumeUsage(ctx, 'ai_actions');
    if (!quota.allowed) {
      throw new ServiceError('forbidden', quota.reason ?? 'AI draft limit reached for this month.');
    }
    reserved = true;

    const [clients, taxRates, settings] = await Promise.all([
      listCounterparties(ctx, { kind: 'customer' }),
      listTaxRates(ctx),
      getInvoiceSettings(ctx),
    ]);

    const openai = new OpenAI({
      apiKey: process.env.AI_API_KEY,
      baseURL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    });

    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'invoice_draft', schema: SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'system',
          content: `Existing clients: ${clients.map((c) => c.name).join(', ') || '(none yet)'}`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let draft: AiDraft;
    try {
      draft = JSON.parse(raw) as AiDraft;
    } catch {
      throw new ServiceError('upstream', 'Could not understand that request. Try rephrasing it.');
    }

    if (draft.needs_clarification || !draft.lines?.length) {
      await releaseUsage(ctx, 'ai_actions');
      reserved = false;
      return NextResponse.json({
        ok: false,
        needsClarification:
          draft.needs_clarification ?? 'Tell me who to bill, what for, and how much.',
      });
    }

    // ── Resolve the client. Never invent an id. ──
    let counterpartyId: string | null = null;
    let clientNote: string | null = null;

    if (draft.client_name?.trim()) {
      const needle = draft.client_name.trim().toLowerCase();
      const match =
        clients.find((c) => c.name.toLowerCase() === needle) ??
        clients.find((c) => c.name.toLowerCase().includes(needle));

      if (match) {
        counterpartyId = match.id;
      } else {
        // Creating the client is itself limit-checked in the service.
        const created = await createCounterparty(
          ctx,
          { name: draft.client_name.trim(), kind: 'customer' },
          { actorType: 'zylx', source: 'zylx', requestId }
        );
        counterpartyId = created.id;
        clientNote = `Added ${created.name} as a new client. Add their email before sending.`;
      }
    }

    // ── Build lines. Money is parsed, never multiplied by 100. ──
    const taxOption = defaultTaxRate(taxRates, settings.default_tax_code);
    const noTax = taxRates.find((r) => r.code === 'NONE');

    const lines = draft.lines.map((l, i) => {
      const unitPriceMinor = parseMajorToMinor(
        String(l.unit_price_major ?? 0),
        ctx.business.base_currency
      );
      const useTax = Boolean(l.taxable) && taxOption;
      return {
        description: String(l.description ?? `Item ${i + 1}`).slice(0, 1000),
        quantity: Number(l.quantity) || 1,
        unitPriceMinor,
        taxCode: useTax ? taxOption!.code : noTax?.code ?? 'NONE',
        taxLabel: useTax ? taxOption!.label : null,
        taxRate: useTax ? taxOption!.rate : 0,
        taxTreatment: (useTax ? taxOption!.treatment : 'out_of_scope') as never,
      };
    });

    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate =
      typeof draft.due_in_days === 'number' && draft.due_in_days >= 0
        ? new Date(Date.now() + draft.due_in_days * 86_400_000).toISOString().slice(0, 10)
        : dueDateFor(issueDate, settings.default_payment_terms);

    // Totals, tax and numbering all come from the kernel.
    const result = await createInvoice(
      ctx,
      {
        counterpartyId,
        issueDate,
        dueDate,
        lines,
        notes: draft.notes ?? null,
      },
      { actorType: 'zylx', source: 'zylx', requestId }
    );

    const warnings = [clientNote].filter(Boolean) as string[];
    if (draft.lines.some((l) => l.taxable) && !taxOption) {
      warnings.push('Tax was requested but no tax rate is configured, so nothing was applied.');
    }

    logEvent('invoice.ai_drafted', {
      requestId,
      businessId: ctx.businessId,
      invoiceId: result.invoice.id,
    });

    return NextResponse.json({
      ok: true,
      invoice: result.invoice,
      lines: result.lines,
      warnings,
      // The draft is NOT issued and NOT sent. The user does both.
      next: 'review',
    });
  } catch (error) {
    if (reserved && ctxRef) await releaseUsage(ctxRef, 'ai_actions');
    const e = toServiceError(error, 'draft that invoice');
    logError('invoice.ai_draft_failed', e, { requestId });
    return NextResponse.json(e.toJSON(), { status: e.status });
  }
}
