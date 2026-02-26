import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock irc-framework before importing the plugin
const mockConnect = vi.fn();
const mockOn = vi.fn();
const mockJoin = vi.fn();
const mockQuit = vi.fn();
const mockSay = vi.fn();
const mockChangeNick = vi.fn();
const mockCtcpResponse = vi.fn();

vi.mock("irc-framework", () => {
  class MockClient {
    user = { nick: "testbot" };
    connect = mockConnect;
    on = mockOn;
    join = mockJoin;
    quit = mockQuit;
    say = mockSay;
    changeNick = mockChangeNick;
    ctcpResponse = mockCtcpResponse;
  }
  return {
    default: { Client: MockClient },
    Client: MockClient,
  };
});

// Mock winston to avoid file I/O in tests
vi.mock("winston", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    default: {
      createLogger: () => mockLogger,
      format: {
        combine: vi.fn(),
        timestamp: vi.fn(),
        errors: vi.fn(),
        json: vi.fn(),
        printf: vi.fn(() => ({})),
        colorize: vi.fn(),
      },
      transports: {
        File: vi.fn(),
        Console: vi.fn(),
      },
    },
    createLogger: () => mockLogger,
    format: {
      combine: vi.fn(),
      timestamp: vi.fn(),
      errors: vi.fn(),
      json: vi.fn(),
      printf: vi.fn(() => ({})),
      colorize: vi.fn(),
    },
    transports: {
      File: vi.fn(),
      Console: vi.fn(),
    },
  };
});

import plugin from "../src/index.js";

function createMockContext(config: Record<string, unknown> = {}) {
  return {
    registerConfigSchema: vi.fn(),
    registerChannelProvider: vi.fn(),
    unregisterChannelProvider: vi.fn(),
    getConfig: vi.fn(() => config),
    getMainConfig: vi.fn(),
    inject: vi.fn(async () => "response"),
    events: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(async () => {}),
      once: vi.fn(),
      emitCustom: vi.fn(async () => {}),
      listenerCount: vi.fn(() => 0),
    },
    hooks: {
      on: vi.fn(),
      off: vi.fn(),
      offByName: vi.fn(),
      list: vi.fn(() => []),
    },
    registerExtension: vi.fn(),
    unregisterExtension: vi.fn(),
    getExtension: vi.fn(),
    listExtensions: vi.fn(() => []),
    registerChannel: vi.fn(),
    unregisterChannel: vi.fn(),
    getChannel: vi.fn(),
    getChannels: vi.fn(() => []),
    getChannelsForSession: vi.fn(() => []),
    registerContextProvider: vi.fn(),
    unregisterContextProvider: vi.fn(),
    getContextProvider: vi.fn(),
    registerWebUiExtension: vi.fn(),
    unregisterWebUiExtension: vi.fn(),
    getWebUiExtensions: vi.fn(() => []),
    registerUiComponent: vi.fn(),
    unregisterUiComponent: vi.fn(),
    getUiComponents: vi.fn(() => []),
    logMessage: vi.fn(),
    getAgentIdentity: vi.fn(() => ({})),
    getUserProfile: vi.fn(() => ({})),
    getSessions: vi.fn(() => []),
    cancelInject: vi.fn(() => false),
    saveConfig: vi.fn(async () => {}),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    unregisterConfigSchema: vi.fn(),
    getConfigSchema: vi.fn(),
    registerSTTProvider: vi.fn(),
    registerTTSProvider: vi.fn(),
    getSTT: vi.fn(),
    getTTS: vi.fn(),
    hasVoice: vi.fn(() => ({ stt: false, tts: false })),
    getChannelProvider: vi.fn(),
    getChannelProviders: vi.fn(() => []),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getPluginDir: vi.fn(() => "/tmp"),
  };
}

