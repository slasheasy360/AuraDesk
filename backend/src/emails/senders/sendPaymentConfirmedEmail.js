import { sendEmail } from '../../utils/email.js';
import { paymentConfirmedEmailTemplate } from '../templates/payment-confirmed.js';
import { getFrontendUrl } from '../layout.js';

/**
 * Send a payment confirmation email after a successful Stripe checkout
 * or subscription renewal.
 *
 * @param {Object} params
 * @param {Object} params.user - User object (must have `email`)
 * @param {string} params.planName - "Starter" | "Pro" | "Elite"
 * @param {number} params.amount - Amount charged in major units (e.g. 29.00)
 * @param {string} [params.currency='USD'] - ISO currency code
 * @param {string} params.billingCycle - "monthly" | "yearly"
 * @param {Date|string} [params.nextBillingDate] - When the next charge will occur
 * @returns {Promise<{messageId: string}>}
 *
 * @example
 *   // Called from a Stripe webhook handler after invoice.payment_succeeded
 *   await sendPaymentConfirmedEmail({
 *     user,
 *     planName: 'Pro',
 *     amount: 79,
 *     billingCycle: 'monthly',
 *     nextBillingDate: subscription.current_period_end,
 *   });
 */
export async function sendPaymentConfirmedEmail({
  user,
  planName,
  amount,
  currency = 'USD',
  billingCycle,
  nextBillingDate,
}) {
  if (!user?.email) throw new Error('sendPaymentConfirmedEmail: user.email is required');

  const { subject, html } = paymentConfirmedEmailTemplate({
    firstName: user.firstName || user.name?.split(' ')[0] || user.email.split('@')[0],
    planName,
    amount,
    currency,
    billingCycle,
    nextBillingDate,
    dashboardUrl: `${getFrontendUrl()}/dashboard`,
  });

  return sendEmail({ to: user.email, subject, html });
}
