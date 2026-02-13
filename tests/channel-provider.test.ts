import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ircChannelProvider,
  setChannelProviderClient,
  setFloodProtector,
  setMaxMessageLength,
  handleRegisteredCommand,
  handleRegisteredParsers,
} from "../src/channel-provider.js";
import { FloodProtector } from "../src/message-utils.js";

function createMockClient() {
  return {
    say: vi.fn(),
    user: { nick: "testbot" },
  };
}

describe("ircChannelProvider", () => {
  beforeEach(() => {
    // Clean up commands/parsers between tests
    for (const cmd of ircChannelProvider.getCommands()) {
      ircChannelProvider.unregisterCommand(cmd.name);
    }
    for (const parser of ircChannelProvider.getMessageParsers()) {
      ircChannelProvider.removeMessageParser(parser.id);
    }
    setChannelProviderClient(null);
    setFloodProtector(null);
    setMaxMessageLength(512);
  });

  describe("command registration", () => {
    it("registers and retrieves commands", () => {
      const cmd = {
        name: "test",
        description: "A test command",
        handler: vi.fn(),
      };

      ircChannelProvider.registerCommand(cmd);
      expect(ircChannelProvider.getCommands()).toHaveLength(1);
      expect(ircChannelProvider.getCommands()[0].name).toBe("test");
    });

    it("unregisters commands", () => {
      ircChannelProvider.registerCommand({
        name: "test",
        description: "test",
        handler: vi.fn(),
      });

      ircChannelProvider.unregisterCommand("test");
      expect(ircChannelProvider.getCommands()).toHaveLength(0);
    });
  });

  describe("message parser registration", () => {
    it("registers and retrieves parsers", () => {
      const parser = {
        id: "test-parser",
        pattern: /hello/,
        handler: vi.fn(),
      };

      ircChannelProvider.addMessageParser(parser);
      expect(ircChannelProvider.getMessageParsers()).toHaveLength(1);
      expect(ircChannelProvider.getMessageParsers()[0].id).toBe("test-parser");
    });

    it("removes parsers", () => {
      ircChannelProvider.addMessageParser({
        id: "test-parser",
        pattern: /hello/,
        handler: vi.fn(),
      });

      ircChannelProvider.removeMessageParser("test-parser");
      expect(ircChannelProvider.getMessageParsers()).toHaveLength(0);
    });
  });

  describe("send", () => {
    it("throws when client is not initialized", async () => {
      await expect(ircChannelProvider.send("#test", "hello")).rejects.toThrow("IRC client not initialized");
    });

    it("sends a message via the client", async () => {
      const mockClient = createMockClient();
      setChannelProviderClient(mockClient);

      await ircChannelProvider.send("#test", "hello world");
      expect(mockClient.say).toHaveBeenCalledWith("#test", "hello world");
    });

    it("splits long messages", async () => {
      const mockClient = createMockClient();
      setChannelProviderClient(mockClient);
      setMaxMessageLength(20);

      await ircChannelProvider.send("#test", "hello world this is a long message");
      expect(mockClient.say.mock.calls.length).toBeGreaterThan(1);
    });

    it("uses flood protector when available", async () => {
      const mockClient = createMockClient();
      setChannelProviderClient(mockClient);

      const fp = new FloodProtector(500);
      const enqueueSpy = vi.spyOn(fp, "enqueue");
      setFloodProtector(fp);

      await ircChannelProvider.send("#test", "hello");
      expect(enqueueSpy).toHaveBeenCalled();
    });
  });

  describe("getBotUsername", () => {
    it("returns 'unknown' when client is not set", () => {
      expect(ircChannelProvider.getBotUsername()).toBe("unknown");
    });

    it("returns the client nick", () => {
      setChannelProviderClient(createMockClient());
      expect(ircChannelProvider.getBotUsername()).toBe("testbot");
    });
  });

  describe("id", () => {
    it("has id 'irc'", () => {
      expect(ircChannelProvider.id).toBe("irc");
    });
  });
});

