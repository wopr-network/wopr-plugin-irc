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
  ChannelProvider,
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

export function setChannelProviderClient(c: IrcClient | null): void {
  ircClient = c;
}

export function setFloodProtector(fp: FloodProtector | null): void {
  floodProtector = fp;
}

export function setMaxMessageLength(len: number): void {
  maxMsgLength = len;
}

export function getRegisteredCommand(name: string): ChannelCommand | undefined {
  return registeredCommands.get(name);
}

export const ircChannelProvider: ChannelProvider = {
  id: "irc",

  registerCommand(cmd: ChannelCommand): void {
    registeredCommands.set(cmd.name, cmd);
    logger.info({ msg: "Channel command registered", name: cmd.name });
  },

  unregisterCommand(name: string): void {
    registeredCommands.delete(name);
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
  } catch (error) {
    logger.error({ msg: "Channel command error", cmd: cmdName, error: String(error) });
    replyFn(`Error executing ${commandPrefix}${cmdName}: ${error}`);
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

    if (typeof parser.pattern === "function") {
      matches = parser.pattern(content);
    } else {
      parser.pattern.lastIndex = 0;
      matches = parser.pattern.test(content);
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
      } catch (error) {
        logger.error({ msg: "Message parser error", id: parser.id, error: String(error) });
        return false;
      }
    }
  }

  return false;
}
