import { Router } from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /webhooks/stripe
 * Raw body webhook endpoint for Stripe events.
 * Verifies the signature and processes checkout.session.completed events.
 */
router.post('/', async (req, res) => {
  // Stripe webhooks send raw body, not JSON
  const sig = req.headers['stripe-signature'];
  if (!sig || !webhookSecret) {
    console.warn('[Stripe Webhook] Missing signature or webhook secret');
    return res.status(400).json({ error: 'Missing signature' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Process checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    try {
      const session = event.data.object;
      const invoiceId = session.metadata?.invoiceId;
      const userId = session.metadata?.userId;

      if (!invoiceId || !userId) {
        console.warn('[Stripe Webhook] Missing invoiceId or userId in metadata');
        return res.json({ received: true });
      }

      // Fetch invoice to verify ownership
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, userId },
        include: {
          lead: { select: { conversationId: true, name: true } },
          payments: true,
        },
      });

      if (!invoice) {
        console.warn(`[Stripe Webhook] Invoice ${invoiceId} not found for user ${userId}`);
        return res.json({ received: true });
      }

      // Check if already paid to prevent duplicate payments
      if (invoice.status === 'Paid') {
        console.log(`[Stripe Webhook] Invoice ${invoiceId} already paid, ignoring duplicate webhook`);
        return res.json({ received: true });
      }

      // Check if payment for this session already exists
      const existingPayment = invoice.payments.find(p =>
        p.note && p.note.includes(session.id)
      );
      if (existingPayment) {
        console.log(`[Stripe Webhook] Payment already recorded for session ${session.id}`);
        return res.json({ received: true });
      }

      // Record payment (Full payment since checkout is complete)
      const payment = await prisma.payment.create({
        data: {
          invoiceId,
          amount: invoice.total,
          type: 'Full',
          note: `Stripe payment via checkout session ${session.id}`,
        },
      });

      // Update invoice status to Paid
      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'Paid' },
        include: { items: true, payments: true },
      });

      // Send confirmation message to chat if lead exists
      if (invoice.lead?.conversationId) {
        const confirmationMessage = await prisma.message.create({
          data: {
            conversationId: invoice.lead.conversationId,
            platformMessageId: `payment-${payment.id}`,
            direction: 'outbound',
            sender: 'AuraDesk',
            subject: `Payment Received for Invoice #${invoice.invoiceNumber}`,
            content: `✅ Payment received!\n\nInvoice #${invoice.invoiceNumber}\nAmount: $${invoice.total.toFixed(2)}\n\nThank you for your payment.`,
            contentType: 'text',
            status: 'sent',
            sentAt: new Date(),
          },
        });

        // Emit socket events to update UI in real-time
        emitToUser(userId, 'invoice_updated', { invoice: updatedInvoice });
        emitToUser(userId, 'new_message', {
          message: confirmationMessage,
          conversationId: invoice.lead.conversationId,
          platform: 'system',
        });
      }

      console.log(`[Stripe Webhook] Payment received for invoice ${invoiceId}`);
      return res.json({ received: true });
    } catch (err) {
      console.error('[Stripe Webhook] Error processing checkout.session.completed:', err);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }

  // Acknowledge receipt of other event types without processing
  res.json({ received: true });
});

export default router;
