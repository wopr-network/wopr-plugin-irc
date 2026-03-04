/**
 * IRC Channel Provider
 *
 * Implements the ChannelProvider interface, allowing other plugins to
 * register commands and message parsers that work within IRC channels.
 */

import { logger } from "./logger.js";
import { type FloodProtector, splitMessage } from "./message-utils.js";
import type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelNotificationCallbacks,
  ChannelNotificationPayload,
  IrcChannelProvider,
} from "./types.js";

// irc-framework client type (untyped library)
type IrcClient = {
  say: (target: string, message: string) => void;
  user: { nick: string };
};

let ircClient: IrcClient | null = null;
let floodProtector: FloodProtector | null = null;
let maxMsgLength = 512;

const registeredCommands: Map<string, ChannelCommand> = new Map();
const registeredParsers: Map<string, ChannelMessageParser> = new Map();

interface PendingNotification {
  callbacks?: ChannelNotificationCallbacks;
  timer: ReturnType<typeof setTimeout>;
}

const pendingNotifications: Map<string, PendingNotification> = new Map();

const NOTIFICATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function setChannelProviderClient(c: IrcClient | null): void {
  ircClient = c;
}

export function setFloodProtector(fp: FloodProtector | null): void {
  floodProtector = fp;
}

export function setMaxMessageLength(len: number): void {
  maxMsgLength = len;
}

export function clearRegistrations(): void {
  registeredCommands.clear();
  registeredParsers.clear();
}

export function clearPendingNotifications(): void {
  for (const pending of pendingNotifications.values()) {
    clearTimeout(pending.timer);
  }
  pendingNotifications.clear();
}

export function getRegisteredCommand(name: string): ChannelCommand | undefined {
  return registeredCommands.get(name.toLowerCase());
}

export const ircChannelProvider: IrcChannelProvider = {
  id: "irc",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name.toLowerCase(), cmd);
    logger.info({ msg: "Channel command registered", name: cmd.name });
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name.toLowerCase());
  },

  getCommands(): ChannelCommand[] {
    return Array.from(registeredCommands.values());
  },

  addMessageParser(parser: ChannelMessageParser): void {
    registeredParsers.set(parser.id, parser);
    logger.info({ msg: "Message parser registered", id: parser.id });
  },

  removeMessageParser(id: string): void {
    registeredParsers.delete(id);
  },

  getMessageParsers(): ChannelMessageParser[] {
    return Array.from(registeredParsers.values());
  },

  async send(channel: string, content: string): Promise<void> {
    if (!ircClient) throw new Error("IRC client not initialized");
    const chunks = splitMessage(content, maxMsgLength);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        const sayFn = () => ircClient?.say(channel, chunk);
        if (floodProtector) {
          floodProtector.enqueue(sayFn);
        } else {
          sayFn();
        }
      }
    }
  },

  getBotUsername(): string {
    return ircClient?.user?.nick || "unknown";
  },

  async sendNotification(
    channelId: string,
    payload: ChannelNotificationPayload,
    callbacks?: ChannelNotificationCallbacks,
  ): Promise<void> {
    if (payload.type !== "friend-request") return;
    if (!ircClient) throw new Error("IRC client not initialized");

    const fromLabel = payload.from || payload.pubkey || "unknown peer";
    const message = `Friend request from ${fromLabel}. Reply ACCEPT or DENY.`;

    await ircChannelProvider.send(channelId, message);

    // Clean up any existing pending notification for this channel
    const key = channelId.toLowerCase();
    const existing = pendingNotifications.get(key);
    if (existing) {
      Promise.resolve(existing.callbacks?.onDeny?.()).catch(() => {});
      clearTimeout(existing.timer);
    }

    // Register one-shot pending notification
    const timer = setTimeout(() => {
      pendingNotifications.delete(key);
    }, NOTIFICATION_TIMEOUT_MS);

    pendingNotifications.set(key, { callbacks, timer });
  },
};

/**
 * Check if a message matches a registered command and handle it.
 */
export async function handleRegisteredCommand(
  target: string,
  sender: string,
  content: string,
  commandPrefix: string,
  replyFn: (msg: string) => void,
): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed.startsWith(commandPrefix)) return false;

  const parts = trimmed.slice(commandPrefix.length).split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);

  const cmd = registeredCommands.get(cmdName);
  if (!cmd) return false;

  const cmdCtx: ChannelCommandContext = {
    channel: target,
    channelType: "irc",
    sender,
    args,
    reply: async (msg: string) => {
      replyFn(msg);
    },
    getBotUsername: () => ircClient?.user?.nick || "unknown",
  };

  try {
    await cmd.handler(cmdCtx);
    return true;
  } catch (error: unknown) {
    logger.error({ msg: "Channel command error", cmd: cmdName, error: String(error) });
    replyFn(`An error occurred while executing ${commandPrefix}${cmdName}`);
    return true;
  }
}

/**
 * Check if a message matches any registered parser and handle it.
 */
export async function handleRegisteredParsers(
  target: string,
  sender: string,
  content: string,
  replyFn: (msg: string) => void,
): Promise<boolean> {
  for (const parser of registeredParsers.values()) {
    let matches = false;

    try {
      if (typeof parser.pattern === "function") {
        matches = parser.pattern(content);
      } else {
        parser.pattern.lastIndex = 0;
        matches = parser.pattern.test(content);
      }
    } catch (error: unknown) {
      logger.error({ msg: "Parser pattern evaluation error", id: parser.id, error: String(error) });
      continue;
    }

    if (matches) {
      const msgCtx: ChannelMessageContext = {
        channel: target,
        channelType: "irc",
        sender,
        content,
        reply: async (msg: string) => {
          replyFn(msg);
        },
        getBotUsername: () => ircClient?.user?.nick || "unknown",
      };

      try {
        await parser.handler(msgCtx);
        return true;
      } catch (error: unknown) {
        logger.error({ msg: "Message parser error", id: parser.id, error: String(error) });
        return false;
      }
    }
  }

  return false;
}

/**
 * Check if a private message is an ACCEPT/DENY reply to a pending notification.
 * Returns true if it was handled (one-shot: removes the pending entry).
 */
export function handleNotificationReply(sender: string, content: string): boolean {
  const key = sender.toLowerCase();
  const pending = pendingNotifications.get(key);
  if (!pending) return false;

  const trimmed = content.trim().toUpperCase();

  if (trimmed === "ACCEPT") {
    clearTimeout(pending.timer);
    pendingNotifications.delete(key);
    (async () => {
      try {
        await pending.callbacks?.onAccept?.();
      } catch (err) {
        logger.error({ msg: "Notification callback failed", error: String(err) });
      }
    })();
    return true;
  }

  if (trimmed === "DENY") {
    clearTimeout(pending.timer);
    pendingNotifications.delete(key);
    (async () => {
      try {
        await pending.callbacks?.onDeny?.();
      } catch (err) {
        logger.error({ msg: "Notification callback failed", error: String(err) });
      }
    })();
    return true;
  }

  return false;
}
