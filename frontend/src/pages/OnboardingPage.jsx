import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Check, Upload, ArrowRight } from 'lucide-react';

const STEPS = ['Connect Platform', 'Set up Branding', 'Try replying to your first lead'];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition ${
              i < current
                ? 'bg-blue-500 border-blue-500 text-white'
                : i === current
                ? 'bg-blue-500 border-blue-500 text-white'
                : 'bg-white border-gray-300 text-gray-400'
            }`}
          >
            {i < current ? <Check size={18} /> : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-16 h-0.5 ${i < current ? 'bg-blue-500' : 'bg-gray-300'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Connect Platform ──
function PlatformStep({ onNext }) {
  const [connected, setConnected] = useState({});

  const platforms = [
    { id: 'instagram', name: 'Instagram', icon: '📷' },
    { id: 'facebook', name: 'Connect Facebook', icon: '📘' },
    { id: 'whatsapp', name: 'Connect Whatsapp', icon: '💬' },
    { id: 'gmail', name: 'Connect Email', icon: '📧' },
  ];

  useEffect(() => {
    api.get('/api/accounts').then((res) => {
      const map = {};
      (res.data.accounts || []).forEach((a) => { map[a.platform] = a; });
      setConnected(map);
    }).catch(() => {});
  }, []);

  const handleConnect = (platformId) => {
    const urls = {
      instagram: '/auth/instagram/start',
      facebook: '/auth/facebook/start',
      whatsapp: '/auth/whatsapp/exchange',
      gmail: '/auth/gmail/start',
    };
    const url = urls[platformId];
    if (url) {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      window.location.href = `${base}${url}`;
    }
  };

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-1">Connect Platform</h2>
      <p className="text-gray-400 text-sm mb-8">SETUP YOUR ORGANISATION</p>

      <div className="space-y-3 max-w-md mx-auto">
        {platforms.map((p) => (
          <div key={p.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xl">{p.icon}</span>
              <span className="font-medium">{p.name}</span>
            </div>
            {connected[p.id] ? (
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-500" />
                <span className="text-sm text-green-600">Connected</span>
              </div>
            ) : (
              <button
                onClick={() => handleConnect(p.id)}
                className="text-gray-400 hover:text-gray-600"
              >
                <ArrowRight size={20} />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="mt-8 bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition"
      >
        CONTINUE <ArrowRight size={16} className="inline ml-1" />
      </button>
    </div>
  );
}

// ── Step 2: Branding ──
function BrandingStep({ onNext }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', companyName: '', brandColor: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.firstName || !form.companyName) return;
    setSaving(true);
    try {
      await api.post('/api/onboarding/branding', form);
      onNext();
    } catch (err) {
      console.error('Branding save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-1">Set up Branding</h2>
      <p className="text-gray-400 text-sm mb-8">SETUP YOUR ORGANISATION</p>

      <div className="max-w-md mx-auto space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 text-left">FIRST NAME *</label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 text-left">LAST NAME</label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1 text-left">COMPANY NAME *</label>
          <input
            type="text"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div className="flex gap-6 items-start">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 text-left">COMPANY LOGO</label>
            <div className="w-20 h-20 border-2 border-dashed border-blue-300 rounded-full flex items-center justify-center text-blue-400 cursor-pointer hover:bg-blue-50">
              <Upload size={24} />
            </div>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1 text-left">BRAND COLORS</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="#HEX"
                value={form.brandColor}
                onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
                className="flex-1 border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <button className="w-10 h-10 border-2 border-dashed border-blue-300 rounded-lg flex items-center justify-center text-blue-400 text-lg hover:bg-blue-50">
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!form.firstName || !form.companyName || saving}
        className="mt-8 bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'CONTINUE'} <ArrowRight size={16} className="inline ml-1" />
      </button>
    </div>
  );
}

// ── Step 3: First Message ──
function FirstMessageStep({ onNext }) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post('/api/onboarding/first-message', { cannedResponse: message });
      onNext();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-1">Try replying to your first lead</h2>
      <p className="text-gray-400 text-sm mb-8">SETUP YOUR ORGANISATION</p>

      <div className="max-w-md mx-auto">
        <label className="block text-xs font-semibold text-gray-500 mb-1 text-left">CANNED RESPONSE</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type canned response on lead enquiry"
          rows={4}
          className="w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="mt-8 bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'CONTINUE'} <ArrowRight size={16} className="inline ml-1" />
      </button>
    </div>
  );
}

// ── Success Screen ──
function SuccessScreen({ onFinish }) {
  return (
    <div className="text-center py-12">
      <div className="w-24 h-24 mx-auto mb-6 bg-blue-100 rounded-full flex items-center justify-center">
        <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center">
          <Check size={32} className="text-white" />
        </div>
      </div>
      <h2 className="text-2xl font-bold mb-2">Organisation Setup Successful</h2>
      <p className="text-gray-400 text-sm mb-8">WELCOME ABOARD! START YOUR JOURNEY WITH AURADESK.</p>
      <button
        onClick={onFinish}
        className="bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition"
      >
        LET'S START <ArrowRight size={16} className="inline ml-1" />
      </button>
    </div>
  );
}

// ── Main Onboarding Page ──
export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    api.get('/api/onboarding/status').then((res) => {
      const s = res.data.onboardingStep || 0;
      if (s >= 4) {
        navigate('/inbox');
      } else if (s > 0) {
        setStep(Math.min(s, 2));
      }
    }).catch(() => {});
  }, [navigate]);

  const handleNext = () => {
    if (step < 2) {
      setStep(step + 1);
    } else {
      setShowSuccess(true);
    }
  };

  const handleFinish = async () => {
    try {
      await api.post('/api/onboarding/complete');
      if (refreshUser) await refreshUser();
      navigate('/inbox');
    } catch {
      navigate('/inbox');
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4ff] flex flex-col items-center justify-center px-4">
      <div className="mb-8 flex items-center gap-2">
        <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">A</div>
        <span className="text-xl font-bold text-gray-800">AuraDesk</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 md:p-12 w-full max-w-xl">
        {showSuccess ? (
          <SuccessScreen onFinish={handleFinish} />
        ) : (
          <>
            <StepIndicator current={step} />
            {step === 0 && <PlatformStep onNext={handleNext} />}
            {step === 1 && <BrandingStep onNext={handleNext} />}
            {step === 2 && <FirstMessageStep onNext={handleNext} />}
          </>
        )}
      </div>

      <footer className="mt-8 text-center text-xs text-gray-400">
        Copyright 2021 - 2025 AuraDesk Inc. All Rights Reserved.
        <span className="ml-8 cursor-pointer hover:text-gray-600">Need help?</span>
      </footer>
    </div>
  );
}
