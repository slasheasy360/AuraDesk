import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

/**
 * AuraDesk transactional email utility — wraps AWS SES.
 *
 * Required env vars (loaded from Secrets Manager in production):
 *   AWS_REGION              — AWS region (e.g. "eu-north-1")
 *   SES_FROM_EMAIL          — Verified sender email address
 *   SES_FROM_NAME           — Display name shown in From header
 *   SES_CONFIGURATION_SET   — (optional) SES configuration set for tracking
 *
 * Usage:
 *   import { sendEmail } from './utils/email.js';
 *   await sendEmail({
 *     to: 'user@example.com',
 *     subject: 'Welcome to AuraDesk',
 *     html: '<h1>Hello</h1>',
 *     text: 'Hello',
 *   });
 *
 * SANDBOX MODE: Until production access is requested, recipients must
 * also be verified in SES. To verify a recipient run:
 *   aws sesv2 create-email-identity --email-identity user@example.com
 */

const ses = new SESv2Client({ region: process.env.AWS_REGION || 'eu-north-1' });

/**
 * Send a transactional email via AWS SES.
 *
 * @param {Object} opts
 * @param {string|string[]} opts.to       - Recipient email or array of emails
 * @param {string}          opts.subject  - Subject line
 * @param {string}          opts.html     - HTML body
 * @param {string}          [opts.text]   - Plain-text body (auto-derived from html if omitted)
 * @param {string}          [opts.replyTo] - Reply-To address (defaults to from)
 * @param {string[]}        [opts.cc]     - CC addresses
 * @param {string[]}        [opts.bcc]    - BCC addresses
 * @returns {Promise<{messageId: string}>} SES message ID on success
 * @throws {Error} If env vars missing or SES rejects the send
 */
export async function sendEmail({ to, subject, html, text, replyTo, cc, bcc }) {
  const fromEmail = process.env.SES_FROM_EMAIL;
  const fromName = process.env.SES_FROM_NAME || 'AuraDesk';
  const configSet = process.env.SES_CONFIGURATION_SET;

  if (!fromEmail) {
    throw new Error('SES_FROM_EMAIL env var is required');
  }
  if (!to || !subject || !html) {
    throw new Error('sendEmail requires { to, subject, html }');
  }

  const toAddresses = Array.isArray(to) ? to : [to];
  const fallbackText = text || html.replace(/<[^>]*>/g, '').trim();

  const command = new SendEmailCommand({
    FromEmailAddress: `"${fromName}" <${fromEmail}>`,
    Destination: {
      ToAddresses: toAddresses,
      CcAddresses: cc,
      BccAddresses: bcc,
    },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: html, Charset: 'UTF-8' },
          Text: { Data: fallbackText, Charset: 'UTF-8' },
        },
      },
    },
    ConfigurationSetName: configSet || undefined,
  });

  try {
    const result = await ses.send(command);
    console.log(`[SES] Sent email to ${toAddresses.join(', ')} — MessageId: ${result.MessageId}`);
    return { messageId: result.MessageId };
  } catch (err) {
    console.error(`[SES] Failed to send email to ${toAddresses.join(', ')}:`, err.message);
    throw err;
  }
}
