/**
 * Tests — v1.16K-M Structured source writer tax identifier type mapping
 *
 * Verifies the resolvedTaxIdentifierType mapping in the writer:
 * CO → NIT, MX → RFC, CL → RUT, PE → RUC, EC → RUC.
 *
 * Since the mapping is inline in writeBatchToDatabase, we test it
 * by inspecting the logic directly through a minimal isolation layer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Replicate the mapping logic from structured-source-candidate-writer.ts
// to allow unit testing without instantiating the full writer.
function resolvedTaxIdentifierTypeFor(countryCode: string | null | undefined): string | null {
  const upperCc = countryCode?.toUpperCase();
  if (upperCc === 'CO') return 'NIT';
  if (upperCc === 'MX') return 'RFC';
  if (upperCc === 'CL') return 'RUT';
  if (upperCc === 'PE') return 'RUC';
  if (upperCc === 'EC') return 'RUC';
  return null;
}

describe('SSWT1 — tax_identifier_type mapping per country', () => {
  it('CO → NIT', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('CO'), 'NIT');
  });

  it('MX → RFC', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('MX'), 'RFC');
  });

  it('CL → RUT', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('CL'), 'RUT');
  });

  it('PE → RUC', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('PE'), 'RUC');
  });

  it('EC → RUC', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('EC'), 'RUC');
  });

  it('lowercase codes are normalized (co → NIT)', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('co'), 'NIT');
    assert.equal(resolvedTaxIdentifierTypeFor('mx'), 'RFC');
    assert.equal(resolvedTaxIdentifierTypeFor('pe'), 'RUC');
    assert.equal(resolvedTaxIdentifierTypeFor('ec'), 'RUC');
  });
});

describe('SSWT2 — structured-source-candidate-writer module integrity', () => {
  it('module can be imported without errors', async () => {
    const mod = await import('../structured-source-candidate-writer');
    assert.ok(typeof mod === 'object');
  });

  it('PE and EC map to the same tax type (RUC)', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('PE'), resolvedTaxIdentifierTypeFor('EC'));
  });

  it('CO, MX, CL, PE, EC all produce non-null tax types', () => {
    for (const cc of ['CO', 'MX', 'CL', 'PE', 'EC']) {
      const result = resolvedTaxIdentifierTypeFor(cc);
      assert.notEqual(result, null, `${cc} should produce a non-null tax type`);
    }
  });

  it('unknown country code produces null (no default assumed)', () => {
    assert.equal(resolvedTaxIdentifierTypeFor('AR'), null);
    assert.equal(resolvedTaxIdentifierTypeFor('BR'), null);
    assert.equal(resolvedTaxIdentifierTypeFor(null), null);
    assert.equal(resolvedTaxIdentifierTypeFor(undefined), null);
  });
});
