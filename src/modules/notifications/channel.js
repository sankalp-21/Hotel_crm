const nodemailer = require('nodemailer');
const parseAddresses = require('nodemailer/lib/addressparser');
const env = require('../../config/env');
const logger = require('../../config/logger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtpConfigured) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || 587,
    secure: Boolean(env.SMTP_SECURE),
    // Bounded so a hung SMTP server fails the delivery (and gets retried) instead of holding it.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: env.SMTP_USER
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
      : undefined,
  });
  return transporter;
}

/** The server-wide default sender parsed from EMAIL_FROM ("Name <a@b.com>" or "a@b.com"). */
function globalFrom() {
  const [parsed] = parseAddresses(env.EMAIL_FROM || '');
  return parsed ? { name: parsed.name || '', address: parsed.address } : { name: '', address: '' };
}

/**
 * Email/SMS delivery adapter.
 * - Production email: requires SMTP_* + EMAIL_FROM; fails closed if missing.
 * - Development email without SMTP: logs a stub (never claim production delivery).
 * - SMS: not wired yet — fails in production, stubs in development.
 */
async function send({ to, subject, body, html, headers, from, replyTo, channel = 'email' }) {
  if (channel === 'sms') {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMS provider is not configured');
    }
    logger.info({ to, subject }, 'notifications:sms_stub_send');
    return { success: true, provider: 'stub' };
  }

  if (!env.smtpConfigured) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured (set SMTP_HOST and EMAIL_FROM)');
    }
    logger.info({ to, subject }, 'notifications:email_stub_send');
    return { success: true, provider: 'stub' };
  }

  const mailer = getTransporter();
  const info = await mailer.sendMail({
    from: from || env.EMAIL_FROM,
    ...(replyTo && { replyTo }),
    to,
    subject: subject || '(no subject)',
    text: body,
    ...(html && { html }),
    ...(headers && { headers }),
  });

  logger.info({ to, subject }, 'notifications:email_sent');
  return { success: true, provider: 'smtp', messageId: info?.messageId };
}

module.exports = { send, globalFrom };