describe("IRC Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Ensure plugin is shut down between tests
    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it("has correct metadata", () => {
    expect(plugin.name).toBe("wopr-plugin-irc");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toBeDefined();
  });

  it("registers config schema on init", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as never);
    expect(ctx.registerConfigSchema).toHaveBeenCalledWith("wopr-plugin-irc", expect.objectContaining({
      title: "IRC Integration",
    }));
  });

  it("registers channel provider on init", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as never);
    expect(ctx.registerChannelProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: "irc" }),
    );
  });

  it("does not connect when config is missing required fields", async () => {
    const ctx = createMockContext({});
    await plugin.init!(ctx as never);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("connects to IRC server with full config", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      port: 6697,
      nick: "testbot",
      channels: ["#test"],
      useTLS: true,
    });

    await plugin.init!(ctx as never);
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "irc.test.com",
        port: 6697,
        nick: "testbot",
        tls: true,
        auto_reconnect: true,
      }),
    );
  });

  it("uses default values for optional config", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#ch"],
    });

    await plugin.init!(ctx as never);
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 6697,
        tls: true,
      }),
    );
  });

  it("registers event handlers on connect", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);

    const registeredEvents = mockOn.mock.calls.map((call: unknown[]) => call[0]);
    expect(registeredEvents).toContain("registered");
    expect(registeredEvents).toContain("privmsg");
    expect(registeredEvents).toContain("ctcp request");
    expect(registeredEvents).toContain("kick");
    expect(registeredEvents).toContain("nick in use");
    expect(registeredEvents).toContain("nick");
    expect(registeredEvents).toContain("reconnecting");
    expect(registeredEvents).toContain("close");
    expect(registeredEvents).toContain("socket error");
  });

  it("joins channels on registered event", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test", "#dev"],
    });

    await plugin.init!(ctx as never);

    // Find the 'registered' handler and invoke it
    const registeredCall = mockOn.mock.calls.find((call: unknown[]) => call[0] === "registered");
    expect(registeredCall).toBeDefined();

    const handler = registeredCall[1];
    handler({ nick: "bot" });

    expect(mockJoin).toHaveBeenCalledWith("#test");
    expect(mockJoin).toHaveBeenCalledWith("#dev");
  });

  it("disconnects and unregisters on shutdown", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);
    await plugin.shutdown!();

    expect(mockQuit).toHaveBeenCalledWith("WOPR shutting down");
    expect(ctx.unregisterChannelProvider).toHaveBeenCalledWith("irc");
  });

  it("handles nick in use by trying alternative", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);

    const nickInUseCall = mockOn.mock.calls.find((call: unknown[]) => call[0] === "nick in use");
    const handler = nickInUseCall[1];
    handler();

    expect(mockChangeNick).toHaveBeenCalledWith(expect.stringMatching(/^bot_\d+$/));
  });

  it("handles CTCP VERSION", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);

    const ctcpCall = mockOn.mock.calls.find((call: unknown[]) => call[0] === "ctcp request");
    const handler = ctcpCall[1];
    handler({
      nick: "someone",
      target: "bot",
      type: "VERSION",
      message: "",
      reply: vi.fn(),
    });

    expect(mockCtcpResponse).toHaveBeenCalledWith("someone", "VERSION", "WOPR IRC Plugin 1.0.0");
  });

  it("handles CTCP PING", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);

    const ctcpCall = mockOn.mock.calls.find((call: unknown[]) => call[0] === "ctcp request");
    const handler = ctcpCall[1];
    handler({
      nick: "someone",
      target: "bot",
      type: "PING",
      message: "1234567890",
      reply: vi.fn(),
    });

    expect(mockCtcpResponse).toHaveBeenCalledWith("someone", "PING", "1234567890");
  });

  it("config schema fields have setupFlow annotation", async () => {
    const ctx = createMockContext();
    await plugin.init!(ctx as never);

    const schema = ctx.registerConfigSchema.mock.calls[0][1];
    for (const field of schema.fields) {
      expect(field.setupFlow).toBeDefined();
    }
  });

  it("has a complete manifest", () => {
    expect(plugin.manifest).toBeDefined();
    expect(plugin.manifest!.name).toBe("@wopr-network/wopr-plugin-irc");
    expect(plugin.manifest!.capabilities).toContain("channel");
    expect(plugin.manifest!.capabilities).toContain("commands");
    expect(plugin.manifest!.category).toBe("channel");
    expect(plugin.manifest!.tags).toEqual(expect.arrayContaining(["irc", "chat"]));
    expect(plugin.manifest!.icon).toBeDefined();
    expect(plugin.manifest!.lifecycle).toBeDefined();
    expect(plugin.manifest!.lifecycle!.shutdownBehavior).toBe("graceful");
    expect(plugin.manifest!.configSchema).toBeDefined();
  });

  it("unregisters config schema on shutdown", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);
    await plugin.shutdown!();

    expect(ctx.unregisterConfigSchema).toHaveBeenCalledWith("wopr-plugin-irc");
  });

  it("shutdown is idempotent (can be called twice)", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);
    await plugin.shutdown!();
    // Second call should not throw
    await plugin.shutdown!();
  });

  it("auto-rejoins after being kicked", async () => {
    vi.useFakeTimers();

    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);

    const kickCall = mockOn.mock.calls.find((call: unknown[]) => call[0] === "kick");
    const handler = kickCall[1];

    // Reset join mock to track only the rejoin
    mockJoin.mockClear();

    handler({
      kicked: "testbot", // matches client.user.nick from mock
      nick: "op",
      channel: "#test",
      message: "bye",
    });

    // Should not rejoin immediately
    expect(mockJoin).not.toHaveBeenCalled();

    // Should rejoin after delay
    vi.advanceTimersByTime(2000);
    expect(mockJoin).toHaveBeenCalledWith("#test");

    vi.useRealTimers();
  });

  it("does not rejoin when someone else is kicked", async () => {
    vi.useFakeTimers();

    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
    });

    await plugin.init!(ctx as never);

    const kickCall = mockOn.mock.calls.find((call: unknown[]) => call[0] === "kick");
    const handler = kickCall[1];

    mockJoin.mockClear();
    handler({
      kicked: "otheruser",
      nick: "op",
      channel: "#test",
      message: "bye",
    });

    vi.advanceTimersByTime(5000);
    expect(mockJoin).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("supports TLS disabled config", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      port: 6667,
      nick: "bot",
      channels: ["#test"],
      useTLS: false,
    });

    await plugin.init!(ctx as never);
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        tls: false,
        port: 6667,
      }),
    );
  });

  it("passes server password when configured", async () => {
    const ctx = createMockContext({
      server: "irc.test.com",
      nick: "bot",
      channels: ["#test"],
      password: "secret123",
    });

    await plugin.init!(ctx as never);
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "secret123",
      }),
    );
  });
});
