import { sendEmail } from '../../utils/email.js';

/**
 * Send a team invite email via SES.
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.inviteLink - Full invite URL
 * @param {string} [params.companyName] - Workspace/company name
 * @param {string} [params.inviterName] - Name of the person sending the invite
 * @returns {Promise<{messageId: string}>}
 */
export async function sendInviteEmail({ to, inviteLink, companyName, inviterName }) {
  if (!to) throw new Error('sendInviteEmail: to is required');
  if (!inviteLink) throw new Error('sendInviteEmail: inviteLink is required');

  const sender = inviterName || 'A teammate';
  const team = companyName || 'their team';
  const subject = `${sender} invited you to join ${team} on AuraDesk`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f0f4ff;border-radius:12px">
    <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 10px rgba(0,0,0,.04)">
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;width:48px;height:48px;background:#3b82f6;border-radius:10px;color:#fff;font-size:24px;font-weight:700;line-height:48px;text-align:center">A</div>
        <h1 style="margin:12px 0 0;color:#0f1d33;font-size:20px">AuraDesk</h1>
      </div>
      <h2 style="color:#0f1d33;font-size:18px;margin:0 0 12px">You're invited to join ${team}</h2>
      <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px">
        ${sender} has invited you to collaborate on AuraDesk.
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

  const text = `${sender} invited you to join ${team} on AuraDesk.\n\nAccept invite: ${inviteLink}\n\nThis link expires in 7 days.`;

  return sendEmail({ to, subject, html, text });
}
