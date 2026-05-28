import type { SourceConnectionTestErrorCode } from './types';

const SECRET_PATTERNS = [
  /api[_-]?key=[^\s&"']+/gi,
  /token=[^\s&"']+/gi,
  /access[_-]?token=[^\s&"']+/gi,
  /Authorization:\s*Bearer\s+\S+/gi,
  /key=[^\s&"']+/gi,
  /secret=[^\s&"']+/gi,
];

export function sanitizeErrorMessage(error: unknown): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = 'Error desconocido';
  }

  // Strip stack traces
  const stackIndex = message.indexOf('\n    at ');
  if (stackIndex !== -1) {
    message = message.slice(0, stackIndex);
  }

  // Remove secret patterns
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, '[REDACTED]');
  }

  return message.slice(0, 500);
}

export function mapHttpStatusToErrorCode(
  status: number,
): SourceConnectionTestErrorCode {
  if (status >= 200 && status < 400) return 'OK';
  if (status === 403) return 'HTTP_403_FORBIDDEN';
  if (status === 404) return 'HTTP_404_NOT_FOUND';
  if (status === 429) return 'HTTP_429_RATE_LIMITED';
  if (status >= 500) return 'HTTP_5XX';
  return 'UNKNOWN_ERROR';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function measureResponseTime(): { end: () => number } {
  const start = Date.now();
  return {
    end: () => Date.now() - start,
  };
}
