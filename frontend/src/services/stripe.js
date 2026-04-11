import { loadStripe } from '@stripe/stripe-js';

// Cached Stripe.js promise — reuse across redirects
let stripePromise = null;

/**
 * Lazily load Stripe.js with the publishable key.
 *
 * Safety guards:
 *  - If the env var is missing, returns null so callers can fall back gracefully.
 *  - If a SECRET key (sk_*) was accidentally pasted into the publishable slot,
 *    we refuse to load Stripe.js and log a loud error. This prevents leaking
 *    the secret key into the production bundle.
 *  - If the value doesn't look like a Stripe publishable key at all, we warn
 *    in dev so the misconfiguration is caught early.
 */
export function getStripe() {
  if (stripePromise) return stripePromise;

  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    if (import.meta.env.DEV) {
      console.warn('[Stripe] VITE_STRIPE_PUBLISHABLE_KEY is not set — Stripe.js will not load.');
    }
    return Promise.resolve(null);
  }

  if (key.startsWith('sk_')) {
    // This is a secret key. Refuse to load it. Logging the error in plain text
    // doesn't fully mitigate the leak (the key is still in the bundle), but it
    // gives the developer an immediate signal to rotate it.
    console.error(
      '[Stripe] FATAL: VITE_STRIPE_PUBLISHABLE_KEY contains a SECRET key (sk_*). ' +
      'Secret keys must NEVER be shipped to the browser. Replace it with the publishable ' +
      'key (pk_test_… or pk_live_…) from https://dashboard.stripe.com/apikeys and ROTATE ' +
      'the leaked secret key immediately.'
    );
    return Promise.resolve(null);
  }

  if (!key.startsWith('pk_')) {
    if (import.meta.env.DEV) {
      console.warn(
        '[Stripe] VITE_STRIPE_PUBLISHABLE_KEY does not start with "pk_". ' +
        'This may not be a valid Stripe publishable key.'
      );
    }
  }

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
