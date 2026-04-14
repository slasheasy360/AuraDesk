import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

// ── SES client (region from env, falls back to eu-north-1) ──────────────────
const ses = new SESv2Client({ region: process.env.AWS_REGION || 'eu-north-1' });

function buildMessageId(fromEmail) {
  const domain = (fromEmail || '').split('@')[1] || 'auradesk.com';
  return `<${crypto.randomBytes(16).toString('hex')}@${domain}>`;
}

// ── Build a raw MIME buffer using nodemailer (transport-agnostic) ────────────
async function buildRawMime({ from, to, subject, html, text, replyTo, headers, messageId, attachments }) {
  const stream = nodemailer.createTransport({ streamTransport: true, newline: 'unix' });
  const { message } = await stream.sendMail({
    from,
    to,
    subject,
    html,
    text,
    replyTo,
    headers: { 'Message-ID': messageId, ...headers },
    attachments,
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    message.on('data', (c) => chunks.push(c));
    message.on('end', () => resolve(Buffer.concat(chunks)));
    message.on('error', reject);
  });
}

// ── sendMail — drop-in replacement for the previous nodemailer/SMTP version ──
//
// Params (unchanged from old API):
//   to          string | string[]
//   subject     string
//   html        string  (optional if text provided)
//   text        string  (optional if html provided)
//   from        string  (ignored for the actual SES sender — SES_FROM_EMAIL is
//                        always used; a custom `from` becomes Reply-To instead)
//   replyTo     string
//   headers     object  ({ 'In-Reply-To': '...', References: '...' }, etc.)
//   messageId   string  (custom Message-ID header)
//   attachments array   (nodemailer attachment objects)
//
// Returns: { sent, messageId, response?, accepted?, rejected?, reason? }
//
export async function sendMail({ to, subject, html, text, from, replyTo, headers, messageId, attachments } = {}) {
  const sesFromEmail = process.env.SES_FROM_EMAIL;
  const sesFromName  = process.env.SES_FROM_NAME || 'AuraDesk';
  const configSet    = process.env.SES_CONFIGURATION_SET;

  if (!sesFromEmail) {
    console.warn('[Mailer] SES_FROM_EMAIL is not set — email not sent');
    return { sent: false, reason: 'SES_FROM_EMAIL not configured' };
  }

  const resolvedFrom      = `"${sesFromName}" <${sesFromEmail}>`;
  const resolvedMessageId = messageId || buildMessageId(sesFromEmail);

  // SES requires the sender to be a verified identity.
  // If the caller passed a custom `from` (e.g. the user's connected Gmail),
  // forward it as Reply-To so replies go to the right person.
  const resolvedReplyTo =
    replyTo ||
    (from && from !== sesFromEmail && from !== resolvedFrom ? from : undefined);

  // Use Raw MIME when threading headers or attachments are present;
  // use Simple format otherwise (cheaper, simpler, no MIME-building needed).
  const needsRaw = (headers && Object.keys(headers).length > 0) || attachments?.length;

  try {
    if (needsRaw) {
      const rawBuffer = await buildRawMime({
        from: resolvedFrom,
        to,
        subject,
        html,
        text,
        replyTo: resolvedReplyTo,
        headers,
        messageId: resolvedMessageId,
        attachments,
      });

      const result = await ses.send(new SendEmailCommand({
        Content: {
          Raw: { Data: rawBuffer },
        },
        ConfigurationSetName: configSet || undefined,
      }));

      const sesId = result.MessageId;
      console.log(`[Mailer/SES-Raw] Sent to ${Array.isArray(to) ? to.join(', ') : to} — SES MessageId: ${sesId}`);
      return { sent: true, messageId: resolvedMessageId, response: sesId };
    }

    // ── Simple format ────────────────────────────────────────────────────────
    const toAddresses  = Array.isArray(to) ? to : [to];
    const fallbackText = text || (html || '').replace(/<[^>]*>/g, '').trim();

    const result = await ses.send(new SendEmailCommand({
      FromEmailAddress: resolvedFrom,
      Destination: { ToAddresses: toAddresses },
      ReplyToAddresses: resolvedReplyTo ? [resolvedReplyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: subject || '(no subject)', Charset: 'UTF-8' },
          Body: {
            ...(html  && { Html: { Data: html,          Charset: 'UTF-8' } }),
            ...(fallbackText && { Text: { Data: fallbackText, Charset: 'UTF-8' } }),
          },
        },
      },
      ConfigurationSetName: configSet || undefined,
    }));

    const sesId = result.MessageId;
    console.log(`[Mailer/SES] Sent to ${toAddresses.join(', ')} — SES MessageId: ${sesId}`);
    return { sent: true, messageId: sesId, accepted: toAddresses, rejected: [], response: sesId };

  } catch (err) {
    console.error('[Mailer/SES] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

// ── Email body builders (unchanged) ─────────────────────────────────────────

export function buildPasswordResetEmail({ resetLink, userName }) {
  const subject = 'Reset your AuraDesk password';
  const greeting = userName ? `Hi ${userName},` : 'Hi there,';
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f0f4ff;border-radius:12px">
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 10px rgba(0,0,0,.04)">
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;width:48px;height:48px;background:#3b82f6;border-radius:10px;color:#fff;font-size:24px;font-weight:700;line-height:48px;text-align:center">A</div>
        <h1 style="margin:12px 0 0;color:#0f1d33;font-size:20px">AuraDesk</h1>
      </div>
      <h2 style="color:#0f1d33;font-size:18px;margin:0 0 12px">Reset your password</h2>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 12px">${greeting}</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
        We received a request to reset the password for your AuraDesk account.
        Click the button below to set a new one. This link expires in
        <strong>10 minutes</strong> and can only be used once.
      </p>
      <div style="text-align:center;margin:28px 0">
        <a href="${resetLink}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px">Reset password</a>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:24px 0 0;word-break:break-all">
        Or paste this link into your browser:<br><a href="${resetLink}" style="color:#3b82f6">${resetLink}</a>
      </p>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px">
        If you didn't request this, you can safely ignore this email — your password will remain unchanged.
      </p>
    </div>
  </div>`;
  const text = `${greeting}\n\nWe received a request to reset your AuraDesk password.\n\nReset your password: ${resetLink}\n\nThis link expires in 10 minutes and can only be used once.\n\nIf you didn't request this, you can ignore this email.`;
  return { subject, html, text };
}

export function buildInviteEmail({ inviteLink, companyName, inviterName }) {
  const subject = `${inviterName || 'Someone'} invited you to join ${companyName || 'their team'} on AuraDesk`;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f0f4ff;border-radius:12px">
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 10px rgba(0,0,0,.04)">
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;width:48px;height:48px;background:#3b82f6;border-radius:10px;color:#fff;font-size:24px;font-weight:700;line-height:48px;text-align:center">A</div>
        <h1 style="margin:12px 0 0;color:#0f1d33;font-size:20px">AuraDesk</h1>
      </div>
      <h2 style="color:#0f1d33;font-size:18px;margin:0 0 12px">You're invited to join ${companyName || 'a team'}</h2>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
        ${inviterName || 'A teammate'} has invited you to collaborate on AuraDesk.
        Click the button below to set your password and join the team.
      </p>
      <div style="text-align:center;margin:28px 0">
        <a href="${inviteLink}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px">Accept invite</a>
      </div>
      <p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:24px 0 0;word-break:break-all">
        Or paste this link into your browser:<br><a href="${inviteLink}" style="color:#3b82f6">${inviteLink}</a>
      </p>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px">This invite expires in 7 days.</p>
    </div>
  </div>`;
  const text = `${inviterName || 'A teammate'} invited you to join ${companyName || 'their team'} on AuraDesk.\n\nAccept invite: ${inviteLink}\n\nThis link expires in 7 days.`;
  return { subject, html, text };
}
