/**
 * Redaction for anything that might end up in a log or an error detail (spec 01, "Logging";
 * spec 02, "Security rules"): bearer tokens, JWT-shaped strings and Authorization headers.
 */
const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const BEARER = /(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const AUTH_HEADER = /("?authorization"?\s*[:=]\s*"?)[^",}\n]+/gi;

export function redact(text: string): string {
  return text
    .replace(JWT, '[redacted-jwt]')
    .replace(BEARER, '$1[redacted]')
    .replace(AUTH_HEADER, '$1[redacted]');
}

/** Short, redacted description of an error, safe for logs and UI details. */
export function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redact(text).slice(0, 500);
}
