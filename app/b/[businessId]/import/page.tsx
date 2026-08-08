import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import ImportWizard from '@/components/bdm/ImportWizard';

export const dynamic = 'force-dynamic';

export default async function ImportPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'member');

  const { data: accounts } = await ctx.db
    .from('accounts')
    .select('id, name, account_kind')
    .eq('business_id', ctx.businessId)
    .eq('is_active', true)
    .order('created_at');

  return (
    <div className="bdm-page max-w-2xl">
      <header className="mb-4">
        <Link href={`/b/${ctx.businessId}/transactions`} className="text-[13px] font-semibold text-muted hover:text-ink">
          ← Transactions
        </Link>
        <h1 className="bdm-h1 mt-2">Import from a file</h1>
        <p className="bdm-sub mt-1">
          Nothing is saved until you&apos;ve seen exactly what will land.
        </p>
      </header>

      <ImportWizard
        businessId={ctx.businessId}
        currency={ctx.business.base_currency}
        accounts={accounts ?? []}
      />
    </div>
  );
}
