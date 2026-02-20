import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Trash2, Plus, Shield, User, X } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useWoTStore } from '@/stores/wotStore';
import { useProfileStore } from '@/stores/profileStore';
import { Relay } from '@/services/relay';
import { Mute } from '@/services/mute';
import { Profiles } from '@/services/profiles';
import { Signer } from '@/services/signer';
import { truncateNpub, pubkeyColor } from '@/utils/helpers';
import { nip19 } from 'nostr-tools';
import type { SortMode } from '@/types/nostr';

export function Settings() {
  const navigate = useNavigate();
  const settings = useSettingsStore();
  const { pubkey, logout } = useAuthStore();
  const { hasExtension } = useWoTStore();
  const { updateTick } = useProfileStore();
  const [newRelay, setNewRelay] = useState('');

  let npubDisplay = '';
  if (pubkey) {
    try {
      npubDisplay = nip19.npubEncode(pubkey);
    } catch {
      npubDisplay = pubkey;
    }
  }

  const handleAddRelay = () => {
    const url = newRelay.trim();
    if (!url || !url.startsWith('wss://')) return;
    settings.addRelay(url);
    Relay.addRelay(url);
    setNewRelay('');
  };

  const handleRemoveRelay = (url: string) => {
    settings.removeRelay(url);
    Relay.removeRelay(url);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const mutedPubkeys = [...Mute.list];

  return (
    <div className="bg-black min-h-screen text-white pb-20 md:pb-0">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-zinc-800 p-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-full hover:bg-zinc-800 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      <div className="max-w-xl mx-auto p-4 space-y-6">

        {/* Feed Settings */}
        <Section title="Feed">
          <SelectRow
            label="Sort Mode"
            value={settings.sortMode}
            options={[
              { value: 'trust-desc', label: 'Trusted First' },
              { value: 'trust-asc', label: 'Least Trusted First' },
              { value: 'newest', label: 'Newest First' },
              { value: 'oldest', label: 'Oldest First' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(v) => settings.setSortMode(v as SortMode)}
          />
          <NumberRow
            label="Max Notes"
            value={settings.maxNotes}
            min={50}
            max={500}
            step={50}
            onChange={(v) => settings.set('maxNotes', v)}
          />
          <NumberRow
            label="Time Window (hours)"
            value={settings.timeWindow}
            min={1}
            max={48}
            step={1}
            onChange={(v) => settings.set('timeWindow', v)}
          />
          <ToggleRow
            label="Trusted Only"
            description="Only show notes from users in your WoT"
            checked={settings.trustedOnly}
            onChange={(v) => settings.setTrustedOnly(v)}
          />
          <ToggleRow
            label="Compact Mode"
            description="Show notes in a compact view"
            checked={settings.compactMode}
            onChange={(v) => settings.set('compactMode', v)}
          />
        </Section>

        {/* Trust Settings */}
        <Section title="Trust">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className={hasExtension ? 'text-green-400' : 'text-zinc-600'} />
            <span className={hasExtension ? 'text-green-400 text-sm' : 'text-zinc-500 text-sm'}>
              {hasExtension ? 'WoT Extension Detected' : 'WoT Extension Not Found'}
            </span>
          </div>
          <SliderRow
            label="Max Hops"
            value={settings.maxHops}
            min={1}
            max={6}
            step={1}
            display={`${settings.maxHops} hop${settings.maxHops > 1 ? 's' : ''}`}
            onChange={(v) => settings.setMaxHops(v)}
          />
          <SliderRow
            label="Trust Weight"
            value={Math.round(settings.trustWeight * 100)}
            min={0}
            max={100}
            step={5}
            display={`${Math.round(settings.trustWeight * 100)}%`}
            onChange={(v) => settings.set('trustWeight', v / 100)}
          />
          <SliderRow
            label="Trust Threshold"
            value={settings.trustThreshold}
            min={0}
            max={100}
            step={5}
            display={`${settings.trustThreshold}%`}
            onChange={(v) => settings.set('trustThreshold', v)}
          />
          <ToggleRow
            label="Show Trust Footer"
            description="Display trust info on each note"
            checked={settings.showTrustFooter}
            onChange={(v) => settings.set('showTrustFooter', v)}
          />
        </Section>

        {/* Relays */}
        <Section title="Relays">
          <div className="space-y-2">
            {settings.relays.map((url) => (
              <div key={url} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                <span className="text-sm text-zinc-300 truncate flex-1 mr-2 font-mono">{url}</span>
                <button
                  onClick={() => handleRemoveRelay(url)}
                  className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                  disabled={settings.relays.length <= 1}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <input
              type="text"
              value={newRelay}
              onChange={(e) => setNewRelay(e.target.value)}
              placeholder="wss://relay.example.com"
              className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
              onKeyDown={(e) => e.key === 'Enter' && handleAddRelay()}
            />
            <button
              onClick={handleAddRelay}
              className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <Plus size={18} />
            </button>
          </div>
        </Section>

        {/* Muted Users */}
        <Section title="Muted Users">
          {mutedPubkeys.length === 0 ? (
            <p className="text-zinc-500 text-sm">No muted users</p>
          ) : (
            <div className="space-y-2">
              {mutedPubkeys.map((pk) => (
                <MutedUserRow key={pk} pubkey={pk} />
              ))}
            </div>
          )}
        </Section>

        {/* Account */}
        <Section title="Account">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-sm">Login Method</span>
              <span className="text-sm font-medium text-zinc-200">
                {Signer.getBackend() === 'nip07' ? 'NIP-07 Extension' :
                 Signer.getBackend() === 'nip46' ? 'NIP-46 Bunker' :
                 Signer.getBackend() === 'readonly' ? 'Read Only' : 'Not logged in'}
              </span>
            </div>
            {npubDisplay && (
              <div
                className="p-2 bg-zinc-800 rounded-lg text-xs text-zinc-500 font-mono truncate cursor-pointer hover:text-zinc-300"
                onClick={() => navigator.clipboard.writeText(npubDisplay)}
                title="Click to copy npub"
              >
                {npubDisplay}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="w-full py-2.5 bg-red-900/30 hover:bg-red-900/50 border border-red-800 text-red-300 rounded-lg text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </div>
        </Section>

        {/* Debug */}
        <Section title="Debug">
          <ToggleRow
            label="Show Debug Info"
            description="Display debug information in the UI"
            checked={settings.showDebug}
            onChange={(v) => settings.set('showDebug', v)}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4">
      <h2 className="text-lg font-bold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-purple-600' : 'bg-zinc-700'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm text-zinc-200">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-800 text-sm text-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function NumberRow({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm text-zinc-200">{label}</p>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-zinc-800 text-sm text-zinc-200 rounded-lg px-3 py-1.5 w-24 text-right focus:outline-none focus:ring-1 focus:ring-purple-500"
      />
    </div>
  );
}

function SliderRow({ label, value, min, max, step, display, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-zinc-200">{label}</p>
        <span className="text-sm text-purple-400 font-medium">{display}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-purple-600"
      />
    </div>
  );
}

function MutedUserRow({ pubkey }: { pubkey: string }) {
  const profile = Profiles.get(pubkey);
  const { updateTick } = useProfileStore();
  const name = profile?.displayName || profile?.name || truncateNpub(pubkey);
  const avatarUrl = profile?.picture || '';
  const fallbackColor = pubkeyColor(pubkey);

  return (
    <div className="flex items-center gap-3 bg-zinc-800 rounded-lg px-3 py-2">
      <div
        className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
        style={!avatarUrl ? { backgroundColor: fallbackColor } : undefined}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <User size={14} className="text-white/60" />
        )}
      </div>
      <span className="text-sm text-zinc-300 truncate flex-1">{name}</span>
      <button
        onClick={() => Mute.unmute(pubkey)}
        className="text-zinc-500 hover:text-green-400 transition-colors p-1"
        title="Unmute"
      >
        <X size={16} />
      </button>
    </div>
  );
}
