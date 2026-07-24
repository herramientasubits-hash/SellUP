/**
 * Q3F-5BB.7 — Lusha duplicate-parity contract.
 *
 * Proves the Lusha pending-review writer now reaches DUPLICATE PARITY with the
 * canonical Tavily/candidate-writer flow BEFORE persisting candidates:
 *   - SellUp account duplicate check (exact + possible).
 *   - HubSpot duplicate check (exact + possible + unavailable = non-blocking).
 *   - Active-candidate duplicate guard (skip strong / mark canonical possible).
 *   - Real duplicate_status, matched_account_id, matched_hubspot_company_id.
 *   - source_trace records what ran (no more `accountDuplicateCheck: not_performed`).
 *   - No account creation, no HubSpot write, no enrichment, no live provider calls
 *     (every dep is an in-test double), no migrations.
 *
 * The duplicate checks are exercised through the pure core's injected READ-ONLY
 * deps — the checkers themselves are never contacted for real here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  persistLushaPendingReviewBatch,
  resolveLushaCandidateDuplicateState,
  buildLushaDuplicateCheckInput,
  buildLushaGuardInput,
  isValidAccountUuid,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
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
  DuplicateGuardMatch,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import { evaluateConvertApproveEligibility } from '@/modules/prospect-review/approve-and-convert-eligibility';

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

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: 'pc-1',
    name: 'Acme',
    domain: 'acme.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Banking',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 90,
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
      sector: 'Banca',
      sectorKey: 'banking',
      mainIndustriesIds: [7],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

// ── DuplicateCheckResult builders (resolver reads matches/checkedSources/errors) ──

function dupResult(opts: {
  sellup?: DuplicateMatch[];
  hubspot?: DuplicateMatch[];
  hubspotChecked?: boolean;
  errors?: string[];
}): DuplicateCheckResult {
  const sellup = opts.sellup ?? [];
  const hubspot = opts.hubspot ?? [];
  const hubspotChecked = opts.hubspotChecked ?? true;
  return {
    status: 'new_candidate', // resolver ignores the consolidated status by design
    confidence: 0,
    input: { name: 'x' },
    matches: [...sellup, ...hubspot],
    summary: '',
    checkedSources: hubspotChecked ? ['sellup', 'hubspot'] : ['sellup'],
    ...(opts.errors ? { errors: opts.errors } : {}),
  };
}

const NO_GUARD: DuplicateGuardMatch = {
  matched: false,
  reason: null,
  matchedCandidateId: null,
  matchedDomain: null,
  matchedName: null,
};

function sellupExact(accountId: string): DuplicateMatch {
  return { source: 'sellup', status: 'existing_in_sellup', confidence: 95, matchedId: accountId, matchedName: 'Acme', reason: 'domain' };
}
function sellupPossible(accountId: string): DuplicateMatch {
  return { source: 'sellup', status: 'possible_duplicate', confidence: 65, matchedId: accountId, matchedName: 'Acme SAS', reason: 'name' };
}
function hubspotExact(hsId: string): DuplicateMatch {
  return { source: 'hubspot', status: 'existing_in_hubspot', confidence: 90, matchedId: hsId, matchedName: 'Acme', reason: 'domain' };
}
function hubspotPossible(hsId: string): DuplicateMatch {
  return { source: 'hubspot', status: 'possible_duplicate', confidence: 60, matchedId: hsId, matchedName: 'Acme Inc', reason: 'name' };
}

// ── Flow harness: configurable read-only deps, spy on writes ──────────────────

function emptySecondPage(): LushaPreviewResult {
  return {
    ...successResult([]),
    billing: { creditsCharged: null, resultsReturned: 0, expectedMaxCredits: 1 },
  };
}

function makeFlow(opts: {
  results: LushaPreviewCompany[];
  /** Optional page-1 top-up results (default = empty, so single-page fixtures
   *  keep single-page skip/credit semantics under Q3F-5BB.7B top-up). */
  secondPageResults?: LushaPreviewCompany[];
  checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
  active?: ActiveCandidateRecord[];
}) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
    duplicateInputs: [] as DuplicateCheckInput[],
    searchPages: [] as number[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      calls.searchPages.push(input.page ?? 0);
      if ((input.page ?? 0) > 0) {
        return opts.secondPageResults
          ? successResult(opts.secondPageResults)
          : emptySecondPage();
      }
      return successResult(opts.results);
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
      return (opts.checker ?? (() => dupResult({})))(input);
    },
    fetchActiveCandidates: async () => opts.active ?? [],
  };
  return { deps, calls };
}

