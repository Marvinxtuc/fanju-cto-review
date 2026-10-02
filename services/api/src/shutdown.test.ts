import { describe, expect, it, vi } from "vitest";
import { drainAndDisconnect } from "./shutdown.js";

describe("shutdown cleanup", () => {
  it("disconnects the database after an HTTP close failure and reports failure", async () => {
    const closeError = new Error("close failed");
    const disconnectDatabase = vi.fn(async () => undefined);
    const logError = vi.fn();
    const clean = await drainAndDisconnect({
      closeHttp: async () => { throw closeError; },
      disconnectDatabase,
      logError,
    });
    expect(clean).toBe(false);
    expect(disconnectDatabase).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(closeError);
  });

  it("reports a database disconnect failure after closing HTTP", async () => {
    const disconnectError = new Error("disconnect failed");
    const logError = vi.fn();
    const clean = await drainAndDisconnect({
      closeHttp: async () => undefined,
      disconnectDatabase: async () => { throw disconnectError; },
      logError,
    });
    expect(clean).toBe(false);
    expect(logError).toHaveBeenCalledWith(disconnectError);
  });
});
