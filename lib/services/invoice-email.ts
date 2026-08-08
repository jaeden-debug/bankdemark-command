// ============================================================
// INVOICE EMAIL TEMPLATES
//
// Every interpolated value is escaped. Invoice notes, client names and
// the sender's personal message are all user input, and an invoice
// email is delivered to a third party — an unescaped value here would
// be an HTML injection into someone else's inbox.
// ============================================================

import 'server-only';

function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escMultiline(value: unknown): string {
  return esc(value).replace(/\r?\n/g, '<br>');
}

/** Only http(s) links are ever emitted into an email. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface InvoiceEmailInput {
  businessName: string;
  clientName: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  dueDate: string;
  viewUrl: string | null;
  message?: string | null;
  paymentInstructions?: string | null;
  accentColor?: string;
  hasAttachment?: boolean;
}

export function invoiceEmailHtml(input: InvoiceEmailInput): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(input.accentColor ?? '') ? input.accentColor! : '#c6a24a';
  const url = safeUrl(input.viewUrl);

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(input.invoiceNumber)}</title></head>
<body style="margin:0;padding:0;background:#f6f4ef;font-family:ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#14181f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e3d8;">
    <tr><td style="height:4px;background:${esc(accent)};"></td></tr>
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0;font-size:13px;color:#667085;">Invoice from</p>
      <p style="margin:2px 0 0;font-size:19px;font-weight:800;letter-spacing:-0.02em;">${esc(input.businessName)}</p>
    </td></tr>

    <tr><td style="padding:16px 28px 0;">
      <p style="margin:0;font-size:15px;">Hi ${esc(input.clientName)},</p>
      ${input.message
        ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.6;">${escMultiline(input.message)}</p>`
        : `<p style="margin:12px 0 0;font-size:15px;line-height:1.6;">Please find invoice ${esc(input.invoiceNumber)} below.${input.hasAttachment ? ' A PDF copy is attached.' : ''}</p>`}
    </td></tr>

    <tr><td style="padding:20px 28px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f4;border:1px solid #eee9dd;border-radius:10px;">
        <tr><td style="padding:16px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:#667085;padding:3px 0;">Invoice</td>
              <td align="right" style="font-size:13px;font-weight:700;padding:3px 0;">${esc(input.invoiceNumber)}</td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#667085;padding:3px 0;">Due</td>
              <td align="right" style="font-size:13px;font-weight:700;padding:3px 0;">${esc(input.dueDate)}</td>
            </tr>
            <tr>
              <td style="font-size:15px;font-weight:800;padding:10px 0 0;border-top:1px solid #eee9dd;">Amount due</td>
              <td align="right" style="font-size:19px;font-weight:800;padding:10px 0 0;border-top:1px solid #eee9dd;">${esc(input.amount)} ${esc(input.currency)}</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    ${url ? `
    <tr><td align="center" style="padding:22px 28px 4px;">
      <a href="${esc(url)}" style="display:inline-block;background:${esc(accent)};color:#14181f;text-decoration:none;font-weight:800;font-size:15px;padding:13px 30px;border-radius:999px;">View invoice</a>
    </td></tr>
    <tr><td align="center" style="padding:8px 28px 0;">
      <p style="margin:0;font-size:11.5px;color:#98a2b3;word-break:break-all;">${esc(url)}</p>
    </td></tr>` : ''}

    ${input.paymentInstructions ? `
    <tr><td style="padding:22px 28px 0;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#667085;">How to pay</p>
      <p style="margin:0;font-size:13.5px;line-height:1.6;color:#444c58;">${escMultiline(input.paymentInstructions)}</p>
    </td></tr>` : ''}

    <tr><td style="padding:26px 28px 28px;">
      <p style="margin:0;font-size:13px;color:#667085;">Thank you,<br>${esc(input.businessName)}</p>
    </td></tr>
  </table>

  <p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#98a2b3;text-align:center;">
    Sent with BankDeMark. If you were not expecting this invoice, please reply to this email.
  </p>
</td></tr>
</table>
</body></html>`;
}

/** Plain-text alternative. Improves deliverability and accessibility. */
export function invoiceEmailText(input: InvoiceEmailInput): string {
  const url = safeUrl(input.viewUrl);
  return [
    `Invoice ${input.invoiceNumber} from ${input.businessName}`,
    '',
    `Hi ${input.clientName},`,
    '',
    input.message ?? 'Please find your invoice details below.',
    '',
    `Invoice:    ${input.invoiceNumber}`,
    `Due:        ${input.dueDate}`,
    `Amount due: ${input.amount} ${input.currency}`,
    '',
    url ? `View it here: ${url}` : '',
    '',
    `Thank you,`,
    input.businessName,
  ]
    .filter((l) => l !== null)
    .join('\n');
}
