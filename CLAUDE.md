# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Nostr Web of Trust (WoT) feed application built with **Expo (React Native)** for cross-platform support (Web, iOS, Android). Uses NativeWind (Tailwind for RN), Zustand for state management, and nostr-tools for the Nostr protocol.

## Commands

- **Start (all platforms):** `npx expo start`
- **Web:** `npx expo start --web`
- **iOS:** `npx expo start --ios`
- **Android:** `npx expo start --android`
- **Legacy web app:** `cd legacy-web && node index.js`
- **Tests:** No test framework configured yet.

## Architecture

- **Framework:** Expo SDK 52 + expo-router (file-based routing)
- **Styling:** NativeWind v4 (Tailwind CSS for React Native)
- **State:** Zustand stores (feedStore, authStore, settingsStore, etc.)
- **Nostr:** nostr-tools for protocol, SimplePool for relay connections
- **Entry:** `app/_layout.tsx` (Expo Router root layout)
- **Legacy:** Original vanilla JS web app preserved in `legacy-web/`

### Key Directories

- `app/` — Expo Router screens (tabs + stack navigation)
- `components/` — Reusable UI components (ui/ for base, feature components at root)
- `services/` — Business logic (settings, auth, relay, wot, profiles, feed, etc.)
- `stores/` — Zustand state stores
- `hooks/` — Custom React hooks
- `theme/` — Color tokens, typography, spacing
- `types/` — TypeScript interfaces
- `utils/` — Helper functions
- `Design/` — Reference design system (React + Tailwind + shadcn/ui)

### Service Architecture

Services are singleton classes/modules in `services/`:
- `signer.ts` — NIP-07 (web) and NIP-46 (bunker) signing
- `auth.ts` — Session persistence with AsyncStorage
- `relay.ts` — SimplePool relay management
- `wot.ts` — Trust scoring (extension + oracle fallback)
- `profiles.ts` — Kind 0 profile batch fetching
- `feed.ts` — Note processing, filtering, sorting
- `content.ts` — Content tokenizer (URLs, mentions, hashtags)
