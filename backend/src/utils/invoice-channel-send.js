import { sendMail } from './mailer.js';
import { sendEmail as sendGmailEmail } from '../services/gmail.js';
import { sendMessage as sendFacebookMessage } from '../services/facebook.js';
import { sendMessage as sendWhatsAppMessage } from '../services/whatsapp.js';
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

async function sendViaFacebook(invoice, lead, invoiceText) {
  try {
    if (!lead.conversationId) {
      console.warn('[Invoice Channel] No conversation for lead, cannot send via Facebook');
      return { success: false, reason: 'no_conversation' };
    }

    // Get conversation and contact to find PSID
    const conversation = await prisma.conversation.findUnique({
      where: { id: lead.conversationId },
      include: { contact: true, connectedAccount: true },
    });

    if (!conversation || !conversation.contact) {
      console.warn('[Invoice Channel] Could not find Facebook conversation or contact');
      return { success: false, reason: 'no_conversation_or_contact' };
    }

    const recipientPsid = conversation.contact.platformUserId;
    const connectedAccountId = conversation.connectedAccountId;

    if (!recipientPsid) {
      console.warn('[Invoice Channel] No PSID found for Facebook contact');
      return { success: false, reason: 'no_psid' };
    }

    console.log(`[Invoice Channel] Sending invoice via Facebook to PSID: ${recipientPsid?.slice(-6)}`);

    const result = await sendFacebookMessage(connectedAccountId, recipientPsid, invoiceText);

    console.log(`[Invoice Channel] ✅ Facebook: Invoice sent to lead ${lead.id}`, {
      messageId: result.message_id,
    });
    return { success: true, channel: 'facebook', messageId: result.message_id };
  } catch (err) {
    console.error('[Invoice Channel] Facebook send failed:', err.message);
    return { success: false, reason: 'facebook_error', error: err.message };
  }
}

async function sendViaWhatsApp(invoice, lead, invoiceText) {
  try {
    if (!lead.conversationId) {
      console.warn('[Invoice Channel] No conversation for lead, cannot send via WhatsApp');
      return { success: false, reason: 'no_conversation' };
    }

    // Get conversation and contact to find WhatsApp number
    const conversation = await prisma.conversation.findUnique({
      where: { id: lead.conversationId },
      include: { contact: true, connectedAccount: true },
    });

    if (!conversation || !conversation.contact) {
      console.warn('[Invoice Channel] Could not find WhatsApp conversation or contact');
      return { success: false, reason: 'no_conversation_or_contact' };
    }

    const recipientId = conversation.contact.platformUserId;
    const connectedAccountId = conversation.connectedAccountId;

    if (!recipientId) {
      console.warn('[Invoice Channel] No recipient ID found for WhatsApp');
      return { success: false, reason: 'no_recipient_id' };
    }

    console.log(`[Invoice Channel] Sending invoice via WhatsApp to: ${recipientId?.slice(-6)}`);

    const result = await sendWhatsAppMessage(connectedAccountId, recipientId, invoiceText);

    console.log(`[Invoice Channel] ✅ WhatsApp: Invoice sent to lead ${lead.id}`, {
      messageId: result.message_id || result.id,
    });
    return { success: true, channel: 'whatsapp', messageId: result.message_id || result.id };
  } catch (err) {
    console.error('[Invoice Channel] WhatsApp send failed:', err.message);
    return { success: false, reason: 'whatsapp_error', error: err.message };
  }
}

async function sendViaInstagram(invoice, lead, invoiceText) {
  try {
    if (!lead.conversationId) {
      console.warn('[Invoice Channel] No conversation for lead, cannot send via Instagram');
      return { success: false, reason: 'no_conversation' };
    }

    // Get conversation and contact to find Instagram PSID
    const conversation = await prisma.conversation.findUnique({
      where: { id: lead.conversationId },
      include: { contact: true, connectedAccount: true },
    });

    if (!conversation || !conversation.contact) {
      console.warn('[Invoice Channel] Could not find Instagram conversation or contact');
      return { success: false, reason: 'no_conversation_or_contact' };
    }

    const recipientPsid = conversation.contact.platformUserId;
    const connectedAccountId = conversation.connectedAccountId;

    if (!recipientPsid) {
      console.warn('[Invoice Channel] No PSID found for Instagram contact');
      return { success: false, reason: 'no_psid' };
    }

    console.log(`[Invoice Channel] Sending invoice via Instagram to PSID: ${recipientPsid?.slice(-6)}`);

    // Instagram uses the same Facebook API as Messenger
    const result = await sendFacebookMessage(connectedAccountId, recipientPsid, invoiceText);

    console.log(`[Invoice Channel] ✅ Instagram: Invoice sent to lead ${lead.id}`, {
      messageId: result.message_id,
    });
    return { success: true, channel: 'instagram', messageId: result.message_id };
  } catch (err) {
    console.error('[Invoice Channel] Instagram send failed:', err.message);
    return { success: false, reason: 'instagram_error', error: err.message };
  }
}
