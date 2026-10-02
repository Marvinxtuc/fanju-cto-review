import { describe, expect, it } from "vitest";
import { SessionTracker } from "./session.js";

describe("async operations across session changes", () => {
  it("does not let an old mutation trigger private-data refresh after logout", async () => {
    const sessions = new SessionTracker();
    sessions.activate("old-token");
    const original = sessions.capture();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const calls: string[] = [];
    const operation = (async () => {
      await pending;
      // The same snapshot belongs to both the mutation and its chained refresh.
      if (sessions.isCurrent(original)) calls.push(original.token);
    })();
    sessions.invalidate();
    finish();
    await operation;
    expect(calls).toEqual([]);
  });
  it("rejects old responses after relogin even when a token string is reused", () => {
    const sessions = new SessionTracker();
    sessions.activate("session");
    const old = sessions.capture();
    sessions.invalidate();
    sessions.activate("session");
    expect(sessions.isCurrent(old)).toBe(false);
    expect(sessions.isCurrent(sessions.capture())).toBe(true);
  });
});
