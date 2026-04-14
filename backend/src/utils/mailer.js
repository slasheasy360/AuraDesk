import nodemailer from 'nodemailer';
import crypto from 'crypto';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[Mailer] SMTP env vars not configured — emails will not be sent');
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true' || parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

function buildMessageId(from) {
  const domain = (from || '').split('@')[1] || 'auradesk.local';
  return `${crypto.randomBytes(16).toString('hex')}@${domain}`;
}

export async function sendMail({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
  headers,
  messageId,
  attachments,
}) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'SMTP not configured' };
  const resolvedFrom = from || process.env.SMTP_FROM || `AuraDesk <${process.env.SMTP_USER}>`;
  const resolvedMessageId = messageId || buildMessageId(resolvedFrom);
  try {
    const info = await t.sendMail({
      from: resolvedFrom,
      to,
      subject,
      html,
      text,
      replyTo,
      headers,
      messageId: resolvedMessageId,
      attachments,
    });
    return {
      sent: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    };
  } catch (err) {
    console.error('[Mailer] Send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

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
