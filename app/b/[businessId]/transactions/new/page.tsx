import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import TransactionForm from '@/components/bdm/TransactionForm';
import type { TransactionKind } from '@/lib/domain/semantics';

export const dynamic = 'force-dynamic';

export default async function NewTransactionPage({
  params, searchParams,
}: { params: { businessId: string }; searchParams: { kind?: string } }) {
  const ctx = await requireBusiness(params.businessId, 'member');

  const [accountsRes, categoriesRes, brandsRes] = await Promise.all([
    ctx.db.from('accounts').select('id, name, account_kind')
      .eq('business_id', ctx.businessId).eq('is_active', true).order('created_at'),
    ctx.db.from('categories').select('id, name, kind, slug')
      .or(`business_id.eq.${ctx.businessId},business_id.is.null`).eq('is_active', true).order('sort_order'),
    ctx.db.from('brands').select('id, name')
      .eq('business_id', ctx.businessId).eq('is_active', true).order('sort_order'),
  ]);

  return (
    <div className="bdm-page max-w-2xl">
      <header className="mb-4">
        <Link href={`/b/${ctx.businessId}/transactions`} className="text-[13px] font-semibold text-muted hover:text-ink">
          ← Transactions
        </Link>
        <h1 className="bdm-h1 mt-2">Record a transaction</h1>
        <p className="bdm-sub mt-1">Everything you add here feeds your dashboard and reports straight away.</p>
      </header>

      <TransactionForm
        businessId={ctx.businessId}
        businessType={ctx.business.business_type}
        currency={ctx.business.base_currency}
        earnsCommissions={ctx.business.earns_commissions}
        accounts={accountsRes.data ?? []}
        categories={categoriesRes.data ?? []}
        brands={brandsRes.data ?? []}
        initialKind={(searchParams.kind as TransactionKind) || undefined}
      />
    </div>
  );
}
