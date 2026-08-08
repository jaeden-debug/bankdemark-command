import { requireBusiness } from '@/lib/services/context';
import ZylxChat from '@/components/bdm/ZylxChat';

export const dynamic = 'force-dynamic';

function suggestionsFor(businessType: string, earnsCommissions: boolean, hasData: boolean): string[] {
  if (!hasData) {
    return [
      'What should I record first?',
      'What is the difference between revenue and profit?',
      'How should I categorise a transfer between my accounts?',
    ];
  }
  const base = [
    'How much did I actually make last month?',
    'What did I spend the most on?',
    'Why is cash down if revenue is up?',
    'What needs my attention?',
  ];
  if (earnsCommissions) base.splice(2, 0, 'How much commission am I still owed?');
  if (businessType === 'agency') base.push('Which project was most profitable?');
  return base;
}

export default async function ZylxPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'viewer');

  const { count } = await ctx.db
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', ctx.businessId)
    .is('deleted_at', null);

  const hasData = (count ?? 0) > 0;

  return (
    <div className="bdm-page max-w-3xl">
      <header className="mb-4">
        <p className="bdm-eyebrow">{ctx.business.name}</p>
        <h1 className="bdm-h1">Zylx</h1>
      </header>

      <ZylxChat
        businessId={ctx.businessId}
        businessName={ctx.business.name}
        hasData={hasData}
        suggestions={suggestionsFor(ctx.business.business_type, ctx.business.earns_commissions, hasData)}
      />
    </div>
  );
}
