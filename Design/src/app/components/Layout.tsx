import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router';
import { Home, MessageCircle, PlusSquare, User, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Layout() {
  const location = useLocation();
  const isMessageDetail = location.pathname.startsWith('/messages/') && location.pathname.split('/').length > 2;
  const isCreate = location.pathname === '/create';
  
  // Hide bottom nav on chat detail and create screen
  const hideBottomNav = isMessageDetail || isCreate;

  return (
    <div className="flex h-screen w-full bg-black text-white overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-zinc-800 p-4">
        <div className="mb-8 px-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">SocialApp</h1>
        </div>
        
        <nav className="flex-1 space-y-2">
          <SidebarLink to="/" icon={Home} label="Home" />
          <SidebarLink to="/explore" icon={Search} label="Explore" />
          <SidebarLink to="/messages" icon={MessageCircle} label="Messages" />
          <SidebarLink to="/create" icon={PlusSquare} label="Create" />
          <SidebarLink to="/profile" icon={User} label="Profile" />
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden">
              <img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop" alt="User" />
            </div>
            <div>
              <p className="font-bold text-sm">CurrentUser</p>
              <p className="text-zinc-500 text-xs">@currentuser</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative w-full md:max-w-2xl md:mx-auto md:border-r md:border-zinc-800 no-scrollbar">
        <div className={cn("min-h-full md:pb-0", hideBottomNav ? "pb-0" : "pb-20")}>
          <Outlet />
        </div>
      </main>

      {/* Right Sidebar (Desktop only - Suggestions/Trending) */}
      <aside className="hidden lg:block w-80 p-6 pl-8">
        <div className="bg-zinc-900 rounded-xl p-4 mb-6">
          <h3 className="font-bold mb-4 text-lg">Trending</h3>
          <div className="space-y-4">
            <TrendingItem category="Technology" topic="#ReactNative" posts="12.5K" />
            <TrendingItem category="Design" topic="#UIUX" posts="8.2K" />
            <TrendingItem category="Politics" topic="#Election2024" posts="56K" />
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      {!hideBottomNav && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-black border-t border-zinc-800 flex justify-around items-center p-3 z-50 pb-safe">
          <MobileNavLink to="/" icon={Home} />
          <MobileNavLink to="/explore" icon={Search} />
          <MobileNavLink to="/create" icon={PlusSquare} />
          <MobileNavLink to="/messages" icon={MessageCircle} />
          <MobileNavLink to="/profile" icon={User} />
        </nav>
      )}
    </div>
  );
}

function SidebarLink({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-4 px-4 py-3 rounded-full transition-colors text-lg",
          isActive ? "font-bold text-white bg-zinc-900" : "text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200"
        )
      }
    >
      <Icon size={26} strokeWidth={2.5} />
      <span>{label}</span>
    </NavLink>
  );
}

function MobileNavLink({ to, icon: Icon }: { to: string; icon: any }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "p-2 rounded-full transition-colors",
          isActive ? "text-white" : "text-zinc-500"
        )
      }
    >
      <Icon size={28} strokeWidth={2.5} />
    </NavLink>
  );
}

function TrendingItem({ category, topic, posts }: { category: string; topic: string; posts: string }) {
  return (
    <div className="cursor-pointer hover:bg-zinc-800/50 p-2 -mx-2 rounded transition-colors">
      <p className="text-zinc-500 text-xs">{category}</p>
      <p className="font-bold">{topic}</p>
      <p className="text-zinc-500 text-xs">{posts} posts</p>
    </div>
  );
}
