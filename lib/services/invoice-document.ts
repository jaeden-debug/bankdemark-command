// ============================================================
// INVOICE DOCUMENT
//
// Renders an issued invoice from its FROZEN SNAPSHOT into HTML, and
// from that HTML into a PDF.
//
// The rule that matters: this function reads `issued_business_snapshot`
// and `issued_client_snapshot`, never the live settings or counterparty
// rows. Regenerating an invoice from 2026 in 2029 produces the 2026
// document, because the inputs cannot have changed.
//
// PDF ENGINE
//   The HTML is real, paginated, print-styled markup. It is converted
//   with headless Chromium when one is available, which yields
//   selectable vector text, proper page breaks and repeating table
//   headers on multi-page invoices.
//
//   When no Chromium is available (most serverless targets, unless a
//   binary is provisioned), we DO NOT silently emit a broken file or a
//   screenshot. `renderInvoicePdf` reports that it is unavailable and
//   the caller falls back to the print-ready HTML, which the browser
//   can save as a PDF. Honest degradation beats a corrupt artefact.
// ============================================================

import 'server-only';
import { formatMinor } from '@/lib/domain/money';
import type { BusinessSnapshot, ClientSnapshot, InvoiceRow, InvoiceLineRow } from './invoices';

export interface RenderableInvoice {
  invoice: InvoiceRow;
  lines: InvoiceLineRow[];
  business: BusinessSnapshot;
  client: ClientSnapshot;
  logoDataUri?: string | null;
}

/** Escapes every interpolated value. Invoice text is user input. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Preserves author line breaks without ever allowing markup through. */
function escMultiline(value: unknown): string {
  return esc(value).replace(/\r?\n/g, '<br>');
}

/**
 * What the Tax column shows for a line.
 *
 * An out-of-scope line is simply not taxed, so it reads as a dash. Only
 * zero_rated and exempt keep their label at 0%, because those are
 * taxable supplies that must stay identifiable on the document.
 */
function taxCellLabel(line: InvoiceLineRow): string {
  const treatment = line.tax_treatment ?? 'standard';
  if (treatment === 'out_of_scope') return '\u2014';
  if (treatment === 'standard' && Number(line.tax_rate) <= 0) return '\u2014';
  return line.tax_label ?? line.tax_code ?? '\u2014';
}

function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const TEMPLATE_STYLES: Record<string, { headerRule: string; tableHead: string; titleWeight: number }> = {
  clean: { headerRule: '1px solid #e5e0d5', tableHead: 'transparent', titleWeight: 800 },
  modern: { headerRule: '3px solid var(--accent)', tableHead: 'var(--accent-tint)', titleWeight: 900 },
  professional: { headerRule: '1px solid #333', tableHead: '#f4f1ea', titleWeight: 700 },
};

export function renderInvoiceHtml(data: RenderableInvoice): string {
  const { invoice, lines, business, client } = data;
  const currency = invoice.currency;
  const money = (m: number) => formatMinor(m, currency, { showMinor: true });

  const template = TEMPLATE_STYLES[business.template] ?? TEMPLATE_STYLES.clean;
  const accent = /^#[0-9a-fA-F]{6}$/.test(business.accent_color ?? '')
    ? business.accent_color
    : '#c6a24a';

  const taxLines = Array.isArray(invoice.tax_breakdown)
    ? (invoice.tax_breakdown as Array<{ label: string; taxMinor: number; treatment: string; rate: number }>)
    : [];

  const customEntries = Object.entries(invoice.custom_fields ?? {});

  const addressLines = [
    business.address_line1,
    business.address_line2,
    [business.city, business.region, business.postal_code].filter(Boolean).join(', '),
    business.country,
  ].filter((l) => l && String(l).trim());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(invoice.number ?? 'Invoice')}</title>
