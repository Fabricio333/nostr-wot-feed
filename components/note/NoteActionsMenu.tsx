import React from 'react';
import { MoreHorizontal, Copy, FileText, User, VolumeX, Volume2, ExternalLink } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface NoteActionsMenuProps {
  noteId: string;
  pubkey: string;
  content: string;
  isMuted: boolean;
  onMuteToggle: (e: React.MouseEvent) => void;
}

export function NoteActionsMenu({ noteId, pubkey, content, isMuted, onMuteToggle }: NoteActionsMenuProps) {
  const copyEventId = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nevent = nip19.neventEncode({ id: noteId });
      navigator.clipboard.writeText(nevent);
      toast.success('Event ID copied');
    } catch {
      navigator.clipboard.writeText(noteId);
      toast.success('Event ID copied (hex)');
    }
  };

  const copyContent = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(content);
    toast.success('Content copied');
  };

  const copyNpub = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const npub = nip19.npubEncode(pubkey);
      navigator.clipboard.writeText(npub);
      toast.success('Author npub copied');
    } catch {
      navigator.clipboard.writeText(pubkey);
      toast.success('Author pubkey copied');
    }
  };

  const openInNewTab = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nevent = nip19.neventEncode({ id: noteId });
      window.open(`https://njump.me/${nevent}`, '_blank');
    } catch {
      window.open(`https://njump.me/e/${noteId}`, '_blank');
    }
  };

  const handleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMuteToggle(e);
    toast.success(isMuted ? 'User unmuted' : 'User muted');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1.5 rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          onClick={(e) => e.stopPropagation()}
          aria-label="More options"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onClick={copyEventId}>
          <Copy size={14} />
          Copy Event ID
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyContent}>
          <FileText size={14} />
          Copy Content
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyNpub}>
          <User size={14} />
          Copy Author npub
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openInNewTab}>
          <ExternalLink size={14} />
          Open in njump.me
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleMute}
          variant={isMuted ? "default" : "destructive"}
        >
          {isMuted ? <Volume2 size={14} /> : <VolumeX size={14} />}
          {isMuted ? 'Unmute User' : 'Mute User'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
