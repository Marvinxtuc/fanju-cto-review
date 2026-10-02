import { z } from "zod";
import { createVerify, X509Certificate, type KeyObject } from "node:crypto";

export function verifyChannelResponse(raw: string, headers: Headers, config: {
  certificate: string | KeyObject; serial: string; now?: () => number;
}) {
  const timestamp = headers.get("wechatpay-timestamp");
  const nonce = headers.get("wechatpay-nonce");
  const signature = headers.get("wechatpay-signature");
  if (!timestamp || !nonce || !signature || headers.get("wechatpay-serial") !== config.serial) throw new Error("Channel response verification material missing or unknown");
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs((config.now ?? Date.now)() / 1000 - seconds) > 300) throw new Error("Channel response timestamp rejected");
  if (typeof config.certificate === "string" && config.certificate.includes("BEGIN CERTIFICATE")) {
    const certificate = new X509Certificate(config.certificate);
    const now = (config.now ?? Date.now)();
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) throw new Error("Channel certificate expired or not yet valid");
  }
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}\n${nonce}\n${raw}\n`);verifier.end();
  if (!verifier.verify(config.certificate, signature, "base64")) throw new Error("Channel response signature rejected");
}

export function parseChannelPaymentTime(value: unknown): string {
  const parsed = z.string().datetime({ offset: true }).safeParse(value);
  if (!parsed.success) throw new Error("Channel payment time missing or invalid");
  return new Date(parsed.data).toISOString();
}
