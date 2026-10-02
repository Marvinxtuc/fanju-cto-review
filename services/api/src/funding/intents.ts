import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { ProviderEnv, ProviderMode } from "../providers.js";
import { lockOrder } from "./receipts.js";
import { enqueue } from "../jobs/queue.js";
import { LOCAL_MOCK_BINDING, type ChannelBinding } from "./mock-channel.js";

export function bindingFor(env: ProviderEnv, mode: ProviderMode): ChannelBinding {
  if (mode === "mock") return LOCAL_MOCK_BINDING;
  if (!env.WECHAT_PAY_MCH_ID || !env.WECHAT_MINIAPP_APP_ID) throw new Error("Missing channel identity");
  return { channel: "wechat", merchantScope: createHash("sha256").update(`${env.WECHAT_PAY_MCH_ID}:${env.WECHAT_MINIAPP_APP_ID}`).digest("hex"),
    providerConfigId: env.WECHAT_PAY_CONFIG_VERSION ?? "wechat-v1" };
}
export async function ensurePaymentIntent(db: PrismaClient, orderId: string, userId: string, binding: ChannelBinding) {
  return db.$transaction(async tx => {
    const order = await lockOrder(tx, orderId);
    if (order.userId !== userId) throw new Error("Order not found");
    if (order.status !== "PENDING_PAYMENT" || !order.registrationActive || !order.capacityHeld) {
      throw new Error("Order is not pending payment");
    }
    if (!["PUBLISHED", "REGISTRATION_OPEN"].includes(order.activity.status)
      || order.activity.registrationEndsAt <= new Date()
      || (order.inventoryLockedUntil && order.inventoryLockedUntil <= new Date())) {
      throw Object.assign(new Error("Payment window has closed"), { statusCode: 409 });
    }
    const prior = await tx.payment.findFirst({ where: { orderId, active: true } });
    if (prior) {
      if (prior.channel !== binding.channel || prior.merchantScope !== binding.merchantScope || prior.providerConfigId !== binding.providerConfigId) {
        throw new Error("Original payment channel unavailable");
      }
      await enqueue(tx, "RECOVER_PAYMENT", `payment:${prior.id}`, prior.id);
      return { payment: prior, created: false };
    }
    const payment = await tx.payment.create({ data: { orderId, amountCents: order.amountCents, ...binding } });
    await enqueue(tx, "RECOVER_PAYMENT", `payment:${payment.id}`, payment.id, new Date(Date.now() + 30_000));
    return { payment, created: true };
  });
}
