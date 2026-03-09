import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import { Send, Search, MessageSquare, Mail } from 'lucide-react';
import PlatformBadge from '../components/PlatformBadge.jsx';

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

  // Fetch conversations + start Gmail polling
  useEffect(() => {
    fetchConversations();

    // Initial Gmail sync, then poll every 60s
    syncGmail();
    pollingRef.current = setInterval(syncGmail, 60000);

    // Initial Instagram sync, then poll every 60s
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
          // New conversation from Pub/Sub — re-fetch the full list
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
        // Also refresh the active conversation thread if one is open
        const activeId = conversationIdRef.current;
        if (activeId) fetchMessages(activeId);
      }
    } catch {
      // Silent fail — retries on next cycle
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
      // Silent fail — retries on next cycle
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

  const isEmailPlatform = activeConversation?.connectedAccount?.platform === 'gmail';
  const emailSubject = isEmailPlatform
    ? (messages.find((m) => m.subject)?.subject || '(No Subject)')
    : null;

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true;
    const contactName = c.contact?.name || c.contact?.username || '';
    return contactName.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-gray-900 mb-3">Smart Inbox</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-4 py-2 bg-gray-100 border border-transparent rounded-lg text-sm focus:bg-white focus:border-primary-300 focus:ring-1 focus:ring-primary-300 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <MessageSquare size={40} className="mb-3" />
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1">Connect an account to start</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const lastMessage = conv.messages?.[0];
              const preview = lastMessage?.content
                ? lastMessage.content.replace(/\n+/g, ' ').slice(0, 80)
                : 'No messages';

              return (
                <button
                  key={conv.id}
                  onClick={() => navigate(`/inbox/${conv.id}`)}
                  className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-50 border-b border-gray-100 transition text-left ${
                    conv.id === conversationId ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                  }`}
                >
                  <div className="relative flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                      conv.unreadCount > 0
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-200 text-gray-500'
                    }`}>
                      {(conv.contact?.name || '?')[0]?.toUpperCase()}
                    </div>
                    <PlatformBadge
                      platform={conv.connectedAccount?.platform}
                      className="absolute -bottom-1 -right-1"
                      size="sm"
                    />
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
      <div className="flex-1 flex flex-col bg-gray-50">
        {conversationId && activeConversation ? (
          <>
            {/* Chat header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 font-medium">
                {(activeConversation.contact?.name || '?')[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-gray-900 truncate">
                  {activeConversation.contact?.name || activeConversation.contact?.username || 'Unknown'}
                </h2>
                <div className="flex items-center gap-2">
                  <PlatformBadge platform={activeConversation.connectedAccount?.platform} size="xs" />
                  <span className="text-xs text-gray-500">
                    via {activeConversation.connectedAccount?.displayName}
                  </span>
                  {isEmailPlatform && emailSubject && (
                    <span className="text-xs text-gray-400 truncate">&mdash; {emailSubject}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {messages.map((msg, idx) => {
                const isOutbound = msg.direction === 'outbound';
                const prevMsg = idx > 0 ? messages[idx - 1] : null;
                const showDate = !prevMsg || !isSameDay(prevMsg.sentAt, msg.sentAt);

                return (
                  <div key={msg.id || `msg-${idx}`}>
                    {showDate && (
                      <div className="flex items-center justify-center my-4">
                        <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                          {formatDate(msg.sentAt)}
                        </span>
                      </div>
                    )}

                    {isEmailPlatform ? (
                      <div className={`max-w-[85%] ${isOutbound ? 'ml-auto' : ''}`}>
                        <div className={`rounded-xl p-4 ${
                          isOutbound
                            ? 'bg-primary-50 border border-primary-200'
                            : 'bg-white border border-gray-200'
                        }`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                                isOutbound ? 'bg-primary-200 text-primary-700' : 'bg-gray-200 text-gray-600'
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
                    ) : (
                      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm ${
                            isOutbound
                              ? 'bg-primary-500 text-white rounded-br-md'
                              : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          <p className={`text-xs mt-1 ${isOutbound ? 'text-primary-200' : 'text-gray-400'}`}>
                            {formatTime(msg.sentAt)}
                            {isOutbound && msg.status && (
                              <span className="ml-1">
                                {msg.status === 'delivered' || msg.status === 'read' ? ' \u2713\u2713' : ' \u2713'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {sendError && (
              <div className="px-6 py-2 bg-red-50 border-t border-red-200">
                <p className="text-xs text-red-600">{sendError}</p>
              </div>
            )}

            <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={isEmailPlatform ? 'Write a reply...' : 'Write a message...'}
                  className="flex-1 px-4 py-3 bg-gray-100 rounded-xl border border-transparent focus:bg-white focus:border-primary-300 focus:ring-1 focus:ring-primary-300 outline-none text-sm"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim() || sending}
                  className="bg-primary-500 hover:bg-primary-600 text-white p-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
            <MessageSquare size={64} className="mb-4" />
            <h2 className="text-xl font-semibold text-gray-600">Select a conversation</h2>
            <p className="text-sm mt-1">Choose a conversation from the left to start messaging</p>
          </div>
        )}
      </div>
    </div>
  );
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
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}
