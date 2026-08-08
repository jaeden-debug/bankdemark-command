'use client';

// ============================================================
// INVOICE SETTINGS
//
// Every control here is wired to a real column that a real invoice
// reads. Gated controls are visibly disabled with the reason stated,
// rather than silently saving a value that is then ignored.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { InvoiceSettings, CustomFieldDef, TaxRateOption } from '@/lib/services/invoices';

interface Props {
  businessId: string;
  settings: InvoiceSettings;
  customFields: CustomFieldDef[];
  taxRates: TaxRateOption[];
  planName: string;
  canBrand: boolean;
  canTemplate: boolean;
  jurisdiction: string;
}

const TEMPLATES = [
  { key: 'clean', label: 'Clean', hint: 'Quiet and typographic' },
  { key: 'modern', label: 'Modern', hint: 'Accent banner, bolder headings' },
  { key: 'professional', label: 'Professional', hint: 'Ruled, formal, accountant-friendly' },
] as const;

export default function InvoiceSettingsForm(props: Props) {
  const router = useRouter();
  const [s, setS] = useState(props.settings);
  const [fields, setFields] = useState(props.customFields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof InvoiceSettings>(key: K, value: InvoiceSettings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/invoices/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: props.businessId,
          settings: {
            number_prefix: s.number_prefix,
            number_include_year: s.number_include_year,
            number_pad: s.number_pad,
            legal_name: s.legal_name,
            address_line1: s.address_line1,
            address_line2: s.address_line2,
            city: s.city,
            region: s.region,
            postal_code: s.postal_code,
            country: s.country,
            email: s.email,
            phone: s.phone,
            website: s.website,
            tax_number: s.tax_number,
            tax_number_label: s.tax_number_label,
            template: s.template,
            accent_color: s.accent_color,
            footer_text: s.footer_text,
            show_bdm_credit: s.show_bdm_credit,
            default_payment_terms: s.default_payment_terms,
            default_notes: s.default_notes,
            default_terms: s.default_terms,
            payment_instructions: s.payment_instructions,
            default_tax_code: s.default_tax_code,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save.');
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function addField(label: string, fieldType: string) {
    const res = await fetch('/api/invoices/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId: props.businessId,
        addCustomField: { label, fieldType },
      }),
    });
    const json = await res.json();
    if (res.ok) {
      setFields((prev) => [...prev, json.field]);
      router.refresh();
    } else {
      setError(json.error ?? 'Could not add that field.');
    }
  }

  async function removeField(id: string) {
    const res = await fetch('/api/invoices/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: props.businessId, removeCustomFieldId: id }),
    });
    if (res.ok) {
      setFields((prev) => prev.filter((f) => f.id !== id));
      router.refresh();
    }
  }

  const nextNumber = s.number_include_year
    ? `${s.number_prefix}-${new Date().getFullYear()}-${String(s.next_sequence).padStart(s.number_pad, '0')}`
    : `${s.number_prefix}-${String(s.next_sequence).padStart(s.number_pad, '0')}`;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-panel border border-negative/25 bg-negative-soft p-3">
          <p className="text-sm font-semibold text-negative">{error}</p>
        </div>
      )}

      {/* ── Identity ── */}
      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-1">Your details on the invoice</h2>
        <p className="bdm-sub mb-4 text-xs">
          These are copied onto each invoice when you issue it. Changing them later never alters an
          invoice you have already issued.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business / legal name" value={s.legal_name} onChange={(v) => set('legal_name', v)} placeholder="As it should appear on the invoice" />
          <Field label="Email" type="email" value={s.email} onChange={(v) => set('email', v)} />
          <Field label="Address" value={s.address_line1} onChange={(v) => set('address_line1', v)} />
          <Field label="Address line 2" value={s.address_line2} onChange={(v) => set('address_line2', v)} />
          <Field label="City" value={s.city} onChange={(v) => set('city', v)} />
          <Field label="Province / region" value={s.region} onChange={(v) => set('region', v)} />
          <Field label="Postal code" value={s.postal_code} onChange={(v) => set('postal_code', v)} />
          <Field label="Phone" value={s.phone} onChange={(v) => set('phone', v)} />
          <Field label="Tax number label" value={s.tax_number_label} onChange={(v) => set('tax_number_label', v ?? '')} placeholder="GST/HST" />
          <Field label="Tax number" value={s.tax_number} onChange={(v) => set('tax_number', v)} placeholder="123456789 RT0001" />
        </div>
      </section>

      {/* ── Numbering ── */}
      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-1">Invoice numbering</h2>
        <p className="bdm-sub mb-4 text-xs">
          Numbers are assigned by the server when you issue an invoice, so two people working at
          once can never produce the same one. Issued numbers are never reused.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="bdm-label" htmlFor="prefix">Prefix</label>
            <input
              id="prefix" className="bdm-input" maxLength={8}
              value={s.number_prefix}
              onChange={(e) => set('number_prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </div>
          <div>
            <label className="bdm-label" htmlFor="pad">Digits</label>
            <select id="pad" className="bdm-select" value={s.number_pad} onChange={(e) => set('number_pad', Number(e.target.value))}>
              {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="bdm-label" htmlFor="year">Include year</label>
            <select
              id="year" className="bdm-select"
              value={s.number_include_year ? 'yes' : 'no'}
              onChange={(e) => set('number_include_year', e.target.value === 'yes')}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>
        <p className="bdm-hint mt-2">Next invoice will be <strong className="text-ink">{nextNumber}</strong></p>
      </section>

      {/* ── Appearance ── */}
      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-1">Appearance</h2>
        <p className="bdm-sub mb-4 text-xs">Applied to the PDF and the client-facing page.</p>

        <fieldset disabled={!props.canTemplate} className="disabled:opacity-60">
          <legend className="bdm-label">Template</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <label
                key={t.key}
                className={`cursor-pointer rounded-panel border p-3 transition-colors ${
                  s.template === t.key ? 'border-gold bg-gold-tint' : 'border-gold-line bg-white/60'
                }`}
              >
                <input
                  type="radio" name="template" className="sr-only"
                  checked={s.template === t.key}
                  onChange={() => set('template', t.key)}
                />
                <span className="block text-sm font-bold text-ink">{t.label}</span>
                <span className="block text-xs text-muted">{t.hint}</span>
              </label>
            ))}
          </div>
          {!props.canTemplate && (
            <p className="bdm-hint mt-1.5">
              Templates are included from Starter. You are on {props.planName}.
            </p>
          )}
        </fieldset>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="bdm-label" htmlFor="accent">Accent colour</label>
            <div className="flex items-center gap-2">
              <input
                id="accent" type="color" className="h-10 w-14 rounded-control border border-gold-line"
                value={s.accent_color}
                disabled={!props.canTemplate}
                onChange={(e) => set('accent_color', e.target.value)}
              />
              <input
                className="bdm-input font-mono" value={s.accent_color}
                disabled={!props.canTemplate}
                onChange={(e) => set('accent_color', e.target.value)}
              />
            </div>
          </div>
          <Field label="Footer text" value={s.footer_text} onChange={(v) => set('footer_text', v)} placeholder="Thank you for your business" />
        </div>

        <label className={`mt-4 flex items-start gap-2.5 ${props.canBrand ? '' : 'opacity-60'}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gold-line"
            checked={!s.show_bdm_credit}
            disabled={!props.canBrand}
            onChange={(e) => set('show_bdm_credit', !e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-ink">Remove the BankDeMark credit</span>
            <span className="block text-xs text-muted">
              {props.canBrand
                ? 'Your invoice shows only your branding.'
                : `Included from Starter. You are on ${props.planName}.`}
            </span>
          </span>
        </label>
      </section>

      {/* ── Defaults ── */}
      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-4">Defaults for new invoices</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="bdm-label" htmlFor="deftax">Default tax</label>
            <select
              id="deftax" className="bdm-select"
              value={s.default_tax_code ?? 'NONE'}
              onChange={(e) => set('default_tax_code', e.target.value)}
            >
              {props.taxRates.map((t) => (
                <option key={t.id} value={t.code}>{t.label}</option>
              ))}
            </select>
            <span className="bdm-hint">
              Rates shown are for {props.jurisdiction}, effective today.
            </span>
          </div>
          <div>
            <label className="bdm-label" htmlFor="defterms">Default payment terms</label>
            <select
              id="defterms" className="bdm-select"
              value={s.default_payment_terms}
              onChange={(e) => set('default_payment_terms', e.target.value)}
            >
              {['due_on_receipt', 'net_7', 'net_14', 'net_15', 'net_30', 'net_45', 'net_60', 'net_90'].map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="bdm-label" htmlFor="payinst">How clients pay you</label>
            <textarea
              id="payinst" className="bdm-textarea"
              placeholder="EFT to Example Bank, transit 00001, account 1234567 — or e-transfer to billing@yourbusiness.com"
              value={s.payment_instructions ?? ''}
              onChange={(e) => set('payment_instructions', e.target.value)}
            />
          </div>
          <div>
            <label className="bdm-label" htmlFor="defnotes">Default notes</label>
            <textarea id="defnotes" className="bdm-textarea" value={s.default_notes ?? ''} onChange={(e) => set('default_notes', e.target.value)} />
          </div>
          <div>
            <label className="bdm-label" htmlFor="defterms2">Default terms</label>
            <textarea id="defterms2" className="bdm-textarea" value={s.default_terms ?? ''} onChange={(e) => set('default_terms', e.target.value)} />
          </div>
        </div>
      </section>

      {/* ── Custom fields ── */}
      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-1">Reference fields</h2>
        <p className="bdm-sub mb-4 text-xs">
          Structured context that appears on every invoice — booking reference, PO number, matter
          number. These are shown to the client but never change the amount.
        </p>

        {fields.length > 0 && (
          <ul className="mb-4 space-y-2">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 rounded-panel border border-gold-line bg-white/60 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{f.label}</p>
                  <p className="text-xs text-muted">{f.field_type} · <code className="font-mono">{f.key}</code></p>
                </div>
                <button type="button" onClick={() => removeField(f.id)} className="bdm-btn-ghost bdm-btn-sm text-negative">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const label = String(fd.get('label') ?? '').trim();
            if (!label) return;
            void addField(label, String(fd.get('type') ?? 'text'));
            e.currentTarget.reset();
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input name="label" className="bdm-input flex-1" placeholder="Field name, e.g. Booking reference" aria-label="New field name" />
          <select name="type" className="bdm-select sm:w-40" aria-label="Field type" defaultValue="text">
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="date_range">Date range</option>
            <option value="currency">Currency</option>
            <option value="percent">Percent</option>
          </select>
          <button type="submit" className="bdm-btn-secondary">Add field</button>
        </form>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="bdm-btn-gold">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span role="status" className="text-sm font-semibold text-positive">Saved.</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  type?: string;
}) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div>
      <label className="bdm-label" htmlFor={id}>{label}</label>
      <input
        id={id} type={type} className="bdm-input" placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  );
}
