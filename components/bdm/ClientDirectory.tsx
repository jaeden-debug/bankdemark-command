'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMinor } from '@/lib/domain/money';

export interface DirectoryClient {
  id: string;
  name: string;
  kind: string;
  email: string | null;
  phone: string | null;
  stats?: { currency: string; billedMinor: number; outstandingMinor: number; count: number };
}

export default function ClientDirectory({
  businessId,
  clients,
  returnTo,
}: {
  businessId: string;
  clients: DirectoryClient[];
  /** Where to go after adding the first client — usually back to the invoice. */
  returnTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>, id?: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/counterparties', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          id,
          name: String(fd.get('name') ?? ''),
          kind: String(fd.get('kind') ?? 'customer'),
          email: String(fd.get('email') ?? '') || null,
          phone: String(fd.get('phone') ?? '') || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save that client.');
      form.reset();
      setEditing(null);
      if (!id && returnTo) router.push(returnTo);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string, name: string) {
    if (!confirm(`Archive ${name}? Invoices already sent to them are unaffected.`)) return;
    setBusy(true);
    await fetch('/api/counterparties', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, action: 'archive' }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-panel border border-negative/25 bg-negative-soft p-3">
          <p className="text-sm font-semibold text-negative">{error}</p>
        </div>
      )}

      <section className="bdm-card p-5">
        <h2 className="bdm-h2 mb-1">Add a client</h2>
        <p className="bdm-sub mb-4 text-xs">
          The agency or customer you bill. An email address is needed to send them an invoice.
        </p>
        <form onSubmit={(e) => submit(e)} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="bdm-label" htmlFor="c-name">Name *</label>
            <input id="c-name" name="name" required className="bdm-input" placeholder="Example Host Agency" />
          </div>
          <div>
            <label className="bdm-label" htmlFor="c-email">Email</label>
            <input id="c-email" name="email" type="email" className="bdm-input" placeholder="ap@agency.com" />
          </div>
          <div>
            <label className="bdm-label" htmlFor="c-phone">Phone</label>
            <input id="c-phone" name="phone" className="bdm-input" />
          </div>
          <div>
            <label className="bdm-label" htmlFor="c-kind">Type</label>
            <select id="c-kind" name="kind" className="bdm-select" defaultValue="customer">
              <option value="customer">Client / agency (you invoice them)</option>
              <option value="supplier">Supplier / resort</option>
              <option value="vendor">Vendor (you pay them)</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className="bdm-btn-gold w-full sm:w-auto">
              {busy ? 'Saving…' : 'Add client'}
            </button>
          </div>
        </form>
      </section>

      {clients.length > 0 && (
        <section className="bdm-card overflow-hidden">
          <div className="border-b border-gold-line px-5 py-4">
            <h2 className="bdm-h2">
              {clients.length} {clients.length === 1 ? 'client' : 'clients'}
            </h2>
          </div>
          <ul className="divide-y divide-gold-line/60">
            {clients.map((c) => (
              <li key={c.id} className="px-5 py-4">
                {editing === c.id ? (
                  <form onSubmit={(e) => submit(e, c.id)} className="grid gap-2 sm:grid-cols-2">
                    <input name="name" required defaultValue={c.name} className="bdm-input" aria-label="Name" />
                    <input name="email" type="email" defaultValue={c.email ?? ''} className="bdm-input" aria-label="Email" />
                    <input name="phone" defaultValue={c.phone ?? ''} className="bdm-input" aria-label="Phone" />
                    <select name="kind" defaultValue={c.kind} className="bdm-select" aria-label="Type">
                      <option value="customer">Client / agency</option>
                      <option value="supplier">Supplier</option>
                      <option value="vendor">Vendor</option>
                      <option value="other">Other</option>
                    </select>
                    <div className="flex gap-2 sm:col-span-2">
                      <button type="submit" disabled={busy} className="bdm-btn-gold bdm-btn-sm">Save</button>
                      <button type="button" onClick={() => setEditing(null)} className="bdm-btn-ghost bdm-btn-sm">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{c.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {c.email ?? 'No email — cannot be sent invoices'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </p>
                      {c.stats && c.stats.count > 0 && (
                        <p className="mt-1 text-xs text-muted">
                          {c.stats.billedMinor < 0
                            ? `${c.stats.count} invoices across multiple currencies`
                            : `${formatMinor(c.stats.billedMinor, c.stats.currency)} billed` +
                              (c.stats.outstandingMinor > 0
                                ? ` · ${formatMinor(c.stats.outstandingMinor, c.stats.currency)} outstanding`
                                : '')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => setEditing(c.id)} className="bdm-btn-ghost bdm-btn-sm">
                        Edit
                      </button>
                      <button type="button" onClick={() => archive(c.id, c.name)} disabled={busy} className="bdm-btn-ghost bdm-btn-sm">
                        Archive
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
