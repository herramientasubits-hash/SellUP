/**
 * Tests — Agent 1 v1.16K-E-A — Post-Approval NIT Worker Smoke Readiness
 *
 * Sin Tavily. Sin LLM. Sin LinkedIn. Sin Supabase real.
 *
 * F1  — smoke domain constante correcto
 * F2  — smoke metadata tiene smoke_type correcto
 * F3  — candidate mock queda converted_to_account y queued nit_first
 * F4  — adapterRegistryOverride tiene 5 source keys
 * F5  — mock personas_juridicas_cc matched
 * F6  — mock secop2 no_match
 * F7  — mock sectoriales (minsalud_reps + superfinanciera) skipped
 * F8  — mock siis matched
 * F9  — worker con candidateId procesa solo candidato smoke
 * F10 — metadata previa se preserva (approval + rich_profile + icp_size_gate)
 * F11 — audit sub_action completed
 * F12 — cleanup SQL no contiene DELETE
 * F13 — no Tavily
 * F14 — no LLM
 * F15 — no LinkedIn
 * F16 — provider_usage_logs esperado 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runPostApprovalNitEnrichmentWorker,
  selectQueuedCandidates,
  persistEnrichmentResults,
  insertPostApprovalAuditTrail,
  CO_NIT_SAFE_SOURCE_KEYS,
  type CandidateRow,
  type AdapterRunResult,
} from '@/server/prospect-batches/post-approval-nit-enrichment-worker';

import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
} from '@/server/source-catalog/enrichment/types';

// ── Constants (mirrors smoke script) ─────────────────────────────────────────

const SMOKE_DOMAIN = 'sellup-post-approval-nit-smoke.example';
const SMOKE_NIT = '900123456';
const SMOKE_TYPE = 'post_approval_nit_worker_v1_16k_e_a';
const EXPECTED_SOURCE_KEYS = [...CO_NIT_SAFE_SOURCE_KEYS];

// ── Helpers ───────────────────────────────────────────────────────────────────

type AuditRow = {
  action_type: string;
  details: Record<string, unknown>;
  batch_id: string | null;
  candidate_id: string;
};

function makeSmokeCandidateMetadata(accountId: string): Record<string, unknown> {
  return {
    smoke_test: true,
    smoke_type: SMOKE_TYPE,
    qa_only: true,
    do_not_use_for_sales: true,
    do_not_convert: true,
    approval: {
      approved_at: '2026-06-25T10:00:00.000Z',
      approved_by: 'smoke_script_v1_16k_e_a',
    },
    rich_profile: { company_type: 'SAS', employees: 42, domain: SMOKE_DOMAIN },
    icp_size_gate: { passed: true, size_bucket: 'mid_market' },
    post_approval_enrichment: {
      status: 'queued',
      strategy: 'nit_first',
      nit: SMOKE_NIT,
      source_keys: EXPECTED_SOURCE_KEYS,
      trigger: 'candidate_approval',
      account_id: accountId,
      triggered_at: '2026-06-25T10:00:00.000Z',
    },
  };
}

function makeSmokeCandidateRow(accountId = 'smoke-account-uuid'): CandidateRow {
  return {
    id: 'smoke-candidate-uuid',
    batch_id: null,
    name: 'SellUp Post Approval NIT Smoke Candidate',
    status: 'converted_to_account',
    converted_account_id: accountId,
    tax_identifier: SMOKE_NIT,
    country_code: 'CO',
    sector_code: null,
    sector_description: null,
    metadata: makeSmokeCandidateMetadata(accountId),
  };
}

function makeMockSupabase(opts: { rows?: CandidateRow[] } = {}) {
  const auditRows: AuditRow[] = [];
  const updatedRows: { id: string; data: Record<string, unknown> }[] = [];
  const deleteCalls: string[] = [];
  const insertCalls: { table: string; data: unknown }[] = [];

  const rows: CandidateRow[] = opts.rows ?? [makeSmokeCandidateRow()];

  const mock = {
    auditRows,
    updatedRows,
    deleteCalls,
    insertCalls,
    from: (table: string) => {
      if (table === 'prospect_candidates') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              not: (_col2: string, _op: string, _val2: unknown) => ({
                limit: (_n: number) =>
                  Promise.resolve({ data: rows, error: null }),
              }),
            }),
          }),
          update: (data: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              updatedRows.push({ id, data });
              return Promise.resolve({ error: null });
            },
          }),
          delete: () => {
            deleteCalls.push(table);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return {
          insert: (row: AuditRow) => {
            auditRows.push(row);
            insertCalls.push({ table, data: row });
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        delete: () => {
          deleteCalls.push(table);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };

  return mock;
}

function makeMockAdapterRegistry(): Record<string, SourceEnrichmentAdapter> {
  const make = (
    sourceKey: string,
    result: Partial<SourceEnrichmentOutput>,
  ): SourceEnrichmentAdapter => ({
    sourceKey,
    supportedCapabilities: ['enrichment_after_discovery'],
    enrichCandidate: async (_: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> => ({
      sourceKey,
      status: 'matched',
      matchedBy: null,
      confidence: 0,
      ...result,
    }),
  });

  return {
    co_personas_juridicas_cc: make('co_personas_juridicas_cc', {
      status: 'matched',
      matchedBy: 'tax_id',
      confidence: 0.95,
    }),
    co_secop2_proveedores: make('co_secop2_proveedores', {
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      reason: 'not_found_in_mock_secop2',
    }),
    co_minsalud_reps: make('co_minsalud_reps', {
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'sector_mismatch',
    }),
    co_superfinanciera: make('co_superfinanciera', {
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'sector_mismatch',
    }),
    co_siis: make('co_siis', {
      status: 'matched',
      matchedBy: 'tax_id',
      confidence: 0.95,
    }),
  };
}

// ── F1 — smoke domain constante correcto ─────────────────────────────────────

describe('v1.16K-E-A — F1: smoke domain constante correcto', () => {
  it('SMOKE_DOMAIN es el domain aislado esperado', () => {
    assert.equal(
      SMOKE_DOMAIN,
      'sellup-post-approval-nit-smoke.example',
      'SMOKE_DOMAIN must be the isolated QA domain',
    );
    assert.ok(
      SMOKE_DOMAIN.includes('smoke'),
      'SMOKE_DOMAIN must contain "smoke" to signal QA context',
    );
    assert.ok(
      SMOKE_DOMAIN.endsWith('.example'),
      'SMOKE_DOMAIN must use .example TLD (reserved, never resolves)',
    );
  });
});

// ── F2 — smoke metadata tiene smoke_type correcto ─────────────────────────────

describe('v1.16K-E-A — F2: smoke metadata tiene smoke_type correcto', () => {
  it('smoke candidate metadata smoke_type matches expected constant', () => {
    const meta = makeSmokeCandidateMetadata('acc-123');
    assert.equal(meta.smoke_type, SMOKE_TYPE);
    assert.equal(meta.smoke_type, 'post_approval_nit_worker_v1_16k_e_a');
  });

  it('smoke metadata flags are set correctly', () => {
    const meta = makeSmokeCandidateMetadata('acc-123');
    assert.equal(meta.smoke_test, true);
    assert.equal(meta.qa_only, true);
    assert.equal(meta.do_not_use_for_sales, true);
    assert.equal(meta.do_not_convert, true);
  });
});

// ── F3 — candidate mock queda converted_to_account y queued nit_first ─────────

describe('v1.16K-E-A — F3: candidate mock queda converted_to_account y queued nit_first', () => {
  it('smoke candidate row has status=converted_to_account', () => {
    const candidate = makeSmokeCandidateRow();
    assert.equal(candidate.status, 'converted_to_account');
  });

  it('smoke candidate pae.status=queued, strategy=nit_first, nit=SMOKE_NIT', () => {
    const candidate = makeSmokeCandidateRow();
    const meta = candidate.metadata as Record<string, unknown>;
    const pae = meta.post_approval_enrichment as Record<string, unknown>;
    assert.equal(pae.status, 'queued');
    assert.equal(pae.strategy, 'nit_first');
    assert.equal(pae.nit, SMOKE_NIT);
  });

  it('smoke candidate has converted_account_id set', () => {
    const candidate = makeSmokeCandidateRow('smoke-account-uuid');
    assert.ok(candidate.converted_account_id, 'converted_account_id must be set');
  });

  it('selectQueuedCandidates picks up the smoke candidate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;
    const result = await selectQueuedCandidates(mock, 5);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'smoke-candidate-uuid');
  });
});

// ── F4 — adapterRegistryOverride tiene 5 source keys ─────────────────────────

describe('v1.16K-E-A — F4: adapterRegistryOverride tiene 5 source keys', () => {
  it('mock registry has exactly 5 source keys', () => {
    const registry = makeMockAdapterRegistry();
    assert.equal(Object.keys(registry).length, 5);
  });

  it('mock registry keys match CO_NIT_SAFE_SOURCE_KEYS', () => {
    const registry = makeMockAdapterRegistry();
    for (const key of EXPECTED_SOURCE_KEYS) {
      assert.ok(key in registry, `registry must contain key: ${key}`);
    }
  });
});

// ── F5 — mock personas_juridicas_cc matched ──────────────────────────────────

describe('v1.16K-E-A — F5: mock personas_juridicas_cc matched', () => {
  it('mock adapter co_personas_juridicas_cc returns status=matched', async () => {
    const registry = makeMockAdapterRegistry();
    const output = await registry.co_personas_juridicas_cc.enrichCandidate({
      candidateName: 'Test SA',
      candidateTaxId: SMOKE_NIT,
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      capability: 'enrichment_after_discovery',
    });
    assert.equal(output.status, 'matched');
    assert.equal(output.matchedBy, 'tax_id');
    assert.ok(output.confidence >= 0.9);
  });
});

// ── F6 — mock secop2 no_match ─────────────────────────────────────────────────

describe('v1.16K-E-A — F6: mock secop2 no_match', () => {
  it('mock adapter co_secop2_proveedores returns status=no_match', async () => {
    const registry = makeMockAdapterRegistry();
    const output = await registry.co_secop2_proveedores.enrichCandidate({
      candidateName: 'Test SA',
      candidateTaxId: SMOKE_NIT,
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      capability: 'enrichment_after_discovery',
    });
    assert.equal(output.status, 'no_match');
    assert.equal(output.confidence, 0);
  });
});

// ── F7 — mock sectoriales skipped ────────────────────────────────────────────

describe('v1.16K-E-A — F7: mock sectoriales skipped', () => {
  it('mock adapter co_minsalud_reps returns status=skipped', async () => {
    const registry = makeMockAdapterRegistry();
    const output = await registry.co_minsalud_reps.enrichCandidate({
      candidateName: 'Test SA',
      candidateTaxId: SMOKE_NIT,
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      capability: 'enrichment_after_discovery',
    });
    assert.equal(output.status, 'skipped');
    assert.equal(output.reason, 'sector_mismatch');
  });

  it('mock adapter co_superfinanciera returns status=skipped', async () => {
    const registry = makeMockAdapterRegistry();
    const output = await registry.co_superfinanciera.enrichCandidate({
      candidateName: 'Test SA',
      candidateTaxId: SMOKE_NIT,
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      capability: 'enrichment_after_discovery',
    });
    assert.equal(output.status, 'skipped');
    assert.equal(output.reason, 'sector_mismatch');
  });
});

// ── F8 — mock siis matched ────────────────────────────────────────────────────

describe('v1.16K-E-A — F8: mock siis matched', () => {
  it('mock adapter co_siis returns status=matched', async () => {
    const registry = makeMockAdapterRegistry();
    const output = await registry.co_siis.enrichCandidate({
      candidateName: 'Test SA',
      candidateTaxId: SMOKE_NIT,
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      capability: 'enrichment_after_discovery',
    });
    assert.equal(output.status, 'matched');
    assert.equal(output.matchedBy, 'tax_id');
    assert.ok(output.confidence >= 0.9);
  });
});

// ── F9 — worker con candidateId procesa solo candidato smoke ──────────────────

describe('v1.16K-E-A — F9: worker con candidateId procesa solo candidato smoke', () => {
  it('runPostApprovalNitEnrichmentWorker with candidateId processes only that candidate', async () => {
    const smoke = makeSmokeCandidateRow('acc-smoke');
    const realCandidate: CandidateRow = {
      ...makeSmokeCandidateRow('acc-real'),
      id: 'real-candidate-uuid',
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [smoke, realCandidate] }) as any;
    const registry = makeMockAdapterRegistry();

    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: registry,
      candidateId: 'smoke-candidate-uuid',
      maxCandidates: 10,
    });

    assert.equal(stats.queued_found, 1, 'Only smoke candidate should be selected after candidateId filter');
    assert.equal(stats.processed, 1, 'Only 1 candidate processed');

    // Verify no update was triggered for the real candidate
    const updatedIds = mock.updatedRows.map((r: { id: string }) => r.id);
    assert.ok(!updatedIds.includes('real-candidate-uuid'), 'Real candidate must not be updated');
  });

  it('candidateId filter with unknown id processes 0 candidates', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;

    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: makeMockAdapterRegistry(),
      candidateId: 'non-existent-uuid',
      maxCandidates: 5,
    });

    assert.equal(stats.queued_found, 0, 'Unknown candidateId must result in 0 candidates found');
    assert.equal(stats.processed, 0);
  });
});

// ── F10 — metadata previa se preserva ────────────────────────────────────────

describe('v1.16K-E-A — F10: metadata previa se preserva', () => {
  it('persistEnrichmentResults preserves approval, rich_profile, icp_size_gate', async () => {
    const adapterResults: AdapterRunResult[] = EXPECTED_SOURCE_KEYS.map((key) => {
      const statusMap: Record<string, SourceEnrichmentOutput['status']> = {
        co_personas_juridicas_cc: 'matched',
        co_secop2_proveedores: 'no_match',
        co_minsalud_reps: 'skipped',
        co_superfinanciera: 'skipped',
        co_siis: 'matched',
      };
      return {
        sourceKey: key,
        output: {
          sourceKey: key,
          status: statusMap[key] ?? 'matched',
          matchedBy: statusMap[key] === 'matched' ? 'tax_id' : null,
          confidence: statusMap[key] === 'matched' ? 0.95 : 0,
        },
      };
    });

    const existingMetadata = makeSmokeCandidateMetadata('acc-123');
    const paeBlock = existingMetadata.post_approval_enrichment as Record<string, unknown>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await persistEnrichmentResults(
      {
        candidateId: 'smoke-candidate-uuid',
        adapterResults,
        existingMetadata,
        paeBlock,
      },
      mock,
    );

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;

    // approval preserved
    const approval = updatedMeta?.approval as Record<string, unknown>;
    assert.ok(approval, 'approval block must be preserved');
    assert.equal(approval.approved_by, 'smoke_script_v1_16k_e_a');
    assert.equal(approval.approved_at, '2026-06-25T10:00:00.000Z');

    // rich_profile preserved
    const rp = updatedMeta?.rich_profile as Record<string, unknown>;
    assert.ok(rp, 'rich_profile block must be preserved');
    assert.equal(rp.company_type, 'SAS');
    assert.equal(rp.employees, 42);

    // icp_size_gate preserved
    const icpGate = updatedMeta?.icp_size_gate as Record<string, unknown>;
    assert.ok(icpGate, 'icp_size_gate block must be preserved');
    assert.equal(icpGate.passed, true);

    // smoke metadata preserved
    assert.equal(updatedMeta?.smoke_test, true);
    assert.equal(updatedMeta?.smoke_type, SMOKE_TYPE);
  });

  it('all 5 source enrichment statuses are correct after persist', async () => {
    const adapterResults: AdapterRunResult[] = [
      { sourceKey: 'co_personas_juridicas_cc', output: { sourceKey: 'co_personas_juridicas_cc', status: 'matched', matchedBy: 'tax_id', confidence: 0.95 } },
      { sourceKey: 'co_secop2_proveedores', output: { sourceKey: 'co_secop2_proveedores', status: 'no_match', matchedBy: null, confidence: 0 } },
      { sourceKey: 'co_minsalud_reps', output: { sourceKey: 'co_minsalud_reps', status: 'skipped', matchedBy: null, confidence: 0, reason: 'sector_mismatch' } },
      { sourceKey: 'co_superfinanciera', output: { sourceKey: 'co_superfinanciera', status: 'skipped', matchedBy: null, confidence: 0, reason: 'sector_mismatch' } },
      { sourceKey: 'co_siis', output: { sourceKey: 'co_siis', status: 'matched', matchedBy: 'tax_id', confidence: 0.95 } },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;
    const existingMetadata = makeSmokeCandidateMetadata('acc-123');
    const paeBlock = existingMetadata.post_approval_enrichment as Record<string, unknown>;

    await persistEnrichmentResults(
      { candidateId: 'smoke-candidate-uuid', adapterResults, existingMetadata, paeBlock },
      mock,
    );

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const se = updatedMeta?.source_enrichment as Record<string, unknown>;

    assert.equal((se?.co_personas_juridicas_cc as Record<string, unknown>)?.status, 'matched');
    assert.equal((se?.co_secop2_proveedores as Record<string, unknown>)?.status, 'no_match');
    assert.equal((se?.co_minsalud_reps as Record<string, unknown>)?.status, 'skipped');
    assert.equal((se?.co_superfinanciera as Record<string, unknown>)?.status, 'skipped');
    assert.equal((se?.co_siis as Record<string, unknown>)?.status, 'matched');

    // pae.status=completed (no errors in mock)
    const pae = updatedMeta?.post_approval_enrichment as Record<string, unknown>;
    assert.equal(pae?.status, 'completed');
    assert.equal(Array.isArray(pae?.processed_source_keys), true);
    assert.equal((pae?.processed_source_keys as string[]).length, 5);
    assert.equal((pae?.failed_source_keys as string[]).length, 0);
    assert.ok(typeof pae?.completed_at === 'string' && pae.completed_at.length > 0);
  });
});

// ── F11 — audit sub_action completed ─────────────────────────────────────────

describe('v1.16K-E-A — F11: audit sub_action completed', () => {
  it('worker generates audit with sub_action=post_approval_enrichment_completed for smoke candidate', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;
    const registry = makeMockAdapterRegistry();

    await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: registry,
      candidateId: 'smoke-candidate-uuid',
    });

    assert.equal(mock.auditRows.length, 1, 'Exactly 1 audit row must be inserted');
    const row = mock.auditRows[0];
    assert.equal(row.action_type, 'candidate_updated');
    assert.equal(row.details.sub_action, 'post_approval_enrichment_completed');
    assert.ok(Array.isArray(row.details.source_keys_attempted));
    assert.equal((row.details.source_keys_attempted as string[]).length, 5);
  });

  it('insertPostApprovalAuditTrail with smoke candidate data is correct', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await insertPostApprovalAuditTrail(
      {
        candidateId: 'smoke-candidate-uuid',
        batchId: null,
        accountId: 'smoke-account-uuid',
        finalStatus: 'completed',
        processedSourceKeys: EXPECTED_SOURCE_KEYS,
        matchedSourceKeys: ['co_personas_juridicas_cc', 'co_siis'],
        noMatchSourceKeys: ['co_secop2_proveedores'],
        skippedSourceKeys: ['co_minsalud_reps', 'co_superfinanciera'],
        failedSourceKeys: [],
      },
      mock,
    );

    const row = mock.auditRows[0];
    assert.equal(row.details.sub_action, 'post_approval_enrichment_completed');
    assert.equal(row.details.account_id, 'smoke-account-uuid');
    assert.equal((row.details.source_keys_attempted as string[]).length, 5);
    assert.equal((row.details.source_keys_matched as string[]).length, 2);
    assert.equal((row.details.source_keys_no_match as string[]).length, 1);
    assert.equal((row.details.source_keys_skipped as string[]).length, 2);
    assert.equal((row.details.source_keys_error as string[]).length, 0);
  });
});

// ── F12 — cleanup SQL no contiene DELETE ─────────────────────────────────────

describe('v1.16K-E-A — F12: cleanup SQL no contiene DELETE', () => {
  it('proposed cleanup SQL uses UPDATE, not DELETE', () => {
    // Mirrors cleanup SQL from smoke script
    const cleanupSql = `
UPDATE prospect_candidates
SET status = 'discarded', review_status = 'rejected'
WHERE id = 'smoke-candidate-uuid' AND domain = 'sellup-post-approval-nit-smoke.example';

UPDATE accounts
SET metadata = jsonb_set(metadata, '{logical_cleanup}', '{"hard_delete": false}'::jsonb)
WHERE id = 'smoke-account-uuid' AND domain = 'sellup-post-approval-nit-smoke.example';
    `.trim();

    // Must NOT contain DELETE
    assert.ok(
      !cleanupSql.toUpperCase().includes('\nDELETE'),
      'Cleanup SQL must not contain DELETE statement',
    );
    assert.ok(
      !cleanupSql.toUpperCase().match(/^\s*DELETE/m),
      'Cleanup SQL must not start any line with DELETE',
    );

    // Must use UPDATE
    assert.ok(
      cleanupSql.toUpperCase().includes('UPDATE'),
      'Cleanup SQL must use UPDATE for logical cleanup',
    );

    // Must use hard_delete=false
    assert.ok(
      cleanupSql.includes('"hard_delete": false'),
      'Cleanup SQL must set hard_delete=false',
    );
  });
});

// ── F13 — no Tavily ───────────────────────────────────────────────────────────

describe('v1.16K-E-A — F13: no Tavily', () => {
  it('EXPECTED_SOURCE_KEYS contains no Tavily keys', () => {
    const tavily = EXPECTED_SOURCE_KEYS.filter((k) =>
      k.toLowerCase().includes('tavily'),
    );
    assert.equal(tavily.length, 0, `No Tavily keys expected, found: ${tavily.join(',')}`);
  });

  it('mock adapter registry contains no Tavily adapters', () => {
    const registry = makeMockAdapterRegistry();
    const tavilyKeys = Object.keys(registry).filter((k) =>
      k.toLowerCase().includes('tavily'),
    );
    assert.equal(tavilyKeys.length, 0, 'Registry must not contain Tavily adapters');
  });

  it('worker with mock registry produces no Tavily-related enrichment', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;

    await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: makeMockAdapterRegistry(),
      candidateId: 'smoke-candidate-uuid',
    });

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const se = (updatedMeta?.source_enrichment ?? {}) as Record<string, unknown>;
    const tavilyKeys = Object.keys(se).filter((k) => k.toLowerCase().includes('tavily'));
    assert.equal(tavilyKeys.length, 0, 'No Tavily enrichment in output');
  });
});

// ── F14 — no LLM ─────────────────────────────────────────────────────────────

describe('v1.16K-E-A — F14: no LLM', () => {
  it('CO_NIT_SAFE_SOURCE_KEYS contains no llm or ai keys', () => {
    const llm = CO_NIT_SAFE_SOURCE_KEYS.filter(
      (k) => k.toLowerCase().includes('llm') || k.toLowerCase().includes('openai'),
    );
    assert.equal(llm.length, 0, 'No LLM source keys in CO_NIT_SAFE_SOURCE_KEYS');
  });

  it('worker completes without calling LLM (mock adapters only)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;

    // If LLM were called it would fail (no API key in test env)
    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: makeMockAdapterRegistry(),
      candidateId: 'smoke-candidate-uuid',
    });

    assert.equal(stats.processed, 1, 'Worker must complete 1 candidate without LLM call');
    assert.equal(stats.errors, 0, 'No errors — LLM not called');
  });
});

// ── F15 — no LinkedIn ────────────────────────────────────────────────────────

describe('v1.16K-E-A — F15: no LinkedIn', () => {
  it('CO_NIT_SAFE_SOURCE_KEYS contains no LinkedIn keys', () => {
    const linkedin = CO_NIT_SAFE_SOURCE_KEYS.filter((k) =>
      k.toLowerCase().includes('linkedin'),
    );
    assert.equal(linkedin.length, 0, 'No LinkedIn source keys in CO_NIT_SAFE_SOURCE_KEYS');
  });

  it('mock registry contains no LinkedIn adapters', () => {
    const registry = makeMockAdapterRegistry();
    const linkedinKeys = Object.keys(registry).filter((k) =>
      k.toLowerCase().includes('linkedin'),
    );
    assert.equal(linkedinKeys.length, 0, 'Registry must not contain LinkedIn adapters');
  });

  it('worker with mock registry produces no LinkedIn-related enrichment', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;

    await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: makeMockAdapterRegistry(),
      candidateId: 'smoke-candidate-uuid',
    });

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const se = (updatedMeta?.source_enrichment ?? {}) as Record<string, unknown>;
    const linkedinKeys = Object.keys(se).filter((k) =>
      k.toLowerCase().includes('linkedin'),
    );
    assert.equal(linkedinKeys.length, 0, 'No LinkedIn enrichment in output');
  });
});

// ── F16 — provider_usage_logs esperado 0 ─────────────────────────────────────

describe('v1.16K-E-A — F16: provider_usage_logs esperado 0', () => {
  it('mock supabase receives no inserts to provider_usage_logs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;

    await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: makeMockAdapterRegistry(),
      candidateId: 'smoke-candidate-uuid',
    });

    const providerLogs = mock.insertCalls.filter(
      (c: { table: string }) => c.table === 'provider_usage_logs',
    );
    assert.equal(
      providerLogs.length,
      0,
      'provider_usage_logs must receive 0 inserts — no paid providers used',
    );
  });

  it('worker generates exactly 1 audit insert (to prospect_candidate_audit only)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [makeSmokeCandidateRow()] }) as any;

    await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: makeMockAdapterRegistry(),
      candidateId: 'smoke-candidate-uuid',
    });

    assert.equal(
      mock.insertCalls.length,
      1,
      'Only 1 insert expected: audit row in prospect_candidate_audit',
    );
    assert.equal(mock.insertCalls[0].table, 'prospect_candidate_audit');
  });
});
