import Link from 'next/link';
import { requireBusiness } from '@/lib/services/context';
import CommissionReportUpload from '@/components/bdm/CommissionReportUpload';

export const dynamic = 'force-dynamic';
export default async function NewCommissionReportPage({ params }: { params: { businessId: string } }) {
  const ctx = await requireBusiness(params.businessId, 'member');
  return <div className="bdm-page max-w-2xl"><header className="mb-4"><Link className="text-sm font-semibold text-muted" href={`/b/${ctx.businessId}/dashboard`}>← Travel dashboard</Link><h1 className="bdm-h1 mt-2">Commission report</h1></header><CommissionReportUpload businessId={ctx.businessId} /></div>;
}
