import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requireActiveSubscription } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';
import { sendMail } from '../utils/mailer.js';
import { createInvoiceCheckoutSession } from '../utils/invoice-payments.js';
import { sendInvoiceThroughChannel } from '../utils/invoice-channel-send.js';

const router = Router();

const VALID_STATUSES = ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'];

// ── helpers ──────────────────────────────────────────────────────────
function makeSlug() {
  return crypto.randomBytes(16).toString('hex'); // 32-char unguessable
}

async function nextInvoiceNumber(userId) {
  const year = new Date().getFullYear();
  const count = await prisma.invoice.count({
    where: { userId, createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

function buildInvoiceEmail({ invoice, company, publicLink }) {
  const subject = `Invoice ${invoice.invoiceNumber} from ${company || 'AuraDesk'}`;
  const lines = [
    `Hi ${invoice.clientName || 'there'},`,
    '',
    `Here is your invoice ${invoice.invoiceNumber}.`,
    `Total: ${invoice.currency} ${invoice.total.toFixed(2)}`,
    `Due date: ${invoice.dueDate.toISOString().slice(0, 10)}`,
    '',
    `View and pay: ${publicLink}`,
  ];
  const text = lines.join('\n');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;color:#0f172a;">Invoice ${invoice.invoiceNumber}</h2>
      <p style="margin:0 0 8px;color:#334155;">Hi ${invoice.clientName || 'there'},</p>
      <p style="margin:0 0 8px;color:#334155;">Here is your invoice.</p>
      <p style="margin:0 0 8px;color:#334155;"><strong>Total:</strong> ${invoice.currency} ${invoice.total.toFixed(2)}</p>
      <p style="margin:0 0 16px;color:#334155;"><strong>Due date:</strong> ${invoice.dueDate.toISOString().slice(0, 10)}</p>
      <a href="${publicLink}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;">View invoice</a>
    </div>
  `;
  return { subject, text, html };
}

function calcTotals(items, taxRate) {
  const subtotal = items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const taxAmount = +(subtotal * (Number(taxRate || 0) / 100)).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxAmount, total };
}

async function loadInvoiceWithComputed(where) {
  const invoice = await prisma.invoice.findFirst({
    where,
    include: {
      items: { orderBy: { position: 'asc' } },
      payments: { orderBy: { date: 'asc' } },
      lead: { select: { id: true, name: true, conversationId: true } },
    },
  });
  if (!invoice) return null;
  const totalPaid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = +(invoice.total - totalPaid).toFixed(2);
  return { ...invoice, totalPaid: +totalPaid.toFixed(2), remaining };
}

async function recomputeStatus(invoiceId) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
  });
  if (!inv || inv.status === 'Cancelled') return;
  const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
  let status = inv.status;
  if (paid >= inv.total && inv.total > 0) status = 'Paid';
  else if (status === 'Paid' && paid < inv.total) status = 'Sent';
  else if (status !== 'Draft' && status !== 'Paid' && inv.dueDate < new Date() && paid < inv.total) status = 'Overdue';
  if (status !== inv.status) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
  }
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC route — must be defined BEFORE authenticate-protected ones
// GET /api/invoices/public/:slug
// ═══════════════════════════════════════════════════════════════════
router.get('/public/:slug', async (req, res) => {
  try {
    const invoice = await loadInvoiceWithComputed({ publicSlug: req.params.slug });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const user = await prisma.user.findUnique({
      where: { id: invoice.userId },
      select: { companyName: true, companyLogo: true, brandColor: true, email: true },
    });

    res.json({ invoice, company: user });
  } catch (err) {
    console.error('Public invoice error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/invoices — list
// ═══════════════════════════════════════════════════════════════════
router.get('/', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const { search, status, leadId } = req.query;
    const where = { userId: req.user.id };
    if (leadId) where.leadId = leadId;
    if (status && VALID_STATUSES.includes(status)) where.status = status;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        payments: { select: { amount: true } },
      },
    });
    const enriched = invoices.map((i) => {
      const paid = i.payments.reduce((s, p) => s + Number(p.amount), 0);
      return { ...i, totalPaid: +paid.toFixed(2), remaining: +(i.total - paid).toFixed(2) };
    });
    res.json({ invoices: enriched });
  } catch (err) {
    console.error('List invoices error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/invoices/:id — detail
// ═══════════════════════════════════════════════════════════════════
router.get('/:id', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const invoice = await loadInvoiceWithComputed({ id: req.params.id, userId: req.user.id });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json({ invoice });
  } catch (err) {
    console.error('Get invoice error:', err);
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/invoices — create (saves as Draft only, no auto-send)
// ═══════════════════════════════════════════════════════════════════
router.post('/', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const {
      leadId,
      clientName,
      clientEmail,
      clientPhone,
      billingAddress,
      issueDate,
      dueDate,
      note,
      currency,
      taxRate,
      items,
    } = req.body;

    if (!clientName || !clientName.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }
    if (!issueDate || !dueDate) {
      return res.status(400).json({ error: 'Issue date and due date are required' });
    }
    const cleanItems = (items || [])
      .filter((it) => it && (it.description || it.unitPrice))
      .map((it, idx) => ({
        description: String(it.description || ''),
        quantity: Math.max(0, Number(it.quantity) || 0),
        unitPrice: Math.max(0, Number(it.unitPrice) || 0),
        amount: +((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)).toFixed(2),
        position: idx,
      }));
    if (cleanItems.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const tax = Number(taxRate) || 0;
    const totals = calcTotals(cleanItems, tax);

    // Validate lead ownership and block duplicate active invoices
    if (leadId) {
      const lead = await prisma.lead.findFirst({ where: { id: leadId, userId: req.user.id } });
      if (!lead) return res.status(400).json({ error: 'Invalid leadId' });

      const activeInvoice = await prisma.invoice.findFirst({
        where: { leadId, status: { in: ['Draft', 'Sent', 'Overdue'] } },
      });
      if (activeInvoice) {
        const msg =
          activeInvoice.status === 'Draft'
            ? 'This lead has an unfinished draft invoice. Complete or delete it before creating a new one.'
            : activeInvoice.status === 'Sent'
            ? 'This lead already has a sent invoice awaiting payment.'
            : 'This lead has an overdue invoice. Resolve it before creating a new one.';
        return res.status(409).json({
          error: msg,
          activeInvoiceId: activeInvoice.id,
          activeStatus: activeInvoice.status,
        });
      }
    }

    const invoiceNumber = await nextInvoiceNumber(req.user.id);
    const publicSlug = makeSlug();

    const invoice = await prisma.invoice.create({
      data: {
        userId: req.user.id,
        leadId: leadId || null,
        invoiceNumber,
        publicSlug,
        clientName: clientName.trim(),
        clientEmail: clientEmail || null,
        clientPhone: clientPhone || null,
        billingAddress: billingAddress || null,
        issueDate: new Date(issueDate),
        dueDate: new Date(dueDate),
        note: note || null,
        currency: currency || 'USD',
        taxRate: tax,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        status: 'Draft',
        items: { create: cleanItems },
      },
      include: { items: true, payments: true },
    });

    emitToUser(req.user.id, 'invoice_created', { invoice });
    res.status(201).json({ invoice });
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id — edit draft
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status !== 'Draft') {
      return res.status(409).json({ error: 'Only Draft invoices can be edited' });
    }

    const { clientName, clientEmail, clientPhone, billingAddress, issueDate, dueDate, note, currency, taxRate, items } = req.body;

    const data = {};
    if (clientName !== undefined) data.clientName = String(clientName).trim() || existing.clientName;
    if (clientEmail !== undefined) data.clientEmail = clientEmail || null;
    if (clientPhone !== undefined) data.clientPhone = clientPhone || null;
    if (billingAddress !== undefined) data.billingAddress = billingAddress || null;
    if (issueDate !== undefined) data.issueDate = new Date(issueDate);
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (note !== undefined) data.note = note || null;
    if (currency !== undefined) data.currency = currency;

    const effectiveTaxRate = taxRate !== undefined ? Number(taxRate) : existing.taxRate;
    if (taxRate !== undefined) data.taxRate = effectiveTaxRate;

    if (items !== undefined) {
      const cleanItems = (items || [])
        .filter((it) => it && (it.description || it.unitPrice))
        .map((it, idx) => ({
          description: String(it.description || ''),
          quantity: Math.max(0, Number(it.quantity) || 0),
          unitPrice: Math.max(0, Number(it.unitPrice) || 0),
          amount: +((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)).toFixed(2),
          position: idx,
        }));
      const totals = calcTotals(cleanItems, effectiveTaxRate);
      data.subtotal = totals.subtotal;
      data.taxAmount = totals.taxAmount;
      data.total = totals.total;

      await prisma.$transaction(async (tx) => {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: existing.id } });
        if (cleanItems.length > 0) {
          await tx.invoiceItem.createMany({
            data: cleanItems.map((item) => ({ invoiceId: existing.id, ...item })),
          });
        }
        await tx.invoice.update({ where: { id: existing.id }, data });
      });
    } else {
      await prisma.invoice.update({ where: { id: existing.id }, data });
    }

    const fresh = await loadInvoiceWithComputed({ id: existing.id });
    emitToUser(req.user.id, 'invoice_updated', { invoice: fresh });
    res.json({ invoice: fresh });
  } catch (err) {
    console.error('Edit draft invoice error:', err);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/invoices/:id/send — send Draft invoice to client via email
// ═══════════════════════════════════════════════════════════════════
router.post('/:id/send', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { items: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status !== 'Draft') {
      return res.status(409).json({ error: 'Only Draft invoices can be sent' });
    }
    if (!existing.clientEmail) {
      return res.status(400).json({ error: 'Client email is required to send the invoice' });
    }

    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
    const publicLink = `${frontendBase}/i/${existing.publicSlug}`;

    // Create Stripe checkout session for payment
    let paymentLink = null;
    let stripeCheckoutId = null;
    if (existing.clientEmail) {
      const checkoutResult = await createInvoiceCheckoutSession(existing, req.user, frontendBase);
      if (checkoutResult) {
        paymentLink = checkoutResult.checkoutUrl;
        stripeCheckoutId = checkoutResult.sessionId;
      }
    }

    await prisma.invoice.update({
      where: { id: existing.id },
      data: {
        status: 'Sent',
        paymentLink,
        stripeCheckoutId,
      },
    });

    // Send invoice through appropriate channel (email/WhatsApp/Instagram/Facebook)
    // and also to the chat
    if (existing.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: existing.leadId },
        select: { conversationId: true, name: true, platform: true },
      });

      // Send through the channel the lead came from
      if (paymentLink && lead?.platform) {
        const channelResult = await sendInvoiceThroughChannel(
          existing,
          lead,
          paymentLink,
          req.user
        );
        console.log(`[Invoice Send] Channel send result for ${lead.platform}:`, channelResult);
      }

      // Also send to chat
      if (lead?.conversationId) {
        const messageContent = paymentLink
          ? `📄 Invoice #${existing.invoiceNumber}\n\n💰 Amount: $${existing.total.toFixed(2)}\n📅 Due: ${new Date(existing.dueDate).toLocaleDateString()}\n\n💳 Pay now: ${paymentLink}`
          : `📄 Invoice #${existing.invoiceNumber}\n\n💰 Amount: $${existing.total.toFixed(2)}\n📅 Due: ${new Date(existing.dueDate).toLocaleDateString()}\n\n👉 View: ${publicLink}`;

        const invoiceMessage = await prisma.message.create({
          data: {
            conversationId: lead.conversationId,
            platformMessageId: `inv-${existing.id}`,
            direction: 'outbound',
            sender: req.user.name || 'AuraDesk',
            subject: `Invoice #${existing.invoiceNumber}`,
            content: messageContent,
            contentType: 'text',
            status: 'sent',
            sentAt: new Date(),
          },
        });
        emitToUser(req.user.id, 'new_message', {
          message: invoiceMessage,
          conversationId: lead.conversationId,
          platform: 'system',
        });
      }
    }

    const fresh = await loadInvoiceWithComputed({ id: existing.id });
    emitToUser(req.user.id, 'invoice_updated', { invoice: fresh });
    res.json({ invoice: fresh, sent: true });
  } catch (err) {
    console.error('Send invoice error:', err);
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id/cancel — cancel a Draft, Sent, or Overdue invoice
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id/cancel', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (!['Draft', 'Sent', 'Overdue'].includes(existing.status)) {
      return res.status(409).json({ error: 'Only Draft, Sent, or Overdue invoices can be cancelled' });
    }

    const updated = await prisma.invoice.update({
      where: { id: existing.id },
      data: { status: 'Cancelled' },
    });
    emitToUser(req.user.id, 'invoice_updated', { invoice: updated });
    res.json({ invoice: updated });
  } catch (err) {
    console.error('Cancel invoice error:', err);
    res.status(500).json({ error: 'Failed to cancel invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id/status
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id/status', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const updated = await prisma.invoice.update({
      where: { id: existing.id },
      data: { status },
    });
    emitToUser(req.user.id, 'invoice_updated', { invoice: updated });
    res.json({ invoice: updated });
  } catch (err) {
    console.error('Update invoice status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/invoices/:id — only Draft invoices can be deleted
// ═══════════════════════════════════════════════════════════════════
router.delete('/:id', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    if (existing.status !== 'Draft') {
      return res.status(409).json({ error: 'Only Draft invoices can be deleted' });
    }
    await prisma.invoice.delete({ where: { id: existing.id } });
    emitToUser(req.user.id, 'invoice_deleted', { id: existing.id });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Delete invoice error:', err);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/invoices/:id/payments — record payment
// ═══════════════════════════════════════════════════════════════════
router.post('/:id/payments', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const { amount, date, type, note } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than zero' });
    }
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { payments: true },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const alreadyPaid = existing.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remaining = +(existing.total - alreadyPaid).toFixed(2);
    if (amt > remaining + 0.001) {
      return res.status(400).json({ error: `Payment exceeds remaining amount (${remaining})` });
    }

    const validTypes = ['Deposit', 'Partial', 'Full'];
    await prisma.payment.create({
      data: {
        invoiceId: existing.id,
        amount: amt,
        date: date ? new Date(date) : new Date(),
        type: validTypes.includes(type) ? type : 'Partial',
        note: note || null,
      },
    });

    await recomputeStatus(existing.id);
    const fresh = await loadInvoiceWithComputed({ id: existing.id });
    emitToUser(req.user.id, 'invoice_updated', { invoice: fresh });
    res.status(201).json({ invoice: fresh });
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: 'Failed to record payment' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/invoices/:id/payments/:paymentId
// ═══════════════════════════════════════════════════════════════════
router.delete('/:id/payments/:paymentId', authenticate, requireActiveSubscription, async (req, res) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
    await prisma.payment.deleteMany({
      where: { id: req.params.paymentId, invoiceId: existing.id },
    });
    await recomputeStatus(existing.id);
    const fresh = await loadInvoiceWithComputed({ id: existing.id });
    emitToUser(req.user.id, 'invoice_updated', { invoice: fresh });
    res.json({ invoice: fresh });
  } catch (err) {
    console.error('Delete payment error:', err);
    res.status(500).json({ error: 'Failed to delete payment' });
  }
});

export default router;
