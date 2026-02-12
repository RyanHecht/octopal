const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a long message into Discord-safe chunks (≤2000 chars).
 * Splits at newlines or sentence boundaries when possible.
 * Preserves code blocks — avoids splitting mid-block.
 */
export function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    const slice = remaining.slice(0, DISCORD_MAX_LENGTH);
    let splitAt = findSplitPoint(slice, remaining);

    if (splitAt <= 0) {
      // Hard split as last resort
      splitAt = DISCORD_MAX_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((c) => c.length > 0);
}

function findSplitPoint(slice: string, full: string): number {
  // Don't split inside a code block — find the last complete block boundary
  const codeBlockSplit = findCodeBlockSafeSplit(slice, full);
  if (codeBlockSplit > 0) return codeBlockSplit;

  // Try splitting at the last double newline (paragraph break)
  const doubleNewline = slice.lastIndexOf("\n\n");
  if (doubleNewline > DISCORD_MAX_LENGTH * 0.3) return doubleNewline;

  // Try splitting at the last single newline
  const newline = slice.lastIndexOf("\n");
  if (newline > DISCORD_MAX_LENGTH * 0.3) return newline;

  // Try splitting at the last sentence boundary
  const sentenceEnd = findLastSentenceEnd(slice);
  if (sentenceEnd > DISCORD_MAX_LENGTH * 0.3) return sentenceEnd;

  return -1;
}

/**
 * If the slice would split mid-code-block, return the position
 * just before the unclosed block starts. Returns -1 if no issue.
 */
function findCodeBlockSafeSplit(slice: string, _full: string): number {
  const fencePattern = /```/g;
  let count = 0;
  let lastFence = -1;

  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(slice)) !== null) {
    count++;
    lastFence = match.index;
  }

  // Odd number of fences means we're inside an unclosed block
  if (count % 2 !== 0 && lastFence > 0) {
    // Split before the unclosed fence
    const beforeFence = slice.lastIndexOf("\n", lastFence - 1);
    if (beforeFence > 0) return beforeFence;
  }

  return -1;
}

function findLastSentenceEnd(text: string): number {
  // Match ". ", "! ", "? " followed by a space or end
  const pattern = /[.!?]\s/g;
  let lastMatch = -1;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    lastMatch = match.index + 1; // Include the punctuation
  }

  return lastMatch;
}
