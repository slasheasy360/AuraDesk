import { useState, useEffect, useRef, useCallback, forwardRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import {
  Send, Search, MessageSquare, Mail, ArrowLeft, Paperclip,
  Smile, X, FileText, Image, Reply, Forward, ChevronDown,
  ChevronUp, Download, UploadCloud,
} from 'lucide-react';
import PlatformBadge, { PlatformIcon } from '../components/PlatformBadge.jsx';

export default function InboxPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [sendError, setSendError] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // for email reply context
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState(new Set());
  const [uploadProgress, setUploadProgress] = useState(null);
  const messagesEndRef = useRef(null);
  const replyBoxRef = useRef(null);
  const pollingRef = useRef(null);
  const igPollingRef = useRef(null);
  const conversationIdRef = useRef(conversationId);
  const fileInputRef = useRef(null);

  // Fetch conversations + start polling
  useEffect(() => {
    fetchConversations();
    syncGmail();
    pollingRef.current = setInterval(syncGmail, 60000);
    syncInstagram();
    igPollingRef.current = setInterval(syncInstagram, 60000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (igPollingRef.current) clearInterval(igPollingRef.current);
    };
  }, []);

  // Listen for real-time events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === data.conversationId);
        if (!exists) { fetchConversations(); return prev; }
        const updated = prev.map((c) =>
          c.id === data.conversationId
            ? {
                ...c,
                lastMessageAt: new Date().toISOString(),
                messages: [{ content: data.message.content, direction: data.message.direction, sentAt: data.message.sentAt }],
                unreadCount: c.id === conversationId ? 0 : (c.unreadCount || 0) + 1,
              }
            : c
        );
        return updated.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      });
      if (data.conversationId === conversationId) {
        setMessages((prev) => {
          if (data.message.id && prev.some((m) => m.id === data.message.id)) return prev;
          return [...prev, data.message];
        });
      }
    };

    const handleConversationUpdate = (data) => {
      setConversations((prev) =>
        prev
          .map((c) =>
            c.id === data.conversationId
              ? { ...c, lastMessageAt: data.lastMessageAt, unreadCount: data.unreadCount }
              : c
          )
          .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt))
      );
    };

    socket.on('new_message', handleNewMessage);
    socket.on('conversation_update', handleConversationUpdate);
    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('conversation_update', handleConversationUpdate);
    };
  }, [conversationId]);

  useEffect(() => {
    const handleInboxRefresh = () => {
      fetchConversations();
      if (conversationId) fetchMessages(conversationId);
    };
    window.addEventListener('auradesk:refresh-inbox', handleInboxRefresh);
    return () => window.removeEventListener('auradesk:refresh-inbox', handleInboxRefresh);
  }, [conversationId]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    if (conversationId) {
      fetchMessages(conversationId);
      setSendError('');
      setAttachments([]);
      setShowReplyBox(false);
      setReplyingTo(null);
      setCollapsedMessages(new Set());
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
    }
  }, [conversationId]);

  useEffect(() => {
    if (showReplyBox && replyBoxRef.current) {
      replyBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, showReplyBox]);

  async function fetchConversations() {
    try {
      const res = await api.get('/api/conversations');
      setConversations(res.data.conversations);
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }

  async function syncGmail() {
    try {
      const res = await api.get('/api/messages/gmail/sync');
      if ((res.data?.newMessages || 0) > 0) {
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId);
      }
    } catch { /* Silent */ }
  }

  async function syncInstagram() {
    try {
      const res = await api.get('/api/messages/instagram/sync');
      if ((res.data?.newMessages || 0) > 0) {
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId);
      }
    } catch { /* Silent */ }
  }

  async function fetchMessages(convId) {
    try {
      const res = await api.get(`/api/messages/${convId}`);
      setMessages(res.data.messages);
      const convRes = await api.get(`/api/conversations/${convId}`);
      setActiveConversation(convRes.data.conversation);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !conversationId || sending) return;

    setSending(true);
    setSendError('');
    setUploadProgress(0);
    try {
      let res;
      if (attachments.length > 0) {
        const formData = new FormData();
        formData.append('conversationId', conversationId);
        if (newMessage.trim()) formData.append('content', newMessage.trim());
        // Pass subject for email replies
        if (isEmailPlatform && replyingTo?.subject) {
          const subj = replyingTo.subject.startsWith('Re:') ? replyingTo.subject : `Re: ${replyingTo.subject}`;
          formData.append('subject', subj);
        }
        for (const att of attachments) {
          formData.append('attachments', att.file);
        }
        res = await api.post('/api/messages/send', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(pct);
          },
        });
      } else {
        const body = { conversationId, content: newMessage.trim() };
        if (isEmailPlatform && replyingTo?.subject) {
          body.subject = replyingTo.subject.startsWith('Re:') ? replyingTo.subject : `Re: ${replyingTo.subject}`;
        }
        res = await api.post('/api/messages/send', body);
      }
      setMessages((prev) => [...prev, res.data.message]);
      setNewMessage('');
      setAttachments([]);
      setUploadProgress(null);
      // Keep reply box open for email thread continuity
      if (!isEmailPlatform) {
        setShowReplyBox(false);
        setReplyingTo(null);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setSendError(err.response?.data?.error || 'Failed to send message');
      setUploadProgress(null);
    } finally {
      setSending(false);
    }
  }

  const handleFileSelect = useCallback((files) => {
    const newAttachments = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    }));
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
  const emailSubject = isEmailPlatform
    ? (messages.find((m) => m.subject)?.subject || '(No Subject)')
    : null;

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true;
    const contactName = c.contact?.name || c.contact?.username || '';
    return contactName.toLowerCase().includes(search.toLowerCase());
  });

  const handleSelectConversation = (convId) => navigate(`/inbox/${convId}`);
  const handleBackToList = () => navigate('/inbox');
  const platformTheme = getPlatformTheme(platform);

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
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 px-6">
              <MessageSquare size={40} className="mb-3" />
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-xs mt-1">Connect an account to start</p>
            </div>
          ) : (
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
                        {conv.contact?.name || conv.contact?.username || 'Unknown'}
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

        {conversationId && activeConversation ? (
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
                  {activeConversation.contact?.name || activeConversation.contact?.username || 'Unknown'}
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
            {isEmailPlatform ? (
              <EmailThreadView
                messages={messages}
                emailSubject={emailSubject}
                collapsedMessages={collapsedMessages}
                toggleCollapsed={toggleCollapsed}
                onReply={openReplyBox}
                messagesEndRef={messagesEndRef}
              />
            ) : (
              <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-3">
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
            <div className="px-4 sm:px-5 py-3 border-t border-gray-100 bg-gray-50/50">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">
                {msg.attachments.length} Attachment{msg.attachments.length !== 1 ? 's' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {msg.attachments.map((att, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-gray-200 hover:border-gray-300 transition-colors cursor-default"
                  >
                    <div className={`w-8 h-8 rounded flex items-center justify-center ${
                      att.mimeType?.startsWith('image/') ? 'bg-blue-50' : 'bg-gray-100'
                    }`}>
                      {att.mimeType?.startsWith('image/') ? (
                        <Image size={16} className="text-blue-500" />
                      ) : (
                        <FileText size={16} className="text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{att.filename}</p>
                      <p className="text-[10px] text-gray-400">{formatFileSize(att.size)}</p>
                    </div>
                    <Download size={14} className="text-gray-300 ml-1" />
                  </div>
                ))}
              </div>
            </div>
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
              <button className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 hover:border-gray-300 transition">
                <Forward size={14} />
                Forward
              </button>
            </div>
          )}
        </>
      )}
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
                        <p className="text-[10px] text-gray-400">{formatFileSize(att.size)}</p>
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

function MessageAttachments({ attachments }) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {attachments.map((att, i) => (
        <div key={i} className="flex items-center gap-1 px-2 py-1 bg-black/5 rounded text-[11px]">
          {att.mimeType?.startsWith('image/') ? <Image size={12} /> : <FileText size={12} />}
          <span className="truncate max-w-[120px]">{att.filename}</span>
          <span className="text-gray-400">({formatFileSize(att.size)})</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PLATFORM-SPECIFIC CHAT BUBBLES
// ═══════════════════════════════════════════════════════════════════

function renderWhatsAppMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-3 py-2 rounded-lg text-sm shadow-sm relative ${
        isOutbound ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none' : 'bg-white text-gray-900 rounded-tl-none'
      }`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <MessageAttachments attachments={msg.attachments} />
        <div className="flex items-center justify-end gap-1 mt-1">
          <span className="text-[10px] text-gray-500">{formatTime(msg.sentAt)}</span>
          {isOutbound && msg.status && (
            <span className="text-[10px] text-blue-500">
              {msg.status === 'delivered' || msg.status === 'read' ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function renderInstagramMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 text-sm ${
        isOutbound
          ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-white rounded-3xl rounded-br-md'
          : 'bg-gray-200 text-gray-900 rounded-3xl rounded-bl-md'
      }`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <MessageAttachments attachments={msg.attachments} />
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-white/70' : 'text-gray-400'}`}>
          {formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

function renderFacebookMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-3xl text-sm ${
        isOutbound ? 'bg-[#0084ff] text-white rounded-br-md' : 'bg-gray-200 text-gray-900 rounded-bl-md'
      }`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <MessageAttachments attachments={msg.attachments} />
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-blue-200' : 'text-gray-400'}`}>
          {formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

function renderDefaultMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-2xl text-sm ${
        isOutbound
          ? 'bg-primary-500 text-white rounded-br-md'
          : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
      }`}>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <MessageAttachments attachments={msg.attachments} />
        <p className={`text-xs mt-1 ${isOutbound ? 'text-primary-200' : 'text-gray-400'}`}>
          {formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NON-EMAIL COMPOSER
// ═══════════════════════════════════════════════════════════════════

function renderComposer({ platform, newMessage, setNewMessage, handleSend, sending, attachments, onAttachClick }) {
  const hasContent = newMessage.trim() || attachments.length > 0;

  if (platform === 'whatsapp') {
    return (
      <form onSubmit={handleSend} className="bg-[#f0f0f0] px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" className="text-gray-500 hover:text-gray-700 transition p-1.5"><Smile size={22} /></button>
          <button type="button" onClick={onAttachClick} className="text-gray-500 hover:text-gray-700 transition p-1.5" title="Attach file"><Paperclip size={20} /></button>
          <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message" className="flex-1 px-4 py-2.5 bg-white rounded-full border-none outline-none text-sm" />
          <button type="submit" disabled={!hasContent || sending} className="bg-[#075e54] hover:bg-[#064e45] text-white p-2.5 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"><Send size={18} /></button>
        </div>
      </form>
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

function formatFileSize(bytes) {
  if (!bytes) return '0B';
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
