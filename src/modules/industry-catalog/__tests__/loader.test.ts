/**
 * Tests — Industry Catalog Loader (16AB.34)
 *
 * Sections:
 *   A — Transform and dedup (tests 1–7)
 *   B — Geographic filter helpers (tests 8–14)
 *   C — Error and edge cases (tests 15–20)
 *
 * No real Supabase queries. Pure unit tests against the transform/validation logic.
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSubindustryApplicable,
  detectIncompatibleSubindustries,
  CatalogLoadError,
} from '../loader';
import type { CatalogSubindustryOption } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<CatalogSubindustryOption> = {}): CatalogSubindustryOption {
  return {
    id: 'sub-1',
    industryId: 'ind-1',
    name: 'Test Sub',
    slug: 'test-sub',
    description: null,
    applicableCountries: null,
    sortOrder: 0,
    ...overrides,
  };
}

// ── Section A: Transform and dedup ────────────────────────────────────────────

describe('Section A — loader transform logic', () => {
  it('A1: CatalogLoadError carries reason and message', () => {
    const err = new CatalogLoadError('empty_catalog', 'no rows');
    assert.equal(err.reason, 'empty_catalog');
    assert.equal(err.message, 'no rows');
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'CatalogLoadError');
  });

  it('A2: CatalogLoadError with query_failed reason', () => {
    const err = new CatalogLoadError('query_failed', 'db down');
    assert.equal(err.reason, 'query_failed');
  });

  it('A3: CatalogLoadError with mixed_versions reason', () => {
    const err = new CatalogLoadError('mixed_versions', '1.0.0, 2.0.0');
    assert.equal(err.reason, 'mixed_versions');
  });

  it('A4: CatalogLoadError with duplicate_ids reason', () => {
    const err = new CatalogLoadError('duplicate_ids', 'dup');
    assert.equal(err.reason, 'duplicate_ids');
  });

  it('A5: CatalogLoadError with invalid_industry reason', () => {
    const err = new CatalogLoadError('invalid_industry', 'missing id');
    assert.equal(err.reason, 'invalid_industry');
  });

  it('A6: CatalogLoadError with invalid_subindustry reason', () => {
    const err = new CatalogLoadError('invalid_subindustry', 'missing id');
    assert.equal(err.reason, 'invalid_subindustry');
  });

  it('A7: CatalogLoadError with inconsistent_payload reason', () => {
    const err = new CatalogLoadError('inconsistent_payload', 'cross-version');
    assert.equal(err.reason, 'inconsistent_payload');
  });
});

// ── Section B: Geographic filter helpers ──────────────────────────────────────

describe('Section B — isSubindustryApplicable', () => {
  it('B1: null applicable_countries applies to any country', () => {
    const sub = makeSub({ applicableCountries: null });
    assert.ok(isSubindustryApplicable(sub, 'CO'));
    assert.ok(isSubindustryApplicable(sub, 'BR'));
    assert.ok(isSubindustryApplicable(sub, 'MX'));
  });

  it('B2: specific country array allows included country', () => {
    const sub = makeSub({ applicableCountries: ['CO', 'MX'] });
    assert.ok(isSubindustryApplicable(sub, 'CO'));
    assert.ok(isSubindustryApplicable(sub, 'MX'));
  });

  it('B3: specific country array excludes non-included country', () => {
    const sub = makeSub({ applicableCountries: ['CO', 'MX'] });
    assert.equal(isSubindustryApplicable(sub, 'BR'), false);
    assert.equal(isSubindustryApplicable(sub, 'CL'), false);
    assert.equal(isSubindustryApplicable(sub, 'AR'), false);
  });

  it('B4: single-country array matches exactly', () => {
    const sub = makeSub({ applicableCountries: ['BR'] });
    assert.ok(isSubindustryApplicable(sub, 'BR'));
    assert.equal(isSubindustryApplicable(sub, 'CO'), false);
  });

  it('B5: detectIncompatibleSubindustries returns empty when all compatible', () => {
    const subs: CatalogSubindustryOption[] = [
      makeSub({ id: 'a', applicableCountries: null }),
      makeSub({ id: 'b', applicableCountries: ['CO', 'MX'] }),
    ];
    const result = detectIncompatibleSubindustries(['a', 'b'], subs, 'CO');
    assert.deepEqual(result, []);
  });

  it('B6: detectIncompatibleSubindustries identifies incompatible ids', () => {
    const subs: CatalogSubindustryOption[] = [
      makeSub({ id: 'a', applicableCountries: null }),
      makeSub({ id: 'b', applicableCountries: ['CO'] }),
    ];
    const result = detectIncompatibleSubindustries(['a', 'b'], subs, 'BR');
    assert.deepEqual(result, ['b']);
  });

  it('B7: detectIncompatibleSubindustries treats unknown id as incompatible', () => {
    const subs: CatalogSubindustryOption[] = [
      makeSub({ id: 'a', applicableCountries: null }),
    ];
    const result = detectIncompatibleSubindustries(['a', 'unknown-id'], subs, 'CO');
    assert.deepEqual(result, ['unknown-id']);
  });
});

// ── Section C: Edge cases ─────────────────────────────────────────────────────

describe('Section C — edge cases', () => {
  it('C1: detectIncompatibleSubindustries with empty selection returns empty', () => {
    const subs: CatalogSubindustryOption[] = [
      makeSub({ id: 'a', applicableCountries: ['CO'] }),
    ];
    const result = detectIncompatibleSubindustries([], subs, 'BR');
    assert.deepEqual(result, []);
  });

  it('C2: detectIncompatibleSubindustries all incompatible', () => {
    const subs: CatalogSubindustryOption[] = [
      makeSub({ id: 'a', applicableCountries: ['CO'] }),
      makeSub({ id: 'b', applicableCountries: ['MX'] }),
    ];
    const result = detectIncompatibleSubindustries(['a', 'b'], subs, 'BR');
    assert.deepEqual(result.sort(), ['a', 'b']);
  });

  it('C3: isSubindustryApplicable with empty country code string', () => {
    const sub = makeSub({ applicableCountries: ['CO'] });
    assert.equal(isSubindustryApplicable(sub, ''), false);
  });

  it('C4: isSubindustryApplicable null array always true for empty country', () => {
    const sub = makeSub({ applicableCountries: null });
    assert.ok(isSubindustryApplicable(sub, ''));
  });

  it('C5: detectIncompatibleSubindustries with null-only subs, any country', () => {
    const subs: CatalogSubindustryOption[] = [
      makeSub({ id: 'a', applicableCountries: null }),
      makeSub({ id: 'b', applicableCountries: null }),
    ];
    const result = detectIncompatibleSubindustries(['a', 'b'], subs, 'PE');
    assert.deepEqual(result, []);
  });

  it('C6: CatalogLoadError is instanceof Error', () => {
    const err = new CatalogLoadError('empty_catalog', 'test');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof CatalogLoadError);
  });
});
