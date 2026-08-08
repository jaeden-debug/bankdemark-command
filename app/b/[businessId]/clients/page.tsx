import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import { listCounterparties, counterpartyInvoiceStats } from '@/lib/services/counterparties';
import ClientDirectory from '@/components/bdm/ClientDirectory';

export const dynamic = 'force-dynamic';

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: { businessId: string };
  searchParams: { next?: string };
}) {
  const ctx = await requireBusiness(params.businessId, 'viewer');

  const [clients, stats] = await Promise.all([
    listCounterparties(ctx),
    counterpartyInvoiceStats(ctx),
  ]);

  // Only ever an internal path — never trust a caller-supplied redirect.
  const returnTo =
    searchParams.next && /^\/b\/[0-9a-f-]+\/[\w/-]*$/i.test(searchParams.next)
      ? searchParams.next
      : undefined;

  return (
    <div className="bdm-page max-w-3xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="bdm-eyebrow">{ctx.business.name}</p>
          <h1 className="bdm-h1">Clients</h1>
          <p className="bdm-sub mt-1">Everyone you invoice, and everyone you buy from.</p>
        </div>
        <Link href={`/b/${ctx.businessId}/invoices`} className="bdm-btn-secondary bdm-btn-sm">
          Invoices
        </Link>
      </header>

      <ClientDirectory
        businessId={ctx.businessId}
        returnTo={returnTo}
        clients={clients.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          email: c.email,
          phone: c.phone,
          stats: stats.get(c.id),
        }))}
      />
    </div>
  );
}
