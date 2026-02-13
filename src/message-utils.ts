/**
 * IRC message utilities: splitting, formatting, and flood control.
 */

// IRC formatting codes to strip from incoming messages
// Bold, Italic, Underline, Strikethrough, Monospace, Color, Reverse, Reset
// biome-ignore lint/suspicious/noControlCharactersInRegex: IRC protocol uses control characters for formatting
const IRC_FORMAT_REGEX = /\x02|\x1d|\x1f|\x1e|\x11|\x03(\d{1,2}(,\d{1,2})?)?|\x16|\x0f/g;

/**
 * Strip IRC formatting codes from a message.
 */
export function stripFormatting(message: string): string {
  return message.replace(IRC_FORMAT_REGEX, "");
}

/**
 * Split a message into chunks that fit within the IRC byte limit.
 * Splits at word boundaries when possible.
 */
export function splitMessage(message: string, maxBytes: number): string[] {
  if (maxBytes <= 0) return [message];

  const chunks: string[] = [];
  const lines = message.split(/\r?\n/);

  for (const line of lines) {
    let remaining = line;

    while (remaining.length > 0) {
      const byteLength = Buffer.byteLength(remaining, "utf8");
      if (byteLength <= maxBytes) {
        chunks.push(remaining);
        break;
      }

      // Find a split point that fits within maxBytes
      let splitAt = findSplitPoint(remaining, maxBytes);
      chunks.push(remaining.slice(0, splitAt).trimEnd());
      remaining = remaining.slice(splitAt).trimStart();

      // Safety: if we couldn't make progress, force a character-by-character split
      if (remaining.length === line.length) {
        splitAt = findByteSafeIndex(remaining, maxBytes);
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
      }
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Find the best split point at a word boundary that fits within maxBytes.
 */
function findSplitPoint(text: string, maxBytes: number): number {
  // Start from an estimate based on byte ratio
  let end = Math.min(text.length, maxBytes);

  // Shrink until we're within the byte limit
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end--;
  }

  if (end === 0) return 1; // At least one character

  // Try to find a word boundary
  const segment = text.slice(0, end);
  const lastSpace = segment.lastIndexOf(" ");

  // Only use the word boundary if it's not too far back (at least 50% of the max)
  if (lastSpace > end * 0.5) {
    return lastSpace + 1; // Include the space in the first chunk
  }

  return end;
}

/**
 * Find the largest index where the slice fits within maxBytes.
 */
function findByteSafeIndex(text: string, maxBytes: number): number {
  let idx = 1;
  while (idx < text.length && Buffer.byteLength(text.slice(0, idx + 1), "utf8") <= maxBytes) {
    idx++;
  }
  return idx;
}

/**
 * Flood protection: a queue that sends messages with a minimum delay between them.
 */
export class FloodProtector {
  private queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _delay: number;

  constructor(delayMs: number) {
    this._delay = delayMs;
  }

  get delay(): number {
    return this._delay;
  }

  set delay(value: number) {
    this._delay = value;
  }

  enqueue(fn: () => void): void {
    this.queue.push(fn);
    this.process();
  }

  private process(): void {
    if (this.timer) return;
    const fn = this.queue.shift();
    if (!fn) return;

    fn();

    // Always set cooldown after processing — more items may arrive during the delay
    this.timer = setTimeout(() => {
      this.timer = null;
      this.process();
    }, this._delay);
  }

  clear(): void {
    this.queue = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
