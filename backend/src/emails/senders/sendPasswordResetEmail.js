import { sendEmail } from '../../utils/email.js';
import { passwordResetEmailTemplate } from '../templates/password-reset.js';
import { getFrontendUrl } from '../layout.js';

/**
 * Send a password reset link to a user.
 *
 * @param {Object} params
 * @param {Object} params.user - User object (must have `email`)
 * @param {string} params.resetToken - The password reset token (will be appended to URL)
 * @param {number} [params.expiresInMinutes=60] - How long the token is valid
 * @returns {Promise<{messageId: string}>}
 *
 * @example
 *   await sendPasswordResetEmail({
 *     user,
 *     resetToken: 'abc123...',
 *     expiresInMinutes: 60,
 *   });
 */
export async function sendPasswordResetEmail({ user, resetToken, expiresInMinutes = 60 }) {
  if (!user?.email) throw new Error('sendPasswordResetEmail: user.email is required');
  if (!resetToken) throw new Error('sendPasswordResetEmail: resetToken is required');

  const resetUrl = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const { subject, html } = passwordResetEmailTemplate({
    firstName: user.firstName || user.name?.split(' ')[0] || user.email.split('@')[0],
    resetUrl,
    expiresInMinutes,
  });

  return sendEmail({ to: user.email, subject, html });
}
