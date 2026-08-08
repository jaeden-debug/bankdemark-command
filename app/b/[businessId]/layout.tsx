import { redirect } from 'next/navigation';
import AppShell from '@/components/bdm/AppShell';
import { requireBusiness } from '@/lib/services/context';
import { listBusinesses } from '@/lib/services/businesses';
import { ServiceError } from '@/lib/services/errors';

export const dynamic = 'force-dynamic';

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { businessId: string };
}) {
  try {
    const ctx = await requireBusiness(params.businessId, 'viewer');
    const businesses = await listBusinesses(ctx);

    return (
      <AppShell
        business={{
          id: ctx.business.id,
          name: ctx.business.name,
          base_currency: ctx.business.base_currency,
          business_type: ctx.business.business_type,
        }}
        businesses={businesses.map((b) => ({
          id: b.id,
          name: b.name,
          base_currency: b.base_currency,
          business_type: b.business_type,
        }))}
      >
        {children}
      </AppShell>
    );
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'unauthenticated') {
      // Dedicated /auth pages are not built yet; /command carries the
      // working sign-in form.
      redirect('/auth/sign-in');
    }
    // A forbidden or missing business must not leak which ids exist.
    redirect('/command');
  }
}
