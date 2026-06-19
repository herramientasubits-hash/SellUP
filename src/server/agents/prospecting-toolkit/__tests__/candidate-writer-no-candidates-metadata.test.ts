/**
 * Tests — Metadata completeness with 0 persisted candidates (16AB.43.32)
 *
 * Verifies that writeProspectingCandidates persists complete gate metadata,
 * tavily_usage_reconciliation, writer_summary, and pipeline_summary_post_write
 * even when no candidates are created (all blocked by gates / novelty).
 *
 * Fixture A — 0 candidatos persistidos por calidad (gates bloquean todos)
 * Fixture B — 0 candidatos por novelty (canonical identity gate)
 * Fixture C — Tavily reconciliation en 0 persistidos
 * Fixture D — Metadata deep merge preserves previous keys
 * Fixture E — Regresion: con existingBatchId + candidatos normales sigue funcionando
 *
 * Sin Supabase real. Sin Tavily. Sin LLM. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { writeProspectingCandidates } from '../candidate-writer';
import type {
  CandidateWriterInput,
  CandidateWriterOutput,
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── UUIDs de fixtures ────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const EXISTING_BATCH_ID = 'batch-no-cand-0000-0000-000000000001';
const NEW_BATCH_ID = 'batch-no-cand-9999-0000-0000-000000000099';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ProspectingPipelineCandidate> & { name: string }): ProspectingPipelineCandidate {
  return {
    domain: 'testcompany.com.co',
    website: 'https://testcompany.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.8,
      dataCompletenessScore: 0.9,
      recommendedAction: 'add_to_pipeline',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function makePipelineOutput(candidates: ProspectingPipelineCandidate[]): ProspectingPipelineOutput {
  return {
    candidates,
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: candidates.length,
      searchDepth: 'standard',
    },
    summary: {
      requested: candidates.length,
      returned: candidates.length,
      highQualityNew: candidates.length,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
    },
    metadata: {
      provider: 'mock',
      pipelineVersion: 'test-v1',
      executedAt: '2026-06-17T00:00:00.000Z',
    },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

function makeInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput([]),
    triggeredByUserId: USER_A,
    ownerId: USER_A,
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

// ─── Fake admin client (extended with provider_usage_logs support) ─────────────

type FakeAdminStats = {
  batchInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
  candidateInsertCalls: Record<string, unknown>[];
  auditInsertCalls: Record<string, unknown>[];
};

type FakeAdminConfig = {
  existingBatch?: {
    id: string;
    status: string;
    source: string;
    created_by: string | null;
    owner_id: string | null;
    metadata: Record<string, unknown>;
    client_request_id: string | null;
  } | null;
  existingBatchSelectError?: { message: string } | null;
  providerUsageLogs?: Array<Record<string, unknown>>;
  providerUsageLogsError?: { message: string } | null;
  // When true, the batch update that includes a writer_summary in metadata rejects —
  // simulating a DB failure on the full post-loop metadata write.
  failOnFullMetadataUpdate?: boolean;
};

function makeFakeAdmin(config: FakeAdminConfig, stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                if (_col === 'source') {
                  return {
                    gte: () => Promise.resolve({ data: [], error: null }),
                  };
                }
                return {
                  single() {
                    if (config.existingBatchSelectError) {
                      return Promise.resolve({ data: null, error: config.existingBatchSelectError });
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
            const hasWriterSummary =
              config.failOnFullMetadataUpdate &&
              typeof data['metadata'] === 'object' &&
              data['metadata'] !== null &&
              'writer_summary' in (data['metadata'] as Record<string, unknown>);
            if (hasWriterSummary) {
              return { eq: () => Promise.reject(new Error('Simulated DB failure on full metadata update')) };
            }
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
          insert(data: Record<string, unknown>) {
            stats.batchInsertCalls.push({ ...data });
            return {
              select(_cols: string) {
                return {
                  single() {
                    return Promise.resolve({ data: { id: NEW_BATCH_ID }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            return {
              in(_col: string) {
                if (_col === 'domain') return Promise.resolve({ data: [], error: null });
                return { not: () => Promise.resolve({ data: [], error: null }) };
              },
            };
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

      if (table === 'prospect_candidate_audit') {
        return {
          insert(data: Record<string, unknown>) {
            stats.auditInsertCalls.push({ ...data });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }

      if (table === 'provider_usage_logs') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                if (config.providerUsageLogsError) {
                  return Promise.resolve({ data: null, error: config.providerUsageLogsError });
                }
                return Promise.resolve({ data: config.providerUsageLogs ?? [], error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table in fake admin: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makeDraftBatch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: EXISTING_BATCH_ID,
    status: 'draft',
    source: 'agent_1',
    created_by: USER_A,
    owner_id: USER_A,
    metadata: {
      request_source: 'chat_wizard',
      catalog_version_id: 'v2024-01',
      industry_id: 'tech-001',
      subindustry_ids: ['sub-a'],
      country_code: 'CO',
      adaptive_discovery: {
        enabled: true,
        max_rounds: 4,
        rounds_executed: 4,
        stop_reason: 'max_rounds_reached',
      },
      ...overrides,
    },
    client_request_id: 'req-uuid-0001',
  };
}

// Provider usage logs fixture: 4 logs, 19 credits total
const FOUR_LOG_FIXTURE: Array<Record<string, unknown>> = [
  { credits_used: 4, metadata: { queries_executed: 4, queries_planned: 4, successful_query_count: 4, failed_query_count: 0 } },
  { credits_used: 5, metadata: { queries_executed: 5, queries_planned: 5, successful_query_count: 5, failed_query_count: 0 } },
  { credits_used: 5, metadata: { queries_executed: 5, queries_planned: 5, successful_query_count: 5, failed_query_count: 0 } },
  { credits_used: 5, metadata: { queries_executed: 5, queries_planned: 5, successful_query_count: 5, failed_query_count: 0 } },
];

// ============================================================================
// Fixture A — 0 candidatos persistidos por calidad (gates bloquean todos)
// ============================================================================

describe('Fixture A — 0 persisted via quality gates with existingBatchId', () => {
  const EXTERNAL_BLOCKED_CASES = [
    { name: 'Computerweekly', url: 'https://www.computerweekly.com/es/cronica/que-deben-buscar', domain: 'computerweekly.com', expectedSkipPrefix: 'external_platform' },
    { name: 'Reddit', url: 'https://www.reddit.com/r/ColombiaDevs/comments/123', domain: 'reddit.com', expectedSkipPrefix: 'external_platform' },
    { name: 'Bambubpo', url: 'https://bambubpo.com/articulo/outsourcing-colombia', domain: 'bambubpo.com', expectedSkipPrefix: 'external_platform' },
    { name: 'Orbit.es', url: 'https://orbit.es/software-de-gestion-erp-crm', domain: 'orbit.es', expectedSkipPrefix: 'country_incompatible' },
    { name: 'Generic SaaS', url: 'https://medium.com/saas-empresarial-colombia', domain: 'medium.com', expectedSkipPrefix: 'external_platform' },
  ];

  it('A1 — 0 candidates created when all blocked by gates', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software empresarial para empresas en Colombia' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.createdCandidateIds.length, 0);
    assert.equal(result.status, 'success');
    assert.equal(result.batchId, EXISTING_BATCH_ID);
  });

  it('A2 — external_platform_gate is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Empresa de software en Colombia' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;

    assert.ok(meta['external_platform_gate'] != null, 'external_platform_gate must not be null');
    const epg = meta['external_platform_gate'] as Record<string, unknown>;
    assert.equal(epg['blocked_count'], 3, 'Should have blocked 3 external platforms');
  });

  it('A3 — company_ownership_gate is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software empresarial' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['company_ownership_gate'] != null, 'company_ownership_gate must not be null');
  });

  it('A4 — source_url_quality_gate is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['source_url_quality_gate'] != null, 'source_url_quality_gate must not be null');
  });

  it('A5 — business_fit_gate is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software empresarial' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['business_fit_gate'] != null, 'business_fit_gate must not be null');
  });

  it('A6 — precision_gate is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['precision_gate'] != null, 'precision_gate must not be null');
  });

  it('A7 — target_cap is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['target_cap'] != null, 'target_cap must not be null');
    const tc = meta['target_cap'] as Record<string, unknown>;
    assert.equal(tc['eligible_before_cap'], 0);
    assert.equal(tc['persisted_after_cap'], 0);
  });

  it('A8 — canonical_identity_gate is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['canonical_identity_gate'] != null, 'canonical_identity_gate must not be null');
  });

  it('A9 — writer_summary is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['writer_summary'] != null, 'writer_summary must not be null');
    const ws = meta['writer_summary'] as Record<string, unknown>;
    assert.equal(ws['actual_persisted_count'], 0);
    assert.equal(ws['created_candidate_ids_count'], 0);
  });

  it('A10 — pipeline_summary_post_write is not null', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['pipeline_summary_post_write'] != null, 'pipeline_summary_post_write must not be null');
    const pspw = meta['pipeline_summary_post_write'] as Record<string, unknown>;
    assert.equal(pspw['persisted'], 0);
    assert.equal(pspw['skipped'], candidates.length);
  });

  it('A11 — batch status is completed (0 candidates persisted)', async () => {
    const candidates = EXTERNAL_BLOCKED_CASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Software empresarial' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    // At least one batch update must explicitly set status to 'completed'.
    // After the fix, a status-only correction runs before the full metadata write,
    // guaranteeing 'completed' (not ready_for_review) even if the metadata update later fails.
    // 'nothing_to_write' was never in the DB check constraint; 'completed' is the correct value.
    const DB_ALLOWED_STATUSES = ['draft', 'generating', 'ready_for_review', 'in_review', 'completed', 'cancelled', 'failed'];
    const completedCall = stats.batchUpdateCalls.find(
      (u) => u['status'] === 'completed'
    );
    assert.ok(completedCall != null, 'At least one batch update must set status to completed');
    assert.ok(DB_ALLOWED_STATUSES.includes(completedCall['status'] as string), 'status must be in DB-allowed set');
  });
});

// ============================================================================
// Fixture B — 0 candidatos por novelty (canonical identity gate)
// ============================================================================

describe('Fixture B — 0 persisted via canonical identity gate with existingBatchId', () => {
  it('B1 — canonical_identity_gate has total_exclusions > 0', async () => {
    // Use names that are non-company phrases (not content page patterns)
    const NON_COMPANY_PHRASES = [
      { name: 'Software empresarial', url: 'https://softwaredemo.com/soluciones', domain: 'softwaredemo.com' },
      { name: 'Soluciones y tecnología', url: 'https://soltec.co/implementacion-crm', domain: 'soltec.co' },
      { name: 'Plataformas LMS', url: 'https://plataformasedu.com/servicios', domain: 'plataformasedu.com' },
      { name: 'Software ERP', url: 'https://erpsolutions.com.co/partner', domain: 'erpsolutions.com.co' },
      { name: 'Soluciones tecnológicas', url: 'https://soltec.com.co/servicios-ti', domain: 'soltec.com.co' },
    ];
    const candidates = NON_COMPANY_PHRASES.map((c) =>
      makeCandidate({ name: c.name, website: c.url, domain: c.domain, sourceSnippet: 'Ofrecemos software empresarial para empresas en Colombia' })
    );
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    const cig = meta['canonical_identity_gate'] as Record<string, unknown>;
    assert.ok((cig['total_exclusions'] as number) > 0, 'canonical_identity_gate should have total_exclusions > 0');
    assert.ok((cig['non_company_phrase_exclusions'] as number) > 0, 'should have non_company_phrase_exclusions > 0');
  });

  it('B2 — writer_summary identity_gate_skipped_count > 0', async () => {
    const candidates = [
      makeCandidate({ name: 'Software empresarial', website: 'https://softwaredemo.com/soluciones', domain: 'softwaredemo.com', sourceSnippet: 'Software empresarial para empresas' }),
      makeCandidate({ name: 'Soluciones y tecnología', website: 'https://soltec.co/implementacion', domain: 'soltec.co', sourceSnippet: 'Soluciones tecnológicas' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    const ws = meta['writer_summary'] as Record<string, unknown>;
    assert.ok((ws['identity_gate_skipped_count'] as number) > 0, 'identity_gate_skipped_count should be > 0');
    assert.equal(ws['actual_persisted_count'], 0);
  });

  it('B3 — canoncial_identity_gate + writer_summary both present', async () => {
    const candidates = [
      makeCandidate({ name: 'Software empresarial', website: 'https://softwaredemo.com', domain: 'softwaredemo.com', sourceSnippet: 'Software empresarial Colombia' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['canonical_identity_gate'] != null);
    assert.ok(meta['writer_summary'] != null);
  });
});

// ============================================================================
// Fixture C — Tavily reconciliation en 0 persistidos
// ============================================================================

describe('Fixture C — Tavily reconciliation with 0 persisted candidates', () => {
  it('C1 — 4 logs, 19 credits, 19 queries → matched', async () => {
    const candidates = [
      makeCandidate({ name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica', domain: 'computerweekly.com', sourceSnippet: 'Software empresarial' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    const recon = meta['tavily_usage_reconciliation'] as Record<string, unknown>;

    assert.ok(recon != null, 'tavily_usage_reconciliation must not be null');
    assert.equal(recon['logs_count'], 4);
    assert.equal(recon['credits_used_logged'], 19);
    assert.equal(recon['queries_executed_total'], 19);
    assert.equal(recon['expected_credits_from_queries'], 19);
    assert.equal(recon['reconciliation_status'], 'matched');
  });

  it('C2 — tavily_usage_reconciliation present even with 0 candidates created', async () => {
    const candidates = [
      makeCandidate({ name: 'Reddit r/ColombiaDevs', website: 'https://www.reddit.com/r/ColombiaDevs/comments/123', domain: 'reddit.com', sourceSnippet: 'Software recomendaciones' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    const recon = meta['tavily_usage_reconciliation'] as Record<string, unknown>;
    assert.ok(recon != null, 'tavily_usage_reconciliation must be present even with 0 created candidates');
    assert.equal(recon['reconciliation_status'], 'matched');
  });

  it('C3 — reconciliation fallback to pipeline metadata when no logs exist', async () => {
    const candidates = [
      makeCandidate({ name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica', domain: 'computerweekly.com', sourceSnippet: 'Software' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: [] }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    const recon = meta['tavily_usage_reconciliation'] as Record<string, unknown>;
    assert.ok(recon != null, 'tavily_usage_reconciliation must not be null even with empty logs');
    assert.ok(recon['reconciliation_status'] === 'matched' || recon['reconciliation_status'] === 'mismatch',
      'reconciliation_status should be computed');
  });
});

// ============================================================================
// Fixture D — Metadata deep merge preserves previous keys
// ============================================================================

describe('Fixture D — Metadata deep merge preserves previous keys', () => {
  it('D1 — existing metadata keys survive final metadata update', async () => {
    const existingMetadata: Record<string, unknown> = {
      existing_key: 'keep_me',
      discovery_strategy: { version: 'novelty_aware_v1' },
      adaptive_discovery: {
        enabled: true,
        max_rounds: 4,
        rounds_executed: 2,
        stop_reason: 'max_rounds_reached',
        persisted_count: 0,
      },
      request_source: 'chat_wizard',
    };

    const candidates = [
      makeCandidate({ name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica', domain: 'computerweekly.com', sourceSnippet: 'Software empresarial' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(existingMetadata), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;

    assert.equal(meta['existing_key'], 'keep_me', 'existing_key must survive');
    assert.ok(meta['discovery_strategy'] != null, 'discovery_strategy must survive');
    assert.equal((meta['discovery_strategy'] as Record<string, unknown>)['version'], 'novelty_aware_v1');
    assert.equal(meta['request_source'], 'chat_wizard', 'request_source must survive');
  });

  it('D2 — adaptive_discovery from existing metadata survives final update', async () => {
    const existingMetadata: Record<string, unknown> = {
      existing_key: 'keep_me',
      adaptive_discovery: {
        enabled: true,
        max_rounds: 4,
        rounds_executed: 2,
        stop_reason: 'max_rounds_reached',
      },
    };

    const candidates = [
      makeCandidate({ name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica', domain: 'computerweekly.com', sourceSnippet: 'Software' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(existingMetadata), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;

    assert.equal(meta['existing_key'], 'keep_me');
    const ad = meta['adaptive_discovery'] as Record<string, unknown>;
    assert.ok(ad != null, 'adaptive_discovery must survive');
    // adaptive_discovery from existing metadata is preserved but NOT reconciled
    // (reconciliation requires extraBatchMetadata.adaptive_discovery which is set by
    // incremental-search; when writing directly without it, the existing value passes through)
    assert.equal(ad['stop_reason'], 'max_rounds_reached');
  });

  it('D3 — writer adds gate metadata without removing pipeline fields', async () => {
    const candidates = [
      makeCandidate({ name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica', domain: 'computerweekly.com', sourceSnippet: 'Software' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;

    assert.ok(meta['generated_by'] != null, 'generated_by must survive');
    assert.ok(meta['pipeline_summary'] != null, 'pipeline_summary must survive');
    assert.ok(meta['request_source'] != null, 'request_source (from existing meta) must survive');
    assert.ok(meta['writer_summary'] != null, 'writer_summary must be added');
    assert.ok(meta['tavily_usage_reconciliation'] != null, 'tavily_usage_reconciliation must be added');
  });
});

// ============================================================================
// Fixture E — Regresion: con existingBatchId + candidatos normales
// ============================================================================

describe('Fixture E — Regression: normal candidates still work with existingBatchId', () => {
  it('E1 — candidates created with existingBatchId', async () => {
    const candidates = [
      makeCandidate({ name: 'Nexen', website: 'https://www.nexen.com.co', domain: 'nexen.com.co', sourceSnippet: 'Software empresarial para empresas en Colombia' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 },
      admin,
    );

    assert.equal(result.candidatesCreated, 1);
    assert.equal(result.createdCandidateIds.length, 1);
    assert.equal(result.batchId, EXISTING_BATCH_ID);

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['writer_summary'] != null);
    assert.equal((meta['writer_summary'] as Record<string, unknown>)['actual_persisted_count'], 1);
  });

  it('E2 — without existingBatchId still works with 0 candidates (returns batchId:null)', async () => {
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const result = await writeProspectingCandidates(
      makeInput({ pipelineOutput: makePipelineOutput([]), triggeredByUserId: USER_A, ownerId: USER_A, dryRun: false }),
      admin,
    );

    assert.equal(result.batchId, null);
    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.status, 'failed');
  });

  it('E3 — without existingBatchId with 1 candidate still creates batch and writes metadata', async () => {
    const candidates = [
      makeCandidate({ name: 'Nexen', website: 'https://www.nexen.com.co', domain: 'nexen.com.co', sourceSnippet: 'Software empresarial empresas Colombia' }),
    ];
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const pipelineOutput = makePipelineOutput(candidates);
    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: USER_A, ownerId: USER_A, source: 'agent_1', dryRun: false },
      admin,
    );

    assert.equal(result.candidatesCreated, 1);
    assert.ok(result.batchId != null, 'batchId should be set');

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['writer_summary'] != null);
    assert.ok(meta['tavily_usage_reconciliation'] != null);
    assert.ok(meta['external_platform_gate'] != null);
    assert.ok(meta['company_ownership_gate'] != null);
    assert.ok(meta['source_url_quality_gate'] != null);
    assert.ok(meta['business_fit_gate'] != null);
    assert.ok(meta['precision_gate'] != null);
    assert.ok(meta['canonical_identity_gate'] != null);
  });

  it('E4 — 0 pipeline candidates with existingBatchId writes complete metadata', async () => {
    const existingMetadata: Record<string, unknown> = {
      request_source: 'chat_wizard',
      catalog_version_id: 'v2024-01',
      existing_key: 'preserve_me',
    };

    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin({ existingBatch: makeDraftBatch(existingMetadata), providerUsageLogs: FOUR_LOG_FIXTURE }, stats);
    const result = await writeProspectingCandidates(
      makeInput({ pipelineOutput: makePipelineOutput([]), triggeredByUserId: USER_A, ownerId: USER_A, existingBatchId: EXISTING_BATCH_ID, targetPersistibleCandidates: 10 }),
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.batchId, EXISTING_BATCH_ID);
    assert.notEqual(result.status, 'failed', 'Should not be failed when existingBatchId is provided');

    // Verify the last batch update contains complete metadata
    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;

    // Existing fields preserved
    assert.equal(meta['existing_key'], 'preserve_me');
    assert.equal(meta['request_source'], 'chat_wizard');

    // Gate metadata present (all zeroed out since no candidates processed)
    assert.ok(meta['external_platform_gate'] != null, 'external_platform_gate must not be null');
    assert.ok(meta['company_ownership_gate'] != null, 'company_ownership_gate must not be null');
    assert.ok(meta['source_url_quality_gate'] != null, 'source_url_quality_gate must not be null');
    assert.ok(meta['business_fit_gate'] != null, 'business_fit_gate must not be null');
    assert.ok(meta['precision_gate'] != null, 'precision_gate must not be null');
    assert.ok(meta['canonical_identity_gate'] != null, 'canonical_identity_gate must not be null');

    // Writer summary present
    assert.ok(meta['writer_summary'] != null, 'writer_summary must not be null');
    const ws = meta['writer_summary'] as Record<string, unknown>;
    assert.equal(ws['actual_persisted_count'], 0);
    assert.equal(ws['created_candidate_ids_count'], 0);

    // Pipeline summary present
    assert.ok(meta['pipeline_summary_post_write'] != null, 'pipeline_summary_post_write must not be null');

    // Target cap present
    assert.ok(meta['target_cap'] != null, 'target_cap must not be null');
    assert.equal((meta['target_cap'] as Record<string, unknown>)['persisted_after_cap'], 0);

    // Tavily reconciliation present
    assert.ok(meta['tavily_usage_reconciliation'] != null, 'tavily_usage_reconciliation must not be null');

    // Adaptive discovery present (preserved from existing batch metadata when
    // no extraBatchMetadata.adaptive_discovery is provided by incremental-search)
    assert.ok(meta['adaptive_discovery'] != null, 'adaptive_discovery must not be null');
  });
});

// ============================================================================
// Fixture F — Status correction guaranteed even when full metadata update fails
// Regression for batch 7359ae23-1e64-4163-8785-2854a1103512:
//   incremental_multi_round, 4 rounds, 0 persisted, status left at ready_for_review
// ============================================================================

describe('Fixture F — Status correction independent of metadata computation (16AB regression)', () => {
  const INCREMENTAL_BLOCKED = [
    makeCandidate({ name: 'Computerweekly', website: 'https://www.computerweekly.com/es/cronica', domain: 'computerweekly.com', sourceSnippet: 'Software empresarial' }),
    makeCandidate({ name: 'Reddit r/ColombiaDevs', website: 'https://www.reddit.com/r/ColombiaDevs/comments/123', domain: 'reddit.com', sourceSnippet: 'Software recomendaciones' }),
  ];

  const INCREMENTAL_EXTRA_META = {
    search_mode: 'incremental_multi_round',
    adaptive_discovery: {
      enabled: true,
      max_rounds: 4,
      rounds_executed: 4,
      stop_reason: 'max_rounds_reached',
      result_status: 'no_new_candidates',
      persisted_count: 0,
      remaining_to_target: 10,
      persistible_estimate: 2,
    },
    incremental_search: {
      excluded_by_negative_memory_total: 34,
      estimated_persistable_after_novelty: 2,
    },
  };

  it('F1 — status completed set even when full metadata update throws (simulates 7359ae23)', async () => {
    // The fakeAdmin is configured to reject the batch update that carries
    // writer_summary in metadata, replicating the silent-failure scenario seen
    // in the real batch. The status-correction step must still succeed.
    // 'nothing_to_write' was never in the DB check constraint; 'completed' is used instead.
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin(
      {
        existingBatch: makeDraftBatch(),
        providerUsageLogs: FOUR_LOG_FIXTURE,
        failOnFullMetadataUpdate: true,
      },
      stats,
    );
    const pipelineOutput = makePipelineOutput(INCREMENTAL_BLOCKED);

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: USER_A,
        ownerId: USER_A,
        source: 'agent_1',
        dryRun: false,
        existingBatchId: EXISTING_BATCH_ID,
        targetPersistibleCandidates: 10,
        extraBatchMetadata: INCREMENTAL_EXTRA_META,
      },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);

    // A status-only update with 'completed' must exist independently of
    // the full metadata update, so the batch never stays at ready_for_review.
    const statusCorrectionCall = stats.batchUpdateCalls.find(
      (u) => u['status'] === 'completed' && !('metadata' in u)
    );
    assert.ok(
      statusCorrectionCall != null,
      'A status-only correction to completed must run before the full metadata write',
    );
  });

  it('F2 — status completed present in at least one update when metadata succeeds', async () => {
    // Happy path with incremental_multi_round extraBatchMetadata:
    // both the status-correction and the full metadata write succeed.
    // 'nothing_to_write' was never in the DB check constraint; 'completed' is used instead.
    const stats: FakeAdminStats = { batchInsertCalls: [], batchUpdateCalls: [], candidateInsertCalls: [], auditInsertCalls: [] };
    const admin = makeFakeAdmin(
      { existingBatch: makeDraftBatch(), providerUsageLogs: FOUR_LOG_FIXTURE },
      stats,
    );
    const pipelineOutput = makePipelineOutput(INCREMENTAL_BLOCKED);

    await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: USER_A,
        ownerId: USER_A,
        source: 'agent_1',
        dryRun: false,
        existingBatchId: EXISTING_BATCH_ID,
        targetPersistibleCandidates: 10,
        extraBatchMetadata: INCREMENTAL_EXTRA_META,
      },
      admin,
    );

    const completedStatusCall = stats.batchUpdateCalls.find((u) => u['status'] === 'completed');
    assert.ok(completedStatusCall != null, 'At least one update must set status to completed');

    // Full metadata must also be present in the final update
    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const meta = lastUpdate['metadata'] as Record<string, unknown>;
    assert.ok(meta['writer_summary'] != null, 'writer_summary must be present in final metadata');
    assert.ok(meta['tavily_usage_reconciliation'] != null, 'tavily_usage_reconciliation must be present');
    assert.ok(meta['external_platform_gate'] != null, 'external_platform_gate must be present');
  });
});
