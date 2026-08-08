// ============================================================
// EMAIL PROVIDER
//
// One place that talks to Resend. Callers get a typed result and never
// see an API key. A missing key is a configuration ERROR, never a
// silent success — the caller must be able to tell the user the truth.
// ============================================================

import 'server-only';
import { ServiceError, logError, logEvent } from './errors';

export interface SendEmailInput {
  to: string;
  cc?: string | null;
  replyTo?: string | null;
  /** Display name for the From header. Sanitised here. */
  fromName?: string | null;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /** Correlates provider events back to our record. */
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  messageId: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailConfig {
  apiKey: string;
  fromAddress: string;
}

/**
 * Resolve email configuration, or explain exactly what is missing.
 * Never returns a partial configuration.
 */
export function emailConfig(): { ok: true; config: EmailConfig } | { ok: false; reason: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: 'RESEND_API_KEY is not set on this deployment.' };
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim();
  if (!fromAddress) {
    return { ok: false, reason: 'RESEND_FROM_EMAIL is not set on this deployment.' };
  }
  if (!EMAIL_RE.test(fromAddress)) {
    return { ok: false, reason: `RESEND_FROM_EMAIL is not a valid address: ${fromAddress}` };
  }
  // The shared sandbox domain will not pass SPF/DKIM for a customer's
  // business, so mail lands in spam. Refuse it rather than damage the
  // sender's reputation silently.
  if (/@resend\.dev$/i.test(fromAddress)) {
    return {
      ok: false,
      reason:
        'RESEND_FROM_EMAIL is still the Resend sandbox domain. Verify your own domain and set a sender on it.',
    };
  }

  return { ok: true, config: { apiKey, fromAddress } };
}

export function isEmailConfigured(): boolean {
  return emailConfig().ok;
}

/** Keeps a business name safe inside a From header. */
function sanitiseName(name: string | null | undefined): string {
  return (name ?? '').replace(/[<>"\r\n,;]/g, '').trim().slice(0, 78) || 'Invoices';
}

/**
 * Send one transactional email.
 *
 * @throws ServiceError('not_configured') when the provider is not set up
 * @throws ServiceError('upstream') when the provider rejects the message
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const cfg = emailConfig();
  if (!cfg.ok) {
    throw new ServiceError('not_configured', `Email is not configured. ${cfg.reason}`);
  }

  if (!EMAIL_RE.test(input.to)) {
    throw new ServiceError('validation', 'That recipient address is not valid.');
  }
  if (input.cc && !EMAIL_RE.test(input.cc)) {
    throw new ServiceError('validation', 'That CC address is not valid.');
  }

  const payload: Record<string, unknown> = {
    from: `${sanitiseName(input.fromName)} <${cfg.config.fromAddress}>`,
    to: [input.to],
    subject: input.subject.replace(/[\r\n]/g, ' ').slice(0, 200),
    html: input.html,
    text: input.text,
  };
  if (input.cc) payload.cc = [input.cc];
  // Resend v4+ is camelCase. `reply_to` is silently ignored.
  if (input.replyTo && EMAIL_RE.test(input.replyTo)) payload.replyTo = input.replyTo;
  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString('base64'),
    }));
  }
  if (input.tags) {
    payload.tags = Object.entries(input.tags).map(([name, value]) => ({
      name: name.slice(0, 40),
      // Resend tag values allow only ASCII letters, numbers, _ and -.
      value: String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60),
    }));
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    logError('email.network_failed', error, {});
    throw new ServiceError('upstream', 'Could not reach the email provider.');
  }

  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

  if (!res.ok) {
    logError('email.rejected', new Error(json.message ?? `HTTP ${res.status}`), {});
    throw new ServiceError(
      'upstream',
      json.message ?? `The email provider rejected the message (HTTP ${res.status}).`
    );
  }

  logEvent('email.sent', { messageId: json.id ?? null });
  return { messageId: json.id ?? null };
}
