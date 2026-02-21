import { SimplePool } from 'nostr-tools';
import type { NostrEvent, UnsignedEvent, SignerBackend } from '@/types/nostr';
import { hexToBytes } from '@/utils/helpers';

let BunkerSigner: any;
let parseBunkerInput: any;
let generateSecretKey: any;
let getPublicKeyFromSecret: any;

async function loadNip46() {
  if (!BunkerSigner) {
    const nip46 = await import('nostr-tools/nip46');
    BunkerSigner = nip46.BunkerSigner;
    parseBunkerInput = nip46.parseBunkerInput;
    const pure = await import('nostr-tools/pure');
    generateSecretKey = pure.generateSecretKey;
    getPublicKeyFromSecret = pure.getPublicKey;
  }
}

class SignerService {
  private _backend: SignerBackend = null;
  private _pubkey: string | null = null;
  private _bunkerSigner: any = null;
  private _secretKey: Uint8Array | null = null;

  isLoggedIn(): boolean {
    return this._backend !== null;
  }

  isReadOnly(): boolean {
    return this._backend === 'readonly';
  }

  getBackend(): SignerBackend {
    return this._backend;
  }

  async initNip07(): Promise<string> {
    const w = window as any;
    if (!w.nostr) throw new Error('No NIP-07 extension found');
    this._pubkey = await w.nostr.getPublicKey();
    this._backend = 'nip07';
    return this._pubkey!;
  }

  async initNip46(input: string, clientSecretKey: Uint8Array): Promise<string> {
    await loadNip46();
    const pool = new SimplePool();
    const parsed = await parseBunkerInput(input);
    if (!parsed) throw new Error('Invalid bunker input');
    const signer = new BunkerSigner(clientSecretKey, parsed, { pool });
    await signer.connect();
    this._bunkerSigner = signer;
    this._pubkey = await signer.getPublicKey();
    this._backend = 'nip46';
    return this._pubkey!;
  }

  async reconnectNip46(savedInput: string, clientSecretHex: string): Promise<string> {
    const secretBytes = hexToBytes(clientSecretHex);
    return this.initNip46(savedInput, secretBytes);
  }

  async initNsec(secretKey: Uint8Array): Promise<string> {
    const pure = await import('nostr-tools/pure');
    this._secretKey = secretKey;
    this._pubkey = pure.getPublicKey(secretKey);
    this._backend = 'nsec';
    return this._pubkey;
  }

  setReadOnly(): void {
    this._backend = 'readonly';
    this._pubkey = null;
  }

  async getPublicKey(): Promise<string | null> {
    if (!this._backend || this._backend === 'readonly') return null;
    return this._pubkey;
  }

  getPubkey(): string | null {
    return this._pubkey;
  }

  async signEvent(event: UnsignedEvent): Promise<NostrEvent> {
    if (this._backend === 'nip07') {
      return (window as any).nostr.signEvent(event);
    }
    if (this._backend === 'nip46' && this._bunkerSigner) {
      return this._bunkerSigner.signEvent(event);
    }
    if (this._backend === 'nsec' && this._secretKey) {
      const { finalizeEvent } = await import('nostr-tools/pure');
      return finalizeEvent(event, this._secretKey) as unknown as NostrEvent;
    }
    throw new Error('No signer available');
  }

  disconnect(): void {
    if (this._bunkerSigner) {
      try {
        this._bunkerSigner.close();
      } catch {
        // ignore
      }
      this._bunkerSigner = null;
    }
    this._secretKey = null;
    this._backend = null;
    this._pubkey = null;
  }
}

export const Signer = new SignerService();

export async function generateClientSecret(): Promise<{
  secretKey: Uint8Array;
  publicKey: string;
}> {
  await loadNip46();
  const secretKey = generateSecretKey();
  const publicKey = getPublicKeyFromSecret(secretKey);
  return { secretKey, publicKey };
}

export async function generateNewKeypair(): Promise<{
  secretKey: Uint8Array;
  publicKey: string;
}> {
  const pure = await import('nostr-tools/pure');
  const secretKey = pure.generateSecretKey();
  const publicKey = pure.getPublicKey(secretKey);
  return { secretKey, publicKey };
}
