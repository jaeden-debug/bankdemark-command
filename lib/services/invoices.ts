// ============================================================
// INVOICE SERVICE
//
// The only sanctioned path for creating, issuing, settling and voiding
// an invoice. The UI, Zylx, MCP and any future standalone invoicing
// surface all call these functions, so authorization, validation,
// quota, immutability and audit cannot be bypassed by one caller
// taking a shortcut to the database.
//
// The browser NEVER writes to invoice tables directly.
// ============================================================

import 'server-only';
import { randomBytes } from 'node:crypto';
import type { BusinessContext, Db } from './context';
import { ServiceError, assertOk, unwrap, unwrapMaybe, logError } from './errors';
import { recordAudit, diffRecords, type ActorType, type DataSource } from './audit';
import { checkQuota, isEnabled } from './entitlements';
import { assertSafeMinor } from '@/lib/domain/money';
import {
  computeInvoiceTotals,
  canIssue,
  canRecordPayment,
  canVoid,
  isEditable,
  dueDateFor,
  type InvoiceLineInput,
  type InvoiceStatus,
  type DiscountKind,
  type TaxTreatment,
} from '@/lib/domain/invoice';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface WriteOptions {
  actorType?: ActorType;
  source?: DataSource;
  requestId?: string;
}

// ── Row shapes ──────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  business_id: string;
  counterparty_id: string | null;
  source_kind: string;
  booking_id: string | null;
  project_id: string | null;
  document_id: string | null;
  parent_invoice_id: string | null;
  is_credit_note: boolean;
  number: string | null;
  currency: string;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_minor: number;
  balance_minor: number;
  discount_kind: DiscountKind;
  discount_value: number;
  tax_breakdown: unknown;
  notes: string | null;
  terms: string | null;
  payment_terms: string | null;
  payment_instructions: string | null;
  custom_fields: Record<string, string>;
  issued_business_snapshot: BusinessSnapshot | null;
  issued_client_snapshot: ClientSnapshot | null;
  share_token: string | null;
  share_revoked_at: string | null;
  issued_at: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  quantity: number;
  unit_price_minor: number;
  subtotal_minor: number;
  discount_minor: number;
  tax_code: string | null;
  tax_label: string | null;
  tax_rate: number;
  tax_treatment: TaxTreatment;
  tax_minor: number;
  total_minor: number;
  category_id: string | null;
  project_id: string | null;
}

export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
  transaction_id: string | null;
  amount_minor: number;
  currency: string;
  received_on: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  match_status: string;
  created_at: string;
}

/** Identity frozen onto the document at issue. */
export interface BusinessSnapshot {
  name: string;
  legal_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_number: string | null;
  tax_number_label: string | null;
  logo_path: string | null;
  template: string;
  accent_color: string;
  footer_text: string | null;
  show_bdm_credit: boolean;
}

export interface ClientSnapshot {
  name: string;
  email: string | null;
  phone: string | null;
  kind: string | null;
}

const INVOICE_COLUMNS =
  'id, business_id, counterparty_id, source_kind, booking_id, project_id, document_id, ' +
  'parent_invoice_id, is_credit_note, number, currency, issue_date, due_date, status, ' +
  'subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, balance_minor, ' +
  'discount_kind, discount_value, tax_breakdown, notes, terms, payment_terms, ' +
  'payment_instructions, custom_fields, issued_business_snapshot, issued_client_snapshot, ' +
  'share_token, share_revoked_at, issued_at, sent_at, viewed_at, paid_at, voided_at, ' +
  'void_reason, created_at, updated_at';

const LINE_COLUMNS =
  'id, invoice_id, position, description, quantity, unit_price_minor, subtotal_minor, ' +
  'discount_minor, tax_code, tax_label, tax_rate, tax_treatment, tax_minor, total_minor, ' +
  'category_id, project_id';

// ── Validation ──────────────────────────────────────────────

function validDate(value: string, field: string): string {
  if (!ISO_DATE.test(value)) {
    throw new ServiceError('validation', `Enter a valid ${field} (YYYY-MM-DD).`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new ServiceError('validation', `That ${field} is not a real date.`);
  }
  const year = d.getUTCFullYear();
  if (year < 1990 || year > new Date().getUTCFullYear() + 5) {
    throw new ServiceError('validation', `The year ${year} looks wrong. Check the ${field}.`);
  }
  return value;
}

function normaliseLines(input: readonly InvoiceLineInput[]): InvoiceLineInput[] {
  if (input.length === 0) {
    throw new ServiceError('validation', 'An invoice needs at least one line item.');
  }
  if (input.length > 200) {
    throw new ServiceError('validation', 'An invoice cannot have more than 200 line items.');
  }
  return input.map((l, i) => {
    const description = String(l.description ?? '').trim();
    if (!description) {
      throw new ServiceError('validation', `Line ${i + 1} needs a description.`);
    }
    const quantity = Number(l.quantity);
    if (!Number.isFinite(quantity) || quantity === 0) {
      throw new ServiceError('validation', `Line ${i + 1} needs a quantity that is not zero.`);
    }
    const unitPriceMinor = Number(l.unitPriceMinor);
    assertSafeMinor(unitPriceMinor, `line ${i + 1} unit price`);

    const taxRate = Number(l.taxRate ?? 0);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
      throw new ServiceError(
        'validation',
        `Line ${i + 1} has an invalid tax rate. Use a decimal such as 0.13 for 13%.`
      );
    }

    return {
      description: description.slice(0, 1000),
      quantity,
      unitPriceMinor,
      taxCode: l.taxCode ?? null,
      taxLabel: l.taxLabel ?? null,
      taxRate,
      taxTreatment: (l.taxTreatment ?? 'standard') as TaxTreatment,
      categoryId: l.categoryId ?? null,
      projectId: l.projectId ?? null,
    };
  });
}

/**
 * Custom fields are supplementary context and must never behave like
 * money. Values are coerced to strings and length-capped so nothing
 * numeric can leak into a total by accident.
 */
