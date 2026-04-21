# Stripe Webhook Setup

Your payment auto-detection system is now ready. When a client completes payment through the Stripe checkout link, the system will automatically:

1. ✅ Detect the payment completion
2. ✅ Record the full payment in the database
3. ✅ Update the invoice status to "Paid"
4. ✅ Send a confirmation message in the chat
5. ✅ Update the UI in real-time

## Configuration Required

You need to add one environment variable to your backend:

### STRIPE_WEBHOOK_SECRET

Get this from your Stripe Dashboard:
1. Go to [Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Endpoint URL: `https://your-production-url.com/webhooks/stripe` (Replace with your actual backend URL)
4. Events to listen for: Select `checkout.session.completed`
5. Click "Add endpoint"
6. Click on the newly created endpoint
7. Scroll down and reveal the "Signing secret" (starts with `whsec_`)
8. Copy this signing secret

### Set the Environment Variable

In your `.env` file or Render environment variables, add:
```
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
```

## How It Works

### Payment Flow:
1. User creates and sends an invoice
2. A Stripe checkout session is automatically created with a payment link
3. Client clicks the payment link in the chat message
4. Client completes payment on Stripe's checkout page
5. Stripe sends a `checkout.session.completed` webhook event
6. Your backend receives the event and verifies the Stripe signature
7. System automatically records the payment and updates the invoice to "Paid"
8. A confirmation message is sent to the chat
9. The invoice list updates in real-time

### Database Updates:
- Creates a new `Payment` record with type "Full"
- Updates the `Invoice` status to "Paid"
- Creates a confirmation message in the conversation

### Real-time Notifications:
- Socket.io events emit to update the UI instantly
- No manual intervention needed
- Client and business owner both see updates in real-time

## Testing (Sandbox Mode)

If you want to test with Stripe's test environment:

1. Use test card: `4242 4242 4242 4242`, expiry `12/25`, CVC `123`
2. Use Stripe's CLI to listen to webhook events locally:
   ```bash
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```
3. This will give you a `STRIPE_WEBHOOK_SECRET` to use for local testing

## Troubleshooting

If payments aren't being detected:

1. **Check webhook endpoint is active**: Go to Stripe Dashboard → Webhooks, verify endpoint shows recent successful deliveries
2. **Verify STRIPE_WEBHOOK_SECRET is set**: `echo $STRIPE_WEBHOOK_SECRET` should show the secret
3. **Check logs**: Look for `[Stripe Webhook]` messages in your server logs
4. **Verify metadata**: Ensure invoices are created with `stripeCheckoutId` and `paymentLink` fields populated
5. **Test with Stripe CLI**: Use the CLI to send a test event to verify the endpoint works

## What Data is Recorded

When payment is detected, the system records:
- **Payment amount**: Full invoice total
- **Payment type**: "Full"
- **Payment note**: References the Stripe session ID
- **Timestamp**: When the webhook was received
- **Invoice status**: Updated to "Paid"

All data is automatically synced to the frontend in real-time.
