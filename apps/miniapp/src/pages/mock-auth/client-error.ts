const SENSITIVE_VALUE_PATTERN = /\b(code|token|authorization|session_key|openid|phone|appsecret)\b\s*[:=]\s*[^\s,;，；}]+/gi;
const MAX_MESSAGE_LENGTH = 180;

export function formatClientError(error: unknown, fallback: string): string {
  const candidate = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "errMsg" in error && typeof error.errMsg === "string"
      ? error.errMsg
      : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : "";

  const message = candidate.trim().replace(SENSITIVE_VALUE_PATTERN, "$1=已隐藏");
  return message ? `${fallback}：${message.slice(0, MAX_MESSAGE_LENGTH)}` : fallback;
}
