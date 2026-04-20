import { sendEmail } from '../../utils/email.js';
import { invoiceEmailTemplate } from '../templates/invoice.js';
import { getFrontendUrl } from '../layout.js';

/**
 * Send an invoice email to a client.
 *
 * @param {Object} params
 * @param {Object} params.invoice - Invoice record (Prisma model)
 * @param {Object} params.user - User object (the business sending the invoice)
 * @returns {Promise<{messageId: string}>}
 *
 * @example
 *   await sendInvoiceEmail({ invoice, user });
 */
export async function sendInvoiceEmail({ invoice, user }) {
  if (!invoice?.clientEmail) {
    throw new Error('sendInvoiceEmail: invoice.clientEmail is required');
  }

  const invoiceUrl = `${getFrontendUrl()}/invoice/${invoice.publicSlug}`;

  const { subject, html } = invoiceEmailTemplate({
    clientName: invoice.clientName,
    businessName: user?.companyName || user?.name || 'AuraDesk',
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    currency: invoice.currency || 'USD',
    dueDate: invoice.dueDate,
    invoiceUrl,
    note: invoice.note,
  });

  return sendEmail({
    to: invoice.clientEmail,
    subject,
    html,
    replyTo: user?.email,
  });
}
