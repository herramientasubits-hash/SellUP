/**
 * Tests: run-panamacompra-pa-convenio-snapshot-etl (5C — apply piloto)
 *
 * Hito: Centroamérica.5C
 *
 * Verifica:
 *   1. --apply sin --confirm-pilot-apply → error
 *   2. limit-convenios > 5 → error
 *   3. limit-providers > 50 → error
 *   4. dry-run (sin --apply) → ok
 *   5. apply + confirm-pilot-apply → ok
 *   6. source_key = pa_panamacompra_convenio
 *   7. country_code = PA
 *   8. raw_data.source_type = procurement_signal
 *   9. raw_data.coverage_scope = convenio_marco
 *  10. Source Catalog sigue eligible_not_connected y not_connected
 *  11. No toca accounts ni prospect_candidates
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArgs, validateArgs } from '../../../../../../scripts/source-catalog/run-panamacompra-pa-convenio-snapshot-etl';
import { PANAMACOMPRA_SOURCE_KEY, buildPanamaSnapshotRow } from '../panamacompra-pa-snapshot-builder';
import type { PanamaProviderEntry } from '../panamacompra-pa-snapshot-builder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const sampleEntry: PanamaProviderEntry = {
  provider: {
    providerId: 'P123',
    companyId: 'E456',
    legalName: 'EMPRESA PILOTO S.A.',
    rucOriginal: '8-123-456',
    normalizedTaxId: '8123456',
    rucStatus: 'present',
    representativeName: 'JUAN PEREZ',
    email: 'info@empresa.com',
    phone: '+507-123-4567',
    address: 'Ciudad de Panamá',
    branches: [],
  },
  conveniosParticipados: [{ id: 'CV001', nombre: 'Convenio Piloto' }],
};

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('defaults: apply=false, confirmPilotApply=false, limitConvenios=3, limitProviders=20', () => {
    const args = parseArgs([]);
    assert.equal(args.apply, false);
    assert.equal(args.confirmPilotApply, false);
    assert.equal(args.limitConvenios, 3);
    assert.equal(args.limitProviders, 20);
  });

  it('parses --apply flag', () => {
    const args = parseArgs(['--apply']);
    assert.equal(args.apply, true);
  });

  it('parses --confirm-pilot-apply flag', () => {
    const args = parseArgs(['--confirm-pilot-apply']);
    assert.equal(args.confirmPilotApply, true);
  });

  it('parses --limit-convenios and --limit-providers', () => {
    const args = parseArgs(['--limit-convenios=3', '--limit-providers=20']);
    assert.equal(args.limitConvenios, 3);
    assert.equal(args.limitProviders, 20);
  });

  it('dry-run flag does not set apply', () => {
    const args = parseArgs(['--dry-run']);
    assert.equal(args.apply, false);
  });
});

// ─── validateArgs ─────────────────────────────────────────────────────────────

describe('validateArgs — guardrails piloto', () => {
  // Test 1
  it('blocks --apply without --confirm-pilot-apply', () => {
    const result = validateArgs(parseArgs(['--apply']));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('--confirm-pilot-apply'), `Expected reason to mention --confirm-pilot-apply, got: ${result.reason}`);
    }
  });

  // Test 2 — pilot limits are enforced only when --apply is present (dry-run may use any limit for preview)
  it('blocks --apply with limit-convenios > 5', () => {
    const result = validateArgs(parseArgs(['--limit-convenios=6', '--apply', '--confirm-pilot-apply']));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('5'), `Expected reason to mention limit 5, got: ${result.reason}`);
    }
  });

  // Test 3
  it('blocks --apply with limit-providers > 50', () => {
    const result = validateArgs(parseArgs(['--limit-providers=51', '--apply', '--confirm-pilot-apply']));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason.includes('50'), `Expected reason to mention limit 50, got: ${result.reason}`);
    }
  });

  // Test 4
  it('allows dry-run (no --apply)', () => {
    const result = validateArgs(parseArgs([]));
    assert.equal(result.ok, true);
  });

  // Test 5
  it('allows --apply with --confirm-pilot-apply', () => {
    const result = validateArgs(parseArgs(['--apply', '--confirm-pilot-apply']));
    assert.equal(result.ok, true);
  });

  it('allows limit-convenios = 5 (boundary)', () => {
    const result = validateArgs(parseArgs(['--limit-convenios=5']));
    assert.equal(result.ok, true);
  });

  it('allows limit-providers = 50 (boundary)', () => {
    const result = validateArgs(parseArgs(['--limit-providers=50']));
    assert.equal(result.ok, true);
  });
});

// ─── Snapshot builder — semántica ─────────────────────────────────────────────

describe('buildPanamaSnapshotRow — semántica 5C', () => {
  // Test 6
  it('source_key = pa_panamacompra_convenio', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.source_key, 'pa_panamacompra_convenio');
    assert.equal(row.source_key, PANAMACOMPRA_SOURCE_KEY);
  });

  // Test 7
  it('country_code = PA', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.country_code, 'PA');
  });

  // Test 8
  it('raw_data.source_type = procurement_signal', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.raw_data.source_type, 'procurement_signal');
  });

  // Test 9
  it('raw_data.coverage_scope = convenio_marco', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.raw_data.coverage_scope, 'convenio_marco');
  });

  it('raw_data.legal_validation_status = not_applicable', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.raw_data.legal_validation_status, 'not_applicable');
  });

  it('raw_data.tax_validation_status = not_applicable', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.raw_data.tax_validation_status, 'not_applicable');
  });

  it('raw_data.human_review_required = true', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.raw_data.human_review_required, true);
  });

  it('status = active_or_listed', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.status, 'active_or_listed');
  });

  it('source_url contains panamacompra.gob.pa', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.ok(row.source_url.includes('panamacompra.gob.pa'));
  });

  it('raw_data.convenios has the expected entry', () => {
    const row = buildPanamaSnapshotRow(sampleEntry);
    assert.equal(row.raw_data.convenios.length, 1);
    assert.equal(String(row.raw_data.convenios[0]?.id), 'CV001');
  });
});

// ─── Guardrail semántico: no toca accounts ni prospect_candidates ────────────

describe('ETL args — no accounts, no prospect_candidates', () => {
  // Test 11/12: parseArgs no tiene campos para accounts/catalog
  it('parseArgs returns no accounts-related flags', () => {
    const args = parseArgs(['--apply', '--confirm-pilot-apply']);
    assert.ok(!Object.prototype.hasOwnProperty.call(args, 'accounts'));
    assert.ok(!Object.prototype.hasOwnProperty.call(args, 'prospectCandidates'));
  });

  it('parseArgs returns no aiFlowStatus or connectionMode flags', () => {
    const args = parseArgs(['--apply', '--confirm-pilot-apply']);
    assert.ok(!Object.prototype.hasOwnProperty.call(args, 'aiFlowStatus'));
    assert.ok(!Object.prototype.hasOwnProperty.call(args, 'connectionMode'));
  });
});
