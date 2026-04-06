import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(n, cur = 'USD') {
  if (n == null) return '-';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
}

export default function PublicInvoicePage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`${API}/api/invoices/public/${slug}`)
      .then((res) => setData(res.data))
      .catch((e) => setError(e.response?.data?.error || 'Invoice not found'))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-500">Loading…</div>;
  if (error) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-500">{error}</div>;

  const { invoice, company } = data;
  const cur = invoice.currency;

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl p-10">
        <div className="flex justify-between items-start mb-8">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center">
              {company?.companyLogo ? (
                <img src={company.companyLogo} alt="" className="w-12 h-12 object-contain" />
              ) : (
                <svg viewBox="0 0 24 24" className="w-10 h-10"><path d="M12 3 L3 20 L21 20 Z" stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinejoin="round" /></svg>
              )}
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-lg">{company?.companyName || 'AuraDesk'}</h3>
              <p className="text-sm text-gray-600">John Brandon</p>
              <p className="text-sm text-gray-600">123 Business Street, Naples, FL</p>
              <p className="text-sm text-gray-600">+1-555-123-4567 | <span className="text-blue-500 underline">{company?.email || 'billing@auradesk.com'}</span></p>
              <p className="text-sm text-gray-600">Tax ID: 12-3456789</p>
            </div>
          </div>
          <div className="text-right">
            <span className="px-3 py-1 bg-gray-100 rounded text-xs font-mono text-gray-700">#{invoice.invoiceNumber}</span>
            <p className="text-xs text-gray-500 mt-3">Total Amount</p>
            <p className="text-xl font-bold text-gray-900">{fmtMoney(invoice.total, cur)}</p>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-6 mb-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-50 -m-6 mr-0 p-6 rounded-l-lg">
              <p className="text-xs text-gray-500 mb-1">Invoice No</p>
              <p className="font-bold text-gray-900">{invoice.invoiceNumber}</p>
              <p className="text-xs text-gray-500 mt-3 mb-1">Date Issued</p>
              <p className="text-sm text-gray-700">{fmtDate(invoice.issueDate)}</p>
              <p className="text-xs text-gray-500 mt-3 mb-1">Due Date</p>
              <p className="text-sm text-gray-700">{fmtDate(invoice.dueDate)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Billing Address</p>
              <p className="text-sm text-gray-900 font-semibold">{invoice.clientName}</p>
              <p className="text-sm text-gray-600">{invoice.billingAddress}</p>
              <p className="text-sm text-gray-600">{invoice.clientPhone}</p>
              <p className="text-sm text-gray-600">{invoice.clientEmail}</p>
              {invoice.note && (<>
                <p className="text-xs text-gray-500 mt-3 mb-1">Note</p>
                <p className="text-sm text-gray-700">{invoice.note}</p>
              </>)}
            </div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase bg-gray-50">
              <th className="text-left px-3 py-3">No.</th>
              <th className="text-left px-3 py-3">Description</th>
              <th className="text-right px-3 py-3">Quantity</th>
              <th className="text-right px-3 py-3">Unit Price</th>
              <th className="text-right px-3 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((it, i) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="px-3 py-3 text-gray-600">{i + 1}</td>
                <td className="px-3 py-3 text-gray-900">{it.description}</td>
                <td className="px-3 py-3 text-right text-gray-700">{it.quantity}</td>
                <td className="px-3 py-3 text-right text-gray-700">{fmtMoney(it.unitPrice, cur)}</td>
                <td className="px-3 py-3 text-right text-gray-900 font-medium">{fmtMoney(it.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mt-4">
          <div className="w-72 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmtMoney(invoice.subtotal, cur)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Tax ({invoice.taxRate}%)</span><span>{fmtMoney(invoice.taxAmount, cur)}</span></div>
            <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200"><span>Total Due</span><span>{fmtMoney(invoice.total, cur)}</span></div>
          </div>
        </div>

        {invoice.payments.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h4 className="font-bold text-gray-900 mb-4">Payment History</h4>
            <div className="space-y-2">
              {invoice.payments.map((p, i) => (
                <div key={p.id} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-gray-700">{p.type === 'Deposit' ? `Deposit No. ${String(i + 1).padStart(4, '0')}` : `${p.type} Payment`}</span>
                    <span className="text-xs text-gray-500">{fmtDate(p.date)}</span>
                  </div>
                  <span className="font-semibold text-gray-900">{fmtMoney(p.amount, cur)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Remaining Amount</span>
              <span className={`px-3 py-1 rounded text-sm font-bold ${invoice.remaining > 0 ? 'bg-orange-50 text-orange-700' : 'bg-green-50 text-green-700'}`}>
                {fmtMoney(invoice.remaining, cur)}
              </span>
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs font-semibold text-gray-900 mb-2">Status</p>
          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
            invoice.status === 'Paid' ? 'bg-green-100 text-green-700' :
            invoice.status === 'Overdue' ? 'bg-red-100 text-red-700' :
            invoice.status === 'Sent' ? 'bg-violet-100 text-violet-700' :
            'bg-gray-100 text-gray-700'
          }`}>{invoice.status}</span>
        </div>

        <p className="text-center text-sm text-gray-500 mt-10">Thank you for your business!</p>
      </div>
    </div>
  );
}
