import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
// Native DOM component evidence, separate from real API/worker E2E.
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  test: { include: ["tests/ui/miniapp-prelaunch.test.tsx", "tests/ui/miniapp-money.test.tsx"], environment: "jsdom", fileParallelism: false },
});
