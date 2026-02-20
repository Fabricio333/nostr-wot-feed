import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { Key, Globe, Eye, Loader2 } from 'lucide-react';

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
    <div className="flex items-center justify-center min-h-screen bg-black text-white p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent mb-2">
            Nostr WoT Feed
          </h1>
          <p className="text-zinc-400">Web of Trust powered social feed</p>
        </div>

        <div className="space-y-4">
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
    </div>
  );
}
