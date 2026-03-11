import { useState, useEffect, useRef, useCallback, useMemo, forwardRef, memo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import {
  Send, Search, MessageSquare, Mail, ArrowLeft, Paperclip,
  Smile, X, FileText, Image, Reply, ChevronDown,
  ChevronUp, Download, UploadCloud, Play, Music, File, AlertCircle, RefreshCw,
} from 'lucide-react';
import PlatformBadge, { PlatformIcon } from '../components/PlatformBadge.jsx';

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
  const [fileError, setFileError] = useState(null); // { message, details }
  const fileErrorTimerRef = useRef(null);
  const [attachments, setAttachments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // for email reply context
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState(new Set());
  const [uploadProgress, setUploadProgress] = useState(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Deferred skeletons — only show after 200ms to avoid flash on fast loads
  const showConversationSkeleton = useDeferredLoading(loadingConversations, 150);
  const showMessageSkeleton = useDeferredLoading(loadingMessages, 200);

  const messagesEndRef = useRef(null);
  const replyBoxRef = useRef(null);
  const pollingRef = useRef(null);
  const igPollingRef = useRef(null);
  const conversationIdRef = useRef(conversationId);
  const fileInputRef = useRef(null);

  // ── Deduplication: track known message IDs to prevent duplicates ──
  const knownMessageIds = useRef(new Set());
  // ── Message cache: store messages per conversation to avoid refetch ──
  const messageCache = useRef(new Map());

  // Fetch conversations + start polling
  useEffect(() => {
    let cancelled = false;

    const initializeInbox = async () => {
      // 1. Fetch conversations from DB (retry up to 3 times for Render cold starts)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await api.get('/api/conversations');
          if (!cancelled) {
            setConversations(res.data.conversations);
            setLoadingConversations(false);
          }
          break; // success
        } catch (err) {
          console.error(`fetchConversations attempt ${attempt + 1} failed:`, err.message);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          else if (!cancelled) setLoadingConversations(false); // give up, show whatever we have
        }
      }

      // 2. Sync Gmail & Instagram (always refresh conversations after sync)
      try {
        await api.get('/api/messages/gmail/sync');
      } catch { /* silent */ }
      try {
        await api.get('/api/messages/instagram/sync');
      } catch { /* silent */ }

      // 3. Always refresh conversations after sync (messages may have been created)
      if (!cancelled) {
        try {
          const res = await api.get('/api/conversations');
          setConversations(res.data.conversations);
        } catch { /* silent — already loaded from step 1 */ }
      }
    };

    initializeInbox();

    // Set up polling intervals (sync + refresh conversations)
    pollingRef.current = setInterval(async () => {
      try {
        const res = await api.get('/api/messages/gmail/sync');
        if ((res.data?.newMessages || 0) > 0) {
          fetchConversations();
          const activeId = conversationIdRef.current;
          if (activeId) fetchMessages(activeId);
        }
      } catch { /* silent */ }
    }, 60000);

    igPollingRef.current = setInterval(async () => {
      try {
        const res = await api.get('/api/messages/instagram/sync');
        if ((res.data?.newMessages || 0) > 0) {
          fetchConversations();
          const activeId = conversationIdRef.current;
          if (activeId) fetchMessages(activeId);
        }
      } catch { /* silent */ }
    }, 60000);

    return () => {
      cancelled = true;
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (igPollingRef.current) clearInterval(igPollingRef.current);
    };
  }, []);

  // Listen for real-time events — use refs to avoid stale closures
  // IMPORTANT: Polls for socket availability (handles race with DashboardLayout connectSocket)
  // and re-registers listeners on reconnection to catch missed messages.
  useEffect(() => {
    let cleanupFn = null;
    let pollTimer = null;

    const setupSocketListeners = () => {
      const socket = getSocket();
      if (!socket) return false;

      // Clean up previous listeners if any
      if (cleanupFn) cleanupFn();

      const handleReconnect = () => {
        // After reconnection, fetch any messages missed while offline
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId, true);
      };

      socket.on('connect', handleReconnect);

    const handleNewMessage = (data) => {
      const msgId = data.message?.id;
      const convId = data.conversationId;

      // ── DEDUP: skip if we already have this message ──
      if (msgId && knownMessageIds.current.has(msgId)) {
        return;
      }
      if (msgId) knownMessageIds.current.add(msgId);

      // Update conversation sidebar (always, regardless of active conversation)
      // NOTE: Do NOT increment unreadCount here — the backend is the single source of truth.
      // The conversation_update event will deliver the correct count from the DB.
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === convId);
        if (!exists) { fetchConversations(); return prev; }
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

      // ── CHANNEL ISOLATION: only add to messages if this IS the active conversation ──
      if (convId === conversationIdRef.current) {
        setMessages((prev) => {
          // Double-check dedup against current state (handles race with optimistic add)
          if (msgId && prev.some((m) => m.id === msgId)) return prev;
          // Replace optimistic placeholder if it exists (match by content + direction)
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

        // Update message cache for this conversation
        messageCache.current.set(convId, null); // invalidate so next switch refetches

        // Message arrived while user is viewing this conversation — mark as read in DB
        // so unreadCount doesn't accumulate for "seen" messages
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
                  // If this conversation is currently active/open, force unread to 0
                  unreadCount: data.conversationId === activeId ? 0 : (data.unreadCount ?? c.unreadCount),
                }
              : c
          )
          .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
      );
    };

      socket.on('new_message', handleNewMessage);
      socket.on('conversation_update', handleConversationUpdate);

      cleanupFn = () => {
        socket.off('connect', handleReconnect);
        socket.off('new_message', handleNewMessage);
        socket.off('conversation_update', handleConversationUpdate);
      };
      return true; // successfully set up
    };

    // Try immediately, then poll every 500ms until socket is available
    if (!setupSocketListeners()) {
      pollTimer = setInterval(() => {
        if (setupSocketListeners()) clearInterval(pollTimer);
      }, 500);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupFn) cleanupFn();
    };
  }, []); // ← empty deps: handler uses refs, not closure state

  useEffect(() => {
    const handleInboxRefresh = () => {
      fetchConversations();
      const activeId = conversationIdRef.current;
      if (activeId) fetchMessages(activeId, true); // force refresh
    };
    window.addEventListener('auradesk:refresh-inbox', handleInboxRefresh);
    return () => window.removeEventListener('auradesk:refresh-inbox', handleInboxRefresh);
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    if (conversationId) {
      // Restore from cache instantly, then fall back to sessionStorage, then fetch from API
      const cached = messageCache.current.get(conversationId);
      if (cached) {
        setMessages(cached.messages);
        setActiveConversation(cached.activeConversation);
        cached.messages.forEach((m) => m.id && knownMessageIds.current.add(m.id));
      } else {
        // On page refresh, messageCache is empty — restore from sessionStorage for instant display
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
      setAttachments([]);
      setShowReplyBox(false);
      setReplyingTo(null);
      setCollapsedMessages(new Set());
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
    } else {
      setMessages([]);
      setActiveConversation(null);
    }
  }, [conversationId]);

  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    // Only auto-scroll when messages actually change count (new message added)
    if (messages.length !== prevMsgCountRef.current || showReplyBox) {
      prevMsgCountRef.current = messages.length;
      if (showReplyBox && replyBoxRef.current) {
        replyBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages, showReplyBox]);

  // ── Persist conversations to sessionStorage on change ──
  useEffect(() => {
    if (conversations.length > 0) {
      sessionSet(SESSION_KEYS.CONVERSATIONS, conversations);
    }
  }, [conversations]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/api/conversations');
      setConversations(res.data.conversations);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, []);

  const fetchMessages = useCallback(async (convId, forceRefresh = false) => {
    try {
      // Skip if we already have fresh cached data (unless forced)
      if (!forceRefresh && messageCache.current.get(convId)?.fresh) {
        return;
      }
      setLoadingMessages(true);
      const [msgRes, convRes] = await Promise.all([
        api.get(`/api/messages/${convId}`),
        api.get(`/api/conversations/${convId}`),
      ]);
      const msgs = msgRes.data.messages;
      // Rebuild known IDs for this conversation
      msgs.forEach((m) => m.id && knownMessageIds.current.add(m.id));
      // Only update if this is still the active conversation (prevents stale writes)
      if (conversationIdRef.current === convId) {
        setMessages(msgs);
        setActiveConversation(convRes.data.conversation);
      }
      // Cache for quick restore on re-visit
      messageCache.current.set(convId, {
        messages: msgs,
        activeConversation: convRes.data.conversation,
        fresh: true,
      });
      // Mark cache as stale after 30s
      setTimeout(() => {
        const entry = messageCache.current.get(convId);
        if (entry) entry.fresh = false;
      }, 30000);
      // Persist to sessionStorage for page refresh recovery
      sessionSet(SESSION_KEYS.MESSAGES + convId, msgs.slice(-50)); // last 50 msgs
      sessionSet(SESSION_KEYS.ACTIVE_CONVERSATION, convRes.data.conversation);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // ── Ref for activeConversation to avoid stale closures in handleSend ──
  const activeConversationRef = useRef(activeConversation);
  useEffect(() => { activeConversationRef.current = activeConversation; }, [activeConversation]);

  const handleSend = useCallback(async (e, retryCount = 0) => {
    if (e?.preventDefault) e.preventDefault();
    const activeId = conversationIdRef.current;
    if ((!newMessage.trim() && attachments.length === 0) || !activeId || sending) return;

    const trimmedMsg = newMessage.trim();
    const currentAttachments = [...attachments];
    const isEmail = activeConversationRef.current?.connectedAccount?.platform === 'gmail';

    // ── OPTIMISTIC UI: show message instantly with "sending" status ──
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

    // Add optimistic message immediately
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
            timeout: 120000, // 2 minutes for large uploads
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
        if (!isEmail) {
          setShowReplyBox(false);
          setReplyingTo(null);
        }
      } catch (err) {
        // Retry on network/timeout errors (not on 4xx client errors)
        const isRetryable = !err.response || err.response.status >= 500 || err.code === 'ECONNABORTED';
        if (isRetryable && attempt < MAX_RETRIES) {
          console.warn(`Send failed (attempt ${attempt + 1}), retrying...`, err.message);
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
      setUploadProgress(null);
      // Mark optimistic message as failed instead of removing it
      setMessages((prev) =>
        prev.map((m) => m.id === optimisticId ? { ...m, status: 'failed', _sendError: errorMsg } : m)
      );
    } finally {
      setSending(false);
    }
  }, [newMessage, attachments, sending, replyingTo]);

  const showFileError = useCallback((message, details) => {
    clearTimeout(fileErrorTimerRef.current);
    setFileError({ message, details });
    fileErrorTimerRef.current = setTimeout(() => setFileError(null), 5000);
  }, []);

  // Clean up file error timer on unmount
  useEffect(() => () => clearTimeout(fileErrorTimerRef.current), []);

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
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
    const SUPPORTED_FORMATS = 'JPG, PNG, GIF, WebP, PDF, DOC, DOCX, XLS, XLSX, TXT, CSV, MP3, OGG, WAV, MP4, WebM';

    const newAttachments = [];
    for (const file of Array.from(files)) {
      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        showFileError(
          `"${file.name}" is not a supported file type`,
          `Supported formats: ${SUPPORTED_FORMATS}`
        );
        continue;
      }
      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        showFileError(
          `"${file.name}" exceeds the 25 MB size limit (${formatFileSize(file.size)})`,
          `Maximum file size: 25 MB. Supported formats: ${SUPPORTED_FORMATS}`
        );
        continue;
      }

      let processedFile = file;
      let preview = null;

      // ── Compress images > 500KB before attaching ──
      if (file.type.startsWith('image/') && file.size > 512000) {
        try {
          processedFile = await compressImage(file, 1200, 0.8);
        } catch { /* Use original if compression fails */ }
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
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

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

  const openReplyBox = (msg) => {
    setReplyingTo(msg);
    setShowReplyBox(true);
    setNewMessage('');
    setAttachments([]);
  };

  const platform = activeConversation?.connectedAccount?.platform;
  const isEmailPlatform = platform === 'gmail';
  const emailSubject = useMemo(
    () => isEmailPlatform ? (messages.find((m) => m.subject)?.subject || '(No Subject)') : null,
    [isEmailPlatform, messages]
  );

  // ── Memoize filtered conversations to avoid recomputing on every render ──
  const filteredConversations = useMemo(() => {
    if (!search) return conversations;
    const term = search.toLowerCase();
    return conversations.filter((c) => {
      const contactName = c.contact?.name || c.contact?.username || '';
      return contactName.toLowerCase().includes(term);
    });
  }, [conversations, search]);

  const handleSelectConversation = useCallback((convId) => navigate(`/inbox/${convId}`), [navigate]);
  const handleBackToList = useCallback(() => navigate('/inbox'), [navigate]);
  const platformTheme = useMemo(() => getPlatformTheme(platform), [platform]);

  return (
    <div className="flex h-full">
      {/* ─── Conversation List ─── */}
      <div
        className={`bg-white border-r border-gray-200 flex flex-col w-full md:w-80 lg:w-96 flex-shrink-0 ${conversationId ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">Smart Inbox</h1>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-4 py-2.5 bg-gray-100 border border-transparent rounded-lg text-sm focus:bg-white focus:border-primary-300 focus:ring-1 focus:ring-primary-300 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {showConversationSkeleton && filteredConversations.length === 0 ? (
            <ConversationListSkeleton />
          ) : filteredConversations.length === 0 && !loadingConversations ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6">
              <MessageSquare size={40} className="mb-3" />
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-xs mt-1">Connect an account to start</p>
            </div>
          ) : filteredConversations.length === 0 ? null : (
            filteredConversations.map((conv) => {
              const lastMessage = conv.messages?.[0];
              const preview = lastMessage?.content
                ? lastMessage.content.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').slice(0, 80)
                : 'No messages';
              const convPlatform = conv.connectedAccount?.platform;

              return (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 border-b border-gray-100 transition text-left ${
                    conv.id === conversationId ? 'bg-primary-50 border-l-[3px] border-l-primary-500' : ''
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center ${getPlatformAvatarStyle(convPlatform)}`}>
                      <PlatformIcon platform={convPlatform} size={20} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm truncate ${conv.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {getContactDisplayName(conv.contact, convPlatform)}
                      </span>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{formatTime(conv.lastMessageAt)}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className={`text-xs truncate ${conv.unreadCount > 0 ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                        {lastMessage?.direction === 'outbound' ? 'You: ' : ''}{preview}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="ml-2 bg-primary-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ─── Chat Area ─── */}
      <div
        className={`flex-1 flex flex-col ${conversationId ? 'flex' : 'hidden md:flex'}`}
        style={{ backgroundColor: platformTheme.chatBg }}
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

        {conversationId && !activeConversation ? (
          /* Chat loading skeleton — conversationId is set but data hasn't arrived yet */
          <>
            <div className="border-b px-4 sm:px-6 py-3 flex items-center gap-3 bg-white border-gray-200">
              <button onClick={handleBackToList} className="md:hidden text-gray-600 hover:text-gray-900 transition flex-shrink-0">
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
            {/* Chat header */}
            <div className={`border-b px-4 sm:px-6 py-3 flex items-center gap-3 ${platformTheme.headerBg} ${platformTheme.headerBorder}`}>
              <button onClick={handleBackToList} className="md:hidden text-gray-600 hover:text-gray-900 transition flex-shrink-0">
                <ArrowLeft size={20} />
              </button>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getPlatformAvatarStyle(platform)}`}>
                <PlatformIcon platform={platform} size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-gray-900 truncate text-sm sm:text-base">
                  {getContactDisplayName(activeConversation.contact, platform)}
                </h2>
                <div className="flex items-center gap-2">
                  <PlatformBadge platform={platform} size="xs" />
                  {isEmailPlatform && emailSubject && (
                    <span className="text-xs text-gray-400 truncate hidden sm:inline">&mdash; {emailSubject}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Messages area */}
            {showMessageSkeleton && messages.length === 0 ? (
              <MessagesSkeleton />
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
              <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3 animate-fade-in">
                {messages.map((msg, idx) => {
                  const isOutbound = msg.direction === 'outbound';
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const showDate = !prevMsg || !isSameDay(prevMsg.sentAt, msg.sentAt);
                  return (
                    <div key={msg.id || `msg-${idx}`}>
                      {showDate && (
                        <div className="flex items-center justify-center my-4">
                          <span className={`text-xs px-3 py-1 rounded-full ${platformTheme.dateBadgeBg} ${platformTheme.dateBadgeText}`}>
                            {formatDate(msg.sentAt)}
                          </span>
                        </div>
                      )}
                      {platform === 'whatsapp'
                        ? renderWhatsAppMessage(msg, isOutbound)
                        : platform === 'instagram'
                        ? renderInstagramMessage(msg, isOutbound)
                        : platform === 'facebook'
                        ? renderFacebookMessage(msg, isOutbound)
                        : renderDefaultMessage(msg, isOutbound)}
                      {msg.status === 'failed' && (
                        <div className="flex justify-end items-center gap-2 mt-1 px-2">
                          <AlertCircle size={12} className="text-red-500" />
                          <span className="text-[10px] text-red-500">Failed to send</span>
                          <button
                            onClick={() => {
                              // Remove failed message and restore content for retry
                              setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                              setNewMessage(msg.content || '');
                              setSendError('');
                            }}
                            className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-0.5"
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
              <div className="px-4 sm:px-6 py-2 bg-red-50 border-t border-red-200">
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
                    {fileError.details && (
                      <p className="text-xs text-red-200 mt-1 leading-snug">{fileError.details}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { clearTimeout(fileErrorTimerRef.current); setFileError(null); }}
                    className="flex-shrink-0 text-red-200 hover:text-white transition"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleFileSelect(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            {/* Email reply box OR chat composer */}
            {isEmailPlatform ? (
              <EmailReplyBox
                ref={replyBoxRef}
                showReplyBox={showReplyBox}
                replyingTo={replyingTo}
                newMessage={newMessage}
                setNewMessage={setNewMessage}
                handleSend={handleSend}
                sending={sending}
                attachments={attachments}
                onAttachClick={() => fileInputRef.current?.click()}
                removeAttachment={removeAttachment}
                uploadProgress={uploadProgress}
                onOpenReply={() => {
                  const lastMsg = messages[messages.length - 1];
                  openReplyBox(lastMsg || { subject: emailSubject });
                }}
                onClose={() => { setShowReplyBox(false); setReplyingTo(null); setAttachments([]); }}
              />
            ) : (
              <>
                {attachments.length > 0 && (
                  <AttachmentPreview attachments={attachments} onRemove={removeAttachment} uploadProgress={uploadProgress} />
                )}
                {renderComposer({
                  platform,
                  newMessage,
                  setNewMessage,
                  handleSend,
                  sending,
                  attachments,
                  onAttachClick: () => fileInputRef.current?.click(),
                  showEmojiPicker,
                  setShowEmojiPicker,
                })}
              </>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 px-6">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <MessageSquare size={36} className="text-gray-300" />
            </div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-600">Select a conversation</h2>
            <p className="text-sm mt-1 text-center">Choose a conversation from the list to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL THREAD VIEW — Gmail-like conversation view
// ═══════════════════════════════════════════════════════════════════

function EmailThreadView({ messages, emailSubject, collapsedMessages, toggleCollapsed, onReply, messagesEndRef }) {
  // Auto-collapse all messages except the last 2 for long threads
  const autoCollapsed = messages.length > 3;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Thread subject header */}
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 leading-tight">{emailSubject}</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Inbox</span>
            <span className="text-xs text-gray-400">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Email messages in chronological order */}
        <div className="space-y-0">
          {messages.map((msg, idx) => {
            const isOutbound = msg.direction === 'outbound';
            const isLast = idx === messages.length - 1;
            const isSecondLast = idx === messages.length - 2;
            // Auto-collapse older messages in long threads, except last 2
            const isCollapsed = autoCollapsed && !isLast && !isSecondLast
              ? !collapsedMessages.has(msg.id) // inverted: starts collapsed, click to expand
              : collapsedMessages.has(msg.id);

            return (
              <EmailMessageCard
                key={msg.id || `msg-${idx}`}
                msg={msg}
                isOutbound={isOutbound}
                isLast={isLast}
                isCollapsed={isCollapsed}
                onToggleCollapse={() => toggleCollapsed(msg.id)}
                onReply={() => onReply(msg)}
              />
            );
          })}
        </div>
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function EmailMessageCard({ msg, isOutbound, isLast, isCollapsed, onToggleCollapse, onReply }) {
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

  const senderInitial = (msg.sender || (isOutbound ? 'Y' : '?'))[0]?.toUpperCase();
  const senderName = isOutbound ? 'You' : (msg.sender || 'Unknown');
  const timestamp = msg.sentAt
    ? new Date(msg.sentAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const hasAttachments = msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0;

  return (
    <div className={`border border-gray-200 bg-white ${isLast ? 'rounded-xl' : 'rounded-t-xl border-b-0'} overflow-hidden`}>
      {/* Email header — always visible */}
      <div
        className="flex items-center gap-3 px-4 sm:px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggleCollapse}
      >
        {/* Avatar */}
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
          isOutbound ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'
        }`}>
          {senderInitial}
        </div>

        {/* Sender info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{senderName}</span>
            {isCollapsed && (
              <span className="text-xs text-gray-400 truncate hidden sm:inline">
                &mdash; {msg.content?.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').slice(0, 60) || '(empty)'}
              </span>
            )}
          </div>
          {!isCollapsed && (
            <p className="text-xs text-gray-400 truncate">to {isOutbound ? (msg.sender || 'recipient') : 'me'}</p>
          )}
        </div>

        {/* Timestamp and expand/collapse */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400 hidden sm:inline">{timestamp}</span>
          {isCollapsed ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
        </div>
      </div>

      {/* Email body — hidden when collapsed */}
      {!isCollapsed && (
        <>
          {/* Subject shown on first message or when different */}
          {msg.subject && (
            <div className="px-4 sm:px-5 pb-1">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Mail size={12} />
                <span className="truncate">{msg.subject}</span>
              </div>
            </div>
          )}

          {/* Timestamp on mobile */}
          <div className="px-4 sm:px-5 pb-2 sm:hidden">
            <span className="text-xs text-gray-400">{timestamp}</span>
          </div>

          {/* Email body content */}
          <div className="px-4 sm:px-5 py-4 border-t border-gray-50">
            {sanitizedHtml ? (
              <div
                className="email-html-content text-sm text-gray-800 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            ) : (
              <div className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                {msg.content}
              </div>
            )}
          </div>

          {/* Attachments */}
          {hasAttachments && (
            <EmailAttachments attachments={msg.attachments} messageId={msg.id} />
          )}

          {/* Reply/Forward footer */}
          {isLast && (
            <div className="px-4 sm:px-5 py-3 border-t border-gray-100 flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onReply(); }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 hover:border-gray-300 transition"
              >
                <Reply size={14} />
                Reply
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL ATTACHMENTS — with preview and download
// ═══════════════════════════════════════════════════════════════════

function EmailAttachments({ attachments, messageId }) {
  const handleDownload = async (att, index) => {
    if (!messageId) return;
    try {
      const response = await api.get(`/api/messages/${messageId}/attachments/${index}/download`, {
        responseType: 'blob',
      });
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
    <div className="px-4 sm:px-5 py-3 border-t border-gray-100 bg-gray-50/50">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">
        {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
      </p>
      {/* Inline image previews */}
      {attachments.some(a => a.mimeType?.startsWith('image/') && (a.attachmentId || a.fileUrl || a.mediaId)) && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, i) => {
            if (!att.mimeType?.startsWith('image/') || !(att.attachmentId || att.fileUrl || att.mediaId)) return null;
            return (
              <div key={i} className="relative bg-gray-200 animate-pulse rounded-lg min-h-[80px] min-w-[80px]">
                <img
                  src={getPreviewUrl(i)}
                  alt={att.filename}
                  className="max-h-[200px] rounded-lg cursor-pointer border border-gray-200 relative z-[1]"
                  onClick={() => window.open(getPreviewUrl(i), '_blank')}
                  loading="lazy"
                  onLoad={(e) => { e.target.parentElement.classList.remove('animate-pulse', 'bg-gray-200'); e.target.parentElement.style.minHeight = ''; e.target.parentElement.style.minWidth = ''; }}
                />
              </div>
            );
          })}
        </div>
      )}
      {/* File cards */}
      <div className="flex flex-wrap gap-2">
        {attachments.map((att, i) => (
          <div
            key={i}
            onClick={() => handleDownload(att, i)}
            className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer group"
          >
            <div className={`w-8 h-8 rounded flex items-center justify-center ${
              att.mimeType?.startsWith('image/') ? 'bg-blue-50'
              : att.mimeType?.includes('pdf') ? 'bg-red-50'
              : 'bg-gray-100'
            }`}>
              {att.mimeType?.startsWith('image/') ? (
                <Image size={16} className="text-blue-500" />
              ) : att.mimeType?.includes('pdf') ? (
                <FileText size={16} className="text-red-500" />
              ) : att.mimeType?.startsWith('audio/') ? (
                <Music size={16} className="text-purple-500" />
              ) : att.mimeType?.startsWith('video/') ? (
                <Play size={16} className="text-orange-500" />
              ) : (
                <FileText size={16} className="text-gray-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{att.filename}</p>
              {formatFileSize(att.size) && <p className="text-[10px] text-gray-400">{formatFileSize(att.size)}</p>}
            </div>
            <Download size={14} className="text-gray-300 group-hover:text-blue-500 ml-1 transition-colors" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMAIL REPLY BOX — Gmail-like reply composer
// ═══════════════════════════════════════════════════════════════════

const EmailReplyBox = forwardRef(function EmailReplyBox(
  { showReplyBox, replyingTo, newMessage, setNewMessage, handleSend, sending, attachments, onAttachClick, removeAttachment, uploadProgress, onOpenReply, onClose },
  ref
) {
  const hasContent = newMessage.trim() || attachments.length > 0;

  if (!showReplyBox) {
    return (
      <div className="border-t border-gray-200 bg-white px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={onOpenReply}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 hover:text-gray-700 transition w-full"
          >
            <Reply size={16} />
            Click here to reply...
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="border-t border-gray-200 bg-white px-4 sm:px-6 py-4">
      <div className="max-w-3xl mx-auto">
        <form onSubmit={handleSend}>
          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-blue-300 transition">
            {/* Reply header */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Reply size={13} />
                <span>Replying to {replyingTo?.sender || 'Unknown'}</span>
              </div>
              <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
                <X size={16} />
              </button>
            </div>

            {/* Textarea */}
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
              }}
              placeholder="Write your reply..."
              rows={4}
              className="w-full px-4 py-3 text-sm outline-none resize-none"
              autoFocus
            />

            {/* Attachment preview inside reply box */}
            {attachments.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50">
                <div className="flex gap-2 flex-wrap">
                  {attachments.map((att) => (
                    <div key={att.id} className="relative group flex items-center gap-2 px-2.5 py-1.5 bg-white rounded-lg border border-gray-200 text-xs">
                      {att.preview ? (
                        <img src={att.preview} alt={att.name} className="w-8 h-8 rounded object-cover" />
                      ) : (
                        <FileText size={16} className="text-gray-400" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate max-w-[100px] font-medium text-gray-700">{att.name}</p>
                        {formatFileSize(att.size) && <p className="text-[10px] text-gray-400">{formatFileSize(att.size)}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="text-gray-300 hover:text-red-500 transition ml-1"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {/* Upload progress */}
                {uploadProgress !== null && uploadProgress < 100 && (
                  <div className="mt-2">
                    <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">{uploadProgress}% uploaded</p>
                  </div>
                )}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onAttachClick}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition"
                  title="Attach files"
                >
                  <Paperclip size={16} />
                </button>
              </div>
              <button
                type="submit"
                disabled={!hasContent || sending}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sending ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Send
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// ATTACHMENT PREVIEW BAR (for non-email platforms)
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
            <p className="text-[9px] text-gray-400 truncate w-16 mt-0.5 text-center">{att.name}</p>
          </div>
        ))}
      </div>
      {uploadProgress !== null && uploadProgress < 100 && (
        <div className="mt-1">
          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SKELETON LOADING COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function SkeletonPulse({ className }) {
  return <div className={`skeleton-shimmer rounded ${className}`} />;
}

function ConversationListSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3.5 flex items-center gap-3 border-b border-gray-100">
          <SkeletonPulse className="w-11 h-11 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center justify-between">
              <SkeletonPulse className={`h-3.5 ${i % 3 === 0 ? 'w-28' : i % 3 === 1 ? 'w-36' : 'w-24'}`} />
              <SkeletonPulse className="h-3 w-10" />
            </div>
            <SkeletonPulse className={`h-3 ${i % 2 === 0 ? 'w-48' : 'w-40'}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessagesSkeleton() {
  const bubbles = [
    { align: 'start', w: 'w-48', h: 'h-10', lines: 1 },
    { align: 'start', w: 'w-56', h: 'h-16', lines: 2 },
    { align: 'end',   w: 'w-40', h: 'h-10', lines: 1 },
    { align: 'start', w: 'w-52', h: 'h-10', lines: 1 },
    { align: 'end',   w: 'w-60', h: 'h-20', lines: 3, hasImage: true },
    { align: 'start', w: 'w-44', h: 'h-10', lines: 1 },
    { align: 'end',   w: 'w-36', h: 'h-12', lines: 1 },
  ];

  return (
    <div className="flex-1 overflow-hidden px-3 sm:px-6 py-4 space-y-3">
      {/* Date badge skeleton */}
      <div className="flex justify-center my-2">
        <SkeletonPulse className="h-5 w-20 rounded-full" />
      </div>
      {bubbles.map((b, i) => (
        <div key={i} className={`flex ${b.align === 'end' ? 'justify-end' : 'justify-start'}`}>
          <div className={`${b.w} max-w-[65%] rounded-2xl ${b.align === 'start' ? 'rounded-tl-md' : 'rounded-tr-md'} bg-gray-200/60 animate-pulse p-3 space-y-1.5`}>
            {b.hasImage && <SkeletonPulse className="w-full h-28 rounded-lg !bg-gray-300/50" />}
            {Array.from({ length: b.lines }).map((_, j) => (
              <SkeletonPulse key={j} className={`h-3 !bg-gray-300/50 rounded ${j === b.lines - 1 && b.lines > 1 ? 'w-3/4' : 'w-full'}`} />
            ))}
            <SkeletonPulse className={`h-2 w-12 !bg-gray-300/40 rounded mt-1 ${b.align === 'end' ? 'ml-auto' : ''}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PLATFORM THEMES & STYLES
// ═══════════════════════════════════════════════════════════════════

function getPlatformTheme(platform) {
  switch (platform) {
    case 'whatsapp':
      return { chatBg: '#e5ddd5', headerBg: 'bg-[#075e54]', headerBorder: 'border-[#064e45]', dateBadgeBg: 'bg-white/80', dateBadgeText: 'text-gray-600' };
    case 'instagram':
      return { chatBg: '#fafafa', headerBg: 'bg-white', headerBorder: 'border-gray-200', dateBadgeBg: 'bg-gray-100', dateBadgeText: 'text-gray-400' };
    case 'facebook':
      return { chatBg: '#f0f2f5', headerBg: 'bg-white', headerBorder: 'border-gray-200', dateBadgeBg: 'bg-gray-200', dateBadgeText: 'text-gray-500' };
    case 'gmail':
      return { chatBg: '#f8f9fa', headerBg: 'bg-white', headerBorder: 'border-gray-200', dateBadgeBg: 'bg-gray-100', dateBadgeText: 'text-gray-400' };
    default:
      return { chatBg: '#f9fafb', headerBg: 'bg-white', headerBorder: 'border-gray-200', dateBadgeBg: 'bg-gray-100', dateBadgeText: 'text-gray-400' };
  }
}

function getPlatformAvatarStyle(platform) {
  switch (platform) {
    case 'gmail': return 'bg-red-100 text-red-500';
    case 'whatsapp': return 'bg-green-100 text-green-600';
    case 'instagram': return 'bg-pink-100 text-pink-500';
    case 'facebook': return 'bg-blue-100 text-blue-500';
    default: return 'bg-gray-200 text-gray-500';
  }
}

// ═══════════════════════════════════════════════════════════════════
// MESSAGE ATTACHMENT INDICATOR (for non-email platforms)
// ═══════════════════════════════════════════════════════════════════

const MessageAttachments = memo(function MessageAttachments({ attachments, messageId, isOutbound }) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;

  const handleDownload = async (att, index) => {
    if (!messageId) return;
    try {
      const response = await api.get(`/api/messages/${messageId}/attachments/${index}/download`, {
        responseType: 'blob',
      });
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
        const hasSource = att.mediaId || att.fileUrl || att.attachmentId;
        const previewUrl = hasSource ? getPreviewUrl(i) : null;

        if (isImage && previewUrl) {
          return (
            <div key={i} className="rounded-lg overflow-hidden max-w-[280px]">
              <div className="relative bg-gray-200/60 animate-pulse rounded-lg min-h-[100px]">
                <img
                  src={previewUrl}
                  alt={att.filename || 'Image'}
                  className="w-full max-h-[300px] object-cover rounded-lg cursor-pointer relative z-[1]"
                  onClick={() => window.open(previewUrl, '_blank')}
                  loading="lazy"
                  onLoad={(e) => { e.target.parentElement.classList.remove('animate-pulse', 'bg-gray-200/60'); e.target.parentElement.style.minHeight = ''; }}
                />
              </div>
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-[10px] text-gray-500 truncate">{att.filename}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(att, i); }}
                  className={`p-1 rounded hover:bg-black/10 transition ${isOutbound ? 'text-gray-600' : 'text-gray-400'}`}
                  title="Download"
                >
                  <Download size={12} />
                </button>
              </div>
            </div>
          );
        }

        if (isVideo && previewUrl) {
          return (
            <div key={i} className="rounded-lg overflow-hidden max-w-[280px]">
              <video
                src={previewUrl}
                controls
                preload="metadata"
                className="w-full max-h-[300px] rounded-lg"
              />
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-[10px] text-gray-500 truncate">{att.filename}</span>
                <button
                  onClick={() => handleDownload(att, i)}
                  className={`p-1 rounded hover:bg-black/10 transition ${isOutbound ? 'text-gray-600' : 'text-gray-400'}`}
                  title="Download"
                >
                  <Download size={12} />
                </button>
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
                <button
                  onClick={() => handleDownload(att, i)}
                  className={`p-1 rounded hover:bg-black/10 transition ${isOutbound ? 'text-gray-600' : 'text-gray-400'}`}
                  title="Download"
                >
                  <Download size={12} />
                </button>
              </div>
            </div>
          );
        }

        // File card for documents, PDFs, etc.
        return (
          <div
            key={i}
            className="flex items-center gap-2.5 px-3 py-2.5 bg-black/5 rounded-lg cursor-pointer hover:bg-black/10 transition max-w-[280px]"
            onClick={() => hasSource && handleDownload(att, i)}
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              mime.includes('pdf') ? 'bg-red-100 text-red-500'
              : mime.includes('word') || mime.includes('document') ? 'bg-blue-100 text-blue-500'
              : mime.includes('sheet') || mime.includes('excel') ? 'bg-green-100 text-green-500'
              : 'bg-gray-200 text-gray-500'
            }`}>
              {mime.includes('pdf') ? <FileText size={20} /> :
               isImage ? <Image size={20} /> :
               isVideo ? <Play size={20} /> :
               isAudio ? <Music size={20} /> :
               <File size={20} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{att.filename || 'Unnamed file'}</p>
              {formatFileSize(att.size) && <p className="text-[10px] text-gray-400">{formatFileSize(att.size)}</p>}
            </div>
            {hasSource && <Download size={14} className="text-gray-400 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// PLATFORM-SPECIFIC CHAT BUBBLES
// ═══════════════════════════════════════════════════════════════════

function renderWhatsAppMessage(msg, isOutbound) {
  const isSending = msg._optimistic || msg.status === 'sending';
  const isPlaceholder = msg.attachments?.length > 0 && msg.content && /^\[[\w\s.,_-]+\]$/.test(msg.content.trim());
  const textContent = isPlaceholder ? '' : (msg.content || '');
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-3 py-2 rounded-lg text-sm shadow-sm relative ${
        isOutbound ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none' : 'bg-white text-gray-900 rounded-tl-none'
      } ${isSending ? 'opacity-70' : ''}`}>
        {textContent && <p className="whitespace-pre-wrap break-words">{textContent}</p>}
        <MessageAttachments attachments={msg.attachments} messageId={msg.id} isOutbound={isOutbound} />
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-gray-500">{formatTime(msg.sentAt)}</span>
          {isOutbound && (
            <span className="text-[10px] text-blue-500">
              {isSending ? '○' : msg.status === 'delivered' || msg.status === 'read' ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function renderInstagramMessage(msg, isOutbound) {
  const isSending = msg._optimistic || msg.status === 'sending';
  const isPlaceholder = msg.attachments?.length > 0 && msg.content && /^\[[\w\s.,_-]+\]$/.test(msg.content.trim());
  const textContent = isPlaceholder ? '' : (msg.content || '');
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 text-sm ${
        isOutbound
          ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-white rounded-3xl rounded-br-md'
          : 'bg-gray-200 text-gray-900 rounded-3xl rounded-bl-md'
      } ${isSending ? 'opacity-70' : ''}`}>
        {textContent && <p className="whitespace-pre-wrap break-words">{textContent}</p>}
        <MessageAttachments attachments={msg.attachments} messageId={msg.id} isOutbound={isOutbound} />
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-white/70' : 'text-gray-400'}`}>
          {isSending ? 'Sending...' : formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

function renderFacebookMessage(msg, isOutbound) {
  const isSending = msg._optimistic || msg.status === 'sending';
  const isPlaceholder = msg.attachments?.length > 0 && msg.content && /^\[[\w\s.,_-]+\]$/.test(msg.content.trim());
  const textContent = isPlaceholder ? '' : (msg.content || '');
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-3xl text-sm ${
        isOutbound ? 'bg-[#0084ff] text-white rounded-br-md' : 'bg-gray-200 text-gray-900 rounded-bl-md'
      } ${isSending ? 'opacity-70' : ''}`}>
        {textContent && <p className="whitespace-pre-wrap break-words">{textContent}</p>}
        <MessageAttachments attachments={msg.attachments} messageId={msg.id} isOutbound={isOutbound} />
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-blue-200' : 'text-gray-400'}`}>
          {isSending ? 'Sending...' : formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

function renderDefaultMessage(msg, isOutbound) {
  const isSending = msg._optimistic || msg.status === 'sending';
  const isPlaceholder = msg.attachments?.length > 0 && msg.content && /^\[[\w\s.,_-]+\]$/.test(msg.content.trim());
  const textContent = isPlaceholder ? '' : (msg.content || '');
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-2xl text-sm ${
        isOutbound
          ? 'bg-primary-500 text-white rounded-br-md'
          : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
      } ${isSending ? 'opacity-70' : ''}`}>
        {textContent && <p className="whitespace-pre-wrap break-words">{textContent}</p>}
        <MessageAttachments attachments={msg.attachments} messageId={msg.id} isOutbound={isOutbound} />
        <p className={`text-xs mt-1 ${isOutbound ? 'text-primary-200' : 'text-gray-400'}`}>
          {isSending ? 'Sending...' : formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMOJI PICKER — lightweight inline picker for WhatsApp composer
// ═══════════════════════════════════════════════════════════════════

const EMOJI_CATEGORIES = {
  'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐'],
  'Gestures': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏'],
  'Hearts': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟'],
  'Objects': ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','⭐','🌟','💫','✨','🔥','💯','👑','💎','📱','💻','📷','🎵','🎶','☀️','🌈','🌸','🍕','🍔','☕','🍺','🥂'],
};

function EmojiPicker({ onSelect, onClose }) {
  const [activeCategory, setActiveCategory] = useState(Object.keys(EMOJI_CATEGORIES)[0]);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={pickerRef} className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-xl border border-gray-200 w-72 sm:w-80 z-20">
      <div className="flex border-b border-gray-100 px-2 pt-2 gap-1 overflow-x-auto">
        {Object.keys(EMOJI_CATEGORIES).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-t-lg whitespace-nowrap transition ${
              activeCategory === cat ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-0.5 p-2 max-h-48 overflow-y-auto">
        {EMOJI_CATEGORIES[activeCategory].map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            className="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 rounded transition"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NON-EMAIL COMPOSER
// ═══════════════════════════════════════════════════════════════════

function renderComposer({ platform, newMessage, setNewMessage, handleSend, sending, attachments, onAttachClick, showEmojiPicker, setShowEmojiPicker }) {
  const hasContent = newMessage.trim() || attachments.length > 0;

  const insertEmoji = (emoji) => {
    setNewMessage((prev) => prev + emoji);
  };

  if (platform === 'whatsapp') {
    return (
      <div className="relative">
        {showEmojiPicker && (
          <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmojiPicker(false)} />
        )}
        <form onSubmit={handleSend} className="bg-[#f0f0f0] px-3 sm:px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowEmojiPicker((p) => !p)} className={`transition p-1.5 ${showEmojiPicker ? 'text-[#075e54]' : 'text-gray-500 hover:text-gray-700'}`}><Smile size={22} /></button>
            <button type="button" onClick={onAttachClick} className="text-gray-500 hover:text-gray-700 transition p-1.5" title="Attach file"><Paperclip size={20} /></button>
            <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message" className="flex-1 px-4 py-2.5 bg-white rounded-full border-none outline-none text-sm" />
            <button type="submit" disabled={!hasContent || sending} className="bg-[#075e54] hover:bg-[#064e45] text-white p-2.5 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"><Send size={18} /></button>
          </div>
        </form>
      </div>
    );
  }

  if (platform === 'instagram') {
    return (
      <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-3 sm:px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onAttachClick} className="text-gray-400 hover:text-gray-600 transition p-1" title="Attach file"><Paperclip size={18} /></button>
          <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Message..." className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full border border-gray-200 outline-none text-sm focus:border-gray-300" />
          <button type="submit" disabled={!hasContent || sending} className="text-primary-500 hover:text-primary-600 font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed px-2">Send</button>
        </div>
      </form>
    );
  }

  if (platform === 'facebook') {
    return (
      <form onSubmit={handleSend} className="bg-white border-t border-gray-100 px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onAttachClick} className="text-[#0084ff] hover:text-[#0073e6] transition p-1" title="Attach file"><Paperclip size={20} /></button>
          <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Aa" className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full border-none outline-none text-sm" />
          <button type="submit" disabled={!hasContent || sending} className="text-[#0084ff] hover:text-[#0073e6] transition disabled:opacity-50 disabled:cursor-not-allowed p-1.5"><Send size={20} /></button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-4 sm:px-6 py-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onAttachClick} className="text-gray-400 hover:text-gray-600 transition p-1" title="Attach file"><Paperclip size={18} /></button>
        <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Write a message..." className="flex-1 px-4 py-2.5 bg-gray-100 rounded-xl border border-transparent focus:bg-white focus:border-primary-300 focus:ring-1 focus:ring-primary-300 outline-none text-sm" />
        <button type="submit" disabled={!hasContent || sending} className="bg-primary-500 hover:bg-primary-600 text-white p-2.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"><Send size={18} /></button>
      </div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Get the best display name for a contact based on platform.
 * - Instagram: username (e.g., @johndoe)
 * - Facebook: display name (e.g., John Doe)
 * - WhatsApp: profile name or phone number
 * - Gmail: sender name + email
 */
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
      if (name && email && name !== email) return `${name} <${email}>`;
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
// IMAGE COMPRESSION — reduces upload size for large images
// ═══════════════════════════════════════════════════════════════════

function compressImage(file, maxDimension = 1200, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
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
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Compression failed'));
          const compressed = new File([blob], file.name, { type: file.type, lastModified: Date.now() });
          resolve(compressed);
        },
        file.type,
        quality
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}
