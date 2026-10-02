import Taro from "@tarojs/taro";
import { createPrelaunchClient, type PrelaunchSession } from "@timeleft-shanghai/shared/prelaunch-client";

declare const __FANJU_API_BASE_URL__: string;
declare const __FANJU_PRELAUNCH_ENABLED__: boolean;
export const prelaunchEnabled = __FANJU_PRELAUNCH_ENABLED__;
const KEY = "fanju_prelaunch_session_v11";
export const prelaunchClient = createPrelaunchClient(async request => {
  if (!prelaunchEnabled || !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/.test(__FANJU_API_BASE_URL__)) throw Error("Local preview unavailable");
  const response = await Taro.request({ url: `${__FANJU_API_BASE_URL__.replace(/\/$/, "")}${request.path}`, method: request.method,
    header: { "content-type": "application/json", "x-fanju-contract": "prelaunch-v11-1", ...(request.token ? { authorization: `Bearer ${request.token}` } : {}) },
    ...(request.data === undefined ? {} : { data: request.data }) });
  return { status: response.statusCode, data: response.data };
}, {
  read() { return Taro.getStorageSync<PrelaunchSession>(KEY) || null; },
  write(session) { Taro.setStorageSync(KEY, session); },
  clear() { Taro.removeStorageSync(KEY); },
});
