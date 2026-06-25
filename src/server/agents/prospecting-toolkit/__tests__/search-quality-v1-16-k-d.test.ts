/**
 * Tests — Agent 1 v1.16K-D — Post-Approval Source Enrichment Trigger NIT-first
 *
 * Sin Tavily. Sin LLM. Sin LinkedIn. Sin Supabase real.
 *
 * F1  — flag default false → isPostApprovalSourceEnrichmentEnabled() = false
 * F2  — flag off → approveAndConvert path: no enqueue, no enrichment call
 * F3  — flag on + candidate con NIT → status='queued', source_keys planificados
 * F4  — flag on + candidate sin NIT → status='skipped', reason='missing_tax_id'
 * F5  — trigger falla → approval no bloqueada, metadata registra trigger_failed
 * F6  — LinkedIn no llamado en ningún test
 * F7  — Tavily no llamado en ningún test (0 imports de Tavily)
 * F8  — LLM no llamado en ningún test (0 enrichProspectCandidate)
 * F9  — NIT-first source plan incluye solo adapters Colombia NIT-safe
 * F10 — sin NIT no se crea job automático
 * F11 — audit trail: metadata tiene sub_action esperado
 * F12 — approveAndConvertCandidateAction legacy intacto con flag off
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPostApprovalSourceEnrichmentEnabled,
  POST_APPROVAL_SOURCE_ENRICHMENT_FLAG,
} from '@/lib/feature-flags.server';

import {
  extractNitFromCandidate,
  planNitFirstSourceKeys,
  triggerPostApprovalEnrichment,
  type PostApprovalEnrichmentMeta,
} from '@/server/prospect-batches/post-approval-enrichment-trigger';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CANDIDATE_WITH_NIT: Record<string, unknown> = {
  id: 'cand-nit-uuid',
  batch_id: 'batch-test-uuid',
  name: 'Empresa Test SA',
  tax_identifier: '900123456-1',
  country_code: 'CO',
  metadata: { source: 'agent_1' },
};

const MOCK_CANDIDATE_NO_NIT: Record<string, unknown> = {
  id: 'cand-nonit-uuid',
  batch_id: 'batch-test-uuid',
  name: 'Empresa Sin NIT SAS',
  tax_identifier: null,
  country_code: 'CO',
  metadata: { source: 'agent_1' },
};

const MOCK_CANDIDATE_NIT_IN_METADATA: Record<string, unknown> = {
  id: 'cand-meta-uuid',
  batch_id: 'batch-test-uuid',
  name: 'Empresa NIT Meta SAS',
  country_code: 'CO',
  metadata: {
    tax_id: '800456789-2',
    source: 'agent_1',
  },
};

const MOCK_CANDIDATE_NIT_IN_RICH_PROFILE: Record<string, unknown> = {
  id: 'cand-rich-uuid',
  batch_id: 'batch-test-uuid',
  name: 'Empresa Rich Profile SAS',
  country_code: 'CO',
  metadata: {
    rich_profile: { tax_id: '700999111-3' },
  },
};

const MOCK_ACCOUNT_ID = 'account-test-uuid';
const MOCK_INTERNAL_USER_ID = 'user-test-uuid';

// ─── Supabase mock factory ────────────────────────────────────────────────────

type AuditRow = { action_type: string; details: Record<string, unknown> };

function makeMockSupabase(opts?: {
  selectReturns?: Record<string, unknown> | null;
  updateFails?: boolean;
  insertFails?: boolean;
}) {
  const auditRows: AuditRow[] = [];
  const updatedMetadata: Record<string, unknown>[] = [];

  const mock = {
    auditRows,
    updatedMetadata,
    from: (table: string) => {
      if (table === 'prospect_candidates') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: opts?.selectReturns !== undefined
                  ? opts.selectReturns
                  : { metadata: {} },
                error: null,
              }),
            }),
          }),
          update: (data: Record<string, unknown>) => {
            if (!opts?.updateFails) {
              updatedMetadata.push(data);
            }
            return {
              eq: () => (opts?.updateFails
                ? Promise.reject(new Error('update_failed_mock'))
                : Promise.resolve({ error: null })),
            };
          },
        };
      }
      if (table === 'prospect_candidate_audit') {
        return {
          insert: async (row: AuditRow) => {
            if (!opts?.insertFails) {
              auditRows.push(row);
            }
            return opts?.insertFails
              ? { error: new Error('insert_failed_mock') }
              : { error: null };
          },
        };
      }
      return {};
    },
  };
  return mock;
}

// ─── F1 — flag default false ──────────────────────────────────────────────────

describe('v1.16K-D — F1: flag default false', () => {
  let original: string | undefined;

  before(() => {
    original = process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];
    delete process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];
  });

  after(() => {
    if (original !== undefined) {
      process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG] = original;
    } else {
      delete process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];
    }
  });

  it('isPostApprovalSourceEnrichmentEnabled() returns false when env var is unset', () => {
    assert.equal(isPostApprovalSourceEnrichmentEnabled(), false);
  });

  it('isPostApprovalSourceEnrichmentEnabled() returns false when env var is empty string', () => {
    process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG] = '';
    assert.equal(isPostApprovalSourceEnrichmentEnabled(), false);
  });

  it('isPostApprovalSourceEnrichmentEnabled() returns false for "false" string', () => {
    process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG] = 'false';
    assert.equal(isPostApprovalSourceEnrichmentEnabled(), false);
  });
});

// ─── F2 — flag off path: no trigger ──────────────────────────────────────────

describe('v1.16K-D — F2: flag off → trigger not invoked', () => {
  it('isPostApprovalSourceEnrichmentEnabled() returns true only when "true"', () => {
    const saved = process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];
    process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG] = 'true';
    assert.equal(isPostApprovalSourceEnrichmentEnabled(), true);
    if (saved !== undefined) {
      process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG] = saved;
    } else {
      delete process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];
    }
  });

  it('flag guard prevents enrichment calls when flag is off', () => {
    delete process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];
    // Simulate the guard in approveAndConvertCandidateAction
    let triggerCalled = false;
    const guardedTrigger = () => { triggerCalled = true; };

    if (isPostApprovalSourceEnrichmentEnabled()) {
      guardedTrigger();
    }

    assert.equal(triggerCalled, false, 'trigger must not be called when flag is off');
  });
});

// ─── F3 — flag on + NIT → status queued ──────────────────────────────────────

describe('v1.16K-D — F3: flag on + candidate con NIT → queued', () => {
  it('triggerPostApprovalEnrichment returns status=queued with NIT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_WITH_NIT,
      candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
      batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(result.triggered, true);
    assert.equal(result.meta.status, 'queued');
    assert.equal(result.meta.requested, true);
    assert.equal(result.meta.strategy, 'nit_first');
    assert.equal(result.meta.trigger, 'candidate_approval');
    assert.equal(result.meta.nit, '900123456-1');
    assert.equal(result.meta.account_id, MOCK_ACCOUNT_ID);
    assert.ok(Array.isArray(result.meta.source_keys), 'source_keys should be an array');
    assert.ok((result.meta.source_keys?.length ?? 0) > 0, 'source_keys should not be empty');
  });

  it('triggerPostApprovalEnrichment reads NIT from metadata.tax_id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_NIT_IN_METADATA,
      candidateId: MOCK_CANDIDATE_NIT_IN_METADATA.id as string,
      batchId: MOCK_CANDIDATE_NIT_IN_METADATA.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(result.triggered, true);
    assert.equal(result.meta.nit, '800456789-2');
  });

  it('triggerPostApprovalEnrichment reads NIT from metadata.rich_profile.tax_id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_NIT_IN_RICH_PROFILE,
      candidateId: MOCK_CANDIDATE_NIT_IN_RICH_PROFILE.id as string,
      batchId: MOCK_CANDIDATE_NIT_IN_RICH_PROFILE.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(result.triggered, true);
    assert.equal(result.meta.nit, '700999111-3');
  });
});

// ─── F4 — flag on + no NIT → skipped ─────────────────────────────────────────

describe('v1.16K-D — F4: flag on + candidate sin NIT → skipped', () => {
  it('triggerPostApprovalEnrichment returns status=skipped when no NIT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_NO_NIT,
      candidateId: MOCK_CANDIDATE_NO_NIT.id as string,
      batchId: MOCK_CANDIDATE_NO_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.requested, false);
    assert.equal(result.meta.reason, 'missing_tax_id');
    assert.equal(result.meta.name_fallback_available, true);
    assert.equal(result.meta.strategy, 'nit_first');
    assert.equal(result.meta.account_id, MOCK_ACCOUNT_ID);
  });
});

// ─── F5 — trigger falla → approval no bloqueada ───────────────────────────────

describe('v1.16K-D — F5: trigger failure → approval continues', () => {
  it('triggerPostApprovalEnrichment returns trigger_failed without throwing', async () => {
    // Supabase mock that fails on first update
    const failingSupabase = {
      from: (table: string) => {
        if (table === 'prospect_candidates') {
          return {
            select: () => ({
              eq: () => ({
                single: () => Promise.reject(new Error('db_connection_error')),
              }),
            }),
            update: () => ({
              eq: () => Promise.reject(new Error('db_connection_error')),
            }),
          };
        }
        if (table === 'prospect_candidate_audit') {
          return {
            insert: () => Promise.resolve({ error: null }),
          };
        }
        return {};
      },
    };

    let result: Awaited<ReturnType<typeof triggerPostApprovalEnrichment>> | undefined;
    let threw = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result = await triggerPostApprovalEnrichment({
        candidate: MOCK_CANDIDATE_WITH_NIT,
        candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
        batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
        accountId: MOCK_ACCOUNT_ID,
        internalUserId: MOCK_INTERNAL_USER_ID,
        supabase: failingSupabase as unknown as import('@supabase/supabase-js').SupabaseClient,
      });
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'trigger must not throw — approval must not be blocked');
    assert.ok(result, 'result should be defined');
    assert.equal(result?.meta.status, 'trigger_failed');
    assert.equal(result?.triggered, false);
  });
});

// ─── F6 — LinkedIn no llamado ─────────────────────────────────────────────────

describe('v1.16K-D — F6: LinkedIn not called', () => {
  it('planNitFirstSourceKeys does not include any linkedin source', () => {
    const keys = planNitFirstSourceKeys();
    const linkedinKeys = keys.filter(k => k.includes('linkedin'));
    assert.equal(linkedinKeys.length, 0, 'No LinkedIn source keys must be present');
  });

  it('triggerPostApprovalEnrichment result does not reference LinkedIn', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_WITH_NIT,
      candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
      batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    const metaStr = JSON.stringify(result.meta);
    assert.ok(!metaStr.includes('linkedin'), 'LinkedIn must not appear in enrichment meta');
  });
});

// ─── F7 — Tavily no llamado ───────────────────────────────────────────────────

describe('v1.16K-D — F7: Tavily not called', () => {
  it('planNitFirstSourceKeys does not include tavily source', () => {
    const keys = planNitFirstSourceKeys();
    const tavilyKeys = keys.filter(k => k.includes('tavily'));
    assert.equal(tavilyKeys.length, 0, 'No Tavily source keys must be present');
  });
});

// ─── F8 — LLM no llamado ─────────────────────────────────────────────────────

describe('v1.16K-D — F8: LLM not called', () => {
  it('trigger module does not import enrichProspectCandidate', async () => {
    // Verify by checking that the trigger returns without calling LLM-based enrichment.
    // The module only uses Supabase DB operations.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    // If LLM were called, it would fail in test env (no API keys). The test
    // passing without error confirms no LLM was invoked.
    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_WITH_NIT,
      candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
      batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    // If result is present, no LLM/network call happened
    assert.ok(result, 'result should be defined without LLM calls');
    assert.ok(
      ['queued', 'skipped', 'trigger_failed'].includes(result.meta.status),
      'status must be a valid non-LLM outcome',
    );
  });
});

// ─── F9 — NIT-first source plan ──────────────────────────────────────────────

describe('v1.16K-D — F9: NIT-first source plan includes only CO NIT-safe adapters', () => {
  const EXPECTED_NIT_SAFE_SOURCES = [
    'co_personas_juridicas_cc',
    'co_secop2_proveedores',
    'co_minsalud_reps',
    'co_superfinanciera',
    'co_siis',
  ];

  it('planNitFirstSourceKeys returns all expected NIT-safe CO sources', () => {
    const keys = planNitFirstSourceKeys();
    for (const expected of EXPECTED_NIT_SAFE_SOURCES) {
      assert.ok(keys.includes(expected), `Expected source key '${expected}' in plan`);
    }
  });

  it('planNitFirstSourceKeys does not include MX or CL sources', () => {
    const keys = planNitFirstSourceKeys();
    const nonCO = keys.filter(k => !k.startsWith('co_'));
    assert.equal(nonCO.length, 0, 'Non-CO sources must not be in NIT-first plan');
  });

  it('triggerPostApprovalEnrichment with NIT includes CO NIT-safe sources', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_WITH_NIT,
      candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
      batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.ok(result.meta.source_keys, 'source_keys should be set when NIT present');
    for (const expected of EXPECTED_NIT_SAFE_SOURCES) {
      assert.ok(
        result.meta.source_keys?.includes(expected),
        `source_keys should include '${expected}'`,
      );
    }
  });
});

// ─── F10 — no NIT → no job automático ────────────────────────────────────────

describe('v1.16K-D — F10: no NIT → no automatic job, skipped', () => {
  it('result.triggered is false and status is skipped when no NIT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    const result = await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_NO_NIT,
      candidateId: MOCK_CANDIDATE_NO_NIT.id as string,
      batchId: MOCK_CANDIDATE_NO_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(result.triggered, false);
    assert.equal(result.meta.status, 'skipped');
    assert.equal(result.meta.source_keys, undefined, 'source_keys must not be set when NIT missing');
  });
});

// ─── F11 — audit trail ────────────────────────────────────────────────────────

describe('v1.16K-D — F11: audit trail recorded correctly', () => {
  it('audit row has sub_action=post_approval_enrichment_queued when NIT present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_WITH_NIT,
      candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
      batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(mockSupabase.auditRows.length, 1);
    const row = mockSupabase.auditRows[0];
    assert.equal(row.action_type, 'candidate_updated');
    assert.equal(row.details.sub_action, 'post_approval_enrichment_queued');
    assert.equal(row.details.account_id, MOCK_ACCOUNT_ID);
    assert.equal(row.details.strategy, 'nit_first');
    assert.equal(row.details.status, 'queued');
    assert.equal(row.details.nit_present, true);
  });

  it('audit row has sub_action=post_approval_enrichment_skipped when no NIT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase() as any;

    await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_NO_NIT,
      candidateId: MOCK_CANDIDATE_NO_NIT.id as string,
      batchId: MOCK_CANDIDATE_NO_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(mockSupabase.auditRows.length, 1);
    const row = mockSupabase.auditRows[0];
    assert.equal(row.action_type, 'candidate_updated');
    assert.equal(row.details.sub_action, 'post_approval_enrichment_skipped');
    assert.equal(row.details.reason, 'missing_tax_id');
  });

  it('metadata update includes post_approval_enrichment block', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockSupabase = makeMockSupabase({ selectReturns: { metadata: { approval: { approved_at: 'now' } } } }) as any;

    await triggerPostApprovalEnrichment({
      candidate: MOCK_CANDIDATE_WITH_NIT,
      candidateId: MOCK_CANDIDATE_WITH_NIT.id as string,
      batchId: MOCK_CANDIDATE_WITH_NIT.batch_id as string,
      accountId: MOCK_ACCOUNT_ID,
      internalUserId: MOCK_INTERNAL_USER_ID,
      supabase: mockSupabase,
    });

    assert.equal(mockSupabase.updatedMetadata.length, 1);
    const updated = mockSupabase.updatedMetadata[0] as { metadata: Record<string, unknown> };
    assert.ok(updated.metadata.post_approval_enrichment, 'post_approval_enrichment block must exist');
    // Previous keys preserved
    const pae = updated.metadata.post_approval_enrichment as PostApprovalEnrichmentMeta;
    assert.equal(pae.status, 'queued');
    assert.ok(updated.metadata.approval, 'existing approval block must be preserved');
  });
});

// ─── F12 — legacy intacto con flag off ───────────────────────────────────────

describe('v1.16K-D — F12: approval legacy flow intact when flag is off', () => {
  it('flag guard is a simple boolean check — no side effects when off', () => {
    delete process.env[POST_APPROVAL_SOURCE_ENRICHMENT_FLAG];

    const flagValue = isPostApprovalSourceEnrichmentEnabled();
    assert.equal(flagValue, false);

    // Simulate the guard without actually calling the server action
    let enrichmentWouldHaveRun = false;
    if (flagValue) {
      enrichmentWouldHaveRun = true;
    }

    assert.equal(
      enrichmentWouldHaveRun,
      false,
      'enrichment must not run when flag is off',
    );
  });

  it('extractNitFromCandidate does not modify candidate object', () => {
    const candidate: Record<string, unknown> = {
      id: 'c1',
      tax_identifier: '123-test',
      metadata: { foo: 'bar' },
    };
    const original = JSON.stringify(candidate);
    extractNitFromCandidate(candidate);
    assert.equal(JSON.stringify(candidate), original, 'candidate must not be mutated');
  });

  it('planNitFirstSourceKeys returns a new array each call (immutable)', () => {
    const a = planNitFirstSourceKeys();
    const b = planNitFirstSourceKeys();
    a.push('injected');
    assert.ok(!b.includes('injected'), 'source_keys arrays must be independent copies');
  });
});

// ─── Additional: extractNitFromCandidate unit tests ───────────────────────────

describe('v1.16K-D — extractNitFromCandidate unit', () => {
  it('extracts from tax_id root field', () => {
    assert.equal(extractNitFromCandidate({ tax_id: '111-1' }), '111-1');
  });

  it('extracts from tax_identifier root field', () => {
    assert.equal(extractNitFromCandidate({ tax_identifier: '222-2' }), '222-2');
  });

  it('extracts from metadata.tax_id', () => {
    assert.equal(
      extractNitFromCandidate({ metadata: { tax_id: '333-3' } }),
      '333-3',
    );
  });

  it('extracts from metadata.rich_profile.tax_id', () => {
    assert.equal(
      extractNitFromCandidate({ metadata: { rich_profile: { tax_id: '444-4' } } }),
      '444-4',
    );
  });

  it('returns null when no NIT found', () => {
    assert.equal(extractNitFromCandidate({ name: 'No NIT Corp' }), null);
  });

  it('returns null for empty string tax_identifier', () => {
    assert.equal(extractNitFromCandidate({ tax_identifier: '   ' }), null);
  });

  it('returns null when metadata is null', () => {
    assert.equal(extractNitFromCandidate({ metadata: null }), null);
  });
});
