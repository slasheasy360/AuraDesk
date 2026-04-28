import { Router } from 'express';
import prisma from '../utils/prisma.js';

const router = Router();

function resolveOwnerId(user) {
  return user.inviterUserId || user.id;
}

function buildRange(preset) {
  const now = new Date();
  let start, end, prevStart, prevEnd;

  if (preset === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    prevStart = new Date(start); prevStart.setDate(start.getDate() - 1);
    prevEnd   = new Date(end);   prevEnd.setDate(end.getDate() - 1);
  } else if (preset === 'week') {
    const day = now.getDay();
    start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0);
    end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    prevStart = new Date(start); prevStart.setDate(start.getDate() - 7);
    prevEnd   = new Date(end);   prevEnd.setDate(end.getDate() - 7);
  } else if (preset === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    prevStart = new Date(now.getFullYear() - 1, 0, 1);
    prevEnd   = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  } else {
    // month (default)
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  }

  return { start, end, prevStart, prevEnd };
}

function trendPct(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// Bucket payments into chart points depending on preset
function buildTrend(payments, preset, rangeStart) {
  if (preset === 'today') {
    const labels = ['12am','2am','4am','6am','8am','10am','12pm','2pm','4pm','6pm','8pm','10pm'];
    const buckets = labels.map(l => ({ label: l, amount: 0 }));
    payments.forEach(p => {
      const h = new Date(p.createdAt).getHours();
      buckets[Math.floor(h / 2)].amount += p.amount;
    });
    return buckets;
  }
  if (preset === 'week') {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const buckets = days.map(d => ({ label: d, amount: 0 }));
    payments.forEach(p => { buckets[new Date(p.createdAt).getDay()].amount += p.amount; });
    return buckets;
  }
  if (preset === 'year') {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const buckets = months.map(m => ({ label: m, amount: 0 }));
    payments.forEach(p => { buckets[new Date(p.createdAt).getMonth()].amount += p.amount; });
    return buckets;
  }
  // month: daily buckets
  const daysInMonth = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0).getDate();
  const buckets = Array.from({ length: daysInMonth }, (_, i) => ({ label: `${i + 1}`, amount: 0 }));
  payments.forEach(p => {
    const d = new Date(p.createdAt).getDate() - 1;
    if (d >= 0 && d < buckets.length) buckets[d].amount += p.amount;
  });
  return buckets;
}

/**
 * GET /api/dashboard?preset=today|week|month|year
 * Single aggregated endpoint — returns all dashboard data in one round-trip.
 */
