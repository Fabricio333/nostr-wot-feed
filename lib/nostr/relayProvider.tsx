'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Relay } from './relay';
import { QueryBatcher } from './queryBatcher';
import type { NostrEvent } from '@/types/nostr';

type RelayStatus = 'connected' | 'eose' | 'disconnected';

interface RelayPoolContext {
  // Status
  ready: boolean;
  connectedCount: number;
  totalRelays: number;
  relayStatuses: Map<string, boolean>;

  // Querying (wraps QueryBatcher + Relay.getUrls())
  query: (filter: Record<string, any>, opts?: { onUpdate?: (events: NostrEvent[]) => void }) => Promise<NostrEvent[]>;
  queryImmediate: (filter: Record<string, any>, opts?: { onUpdate?: (events: NostrEvent[]) => void }) => Promise<NostrEvent[]>;

  // Publishing
  publishEvent: (event: NostrEvent) => Promise<void>;

  // Feed lifecycle
  initFeed: (onEvent: (event: NostrEvent) => void, onStatus: (status: RelayStatus) => void) => void;
  subscribeFollowing: (pubkeys: string[], onEvent: (event: NostrEvent) => void, onEose?: () => void) => Promise<void>;
  fetchOlderNotes: (until: number, limit?: number, customSince?: number) => Promise<NostrEvent[]>;
  fetchOlderFollowingNotes: (pubkeys: string[], until: number, limit?: number, customSince?: number) => Promise<NostrEvent[]>;

  // Relay management
  addRelay: (url: string) => Promise<boolean>;
  removeRelay: (url: string) => Promise<boolean>;
  reconnect: () => void;
  resetRelays: (urls: string[]) => void;
  fetchUserRelays: (pubkey: string) => Promise<string[]>;
  refreshStatuses: () => void;
  getUrls: () => string[];
}

const defaultCtx: RelayPoolContext = {
  ready: false,
  connectedCount: 0,
  totalRelays: 0,
  relayStatuses: new Map(),
  query: () => Promise.resolve([]),
  queryImmediate: () => Promise.resolve([]),
  publishEvent: () => Promise.resolve(),
  initFeed: () => {},
  subscribeFollowing: () => Promise.resolve(),
  fetchOlderNotes: () => Promise.resolve([]),
  fetchOlderFollowingNotes: () => Promise.resolve([]),
  addRelay: () => Promise.resolve(false),
  removeRelay: () => Promise.resolve(false),
  reconnect: () => {},
  resetRelays: () => {},
  fetchUserRelays: () => Promise.resolve([]),
  refreshStatuses: () => {},
  getUrls: () => [],
};

const RelayPoolCtx = createContext<RelayPoolContext>(defaultCtx);

export function useRelayPool(): RelayPoolContext {
  return useContext(RelayPoolCtx);
}

export function RelayPoolProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connectedCount, setConnectedCount] = useState(0);
  const [totalRelays, setTotalRelays] = useState(0);
  const [relayStatuses, setRelayStatuses] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    // Create pool eagerly so any page can query relays immediately
    Relay.ensurePool();
    setReady(true);

    // Eagerly connect to all configured relays
    const urls = Relay.getUrls();
    setTotalRelays(urls.length);
    for (const url of urls) {
      try {
        (Relay.pool as any).ensureRelay(url).catch(() => {});
      } catch {
        // ensureRelay not available or failed
      }
    }

    // Sync connected count and statuses from Relay's status tracking
    const syncStatus = () => {
      setConnectedCount(Relay.getConnectedCount());
      setTotalRelays(Relay.getUrls().length);
      setRelayStatuses(new Map(Relay.relayStatuses));
    };
    const prevHandler = Relay.onRelayStatusChange;
    Relay.onRelayStatusChange = () => {
      prevHandler?.();
      syncStatus();
    };
    syncStatus();

    return () => {
      Relay.onRelayStatusChange = prevHandler;
    };
  }, []);

  // --- Querying ---

  const query = useCallback(
    (filter: Record<string, any>, opts?: { onUpdate?: (events: NostrEvent[]) => void }) =>
      QueryBatcher.query(Relay.getUrls(), filter, opts),
    []
  );

  const queryImmediate = useCallback(
    (filter: Record<string, any>, opts?: { onUpdate?: (events: NostrEvent[]) => void }) =>
      QueryBatcher.queryImmediate(Relay.getUrls(), filter, opts),
    []
  );

  // --- Publishing ---

  const publishEvent = useCallback(
    (event: NostrEvent) => Relay.publishEvent(event),
    []
  );

  // --- Feed lifecycle ---

  const initFeed = useCallback(
    (onEvent: (event: NostrEvent) => void, onStatus: (status: RelayStatus) => void) =>
      Relay.init(onEvent, onStatus),
    []
  );

  const subscribeFollowing = useCallback(
    (pubkeys: string[], onEvent: (event: NostrEvent) => void, onEose?: () => void) =>
      Relay.subscribeFollowing(pubkeys, onEvent, onEose),
    []
  );

  const fetchOlderNotes = useCallback(
    (until: number, limit?: number, customSince?: number) =>
      Relay.fetchOlderNotes(until, limit, customSince),
    []
  );

  const fetchOlderFollowingNotes = useCallback(
    (pubkeys: string[], until: number, limit?: number, customSince?: number) =>
      Relay.fetchOlderFollowingNotes(pubkeys, until, limit, customSince),
    []
  );

  // --- Relay management ---

  const addRelay = useCallback(
    (url: string) => Relay.addRelay(url),
    []
  );

  const removeRelay = useCallback(
    (url: string) => Relay.removeRelay(url),
    []
  );

  const reconnect = useCallback(() => {
    Relay.reconnect();
  }, []);

  const resetRelays = useCallback((urls: string[]) => {
    // Settings store handles persisting; just reconnect relay
    Relay.reconnect();
  }, []);

  const fetchUserRelays = useCallback(
    (pubkey: string) => Relay.fetchUserRelays(pubkey),
    []
  );

  const refreshStatuses = useCallback(() => {
    Relay.refreshStatuses();
  }, []);

  const getUrls = useCallback(() => Relay.getUrls(), []);

  const value: RelayPoolContext = {
    ready,
    connectedCount,
    totalRelays,
    relayStatuses,
    query,
    queryImmediate,
    publishEvent,
    initFeed,
    subscribeFollowing,
    fetchOlderNotes,
    fetchOlderFollowingNotes,
    addRelay,
    removeRelay,
    reconnect,
    resetRelays,
    fetchUserRelays,
    refreshStatuses,
    getUrls,
  };

  return (
    <RelayPoolCtx.Provider value={value}>
      {children}
    </RelayPoolCtx.Provider>
  );
}
