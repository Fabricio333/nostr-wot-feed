import React, { useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router';
import { Home, MessageCircle, PlusSquare, User, Search, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useProfileStore } from '@/stores/profileStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Profiles } from '@/services/profiles';
import { loadSettings } from '@/services/settings';
import { truncateNpub } from '@/utils/helpers';

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isLoggedIn, loading, pubkey, logout, initialize } = useAuthStore();
  const { updateTick } = useProfileStore();
  const settingsStore = useSettingsStore();

  const isMessageDetail = location.pathname.startsWith('/messages/') && location.pathname.split('/').length > 2;
  const isCreate = location.pathname === '/create';
  const hideBottomNav = isMessageDetail || isCreate;

  // Initialize auth on mount
  useEffect(() => {
    loadSettings();
    settingsStore.load();
    initialize();
  }, []);

  // Wire profile updates
  useEffect(() => {
    Profiles.onUpdate = (pubkeys) => {
      useProfileStore.getState().onProfilesUpdated(pubkeys);
    };
  }, []);

  // Request own profile
  useEffect(() => {
    if (pubkey) {
      Profiles.request(pubkey);
    }
  }, [pubkey]);

  // Redirect to login if not logged in
  useEffect(() => {
    if (!loading && !isLoggedIn) {
      navigate('/login', { replace: true });
    }
  }, [loading, isLoggedIn, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white">
        <div className="animate-pulse text-lg">Loading...</div>
      </div>
    );
  }

  if (!isLoggedIn) return null;

  const profile = pubkey ? Profiles.get(pubkey) : null;
  const displayName = profile?.displayName || profile?.name || (pubkey ? truncateNpub(pubkey) : 'Anonymous');
  const handle = profile?.name ? `@${profile.name}` : (pubkey ? truncateNpub(pubkey) : '@anonymous');

  return (
    <div className="flex h-screen w-full bg-black text-white overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-zinc-800 p-4">
        <div className="mb-8 px-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Nostr WTF</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarLink to="/" icon={Home} label="Home" />
          <SidebarLink to="/explore" icon={Search} label="Explore" />
          <SidebarLink to="/messages" icon={MessageCircle} label="Messages" />
          <SidebarLink to="/create" icon={PlusSquare} label="Create" />
          <SidebarLink to="/profile" icon={User} label="Profile" />
          <SidebarLink to="/settings" icon={SettingsIcon} label="Settings" />
        </nav>

        <div className="p-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden flex items-center justify-center">
              {profile?.picture ? (
                <img src={profile.picture} alt="User" className="w-full h-full object-cover" />
              ) : (
                <User size={20} className="text-zinc-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{displayName}</p>
              <p className="text-zinc-500 text-xs truncate">{handle}</p>
            </div>
          </div>
          <button
            onClick={async () => { await logout(); navigate('/login'); }}
            className="flex items-center gap-2 text-zinc-500 hover:text-red-400 text-sm transition-colors w-full"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative w-full md:max-w-2xl md:mx-auto md:border-r md:border-zinc-800 no-scrollbar bg-black">
        <div className={cn("min-h-full md:pb-0", hideBottomNav ? "pb-0" : "pb-20")}>
          <Outlet />
        </div>
      </main>

      {/* Right Sidebar (Desktop only) */}
      <aside className="hidden lg:block w-80 p-6 pl-8">
        <div className="bg-zinc-900 rounded-xl p-4 mb-6">
          <h3 className="font-bold mb-4 text-lg">Nostr WTF</h3>
          <p className="text-zinc-400 text-sm">
            Your feed is filtered by Web of Trust. Notes from people closer to you in the social graph are scored higher.
          </p>
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
