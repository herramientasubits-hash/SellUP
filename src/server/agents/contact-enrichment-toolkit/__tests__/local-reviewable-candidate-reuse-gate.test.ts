// Tests — Pre-Provider LOCAL Reviewable Candidate Reuse Gate
// AGENT2A-LOCAL-REVIEWABLE-CANDIDATE-REUSE-1.1
//
// Fully offline and deterministic: no Supabase, no network, no Apollo/Lusha/
// HubSpot call, no credential, 0 credits. Every reader is injected.
//
// The 1.1 correction under test: the reusable set is source IN
// ('apollo','lusha'), not Lusha alone. A Lusha-only predicate left a real cost
// leak, because #315 removes already-known Apollo person_ids BEFORE the paid
// /people/match leg, so a repeat run can reach candidatesCreated=0 while an
// actionable APOLLO candidate for the same company already waits for review.
//
// What is NOT under test because it must not exist: any cross-provider
// identity claim. These tests prove the gate never compares source_contact_id
// values, within or across providers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONABLE_LOCAL_REUSE_THRESHOLD,
  REUSABLE_LOCAL_CANDIDATE_SOURCES,
  SUPPRESS_ONLY_NOT_REUSABLE_STATES,
  buildDomainLookupSpellings,
  evaluateLocalReviewableCandidateReuseGate,
  isActionableReusableLocalCandidate,
  selectActionableReusableLocalCandidates,
  type LocalReuseGateResultV1,
  type ReusableLocalCandidateRowV1,
} from '../local-reviewable-candidate-reuse-gate';
import type { CompanyIdentityKeysV1 } from '../provider-native-novelty-gate';
import { CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG } from '@/lib/feature-flags.server';

const CURRENT_REQUEST_ID = 'req-current';
const ACCOUNT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACCOUNT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function company(overrides: Partial<CompanyIdentityKeysV1> = {}): CompanyIdentityKeysV1 {
  return { accountId: null, hubspotCompanyId: null, companyDomain: null, ...overrides };
}

function candidate(overrides: Partial<ReusableLocalCandidateRowV1> = {}): ReusableLocalCandidateRowV1 {
  return {
    source: 'lusha',
    sourceContactId: 'lusha-contact-1',
    status: 'pending_review',
    duplicateStatus: 'no_match',
    email: 'someone@acme.com',
    requestId: 'req-historic',
    company: company({ accountId: ACCOUNT_A }),
    ...overrides,
  };
}

async function runGate(
  overrides: {
    enabled?: boolean;
    requestCompany?: CompanyIdentityKeysV1 | null;
    requestError?: string | null;
    rows?: ReusableLocalCandidateRowV1[];
    lookupError?: string | null;
    onRequestRead?: () => void;
    onCandidateRead?: () => void;
  } = {},
): Promise<LocalReuseGateResultV1> {
  const {
    enabled = true,
    requestCompany = company({ accountId: ACCOUNT_A }),
    requestError = null,
    rows = [candidate()],
    lookupError = null,
    onRequestRead,
    onCandidateRead,
  } = overrides;

  return evaluateLocalReviewableCandidateReuseGate(
    { requestId: CURRENT_REQUEST_ID },
    {
      isGateEnabled: () => enabled,
      readRequestCompanyKeys: async () => {
        onRequestRead?.();
        return { company: requestCompany, lookupError: requestError };
      },
      readReusableCandidates: async () => {
        onCandidateRead?.();
        return { rows, lookupError };
      },
    },
  );
}

// ── Threshold and flag ──────────────────────────────────────────

