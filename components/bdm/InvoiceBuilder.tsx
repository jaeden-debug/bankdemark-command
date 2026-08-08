'use client';

// ============================================================
// INVOICE BUILDER
//
// The preview here and the stored totals come from the SAME pure
// function (lib/domain/invoice.ts), so what the user sees while typing
// is exactly what the server computes and stores. No second
// implementation to drift.
//
// Money is entered as text and parsed with parseMajorToMinor — never
// `Number(x) * 100`, which is wrong for values like 1.005.
// ============================================================

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeInvoiceTotals, dueDateFor, PAYMENT_TERMS, type TaxTreatment } from '@/lib/domain/invoice';
import { formatMinor, parseMajorToMinor, minorToMajor } from '@/lib/domain/money';

export interface BuilderCounterparty {
  id: string;
  name: string;
  email: string | null;
}

export interface BuilderTaxRate {
  id: string;
  code: string;
  label: string;
  rate: number;
  treatment: TaxTreatment;
}

export interface BuilderCustomField {
  id: string;
  key: string;
  label: string;
  field_type: string;
  help_text: string | null;
}

export interface BuilderBusinessIdentity {
  name: string;
  addressLines: string[];
  email: string | null;
  taxNumber: string | null;
  taxNumberLabel: string;
}

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxCode: string;
}

export interface InvoiceBuilderProps {
  businessId: string;
  currency: string;
  identity: BuilderBusinessIdentity;
  counterparties: BuilderCounterparty[];
  taxRates: BuilderTaxRate[];
  customFields: BuilderCustomField[];
  defaults: {
    paymentTerms: string;
    notes: string | null;
    terms: string | null;
    paymentInstructions: string | null;
    taxCode: string | null;
  };
  /** Present when editing an existing draft. */
  existing?: {
    id: string;
    counterpartyId: string | null;
    issueDate: string;
    dueDate: string;
    paymentTerms: string | null;
    lines: Array<{
      description: string;
      quantity: number;
      unit_price_minor: number;
      tax_code: string | null;
    }>;
    discountKind: 'percentage' | 'fixed';
    discountValue: number;
    notes: string | null;
    terms: string | null;
    paymentInstructions: string | null;
    customFields: Record<string, string>;
  };
  /** Context carried from a booking, shown read-only above the lines. */
  sourceNote?: string | null;
}

let keyCounter = 0;
const nextKey = () => `line_${(keyCounter += 1)}`;

