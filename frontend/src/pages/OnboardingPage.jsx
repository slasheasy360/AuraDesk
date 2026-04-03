import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Check, Upload, ArrowRight, ArrowLeft, X, RefreshCw } from 'lucide-react';

const STEPS = ['Connect Platform', 'Set up Branding', 'Try replying to your first lead'];

function StepIndicator({ current, onStepClick }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((_, i) => (
        <div key={i} className="flex items-center">
          <button
            onClick={() => onStepClick(i)}
            disabled={i > current}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition cursor-pointer disabled:cursor-not-allowed ${
              i < current
                ? 'bg-blue-500 border-blue-500 text-white hover:bg-blue-600'
                : i === current
                ? 'bg-blue-500 border-blue-500 text-white'
                : 'bg-white border-gray-300 text-gray-400'
            }`}
          >
            {i < current ? <Check size={18} /> : i + 1}
          </button>
          {i < STEPS.length - 1 && (
            <div className={`w-16 h-0.5 ${i < current ? 'bg-blue-500' : 'bg-gray-300'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Connect Platform ──
function PlatformStep({ onNext, onBack }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const platforms = [
    { id: 'instagram', name: 'Instagram', icon: '📷' },
    { id: 'facebook', name: 'Facebook', icon: '📘' },
    { id: 'whatsapp', name: 'WhatsApp', icon: '💬' },
    { id: 'gmail', name: 'Email (Gmail)', icon: '📧' },
  ];

  const fetchAccounts = useCallback(() => {
    setLoading(true);
    api.get('/api/accounts').then((res) => {
      setAccounts(res.data.accounts || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const handleConnect = async (platformId) => {
    // WhatsApp uses a different flow (embedded signup) — redirect directly with token
    if (platformId === 'whatsapp') {
      const base = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const token = localStorage.getItem('token');
      window.location.href = `${base}/auth/whatsapp/exchange?token=${token}`;
      return;
    }

    // Other platforms: call /start API to get OAuth URL, then redirect
    const endpoints = {
      instagram: '/auth/instagram/start',
      facebook: '/auth/facebook/start',
      gmail: '/auth/gmail/start',
    };
    try {
      const res = await api.get(endpoints[platformId]);
      if (res.data.url) {
        window.location.href = res.data.url;
      }
    } catch (err) {
      console.error(`Connect ${platformId} failed:`, err);
    }
  };

  const handleDisconnect = async (accountId) => {
    try {
      await api.delete(`/api/accounts/${accountId}`);
      fetchAccounts();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  };

  const getAccountForPlatform = (platformId) => {
    return accounts.find((a) => a.platform === platformId && a.status === 'active');
  };

  return (
    <div className="text-center">
      <h2 className="text-2xl font-bold mb-1">Connect Platform</h2>
      <p className="text-gray-400 text-sm mb-8">SETUP YOUR ORGANISATION</p>

      <div className="space-y-3 max-w-md mx-auto">
        {platforms.map((p) => {
          const account = getAccountForPlatform(p.id);
          return (
            <div key={p.id} className="flex items-center justify-between border rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xl">{p.icon}</span>
                <div className="text-left">
                  <span className="font-medium block">{p.name}</span>
                  {account && (
                    <span className="text-xs text-gray-400">{account.displayName || account.platformAccountId}</span>
                  )}
                </div>
              </div>
              {account ? (
                <div className="flex items-center gap-2">
                  <Check size={16} className="text-green-500" />
                  <span className="text-sm text-green-600">Connected</span>
                  <button
                    onClick={() => handleDisconnect(account.id)}
                    className="ml-1 text-red-400 hover:text-red-600 text-xs"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleConnect(p.id)}
                  className="text-blue-500 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
                >
                  Connect <ArrowRight size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-3 mt-8">
        <button
          onClick={() => fetchAccounts()}
          className="text-gray-400 hover:text-gray-600 text-sm flex items-center gap-1"
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh status
        </button>
      </div>

      <button
        onClick={onNext}
        className="mt-4 bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition"
      >
        CONTINUE <ArrowRight size={16} className="inline ml-1" />
      </button>
    </div>
  );
}

// ── Step 2: Branding ──
function BrandingStep({ onNext, onBack, savedData, onSaveData }) {
  const [form, setForm] = useState(savedData || { firstName: '', lastName: '', companyName: '', brandColor: '' });
  const [logoPreview, setLogoPreview] = useState(savedData?.companyLogo || null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Restore saved data from server on mount
  useEffect(() => {
    if (!savedData?.firstName) {
      api.get('/api/onboarding/status').then((res) => {
        const d = res.data;
        if (d.firstName || d.companyName) {
          const restored = {
            firstName: d.firstName || '',
            lastName: d.lastName || '',
            companyName: d.companyName || '',
            brandColor: d.brandColor || '',
            companyLogo: d.companyLogo || null,
          };
          setForm(restored);
          if (d.companyLogo) setLogoPreview(d.companyLogo);
        }
      }).catch(() => {});
    }
  }, [savedData]);

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Instant preview
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    // Upload to server
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await api.post('/api/onboarding/upload-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.url) {
        setForm((prev) => ({ ...prev, companyLogo: res.data.url }));
        setLogoPreview(res.data.url);
      }
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.firstName || !form.companyName) return;
    setSaving(true);
    try {
      await api.post('/api/onboarding/branding', form);
      onSaveData(form);
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
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleLogoSelect} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-20 h-20 border-2 border-dashed border-blue-300 rounded-full flex items-center justify-center text-blue-400 cursor-pointer hover:bg-blue-50 overflow-hidden relative"
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-cover rounded-full" />
              ) : uploading ? (
                <RefreshCw size={20} className="animate-spin" />
              ) : (
                <Upload size={24} />
              )}
            </button>
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
              <input
                type="color"
                value={form.brandColor || '#3b82f6'}
                onChange={(e) => setForm({ ...form, brandColor: e.target.value })}
                className="w-10 h-10 border-2 border-gray-200 rounded-lg cursor-pointer p-0.5"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 mt-8">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg font-semibold text-gray-500 hover:bg-gray-100 transition flex items-center gap-1"
        >
          <ArrowLeft size={16} /> BACK
        </button>
        <button
          onClick={handleSubmit}
          disabled={!form.firstName || !form.companyName || saving}
          className="bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'CONTINUE'} <ArrowRight size={16} className="inline ml-1" />
        </button>
      </div>
    </div>
  );
}

// ── Step 3: First Message ──
function FirstMessageStep({ onNext, onBack, savedMessage, onSaveMessage }) {
  const [message, setMessage] = useState(savedMessage || '');
  const [saving, setSaving] = useState(false);

  // Restore from server if no local data
  useEffect(() => {
    if (!savedMessage) {
      api.get('/api/onboarding/status').then((res) => {
        if (res.data.cannedResponse) setMessage(res.data.cannedResponse);
      }).catch(() => {});
    }
  }, [savedMessage]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post('/api/onboarding/first-message', { cannedResponse: message });
      onSaveMessage(message);
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

      <div className="flex items-center justify-center gap-4 mt-8">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg font-semibold text-gray-500 hover:bg-gray-100 transition flex items-center gap-1"
        >
          <ArrowLeft size={16} /> BACK
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-[#1a2341] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#2a3555] transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'CONTINUE'} <ArrowRight size={16} className="inline ml-1" />
        </button>
      </div>
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
  const [maxStep, setMaxStep] = useState(0); // highest step reached
  const [showSuccess, setShowSuccess] = useState(false);
  const [brandingData, setBrandingData] = useState(null);
  const [cannedMessage, setCannedMessage] = useState('');
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  useEffect(() => {
    api.get('/api/onboarding/status').then((res) => {
      const s = res.data.onboardingStep || 0;
      if (s >= 4) {
        navigate('/');
      } else if (s > 0) {
        const displayStep = Math.min(s, 2);
        setStep(displayStep);
        setMaxStep(displayStep);
        // Restore saved data
        if (res.data.firstName || res.data.companyName) {
          setBrandingData({
            firstName: res.data.firstName || '',
            lastName: res.data.lastName || '',
            companyName: res.data.companyName || '',
            brandColor: res.data.brandColor || '',
            companyLogo: res.data.companyLogo || null,
          });
        }
        if (res.data.cannedResponse) setCannedMessage(res.data.cannedResponse);
      }
    }).catch(() => {});
  }, [navigate]);

  const handleNext = () => {
    if (step < 2) {
      const next = step + 1;
      setStep(next);
      setMaxStep((prev) => Math.max(prev, next));
    } else {
      setShowSuccess(true);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleStepClick = (targetStep) => {
    if (targetStep <= maxStep) setStep(targetStep);
  };

  const handleFinish = async () => {
    try {
      await api.post('/api/onboarding/complete');
      if (refreshUser) await refreshUser();
      navigate('/');
    } catch {
      navigate('/');
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
            <StepIndicator current={step} onStepClick={handleStepClick} />
            {step === 0 && <PlatformStep onNext={handleNext} onBack={null} />}
            {step === 1 && (
              <BrandingStep
                onNext={handleNext}
                onBack={handleBack}
                savedData={brandingData}
                onSaveData={setBrandingData}
              />
            )}
            {step === 2 && (
              <FirstMessageStep
                onNext={handleNext}
                onBack={handleBack}
                savedMessage={cannedMessage}
                onSaveMessage={setCannedMessage}
              />
            )}
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
