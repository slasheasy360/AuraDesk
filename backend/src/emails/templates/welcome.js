import { wrapInLayout, ctaButton, escapeHtml } from '../layout.js';

/**
 * Welcome email — sent immediately after a new user registers.
 *
 * @param {Object} data
 * @param {string} data.firstName - User's first name (or fallback)
 * @param {string} data.dashboardUrl - Link to the dashboard / login
 * @returns {{ subject: string, html: string }}
 */
export function welcomeEmailTemplate({ firstName, dashboardUrl }) {
  const safeName = escapeHtml(firstName || 'there');
  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;">Welcome to AuraDesk, ${safeName}! 🎉</h2>
    <p style="margin:0 0 16px 0;">
      Your AI-powered productivity dashboard is ready. AuraDesk brings all your customer
      conversations from Facebook, Instagram, WhatsApp and Gmail into one unified inbox —
      with AI assistance to help you respond faster.
    </p>
    <p style="margin:0 0 16px 0;"><strong>Here's what to do next:</strong></p>
    <ol style="margin:0 0 16px 20px;padding:0;">
      <li style="margin-bottom:8px;">Connect your first messaging platform (Facebook, Instagram, WhatsApp, or Gmail)</li>
      <li style="margin-bottom:8px;">Set up your business branding so replies feel personal</li>
      <li style="margin-bottom:8px;">Try the AI reply suggestions on your first incoming message</li>
    </ol>
    ${ctaButton(dashboardUrl, 'Open Dashboard')}
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:14px;">
      Need help getting started? Just reply to this email — a real human reads every message.
    </p>
  `;
  return {
    subject: `Welcome to AuraDesk, ${safeName}`,
    html: wrapInLayout(body, {
      previewText: 'Your AI-powered productivity dashboard is ready. Get started in under 5 minutes.',
    }),
  };
}
