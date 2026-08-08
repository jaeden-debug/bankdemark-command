'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoUpload({
  businessId,
  initialUrl,
  canBrand,
  planName,
}: {
  businessId: string;
  initialUrl: string | null;
  canBrand: boolean;
  planName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    // Optimistic local preview; replaced by the signed URL on success.
    const localPreview = URL.createObjectURL(file);
    setUrl(localPreview);
    try {
      const fd = new FormData();
      fd.set('businessId', businessId);
      fd.set('file', file);
      const res = await fetch('/api/invoices/logo', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not upload that image.');

      const signed = await fetch(`/api/invoices/logo?businessId=${businessId}`).then((r) => r.json());
      setUrl(signed.url ?? null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setUrl(initialUrl);
    } finally {
      URL.revokeObjectURL(localPreview);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/logo?businessId=${businessId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not remove the logo.');
      setUrl(null);
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="bdm-label">Logo</p>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-32 items-center justify-center overflow-hidden rounded-control border border-gold-line bg-white/70">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Your logo" className="max-h-16 max-w-28 object-contain" />
          ) : (
            <span className="text-xs text-muted">No logo</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <label className={`bdm-btn-secondary bdm-btn-sm ${canBrand && !busy ? 'cursor-pointer' : 'pointer-events-none opacity-60'}`}>
            {busy ? 'Uploading…' : url ? 'Replace' : 'Upload logo'}
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={!canBrand || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          </label>
          {url && canBrand && (
            <button type="button" onClick={remove} disabled={busy} className="bdm-btn-ghost bdm-btn-sm text-negative">
              Remove
            </button>
          )}
        </div>
      </div>

      <span className="bdm-hint">
        {canBrand
          ? 'PNG, JPG, WEBP or SVG, up to 2 MB. Appears on the invoice, the PDF and the client page.'
          : `Your logo on invoices is included from Starter. You are on ${planName}.`}
      </span>
      {error && <p role="alert" className="mt-1.5 text-sm font-semibold text-negative">{error}</p>}
    </div>
  );
}
