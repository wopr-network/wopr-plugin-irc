/**
 * WOPR IRC Plugin
 *
 * Connects to IRC servers using irc-framework, handles channel and private
 * messages, and routes them through WOPR's ChannelProvider interface.
 */

import IrcFramework from "irc-framework";
import {
  handleRegisteredCommand,
  handleRegisteredParsers,
  ircChannelProvider,
  setChannelProviderClient,
  setFloodProtector,
  setMaxMessageLength,
} from "./channel-provider.js";
import { logger } from "./logger.js";
import { FloodProtector, splitMessage, stripFormatting } from "./message-utils.js";
import type {
  ConfigSchema,
  IrcCtcpRequestEvent,
  IrcKickEvent,
  IrcMessageEvent,
  IrcNickEvent,
  IrcPluginConfig,
  IrcRegisteredEvent,
  WOPRPlugin,
  WOPRPluginContext,
} from "./types.js";

let client: InstanceType<typeof IrcFramework.Client> | null = null;
let ctx: WOPRPluginContext | null = null;
let floodProtector: FloodProtector | null = null;
let currentConfig: IrcPluginConfig | null = null;

// ============================================================================
// Config Schema
// ============================================================================

const configSchema: ConfigSchema = {
  title: "IRC Integration",
  description: "Configure IRC bot integration for channels and private messages",
  fields: [
    {
      name: "server",
      type: "text",
      label: "IRC Server",
      placeholder: "irc.libera.chat",
      required: true,
      description: "IRC server hostname",
    },
    {
      name: "port",
      type: "number",
      label: "Port",
      placeholder: "6697",
      default: 6697,
      description: "IRC server port (6697 for TLS, 6667 for plain)",
    },
    {
      name: "nick",
      type: "text",
      label: "Nickname",
      placeholder: "wopr-bot",
      required: true,
      description: "IRC nickname for the bot",
    },
    {
      name: "channels",
      type: "array",
      label: "Channels",
      required: true,
      description: "IRC channels to join (e.g., #general)",
      items: {
        name: "channel",
        type: "text",
        label: "Channel",
        placeholder: "#channel",
      },
    },
    {
      name: "useTLS",
      type: "checkbox",
      label: "Use TLS/SSL",
      default: true,
      description: "Connect using TLS/SSL encryption",
    },
    {
      name: "password",
      type: "password",
      label: "Server Password",
      description: "IRC server password (optional)",
      secret: true,
    },
    {
      name: "floodDelay",
      type: "number",
      label: "Flood Delay (ms)",
      default: 500,
      description: "Minimum delay between outgoing messages",
    },
    {
      name: "maxMessageLength",
      type: "number",
      label: "Max Message Length",
      default: 512,
      description: "Maximum message length in bytes (IRC standard: 512)",
    },
    {
      name: "commandPrefix",
      type: "text",
      label: "Command Prefix",
      default: "!",
      description: "Prefix character for bot commands",
    },
    {
      name: "username",
      type: "text",
      label: "Username",
      placeholder: "wopr",
      description: "IRC username (ident)",
    },
    {
      name: "realname",
      type: "text",
      label: "Real Name",
      placeholder: "WOPR Bot",
      description: "IRC real name (GECOS)",
    },
  ],
};

// ============================================================================
// Plugin Definition
// ============================================================================

const plugin: WOPRPlugin = {
  name: "wopr-plugin-irc",
  version: "1.0.0",
  description: "IRC bot with channel and private message support",

  async init(context: WOPRPluginContext) {
    ctx = context;
    ctx.registerConfigSchema("wopr-plugin-irc", configSchema);

    // Register channel provider
    if (ctx.registerChannelProvider) {
      ctx.registerChannelProvider(ircChannelProvider);
      logger.info("Registered IRC channel provider");
    }

    // Load config
    const rawConfig = ctx.getConfig<Partial<IrcPluginConfig>>();
    if (!rawConfig?.server || !rawConfig?.nick || !rawConfig?.channels?.length) {
      logger.warn("IRC plugin not configured (missing server, nick, or channels)");
      return;
    }

    currentConfig = {
      server: rawConfig.server,
      port: rawConfig.port ?? 6697,
      nick: rawConfig.nick,
      channels: rawConfig.channels,
      useTLS: rawConfig.useTLS ?? true,
      password: rawConfig.password,
      floodDelay: rawConfig.floodDelay ?? 500,
      maxMessageLength: rawConfig.maxMessageLength ?? 512,
      commandPrefix: rawConfig.commandPrefix ?? "!",
      username: rawConfig.username,
      realname: rawConfig.realname,
    };

    // Set up flood protection
    floodProtector = new FloodProtector(currentConfig.floodDelay);
    setFloodProtector(floodProtector);
    setMaxMessageLength(currentConfig.maxMessageLength);

    // Create IRC client
    client = new IrcFramework.Client();
    setChannelProviderClient(client);

    // Wire up event handlers
    registerEventHandlers(client, currentConfig);

    // Connect
    client.connect({
      host: currentConfig.server,
      port: currentConfig.port,
      nick: currentConfig.nick,
      username: currentConfig.username || currentConfig.nick,
      gecos: currentConfig.realname || "WOPR Bot",
      tls: currentConfig.useTLS,
      password: currentConfig.password || undefined,
      auto_reconnect: true,
      auto_reconnect_max_wait: 30000,
      auto_reconnect_max_retries: 10,
    });

    logger.info({
      msg: "IRC client connecting",
      server: currentConfig.server,
      port: currentConfig.port,
      nick: currentConfig.nick,
      tls: currentConfig.useTLS,
    });
  },

  async shutdown() {
    if (floodProtector) {
      floodProtector.clear();
      floodProtector = null;
    }
    setFloodProtector(null);

    if (ctx?.unregisterChannelProvider) {
      ctx.unregisterChannelProvider("irc");
    }

    if (client) {
      client.quit("WOPR shutting down");
      client = null;
    }
    setChannelProviderClient(null);

    currentConfig = null;
    ctx = null;
  },
};

