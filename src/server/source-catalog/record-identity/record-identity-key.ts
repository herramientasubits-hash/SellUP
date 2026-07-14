/**
 * Generic record identity key builder and validator.
 * Hito: EC4D5.B — Shared record identity module
 *
 * Namespace model is extensible on purpose: no allowlist, no source_key
 * switch. The only globally forbidden namespace is 'name' (and any casing
 * of it), because legal/company name must never become an identity
 * fallback. Source-specific derivation (Panama, Fedesoft, SCVS, ...) is
 * connector-owned and does not belong here.
 */

import type {
  RecordIdentityKey,
  RecordIdentityResult,
  RecordIdentityValidation,
} from './record-identity-types';

const FORBIDDEN_NAMESPACE = 'name';

export function normalizeRecordIdentityPart(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function buildRecordIdentityKey(namespace: string, value: unknown): RecordIdentityResult {
  const trimmedNamespace = typeof namespace === 'string' ? namespace.trim() : '';

  if (trimmedNamespace.length === 0) {
    return { status: 'unavailable', reason: 'invalid_value' };
  }

  if (trimmedNamespace.includes(':')) {
    return { status: 'unavailable', reason: 'invalid_value' };
  }

  if (trimmedNamespace.toLowerCase() === FORBIDDEN_NAMESPACE) {
    return { status: 'unavailable', reason: 'forbidden_namespace' };
  }

  const normalizedPart = normalizeRecordIdentityPart(value);
  if (normalizedPart === null) {
    return { status: 'unavailable', reason: 'missing_value' };
  }

  return {
    status: 'resolved',
    recordIdentityKey: `${trimmedNamespace}:${normalizedPart}` as RecordIdentityKey,
  };
}

/**
 * Splits on the FIRST colon only. The identity part is opaque and future
 * provider IDs may contain their own punctuation (including colons), so a
 * single-namespace-separator model is the safer default.
 */
export function validateRecordIdentityKey(value: unknown): RecordIdentityValidation {
  if (typeof value !== 'string') {
    return { valid: false, reason: 'missing_value' };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'missing_value' };
  }

  const separatorIndex = trimmed.indexOf(':');
  if (separatorIndex === -1) {
    return { valid: false, reason: 'invalid_value' };
  }

  const namespace = trimmed.slice(0, separatorIndex);
  const identityPart = trimmed.slice(separatorIndex + 1);

  if (namespace.length === 0 || identityPart.length === 0) {
    return { valid: false, reason: 'invalid_value' };
  }

  if (namespace.toLowerCase() === FORBIDDEN_NAMESPACE) {
    return { valid: false, reason: 'forbidden_namespace' };
  }

  return { valid: true };
}
