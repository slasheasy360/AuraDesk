# Payment Auto-Detection Setup — What You Need to Do

Your invoice payment system is now fully implemented. But to make payments automatically detected and update the invoice status, you must complete this critical setup:

## ⚠️ CRITICAL: Stripe Webhook Configuration

### Step 1: Get Your Webhook Secret
1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **"Add an endpoint"**
3. Enter your webhook URL:
   ```
   https://your-render-app.onrender.com/webhooks/stripe
   ```
   *(Replace with your actual backend URL)*
4. Select Events: Check **`checkout.session.completed`**
5. Click **"Add endpoint"**
6. Click the newly created endpoint
7. Scroll down to find **"Signing secret"** (starts with `whsec_`)
8. Click "Reveal" to see the full secret
9. **Copy the entire secret** (including `whsec_` prefix)

### Step 2: Add to Environment Variables
In your Render environment:
1. Go to [Render Dashboard](https://dashboard.render.com)
2. Select your AuraDesk backend service
3. Click **Environment**
4. Add new environment variable:
   ```
   Name: STRIPE_WEBHOOK_SECRET
   Value: whsec_xxxxxxxxxxxxxx
   ```
   *(Paste the secret from Step 1.9)*
5. Click **Save Changes**
6. The app will auto-redeploy

---

## ✅ How It Works After Setup

1. **Client clicks "💳 Pay Now" button** in chat
2. Opens Stripe checkout page
3. Completes payment
4. Stripe sends webhook → Your backend receives it
5. **Automatic:**
   - ✅ Payment recorded in database
   - ✅ Invoice status changes to **"PAID"**
   - ✅ Confirmation message appears in chat
   - ✅ UI updates in real-time (no refresh needed)

---

## 🧪 Test It

### Using Real Card (Production)
- Card: `4242 4242 4242 4242`
- Expiry: `12/25`
- CVC: `123`
- Your real card will be charged

### Using Test Mode (Sandbox)
1. Switch Stripe to **Test Mode** (toggle in top-right)
2. Use test card: `4242 4242 4242 4242`
3. No real charge occurs
4. Still triggers webhook (must have webhook configured)

---

## ❌ If It's Still Not Working

### Check 1: Is STRIPE_WEBHOOK_SECRET Set?
```bash
# In Render logs, you should see:
[Stripe Webhook] Event received: checkout.session.completed
```

If you see:
```
[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured
```
→ Go back to Step 2 and add the environment variable

### Check 2: Is Webhook Endpoint Active?
1. Stripe Dashboard → Webhooks
2. Click your endpoint
3. Look for recent "Successful" deliveries
4. If you see "Failed" → Check app logs for errors

### Check 3: Is Payment Link Being Generated?
In your invoice message, you should see:
```
📄 Invoice #INV-2026-0001
💰 Amount: $128.25
📅 Due: 4/22/2026

[💳 Pay Now] ← Button should be visible
```

If the button isn't showing:
- Try sending the invoice again
- Check browser console for errors (F12 → Console)

### Check 4: Invoice Metadata
When creating the Stripe session, the invoice ID must be in the metadata. Check:
1. Send an invoice
2. Look in the Stripe Dashboard → Customers
3. Find the checkout session
4. Check metadata section — should have `invoiceId`

---

## 📋 Checklist Before Payments Work

- [ ] STRIPE_WEBHOOK_SECRET added to Render environment
- [ ] Render app redeployed (after adding secret)
- [ ] Webhook endpoint configured in Stripe Dashboard
- [ ] Webhook set to listen for `checkout.session.completed` events
- [ ] Test button appears in invoice messages
- [ ] Test payment made (use test card if in sandbox)
- [ ] Confirm message appears in chat after payment
- [ ] Invoice status shows as "PAID"

If all above are done and it still doesn't work, check the Render logs for `[Stripe Webhook]` messages to see what's happening.

---

## 💬 Quick Reference: What Each Part Does

| Component | What it does |
|-----------|------------|
| **Invoice Send** | Creates Stripe session, stores link, sends message with button |
| **Pay Now Button** | Clickable button that opens Stripe checkout |
| **Webhook** | Listens for payment completion from Stripe |
| **Auto-Update** | Records payment, updates invoice status, sends confirmation |
| **Real-time Sync** | Socket.io pushes updates to chat UI instantly |

---

## Next Steps

1. Add the `STRIPE_WEBHOOK_SECRET` to Render
2. Wait for app to redeploy
3. Create a test invoice
4. Click "Pay Now" and complete payment
5. Check if:
   - ✅ Confirmation message appears in chat
   - ✅ Invoice status changes to "Paid"
   - ✅ UI updates without page refresh

That's it! Once webhook is configured, everything is automatic.
