import { Router } from 'express';
import prisma from '../utils/prisma.js';

const router = Router();

// Resolve workspace owner id (team members share the owner's data)
function resolveOwnerId(user) {
  return user.inviterUserId || user.id;
}

/**
 * GET /api/payments
 * Paginated payment history for the workspace.
 * Query params: page, limit, search (client name / invoice #), from, to, provider
 */
router.get('/', async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const provider = req.query.provider || null;

    const where = {
      invoice: { userId: ownerId },
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(provider ? { provider } : {}),
    };

    // Search by client name or invoice number via invoice relation
    if (search) {
      where.invoice = {
        userId: ownerId,
        OR: [
          { clientName: { contains: search, mode: 'insensitive' } },
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
              clientName: true,
              clientEmail: true,
              currency: true,
              status: true,
              publicSlug: true,
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[GET /api/payments]', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

/**
 * GET /api/payments/revenue
 * Aggregated revenue stats for the workspace.
 * Query params: preset (today|week|month|last_month|all), from, to
 */
router.get('/revenue', async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const now = new Date();

    // Build date range from preset or explicit from/to
    let rangeStart = null;
    let rangeEnd = null;

    const preset = req.query.preset || 'month';
    if (req.query.from && req.query.to) {
      rangeStart = new Date(req.query.from);
      rangeEnd = new Date(req.query.to);
    } else if (preset === 'today') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (preset === 'week') {
      const day = now.getDay(); // 0=Sun
      rangeStart = new Date(now);
      rangeStart.setDate(now.getDate() - day);
      rangeStart.setHours(0, 0, 0, 0);
      rangeEnd = new Date(now);
      rangeEnd.setHours(23, 59, 59, 999);
    } else if (preset === 'month') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (preset === 'last_month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      rangeStart = lm;
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    }
    // preset === 'all' → no date filter

    const dateFilter =
      rangeStart && rangeEnd
        ? { gte: rangeStart, lte: rangeEnd }
        : rangeStart
        ? { gte: rangeStart }
        : undefined;

    // Total collected (paid, non-refunded payments in range)
    const collectedPayments = await prisma.payment.findMany({
      where: {
        refundedAt: null,
        invoice: { userId: ownerId },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { amount: true, currency: true },
    });
    const totalCollected = collectedPayments.reduce((s, p) => s + p.amount, 0);

    // Outstanding (invoices that are Sent or Overdue)
    const outstandingInvoices = await prisma.invoice.findMany({
      where: {
        userId: ownerId,
        status: { in: ['Sent', 'Overdue'] },
      },
      select: { total: true },
    });
    const totalOutstanding = outstandingInvoices.reduce((s, inv) => s + inv.total, 0);

    // Overdue (invoices past due date with status Sent/Overdue)
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        userId: ownerId,
        status: { in: ['Sent', 'Overdue'] },
        dueDate: { lt: now },
      },
      select: { total: true },
    });
    const totalOverdue = overdueInvoices.reduce((s, inv) => s + inv.total, 0);

    // Payment count in range
    const paymentCount = collectedPayments.length;

    // Recent payments (last 10) for quick preview
    const recentPayments = await prisma.payment.findMany({
      where: {
        refundedAt: null,
        invoice: { userId: ownerId },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            clientName: true,
            currency: true,
            publicSlug: true,
          },
        },
      },
    });

    res.json({
      totalCollected,
      totalOutstanding,
      totalOverdue,
      paymentCount,
      recentPayments,
      rangeStart,
      rangeEnd,
      preset,
    });
  } catch (err) {
    console.error('[GET /api/payments/revenue]', err);
    res.status(500).json({ error: 'Failed to fetch revenue stats' });
  }
});

export default router;
