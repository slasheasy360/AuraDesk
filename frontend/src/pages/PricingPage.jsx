import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Check } from 'lucide-react';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 29,
    yearly: 290,
    features: [
      '1 social inbox (IG, FB, TikTok, etc.)',
      'AI-generated replies (max 30/month)',
      'Manual invoice creation',
      'Lead capture & tracking',
      'Performance dashboard (basic)',
      'Email & DM support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 79,
    yearly: 790,
    popular: true,
    features: [
      '3 social inboxes',
      'Unlimited AI replies',
      'Branded invoice templates',
      'Follow-up automation (limited rules)',
      'Smart lead management',
      'Analytics dashboard (detailed)',
      'Email, DM & WhatsApp integration',
      'Priority support',
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    monthly: 149,
    yearly: 1490,
    features: [
      'Unlimited inboxes + platforms',
      'Multi-language AI replies',
      'Recurring invoices',
      'Custom follow-up rules',
      'Financial & performance reports',
      'Team access (up to 3 users)',
      'Early access to new features',
      'Premium support',
    ],
  },
];

export default function PricingPage() {
  const [cycle, setCycle] = useState('monthly');
  const [loading, setLoading] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleChoosePlan = async (planId) => {
    setLoading(planId);
    try {
      // Try Stripe checkout first
      const res = await api.post('/api/subscription/create-checkout', { plan: planId, cycle });
      if (res.data.url) {
        window.location.href = res.data.url;
        return;
      }
    } catch (err) {
      // If Stripe not configured (501), use manual activation for dev/testing
      if (err.response?.status === 501) {
        try {
          await api.post('/api/subscription/activate', { plan: planId, cycle });
          navigate('/onboarding');
          return;
        } catch (activateErr) {
          console.error('Activation failed:', activateErr);
        }
      }
      console.error('Checkout failed:', err);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4ff] flex flex-col">
      {/* Header */}
      <div className="py-4 px-6">
        <button onClick={() => navigate('/login')} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Return to Log in
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Choose a plan to continue</h1>
        <p className="text-gray-500 mb-6">
          {user?.plan === 'expired'
            ? 'Your 14-day free trial has exhausted. Subscribe to continue growing your business!'
            : 'Subscribe to continue growing your business!'}
        </p>

        {/* Cycle Toggle */}
        <div className="flex bg-gray-200 rounded-full p-1 mb-10">
          <button
            onClick={() => setCycle('monthly')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition ${
              cycle === 'monthly' ? 'bg-[#1a2341] text-white' : 'text-gray-600'
            }`}
          >
            MONTHLY
          </button>
          <button
            onClick={() => setCycle('yearly')}
            className={`px-6 py-2 rounded-full text-sm font-medium transition ${
              cycle === 'yearly' ? 'bg-[#1a2341] text-white' : 'text-gray-600'
            }`}
          >
            YEARLY
          </button>
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white rounded-2xl p-8 flex flex-col border-2 transition-shadow ${
                plan.popular ? 'border-[#1a2341] shadow-xl' : 'border-gray-100 shadow-sm'
              }`}
            >
              <div className="mb-6">
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-gray-900">
                    ${cycle === 'monthly' ? plan.monthly : plan.yearly}
                  </span>
                  <span className="text-gray-400 text-sm">/{cycle === 'monthly' ? 'month' : 'year'}</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">{plan.name}</h3>
              </div>

              <ul className="space-y-3 flex-1 mb-8">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => handleChoosePlan(plan.id)}
                disabled={loading === plan.id}
                className={`w-full py-3 rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2 ${
                  plan.popular
                    ? 'bg-[#1a2341] text-white hover:bg-[#2a3555]'
                    : 'bg-red-500 text-white hover:bg-red-600'
                } disabled:opacity-50`}
              >
                {loading === plan.id ? 'Processing...' : 'CHOOSE PLAN'} &rarr;
              </button>
            </div>
          ))}
        </div>
      </div>

      <footer className="text-center py-4 text-xs text-gray-400">
        Copyright 2021 - 2025 AuraDesk Inc. All Rights Reserved.
        <span className="float-right px-6 cursor-pointer hover:text-gray-600">Need help?</span>
      </footer>
    </div>
  );
}
