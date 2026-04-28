import { Router } from 'express';
import Stripe from 'stripe';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    console.warn('[Stripe Webhook] Missing stripe-signature header');
    return res.status(400).json({ error: 'Missing signature' });
  }
  if (!webhookSecret) {
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`[Stripe Webhook] ${event.type} (${event.id})`);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // ── checkout.session.completed ────────────────────────────────────────
  if (event.type === 'checkout.session.completed') {
    try {
      const session = event.data.object;
      const invoiceId = session.metadata?.invoiceId;
      const userId = session.metadata?.userId;
      const paymentIntentId = session.payment_intent || null;

      if (!invoiceId || !userId) {
        console.warn('[Stripe Webhook] Missing invoiceId or userId in metadata');
        return res.json({ received: true });
      }

      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, userId },
        include: {
          lead: { select: { conversationId: true, name: true } },
          payments: { select: { id: true, note: true, stripePaymentIntentId: true } },
        },
      });

      if (!invoice) {
        console.warn(`[Stripe Webhook] Invoice ${invoiceId} not found for user ${userId}`);
        return res.json({ received: true });
      }

      if (invoice.status === 'Paid') {
        console.log(`[Stripe Webhook] Invoice ${invoiceId} already Paid — ignoring duplicate`);
        return res.json({ received: true });
      }

      // Idempotency: skip if payment for this session / intent already recorded
      const alreadyRecorded = invoice.payments.some(
        (p) =>
          (paymentIntentId && p.stripePaymentIntentId === paymentIntentId) ||
          (p.note && p.note.includes(session.id))
      );
      if (alreadyRecorded) {
        console.log(`[Stripe Webhook] Payment already recorded for session ${session.id}`);
        return res.json({ received: true });
      }

      const payment = await prisma.payment.create({
        data: {
          invoiceId,
          amount: invoice.total,
          currency: (invoice.currency || 'USD').toUpperCase(),
          type: 'Full',
          provider: 'stripe',
          stripePaymentIntentId: paymentIntentId,
          stripeSessionId: session.id,
          note: `Stripe payment — session ${session.id}`,
        },
      });

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'Paid' },
        include: {
          items: true,
          payments: true,
          lead: { select: { conversationId: true, name: true } },
        },
      });

      console.log(`[Stripe Webhook] Invoice ${invoiceId} → Paid`);
      emitToUser(userId, 'invoice_updated', { invoice: updatedInvoice });
      emitToUser(userId, 'payment_received', {
        paymentId: payment.id,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
        amount: invoice.total,
        currency: (invoice.currency || 'USD').toUpperCase(),
      });

      if (invoice.lead?.conversationId) {
        try {
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

          emitToUser(userId, 'new_message', {
            message: confirmationMessage,
            conversationId: invoice.lead.conversationId,
            platform: 'system',
          });
        } catch (msgErr) {
          console.error('[Stripe Webhook] Failed to create confirmation message:', msgErr.message);
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error('[Stripe Webhook] Error processing checkout.session.completed:', err);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }

  // ── charge.refunded ───────────────────────────────────────────────────
  if (event.type === 'charge.refunded') {
    try {
      const charge = event.data.object;
      const paymentIntentId = charge.payment_intent;

      if (!paymentIntentId) {
        console.warn('[Stripe Webhook] charge.refunded has no payment_intent — skipping');
        return res.json({ received: true });
      }

      // Find the payment row that was originally recorded for this intent
      const payment = await prisma.payment.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
        include: {
          invoice: {
            select: { id: true, userId: true, total: true, invoiceNumber: true },
          },
        },
      });

      if (!payment) {
        console.warn(`[Stripe Webhook] No payment found for intent ${paymentIntentId}`);
        return res.json({ received: true });
      }

      if (payment.refundedAt) {
        console.log(`[Stripe Webhook] Refund already recorded for payment ${payment.id}`);
        return res.json({ received: true });
      }

      const refundedAmount = charge.amount_refunded / 100;
      const isFullRefund = charge.refunded; // true when fully refunded

      await prisma.payment.update({
        where: { id: payment.id },
        data: { refundedAt: new Date() },
      });

      // Update invoice status
      const newStatus = isFullRefund ? 'Cancelled' : 'Sent';
      const updatedInvoice = await prisma.invoice.update({
        where: { id: payment.invoice.id },
        data: { status: newStatus },
        include: { items: true, payments: true },
      });

      console.log(
        `[Stripe Webhook] Invoice ${payment.invoice.id} → ${newStatus} after ${isFullRefund ? 'full' : 'partial'} refund of ${refundedAmount}`
      );

      emitToUser(payment.invoice.userId, 'invoice_updated', { invoice: updatedInvoice });

      return res.json({ received: true });
    } catch (err) {
      console.error('[Stripe Webhook] Error processing charge.refunded:', err);
      return res.status(500).json({ error: 'Processing failed' });
    }
  }

  // Acknowledge all other event types without processing
  res.json({ received: true });
});

export default router;
