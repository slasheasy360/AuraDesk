import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import {
  Send, Search, MessageSquare, Mail, ArrowLeft, Paperclip,
  Smile, X, FileText, Image as ImageIcon, Reply, ChevronDown,
  ChevronUp, Download, UploadCloud, Play, Music, File as FileIcon, AlertCircle, RefreshCw,
  Star, Inbox, Clock, Sparkles, FileEdit, Trash2, ChevronLeft, ChevronRight,
  RotateCw, Archive, MoreHorizontal, MoreVertical, Bot, Link2, Users, Undo2, Menu, Camera, Mic,
} from 'lucide-react';
import PlatformBadge, { PlatformIcon } from '../components/PlatformBadge.jsx';
import { useLinkAccounts } from '../context/LinkAccountsContext.jsx';

// ═══════════════════════════════════════════════════════════════════
// DEFERRED LOADING HOOK — avoids skeleton flash for fast loads
// ═══════════════════════════════════════════════════════════════════

function useDeferredLoading(isLoading, delayMs = 200) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isLoading) {
      timerRef.current = setTimeout(() => setShowSkeleton(true), delayMs);
    } else {
      clearTimeout(timerRef.current);
      setShowSkeleton(false);
    }
    return () => clearTimeout(timerRef.current);
  }, [isLoading, delayMs]);

  return showSkeleton;
}

// ═══════════════════════════════════════════════════════════════════
// SESSION STORAGE HELPERS — persist state across page reloads
// ═══════════════════════════════════════════════════════════════════

const SESSION_KEYS = {
  CONVERSATIONS: 'auradesk:conversations',
  MESSAGES: 'auradesk:messages:', // + conversationId
  ACTIVE_CONVERSATION: 'auradesk:activeConversation',
};

function sessionGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function sessionSet(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full — ignore */ }
}

// ═══════════════════════════════════════════════════════════════════
// FILTER CATEGORIES
// ═══════════════════════════════════════════════════════════════════

const FILTER_CATEGORIES = [
  { key: 'all', label: 'All', icon: Inbox },
  { key: 'unread', label: 'Unread', icon: Clock },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'ai_responded', label: 'AI Responded', icon: Sparkles },
  { key: 'draft', label: 'Draft', icon: FileEdit },
  { key: 'bin', label: 'Bin', icon: Trash2 },
];

const ALL_SOURCE_FILTERS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'gmail', label: 'Gmail' },
];

const ITEMS_PER_PAGE = 10;

