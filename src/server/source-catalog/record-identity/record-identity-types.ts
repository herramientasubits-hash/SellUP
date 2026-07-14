/**
 * Shared record identity types.
 * Hito: EC4D5.B — Shared record identity module
 *
 * record_identity_key is namespaced, opaque to the DB, and connector-owned.
 * No source-specific derivation rules live in this module.
 */

export type RecordIdentityKey = string & { readonly __brand: 'RecordIdentityKey' };

export type RecordIdentityUnavailableReason =
  | 'missing_value'
  | 'invalid_value'
  | 'forbidden_namespace'
  | 'missing_tax_id';

export interface RecordIdentityResolved {
  readonly status: 'resolved';
  readonly recordIdentityKey: RecordIdentityKey;
}

export interface RecordIdentityUnavailable {
  readonly status: 'unavailable';
  readonly reason: RecordIdentityUnavailableReason;
}

export type RecordIdentityResult = RecordIdentityResolved | RecordIdentityUnavailable;

export type RecordIdentityValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: RecordIdentityUnavailableReason };