async function run(opts: Parameters<typeof makeFlow>[0]) {
  const { deps, calls } = makeFlow(opts);
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
  return { res, calls };
}

// ── resolveLushaCandidateDuplicateState (unit) ────────────────────────────────

describe('resolveLushaCandidateDuplicateState', () => {
  it('1. no match anywhere → no_match, no matched ids, performed_no_match traces', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({}), NO_GUARD);
    assert.equal(r.dbDuplicateStatus, 'no_match');
    assert.equal(r.matchedAccountId, null);
    assert.equal(r.matchedHubspotCompanyId, null);
    assert.equal(r.accountDuplicateCheck, 'performed_no_match');
    assert.equal(r.hubSpotDuplicateCheck, 'performed_no_match');
    assert.equal(r.activeCandidateDuplicateCheck, 'performed_no_match');
  });

  it('2. exact SellUp domain match → exact_duplicate + matched_account_id', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ sellup: [sellupExact(ACCOUNT_UUID)] }), NO_GUARD);
    assert.equal(r.dbDuplicateStatus, 'exact_duplicate');
    assert.equal(r.matchedAccountId, ACCOUNT_UUID);
    assert.equal(r.accountDuplicateCheck, 'performed_matched');
  });

  it('3. SellUp possible match → possible_duplicate + matched_account_id', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ sellup: [sellupPossible(ACCOUNT_UUID)] }), NO_GUARD);
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(r.matchedAccountId, ACCOUNT_UUID);
    assert.equal(r.accountDuplicateCheck, 'performed_possible_duplicate');
  });

  it('4. exact HubSpot match → exact_duplicate + matched_hubspot_company_id', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ hubspot: [hubspotExact('hs-99')] }), NO_GUARD);
    assert.equal(r.dbDuplicateStatus, 'exact_duplicate');
    assert.equal(r.matchedHubspotCompanyId, 'hs-99');
    assert.equal(r.hubSpotDuplicateCheck, 'performed_matched');
  });

  it('5. HubSpot possible match → possible_duplicate + matched_hubspot_company_id', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ hubspot: [hubspotPossible('hs-7')] }), NO_GUARD);
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(r.matchedHubspotCompanyId, 'hs-7');
    assert.equal(r.hubSpotDuplicateCheck, 'performed_possible_duplicate');
  });

  it('6. HubSpot unavailable → skipped_unavailable, does NOT block (SellUp clean → no_match)', () => {
    const r = resolveLushaCandidateDuplicateState(dupResult({ hubspotChecked: false }), NO_GUARD);
    assert.equal(r.hubSpotDuplicateCheck, 'skipped_unavailable');
    assert.equal(r.dbDuplicateStatus, 'no_match');
  });

  it('6b. HubSpot errored → skipped_unavailable (still non-blocking)', () => {
    const r = resolveLushaCandidateDuplicateState(
      dupResult({ errors: ['HubSpot checker error: boom'] }),
      NO_GUARD,
    );
    assert.equal(r.hubSpotDuplicateCheck, 'skipped_unavailable');
    assert.equal(r.dbDuplicateStatus, 'no_match');
  });

  it('8. active canonical-identity guard → possible_duplicate + trace', () => {
    const guard: DuplicateGuardMatch = {
      matched: true,
      reason: 'same_canonical_identity',
      matchedCandidateId: 'cand-9',
      matchedDomain: null,
      matchedName: 'Acme',
    };
    const r = resolveLushaCandidateDuplicateState(dupResult({}), guard);
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(r.activeCandidateDuplicateCheck, 'performed_possible_duplicate');
    assert.equal(r.activeGuardReason, 'same_canonical_identity');
  });

  it('exact wins over possible across sources', () => {
    const r = resolveLushaCandidateDuplicateState(
      dupResult({ sellup: [sellupPossible(ACCOUNT_UUID)], hubspot: [hubspotExact('hs-1')] }),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'exact_duplicate');
    assert.equal(r.matchedAccountId, ACCOUNT_UUID);
    assert.equal(r.matchedHubspotCompanyId, 'hs-1');
  });

  it('non-UUID SellUp matchedId is not persisted as matched_account_id', () => {
    const r = resolveLushaCandidateDuplicateState(
      dupResult({ sellup: [{ ...sellupExact('not-a-uuid'), matchedId: 'not-a-uuid' }] }),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'exact_duplicate');
    assert.equal(r.matchedAccountId, null);
  });

  it('isValidAccountUuid accepts UUIDs, rejects junk', () => {
    assert.equal(isValidAccountUuid(ACCOUNT_UUID), true);
    assert.equal(isValidAccountUuid('nope'), false);
    assert.equal(isValidAccountUuid(null), false);
  });
});