function normaliseCustomFields(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (count >= 40) break;
    if (!/^[a-z0-9_]{1,40}$/.test(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    out[k] = String(v).slice(0, 500);
    count += 1;
  }
  return out;
}

// ── Settings ────────────────────────────────────────────────

export interface InvoiceSettings {
  business_id: string;
  number_prefix: string;
  number_include_year: boolean;
  number_pad: number;
  next_sequence: number;
  legal_name: string | null;
  logo_path: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_number: string | null;
  tax_number_label: string;
  template: string;
  accent_color: string;
  footer_text: string | null;
  show_bdm_credit: boolean;
  default_payment_terms: string;
  default_due_days: number;
  default_notes: string | null;
  default_terms: string | null;
  payment_instructions: string | null;
  default_tax_code: string | null;
}

/** Read settings, creating the default row on first use. */
export async function getInvoiceSettings(ctx: BusinessContext): Promise<InvoiceSettings> {
  const existing = unwrapMaybe(
    await ctx.db.from('invoice_settings').select('*').eq('business_id', ctx.businessId).maybeSingle(),
    'load invoice settings'
  );
  if (existing) return existing as unknown as InvoiceSettings;

  const created = unwrap(
    await ctx.db
      .from('invoice_settings')
      .insert({ business_id: ctx.businessId })
      .select('*')
      .single(),
    'set up invoice settings'
  );
  return created as unknown as InvoiceSettings;
}

const SETTINGS_FIELDS = [
  'number_prefix', 'number_include_year', 'number_pad',
  'legal_name', 'logo_path', 'address_line1', 'address_line2', 'city', 'region',
  'postal_code', 'country', 'email', 'phone', 'website', 'tax_number',
  'tax_number_label', 'template', 'accent_color', 'footer_text', 'show_bdm_credit',
  'default_payment_terms', 'default_due_days', 'default_notes', 'default_terms',
  'payment_instructions', 'default_tax_code',
] as const;

export async function updateInvoiceSettings(
  ctx: BusinessContext,
  patch: Partial<Record<(typeof SETTINGS_FIELDS)[number], unknown>>,
  options: WriteOptions = {}
): Promise<InvoiceSettings> {
  const before = await getInvoiceSettings(ctx);

  const update: Record<string, unknown> = {};
  for (const key of SETTINGS_FIELDS) {
    if (patch[key] !== undefined) update[key] = patch[key];
  }

  if (typeof update.number_prefix === 'string') {
    const prefix = update.number_prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) throw new ServiceError('validation', 'The invoice prefix needs at least one letter or number.');
    update.number_prefix = prefix.slice(0, 8);
  }
  if (typeof update.accent_color === 'string' && !/^#[0-9a-fA-F]{6}$/.test(update.accent_color)) {
    throw new ServiceError('validation', 'The accent colour must be a hex value such as #c6a24a.');
  }

  // Branding and templates are entitlement-gated. Financial fields
  // never are — see the note in entitlements.ts.
  const plan = await planOf(ctx);
  if (update.show_bdm_credit === false && !isEnabled(plan, 'invoice_branding')) {
    throw new ServiceError(
      'forbidden',
      'Removing the BankDeMark credit is included from the Starter plan.'
    );
  }
  if (update.template !== undefined && update.template !== before.template
      && !isEnabled(plan, 'invoice_templates')) {
    throw new ServiceError('forbidden', 'Invoice templates are included from the Starter plan.');
  }

  if (Object.keys(update).length === 0) return before;

  const after = unwrap(
    await ctx.db
      .from('invoice_settings')
      .update(update as never)
      .eq('business_id', ctx.businessId)
      .select('*')
      .single(),
    'save invoice settings'
  ) as unknown as InvoiceSettings;

  const delta = diffRecords(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>
  );
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice_settings',
    entityId: ctx.businessId,
    action: 'update',
    before: delta.before,
    after: delta.after,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return after;
}

async function planOf(ctx: BusinessContext): Promise<string> {
  const { data } = await ctx.db.from('profiles').select('plan').eq('id', ctx.userId).maybeSingle();
  return (data?.plan as string) ?? 'free';
}

// ── Create / update drafts ──────────────────────────────────

export interface CreateInvoiceInput {
  counterpartyId?: string | null;
  sourceKind?: string;
  bookingId?: string | null;
  projectId?: string | null;
  issueDate?: string;
  dueDate?: string;
  paymentTerms?: string;
  currency?: string;
  lines: InvoiceLineInput[];
  discountKind?: DiscountKind;
  discountValue?: number;
  notes?: string | null;
  terms?: string | null;
  paymentInstructions?: string | null;
  customFields?: Record<string, unknown>;
}

export async function createInvoice(
  ctx: BusinessContext,
  input: CreateInvoiceInput,
  options: WriteOptions = {}
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
  const settings = await getInvoiceSettings(ctx);

  // Quota applies to CREATING invoices only. Reading, exporting and
  // settling existing ones is never gated.
  const plan = await planOf(ctx);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const { count } = await ctx.db
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .gte('created_at', monthStart.toISOString().slice(0, 10));

  const quota = checkQuota(plan, 'invoices_per_month', count ?? 0);
  if (!quota.allowed) {
    throw new ServiceError('forbidden', quota.reason ?? 'Invoice limit reached for this month.');
  }

  const issueDate = validDate(input.issueDate ?? new Date().toISOString().slice(0, 10), 'issue date');
  const paymentTerms = input.paymentTerms ?? settings.default_payment_terms;
  const dueDate = validDate(input.dueDate ?? dueDateFor(issueDate, paymentTerms), 'due date');

  if (dueDate < issueDate) {
    throw new ServiceError('validation', 'The due date cannot be before the issue date.');
  }

  const currency = (input.currency ?? ctx.business.base_currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ServiceError('validation', 'Currency must be a 3-letter ISO code such as CAD.');
  }

  if (input.counterpartyId) {
    await assertCounterparty(ctx, input.counterpartyId);
  }
  if (input.bookingId) {
    await assertBooking(ctx, input.bookingId);
  }

  const lines = normaliseLines(input.lines);
  const totals = computeInvoiceTotals(lines, {
    currency,
    discountKind: input.discountKind,
    discountValue: input.discountValue,
  });

  const invoice = unwrap(
    await ctx.db
      .from('invoices')
      .insert({
        business_id: ctx.businessId,
        counterparty_id: input.counterpartyId ?? null,
        source_kind: (input.sourceKind ?? (input.bookingId ? 'booking' : 'manual')) as never,
        booking_id: input.bookingId ?? null,
        project_id: input.projectId ?? null,
        currency,
        issue_date: issueDate,
        due_date: dueDate,
        status: 'draft',
        subtotal_minor: totals.subtotalMinor,
        discount_minor: totals.discountMinor,
        tax_minor: totals.taxMinor,
        total_minor: totals.totalMinor,
        balance_minor: totals.totalMinor,
        discount_kind: input.discountKind ?? 'percentage',
        discount_value: input.discountValue ?? 0,
        tax_breakdown: totals.taxLines as never,
        notes: input.notes?.slice(0, 4000) ?? settings.default_notes,
        terms: input.terms?.slice(0, 8000) ?? settings.default_terms,
        payment_terms: paymentTerms,
        payment_instructions:
          input.paymentInstructions?.slice(0, 2000) ?? settings.payment_instructions,
        custom_fields: normaliseCustomFields(input.customFields) as never,
        source: (options.source ?? 'manual') as never,
        created_by: ctx.userId,
      })
      .select(INVOICE_COLUMNS)
      .single(),
    'create that invoice'
  ) as unknown as InvoiceRow;

  const lineRows = await replaceLines(ctx, invoice.id, totals);

  await logInvoiceEvent(ctx, invoice.id, 'created', { total_minor: totals.totalMinor }, options);
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: invoice.id,
    action: 'create',
    after: invoice,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return { invoice, lines: lineRows };
}

