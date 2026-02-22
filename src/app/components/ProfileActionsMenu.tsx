import React from 'react';
import { MoreHorizontal, Copy, Hash, Share2, ExternalLink, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/app/components/ui/dropdown-menu';

interface ProfileActionsMenuProps {
  pubkey: string;
  npub: string;
  onShowQR: () => void;
}

export function ProfileActionsMenu({ pubkey, npub, onShowQR }: ProfileActionsMenuProps) {
  const copyNpub = () => {
    navigator.clipboard.writeText(npub);
    toast.success('npub copied');
  };

  const copyHex = () => {
    navigator.clipboard.writeText(pubkey);
    toast.success('Hex pubkey copied');
  };

  const shareProfileUrl = () => {
    const url = `${window.location.origin}/profile/${npub}`;
    navigator.clipboard.writeText(url);
    toast.success('Profile URL copied');
  };

  const openInNjump = () => {
    window.open(`https://njump.me/${npub}`, '_blank');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-2 rounded-full text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors border border-zinc-600"
          aria-label="Profile options"
        >
          <MoreHorizontal size={18} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={copyNpub}>
          <Copy size={14} />
          Copy npub
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyHex}>
          <Hash size={14} />
          Copy hex pubkey
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={shareProfileUrl}>
          <Share2 size={14} />
          Share profile URL
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openInNjump}>
          <ExternalLink size={14} />
          Open in njump.me
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onShowQR}>
          <QrCode size={14} />
          Show QR Code
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
