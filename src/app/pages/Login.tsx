import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { Key, Globe, Eye, Loader2, Shield, MessageCircle, Radio, Lock } from 'lucide-react';

export function Login() {
  const navigate = useNavigate();
  const {
    isLoggedIn,
    loading,
    error,
    hasExtension,
    initialize,
    loginExtension,
    loginBunker,
    loginReadOnly,
    clearError,
  } = useAuthStore();

  const [bunkerUrl, setBunkerUrl] = useState('');
  const [showBunker, setShowBunker] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (isLoggedIn && !loading) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, loading, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <Loader2 className="animate-spin text-purple-500" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center px-4 pt-24 pb-16 overflow-hidden">
        {/* Gradient glow behind title */}
        <div className="absolute top-12 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl pointer-events-none" />

        <img src="/icon.svg" alt="Nostr WTF" className="w-16 h-16 mb-6 relative" />

        <h1 className="relative text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent mb-3 text-center">
          Nostr WTF
        </h1>
        <p className="relative text-xl sm:text-2xl text-zinc-300 font-medium mb-4 text-center">
          Web of Trust Feed
        </p>
        <p className="relative text-zinc-500 text-center max-w-lg text-base sm:text-lg leading-relaxed">
          A trust-scored Nostr feed. See notes from people you trust, filter out spam, and explore the network through your Web of Trust.
        </p>
      </section>

      {/* Features Section */}
      <section className="max-w-4xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FeatureCard
            icon={<Shield size={24} className="text-purple-400" />}
            title="Web of Trust Filtering"
            description="Every note is scored by your social graph. People closer to you rank higher — spam disappears naturally."
          />
          <FeatureCard
            icon={<Lock size={24} className="text-pink-400" />}
            title="Encrypted DMs"
            description="Private conversations with NIP-04 encryption. Only you and the recipient can read your messages."
          />
          <FeatureCard
            icon={<Radio size={24} className="text-purple-400" />}
            title="Multi-Relay Support"
            description="Connect to multiple relays simultaneously for a wider, more resilient view of the network."
          />
          <FeatureCard
            icon={<MessageCircle size={24} className="text-pink-400" />}
            title="Flexible Authentication"
            description="Sign in with a browser extension, Nostr Connect bunker, or browse in read-only mode."
          />
        </div>
      </section>

      {/* Sign In Section */}
      <section className="max-w-md mx-auto px-4 pb-16">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <h2 className="text-xl font-bold text-center">Get Started</h2>

          <div className="space-y-3">
            {/* NIP-07 Extension Login */}
            {hasExtension && (
              <button
                onClick={loginExtension}
                className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-700 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
              >
                <Key size={20} />
                Sign in with Extension
              </button>
            )}

            {!hasExtension && (
              <div className="text-center p-4 border border-zinc-800 rounded-xl">
                <p className="text-zinc-400 text-sm">
                  No NIP-07 extension detected. Install{' '}
                  <a
                    href="https://getalby.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    Alby
                  </a>{' '}
                  or{' '}
                  <a
                    href="https://github.com/nicely-gg/nos2x"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 hover:text-purple-300 underline"
                  >
                    nos2x
                  </a>{' '}
                  for best experience.
                </p>
              </div>
            )}

            {/* NIP-46 Bunker Login */}
            <div>
              <button
                onClick={() => setShowBunker(!showBunker)}
                className="w-full flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
              >
                <Globe size={20} />
                Nostr Connect (NIP-46)
              </button>

              {showBunker && (
                <div className="mt-3 space-y-3">
                  <input
                    type="text"
                    placeholder="bunker://... or npub..."
                    value={bunkerUrl}
                    onChange={(e) => setBunkerUrl(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                  />
                  <button
                    onClick={() => loginBunker(bunkerUrl)}
                    disabled={!bunkerUrl.trim()}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2.5 px-4 rounded-lg font-semibold transition-colors"
                  >
                    Connect
                  </button>
                </div>
              )}
            </div>

            {/* Read-only Mode */}
            <button
              onClick={loginReadOnly}
              className="w-full flex items-center justify-center gap-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 py-3 px-6 rounded-xl font-semibold transition-colors border border-zinc-800"
            >
              <Eye size={20} />
              Browse Read-Only
            </button>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-300 text-sm text-center">
              {error}
              <button
                onClick={clearError}
                className="ml-2 text-red-400 hover:text-red-200 underline"
              >
                dismiss
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800/50 py-8 text-center text-zinc-600 text-sm">
        <p>
          Built on{' '}
          <a href="https://nostr.com" target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-400 underline">
            Nostr
          </a>{' '}
          — the open protocol for censorship-resistant social networking.
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl p-5 space-y-2">
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <p className="text-zinc-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
