import { nip19 } from 'nostr-tools';
import type { ContentToken, ParsedContent } from '@/types/nostr';

export function tokenize(content: string): ContentToken[] {
  const tokens: ContentToken[] = [];
  let m: RegExpExecArray | null;

  const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
  while ((m = urlRe.exec(content)) !== null) {
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      type: 'url',
      value: m[0],
    });
  }

  const nostrRe = /nostr:(npub1|note1|nevent1|nprofile1)[a-z0-9]+/gi;
  while ((m = nostrRe.exec(content)) !== null) {
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      type: 'nostr',
      value: m[0],
    });
  }

  const hashRe = /(^|\s)#(\w{1,50})/g;
  while ((m = hashRe.exec(content)) !== null) {
    const hashStart = m.index + m[1].length;
    const hashEnd = m.index + m[0].length;
    tokens.push({
      start: hashStart,
      end: hashEnd,
      type: 'hashtag',
      value: '#' + m[2],
    });
  }

  tokens.sort((a, b) => a.start - b.start);
  const cleaned: ContentToken[] = [];
  let lastEnd = 0;
  for (const t of tokens) {
    if (t.start >= lastEnd) {
      cleaned.push(t);
      lastEnd = t.end;
    }
  }
  return cleaned;
}

export function parseContent(content: string): ParsedContent[] {
  const tokens = tokenize(content);
  const parts: ParsedContent[] = [];
  let pos = 0;

  for (const t of tokens) {
    if (t.start > pos) {
      parts.push({ type: 'text', value: content.slice(pos, t.start) });
    }

    switch (t.type) {
      case 'url':
        parts.push(classifyUrl(t.value));
        break;
      case 'nostr':
        parts.push(classifyNostr(t.value));
        break;
      case 'hashtag':
        parts.push({ type: 'hashtag', value: t.value });
        break;
    }

    pos = t.end;
  }

  if (pos < content.length) {
    parts.push({ type: 'text', value: content.slice(pos) });
  }

  return parts;
}

function classifyUrl(url: string): ParsedContent {
  if (/\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$/i.test(url)) {
    return { type: 'image', value: url };
  }
  if (/\.(mp4|mov|webm)(\?[^\s]*)?$/i.test(url)) {
    return { type: 'video', value: url };
  }
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (ytMatch) {
    return { type: 'youtube', value: url, extra: ytMatch[1] };
  }
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return { type: 'vimeo', value: url, extra: vimeoMatch[1] };
  }
  return { type: 'link', value: url };
}

function classifyNostr(raw: string): ParsedContent {
  const value = raw.slice(6);
  try {
    nip19.decode(value);
    const display = value.slice(0, 12) + '...' + value.slice(-4);
    return { type: 'nostr-mention', value: display, extra: value };
  } catch {
    return { type: 'nostr-mention', value: raw };
  }
}
