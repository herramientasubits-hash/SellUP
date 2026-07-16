/**
 * Snapshot read contract types for source_company_snapshots.
 * Hito: EC4D5.APP-C1A — Source family registry + snapshot read types
 *
 * SnapshotReadResult is the discriminated union every cardinality-aware
 * snapshot reader must return (APP-C readers, not implemented yet).
 *
 * DB/transport errors are deliberately NOT part of this union: readers
 * throw (or wrap externally) on infrastructure failure. The union only
 * models domain outcomes of a well-formed lookup.
 */

import type { RecordIdentityUnavailableReason } from '../record-identity/record-identity-types';

export interface SnapshotReadFound<TRow> {
  readonly status: 'FOUND';
  readonly row: TRow;
}

export interface SnapshotReadRecordIdentityNotFound {
  readonly status: 'RECORD_IDENTITY_NOT_FOUND';
}

export interface SnapshotReadIdentityUnavailable {
  readonly status: 'IDENTITY_UNAVAILABLE';
  readonly reason: RecordIdentityUnavailableReason;
}

/**
 * NATIVE_RECORD_GRAIN sources: the same fiscal identity legitimately maps
 * to more than one record. Callers must disambiguate, never pick silently.
 */
export interface SnapshotReadMultiRecordSameFiscalIdentity {
  readonly status: 'MULTI_RECORD_SAME_FISCAL_IDENTITY';
  readonly sourceKey: string;
  readonly countryCode: string;
  readonly sourceYear?: number;
  readonly normalizedTaxId: string;
  readonly recordCount: number;
  readonly recordIdentityKeys?: readonly string[];
}

/**
 * TAX_GRAIN sources: more than one row for the same fiscal identity within
 * (source_key, country_code, source_year) violates the family invariant.
 * This is a data-integrity signal, not a normal domain outcome.
 */
export interface SnapshotReadSourceFamilyCardinalityInvariantViolation {
  readonly status: 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION';
  readonly sourceKey: string;
  readonly countryCode: string;
  readonly sourceYear?: number;
  readonly normalizedTaxId: string;
  readonly recordCount: number;
}

export type SnapshotReadResult<TRow> =
  | SnapshotReadFound<TRow>
  | SnapshotReadRecordIdentityNotFound
  | SnapshotReadIdentityUnavailable
  | SnapshotReadMultiRecordSameFiscalIdentity
  | SnapshotReadSourceFamilyCardinalityInvariantViolation;

export type SnapshotReadStatus = SnapshotReadResult<unknown>['status'];

export const SNAPSHOT_READ_STATUSES: readonly SnapshotReadStatus[] = [
  'FOUND',
  'RECORD_IDENTITY_NOT_FOUND',
  'IDENTITY_UNAVAILABLE',
  'MULTI_RECORD_SAME_FISCAL_IDENTITY',
  'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION',
];
