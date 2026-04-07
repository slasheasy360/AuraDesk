import { loadStripe } from '@stripe/stripe-js';

// Cached Stripe.js promise — reuse across redirects
let stripePromise = null;
export function getStripe() {
  if (stripePromise) return stripePromise;
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) return Promise.resolve(null);
  stripePromise = loadStripe(key);
  return stripePromise;
}

/**
 * Redirect the browser to a Stripe Checkout session.
 * Prefers the modern `session.url` redirect (recommended) and falls
 * back to `stripe.redirectToCheckout({ sessionId })` if no URL is given.
 *
 * @param {{ url?: string, sessionId?: string }} session
 */
export async function redirectToStripeCheckout(session) {
  if (!session) throw new Error('No checkout session provided');
  if (session.url) {
    window.location.href = session.url;
    return;
  }
  const stripe = await getStripe();
  if (!stripe) {
    throw new Error('Stripe.js could not load. Set VITE_STRIPE_PUBLISHABLE_KEY.');
  }
  const { error } = await stripe.redirectToCheckout({ sessionId: session.sessionId });
  if (error) throw error;
}
