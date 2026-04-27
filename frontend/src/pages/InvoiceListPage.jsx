import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, FilePlus, FileText, Filter, X, Download,
  Clock, CreditCard, ChevronDown, Eye, Edit3, AlertCircle,
  CheckCircle, XCircle, Circle, Calendar,
  Link, Copy, ExternalLink, Zap, RefreshCw,
} from 'lucide-react';
import api from '../services/api.js';

// ─────────────────────────────────────────────────────────────────
// Constants & tiny helpers
// ─────────────────────────────────────────────────────────────────
const STATUS_STYLES = {
  Draft:     { badge: 'bg-gray-100 text-gray-600 border-gray-200',     dot: 'bg-gray-400'  },
  Sent:      { badge: 'bg-blue-50 text-blue-700 border-blue-200',      dot: 'bg-blue-500'  },
  Paid:      { badge: 'bg-green-50 text-green-700 border-green-200',   dot: 'bg-green-500' },
  Overdue:   { badge: 'bg-red-50 text-red-600 border-red-200',         dot: 'bg-red-500'   },
  Cancelled: { badge: 'bg-gray-100 text-gray-400 border-gray-200',     dot: 'bg-gray-300'  },
};

const DATE_PRESETS = [
  { value: '',           label: 'All Time'   },
  { value: 'today',      label: 'Today'      },
  { value: 'this_week',  label: 'This Week'  },
  { value: 'this_month', label: 'This Month' },
  { value: 'custom',     label: 'Custom…'    },
];