describe('threshold and flag', () => {
  it('the threshold is exactly one actionable candidate — no numeric target is invented', () => {
    assert.equal(ACTIONABLE_LOCAL_REUSE_THRESHOLD, 1);
  });

  it('the flag constant is the dedicated ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE name', () => {
    assert.equal(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE');
  });

  it('gate disabled: neither reader executes and the result is a MISS', async () => {
    let requestReads = 0;
    let candidateReads = 0;
    const result = await runGate({
      enabled: false,
      onRequestRead: () => { requestReads += 1; },
      onCandidateRead: () => { candidateReads += 1; },
    });

    assert.equal(result.hit, false);
    assert.equal(result.actionableReusableCandidateCount, 0);
    assert.equal(result.observability.gate_applied, false);
    assert.equal(result.observability.gate_skipped_reason, 'gate_disabled');
    assert.equal(requestReads, 0);
    assert.equal(candidateReads, 0);
  });
});

// ── Actionable contract ─────────────────────────────────────────

describe('actionable reuse contract', () => {
  it('pending_review + email + no_match + Lusha native id => reusable', () => {
    assert.equal(isActionableReusableLocalCandidate(candidate()), true);
  });

  it('pending_review + email + NO LinkedIn => still reusable (LinkedIn is optional and never read)', () => {
    // The row shape has no LinkedIn field at all — proving it cannot influence the decision.
    assert.equal('linkedinUrl' in candidate(), false);
    assert.equal(isActionableReusableLocalCandidate(candidate()), true);
  });

  it('pending_review WITHOUT email => NOT reusable', () => {
    assert.equal(isActionableReusableLocalCandidate(candidate({ email: null })), false);
    assert.equal(isActionableReusableLocalCandidate(candidate({ email: '   ' })), false);
  });

  it('missing / blank Lusha native id => NOT reusable', () => {
    assert.equal(isActionableReusableLocalCandidate(candidate({ sourceContactId: null })), false);
    assert.equal(isActionableReusableLocalCandidate(candidate({ sourceContactId: ' ' })), false);
  });

  it('the reusable source set is exactly apollo + lusha', () => {
    assert.deepEqual([...REUSABLE_LOCAL_CANDIDATE_SOURCES], ['apollo', 'lusha']);
  });

  it('an actionable APOLLO candidate IS reusable — this is the 1.1 cost-leak fix', () => {
    const apollo = candidate({ source: 'apollo', sourceContactId: 'apollo-person-1' });
    assert.equal(isActionableReusableLocalCandidate(apollo), true);
  });

  it('an actionable LUSHA candidate is reusable', () => {
    const lusha = candidate({ source: 'lusha', sourceContactId: 'lusha-contact-1' });
    assert.equal(isActionableReusableLocalCandidate(lusha), true);
  });

  it('APOLLO candidate with a missing / blank source_contact_id => NOT reusable', () => {
    // source_contact_id is retained as EVIDENCE of a durable provider-backed
    // candidate, so a manual or fabricated row cannot satisfy the gate. Its
    // value is never compared to anything.
    assert.equal(
      isActionableReusableLocalCandidate(candidate({ source: 'apollo', sourceContactId: null })),
      false,
    );
    assert.equal(
      isActionableReusableLocalCandidate(candidate({ source: 'apollo', sourceContactId: '  ' })),
      false,
    );
  });

  it('APOLLO candidate without email => NOT reusable', () => {
    assert.equal(
      isActionableReusableLocalCandidate(candidate({ source: 'apollo', email: null })),
      false,
    );
  });

  it('a source outside the set => never reusable, however perfect the row', () => {
    for (const source of ['hubspot', 'manual', 'public_source', 'csv_import', '']) {
      assert.equal(
        isActionableReusableLocalCandidate(candidate({ source, sourceContactId: 'x-1' })),
        false,
        `source '${source}' must not be reusable`,
      );
    }
  });
});

// ── Cross-provider identity safety ──────────────────────────────

describe('no cross-provider identity is ever asserted', () => {
  it('an Apollo row and a Lusha row with IDENTICAL source_contact_id values are counted as two, never reconciled', () => {
    // If the gate compared provider-native ids, a shared value would collapse
    // these into one (or be treated as an alias). It does neither: the ids are
    // only tested for presence.
    const shared = 'same-string-different-provider-namespace';
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ accountId: ACCOUNT_A }),
      [
        candidate({ source: 'apollo', sourceContactId: shared }),
        candidate({ source: 'lusha', sourceContactId: shared }),
      ],
    );
    assert.equal(selection.actionableCount, 2);
    assert.deepEqual(selection.sourceCounts, { apollo: 1, lusha: 1 });
  });

  it('the actionable predicate result is independent of the source_contact_id VALUE', () => {
    // Same row, wildly different native ids => identical verdict. Proves no
    // value-level comparison, matching, or cross-provider translation exists.
    for (const id of ['apollo-person-999', 'lusha-contact-999', 'zzz', '1']) {
      assert.equal(
        isActionableReusableLocalCandidate(candidate({ source: 'apollo', sourceContactId: id })),
        true,
      );
      assert.equal(
        isActionableReusableLocalCandidate(candidate({ source: 'lusha', sourceContactId: id })),
        true,
      );
    }
  });

  it('an Apollo row never suppresses a specific Lusha id and vice versa — the gate returns counts, not ids', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ accountId: ACCOUNT_A }),
      [candidate({ source: 'apollo', sourceContactId: 'apollo-person-1' })],
    );
    // The selection surface carries no id-shaped field at all.
    assert.deepEqual(
      Object.keys(selection).sort(),
      ['actionableCount', 'companyScopeKind', 'matchedByCounts', 'sourceCounts'],
    );
    assert.doesNotMatch(JSON.stringify(selection), /apollo-person-1/);
  });
});

