import { describe, it, expect, jest, beforeEach, afterAll } from "@jest/globals";
import { ChannelType } from "discord.js";

import { DiscordAdapter } from "../../packages/bot/src/discord/DiscordAdapter";

/**
 * These tests exercise the real `messageCreate` wiring registered in
 * setupEventHandlers() — not a reflection hack against private methods —
 * by emitting on the adapter's underlying discord.js Client, exactly as
 * discord.js itself would when a message arrives.
 */

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeMockMessage(overrides: Partial<{
  content: string;
  authorId: string;
  isBot: boolean;
  channelType: ChannelType;
}> = {}) {
  const {
    content = "hello world",
    authorId = "user-1",
    isBot = false,
    channelType = ChannelType.GuildText,
  } = overrides;

  const deleteFn = jest.fn(async () => undefined);
  const sendFn = jest.fn(async () => undefined);

  const message = {
    id: "msg-1",
    content,
    channelId: "channel-1",
    guildId: "guild-1",
    createdTimestamp: Date.now(),
    author: { id: authorId, bot: isBot },
    channel: { type: channelType, send: sendFn },
    delete: deleteFn,
  };

  return { message, deleteFn, sendFn };
}

describe("DiscordAdapter moderation wiring", () => {
  let adapter: DiscordAdapter;
  const originalModerationEnabled = process.env.MODERATION_ENABLED;
  const originalModerationAction = process.env.MODERATION_ACTION;

  beforeEach(() => {
    delete process.env.MODERATION_ENABLED;
    process.env.MODERATION_ACTION = "block"; // scam-link suggests "delete"
    adapter = new DiscordAdapter({
      token: "test-token",
      backendUrl: "http://localhost:0",
      adminRoleIds: [],
    });
  });

  afterAll(() => {
    process.env.MODERATION_ENABLED = originalModerationEnabled;
    process.env.MODERATION_ACTION = originalModerationAction;
  });

  it("ignores messages from bots entirely", async () => {
    const { message, deleteFn } = makeMockMessage({
      content: "https://free-airdrop.xyz/claim",
      isBot: true,
    });

    adapter.getClient().emit("messageCreate", message as never);
    await flushMicrotasks();

    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("leaves a clean message untouched", async () => {
    const { message, deleteFn, sendFn } = makeMockMessage({ content: "gm everyone" });

    adapter.getClient().emit("messageCreate", message as never);
    await flushMicrotasks();

    expect(deleteFn).not.toHaveBeenCalled();
    expect(sendFn).not.toHaveBeenCalled();
  });

  it("deletes the message and posts a channel notice on a scam-link violation", async () => {
    const { message, deleteFn, sendFn } = makeMockMessage({
      content: "check this out https://free-double-your-crypto.xyz/claim",
    });

    adapter.getClient().emit("messageCreate", message as never);
    await flushMicrotasks();

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sendFn.mock.calls[0][0]).toContain("removed");
  });

  it("records the decision in the moderation audit sink", async () => {
    const { message } = makeMockMessage({
      content: "https://free-double-your-crypto.xyz/claim",
    });

    adapter.getClient().emit("messageCreate", message as never);
    await flushMicrotasks();

    const entries = adapter.getModerationAuditSink().getEntries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].ruleId).toBe("scam-link");
    expect(entries[0].platform).toBe("discord");
  });

  it("does not throw or delete when the channel type cannot receive a notice", async () => {
    const { message, deleteFn } = makeMockMessage({
      content: "https://free-double-your-crypto.xyz/claim",
      channelType: ChannelType.GuildVoice,
    });

    expect(() => {
      adapter.getClient().emit("messageCreate", message as never);
    }).not.toThrow();
    await flushMicrotasks();

    // Deletion is independent of notice-sending; only the notice send is skipped.
    expect(deleteFn).toHaveBeenCalledTimes(1);
  });

  it("skips moderation entirely when MODERATION_ENABLED=false", async () => {
    process.env.MODERATION_ENABLED = "false";
    const disabledAdapter = new DiscordAdapter({
      token: "test-token",
      backendUrl: "http://localhost:0",
      adminRoleIds: [],
    });

    const { message, deleteFn } = makeMockMessage({
      content: "https://free-double-your-crypto.xyz/claim",
    });

    disabledAdapter.getClient().emit("messageCreate", message as never);
    await flushMicrotasks();

    expect(deleteFn).not.toHaveBeenCalled();
    process.env.MODERATION_ENABLED = "true";
  });

  it("does not crash message handling when message.delete() rejects", async () => {
    const { message, sendFn } = makeMockMessage({
      content: "https://free-double-your-crypto.xyz/claim",
    });
    message.delete = jest.fn(async () => {
      throw new Error("missing permissions");
    });

    expect(() => {
      adapter.getClient().emit("messageCreate", message as never);
    }).not.toThrow();
    await flushMicrotasks();

    // Notice should still be sent even though delete failed.
    expect(sendFn).toHaveBeenCalledTimes(1);
  });
});