export async function updateInvoice(
  ctx: BusinessContext,
  invoiceId: string,
  patch: Partial<CreateInvoiceInput>,
  options: WriteOptions = {}
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
  const before = await requireInvoice(ctx, invoiceId);

  if (!isEditable(before.status)) {
    throw new ServiceError(
      'conflict',
      `Invoice ${before.number ?? ''} has been issued and cannot be edited. Void it or issue a revision.`.trim()
    );
  }

  if (patch.counterpartyId) await assertCounterparty(ctx, patch.counterpartyId);
  if (patch.bookingId) await assertBooking(ctx, patch.bookingId);

  const issueDate = validDate(patch.issueDate ?? before.issue_date, 'issue date');
  const paymentTerms = patch.paymentTerms ?? before.payment_terms ?? 'net_30';
  const dueDate = validDate(
    patch.dueDate ?? (patch.paymentTerms ? dueDateFor(issueDate, paymentTerms) : before.due_date),
    'due date'
  );
  if (dueDate < issueDate) {
    throw new ServiceError('validation', 'The due date cannot be before the issue date.');
  }

  const currency = (patch.currency ?? before.currency).toUpperCase();
  const lines = patch.lines
    ? normaliseLines(patch.lines)
    : (await loadLines(ctx.db, invoiceId)).map(lineRowToInput);

  const totals = computeInvoiceTotals(lines, {
    currency,
    discountKind: patch.discountKind ?? before.discount_kind,
    discountValue: patch.discountValue ?? Number(before.discount_value),
  });

  const invoice = unwrap(
    await ctx.db
      .from('invoices')
      .update({
        counterparty_id:
          patch.counterpartyId !== undefined ? patch.counterpartyId : before.counterparty_id,
        project_id: patch.projectId !== undefined ? patch.projectId : before.project_id,
        booking_id: patch.bookingId !== undefined ? patch.bookingId : before.booking_id,
        currency,
        issue_date: issueDate,
        due_date: dueDate,
        payment_terms: paymentTerms,
        subtotal_minor: totals.subtotalMinor,
        discount_minor: totals.discountMinor,
        tax_minor: totals.taxMinor,
        total_minor: totals.totalMinor,
        balance_minor: totals.totalMinor,
        discount_kind: patch.discountKind ?? before.discount_kind,
        discount_value: patch.discountValue ?? before.discount_value,
        tax_breakdown: totals.taxLines as never,
        notes: patch.notes !== undefined ? patch.notes?.slice(0, 4000) ?? null : before.notes,
        terms: patch.terms !== undefined ? patch.terms?.slice(0, 8000) ?? null : before.terms,
        payment_instructions:
          patch.paymentInstructions !== undefined
            ? patch.paymentInstructions?.slice(0, 2000) ?? null
            : before.payment_instructions,
        custom_fields: (patch.customFields !== undefined
          ? normaliseCustomFields(patch.customFields)
          : before.custom_fields) as never,
      })
      .eq('id', invoiceId)
      .eq('business_id', ctx.businessId)
      .select(INVOICE_COLUMNS)
      .single(),
    'save that invoice'
  ) as unknown as InvoiceRow;

  const lineRows = await replaceLines(ctx, invoiceId, totals);

  const delta = diffRecords(
    before as unknown as Record<string, unknown>,
    invoice as unknown as Record<string, unknown>
  );
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: invoiceId,
    action: 'update',
    before: delta.before,
    after: delta.after,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });
  await logInvoiceEvent(ctx, invoiceId, 'edited', delta.after, options);

  return { invoice, lines: lineRows };
}

export async function deleteDraftInvoice(
  ctx: BusinessContext,
  invoiceId: string,
  options: WriteOptions = {}
): Promise<void> {
  const before = await requireInvoice(ctx, invoiceId);
  if (before.issued_at) {
    throw new ServiceError(
      'conflict',
      `Invoice ${before.number} has been issued and cannot be deleted. Void it instead — the record has to survive.`
    );
  }

  assertOk(
    await ctx.db.from('invoices').delete().eq('id', invoiceId).eq('business_id', ctx.businessId),
    'delete that draft'
  );

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: invoiceId,
    action: 'delete_draft',
    before,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });
}

// ── Issue ───────────────────────────────────────────────────

/**
 * Turn a draft into a financial record.
 *
 * Assigns the number atomically, freezes both identity snapshots, and
 * from this point the database itself refuses to let the financial
 * fields change.
 */