export default function InvoiceBuilder(props: InvoiceBuilderProps) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [counterpartyId, setCounterpartyId] = useState(props.existing?.counterpartyId ?? '');
  const [issueDate, setIssueDate] = useState(props.existing?.issueDate ?? today);
  const [paymentTerms, setPaymentTerms] = useState(
    props.existing?.paymentTerms ?? props.defaults.paymentTerms
  );
  const [dueDate, setDueDate] = useState(
    props.existing?.dueDate ?? dueDateFor(today, props.defaults.paymentTerms)
  );
  const [discountKind, setDiscountKind] = useState<'percentage' | 'fixed'>(
    props.existing?.discountKind ?? 'percentage'
  );
  const [discountValue, setDiscountValue] = useState(
    props.existing
      ? props.existing.discountKind === 'fixed'
        ? String(minorToMajor(props.existing.discountValue, props.currency))
        : String(props.existing.discountValue)
      : ''
  );
  const [notes, setNotes] = useState(props.existing?.notes ?? props.defaults.notes ?? '');
  const [terms, setTerms] = useState(props.existing?.terms ?? props.defaults.terms ?? '');
  const [paymentInstructions, setPaymentInstructions] = useState(
    props.existing?.paymentInstructions ?? props.defaults.paymentInstructions ?? ''
  );
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    props.existing?.customFields ?? {}
  );
  const [showFooter, setShowFooter] = useState(false);

  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (props.existing?.lines.length) {
      return props.existing.lines.map((l) => ({
        key: nextKey(),
        description: l.description,
        quantity: String(l.quantity),
        unitPrice: minorToMajor(l.unit_price_minor, props.currency).toFixed(2),
        taxCode: l.tax_code ?? props.defaults.taxCode ?? 'NONE',
      }));
    }
    return [
      {
        key: nextKey(),
        description: '',
        quantity: '1',
        unitPrice: '',
        taxCode: props.defaults.taxCode ?? 'NONE',
      },
    ];
  });

  const [saving, setSaving] = useState<null | 'draft' | 'issue'>(null);
  const [error, setError] = useState<string | null>(null);

  const taxByCode = useMemo(
    () => new Map(props.taxRates.map((t) => [t.code, t])),
    [props.taxRates]
  );

  // Same engine the server uses. Bad input contributes zero rather
  // than throwing while the user is mid-keystroke.
  const totals = useMemo(() => {
    const inputs = lines.map((l) => {
      const tax = taxByCode.get(l.taxCode);
      let unitPriceMinor = 0;
      try {
        unitPriceMinor = l.unitPrice.trim() ? parseMajorToMinor(l.unitPrice, props.currency) : 0;
      } catch {
        unitPriceMinor = 0;
      }
      const quantity = Number(l.quantity);
      return {
        description: l.description,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unitPriceMinor,
        taxCode: tax?.code ?? 'NONE',
        taxLabel: tax?.label ?? null,
        taxRate: tax?.rate ?? 0,
        taxTreatment: (tax?.treatment ?? 'out_of_scope') as TaxTreatment,
      };
    });

    let discount = 0;
    try {
      if (discountValue.trim()) {
        discount =
          discountKind === 'fixed'
            ? parseMajorToMinor(discountValue, props.currency)
            : Number(discountValue);
      }
    } catch {
      discount = 0;
    }

    try {
      return computeInvoiceTotals(inputs, {
        currency: props.currency,
        discountKind,
        discountValue: discount,
      });
    } catch {
      return computeInvoiceTotals([], { currency: props.currency });
    }
  }, [lines, discountKind, discountValue, props.currency, taxByCode]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        description: '',
        quantity: '1',
        unitPrice: '',
        taxCode: props.defaults.taxCode ?? 'NONE',
      },
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  function handleTermsChange(value: string) {
    setPaymentTerms(value);
    if (PAYMENT_TERMS[value]?.days !== null && PAYMENT_TERMS[value]?.days !== undefined) {
      setDueDate(dueDateFor(issueDate, value));
    }
  }

  function handleIssueDateChange(value: string) {
    setIssueDate(value);
    if (PAYMENT_TERMS[paymentTerms]?.days !== null) {
      setDueDate(dueDateFor(value, paymentTerms));
    }
  }

  async function save(mode: 'draft' | 'issue') {
    setSaving(mode);
    setError(null);

    try {
      const payloadLines = lines
        .filter((l) => l.description.trim())
        .map((l) => {
          const tax = taxByCode.get(l.taxCode);
          return {
            description: l.description.trim(),
            quantity: Number(l.quantity) || 0,
            unitPriceMinor: l.unitPrice.trim()
              ? parseMajorToMinor(l.unitPrice, props.currency)
              : 0,
            taxCode: tax?.code ?? 'NONE',
            taxLabel: tax?.label ?? null,
            taxRate: tax?.rate ?? 0,
            taxTreatment: tax?.treatment ?? 'out_of_scope',
          };
        });

      if (payloadLines.length === 0) {
        throw new Error('Add at least one line item with a description.');
      }
      if (mode === 'issue' && !counterpartyId) {
        throw new Error('Choose who this invoice is for before issuing it.');
      }

      const body = {
        businessId: props.businessId,
        counterpartyId: counterpartyId || null,
        issueDate,
        dueDate,
        paymentTerms,
        currency: props.currency,
        lines: payloadLines,
        discountKind,
        discountValue: discountValue.trim()
          ? discountKind === 'fixed'
            ? parseMajorToMinor(discountValue, props.currency)
            : Number(discountValue)
          : 0,
        notes: notes || null,
        terms: terms || null,
        paymentInstructions: paymentInstructions || null,
        customFields: customValues,
      };

      const res = props.existing
        ? await fetch(`/api/invoices/${props.existing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, action: 'update' }),
          })
        : await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save this invoice.');

      const invoiceId = json.invoice.id as string;

      if (mode === 'issue') {
        const issueRes = await fetch(`/api/invoices/${invoiceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId: props.businessId, action: 'issue' }),
        });
        const issueJson = await issueRes.json();
        if (!issueRes.ok) throw new Error(issueJson.error ?? 'Could not issue this invoice.');
      }

      router.push(`/b/${props.businessId}/invoices/${invoiceId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setSaving(null);
    }
  }

  const selectedClient = props.counterparties.find((c) => c.id === counterpartyId);

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-panel border border-negative/25 bg-negative-soft p-4">
          <p className="text-sm font-semibold text-negative">{error}</p>
        </div>
      )}

      {/* ── From / invoice meta ── */}
      <section className="bdm-card p-5">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h2 className="bdm-eyebrow mb-2">From</h2>
            <p className="text-sm font-bold text-ink">{props.identity.name}</p>
            {props.identity.addressLines.map((l) => (
              <p key={l} className="text-sm text-muted">{l}</p>
            ))}
            {props.identity.email && <p className="text-sm text-muted">{props.identity.email}</p>}
            {props.identity.taxNumber && (
              <p className="mt-1 text-xs text-muted">
                {props.identity.taxNumberLabel}: {props.identity.taxNumber}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="bdm-label" htmlFor="inv-client">Bill to</label>
              <select
                id="inv-client"
                className="bdm-select"
                value={counterpartyId}
                onChange={(e) => setCounterpartyId(e.target.value)}
              >
                <option value="">— Choose a client —</option>
                {props.counterparties.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {selectedClient && !selectedClient.email && (
                <span className="bdm-hint">
                  This client has no email address, so the invoice cannot be emailed yet.
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="bdm-label" htmlFor="inv-issue">Issue date</label>
                <input
                  id="inv-issue" type="date" className="bdm-input"
                  value={issueDate}
                  onChange={(e) => handleIssueDateChange(e.target.value)}
                />
              </div>
              <div>
                <label className="bdm-label" htmlFor="inv-due">Due date</label>
                <input
                  id="inv-due" type="date" className="bdm-input"
                  value={dueDate} min={issueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="bdm-label" htmlFor="inv-terms">Payment terms</label>
              <select
                id="inv-terms" className="bdm-select"
                value={paymentTerms}
                onChange={(e) => handleTermsChange(e.target.value)}
              >
                {Object.entries(PAYMENT_TERMS).map(([key, t]) => (
                  <option key={key} value={key}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* ── Custom fields ── */}
      {props.customFields.length > 0 && (
        <section className="bdm-card p-5">
          <h2 className="bdm-eyebrow mb-1">Reference details</h2>
          <p className="bdm-sub mb-3 text-xs">
            Shown on the invoice for context. These never change the amount.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {props.customFields.map((f) => (
              <div key={f.id}>
                <label className="bdm-label" htmlFor={`cf-${f.key}`}>{f.label}</label>
                <input
                  id={`cf-${f.key}`}
                  className="bdm-input"
                  type={f.field_type === 'date' ? 'date' : 'text'}
                  value={customValues[f.key] ?? ''}
                  onChange={(e) =>
                    setCustomValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                />
                {f.help_text && <span className="bdm-hint">{f.help_text}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {props.sourceNote && (
        <div className="rounded-panel border border-gold-line bg-gold-tint p-4">
          <p className="text-sm text-ink">{props.sourceNote}</p>
        </div>
      )}

      {/* ── Line items ── */}
      <section className="bdm-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gold-line px-5 py-4">
          <h2 className="bdm-h2">Line items</h2>
          <span className="text-xs text-muted">{props.currency}</span>
        </div>

        {/* Desktop column headers */}
        <div className="hidden grid-cols-12 gap-3 border-b border-gold-line/60 bg-ink/[0.02] px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-muted sm:grid">
          <div className="col-span-5">Description</div>
          <div className="col-span-2 text-right">Qty</div>
          <div className="col-span-2 text-right">Rate</div>
          <div className="col-span-2">Tax</div>
          <div className="col-span-1 text-right">Amount</div>
        </div>

        <ul className="divide-y divide-gold-line/60">
          {lines.map((line, i) => {
            const computed = totals.lines[i];
            return (
              <li key={line.key} className="px-5 py-4">
                <div className="grid grid-cols-12 gap-3">
                  <div className="col-span-12 sm:col-span-5">
                    <label className="bdm-label sm:sr-only" htmlFor={`d-${line.key}`}>
                      Description
                    </label>
                    <textarea
                      id={`d-${line.key}`}
                      className="bdm-textarea min-h-[62px]"
                      placeholder="What are you billing for?"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    />
                  </div>

                  <div className="col-span-4 sm:col-span-2">
                    <label className="bdm-label sm:sr-only" htmlFor={`q-${line.key}`}>Qty</label>
                    <input
                      id={`q-${line.key}`}
                      className="bdm-input text-right"
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    />
                  </div>

                  <div className="col-span-8 sm:col-span-2">
                    <label className="bdm-label sm:sr-only" htmlFor={`p-${line.key}`}>Rate</label>
                    <input
                      id={`p-${line.key}`}
                      className="bdm-input text-right"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.unitPrice}
                      onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                    />
                  </div>

                  <div className="col-span-8 sm:col-span-2">
                    <label className="bdm-label sm:sr-only" htmlFor={`t-${line.key}`}>Tax</label>
                    <select
                      id={`t-${line.key}`}
                      className="bdm-select"
                      value={line.taxCode}
                      onChange={(e) => updateLine(line.key, { taxCode: e.target.value })}
                    >
                      {props.taxRates.map((t) => (
                        <option key={t.id} value={t.code}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-4 flex flex-col items-end justify-center sm:col-span-1">
                    <span className="bdm-num text-sm font-bold text-ink">
                      {formatMinor(computed?.totalMinor ?? 0, props.currency, { showMinor: true })}
                    </span>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="mt-1 text-xs font-semibold text-muted hover:text-negative"
                        aria-label={`Remove line ${i + 1}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-gold-line/60 px-5 py-3">
          <button type="button" onClick={addLine} className="bdm-btn-ghost bdm-btn-sm">
            + Add line
          </button>
        </div>
      </section>

      {/* ── Totals ── */}
      <section className="bdm-card p-5">
        <div className="ml-auto max-w-sm space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <label className="bdm-label mb-0" htmlFor="inv-discount">Discount</label>
            <div className="flex items-center gap-2">
              <select
                className="bdm-select w-24 py-1.5 text-[13px]"
                value={discountKind}
                onChange={(e) => setDiscountKind(e.target.value as 'percentage' | 'fixed')}
                aria-label="Discount type"
              >
                <option value="percentage">%</option>
                <option value="fixed">{props.currency}</option>
              </select>
              <input
                id="inv-discount"
                className="bdm-input w-28 py-1.5 text-right text-[14px]"
                inputMode="decimal"
                placeholder="0"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </div>
          </div>

          <div className="bdm-divider" />

          <Row label="Subtotal" value={formatMinor(totals.subtotalMinor, props.currency, { showMinor: true })} />
          {totals.discountMinor > 0 && (
            <Row
              label="Discount"
              value={`−${formatMinor(totals.discountMinor, props.currency, { showMinor: true })}`}
              tone="positive"
            />
          )}
          {totals.taxLines.map((t) => (
            <Row
              key={`${t.code}-${t.rate}`}
              label={t.treatment === 'standard' ? t.label : `${t.label} (0%)`}
              value={formatMinor(t.taxMinor, props.currency, { showMinor: true })}
            />
          ))}

          <div className="bdm-divider" />
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-ink">Total</span>
            <span className="bdm-num text-xl font-extrabold text-ink">
              {formatMinor(totals.totalMinor, props.currency, { showMinor: true })}
            </span>
          </div>
        </div>
      </section>

      {/* ── Notes / terms / payment instructions ── */}
      <section className="bdm-card p-5">
        <button
          type="button"
          onClick={() => setShowFooter((v) => !v)}
          aria-expanded={showFooter}
          className="flex w-full items-center gap-2 text-sm font-semibold text-muted hover:text-ink"
        >
          <span aria-hidden className={showFooter ? 'rotate-90 transition-transform' : 'transition-transform'}>›</span>
          Notes, terms and payment instructions
        </button>

        {showFooter && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="bdm-label" htmlFor="inv-notes">Notes to the client</label>
              <textarea id="inv-notes" className="bdm-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <label className="bdm-label" htmlFor="inv-payment">How to pay</label>
              <textarea
                id="inv-payment" className="bdm-textarea"
                placeholder="e.g. EFT to Example Bank, transit 00001, account 1234567"
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="bdm-label" htmlFor="inv-terms-text">Terms</label>
              <textarea id="inv-terms-text" className="bdm-textarea" value={terms} onChange={(e) => setTerms(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      {/* ── Actions ── */}
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={() => save('draft')}
          disabled={saving !== null}
          className="bdm-btn-secondary flex-1"
        >
          {saving === 'draft' ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={() => save('issue')}
          disabled={saving !== null}
          className="bdm-btn-gold flex-1"
        >
          {saving === 'issue' ? 'Issuing…' : 'Issue invoice'}
        </button>
      </div>

      <p className="text-center text-xs text-muted">
        Issuing assigns a permanent invoice number and locks the amounts. After that, corrections
        are made by voiding it or issuing a credit note.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive';
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className={`bdm-num font-semibold ${tone === 'positive' ? 'text-positive' : 'text-ink'}`}>
        {value}
      </span>
    </div>
  );
}
