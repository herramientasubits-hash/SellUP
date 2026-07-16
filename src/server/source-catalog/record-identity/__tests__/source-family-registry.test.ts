/**
 * Tests para source-family-registry.ts
 * Hito: EC4D5.APP-C1A — Source family registry + snapshot read types
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_FAMILY_BY_SOURCE_KEY,
  getSourceFamily,
  isTaxGrainSource,
  isNativeRecordGrainSource,
} from '../source-family-registry';

const TAX_GRAIN_SOURCE_KEYS = [
  'cl_chilecompra_ocds',
  'cr_sicop',
  'hn_contrataciones_abiertas',
  'do_dgcp',
  'rd_dgii_bulk',
  'gt_rgae_proveedores',
  'co_siis',
] as const;

const NATIVE_RECORD_GRAIN_SOURCE_KEYS = ['pa_panamacompra_convenio', 'co_fedesoft'] as const;

// ── getSourceFamily ──────────────────────────────────────────────────────────

describe('getSourceFamily', () => {
  for (const sourceKey of TAX_GRAIN_SOURCE_KEYS) {
    it(`${sourceKey} → TAX_GRAIN`, () => {
      assert.equal(getSourceFamily(sourceKey), 'TAX_GRAIN');
    });
  }

  for (const sourceKey of NATIVE_RECORD_GRAIN_SOURCE_KEYS) {
    it(`${sourceKey} → NATIVE_RECORD_GRAIN`, () => {
      assert.equal(getSourceFamily(sourceKey), 'NATIVE_RECORD_GRAIN');
    });
  }

  it('unknown source_key throws fail-closed', () => {
    assert.throws(
      () => getSourceFamily('xx_unknown_source'),
      /Unknown source family for source_key: xx_unknown_source/,
    );
  });

  it('ec_scvs is not registered yet (future native record grain, no writer)', () => {
    assert.throws(() => getSourceFamily('ec_scvs'), /Unknown source family/);
  });

  it('empty string throws fail-closed', () => {
    assert.throws(() => getSourceFamily(''), /Unknown source family/);
  });
});

// ── registry shape ───────────────────────────────────────────────────────────

describe('SOURCE_FAMILY_BY_SOURCE_KEY', () => {
  it('registers exactly the 9 active source_keys', () => {
    const registered = Object.keys(SOURCE_FAMILY_BY_SOURCE_KEY).sort();
    const expected = [...TAX_GRAIN_SOURCE_KEYS, ...NATIVE_RECORD_GRAIN_SOURCE_KEYS].sort();
    assert.deepEqual(registered, expected);
  });

  it('has no implicit TAX_GRAIN default: every entry is explicit', () => {
    for (const [sourceKey, family] of Object.entries(SOURCE_FAMILY_BY_SOURCE_KEY)) {
      assert.ok(
        family === 'TAX_GRAIN' || family === 'NATIVE_RECORD_GRAIN',
        `unexpected family for ${sourceKey}: ${family}`,
      );
    }
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────

describe('isTaxGrainSource / isNativeRecordGrainSource', () => {
  it('tax sources: isTaxGrainSource=true, isNativeRecordGrainSource=false', () => {
    for (const sourceKey of TAX_GRAIN_SOURCE_KEYS) {
      assert.equal(isTaxGrainSource(sourceKey), true);
      assert.equal(isNativeRecordGrainSource(sourceKey), false);
    }
  });

  it('native record sources: isNativeRecordGrainSource=true, isTaxGrainSource=false', () => {
    for (const sourceKey of NATIVE_RECORD_GRAIN_SOURCE_KEYS) {
      assert.equal(isNativeRecordGrainSource(sourceKey), true);
      assert.equal(isTaxGrainSource(sourceKey), false);
    }
  });

  it('pa_panamacompra_convenio is NOT TAX_GRAIN', () => {
    assert.equal(isTaxGrainSource('pa_panamacompra_convenio'), false);
  });

  it('co_fedesoft is NOT TAX_GRAIN', () => {
    assert.equal(isTaxGrainSource('co_fedesoft'), false);
  });

  it('helpers also fail closed on unknown source_key', () => {
    assert.throws(() => isTaxGrainSource('xx_unknown_source'), /Unknown source family/);
    assert.throws(() => isNativeRecordGrainSource('xx_unknown_source'), /Unknown source family/);
  });
});
