/**
 * Tests para ec-scvs-record-identity.ts
 * Hito: EC-SCVS-1 — Registry and identity builder
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveEcScvsRecordIdentity } from '../ec-scvs-record-identity';
import { validateRecordIdentityKey } from '../../../record-identity';

// ── deriveEcScvsRecordIdentity ───────────────────────────────────────────────

describe('deriveEcScvsRecordIdentity', () => {
  it('expediente 12345 → resolved expediente:12345', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: '12345' });
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'expediente:12345');
  });

  it('trims surrounding whitespace → expediente:12345', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: ' 12345 ' });
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'expediente:12345');
  });

  it('empty expediente → unavailable, no key', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: '' });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('whitespace-only expediente → unavailable, no key', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: '   ' });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('null expediente → unavailable, no key', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: null });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('undefined expediente → unavailable, no key', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: undefined });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('missing expediente field → unavailable, no key', () => {
    const result = deriveEcScvsRecordIdentity({});
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('numeric-string expediente is preserved as string after trim', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: '  007  ' });
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'expediente:007');
  });

  it('always uses the expediente namespace — never name:', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: 'ACME SA' });
    assert.equal(result.status, 'resolved');
    assert.ok(
      result.status === 'resolved' && result.recordIdentityKey.startsWith('expediente:'),
      'record_identity_key must be namespaced with expediente',
    );
    assert.ok(
      result.status === 'resolved' && !result.recordIdentityKey.startsWith('name:'),
      'record_identity_key must never use the name namespace',
    );
  });

  it('never uses the tax: namespace for EC SCVS', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: '900123456' });
    assert.equal(result.status, 'resolved');
    assert.ok(
      result.status === 'resolved' && !result.recordIdentityKey.startsWith('tax:'),
      'EC SCVS identity must not be fiscal (tax:)',
    );
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'expediente:900123456');
  });

  it('resolved key passes validateRecordIdentityKey', () => {
    const result = deriveEcScvsRecordIdentity({ expediente: ' 12345 ' });
    assert.equal(result.status, 'resolved');
    if (result.status === 'resolved') {
      assert.equal(validateRecordIdentityKey(result.recordIdentityKey).valid, true);
    }
  });

  it('does not throw on invalid expediente values', () => {
    assert.doesNotThrow(() => deriveEcScvsRecordIdentity({ expediente: null }));
    assert.doesNotThrow(() => deriveEcScvsRecordIdentity({ expediente: '' }));
    assert.doesNotThrow(() => deriveEcScvsRecordIdentity({}));
  });
});
