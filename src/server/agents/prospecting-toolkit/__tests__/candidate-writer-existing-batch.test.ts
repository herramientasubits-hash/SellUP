/**
 * Tests — Candidate Writer: existingBatchId support (16AB.43.4)
 *
 * Verifies that writeProspectingCandidates can reuse a pre-existing batch
 * instead of inserting a new one, including validation, metadata merge, and
 * correct candidate/audit association.
 *
 * ALL interactions use a lightweight injectable fake admin client.
 * No Supabase, Tavily, Apollo, HubSpot, or LLM calls are made.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  writeProspectingCandidates,
  CandidateWriterBatchValidationError,
} from '../candidate-writer';
import { runIncrementalProspectingSearch } from '../incremental-search';

import type { CandidateWriterInput, CandidateWriterOutput, CatalogContextResult } from '../types';
import type { IncrementalSearchInput } from '../incremental-search-types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Minimal CatalogContextResult for test fixtures (ProspectingPipelineOutput requires it non-null)
const FAKE_CATALOG_CONTEXT: CatalogContextResult = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'EdTech',
  searchDepth: 'standard',
  fiscalIdentifierLabel: null,
  recommendedSources: [],
  sectorSources: [],
  risks: [],
  operatingRules: [],
  coverageNotes: [],
  promptContext: '',
};

// ─── UUIDs de fixtures ────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const EXISTING_BATCH_ID = 'batch-0001-0000-0000-0000-000000000001';
const NEW_BATCH_ID = 'batch-9999-0000-0000-0000-000000000099';

// ─── Fake admin client ────────────────────────────────────────────────────────

/**
 * A minimal chainable/thenable builder used by the fake Supabase client.
 * Supports the chained API used by candidate-writer and novelty-checker.
 */
class ChainResult {
  constructor(private readonly _val: unknown) {}

  eq(_col: string, _val: unknown): ChainResult { return this; }
  neq(_col: string, _val: unknown): ChainResult { return this; }
  in(_col: string, _vals: unknown[]): ChainResult { return this; }
  not(_col: string, _op: string, _val: unknown): ChainResult { return this; }
  gte(_col: string, _val: unknown): ChainResult { return this; }
  limit(_n: number): ChainResult { return this; }
  select(_cols: string): ChainResult { return this; }

  /** Makes the object directly awaitable (thenable). */
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }

  single(): Promise<unknown> {
    return Promise.resolve(this._val);
  }
}

type FakeBatchRow = {
  id: string;
  status: string;
  source: string;
  created_by: string | null;
  owner_id: string | null;
  metadata: Record<string, unknown>;
  client_request_id: string | null;
};

type FakeAdminStats = {
  batchInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
  candidateInsertCalls: Record<string, unknown>[];
  auditInsertCalls: Record<string, unknown>[];
};

type FakeAdminConfig = {
  existingBatch?: FakeBatchRow | null;
  batchSelectError?: { message: string } | null;
  batchUpdateError?: { message: string } | null;
  newBatchId?: string;
};

