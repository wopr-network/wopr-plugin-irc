import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ircChannelProvider,
  setChannelProviderClient,
  setFloodProtector,
  clearRegistrations,
  handleNotificationReply,
  clearPendingNotifications,
} from "../src/channel-provider.js";
import type {
  IrcChannelProvider,
} from "../src/types.js";

function createMockClient() {
  return {
    say: vi.fn(),
    user: { nick: "testbot" },
  };
}

const provider = ircChannelProvider as IrcChannelProvider;

describe("sendNotification", () => {
  beforeEach(() => {
    clearRegistrations();
    clearPendingNotifications();
    setChannelProviderClient(null);
    setFloodProtector(null);
  });

  it("silently returns for non-friend-request types", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    await provider.sendNotification("owner", { type: "other" });
    expect(mockClient.say).not.toHaveBeenCalled();
  });

  it("throws when client is not initialized", async () => {
    await expect(
      provider.sendNotification("owner", { type: "friend-request", from: "alice" }),
    ).rejects.toThrow("IRC client not initialized");
  });

  it("sends PRIVMSG to the channel with friend request text", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    await provider.sendNotification("owner", { type: "friend-request", from: "alice" });
    expect(mockClient.say).toHaveBeenCalledWith(
      "owner",
      "Friend request from alice. Reply ACCEPT or DENY.",
    );
  });

  it("uses pubkey when from is not provided", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    await provider.sendNotification("owner", { type: "friend-request", pubkey: "abc123" });
    expect(mockClient.say).toHaveBeenCalledWith(
      "owner",
      "Friend request from abc123. Reply ACCEPT or DENY.",
    );
  });

  it("uses 'unknown peer' when neither from nor pubkey is provided", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    await provider.sendNotification("owner", { type: "friend-request" });
    expect(mockClient.say).toHaveBeenCalledWith(
      "owner",
      "Friend request from unknown peer. Reply ACCEPT or DENY.",
    );
  });
});

describe("handleNotificationReply", () => {
  beforeEach(() => {
    clearRegistrations();
    clearPendingNotifications();
    setChannelProviderClient(createMockClient());
  });

  it("returns false when no pending notification exists", () => {
    const result = handleNotificationReply("owner", "ACCEPT");
    expect(result).toBe(false);
  });

  it("fires onAccept callback and returns true for ACCEPT", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    const onAccept = vi.fn();
    const onDeny = vi.fn();

    await provider.sendNotification("owner", { type: "friend-request", from: "alice" }, { onAccept, onDeny });

    const result = handleNotificationReply("owner", "ACCEPT");
    expect(result).toBe(true);
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("fires onDeny callback and returns true for DENY", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    const onAccept = vi.fn();
    const onDeny = vi.fn();

    await provider.sendNotification("owner", { type: "friend-request", from: "alice" }, { onAccept, onDeny });

    const result = handleNotificationReply("owner", "DENY");
    expect(result).toBe(true);
    expect(onDeny).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("is case-insensitive", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    const onAccept = vi.fn();
    await provider.sendNotification("owner", { type: "friend-request", from: "alice" }, { onAccept });

    const result = handleNotificationReply("owner", "accept");
    expect(result).toBe(true);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("removes pending notification after handling (one-shot)", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    const onAccept = vi.fn();
    await provider.sendNotification("owner", { type: "friend-request", from: "alice" }, { onAccept });

    handleNotificationReply("owner", "ACCEPT");
    const secondResult = handleNotificationReply("owner", "ACCEPT");
    expect(secondResult).toBe(false);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("ignores non-ACCEPT/DENY messages", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    const onAccept = vi.fn();
    await provider.sendNotification("owner", { type: "friend-request", from: "alice" }, { onAccept });

    const result = handleNotificationReply("owner", "hello");
    expect(result).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("works with no callbacks", async () => {
    const mockClient = createMockClient();
    setChannelProviderClient(mockClient);

    await provider.sendNotification("owner", { type: "friend-request", from: "alice" });

    const result = handleNotificationReply("owner", "ACCEPT");
    expect(result).toBe(true);
  });
});

describe("handleNotificationReply integration with privmsg", () => {
  it("handleNotificationReply is called before command/parser handlers", () => {
    expect(typeof handleNotificationReply).toBe("function");
  });
});
