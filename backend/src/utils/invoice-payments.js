import { getStripe } from './stripe.js';
import prisma from './prisma.js';

/**
 * Create a Stripe checkout session for an invoice.
 *
 * When the workspace owner has a connected Stripe account with charges
 * enabled, funds are routed there via destination charges so the payment
 * appears on the connected account's Stripe dashboard.
 *
 * Returns { checkoutUrl, sessionId } on success, or null if Stripe is not
 * configured.
 */
export async function createInvoiceCheckoutSession(invoice, user, frontendBase) {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[Invoice] Stripe not configured, skipping checkout session');
    return null;
  }

  try {
    // Resolve the workspace owner id (team members share the owner's Stripe)
    const ownerId = user.inviterUserId || user.id;

    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { stripeConnectAccountId: true, stripeConnectChargesEnabled: true },
    });

    const sessionParams = {
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: invoice.clientEmail || undefined,
      line_items: [
        {
          price_data: {
            currency: (invoice.currency || 'USD').toLowerCase(),
            product_data: {
              name: `Invoice #${invoice.invoiceNumber}`,
              description: `Payment for invoice #${invoice.invoiceNumber}`,
            },
            unit_amount: Math.round(invoice.total * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${frontendBase}/i/${invoice.publicSlug}?payment=success`,
      cancel_url: `${frontendBase}/i/${invoice.publicSlug}?payment=cancelled`,
      metadata: {
        invoiceId: invoice.id,
        userId: ownerId,
        invoiceNumber: invoice.invoiceNumber,
      },
    };

    // Route funds to the connected account via destination charges
    if (owner?.stripeConnectAccountId && owner.stripeConnectChargesEnabled) {
      sessionParams.payment_intent_data = {
        transfer_data: { destination: owner.stripeConnectAccountId },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return { checkoutUrl: session.url, sessionId: session.id };
  } catch (err) {
    console.error('[Invoice] Failed to create Stripe checkout session:', err.message);
    return null;
  }
}

/**
 * Retrieve a Stripe checkout session and return its payment status.
 */
export async function getCheckoutSessionStatus(sessionId) {
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      status: session.payment_status,
      paymentIntentId: session.payment_intent,
      customerEmail: session.customer_email,
    };
  } catch (err) {
    console.error('[Invoice] Failed to retrieve Stripe session:', err.message);
    return null;
  }
}
