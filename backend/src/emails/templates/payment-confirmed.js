import { wrapInLayout, ctaButton, escapeHtml } from '../layout.js';

/**
 * Format a number as a currency amount.
 */
function formatCurrency(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

/**
 * Format a date as "Mon DD, YYYY".
 */
function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Payment confirmation email — sent after a successful Stripe checkout or subscription renewal.
 *
 * @param {Object} data
 * @param {string} data.firstName - User's first name (or fallback)
 * @param {string} data.planName - e.g. "Pro", "Starter", "Elite"
 * @param {number} data.amount - Amount charged (in major units, e.g. 29.00 not 2900)
 * @param {string} [data.currency='USD'] - ISO currency code
 * @param {string} data.billingCycle - "monthly" or "yearly"
 * @param {Date|string} data.nextBillingDate - When the next charge will occur
 * @param {string} data.dashboardUrl - Link to the dashboard
 * @returns {{ subject: string, html: string }}
 */
export function paymentConfirmedEmailTemplate({
  firstName,
  planName,
  amount,
  currency = 'USD',
  billingCycle,
  nextBillingDate,
  dashboardUrl,
}) {
  const safeName = escapeHtml(firstName || 'there');
  const safePlan = escapeHtml(planName || 'Pro');
  const formattedAmount = formatCurrency(amount, currency);
  const formattedNext = formatDate(nextBillingDate);
  const cycleText = billingCycle === 'yearly' ? 'yearly' : 'monthly';

  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;">Payment received ✓</h2>
    <p style="margin:0 0 16px 0;">Hi ${safeName},</p>
    <p style="margin:0 0 16px 0;">
      Thanks for subscribing to AuraDesk! Your payment has been processed and your
      <strong>${safePlan}</strong> plan is now active.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f0fdf4;border-radius:8px;margin:16px 0;border:1px solid #bbf7d0;">
      <tr>
        <td style="padding:20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#15803d;">Plan</td>
              <td style="padding:6px 0;font-size:14px;color:#14532d;text-align:right;font-weight:600;">${safePlan} (${escapeHtml(cycleText)})</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#15803d;">Amount paid</td>
              <td style="padding:6px 0;font-size:18px;color:#14532d;text-align:right;font-weight:700;">${formattedAmount}</td>
            </tr>
            ${formattedNext ? `<tr>
              <td style="padding:6px 0;font-size:14px;color:#15803d;">Next billing date</td>
              <td style="padding:6px 0;font-size:14px;color:#14532d;text-align:right;font-weight:600;">${formattedNext}</td>
            </tr>` : ''}
          </table>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0;">
      You now have access to all <strong>${safePlan}</strong> features. Head over to your
      dashboard to start exploring what's new.
    </p>
    ${ctaButton(dashboardUrl, 'Go to Dashboard')}
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:14px;">
      Need an invoice or have questions about your subscription? Just reply to this email.
    </p>
  `;

  return {
    subject: `Payment received — Welcome to AuraDesk ${safePlan}`,
    html: wrapInLayout(body, {
      previewText: `Your ${safePlan} plan is active. Amount: ${formattedAmount}.`,
    }),
  };
}