function makeFakeAdmin(
  config: FakeAdminConfig,
  stats: FakeAdminStats,
): SupabaseClient {
  let candidateSeq = 0;

  return {
    from(table: string) {
      // ── prospect_batches ──────────────────────────────────────────────────
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                // buildRecentIdentityKeySet uses .eq('source', ...).gte(...) — return ChainResult
                // that is thenable (empty data → no identity keys) and also supports .single()
                if (_col === 'source') {
                  return new ChainResult({ data: [], error: null });
                }
                // Default: batch lookup by id → .single()
                return {
                  single() {
                    if (config.batchSelectError) {
                      return Promise.resolve({ data: null, error: config.batchSelectError });
                    }
                    return Promise.resolve({
                      data: config.existingBatch ?? null,
                      error: config.existingBatch ? null : { message: 'Not found' },
                    });
                  },
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return new ChainResult({ error: config.batchUpdateError ?? null });
          },
          insert(data: Record<string, unknown>) {
            stats.batchInsertCalls.push({ ...data });
            return {
              select(_cols: string) {
                return {
                  single() {
                    return Promise.resolve({
                      data: { id: config.newBatchId ?? NEW_BATCH_ID },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      // ── prospect_candidates ───────────────────────────────────────────────
      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            // Novelty check: returns empty history (no prior candidates)
            return new ChainResult({ data: [], error: null });
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-fake-${++candidateSeq}`;
            return {
              select(_cols: string) {
                return {
                  single() {
                    return Promise.resolve({ data: { id }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      // ── prospect_candidate_audit ──────────────────────────────────────────
      if (table === 'prospect_candidate_audit') {
        return {
          insert(data: Record<string, unknown>) {
            stats.auditInsertCalls.push({ ...data });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Pipeline output de prueba ────────────────────────────────────────────────

function makePipelineOutput(candidateCount = 1) {
  const candidates = Array.from({ length: candidateCount }, (_, i) => ({
    name: `Empresa Test ${i + 1}`,
    website: `https://empresa-test-${i + 1}.com.co`,
    domain: `empresa-test-${i + 1}.com.co`,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'EdTech',
    sourceUrl: `https://source-${i + 1}.com`,
    sourceTitle: `Empresa Test ${i + 1} - Software empresarial en Colombia`,
    sourceSnippet: `Empresa colombiana de software empresarial para clientes corporativos en Colombia.`,
    inferredNameSource: null,
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: {
      status: 'new_candidate' as const,
      confidence: 1,
      input: { name: `Empresa Test ${i + 1}`, website: `https://empresa-test-${i + 1}.com.co`, domain: `empresa-test-${i + 1}.com.co` },
      checkedSources: ['sellup' as const],
      summary: 'No match',
      matches: [],
    },
    scoring: {
      qualityLabel: 'high_quality_new' as const,
      confidenceScore: 0.9,
      fitScore: 0.85,
      dataCompletenessScore: 0.8,
      recommendedAction: 'approve_for_review' as const,
      breakdown: { existenceSignals: 1, websiteSignals: 1, duplicateSignals: 1, sourceSignals: 1, fitSignals: 1, completenessSignals: 1, penalties: 0 },
      reasons: [],
      warnings: [],
      blockers: [],
    },
  }));

  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'EdTech',
      webSearchProvider: 'mock' as const,
      mode: 'multi_query' as const,
    },
    catalogContext: FAKE_CATALOG_CONTEXT,
    searchQuery: 'EdTech Colombia',
    webSearch: {
      provider: 'mock' as const,
      query: 'test',
      results: [],
      resultsCount: candidateCount,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: candidateCount,
      searched: candidateCount,
      returned: candidateCount,
      highQualityNew: candidateCount,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: {
      provider: 'mock',
      pipelineVersion: 'test-v1',
      executedAt: '2026-06-17T00:00:00.000Z',
    },
  };
}

function makeInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput(1),
    triggeredByUserId: USER_A,
    ownerId: USER_A,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

function makeDraftBatch(overrides: Partial<FakeBatchRow> = {}): FakeBatchRow {
  return {
    id: EXISTING_BATCH_ID,
    status: 'draft',
    source: 'agent_1',
    created_by: USER_A,
    owner_id: USER_A,
    metadata: {
      request_source: 'chat_wizard',
      catalog_version_id: 'v2024-01',
      industry_id: 'edtech-001',
      subindustry_ids: ['sub-a', 'sub-b'],
      country_code: 'CO',
      additional_criteria: null,
    },
    client_request_id: 'req-uuid-0001-0000-0000-000000000001',
    ...overrides,
  };
}

// ─── T01: Sin existingBatchId → INSERT nuevo lote (ruta histórica) ─────────────

describe('T01: without existingBatchId → INSERT new batch (historical behavior)', () => {
  it('inserts a new batch row and returns its id', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ newBatchId: NEW_BATCH_ID }, stats);

    const result = await writeProspectingCandidates(makeInput(), admin);

    assert.equal(result.batchId, NEW_BATCH_ID);
    assert.equal(stats.batchInsertCalls.length, 1);
    assert.equal(stats.batchUpdateCalls.length, 1); // post-loop metadata update only
    assert.ok(!result.errors.length, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('uses batch_created audit action type', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ newBatchId: NEW_BATCH_ID }, stats);

    await writeProspectingCandidates(makeInput(), admin);

    const batchAudit = stats.auditInsertCalls.find(a => a['action_type'] === 'batch_created');
    assert.ok(batchAudit, 'Expected batch_created audit entry');
    assert.equal(batchAudit['batch_id'], NEW_BATCH_ID);
  });
});

// ─── T02: Con existingBatchId válido → UPDATE, sin INSERT en prospect_batches ──

describe('T02: with valid existingBatchId → UPDATE, no INSERT to prospect_batches', () => {
  it('does not INSERT a new batch row', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(stats.batchInsertCalls.length, 0, 'No INSERT should happen to prospect_batches');
  });

  it('calls UPDATE on the existing batch', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    // At least one update call should be the status change (others may be post-loop)
    assert.ok(stats.batchUpdateCalls.length >= 1, 'Expected at least one UPDATE call');
    const statusUpdate = stats.batchUpdateCalls.find(u => u['status'] === 'ready_for_review');
    assert.ok(statusUpdate, 'First UPDATE must set status = ready_for_review');
  });
});