export async function issueInvoice(
  ctx: BusinessContext,
  invoiceId: string,
  options: WriteOptions = {}
): Promise<InvoiceRow> {
  const before = await requireInvoice(ctx, invoiceId);

  if (!canIssue(before.status)) {
    throw new ServiceError('conflict', `That invoice is already ${before.status}.`);
  }
  const lines = await loadLines(ctx.db, invoiceId);
  if (lines.length === 0) {
    throw new ServiceError('validation', 'Add at least one line item before issuing.');
  }
  if (!before.counterparty_id) {
    throw new ServiceError('validation', 'Choose who this invoice is for before issuing it.');
  }

  const [settings, client] = await Promise.all([
    getInvoiceSettings(ctx),
    ctx.db
      .from('counterparties')
      .select('name, email, phone, kind')
      .eq('id', before.counterparty_id)
      .eq('business_id', ctx.businessId)
      .single(),
  ]);

  if (client.error || !client.data) {
    throw new ServiceError('not_found', 'That client could not be found.');
  }

  const businessSnapshot: BusinessSnapshot = {
    name: settings.legal_name?.trim() || ctx.business.name,
    legal_name: settings.legal_name,
    address_line1: settings.address_line1,
    address_line2: settings.address_line2,
    city: settings.city,
    region: settings.region,
    postal_code: settings.postal_code,
    country: settings.country ?? ctx.business.country,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    tax_number: settings.tax_number,
    tax_number_label: settings.tax_number_label,
    logo_path: settings.logo_path,
    template: settings.template,
    accent_color: settings.accent_color,
    footer_text: settings.footer_text,
    show_bdm_credit: settings.show_bdm_credit,
  };

  const clientSnapshot: ClientSnapshot = {
    name: client.data.name,
    email: client.data.email,
    phone: client.data.phone,
    kind: client.data.kind,
  };

  // Atomic, server-side, race-free.
  const { data: numberData, error: numberError } = await ctx.db.rpc(
    'bdm_next_invoice_number',
    { p_business_id: ctx.businessId }
  );
  if (numberError || !numberData) {
    throw new ServiceError('internal', 'Could not assign an invoice number.', {
      detail: numberError?.message,
      cause: numberError,
    });
  }

  const shareToken = randomBytes(32).toString('base64url');

  const invoice = unwrap(
    await ctx.db
      .from('invoices')
      .update({
        number: String(numberData),
        status: 'issued',
        issued_at: new Date().toISOString(),
        issued_business_snapshot: businessSnapshot as never,
        issued_client_snapshot: clientSnapshot as never,
        share_token: shareToken,
      })
      .eq('id', invoiceId)
      .eq('business_id', ctx.businessId)
      // Losing this race means someone else issued it first.
      .eq('status', 'draft')
      .select(INVOICE_COLUMNS)
      .single(),
    'issue that invoice'
  ) as unknown as InvoiceRow;

  await logInvoiceEvent(ctx, invoiceId, 'issued', {
    number: invoice.number,
    total_minor: invoice.total_minor,
    currency: invoice.currency,
  }, options);

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: invoiceId,
    action: 'issue',
    before: { status: before.status, number: null },
    after: { status: 'issued', number: invoice.number },
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return invoice;
}

// ── Void and revise ─────────────────────────────────────────

export async function voidInvoice(
  ctx: BusinessContext,
  invoiceId: string,
  reason: string,
  options: WriteOptions = {}
): Promise<InvoiceRow> {
  const before = await requireInvoice(ctx, invoiceId);
  if (!canVoid(before.status)) {
    throw new ServiceError(
      'conflict',
      before.status === 'draft'
        ? 'A draft has no financial record to void — delete it instead.'
        : 'That invoice is already void.'
    );
  }
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new ServiceError('validation', 'Give a reason for voiding this invoice. It goes on the record.');
  }

  const invoice = unwrap(
    await ctx.db
      .from('invoices')
      .update({
        status: 'void',
        voided_at: new Date().toISOString(),
        void_reason: trimmed.slice(0, 500),
        // A void invoice's public link stops working.
        share_revoked_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('business_id', ctx.businessId)
      .select(INVOICE_COLUMNS)
      .single(),
    'void that invoice'
  ) as unknown as InvoiceRow;

  await logInvoiceEvent(ctx, invoiceId, 'voided', { reason: trimmed }, options);
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: invoiceId,
    action: 'void',
    before: { status: before.status },
    after: { status: 'void', reason: trimmed },
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return invoice;
}

/**
 * Void an issued invoice and open a fresh draft carrying its content.
 *
 * The original stays exactly as it was sent — that is the whole point.
 * The revision is a new document that references it.
 */
export async function reviseInvoice(
  ctx: BusinessContext,
  invoiceId: string,
  reason: string,
  options: WriteOptions = {}
): Promise<{ voided: InvoiceRow; draft: InvoiceRow; lines: InvoiceLineRow[] }> {
  const original = await requireInvoice(ctx, invoiceId);
  if (original.status === 'draft') {
    throw new ServiceError('conflict', 'That invoice is still a draft — just edit it.');
  }
  if (original.paid_minor > 0) {
    throw new ServiceError(
      'conflict',
      'This invoice has payments recorded against it. Issue a credit note instead so the payment history stays intact.'
    );
  }

  const lines = await loadLines(ctx.db, invoiceId);
  const voided = await voidInvoice(ctx, invoiceId, reason, options);

  const { invoice: draft, lines: draftLines } = await createInvoice(
    ctx,
    {
      counterpartyId: original.counterparty_id,
      sourceKind: original.source_kind,
      bookingId: original.booking_id,
      projectId: original.project_id,
      issueDate: new Date().toISOString().slice(0, 10),
      paymentTerms: original.payment_terms ?? undefined,
      currency: original.currency,
      lines: lines.map(lineRowToInput),
      discountKind: original.discount_kind,
      discountValue: Number(original.discount_value),
      notes: original.notes,
      terms: original.terms,
      paymentInstructions: original.payment_instructions,
      customFields: original.custom_fields,
    },
    options
  );

  const linked = unwrap(
    await ctx.db
      .from('invoices')
      .update({ parent_invoice_id: invoiceId })
      .eq('id', draft.id)
      .eq('business_id', ctx.businessId)
      .select(INVOICE_COLUMNS)
      .single(),
    'link the revision to the original'
  ) as unknown as InvoiceRow;

  await logInvoiceEvent(ctx, draft.id, 'revised', { revises: original.number }, options);

  return { voided, draft: linked, lines: draftLines };
}

/**
 * A credit note: a negative document that offsets an issued invoice
 * without touching it. Used when the invoice has already been paid, or
 * partly paid, and its history must stay intact.
 */
export async function createCreditNote(
  ctx: BusinessContext,
  invoiceId: string,
  reason: string,
  options: WriteOptions = {}
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
  const original = await requireInvoice(ctx, invoiceId);
  if (!original.issued_at) {
    throw new ServiceError('conflict', 'A draft cannot be credited. Edit or delete it.');
  }
  if (original.is_credit_note) {
    throw new ServiceError('conflict', 'That is already a credit note.');
  }
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw new ServiceError('validation', 'Give a reason for the credit note.');
  }

  const lines = await loadLines(ctx.db, invoiceId);

  const { invoice, lines: creditLines } = await createInvoice(
    ctx,
    {
      counterpartyId: original.counterparty_id,
      sourceKind: original.source_kind,
      bookingId: original.booking_id,
      projectId: original.project_id,
      currency: original.currency,
      // Negative quantities produce a negative document.
      lines: lines.map((l) => ({ ...lineRowToInput(l), quantity: -Number(l.quantity) })),
      notes: `Credit note for invoice ${original.number}. ${trimmed}`.slice(0, 4000),
      terms: original.terms,
      customFields: original.custom_fields,
    },
    options
  );

  const marked = unwrap(
    await ctx.db
      .from('invoices')
      .update({ is_credit_note: true, parent_invoice_id: invoiceId })
      .eq('id', invoice.id)
      .eq('business_id', ctx.businessId)
      .select(INVOICE_COLUMNS)
      .single(),
    'mark the credit note'
  ) as unknown as InvoiceRow;

  await logInvoiceEvent(ctx, invoice.id, 'credit_note_created', {
    credits: original.number,
    reason: trimmed,
  }, options);

  return { invoice: marked, lines: creditLines };
}

