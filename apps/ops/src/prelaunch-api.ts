import { createPrelaunchClient, type PrelaunchSession } from "@timeleft-shanghai/shared/prelaunch-client";

const SESSION_KEY = "fanju_prelaunch_session_v11";
export const prelaunchEnabled = import.meta.env.VITE_FANJU_PRELAUNCH_ENABLED === "true";
export const prelaunchClient = createPrelaunchClient(async request => {
  const base = new URL(import.meta.env.VITE_API_BASE_URL ?? window.location.origin);
  if (!prelaunchEnabled || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || !["http:", "https:"].includes(base.protocol)) throw Error("Local preview unavailable");
  const response = await fetch(`${base.origin}${request.path}`, {
    method: request.method, headers: { "content-type": "application/json", "x-fanju-contract": "prelaunch-v11-1", ...(request.token ? { authorization: `Bearer ${request.token}` } : {}) },
    ...(request.data === undefined ? {} : { body: JSON.stringify(request.data) }),
  });
  return { status: response.status, data: await response.json() };
}, {
  read() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as PrelaunchSession | null; } catch { return null; } },
  write(session) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); },
  clear() { sessionStorage.removeItem(SESSION_KEY); },
});
