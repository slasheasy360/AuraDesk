import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import { Send, Search, MessageSquare, Mail, ArrowLeft, Paperclip, Smile } from 'lucide-react';
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
  const messagesEndRef = useRef(null);
  const pollingRef = useRef(null);
  const igPollingRef = useRef(null);
  const conversationIdRef = useRef(conversationId);

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

        if (!exists) {
          fetchConversations();
          return prev;
        }

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
      if (conversationId) {
        fetchMessages(conversationId);
      }
    };

    window.addEventListener('auradesk:refresh-inbox', handleInboxRefresh);
    return () => {
      window.removeEventListener('auradesk:refresh-inbox', handleInboxRefresh);
    };
  }, [conversationId]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    if (conversationId) {
      fetchMessages(conversationId);
      setSendError('');
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
    }
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      const newCount = res.data?.newMessages || 0;
      if (newCount > 0) {
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId);
      }
    } catch {
      // Silent fail
    }
  }

  async function syncInstagram() {
    try {
      const res = await api.get('/api/messages/instagram/sync');
      const newCount = res.data?.newMessages || 0;
      if (newCount > 0) {
        fetchConversations();
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId);
      }
    } catch {
      // Silent fail
    }
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
    if (!newMessage.trim() || !conversationId || sending) return;

    setSending(true);
    setSendError('');
    try {
      const res = await api.post('/api/messages/send', {
        conversationId,
        content: newMessage.trim(),
      });
      setMessages((prev) => [...prev, res.data.message]);
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
      setSendError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

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

  const handleSelectConversation = (convId) => {
    navigate(`/inbox/${convId}`);
  };

  const handleBackToList = () => {
    navigate('/inbox');
  };

  // Platform-specific colors
  const platformTheme = getPlatformTheme(platform);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div
        className={`
          bg-white border-r border-gray-200 flex flex-col
          w-full md:w-80 lg:w-96 flex-shrink-0
          ${conversationId ? 'hidden md:flex' : 'flex'}
        `}
      >
        {/* Header */}
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

        {/* Conversation list items */}
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
                ? lastMessage.content.replace(/\n+/g, ' ').slice(0, 80)
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
                  {/* Platform icon avatar */}
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
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className={`text-xs truncate ${conv.unreadCount > 0 ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                        {lastMessage?.direction === 'outbound' ? 'You: ' : ''}
                        {preview}
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

      {/* Chat area */}
      <div
        className={`
          flex-1 flex flex-col
          ${conversationId ? 'flex' : 'hidden md:flex'}
        `}
        style={{ backgroundColor: platformTheme.chatBg }}
      >
        {conversationId && activeConversation ? (
          <>
            {/* Chat header - platform-styled */}
            <div className={`border-b px-4 sm:px-6 py-3 flex items-center gap-3 ${platformTheme.headerBg} ${platformTheme.headerBorder}`}>
              {/* Back button on mobile */}
              <button
                onClick={handleBackToList}
                className="md:hidden text-gray-600 hover:text-gray-900 transition flex-shrink-0"
              >
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

            {/* Messages area - platform-specific rendering */}
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

                    {isEmailPlatform
                      ? renderEmailMessage(msg, isOutbound, idx, messages)
                      : platform === 'whatsapp'
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

            {/* Send error */}
            {sendError && (
              <div className="px-4 sm:px-6 py-2 bg-red-50 border-t border-red-200">
                <p className="text-xs text-red-600">{sendError}</p>
              </div>
            )}

            {/* Message composer - platform-styled */}
            {renderComposer(platform, isEmailPlatform, newMessage, setNewMessage, handleSend, sending)}
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

// ─── Platform theme configs ───

function getPlatformTheme(platform) {
  switch (platform) {
    case 'whatsapp':
      return {
        chatBg: '#e5ddd5',
        headerBg: 'bg-[#075e54]',
        headerBorder: 'border-[#064e45]',
        headerText: 'text-white',
        dateBadgeBg: 'bg-white/80',
        dateBadgeText: 'text-gray-600',
      };
    case 'instagram':
      return {
        chatBg: '#fafafa',
        headerBg: 'bg-white',
        headerBorder: 'border-gray-200',
        headerText: 'text-gray-900',
        dateBadgeBg: 'bg-gray-100',
        dateBadgeText: 'text-gray-400',
      };
    case 'facebook':
      return {
        chatBg: '#f0f2f5',
        headerBg: 'bg-white',
        headerBorder: 'border-gray-200',
        headerText: 'text-gray-900',
        dateBadgeBg: 'bg-gray-200',
        dateBadgeText: 'text-gray-500',
      };
    case 'gmail':
      return {
        chatBg: '#f8f9fa',
        headerBg: 'bg-white',
        headerBorder: 'border-gray-200',
        headerText: 'text-gray-900',
        dateBadgeBg: 'bg-gray-100',
        dateBadgeText: 'text-gray-400',
      };
    default:
      return {
        chatBg: '#f9fafb',
        headerBg: 'bg-white',
        headerBorder: 'border-gray-200',
        headerText: 'text-gray-900',
        dateBadgeBg: 'bg-gray-100',
        dateBadgeText: 'text-gray-400',
      };
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

// ─── Email thread view ───

function renderEmailMessage(msg, isOutbound, idx, allMessages) {
  return (
    <div className={`max-w-[95%] sm:max-w-[85%] ${isOutbound ? 'ml-auto' : ''}`}>
      <div className={`rounded-xl p-4 shadow-sm ${
        isOutbound
          ? 'bg-blue-50 border border-blue-200'
          : 'bg-white border border-gray-200'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
              isOutbound ? 'bg-blue-200 text-blue-700' : 'bg-gray-200 text-gray-600'
            }`}>
              {(msg.sender || (isOutbound ? 'Y' : '?'))[0]?.toUpperCase()}
            </div>
            <span className="text-sm font-medium text-gray-900">
              {isOutbound ? 'You' : (msg.sender || 'Unknown')}
            </span>
          </div>
          <span className="text-xs text-gray-400">
            {formatTime(msg.sentAt)}
          </span>
        </div>

        {msg.subject && idx === 0 && (
          <div className="flex items-center gap-1.5 mb-2">
            <Mail size={13} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-600">{msg.subject}</span>
          </div>
        )}

        <div className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
          {msg.content}
        </div>
      </div>
    </div>
  );
}

// ─── WhatsApp-style chat bubbles ───

function renderWhatsAppMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] sm:max-w-[65%] px-3 py-2 rounded-lg text-sm shadow-sm relative ${
          isOutbound
            ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none'
            : 'bg-white text-gray-900 rounded-tl-none'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <div className={`flex items-center justify-end gap-1 mt-1`}>
          <span className="text-[10px] text-gray-500">
            {formatTime(msg.sentAt)}
          </span>
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

// ─── Instagram DM-style ───

function renderInstagramMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 text-sm ${
          isOutbound
            ? 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 text-white rounded-3xl rounded-br-md'
            : 'bg-gray-200 text-gray-900 rounded-3xl rounded-bl-md'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-white/70' : 'text-gray-400'}`}>
          {formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

// ─── Facebook Messenger-style ───

function renderFacebookMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-3xl text-sm ${
          isOutbound
            ? 'bg-[#0084ff] text-white rounded-br-md'
            : 'bg-gray-200 text-gray-900 rounded-bl-md'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-blue-200' : 'text-gray-400'}`}>
          {formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

// ─── Default chat style ───

function renderDefaultMessage(msg, isOutbound) {
  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] sm:max-w-[65%] px-4 py-2.5 rounded-2xl text-sm ${
          isOutbound
            ? 'bg-primary-500 text-white rounded-br-md'
            : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-xs mt-1 ${isOutbound ? 'text-primary-200' : 'text-gray-400'}`}>
          {formatTime(msg.sentAt)}
        </p>
      </div>
    </div>
  );
}

// ─── Platform-specific composer ───

function renderComposer(platform, isEmailPlatform, newMessage, setNewMessage, handleSend, sending) {
  if (isEmailPlatform) {
    return (
      <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-4 sm:px-6 py-4">
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            placeholder="Write a reply..."
            rows={3}
            className="w-full px-4 py-3 text-sm outline-none resize-none"
          />
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100">
            <div className="flex items-center gap-2 text-gray-400">
              <button type="button" className="hover:text-gray-600 transition p-1"><Paperclip size={16} /></button>
            </div>
            <button
              type="submit"
              disabled={!newMessage.trim() || sending}
              className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Send size={14} />
              Send
            </button>
          </div>
        </div>
      </form>
    );
  }

  if (platform === 'whatsapp') {
    return (
      <form onSubmit={handleSend} className="bg-[#f0f0f0] px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" className="text-gray-500 hover:text-gray-700 transition p-1.5"><Smile size={22} /></button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message"
            className="flex-1 px-4 py-2.5 bg-white rounded-full border-none outline-none text-sm"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="bg-[#075e54] hover:bg-[#064e45] text-white p-2.5 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={18} />
          </button>
        </div>
      </form>
    );
  }

  if (platform === 'instagram') {
    return (
      <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-3 sm:px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Message..."
            className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full border border-gray-200 outline-none text-sm focus:border-gray-300"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="text-primary-500 hover:text-primary-600 font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed px-2"
          >
            Send
          </button>
        </div>
      </form>
    );
  }

  if (platform === 'facebook') {
    return (
      <form onSubmit={handleSend} className="bg-white border-t border-gray-100 px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Aa"
            className="flex-1 px-4 py-2.5 bg-gray-100 rounded-full border-none outline-none text-sm"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="text-[#0084ff] hover:text-[#0073e6] transition disabled:opacity-50 disabled:cursor-not-allowed p-1.5"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    );
  }

  // Default composer
  return (
    <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-4 sm:px-6 py-3">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Write a message..."
          className="flex-1 px-4 py-2.5 bg-gray-100 rounded-xl border border-transparent focus:bg-white focus:border-primary-300 focus:ring-1 focus:ring-primary-300 outline-none text-sm"
        />
        <button
          type="submit"
          disabled={!newMessage.trim() || sending}
          className="bg-primary-500 hover:bg-primary-600 text-white p-2.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={18} />
        </button>
      </div>
    </form>
  );
}

// ─── Utility functions ───

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
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}
