'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CommissionReportUpload({ businessId }: { businessId: string }) {
  const router = useRouter(); const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function upload(file: File) {
    setBusy(true); setError(null);
    try {
      const form = new FormData(); form.append('businessId', businessId); form.append('file', file); form.append('docType', 'commission_report');
      const response = await fetch('/api/documents', { method: 'POST', body: form }); const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not upload that report.');
      if (!data.document?.id) throw new Error(data.message || 'No report was created.');
      if (!data.report && !data.duplicate) throw new Error(data.message || 'No commission rows could be read.');
      router.push(`/b/${businessId}/commission-reports/${data.document.id}`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload that report.'); setBusy(false); }
  }
  return <div className="space-y-3"><div className="bdm-card p-7 text-center"><h2 className="bdm-h2">Upload commission report</h2><p className="bdm-sub mx-auto mt-2 max-w-md">Use a clear screenshot or image. BankDeMark extracts the rows, then deterministic rules match them to your bookings.</p><button type="button" className="bdm-btn-gold mt-6 w-full py-3.5 sm:w-auto" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading report…' : 'Choose report image'}</button><input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} /><p className="mt-3 text-xs text-muted">JPG, PNG or WEBP · up to 15 MB</p></div>{error && <p role="alert" className="rounded-control bg-negative-soft p-3 text-sm text-negative">{error}</p>}</div>;
}
