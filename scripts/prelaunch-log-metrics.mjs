// Limit numeric timing precision in Pino request-completed evidence. Preserve all
// other fields, including potentially sensitive fields for the secret scanner.
export function normalizeRequestTiming(text) {
  return String(text).split('\n').map(line => {
    let record;
    try { record = JSON.parse(line); } catch { return line; }
    if (!record || record.msg !== 'request completed' || typeof record.reqId !== 'string'
      || typeof record.responseTime !== 'number' || !Number.isFinite(record.responseTime)
      || record.responseTime < 0) return line;
    record.responseTime = Math.round(record.responseTime * 1000) / 1000;
    return JSON.stringify(record);
  }).join('\n');
}
