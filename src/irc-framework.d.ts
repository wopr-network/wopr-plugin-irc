declare module "irc-framework" {
  import { EventEmitter } from "node:events";

  interface ConnectOptions {
    host: string;
    port?: number;
    nick: string;
    username?: string;
    gecos?: string;
    tls?: boolean;
    password?: string;
    auto_reconnect?: boolean;
    auto_reconnect_max_wait?: number;
    auto_reconnect_max_retries?: number;
    encoding?: string;
    version?: string;
    message_max_length?: number;
  }

  class Client extends EventEmitter {
    user: { nick: string };
    connect(options: ConnectOptions): void;
    say(target: string, message: string): void;
    notice(target: string, message: string): void;
    join(channel: string, key?: string): void;
    part(channel: string, message?: string): void;
    quit(message?: string): void;
    changeNick(nick: string): void;
    ctcpResponse(target: string, type: string, ...params: string[]): void;
    raw(...args: string[]): void;
  }

  const _default: { Client: typeof Client };
  export default _default;
  export { Client };
}