// ── Suppress-only contract ──────────────────────────────────────

describe('suppress-only states never satisfy local reuse', () => {
  const cases: Array<[string, Partial<ReusableLocalCandidateRowV1>]> = [
    ['approved', { status: 'approved' }],
    ['discarded', { status: 'discarded' }],
    ['status duplicate', { status: 'duplicate' }],
    ['possible_duplicate', { duplicateStatus: 'possible_duplicate' }],
    ['exact_duplicate', { duplicateStatus: 'exact_duplicate' }],
    ['unchecked duplicate_status', { duplicateStatus: 'unchecked' }],
    ['pending_review without email', { email: null }],
  ];

  for (const [label, overrides] of cases) {
    it(`${label} => NOT reusable, for EITHER source`, () => {
      for (const source of REUSABLE_LOCAL_CANDIDATE_SOURCES) {
        assert.equal(
          isActionableReusableLocalCandidate(candidate({ ...overrides, source })),
          false,
          `${label} must not be reusable for source '${source}'`,
        );
      }
    });

    it(`${label} => gate MISSES even when it is the only same-company row`, async () => {
      const result = await runGate({ rows: [candidate(overrides)] });
      assert.equal(result.hit, false);
      assert.equal(result.actionableReusableCandidateCount, 0);
      assert.equal(result.observability.gate_skipped_reason, 'no_actionable_reusable_candidate');
      assert.equal(result.observability.outcome, 'fallback_not_satisfied_locally');
    });
  }

  it('the documented suppress-only set covers every non-reusable state asserted above', () => {
    assert.deepEqual([...SUPPRESS_ONLY_NOT_REUSABLE_STATES], [
      'status:approved',
      'status:discarded',
      'status:duplicate',
      'duplicate_status:possible_duplicate',
      'duplicate_status:exact_duplicate',
      'duplicate_status:unchecked',
      'pending_review_without_email',
    ]);
  });
});

// ── Company identity ────────────────────────────────────────────