const STATUSES = ['All', 'Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'];

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtMoney(n, cur = 'USD') {
  if (n == null) return '-';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

// ─────────────────────────────────────────────────────────────────
// PDF generation via print dialog
// ─────────────────────────────────────────────────────────────────
function openInvoicePDF(inv) {
  const itemsRows = (inv.items || [])
    .map(
      (it, i) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;">${i + 1}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">${it.description || ''}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;">${Number(it.quantity)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;">${fmtMoney(it.unitPrice, inv.currency)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;">${fmtMoney(it.amount, inv.currency)}</td>
        </tr>`
    )
    .join('');

  const paymentsSection =
    inv.payments && inv.payments.length > 0
      ? `<div style="margin-top:24px;">
          <h4 style="font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.08em;margin-bottom:8px;">Payment History</h4>
          ${inv.payments
            .map(
              (p) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid #f1f5f9;">
                <span>${p.type} — ${fmtDate(p.date)}</span>
                <span style="font-weight:600;color:#16a34a;">${fmtMoney(p.amount, inv.currency)}</span>
              </div>`
            )
            .join('')}
        </div>`
      : '';

  const statusColor = { Draft: '#94a3b8', Sent: '#3b82f6', Paid: '#22c55e', Overdue: '#ef4444', Cancelled: '#94a3b8' };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${inv.invoiceNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; background: #fff; padding: 40px; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <!-- Print button -->
  <div class="no-print" style="text-align:right;margin-bottom:24px;">
    <button onclick="window.print()" style="padding:10px 20px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
      Download / Print PDF
    </button>
  </div>

  <!-- Invoice header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
    <div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="width:48px;height:48px;background:#eff6ff;border-radius:12px;display:flex;align-items:center;justify-content:center;">
          <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 3 L3 20 L21 20 Z" stroke="#3b82f6" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>
        </div>
        <div>
          <h2 style="font-size:18px;font-weight:700;color:#0f172a;">AuraDesk</h2>
          <p style="font-size:12px;color:#64748b;">billing@auradesk.com</p>
        </div>
      </div>
    </div>
    <div style="text-align:right;">
      <span style="padding:4px 12px;background:${statusColor[inv.status] || '#94a3b8'}22;color:${statusColor[inv.status] || '#94a3b8'};border:1px solid ${statusColor[inv.status] || '#94a3b8'}44;border-radius:20px;font-size:12px;font-weight:600;">${inv.status}</span>
      <p style="font-size:24px;font-weight:800;color:#0f172a;margin-top:8px;">${fmtMoney(inv.total, inv.currency)}</p>
      <p style="font-size:11px;color:#94a3b8;margin-top:2px;">Invoice #${inv.invoiceNumber}</p>
    </div>
  </div>

  <!-- Client + dates row -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:28px;">
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:.1em;margin-bottom:6px;">Billed To</p>
      <p style="font-size:15px;font-weight:700;color:#0f172a;">${inv.clientName || '-'}</p>
      ${inv.clientEmail ? `<p style="font-size:12px;color:#64748b;margin-top:2px;">${inv.clientEmail}</p>` : ''}
      ${inv.clientPhone ? `<p style="font-size:12px;color:#64748b;margin-top:2px;">${inv.clientPhone}</p>` : ''}
      ${inv.billingAddress ? `<p style="font-size:12px;color:#64748b;margin-top:2px;">${inv.billingAddress}</p>` : ''}
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:.1em;margin-bottom:6px;">Invoice Details</p>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
        <span style="color:#64748b;">Invoice No.</span><span style="font-weight:600;">${inv.invoiceNumber}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
        <span style="color:#64748b;">Date Issued</span><span>${fmtDate(inv.issueDate)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;">
        <span style="color:#64748b;">Due Date</span><span>${fmtDate(inv.dueDate)}</span>
      </div>
    </div>
  </div>

  <!-- Items table -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <thead>
      <tr style="background:#f1f5f9;">
        <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.08em;">#</th>
        <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.08em;">Description</th>
        <th style="text-align:right;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.08em;">Qty</th>
        <th style="text-align:right;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.08em;">Unit Price</th>
        <th style="text-align:right;padding:10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:.08em;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <!-- Totals -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">
    <div style="width:260px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
        <span style="color:#64748b;">Subtotal</span><span>${fmtMoney(inv.subtotal, inv.currency)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid #f1f5f9;">
        <span style="color:#64748b;">Tax (${inv.taxRate || 0}%)</span><span>${fmtMoney(inv.taxAmount, inv.currency)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;padding:8px 0;">
        <span>Total Due</span><span>${fmtMoney(inv.total, inv.currency)}</span>
      </div>
      ${inv.remaining > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;background:#fef9c3;border-radius:6px;padding:6px 8px;margin-top:4px;">
        <span style="color:#92400e;">Remaining</span><span style="font-weight:700;color:#92400e;">${fmtMoney(inv.remaining, inv.currency)}</span>
      </div>` : ''}
    </div>
  </div>

  ${paymentsSection}

  ${inv.note ? `<div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;border-left:3px solid #3b82f6;">
    <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">Note</p>
    <p style="font-size:13px;color:#334155;">${inv.note}</p>
  </div>` : ''}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8;">
    Generated by AuraDesk &middot; ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─────────────────────────────────────────────────────────────────
// Derive timeline events from invoice data (no backend DB table needed)
// ─────────────────────────────────────────────────────────────────
function deriveTimeline(inv) {
  const events = [];

  // 1. Invoice created
  events.push({
    id: 'created',
    type: 'created',
    label: 'Invoice Created',
    detail: `Draft invoice ${inv.invoiceNumber} created`,
    date: inv.createdAt,
    icon: 'circle',
    color: 'text-gray-500',
    bg: 'bg-gray-100',
  });

  // 2. Invoice sent (if not Draft/Cancelled)
  if (['Sent', 'Paid', 'Overdue'].includes(inv.status)) {
    // We don't have an exact sent-at timestamp, so we estimate updatedAt
    // or fall back to createdAt + 1 minute as a safe approximation.
    const sentDate = inv.updatedAt && inv.updatedAt !== inv.createdAt ? inv.updatedAt : new Date(new Date(inv.createdAt).getTime() + 60000).toISOString();
    events.push({
      id: 'sent',
      type: 'sent',
      label: 'Invoice Sent',
      detail: inv.clientEmail ? `Sent to ${inv.clientEmail}` : 'Sent to client',
      date: sentDate,
      icon: 'send',
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    });
  }

  // 3. Payments received
  if (inv.payments && inv.payments.length > 0) {
    inv.payments.forEach((p, idx) => {
      events.push({
        id: `payment-${p.id || idx}`,
        type: 'payment',
        label: `Payment Received`,
        detail: `${p.type || 'Partial'} — ${fmtMoney(p.amount, inv.currency)}${p.note ? ` · ${p.note}` : ''}`,
        date: p.date || p.createdAt,
        icon: 'payment',
        color: 'text-green-600',
        bg: 'bg-green-50',
      });
    });
  }

  // 4. Overdue event (if applicable)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
  if (dueDate && dueDate < today && !['Paid', 'Cancelled', 'Draft'].includes(inv.status)) {
    events.push({
      id: 'overdue',
      type: 'overdue',
      label: 'Invoice Overdue',
      detail: `Due date ${fmtDate(inv.dueDate)} passed`,
      date: inv.dueDate,
      icon: 'alert',
      color: 'text-red-600',
      bg: 'bg-red-50',
    });
  }

  // 5. Paid / Cancelled terminal event
  if (inv.status === 'Paid') {
    events.push({
      id: 'paid',
      type: 'paid',
      label: 'Invoice Paid',
      detail: `Fully paid — ${fmtMoney(inv.totalPaid, inv.currency)}`,
      date: inv.payments?.slice(-1)[0]?.date || inv.updatedAt,
      icon: 'check',
      color: 'text-green-700',
      bg: 'bg-green-100',
    });
  }
  if (inv.status === 'Cancelled') {
    events.push({
      id: 'cancelled',
      type: 'cancelled',
      label: 'Invoice Cancelled',
      detail: 'Invoice was cancelled',
      date: inv.updatedAt,
      icon: 'x',
      color: 'text-gray-500',
      bg: 'bg-gray-100',
    });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

// ─────────────────────────────────────────────────────────────────
// Skeleton row
// ─────────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100">
      {[...Array(7)].map((_, j) => (
        <td key={j} className="px-5 py-4">
          <div className={`h-3 bg-gray-100 rounded animate-pulse ${j === 1 ? 'w-32' : j === 5 ? 'w-16' : 'w-24'}`} />
        </td>
      ))}
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const styles = STATUS_STYLES[status] || STATUS_STYLES.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${styles.badge} ${status === 'Cancelled' ? 'line-through opacity-70' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
      {status}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────
// Payment History Modal
// ─────────────────────────────────────────────────────────────────
function PaymentHistoryModal({ invoice, onClose }) {
  const payments = invoice.payments || [];
  const totalPaid = invoice.totalPaid ?? payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = invoice.remaining ?? invoice.total - totalPaid;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Payment History</h2>
            <p className="text-xs text-gray-500 mt-0.5">Invoice #{invoice.invoiceNumber} · {invoice.clientName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
            <X size={15} />
          </button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 bg-gray-50 border-b border-gray-100">
          <div className="px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Invoice Total</p>
            <p className="text-base font-bold text-gray-900">{fmtMoney(invoice.total, invoice.currency)}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Total Paid</p>
            <p className="text-base font-bold text-green-600">{fmtMoney(totalPaid, invoice.currency)}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Remaining</p>
            <p className={`text-base font-bold ${remaining > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {fmtMoney(Math.max(0, remaining), invoice.currency)}
            </p>
          </div>
        </div>

        {/* Payments list */}
        <div className="max-h-80 overflow-y-auto px-6 py-4">
          {payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <CreditCard size={32} className="mb-2 text-gray-200" />
              <p className="text-sm font-medium">No payments recorded</p>
            </div>
          ) : (
            <div className="space-y-3">
              {payments.map((p, idx) => {
                const runningBalance = payments
                  .slice(0, idx + 1)
                  .reduce((s, pp) => s + Number(pp.amount), 0);
                const bal = +(invoice.total - runningBalance).toFixed(2);
                return (
                  <div key={p.id || idx} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle size={14} className="text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">
                          {p.type === 'Deposit' ? `Deposit #${String(idx + 1).padStart(3, '0')}` : p.type === 'Full' ? 'Full Payment' : `Partial Payment #${String(idx + 1).padStart(3, '0')}`}
                        </p>
                        <span className="text-sm font-bold text-green-700 shrink-0">{fmtMoney(p.amount, invoice.currency)}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Calendar size={10} /> {fmtDate(p.date)}
                        </span>
                        {p.note && (
                          <span className="text-xs text-gray-500 truncate max-w-[180px]">{p.note}</span>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">
                          Balance after: {bal > 0 ? <span className="text-amber-600 font-medium">{fmtMoney(bal, invoice.currency)}</span> : <span className="text-green-600 font-medium">Paid in full</span>}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="w-full px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Modal
// ─────────────────────────────────────────────────────────────────
function TimelineIcon({ type }) {
  if (type === 'payment') return <CheckCircle size={14} className="text-green-600" />;
  if (type === 'sent') return <Circle size={14} className="text-blue-600" />;
  if (type === 'overdue') return <AlertCircle size={14} className="text-red-600" />;
  if (type === 'paid') return <CheckCircle size={14} className="text-green-700" />;
  if (type === 'cancelled') return <XCircle size={14} className="text-gray-400" />;
  return <Circle size={14} className="text-gray-400" />;
}

function TimelineModal({ invoice, onClose }) {
  const events = useMemo(() => deriveTimeline(invoice), [invoice]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Activity Timeline</h2>
            <p className="text-xs text-gray-500 mt-0.5">Invoice #{invoice.invoiceNumber} · {invoice.clientName}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
            <X size={15} />
          </button>
        </div>

        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-gray-200" />

            <div className="space-y-4">
              {events.map((ev, idx) => (
                <div key={ev.id} className="flex gap-4 relative">
                  <div className={`w-10 h-10 rounded-full ${ev.bg} flex items-center justify-center shrink-0 z-10 border-2 border-white shadow-sm`}>
                    <TimelineIcon type={ev.type} />
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <p className={`text-sm font-semibold ${ev.color === 'text-gray-500' ? 'text-gray-700' : ev.color}`}>{ev.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{ev.detail}</p>
                    <p className="text-xs text-gray-400 mt-1">{fmtDateTime(ev.date)}</p>
                  </div>
                  {idx === events.length - 1 && (
                    <span className="text-xs font-semibold text-gray-400 shrink-0 self-center">Latest</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="w-full px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Action row (shown on hover)
// ─────────────────────────────────────────────────────────────────
function ActionCell({
  inv,
  onPaymentHistory,
  onTimeline,
  onDownload,
  onView,
  onEdit,
  stripeConnected,
  onGenerateLink,
  onCopyLink,
  linkCopied,
  generatingLink,
}) {
  const canPaymentLink =
    stripeConnected && !['Paid', 'Cancelled', 'Draft'].includes(inv.status);
  const hasLink = !!inv.paymentLink;

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={(e) => { e.stopPropagation(); onView(); }}
        title="View invoice"
        className="w-7 h-7 rounded-md hover:bg-blue-50 flex items-center justify-center text-gray-400 hover:text-blue-600 transition"
      >
        <Eye size={14} />
      </button>
      {inv.status === 'Draft' && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit draft"
          className="w-7 h-7 rounded-md hover:bg-amber-50 flex items-center justify-center text-gray-400 hover:text-amber-600 transition"
        >
          <Edit3 size={14} />
        </button>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onDownload(); }}
        title="Download PDF"
        className="w-7 h-7 rounded-md hover:bg-green-50 flex items-center justify-center text-gray-400 hover:text-green-600 transition"
      >
        <Download size={14} />
      </button>

      {/* ── Payment link actions ── */}
      {canPaymentLink && !hasLink && (
        <button
          onClick={(e) => onGenerateLink(inv, e)}
          disabled={generatingLink === inv.id}
          title="Generate payment link"
          className="w-7 h-7 rounded-md hover:bg-violet-50 flex items-center justify-center text-gray-400 hover:text-violet-600 transition disabled:opacity-50"
        >
          {generatingLink === inv.id
            ? <RefreshCw size={14} className="animate-spin" />
            : <Link size={14} />}
        </button>
      )}
      {canPaymentLink && hasLink && (
        <>
          <button
            onClick={(e) => onCopyLink(inv, e)}
            title={linkCopied === inv.id ? 'Copied!' : 'Copy payment link'}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition ${
              linkCopied === inv.id
                ? 'bg-green-100 text-green-600'
                : 'hover:bg-violet-50 text-gray-400 hover:text-violet-600'
            }`}
          >
            {linkCopied === inv.id ? <CheckCircle size={14} /> : <Copy size={14} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(inv.paymentLink, '_blank'); }}
            title="Open payment link"
            className="w-7 h-7 rounded-md hover:bg-violet-50 flex items-center justify-center text-gray-400 hover:text-violet-600 transition"
          >
            <ExternalLink size={14} />
          </button>
          <button
            onClick={(e) => onGenerateLink(inv, e)}
            disabled={generatingLink === inv.id}
            title="Regenerate payment link"
            className="w-7 h-7 rounded-md hover:bg-amber-50 flex items-center justify-center text-gray-400 hover:text-amber-600 transition disabled:opacity-50"
          >
            {generatingLink === inv.id
              ? <RefreshCw size={14} className="animate-spin" />
              : <RefreshCw size={14} />}
          </button>
        </>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onPaymentHistory(); }}
        title="Payment history"
        className="w-7 h-7 rounded-md hover:bg-purple-50 flex items-center justify-center text-gray-400 hover:text-purple-600 transition"
      >
        <CreditCard size={14} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onTimeline(); }}
        title="Activity timeline"
        className="w-7 h-7 rounded-md hover:bg-orange-50 flex items-center justify-center text-gray-400 hover:text-orange-600 transition"
      >
        <Clock size={14} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Filter section
// ─────────────────────────────────────────────────────────────────
function FilterBar({ filters, onChange, activeCount }) {
  const [open, setOpen] = useState(false);
  const showCustomDates = filters.datePreset === 'custom';

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${activeCount > 0 ? 'bg-blue-500 text-white shadow-sm' : 'bg-white/10 text-white hover:bg-white/15'}`}
      >
        <Filter size={14} />
        Filters
        {activeCount > 0 && (
          <span className="w-5 h-5 rounded-full bg-white/30 text-xs flex items-center justify-center font-bold">{activeCount}</span>
        )}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-3 bg-white rounded-2xl shadow-xl p-5 border border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Status */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => onChange('status', s === 'All' ? '' : s)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                      (s === 'All' && !filters.status) || filters.status === s
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Date preset */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Date Range</label>
              <select
                value={filters.datePreset}
                onChange={(e) => {
                  onChange('datePreset', e.target.value);
                  if (e.target.value !== 'custom') {
                    onChange('dateFrom', '');
                    onChange('dateTo', '');
                  }
                }}
                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 outline-none"
              >
                {DATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {/* Custom date range */}
            {showCustomDates && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">From</label>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => onChange('dateFrom', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">To</label>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => onChange('dateTo', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 outline-none"
                  />
                </div>
              </>
            )}
          </div>

          {activeCount > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => {
                  onChange('status', '');
                  onChange('datePreset', '');
                  onChange('dateFrom', '');
                  onChange('dateTo', '');
                }}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-red-500 transition"
              >
                <X size={12} /> Clear all filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────
export default function InvoiceListPage() {
  const navigate = useNavigate();

  // ── remote state ──────────────────────────────────────────────
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Stripe Connect state ───────────────────────────────────────
  // null = not yet loaded, object = { connected, account_name, connect_configured }
  const [stripeStatus, setStripeStatus] = useState(null);
  const [stripeConnecting, setStripeConnecting] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(null); // invoice id
  const [linkCopied, setLinkCopied] = useState(null);         // invoice id

  // ── filter state ──────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    datePreset: '',
    dateFrom: '',
    dateTo: '',
  });

  // ── UI state ──────────────────────────────────────────────────
  const [paymentModal, setPaymentModal] = useState(null); // invoice object
  const [timelineModal, setTimelineModal] = useState(null);

  // ── debounce search ───────────────────────────────────────────
  const debounceRef = useRef(null);
  const handleSearchChange = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  };

  // ── Stripe Connect: load status on mount + handle OAuth redirect ──
  useEffect(() => {
    api.get('/api/stripe/status')
      .then((r) => setStripeStatus(r.data))
      .catch(() => setStripeStatus({ connected: false, account_name: null, connect_configured: false }));

    // Handle Stripe OAuth redirect result in query params
    const params = new URLSearchParams(window.location.search);
    const connectResult = params.get('stripe_connect');
    if (connectResult === 'success') {
      window.history.replaceState({}, '', window.location.pathname);
      // Re-fetch status after successful connect
      api.get('/api/stripe/status')
        .then((r) => setStripeStatus(r.data))
        .catch(() => {});
    } else if (connectResult === 'error') {
      const reason = params.get('reason') || 'Unknown error';
      setError(`Stripe Connect failed: ${reason}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const connectStripe = useCallback(async () => {
    setStripeConnecting(true);
    try {
      const res = await api.get('/api/stripe/connect');
      window.location.href = res.data.url;
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to start Stripe Connect');
      setStripeConnecting(false);
    }
  }, []);

  const generatePaymentLink = useCallback(async (inv, e) => {
    e.stopPropagation();
    setGeneratingLink(inv.id);
    try {
      const res = await api.post('/api/stripe/checkout', { invoice_id: inv.id });
      if (res.data.url) {
        setInvoices((prev) =>
          prev.map((i) => i.id === inv.id ? { ...i, paymentLink: res.data.url } : i)
        );
        try {
          await navigator.clipboard.writeText(res.data.url);
          setLinkCopied(inv.id);
          setTimeout(() => setLinkCopied(null), 2500);
        } catch { /* clipboard permission denied */ }
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to generate payment link');
    } finally {
      setGeneratingLink(null);
    }
  }, []);

  const copyPaymentLink = useCallback(async (inv, e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(inv.paymentLink);
      setLinkCopied(inv.id);
      setTimeout(() => setLinkCopied(null), 2500);
    } catch { /* ignore */ }
  }, []);

  // ── filter helpers ────────────────────────────────────────────
  const setFilter = useCallback((key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.status) n++;
    if (filters.datePreset && filters.datePreset !== '') n++;
    if (filters.datePreset === 'custom' && (filters.dateFrom || filters.dateTo)) n++;
    return n;
  }, [filters]);

  // ── fetch (server-side filters) ───────────────────────────────
  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      if (filters.status) params.status = filters.status;
      if (filters.datePreset && filters.datePreset !== 'custom') {
        params.datePreset = filters.datePreset;
      } else if (filters.datePreset === 'custom') {
        if (filters.dateFrom) params.dateFrom = filters.dateFrom;
        if (filters.dateTo) params.dateTo = filters.dateTo;
      }
      const res = await api.get('/api/invoices', { params });
      setInvoices(res.data.invoices || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load invoices. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // ── For PDF we need full invoice with items – fetch on demand ─
  const downloadPDF = useCallback(async (inv) => {
    if (inv.items) {
      // already has items in the list (list endpoint doesn't include items, so fetch detail)
    }
    try {
      const res = await api.get(`/api/invoices/${inv.id}`);
      openInvoicePDF(res.data.invoice);
    } catch {
      openInvoicePDF(inv); // fallback with what we have
    }
  }, []);

  // ── Stats bar ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = invoices.length;
    const paid = invoices.filter((i) => i.status === 'Paid').length;
    const overdue = invoices.filter((i) => i.status === 'Overdue').length;
    const totalRevenue = invoices.filter((i) => i.status === 'Paid').reduce((s, i) => s + Number(i.total), 0);
    return { total, paid, overdue, totalRevenue };
  }, [invoices]);

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c1a2e] overflow-hidden">
      {/* ── Header ── */}
      <div className="px-6 lg:px-8 pt-6 pb-4 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-white">Invoices</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {loading ? 'Loading…' : `${stats.total} invoice${stats.total !== 1 ? 's' : ''}${activeFilterCount > 0 ? ' (filtered)' : ''}`}
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search by name, number or email…"
                className="w-full pl-10 pr-9 py-2.5 bg-white/10 border border-white/10 rounded-full text-sm text-white placeholder-gray-400 focus:bg-white/15 outline-none transition"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setDebouncedSearch(''); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <button
              onClick={() => navigate('/invoices/new')}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1787FE] hover:bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-500/20 transition shrink-0"
            >
              <FilePlus size={15} /> CREATE INVOICE
            </button>
          </div>
        </div>

        {/* Stats row */}
        {!loading && invoices.length > 0 && (
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-400">Total</span>
              <span className="text-sm font-bold text-white">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-gray-400">Paid</span>
              <span className="text-sm font-bold text-green-400">{stats.paid}</span>
            </div>
            {stats.overdue > 0 && (
              <div className="flex items-center gap-2 bg-red-500/10 rounded-lg px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-xs text-red-300">Overdue</span>
                <span className="text-sm font-bold text-red-400">{stats.overdue}</span>
              </div>
            )}
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-400">Revenue</span>
              <span className="text-sm font-bold text-white">{fmtMoney(stats.totalRevenue)}</span>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <FilterBar filters={filters} onChange={setFilter} activeCount={activeFilterCount} />
      </div>

      {/* ── Stripe Connect banner ── */}
      {stripeStatus && !stripeStatus.connected && stripeStatus.connect_configured && (
        <div className="mx-6 lg:mx-8 mb-4 flex items-center justify-between gap-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <Zap size={15} className="text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800">Connect Stripe to enable online payments</p>
              <p className="text-xs text-amber-600 mt-0.5 hidden sm:block">
                Link your Stripe account so clients can pay invoices directly online
              </p>
            </div>
          </div>
          <button
            onClick={connectStripe}
            disabled={stripeConnecting}
            className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
          >
            <Zap size={13} />
            {stripeConnecting ? 'Redirecting…' : 'Connect Stripe'}
          </button>
        </div>
      )}
      {stripeStatus?.connected && (
        <div className="mx-6 lg:mx-8 mb-4 flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-xl px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} className="text-green-600 shrink-0" />
            <p className="text-sm font-semibold text-green-800">
              Stripe connected{stripeStatus.account_name ? ` — ${stripeStatus.account_name}` : ''}
            </p>
            {stripeStatus.charges_enabled === false && (
              <span className="text-xs text-amber-600 font-medium">(charges pending activation)</span>
            )}
          </div>
          <button
            onClick={async () => {
              if (!window.confirm('Disconnect Stripe? Existing payment records will not be affected.')) return;
              try {
                await api.delete('/api/stripe/connect');
                setStripeStatus((s) => ({ ...s, connected: false, account_name: null }));
              } catch { /* ignore */ }
            }}
            className="text-xs text-gray-400 hover:text-red-500 font-semibold transition"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* ── Table card ── */}
      <div className="flex-1 mx-6 lg:mx-8 mb-6 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden min-h-0">
        {/* Error banner */}
        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={14} className="shrink-0" />
            {error}
            <button onClick={fetchInvoices} className="ml-auto text-xs underline font-semibold hover:text-red-800">Retry</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3.5">Invoice #</th>
                <th className="text-left px-5 py-3.5">Client</th>
                <th className="text-left px-5 py-3.5 hidden sm:table-cell">Issued</th>
                <th className="text-left px-5 py-3.5 hidden md:table-cell">Due Date</th>
                <th className="text-right px-5 py-3.5">Amount</th>
                <th className="text-left px-5 py-3.5 hidden sm:table-cell">Status</th>
                <th className="text-right px-5 py-3.5 w-40">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(7)].map((_, i) => <SkeletonRow key={i} />)
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center">
                        <FileText size={24} className="text-gray-300" />
                      </div>
                      {activeFilterCount > 0 || debouncedSearch ? (
                        <>
                          <p className="text-sm font-semibold text-gray-500">No invoices match your filters</p>
                          <p className="text-xs text-gray-400">Try adjusting your search or removing filters</p>
                          <button
                            onClick={() => { setSearch(''); setDebouncedSearch(''); setFilters({ status: '', datePreset: '', dateFrom: '', dateTo: '' }); }}
                            className="mt-1 text-sm text-blue-500 hover:underline font-semibold"
                          >
                            Clear all filters
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-gray-500">No invoices yet</p>
                          <button
                            onClick={() => navigate('/invoices/new')}
                            className="text-sm text-blue-500 hover:underline font-semibold mt-1"
                          >
                            + Create your first invoice
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                    className="group border-t border-gray-100 cursor-pointer hover:bg-blue-50/40 transition-colors"
                  >
                    <td className="px-5 py-4">
                      <span className="text-sm font-bold text-gray-900 font-mono">{inv.invoiceNumber}</span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{inv.clientName}</p>
                      {inv.clientEmail && <p className="text-xs text-gray-400 mt-0.5 hidden lg:block">{inv.clientEmail}</p>}
                    </td>
                    <td className="px-5 py-4 hidden sm:table-cell">
                      <span className="text-sm text-gray-600">{fmtDate(inv.issueDate)}</span>
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      {inv.status === 'Draft' ? (
                        <span className="text-sm text-gray-300">—</span>
                      ) : (
                        <span className={`text-sm ${inv.status === 'Overdue' ? 'text-red-500 font-semibold' : 'text-gray-600'}`}>
                          {fmtDate(inv.dueDate)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div>
                        <span className="text-sm font-bold text-gray-900">{fmtMoney(inv.total, inv.currency)}</span>
                        {inv.totalPaid > 0 && inv.status !== 'Paid' && (
                          <p className="text-xs text-green-600 mt-0.5">{fmtMoney(inv.totalPaid, inv.currency)} paid</p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden sm:table-cell">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end">
                        <ActionCell
                          inv={inv}
                          onView={() => navigate(`/invoices/${inv.id}`)}
                          onEdit={() => navigate(`/invoices/${inv.id}`)}
                          onDownload={() => downloadPDF(inv)}
                          onPaymentHistory={() => setPaymentModal(inv)}
                          onTimeline={() => setTimelineModal(inv)}
                          stripeConnected={stripeStatus?.connected && stripeStatus?.charges_enabled !== false}
                          onGenerateLink={generatePaymentLink}
                          onCopyLink={copyPaymentLink}
                          linkCopied={linkCopied}
                          generatingLink={generatingLink}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50/50">
          <p className="text-xs text-gray-400">
            {loading ? 'Loading…' : `${invoices.length} result${invoices.length !== 1 ? 's' : ''}${activeFilterCount > 0 || debouncedSearch ? ' (filtered)' : ''}`}
          </p>
          {(activeFilterCount > 0 || debouncedSearch) && !loading && (
            <button
              onClick={() => { setSearch(''); setDebouncedSearch(''); setFilters({ status: '', datePreset: '', dateFrom: '', dateTo: '' }); }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 font-semibold transition"
            >
              <X size={11} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {paymentModal && (
        <PaymentHistoryModal invoice={paymentModal} onClose={() => setPaymentModal(null)} />
      )}
      {timelineModal && (
        <TimelineModal invoice={timelineModal} onClose={() => setTimelineModal(null)} />
      )}
    </div>
  );
}
