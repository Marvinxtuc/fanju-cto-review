export const FORBIDDEN_VISIBLE_COPY_WORDS = [
  "交友",
  "相亲",
  "约会",
  "脱单",
  "匹配对象",
  "陌生人交友",
  "CP",
  "找对象",
] as const;

export type ForbiddenVisibleCopyWord =
  (typeof FORBIDDEN_VISIBLE_COPY_WORDS)[number];

export interface ForbiddenWordFinding {
  word: ForbiddenVisibleCopyWord;
  index: number;
}

export function findForbiddenVisibleCopyWords(
  text: string,
): ForbiddenWordFinding[] {
  const findings: ForbiddenWordFinding[] = [];

  for (const word of FORBIDDEN_VISIBLE_COPY_WORDS) {
    const index = text.indexOf(word);
    if (index >= 0) {
      findings.push({ word, index });
    }
  }

  return findings.sort((left, right) => left.index - right.index);
}

export function assertVisibleCopyAllowed(text: string): void {
  const findings = findForbiddenVisibleCopyWords(text);
  if (findings.length > 0) {
    throw new Error(
      `User-visible copy contains forbidden words: ${findings
        .map((finding) => finding.word)
        .join(", ")}`,
    );
  }
}