describe('deterministic company scope (delegated to the #315 helpers)', () => {
  it('account_id exact match => reusable', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ accountId: ACCOUNT_A }),
      [candidate({ company: company({ accountId: ACCOUNT_A }) })],
    );
    assert.equal(selection.actionableCount, 1);
    assert.equal(selection.companyScopeKind, 'account_id');
  });

  it('account_id disagreement => NOT the same company even when HubSpot id and domain agree', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ accountId: ACCOUNT_A, hubspotCompanyId: 'hs-1', companyDomain: 'acme.com' }),
      [
        candidate({
          company: company({ accountId: ACCOUNT_B, hubspotCompanyId: 'hs-1', companyDomain: 'acme.com' }),
        }),
      ],
    );
    assert.equal(selection.actionableCount, 0);
    assert.equal(selection.companyScopeKind, 'none');
  });

  it('current side lacks account_id but both share the HubSpot id => reusable via HubSpot', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ hubspotCompanyId: 'hs-77' }),
      [candidate({ company: company({ accountId: ACCOUNT_B, hubspotCompanyId: 'hs-77' }) })],
    );
    assert.equal(selection.actionableCount, 1);
    assert.equal(selection.companyScopeKind, 'hubspot_company_id');
  });

  it('only shared key is the normalized domain => deterministic domain match', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ companyDomain: 'https://WWW.Acme.com/careers' }),
      [candidate({ company: company({ companyDomain: 'acme.com' }) })],
    );
    assert.equal(selection.actionableCount, 1);
    assert.equal(selection.companyScopeKind, 'company_domain');
  });

  it('different normalized domains => NOT reusable', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ companyDomain: 'acme.com' }),
      [candidate({ company: company({ companyDomain: 'notacme.com' }) })],
    );
    assert.equal(selection.actionableCount, 0);
  });

  it('company NAME agreement alone => never reusable (no name field exists to compare)', () => {
    const nameOnlyCurrent = company();
    assert.equal(
      selectActionableReusableLocalCandidates(CURRENT_REQUEST_ID, nameOnlyCurrent, [candidate()])
        .actionableCount,
      0,
    );
    // There is no company-name key anywhere in the scope contract.
    assert.deepEqual(Object.keys(nameOnlyCurrent).sort(), ['accountId', 'companyDomain', 'hubspotCompanyId']);
  });

  it('no deterministic company key on the current side => fail open (MISS, no suppression)', async () => {
    let candidateReads = 0;
    const result = await runGate({
      requestCompany: company(),
      onCandidateRead: () => { candidateReads += 1; },
    });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'no_deterministic_company_key');
    assert.equal(candidateReads, 0);
  });

  it('rows produced by the CURRENT request never satisfy it', () => {
    const selection = selectActionableReusableLocalCandidates(
      CURRENT_REQUEST_ID,
      company({ accountId: ACCOUNT_A }),
      [candidate({ requestId: CURRENT_REQUEST_ID })],
    );
    assert.equal(selection.actionableCount, 0);
  });
});

// ── Domain lookup bound ─────────────────────────────────────────

describe('domain lookup bound is exact-match only', () => {
  it('produces a small deterministic set of literal spellings, never a wildcard', () => {
    const spellings = buildDomainLookupSpellings('https://WWW.Acme.com/careers');
    assert.deepEqual(spellings, ['acme.com', 'www.acme.com', 'https://www.acme.com/careers']);
    for (const spelling of spellings) {
      assert.doesNotMatch(spelling, /[%*]/);
    }
  });

  it('an unusable domain yields no spellings at all', () => {
    assert.deepEqual(buildDomainLookupSpellings(null), []);
    assert.deepEqual(buildDomainLookupSpellings('   '), []);
  });
});

// ── Fail-open behaviour ─────────────────────────────────────────

describe('fail open', () => {
  it('request company-keys lookup error => MISS', async () => {
    const result = await runGate({ requestError: 'boom' });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'request_company_keys_unavailable');
    assert.equal(result.observability.lookup_error, 'boom');
  });

  it('request not found => MISS', async () => {
    const result = await runGate({ requestCompany: null, requestError: 'request_not_found' });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'request_company_keys_unavailable');
  });

  it('candidate lookup error => MISS (never blocks the normal fallback)', async () => {
    const result = await runGate({ lookupError: 'connection_reset' });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'lookup_error');
    assert.equal(result.observability.lookup_error, 'connection_reset');
  });

  it('blank requestId => MISS', async () => {
    const result = await evaluateLocalReviewableCandidateReuseGate(
      { requestId: '   ' },
      {
        isGateEnabled: () => true,
        readRequestCompanyKeys: async () => {
          throw new Error('must not be called');
        },
        readReusableCandidates: async () => {
          throw new Error('must not be called');
        },
      },
    );
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'request_company_keys_unavailable');
  });
});