// ── Payments ────────────────────────────────────────────────

export interface RecordPaymentInput {
  amountMinor: number;
  receivedOn?: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** An existing bank transaction this payment settles. */
  transactionId?: string | null;
}

/**
 * Record money received against an invoice.
 *
 * `paid_minor`, `balance_minor` and `status` are recomputed by a
 * database trigger from the payment rows, so they are always justified
 * by payments that exist.
 *
 * When the invoice came from a booking AND the payment is tied to a
 * real transaction, a matching `commission_payments` row is written so
 * the booking's commission status resolves too. That is the last link
 * in booking -> commission -> invoice -> payment -> revenue.
 */
export async function recordInvoicePayment(
  ctx: BusinessContext,
  invoiceId: string,
  input: RecordPaymentInput,
  options: WriteOptions = {}
): Promise<{ payment: InvoicePaymentRow; invoice: InvoiceRow }> {
  const invoice = await requireInvoice(ctx, invoiceId);

  if (!canRecordPayment(invoice.status)) {
    throw new ServiceError(
      'conflict',
      invoice.status === 'draft'
        ? 'Issue this invoice before recording a payment against it.'
        : invoice.status === 'paid'
          ? 'This invoice is already paid in full.'
          : `A ${invoice.status} invoice cannot take a payment.`
    );
  }

  const amountMinor = Math.trunc(Number(input.amountMinor));
  assertSafeMinor(amountMinor, 'payment amount');
  if (amountMinor <= 0) {
    throw new ServiceError('validation', 'A payment amount must be more than zero.');
  }
  if (amountMinor > invoice.balance_minor) {
    throw new ServiceError(
      'validation',
      `That is more than the ${formatBalanceHint(invoice)} still outstanding. Record the exact amount received, or issue a credit note if the client overpaid.`
    );
  }

  const receivedOn = validDate(
    input.receivedOn ?? new Date().toISOString().slice(0, 10),
    'payment date'
  );

  if (input.transactionId) {
    const tx = unwrapMaybe(
      await ctx.db
        .from('transactions')
        .select('id, business_id, currency')
        .eq('id', input.transactionId)
        .eq('business_id', ctx.businessId)
        .maybeSingle(),
      'find that transaction'
    ) as { id: string; business_id: string; currency: string } | null;
    if (!tx) throw new ServiceError('not_found', 'That transaction could not be found.');
    if (tx.currency !== invoice.currency) {
      throw new ServiceError(
        'validation',
        `That transaction is in ${tx.currency} but the invoice is in ${invoice.currency}. BankDeMark will not convert between them silently.`
      );
    }
  }

  const payment = unwrap(
    await ctx.db
      .from('invoice_payments')
      .insert({
        invoice_id: invoiceId,
        business_id: ctx.businessId,
        transaction_id: input.transactionId ?? null,
        amount_minor: amountMinor,
        currency: invoice.currency,
        received_on: receivedOn,
        method: input.method?.slice(0, 100) ?? null,
        reference: input.reference?.slice(0, 200) ?? null,
        notes: input.notes?.slice(0, 2000) ?? null,
        match_status: input.transactionId ? 'matched' : 'unmatched',
        source: (options.source ?? 'manual') as never,
        created_by: ctx.userId,
      })
      .select('id, invoice_id, transaction_id, amount_minor, currency, received_on, method, reference, notes, match_status, created_at')
      .single(),
    'record that payment'
  ) as unknown as InvoicePaymentRow;

  // Resolve the booking commission when this settles a booking invoice.
  if (invoice.booking_id && input.transactionId) {
    const { error: commissionError } = await ctx.db.from('commission_payments').insert({
      business_id: ctx.businessId,
      booking_id: invoice.booking_id,
      transaction_id: input.transactionId,
      amount_minor: amountMinor,
      currency: invoice.currency,
      received_on: receivedOn,
      notes: `Invoice ${invoice.number}`,
      created_by: ctx.userId,
    });
    if (commissionError) {
      // The invoice payment is real and already recorded; the booking
      // roll-up is derived and can be repaired. Loud, not silent.
      logError('invoice.commission_link_failed', commissionError, {
        businessId: ctx.businessId,
        invoiceId,
        bookingId: invoice.booking_id,
      });
    }
  }

  const after = await requireInvoice(ctx, invoiceId);

  await logInvoiceEvent(ctx, invoiceId, 'payment_recorded', {
    amount_minor: amountMinor,
    received_on: receivedOn,
    method: input.method ?? null,
    balance_minor: after.balance_minor,
    matched_transaction: input.transactionId ?? null,
  }, options);

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: invoiceId,
    action: 'payment_recorded',
    before: { paid_minor: invoice.paid_minor, balance_minor: invoice.balance_minor, status: invoice.status },
    after: { paid_minor: after.paid_minor, balance_minor: after.balance_minor, status: after.status },
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return { payment, invoice: after };
}

export async function deleteInvoicePayment(
  ctx: BusinessContext,
  paymentId: string,
  options: WriteOptions = {}
): Promise<InvoiceRow> {
  const payment = unwrapMaybe(
    await ctx.db
      .from('invoice_payments')
      .select('id, invoice_id, amount_minor, received_on')
      .eq('id', paymentId)
      .eq('business_id', ctx.businessId)
      .maybeSingle(),
    'find that payment'
  ) as { id: string; invoice_id: string; amount_minor: number; received_on: string } | null;
  if (!payment) throw new ServiceError('not_found', 'That payment could not be found.');

  assertOk(
    await ctx.db.from('invoice_payments').delete().eq('id', paymentId).eq('business_id', ctx.businessId),
    'remove that payment'
  );

  const invoice = await requireInvoice(ctx, payment.invoice_id);

  await logInvoiceEvent(ctx, payment.invoice_id, 'payment_removed', {
    amount_minor: payment.amount_minor,
    balance_minor: invoice.balance_minor,
  }, options);
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice',
    entityId: payment.invoice_id,
    action: 'payment_removed',
    before: payment,
    source: options.source ?? 'manual',
    requestId: options.requestId,
  });

  return invoice;
}

function formatBalanceHint(invoice: InvoiceRow): string {
  const major = (invoice.balance_minor / 100).toFixed(2);
  return `${major} ${invoice.currency}`;
}

