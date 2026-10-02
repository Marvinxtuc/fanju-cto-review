import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { PersistentMockChannel, LOCAL_MOCK_BINDING } from "./mock-channel.js";
import { recoveryHandlers } from "./recovery.js";

// No network or database: observe whether rejected identities reach any I/O boundary.
function fixture(overrides: Record<string, unknown> = {}) {
  const receipt = { id: "receipt", ...LOCAL_MOCK_BINDING, orderId: "order", paymentId: "payment",
    channelTradeNo: "original-trade", currency: "CNY", amountCents: 100 };
  const refund = { id: "refund", ...LOCAL_MOCK_BINDING, orderId: "order", paymentId: "payment",
    merchantRefundNo: "immutable-refund", version: 1, resolutionState: "NEW", status: "REFUNDING", amountCents: 100,
    receipt, ...overrides };
  const updateMany = vi.fn();
  const db = { refund: { findUniqueOrThrow: vi.fn().mockResolvedValue(refund), updateMany } } as unknown as PrismaClient;
  const channel = new PersistentMockChannel(db);
  const query = vi.spyOn(channel, "query");
  const send = vi.spyOn(channel, "refund");
  return { refund, receipt, updateMany, query, send, handlers: recoveryHandlers(db, channel, "isolated-owner") };
}

describe("legacy recovery original channel guards", () => {
  it.each([{ resolutionState: "MANUAL" }, { resolutionState: "REJECTED" }, { status: "REVIEWING" }, { status: "REJECTED" }])(
    "does not dispatch unapproved or manually quarantined refunds: %o", async state => {
      const f = fixture(state);
      await expect(f.handlers.RECOVER_REFUND({ refId: "refund" })).rejects.toThrow("approved recovery state");
      expect(f.query).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.updateMany).not.toHaveBeenCalled();
    });
  it.each([
    { channel: "wechat", merchantScope: "historical-merchant", providerConfigId: "historical-config" },
    { merchantScope: "historical-merchant" },
    { providerConfigId: "legacy-unverified" },
  ])("does not query, send, or mutate when the original transport is unavailable: %o", async binding => {
    const f = fixture(binding);
    await expect(f.handlers.RECOVER_REFUND({ refId: "refund" })).rejects.toThrow("Original channel configuration unavailable");
    expect(f.query).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    { channel: "wechat" }, { merchantScope: "other-merchant" }, { orderId: "other-order" },
    { paymentId: "other-payment" }, { currency: "USD" }, { amountCents: 99 },
  ])("rejects an incorrect original receipt before channel I/O: %o", async mismatch => {
    const f = fixture(); Object.assign(f.receipt, mismatch);
    await expect(f.handlers.RECOVER_REFUND({ refId: "refund" })).rejects.toThrow("Original refund receipt identity conflict");
    expect(f.query).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.updateMany).not.toHaveBeenCalled();
  });
  it.each([0, -1, 0.5, 101])("rejects invalid or excessive refund amount %s before channel I/O", async amountCents => {
    const f = fixture({ amountCents });
    await expect(f.handlers.RECOVER_REFUND({ refId: "refund" })).rejects.toThrow("Original refund receipt identity conflict");
    expect(f.query).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.updateMany).not.toHaveBeenCalled();
  });
});
