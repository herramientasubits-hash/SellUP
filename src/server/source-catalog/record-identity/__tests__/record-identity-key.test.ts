/**
 * Tests para record-identity-key.ts
 * Hito: EC4D5.B — Shared record identity module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildRecordIdentityKey, validateRecordIdentityKey } from '../record-identity-key';

// ── buildRecordIdentityKey ──────────────────────────────────────────────────

describe('buildRecordIdentityKey', () => {
  it('builds tax:123', () => {
    const result = buildRecordIdentityKey('tax', '123');
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'tax:123');
  });

  it('trims namespace and value', () => {
    const result = buildRecordIdentityKey('  tax  ', '  123  ');
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'tax:123');
  });

  it('rejects empty namespace', () => {
    const result = buildRecordIdentityKey('', '123');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'invalid_value');
  });

  it('rejects empty value', () => {
    const result = buildRecordIdentityKey('tax', '');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('rejects whitespace-only value', () => {
    const result = buildRecordIdentityKey('tax', '   ');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'missing_value');
  });

  it('rejects namespace with colon', () => {
    const result = buildRecordIdentityKey('tax:evil', '123');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'invalid_value');
  });

  it('rejects name namespace', () => {
    const result = buildRecordIdentityKey('name', 'Acme Corp');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'forbidden_namespace');
  });

  it('rejects NAME namespace case-insensitively', () => {
    const result = buildRecordIdentityKey('NAME', 'Acme Corp');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'forbidden_namespace');
  });

  it('does not reject unknown future namespace, e.g. provider:abc', () => {
    const result = buildRecordIdentityKey('provider', 'abc');
    assert.equal(result.status, 'resolved');
    assert.equal(result.status === 'resolved' && result.recordIdentityKey, 'provider:abc');
  });

  it('does not require source_key', () => {
    const result = buildRecordIdentityKey('fedesoft-directory', '123');
    assert.equal(result.status, 'resolved');
    assert.equal(
      result.status === 'resolved' && result.recordIdentityKey,
      'fedesoft-directory:123',
    );
  });
});

// ── validateRecordIdentityKey ────────────────────────────────────────────────

describe('validateRecordIdentityKey', () => {
  it('accepts tax:123', () => {
    const result = validateRecordIdentityKey('tax:123');
    assert.equal(result.valid, true);
  });

  it('accepts provider:abc', () => {
    const result = validateRecordIdentityKey('provider:abc');
    assert.equal(result.valid, true);
  });

  it('accepts fedesoft-directory:123', () => {
    const result = validateRecordIdentityKey('fedesoft-directory:123');
    assert.equal(result.valid, true);
  });

  it('rejects raw value without namespace', () => {
    const result = validateRecordIdentityKey('rawvalue');
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'invalid_value');
  });

  it('rejects :123', () => {
    const result = validateRecordIdentityKey(':123');
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'invalid_value');
  });

  it('rejects tax:', () => {
    const result = validateRecordIdentityKey('tax:');
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'invalid_value');
  });

  it('rejects name:anything', () => {
    const result = validateRecordIdentityKey('name:anything');
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'forbidden_namespace');
  });

  it('rejects NAME:anything', () => {
    const result = validateRecordIdentityKey('NAME:anything');
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'forbidden_namespace');
  });

  it('handles outer whitespace consistently', () => {
    const result = validateRecordIdentityKey('  tax:123  ');
    assert.equal(result.valid, true);
  });

  it('allows colons inside the opaque value part (splits on first colon only)', () => {
    const result = validateRecordIdentityKey('provider:abc:def');
    assert.equal(result.valid, true);
  });

  it('rejects null', () => {
    const result = validateRecordIdentityKey(null);
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'missing_value');
  });

  it('rejects undefined', () => {
    const result = validateRecordIdentityKey(undefined);
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'missing_value');
  });

  it('rejects empty string', () => {
    const result = validateRecordIdentityKey('');
    assert.equal(result.valid, false);
    assert.equal(!result.valid && result.reason, 'missing_value');
  });
});
