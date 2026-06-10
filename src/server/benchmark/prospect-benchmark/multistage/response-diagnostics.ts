/**
 * Response Diagnostics — Hotfix 16AB.23.9
 *
 * Sanitized metadata about failed API responses.
 *
 * Safety invariants — this module NEVER stores:
 *   - Raw response text
 *   - Full prompt content
 *   - API keys or auth headers
 *   - Encrypted content or indexes
 *   - Full candidate JSON
 *
 * Only metadata derived from the response is stored:
 *   - SHA-256 of text (for identical-retry detection)
 *   - First/last non-whitespace character (for truncation diagnosis)
 *   - Content block type list
 *   - Text length
 *   - Stop reason
 *   - Validation issue paths/codes (no values)
 */

import { createHash } from 'crypto';

// ─── Diagnostic error codes ───────────────────────────────────────────────────

export type InvalidResponseDiagnosticCode =
  | 'http_error'
  | 'empty_response'
  | 'no_text_blocks'
  | 'no_json_candidate'
  | 'malformed_json'
  | 'schema_validation_failed'
  | 'partial_candidate_validation'
  | 'truncated_output'
  | 'max_tokens'
  | 'pause_turn_unhandled'
  | 'unsupported_content_blocks'
  | 'provider_error'
  | 'repeated_invalid_response'
  // 16AB.23.10 — non-retryable provider errors
  | 'insufficient_credits'
  | 'provider_billing_error'
  | 'provider_account_disabled'
  | 'authentication_error';

// ─── Diagnostic record ────────────────────────────────────────────────────────

export type InvalidResponseDiagnostic = {
  errorCode: InvalidResponseDiagnosticCode;
  stage: string;
  batchId?: number;
  attemptNumber?: number;
  stopReason?: string | null;
  contentBlockTypes: string[];
  textLength: number;
  /** SHA-256 hex of the text. Null for empty responses. Used for identical-retry detection. */
  textSha256: string | null;
  firstNonWhitespaceCharacter?: string;
  lastNonWhitespaceCharacter?: string;
  jsonCandidateCount: number;
  validationIssues: Array<{ path: string; code: string }>;
  usageReceived: boolean;
  searchAuditReceived: boolean;
  retryable: boolean;
  timestamp: string;
};

// ─── Hash helpers ─────────────────────────────────────────────────────────────

/** SHA-256 hex of a text string. Returns null for empty input. */
export function computeTextSha256(text: string): string | null {
  if (!text) return null;
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Sanitized fingerprint combining text hash + error code + stop reason.
 * Used to detect consecutive identical responses within a retry sequence.
 * Returns a 16-char hex prefix — sufficient for equality checks, not for security.
 */
export function computeResponseHash(
  text: string,
  errorCode: string | null,
  stopReason: string | null | undefined
): string {
  const textHash = computeTextSha256(text) ?? '';
  return createHash('sha256')
    .update(`t:${textHash}|e:${errorCode ?? ''}|s:${stopReason ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

// ─── Diagnostic builder ───────────────────────────────────────────────────────

function firstNonWhitespace(text: string): string | undefined {
  const m = text.match(/\S/);
  return m?.[0];
}

function lastNonWhitespace(text: string): string | undefined {
  // Use a simple loop to avoid backtracking concerns
  for (let i = text.length - 1; i >= 0; i--) {
    if (!/\s/.test(text[i])) return text[i];
  }
  return undefined;
}

export function buildInvalidResponseDiagnostic(opts: {
  errorCode: InvalidResponseDiagnosticCode;
  stage: string;
  batchId?: number;
  attemptNumber?: number;
  stopReason?: string | null;
  contentBlockTypes?: string[];
  /** Raw text — used only to derive metadata. NEVER stored as-is. */
  text?: string;
  jsonCandidateCount?: number;
  validationIssues?: Array<{ path: string; code: string }>;
  usageReceived: boolean;
  searchAuditReceived: boolean;
  retryable: boolean;
}): InvalidResponseDiagnostic {
  const text = opts.text ?? '';
  const sha = text.length > 0 ? computeTextSha256(text) : null;

  const diag: InvalidResponseDiagnostic = {
    errorCode: opts.errorCode,
    stage: opts.stage,
    stopReason: opts.stopReason ?? null,
    contentBlockTypes: opts.contentBlockTypes ?? [],
    textLength: text.length,
    textSha256: sha,
    jsonCandidateCount: opts.jsonCandidateCount ?? 0,
    validationIssues: opts.validationIssues ?? [],
    usageReceived: opts.usageReceived,
    searchAuditReceived: opts.searchAuditReceived,
    retryable: opts.retryable,
    timestamp: new Date().toISOString(),
  };

  if (opts.batchId !== undefined) diag.batchId = opts.batchId;
  if (opts.attemptNumber !== undefined) diag.attemptNumber = opts.attemptNumber;

  if (text.length > 0) {
    const first = firstNonWhitespace(text);
    const last = lastNonWhitespace(text);
    if (first !== undefined) diag.firstNonWhitespaceCharacter = first;
    if (last !== undefined) diag.lastNonWhitespaceCharacter = last;
  }

  return diag;
}
