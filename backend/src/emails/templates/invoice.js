import { wrapInLayout, ctaButton, escapeHtml } from '../layout.js';

/**
 * Format a number as a currency amount.
 * @param {number} amount
 * @param {string} [currency='USD']
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
 * @param {Date|string} date
 */
function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Invoice delivery email — sent to the client (not the user) when an invoice is issued.
 *
 * @param {Object} data
 * @param {string} data.clientName - Recipient's name
 * @param {string} data.businessName - Sending business name (e.g. user's company name)
 * @param {string} data.invoiceNumber - Human-readable invoice number
 * @param {number} data.total - Invoice total amount
 * @param {string} [data.currency='USD'] - ISO currency code
 * @param {Date|string} data.dueDate - Payment due date
 * @param {string} data.invoiceUrl - Public URL to view + pay the invoice
 * @param {string} [data.note] - Optional note from the sender
 * @returns {{ subject: string, html: string }}
 */
export function invoiceEmailTemplate({
  clientName,
  businessName,
  invoiceNumber,
  total,
  currency = 'USD',
  dueDate,
  invoiceUrl,
  note,
}) {
  const safeClient = escapeHtml(clientName || 'Customer');
  const safeBusiness = escapeHtml(businessName || 'a business on AuraDesk');
  const safeInvoiceNo = escapeHtml(invoiceNumber || '');
  const formattedTotal = formatCurrency(total, currency);
  const formattedDue = formatDate(dueDate);

  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px;">New invoice from ${safeBusiness}</h2>
    <p style="margin:0 0 16px 0;">Hi ${safeClient},</p>
    <p style="margin:0 0 16px 0;">
      You have a new invoice from ${safeBusiness}. The details are below.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:8px;margin:16px 0;">
      <tr>
        <td style="padding:20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Invoice number</td>
              <td style="padding:6px 0;font-size:14px;color:#1f2937;text-align:right;font-weight:600;">${safeInvoiceNo}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Amount due</td>
              <td style="padding:6px 0;font-size:18px;color:#1f2937;text-align:right;font-weight:700;">${formattedTotal}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:14px;color:#6b7280;">Due date</td>
              <td style="padding:6px 0;font-size:14px;color:#1f2937;text-align:right;font-weight:600;">${formattedDue}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    ${note ? `<p style="margin:16px 0;padding:12px 16px;background-color:#eff6ff;border-left:4px solid #3b82f6;border-radius:4px;font-size:14px;color:#1e3a8a;"><strong>Note from ${safeBusiness}:</strong><br>${escapeHtml(note)}</p>` : ''}
    ${ctaButton(invoiceUrl, 'View & Pay Invoice')}
    <p style="margin:24px 0 0 0;color:#6b7280;font-size:14px;">
      Questions about this invoice? Reply to this email and ${safeBusiness} will get back to you.
    </p>
  `;

  return {
    subject: `Invoice ${safeInvoiceNo} from ${safeBusiness} — ${formattedTotal}`,
    html: wrapInLayout(body, {
      previewText: `New invoice ${safeInvoiceNo} for ${formattedTotal}, due ${formattedDue}.`,
    }),
  };
}
