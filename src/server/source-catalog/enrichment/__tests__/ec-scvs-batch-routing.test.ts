/**
 * Tests — EC-SCVS-7 — Ecuador runtime routing into validated-source enrichment
 *
 * Verifies the batch helper `enrichEcBatchWithValidatedSources`:
 * - Routes EC candidates to the ec_scvs adapter (via the generic validated-source
 *   helper) and persists metadata under metadata.source_enrichment.ec_scvs.
 * - EC candidate without RUC → skipped, batch never fails.
 * - EC candidate with a single expediente → matched.
 * - EC candidate with RUC multiplicity → observable ambiguity (no arbitrary pick).
 * - Adapter error → fail-soft, batch never tumbles.
 * - No raw_data leak in persisted metadata.
 *
 * Offline: matched / ambiguous / error paths swap the ec_scvs registry entry for a
 * stub so no network / snapshot / provider call is ever made.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { enrichEcBatchWithValidatedSources } from '../enrich-ec-batch-with-validated-sources';
import { ENRICHMENT_ADAPTER_REGISTRY } from '../enrichment-adapter-registry';
import type { SourceEnrichmentAdapter, SourceEnrichmentOutput } from '../types';

// ── Fake Supabase ──────────────────────────────────────────────────────────────

interface CapturedUpdate {
  id: unknown;
  metadata: Record<string, unknown>;
}

function makeFakeSupabase(candidates: Array<Record<string, unknown>>) {
  const updates: CapturedUpdate[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: candidates, error: null });
            },
          };
        },
        update(payload: { metadata: Record<string, unknown> }) {
          return {
            eq(_col: string, val: unknown) {
              updates.push({ id: val, metadata: payload.metadata });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as Parameters<typeof enrichEcBatchWithValidatedSources>[0], updates };
}

// ── Registry swap helper (offline: never touches snapshot/network) ──────────────

const originalEcAdapter = ENRICHMENT_ADAPTER_REGISTRY.ec_scvs;

function stubEcAdapter(fn: () => Promise<SourceEnrichmentOutput> | SourceEnrichmentOutput) {
  const stub: SourceEnrichmentAdapter = {
    sourceKey: 'ec_scvs',
    supportedCapabilities: ['enrichment_after_discovery'],
    async enrichCandidate() {
      return fn();
    },
  };
  ENRICHMENT_ADAPTER_REGISTRY.ec_scvs = stub;
}

afterEach(() => {
  ENRICHMENT_ADAPTER_REGISTRY.ec_scvs = originalEcAdapter;
});

// ── Routing + skipped (real adapter, offline: no RUC → no network) ──────────────

describe('EC-SCVS-7 — routing to ec_scvs adapter', () => {
  it('EC candidate without RUC is routed to ec_scvs, skipped, and never fails the batch', async () => {
    const { client, updates } = makeFakeSupabase([
      { id: 'c1', name: 'Empresa EC', legal_name: null, tax_identifier: null, sector_description: null, metadata: {} },
    ]);

    const result = await enrichEcBatchWithValidatedSources(client, 'batch-ec-1');

    assert.equal(result.attempted, true);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(updates.length, 1);
    // Metadata landed under source_enrichment.ec_scvs (routing proof)
    const se = updates[0].metadata.source_enrichment as Record<string, unknown>;
    const ec = se.ec_scvs as Record<string, unknown>;
    assert.ok(ec, 'source_enrichment.ec_scvs must be present');
    assert.equal(ec.status, 'skipped');
    const summary = se._summary as Record<string, unknown>;
    assert.equal(summary.country_code, 'EC');
    assert.deepEqual(summary.source_keys_attempted, ['ec_scvs']);
  });

  it('preserves existing candidate metadata when attaching ec_scvs enrichment', async () => {
    const { client, updates } = makeFakeSupabase([
      {
        id: 'c1',
        name: 'Empresa EC',
        tax_identifier: null,
        sector_description: null,
        metadata: { apollo_id: 'a-123', source_enrichment: { prior_note: 'keep-me' } },
      },
    ]);

    await enrichEcBatchWithValidatedSources(client, 'batch-ec-1');

    assert.equal(updates[0].metadata.apollo_id, 'a-123');
    const se = updates[0].metadata.source_enrichment as Record<string, unknown>;
    assert.equal(se.prior_note, 'keep-me');
    assert.ok(se.ec_scvs);
  });
});

// ── Matched (single expediente) ─────────────────────────────────────────────────

describe('EC-SCVS-7 — matched single expediente', () => {
  it('EC candidate with a single expediente is matched with record_identity_key', async () => {
    stubEcAdapter(() => ({
      sourceKey: 'ec_scvs',
      status: 'matched',
      matchedBy: null,
      confidence: 1,
      sourceYear: 2026,
      priorityBoost: 0,
      signals: { record_identity_key: 'expediente:EC:0990012345001', expediente_found: true },
    }));

    const { client, updates } = makeFakeSupabase([
      { id: 'c1', name: 'Empresa EC', tax_identifier: '0990012345001', sector_description: null, metadata: {} },
    ]);

    const result = await enrichEcBatchWithValidatedSources(client, 'batch-ec-1');

    assert.equal(result.matchedCount, 1);
    const se = updates[0].metadata.source_enrichment as Record<string, unknown>;
    const ec = se.ec_scvs as Record<string, unknown>;
    assert.equal(ec.status, 'matched');
    assert.equal(ec.source_year, 2026);
    const signals = ec.signals as Record<string, unknown>;
    assert.equal(signals.record_identity_key, 'expediente:EC:0990012345001');
    const summary = se._summary as Record<string, unknown>;
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.source_keys_matched, ['ec_scvs']);
    assert.equal(summary.human_review_required, false);
  });
});

// ── Ambiguity (RUC multiplicity) — observable, never arbitrary ──────────────────

describe('EC-SCVS-7 — RUC multiplicity is observable', () => {
  it('EC candidate with multiple expedientes surfaces ambiguity and requires human review', async () => {
    stubEcAdapter(() => ({
      sourceKey: 'ec_scvs',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      priorityBoost: 0,
      reason: 'ruc_multiplicity_detected: 3 expedientes',
      signals: {
        ruc_multiplicity: 'multiple',
        record_count: 3,
        record_identity_keys: ['expediente:EC:1', 'expediente:EC:2', 'expediente:EC:3'],
        human_review_required: true,
      },
    }));

    const { client, updates } = makeFakeSupabase([
      { id: 'c1', name: 'Empresa EC', tax_identifier: '0990012345001', sector_description: null, metadata: {} },
    ]);

    const result = await enrichEcBatchWithValidatedSources(client, 'batch-ec-1');

    assert.equal(result.ambiguousCount, 1);
    assert.equal(result.matchedCount, 0);
    const se = updates[0].metadata.source_enrichment as Record<string, unknown>;
    const ec = se.ec_scvs as Record<string, unknown>;
    // Never collapsed to a single validated match
    assert.equal(ec.status, 'no_match');
    const signals = ec.signals as Record<string, unknown>;
    assert.equal(signals.ruc_multiplicity, 'multiple');
    assert.equal(signals.record_count, 3);
    assert.deepEqual(signals.record_identity_keys, ['expediente:EC:1', 'expediente:EC:2', 'expediente:EC:3']);
    const summary = se._summary as Record<string, unknown>;
    assert.equal(summary.human_review_required, true);
    assert.deepEqual(summary.source_keys_matched, []);
  });
});

// ── Fail-soft on adapter error ──────────────────────────────────────────────────

describe('EC-SCVS-7 — fail-soft', () => {
  it('adapter error does not tumble the batch', async () => {
    stubEcAdapter(() => {
      throw new Error('snapshot boom');
    });

    const { client, updates } = makeFakeSupabase([
      { id: 'c1', name: 'Empresa EC', tax_identifier: '0990012345001', sector_description: null, metadata: {} },
    ]);

    // Must resolve, never reject
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-ec-1');

    assert.equal(result.errorCount, 1);
    const se = updates[0].metadata.source_enrichment as Record<string, unknown>;
    const ec = se.ec_scvs as Record<string, unknown>;
    assert.equal(ec.status, 'error');
    const summary = se._summary as Record<string, unknown>;
    assert.equal(summary.status, 'error');
  });

  it('empty batch returns cleanly with no updates', async () => {
    const { client, updates } = makeFakeSupabase([]);
    const result = await enrichEcBatchWithValidatedSources(client, 'batch-empty');
    assert.equal(result.attempted, true);
    assert.equal(result.candidatesProcessed, 0);
    assert.equal(updates.length, 0);
  });
});

// ── No raw_data leak ────────────────────────────────────────────────────────────

describe('EC-SCVS-7 — no raw_data in persisted metadata', () => {
  it('matched metadata never contains raw_data', async () => {
    stubEcAdapter(() => ({
      sourceKey: 'ec_scvs',
      status: 'matched',
      matchedBy: null,
      confidence: 1,
      sourceYear: 2026,
      priorityBoost: 0,
      signals: { record_identity_key: 'expediente:EC:0990012345001', expediente_found: true },
    }));

    const { client, updates } = makeFakeSupabase([
      { id: 'c1', name: 'Empresa EC', tax_identifier: '0990012345001', sector_description: null, metadata: {} },
    ]);

    await enrichEcBatchWithValidatedSources(client, 'batch-ec-1');

    const serialized = JSON.stringify(updates[0].metadata);
    assert.ok(!serialized.includes('raw_data'), 'persisted metadata must not include raw_data');
  });
});

// ── Static safety guards on helper source ───────────────────────────────────────

describe('EC-SCVS-7 — static safety guards', () => {
  const helperPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../enrich-ec-batch-with-validated-sources.ts',
  );
  const src = readFileSync(helperPath, 'utf8');

  it('uses the existing validated-source helper', () => {
    assert.ok(src.includes('enrichCandidatesWithValidatedSources'));
  });

  it('does not persist raw_data', () => {
    assert.ok(!src.includes("'raw_data'") && !src.includes('"raw_data"'));
  });

  it('does not use TAX_GRAIN helpers', () => {
    assert.ok(!src.includes('TAX_GRAIN'));
  });

  it('does not use .limit(1)/.maybeSingle probes', () => {
    assert.ok(!src.includes('.limit(1)'));
    assert.ok(!src.includes('maybeSingle'));
  });

  it('does not import the CO/MX tax-resolution dispatcher', () => {
    // The name may appear in prose (explaining why EC needs its own hook), but it
    // must never be imported or called — EC routing is independent of it.
    assert.ok(!/import[^;]*tax-identifier-resolution/.test(src));
    assert.ok(!src.includes('enrichBatchCandidatesWithTaxResolution('));
  });

  it('is hardcoded to EC only', () => {
    assert.ok(src.includes("EC_COUNTRY_CODE = 'EC'"));
  });
});
