import { sendEmail } from '../../utils/email.js';
import { welcomeEmailTemplate } from '../templates/welcome.js';
import { getFrontendUrl } from '../layout.js';

/**
 * Send a welcome email to a newly registered user.
 *
 * @param {Object} user - User object (must have at least `email`; uses `firstName` or `name` for greeting)
 * @returns {Promise<{messageId: string}>} SES message ID
 *
 * @example
 *   sendWelcomeEmail(newUser).catch((err) => {
 *     console.error('[auth] welcome email failed (non-blocking):', err.message);
 *   });
 */
export async function sendWelcomeEmail(user) {
  if (!user?.email) throw new Error('sendWelcomeEmail: user.email is required');

  const { subject, html } = welcomeEmailTemplate({
    firstName: user.firstName || user.name?.split(' ')[0] || user.email.split('@')[0],
    dashboardUrl: `${getFrontendUrl()}/dashboard`,
  });

  return sendEmail({ to: user.email, subject, html });
}
