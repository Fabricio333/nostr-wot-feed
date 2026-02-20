import React from 'react';
import { Link } from 'react-router';
import { Search, PenSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONVERSATIONS = [
  {
    id: '1',
    user: {
      name: 'Sarah Connor',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
      online: true,
    },
    lastMessage: 'Hey! Are you coming to the meetup?',
    time: '2m',
    unread: 2,
  },
  {
    id: '2',
    user: {
      name: 'Alex Rivera',
      avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop',
      online: false,
    },
    lastMessage: 'Sent you the design files.',
    time: '1h',
    unread: 0,
  },
  {
    id: '3',
    user: {
      name: 'Jessica Wu',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop',
      online: true,
    },
    lastMessage: 'Let me know what you think!',
    time: '3h',
    unread: 1,
  },
];

export function Messages() {
  return (
    <div className="bg-black min-h-screen text-white pb-20 md:pb-0">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800 p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Messages</h1>
        <button className="p-2 -mr-2 text-zinc-400 hover:text-white transition-colors">
          <PenSquare size={24} />
        </button>
      </header>

      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input 
            type="text" 
            placeholder="Search messages..." 
            className="w-full bg-zinc-900 rounded-lg py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-700"
          />
        </div>
      </div>

      <div className="mt-2">
        <h2 className="px-4 text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">Active Now</h2>
        <div className="flex gap-4 px-4 overflow-x-auto pb-4 no-scrollbar">
          {CONVERSATIONS.filter(c => c.user.online).map(c => (
            <div key={c.id} className="flex flex-col items-center gap-1 min-w-[64px]">
              <div className="relative">
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-black">
                  <img src={c.user.avatar} alt={c.user.name} className="w-full h-full object-cover" />
                </div>
                <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-black"></div>
              </div>
              <span className="text-xs text-zinc-400 truncate w-full text-center">{c.user.name.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col">
        {CONVERSATIONS.map((chat) => (
          <Link 
            key={chat.id} 
            to={`/messages/${chat.id}`}
            className="flex items-center gap-4 p-4 hover:bg-zinc-900/50 active:bg-zinc-900 transition-colors"
          >
            <div className="relative">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800">
                <img src={chat.user.avatar} alt={chat.user.name} className="w-full h-full object-cover" />
              </div>
              {chat.user.online && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-black"></div>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline mb-0.5">
                <h3 className={cn("font-medium truncate", chat.unread > 0 ? "text-white" : "text-zinc-200")}>
                  {chat.user.name}
                </h3>
                <span className={cn("text-xs", chat.unread > 0 ? "text-blue-500 font-semibold" : "text-zinc-500")}>
                  {chat.time}
                </span>
              </div>
              <p className={cn("text-sm truncate pr-4", chat.unread > 0 ? "text-white font-medium" : "text-zinc-500")}>
                {chat.unread > 0 && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-2"></span>}
                {chat.lastMessage}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
