import { Signer, generateClientSecret } from './signer';
import { bytesToHex, hexToBytes } from '@/utils/helpers';
import type { SignerBackend } from '@/types/nostr';

const AUTH_KEY = 'wot-feed-auth';

interface AuthSession {
  method: SignerBackend;
  bunkerInput?: string;
  clientSecret?: string;
  secretHex?: string;
}

export function saveSession(data: AuthSession): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function loadSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
}

export async function tryRestoreSession(): Promise<{
  success: boolean;
  method?: SignerBackend;
  error?: string;
}> {
  const saved = loadSession();
  if (!saved) return { success: false };

  try {
    if (saved.method === 'nip07') {
      const hasExt = await detectExtension(true);
      if (hasExt) {
        await Signer.initNip07();
        return { success: true, method: 'nip07' };
      }
      clearSession();
      return { success: false, error: 'Extension not found' };
    }

    if (saved.method === 'nip46' && saved.bunkerInput && saved.clientSecret) {
      await Signer.reconnectNip46(saved.bunkerInput, saved.clientSecret);
      return { success: true, method: 'nip46' };
    }

    if (saved.method === 'nsec' && saved.secretHex) {
      const secretBytes = hexToBytes(saved.secretHex);
      await Signer.initNsec(secretBytes);
      return { success: true, method: 'nsec' };
    }

    if (saved.method === 'readonly') {
      Signer.setReadOnly();
      return { success: true, method: 'readonly' };
    }
  } catch (e: any) {
    clearSession();
    return { success: false, error: e.message };
  }

  return { success: false };
}

export async function loginWithExtension(): Promise<string> {
  const pubkey = await Signer.initNip07();
  saveSession({ method: 'nip07' });
  return pubkey;
}

export async function loginWithBunker(input: string): Promise<string> {
  const { secretKey } = await generateClientSecret();
  const secretHex = bytesToHex(secretKey);
  const pubkey = await Signer.initNip46(input, secretKey);
  saveSession({
    method: 'nip46',
    bunkerInput: input,
    clientSecret: secretHex,
  });
  return pubkey;
}

export async function loginWithNsec(secretKey: Uint8Array): Promise<string> {
  const pubkey = await Signer.initNsec(secretKey);
  const secretHex = bytesToHex(secretKey);
  saveSession({ method: 'nsec', secretHex });
  return pubkey;
}

export async function loginReadOnly(): Promise<void> {
  Signer.setReadOnly();
  saveSession({ method: 'readonly' });
}

export async function logout(): Promise<void> {
  Signer.disconnect();
  clearSession();
}

export async function detectExtension(quick = false): Promise<boolean> {
  const w = window as any;
  if (w.nostr) return true;
  const delays = quick ? [100, 400] : [200, 500, 1000];
  for (const d of delays) {
    await new Promise((r) => setTimeout(r, d));
    if (w.nostr) return true;
  }
  return false;
}
