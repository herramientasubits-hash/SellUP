/**
 * Tests para tax-record-identity.ts y record-identity-conflict-targets.ts
 * Hito: EC4D5.B — Shared record identity module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveTaxRecordIdentity } from '../tax-record-identity';
import {
  OLD_TAX_GRAIN_ON_CONFLICT,
  RECORD_IDENTITY_ON_CONFLICT,
} from '../record-identity-conflict-targets';

// ── deriveTaxRecordIdentity ──────────────────────────────────────────────────

describe('deriveTaxRecordIdentity', () => {
  it('null → unavailable missing_tax_id', () => {
    const result = deriveTaxRecordIdentity(null);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_tax_id');
  });

  it('undefined → unavailable missing_tax_id', () => {
    const result = deriveTaxRecordIdentity(undefined);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_tax_id');
  });

  it('empty → unavailable missing_tax_id', () => {
    const result = deriveTaxRecordIdentity('');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_tax_id');
  });

  it('whitespace → unavailable missing_tax_id', () => {
    const result = deriveTaxRecordIdentity('   ');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_tax_id');
  });

  it('valid normalized tax → resolved tax:<value>', () => {
    const result = deriveTaxRecordIdentity('900123456');
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'tax:900123456');
  });

  it('trims a normalized tax id with surrounding whitespace', () => {
    const result = deriveTaxRecordIdentity('  900123456  ');
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'tax:900123456');
  });
});

// ── Conflict target constants ────────────────────────────────────────────────

describe('conflict target constants', () => {
  it('OLD_TAX_GRAIN_ON_CONFLICT exact string', () => {
    assert.equal(
      OLD_TAX_GRAIN_ON_CONFLICT,
      'source_key,country_code,source_year,normalized_tax_id',
    );
  });

  it('RECORD_IDENTITY_ON_CONFLICT exact string', () => {
    assert.equal(
      RECORD_IDENTITY_ON_CONFLICT,
      'source_key,country_code,source_year,record_identity_key',
    );
  });

  it('constants are different', () => {
    assert.notEqual(OLD_TAX_GRAIN_ON_CONFLICT, RECORD_IDENTITY_ON_CONFLICT);
  });
});
