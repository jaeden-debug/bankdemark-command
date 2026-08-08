import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import BookingForm from '@/components/bdm/BookingForm';
import { nounFor } from '@/lib/domain/nouns';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'member');
  const noun = nounFor(ctx.business.business_type);

  const { data: brands } = await ctx.db
    .from('brands').select('id, name')
    .eq('business_id', ctx.businessId).eq('is_active', true).order('sort_order');

  return (
    <div className="bdm-page max-w-2xl">
      <header className="mb-4">
        <Link href={`/b/${ctx.businessId}/money-in`} className="text-[13px] font-semibold text-muted hover:text-ink">
          ← {noun.plural}
        </Link>
        <h1 className="bdm-h1 mt-2">Add a {noun.singular.toLowerCase()}</h1>
      </header>

      <BookingForm
        businessId={ctx.businessId}
        currency={ctx.business.base_currency}
        brands={brands ?? []}
        noun={noun}
      />
    </div>
  );
}
