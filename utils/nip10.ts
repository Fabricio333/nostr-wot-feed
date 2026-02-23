/**
 * NIP-10: extract the event ID this note is replying to
 */
export function getReplyToId(tags: string[][]): string | null {
  const eTags = tags.filter((t) => t[0] === 'e');
  if (eTags.length === 0) return null;

  const replyTag = eTags.find((t) => t[3] === 'reply');
  if (replyTag) return replyTag[1];

  if (eTags.length === 1 && eTags[0][3] === 'root') return eTags[0][1];

  const hasMarkers = eTags.some(
    (t) => t[3] === 'root' || t[3] === 'reply' || t[3] === 'mention'
  );
  if (!hasMarkers && eTags.length > 0) return eTags[eTags.length - 1][1];

  return null;
}
