import { sha256TokenRanges, phoneMatchInsideSha256 } from "./secret-scan-digest.mjs";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { relative } from "node:path";

const ignoredPathParts = [
  "/.git/",
  "/node_modules/",
  "/dist/",
  "/coverage/",
  "/services/api/src/generated/",
  "/.turbo/",
];

const allowedFiles = new Set([".env.example", "pnpm-lock.yaml"]);
const allowedValues = new Set([
  "local-dev-session-secret",
  "timeleft_dev_password",
  "wx_test_secret",
  "test_api_v3_key",
  "test_mch_id",
  "test_cert_serial",
  "13800138000",
  "13900139000",
  "13700137000",
  "13600136000",
]);

const allowedValuePatterns = [
  /^13500135\d{3}$/,
  /^1350020\d{4}$/,
  /^1350021\d{4}$/,
];

const secretPatterns = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g },
  { name: "wechat app secret", pattern: /\b(?:appsecret|app_secret)\b\s*[:=]\s*["']?([A-Za-z0-9_-]{16,})/gi },
  { name: "api key", pattern: /\b(?:api[_-]?key|api[_-]?v3[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_-]{16,})/gi },
  { name: "token", pattern: /\b(?:token|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*["']?([A-Za-z0-9._-]{20,})/gi },
  { name: "openid", pattern: /\b(?:openid|open_id)\b\s*[:=]\s*["']?(o[A-Za-z0-9_-]{20,})/gi },
  { name: "phone", pattern: /(?<!\d)(1[3-9]\d{9})(?!\d)/g },
];

const dotEnvFiles = globSync(".env*", { withFileTypes: false }).filter(
  (file) => file !== ".env.example",
);
if (dotEnvFiles.length > 0) {
  for (const file of dotEnvFiles) {
    console.error(`${file} must not be committed or scanned as repo config`);
  }
  process.exit(1);
}

const files = globSync("**/*", {
  nodir: true,
  dot: true,
  withFileTypes: false,
}).filter((file) => {
  const normalized = `/${file}`;
  if (allowedFiles.has(file)) {
    return false;
  }
  return !ignoredPathParts.some((part) => normalized.includes(part));
});

const findings: string[] = [];

for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const digestRanges = sha256TokenRanges(text);
  for (const { name, pattern } of secretPatterns) {
    for (const match of text.matchAll(pattern)) {
    const value = match[1];
    if (name === "phone" && phoneMatchInsideSha256(match, digestRanges)) continue;
    if (value && isAllowedLiteralMatch(name, value, match[0])) {
      continue;
    }
    if (
      value &&
      (allowedValues.has(value) ||
        allowedValuePatterns.some((allowedPattern) => allowedPattern.test(value)))
    ) {
      continue;
    }
    findings.push(`${relative(process.cwd(), file)} matched ${name}`);
    }
  }
}

function isAllowedLiteralMatch(name: string, value: string, rawMatch: string): boolean {
  return (
    name === "token" &&
    value === "https" &&
    rawMatch.includes("https://api.weixin.qq.com/cgi-bin/token")
  );
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(finding);
  }
  process.exit(1);
}
