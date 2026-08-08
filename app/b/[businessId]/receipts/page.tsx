import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import ReceiptCapture from '@/components/bdm/ReceiptCapture';

export const dynamic = 'force-dynamic';

export default async function ReceiptsPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'member');

  const [accountsRes, categoriesRes] = await Promise.all([
    ctx.db.from('accounts').select('id, name, account_kind')
      .eq('business_id', ctx.businessId).eq('is_active', true).order('created_at'),
    ctx.db.from('categories').select('id, name, slug')
      .or(`business_id.eq.${ctx.businessId},business_id.is.null`)
      .eq('kind', 'expense').eq('is_active', true).order('sort_order'),
  ]);

  return (
    <div className="bdm-page max-w-2xl">
      <header className="mb-4">
        <Link href={`/b/${ctx.businessId}/transactions`} className="text-[13px] font-semibold text-muted hover:text-ink">
          ← Transactions
        </Link>
        <h1 className="bdm-h1 mt-2">Receipts</h1>
      </header>

      <ReceiptCapture
        businessId={ctx.businessId}
        currency={ctx.business.base_currency}
        accounts={accountsRes.data ?? []}
        categories={categoriesRes.data ?? []}
      />
    </div>
  );
}
