import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

export interface ChannelBinding { channel: string; merchantScope: string; providerConfigId: string }
export const LOCAL_MOCK_BINDING: ChannelBinding = { channel: "mock", merchantScope: "mock-local", providerConfigId: "mock-v1" };
// Durable simulator only. It can use a separate database to exercise local backup loss.
export class PersistentMockChannel {
  constructor(private db: PrismaClient) {}
  assertBinding(binding: ChannelBinding) {
    if (binding.channel !== "mock" || binding.merchantScope !== LOCAL_MOCK_BINDING.merchantScope
      || binding.providerConfigId !== LOCAL_MOCK_BINDING.providerConfigId) throw Object.assign(new Error("Original channel configuration unavailable"), { statusCode: 409 });
  }
  async pay(merchantOrderNo: string, amountCents: number) {
    return this.record("PAYMENT", merchantOrderNo, amountCents, null);
  }
  async closePayment(merchantOrderNo: string, amountCents: number) {
    return this.db.$transaction(async tx => {
      const businessKey = `PAYMENT:${merchantOrderNo}`;
      await tx.$executeRaw`INSERT INTO "MockChannelTransaction"
        ("id","kind","businessKey","channelNo","originalTradeNo","amountCents","status","updatedAt")
        VALUES (${randomUUID()},'PAYMENT',${businessKey},${`mock_${randomUUID()}`},NULL,${amountCents},'CLOSED',clock_timestamp())
        ON CONFLICT ("businessKey") DO NOTHING`;
      const fact = await tx.mockChannelTransaction.findUniqueOrThrow({ where: { businessKey } });
      if (fact.kind !== "PAYMENT" || fact.amountCents !== amountCents) throw new Error("Channel business identity conflict");
      if (fact.status === "SUCCEEDED") return fact;
      if (fact.status !== "CLOSED") throw new Error("Mock channel outcome unknown");
      return fact;
    });
  }
  async refund(merchantRefundNo: string, originalTradeNo: string, amountCents: number) {
    const original = await this.db.mockChannelTransaction.findUniqueOrThrow({ where: { channelNo: originalTradeNo } });
    if (original.kind !== "PAYMENT" || original.status !== "SUCCEEDED") throw new Error("Original mock receipt missing");
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "MockChannelTransaction" WHERE id = ${original.id} FOR UPDATE`;
      const previous = await tx.mockChannelTransaction.findUnique({ where: { businessKey: `REFUND:${merchantRefundNo}` } });
      if (previous) {
        if (previous.originalTradeNo !== originalTradeNo || previous.amountCents !== amountCents) throw new Error("Channel business identity conflict");
        return previous;
      }
      const total = await tx.mockChannelTransaction.aggregate({ where: { kind: "REFUND", originalTradeNo, status: "SUCCEEDED" }, _sum: { amountCents: true } });
      if ((total._sum.amountCents ?? 0) + amountCents > original.amountCents) throw new Error("Channel refund budget exceeded");
      return tx.mockChannelTransaction.create({ data: { kind: "REFUND", businessKey: `REFUND:${merchantRefundNo}`,
        channelNo: `mock_${randomUUID()}`, originalTradeNo, amountCents, status: "SUCCEEDED" } });
    });
  }
  async query(kind: "PAYMENT" | "REFUND", merchantNo: string) {
    return this.db.mockChannelTransaction.findUnique({ where: { businessKey: `${kind}:${merchantNo}` } });
  }
  private async record(kind: "PAYMENT", merchantNo: string, amountCents: number, originalTradeNo: null) {
    return this.db.$transaction(async tx => {
      const businessKey = `${kind}:${merchantNo}`;
      await tx.$executeRaw`INSERT INTO "MockChannelTransaction"
        ("id","kind","businessKey","channelNo","originalTradeNo","amountCents","status","updatedAt")
        VALUES (${randomUUID()},${kind},${businessKey},${`mock_${randomUUID()}`},${originalTradeNo},${amountCents},'SUCCEEDED',clock_timestamp())
        ON CONFLICT ("businessKey") DO NOTHING`;
      const fact = await tx.mockChannelTransaction.findUniqueOrThrow({ where: { businessKey } });
      if (fact.amountCents !== amountCents) throw new Error("Channel business identity conflict");
      if (fact.status !== "SUCCEEDED") throw Object.assign(new Error("Original merchant order closed"), { statusCode: 409 });
      return fact;
    });
  }
}
