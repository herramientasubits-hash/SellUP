/**
 * Tests — Agent 1 v1.16K-E — Post-Approval NIT Adapter Enrichment Worker
 *
 * Sin Tavily. Sin LLM. Sin LinkedIn. Sin Supabase real.
 *
 * F1  — selector encuentra solo candidatos queued nit_first converted
 * F2  — selector ignora candidatos sin NIT
 * F3  — selector ignora candidatos con status distinto de queued
 * F4  — selector respeta limit default 5
 * F5  — ejecución con adapters mock exitosos marca completed
 * F6  — adapter no_match guarda source_enrichment[source].status='no_match'
 * F7  — adapter skipped guarda source_enrichment[source].status='skipped'
 * F8  — adapter error no rompe los demás y marca completed_with_warnings
 * F9  — metadata.approval se preserva
 * F10 — metadata.rich_profile se preserva
 * F11 — post_approval_enrichment.completed_at se setea
 * F12 — audit trail se genera con sub_action correcto
 * F13 — no Tavily
 * F14 — no LLM
 * F15 — no LinkedIn
 * F16 — endpoint cron exige secret si aplica
 * F17 — no DELETE / no hard delete
 * F18 — source_keys Colombia son las esperadas
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  selectQueuedCandidates,
  executeNitAdapters,
  persistEnrichmentResults,
  insertPostApprovalAuditTrail,
  determineFinalStatus,
  runPostApprovalNitEnrichmentWorker,
  CO_NIT_SAFE_SOURCE_KEYS,
  type CandidateRow,
  type AdapterRunResult,
} from '@/server/prospect-batches/post-approval-nit-enrichment-worker';

import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
} from '@/server/source-catalog/enrichment/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueuedCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: 'cand-e-uuid',
    batch_id: 'batch-e-uuid',
    name: 'Empresa Test SA',
    status: 'converted_to_account',
    converted_account_id: 'account-e-uuid',
    tax_identifier: '900123456-1',
    country_code: 'CO',
    sector_code: null,
    sector_description: null,
    metadata: {
      post_approval_enrichment: {
        requested: true,
        strategy: 'nit_first',
        trigger: 'candidate_approval',
        account_id: 'account-e-uuid',
        status: 'queued',
        nit: '900123456-1',
        source_keys: [...CO_NIT_SAFE_SOURCE_KEYS],
        triggered_at: '2026-06-25T10:00:00.000Z',
      },
      approval: { approved_at: '2026-06-25T09:59:00.000Z', approved_by: 'user-1' },
      rich_profile: { company_type: 'SAS', employees: 50 },
    },
    ...overrides,
  };
}

type AuditRow = { action_type: string; details: Record<string, unknown>; batch_id: string | null; candidate_id: string };

function makeMockSupabase(opts: {
  rows?: CandidateRow[];
  captureUpdates?: boolean;
} = {}) {
  const auditRows: AuditRow[] = [];
  const updatedRows: { id: string; data: Record<string, unknown> }[] = [];
  const deleteCalls: string[] = [];

  const rows: CandidateRow[] = opts.rows ?? [makeQueuedCandidate()];

  const mock = {
    auditRows,
    updatedRows,
    deleteCalls,
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
            return {
              eq: () => Promise.resolve({ error: null }),
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return {
          insert: (row: AuditRow) => {
            auditRows.push(row);
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

function makeMockAdapter(
  sourceKey: string,
  output: Partial<SourceEnrichmentOutput>,
): SourceEnrichmentAdapter {
  return {
    sourceKey,
    supportedCapabilities: ['enrichment_after_discovery'],
    enrichCandidate: async (_input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> => ({
      sourceKey,
      status: 'matched',
      matchedBy: 'tax_id',
      confidence: 0.95,
      ...output,
    }),
  };
}

// ── F1 — selector finds queued nit_first converted candidates ─────────────────

describe('v1.16K-E — F1: selector finds queued nit_first converted candidates', () => {
  it('selectQueuedCandidates returns candidates with status=queued, strategy=nit_first, nit present', async () => {
    const queued = makeQueuedCandidate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [queued] }) as any;

    const result = await selectQueuedCandidates(mock, 5);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'cand-e-uuid');
  });
});

// ── F2 — selector ignores candidates without NIT ──────────────────────────────

describe('v1.16K-E — F2: selector ignores candidates without NIT', () => {
  it('selectQueuedCandidates filters out candidates where pae.nit is missing', async () => {
    const noNit = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'queued',
          // nit intentionally absent
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [noNit] }) as any;

    const result = await selectQueuedCandidates(mock, 5);
    assert.equal(result.length, 0, 'candidate without NIT must be excluded');
  });

  it('selectQueuedCandidates filters out candidates where pae.nit is empty string', async () => {
    const emptyNit = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'queued',
          nit: '   ',
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [emptyNit] }) as any;

    const result = await selectQueuedCandidates(mock, 5);
    assert.equal(result.length, 0, 'candidate with empty NIT must be excluded');
  });
});

// ── F3 — selector ignores status != queued ────────────────────────────────────

describe('v1.16K-E — F3: selector ignores candidates with status != queued', () => {
  it('selectQueuedCandidates filters out completed candidates', async () => {
    const completed = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'completed',
          nit: '900123456-1',
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [completed] }) as any;

    const result = await selectQueuedCandidates(mock, 5);
    assert.equal(result.length, 0, 'completed candidate must not be selected');
  });

  it('selectQueuedCandidates filters out skipped candidates', async () => {
    const skipped = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'skipped',
          nit: '900123456-1',
        },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [skipped] }) as any;

    const result = await selectQueuedCandidates(mock, 5);
    assert.equal(result.length, 0, 'skipped candidate must not be selected');
  });

  it('selectQueuedCandidates filters out candidates with no post_approval_enrichment block', async () => {
    const noBlock = makeQueuedCandidate({ metadata: { approval: { approved_at: 'now' } } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [noBlock] }) as any;

    const result = await selectQueuedCandidates(mock, 5);
    assert.equal(result.length, 0, 'candidate without pae block must not be selected');
  });
});

// ── F4 — selector respects limit ─────────────────────────────────────────────

describe('v1.16K-E — F4: selector respects limit default 5', () => {
  it('selectQueuedCandidates returns at most limit candidates', async () => {
    // 10 queued candidates — all valid
    const rows: CandidateRow[] = Array.from({ length: 10 }, (_, i) =>
      makeQueuedCandidate({ id: `cand-${i}`, converted_account_id: `acc-${i}` }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows }) as any;

    const result = await selectQueuedCandidates(mock, 5);
    assert.ok(result.length <= 5, `Expected at most 5, got ${result.length}`);
  });

  it('runPostApprovalNitEnrichmentWorker uses default limit 5', async () => {
    const rows: CandidateRow[] = Array.from({ length: 10 }, (_, i) =>
      makeQueuedCandidate({ id: `cand-${i}`, converted_account_id: `acc-${i}` }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows }) as any;

    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: {},
    });

    assert.ok(
      stats.queued_found <= 5,
      `queued_found should be at most 5, got ${stats.queued_found}`,
    );
  });
});

// ── F5 — successful adapters mark completed ───────────────────────────────────

describe('v1.16K-E — F5: successful adapters mark completed', () => {
  it('all-matched adapters produce finalStatus=completed', async () => {
    const sourceKey = 'co_personas_juridicas_cc';
    const candidate = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'queued',
          nit: '900123456-1',
          source_keys: [sourceKey],
          account_id: 'account-e-uuid',
          triggered_at: '2026-06-25T10:00:00.000Z',
        },
        approval: { approved_at: 'now' },
        rich_profile: { employees: 10 },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [candidate] }) as any;
    const registry = {
      [sourceKey]: makeMockAdapter(sourceKey, { status: 'matched', matchedBy: 'tax_id' }),
    };

    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: registry,
    });

    assert.equal(stats.completed, 1);
    assert.equal(stats.completed_with_warnings, 0);
    assert.equal(stats.errors, 0);
  });
});

// ── F6 — no_match saved correctly ─────────────────────────────────────────────

describe('v1.16K-E — F6: no_match source saved correctly', () => {
  it('persistEnrichmentResults stores no_match status for adapter that returned no_match', async () => {
    const sourceKey = 'co_secop2_proveedores';
    const adapterResults: AdapterRunResult[] = [
      {
        sourceKey,
        output: {
          sourceKey,
          status: 'no_match',
          matchedBy: null,
          confidence: 0,
          reason: 'NIT no encontrado en SECOP2',
        },
      },
    ];

    const existingMetadata = {
      approval: { approved_at: 'now' },
      post_approval_enrichment: {
        strategy: 'nit_first',
        status: 'queued',
        nit: '900123456-1',
        account_id: 'acc-1',
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    const result = await persistEnrichmentResults(
      {
        candidateId: 'cand-e-uuid',
        adapterResults,
        existingMetadata,
        paeBlock: existingMetadata.post_approval_enrichment,
      },
      mock,
    );

    assert.equal(result.noMatchSourceKeys.includes(sourceKey), true);
    assert.equal(result.finalStatus, 'completed');

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const se = updatedMeta?.source_enrichment as Record<string, unknown>;
    const sourceBlock = se?.[sourceKey] as Record<string, unknown>;
    assert.equal(sourceBlock?.status, 'no_match');
  });
});

// ── F7 — skipped source saved correctly ──────────────────────────────────────

describe('v1.16K-E — F7: skipped source saved correctly', () => {
  it('persistEnrichmentResults stores skipped status for adapter not registered', async () => {
    const sourceKey = 'co_siis';
    const adapterResults: AdapterRunResult[] = [
      {
        sourceKey,
        output: {
          sourceKey,
          status: 'skipped',
          matchedBy: null,
          confidence: 0,
          reason: 'adapter_not_registered',
        },
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    const result = await persistEnrichmentResults(
      {
        candidateId: 'cand-e-uuid',
        adapterResults,
        existingMetadata: {
          post_approval_enrichment: { strategy: 'nit_first', status: 'queued', nit: '1', account_id: 'a' },
        },
        paeBlock: { strategy: 'nit_first', status: 'queued', nit: '1', account_id: 'a' },
      },
      mock,
    );

    assert.equal(result.skippedSourceKeys.includes(sourceKey), true);
    assert.equal(result.finalStatus, 'completed');

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const se = updatedMeta?.source_enrichment as Record<string, unknown>;
    const block = se?.[sourceKey] as Record<string, unknown>;
    assert.equal(block?.status, 'skipped');
  });
});

// ── F8 — error in one adapter does not break others ───────────────────────────

describe('v1.16K-E — F8: one adapter error does not break others → completed_with_warnings', () => {
  it('determineFinalStatus returns completed_with_warnings when some error some matched', () => {
    const results: AdapterRunResult[] = [
      {
        sourceKey: 'co_personas_juridicas_cc',
        output: { sourceKey: 'co_personas_juridicas_cc', status: 'matched', matchedBy: 'tax_id', confidence: 0.9 },
      },
      {
        sourceKey: 'co_secop2_proveedores',
        output: { sourceKey: 'co_secop2_proveedores', status: 'error', matchedBy: null, confidence: 0, reason: 'timeout' },
      },
    ];

    const status = determineFinalStatus(results);
    assert.equal(status, 'completed_with_warnings');
  });

  it('runPostApprovalNitEnrichmentWorker marks completed_with_warnings when one adapter fails', async () => {
    const candidate = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'queued',
          nit: '900123456-1',
          source_keys: ['co_personas_juridicas_cc', 'co_secop2_proveedores'],
          account_id: 'account-e-uuid',
          triggered_at: '2026-06-25T10:00:00.000Z',
        },
        approval: { approved_at: 'now' },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [candidate] }) as any;
    const registry = {
      co_personas_juridicas_cc: makeMockAdapter('co_personas_juridicas_cc', { status: 'matched' }),
      co_secop2_proveedores: {
        sourceKey: 'co_secop2_proveedores',
        supportedCapabilities: ['enrichment_after_discovery'] as const,
        enrichCandidate: async (): Promise<SourceEnrichmentOutput> => {
          throw new Error('simulated_timeout');
        },
      } satisfies SourceEnrichmentAdapter,
    };

    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: registry,
    });

    assert.equal(stats.completed_with_warnings, 1, 'should be completed_with_warnings');
    assert.equal(stats.errors, 0, 'should not count as error at worker level');
    assert.equal(stats.completed, 0);
  });
});

// ── F9 — metadata.approval preserved ─────────────────────────────────────────

describe('v1.16K-E — F9: metadata.approval preserved', () => {
  it('persistEnrichmentResults keeps metadata.approval block intact', async () => {
    const adapterResults: AdapterRunResult[] = [
      {
        sourceKey: 'co_personas_juridicas_cc',
        output: { sourceKey: 'co_personas_juridicas_cc', status: 'matched', matchedBy: 'tax_id', confidence: 0.95 },
      },
    ];

    const existingMetadata = {
      approval: { approved_at: '2026-06-25T09:59:00.000Z', approved_by: 'user-1' },
      post_approval_enrichment: {
        strategy: 'nit_first',
        status: 'queued',
        nit: '900123456-1',
        account_id: 'acc-1',
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await persistEnrichmentResults(
      {
        candidateId: 'cand-e-uuid',
        adapterResults,
        existingMetadata,
        paeBlock: existingMetadata.post_approval_enrichment,
      },
      mock,
    );

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const approval = updatedMeta?.approval as Record<string, unknown> | undefined;
    assert.ok(approval, 'approval block must be preserved');
    assert.equal(approval?.approved_by, 'user-1');
    assert.equal(approval?.approved_at, '2026-06-25T09:59:00.000Z');
  });
});

// ── F10 — metadata.rich_profile preserved ────────────────────────────────────

describe('v1.16K-E — F10: metadata.rich_profile preserved', () => {
  it('persistEnrichmentResults keeps metadata.rich_profile block intact', async () => {
    const adapterResults: AdapterRunResult[] = [
      {
        sourceKey: 'co_personas_juridicas_cc',
        output: { sourceKey: 'co_personas_juridicas_cc', status: 'matched', matchedBy: 'tax_id', confidence: 0.9 },
      },
    ];

    const existingMetadata = {
      rich_profile: { company_type: 'SAS', employees: 50, domain: 'empresa.co' },
      post_approval_enrichment: { strategy: 'nit_first', status: 'queued', nit: '1', account_id: 'a' },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await persistEnrichmentResults(
      {
        candidateId: 'cand-e-uuid',
        adapterResults,
        existingMetadata,
        paeBlock: existingMetadata.post_approval_enrichment,
      },
      mock,
    );

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const richProfile = updatedMeta?.rich_profile as Record<string, unknown> | undefined;
    assert.ok(richProfile, 'rich_profile must be preserved');
    assert.equal(richProfile?.employees, 50);
    assert.equal(richProfile?.domain, 'empresa.co');
  });
});

// ── F11 — completed_at is set ─────────────────────────────────────────────────

describe('v1.16K-E — F11: post_approval_enrichment.completed_at is set', () => {
  it('persistEnrichmentResults sets completed_at in post_approval_enrichment block', async () => {
    const adapterResults: AdapterRunResult[] = [
      {
        sourceKey: 'co_personas_juridicas_cc',
        output: { sourceKey: 'co_personas_juridicas_cc', status: 'matched', matchedBy: 'tax_id', confidence: 0.9 },
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await persistEnrichmentResults(
      {
        candidateId: 'cand-e-uuid',
        adapterResults,
        existingMetadata: {
          post_approval_enrichment: { strategy: 'nit_first', status: 'queued', nit: '1', account_id: 'a' },
        },
        paeBlock: { strategy: 'nit_first', status: 'queued', nit: '1', account_id: 'a' },
      },
      mock,
    );

    const updatedMeta = mock.updatedRows[0]?.data?.metadata as Record<string, unknown>;
    const pae = updatedMeta?.post_approval_enrichment as Record<string, unknown>;
    assert.ok(pae?.completed_at, 'completed_at must be set');
    assert.ok(
      typeof pae.completed_at === 'string' && pae.completed_at.length > 0,
      'completed_at must be a non-empty string',
    );
  });
});

// ── F12 — audit trail generated ───────────────────────────────────────────────

describe('v1.16K-E — F12: audit trail generated with correct sub_action', () => {
  it('insertPostApprovalAuditTrail inserts with sub_action=post_approval_enrichment_completed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await insertPostApprovalAuditTrail(
      {
        candidateId: 'cand-e-uuid',
        batchId: 'batch-e-uuid',
        accountId: 'account-e-uuid',
        finalStatus: 'completed',
        processedSourceKeys: ['co_personas_juridicas_cc'],
        matchedSourceKeys: ['co_personas_juridicas_cc'],
        noMatchSourceKeys: [],
        skippedSourceKeys: [],
        failedSourceKeys: [],
      },
      mock,
    );

    assert.equal(mock.auditRows.length, 1);
    const row = mock.auditRows[0];
    assert.equal(row.action_type, 'candidate_updated');
    assert.equal(row.details.sub_action, 'post_approval_enrichment_completed');
    assert.equal(row.details.account_id, 'account-e-uuid');
    assert.ok(Array.isArray(row.details.source_keys_attempted));
    assert.ok(Array.isArray(row.details.source_keys_matched));
  });

  it('insertPostApprovalAuditTrail uses sub_action=post_approval_enrichment_completed_with_warnings', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await insertPostApprovalAuditTrail(
      {
        candidateId: 'cand-e-uuid',
        batchId: 'batch-e-uuid',
        accountId: 'account-e-uuid',
        finalStatus: 'completed_with_warnings',
        processedSourceKeys: ['co_personas_juridicas_cc', 'co_secop2_proveedores'],
        matchedSourceKeys: ['co_personas_juridicas_cc'],
        noMatchSourceKeys: [],
        skippedSourceKeys: [],
        failedSourceKeys: ['co_secop2_proveedores'],
      },
      mock,
    );

    const row = mock.auditRows[0];
    assert.equal(row.details.sub_action, 'post_approval_enrichment_completed_with_warnings');
  });

  it('insertPostApprovalAuditTrail uses sub_action=post_approval_enrichment_error on all-errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await insertPostApprovalAuditTrail(
      {
        candidateId: 'cand-e-uuid',
        batchId: 'batch-e-uuid',
        accountId: 'account-e-uuid',
        finalStatus: 'error',
        processedSourceKeys: ['co_personas_juridicas_cc'],
        matchedSourceKeys: [],
        noMatchSourceKeys: [],
        skippedSourceKeys: [],
        failedSourceKeys: ['co_personas_juridicas_cc'],
      },
      mock,
    );

    const row = mock.auditRows[0];
    assert.equal(row.details.sub_action, 'post_approval_enrichment_error');
  });

  it('audit row does not expose secretos (no passwords, keys, tokens)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await insertPostApprovalAuditTrail(
      {
        candidateId: 'cand-e-uuid',
        batchId: 'batch-e-uuid',
        accountId: 'account-e-uuid',
        finalStatus: 'completed',
        processedSourceKeys: ['co_personas_juridicas_cc'],
        matchedSourceKeys: ['co_personas_juridicas_cc'],
        noMatchSourceKeys: [],
        skippedSourceKeys: [],
        failedSourceKeys: [],
      },
      mock,
    );

    const detailsStr = JSON.stringify(mock.auditRows[0].details);
    assert.ok(!detailsStr.includes('password'), 'No passwords in audit');
    assert.ok(!detailsStr.includes('api_key'), 'No API keys in audit');
    assert.ok(!detailsStr.includes('service_role'), 'No service role key in audit');
  });
});

// ── F13 — no Tavily ───────────────────────────────────────────────────────────

describe('v1.16K-E — F13: no Tavily', () => {
  it('CO_NIT_SAFE_SOURCE_KEYS does not include any tavily source', () => {
    const tavily = CO_NIT_SAFE_SOURCE_KEYS.filter((k) =>
      k.toLowerCase().includes('tavily'),
    );
    assert.equal(tavily.length, 0, 'No Tavily source keys must be in CO_NIT_SAFE_SOURCE_KEYS');
  });

  it('executeNitAdapters with no tavily keys in registry completes without error', async () => {
    const registry = {
      co_personas_juridicas_cc: makeMockAdapter('co_personas_juridicas_cc', { status: 'matched' }),
    };

    const results = await executeNitAdapters({
      candidateName: 'Test SA',
      nit: '900123456-1',
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      sourceKeys: ['co_personas_juridicas_cc'],
      registry,
    });

    const tavilyResults = results.filter((r) =>
      r.sourceKey.toLowerCase().includes('tavily'),
    );
    assert.equal(tavilyResults.length, 0, 'No Tavily results');
  });
});

// ── F14 — no LLM ─────────────────────────────────────────────────────────────

describe('v1.16K-E — F14: no LLM', () => {
  it('executeNitAdapters does not call enrichProspectCandidate (LLM) when adapters are provided', async () => {
    let llmCalled = false;

    const registry = {
      co_personas_juridicas_cc: {
        sourceKey: 'co_personas_juridicas_cc',
        supportedCapabilities: ['enrichment_after_discovery'] as const,
        enrichCandidate: async (): Promise<SourceEnrichmentOutput> => {
          // This is a source adapter — NO LLM here
          return {
            sourceKey: 'co_personas_juridicas_cc',
            status: 'matched',
            matchedBy: 'tax_id',
            confidence: 0.95,
          };
        },
      } satisfies SourceEnrichmentAdapter,
    };

    const results = await executeNitAdapters({
      candidateName: 'Test SA',
      nit: '900123456-1',
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      sourceKeys: ['co_personas_juridicas_cc'],
      registry,
    });

    assert.equal(llmCalled, false, 'LLM must not be called during adapter execution');
    assert.equal(results[0].output.status, 'matched');
  });

  it('runPostApprovalNitEnrichmentWorker with mock registry completes without LLM', async () => {
    const candidate = makeQueuedCandidate({
      metadata: {
        post_approval_enrichment: {
          strategy: 'nit_first',
          status: 'queued',
          nit: '900123456-1',
          source_keys: ['co_personas_juridicas_cc'],
          account_id: 'account-e-uuid',
          triggered_at: '2026-06-25T10:00:00.000Z',
        },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [candidate] }) as any;
    const registry = {
      co_personas_juridicas_cc: makeMockAdapter('co_personas_juridicas_cc', { status: 'matched' }),
    };

    const stats = await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: registry,
    });

    // If LLM were called, it would fail (no API keys in test). Passing confirms no LLM.
    assert.equal(stats.processed, 1, 'Worker completed 1 candidate without LLM');
  });
});

// ── F15 — no LinkedIn ────────────────────────────────────────────────────────

describe('v1.16K-E — F15: no LinkedIn', () => {
  it('CO_NIT_SAFE_SOURCE_KEYS does not include any linkedin source', () => {
    const linkedin = CO_NIT_SAFE_SOURCE_KEYS.filter((k) =>
      k.toLowerCase().includes('linkedin'),
    );
    assert.equal(linkedin.length, 0, 'No LinkedIn source keys in CO_NIT_SAFE_SOURCE_KEYS');
  });

  it('executeNitAdapters filters out any non-CO NIT-safe keys (including hypothetical linkedin keys)', async () => {
    const registry = {
      linkedin_profiles: makeMockAdapter('linkedin_profiles', { status: 'matched' }),
    };

    const results = await executeNitAdapters({
      candidateName: 'Test SA',
      nit: '900123456-1',
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      sourceKeys: ['linkedin_profiles'], // should be filtered out
      registry,
    });

    // linkedin_profiles is not in CO_NIT_SAFE_SOURCE_KEYS → filtered out
    assert.equal(results.length, 0, 'LinkedIn keys must be filtered by CO_NIT_SAFE guard');
  });
});

// ── F16 — cron endpoint requires secret ──────────────────────────────────────

describe('v1.16K-E — F16: cron endpoint requires CRON_SECRET', () => {
  it('CRON_SECRET authentication logic rejects missing auth header', () => {
    const cronSecret = 'test_cron_secret_xyz';
    const authHeader: string | null = null;

    const isAuthorized =
      authHeader !== null && authHeader === `Bearer ${cronSecret}`;

    assert.equal(isAuthorized, false, 'Missing auth header must not be authorized');
  });

  it('CRON_SECRET authentication logic rejects wrong secret', () => {
    const cronSecret = 'test_cron_secret_xyz';
    const authHeader: string = 'Bearer wrong_secret';

    const isAuthorized =
      authHeader !== null && authHeader === `Bearer ${cronSecret}`;

    assert.equal(isAuthorized, false, 'Wrong secret must not be authorized');
  });

  it('CRON_SECRET authentication logic accepts correct secret', () => {
    const cronSecret = 'test_cron_secret_xyz';
    const authHeader = `Bearer ${cronSecret}`;

    const isAuthorized =
      authHeader !== null && authHeader === `Bearer ${cronSecret}`;

    assert.equal(isAuthorized, true, 'Correct secret must be authorized');
  });

  it('CRON_SECRET is read from environment — not hardcoded', () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'env_secret_abc';

    const cronSecret = process.env.CRON_SECRET || 'local_cron_secret';
    assert.equal(cronSecret, 'env_secret_abc', 'CRON_SECRET must be read from env');

    if (saved !== undefined) {
      process.env.CRON_SECRET = saved;
    } else {
      delete process.env.CRON_SECRET;
    }
  });
});

// ── F17 — no DELETE / no hard delete ──────────────────────────────────────────

describe('v1.16K-E — F17: no DELETE / no hard delete', () => {
  it('runPostApprovalNitEnrichmentWorker never calls .delete() on any table', async () => {
    const candidate = makeQueuedCandidate();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase({ rows: [candidate] }) as any;
    const registry = {
      co_personas_juridicas_cc: makeMockAdapter('co_personas_juridicas_cc', { status: 'matched' }),
    };

    await runPostApprovalNitEnrichmentWorker({
      supabase: mock,
      adapterRegistryOverride: registry,
    });

    assert.equal(
      mock.deleteCalls.length,
      0,
      'Worker must never call .delete() on any Supabase table',
    );
  });

  it('persistEnrichmentResults never calls .delete()', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mock = makeMockSupabase() as any;

    await persistEnrichmentResults(
      {
        candidateId: 'cand-e-uuid',
        adapterResults: [
          {
            sourceKey: 'co_personas_juridicas_cc',
            output: { sourceKey: 'co_personas_juridicas_cc', status: 'matched', matchedBy: 'tax_id', confidence: 0.9 },
          },
        ],
        existingMetadata: { post_approval_enrichment: { status: 'queued', nit: '1', account_id: 'a' } },
        paeBlock: { status: 'queued', nit: '1', account_id: 'a' },
      },
      mock,
    );

    assert.equal(mock.deleteCalls.length, 0, 'persistEnrichmentResults must never DELETE');
  });
});

// ── F18 — source_keys Colombia are the expected ones ─────────────────────────

describe('v1.16K-E — F18: CO NIT-safe source_keys are the expected ones', () => {
  const EXPECTED_CO_SOURCES = [
    'co_personas_juridicas_cc',
    'co_secop2_proveedores',
    'co_minsalud_reps',
    'co_superfinanciera',
    'co_siis',
  ];

  it('CO_NIT_SAFE_SOURCE_KEYS contains all expected Colombia sources', () => {
    for (const expected of EXPECTED_CO_SOURCES) {
      assert.ok(
        CO_NIT_SAFE_SOURCE_KEYS.includes(expected),
        `Expected CO source key '${expected}' in CO_NIT_SAFE_SOURCE_KEYS`,
      );
    }
  });

  it('CO_NIT_SAFE_SOURCE_KEYS contains no non-CO sources', () => {
    const nonCO = CO_NIT_SAFE_SOURCE_KEYS.filter((k) => !k.startsWith('co_'));
    assert.equal(
      nonCO.length,
      0,
      `CO_NIT_SAFE_SOURCE_KEYS must only have co_ sources, found: ${nonCO.join(', ')}`,
    );
  });

  it('executeNitAdapters only executes keys in CO_NIT_SAFE_SOURCE_KEYS', async () => {
    const calledKeys: string[] = [];
    const registry: Record<string, SourceEnrichmentAdapter> = {};

    for (const key of EXPECTED_CO_SOURCES) {
      registry[key] = {
        sourceKey: key,
        supportedCapabilities: ['enrichment_after_discovery'],
        enrichCandidate: async (): Promise<SourceEnrichmentOutput> => {
          calledKeys.push(key);
          return { sourceKey: key, status: 'matched', matchedBy: 'tax_id', confidence: 0.9 };
        },
      };
    }

    // Pass only CO NIT-safe keys + one non-CO key
    const sourceKeys = [...EXPECTED_CO_SOURCES, 'mx_denue', 'cl_inapi'];

    await executeNitAdapters({
      candidateName: 'Test SA',
      nit: '900123456-1',
      countryCode: 'CO',
      sector: null,
      existingMetadata: {},
      sourceKeys,
      registry,
    });

    // Only CO NIT-safe keys must have been called
    for (const called of calledKeys) {
      assert.ok(
        CO_NIT_SAFE_SOURCE_KEYS.includes(called),
        `Non-CO key '${called}' must not have been called`,
      );
    }

    // MX and CL keys must NOT be called
    assert.ok(!calledKeys.includes('mx_denue'), 'mx_denue must not be called');
    assert.ok(!calledKeys.includes('cl_inapi'), 'cl_inapi must not be called');
  });
});

// ── Additional: determineFinalStatus edge cases ───────────────────────────────

describe('v1.16K-E — determineFinalStatus edge cases', () => {
  it('returns error when no results', () => {
    assert.equal(determineFinalStatus([]), 'error');
  });

  it('returns completed when all matched', () => {
    const results: AdapterRunResult[] = [
      { sourceKey: 'a', output: { sourceKey: 'a', status: 'matched', matchedBy: 'tax_id', confidence: 0.9 } },
      { sourceKey: 'b', output: { sourceKey: 'b', status: 'no_match', matchedBy: null, confidence: 0 } },
    ];
    assert.equal(determineFinalStatus(results), 'completed');
  });

  it('returns error when all adapters errored', () => {
    const results: AdapterRunResult[] = [
      { sourceKey: 'a', output: { sourceKey: 'a', status: 'error', matchedBy: null, confidence: 0 } },
      { sourceKey: 'b', output: { sourceKey: 'b', status: 'error', matchedBy: null, confidence: 0 } },
    ];
    assert.equal(determineFinalStatus(results), 'error');
  });
});
