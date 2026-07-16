/**
 * Tests para snapshot-read-types.ts
 * Hito: EC4D5.APP-C1A — Source family registry + snapshot read types
 *
 * The union is type-only; these tests exercise compile-time assignability
 * (values typed as SnapshotReadResult) plus the runtime status catalog.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RecordIdentityUnavailableReason } from '../../record-identity/record-identity-types';
import {
  SNAPSHOT_READ_STATUSES,
  type SnapshotReadResult,
  type SnapshotReadStatus,
} from '../snapshot-read-types';

type SampleRow = { readonly id: string; readonly name: string };

// ── compile-time assignability (would break typecheck if the union drifts) ──

const foundResult: SnapshotReadResult<SampleRow> = {
  status: 'FOUND',
  row: { id: 'row-1', name: 'ACME' },
};

const notFoundResult: SnapshotReadResult<SampleRow> = {
  status: 'RECORD_IDENTITY_NOT_FOUND',
};

const unavailableReason: RecordIdentityUnavailableReason = 'missing_tax_id';
const identityUnavailableResult: SnapshotReadResult<SampleRow> = {
  status: 'IDENTITY_UNAVAILABLE',
  reason: unavailableReason,
};

const multiRecordResult: SnapshotReadResult<SampleRow> = {
  status: 'MULTI_RECORD_SAME_FISCAL_IDENTITY',
  sourceKey: 'pa_panamacompra_convenio',
  countryCode: 'PA',
  sourceYear: 2026,
  normalizedTaxId: '155-123-456',
  recordCount: 2,
  recordIdentityKeys: ['provider:111', 'provider:222'],
};

const invariantViolationResult: SnapshotReadResult<SampleRow> = {
  status: 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION',
  sourceKey: 'cr_sicop',
  countryCode: 'CR',
  normalizedTaxId: '3101123456',
  recordCount: 2,
};

function describeResult(result: SnapshotReadResult<SampleRow>): string {
  switch (result.status) {
    case 'FOUND':
      return `found:${result.row.id}`;
    case 'RECORD_IDENTITY_NOT_FOUND':
      return 'not_found';
    case 'IDENTITY_UNAVAILABLE':
      return `unavailable:${result.reason}`;
    case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
      return `multi:${result.sourceKey}:${result.recordCount}`;
    case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
      return `violation:${result.sourceKey}:${result.recordCount}`;
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled snapshot read status: ${String(exhaustive)}`);
    }
  }
}

// ── runtime assertions ───────────────────────────────────────────────────────

describe('SnapshotReadResult', () => {
  it('FOUND carries the typed row', () => {
    assert.equal(describeResult(foundResult), 'found:row-1');
  });

  it('RECORD_IDENTITY_NOT_FOUND has no payload beyond status', () => {
    assert.equal(describeResult(notFoundResult), 'not_found');
    assert.deepEqual(Object.keys(notFoundResult), ['status']);
  });

  it('IDENTITY_UNAVAILABLE accepts RecordIdentityUnavailableReason', () => {
    assert.equal(describeResult(identityUnavailableResult), 'unavailable:missing_tax_id');
  });

  it('MULTI_RECORD_SAME_FISCAL_IDENTITY carries fiscal context and counts', () => {
    assert.equal(describeResult(multiRecordResult), 'multi:pa_panamacompra_convenio:2');
  });

  it('SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION carries fiscal context and counts', () => {
    assert.equal(describeResult(invariantViolationResult), 'violation:cr_sicop:2');
  });

  it('switch over statuses is exhaustive (never default unreachable)', () => {
    const results: SnapshotReadResult<SampleRow>[] = [
      foundResult,
      notFoundResult,
      identityUnavailableResult,
      multiRecordResult,
      invariantViolationResult,
    ];
    for (const result of results) {
      assert.equal(typeof describeResult(result), 'string');
    }
  });
});

describe('SNAPSHOT_READ_STATUSES', () => {
  it('lists exactly the 5 statuses of the union', () => {
    const expected: readonly SnapshotReadStatus[] = [
      'FOUND',
      'RECORD_IDENTITY_NOT_FOUND',
      'IDENTITY_UNAVAILABLE',
      'MULTI_RECORD_SAME_FISCAL_IDENTITY',
      'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION',
    ];
    assert.deepEqual([...SNAPSHOT_READ_STATUSES].sort(), [...expected].sort());
    assert.equal(SNAPSHOT_READ_STATUSES.length, 5);
  });
});
