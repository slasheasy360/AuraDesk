import { wrapInLayout, ctaButton, escapeHtml } from '../layout.js';

/**
 * Trial expiry warning email — sent N days before the user's trial ends.
 *
 * @param {Object} data
 * @param {string} data.firstName - User's first name (or fallback)
 * @param {number} data.daysLeft - How many days until trial expires
 * @param {string} data.pricingUrl - Link to the pricing page
 * @returns {{ subject: string, html: string }}
 */
export function trialExpiryEmailTemplate({ firstName, daysLeft, pricingUrl }) {
  const safeName = escapeHtml(firstName || 'there');
  const isLastDay = daysLeft <= 1;
  const timeText = isLastDay
    ? '<strong>today</strong>'
    : `in <strong>${daysLeft} days</strong>`;

  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;">
      ${isLastDay ? '⏰ Your trial ends today' : `Your trial ends in ${daysLeft} days`}
    </h2>
    <p style="margin:0 0 16px 0;">Hi ${safeName},</p>
    <p style="margin:0 0 16px 0;">
      Just a heads up — your AuraDesk free trial ends ${timeText}. To keep using the
      smart inbox, AI replies, lead tracking and invoicing features without interruption,
      pick a plan below.
    </p>
    <div style="background-color:#f0f9ff;border-radius:8px;padding:20px;margin:16px 0;">
      <p style="margin:0 0 12px 0;font-weight:600;color:#1e40af;">What you'll lose if your trial expires:</p>
      <ul style="margin:0;padding-left:20px;color:#1e3a8a;font-size:14px;">
        <li style="margin-bottom:6px;">Unified inbox across Facebook, Instagram, WhatsApp, Gmail</li>
        <li style="margin-bottom:6px;">AI reply suggestions and auto-replies</li>
        <li style="margin-bottom:6px;">Lead tracking and invoice generation</li>
        <li>All your connected accounts and conversation history</li>
      </ul>
    </div>
    ${ctaButton(pricingUrl, 'Choose a Plan')}
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:14px;">
      Have questions about pricing or which plan is right for you? Reply to this email
      and we'll help you decide.
    </p>
  `;

  return {
    subject: isLastDay
      ? '⏰ Your AuraDesk trial ends today'
      : `Your AuraDesk trial ends in ${daysLeft} days`,
    html: wrapInLayout(body, {
      previewText: isLastDay
        ? 'Pick a plan today to keep using AuraDesk without interruption.'
        : `Your free trial ends in ${daysLeft} days. Choose a plan to keep going.`,
    }),
  };
}
