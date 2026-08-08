import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '@/lib/domain/invoice';

const STYLES: Record<InvoiceStatus, string> = {
  draft: 'bdm-badge-neutral',
  issued: 'bdm-badge-gold',
  sent: 'bdm-badge-gold',
  viewed: 'bdm-badge-gold',
  partially_paid: 'bdm-badge-caution',
  paid: 'bdm-badge-positive',
  overdue: 'bdm-badge-negative',
  void: 'bdm-badge-neutral',
};

export default function InvoiceStatusBadge({
  status,
  daysOverdue,
}: {
  status: InvoiceStatus;
  daysOverdue?: number;
}) {
  return (
    <span className={STYLES[status] ?? 'bdm-badge-neutral'}>
      {INVOICE_STATUS_LABELS[status] ?? status}
      {status === 'overdue' && daysOverdue && daysOverdue > 0 ? ` · ${daysOverdue}d` : ''}
    </span>
  );
}
