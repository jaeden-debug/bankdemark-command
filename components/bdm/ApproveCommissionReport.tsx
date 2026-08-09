'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ApproveCommissionReport({ businessId, documentId, count }: { businessId: string; documentId: string; count: number }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function approve() { setBusy(true); setMessage(null); try { const response = await fetch(`/api/commission-reports/${documentId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not approve this report.'); setMessage(data.idempotent ? 'Already approved.' : `${data.paymentCount} commission${data.paymentCount === 1 ? '' : 's'} marked paid.`); router.refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not approve this report.'); } finally { setBusy(false); } }
  if (count === 0) return null;
  return <div className="sticky bottom-20 rounded-panel border border-gold/50 bg-cream/95 p-4 shadow-float backdrop-blur lg:bottom-4"><button className="bdm-btn-gold w-full py-3" disabled={busy} onClick={approve}>{busy ? 'Approving…' : `Approve ${count} matched commission${count === 1 ? '' : 's'}`}</button>{message && <p className="mt-2 text-center text-sm text-ink" role="status">{message}</p>}</div>;
}
