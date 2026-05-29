// Param name is redacted if it equals or contains any of these terms
const SENSITIVE_PARAM_TERMS = [
  'key',
  'token',
  'secret',
  'api',
  'auth',
  'pass',
  'access_token',
  'refresh_token',
  'password',
];

function isSensitiveParam(paramName: string): boolean {
  const lower = paramName.toLowerCase();
  return SENSITIVE_PARAM_TERMS.some((term) => lower === term || lower.includes(term));
}

const REDACTED = 'REDACTED';
const MAX_URL_LENGTH = 2000;
const MAX_METADATA_KEYS = 20;
const MAX_STRING_VALUE_LENGTH = 200;

const BLOCKED_METADATA_KEYS = new Set([
  'body',
  'html',
  'content',
  'response',
  'headers',
  'cookie',
  'token',
  'key',
  'secret',
  'password',
  'authorization',
]);

export function sanitizeTestedUrl(url: string | null): string | null {
  if (url === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Remove fragment — may contain sensitive data
  parsed.hash = '';

  for (const paramName of Array.from(parsed.searchParams.keys())) {
    if (isSensitiveParam(paramName)) {
      parsed.searchParams.set(paramName, REDACTED);
    }
  }

  const sanitized = parsed.toString();
  return sanitized.length <= MAX_URL_LENGTH
    ? sanitized
    : sanitized.slice(0, MAX_URL_LENGTH);
}

export function sanitizeConnectionTestMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  let keyCount = 0;

  for (const [rawKey, value] of Object.entries(metadata)) {
    if (keyCount >= MAX_METADATA_KEYS) break;

    const key = rawKey.toLowerCase();
    if (BLOCKED_METADATA_KEYS.has(key)) continue;

    // No arrays
    if (Array.isArray(value)) continue;

    // No nested objects
    if (typeof value === 'object' && value !== null) continue;

    if (typeof value === 'string') {
      result[rawKey] = value.slice(0, MAX_STRING_VALUE_LENGTH);
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[rawKey] = value;
    }
    // Discard non-serializable values (functions, symbols, undefined)

    keyCount += 1;
  }

  return result;
}