// ── Hit shape and telemetry honesty ─────────────────────────────

describe('reuse HIT', () => {
  it('one actionable same-company candidate is enough', async () => {
    const result = await runGate();
    assert.equal(result.hit, true);
    assert.equal(result.actionableReusableCandidateCount, 1);
    assert.equal(result.observability.gate_applied, true);
    assert.equal(result.observability.gate_skipped_reason, null);
    assert.equal(result.observability.outcome, 'fallback_satisfied_by_existing_candidate');
    assert.equal(result.observability.threshold, 1);
    assert.equal(result.observability.company_scope_kind, 'account_id');
  });

  it('counts every actionable same-company candidate', async () => {
    const result = await runGate({
      rows: [
        candidate({ sourceContactId: 'lusha-1' }),
        candidate({ sourceContactId: 'lusha-2' }),
        candidate({ sourceContactId: 'lusha-3', status: 'approved' }),
        candidate({ sourceContactId: 'lusha-4', company: company({ accountId: ACCOUNT_B }) }),
      ],
    });
    assert.equal(result.hit, true);
    assert.equal(result.actionableReusableCandidateCount, 2);
  });

  it('observability records zero provider calls and claims no counterfactual savings', async () => {
    const result = await runGate();
    const observability = result.observability as unknown as Record<string, unknown>;
    assert.equal(observability.provider_calls, 0);
    for (const forbidden of [
      'avoided_paid_calls',
      'credits_saved',
      'usd_saved',
      'USD_saved',
      'projected_savings',
      'estimated_savings',
    ]) {
      assert.equal(forbidden in observability, false, `${forbidden} must not be reported`);
    }
  });

  it('observability leaks no candidate id, provider id, email or LinkedIn', async () => {
    const result = await runGate({
      rows: [candidate({ sourceContactId: 'lusha-secret-id', email: 'leak@acme.com' })],
    });
    const serialized = JSON.stringify(result.observability);
    assert.doesNotMatch(serialized, /lusha-secret-id/);
    assert.doesNotMatch(serialized, /leak@acme\.com/);
    assert.doesNotMatch(serialized, /linkedin/i);
  });
});

// ── Provider-agnostic reuse: the owner-required counterfactual set ──
//
// One test per numbered requirement of the 1.1 correction. The Apollo cases
// are the ones the Lusha-only predicate got wrong.

