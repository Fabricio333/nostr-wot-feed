# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Nostr WTF** — A Nostr Web of Trust Feed application built with **Next.js 15 + React 18**. Uses Tailwind CSS v4 with shadcn/ui components, Zustand for state management, nostr-tools for the Nostr protocol, and next-intl for i18n.

## Commands

- **Dev server:** `npm run dev`
- **Build:** `npm run build`
- **Start production:** `npm start`
- **Tests:** No test framework configured yet.

## Architecture

- **Framework:** Next.js 15 (App Router with Turbopack) + React 18
- **Styling:** Tailwind CSS v4 (via @tailwindcss/postcss) + shadcn/ui (Radix UI primitives)
- **State:** Zustand 5 stores (feedStore, authStore, settingsStore, etc.)
- **Nostr:** nostr-tools for protocol, SimplePool for relay connections
- **i18n:** next-intl with `[locale]` route segment (en, es)
- **Entry:** `app/layout.tsx` → `app/[locale]/layout.tsx` → App Router
- **Path alias:** `@/` → `./` (configured in tsconfig.json)

### Key Directories

- `app/[locale]/(app)/` — App Router pages (Feed, Explore, Messages, Profile, etc.)
- `app/[locale]/login/` — Login page (outside AppShell layout)
- `app/api/` — Next.js API route handlers (trending, health)
- `components/` — All UI components, grouped by domain:
  - `feed/` — Feed, Explore, CreatePost
  - `note/` — NotePost, NoteActionsMenu, NoteThread
  - `messaging/` — Messages, Chat, ConversationRow
  - `profile/` — Profile, EditProfileDialog, FollowListDialog, ProfileActionsMenu, QRCodeDialog, PartnerAvatar
  - `auth/` — Login
  - `settings/` — Settings
  - `media/` — ClickableMedia, MediaLightbox, MediaGridItem
  - `layout/` — TrendingSidebar
  - `brand/` — WoTLogo, FeatureCard
  - `ui/` — shadcn/ui base primitives (Dialog, DropdownMenu, Input, etc.)
- `lib/` — Business logic, grouped by domain:
  - `nostr/` — relay, signer, actions, follows, dm, relayStats, eventBuffer, verifier, serverFetch, serverPool
  - `wot/` — wot, feed, mute, serverWot
  - `content/` — content, profiles, parentNotes, bookmarks, trending, serverTrending
  - `storage/` — db, settings, auth
  - `utils.ts` — cn() helper
- `stores/` — Zustand state stores
- `i18n/` — next-intl config (routing, request, navigation)
- `messages/` — Translation files (en.json, es.json)
- `types/` — TypeScript interfaces
- `utils/` — Helper functions
- `styles/` — Tailwind CSS, theme tokens, fonts

### Routing Structure

Uses Next.js App Router with `[locale]` segment for i18n:
- `/[locale]/` — Feed (home)
- `/[locale]/login` — Login (no AppShell)
- `/[locale]/note/[id]` — Note thread (with server-side OG metadata)
- `/[locale]/profile` — Own profile
- `/[locale]/profile/[handle]` — Other user profile (with server-side OG metadata)
- `/[locale]/messages` — DM list
- `/[locale]/messages/[id]` — Chat
- `/[locale]/create` — Create post
- `/[locale]/explore` — Explore/search
- `/[locale]/settings` — Settings
- `/api/trending` — GET trending data
- `/api/trending/refresh` — POST refresh trending
- `/api/health` — GET health check

### Navigation

Use `Link`, `useRouter`, `usePathname` from `@/i18n/navigation` (not from `next/navigation` directly) to ensure locale-aware routing. Use `useSearchParams` from `next/navigation`.

### Service Architecture

Services are singleton classes/modules in `lib/` (client-side only):
- `signer.ts` — NIP-07 (web) and NIP-46 (bunker) signing
- `auth.ts` — Session persistence with localStorage
- `relay.ts` — SimplePool relay management
- `wot.ts` — Trust scoring (extension + oracle fallback)
- `profiles.ts` — Kind 0 profile batch fetching (250ms debounce)
- `feed.ts` — Note processing, filtering, sorting
- `content.ts` — Content tokenizer (URLs, images, videos, mentions, hashtags)
- `mute.ts` — NIP-10000 mute list management

Server-side modules (prefixed with `server`) live alongside their client counterparts:
- `lib/nostr/serverFetch.ts` — Fetch notes/profiles from relays for SEO metadata
- `lib/nostr/serverPool.ts` — Server-side SimplePool for trending data
- `lib/wot/serverWot.ts` — Server-side WoT oracle for trending filtering
- `lib/content/serverTrending.ts` — Trending calculation with WoT filtering

### UI Patterns

- **AppShell** (`app/[locale]/AppShell.tsx`): Main layout wrapper with desktop sidebar, mobile bottom nav, and trending sidebar. Client component.
- **NoteActionsMenu**: Three-dot dropdown (top-right of each note) using Radix DropdownMenu.
- **Explore page**: Hashtag/npub search via relay `#t` tag filters + masonry media grid.
- **WoTLogo**: Reusable SVG component at `components/brand/WoTLogo.tsx`.

### Feed Loading Strategy

The feed uses **progressive streaming** — notes display immediately as they arrive from relays, not after a full batch loads:

1. **Initial fetch**: `INITIAL_LIMIT = 30` notes requested from relays
2. **Streaming render**: Notes render one-by-one as relay events arrive
3. **Scroll pagination**: `fetchMore()` in feedStore triggers relay querySync
4. **Deduplication**: `seenIds` Set prevents duplicates
5. **Following pagination**: Chunks pubkeys for followed authors

### Workarounds & Technical Notes

- **react-responsive-masonry**: No TypeScript types — declared in `types/modules.d.ts`
- **nostr-tools filter types**: Need `as any` casts for `#t` and `#p` tag filters
- **WoT extension detection**: Retries with delays (500, 1500, 3000ms)
- **All page components**: Must have `'use client'` directive since they use browser APIs
- **Server components**: Only used for layout shells, metadata generation, and page wrappers

## Pending
- Hardcode a trusted npub for when the user enter as a guest to see the global feed, allow all the ux to allow for that, the npub hardcoded I will added next, so all the posts that appear are from that account wot, so anyone can test the app.
