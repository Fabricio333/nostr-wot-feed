import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface QRCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  npub: string;
  displayName: string;
}

export function QRCodeDialog({ open, onOpenChange, npub, displayName }: QRCodeDialogProps) {
  const copyNpub = () => {
    navigator.clipboard.writeText(npub);
    toast.success('npub copied');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white text-center">{displayName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="bg-white p-4 rounded-xl">
            <QRCodeSVG
              value={npub}
              size={200}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
          <div
            className="w-full p-2 bg-zinc-800 rounded-lg text-xs text-zinc-400 font-mono truncate cursor-pointer hover:text-zinc-200 text-center transition-colors"
            onClick={copyNpub}
            title="Click to copy npub"
          >
            {npub}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