// ─── T03: Con existingBatchId → candidatos usan existingBatchId ────────────────

describe('T03: with existingBatchId → candidates are associated to existing batch', () => {
  it('all candidate inserts carry the existingBatchId as batch_id', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    await writeProspectingCandidates(
      makeInput({ pipelineOutput: makePipelineOutput(3), existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(stats.candidateInsertCalls.length, 3);
    for (const c of stats.candidateInsertCalls) {
      assert.equal(c['batch_id'], EXISTING_BATCH_ID, 'Each candidate must reference the existing batch');
    }
  });
});

// ─── T04: Con existingBatchId → auditorías usan existingBatchId ───────────────

describe('T04: with existingBatchId → audits are associated to existing batch', () => {
  it('all audit entries carry the existingBatchId as batch_id', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    await writeProspectingCandidates(
      makeInput({ pipelineOutput: makePipelineOutput(2), existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    for (const a of stats.auditInsertCalls) {
      assert.equal(a['batch_id'], EXISTING_BATCH_ID, 'Each audit must reference the existing batch');
    }
  });

  it('uses batch_status_changed audit type for the batch transition', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    const batchAudit = stats.auditInsertCalls.find(a => a['action_type'] === 'batch_status_changed');
    assert.ok(batchAudit, 'Expected batch_status_changed audit entry');
    assert.equal(batchAudit['batch_id'], EXISTING_BATCH_ID);
  });
});

// ─── T05: output.batchId === existingBatchId ──────────────────────────────────

describe('T05: output.batchId equals existingBatchId', () => {
  it('returns the same batchId that was passed as existingBatchId', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.batchId, EXISTING_BATCH_ID);
    assert.notEqual(result.batchId, NEW_BATCH_ID);
  });
});

// ─── T06: Preservación de metadata ────────────────────────────────────────────

describe('T06: metadata preservation — wizard fields are not overwritten', () => {
  it('merges wizard metadata with pipeline metadata in the UPDATE call', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const wizardMeta = {
      request_source: 'chat_wizard',
      catalog_version_id: 'v2024-01',
      industry_id: 'edtech-001',
      subindustry_ids: ['sub-a', 'sub-b'],
      country_code: 'CO',
      additional_criteria: 'empresa > 50 empleados',
    };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch({ metadata: wizardMeta }) }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    // First UPDATE (status change) contains the merged metadata
    const statusUpdate = stats.batchUpdateCalls.find(u => u['status'] === 'ready_for_review');
    assert.ok(statusUpdate, 'Status update call not found');
    const meta = statusUpdate['metadata'] as Record<string, unknown>;

    // Wizard fields preserved
    assert.equal(meta['request_source'], 'chat_wizard');
    assert.equal(meta['catalog_version_id'], 'v2024-01');
    assert.equal(meta['industry_id'], 'edtech-001');
    assert.deepEqual(meta['subindustry_ids'], ['sub-a', 'sub-b']);
    assert.equal(meta['additional_criteria'], 'empresa > 50 empleados');

    // Pipeline fields added
    assert.equal(meta['generated_by'], 'agent_1_candidate_writer');
    assert.ok('pipeline_version' in meta, 'pipeline_version must be present');
  });

  it('preserves client_request_id (never written NULL)', async () => {
    const CLIENT_REQ_ID = 'req-uuid-0001-0000-0000-000000000001';
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({
      existingBatch: makeDraftBatch({ client_request_id: CLIENT_REQ_ID }),
    }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    // UPDATE must NOT include client_request_id (preserved by not overwriting it)
    for (const upd of stats.batchUpdateCalls) {
      assert.ok(!('client_request_id' in upd), 'UPDATE must not touch client_request_id');
    }
  });

  it('does not overwrite created_by', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch({ created_by: USER_A }) }, stats);

    await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    for (const upd of stats.batchUpdateCalls) {
      assert.ok(!('created_by' in upd), 'UPDATE must not touch created_by');
    }
  });
});

