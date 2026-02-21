import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { generateNewKeypair } from '@/services/signer';
import { nip19 } from 'nostr-tools';
import {
  Key, Globe, Eye, Loader2, Shield, MessageCircle, Radio, Lock,
  UserPlus, Copy, Check, Download, AlertTriangle, ArrowLeft,
} from 'lucide-react';

type CreateStep = 'warning' | 'keys' | null;

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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
    loginNsec,
    loginReadOnly,
    clearError,
  } = useAuthStore();

  const [bunkerUrl, setBunkerUrl] = useState('');
  const [showBunker, setShowBunker] = useState(false);

  // Create account wizard state
  const [createStep, setCreateStep] = useState<CreateStep>(null);
  const [keypair, setKeypair] = useState<{ secretKey: Uint8Array; publicKey: string } | null>(null);
  const [nsecStr, setNsecStr] = useState('');
  const [npubStr, setNpubStr] = useState('');
  const [copiedNsec, setCopiedNsec] = useState(false);
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [backedUp, setBackedUp] = useState(false);

  // Encrypted backup state
  const [showEncrypt, setShowEncrypt] = useState(false);
  const [encPassword, setEncPassword] = useState('');
  const [encConfirm, setEncConfirm] = useState('');
  const [encrypting, setEncrypting] = useState(false);
  const [encError, setEncError] = useState('');

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (isLoggedIn && !loading) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, loading, navigate]);

  const handleGenerateKeys = async () => {
    const kp = await generateNewKeypair();
    setKeypair(kp);
    setNsecStr(nip19.nsecEncode(kp.secretKey));
    setNpubStr(nip19.npubEncode(kp.publicKey));
    setCreateStep('keys');
  };

  const handleCopy = async (text: string, which: 'nsec' | 'npub') => {
    await navigator.clipboard.writeText(text);
    if (which === 'nsec') {
      setCopiedNsec(true);
      setBackedUp(true);
      setTimeout(() => setCopiedNsec(false), 2000);
    } else {
      setCopiedNpub(true);
      setTimeout(() => setCopiedNpub(false), 2000);
    }
  };

  const handleDownloadNsec = () => {
    downloadFile('nostr-nsec-backup.txt', nsecStr);
    setBackedUp(true);
  };

  const handleDownloadNcryptsec = async () => {
    if (encPassword !== encConfirm) {
      setEncError('Passwords do not match');
      return;
    }
    if (encPassword.length < 8) {
      setEncError('Password must be at least 8 characters');
      return;
    }
    if (!keypair) return;

    setEncrypting(true);
    setEncError('');
    try {
      const nip49 = await import('nostr-tools/nip49');
      const ncryptsec = nip49.encrypt(keypair.secretKey, encPassword);
      downloadFile('nostr-ncryptsec-backup.txt', ncryptsec);
      setBackedUp(true);
      setShowEncrypt(false);
    } catch (e: any) {
      setEncError(e.message || 'Encryption failed');
    } finally {
      setEncrypting(false);
    }
  };

  const handleContinueToApp = async () => {
    if (!keypair) return;
    await loginNsec(keypair.secretKey);
  };

  const handleCancelCreate = () => {
    setCreateStep(null);
    setKeypair(null);
    setNsecStr('');
    setNpubStr('');
    setCopiedNsec(false);
    setCopiedNpub(false);
    setBackedUp(false);
    setShowEncrypt(false);
    setEncPassword('');
    setEncConfirm('');
    setEncError('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <Loader2 className="animate-spin text-purple-500" size={48} />
      </div>
    );
  }

  // Create Account — Step 1: Warning
  if (createStep === 'warning') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <button
            onClick={handleCancelCreate}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft size={16} />
            Back to login
          </button>

          <div className="flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle size={28} className="text-amber-400" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-center">Create a New Nostr Identity</h2>

          <div className="space-y-3 text-sm text-zinc-300 leading-relaxed">
            <p>
              Nostr uses <strong className="text-white">cryptographic keys</strong> instead of usernames and passwords. Your identity is a key pair:
            </p>
            <ul className="space-y-2 ml-1">
              <li className="flex gap-2">
                <span className="text-green-400 font-bold shrink-0">npub</span>
                <span>— Your public key. Share it freely — it&apos;s your identity.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-400 font-bold shrink-0">nsec</span>
                <span>— Your private key. <strong className="text-white">NEVER share it.</strong> Anyone with it controls your account.</span>
              </li>
            </ul>
            <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3 text-red-300">
              <strong>There is no password reset.</strong> If you lose your nsec, you lose access to this account forever. No one can recover it for you.
            </div>
            <p className="text-zinc-400">
              You are solely responsible for backing up your key. We&apos;ll help you save it in the next step.
            </p>
          </div>

          <button
            onClick={handleGenerateKeys}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
          >
            I understand, generate my keys
          </button>
        </div>
      </div>
    );
  }

  // Create Account — Step 2: Key Display + Backup
  if (createStep === 'keys' && keypair) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-8">
        <div className="max-w-md w-full bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6 space-y-5">
          <button
            onClick={handleCancelCreate}
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft size={16} />
            Back to login
          </button>

          <h2 className="text-xl font-bold text-center">Your New Nostr Keys</h2>

          {/* npub */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-green-400">Public Key (npub) — safe to share</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 break-all select-all">
                {npubStr}
              </code>
              <button
                onClick={() => handleCopy(npubStr, 'npub')}
                className="shrink-0 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                title="Copy npub"
              >
                {copiedNpub ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-zinc-400" />}
              </button>
            </div>
          </div>

          {/* nsec */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-red-400">Private Key (nsec) — NEVER share</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-zinc-800 border border-red-900/50 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 break-all select-all">
                {nsecStr}
              </code>
              <button
                onClick={() => handleCopy(nsecStr, 'nsec')}
                className="shrink-0 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                title="Copy nsec"
              >
                {copiedNsec ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-zinc-400" />}
              </button>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-red-900/20 border border-red-800/50 rounded-lg p-3 text-red-300 text-sm">
            If you lose your nsec, you lose access to this account forever. There is no recovery.
          </div>

          {/* Download buttons */}
          <div className="space-y-3">
            <button
              onClick={handleDownloadNsec}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white py-2.5 px-4 rounded-xl font-semibold transition-colors"
            >
              <Download size={18} />
              Download nsec (plaintext)
            </button>

            <button
              onClick={() => setShowEncrypt(!showEncrypt)}
              className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white py-2.5 px-4 rounded-xl font-semibold transition-colors"
            >
              <Lock size={18} />
              Download encrypted backup (ncryptsec)
            </button>

            {showEncrypt && (
              <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 space-y-3">
                <p className="text-xs text-zinc-400">
                  Encrypt your key with a password (NIP-49). You&apos;ll need this password to decrypt it later.
                </p>
                <input
                  type="password"
                  placeholder="Password (min 8 characters)"
                  value={encPassword}
                  onChange={(e) => { setEncPassword(e.target.value); setEncError(''); }}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={encConfirm}
                  onChange={(e) => { setEncConfirm(e.target.value); setEncError(''); }}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500"
                />
                {encError && (
                  <p className="text-red-400 text-xs">{encError}</p>
                )}
                <button
                  onClick={handleDownloadNcryptsec}
                  disabled={encrypting || !encPassword || !encConfirm}
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2 px-4 rounded-lg font-semibold transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {encrypting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Encrypting...
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      Encrypt & Download
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Continue button */}
          <button
            onClick={handleContinueToApp}
            disabled={!backedUp}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
          >
            {backedUp ? 'Continue to app' : 'Back up your key first to continue'}
          </button>

          {!backedUp && (
            <p className="text-xs text-zinc-500 text-center">
              Copy or download your nsec to enable the continue button.
            </p>
          )}
        </div>
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

            {/* Create New Account */}
            <button
              onClick={() => setCreateStep('warning')}
              className="w-full flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
            >
              <UserPlus size={20} />
              Create New Account
            </button>

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
