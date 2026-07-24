/**
 * Q3F-5BB.7B — Lusha useful-candidate top-up + reviewer-facing duplicate details.
 *
 * Locks the new observable contract on top of the Q3F-5BB.7 duplicate parity:
 *   - TOP-UP: page 0 first; page 1 ONLY when useful < 5; never a 3rd page; size 10;
 *     expectedMaxCredits = 2; cross-page dedupe; credits summed across pages.
 *   - EXACT EXCLUSION: exact_duplicate is never persisted as a reviewable candidate;
 *     it is counted (excludedExactDuplicatesCount).
 *   - DETAILS: possible/exact matches carry a `duplicateDetails` object in
 *     source_trace (SellUp/HubSpot/active-candidate name/domain/id + reviewerMessage)
 *     and feed the existing review UI via metadata.duplicate_check + metadata.validation.
 *   - No live provider calls (every dep is an in-test double), no writes beyond the
 *     two injected insert deps, no migrations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  persistLushaPendingReviewBatch,
  buildLushaDuplicateDetails,
  buildLushaDuplicateCheckMetadata,
  buildLushaValidationMetadata,
  resolveLushaCandidateDuplicateState,
  classifySellupHubspotMatchType,
  classifyActiveGuardMatchType,
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  buildLushaPreviewRequest,
  clampLushaPreviewPage,
  LUSHA_PREVIEW_SIZE,
  LUSHA_PREVIEW_MAX_PAGE,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateMatch,
} from '@/server/agents/prospecting-toolkit/types';
import type {
  ActiveCandidateRecord,
  DuplicateGuardMatch,
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

function manyCompanies(n: number, base = 0): LushaPreviewCompany[] {
  return Array.from({ length: n }, (_, k) => company(base + k + 1));
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

function errorResult(): LushaPreviewResult {
  return {
    ok: false,
    status: 'provider_error',
    results: [],
    billing: { creditsCharged: null, resultsReturned: null, expectedMaxCredits: 1 },
    warnings: ['provider_error'],
    requestSummary: successResult([]).requestSummary,
    error: 'boom raw-payload-should-not-leak Authorization: Bearer xyz',
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

function dupResult(opts: { sellup?: DuplicateMatch[]; hubspot?: DuplicateMatch[]; hubspotChecked?: boolean }): DuplicateCheckResult {
  const hubspotChecked = opts.hubspotChecked ?? true;
  return {
    status: 'new_candidate',
    confidence: 0,
    input: { name: 'x' },
    matches: [...(opts.sellup ?? []), ...(opts.hubspot ?? [])],
    summary: '',
    checkedSources: hubspotChecked ? ['sellup', 'hubspot'] : ['sellup'],
  };
}

const NO_GUARD: DuplicateGuardMatch = {
  matched: false,
  reason: null,
  matchedCandidateId: null,
  matchedDomain: null,
  matchedName: null,
};

// Page-aware harness: page 0 → firstPage; page 1 → secondPage (default empty).
function makeFlow(opts: {
  firstPage: LushaPreviewResult;
  secondPage?: LushaPreviewResult;
  checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
  active?: ActiveCandidateRecord[];
}) {
  const calls = {
    pages: [] as number[],
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
    duplicateInputs: [] as DuplicateCheckInput[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      const page = input.page ?? 0;
      calls.pages.push(page);
      if (page > 0) return opts.secondPage ?? successResult([]);
      return opts.firstPage;
    },
    insertBatch: async (row) => {
      calls.batches.push(row);
      return { id: 'batch-1' };
    },
    insertCandidates: async (rows) => {
      calls.candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => {
      calls.duplicateInputs.push(input);
      return (opts.checker ?? noDup)(input);
    },
    fetchActiveCandidates: async () => opts.active ?? [],
  };
  return { deps, calls };
}

const run = async (opts: Parameters<typeof makeFlow>[0]) => {
  const { deps, calls } = makeFlow(opts);
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
  return { res, calls };
};

// ── Top-up pagination ─────────────────────────────────────────────────────────

describe('Q3F-5BB.7B top-up pagination', () => {
  it('1. page 0 yields >= 5 useful → only ONE search call (no top-up)', async () => {
    const { res, calls } = await run({ firstPage: successResult(manyCompanies(5)) });
    assert.equal(res.status, 'success');
    assert.deepEqual(calls.pages, [0]);
    assert.equal(res.pagesRequested, 1);
    assert.equal(res.topUpTriggered, false);
    assert.equal(res.usefulCandidatesCount, 5);
  });

  it('2. page 0 yields < 5 useful → a SECOND search call on page 1', async () => {
    const { res, calls } = await run({
      firstPage: successResult(manyCompanies(2, 0)),
      secondPage: successResult(manyCompanies(3, 100)),
    });
    assert.equal(res.status, 'success');
    assert.deepEqual(calls.pages, [0, 1]);
    assert.equal(res.pagesRequested, 2);
    assert.equal(res.topUpTriggered, true);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(calls.candidateRows.length, 5);
  });

  it('3. never requests a page > 1 (max 2 pages) even if still short after page 1', async () => {
    const { res, calls } = await run({
      firstPage: successResult(manyCompanies(1, 0)),
      secondPage: successResult(manyCompanies(1, 100)),
    });
    assert.deepEqual(calls.pages, [0, 1]);
    assert.equal(res.pagesRequested, 2);
    assert.ok(calls.pages.every((p) => p <= LUSHA_PREVIEW_MAX_PAGE));
    assert.equal(res.usefulCandidatesCount, 2); // still < 5, but no page 2
  });

  it('4. size is always 10 and page is clamped to [0,1] in the request', () => {
    const req0 = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [7], page: 0 });
    assert.equal(req0.pagination.size, LUSHA_PREVIEW_SIZE);
    assert.equal(req0.pagination.size, 10);
    assert.equal(req0.pagination.page, 0);
    const req1 = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [7], page: 1 });
    assert.equal(req1.pagination.page, 1);
    // deep pagination is impossible — clamps to MAX_PAGE
    const reqDeep = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [7], page: 99 });
    assert.equal(reqDeep.pagination.page, LUSHA_PREVIEW_MAX_PAGE);
    assert.equal(clampLushaPreviewPage(99), 1);
    assert.equal(clampLushaPreviewPage(-5), 0);
    assert.equal(clampLushaPreviewPage(undefined), 0);
    assert.equal(clampLushaPreviewPage(1.9), 1);
  });

  it('5. expectedMaxCredits is 2 (server-authoritative ceiling)', async () => {
    const { res } = await run({ firstPage: successResult(manyCompanies(5)) });
    assert.equal(res.expectedMaxCredits, 2);
    assert.equal(LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS, 2);
    assert.equal(LUSHA_PENDING_REVIEW_MAX_PAGES, 2);
    assert.equal(LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES, 5);
  });

  it('6/12. page 1 companies that duplicate page 0 are NOT persisted twice', async () => {
    // page 1 returns co1..co3 again (co1,co2 already on page 0) plus a fresh co3.
    const { res, calls } = await run({
      firstPage: successResult([company(1), company(2)]),
      secondPage: successResult([company(1), company(2), company(3)]),
    });
    assert.equal(res.usefulCandidatesCount, 3); // co1, co2, co3 — no dupes
    const domains = calls.candidateRows.map((r) => r.domain).sort();
    assert.deepEqual(domains, ['co1.com', 'co2.com', 'co3.com']);
  });

  it('13. creditsChargedTotal sums both pages', async () => {
    const { res } = await run({
      firstPage: successResult(manyCompanies(2, 0), 1),
      secondPage: successResult(manyCompanies(3, 100), 1),
    });
    assert.equal(res.creditsChargedTotal, 2);
    assert.equal(res.creditsCharged, 2);
  });

  it('14. page-1 (top-up) failure keeps page-0 useful candidates (fail-safe)', async () => {
    const { res, calls } = await run({
      firstPage: successResult(manyCompanies(2, 0)),
      secondPage: errorResult(),
    });
    assert.equal(res.status, 'success');
    assert.equal(res.usefulCandidatesCount, 2);
    assert.equal(calls.candidateRows.length, 2);
    assert.equal(res.pagesRequested, 2);
  });

  it('page-0 failure → hard error, NO writes at all', async () => {
    const { res, calls } = await run({ firstPage: errorResult() });
    assert.equal(res.status, 'error');
    assert.equal(calls.batches.length, 0);
    assert.equal(calls.candidateRows.length, 0);
    assert.deepEqual(calls.pages, [0]); // never tops up after a page-0 error
    // 22/17. raw payload/secret not surfaced verbatim beyond a short slice.
    assert.ok((res.error ?? '').length <= 200);
  });
});

// ── Exact exclusion / classification ──────────────────────────────────────────

describe('Q3F-5BB.7B exact exclusion', () => {
  const sellupExact = (): DuplicateMatch => ({
    source: 'sellup', status: 'existing_in_sellup', confidence: 95,
    matchedId: ACCOUNT_UUID, matchedName: 'Acme Bank', matchedDomain: 'acmebank.com',
    reason: 'Dominio exacto coincide: acmebank.com',
  });

  it('7/8. exact_duplicate is excluded from persisted candidates and counted', async () => {
    const { res, calls } = await run({
      firstPage: successResult([company(1, { domain: 'acmebank.com' }), company(2)]),
      checker: (input) => (input.domain === 'acmebank.com' ? dupResult({ sellup: [sellupExact()] }) : noDup(input)),
    });
    assert.equal(res.excludedExactDuplicatesCount, 1);
    assert.equal(res.usefulCandidatesCount, 1);
    assert.ok(calls.candidateRows.every((r) => r.duplicate_status !== 'exact_duplicate'));
  });

  it('10. no_match is persisted normally', async () => {
    const { calls } = await run({ firstPage: successResult([company(1)]) });
    assert.equal(calls.candidateRows[0].duplicate_status, 'no_match');
  });
});

// ── Duplicate details (source_trace + metadata) ───────────────────────────────

describe('Q3F-5BB.7B duplicate details', () => {
  const sellupPossible: DuplicateMatch = {
    source: 'sellup', status: 'possible_duplicate', confidence: 65,
    matchedId: ACCOUNT_UUID, matchedName: 'Acme SAS', matchedDomain: 'acme-sas.com',
    reason: 'Nombre similar por contenido: "Acme SAS"',
  };
  const hubspotExact: DuplicateMatch = {
    source: 'hubspot', status: 'existing_in_hubspot', confidence: 92,
    matchedId: 'hs-777', matchedName: 'Acme HubSpot', matchedDomain: 'acme-hs.com',
    reason: 'Dominio exacto coincide en HubSpot: acme-hs.com',
    raw: { secret: 'RAW-HUBSPOT-PAYLOAD-DO-NOT-LEAK', token: 'Bearer abc' },
  };

  it('16. SellUp detail carries matchedName/domain/accountId', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ sellup: [sellupPossible] }), NO_GUARD);
    const src = r.duplicateDetails?.sources.find((s) => s.source === 'sellup');
    assert.equal(src?.matchedName, 'Acme SAS');
    assert.equal(src?.matchedDomain, 'acme-sas.com');
    assert.equal(src?.matchedAccountId, ACCOUNT_UUID);
    assert.equal(src?.strength, 'possible');
  });

  it('17. HubSpot detail carries matchedName/domain/hubspotId', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ hubspot: [hubspotExact] }), NO_GUARD);
    const src = r.duplicateDetails?.sources.find((s) => s.source === 'hubspot');
    assert.equal(src?.matchedName, 'Acme HubSpot');
    assert.equal(src?.matchedDomain, 'acme-hs.com');
    assert.equal(src?.matchedHubspotCompanyId, 'hs-777');
    assert.equal(r.duplicateDetails?.status, 'exact_duplicate');
  });

  it('18. active-candidate detail carries matchedCandidateId', () => {
    const guard: DuplicateGuardMatch = {
      matched: true, reason: 'same_canonical_identity',
      matchedCandidateId: 'cand-42', matchedDomain: null, matchedName: 'Acme Existing',
    };
    const r = resolveLushaCandidateDuplicateState(dupResult({}), guard);
    const src = r.duplicateDetails?.sources.find((s) => s.source === 'active_candidate');
    assert.equal(src?.matchedCandidateId, 'cand-42');
    assert.equal(src?.matchType, 'canonical_identity');
  });

  it('19. reviewerMessage is present for possible_duplicate', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ sellup: [sellupPossible] }), NO_GUARD);
    assert.ok((r.duplicateDetails?.reviewerMessage ?? '').length > 0);
    assert.match(r.duplicateDetails!.reviewerMessage, /Posible duplicado/);
  });

  it('21. source_trace.duplicateDetails exists when a duplicate is found (and absent on no_match)', async () => {
    const { calls } = await run({
      firstPage: successResult([company(1), company(2)]),
      checker: (input) => (input.domain === 'co1.com' ? dupResult({ sellup: [sellupPossible] }) : noDup(input)),
    });
    const dupRow = calls.candidateRows.find((r) => r.domain === 'co1.com')!;
    const cleanRow = calls.candidateRows.find((r) => r.domain === 'co2.com')!;
    assert.ok((dupRow.source_trace as Record<string, unknown>).duplicateDetails);
    assert.equal((cleanRow.source_trace as Record<string, unknown>).duplicateDetails, undefined);
  });

  it('22. raw HubSpot payload is NEVER persisted in details/metadata', async () => {
    const { calls } = await run({
      firstPage: successResult([company(1)]),
      checker: () => dupResult({ hubspot: [hubspotExact] }),
    });
    // hubspotExact is EXACT → excluded from persistence → no candidate row.
    // Still assert the detail builder itself never copies raw payloads.
    const details = buildLushaDuplicateDetails(
      'possible_duplicate',
      dupResult({ hubspot: [{ ...hubspotExact, status: 'possible_duplicate' }] }),
      NO_GUARD,
    );
    const serialized = JSON.stringify(details);
    assert.doesNotMatch(serialized, /RAW-HUBSPOT-PAYLOAD|Bearer|token/i);
    // And nothing exact was persisted.
    assert.equal(calls.candidateRows.length, 0);
  });

  it('classifies match types from checker reasons', () => {
    assert.equal(classifySellupHubspotMatchType('Dominio exacto coincide: x.com'), 'exact_domain');
    assert.equal(classifySellupHubspotMatchType('Identificador fiscal exacto coincide'), 'exact_tax_id');
    assert.equal(classifySellupHubspotMatchType('Nombre normalizado exacto coincide + país CO'), 'name_country');
    assert.equal(classifySellupHubspotMatchType('Nombre similar por contenido: "x"'), 'name_similarity');
    assert.equal(classifySellupHubspotMatchType('algo raro'), 'unknown');
    assert.equal(classifyActiveGuardMatchType('same_active_domain'), 'active_domain');
    assert.equal(classifyActiveGuardMatchType('same_canonical_identity'), 'canonical_identity');
  });
});

// ── UI data-shape: the existing review UI reads these ──────────────────────────

describe('Q3F-5BB.7B UI data-shape (feeds existing list + sheet)', () => {
  const sellupPossible: DuplicateMatch = {
    source: 'sellup', status: 'possible_duplicate', confidence: 65,
    matchedId: ACCOUNT_UUID, matchedName: 'Banco Coincidente', matchedDomain: 'banco.com',
    reason: 'Nombre similar por contenido: "Banco Coincidente"',
  };

  it('24/25. metadata.duplicate_check.matches carries matched company name + source', async () => {
    const { calls } = await run({
      firstPage: successResult([company(1)]),
      checker: () => dupResult({ sellup: [sellupPossible], hubspot: [{ source: 'hubspot', status: 'possible_duplicate', confidence: 60, matchedId: 'hs-9', matchedName: 'Banco HS', matchedDomain: 'banco.com', reason: 'Nombre similar por contenido en HubSpot' }] }),
    });
    const meta = calls.candidateRows[0].metadata as Record<string, unknown>;
    const dc = meta.duplicate_check as { sources_checked: string[]; matches: Array<Record<string, unknown>> };
    assert.ok(dc.sources_checked.includes('sellup'));
    assert.ok(dc.sources_checked.includes('hubspot'));
    const names = dc.matches.map((m) => m.matched_name);
    assert.ok(names.includes('Banco Coincidente'));
    assert.ok(names.includes('Banco HS'));
  });

  it('26/27. metadata.validation carries sellup + hubspot matched detail (sheet reads it)', () => {
    const resolution = resolveLushaCandidateDuplicateState(
      dupResult({ sellup: [sellupPossible], hubspot: [{ source: 'hubspot', status: 'possible_duplicate', confidence: 60, matchedId: 'hs-9', matchedName: 'Banco HS', matchedDomain: 'banco.com', reason: 'x' }] }),
      NO_GUARD,
    );
    const validation = buildLushaValidationMetadata(resolution) as Record<string, Record<string, unknown>>;
    assert.equal(validation.sellup_duplicate_check.status, 'possible_duplicate');
    assert.equal(validation.sellup_duplicate_check.matched_name, 'Banco Coincidente');
    assert.equal(validation.sellup_duplicate_check.matched_account_id, ACCOUNT_UUID);
    assert.equal(validation.hubspot_duplicate_check.status, 'possible_match');
    assert.equal(validation.hubspot_duplicate_check.matched_company_name, 'Banco HS');
    assert.equal(validation.hubspot_duplicate_check.matched_company_id, 'hs-9');
  });

  it('HubSpot unavailable → validation omits the hubspot slot (not "verified")', () => {
    const resolution = resolveLushaCandidateDuplicateState(dupResult({ hubspotChecked: false }), NO_GUARD);
    const validation = buildLushaValidationMetadata(resolution) as Record<string, unknown>;
    assert.equal(validation.hubspot_duplicate_check, undefined);
    const dc = buildLushaDuplicateCheckMetadata(resolution) as { sources_checked: string[] };
    assert.ok(!dc.sources_checked.includes('hubspot'));
  });

  it('active-candidate canonical match surfaces as a candidate-source SellUp detail', () => {
    const guard: DuplicateGuardMatch = {
      matched: true, reason: 'same_canonical_identity',
      matchedCandidateId: 'cand-1', matchedDomain: null, matchedName: 'Prospecto Activo',
    };
    const resolution = resolveLushaCandidateDuplicateState(dupResult({}), guard);
    const validation = buildLushaValidationMetadata(resolution) as Record<string, Record<string, unknown>>;
    assert.equal(validation.sellup_duplicate_check.status, 'possible_duplicate');
    assert.equal(validation.sellup_duplicate_check.matched_source, 'candidate');
    assert.equal(validation.sellup_duplicate_check.matched_candidate_id, 'cand-1');
  });
});
