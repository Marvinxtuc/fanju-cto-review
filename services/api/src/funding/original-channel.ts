import type { PaymentProvider, RefundProvider, ProviderEnv } from "../providers.js";
import { bindingFor } from "./intents.js";
import type { ChannelBinding } from "./mock-channel.js";
import { createWechatChannel } from "../prelaunch/wechat-channel.js";

export type OriginalTransport = ReturnType<typeof createWechatChannel>;
const key = (binding: ChannelBinding) => JSON.stringify([binding.channel, binding.merchantScope, binding.providerConfigId]);
export class OriginalChannelRegistry {
  private readonly entries = new Map<string, OriginalTransport>();
  registerWechat(env: ProviderEnv, payment: PaymentProvider, refund: RefundProvider) {
    const binding = bindingFor(env, "wechat");
    const identity = key(binding);
    if (this.entries.has(identity)) throw Error("Duplicate original channel configuration");
    this.entries.set(identity, createWechatChannel(env, payment, refund));
    return binding;
  }
  resolve(binding: ChannelBinding) {
    const transport = this.entries.get(key(binding));
    if (!transport) throw Error("Original channel configuration unavailable");
    transport.assertBinding(binding);
    return transport;
  }
}