// ─── T07: Lote inexistente → BATCH_NOT_FOUND ─────────────────────────────────

describe('T07: non-existent batch → BATCH_NOT_FOUND error, zero writes', () => {
  it('throws CandidateWriterBatchValidationError with BATCH_NOT_FOUND code', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: null }, stats);

    await assert.rejects(
      () => writeProspectingCandidates(
        makeInput({ existingBatchId: EXISTING_BATCH_ID }),
        admin,
      ),
      (err: unknown) => {
        assert.ok(err instanceof CandidateWriterBatchValidationError);
        assert.equal(err.code, 'BATCH_NOT_FOUND');
        return true;
      },
    );
  });

  it('makes zero writes when batch is not found', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: null }, stats);

    try { await writeProspectingCandidates(makeInput({ existingBatchId: EXISTING_BATCH_ID }), admin); } catch { /* expected */ }

    assert.equal(stats.batchInsertCalls.length, 0);
    assert.equal(stats.batchUpdateCalls.length, 0);
    assert.equal(stats.candidateInsertCalls.length, 0);
    assert.equal(stats.auditInsertCalls.length, 0);
  });
});

// ─── T08: Lote de otro usuario → BATCH_WRONG_OWNER ───────────────────────────

describe('T08: batch owned by another user → BATCH_WRONG_OWNER, zero writes', () => {
  it('throws CandidateWriterBatchValidationError with BATCH_WRONG_OWNER code', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({
      existingBatch: makeDraftBatch({ created_by: USER_B, owner_id: USER_B }),
    }, stats);

    await assert.rejects(
      () => writeProspectingCandidates(
        makeInput({ existingBatchId: EXISTING_BATCH_ID, triggeredByUserId: USER_A, ownerId: USER_A }),
        admin,
      ),
      (err: unknown) => {
        assert.ok(err instanceof CandidateWriterBatchValidationError);
        assert.equal(err.code, 'BATCH_WRONG_OWNER');
        return true;
      },
    );
  });

  it('makes zero writes on wrong owner', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({
      existingBatch: makeDraftBatch({ created_by: USER_B, owner_id: USER_B }),
    }, stats);

    try {
      await writeProspectingCandidates(
        makeInput({ existingBatchId: EXISTING_BATCH_ID, triggeredByUserId: USER_A, ownerId: USER_A }),
        admin,
      );
    } catch { /* expected */ }

    assert.equal(stats.batchInsertCalls.length, 0);
    assert.equal(stats.batchUpdateCalls.length, 0);
    assert.equal(stats.candidateInsertCalls.length, 0);
    assert.equal(stats.auditInsertCalls.length, 0);
  });
});

// ─── T09: Source incompatible → BATCH_INCOMPATIBLE_SOURCE ────────────────────

