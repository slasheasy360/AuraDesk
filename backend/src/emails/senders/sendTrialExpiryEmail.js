import { sendEmail } from '../../utils/email.js';
import { trialExpiryEmailTemplate } from '../templates/trial-expiry.js';
import { getFrontendUrl } from '../layout.js';

/**
 * Send a trial expiry warning to a user.
 *
 * @param {Object} params
 * @param {Object} params.user - User object (must have `email`, optionally `firstName`)
 * @param {number} params.daysLeft - Days remaining in trial (use 1 for "today")
 * @returns {Promise<{messageId: string}>}
 *
 * @example
 *   // Called by a scheduled job that finds users with trialEndsAt in 3 days
 *   await sendTrialExpiryEmail({ user, daysLeft: 3 });
 */
export async function sendTrialExpiryEmail({ user, daysLeft }) {
  if (!user?.email) throw new Error('sendTrialExpiryEmail: user.email is required');
  if (typeof daysLeft !== 'number') {
    throw new Error('sendTrialExpiryEmail: daysLeft (number) is required');
  }

  const { subject, html } = trialExpiryEmailTemplate({
    firstName: user.firstName || user.name?.split(' ')[0] || user.email.split('@')[0],
    daysLeft,
    pricingUrl: `${getFrontendUrl()}/pricing`,
  });

  return sendEmail({ to: user.email, subject, html });
}
