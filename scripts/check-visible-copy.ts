import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { globSync } from "node:fs";
import { findForbiddenVisibleCopyWords } from "../packages/shared/src/rules/forbiddenWords.js";

const roots = ["apps/miniapp/src", "apps/ops/src", "services/api/src"];
const ignored = [
  /(^|\/)generated\//,
  /\.test\.tsx?$/,
  /probe-state-machine\.ts$/,
  /providers\.ts$/,
];

const files = roots.flatMap((root) =>
  globSync(`${root}/**/*.{ts,tsx}`, { withFileTypes: false }),
);

const findings = files
  .filter((file) => !ignored.some((pattern) => pattern.test(file)))
  .flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return findForbiddenVisibleCopyWords(text).map((finding) => ({
      file,
      ...finding,
    }));
  });

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(
      `${relative(process.cwd(), finding.file)} contains forbidden visible copy "${finding.word}" at index ${finding.index}`,
    );
  }
  process.exit(1);
}
