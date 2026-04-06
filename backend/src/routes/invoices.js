import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import prisma from '../utils/prisma.js';
import { emitToUser } from '../utils/socket.js';

const router = Router();

const VALID_STATUSES = ['Draft', 'Sent', 'Paid', 'Overdue'];

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
  if (!inv) return;
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

    // Include company branding from owning user
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
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = { userId: req.user.id };
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
router.get('/:id', authenticate, async (req, res) => {
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
// POST /api/invoices — create
// ═══════════════════════════════════════════════════════════════════
router.post('/', authenticate, async (req, res) => {
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

    // Validate lead ownership if provided + block duplicate active invoices
    let lead = null;
    if (leadId) {
      lead = await prisma.lead.findFirst({ where: { id: leadId, userId: req.user.id } });
      if (!lead) return res.status(400).json({ error: 'Invalid leadId' });
      const activeInvoice = await prisma.invoice.findFirst({
        where: { leadId, status: { not: 'Paid' } },
      });
      if (activeInvoice) {
        return res.status(409).json({
          error: 'This lead already has an active invoice. Complete payment before creating a new one.',
          activeInvoiceId: activeInvoice.id,
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

    // ── Auto-send to chat if lead has conversation ──
    if (lead?.conversationId) {
      try {
        const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();
        const link = `${frontendBase}/i/${publicSlug}`;
        const content = `Your invoice is ready: ${link}`;

        const message = await prisma.message.create({
          data: {
            conversationId: lead.conversationId,
            direction: 'outbound',
            content,
            contentType: 'text',
            status: 'sent',
          },
        });

        // Bump conversation lastMessageAt so it sorts to top of inbox
        const updatedConv = await prisma.conversation.update({
          where: { id: lead.conversationId },
          data: { lastMessageAt: message.sentAt },
          include: { connectedAccount: { select: { platform: true } } },
        });

        // Emit the same events the inbox already listens to
        emitToUser(req.user.id, 'new_message', {
          conversationId: lead.conversationId,
          message,
          platform: updatedConv.connectedAccount?.platform,
        });
        emitToUser(req.user.id, 'conversation_update', {
          conversationId: lead.conversationId,
          lastMessageAt: updatedConv.lastMessageAt,
          unreadCount: updatedConv.unreadCount,
        });
      } catch (e) {
        console.warn('Auto-send invoice message failed:', e.message);
      }
    }

    emitToUser(req.user.id, 'invoice_created', { invoice });
    res.status(201).json({ invoice });
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/invoices/:id/status
// ═══════════════════════════════════════════════════════════════════
router.patch('/:id/status', authenticate, async (req, res) => {
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
// DELETE /api/invoices/:id
// ═══════════════════════════════════════════════════════════════════
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const existing = await prisma.invoice.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });
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
router.post('/:id/payments', authenticate, async (req, res) => {
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
router.delete('/:id/payments/:paymentId', authenticate, async (req, res) => {
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
