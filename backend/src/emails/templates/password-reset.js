import { wrapInLayout, ctaButton, escapeHtml } from '../layout.js';

/**
 * Password reset email — sent when a user requests a password reset link.
 *
 * @param {Object} data
 * @param {string} data.firstName - User's first name (or fallback)
 * @param {string} data.resetUrl - Full URL to the password reset page (includes token)
 * @param {number} [data.expiresInMinutes=60] - How long the reset link is valid
 * @returns {{ subject: string, html: string }}
 */
export function passwordResetEmailTemplate({ firstName, resetUrl, expiresInMinutes = 60 }) {
  const safeName = escapeHtml(firstName || 'there');
  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;">Reset your password</h2>
    <p style="margin:0 0 16px 0;">Hi ${safeName},</p>
    <p style="margin:0 0 16px 0;">
      We received a request to reset the password for your AuraDesk account. Click the
      button below to choose a new password. This link will expire in
      <strong>${expiresInMinutes} minutes</strong>.
    </p>
    ${ctaButton(resetUrl, 'Reset Password')}
    <p style="margin:24px 0 8px 0;color:#6b7280;font-size:14px;">
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 24px 0;word-break:break-all;">
      <a href="${escapeHtml(resetUrl)}" style="color:#3b82f6;font-size:13px;">${escapeHtml(resetUrl)}</a>
    </p>
    <div style="background-color:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#92400e;">
        <strong>Didn't request this?</strong> You can safely ignore this email — your
        password will not be changed unless you click the link above.
      </p>
    </div>
  `;
  return {
    subject: 'Reset your AuraDesk password',
    html: wrapInLayout(body, {
      previewText: `Reset your AuraDesk password. Link expires in ${expiresInMinutes} minutes.`,
    }),
  };
}
