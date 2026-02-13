import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { stripFormatting, splitMessage, FloodProtector } from "../src/message-utils.js";

describe("stripFormatting", () => {
  it("strips bold codes", () => {
    expect(stripFormatting("\x02bold text\x02")).toBe("bold text");
  });

  it("strips italic codes", () => {
    expect(stripFormatting("\x1ditalic\x1d")).toBe("italic");
  });

  it("strips underline codes", () => {
    expect(stripFormatting("\x1funderline\x1f")).toBe("underline");
  });

  it("strips color codes with foreground only", () => {
    expect(stripFormatting("\x034red text")).toBe("red text");
  });

  it("strips color codes with foreground and background", () => {
    expect(stripFormatting("\x034,12red on blue")).toBe("red on blue");
  });

  it("strips two-digit color codes", () => {
    expect(stripFormatting("\x0312blue text\x03")).toBe("blue text");
  });

  it("strips reset code", () => {
    expect(stripFormatting("before\x0fafter")).toBe("beforeafter");
  });

  it("strips reverse code", () => {
    expect(stripFormatting("\x16reversed\x16")).toBe("reversed");
  });

  it("strips strikethrough code", () => {
    expect(stripFormatting("\x1estrike\x1e")).toBe("strike");
  });

  it("strips monospace code", () => {
    expect(stripFormatting("\x11mono\x11")).toBe("mono");
  });

  it("strips mixed formatting", () => {
    expect(stripFormatting("\x02\x034,12bold red\x03\x02 plain")).toBe("bold red plain");
  });

  it("returns plain text unchanged", () => {
    expect(stripFormatting("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(stripFormatting("")).toBe("");
  });
});

describe("splitMessage", () => {
  it("returns the message as-is when within limit", () => {
    const msg = "Hello, world!";
    expect(splitMessage(msg, 512)).toEqual(["Hello, world!"]);
  });

  it("splits a long message at word boundaries", () => {
    const words = Array(20).fill("hello").join(" ");
    const chunks = splitMessage(words, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(50);
    }
    // All content should be preserved
    expect(chunks.join(" ")).toBe(words);
  });

  it("handles multi-byte characters correctly", () => {
    // Each emoji is typically 4 bytes in UTF-8
    const emojis = Array(50).fill("\u{1F600}").join(" ");
    const chunks = splitMessage(emojis, 50);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(50);
    }
  });

  it("splits very long words that exceed the limit", () => {
    const longWord = "a".repeat(100);
    const chunks = splitMessage(longWord, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(30);
    }
    expect(chunks.join("")).toBe(longWord);
  });

  it("handles newlines in the message", () => {
    const msg = "line one\nline two\nline three";
    const chunks = splitMessage(msg, 512);
    expect(chunks).toEqual(["line one", "line two", "line three"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitMessage("", 512)).toEqual([]);
  });

  it("handles maxBytes of 0 by returning the whole message", () => {
    expect(splitMessage("test", 0)).toEqual(["test"]);
  });

  it("splits at exactly the byte boundary", () => {
    // 'a' is 1 byte each in UTF-8
    const msg = "aaa bbb ccc";
    const chunks = splitMessage(msg, 7);
    // "aaa bbb" = 7 bytes, "ccc" = 3 bytes
    // Should split: "aaa" (3) + space consumed, "bbb" (3), "ccc" (3) or similar
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(7);
    }
  });
});

describe("FloodProtector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes the first message immediately", () => {
    const fp = new FloodProtector(500);
    const fn = vi.fn();
    fp.enqueue(fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("delays subsequent messages", () => {
    const fp = new FloodProtector(500);
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    fp.enqueue(fn1);
    fp.enqueue(fn2);

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("processes multiple queued messages in order", () => {
    const fp = new FloodProtector(100);
    const order: number[] = [];

    fp.enqueue(() => order.push(1));
    fp.enqueue(() => order.push(2));
    fp.enqueue(() => order.push(3));

    expect(order).toEqual([1]);

    vi.advanceTimersByTime(100);
    expect(order).toEqual([1, 2]);

    vi.advanceTimersByTime(100);
    expect(order).toEqual([1, 2, 3]);
  });

  it("reports pending count", () => {
    const fp = new FloodProtector(500);
    fp.enqueue(() => {});
    fp.enqueue(() => {});
    fp.enqueue(() => {});

    // First one executed immediately, 2 remaining
    expect(fp.pending).toBe(2);
  });

  it("clears pending messages", () => {
    const fp = new FloodProtector(500);
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    fp.enqueue(fn1);
    fp.enqueue(fn2);

    fp.clear();

    vi.advanceTimersByTime(1000);
    expect(fn2).not.toHaveBeenCalled();
    expect(fp.pending).toBe(0);
  });

  it("allows updating the delay", () => {
    const fp = new FloodProtector(500);
    expect(fp.delay).toBe(500);

    fp.delay = 1000;
    expect(fp.delay).toBe(1000);
  });
});
