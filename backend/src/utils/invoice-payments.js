import { getStripe } from './stripe.js';

/**
 * Create a Stripe checkout session for an invoice
 * Returns { checkoutUrl, sessionId } on success, or null if Stripe not configured
 */
export async function createInvoiceCheckoutSession(invoice, user, backendUrl) {
  const stripe = getStripe();
  if (!stripe) {
    console.warn('[Invoice] Stripe not configured, skipping checkout session');
    return null;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: invoice.clientEmail,
      line_items: [
        {
          price_data: {
            currency: (invoice.currency || 'USD').toLowerCase(),
            product_data: {
              name: `Invoice #${invoice.invoiceNumber}`,
              description: `Payment for invoice #${invoice.invoiceNumber}`,
            },
            unit_amount: Math.round(invoice.total * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      success_url: `${backendUrl}/i/${invoice.publicSlug}?payment=success`,
      cancel_url: `${backendUrl}/i/${invoice.publicSlug}?payment=cancelled`,
      metadata: {
        invoiceId: invoice.id,
        userId: user.id,
        invoiceNumber: invoice.invoiceNumber,
      },
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  } catch (err) {
    console.error('[Invoice] Failed to create Stripe checkout session:', err.message);
    return null;
  }
}

/**
 * Retrieve a Stripe checkout session and check if payment was completed
 */
export async function getCheckoutSessionStatus(sessionId) {
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      status: session.payment_status, // 'paid', 'unpaid', 'no_payment_required'
      paymentIntentId: session.payment_intent,
      customerEmail: session.customer_email,
    };
  } catch (err) {
    console.error('[Invoice] Failed to retrieve Stripe session:', err.message);
    return null;
  }
}
