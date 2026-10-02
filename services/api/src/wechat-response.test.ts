import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, VerifiedChannelError } from "./providers.js";
import { verifyChannelResponse } from "./wechat-response.js";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const now = 1_800_000_000;
function signed(raw: string) {
  const signer = createSign("RSA-SHA256");signer.update(`${now}\nfixture-response\n${raw}\n`);signer.end();
  return new Headers({ "wechatpay-timestamp": String(now), "wechatpay-nonce": "fixture-response", "wechatpay-serial": "fixture-serial", "wechatpay-signature": signer.sign(privateKey, "base64") });
}
const config = { certificate: publicKey, serial: "fixture-serial", now: () => now * 1000 };
afterEach(() => vi.unstubAllGlobals());
describe("verified bounded channel responses", () => {
  it("rejects altered bodies, wrong certificate identity and stale signed responses", () => {
    const raw = '{"prepay_id":"fixture"}';
    expect(() => verifyChannelResponse(raw, signed(raw), config)).not.toThrow();
    expect(() => verifyChannelResponse(raw + " ", signed(raw), config)).toThrow("signature");
    expect(() => verifyChannelResponse(raw, signed(raw), { ...config, serial: "other" })).toThrow("unknown");
    expect(() => verifyChannelResponse(raw, signed(raw), { ...config, now: () => 0 })).toThrow("timestamp");
  });
  it("verifies exact response bytes before parsing and refuses unsigned success", async () => {
    const raw = '{"prepay_id":"fixture"}';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { headers: signed(raw) })));
    expect(await fetchJson({ url: "https://example.invalid", verifyResponse: (body, headers) => verifyChannelResponse(body, headers, config) })).toEqual({ prepay_id: "fixture" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw)));
    await expect(fetchJson({ url: "https://example.invalid", verifyResponse: (body, headers) => verifyChannelResponse(body, headers, config) })).rejects.toThrow("verification");
  });
  it("recognizes only signed exact order or refund absence errors", async () => {
    const raw = '{"code":"ORDER_NOT_EXIST","message":"not retained"}';
    const request = { url: "https://example.invalid", verifyResponse: (body: string, headers: Headers) => verifyChannelResponse(body, headers, config) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { status: 404, headers: signed(raw) })));
    await expect(fetchJson(request)).rejects.toBeInstanceOf(VerifiedChannelError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { status: 404 })));
    await expect(fetchJson(request)).rejects.toThrow("verification");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { status: 404 })));
    await expect(fetchJson({ url: request.url })).rejects.not.toBeInstanceOf(VerifiedChannelError);
    const refundAbsent = '{"code":"RESOURCE_NOT_EXISTS"}';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(refundAbsent, { status: 404, headers: signed(refundAbsent) })));
    await expect(fetchJson(request)).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_EXISTS' });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(refundAbsent, { status: 404 })));
    await expect(fetchJson(request)).rejects.toThrow('verification');
    const other = '{"code":"MCH_NOT_EXISTS"}';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(other, { status: 404, headers: signed(other) })));
    await expect(fetchJson(request)).rejects.not.toBeInstanceOf(VerifiedChannelError);
  });
  it("bounds response size and disallows credential-bearing redirects", async () => {
    const fake = vi.fn().mockResolvedValue(new Response("x".repeat(1_048_577)));
    vi.stubGlobal("fetch", fake);
    await expect(fetchJson({ url: "https://example.invalid" })).rejects.toThrow("size limit");
    expect(fake.mock.calls[0]![1].redirect).toBe("error");
  });
  it("aborts an actual stalled local HTTP request within the ten-second budget", async () => {
    const server = createServer((_request, _response) => {});
    server.listen(0, "127.0.0.1");await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No local listener");
    const start = Date.now();
    try {
      await expect(fetchJson({ url: `http://127.0.0.1:${address.port}` })).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(12_000);
    } finally { server.closeAllConnections(); server.close(); }
  }, 15_000);
});
