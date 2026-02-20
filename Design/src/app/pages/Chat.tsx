import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Send, Image, Smile, Phone, Video } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

// Mock data
const USERS: Record<string, any> = {
  '1': { name: 'Sarah Connor', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop', online: true },
  '2': { name: 'Alex Rivera', avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop', online: false },
};

export function Chat() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([
    { id: 1, text: 'Hey! How are you doing?', sender: 'them', time: '10:00 AM' },
    { id: 2, text: 'I am good! Just working on the new project.', sender: 'me', time: '10:02 AM' },
    { id: 3, text: 'That sounds exciting! What stack are you using?', sender: 'them', time: '10:05 AM' },
  ]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const user = USERS[id || '1'] || USERS['1'];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMessage = {
      id: messages.length + 1,
      text: inputText,
      sender: 'me',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages([...messages, newMessage]);
    setInputText('');
    
    // Simulate reply
    setTimeout(() => {
      setMessages(prev => [...prev, {
        id: prev.length + 1,
        text: 'That is awesome! Keep it up! 🚀',
        sender: 'them',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    }, 2000);
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
            <div className="w-10 h-10 rounded-full overflow-hidden bg-zinc-800">
              <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" />
            </div>
            {user.online && (
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-black"></div>
            )}
          </div>
          <div>
            <h3 className="font-bold text-sm">{user.name}</h3>
            <p className="text-xs text-zinc-500">{user.online ? 'Active now' : 'Offline'}</p>
          </div>
        </div>

        <div className="flex gap-1">
          <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            <Phone size={20} />
          </button>
          <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors">
            <Video size={20} />
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "flex w-full",
                msg.sender === 'me' ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[75%] px-4 py-2 rounded-2xl text-sm relative group",
                  msg.sender === 'me' 
                    ? "bg-blue-600 text-white rounded-tr-none" 
                    : "bg-zinc-800 text-zinc-100 rounded-tl-none"
                )}
              >
                {msg.text}
                <span className="text-[10px] opacity-50 block text-right mt-1 w-full min-w-[40px]">{msg.time}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 bg-black border-t border-zinc-800">
        <form onSubmit={sendMessage} className="flex items-center gap-2 bg-zinc-900 rounded-full px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-500/50 transition-all">
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
            disabled={!inputText.trim()}
            className="p-2 bg-blue-600 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
          >
            <Send size={18} fill="currentColor" />
          </button>
        </form>
      </div>
    </div>
  );
}