// ============================================================================
// Event Handlers
// ============================================================================

function registerEventHandlers(ircClient: InstanceType<typeof IrcFramework.Client>, config: IrcPluginConfig): void {
  // On successful registration, join channels
  ircClient.on("registered", (event: IrcRegisteredEvent) => {
    logger.info({ msg: "Connected to IRC", nick: event.nick });
    for (const channel of config.channels) {
      ircClient.join(channel);
      logger.info({ msg: "Joining channel", channel });
    }
  });

  // Handle incoming messages (channel and private)
  ircClient.on("privmsg", (event: IrcMessageEvent) => {
    handleIncomingMessage(event, config).catch((e) =>
      logger.error({ msg: "Message handling failed", error: String(e) }),
    );
  });

  // Handle CTCP requests (VERSION, PING)
  ircClient.on("ctcp request", (event: IrcCtcpRequestEvent) => {
    handleCtcp(ircClient, event);
  });

  // Handle being kicked - auto-rejoin
  ircClient.on("kick", (event: IrcKickEvent) => {
    if (event.kicked === ircClient.user.nick) {
      logger.warn({ msg: "Kicked from channel, rejoining", channel: event.channel, by: event.nick });
      setTimeout(() => {
        ircClient.join(event.channel);
      }, 2000);
    }
  });

  // Handle nick-in-use - try alternative
  ircClient.on("nick in use", () => {
    const currentNick = ircClient.user.nick;
    const newNick = `${config.nick}_${Math.floor(Math.random() * 1000)}`;
    logger.warn({ msg: "Nick in use, trying alternative", from: currentNick, to: newNick });
    ircClient.changeNick(newNick);
  });

  // Attempt to reclaim original nick when someone else changes nick
  ircClient.on("nick", (event: IrcNickEvent) => {
    // If someone else freed our preferred nick, reclaim it
    if (event.nick !== ircClient.user.nick && ircClient.user.nick !== config.nick) {
      // Our nick is different from desired, try to reclaim
      logger.info({ msg: "Attempting to reclaim nick", desired: config.nick });
      ircClient.changeNick(config.nick);
    }
  });

  // Log connection events
  ircClient.on("reconnecting", () => {
    logger.info({ msg: "Reconnecting to IRC" });
  });

  ircClient.on("close", () => {
    logger.info({ msg: "IRC connection closed" });
  });

  ircClient.on("socket error", (err: Error) => {
    logger.error({ msg: "IRC socket error", error: String(err) });
  });
}

async function handleIncomingMessage(event: IrcMessageEvent, config: IrcPluginConfig): Promise<void> {
  const isPrivate = event.target === client?.user.nick;
  const channel = isPrivate ? event.nick : event.target;
  const sender = event.nick;
  const rawMessage = event.message;
  const message = stripFormatting(rawMessage);

  logger.debug({
    msg: "Incoming IRC message",
    channel,
    sender,
    private: isPrivate,
    messageLength: message.length,
  });

  // Reply helper that uses flood protection
  const replyFn = (msg: string) => {
    if (!client) return;
    const chunks = splitMessage(msg, currentConfig?.maxMessageLength ?? 512);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        const sayFn = () => client?.say(channel, chunk);
        if (floodProtector) {
          floodProtector.enqueue(sayFn);
        } else {
          sayFn();
        }
      }
    }
  };

  // Check registered commands first
  const handledByCommand = await handleRegisteredCommand(channel, sender, message, config.commandPrefix, replyFn);
  if (handledByCommand) return;

  // Check registered message parsers
  const handledByParser = await handleRegisteredParsers(channel, sender, message, replyFn);
  if (handledByParser) return;

  // Emit channel message event for WOPR core to pick up
  if (ctx?.events) {
    await ctx.events.emit("channel:message", {
      channel: { type: "irc", id: channel, name: channel },
      message,
      from: sender,
      metadata: { private: isPrivate, hostname: event.hostname },
    });
  }

  // Inject into WOPR session if we have a context
  if (ctx) {
    try {
      const response = await ctx.inject("default", message, {
        from: sender,
        channel: { type: "irc", id: channel, name: channel },
        onStream: (streamMsg) => {
          if (streamMsg.type === "text" && streamMsg.content) {
            replyFn(streamMsg.content);
          }
        },
      });

      // If inject returned a complete response and we haven't streamed, send it
      if (response && typeof response === "string") {
        replyFn(response);
      }
    } catch (e) {
      logger.error({ msg: "Failed to inject message", error: String(e) });
    }
  }
}

function handleCtcp(ircClient: InstanceType<typeof IrcFramework.Client>, event: IrcCtcpRequestEvent): void {
  const type = event.type.toUpperCase();

  if (type === "VERSION") {
    ircClient.ctcpResponse(event.nick, "VERSION", "WOPR IRC Plugin 1.0.0");
    logger.debug({ msg: "CTCP VERSION response sent", to: event.nick });
  } else if (type === "PING") {
    ircClient.ctcpResponse(event.nick, "PING", event.message);
    logger.debug({ msg: "CTCP PING response sent", to: event.nick });
  }
}

export default plugin;