describe("handleRegisteredCommand", () => {
  beforeEach(() => {
    for (const cmd of ircChannelProvider.getCommands()) {
      ircChannelProvider.unregisterCommand(cmd.name);
    }
    setChannelProviderClient(createMockClient());
  });

  it("returns false when message does not match prefix", async () => {
    const result = await handleRegisteredCommand("#test", "user", "hello", "!", vi.fn());
    expect(result).toBe(false);
  });

  it("returns false when command is not registered", async () => {
    const result = await handleRegisteredCommand("#test", "user", "!unknown", "!", vi.fn());
    expect(result).toBe(false);
  });

  it("executes a registered command", async () => {
    const handler = vi.fn();
    ircChannelProvider.registerCommand({
      name: "ping",
      description: "Ping command",
      handler,
    });

    const result = await handleRegisteredCommand("#test", "user", "!ping", "!", vi.fn());
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toMatchObject({
      channel: "#test",
      channelType: "irc",
      sender: "user",
      args: [],
    });
  });

  it("passes arguments to the command handler", async () => {
    const handler = vi.fn();
    ircChannelProvider.registerCommand({
      name: "echo",
      description: "Echo command",
      handler,
    });

    await handleRegisteredCommand("#test", "user", "!echo hello world", "!", vi.fn());
    expect(handler.mock.calls[0][0].args).toEqual(["hello", "world"]);
  });

  it("supports custom command prefix", async () => {
    const handler = vi.fn();
    ircChannelProvider.registerCommand({
      name: "test",
      description: "test",
      handler,
    });

    const result = await handleRegisteredCommand("#ch", "user", ".test", ".", vi.fn());
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("sends error reply when handler throws", async () => {
    ircChannelProvider.registerCommand({
      name: "fail",
      description: "fail",
      handler: async () => {
        throw new Error("boom");
      },
    });

    const replyFn = vi.fn();
    const result = await handleRegisteredCommand("#test", "user", "!fail", "!", replyFn);
    expect(result).toBe(true);
    expect(replyFn).toHaveBeenCalledWith(expect.stringContaining("Error executing !fail"));
  });
});

describe("handleRegisteredParsers", () => {
  beforeEach(() => {
    for (const parser of ircChannelProvider.getMessageParsers()) {
      ircChannelProvider.removeMessageParser(parser.id);
    }
    setChannelProviderClient(createMockClient());
  });

  it("returns false when no parsers match", async () => {
    const result = await handleRegisteredParsers("#test", "user", "hello", vi.fn());
    expect(result).toBe(false);
  });

  it("matches a regex parser", async () => {
    const handler = vi.fn();
    ircChannelProvider.addMessageParser({
      id: "greet",
      pattern: /^hi\b/i,
      handler,
    });

    const result = await handleRegisteredParsers("#test", "user", "Hi there", vi.fn());
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("matches a function parser", async () => {
    const handler = vi.fn();
    ircChannelProvider.addMessageParser({
      id: "custom",
      pattern: (msg: string) => msg.includes("secret"),
      handler,
    });

    const result = await handleRegisteredParsers("#test", "user", "this is secret", vi.fn());
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("provides correct context to parser", async () => {
    const handler = vi.fn();
    ircChannelProvider.addMessageParser({
      id: "ctx-check",
      pattern: /./,
      handler,
    });

    await handleRegisteredParsers("#channel", "nick", "message text", vi.fn());
    expect(handler.mock.calls[0][0]).toMatchObject({
      channel: "#channel",
      channelType: "irc",
      sender: "nick",
      content: "message text",
    });
  });

  it("returns false when parser handler throws", async () => {
    ircChannelProvider.addMessageParser({
      id: "fail",
      pattern: /./,
      handler: async () => {
        throw new Error("parser error");
      },
    });

    const result = await handleRegisteredParsers("#test", "user", "msg", vi.fn());
    expect(result).toBe(false);
  });
});
