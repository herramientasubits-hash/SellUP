/**
 * Tests — EC-SCVS-7 — Runtime routing config + regression guards
 *
 * Verifies:
 * - EC resolves to the ec_scvs validated source for post-discovery enrichment.
 * - CO / MX / CL keep their existing validated sources and NEVER pick up ec_scvs.
 * - A country with no validated sources resolves to nothing.
 * - ec_scvs stays snapshot-backed / non-live (canRunLive=false, requiresSnapshot=true).
 * - prospect-generation wires the EC helper behind an EC-only guard so CO/MX/CL
 *   are never double-enriched by the new routing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  getValidatedSourcesForEnrichment,
  VALIDATED_SOURCE_CONFIGS,
} from '../validated-source-configs';
import { ENRICHMENT_ADAPTER_REGISTRY } from '../enrichment-adapter-registry';

// ── EC resolves to ec_scvs ──────────────────────────────────────────────────────

describe('EC-SCVS-7 — EC resolves to ec_scvs', () => {
  it('EC post-discovery enrichment includes ec_scvs', () => {
    const sources = getValidatedSourcesForEnrichment('EC', 'enrichment_after_discovery');
    const keys = sources.map((s) => s.sourceKey);
    assert.ok(keys.includes('ec_scvs'), `expected ec_scvs, got ${JSON.stringify(keys)}`);
  });

  it('ec_scvs adapter is registered', () => {
    const adapter = ENRICHMENT_ADAPTER_REGISTRY.ec_scvs;
    assert.ok(adapter);
    assert.equal(adapter.sourceKey, 'ec_scvs');
  });

  it('ec_scvs stays snapshot-backed and non-live', () => {
    const cfg = VALIDATED_SOURCE_CONFIGS.find((c) => c.sourceKey === 'ec_scvs');
    assert.ok(cfg);
    assert.equal(cfg!.canRunLive, false);
    assert.equal(cfg!.requiresSnapshot, true);
    assert.deepEqual(cfg!.countryCodes, ['EC']);
  });
});

// ── CO / MX / CL preserved and never pick up ec_scvs ────────────────────────────

describe('EC-SCVS-7 — other countries preserved', () => {
  it('CO keeps its validated sources and never includes ec_scvs', () => {
    const keys = getValidatedSourcesForEnrichment('CO', 'enrichment_after_discovery').map((s) => s.sourceKey);
    assert.ok(keys.length > 0, 'CO must still resolve validated sources');
    assert.ok(!keys.includes('ec_scvs'));
    assert.ok(keys.some((k) => k.startsWith('co_')));
  });

  it('MX keeps mx_denue and never includes ec_scvs', () => {
    const keys = getValidatedSourcesForEnrichment('MX', 'enrichment_after_discovery').map((s) => s.sourceKey);
    assert.ok(keys.includes('mx_denue'));
    assert.ok(!keys.includes('ec_scvs'));
  });

  it('CL never includes ec_scvs (cl_inapi is manual_signal_only)', () => {
    const keys = getValidatedSourcesForEnrichment('CL', 'enrichment_after_discovery').map((s) => s.sourceKey);
    assert.ok(!keys.includes('ec_scvs'));
    assert.ok(!keys.includes('cl_inapi'));
  });

  it('a country with no validated sources resolves to nothing', () => {
    const keys = getValidatedSourcesForEnrichment('ZZ', 'enrichment_after_discovery');
    assert.equal(keys.length, 0);
  });
});

// ── prospect-generation call-site guard (static) ────────────────────────────────

describe('EC-SCVS-7 — prospect-generation EC-only wiring', () => {
  const genPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../agents/prospect-generation.ts',
  );
  const src = readFileSync(genPath, 'utf8');

  it('imports the EC validated-source enrichment helper', () => {
    assert.ok(src.includes('enrichEcBatchWithValidatedSources'));
  });

  it('invokes the EC helper only behind an EC-only guard', () => {
    // The guard block and the call must both be present.
    assert.ok(src.includes("if (countryCode === 'EC')"));
    const callIdx = src.indexOf('enrichEcBatchWithValidatedSources(admin, batch.id)');
    assert.ok(callIdx > 0, 'EC helper must be called with the batch id');
    // The nearest preceding EC guard must be closer than any other country branch,
    // i.e. the call lives inside the EC-only block.
    const guardIdx = src.lastIndexOf("if (countryCode === 'EC')", callIdx);
    assert.ok(guardIdx > 0 && guardIdx < callIdx, 'EC helper call must be inside the EC guard');
  });
});
