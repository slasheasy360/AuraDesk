import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, X, ChevronDown, ChevronUp, Sparkles,
  CheckCircle, Trash2, Edit2, Check, Info,
  Heart, FileText, Bell, Calendar, BookOpen, HelpCircle,
} from 'lucide-react';
import api from '../services/api.js';

const TABS = ['General', 'Features', 'Resources'];

const CATEGORY_MAP = {
  General: 'general',
  Features: 'features',
  Resources: 'resources',
};

const TONES = [
  'Playful', 'Friendly', 'Business', 'Supportive',
  'Professional', 'Artistic', 'Calm', 'Futuristic', 'Active', 'Childish',
];

const CATEGORY_ICONS = {
  general: Info,
  features: Heart,
  resources: FileText,
};

function categoryIcon(category) {
  const Icon = CATEGORY_ICONS[category] || HelpCircle;
  return Icon;
}

// ─── Add FAQ Modal ─────────────────────────────────────────────────────────
function AddFaqModal({ onClose, onSaved, editFaq = null }) {
  const [question, setQuestion] = useState(editFaq?.question || '');
  const [answer, setAnswer] = useState(editFaq?.answer || '');
  const [category, setCategory] = useState(editFaq?.category || 'general');
  const [saving, setSaving] = useState(false);
  const [extras, setExtras] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;
    setSaving(true);
    try {
      if (editFaq) {
        const res = await api.put(`/api/ai-training/faqs/${editFaq.id}`, { question, answer, category });
        onSaved([res.data.faq]);
      } else {
        const batch = [{ question, answer, category }, ...extras.filter(x => x.question.trim() && x.answer.trim())];
        const res = await api.post('/api/ai-training/faqs', batch);
        onSaved(res.data.faqs);
      }
      onClose();
    } catch (err) {
      console.error('Save FAQ failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const addAnother = () => {
    setExtras(prev => [...prev, { question: '', answer: '', category: 'general' }]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8 relative max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold text-center text-gray-900 mb-6">
          {editFaq ? 'Edit FAQ' : 'Add FAQ'}
        </h2>


        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#1787FE]"
            >
              <option value="general">General</option>
              <option value="features">Features</option>
              <option value="resources">Resources</option>
            </select>
          </div>

          {/* Main Q&A */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Question</label>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Type the question"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#1787FE] focus:ring-1 focus:ring-[#1787FE]"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Answer</label>
            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              placeholder="Type the answer"
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-[#1787FE] focus:ring-1 focus:ring-[#1787FE]"
              required
            />
          </div>

          {/* Extra Q&As */}
          {extras.map((ex, idx) => (
            <div key={idx} className="border-t pt-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-500 uppercase">FAQ #{idx + 2}</span>
                <button type="button" onClick={() => setExtras(p => p.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">
                  <X size={14} />
                </button>
              </div>
              <input
                value={ex.question}
                onChange={e => setExtras(p => p.map((x, i) => i === idx ? { ...x, question: e.target.value } : x))}
                placeholder="Type the question"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#1787FE]"
              />
              <textarea
                value={ex.answer}
                onChange={e => setExtras(p => p.map((x, i) => i === idx ? { ...x, answer: e.target.value } : x))}
                placeholder="Type the answer"
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:border-[#1787FE]"
              />
            </div>
          ))}

          <div className="flex gap-3 pt-2">
            {!editFaq && (
              <button
                type="button"
                onClick={addAnother}
                className="flex-1 flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
              >
                <Plus size={16} />
                ADD ANOTHER
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1787FE] hover:bg-[#1377e0] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              <Check size={16} />
              {saving ? 'Saving...' : 'DONE'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── FAQ Item ──────────────────────────────────────────────────────────────
function FaqItem({ faq, onDeleted, onEdited }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const Icon = categoryIcon(faq.category);

  const handleDelete = async (e) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await api.delete(`/api/ai-training/faqs/${faq.id}`);
      onDeleted(faq.id);
    } catch { setDeleting(false); }
  };

  return (
    <>
      {editing && (
        <AddFaqModal
          editFaq={faq}
          onClose={() => setEditing(false)}
          onSaved={([updated]) => { onEdited(updated); setEditing(false); }}
        />
      )}
      <div className="border-b border-gray-100 last:border-0">
        <button
          className="w-full flex items-center gap-3 py-4 px-1 text-left hover:bg-gray-50/50 transition group"
          onClick={() => setExpanded(v => !v)}
        >
          <span className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Icon size={15} className="text-[#1787FE]" />
          </span>
          <span className="flex-1 text-sm font-medium text-[#1787FE]">{faq.question}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setEditing(true); }}
              className="p-1.5 text-gray-400 hover:text-gray-700 rounded"
            >
              <Edit2 size={14} />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="p-1.5 text-gray-400 hover:text-red-500 rounded"
            >
              <Trash2 size={14} />
            </button>
          </div>
          <span className="text-gray-400 flex-shrink-0 ml-1">
            {expanded ? <ChevronUp size={16} /> : <Plus size={16} />}
          </span>
        </button>
        {expanded && (
          <div className="pb-4 px-11 text-sm text-gray-600 leading-relaxed">
            {faq.answer}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function AITrainingPage() {
  const [activeTab, setActiveTab] = useState('General');
  const [faqs, setFaqs] = useState([]);
  const [settings, setSettings] = useState({ tones: ['friendly'], automations: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [automationInput, setAutomationInput] = useState('');
  const [savingTone, setSavingTone] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [faqRes, settingsRes] = await Promise.all([
        api.get('/api/ai-training/faqs'),
        api.get('/api/ai-training/settings'),
      ]);
      setFaqs(faqRes.data.faqs || []);
      setSettings(settingsRes.data.settings || { tones: ['friendly'], automations: [] });
    } catch (err) {
      console.error('Failed to load AI training data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredFaqs = faqs.filter(f => {
    const catMatch = f.category === CATEGORY_MAP[activeTab];
    const searchMatch = !search ||
      f.question.toLowerCase().includes(search.toLowerCase()) ||
      f.answer.toLowerCase().includes(search.toLowerCase());
    return catMatch && searchMatch;
  });

  const handleToneToggle = async (tone) => {
    const lowerTone = tone.toLowerCase();
    const current = Array.isArray(settings.tones) ? settings.tones : [];
    const next = current.includes(lowerTone)
      ? current.filter(t => t !== lowerTone)
      : [...current, lowerTone];
    setSettings(s => ({ ...s, tones: next }));
    setSavingTone(true);
    try {
      const res = await api.put('/api/ai-training/settings', { tones: next });
      setSettings(res.data.settings);
    } catch { /* revert */ fetchData(); }
    finally { setSavingTone(false); }
  };

  const handleAddAutomation = async () => {
    if (!automationInput.trim()) return;
    const next = [...(settings.automations || []), automationInput.trim()];
    setAutomationInput('');
    try {
      const res = await api.put('/api/ai-training/settings', { automations: next });
      setSettings(res.data.settings);
    } catch { fetchData(); }
  };

  const handleRemoveAutomation = async (idx) => {
    const next = (settings.automations || []).filter((_, i) => i !== idx);
    try {
      const res = await api.put('/api/ai-training/settings', { automations: next });
      setSettings(res.data.settings);
    } catch { fetchData(); }
  };

  const tones = Array.isArray(settings.tones) ? settings.tones : [];
  const automations = Array.isArray(settings.automations) ? settings.automations : [];

  return (
    <div className="flex flex-col h-full bg-[#0B1628] p-3 sm:p-5 gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">AI Training</h1>
        <div className="flex items-center gap-3">
          <div className="relative w-56 hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={15} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search FAQ"
              className="w-full pl-9 pr-4 py-2.5 bg-[#0F1D33] border border-white/5 rounded-full text-sm text-white placeholder-white/40 focus:border-[#1787FE] outline-none transition"
            />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1787FE] hover:bg-[#1377e0] text-white text-sm font-semibold rounded-full transition shadow-lg shadow-[#1787FE]/20 whitespace-nowrap"
          >
            <Plus size={16} />
            ADD FAQ
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 gap-4">
        {/* Left: FAQ Panel */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-xl flex flex-col overflow-hidden min-w-0">
          {/* Tabs */}
          <div className="flex gap-1 px-6 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition ${
                  activeTab === tab
                    ? 'bg-[#1787FE] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* FAQ list */}
          <div className="flex-1 overflow-y-auto px-6 py-2">
            {loading ? (
              <div className="space-y-4 py-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : filteredFaqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <BookOpen size={40} className="mb-3 text-gray-200" />
                <p className="text-sm font-medium text-gray-500">No FAQs yet</p>
                <p className="text-xs mt-1">Click "ADD FAQ" to start training your AI</p>
              </div>
            ) : (
              filteredFaqs.map(faq => (
                <FaqItem
                  key={faq.id}
                  faq={faq}
                  onDeleted={id => setFaqs(prev => prev.filter(f => f.id !== id))}
                  onEdited={updated => setFaqs(prev => prev.map(f => f.id === updated.id ? updated : f))}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: AI Settings Panel */}
        <div className="w-[280px] flex-shrink-0 flex flex-col gap-4 hidden lg:flex">
          {/* AI Assistant Card */}
          <div className="bg-gradient-to-br from-[#6B2FD9] to-[#3B82F6] rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={18} />
              <span className="font-bold text-base">AI Assistant</span>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-white/80">Status</span>
                <span className="flex items-center gap-1.5 bg-white/20 px-2.5 py-1 rounded-full text-xs font-semibold">
                  <CheckCircle size={12} />
                  Active
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/80">Training Data</span>
                <span className="font-semibold">{faqs.length} FAQs</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/80">Response Rate</span>
                <span className="font-semibold">{faqs.length > 0 ? '89%' : '—'}</span>
              </div>
            </div>
          </div>

          {/* Tone of Voice */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Tone of Voice</h3>
            <div className="flex flex-wrap gap-2">
              {TONES.map(tone => {
                const isActive = tones.includes(tone.toLowerCase());
                return (
                  <button
                    key={tone}
                    onClick={() => handleToneToggle(tone)}
                    disabled={savingTone}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      isActive
                        ? 'bg-blue-50 border-[#1787FE] text-[#1787FE]'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    {isActive && <Check size={11} />}
                    {tone}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Automation Settings */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3 text-sm">Automation Settings</h3>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={automationInput}
                onChange={e => setAutomationInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleAddAutomation())}
                placeholder="Type automation prompt"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#1787FE]"
              />
              <button
                onClick={handleAddAutomation}
                className="text-gray-400 hover:text-[#1787FE] transition"
              >
                <Plus size={18} />
              </button>
            </div>
            <div className="space-y-2">
              {automations.map((a, i) => (
                <div key={i} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                  <Check size={13} className="text-[#1787FE] flex-shrink-0" />
                  <span className="flex-1 text-xs text-gray-700">{a}</span>
                  <button onClick={() => handleRemoveAutomation(i)} className="text-gray-300 hover:text-red-400 transition">
                    <X size={13} />
                  </button>
                </div>
              ))}
              {automations.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">No automations yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddFaqModal
          onClose={() => setShowAddModal(false)}
          onSaved={(newFaqs) => setFaqs(prev => [...prev, ...newFaqs])}
        />
      )}
    </div>
  );
}
