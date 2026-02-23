import { useEffect, type RefObject } from 'react';

/**
 * Save and restore scroll position across navigation.
 * Uses sessionStorage keyed by a string identifier.
 */
export function useScrollRestoration(
  key: string,
  containerRef: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Restore on mount
    const saved = sessionStorage.getItem(`scroll-${key}`);
    if (saved) {
      const pos = parseInt(saved, 10);
      if (!isNaN(pos)) {
        requestAnimationFrame(() => {
          container.scrollTop = pos;
        });
      }
    }

    // Save on scroll (debounced)
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        sessionStorage.setItem(`scroll-${key}`, String(container.scrollTop));
      }, 200);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    };
  }, [key, containerRef]);
}
