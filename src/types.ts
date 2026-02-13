export type {
  ChannelCommand,
  ChannelCommandContext,
  ChannelMessageContext,
  ChannelMessageParser,
  ChannelProvider,
  ChannelRef,
  ConfigField,
  ConfigSchema,
  EventHandler,
  PluginCommand,
  PluginInjectOptions,
  PluginLogger,
  SessionCreateEvent,
  SessionInjectEvent,
  SessionResponseEvent,
  StreamMessage,
  UserProfile,
  WOPREvent,
  WOPREventBus,
  WOPRPlugin,
  WOPRPluginContext,
} from "@wopr-network/plugin-types";

export interface IrcPluginConfig {
  server: string;
  port: number;
  nick: string;
  channels: string[];
  useTLS: boolean;
  password?: string;
  floodDelay: number;
  maxMessageLength: number;
  commandPrefix: string;
  username?: string;
  realname?: string;
}

/** An event emitted by irc-framework for privmsg/notice/action */
export interface IrcMessageEvent {
  nick: string;
  ident: string;
  hostname: string;
  target: string;
  message: string;
  tags: Record<string, string>;
  type: string;
  reply: (message: string) => void;
}

/** irc-framework registered event */
export interface IrcRegisteredEvent {
  nick: string;
}

/** irc-framework kick event */
export interface IrcKickEvent {
  kicked: string;
  nick: string;
  channel: string;
  message: string;
}

/** irc-framework nick event */
export interface IrcNickEvent {
  nick: string;
  new_nick: string;
}

/** irc-framework CTCP request event */
export interface IrcCtcpRequestEvent {
  nick: string;
  target: string;
  type: string;
  message: string;
  reply: (message: string) => void;
}
