import { useEffect, useRef, useState, useCallback } from 'react';

const PULL_THRESHOLD = 80;
const MAX_PULL = 120;

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  getScrollContainer: () => HTMLElement | null;
}

export function usePullToRefresh({ onRefresh, getScrollContainer }: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      // Give relay time to reconnect and start streaming
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      }, 1000);
    }
  }, [onRefresh]);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (container.scrollTop <= 0) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullingRef.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      if (diff > 0 && container.scrollTop <= 0) {
        // Apply resistance: distance diminishes as you pull further
        const distance = Math.min(diff * 0.5, MAX_PULL);
        setPullDistance(distance);
        if (distance > 10) {
          e.preventDefault();
        }
      } else {
        pullingRef.current = false;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) return;
      pullingRef.current = false;

      if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
        handleRefresh();
      } else {
        setPullDistance(0);
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [getScrollContainer, isRefreshing, pullDistance, handleRefresh]);

  return { pullDistance, isRefreshing, threshold: PULL_THRESHOLD };
}
