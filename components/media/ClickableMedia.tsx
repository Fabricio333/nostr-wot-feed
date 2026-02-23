import React from 'react';
import { useLightboxStore, type LightboxItem } from '@/stores/lightboxStore';

interface ClickableMediaProps {
  items: LightboxItem[];
  index: number;
  children: React.ReactElement;
  className?: string;
}

export function ClickableMedia({ items, index, children, className }: ClickableMediaProps) {
  const open = useLightboxStore((s) => s.open);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    open(items, index);
  };

  return (
    <div
      className={className}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(items, index);
        }
      }}
      style={{ cursor: 'zoom-in' }}
    >
      {children}
    </div>
  );
}
