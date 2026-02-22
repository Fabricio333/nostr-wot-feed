// Reference pubkey used as the WoT anchor for public statistics.
// Same value as src/constants/nostr.ts — duplicated here to avoid Vite path aliases.
export const REFERENCE_PUBKEY =
  'd9590d95a7811e1cb312be66edd664d7e3e6ed57822ad9f213ed620fc6748be8';

export const RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

export const WOT_ORACLE_URL = 'https://nostr-wot.com';
export const MAX_HOPS = 3;

export const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
export const LOOKBACK_SECONDS = 4 * 60 * 60; // 4 hours
export const TOP_HASHTAGS = 10;
export const TOP_POSTS = 10;
export const NOTE_FETCH_LIMIT = 500;
export const REACTION_FETCH_LIMIT = 1000;
export const SERVER_PORT = Number(process.env.PORT) || 3001;
