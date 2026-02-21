import React, { useEffect, useCallback, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLightboxStore } from '@/stores/lightboxStore';

export function MediaLightbox() {
  const { isOpen, items, currentIndex, close, next, prev } = useLightboxStore();
  const current = items[currentIndex];

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, next, prev]);

  // Touch swipe
  const touchStartX = useRef<number | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(diff) > 50) {
      if (diff < 0) next();
      else prev();
    }
    touchStartX.current = null;
  }, [next, prev]);

  if (!current) return null;

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[100] bg-black/95 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[100] flex items-center justify-center outline-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <DialogPrimitive.Title className="sr-only">Media viewer</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Viewing media {currentIndex + 1} of {items.length}
          </DialogPrimitive.Description>

          {/* Close */}
          <DialogPrimitive.Close
            className="absolute top-4 right-4 z-[101] p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
          >
            <X size={24} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          {/* Counter */}
          {items.length > 1 && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[101] text-white/80 text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
              {currentIndex + 1} / {items.length}
            </div>
          )}

          {/* Prev */}
          {items.length > 1 && currentIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); prev(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-[101] p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <ChevronLeft size={28} />
            </button>
          )}

          {/* Next */}
          {items.length > 1 && currentIndex < items.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); next(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-[101] p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <ChevronRight size={28} />
            </button>
          )}

          {/* Media area — click backdrop to close */}
          <div className="w-full h-full flex items-center justify-center p-4 md:p-8" onClick={close}>
            {current.type === 'image' ? (
              <img
                src={current.src}
                alt=""
                className="max-w-full max-h-full object-contain select-none"
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              />
            ) : (
              <video
                src={current.src}
                controls
                autoPlay
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>

          {/* Dot indicators */}
          {items.length > 1 && items.length <= 10 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[101] flex gap-2">
              {items.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => useLightboxStore.getState().goTo(idx)}
                  className={cn(
                    'w-2 h-2 rounded-full transition-all',
                    idx === currentIndex
                      ? 'bg-white w-3'
                      : 'bg-white/40 hover:bg-white/60'
                  )}
                />
              ))}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