export default function InboxPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState(() => sessionGet(SESSION_KEYS.CONVERSATIONS) || []);
  const [messages, setMessages] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [sendError, setSendError] = useState('');
  const [fileError, setFileError] = useState(null);
  const fileErrorTimerRef = useRef(null);
  const sendErrorTimerRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState(new Set());
  const [uploadProgress, setUploadProgress] = useState(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // ── New filter & pagination state ──
  const [activeFilter, setActiveFilter] = useState('all');
  const [sourceFilters, setSourceFilters] = useState(new Set());
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [connectedPlatforms, setConnectedPlatforms] = useState(new Set());
  // ── Mobile UI state ──
  const { openLinkAccounts, onAccountsChanged } = useLinkAccounts();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const draftTimerRef = useRef(null);
  const lastSavedDraftRef = useRef('');

  // Deferred skeletons
  const showConversationSkeleton = useDeferredLoading(loadingConversations, 150);
  const showMessageSkeleton = useDeferredLoading(loadingMessages, 200);

  // ── Time-ago ticker ──
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // ── Instant disconnect reaction ──
  // When a platform is disconnected via the Link Accounts modal, immediately
  // remove its conversations from the list without waiting for a page refresh.
  useEffect(() => {
    return onAccountsChanged((platform) => {
      setConversations((prev) => prev.filter((c) => c.connectedAccount?.platform !== platform));
      // If the active conversation belonged to that platform, deselect it.
      setActiveConversation((prev) => (prev?.connectedAccount?.platform === platform ? null : prev));
    });
  }, [onAccountsChanged]);

  const messagesEndRef = useRef(null);
  const replyBoxRef = useRef(null);
  const igPollingRef = useRef(null);
  const conversationIdRef = useRef(conversationId);
  const fileInputRef = useRef(null);
  const knownMessageIds = useRef(new Set());
  const messageCache = useRef(new Map());

  // Derive connected platforms from conversations and auto-check them in sourceFilters
  const sourceFiltersInitialized = useRef(false);
  useEffect(() => {
    const platforms = new Set();
    conversations.forEach((c) => {
      const p = c.connectedAccount?.platform;
      if (p) platforms.add(p);
    });
    setConnectedPlatforms(platforms);

    if (platforms.size === 0) return;
    if (!sourceFiltersInitialized.current) {
      // First load: check all connected platforms
      sourceFiltersInitialized.current = true;
      setSourceFilters(new Set(platforms));
    } else {
      // New platform added later (new account connected): auto-check it
      setSourceFilters((prev) => {
        let changed = false;
        const next = new Set(prev);
        platforms.forEach((p) => { if (!next.has(p)) { next.add(p); changed = true; } });
        return changed ? next : prev;
      });
    }
  }, [conversations]);

  // ═══════════════════════════════════════════════════════════════════
  // DATA FETCHING & REAL-TIME
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    let cancelled = false;

    const initializeInbox = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Fetch both active and deleted (bin) conversations so all filters work client-side
          const [activeRes, binRes] = await Promise.all([
            api.get('/api/conversations'),
            api.get('/api/conversations', { params: { filter: 'bin' } }),
          ]);
          if (!cancelled) {
            const all = [...(activeRes.data.conversations || []), ...(binRes.data.conversations || [])];
            setConversations(all);
            setLoadingConversations(false);
          }
          break;
        } catch (err) {
          console.error(`fetchConversations attempt ${attempt + 1} failed:`, err.message);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          else if (!cancelled) setLoadingConversations(false);
        }
      }

      Promise.allSettled([
        api.get('/api/messages/gmail/sync').catch(() => ({ data: {} })),
        api.get('/api/messages/instagram/sync').catch(() => ({ data: {} })),
        api.get('/api/messages/facebook/sync').catch(() => ({ data: {} })),
      ]).then((results) => {
        if (cancelled) return;
        const hasNew = results.some(
          (r) => r.status === 'fulfilled' && (r.value?.data?.newMessages || 0) > 0
        );
        if (hasNew) {
          Promise.all([
            api.get('/api/conversations'),
            api.get('/api/conversations', { params: { filter: 'bin' } }),
          ]).then(([activeRes, binRes]) => {
            if (!cancelled) setConversations([...(activeRes.data.conversations || []), ...(binRes.data.conversations || [])]);
          }).catch(() => {});
        }
      });
    };

    initializeInbox();

    igPollingRef.current = setInterval(async () => {
      try {
        const results = await Promise.allSettled([
          api.get('/api/messages/instagram/sync'),
          api.get('/api/messages/facebook/sync'),
          api.get('/api/messages/gmail/sync'),
        ]);
        const hasNew = results.some(
          (r) => r.status === 'fulfilled' && (r.value?.data?.newMessages || 0) > 0
        );
        if (hasNew) {
          fetchConversations();
          const activeId = conversationIdRef.current;
          if (activeId) fetchMessages(activeId, true, true);
        }
      } catch { /* silent */ }
    }, 60000);

    const safetyRefresh = setInterval(() => {
      if (!cancelled) {
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId, true, true);
      }
    }, 30000);

    return () => {
      cancelled = true;
      if (igPollingRef.current) clearInterval(igPollingRef.current);
      clearInterval(safetyRefresh);
    };
  }, []);

  // Socket listeners
  useEffect(() => {
    let cleanupFn = null;
    let pollTimer = null;

    const setupSocketListeners = () => {
      const socket = getSocket();
      if (!socket) return false;

      if (cleanupFn) cleanupFn();

      let hasConnectedOnce = socket.connected;

      const handleReconnect = () => {
        if (!hasConnectedOnce) {
          hasConnectedOnce = true;
          return;
        }
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId, true, true);
      };

      socket.on('connect', handleReconnect);

      const handleNewMessage = (data) => {
        const msgId = data.message?.id;
        const convId = data.conversationId;

        if (msgId && knownMessageIds.current.has(msgId)) return;
        if (msgId) knownMessageIds.current.add(msgId);

        setConversations((prev) => {
          const exists = prev.some((c) => c.id === convId);
          if (!exists) {
            fetchConversations();
            const placeholder = {
              id: convId,
              lastMessageAt: new Date().toISOString(),
              unreadCount: data.message?.direction === 'inbound' ? 1 : 0,
              messages: [{ content: data.message.content, direction: data.message.direction, sentAt: data.message.sentAt }],
              contact: { name: data.message?.sender || 'New Contact' },
              connectedAccount: { platform: data.platform || 'gmail' },
            };
            return [placeholder, ...prev];
          }
          const updated = prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  lastMessageAt: new Date().toISOString(),
                  messages: [{ content: data.message.content, direction: data.message.direction, sentAt: data.message.sentAt }],
                }
              : c
          );
          return updated.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
        });

        if (convId === conversationIdRef.current) {
          setMessages((prev) => {
            if (msgId && prev.some((m) => m.id === msgId)) return prev;
            const optimisticIdx = prev.findIndex(
              (m) => m._optimistic && m.content === data.message.content && m.direction === data.message.direction
            );
            if (optimisticIdx !== -1) {
              const next = [...prev];
              next[optimisticIdx] = data.message;
              return next;
            }
            return [...prev, data.message];
          });
          messageCache.current.set(convId, null);
          if (data.message?.direction === 'inbound') {
            api.get(`/api/conversations/${convId}`).catch(() => {});
          }
        }
      };

      const handleConversationUpdate = (data) => {
        const activeId = conversationIdRef.current;
        setConversations((prev) =>
          prev
            .map((c) =>
              c.id === data.conversationId
                ? {
                    ...c,
                    lastMessageAt: data.lastMessageAt,
                    unreadCount: data.conversationId === activeId ? 0 : (data.unreadCount ?? c.unreadCount),
                  }
                : c
            )
            .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
        );
      };

      const handleStateChange = (data) => {
        const { conversationId: convId, field, value } = data;
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, [field]: value } : c))
        );
      };

      const handleDraftUpdate = (data) => {
        const { conversationId: convId, draft } = data;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, hasDraft: !!draft, draftPreview: draft?.content?.slice(0, 80) || null, drafts: draft ? [draft] : [] }
              : c
          )
        );
      };

      socket.on('new_message', handleNewMessage);
      socket.on('conversation_update', handleConversationUpdate);
      socket.on('conversation_state_change', handleStateChange);
      socket.on('draft_update', handleDraftUpdate);

      cleanupFn = () => {
        socket.off('connect', handleReconnect);
        socket.off('new_message', handleNewMessage);
        socket.off('conversation_update', handleConversationUpdate);
        socket.off('conversation_state_change', handleStateChange);
        socket.off('draft_update', handleDraftUpdate);
      };
      return true;
    };

    if (!setupSocketListeners()) {
      pollTimer = setInterval(() => {
        if (setupSocketListeners()) clearInterval(pollTimer);
      }, 500);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupFn) cleanupFn();
    };
  }, []);

  useEffect(() => {
    const handleInboxRefresh = () => {
      fetchConversations();
      const activeId = conversationIdRef.current;
      if (activeId) fetchMessages(activeId, true);
    };
    window.addEventListener('auradesk:refresh-inbox', handleInboxRefresh);
    return () => window.removeEventListener('auradesk:refresh-inbox', handleInboxRefresh);
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    if (conversationId) {
      const cached = messageCache.current.get(conversationId);
      if (cached) {
        setMessages(cached.messages);
        setActiveConversation(cached.activeConversation);
        cached.messages.forEach((m) => m.id && knownMessageIds.current.add(m.id));
      } else {
        const sessionMsgs = sessionGet(SESSION_KEYS.MESSAGES + conversationId);
        if (sessionMsgs && sessionMsgs.length > 0) {
          setMessages(sessionMsgs);
          sessionMsgs.forEach((m) => m.id && knownMessageIds.current.add(m.id));
        }
        const sessionConv = sessionGet(SESSION_KEYS.ACTIVE_CONVERSATION);
        if (sessionConv && sessionConv.id === conversationId) {
          setActiveConversation(sessionConv);
        }
      }
      fetchMessages(conversationId);
      setSendError('');
      setMessagesError(null);
      setAttachments([]);
      setCollapsedMessages(new Set());
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
      // Load draft — if draft exists, auto-open the reply box with draft content
      api.get(`/api/conversations/${conversationId}/draft`).then((res) => {
        if (res.data.draft?.content) {
          setNewMessage(res.data.draft.content);
          lastSavedDraftRef.current = res.data.draft.content;
          setShowReplyBox(true);
          // Set replyingTo from the last message so the reply header shows correctly
          setReplyingTo((prev) => prev || { sender: 'sender' });
        } else {
          setNewMessage('');
          lastSavedDraftRef.current = '';
          setShowReplyBox(false);
          setReplyingTo(null);
        }
      }).catch(() => {
        setShowReplyBox(false);
        setReplyingTo(null);
      });
    } else {
      setMessages([]);
      setActiveConversation(null);
    }
  }, [conversationId]);

  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length !== prevMsgCountRef.current || showReplyBox) {
      prevMsgCountRef.current = messages.length;
      if (showReplyBox && replyBoxRef.current) {
        replyBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, showReplyBox]);

  useEffect(() => {
    if (conversations.length > 0) {
      sessionSet(SESSION_KEYS.CONVERSATIONS, conversations);
    }
  }, [conversations]);

  const fetchConversations = useCallback(async () => {
    try {
      const [activeRes, binRes] = await Promise.all([
        api.get('/api/conversations'),
        api.get('/api/conversations', { params: { filter: 'bin' } }),
      ]);
      const all = [...(activeRes.data.conversations || []), ...(binRes.data.conversations || [])];
      setConversations(all);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, []);

  const fetchMessages = useCallback(async (convId, forceRefresh = false, silent = false) => {
    if (!forceRefresh && messageCache.current.get(convId)?.fresh) return;
    if (!silent) setLoadingMessages(true);
    setMessagesError(null);

    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const [msgRes, convRes] = await Promise.all([
          api.get(`/api/messages/${convId}`),
          api.get(`/api/conversations/${convId}`),
        ]);
        const msgs = msgRes.data.messages;
        msgs.forEach((m) => m.id && knownMessageIds.current.add(m.id));
        if (conversationIdRef.current === convId) {
          setMessages(msgs);
          setActiveConversation(convRes.data.conversation);
          setMessagesError(null);
          // If reply box is open (from draft restore), set replyingTo to the last message
          if (msgs.length > 0) {
            setReplyingTo((prev) => {
              if (prev && !prev.id) return msgs[msgs.length - 1]; // replace placeholder with real message
              return prev;
            });
          }
        }
        messageCache.current.set(convId, {
          messages: msgs,
          activeConversation: convRes.data.conversation,
          fresh: true,
        });
        setTimeout(() => {
          const entry = messageCache.current.get(convId);
          if (entry) entry.fresh = false;
        }, 30000);
        sessionSet(SESSION_KEYS.MESSAGES + convId, msgs.slice(-50));
        sessionSet(SESSION_KEYS.ACTIVE_CONVERSATION, convRes.data.conversation);
        if (!silent) setLoadingMessages(false);
        return; // success
      } catch (err) {
        console.error(`fetchMessages attempt ${attempt + 1} failed:`, err.message);
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        } else {
          // All attempts failed
          if (conversationIdRef.current === convId && !silent) {
            setMessagesError('Failed to load messages. Please try again.');
          }
        }
      }
    }
    if (!silent) setLoadingMessages(false);
  }, []);

  const activeConversationRef = useRef(activeConversation);
  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);

  // Keep activeConversation in sync with conversation list state changes (star, lead, delete)
  useEffect(() => {
    if (activeConversation && conversationId) {
      const fromList = conversations.find((c) => c.id === conversationId);
      if (fromList) {
        setActiveConversation((prev) => {
          if (!prev) return prev;
          if (prev.isStarred !== fromList.isStarred || prev.isLead !== fromList.isLead || prev.isDeleted !== fromList.isDeleted) {
            return { ...prev, isStarred: fromList.isStarred, isLead: fromList.isLead, isDeleted: fromList.isDeleted };
          }
          return prev;
        });
      }
    }
  }, [conversations, conversationId, activeConversation]);

  // ═══════════════════════════════════════════════════════════════════
  // DRAFT AUTO-SAVE
  // ═══════════════════════════════════════════════════════════════════

  const saveDraft = useCallback((convId, content) => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(async () => {
      if (content === lastSavedDraftRef.current) return;
      try {
        await api.put(`/api/conversations/${convId}/draft`, { content });
        lastSavedDraftRef.current = content;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, hasDraft: !!content.trim(), draftPreview: content.trim().slice(0, 80) || null }
              : c
          )
        );
      } catch (err) {
        console.error('Failed to save draft:', err);
      }
    }, 1500);
  }, []);

  const clearDraft = useCallback(async (convId) => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    lastSavedDraftRef.current = '';
    try {
      await api.delete(`/api/conversations/${convId}/draft`);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId ? { ...c, hasDraft: false, draftPreview: null, drafts: [] } : c
        )
      );
    } catch { /* silent */ }
  }, []);

  const handleNewMessageChange = useCallback((value) => {
    setNewMessage(value);
    const activeId = conversationIdRef.current;
    if (activeId) {
      saveDraft(activeId, value);
    }
  }, [saveDraft]);

  // ── AI Respond state ────────────────────────────────────────────────
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);

  const handleAiRespond = useCallback(async () => {
    const activeId = conversationIdRef.current;
    if (!activeId || aiLoading) return;
    // Find the last inbound message to use as the prompt
    const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound');
    const prompt = lastInbound?.content || newMessage.trim();
    if (!prompt) return;

    setAiLoading(true);
    setAiError(null);
    setAiSuggestion(null);
    try {
      const res = await api.post('/api/ai/generate-reply', {
        conversationId: activeId,
        prompt,
        platform: activeConversationRef.current?.connectedAccount?.platform,
      });
      setAiSuggestion(res.data.reply);
    } catch (err) {
      const msg = err.response?.data?.error || 'AI generation failed';
      setAiError(msg);
      setTimeout(() => setAiError(null), 4000);
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, messages, newMessage]);

  useEffect(() => () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); }, []);

  // ═══════════════════════════════════════════════════════════════════
  // SEND MESSAGE
  // ═══════════════════════════════════════════════════════════════════

  const handleSend = useCallback(async (e) => {
    if (e?.preventDefault) e.preventDefault();
    const activeId = conversationIdRef.current;
    if ((!newMessage.trim() && attachments.length === 0) || !activeId || sending) return;

    const trimmedMsg = newMessage.trim();
    const currentAttachments = [...attachments];
    const isEmail = activeConversationRef.current?.connectedAccount?.platform === 'gmail';

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage = {
      id: optimisticId,
      conversationId: activeId,
      direction: 'outbound',
      content: trimmedMsg || (currentAttachments.length > 0 ? `[${currentAttachments.map(a => a.name).join(', ')}]` : ''),
      sentAt: new Date().toISOString(),
      status: 'sending',
      _optimistic: true,
      attachments: currentAttachments.map((a) => ({
        filename: a.name,
        mimeType: a.type,
        size: a.size,
      })),
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setNewMessage('');
    setAttachments([]);
    setSending(true);
    setSendError('');
    setUploadProgress(0);

    const MAX_RETRIES = 2;

    const doSend = async (attempt) => {
      try {
        let res;
        if (currentAttachments.length > 0) {
          const formData = new FormData();
          formData.append('conversationId', activeId);
          if (trimmedMsg) formData.append('content', trimmedMsg);
          if (isEmail && replyingTo?.subject) {
            const subj = replyingTo.subject.startsWith('Re:') ? replyingTo.subject : `Re: ${replyingTo.subject}`;
            formData.append('subject', subj);
          }
          for (const att of currentAttachments) {
            formData.append('attachments', att.file);
          }
          res = await api.post('/api/messages/send', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
            onUploadProgress: (progressEvent) => {
              const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setUploadProgress(pct);
            },
          });
        } else {
          const body = { conversationId: activeId, content: trimmedMsg };
          if (isEmail && replyingTo?.subject) {
            body.subject = replyingTo.subject.startsWith('Re:') ? replyingTo.subject : `Re: ${replyingTo.subject}`;
          }
          res = await api.post('/api/messages/send', body);
        }

        const realMessage = res.data.message;
        if (realMessage.id) knownMessageIds.current.add(realMessage.id);
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? realMessage : m))
        );
        messageCache.current.set(activeId, null);
        setUploadProgress(null);
        clearDraft(activeId);
        // Close the reply box and clear replyingTo on all platforms after a
        // successful send. For Gmail this keeps the UX tight (the reply
        // is now visible in the thread list above).
        setShowReplyBox(false);
        setReplyingTo(null);
      } catch (err) {
        const isRetryable = !err.response || err.response.status >= 500 || err.code === 'ECONNABORTED';
        if (isRetryable && attempt < MAX_RETRIES) {
          setUploadProgress(0);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          return doSend(attempt + 1);
        }
        throw err;
      }
    };

    try {
      await doSend(0);
    } catch (err) {
      console.error('Failed to send message:', err);
      const errorMsg = err.response?.data?.error || err.message || 'Failed to send message';
      setSendError(errorMsg);
      clearTimeout(sendErrorTimerRef.current);
      sendErrorTimerRef.current = setTimeout(() => setSendError(''), 5000);
      setUploadProgress(null);
      setMessages((prev) =>
        prev.map((m) => m.id === optimisticId ? { ...m, status: 'failed', _sendError: errorMsg } : m)
      );
    } finally {
      setSending(false);
    }
  }, [newMessage, attachments, sending, replyingTo, clearDraft]);

  const showFileError = useCallback((message, details) => {
    clearTimeout(fileErrorTimerRef.current);
    setFileError({ message, details });
    fileErrorTimerRef.current = setTimeout(() => setFileError(null), 5000);
  }, []);

  useEffect(() => () => { clearTimeout(fileErrorTimerRef.current); clearTimeout(sendErrorTimerRef.current); }, []);

  const handleFileSelect = useCallback(async (files) => {
    const ALLOWED_TYPES = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv',
      'audio/mpeg', 'audio/ogg', 'audio/wav',
      'video/mp4', 'video/webm',
    ];
    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    const SUPPORTED_FORMATS = 'JPG, PNG, GIF, WebP, PDF, DOC, DOCX, XLS, XLSX, TXT, CSV, MP3, OGG, WAV, MP4, WebM';

    const fileArray = Array.from(files);
    const newAttachments = [];
    for (const file of fileArray) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        showFileError(`"${file.name}" is not a supported file type`, `Supported formats: ${SUPPORTED_FORMATS}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        showFileError(`"${file.name}" exceeds the 25 MB size limit (${formatFileSize(file.size)})`, `Maximum file size: 25 MB. Supported formats: ${SUPPORTED_FORMATS}`);
        continue;
      }
      try {
        let processedFile = file;
        let preview = null;
        if (file.type.startsWith('image/') && file.size > 512000) {
          try { processedFile = await compressImage(file, 1200, 0.8); } catch { processedFile = file; }
        }
        if (processedFile.type.startsWith('image/')) {
          preview = URL.createObjectURL(processedFile);
        } else if (processedFile.type.startsWith('video/')) {
          preview = URL.createObjectURL(processedFile);
        }
        newAttachments.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: processedFile,
          name: file.name,
          size: processedFile.size,
          type: processedFile.type,
          preview,
        });
      } catch (err) {
        console.error('Failed to process attachment:', file.name, err);
        showFileError(`Failed to process "${file.name}"`, 'Please try again or use a different file');
      }
    }
    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  }, [showFileError]);

  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const toggleCollapsed = (msgId) => {
    setCollapsedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const openReplyBox = useCallback((msg) => {
    setReplyingTo(msg);
    setShowReplyBox(true);
    // Only clear message if there's no existing draft content
    setNewMessage((prev) => prev || '');
    setAttachments([]);
  }, []);

  // ── Socket connection status ──
  const [socketConnected, setSocketConnected] = useState(() => {
    const s = getSocket();
    return s?.connected || false;
  });
  useEffect(() => {
    const checkSocket = () => {
      const s = getSocket();
      if (!s) return;
      setSocketConnected(s.connected);
      const onConnect = () => setSocketConnected(true);
      const onDisconnect = () => setSocketConnected(false);
      s.on('connect', onConnect);
      s.on('disconnect', onDisconnect);
      return () => { s.off('connect', onConnect); s.off('disconnect', onDisconnect); };
    };
    const cleanup = checkSocket();
    if (!cleanup) {
      const timer = setTimeout(() => { checkSocket(); }, 1000);
      return () => clearTimeout(timer);
    }
    return cleanup;
  }, []);

  const platform = activeConversation?.connectedAccount?.platform;
  const isEmailPlatform = platform === 'gmail';
  const emailSubject = useMemo(
    () => isEmailPlatform ? (messages.find((m) => m.subject)?.subject || '(No Subject)') : null,
    [isEmailPlatform, messages]
  );

  // ═══════════════════════════════════════════════════════════════════
  // FILTER & PAGINATION LOGIC
  // ═══════════════════════════════════════════════════════════════════

  const toggleStar = useCallback(async (convId, e) => {
    if (e) e.stopPropagation();
    // Optimistic update
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, isStarred: !c.isStarred } : c))
    );
    try {
      await api.patch(`/api/conversations/${convId}/star`);
    } catch (err) {
      console.error('Failed to toggle star:', err);
      // Revert on failure
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, isStarred: !c.isStarred } : c))
      );
    }
  }, []);

  const toggleLead = useCallback(async (convId, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, isLead: !c.isLead } : c))
    );
    try {
      await api.patch(`/api/conversations/${convId}/lead`);
    } catch (err) {
      console.error('Failed to toggle lead:', err);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, isLead: !c.isLead } : c))
      );
    }
  }, []);

  const deleteConversation = useCallback(async (convId, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, isDeleted: true } : c))
    );
    try {
      await api.patch(`/api/conversations/${convId}/delete`);
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, isDeleted: false } : c))
      );
    }
    // Navigate away if viewing deleted conversation
    if (conversationIdRef.current === convId) {
      navigate('/inbox');
    }
  }, [navigate]);

  const restoreConversation = useCallback(async (convId, e) => {
    if (e) e.stopPropagation();
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, isDeleted: false, deletedAt: null } : c))
    );
    try {
      await api.patch(`/api/conversations/${convId}/restore`);
    } catch (err) {
      console.error('Failed to restore conversation:', err);
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, isDeleted: true } : c))
      );
    }
  }, []);

  const permanentDeleteConversation = useCallback(async (convId, e) => {
    if (e) e.stopPropagation();
    try {
      await api.delete(`/api/conversations/${convId}/permanent`);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (conversationIdRef.current === convId) {
        navigate('/inbox');
      }
    } catch (err) {
      console.error('Failed to permanently delete:', err);
    }
  }, [navigate]);

  const toggleSourceFilter = useCallback((source) => {
    setSourceFilters((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
    setCurrentPage(1);
  }, []);

  const toggleSelectMessage = useCallback((convId, e) => {
    e.stopPropagation();
    setSelectedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(convId)) next.delete(convId);
      else next.add(convId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedMessages((prev) => {
      if (prev.size > 0) return new Set();
      return new Set(conversations.map((c) => c.id));
    });
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    let result = conversations;

    // Apply search filter
    if (search) {
      const term = search.toLowerCase();
      result = result.filter((c) => {
        const contactName = c.contact?.name || c.contact?.username || '';
        const lastMsg = c.messages?.[0]?.content || '';
        return contactName.toLowerCase().includes(term) || lastMsg.toLowerCase().includes(term);
      });
    }

    // Apply source filter only when a subset of platforms is selected
    if (sourceFilters.size > 0 && sourceFilters.size < connectedPlatforms.size) {
      result = result.filter((c) => sourceFilters.has(c.connectedAccount?.platform));
    }

    // Apply category filter
    switch (activeFilter) {
      case 'unread':
        result = result.filter((c) => !c.isDeleted && c.unreadCount > 0);
        break;
      case 'starred':
        result = result.filter((c) => !c.isDeleted && c.isStarred);
        break;
      case 'ai_responded':
        result = result.filter((c) => !c.isDeleted && c._aiResponded);
        break;
      case 'draft':
        result = result.filter((c) => !c.isDeleted && c.hasDraft);
        break;
      case 'bin':
        result = result.filter((c) => c.isDeleted);
        break;
      default:
        // Default: exclude deleted
        result = result.filter((c) => !c.isDeleted);
        break;
    }

    return result;
  }, [conversations, search, sourceFilters, activeFilter, connectedPlatforms]);

  // Filter counts
  const filterCounts = useMemo(() => {
    const nonDeleted = conversations.filter((c) => !c.isDeleted);
    return {
      all: nonDeleted.length,
      unread: nonDeleted.filter((c) => c.unreadCount > 0).length,
      starred: nonDeleted.filter((c) => c.isStarred).length,
      ai_responded: 0,
      draft: nonDeleted.filter((c) => c.hasDraft).length,
      bin: conversations.filter((c) => c.isDeleted).length,
    };
  }, [conversations]);

  // Source counts — only from non-deleted conversations
  const sourceCounts = useMemo(() => {
    const counts = {};
    conversations.filter((c) => !c.isDeleted).forEach((c) => {
      const p = c.connectedAccount?.platform;
      if (p) counts[p] = (counts[p] || 0) + 1;
    });
    return counts;
  }, [conversations]);

  // Only show source filters for connected platforms
  const availableSourceFilters = useMemo(
    () => ALL_SOURCE_FILTERS.filter((sf) => connectedPlatforms.has(sf.key)),
    [connectedPlatforms]
  );

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredConversations.length / ITEMS_PER_PAGE));
  const paginatedConversations = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredConversations.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredConversations, currentPage]);

  // Reset page when filter changes
  useEffect(() => { setCurrentPage(1); }, [activeFilter, search]);

  const handleSelectConversation = useCallback((convId) => navigate(`/inbox/${convId}`), [navigate]);
  const handleBackToList = useCallback(() => navigate('/inbox'), [navigate]);
  const platformTheme = useMemo(() => getPlatformTheme(platform), [platform]);

  // Stable handlers for inline props — prevents child re-renders
  const handleAttachClick = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileInputChange = useCallback((e) => {
    if (e.target.files?.length) {
      const selectedFiles = Array.from(e.target.files);
      e.target.value = '';
      handleFileSelect(selectedFiles);
    }
  }, [handleFileSelect]);
  const handleOpenReply = useCallback(() => {
    const lastMsg = messages[messages.length - 1];
    openReplyBox(lastMsg || { subject: emailSubject });
  }, [messages, openReplyBox, emailSubject]);
  const handleCloseReply = useCallback(() => {
    setShowReplyBox(false);
    setReplyingTo(null);
    setAttachments([]);
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // RENDER: CONVERSATION VIEW (when a conversation is selected)
  // ═══════════════════════════════════════════════════════════════════

  if (conversationId) {
    return (
      <div className="flex flex-col h-full bg-[#0B1628] p-0 lg:p-5 gap-0 lg:gap-4 overflow-hidden">
        {/* Page header — desktop only on conversation view (mobile uses chat header) */}
        <div className="hidden lg:flex items-center justify-between gap-3 flex-shrink-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Smart Inbox</h1>
          <div className="flex items-center gap-3 flex-1 sm:flex-none justify-end">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inbox"
                className="w-full pl-9 pr-4 py-2.5 bg-[#0F1D33] border border-white/5 rounded-full text-sm text-white placeholder-white/40 focus:border-[#1787FE] focus:ring-1 focus:ring-[#1787FE] outline-none transition"
              />
            </div>
            <button
              onClick={openLinkAccounts}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#1787FE] hover:bg-[#1377e0] text-white text-sm font-semibold rounded-full transition whitespace-nowrap shadow-lg shadow-[#1787FE]/20"
            >
              <Link2 size={16} />
              <span className="hidden sm:inline">LINK ACCOUNT</span>
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 bg-white lg:rounded-2xl border-0 lg:border lg:border-gray-200 overflow-hidden lg:shadow-xl">
        {/* Filter panel — hidden on mobile when viewing conversation */}
        <div className="hidden lg:flex w-[260px] flex-shrink-0 flex-col border-r border-gray-100">
          <FilterPanel
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            filterCounts={filterCounts}
            sourceFilters={sourceFilters}
            toggleSourceFilter={toggleSourceFilter}
            sourceCounts={sourceCounts}
            availableSourceFilters={availableSourceFilters}
            conversationId={conversationId}
            navigate={navigate}
          />
        </div>

        {/* Conversation area */}
        <div
          className="flex-1 flex flex-col min-w-0"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {/* Drop overlay */}
          {dragOver && (
            <div className="absolute inset-0 bg-primary-500/10 border-2 border-dashed border-primary-400 z-10 flex items-center justify-center rounded-lg pointer-events-none">
              <div className="bg-white px-6 py-4 rounded-xl shadow-lg text-center">
                <UploadCloud size={32} className="text-primary-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">Drop files here to attach</p>
              </div>
            </div>
          )}

          {conversationId && !activeConversation && messagesError ? (
            /* Error state — all retries exhausted */
            <>
              <div className="border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-3 bg-white">
                <button onClick={handleBackToList} className="text-gray-500 hover:text-gray-800 transition flex-shrink-0">
                  <ArrowLeft size={20} />
                </button>
                <span className="text-sm text-gray-500">Conversation</span>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <AlertCircle size={40} className="text-red-500 mb-3" />
                <p className="text-sm font-medium text-gray-700 mb-1">{messagesError}</p>
                <button
                  onClick={() => fetchMessages(conversationId, true)}
                  className="mt-3 px-4 py-2 bg-[#1787FE] hover:bg-[#1377e0] text-white text-sm rounded-lg transition flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  Retry
                </button>
              </div>
            </>
          ) : conversationId && !activeConversation ? (
            /* Loading skeleton */
            <>
              <div className="border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-3 bg-white">
                <button onClick={handleBackToList} className="text-gray-500 hover:text-gray-800 transition flex-shrink-0">
                  <ArrowLeft size={20} />
                </button>
                <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                  <div className="h-3 w-20 bg-gray-100 rounded animate-pulse" />
                </div>
              </div>
              <MessagesSkeleton />
            </>
          ) : conversationId && activeConversation ? (
            <>
              {/* MOBILE Chat header — dark navy */}
              <div className="lg:hidden bg-[#0B1628] px-3 py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={handleBackToList}
                    className="w-9 h-9 rounded-lg bg-white/10 text-white flex items-center justify-center flex-shrink-0"
                    aria-label="Back"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <h2 className="font-semibold text-white truncate text-sm">
                    {getContactDisplayName(activeConversation.contact, platform)}
                  </h2>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${getPlatformBadgeStyle(platform)}`}>
                    {getPlatformLabel(platform)}
                  </span>
                </div>
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setMobileMenuOpen((v) => !v)}
                    className="w-9 h-9 rounded-lg text-white flex items-center justify-center hover:bg-white/10"
                    aria-label="More options"
                  >
                    <MoreVertical size={18} />
                  </button>
                  {mobileMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMobileMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-2xl border border-gray-200 z-40 overflow-hidden">
                        <button
                          onClick={() => { toggleLead(conversationId); setMobileMenuOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition text-left"
                        >
                          <Users size={16} className={activeConversation?.isLead ? 'text-[#1787FE]' : 'text-gray-400'} />
                          {activeConversation?.isLead ? 'Remove from Leads' : 'Mark as Lead'}
                        </button>
                        <button
                          onClick={() => { toggleStar(conversationId); setMobileMenuOpen(false); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition text-left"
                        >
                          <Star size={16} className={activeConversation?.isStarred ? 'text-yellow-500' : 'text-gray-400'} fill={activeConversation?.isStarred ? 'currentColor' : 'none'} />
                          {activeConversation?.isStarred ? 'Unstar' : 'Star'}
                        </button>
                        {activeConversation?.isDeleted ? (
                          <button
                            onClick={() => { restoreConversation(conversationId); setMobileMenuOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition text-left"
                          >
                            <Undo2 size={16} className="text-gray-400" />
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => { deleteConversation(conversationId); setMobileMenuOpen(false); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-red-50 transition text-left"
                          >
                            <Trash2 size={16} />
                            Move to Bin
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* DESKTOP Chat header */}
              <div className="hidden lg:flex border-b border-gray-100 px-4 sm:px-6 py-3 items-center justify-between bg-white">
                <div className="flex items-center gap-3">
                  <button onClick={handleBackToList} className="text-gray-500 hover:text-gray-800 transition flex-shrink-0">
                    <ArrowLeft size={20} />
                  </button>
                  <h2 className="font-semibold text-gray-900 truncate text-sm sm:text-base">
                    {getContactDisplayName(activeConversation.contact, platform)}
                  </h2>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${getPlatformBadgeStyle(platform)}`}>
                    {getPlatformLabel(platform)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleLead(conversationId)}
                    className={`p-2 rounded-lg transition ${activeConversation?.isLead ? 'text-[#1787FE] hover:bg-blue-50' : 'text-gray-400 hover:text-[#1787FE] hover:bg-gray-100'}`}
                    title={activeConversation?.isLead ? 'Remove from Leads' : 'Mark as Lead'}
                  >
                    <Users size={18} />
                  </button>
                  <button
                    onClick={() => toggleStar(conversationId)}
                    className={`p-2 rounded-lg transition ${activeConversation?.isStarred ? 'text-yellow-500 hover:bg-yellow-50' : 'text-gray-400 hover:text-yellow-500 hover:bg-gray-100'}`}
                    title={activeConversation?.isStarred ? 'Unstar' : 'Star'}
                  >
                    <Star size={18} fill={activeConversation?.isStarred ? 'currentColor' : 'none'} />
                  </button>
                  {activeConversation?.isDeleted ? (
                    <button
                      onClick={() => restoreConversation(conversationId)}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-gray-100 rounded-lg transition"
                      title="Restore from Bin"
                    >
                      <Undo2 size={18} />
                    </button>
                  ) : (
                    <button
                      onClick={() => deleteConversation(conversationId)}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 rounded-lg transition"
                      title="Move to Bin"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>

              {/* Messages area */}
              {(loadingMessages || showMessageSkeleton) && messages.length === 0 ? (
                <MessagesSkeleton />
              ) : !loadingMessages && messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 px-6 bg-white">
                  <MessageSquare size={40} className="mb-3 text-gray-300" />
                  <p className="text-sm text-gray-500">No messages yet</p>
                </div>
              ) : isEmailPlatform ? (
                <EmailThreadView
                  messages={messages}
                  emailSubject={emailSubject}
                  collapsedMessages={collapsedMessages}
                  toggleCollapsed={toggleCollapsed}
                  onReply={openReplyBox}
                  messagesEndRef={messagesEndRef}
                />
              ) : (
                <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3 animate-fade-in bg-white">
                  {messages.map((msg, idx) => {
                    const isOutbound = msg.direction === 'outbound';
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const showDate = !prevMsg || !isSameDay(prevMsg.sentAt, msg.sentAt);
                    return (
                      <div key={msg.id || `msg-${idx}`}>
                        {showDate && (
                          <div className="flex items-center justify-center my-4">
                            <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-500">
                              {formatDate(msg.sentAt)}
                            </span>
                          </div>
                        )}
                        {renderChatBubble(msg, isOutbound, activeConversation?.contact, platform)}
                        {msg.status === 'failed' && (
                          <div className="flex justify-end items-center gap-2 mt-1 px-2">
                            <AlertCircle size={12} className="text-red-500" />
                            <span className="text-[10px] text-red-500">Failed to send</span>
                            <button
                              onClick={() => {
                                setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                setNewMessage(msg.content || '');
                                setSendError('');
                              }}
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                            >
                              <RefreshCw size={10} />
                              Retry
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {/* Send error */}
              {sendError && (
                <div className="px-4 sm:px-6 py-2 bg-red-50 border-t border-red-100">
                  <p className="text-xs text-red-600">{sendError}</p>
                </div>
              )}

              {/* File validation toast */}
              {fileError && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md animate-fade-in">
                  <div className="bg-red-600 text-white rounded-xl shadow-lg px-4 py-3 flex items-start gap-3">
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{fileError.message}</p>
                      {fileError.details && <p className="text-xs text-red-200 mt-1 leading-snug">{fileError.details}</p>}
                    </div>
                    <button onClick={() => { clearTimeout(fileErrorTimerRef.current); setFileError(null); }} className="flex-shrink-0 text-red-200 hover:text-white transition"><X size={16} /></button>
                  </div>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,audio/mpeg,audio/ogg,audio/wav,video/mp4,video/webm"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {/* Composer — EmailReplyBox for Gmail, chat composer for all other platforms */}
              {isEmailPlatform ? (
                <EmailReplyBox
                  ref={replyBoxRef}
                  showReplyBox={showReplyBox}
                  replyingTo={replyingTo}
                  newMessage={newMessage}
                  setNewMessage={handleNewMessageChange}
                  handleSend={handleSend}
                  sending={sending}
                  attachments={attachments}
                  onAttachClick={handleAttachClick}
                  removeAttachment={removeAttachment}
                  uploadProgress={uploadProgress}
                  onOpenReply={() => {
                    const lastMsg = messages[messages.length - 1];
                    openReplyBox(lastMsg || { subject: emailSubject });
                  }}
                  onClose={() => { setShowReplyBox(false); setReplyingTo(null); }}
                  onAiRespond={handleAiRespond}
                  aiLoading={aiLoading}
                  aiSuggestion={aiSuggestion}
                  aiError={aiError}
                  onAiUse={(text) => { handleNewMessageChange(text); setAiSuggestion(null); }}
                  onAiDismiss={() => setAiSuggestion(null)}
                />
              ) : (
                <>
                  {attachments.length > 0 && (
                    <AttachmentPreview attachments={attachments} onRemove={removeAttachment} uploadProgress={uploadProgress} />
                  )}
                  {/* Desktop composer */}
                  <div className="hidden lg:block">
                    <ChatComposer
                      newMessage={newMessage}
                      setNewMessage={handleNewMessageChange}
                      handleSend={handleSend}
                      sending={sending}
                      attachments={attachments}
                      onAttachClick={() => fileInputRef.current?.click()}
                      onAiRespond={handleAiRespond}
                      aiLoading={aiLoading}
                      aiSuggestion={aiSuggestion}
                      aiError={aiError}
                      onAiUse={(text) => { handleNewMessageChange(text); setAiSuggestion(null); }}
                      onAiDismiss={() => setAiSuggestion(null)}
                    />
                  </div>
                  {/* Mobile composer — dark navy with pill input */}
                  <div className="lg:hidden">
                    <MobileChatComposer
                      newMessage={newMessage}
                      setNewMessage={handleNewMessageChange}
                      handleSend={handleSend}
                      sending={sending}
                      attachments={attachments}
                      onAttachClick={() => fileInputRef.current?.click()}
                      onAiRespond={handleAiRespond}
                      aiLoading={aiLoading}
                    />
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER: INBOX LIST VIEW (no conversation selected)
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-full bg-[#0B1628] p-3 sm:p-5 gap-3 lg:gap-4 overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between gap-2 lg:gap-3 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* Hamburger — mobile only — toggles DashboardLayout sidebar via custom event */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('toggle-mobile-sidebar'))}
            className="lg:hidden text-white p-1.5 flex-shrink-0"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white truncate">Smart Inbox</h1>
        </div>
        <div className="flex items-center gap-2 lg:gap-3 flex-1 lg:flex-none justify-end min-w-0">
          <div className="relative flex-1 lg:w-72 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full pl-9 pr-3 py-2 lg:py-2.5 bg-[#0F1D33] border border-white/5 rounded-full text-sm text-white placeholder-white/40 focus:border-[#1787FE] focus:ring-1 focus:ring-[#1787FE] outline-none transition"
            />
          </div>
          {/* Mobile: round icon-only Link button */}
          <button
            onClick={openLinkAccounts}
            className="lg:hidden w-10 h-10 rounded-full bg-[#1787FE] hover:bg-[#1377e0] text-white flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#1787FE]/30"
            aria-label="Link account"
          >
            <Link2 size={18} />
          </button>
          {/* Desktop: pill with label */}
          <button
            onClick={openLinkAccounts}
            className="hidden lg:flex items-center gap-2 px-4 py-2.5 bg-[#1787FE] hover:bg-[#1377e0] text-white text-sm font-semibold rounded-full transition whitespace-nowrap shadow-lg shadow-[#1787FE]/20"
          >
            <Link2 size={16} />
            <span>LINK ACCOUNT</span>
          </button>
        </div>
      </div>

      {/* Inbox card */}
      <div className="flex flex-1 min-h-0 bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xl">
      {/* Filter Panel */}
      <div className="hidden lg:flex w-[260px] flex-shrink-0 flex-col border-r border-gray-100">
        <FilterPanel
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          filterCounts={filterCounts}
          sourceFilters={sourceFilters}
          toggleSourceFilter={toggleSourceFilter}
          sourceCounts={sourceCounts}
          availableSourceFilters={availableSourceFilters}
          conversationId={null}
          navigate={navigate}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar row */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-gray-100">
          <input
            type="checkbox"
            checked={selectedMessages.size > 0 && selectedMessages.size === paginatedConversations.length}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded border-gray-300 bg-white text-[#1787FE] focus:ring-[#1787FE] focus:ring-offset-0 cursor-pointer"
          />
        </div>

        {/* Message rows */}
        <div className="flex-1 overflow-y-auto">
          {showConversationSkeleton && filteredConversations.length === 0 ? (
            <InboxListSkeleton />
          ) : filteredConversations.length === 0 && !loadingConversations ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
              <MessageSquare size={48} className="mb-3 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">No conversations found</p>
              <p className="text-xs mt-1 text-gray-400">Connect an account or adjust your filters</p>
            </div>
          ) : (
            paginatedConversations.map((conv, rowIdx) => {
              const lastMessage = conv.messages?.[0];
              const preview = lastMessage?.content
                ? lastMessage.content.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').slice(0, 80)
                : 'No messages';
              const convPlatform = conv.connectedAccount?.platform;
              const isStarred = !!conv.isStarred;
              const isSelected = selectedMessages.has(conv.id);
              const isUnread = conv.unreadCount > 0;
              const isBinView = activeFilter === 'bin';

              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-100 transition text-left group hover:bg-blue-50 ${
                    rowIdx % 2 === 0 ? 'bg-white' : 'bg-[#F5F8FF]'
                  } ${isUnread ? 'font-medium' : ''}`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => toggleSelectMessage(conv.id, e)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-gray-300 bg-white text-[#1787FE] focus:ring-[#1787FE] focus:ring-offset-0 cursor-pointer flex-shrink-0"
                  />

                  {/* Star */}
                  <button
                    onClick={(e) => toggleStar(conv.id, e)}
                    className={`flex-shrink-0 transition ${isStarred ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-400'}`}
                  >
                    <Star size={16} fill={isStarred ? 'currentColor' : 'none'} />
                  </button>

                  {/* Sender name */}
                  <span className={`w-36 truncate text-sm flex-shrink-0 ${isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                    {getContactDisplayName(conv.contact, convPlatform)}
                  </span>

                  {/* Platform badge */}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${getPlatformBadgeStyle(convPlatform)}`}>
                    {getPlatformLabel(convPlatform)}
                  </span>

                  {/* Message preview */}
                  <span className={`flex-1 truncate text-sm ${isUnread ? 'text-gray-800' : 'text-gray-500'}`}>
                    {preview}
                  </span>

                  {/* Draft indicator */}
                  {conv.hasDraft && !isBinView && (
                    <span className="text-xs text-orange-500 flex-shrink-0">Draft</span>
                  )}

                  {/* Timestamp */}
                  <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                    {formatTimeShort(conv.lastMessageAt)}
                  </span>

                  {/* Row actions — on hover */}
                  {isBinView ? (
                    <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={(e) => restoreConversation(conv.id, e)}
                        className="p-1 text-gray-400 hover:text-green-600 transition rounded"
                        title="Restore"
                      >
                        <Undo2 size={14} />
                      </button>
                      <button
                        onClick={(e) => permanentDeleteConversation(conv.id, e)}
                        className="p-1 text-gray-400 hover:text-red-600 transition rounded"
                        title="Delete permanently"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={(e) => toggleLead(conv.id, e)}
                        className={`p-1 transition rounded ${conv.isLead ? 'text-[#1787FE] hover:text-[#1377e0]' : 'text-gray-400 hover:text-[#1787FE]'}`}
                        title={conv.isLead ? 'Remove from Leads' : 'Mark as Lead'}
                      >
                        <Users size={14} />
                      </button>
                      <button
                        onClick={(e) => deleteConversation(conv.id, e)}
                        className="p-1 text-gray-400 hover:text-red-600 transition rounded"
                        title="Move to Bin"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Pagination */}
        {filteredConversations.length > 0 && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>
              Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredConversations.length)}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredConversations.length)} of {filteredConversations.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Link Accounts modal is mounted globally in DashboardLayout */}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FILTER PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════

const FilterPanel = memo(function FilterPanel({ activeFilter, setActiveFilter, filterCounts, sourceFilters, toggleSourceFilter, sourceCounts, availableSourceFilters, conversationId, navigate }) {
  const { openLinkAccounts } = useLinkAccounts();
  return (
    <div className="flex flex-col h-full py-4">
      {/* Filter categories */}
      <div className="px-3 space-y-0.5">
        {FILTER_CATEGORIES.map(({ key, label, icon: Icon }) => {
          const isActive = activeFilter === key;
          const count = filterCounts[key] || 0;
          return (
            <button
              key={key}
              onClick={() => {
                setActiveFilter(key);
                if (conversationId) navigate('/inbox');
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition ${
                isActive
                  ? 'bg-[#1787FE] text-white shadow-lg shadow-[#1787FE]/20'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon size={18} className={isActive ? 'text-white' : 'text-gray-400'} />
                <span className={isActive ? 'font-semibold' : ''}>{label}</span>
              </div>
              {count > 0 && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  isActive ? 'bg-white/25 text-white' : 'text-gray-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Source section — only connected platforms, clickable filters */}
      {availableSourceFilters.length > 0 && (
        <div className="mt-6 px-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">Source</h3>
          <div className="space-y-0.5">
            {availableSourceFilters.map(({ key, label }) => {
              const isChecked = sourceFilters.has(key);
              const count = sourceCounts[key] || 0;
              const dotColor = key === 'instagram' ? 'bg-pink-500' :
                               key === 'facebook'  ? 'bg-blue-500' :
                               key === 'whatsapp'  ? 'bg-green-500' :
                               key === 'gmail'     ? 'bg-red-500' : 'bg-gray-500';
              return (
                <button
                  key={key}
                  onClick={() => toggleSourceFilter(key)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition ${
                    isActive
                      ? 'bg-blue-50 text-gray-900'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border ${
                      isActive
                        ? key === 'instagram' ? 'bg-orange-500 border-orange-500' :
                          key === 'facebook' ? 'bg-blue-500 border-blue-500' :
                          key === 'whatsapp' ? 'bg-green-500 border-green-500' :
                          key === 'gmail' ? 'bg-red-500 border-red-500' :
                          key === 'linkedin' ? 'bg-sky-500 border-sky-500' : 'bg-gray-500 border-gray-500'
                        : 'bg-white border-gray-300'
                    }`}>
                      {isActive && <span className="text-white text-[10px] leading-none">✓</span>}
                    </span>
                    <span className={isActive ? 'font-medium' : ''}>{label}</span>
                  </div>
                  {count > 0 && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-blue-100 text-blue-700' : 'text-gray-400'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Connect account link — opens the global Link Accounts modal */}
      <div className="mt-4 px-6">
        <button
          type="button"
          onClick={openLinkAccounts}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#1787FE] transition"
        >
          <span className="text-lg leading-none">+</span>
          Connect account
        </button>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// CHAT COMPOSER (dark theme, matching design)
// ═══════════════════════════════════════════════════════════════════

const ChatComposer = memo(function ChatComposer({
  newMessage, setNewMessage, handleSend, sending, attachments, onAttachClick,
  onAiRespond, aiLoading, aiSuggestion, aiError, onAiUse, onAiDismiss,
}) {
  const hasContent = newMessage.trim() || attachments.length > 0;
  const [autoSend, setAutoSend] = useState(false);

  const handleUseSuggestion = () => {
    if (autoSend) {
      onAiUse(aiSuggestion);
      // Trigger send after state update
      setTimeout(() => {
        document.getElementById('chat-send-btn')?.click();
      }, 50);
    } else {
      onAiUse(aiSuggestion);
    }
  };

  return (
    <div className="border-t border-gray-100 bg-white px-4 sm:px-6 py-3 space-y-2">
      {/* AI Suggestion Box */}
      {(aiSuggestion || aiLoading || aiError) && (
        <div className="rounded-xl border-2 border-dashed border-[#1787FE]/40 bg-blue-50/60 px-4 py-3 relative">
          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Sparkles size={14} className="text-[#1787FE] animate-pulse" />
              Generating AI reply...
            </div>
          )}
          {aiError && (
            <div className="text-sm text-red-500">{aiError}</div>
          )}
          {aiSuggestion && (
            <>
              <p className="text-sm text-gray-800 leading-relaxed pr-24">{aiSuggestion}</p>
              <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
                <button
                  onClick={() => { navigator.clipboard.writeText(aiSuggestion); }}
                  className="px-3 py-1.5 text-xs font-semibold border border-gray-300 bg-white rounded-lg hover:bg-gray-50 transition whitespace-nowrap"
                >
                  Copy Text
                </button>
                <button
                  onClick={handleUseSuggestion}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1787FE] text-white rounded-lg hover:bg-[#1377e0] transition whitespace-nowrap"
                >
                  Auto-Send
                  <Send size={11} />
                </button>
                <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={e => setAutoSend(e.target.checked)}
                    className="w-3 h-3"
                  />
                  Always
                </label>
              </div>
              <button
                onClick={onAiDismiss}
                className="absolute bottom-2 right-2 text-gray-300 hover:text-gray-500 transition"
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
      )}

      <form onSubmit={handleSend} className="flex items-center gap-3">
        {/* AI Respond pill */}
        <button
          type="button"
          onClick={onAiRespond}
          disabled={aiLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#1787FE] bg-blue-50 hover:bg-blue-100 rounded-full transition whitespace-nowrap disabled:opacity-50"
        >
          <Sparkles size={14} className={aiLoading ? 'animate-pulse' : ''} />
          AI Respond
        </button>

        {/* Input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Write message"
            className="w-full px-4 py-2.5 bg-white border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:border-[#1787FE] focus:ring-1 focus:ring-[#1787FE] outline-none transition"
          />
        </div>

        {/* Attach */}
        <button
          type="button"
          onClick={onAttachClick}
          className="p-2 text-gray-400 hover:text-gray-700 transition"
          title="Attach file"
        >
          <Paperclip size={18} />
        </button>

        {/* Emoji */}
        <button
          type="button"
          className="p-2 text-gray-400 hover:text-gray-700 transition hidden sm:block"
        >
          <Smile size={18} />
        </button>

        {/* Send */}
        <button
          id="chat-send-btn"
          type="submit"
          disabled={!hasContent || sending}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1787FE] hover:bg-[#1377e0] text-white text-sm font-semibold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
          <Send size={14} />
        </button>
      </form>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// MOBILE CHAT COMPOSER — dark navy bottom bar matching mockup
// ═══════════════════════════════════════════════════════════════════

function MobileChatComposer({ newMessage, setNewMessage, handleSend, sending, attachments, onAttachClick, onAiRespond, aiLoading }) {
  const hasContent = newMessage.trim() || attachments.length > 0;

  return (
    <div className="bg-[#0B1628] px-3 py-3 border-t border-white/5">
      <form onSubmit={handleSend} className="flex items-center gap-2">
        {/* Attach */}
        <button
          type="button"
          onClick={onAttachClick}
          className="text-[#1787FE] p-1.5 flex-shrink-0"
          aria-label="Attach file"
        >
          <Paperclip size={20} />
        </button>

        {/* Pill input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Write message"
            className="w-full px-4 py-2.5 bg-[#0F1D33] border border-white/5 rounded-full text-sm text-white placeholder-white/40 focus:border-[#1787FE] outline-none transition"
          />
        </div>

        {/* AI Respond button */}
        <button
          type="button"
          onClick={onAiRespond}
          disabled={aiLoading}
          className="w-10 h-10 rounded-full bg-white flex items-center justify-center flex-shrink-0 disabled:opacity-50 transition"
          aria-label="AI Respond"
        >
          <Sparkles size={18} className={`text-[#1787FE] ${aiLoading ? 'animate-pulse' : ''}`} />
        </button>

        {/* Camera */}
        <button
          type="button"
          onClick={onAttachClick}
          className="text-white/70 p-1.5 flex-shrink-0"
          aria-label="Camera"
        >
          <Camera size={20} />
        </button>

        {/* Mic */}
        <button
          type="button"
          className="text-white/70 p-1.5 flex-shrink-0"
          aria-label="Voice message"
        >
          <Mic size={20} />
        </button>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CHAT BUBBLE (dark theme, matching design)
// ═══════════════════════════════════════════════════════════════════

function renderChatBubble(msg, isOutbound, contact, platform) {
  const isSending = msg._optimistic || msg.status === 'sending';
  const isPlaceholder = msg.attachments?.length > 0 && msg.content && /^\[[\w\s.,_-]+\]$/.test(msg.content.trim());
  const hasAttachments = msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0;
  // Suppress text content if all attachments are images — the text is just
  // the filename echoed by Instagram/WhatsApp and clutters the image bubble.
  const allAttachmentsAreImages = hasAttachments && msg.attachments.every(a => a.mimeType?.startsWith('image/'));
  const textContent = (isPlaceholder || allAttachmentsAreImages) ? '' : (msg.content || '');
  if (!textContent && !hasAttachments && !isSending) return null;

  // For image-only messages, render images without the colored bubble wrapper
  if (allAttachmentsAreImages && !textContent) {
    return (
      <div className={`flex items-end gap-2 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
        {!isOutbound && (
          <ContactAvatar
            name={contact?.name || contact?.username || msg.sender}
            avatarUrl={contact?.avatarUrl}
            platform={platform}
            size={8}
          />
        )}
        <div className={`max-w-[80%] sm:max-w-[65%] ${isSending ? 'opacity-70' : ''}`}>
          <MessageAttachments attachments={msg.attachments} messageId={msg.id} isOutbound={isOutbound} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      {!isOutbound && (
        <ContactAvatar
          name={contact?.name || contact?.username || msg.sender}
          avatarUrl={contact?.avatarUrl}
          platform={platform}
          size={8}
        />
      )}
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-3 rounded-2xl text-sm ${
        isOutbound
          ? 'bg-[#1787FE] text-white rounded-br-md'
          : 'bg-gray-100 text-gray-800 rounded-bl-md'
      } ${isSending ? 'opacity-70' : ''}`}>
        {textContent && <p className="whitespace-pre-wrap break-words leading-relaxed">{textContent}</p>}
        <MessageAttachments attachments={msg.attachments} messageId={msg.id} isOutbound={isOutbound} />
        <p className={`text-[10px] mt-1.5 text-right ${isOutbound ? 'text-blue-100' : 'text-gray-500'}`}>
          {isSending ? 'Sending...' : formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL THREAD VIEW
// ═══════════════════════════════════════════════════════════════════

function EmailThreadView({ messages, emailSubject, collapsedMessages, toggleCollapsed, onReply, messagesEndRef }) {
  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="divide-y divide-gray-100">
        {messages.map((msg, idx) => {
          const isOutbound = msg.direction === 'outbound';
          const isLast = idx === messages.length - 1;
          // Auto-expand only the last message; allow user toggle for the rest
          const isCollapsed = isLast
            ? collapsedMessages.has(msg.id)
            : !collapsedMessages.has(msg.id);

          return (
            <EmailMessageCard
              key={msg.id || `msg-${idx}`}
              msg={msg}
              emailSubject={emailSubject}
              isOutbound={isOutbound}
              isCollapsed={isCollapsed}
              onToggleCollapse={() => toggleCollapsed(msg.id)}
              onReply={onReply}
            />
          );
        })}
      </div>
      <div ref={messagesEndRef} />
    </div>
  );
}

function EmailMessageCard({ msg, emailSubject, isOutbound, isCollapsed, onToggleCollapse, onReply }) {
  const hasHtml = msg.htmlContent && msg.htmlContent.trim().length > 0;
  const sanitizedHtml = hasHtml
    ? DOMPurify.sanitize(msg.htmlContent, {
        ALLOWED_TAGS: [
          'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
          'div', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img',
          'hr', 'font', 'center', 'small', 'sub', 'sup', 'dl', 'dt', 'dd',
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'width', 'height', 'style', 'class', 'color', 'face', 'size', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan'],
        ADD_ATTR: ['target'],
      })
    : null;

  const senderName = isOutbound ? 'You' : (msg.sender || 'Unknown');
  const senderEmail = msg.senderEmail || msg.fromEmail || (isOutbound ? null : msg.sender);
  const isEmailLikeAddress = senderEmail && /@/.test(senderEmail);
  const subjectText = msg.subject || emailSubject || '';
  const timestamp = msg.sentAt ? formatRelative(msg.sentAt) : '';

  const hasAttachments = msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0;

  return (
    <div className="px-4 sm:px-6 py-4 group/email-card">
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={onToggleCollapse}
      >
        {/* Avatar — letter fallback with platform color */}
        <ContactAvatar
          name={senderName}
          avatarUrl={msg.avatarUrl || null}
          platform="gmail"
          size={10}
        />

        {/* Sender + subject/preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">{senderName}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Reply icon — visible on row hover */}
              {onReply && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onReply(msg); }}
                  className="opacity-0 group-hover/email-card:opacity-100 transition-opacity p-1 text-gray-400 hover:text-[#1787FE] rounded hover:bg-blue-50"
                  title="Reply"
                >
                  <Reply size={14} />
                </button>
              )}
              <span className="text-xs text-gray-500">{timestamp}</span>
            </div>
          </div>
          {isCollapsed ? (
            <p className="text-xs text-gray-500 truncate mt-0.5">{subjectText || '(no subject)'}</p>
          ) : (
            isEmailLikeAddress && (
              <p className="text-xs text-gray-500 truncate mt-0.5">&lt;{senderEmail}&gt;</p>
            )
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="pl-13 sm:pl-[52px] mt-3">
          {subjectText && (
            <h3 className="text-sm font-semibold text-gray-900 mb-2">{subjectText}</h3>
          )}
          {sanitizedHtml ? (
            <div
              className="email-html-content text-sm text-gray-700 leading-relaxed"
              style={{ color: '#374151' }}
              dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
          ) : msg.content ? (
            <div className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
              {msg.content}
            </div>
          ) : (
            <div className="text-sm text-gray-400 italic">(No content)</div>
          )}
          {hasAttachments && (
            <div className="mt-3">
              <EmailAttachments attachments={msg.attachments} messageId={msg.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(date) {
  const then = new Date(date).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(date).toLocaleDateString();
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL ATTACHMENTS
// ═══════════════════════════════════════════════════════════════════

function EmailAttachments({ attachments, messageId }) {
  const handleDownload = async (att, index) => {
    if (!messageId) return;
    try {
      const response = await api.get(`/api/messages/${messageId}/attachments/${index}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const getPreviewUrl = (index) => {
    if (!messageId) return null;
    const token = localStorage.getItem('token');
    const base = api.defaults.baseURL || '';
    return `${base}/api/messages/${messageId}/attachments/${index}/preview?token=${encodeURIComponent(token)}`;
  };

  return (
    <div className="px-4 sm:px-5 py-3 border-t border-gray-100 bg-gray-50">
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-2">
        {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
      </p>
      {attachments.some(a => a.mimeType?.startsWith('image/') && (a.attachmentId || a.fileUrl || a.mediaId || a.localPath)) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, i) => {
            if (!att.mimeType?.startsWith('image/') || !(att.attachmentId || att.fileUrl || att.mediaId || att.localPath)) return null;
            return (
              <div key={i} className="relative bg-gray-100 animate-pulse rounded-lg min-h-[80px] min-w-[80px]">
                <img
                  src={getPreviewUrl(i)}
                  alt={att.filename}
                  className="max-h-[200px] rounded-lg cursor-pointer border border-gray-200 relative z-[1]"
                  onClick={() => window.open(getPreviewUrl(i), '_blank')}
                  loading="lazy"
                  onLoad={(e) => { e.target.parentElement.classList.remove('animate-pulse', 'bg-gray-100'); e.target.parentElement.style.minHeight = ''; e.target.parentElement.style.minWidth = ''; }}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments.map((att, i) => (
          <div
            key={i}
            onClick={() => handleDownload(att, i)}
            className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 hover:border-[#1787FE] hover:bg-blue-50 transition-all cursor-pointer group"
          >
            <div className={`w-8 h-8 rounded flex items-center justify-center ${
              att.mimeType?.startsWith('image/') ? 'bg-blue-100'
              : att.mimeType?.includes('pdf') ? 'bg-red-100'
              : 'bg-gray-100'
            }`}>
              {att.mimeType?.startsWith('image/') ? <ImageIcon size={16} className="text-blue-600" />
              : att.mimeType?.includes('pdf') ? <FileText size={16} className="text-red-600" />
              : att.mimeType?.startsWith('audio/') ? <Music size={16} className="text-purple-600" />
              : att.mimeType?.startsWith('video/') ? <Play size={16} className="text-orange-600" />
              : <FileText size={16} className="text-gray-500" />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{att.filename}</p>
              {formatFileSize(att.size) && <p className="text-[10px] text-gray-500">{formatFileSize(att.size)}</p>}
            </div>
            <Download size={14} className="text-gray-400 group-hover:text-[#1787FE] ml-1 transition-colors" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL REPLY BOX
// ═══════════════════════════════════════════════════════════════════

const EmailReplyBox = forwardRef(function EmailReplyBox(
  { showReplyBox, replyingTo, newMessage, setNewMessage, handleSend, sending, attachments, onAttachClick, removeAttachment, uploadProgress, onOpenReply, onClose, onAiRespond, aiLoading, aiSuggestion, aiError, onAiUse, onAiDismiss },
  ref
) {
  const hasContent = newMessage.trim() || attachments.length > 0;

  return (
    <div ref={ref} className="border-t border-gray-100 bg-white px-4 sm:px-6 py-3 space-y-2">

      {/* AI Suggestion Box — shown when AI generates a reply */}
      {(aiSuggestion || aiLoading || aiError) && (
        <div className="rounded-xl border-2 border-dashed border-[#1787FE]/40 bg-blue-50/60 px-4 py-3 relative">
          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Sparkles size={14} className="text-[#1787FE] animate-pulse" />
              Generating AI reply...
            </div>
          )}
          {aiError && <div className="text-sm text-red-500">{aiError}</div>}
          {aiSuggestion && (
            <>
              <p className="text-sm text-gray-800 leading-relaxed pr-24">{aiSuggestion}</p>
              <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(aiSuggestion)}
                  className="px-3 py-1.5 text-xs font-semibold border border-gray-300 bg-white rounded-lg hover:bg-gray-50 transition whitespace-nowrap"
                >
                  Copy Text
                </button>
                <button
                  type="button"
                  onClick={() => onAiUse(aiSuggestion)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1787FE] text-white rounded-lg hover:bg-[#1377e0] transition whitespace-nowrap"
                >
                  Use Reply <Send size={11} />
                </button>
              </div>
              <button
                type="button"
                onClick={onAiDismiss}
                className="absolute bottom-2 right-2 text-gray-300 hover:text-gray-500 transition"
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap px-1">
          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded-lg border border-gray-200 text-xs">
              {att.preview
                ? <img src={att.preview} alt={att.name} className="w-8 h-8 rounded object-cover" />
                : <FileText size={16} className="text-gray-400" />}
              <div className="min-w-0">
                <p className="truncate max-w-[100px] font-medium text-gray-700">{att.name}</p>
                {formatFileSize(att.size) && <p className="text-[10px] text-gray-500">{formatFileSize(att.size)}</p>}
              </div>
              <button type="button" onClick={() => removeAttachment(att.id)} className="text-gray-400 hover:text-red-500 transition ml-1">
                <X size={14} />
              </button>
            </div>
          ))}
          {uploadProgress !== null && uploadProgress < 100 && (
            <div className="w-full mt-1">
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-[#1787FE] transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">{uploadProgress}% uploaded</p>
            </div>
          )}
        </div>
      )}

      {/* Composer bar — always visible, matches chat design */}
      <form onSubmit={handleSend} className="flex items-center gap-2">
        {/* AI Respond pill */}
        <button
          type="button"
          onClick={onAiRespond}
          disabled={aiLoading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#1787FE] hover:bg-[#1377e0] rounded-full transition whitespace-nowrap disabled:opacity-50 flex-shrink-0"
        >
          <Sparkles size={14} className={aiLoading ? 'animate-pulse' : ''} />
          AI Respond
        </button>

        {/* Input */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
            onClick={() => { if (!showReplyBox) onOpenReply(); }}
            placeholder="Write message"
            className="w-full px-4 py-2.5 bg-white border border-transparent rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:border-[#1787FE] focus:ring-1 focus:ring-[#1787FE] outline-none transition"
          />
        </div>

        {/* Mic */}
        <button type="button" className="p-2 text-gray-400 hover:text-gray-700 transition flex-shrink-0" title="Voice">
          <Mic size={18} />
        </button>

        {/* Image */}
        <button type="button" onClick={onAttachClick} className="p-2 text-gray-400 hover:text-gray-700 transition flex-shrink-0" title="Attach image">
          <ImageIcon size={18} />
        </button>

        {/* Paperclip */}
        <button type="button" onClick={onAttachClick} className="p-2 text-gray-400 hover:text-gray-700 transition flex-shrink-0" title="Attach file">
          <Paperclip size={18} />
        </button>

        {/* Send */}
        <button
          type="submit"
          disabled={!hasContent || sending}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#1787FE] hover:bg-[#1377e0] text-white text-sm font-semibold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          {sending
            ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <><Send size={14} /> Send</>}
        </button>
      </form>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// ATTACHMENT PREVIEW BAR
// ═══════════════════════════════════════════════════════════════════

function AttachmentPreview({ attachments, onRemove, uploadProgress }) {
  return (
    <div className="px-4 sm:px-6 py-2 bg-white border-t border-gray-100">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {attachments.map((att) => (
          <div key={att.id} className="relative flex-shrink-0 group">
            {att.preview ? (
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
                <img src={att.preview} alt={att.name} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-lg border border-gray-200 bg-gray-50 flex flex-col items-center justify-center px-1">
                <FileText size={18} className="text-gray-400 mb-0.5" />
                <span className="text-[9px] text-gray-500 truncate w-full text-center">{att.name.split('.').pop()}</span>
              </div>
            )}
            <button
              onClick={() => onRemove(att.id)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
            <p className="text-[9px] text-gray-500 truncate w-16 mt-0.5 text-center">{att.name}</p>
          </div>
        ))}
      </div>
      {uploadProgress !== null && uploadProgress < 100 && (
        <div className="mt-1">
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-[#1787FE] transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MESSAGE ATTACHMENTS (inline in chat bubbles)
// ═══════════════════════════════════════════════════════════════════

const MessageAttachments = memo(function MessageAttachments({ attachments, messageId, isOutbound }) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;

  const handleDownload = async (att, index) => {
    if (!messageId) return;
    try {
      const response = await api.get(`/api/messages/${messageId}/attachments/${index}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.filename || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const getPreviewUrl = (index) => {
    if (!messageId) return null;
    const token = localStorage.getItem('token');
    const base = api.defaults.baseURL || '';
    return `${base}/api/messages/${messageId}/attachments/${index}/preview?token=${encodeURIComponent(token)}`;
  };

  return (
    <div className="mt-2 space-y-2">
      {attachments.map((att, i) => {
        const mime = att.mimeType || '';
        const isImage = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');
        const isAudio = mime.startsWith('audio/');
        const hasSource = att.mediaId || att.fileUrl || att.attachmentId || att.localPath || att.s3Key;
        const previewUrl = hasSource ? getPreviewUrl(i) : null;

        if (isImage) {
          // Always show image-only preview; never fall through to the filename card.
          if (!previewUrl) return null;
          return (
            <div key={i} className="relative rounded-lg overflow-hidden max-w-[280px] group cursor-pointer"
              onClick={() => window.open(previewUrl, '_blank')}
            >
              <div className="relative bg-white/5 animate-pulse rounded-lg min-h-[100px]">
                <img
                  src={previewUrl}
                  alt={att.filename || 'Image'}
                  className="w-full max-h-[300px] object-cover rounded-lg relative z-[1]"
                  loading="lazy"
                  onLoad={(e) => { e.target.parentElement.classList.remove('animate-pulse', 'bg-white/5'); e.target.parentElement.style.minHeight = ''; }}
                />
              </div>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors z-[2] rounded-lg flex items-end justify-end px-2 py-1.5">
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(att, i); }}
                  className="p-1.5 rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                  title="Download"
                >
                  <Download size={14} />
                </button>
              </div>
            </div>
          );
        }

        if (isVideo && previewUrl) {
          return (
            <div key={i} className="relative rounded-lg overflow-hidden max-w-[280px] group">
              <video src={previewUrl} controls preload="metadata" className="w-full max-h-[300px] rounded-lg" />
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-[10px] text-gray-500 truncate">{att.filename}</span>
                <button onClick={() => handleDownload(att, i)} className="p-1 rounded hover:bg-white/10 transition text-gray-500" title="Download"><Download size={12} /></button>
              </div>
            </div>
          );
        }

        if (isAudio && previewUrl) {
          return (
            <div key={i} className="flex flex-col gap-1 max-w-[280px]">
              <audio src={previewUrl} controls preload="metadata" className="w-full h-10" />
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-gray-500 truncate">{att.filename}</span>
                <button onClick={() => handleDownload(att, i)} className="p-1 rounded hover:bg-white/10 transition text-gray-500" title="Download"><Download size={12} /></button>
              </div>
            </div>
          );
        }

        return (
          <div
            key={i}
            className="flex items-center gap-2.5 px-3 py-2.5 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition max-w-[280px]"
            onClick={() => hasSource && handleDownload(att, i)}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              mime.includes('pdf') ? 'bg-red-500/10 text-red-400'
              : mime.includes('word') || mime.includes('document') ? 'bg-blue-500/10 text-blue-400'
              : mime.includes('sheet') || mime.includes('excel') ? 'bg-green-500/10 text-green-400'
              : 'bg-white/5 text-gray-500'
            }`}>
              {mime.includes('pdf') ? <FileText size={20} /> :
               isImage ? <ImageIcon size={20} /> :
               isVideo ? <Play size={20} /> :
               isAudio ? <Music size={20} /> :
               <FileIcon size={20} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-300 truncate">{att.filename || 'Unnamed file'}</p>
              {formatFileSize(att.size) && <p className="text-[10px] text-gray-500">{formatFileSize(att.size)}</p>}
            </div>
            {hasSource && <Download size={14} className="text-gray-500 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// SKELETON LOADING COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function SkeletonPulse({ className }) {
  return <div className={`skeleton-shimmer rounded ${className}`} />;
}

function InboxListSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-white/5">
          <div className="w-4 h-4 rounded bg-white/5 animate-pulse flex-shrink-0" />
          <div className="w-4 h-4 rounded bg-white/5 animate-pulse flex-shrink-0" />
          <SkeletonPulse className={`h-3.5 w-28 !bg-white/5 flex-shrink-0`} />
          <SkeletonPulse className="h-5 w-16 !bg-white/5 rounded-md flex-shrink-0" />
          <SkeletonPulse className={`h-3.5 flex-1 !bg-white/5`} />
          <SkeletonPulse className="h-3 w-14 !bg-white/5 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton({ dark }) {
  const bgClass = dark ? '!bg-white/5' : '!bg-gray-200/60';
  const innerBgClass = dark ? '!bg-white/10' : '!bg-gray-300/50';

  const bubbles = [
    { align: 'start', w: 'w-48', lines: 1 },
    { align: 'start', w: 'w-56', lines: 2 },
    { align: 'end', w: 'w-40', lines: 1 },
    { align: 'start', w: 'w-52', lines: 1 },
    { align: 'end', w: 'w-60', lines: 3 },
    { align: 'start', w: 'w-44', lines: 1 },
    { align: 'end', w: 'w-36', lines: 1 },
  ];

  return (
    <div className="flex-1 overflow-hidden px-3 sm:px-6 py-4 space-y-3">
      <div className="flex justify-center my-2">
        <SkeletonPulse className={`h-5 w-20 rounded-full ${bgClass}`} />
      </div>
      {bubbles.map((b, i) => (
        <div key={i} className={`flex ${b.align === 'end' ? 'justify-end' : 'justify-start'}`}>
          <div className={`${b.w} max-w-[65%] rounded-2xl ${b.align === 'start' ? 'rounded-tl-md' : 'rounded-tr-md'} ${bgClass} animate-pulse p-3 space-y-1.5`}>
            {Array.from({ length: b.lines }).map((_, j) => (
              <SkeletonPulse key={j} className={`h-3 ${innerBgClass} rounded ${j === b.lines - 1 && b.lines > 1 ? 'w-3/4' : 'w-full'}`} />
            ))}
            <SkeletonPulse className={`h-2 w-12 ${innerBgClass} rounded mt-1 ${b.align === 'end' ? 'ml-auto' : ''}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PLATFORM HELPERS
// ═══════════════════════════════════════════════════════════════════

function getPlatformTheme(platform) {
  // All conversations now use the dark theme
  return { chatBg: '#0c1a2e', headerBg: 'bg-[#0f1d33]', headerBorder: 'border-white/10', dateBadgeBg: 'bg-white/10', dateBadgeText: 'text-gray-400' };
}

function getPlatformBadgeStyle(platform) {
  switch (platform) {
    case 'instagram': return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
    case 'facebook': return 'bg-blue-100 text-blue-700 border border-blue-200';
    case 'gmail': return 'bg-pink-100 text-pink-700 border border-pink-200';
    case 'whatsapp': return 'bg-green-100 text-green-700 border border-green-200';
    case 'linkedin': return 'bg-rose-100 text-rose-700 border border-rose-200';
    default: return 'bg-gray-100 text-gray-600 border border-gray-200';
  }
}

function getPlatformLabel(platform) {
  switch (platform) {
    case 'instagram': return 'Instagram';
    case 'facebook': return 'Facebook';
    case 'gmail': return 'Email';
    case 'whatsapp': return 'WhatsApp';
    case 'linkedin': return 'Linkedin';
    default: return platform || 'Unknown';
  }
}

// Generate a deterministic color from a name so every sender always gets the same color.
const AVATAR_COLORS = [
  'bg-red-100 text-red-600', 'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700', 'bg-purple-100 text-purple-600',
  'bg-orange-100 text-orange-600', 'bg-teal-100 text-teal-600',
  'bg-pink-100 text-pink-600', 'bg-indigo-100 text-indigo-600',
];
function getNameAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getPlatformAvatarStyle(platform, name) {
  if (name) return getNameAvatarColor(name);
  switch (platform) {
    case 'gmail': return 'bg-red-100 text-red-600';
    case 'whatsapp': return 'bg-green-100 text-green-700';
    case 'instagram': return 'bg-pink-100 text-pink-600';
    case 'facebook': return 'bg-blue-100 text-blue-600';
    default: return 'bg-gray-100 text-gray-500';
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONTACT AVATAR — shows profile photo or initial letter fallback
// ═══════════════════════════════════════════════════════════════════

function ContactAvatar({ name, avatarUrl, platform, size = 8, className = '' }) {
  const [imgError, setImgError] = useState(false);
  const initials = (name || '?').trim().charAt(0).toUpperCase();
  const styleClass = getPlatformAvatarStyle(platform, name);
  const sizeMap = { 8: 'w-8 h-8 text-xs', 10: 'w-10 h-10 text-sm' };
  const sizeClass = sizeMap[size] || `w-${size} h-${size} text-xs`;

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name || 'Avatar'}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0 ${className}`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className={`${sizeClass} rounded-full flex items-center justify-center flex-shrink-0 font-semibold ${styleClass} ${className}`}>
      {initials}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function getContactDisplayName(contact, platform) {
  if (!contact) return 'Unknown';
  switch (platform) {
    case 'instagram':
      return contact.username || contact.name || `IG User ${(contact.platformUserId || '').slice(-4)}`;
    case 'facebook':
      return contact.name || `FB User ${(contact.platformUserId || '').slice(-4)}`;
    case 'whatsapp':
      return contact.name || contact.platformUserId || 'Unknown';
    case 'gmail': {
      const name = contact.name || '';
      const email = contact.platformUserId || '';
      if (name && email && name !== email) return name;
      return name || email || 'Unknown';
    }
    default:
      return contact.name || contact.username || contact.platformUserId || 'Unknown';
  }
}

function formatFileSize(bytes) {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTimeShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000 && date.getDate() === now.getDate()) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function isSameDay(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return false;
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

// ═══════════════════════════════════════════════════════════════════
// IMAGE COMPRESSION
// ═══════════════════════════════════════════════════════════════════

function compressImage(file, maxDimension = 1200, quality = 0.8) {
  if (file.type === 'image/gif') return Promise.resolve(file);

  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        URL.revokeObjectURL(url);
        resolve(file);
      }
    }, 10000);

    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file);
          const compressed = new File([blob], file.name, { type: outputType, lastModified: Date.now() });
          resolve(compressed);
        },
        outputType,
        quality
      );
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}
