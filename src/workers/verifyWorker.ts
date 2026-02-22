import { verifyEvent } from 'nostr-tools';

interface VerifyRequest {
  id: number;
  events: Array<{
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }>;
}

interface VerifyResponse {
  id: number;
  validIds: string[];
}

self.onmessage = (e: MessageEvent<VerifyRequest>) => {
  const { id, events } = e.data;
  const validIds: string[] = [];

  for (const event of events) {
    try {
      if (verifyEvent(event)) {
        validIds.push(event.id);
      }
    } catch {
      // Invalid event, skip
    }
  }

  self.postMessage({ id, validIds } satisfies VerifyResponse);
};
