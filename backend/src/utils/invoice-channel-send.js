import { sendMail } from './mailer.js';
import { sendEmail as sendGmailEmail } from '../services/gmail.js';
import prisma from './prisma.js';

/**
 * Send invoice through the channel the lead came from
 * Gmail → email, WhatsApp → WhatsApp message, Instagram/Facebook → DM
 */
export async function sendInvoiceThroughChannel(invoice, lead, paymentLink, user) {
  if (!lead || !lead.platform) {
    console.warn('[Invoice Channel] No platform specified for lead, skipping channel send');
    return { success: false, reason: 'no_platform' };
  }

  const invoiceText = buildInvoiceText(invoice, paymentLink);

  try {
    switch (lead.platform.toLowerCase()) {
      case 'gmail':
        return await sendViaEmail(invoice, lead, paymentLink, user, invoiceText);
      case 'whatsapp':
        return await sendViaWhatsApp(invoice, lead, invoiceText);
      case 'instagram':
        return await sendViaInstagram(invoice, lead, invoiceText);
      case 'facebook':
        return await sendViaFacebook(invoice, lead, invoiceText);
      default:
        console.warn(`[Invoice Channel] Unknown platform: ${lead.platform}`);
        return { success: false, reason: 'unknown_platform' };
    }
  } catch (err) {
    console.error(`[Invoice Channel] Failed to send via ${lead.platform}:`, err.message);
    return { success: false, reason: 'send_error', error: err.message };
  }
}

function buildInvoiceText(invoice, paymentLink) {
  return `Invoice #${invoice.invoiceNumber}\n\nAmount: $${invoice.total.toFixed(2)}\nDue: ${new Date(invoice.dueDate).toLocaleDateString()}\n\nPay now: ${paymentLink}`;
}

async function sendViaEmail(invoice, lead, paymentLink, user, invoiceText) {
  if (!invoice.clientEmail) {
    console.warn('[Invoice Channel] No client email for invoice', invoice.id);
    return { success: false, reason: 'no_client_email' };
  }

  const subject = `Invoice ${invoice.invoiceNumber}`;
  const bodyText = `# Invoice ${invoice.invoiceNumber}

**Client:** ${invoice.clientName}
**Amount:** $${invoice.total.toFixed(2)}
**Due:** ${new Date(invoice.dueDate).toLocaleDateString()}

---

[Pay Now](${paymentLink})

---

Thank you for your business!`;

  try {
    console.log(`[Invoice Channel] Attempting to send email to ${invoice.clientEmail} for invoice ${invoice.invoiceNumber}`);

    // Try Gmail API first (more reliable, already authenticated)
    const gmailAccount = await prisma.connectedAccount.findFirst({
      where: {
        userId: user.id,
        platform: 'gmail',
        status: 'active',
      },
    });

    if (gmailAccount) {
      try {
        console.log(`[Invoice Channel] Using Gmail API to send invoice email`);
        const result = await sendGmailEmail(
          gmailAccount.id,
          invoice.clientEmail,
          subject,
          bodyText
        );
        console.log(`[Invoice Channel] ✅ Gmail API: Invoice email sent to ${invoice.clientEmail}`, {
          messageId: result.id,
        });
        return { success: true, channel: 'email', method: 'gmail_api', messageId: result.id };
      } catch (gmailErr) {
        console.warn(`[Invoice Channel] Gmail API send failed, trying SMTP:`, gmailErr.message);
      }
    }

    // Fall back to SMTP if Gmail API not available
    console.log(`[Invoice Channel] Falling back to SMTP for email send`);
    const result = await sendMail({
      to: invoice.clientEmail,
      subject,
      text: bodyText,
    });

    if (result.sent) {
      console.log(`[Invoice Channel] ✅ SMTP: Invoice email sent to ${invoice.clientEmail}`, {
        messageId: result.messageId,
      });
      return { success: true, channel: 'email', method: 'smtp', messageId: result.messageId };
    } else {
      console.error(`[Invoice Channel] ❌ SMTP send failed: ${result.reason}`);
      return { success: false, reason: result.reason };
    }
  } catch (err) {
    console.error('[Invoice Channel] Email send exception:', err.message);
    return { success: false, reason: 'email_error', error: err.message };
  }
}

async function sendViaWhatsApp(invoice, lead, invoiceText) {
  // WhatsApp sending would require WhatsApp Business API integration
  // For now, log that it would be sent
  console.log(`[Invoice Channel] Would send via WhatsApp to lead ${lead.id}:`, invoiceText);
  return { success: false, reason: 'whatsapp_not_implemented' };
}

async function sendViaInstagram(invoice, lead, invoiceText) {
  // Instagram sending would require Instagram Graph API integration
  // For now, log that it would be sent
  console.log(`[Invoice Channel] Would send via Instagram to lead ${lead.id}:`, invoiceText);
  return { success: false, reason: 'instagram_not_implemented' };
}

async function sendViaFacebook(invoice, lead, invoiceText) {
  // Facebook sending would require Facebook Graph API integration
  // For now, log that it would be sent
  console.log(`[Invoice Channel] Would send via Facebook to lead ${lead.id}:`, invoiceText);
  return { success: false, reason: 'facebook_not_implemented' };
}