describe('T09: incompatible source → BATCH_INCOMPATIBLE_SOURCE, zero writes', () => {
  it('throws when batch source is not agent_1', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({
      existingBatch: makeDraftBatch({ source: 'imported' }),
    }, stats);

    await assert.rejects(
      () => writeProspectingCandidates(
        makeInput({ existingBatchId: EXISTING_BATCH_ID }),
        admin,
      ),
      (err: unknown) => {
        assert.ok(err instanceof CandidateWriterBatchValidationError);
        assert.equal(err.code, 'BATCH_INCOMPATIBLE_SOURCE');
        return true;
      },
    );

    assert.equal(stats.batchUpdateCalls.length, 0);
    assert.equal(stats.candidateInsertCalls.length, 0);
  });
});

// ─── T10: Estado incompatible → BATCH_INCOMPATIBLE_STATUS ────────────────────

describe('T10: incompatible status → BATCH_INCOMPATIBLE_STATUS, zero writes', () => {
  const incompatibleStatuses = ['ready_for_review', 'in_review', 'completed', 'cancelled', 'failed'];

  for (const status of incompatibleStatuses) {
    it(`throws for status='${status}'`, async () => {
      const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
      const admin = makeFakeAdmin({
        existingBatch: makeDraftBatch({ status }),
      }, stats);

      await assert.rejects(
        () => writeProspectingCandidates(
          makeInput({ existingBatchId: EXISTING_BATCH_ID }),
          admin,
        ),
        (err: unknown) => {
          assert.ok(err instanceof CandidateWriterBatchValidationError);
          assert.equal(err.code, 'BATCH_INCOMPATIBLE_STATUS');
          return true;
        },
      );

      assert.equal(stats.batchUpdateCalls.length, 0, `No writes should occur for status='${status}'`);
      assert.equal(stats.candidateInsertCalls.length, 0);
    });
  }

  it('accepts status=draft', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch({ status: 'draft' }) }, stats);

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );
    assert.equal(result.batchId, EXISTING_BATCH_ID);
  });

  it('accepts status=generating', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch({ status: 'generating' }) }, stats);

    const result = await writeProspectingCandidates(
      makeInput({ existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );
    assert.equal(result.batchId, EXISTING_BATCH_ID);
  });
});

// ─── T11: Dry run con existingBatchId → cero escrituras ───────────────────────