describe('provider-agnostic local reuse', () => {
  it('(1) same-company actionable pending_review APOLLO candidate => HIT', async () => {
    const result = await runGate({
      rows: [candidate({ source: 'apollo', sourceContactId: 'apollo-person-1' })],
    });
    assert.equal(result.hit, true);
    assert.equal(result.actionableReusableCandidateCount, 1);
    assert.equal(result.observability.outcome, 'fallback_satisfied_by_existing_candidate');
    assert.deepEqual(result.observability.source_counts, { apollo: 1, lusha: 0 });
  });

  it('(2) same-company actionable pending_review LUSHA candidate => HIT', async () => {
    const result = await runGate({
      rows: [candidate({ source: 'lusha', sourceContactId: 'lusha-contact-1' })],
    });
    assert.equal(result.hit, true);
    assert.equal(result.actionableReusableCandidateCount, 1);
    assert.deepEqual(result.observability.source_counts, { apollo: 0, lusha: 1 });
  });

  it('(3) mixed Apollo + Lusha actionable candidates => count includes both, source counts truthful', async () => {
    const result = await runGate({
      rows: [
        candidate({ source: 'apollo', sourceContactId: 'apollo-person-1' }),
        candidate({ source: 'apollo', sourceContactId: 'apollo-person-2' }),
        candidate({ source: 'lusha', sourceContactId: 'lusha-contact-1' }),
        // Not actionable — must be counted by neither source.
        candidate({ source: 'apollo', sourceContactId: 'apollo-person-3', status: 'approved' }),
        candidate({ source: 'lusha', sourceContactId: 'lusha-contact-2', email: null }),
      ],
    });
    assert.equal(result.hit, true);
    assert.equal(result.actionableReusableCandidateCount, 3);
    assert.deepEqual(result.observability.source_counts, { apollo: 2, lusha: 1 });
    // The aggregate counts sum to the reported total — no double counting.
    const { apollo, lusha } = result.observability.source_counts;
    assert.equal(apollo + lusha, result.observability.actionable_reusable_candidate_count);
  });

  it('(4) Apollo candidate with missing source_contact_id => NOT reusable, gate MISSES', async () => {
    const result = await runGate({
      rows: [candidate({ source: 'apollo', sourceContactId: null })],
    });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'no_actionable_reusable_candidate');
    assert.deepEqual(result.observability.source_counts, { apollo: 0, lusha: 0 });
  });

  it('(5) Apollo candidate without email => NOT reusable, gate MISSES', async () => {
    const result = await runGate({
      rows: [candidate({ source: 'apollo', sourceContactId: 'apollo-person-1', email: null })],
    });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'no_actionable_reusable_candidate');
  });

  it('(6) APPROVED Apollo candidate => NOT reusable (suppress-only, not a deliverable)', async () => {
    const result = await runGate({
      rows: [candidate({ source: 'apollo', sourceContactId: 'apollo-person-1', status: 'approved' })],
    });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'no_actionable_reusable_candidate');
  });

  it('(7) possible_duplicate / exact_duplicate Apollo candidate => NOT reusable', async () => {
    for (const duplicateStatus of ['possible_duplicate', 'exact_duplicate', 'unchecked']) {
      const result = await runGate({
        rows: [candidate({ source: 'apollo', sourceContactId: 'apollo-person-1', duplicateStatus })],
      });
      assert.equal(result.hit, false, `${duplicateStatus} must not satisfy reuse`);
      assert.equal(result.observability.gate_skipped_reason, 'no_actionable_reusable_candidate');
    }
  });

  it('(8) different-company Apollo candidate => NOT reusable', async () => {
    const result = await runGate({
      requestCompany: company({ accountId: ACCOUNT_A }),
      rows: [
        candidate({
          source: 'apollo',
          sourceContactId: 'apollo-person-1',
          company: company({ accountId: ACCOUNT_B }),
        }),
      ],
    });
    assert.equal(result.hit, false);
    assert.equal(result.observability.gate_skipped_reason, 'no_actionable_reusable_candidate');
    assert.equal(result.observability.company_scope_kind, 'none');
  });

  it('an Apollo candidate belonging to the CURRENT request never satisfies its own fallback', async () => {
    // Defence in depth: the current attempt creating (then losing) candidates
    // must not become the reason its own fallback is skipped.
    const result = await runGate({
      rows: [
        candidate({
          source: 'apollo',
          sourceContactId: 'apollo-person-1',
          requestId: CURRENT_REQUEST_ID,
        }),
      ],
    });
    assert.equal(result.hit, false);
  });

  it('source_counts never leaks an id, email or LinkedIn', async () => {
    const result = await runGate({
      rows: [
        candidate({ source: 'apollo', sourceContactId: 'apollo-secret-1', email: 'a@acme.com' }),
        candidate({ source: 'lusha', sourceContactId: 'lusha-secret-1', email: 'l@acme.com' }),
      ],
    });
    const serialized = JSON.stringify(result.observability);
    assert.doesNotMatch(serialized, /apollo-secret-1/);
    assert.doesNotMatch(serialized, /lusha-secret-1/);
    assert.doesNotMatch(serialized, /@acme\.com/);
    assert.doesNotMatch(serialized, /linkedin/i);
    // Only the two aggregate provider counters are present.
    assert.deepEqual(Object.keys(result.observability.source_counts).sort(), ['apollo', 'lusha']);
  });
});
