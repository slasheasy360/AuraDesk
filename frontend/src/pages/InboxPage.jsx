import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import { Send, Search, MessageSquare } from 'lucide-react';
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
  const messagesEndRef = useRef(null);

  // Fetch conversations
  useEffect(() => {
    fetchConversations();
  }, []);

  // Listen for real-time events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewMessage = (data) => {
      // Update conversations list
      setConversations((prev) => {
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

      // If viewing this conversation, add message
      if (data.conversationId === conversationId) {
        setMessages((prev) => [...prev, data.message]);
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

  // Fetch messages when conversation changes
  useEffect(() => {
    if (conversationId) {
      fetchMessages(conversationId);
      // Mark conversation as read in local state
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
      );
    }
  }, [conversationId]);

  // Auto-scroll messages
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

  async function fetchMessages(convId) {
    try {
      const res = await api.get(`/api/messages/${convId}`);
      setMessages(res.data.messages);

      // Also fetch conversation details
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
    try {
      const res = await api.post('/api/messages/send', {
        conversationId,
        content: newMessage.trim(),
      });
      setMessages((prev) => [...prev, res.data.message]);
      setNewMessage('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  }

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
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => navigate(`/inbox/${conv.id}`)}
                className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-50 border-b border-gray-100 transition text-left ${
                  conv.id === conversationId ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                }`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-gray-500 text-sm font-medium">
                    {(conv.contact?.name || '?')[0]?.toUpperCase()}
                  </div>
                  <PlatformBadge
                    platform={conv.connectedAccount?.platform}
                    className="absolute -bottom-1 -right-1"
                    size="sm"
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium truncate ${conv.unreadCount > 0 ? 'text-gray-900' : 'text-gray-700'}`}>
                      {conv.contact?.name || conv.contact?.username || 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatTime(conv.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-gray-500 truncate">
                      {conv.messages?.[0]?.direction === 'outbound' ? 'You: ' : ''}
                      {conv.messages?.[0]?.content || 'No messages'}
                    </p>
                    {conv.unreadCount > 0 && (
                      <span className="ml-2 bg-primary-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
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
              <div>
                <h2 className="font-semibold text-gray-900">
                  {activeConversation.contact?.name || activeConversation.contact?.username || 'Unknown'}
                </h2>
                <div className="flex items-center gap-2">
                  <PlatformBadge platform={activeConversation.connectedAccount?.platform} size="xs" />
                  <span className="text-xs text-gray-500">
                    via {activeConversation.connectedAccount?.displayName}
                  </span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-primary-500 text-white rounded-br-md'
                        : 'bg-white text-gray-900 border border-gray-200 rounded-bl-md'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    <p
                      className={`text-xs mt-1 ${
                        msg.direction === 'outbound' ? 'text-primary-200' : 'text-gray-400'
                      }`}
                    >
                      {formatTime(msg.sentAt)}
                      {msg.direction === 'outbound' && msg.status && (
                        <span className="ml-1">
                          {msg.status === 'delivered' ? ' ✓✓' : msg.status === 'read' ? ' ✓✓' : ' ✓'}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Write a message..."
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
