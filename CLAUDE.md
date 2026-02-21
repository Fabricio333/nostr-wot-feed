# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Nostr WTF** — A Nostr Web of Trust Feed application built with **Vite + React 18** for the web. Uses Tailwind CSS v4 with shadcn/ui components, Zustand for state management, and nostr-tools for the Nostr protocol.

## Commands

- **Dev server:** `npm run dev`
- **Build:** `npm run build`
- **Preview:** `npm run preview`
- **Legacy web app:** `cd legacy-web && node index.js`
- **Tests:** No test framework configured yet.

## Architecture

- **Framework:** Vite 6 + React 18 + React Router 7
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix UI primitives)
- **State:** Zustand 5 stores (feedStore, authStore, settingsStore, etc.)
- **Nostr:** nostr-tools for protocol, SimplePool for relay connections
- **Entry:** `src/main.tsx` → `src/app/App.tsx` → React Router
- **Path alias:** `@/` → `./src/` (configured in vite.config.ts)
- **Legacy:** Original vanilla JS web app preserved in `legacy-web/`

### Key Directories

- `src/app/pages/` — Route page components (Feed, Explore, Messages, Profile, etc.)
- `src/app/components/` — Reusable UI components (NotePost, NoteActionsMenu, WoTLogo, etc.)
- `src/app/components/ui/` — shadcn/ui base primitives (Button, DropdownMenu, Dialog, etc.)
- `src/services/` — Business logic singletons (relay, wot, profiles, feed, content, mute, etc.)
- `src/stores/` — Zustand state stores
- `src/types/` — TypeScript interfaces
- `src/utils/` — Helper functions
- `src/styles/` — Tailwind CSS, theme tokens, fonts
- `Design/` — Reference design system (kept for reference)

### Service Architecture

Services are singleton classes/modules in `services/`:
- `signer.ts` — NIP-07 (web) and NIP-46 (bunker) signing
- `auth.ts` — Session persistence with localStorage
- `relay.ts` — SimplePool relay management
- `wot.ts` — Trust scoring (extension + oracle fallback)
- `profiles.ts` — Kind 0 profile batch fetching (250ms debounce)
- `feed.ts` — Note processing, filtering, sorting
- `content.ts` — Content tokenizer (URLs, images, videos, mentions, hashtags)
- `mute.ts` — NIP-10000 mute list management

### UI Patterns

- **NoteActionsMenu**: Three-dot dropdown (top-right of each note) using Radix DropdownMenu. Contains: Copy Event ID, Copy Content, Copy Author npub, Open in njump.me, Mute/Unmute. Uses `sonner` toasts for copy feedback.
- **Explore page**: Hashtag/npub search via relay `#t` tag filters + Instagram-style masonry media grid using `react-responsive-masonry`.
- **WoTLogo**: Reusable SVG component at `src/app/components/WoTLogo.tsx` — the WoT graph logo used in headers.

### Feed Loading Strategy

The feed uses **progressive streaming** — notes display immediately as they arrive from relays, not after a full batch loads:

1. **Initial fetch**: `INITIAL_LIMIT = 30` notes requested from relays (small batch for fast first render)
2. **Streaming render**: Notes render one-by-one as relay events arrive. No full-screen loading gate.
3. **Scroll pagination**: When the user scrolls past all loaded notes, `fetchMore()` in feedStore triggers `Relay.fetchOlderNotes()` — a one-shot `querySync` using `until: oldest_note_timestamp` as cursor.
4. **Throttling**: A 2-second cooldown (`FETCH_COOLDOWN_MS`) between relay pagination requests prevents saturation.
5. **Deduplication**: `seenIds` Set in feedStore ensures no duplicate notes across initial load, pagination, and live events.
6. **Time window end**: When no more notes exist within the configured time window, a "No more posts in the last N hours" prompt appears with a "Load older posts" button that extends the window by 7 days.
7. **Following pagination**: `Relay.fetchOlderFollowingNotes()` paginates for followed authors specifically, chunking pubkeys to avoid relay filter limits.

### Workarounds & Technical Notes

- **Explore infinite scroll + deduplication**: The media grid in Explore uses `gridLimit` state with an IntersectionObserver sentinel. A `displayedIdsRef` (Set) tracks shown note IDs to prevent duplicates when new notes stream in. The grid limit increments by `GRID_PAGE_SIZE` (30) on each scroll.
- **Feed infinite scroll**: Uses the same sentinel pattern in Feed.tsx with `displayLimit` from feedStore + relay pagination via `fetchMore()`.
- **Sonner toast fix**: The shadcn/ui `sonner.tsx` ships with `next-themes` import which fails in Vite. Fixed by removing the import and hardcoding `theme="dark"`.
- **nostr-tools filter types**: Need `as any` casts for `#t` (hashtag) and `#p` tag filters due to strict TypeScript types in nostr-tools.
- **WoT extension detection**: Retries with delays (500, 1500, 3000ms) because the extension may load after the page.
- **react-responsive-masonry**: No TypeScript types shipped — relies on Vite's implicit any for untyped modules.

## Pending
- Hardcode a trusted npub for when the user enter as a guest to see the global feed, allow all the ux to allow for that, the npub hardcoded I will added next, so all the posts that appear are from that account wot, so anyone can test the app.