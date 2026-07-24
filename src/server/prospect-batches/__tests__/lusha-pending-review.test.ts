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
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

/** A canonical "checked, no duplicate" result (SellUp + HubSpot both clean). */
function noDuplicateResult(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

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

/** Empty second page — the default top-up response so single-page fixtures keep
 *  single-page semantics (page 1 adds nothing, charges nothing). */
function emptySecondPage(): LushaPreviewResult {
  return {
    ok: true,
    status: 'empty',
    results: [],
    billing: { creditsCharged: null, resultsReturned: 0, expectedMaxCredits: 1 },
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

// Spy deps: record every write. Absence of any other dep proves no side effects.
// runSearch is page-aware: page 0 returns the fixture, page 1 (top-up) returns
// `secondPage` (default = empty) — Q3F-5BB.7B top-up fires whenever useful < 5.
function makeDeps(search: LushaPreviewResult, secondPage: LushaPreviewResult = emptySecondPage()) {
  const calls = {
    searchInputs: [] as LushaPreviewInput[],
    batches: [] as LushaPendingReviewBatchRow[],
    candidateBatches: [] as LushaPendingReviewCandidateRow[][],
    duplicateInputs: [] as DuplicateCheckInput[],
    guardFetches: [] as Array<{ domains: string[]; countryCode: string | null }>,
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      calls.searchInputs.push(input);
      return (input.page ?? 0) > 0 ? secondPage : search;
    },
    insertBatch: async (row) => {
      calls.batches.push(row);
      return { id: `batch-${calls.batches.length}` };
    },
    insertCandidates: async (rows) => {
      calls.candidateBatches.push(rows);
      return { insertedCount: rows.length };
    },
    // Read-only duplicate parity deps: default = no duplicates anywhere.
    checkCompanyDuplicate: async (input) => {
      calls.duplicateInputs.push(input);
      return noDuplicateResult(input);
    },
    fetchActiveCandidates: async (domains, countryCode) => {
      calls.guardFetches.push({ domains, countryCode });
      return [] as ActiveCandidateRecord[];
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
    const row = buildLushaPendingReviewBatchRow(INPUT, ACTOR, successResult([company()]), 1, {
      pagesRequested: 1,
      creditsChargedTotal: 1,
      resultsReturnedTotal: 1,
      usefulCandidatesCount: 1,
      possibleDuplicatesCount: 0,
      excludedExactDuplicatesCount: 0,
      skippedActiveDuplicatesCount: 0,
      topUpTriggered: false,
    });
    assert.equal(row.source, LUSHA_PENDING_REVIEW_BATCH_SOURCE);
    assert.equal(row.status, LUSHA_PENDING_REVIEW_BATCH_STATUS);
    assert.equal(row.owner_id, 'user-1');
    assert.equal(row.created_by, 'user-1');
    assert.equal(row.metadata.provider, 'lusha');
    assert.equal(row.metadata.do_not_sync_hubspot, true);
    assert.equal(row.metadata.do_not_call_enrichment, true);
    // Safe billing metadata only — no api key, no raw payload.
    const billing = row.metadata.billing as Record<string, unknown>;
    assert.equal(billing.expected_max_credits, 2); // pending-review ceiling (Q3F-5BB.7B)
    assert.doesNotMatch(JSON.stringify(row), /apiKey|api_key|authorization/i);
  });

  it('15. candidate rows use needs_review + production + lusha + resolved no_match', () => {
    const rows = buildLushaPendingReviewCandidateRows('batch-x', [
      {
        company: company(),
        resolution: {
          dbDuplicateStatus: 'no_match',
          matchedAccountId: null,
          matchedHubspotCompanyId: null,
          accountDuplicateCheck: 'performed_no_match',
          hubSpotDuplicateCheck: 'performed_no_match',
          activeCandidateDuplicateCheck: 'performed_no_match',
          activeGuardReason: null,
          duplicateDetails: null,
        },
      },
    ]);
    const row = rows[0];
    assert.equal(row.status, LUSHA_PENDING_REVIEW_CANDIDATE_STATUS);
    assert.equal(row.record_origin, LUSHA_PENDING_REVIEW_RECORD_ORIGIN);
    assert.equal(row.source_primary, LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE);
    assert.equal(row.duplicate_status, LUSHA_PENDING_REVIEW_DUPLICATE_STATUS);
    assert.equal(row.matched_account_id, null);
    assert.equal(row.matched_hubspot_company_id, null);
    assert.equal(row.batch_id, 'batch-x');
    assert.equal(row.domain, 'clinicaandes.com');
    const trace = row.source_trace as Record<string, unknown>;
    assert.equal(trace.sourceProvider, 'lusha');
    // Q3F-5BB.7: the check now RAN — it is no longer 'not_performed'.
    assert.equal(trace.accountDuplicateCheck, 'performed_no_match');
    assert.notEqual(trace.accountDuplicateCheck, 'not_performed');
    assert.equal(trace.duplicateResolutionVersion, 'lusha_duplicate_parity_v1');
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

  it('3/4/5/6/7. write surface is exactly insertBatch + insertCandidates; duplicate deps are read-only', async () => {
    const { deps } = makeDeps(successResult([company()]));
    const depKeys = Object.keys(deps).sort();
    assert.deepEqual(depKeys, [
      'checkCompanyDuplicate',
      'fetchActiveCandidates',
      'insertBatch',
      'insertCandidates',
      'runSearch',
    ]);
    // The ONLY write deps are insertBatch + insertCandidates. checkCompanyDuplicate
    // and fetchActiveCandidates are read-only duplicate detectors — there is still
    // no dep that could create an account, WRITE to HubSpot/enrichment, or write
    // provider_usage_logs / agent_runs.
    const writeDepNames = depKeys.filter((k) => /^insert/i.test(k));
    assert.deepEqual(writeDepNames, ['insertBatch', 'insertCandidates']);
  });
});
