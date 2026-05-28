export type SourceConnectionTestStrategy =
  | 'http_get'
  | 'http_head'
  | 'partial_download_head'
  | 'requires_credentials'
  | 'manual_only'
  | 'validation_input_required'
  | 'not_supported';

export type SourceConnectionTestStatus =
  | 'success'
  | 'failed'
  | 'blocked'
  | 'requires_credentials'
  | 'input_required'
  | 'not_supported';

export type SourceConnectionTestErrorCode =
  | 'OK'
  | 'HTTP_403_FORBIDDEN'
  | 'HTTP_404_NOT_FOUND'
  | 'HTTP_429_RATE_LIMITED'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'DNS_ERROR'
  | 'SSL_ERROR'
  | 'CAPTCHA_OR_BOT_PROTECTION'
  | 'CREDENTIALS_REQUIRED'
  | 'INPUT_REQUIRED'
  | 'UNSUPPORTED_SOURCE_TYPE'
  | 'INVALID_RESPONSE_SHAPE'
  | 'LARGE_DOWNLOAD_SKIPPED'
  | 'UNKNOWN_ERROR';

export type SourceConnectionTestResult = {
  sourceKey: string;
  strategy: SourceConnectionTestStrategy;
  status: SourceConnectionTestStatus;
  httpStatus: number | null;
  responseTimeMs: number | null;
  checkedAt: string;
  testedUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  errorCode: SourceConnectionTestErrorCode;
  errorMessage: string | null;
  recommendation: string | null;
  metadata: Record<string, unknown>;
};

export const SOURCE_CONNECTION_TIMEOUT_MS = 8_000;
export const SOURCE_CONNECTION_MAX_REDIRECTS = 3;
export const SOURCE_CONNECTION_MAX_BODY_BYTES = 100_000;
