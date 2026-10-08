const nodemailer = require('nodemailer');
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
    auth: env.SMTP_USER
      ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        }
      : undefined,
  });
  return transporter;
}

/**
 * Email/SMS delivery adapter.
 * - Production email: requires SMTP_* + EMAIL_FROM; fails closed if missing.
 * - Development email without SMTP: logs a stub (never claim production delivery).
 * - SMS: not wired yet — fails in production, stubs in development.
 */
async function send({ to, subject, body, channel = 'email' }) {
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
  await mailer.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: subject || '(no subject)',
    text: body,
  });

  logger.info({ to, subject }, 'notifications:email_sent');
  return { success: true, provider: 'smtp' };
}

module.exports = { send };