// ── Input adapters ────────────────────────────────────────────────────────────

describe('duplicate-check + guard input adapters', () => {
  it('duplicate-check input carries name/normalized domain/countryCode, no tax id', () => {
    const input = buildLushaDuplicateCheckInput(company({ domain: 'https://www.acme.com/' }), INPUT);
    assert.equal(input.name, 'Acme');
    assert.equal(input.domain, 'acme.com'); // normalized (protocol + www stripped)
    assert.equal(input.countryCode, 'CO');
    assert.equal(input.taxIdentifier, null);
  });

  it('duplicate-check input falls back to the batch countryCode when company iso is null', () => {
    const input = buildLushaDuplicateCheckInput(company({ countryIso2: null }), INPUT);
    assert.equal(input.countryCode, 'CO');
  });

  it('guard input normalizes domain + name', () => {
    const g = buildLushaGuardInput(company({ name: 'Acmé', domain: 'www.acme.com' }));
    assert.equal(g.domain, 'acme.com');
    assert.equal(g.normalizedName, 'acme');
    assert.equal(g.inferredCompanyName, 'Acmé');
  });
});

// ── persist flow (end-to-end with doubles) ────────────────────────────────────

describe('persistLushaPendingReviewBatch — duplicate parity flow', () => {
  it('11 (Q3F-5BB.7B). exact_duplicate is EXCLUDED from persisted candidates + counted', async () => {
    // Only company is an exact SellUp match → nothing useful to review.
    const { res, calls } = await run({
      results: [company()],
      checker: () => dupResult({ sellup: [sellupExact(ACCOUNT_UUID)] }),
    });
    assert.equal(res.status, 'empty');
    assert.equal(calls.batches.length, 0);
    assert.equal(calls.candidateRows.length, 0);
    assert.equal(res.excludedExactDuplicatesCount, 1);
    assert.equal(res.usefulCandidatesCount, 0);
  });

  it('11b. exact_duplicate is excluded but useful siblings still persist', async () => {
    const { res, calls } = await run({
      results: [
        company({ domain: 'exact.com', name: 'Exact' }),
        company({ domain: 'clean.com', name: 'Clean' }),
      ],
      checker: (input) =>
        input.domain === 'exact.com'
          ? dupResult({ sellup: [sellupExact(ACCOUNT_UUID)] })
          : dupResult({}),
    });
    assert.equal(res.status, 'success');
    assert.equal(calls.candidateRows.length, 1);
    assert.equal(calls.candidateRows[0].domain, 'clean.com');
    assert.equal(calls.candidateRows[0].duplicate_status, 'no_match');
    assert.equal(res.excludedExactDuplicatesCount, 1);
    assert.equal(res.usefulCandidatesCount, 1);
  });

  it('12/13. matched_account_id and matched_hubspot_company_id persisted', async () => {
    const { calls } = await run({
      results: [company()],
      checker: () => dupResult({ sellup: [sellupPossible(ACCOUNT_UUID)], hubspot: [hubspotPossible('hs-42')] }),
    });
    const row = calls.candidateRows[0];
    assert.equal(row.matched_account_id, ACCOUNT_UUID);
    assert.equal(row.matched_hubspot_company_id, 'hs-42');
    assert.equal(row.duplicate_status, 'possible_duplicate');
  });

  it('6. HubSpot unavailable does not crash; trace says skipped_unavailable; batch still created', async () => {
    const { res, calls } = await run({
      results: [company()],
      checker: () => dupResult({ hubspotChecked: false }),
    });
    assert.equal(res.status, 'success');
    const row = calls.candidateRows[0];
    assert.equal((row.source_trace as Record<string, unknown>).hubSpotDuplicateCheck, 'skipped_unavailable');
    assert.equal(row.duplicate_status, 'no_match');
  });

  it('7. active candidate with same domain → candidate skipped (not persisted)', async () => {
    const active: ActiveCandidateRecord[] = [
      { id: 'cand-1', name: 'Acme Existing', domain: 'acme.com', normalizedName: 'acme existing', status: 'needs_review' },
    ];
    const { res, calls } = await run({ results: [company({ domain: 'acme.com' })], active });
    // Only usable company was skipped → nothing new to review.
    assert.equal(res.status, 'empty');
    assert.equal(calls.batches.length, 0);
    assert.equal(calls.candidateRows.length, 0);
    assert.equal(res.skippedCount, 1);
  });

  it('8. active candidate same canonical identity → persisted as possible_duplicate', async () => {
    // Distinct name (so same_inferred_identity does NOT fire) but shared normalized_name.
    const active: ActiveCandidateRecord[] = [
      { id: 'cand-2', name: 'Totally Different Legal Name', domain: null, normalizedName: 'acme', status: 'needs_review' },
    ];
    const { res, calls } = await run({ results: [company({ name: 'Acme', domain: 'acme.io' })], active });
    assert.equal(res.status, 'success');
    const row = calls.candidateRows[0];
    assert.equal(row.duplicate_status, 'possible_duplicate');
    assert.equal(
      (row.source_trace as Record<string, unknown>).activeCandidateDuplicateCheck,
      'performed_possible_duplicate',
    );
  });

  it('9. intra-batch domain duplicates still collapse before checks', async () => {
    let checkerCalls = 0;
    const { res, calls } = await run({
      results: [company({ domain: 'dup.com', name: 'A' }), company({ domain: 'dup.com', name: 'A copy' })],
      checker: () => {
        checkerCalls++;
        return dupResult({});
      },
    });
    assert.equal(res.status, 'success');
    assert.equal(calls.candidateRows.length, 1);
    assert.equal(checkerCalls, 1); // dedupe happened before the per-company check
  });

  it('14/15. record_origin=production, source_primary=lusha, needs_review, ready_for_review', async () => {
    const { calls } = await run({ results: [company()] });
    const batch = calls.batches[0];
    const row = calls.candidateRows[0];
    assert.equal(batch.status, 'ready_for_review');
    assert.equal(row.record_origin, 'production');
    assert.equal(row.source_primary, 'lusha');
    assert.equal(row.status, 'needs_review');
  });

  it('checks are fed a normalized domain input per company', async () => {
    const { calls } = await run({ results: [company({ domain: 'https://www.acme.com' })] });
    assert.equal(calls.duplicateInputs[0].domain, 'acme.com');
  });
});

