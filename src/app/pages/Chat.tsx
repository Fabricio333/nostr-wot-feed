import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Send, Image, Smile, Loader2, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useDMStore } from '@/stores/dmStore';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { Profiles } from '@/services/profiles';
import { Signer } from '@/services/signer';
import { truncateNpub, pubkeyColor } from '@/utils/helpers';

export function Chat() {
  const { id: partnerPubkey } = useParams();
  const navigate = useNavigate();
  const { pubkey: myPubkey } = useAuthStore();
  const { currentMessages, loading, loadConversation, sendMessage } = useDMStore();
  const { updateTick } = useProfileStore();
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation on mount
  useEffect(() => {
    if (partnerPubkey) {
      Profiles.request(partnerPubkey);
      loadConversation(partnerPubkey);
    }
  }, [partnerPubkey]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages]);

  const profile = partnerPubkey ? Profiles.get(partnerPubkey) : null;
  const partnerName = profile?.displayName || profile?.name || (partnerPubkey ? truncateNpub(partnerPubkey) : 'Unknown');
  const avatarUrl = profile?.picture || '';
  const fallbackColor = partnerPubkey ? pubkeyColor(partnerPubkey) : '#666';
  const isReadOnly = Signer.isReadOnly();

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !partnerPubkey || sending) return;

    setSending(true);
    setError(null);
    const result = await sendMessage(partnerPubkey, inputText.trim());
    setSending(false);

    if (result.success) {
      setInputText('');
    } else {
      setError(result.error || 'Failed to send');
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      {/* Header */}
      <header className="flex items-center gap-3 p-3 border-b border-zinc-800 bg-black/80 backdrop-blur-md sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-zinc-800 transition-colors">
          <ArrowLeft size={20} />
        </button>

        <div className="flex items-center gap-3 flex-1">
          <div className="relative">
            <div
              className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center"
              style={!avatarUrl ? { backgroundColor: fallbackColor } : undefined}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={partnerName} className="w-full h-full object-cover" />
              ) : (
                <User size={20} className="text-white/60" />
              )}
            </div>
          </div>
          <div>
            <h3 className="font-bold text-sm">{partnerName}</h3>
            <p className="text-xs text-zinc-500">Encrypted DM</p>
          </div>
        </div>
      </header>

      {/* Loading */}
      {loading && currentMessages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-zinc-400">
          <Loader2 className="animate-spin mr-2" size={20} />
          <span>Decrypting messages...</span>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950">
        {currentMessages.length === 0 && !loading && (
          <div className="text-center text-zinc-600 py-8">
            <p>No messages yet</p>
            <p className="text-sm mt-1">Send an encrypted message to start the conversation</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {currentMessages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "flex w-full",
                msg.fromMe ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[75%] px-4 py-2 rounded-2xl text-sm relative group",
                  msg.fromMe
                    ? "bg-blue-600 text-white rounded-tr-none"
                    : "bg-zinc-800 text-zinc-100 rounded-tl-none"
                )}
              >
                {msg.content}
                <span className="text-[10px] opacity-50 block text-right mt-1 w-full min-w-[40px]">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-900/30 text-red-300 text-sm text-center border-t border-red-800">
          {error}
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 bg-black border-t border-zinc-800">
        {isReadOnly ? (
          <p className="text-center text-zinc-600 text-sm py-2">Log in with a signer to send messages</p>
        ) : (
          <form onSubmit={handleSend} className="flex items-center gap-2 bg-zinc-900 rounded-full px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-500/50 transition-all">
            <button type="button" className="p-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-zinc-800">
              <Image size={20} />
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Message..."
              className="flex-1 bg-transparent border-none focus:outline-none text-white px-2 py-1 placeholder:text-zinc-500"
            />
            <button type="button" className="p-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-zinc-800">
              <Smile size={20} />
            </button>
            <button
              type="submit"
              disabled={!inputText.trim() || sending}
              className="p-2 bg-blue-600 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} fill="currentColor" />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
