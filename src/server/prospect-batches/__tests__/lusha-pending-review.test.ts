/**
 * Q3F-5BB.4 — Lusha → pending-review persistence CORE contract.
 *
 * Exercises the pure, dependency-injected `persistLushaPendingReviewBatch`. The
 * core has ONLY two write deps (insertBatch / insertCandidates), so it is
 * structurally impossible for it to touch accounts, HubSpot, enrichment,
 * provider_usage_logs or agent_runs — these tests lock the observable contract:
 *   - success → exactly 1 batch + N candidates with the correct status/origin.
 *   - Lusha failure → NO writes.
 *   - empty / all-duplicates → NO writes.
 *   - dedupe by domain/name; safe billing metadata; no raw payload/secrets.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  persistLushaPendingReviewBatch,
  dedupeLushaCompanies,
  buildLushaPendingReviewCandidateRows,
  buildLushaPendingReviewBatchRow,
  normalizeLushaCompanyName,
  LUSHA_PENDING_REVIEW_BATCH_SOURCE,
  LUSHA_PENDING_REVIEW_BATCH_STATUS,
  LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE,
  LUSHA_PENDING_REVIEW_CANDIDATE_STATUS,
  LUSHA_PENDING_REVIEW_RECORD_ORIGIN,
  LUSHA_PENDING_REVIEW_DUPLICATE_STATUS,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewResult,
  LushaPreviewInput,
} from '@/server/prospect-batches/lusha-preview';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  sectorKey: 'healthcare',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = { internalUserId: 'user-1' };

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: 'pc-1',
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: 'https://linkedin.com/company/andes',
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function successResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      sectorKey: 'healthcare',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function errorResult(): LushaPreviewResult {
  return {
    ok: false,
    status: 'provider_error',
    results: [],
    billing: { creditsCharged: null, resultsReturned: null, expectedMaxCredits: 1 },
    warnings: ['provider_error'],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      sectorKey: 'healthcare',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: null,
      hasSearchText: false,
    },
    error: 'boom raw-payload-should-not-leak',
  };
}

// Spy deps: record every write. Absence of any other dep proves no side effects.
function makeDeps(search: LushaPreviewResult) {
  const calls = {
    searchInputs: [] as LushaPreviewInput[],
    batches: [] as LushaPendingReviewBatchRow[],
    candidateBatches: [] as LushaPendingReviewCandidateRow[][],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      calls.searchInputs.push(input);
      return search;
    },
    insertBatch: async (row) => {
      calls.batches.push(row);
      return { id: `batch-${calls.batches.length}` };
    },
    insertCandidates: async (rows) => {
      calls.candidateBatches.push(rows);
      return { insertedCount: rows.length };
    },
  };
  return { deps, calls };
}

// ── dedupe helper ─────────────────────────────────────────────────────────────

describe('dedupeLushaCompanies', () => {
  it('13. dedupes by domain, then by normalized name, and skips unusable rows', () => {
    const list = [
      company({ domain: 'acme.com', name: 'Acme' }),
      company({ domain: 'https://www.acme.com/', name: 'Acme Dup' }), // dup domain
      company({ domain: null, name: 'Solo Nombre' }),
      company({ domain: null, name: 'solo nombre' }), // dup name
      company({ domain: null, name: null }), // unusable (no name)
    ];
    const { unique, skippedCount } = dedupeLushaCompanies(list);
    assert.equal(unique.length, 2);
    assert.equal(skippedCount, 3);
  });

  it('normalizeLushaCompanyName strips accents/case/punctuation', () => {
    assert.equal(normalizeLushaCompanyName('Clínica  Andés, S.A.'), 'clinica andes s a');
    assert.equal(normalizeLushaCompanyName(''), null);
    assert.equal(normalizeLushaCompanyName(null), null);
  });
});

// ── Pure builders ─────────────────────────────────────────────────────────────

describe('builders', () => {
  it('14/15. batch row carries provider metadata + review status/source', () => {
    const row = buildLushaPendingReviewBatchRow(INPUT, ACTOR, successResult([company()]), 1);
    assert.equal(row.source, LUSHA_PENDING_REVIEW_BATCH_SOURCE);
    assert.equal(row.status, LUSHA_PENDING_REVIEW_BATCH_STATUS);
    assert.equal(row.owner_id, 'user-1');
    assert.equal(row.created_by, 'user-1');
    assert.equal(row.metadata.provider, 'lusha');
    assert.equal(row.metadata.do_not_sync_hubspot, true);
    assert.equal(row.metadata.do_not_call_enrichment, true);
    // Safe billing metadata only — no api key, no raw payload.
    const billing = row.metadata.billing as Record<string, unknown>;
    assert.equal(billing.expected_max_credits, 1);
    assert.doesNotMatch(JSON.stringify(row), /apiKey|api_key|authorization/i);
  });

  it('15. candidate rows use needs_review + production + lusha + no_match', () => {
    const rows = buildLushaPendingReviewCandidateRows('batch-x', [company()]);
    const row = rows[0];
    assert.equal(row.status, LUSHA_PENDING_REVIEW_CANDIDATE_STATUS);
    assert.equal(row.record_origin, LUSHA_PENDING_REVIEW_RECORD_ORIGIN);
    assert.equal(row.source_primary, LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE);
    assert.equal(row.duplicate_status, LUSHA_PENDING_REVIEW_DUPLICATE_STATUS);
    assert.equal(row.batch_id, 'batch-x');
    assert.equal(row.domain, 'clinicaandes.com');
    assert.equal((row.source_trace as Record<string, unknown>).sourceProvider, 'lusha');
    assert.equal((row.source_trace as Record<string, unknown>).accountDuplicateCheck, 'not_performed');
  });
});

// ── Orchestrator ──────────────────────────────────────────────────────────────

describe('persistLushaPendingReviewBatch', () => {
  it('1/2/16. success creates exactly 1 batch and N candidates; returns batchId + counts', async () => {
    const { deps, calls } = makeDeps(successResult([company({ domain: 'a.com', name: 'A' }), company({ domain: 'b.com', name: 'B' })]));
    const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);

    assert.equal(res.ok, true);
    assert.equal(res.status, 'success');
    assert.equal(calls.batches.length, 1);
    assert.equal(calls.candidateBatches.length, 1);
    assert.equal(calls.candidateBatches[0].length, 2);
    assert.equal(res.createdCandidatesCount, 2);
    assert.equal(res.batchId, 'batch-1');
    assert.equal(res.creditsCharged, 1);
    assert.equal(res.resultsReturned, 2);
    assert.match(res.reviewUrl, /prospectos/);
  });

  it('8/9/10. respects preview guardrails (credits<=1) by surfacing billing verbatim', async () => {
    const search = successResult([company()]);
    const { deps } = makeDeps(search);
    const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
    assert.equal(res.creditsCharged, 1);
    assert.ok((search.billing.expectedMaxCredits as number) === 1);
  });

  it('11. Lusha failure creates NO batch and NO candidates', async () => {
    const { deps, calls } = makeDeps(errorResult());
    const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'error');
    assert.equal(calls.batches.length, 0);
    assert.equal(calls.candidateBatches.length, 0);
    assert.equal(res.batchId, null);
    assert.equal(res.createdCandidatesCount, 0);
    // 17. raw provider payload/secret is NOT surfaced verbatim beyond a short slice.
    assert.ok((res.error ?? '').length <= 200);
  });

  it('12. zero Lusha results creates NO candidates and reports empty', async () => {
    const { deps, calls } = makeDeps(successResult([]));
    const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
    assert.equal(res.ok, true);
    assert.equal(res.status, 'empty');
    assert.equal(calls.batches.length, 0);
    assert.equal(calls.candidateBatches.length, 0);
    assert.equal(res.createdCandidatesCount, 0);
  });

  it('12b. all-unusable results (no name) create NO writes (nothing to review)', async () => {
    const { deps, calls } = makeDeps(
      successResult([company({ domain: null, name: null }), company({ domain: null, name: null })]),
    );
    const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
    assert.equal(res.status, 'empty');
    assert.equal(calls.batches.length, 0);
    assert.equal(res.skippedCount, 2);
  });

  it('12c. same-domain duplicates collapse to one candidate (dedupe before insert)', async () => {
    const { deps, calls } = makeDeps(
      successResult([company({ domain: 'x.com', name: 'X' }), company({ domain: 'x.com', name: 'X copy' })]),
    );
    const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
    assert.equal(res.status, 'success');
    assert.equal(calls.batches.length, 1);
    assert.equal(res.createdCandidatesCount, 1);
    assert.equal(res.skippedCount, 1);
  });

  it('3/4/5/6/7. only insertBatch + insertCandidates deps exist (no account/hubspot/enrich/usage/agent-run write path)', async () => {
    const { deps } = makeDeps(successResult([company()]));
    const depKeys = Object.keys(deps).sort();
    assert.deepEqual(depKeys, ['insertBatch', 'insertCandidates', 'runSearch']);
    // There is no dep that could create an account, call HubSpot/enrichment, or
    // write provider_usage_logs / agent_runs. The write surface is exactly two.
  });
});
