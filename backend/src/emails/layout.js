/**
 * Shared HTML layout wrapper for all AuraDesk transactional emails.
 *
 * Templates pass in their inner HTML body and this function returns
 * a fully-formed email-safe HTML document with brand header + footer.
 *
 * Inline styles only — most email clients strip <style> tags.
 */

const BRAND_COLOR = '#3b82f6';
const TEXT_COLOR = '#1f2937';
const MUTED_COLOR = '#6b7280';
const BORDER_COLOR = '#e5e7eb';

/**
 * Wrap an HTML body fragment in the AuraDesk branded layout.
 * @param {string} bodyHtml - Inner HTML content (no <html> wrapper)
 * @param {Object} [opts]
 * @param {string} [opts.previewText] - Hidden preview snippet shown in inbox preview
 * @returns {string} Complete HTML document
 */
export function wrapInLayout(bodyHtml, opts = {}) {
  const { previewText = '' } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AuraDesk</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${TEXT_COLOR};">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f9fafb;">${escapeHtml(previewText)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f9fafb;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding:32px 32px 16px 32px;border-bottom:2px solid ${BRAND_COLOR};">
              <h1 style="margin:0;font-size:24px;color:${BRAND_COLOR};letter-spacing:-0.5px;">AuraDesk</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;font-size:16px;line-height:1.6;color:${TEXT_COLOR};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;border-top:1px solid ${BORDER_COLOR};font-size:12px;color:${MUTED_COLOR};">
              <p style="margin:0 0 8px 0;">AuraDesk — AI productivity for solopreneurs and small businesses.</p>
              <p style="margin:0;">You are receiving this email because you signed up for an AuraDesk account.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Render a primary call-to-action button.
 * @param {string} url - Destination URL
 * @param {string} label - Button text
 */
export function ctaButton(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td style="background-color:${BRAND_COLOR};border-radius:6px;">
        <a href="${escapeAttr(url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Escape HTML entities to prevent injection in dynamic content.
 * @param {string} str
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape for HTML attribute values (quotes only).
 * @param {string} str
 */
export function escapeAttr(str) {
  if (str == null) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Resolve the primary frontend URL from the comma-separated FRONTEND_URL env var.
 * Falls back to localhost for local dev.
 */
export function getFrontendUrl() {
  const urls = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',');
  return urls[0].trim();
}
