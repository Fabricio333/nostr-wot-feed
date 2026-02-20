import React from 'react';
import { Settings, MapPin, Link as LinkIcon, Calendar } from 'lucide-react';
import { Link } from 'react-router';

export function Profile() {
  return (
    <div className="bg-black min-h-screen text-white pb-20 md:pb-0">
      <div className="relative">
        {/* Cover Image */}
        <div className="h-32 md:h-48 bg-gradient-to-r from-purple-800 to-blue-600"></div>
        
        {/* Profile Info */}
        <div className="px-4">
          <div className="relative -mt-16 mb-4 flex justify-between items-end">
            <div className="w-32 h-32 rounded-full border-4 border-black overflow-hidden bg-zinc-800">
              <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&h=400&fit=crop" alt="User" className="w-full h-full object-cover" />
            </div>
            <button className="px-4 py-2 bg-transparent border border-zinc-600 rounded-full font-bold hover:bg-zinc-900 transition-colors">
              Edit Profile
            </button>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold">Current User</h1>
            <p className="text-zinc-500">@currentuser</p>
            
            <p className="mt-4 text-zinc-100">
              Building the future of social media. 🚀 React Native enthusiast.
              <br />
              Open source contributor.
            </p>

            <div className="flex flex-wrap gap-4 mt-4 text-zinc-500 text-sm">
              <div className="flex items-center gap-1">
                <MapPin size={16} />
                <span>San Francisco, CA</span>
              </div>
              <div className="flex items-center gap-1">
                <LinkIcon size={16} />
                <a href="#" className="text-blue-400 hover:underline">github.com/currentuser</a>
              </div>
              <div className="flex items-center gap-1">
                <Calendar size={16} />
                <span>Joined September 2018</span>
              </div>
            </div>

            <div className="flex gap-6 mt-4">
              <div className="hover:underline cursor-pointer">
                <span className="font-bold text-white">564</span> <span className="text-zinc-500">Following</span>
              </div>
              <div className="hover:underline cursor-pointer">
                <span className="font-bold text-white">2.5K</span> <span className="text-zinc-500">Followers</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-zinc-800">
            <TabButton active label="Posts" />
            <TabButton label="Replies" />
            <TabButton label="Media" />
            <TabButton label="Likes" />
          </div>

          {/* Content Grid (Mock) */}
          <div className="grid grid-cols-3 gap-1 py-4">
            {[
              'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=400&fit=crop',
              'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=400&h=400&fit=crop',
              'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
              'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=400&h=400&fit=crop',
              'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop',
              'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop'
            ].map((src, i) => (
              <div key={i} className="aspect-square bg-zinc-900 overflow-hidden hover:opacity-80 transition-opacity cursor-pointer">
                <img src={src} alt="Post thumbnail" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, label }: { active?: boolean; label: string }) {
  return (
    <div className="flex-1 text-center cursor-pointer hover:bg-zinc-900/50 transition-colors">
      <div className={`py-4 font-medium relative ${active ? 'text-white' : 'text-zinc-500'}`}>
        {label}
        {active && (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full"></div>
        )}
      </div>
    </div>
  );
}