describe('T11: dryRun=true with existingBatchId → zero writes', () => {
  it('does not SELECT, UPDATE, INSERT, or call any audit', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    // Config with valid batch — should never be reached
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

    const result = await writeProspectingCandidates(
      makeInput({ dryRun: true, existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    assert.equal(result.dryRun, true);
    assert.equal(result.batchId, null);
    assert.equal(result.candidatesCreated, 0);
    assert.equal(stats.batchInsertCalls.length, 0);
    assert.equal(stats.batchUpdateCalls.length, 0);
    assert.equal(stats.candidateInsertCalls.length, 0);
    assert.equal(stats.auditInsertCalls.length, 0);
  });
});

// ─── T12: Pipeline incremental → transfiere existingBatchId al writer ─────────

describe('T12: runIncrementalProspectingSearch forwards existingBatchId to writer', () => {
  it('passes existingBatchId from input to writeProspectingCandidates', async () => {
    let capturedInput: CandidateWriterInput | null = null;

    const fakeWriter = async (writerInput: CandidateWriterInput): Promise<CandidateWriterOutput> => {
      capturedInput = writerInput;
      return {
        dryRun: false,
        batchId: EXISTING_BATCH_ID,
        candidatesCreated: 1,
        candidatesSkipped: 0,
        createdCandidateIds: ['cand-001'],
        skipped: [],
        status: 'success',
        errors: [],
      };
    };

    const incrementalInput: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'EdTech',
      webSearchProvider: 'mock',
      dryRun: false,
      triggeredByUserId: USER_A,
      ownerId: USER_A,
      existingBatchId: EXISTING_BATCH_ID,
    };

    const result = await runIncrementalProspectingSearch(incrementalInput, fakeWriter);

    assert.ok(capturedInput !== null, 'Writer should have been called');
    assert.equal((capturedInput as CandidateWriterInput).existingBatchId, EXISTING_BATCH_ID,
      'existingBatchId must be forwarded verbatim to the writer');
    assert.equal(result.batchId, EXISTING_BATCH_ID);
  });

  it('passes existingBatchId=null when not provided', async () => {
    let capturedInput: CandidateWriterInput | null = null;

    const fakeWriter = async (writerInput: CandidateWriterInput): Promise<CandidateWriterOutput> => {
      capturedInput = writerInput;
      return {
        dryRun: false,
        batchId: NEW_BATCH_ID,
        candidatesCreated: 1,
        candidatesSkipped: 0,
        createdCandidateIds: ['cand-002'],
        skipped: [],
        status: 'success',
        errors: [],
      };
    };

    const incrementalInput: IncrementalSearchInput = {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'EdTech',
      webSearchProvider: 'mock',
      dryRun: false,
      triggeredByUserId: USER_A,
    };

    await runIncrementalProspectingSearch(incrementalInput, fakeWriter);

    assert.ok(capturedInput !== null, 'Writer should have been called');
    assert.equal((capturedInput as CandidateWriterInput).existingBatchId, null,
      'existingBatchId should be null when not provided');
  });
});

// ─── T13: Guardrail de lote único ─────────────────────────────────────────────

describe('T13: single-batch guardrail — with existingBatchId zero new INSERTs to prospect_batches', () => {
  it('INSERT count to prospect_batches is exactly zero when existingBatchId is provided', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({
      existingBatch: makeDraftBatch(),
    }, stats);

    const result = await writeProspectingCandidates(
      makeInput({ pipelineOutput: makePipelineOutput(5), existingBatchId: EXISTING_BATCH_ID }),
      admin,
    );

    // GUARDRAIL: exactly zero INSERTs to prospect_batches
    assert.equal(
      stats.batchInsertCalls.length,
      0,
      'With existingBatchId: INSERT count to prospect_batches must be exactly 0',
    );
    assert.equal(result.batchId, EXISTING_BATCH_ID,
      'batchId returned must equal existingBatchId');
    assert.equal(result.candidatesCreated, 5,
      'All 5 candidates must be associated with the existing batch');
  });
});

// ─── T14: Garantía de proveedores externos ────────────────────────────────────

describe('T14: no real external providers were invoked', () => {
  it('writeProspectingCandidates with existingBatchId completes without env vars', async () => {
    // If the writer tried to call getAdminClient() (which reads env vars),
    // it would throw "Supabase service credentials not configured".
    // Completing without error proves the injected client was used throughout.
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
      const admin = makeFakeAdmin({ existingBatch: makeDraftBatch() }, stats);

      const result = await writeProspectingCandidates(
        makeInput({ existingBatchId: EXISTING_BATCH_ID }),
        admin,
      );

      assert.equal(result.batchId, EXISTING_BATCH_ID,
        'Should succeed using only the injected admin client — no real Supabase call made');
    } finally {
      if (origUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    }
  });

  it('runIncrementalProspectingSearch with writerOverride does not call real Tavily', async () => {
    // The fake writer captures the call. If Tavily were called, it would
    // need a real API key and would fail. Completing proves no real call was made.
    const fakeWriter = async (): Promise<CandidateWriterOutput> => ({
      dryRun: false,
      batchId: EXISTING_BATCH_ID,
      candidatesCreated: 0,
      candidatesSkipped: 0,
      createdCandidateIds: [],
      skipped: [],
      status: 'success',
      errors: [],
    });

    const result = await runIncrementalProspectingSearch(
      {
        country: 'Colombia',
        countryCode: 'CO',
        industry: 'EdTech',
        webSearchProvider: 'mock',
        dryRun: false,
        existingBatchId: EXISTING_BATCH_ID,
        triggeredByUserId: USER_A,
      },
      fakeWriter,
    );

    assert.equal(result.batchId, EXISTING_BATCH_ID,
      'batchId from fakeWriter must be returned — real Tavily was not invoked');
  });
});
