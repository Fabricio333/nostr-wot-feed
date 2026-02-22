import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Textarea } from '@/app/components/ui/textarea';
import { Label } from '@/app/components/ui/label';
import { Signer } from '@/services/signer';
import { Relay } from '@/services/relay';
import { Profiles } from '@/services/profiles';
import type { Profile, UnsignedEvent } from '@/types/nostr';

interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProfile: Profile | null;
  pubkey: string;
}

export function EditProfileDialog({ open, onOpenChange, currentProfile, pubkey }: EditProfileDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [about, setAbout] = useState('');
  const [picture, setPicture] = useState('');
  const [banner, setBanner] = useState('');
  const [nip05, setNip05] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && currentProfile) {
      setDisplayName(currentProfile.displayName || '');
      setUsername(currentProfile.name || '');
      setAbout(currentProfile.about || '');
      setPicture(currentProfile.picture || '');
      setBanner(currentProfile.banner || '');
      setNip05(currentProfile.nip05 || '');
    }
  }, [open, currentProfile]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);

    try {
      // Fetch existing kind 0 to preserve extra fields (lud16, website, etc.)
      let existingMeta: Record<string, any> = {};
      try {
        if (Relay.pool) {
          const events = await Relay.pool.querySync(Relay.getUrls(), {
            kinds: [0],
            authors: [pubkey],
            limit: 1,
          });
          if (events.length > 0) {
            events.sort((a, b) => b.created_at - a.created_at);
            existingMeta = JSON.parse(events[0].content);
          }
        }
      } catch {
        // use empty if fetch fails
      }

      const content = JSON.stringify({
        ...existingMeta,
        name: username.trim(),
        display_name: displayName.trim(),
        about: about.trim(),
        picture: picture.trim(),
        banner: banner.trim(),
        nip05: nip05.trim(),
      });

      const unsignedEvent: UnsignedEvent = {
        kind: 0,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      };

      const signed = await Signer.signEvent(unsignedEvent);
      await Relay.publishEvent(signed);

      // Update local cache immediately
      const updatedProfile: Profile = {
        name: username.trim(),
        displayName: displayName.trim(),
        about: about.trim(),
        picture: picture.trim(),
        banner: banner.trim(),
        nip05: nip05.trim(),
      };
      Profiles.updateLocal(pubkey, updatedProfile);

      toast.success('Profile updated');
      onOpenChange(false);
    } catch (err) {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Edit Profile</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-zinc-300">Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Username</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">@</span>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 pl-8"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">About</Label>
            <Textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Tell the world about yourself"
              rows={4}
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Profile Picture URL</Label>
            <Input
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
              placeholder="https://example.com/avatar.jpg"
              type="url"
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Banner URL</Label>
            <Input
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
              placeholder="https://example.com/banner.jpg"
              type="url"
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">NIP-05 Identifier</Label>
            <Input
              value={nip05}
              onChange={(e) => setNip05(e.target.value)}
              placeholder="you@example.com"
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 bg-transparent border border-zinc-600 rounded-full text-white hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-white text-black rounded-full font-bold hover:bg-zinc-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