// ── Reads ───────────────────────────────────────────────────

export interface ListInvoicesFilters {
  status?: InvoiceStatus | 'outstanding' | 'all';
  counterpartyId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listInvoices(
  ctx: BusinessContext,
  filters: ListInvoicesFilters = {}
): Promise<{ invoices: InvoiceRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(Math.max(1, filters.pageSize ?? 50), 200);

  let query = ctx.db
    .from('invoices')
    .select(INVOICE_COLUMNS, { count: 'exact' })
    .eq('business_id', ctx.businessId)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (filters.status === 'outstanding') {
    query = query.in('status', ['issued', 'sent', 'viewed', 'partially_paid', 'overdue']);
  } else if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status);
  }
  if (filters.counterpartyId) query = query.eq('counterparty_id', filters.counterpartyId);
  if (filters.from) query = query.gte('issue_date', filters.from);
  if (filters.to) query = query.lte('issue_date', filters.to);
  if (filters.search) {
    const term = filters.search.replace(/[%,()]/g, '').trim().slice(0, 80);
    if (term) query = query.or(`number.ilike.%${term}%,notes.ilike.%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new ServiceError('internal', 'Could not load invoices.', {
      detail: error.message,
      cause: error,
    });
  }

  return {
    invoices: (data ?? []) as unknown as InvoiceRow[],
    total: count ?? 0,
    page,
    pageSize,
  };
}

export interface InvoiceDetail {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  payments: InvoicePaymentRow[];
  events: Array<{ id: number; event: string; detail: unknown; created_at: string; actor_type: string }>;
  counterparty: { id: string; name: string; email: string | null; phone: string | null } | null;
  booking: {
    id: string;
    reference: string | null;
    gross_value_minor: number;
    commission_rate: number | null;
    commission_expected_minor: number;
    currency: string;
  } | null;
}

export async function getInvoice(ctx: BusinessContext, invoiceId: string): Promise<InvoiceDetail> {
  const invoice = await requireInvoice(ctx, invoiceId);

  const [lines, payments, events, counterparty, booking] = await Promise.all([
    loadLines(ctx.db, invoiceId),
    ctx.db
      .from('invoice_payments')
      .select('id, invoice_id, transaction_id, amount_minor, currency, received_on, method, reference, notes, match_status, created_at')
      .eq('invoice_id', invoiceId)
      .order('received_on', { ascending: false }),
    ctx.db
      .from('invoice_events')
      .select('id, event, detail, created_at, actor_type')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(100),
    invoice.counterparty_id
      ? ctx.db
          .from('counterparties')
          .select('id, name, email, phone')
          .eq('id', invoice.counterparty_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    invoice.booking_id
      ? ctx.db
          .from('bookings')
          .select('id, reference, gross_value_minor, commission_rate, commission_expected_minor, currency')
          .eq('id', invoice.booking_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    invoice,
    lines,
    payments: (payments.data ?? []) as unknown as InvoicePaymentRow[],
    events: (events.data ?? []) as InvoiceDetail['events'],
    counterparty: (counterparty.data ?? null) as InvoiceDetail['counterparty'],
    booking: (booking.data ?? null) as InvoiceDetail['booking'],
  };
}

/**
 * The receivables position, per currency.
 *
 * Invoiced and uninvoiced are returned separately and deliberately
 * never summed here: a booking commission that has been invoiced would
 * otherwise be counted twice.
 */
export interface ARPosition {
  currency: string;
  invoicedMinor: number;
  overdueMinor: number;
  uninvoicedCommissionMinor: number;
  invoiceCount: number;
  overdueCount: number;
}

export async function getARPosition(ctx: BusinessContext): Promise<ARPosition[]> {
  const { data, error } = await ctx.db.rpc('bdm_ar_position', { p_business_id: ctx.businessId });
  if (error) {
    logError('invoice.ar_position_failed', error, { businessId: ctx.businessId });
    throw new ServiceError('internal', 'Could not calculate outstanding invoices.', {
      detail: error.message,
      cause: error,
    });
  }
  return (data ?? []).map((r) => ({
    currency: r.currency,
    invoicedMinor: Number(r.invoiced_minor ?? 0),
    overdueMinor: Number(r.overdue_minor ?? 0),
    uninvoicedCommissionMinor: Number(r.uninvoiced_commission_minor ?? 0),
    invoiceCount: Number(r.invoice_count ?? 0),
    overdueCount: Number(r.overdue_count ?? 0),
  }));
}

/** Mark anything past its due date as overdue. Derived, not remembered. */
export async function refreshOverdue(ctx: BusinessContext): Promise<number> {
  const { data, error } = await ctx.db.rpc('bdm_refresh_overdue_invoices', {
    p_business_id: ctx.businessId,
  });
  if (error) {
    logError('invoice.refresh_overdue_failed', error, { businessId: ctx.businessId });
    return 0;
  }
  return Number(data ?? 0);
}

export async function getOutstandingInvoices(
  ctx: BusinessContext,
  limit = 100
): Promise<InvoiceRow[]> {
  await refreshOverdue(ctx);
  const { invoices } = await listInvoices(ctx, { status: 'outstanding', pageSize: limit });
  return invoices;
}

export async function getOverdueInvoices(ctx: BusinessContext, limit = 100): Promise<InvoiceRow[]> {
  await refreshOverdue(ctx);
  const { invoices } = await listInvoices(ctx, { status: 'overdue', pageSize: limit });
  return invoices;
}

/** Average days from issue to full payment. Null when nothing is paid yet. */
export async function getAverageDaysToPayment(ctx: BusinessContext): Promise<number | null> {
  const { data, error } = await ctx.db
    .from('invoices')
    .select('issued_at, paid_at')
    .eq('business_id', ctx.businessId)
    .eq('status', 'paid')
    .not('paid_at', 'is', null)
    .not('issued_at', 'is', null)
    .limit(500);

  if (error || !data || data.length === 0) return null;

  const days = data
    .map((r) => {
      const issued = new Date(r.issued_at as string).getTime();
      const paid = new Date(r.paid_at as string).getTime();
      return (paid - issued) / 86_400_000;
    })
    .filter((d) => Number.isFinite(d) && d >= 0);

  if (days.length === 0) return null;
  return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
}

// ── Share links ─────────────────────────────────────────────

export async function revokeShareLink(
  ctx: BusinessContext,
  invoiceId: string,
  options: WriteOptions = {}
): Promise<void> {
  await requireInvoice(ctx, invoiceId);
  assertOk(
    await ctx.db
      .from('invoices')
      .update({ share_revoked_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('business_id', ctx.businessId),
    'revoke that link'
  );
  await logInvoiceEvent(ctx, invoiceId, 'share_revoked', {}, options);
}

export async function regenerateShareLink(
  ctx: BusinessContext,
  invoiceId: string,
  options: WriteOptions = {}
): Promise<string> {
  const invoice = await requireInvoice(ctx, invoiceId);
  if (!invoice.issued_at) {
    throw new ServiceError('conflict', 'Issue the invoice before sharing a link to it.');
  }
  const token = randomBytes(32).toString('base64url');
  assertOk(
    await ctx.db
      .from('invoices')
      .update({ share_token: token, share_revoked_at: null })
      .eq('id', invoiceId)
      .eq('business_id', ctx.businessId),
    'regenerate that link'
  );
  await logInvoiceEvent(ctx, invoiceId, 'share_regenerated', {}, options);
  return token;
}

// ── Custom field definitions ────────────────────────────────

export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  field_type: string;
  help_text: string | null;
  sort_order: number;
  is_active: boolean;
}

export async function listCustomFields(ctx: BusinessContext): Promise<CustomFieldDef[]> {
  const { data, error } = await ctx.db
    .from('invoice_custom_fields')
    .select('id, key, label, field_type, help_text, sort_order, is_active')
    .eq('business_id', ctx.businessId)
    .eq('is_active', true)
    .order('sort_order');
  if (error) {
    logError('invoice.custom_fields_failed', error, { businessId: ctx.businessId });
    return [];
  }
  return (data ?? []) as CustomFieldDef[];
}

export async function createCustomField(
  ctx: BusinessContext,
  input: { label: string; fieldType?: string; helpText?: string | null },
  options: WriteOptions = {}
): Promise<CustomFieldDef> {
  const label = input.label?.trim();
  if (!label) throw new ServiceError('validation', 'Give the field a label.');

  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!key) {
    throw new ServiceError('validation', 'That label needs at least one letter or number.');
  }

  const allowed = ['text', 'number', 'date', 'date_range', 'currency', 'percent'];
  const fieldType = input.fieldType ?? 'text';
  if (!allowed.includes(fieldType)) {
    throw new ServiceError('validation', `Unknown field type: ${fieldType}`);
  }

  const row = unwrap(
    await ctx.db
      .from('invoice_custom_fields')
      .insert({
        business_id: ctx.businessId,
        key,
        label: label.slice(0, 60),
        field_type: fieldType,
        help_text: input.helpText?.slice(0, 200) ?? null,
      })
      .select('id, key, label, field_type, help_text, sort_order, is_active')
      .single(),
    'add that field'
  ) as unknown as CustomFieldDef;

  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice_custom_field',
    entityId: row.id,
    action: 'create',
    after: row,
    source: options.source ?? 'manual',
  });

  return row;
}

export async function deleteCustomField(
  ctx: BusinessContext,
  fieldId: string,
  options: WriteOptions = {}
): Promise<void> {
  // Deactivated, never deleted: invoices already issued carry values
  // under this key and their labels must keep resolving.
  assertOk(
    await ctx.db
      .from('invoice_custom_fields')
      .update({ is_active: false })
      .eq('id', fieldId)
      .eq('business_id', ctx.businessId),
    'remove that field'
  );
  await recordAudit(ctx.db, {
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: options.actorType ?? 'user',
    entity: 'invoice_custom_field',
    entityId: fieldId,
    action: 'deactivate',
    source: options.source ?? 'manual',
  });
}

// ── Tax rates ───────────────────────────────────────────────

export interface TaxRateOption {
  id: string;
  jurisdiction: string;
  code: string;
  label: string;
  rate: number;
  treatment: TaxTreatment;
  is_override: boolean;
}

/**
 * Tax options for a business: the universal treatments, its region's
 * reference rates, and any rate it has defined itself. Only rates in
 * effect today are returned.
 */
export async function listTaxRates(ctx: BusinessContext): Promise<TaxRateOption[]> {
  const today = new Date().toISOString().slice(0, 10);
  const jurisdiction = ctx.business.tax_jurisdiction
    ?? (ctx.business.region ? `${ctx.business.country}-${ctx.business.region}` : ctx.business.country);

  const { data, error } = await ctx.db
    .from('tax_rates')
    .select('id, business_id, jurisdiction, code, label, rate, treatment, effective_from, effective_to')
    .eq('is_active', true)
    .lte('effective_from', today)
    .or(`business_id.eq.${ctx.businessId},business_id.is.null`)
    .order('rate', { ascending: false });

  if (error) {
    logError('invoice.tax_rates_failed', error, { businessId: ctx.businessId });
    return [];
  }

  return (data ?? [])
    .filter((r) => !r.effective_to || r.effective_to >= today)
    .filter((r) => r.jurisdiction === '*' || r.jurisdiction === jurisdiction || r.business_id === ctx.businessId)
    .map((r) => ({
      id: r.id,
      jurisdiction: r.jurisdiction,
      code: r.code,
      label: r.label,
      rate: Number(r.rate),
      treatment: r.treatment as TaxTreatment,
      is_override: r.business_id !== null,
    }));
}

// ── Booking -> invoice ──────────────────────────────────────

/**
 * Draft an invoice for a booking's outstanding commission.
 *
 * The invoice is for the COMMISSION. The gross booking value travels
 * as context in custom_fields and is never a line, so it can never
 * become revenue.
 */
export async function createInvoiceFromBooking(
  ctx: BusinessContext,
  bookingId: string,
  options: WriteOptions = {}
): Promise<{ invoice: InvoiceRow; lines: InvoiceLineRow[] }> {
  const booking = unwrapMaybe(
    await ctx.db
      .from('bookings')
      .select('id, reference, description, client_id, supplier_id, project_id, gross_value_minor, currency, booking_date, service_date, commission_rate, commission_expected_minor, commission_received_minor, commission_status, status')
      .eq('id', bookingId)
      .eq('business_id', ctx.businessId)
      .maybeSingle(),
    'find that booking'
  ) as {
    id: string;
    reference: string | null;
    description: string | null;
    client_id: string | null;
    supplier_id: string | null;
    project_id: string | null;
    gross_value_minor: number;
    currency: string;
    booking_date: string;
    service_date: string | null;
    commission_rate: number | null;
    commission_expected_minor: number;
    commission_received_minor: number;
    commission_status: string;
    status: string;
  } | null;
  if (!booking) throw new ServiceError('not_found', 'That booking could not be found.');

  if (booking.status === 'cancelled') {
    throw new ServiceError('conflict', 'That booking is cancelled.');
  }

  const outstanding =
    Number(booking.commission_expected_minor) - Number(booking.commission_received_minor);
  if (outstanding <= 0) {
    throw new ServiceError(
      'conflict',
      'There is no outstanding commission on this booking to invoice.'
    );
  }

  const existing = await ctx.db
    .from('invoices')
    .select('id, number, status')
    .eq('business_id', ctx.businessId)
    .eq('booking_id', bookingId)
    .not('status', 'in', '("void")')
    .limit(1);
  if (existing.data && existing.data.length > 0) {
    throw new ServiceError(
      'conflict',
      `Invoice ${existing.data[0].number ?? '(draft)'} already covers this booking.`
    );
  }

  const [supplier, client] = await Promise.all([
    booking.supplier_id
      ? ctx.db.from('counterparties').select('name').eq('id', booking.supplier_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    booking.client_id
      ? ctx.db.from('counterparties').select('name').eq('id', booking.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const ratePercent = booking.commission_rate ? Number(booking.commission_rate) * 100 : null;

  // Structured context. Informative on the document, inert in the maths.
  const customFields: Record<string, string> = {};
  if (booking.reference) customFields.booking_reference = booking.reference;
  if (client.data?.name) customFields.traveller = client.data.name;
  if (supplier.data?.name) customFields.supplier = supplier.data.name;
  if (booking.service_date) customFields.travel_date = booking.service_date;
  customFields.gross_booking_value =
    `${(Number(booking.gross_value_minor) / 100).toFixed(2)} ${booking.currency}`;
  if (ratePercent !== null) customFields.commission_rate = `${ratePercent}%`;

  const label = booking.reference ? ` — Booking ${booking.reference}` : '';

  return createInvoice(
    ctx,
    {
      // The agency that owes the commission. Left for the user to
      // confirm rather than guessed from the traveller.
      counterpartyId: null,
      sourceKind: 'commission',
      bookingId,
      projectId: booking.project_id,
      currency: booking.currency,
      lines: [
        {
          description: `Booking commission${label}`,
          quantity: 1,
          unitPriceMinor: outstanding,
          taxCode: 'NONE',
          taxRate: 0,
          taxTreatment: 'out_of_scope',
        },
      ],
      customFields,
    },
    options
  );
}

// ── Internals ───────────────────────────────────────────────

async function requireInvoice(ctx: BusinessContext, invoiceId: string): Promise<InvoiceRow> {
  const row = unwrapMaybe(
    await ctx.db
      .from('invoices')
      .select(INVOICE_COLUMNS)
      .eq('id', invoiceId)
      .eq('business_id', ctx.businessId)
      .maybeSingle(),
    'find that invoice'
  );
  if (!row) throw new ServiceError('not_found', 'That invoice could not be found.');
  return row as unknown as InvoiceRow;
}

async function loadLines(db: Db, invoiceId: string): Promise<InvoiceLineRow[]> {
  const { data, error } = await db
    .from('invoice_lines')
    .select(LINE_COLUMNS)
    .eq('invoice_id', invoiceId)
    .order('position');
  if (error) {
    throw new ServiceError('internal', 'Could not load the invoice lines.', {
      detail: error.message,
      cause: error,
    });
  }
  return (data ?? []) as unknown as InvoiceLineRow[];
}

function lineRowToInput(row: InvoiceLineRow): InvoiceLineInput {
  return {
    description: row.description,
    quantity: Number(row.quantity),
    unitPriceMinor: Number(row.unit_price_minor),
    taxCode: row.tax_code,
    taxLabel: row.tax_label,
    taxRate: Number(row.tax_rate),
    taxTreatment: row.tax_treatment,
    categoryId: row.category_id,
    projectId: row.project_id,
  };
}

/** Drafts only — the database refuses this once the invoice is issued. */
async function replaceLines(
  ctx: BusinessContext,
  invoiceId: string,
  totals: ReturnType<typeof computeInvoiceTotals>
): Promise<InvoiceLineRow[]> {
  assertOk(
    await ctx.db.from('invoice_lines').delete().eq('invoice_id', invoiceId),
    'update the invoice lines'
  );

  if (totals.lines.length === 0) return [];

  const rows = unwrap(
    await ctx.db
      .from('invoice_lines')
      .insert(
        totals.lines.map((l) => ({
          invoice_id: invoiceId,
          business_id: ctx.businessId,
          position: l.position,
          description: l.description,
          quantity: l.quantity,
          unit_price_minor: l.unitPriceMinor,
          subtotal_minor: l.subtotalMinor,
          discount_minor: l.discountMinor,
          tax_code: l.taxCode ?? null,
          tax_label: l.taxLabel ?? null,
          tax_rate: l.taxRate ?? 0,
          tax_treatment: (l.taxTreatment ?? 'standard') as never,
          tax_minor: l.taxMinor,
          total_minor: l.totalMinor,
          category_id: l.categoryId ?? null,
          project_id: l.projectId ?? null,
        }))
      )
      .select(LINE_COLUMNS),
    'save the invoice lines'
  ) as unknown as InvoiceLineRow[];

  return rows;
}

export async function logInvoiceEvent(
  ctx: BusinessContext,
  invoiceId: string,
  event: string,
  detail: unknown,
  options: WriteOptions = {}
): Promise<void> {
  const { error } = await ctx.db.from('invoice_events').insert({
    invoice_id: invoiceId,
    business_id: ctx.businessId,
    actor_user_id: ctx.userId,
    actor_type: options.actorType ?? 'user',
    event,
    detail: (detail ?? {}) as never,
  });
  // History is important but must never roll back the write it describes.
  if (error) {
    logError('invoice.event_write_failed', error, {
      businessId: ctx.businessId,
      invoiceId,
      event,
    });
  }
}

async function assertCounterparty(ctx: BusinessContext, counterpartyId: string): Promise<void> {
  const row = unwrapMaybe(
    await ctx.db
      .from('counterparties')
      .select('id')
      .eq('id', counterpartyId)
      .eq('business_id', ctx.businessId)
      .maybeSingle(),
    'find that client'
  );
  if (!row) throw new ServiceError('not_found', 'That client could not be found in this business.');
}

async function assertBooking(ctx: BusinessContext, bookingId: string): Promise<void> {
  const row = unwrapMaybe(
    await ctx.db
      .from('bookings')
      .select('id')
      .eq('id', bookingId)
      .eq('business_id', ctx.businessId)
      .maybeSingle(),
    'find that booking'
  );
  if (!row) throw new ServiceError('not_found', 'That booking could not be found in this business.');
}