// ── ScotiaTech / scotiabank.com regression (29/30) ────────────────────────────

describe('ScotiaTech regression — scotiabank.com must not persist as clean no_match', () => {
  const scotia = () =>
    company({ name: 'ScotiaTech', domain: 'scotiabank.com', providerCompanyId: 'pc-scotia' });

  it('29 (Q3F-5BB.7B). checker returns SellUp exact match → EXCLUDED, never persisted', async () => {
    const { res, calls } = await run({
      results: [scotia()],
      checker: (input) =>
        input.domain === 'scotiabank.com'
          ? dupResult({ sellup: [sellupExact(ACCOUNT_UUID)] })
          : dupResult({}),
    });
    assert.equal(calls.candidateRows.length, 0);
    assert.equal(res.excludedExactDuplicatesCount, 1);
    assert.equal(res.status, 'empty');
  });

  it('30. checker returns HubSpot possible risk → NOT persisted as clean no_match', async () => {
    const { calls } = await run({
      results: [scotia()],
      checker: (input) =>
        input.domain === 'scotiabank.com'
          ? dupResult({ hubspot: [hubspotPossible('hs-scotia')] })
          : dupResult({}),
    });
    const row = calls.candidateRows[0];
    assert.notEqual(row.duplicate_status, 'no_match');
    assert.equal(row.duplicate_status, 'possible_duplicate');
    assert.equal(row.matched_hubspot_company_id, 'hs-scotia');
  });
});