<style>
  :root { --accent: ${esc(accent)}; --accent-tint: ${esc(accent)}1a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
    color: #14181f; font-size: 12.5px; line-height: 1.5;
    background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 14mm 12mm; }
  @page { size: A4; margin: 12mm; }
  @media print { .sheet { max-width: none; margin: 0; padding: 0; } }

  header.doc { display: flex; justify-content: space-between; gap: 24px;
    align-items: flex-start; padding-bottom: 16px; border-bottom: ${template.headerRule}; }
  .logo { max-height: 56px; max-width: 180px; object-fit: contain; margin-bottom: 8px; }
  .biz-name { font-size: 17px; font-weight: ${template.titleWeight}; margin: 0 0 4px; letter-spacing: -0.02em; }
  .muted { color: #667085; }
  .doc-title { font-size: 26px; font-weight: 900; letter-spacing: -0.03em; color: var(--accent); margin: 0; text-align: right; }
  .doc-number { font-size: 14px; font-weight: 700; margin: 2px 0 0; text-align: right; }
  .meta { margin-top: 10px; font-size: 11.5px; text-align: right; }
  .meta div { margin-top: 2px; }
  .meta .k { color: #667085; margin-right: 6px; }

  .parties { display: flex; gap: 32px; margin-top: 20px; }
  .parties > div { flex: 1; }
  .label { font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: #667085; margin: 0 0 5px; }

  .ref { margin-top: 16px; border: 1px solid #e5e0d5; border-radius: 8px; padding: 10px 12px;
    background: #fbfaf7; break-inside: avoid; }
  .ref dl { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 20px; margin: 0; }
  .ref .row { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; }
  .ref dt { color: #667085; margin: 0; }
  .ref dd { margin: 0; font-weight: 600; text-align: right; }

  table.items { width: 100%; border-collapse: collapse; margin-top: 20px; }
  table.items thead { background: ${template.tableHead}; display: table-header-group; }
  table.items th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em;
    color: #667085; text-align: left; padding: 8px 8px; border-bottom: 1px solid #e5e0d5; font-weight: 700; }
  table.items td { padding: 9px 8px; border-bottom: 1px solid #f0ece3; vertical-align: top;
    word-break: break-word; }
  table.items tr { break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tax-cell { font-size: 11px; white-space: nowrap; }
  .desc { width: 46%; }

  .totals { margin: 18px 0 0 auto; width: 250px; break-inside: avoid; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
  .totals .grand { border-top: 2px solid var(--accent); margin-top: 6px; padding-top: 8px;
    font-size: 15px; font-weight: 800; }
  .totals .balance { border-top: 1px solid #e5e0d5; margin-top: 5px; padding-top: 6px; font-weight: 800; }

  .footer-blocks { display: flex; gap: 28px; margin-top: 26px; padding-top: 16px;
    border-top: 1px solid #e5e0d5; break-inside: avoid; }
  .footer-blocks > div { flex: 1; }
  .footer-blocks p { margin: 0; font-size: 11.5px; color: #444c58; white-space: pre-wrap; }

  .paid-stamp { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 999px;
    font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
  .paid { background: #e6f2ec; color: #1d7a53; }
  .void { background: #f5e7e6; color: #b3261e; }

  .credit { color: #667085; font-size: 11px; text-align: center; margin-top: 22px;
    padding-top: 10px; border-top: 1px solid #f0ece3; }

  /* Narrow screens only. Print keeps the compact multi-column layout,
     which is correct on A4 and wrong on a 375px phone. */
  @media screen and (max-width: 640px) {
    .sheet { padding: 18px 14px; }
    .parties, .footer-blocks { display: block; }
    .footer-blocks > div + div { margin-top: 16px; }
    .ref dl { grid-template-columns: 1fr; }
    /* 9.5px is fine on paper and unreadable on a phone. */
    .label { font-size: 11px; }
    table.items th { font-size: 10.5px; }
    table.items td, .footer-blocks p, .ref .row { font-size: 13px; }
    .desc { width: 40%; }
    .totals { width: 100%; }
    header.doc { gap: 14px; }
    .doc-title { font-size: 21px; }
  }
</style>
</head>
<body>
<div class="sheet">

  <header class="doc">
    <div>
      ${data.logoDataUri ? `<img class="logo" src="${esc(data.logoDataUri)}" alt="">` : ''}
      <p class="biz-name">${esc(business.name)}</p>
      ${addressLines.map((l) => `<div class="muted">${esc(l)}</div>`).join('')}
      ${business.email ? `<div class="muted">${esc(business.email)}</div>` : ''}
      ${business.phone ? `<div class="muted">${esc(business.phone)}</div>` : ''}
      ${business.tax_number
        ? `<div class="muted" style="margin-top:4px">${esc(business.tax_number_label ?? 'Tax no.')}: ${esc(business.tax_number)}</div>`
        : ''}
    </div>
    <div>
      <h1 class="doc-title">${invoice.is_credit_note ? 'CREDIT NOTE' : 'INVOICE'}</h1>
      <p class="doc-number">${esc(invoice.number ?? 'Draft')}</p>
      <div class="meta">
        <div><span class="k">Issued</span>${esc(invoice.issue_date)}</div>
        <div><span class="k">Due</span><strong>${esc(invoice.due_date)}</strong></div>
        ${invoice.status === 'paid' ? '<div><span class="paid-stamp paid">Paid</span></div>' : ''}
        ${invoice.status === 'void' ? '<div><span class="paid-stamp void">Void</span></div>' : ''}
      </div>
    </div>
  </header>

  <div class="parties">
    <div>
      <p class="label">Bill to</p>
      <div style="font-weight:700">${esc(client.name)}</div>
      ${client.email ? `<div class="muted">${esc(client.email)}</div>` : ''}
      ${client.phone ? `<div class="muted">${esc(client.phone)}</div>` : ''}
    </div>
  </div>

  ${customEntries.length > 0 ? `
  <div class="ref">
    <p class="label">Reference</p>
    <dl>
      ${customEntries.map(([k, v]) => `
        <div class="row"><dt>${esc(humanise(k))}</dt><dd>${esc(v)}</dd></div>
      `).join('')}
    </dl>
  </div>` : ''}

  <table class="items">
    <thead>
      <tr>
        <th class="desc">Description</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th>Tax</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map((l) => `
      <tr>
        <td class="desc">${escMultiline(l.description)}</td>
        <td class="num">${esc(Number(l.quantity))}</td>
        <td class="num">${esc(money(Number(l.unit_price_minor)))}</td>
        <td class="tax-cell muted">${esc(taxCellLabel(l))}</td>
        <td class="num" style="font-weight:600">${esc(money(Number(l.total_minor)))}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span class="muted">Subtotal</span><span class="num">${esc(money(invoice.subtotal_minor))}</span></div>
    ${invoice.discount_minor > 0
      ? `<div class="row"><span class="muted">Discount</span><span class="num">−${esc(money(invoice.discount_minor))}</span></div>`
      : ''}
    ${taxLines.map((t) => `
      <div class="row">
        <span class="muted">${esc(t.treatment === 'standard' ? t.label : `${t.label} (0%)`)}</span>
        <span class="num">${esc(money(t.taxMinor))}</span>
      </div>`).join('')}
    <div class="row grand"><span>Total</span><span class="num">${esc(money(invoice.total_minor))}</span></div>
    ${invoice.paid_minor > 0 ? `
      <div class="row"><span class="muted">Paid</span><span class="num">−${esc(money(invoice.paid_minor))}</span></div>
      <div class="row balance"><span>Balance due</span><span class="num">${esc(money(invoice.balance_minor))}</span></div>
    ` : ''}
  </div>

  ${(invoice.payment_instructions || invoice.notes || invoice.terms) ? `
  <div class="footer-blocks">
    ${invoice.payment_instructions ? `<div><p class="label">How to pay</p><p>${escMultiline(invoice.payment_instructions)}</p></div>` : ''}
    ${invoice.notes ? `<div><p class="label">Notes</p><p>${escMultiline(invoice.notes)}</p></div>` : ''}
    ${invoice.terms ? `<div><p class="label">Terms</p><p>${escMultiline(invoice.terms)}</p></div>` : ''}
  </div>` : ''}

  ${business.footer_text ? `<p class="credit">${escMultiline(business.footer_text)}</p>` : ''}
  ${business.show_bdm_credit ? '<p class="credit">Prepared with BankDeMark</p>' : ''}

</div>
</body>
</html>`;
}

export interface PdfResult {
  ok: boolean;
  pdf?: Buffer;
  /** Why a PDF could not be produced, when ok is false. */
  reason?: string;
}

/**
 * Convert the invoice HTML to a real PDF with headless Chromium.
 *
 * Returns `{ok:false, reason}` rather than throwing or producing a
 * degraded file, so the caller can fall back to print-ready HTML and
 * tell the user the truth.
 */
export async function renderInvoicePdf(html: string): Promise<PdfResult> {
  let launcher: Awaited<ReturnType<typeof resolveLauncher>>;
  try {
    launcher = await resolveLauncher();
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'no_pdf_engine',
    };
  }
  if (!launcher) return { ok: false, reason: 'no_chromium_executable' };

  let browser: Awaited<ReturnType<typeof launcher.puppeteer.launch>> | null = null;
  try {
    browser = await launcher.puppeteer.launch({
      headless: true,
      executablePath: launcher.executablePath,
      args: launcher.args,
    });
    const page = await browser.newPage();
    // No network: the document is fully self-contained, and this stops
    // any injected remote reference from being fetched during render.
    await page.setRequestInterception(true);
    page.on('request', (req: { url(): string; continue(): void; abort(): void }) => {
      if (req.url().startsWith('data:') || req.url() === 'about:blank') req.continue();
      else req.abort();
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#98a2b3;padding:0 12mm;text-align:right;">' +
        'Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
    return { ok: true, pdf: Buffer.from(pdf) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'pdf_render_failed',
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

interface Launcher {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  puppeteer: any;
  executablePath: string;
  args: string[];
}

/**
 * Find a Chromium to drive.
 *
 * On a serverless host, `@sparticuz/chromium` supplies a bundled
 * binary. Locally, we use whatever Chrome the developer already has —
 * downloading a second copy for a dev machine is wasteful.
 *
 * `PUPPETEER_EXECUTABLE_PATH` overrides both.
 */
async function resolveLauncher(): Promise<Launcher | null> {
  const puppeteer = await import('puppeteer-core');

  const override = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (override) {
    return {
      puppeteer,
      executablePath: override,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
  }

  // Serverless / Linux: use the bundled Chromium.
  const isServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL);
  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return {
      puppeteer,
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    };
  }

  // Local development: a Chrome already installed on the machine.
  const { existsSync } = await import('node:fs');
  const candidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

  const found = candidates.find((p) => existsSync(p));
  if (!found) return null;

  return {
    puppeteer,
    executablePath: found,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
}
