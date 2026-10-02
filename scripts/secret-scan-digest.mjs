// Only complete, independently delimited SHA-256-sized hex tokens are exempt.
// Adjacent alphanumeric/underscore characters invalidate the entire token.
export function sha256TokenRanges(text) {
  return [...text.matchAll(/(?<![A-Za-z0-9_])[A-Fa-f0-9]{64}(?![A-Za-z0-9_])/g)]
    .map(match => [match.index, match.index + match[0].length]);
}
export function phoneMatchInsideSha256(match, ranges) {
  const start = match.index, end = start + match[0].length;
  return Number.isInteger(start) && ranges.some(([a, b]) => start >= a && end <= b);
}
