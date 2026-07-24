/**
 * Q3F-5BB.7D — Lusha LinkedIn surfacing + excluded exact-duplicate audit metadata.
 *
 * Locks the new writer contract (NO migration, NO schema change):
 *   - LINKEDIN: the writer keeps the flat `metadata.linkedin_url` (backward compat)
 *     AND, when Lusha returned a real company profile URL, also writes the canonical
 *     `metadata.linkedin_enrichment.company_url` the review UI already reads. A null
 *     or non-company URL never produces a fabricated canonical block.
 *   - EXCLUDED DUPLICATES: exact_duplicate companies excluded from the reviewable
 *     candidates are recorded, per-company, in `prospect_batches.metadata
 *     .excludedExactDuplicates` (safe fields only), with
 *     `duplicate_summary.excluded_details_count` == array length.
 *   - No live provider calls (every dep is an in-test double); no writes beyond the
 *     two injected insert deps; no HubSpot / enrichment / account creation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  persistLushaPendingReviewBatch,
  buildLushaExcludedExactDuplicate,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type ResolvedLushaCandidate,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateMatch,
} from '@/server/agents/prospecting-toolkit/types';
import type {
  ActiveCandidateRecord,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

// ── Fixtures ────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  sectorKey: 'banking',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
const ACTOR = { internalUserId: 'user-1' };
const ACCOUNT_UUID = '11111111-2222-4333-8444-555555555555';

function company(i: number, overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: `pc-${i}`,
    name: `Co ${i}`,
    domain: `co${i}.com`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Banking',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 90,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function successResult(results: LushaPreviewCompany[], creditsCharged: number | null = 1): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Banca',
      sectorKey: 'banking',
      mainIndustriesIds: [7],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function noDup(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function dupResult(matches: DuplicateMatch[]): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 0,
    input: { name: 'x' },
    matches,
    summary: '',
    checkedSources: ['sellup', 'hubspot'],
  };
}

const sellupExact = (): DuplicateMatch => ({
  source: 'sellup',
  status: 'existing_in_sellup',
  confidence: 95,
  matchedId: ACCOUNT_UUID,
  matchedName: 'Acme Bank',
  matchedDomain: 'acmebank.com',
  reason: 'Dominio exacto coincide: acmebank.com',
});

const sellupPossible = (): DuplicateMatch => ({
  source: 'sellup',
  status: 'possible_duplicate',
  confidence: 65,
  matchedId: ACCOUNT_UUID,
  matchedName: 'Acme SAS',
  matchedDomain: 'acme-sas.com',
  reason: 'Nombre similar por contenido: "Acme SAS"',
});

function makeFlow(opts: {
  firstPage: LushaPreviewResult;
  checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
  active?: ActiveCandidateRecord[];
}) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => (input.page && input.page > 0 ? successResult([]) : opts.firstPage),
    insertBatch: async (row) => {
      calls.batches.push(row);
      return { id: 'batch-1' };
    },
    insertCandidates: async (rows) => {
      calls.candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => (opts.checker ?? noDup)(input),
    fetchActiveCandidates: async () => opts.active ?? [],
  };
  return { deps, calls };
}

const run = async (opts: Parameters<typeof makeFlow>[0]) => {
  const { deps, calls } = makeFlow(opts);
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
  return { res, calls };
};

// ── LinkedIn surfacing ────────────────────────────────────────────────────────

describe('Q3F-5BB.7D · Lusha writer LinkedIn', () => {
  it('1. keeps the flat metadata.linkedin_url (backward compat)', async () => {
    const url = 'https://www.linkedin.com/company/co1';
    const { calls } = await run({ firstPage: successResult([company(1, { linkedinUrl: url })]) });
    assert.equal(calls.candidateRows[0].metadata.linkedin_url, url);
  });

  it('2. also writes canonical linkedin_enrichment.company_url for a company URL', async () => {
    const url = 'https://www.linkedin.com/company/co1';
    const { calls } = await run({ firstPage: successResult([company(1, { linkedinUrl: url })]) });
    const le = calls.candidateRows[0].metadata.linkedin_enrichment as Record<string, unknown> | undefined;
    assert.ok(le, 'linkedin_enrichment should be present');
    assert.equal(le!.status, 'found');
    assert.equal(le!.company_url, url);
    assert.equal(le!.source, 'lusha');
  });

  it('3. does NOT write canonical block when Lusha returns no LinkedIn', async () => {
    const { calls } = await run({ firstPage: successResult([company(1, { linkedinUrl: null })]) });
    assert.equal(calls.candidateRows[0].metadata.linkedin_url, null);
    assert.equal(calls.candidateRows[0].metadata.linkedin_enrichment, undefined);
  });

  it('4. does NOT write canonical block for a non-company (personal) URL', async () => {
    const personal = 'https://www.linkedin.com/in/someone';
    const { calls } = await run({ firstPage: successResult([company(1, { linkedinUrl: personal })]) });
    assert.equal(calls.candidateRows[0].metadata.linkedin_url, personal);
    assert.equal(calls.candidateRows[0].metadata.linkedin_enrichment, undefined);
  });
});

// ── Excluded exact-duplicate audit metadata ─────────────────────────────────────

describe('Q3F-5BB.7D · excluded exact-duplicate audit metadata', () => {
  const excludingFlow = () =>
    run({
      // co1 → exact duplicate (excluded); co2 → no_match (persisted, keeps batch alive).
      firstPage: successResult([company(1, { domain: 'acmebank.com' }), company(2)]),
      checker: (input) => (input.domain === 'acmebank.com' ? dupResult([sellupExact()]) : noDup(input)),
    });

  it('1. exact duplicate is NOT inserted as a reviewable candidate', async () => {
    const { calls } = await excludingFlow();
    assert.equal(calls.candidateRows.length, 1);
    assert.equal(calls.candidateRows[0].name, 'Co 2');
    assert.ok(calls.candidateRows.every((r) => r.duplicate_status !== 'exact_duplicate'));
  });

  it('2. batch metadata contains an excludedExactDuplicates array', async () => {
    const { calls } = await excludingFlow();
    const excluded = calls.batches[0].metadata.excludedExactDuplicates as unknown[];
    assert.ok(Array.isArray(excluded));
    assert.equal(excluded.length, 1);
  });

  it('3/4/5. excluded detail carries original name/domain + matched source name/domain/id', async () => {
    const { calls } = await excludingFlow();
    const excluded = calls.batches[0].metadata.excludedExactDuplicates as Array<Record<string, unknown>>;
    const entry = excluded[0];
    assert.equal(entry.name, 'Co 1');
    assert.equal(entry.domain, 'acmebank.com');
    assert.equal(entry.duplicateStatus, 'exact_duplicate');
    const sources = entry.sources as Array<Record<string, unknown>>;
    assert.ok(sources.length >= 1);
    const s = sources[0];
    assert.equal(s.source, 'sellup');
    assert.equal(s.matchedName, 'Acme Bank');
    assert.equal(s.matchedDomain, 'acmebank.com');
    assert.equal(s.matchedAccountId, ACCOUNT_UUID);
    assert.equal(s.strength, 'exact');
    assert.ok(typeof entry.reviewerMessage === 'string');
  });

  it('6. excluded detail does not leak raw payloads/secrets (only safe keys)', async () => {
    const { calls } = await excludingFlow();
    const excluded = calls.batches[0].metadata.excludedExactDuplicates as Array<Record<string, unknown>>;
    const allowedTop = new Set(['name', 'domain', 'duplicateStatus', 'sources', 'reviewerMessage']);
    assert.deepEqual(Object.keys(excluded[0]).filter((k) => !allowedTop.has(k)), []);
    const allowedSrc = new Set([
      'source', 'matchType', 'strength', 'confidence', 'matchedName', 'matchedDomain',
      'matchedAccountId', 'matchedHubspotCompanyId', 'matchedCandidateId', 'reason',
    ]);
    const sources = excluded[0].sources as Array<Record<string, unknown>>;
    for (const s of sources) {
      assert.deepEqual(Object.keys(s).filter((k) => !allowedSrc.has(k)), []);
    }
    const serialized = JSON.stringify(excluded);
    assert.equal(/authorization|bearer|api[_-]?key/i.test(serialized), false);
  });

  it('7. duplicate_summary.excluded_details_count equals the array length', async () => {
    const { calls } = await excludingFlow();
    const summary = calls.batches[0].metadata.duplicate_summary as Record<string, unknown>;
    const excluded = calls.batches[0].metadata.excludedExactDuplicates as unknown[];
    assert.equal(summary.excluded_details_count, excluded.length);
    assert.equal(summary.exact_duplicates_excluded, 1);
  });

  it('8. no_match candidates still insert normally (empty excluded array)', async () => {
    const { calls } = await run({ firstPage: successResult([company(1), company(2)]) });
    assert.equal(calls.candidateRows.length, 2);
    assert.equal(calls.candidateRows.every((r) => r.duplicate_status === 'no_match'), true);
    const excluded = calls.batches[0].metadata.excludedExactDuplicates as unknown[];
    assert.deepEqual(excluded, []);
    const summary = calls.batches[0].metadata.duplicate_summary as Record<string, unknown>;
    assert.equal(summary.excluded_details_count, 0);
  });

  it('9. possible_duplicate candidates still insert normally with details', async () => {
    const { calls } = await run({
      firstPage: successResult([company(1, { domain: 'acme-sas.com' })]),
      checker: () => dupResult([sellupPossible()]),
    });
    assert.equal(calls.candidateRows.length, 1);
    assert.equal(calls.candidateRows[0].duplicate_status, 'possible_duplicate');
    const trace = calls.candidateRows[0].source_trace as Record<string, unknown>;
    assert.ok(trace.duplicateDetails, 'possible duplicate keeps reviewer-facing details');
  });
});

// ── Pure builder ────────────────────────────────────────────────────────────────

describe('Q3F-5BB.7D · buildLushaExcludedExactDuplicate', () => {
  it('maps company + resolution.duplicateDetails into a safe audit entry', () => {
    const resolved: ResolvedLushaCandidate = {
      company: company(1, { domain: 'acmebank.com' }),
      resolution: {
        dbDuplicateStatus: 'exact_duplicate',
        matchedAccountId: ACCOUNT_UUID,
        matchedHubspotCompanyId: null,
        accountDuplicateCheck: 'performed_matched',
        hubSpotDuplicateCheck: 'performed_no_match',
        activeCandidateDuplicateCheck: 'performed_no_match',
        activeGuardReason: null,
        duplicateDetails: {
          status: 'exact_duplicate',
          sources: [
            {
              source: 'sellup',
              matchType: 'exact_domain',
              strength: 'exact',
              matchedName: 'Acme Bank',
              matchedDomain: 'acmebank.com',
              matchedAccountId: ACCOUNT_UUID,
              reason: 'Dominio exacto coincide',
            },
          ],
          reviewerMessage: 'Duplicado confirmado — coincide con SellUp (Acme Bank). Excluido de revisión.',
        },
      },
    };
    const entry = buildLushaExcludedExactDuplicate(resolved);
    assert.equal(entry.name, 'Co 1');
    assert.equal(entry.domain, 'acmebank.com');
    assert.equal(entry.duplicateStatus, 'exact_duplicate');
    assert.equal(entry.sources.length, 1);
    assert.equal(entry.sources[0].matchedName, 'Acme Bank');
    assert.ok(entry.reviewerMessage);
  });

  it('falls back to empty sources / null message when no details present', () => {
    const resolved: ResolvedLushaCandidate = {
      company: company(2, { domain: null }),
      resolution: {
        dbDuplicateStatus: 'exact_duplicate',
        matchedAccountId: null,
        matchedHubspotCompanyId: null,
        accountDuplicateCheck: 'performed_matched',
        hubSpotDuplicateCheck: 'skipped_unavailable',
        activeCandidateDuplicateCheck: 'performed_no_match',
        activeGuardReason: null,
        duplicateDetails: null,
      },
    };
    const entry = buildLushaExcludedExactDuplicate(resolved);
    assert.deepEqual(entry.sources, []);
    assert.equal(entry.reviewerMessage, null);
    assert.equal(entry.domain, null);
  });
});
