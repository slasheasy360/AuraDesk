import { sendMail } from './mailer.js';

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

  const subject = `Invoice ${invoice.invoiceNumber} from ${user.companyName || 'AuraDesk'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">Invoice ${invoice.invoiceNumber}</h2>
      <p>Hello ${invoice.clientName || 'there'},</p>
      <p>Here is your invoice for services provided.</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p><strong>Amount Due:</strong> $${invoice.total.toFixed(2)}</p>
      <p><strong>Due Date:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p><a href="${paymentLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">💳 Pay Now</a></p>
      <p style="margin-top: 20px; color: #666; font-size: 12px;">Thank you for your business!</p>
    </div>
  `;

  try {
    console.log(`[Invoice Channel] Attempting to send email to ${invoice.clientEmail} for invoice ${invoice.invoiceNumber}`);
    const result = await sendMail({
      to: invoice.clientEmail,
      subject,
      html,
      text: invoiceText,
    });

    if (result.sent) {
      console.log(`[Invoice Channel] ✅ Email sent successfully to ${invoice.clientEmail}`, {
        messageId: result.messageId,
        accepted: result.accepted,
      });
      return { success: true, channel: 'email', messageId: result.messageId };
    } else {
      console.error(`[Invoice Channel] ❌ Email send failed: ${result.reason}`);
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
