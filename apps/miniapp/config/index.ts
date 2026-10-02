import { defineConfig } from "@tarojs/cli";

if (process.env.NODE_ENV === "production" && !process.env.TARO_APP_API_BASE_URL) {
  throw new Error("Production weapp build requires TARO_APP_API_BASE_URL");
}

const demoMode = process.env.TARO_APP_DEMO_MODE === "true";
if (demoMode && process.env.NODE_ENV === "production") {
  throw new Error("Production miniapp cannot enable demo mode");
}

const apiBaseUrl = process.env.TARO_APP_API_BASE_URL ?? "http://127.0.0.1:3000";
const prelaunchEnabled = process.env.TARO_APP_PRELAUNCH_ENABLED === "true";
if (prelaunchEnabled && !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/.test(apiBaseUrl)) {
  throw new Error("Prelaunch preview requires an explicit loopback API origin");
}

export default defineConfig({
  projectName: "timeleft-shanghai-miniapp",
  date: "2026-07-16",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: "webpack5",
  defineConstants: {
    __FANJU_API_BASE_URL__: JSON.stringify(apiBaseUrl),
    __FANJU_DEMO_MODE__: JSON.stringify(demoMode),
    __FANJU_FORMAL_BUSINESS__: JSON.stringify(!demoMode && process.env.TARO_APP_FORMAL_BUSINESS !== 'false'),
    __FANJU_PRELAUNCH_ENABLED__: JSON.stringify(prelaunchEnabled)
  },
  mini: {},
  h5: {}
});