// ── Approval eligibility integration (26/27/28) ───────────────────────────────

describe('approval eligibility parity for Lusha candidates', () => {
  function snapshot(row: LushaPendingReviewCandidateRow) {
    return {
      status: row.status,
      recordOrigin: row.record_origin,
      duplicateStatus: row.duplicate_status,
      convertedAccountId: null,
      matchedHubspotCompanyId: row.matched_hubspot_company_id,
    };
  }

  it('28. a no_match Lusha candidate can be approved/converted', async () => {
    const { calls } = await run({ results: [company()] });
    const decision = evaluateConvertApproveEligibility(snapshot(calls.candidateRows[0]));
    assert.equal(decision.decision, 'convert');
  });

  it('27 (Q3F-5BB.7B). exact_duplicate is excluded; a legacy exact row still blocks approval', async () => {
    // New batches never persist exact duplicates → nothing to approve.
    const { calls } = await run({
      results: [company()],
      checker: () => dupResult({ sellup: [sellupExact(ACCOUNT_UUID)] }),
    });
    assert.equal(calls.candidateRows.length, 0);

    // Legacy safety: a pre-existing exact_duplicate row is still blocked at approval.
    const legacyExactSnapshot = {
      status: 'needs_review',
      recordOrigin: 'production',
      duplicateStatus: 'exact_duplicate',
      convertedAccountId: null,
      matchedHubspotCompanyId: null,
    };
    assert.deepEqual(evaluateConvertApproveEligibility(legacyExactSnapshot), {
      decision: 'reject',
      reason: 'duplicate_blocked',
    });
  });

  it('26. a possible_duplicate Lusha candidate requires explicit confirmation', async () => {
    const { calls } = await run({
      results: [company()],
      checker: () => dupResult({ sellup: [sellupPossible(ACCOUNT_UUID)] }),
    });
    const snap = snapshot(calls.candidateRows[0]);
    // Without confirmation → rejected.
    assert.deepEqual(evaluateConvertApproveEligibility(snap), {
      decision: 'reject',
      reason: 'needs_duplicate_confirmation',
    });
    // With confirmation → allowed to convert.
    assert.equal(
      evaluateConvertApproveEligibility(snap, { confirmPossibleDuplicate: true }).decision,
      'convert',
    );
  });

  it('26b. a HubSpot-matched Lusha candidate requires HubSpot confirmation', async () => {
    const { calls } = await run({
      results: [company()],
      checker: () => dupResult({ hubspot: [hubspotPossible('hs-1')] }),
    });
    const snap = snapshot(calls.candidateRows[0]);
    assert.deepEqual(evaluateConvertApproveEligibility(snap, { confirmPossibleDuplicate: true }), {
      decision: 'reject',
      reason: 'needs_hubspot_match_confirmation',
    });
  });
});