router.get('/', async (req, res) => {
  try {
    const ownerId = resolveOwnerId(req.user);
    const preset = ['today', 'week', 'month', 'year'].includes(req.query.preset)
      ? req.query.preset : 'month';
    const { start, end, prevStart, prevEnd } = buildRange(preset);

    // Resolve connected account IDs for conversation queries
    const accounts = await prisma.connectedAccount.findMany({
      where: { userId: ownerId },
      select: { id: true },
    });
    const accountIds = accounts.map(a => a.id);

    const convWhere = accountIds.length > 0
      ? { connectedAccountId: { in: accountIds }, isDeleted: false }
      : null;

    const [
      totalLeads,
      newLeads,
      prevNewLeads,
      pendingData,
      revCurrent,
      revPrevious,
      paymentsForTrend,
      convCounts,
      recentLeads,
      recentPayments,
      recentInvoices,
      aiCounts,
    ] = await Promise.all([
      prisma.lead.count({ where: { userId: ownerId } }),

      prisma.lead.count({ where: { userId: ownerId, createdAt: { gte: start, lte: end } } }),
      prisma.lead.count({ where: { userId: ownerId, createdAt: { gte: prevStart, lte: prevEnd } } }),

      prisma.invoice.aggregate({
        where: { userId: ownerId, status: { in: ['Sent', 'Overdue'] } },
        _count: { id: true },
        _sum: { total: true },
      }),

      prisma.payment.aggregate({
        where: { invoice: { userId: ownerId }, refundedAt: null, createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { invoice: { userId: ownerId }, refundedAt: null, createdAt: { gte: prevStart, lte: prevEnd } },
        _sum: { amount: true },
      }),

      prisma.payment.findMany({
        where: { invoice: { userId: ownerId }, refundedAt: null, createdAt: { gte: start, lte: end } },
        select: { amount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),

      convWhere
        ? Promise.all([
            prisma.conversation.count({ where: convWhere }),
            prisma.conversation.count({ where: { ...convWhere, unreadCount: { gt: 0 } } }),
            prisma.conversation.count({ where: { ...convWhere, status: 'open' } }),
            prisma.conversation.count({ where: { ...convWhere, isStarred: true } }),
          ])
        : Promise.resolve([0, 0, 0, 0]),

      prisma.lead.findMany({
        where: { userId: ownerId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, platform: true, status: true, createdAt: true },
      }),

      prisma.payment.findMany({
        where: { invoice: { userId: ownerId } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          invoice: { select: { invoiceNumber: true, clientName: true, currency: true } },
        },
      }),

      prisma.invoice.findMany({
        where: { userId: ownerId, status: { not: 'Draft' } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true, invoiceNumber: true, clientName: true,
          status: true, total: true, currency: true,
          updatedAt: true, createdAt: true,
        },
      }),

      Promise.all([
        prisma.faq.count({ where: { userId: ownerId } }),
        prisma.trainingFile.count({ where: { userId: ownerId } }),
      ]),
    ]);

    const [totalConvs, unreadConvs, activeConvs, starredConvs] = convCounts;
    const [faqCount, fileCount] = aiCounts;

    const revAmt = revCurrent._sum?.amount || 0;
    const revPrevAmt = revPrevious._sum?.amount || 0;

    // Build activity feed (latest across all entity types)
    const activity = [
      ...recentLeads.map(l => ({
        id: `lead-${l.id}`,
        type: 'lead',
        title: 'New lead added',
        description: `${l.name}${l.platform ? ` via ${l.platform}` : ''}`,
        createdAt: l.createdAt,
        link: '/leads',
      })),
      ...recentPayments.map(p => ({
        id: `payment-${p.id}`,
        type: 'payment',
        title: 'Payment received',
        description: `Invoice #${p.invoice.invoiceNumber} — ${p.invoice.currency} ${p.amount.toFixed(2)} from ${p.invoice.clientName}`,
        createdAt: p.createdAt,
        link: '/payments',
      })),
      ...recentInvoices.map(inv => ({
        id: `invoice-${inv.id}`,
        type: inv.status === 'Paid' ? 'invoice_paid' : 'invoice',
        title: inv.status === 'Paid' ? 'Invoice paid'
          : inv.status === 'Sent' ? 'Invoice sent'
          : `Invoice ${inv.status.toLowerCase()}`,
        description: `#${inv.invoiceNumber} — ${inv.currency} ${inv.total.toFixed(2)} — ${inv.clientName}`,
        createdAt: inv.updatedAt || inv.createdAt,
        link: '/invoices',
      })),
    ]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10);

    res.json({
      preset,
      stats: {
        totalLeads,
        newLeads,
        newLeadsTrendPct: trendPct(newLeads, prevNewLeads),
        unreadMessages: unreadConvs,
        revenue: revAmt,
        revenueTrendPct: trendPct(revAmt, revPrevAmt),
        pendingInvoices: pendingData._count?.id || 0,
        pendingAmount: pendingData._sum?.total || 0,
      },
      inbox: {
        total: totalConvs,
        unread: unreadConvs,
        active: activeConvs,
        starred: starredConvs,
      },
      activity,
      revenueTrend: buildTrend(paymentsForTrend, preset, start),
      aiStats: {
        faqCount,
        fileCount,
        totalItems: faqCount + fileCount,
        isActive: faqCount + fileCount > 0,
      },
    });
  } catch (err) {
    console.error('[GET /api/dashboard]', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

export default router;
