/**
 * Tests — Account Picker Helpers (17A.7D.3)
 * Node.js built-in test runner. Sin I/O externo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { accountPickerLabel, resolveSelectedAccountLabel } from '../account-picker-helpers';

const accounts = [
  { id: '11c1c787-1e23-43e0-93df-52a6ee10beb5', name: 'Siesa', domain: 'siesa.com' },
  { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Acme', domain: null },
];

describe('accountPickerLabel', () => {
  it('includes domain when present', () => {
    assert.equal(accountPickerLabel(accounts[0]), 'Siesa · siesa.com');
  });

  it('returns name only when no domain', () => {
    assert.equal(accountPickerLabel(accounts[1]), 'Acme');
  });
});

describe('resolveSelectedAccountLabel', () => {
  it('returns label from accounts list when id matches', () => {
    const label = resolveSelectedAccountLabel(
      '11c1c787-1e23-43e0-93df-52a6ee10beb5',
      accounts,
      undefined,
    );
    assert.equal(label, 'Siesa · siesa.com');
  });

  it('returns name-only label when account has no domain', () => {
    const label = resolveSelectedAccountLabel(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      accounts,
      undefined,
    );
    assert.equal(label, 'Acme');
  });

  it('uses fallbackLabel when id not in accounts list', () => {
    const label = resolveSelectedAccountLabel(
      '99999999-0000-0000-0000-000000000000',
      [],
      'Siesa · siesa.com',
    );
    assert.equal(label, 'Siesa · siesa.com');
  });

  it('returns null (never UUID) when id not found and no fallback', () => {
    const label = resolveSelectedAccountLabel(
      '11c1c787-1e23-43e0-93df-52a6ee10beb5',
      [],
      undefined,
    );
    assert.equal(label, null);
  });

  it('returns null when selectedAccountId is empty', () => {
    assert.equal(resolveSelectedAccountLabel('', accounts, undefined), null);
  });

  it('never returns a string that looks like a UUID', () => {
    const uuid = '11c1c787-1e23-43e0-93df-52a6ee10beb5';
    const label = resolveSelectedAccountLabel(uuid, [], undefined);
    assert.notEqual(label, uuid);
    assert.equal(label, null);
  });
});
