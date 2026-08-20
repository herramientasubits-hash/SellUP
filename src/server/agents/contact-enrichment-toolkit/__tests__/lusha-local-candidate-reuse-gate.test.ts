// Tests — Pre-Provider LOCAL Lusha Candidate Reuse Gate
// AGENT2A-LUSHA-LOCAL-REUSE-GATE-1
//
// Fully offline and deterministic: no Supabase, no network, no Apollo/Lusha/
// HubSpot call, no credential, 0 credits. Every reader is injected.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIONABLE_LUSHA_REUSE_THRESHOLD,
  SUPPRESS_ONLY_NOT_REUSABLE_STATES,
  buildDomainLookupSpellings,
  evaluateLushaLocalCandidateReuseGate,
  isActionableReusableLushaCandidate,
  selectActionableReusableLushaCandidates,
  type LushaLocalReuseGateResultV1,
  type ReusableLushaCandidateRowV1,
} from '../lusha-local-candidate-reuse-gate';
import type { CompanyIdentityKeysV1 } from '../provider-native-novelty-gate';
import { LUSHA_LOCAL_REUSE_GATE_FLAG } from '@/lib/feature-flags.server';

const CURRENT_REQUEST_ID = 'req-current';
const ACCOUNT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACCOUNT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function company(overrides: Partial<CompanyIdentityKeysV1> = {}): CompanyIdentityKeysV1 {
  return { accountId: null, hubspotCompanyId: null, companyDomain: null, ...overrides };
}

function candidate(overrides: Partial<ReusableLushaCandidateRowV1> = {}): ReusableLushaCandidateRowV1 {
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
    rows?: ReusableLushaCandidateRowV1[];
    lookupError?: string | null;
    onRequestRead?: () => void;
    onCandidateRead?: () => void;
  } = {},
): Promise<LushaLocalReuseGateResultV1> {
  const {
    enabled = true,
    requestCompany = company({ accountId: ACCOUNT_A }),
    requestError = null,
    rows = [candidate()],
    lookupError = null,
    onRequestRead,
    onCandidateRead,
  } = overrides;

  return evaluateLushaLocalCandidateReuseGate(
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
    assert.equal(ACTIONABLE_LUSHA_REUSE_THRESHOLD, 1);
  });

  it('the flag constant is the dedicated ENABLE_LUSHA_LOCAL_REUSE_GATE name', () => {
    assert.equal(LUSHA_LOCAL_REUSE_GATE_FLAG, 'ENABLE_LUSHA_LOCAL_REUSE_GATE');
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
    assert.equal(isActionableReusableLushaCandidate(candidate()), true);
  });

  it('pending_review + email + NO LinkedIn => still reusable (LinkedIn is optional and never read)', () => {
    // The row shape has no LinkedIn field at all — proving it cannot influence the decision.
    assert.equal('linkedinUrl' in candidate(), false);
    assert.equal(isActionableReusableLushaCandidate(candidate()), true);
  });

  it('pending_review WITHOUT email => NOT reusable', () => {
    assert.equal(isActionableReusableLushaCandidate(candidate({ email: null })), false);
    assert.equal(isActionableReusableLushaCandidate(candidate({ email: '   ' })), false);
  });

  it('missing / blank Lusha native id => NOT reusable', () => {
    assert.equal(isActionableReusableLushaCandidate(candidate({ sourceContactId: null })), false);
    assert.equal(isActionableReusableLushaCandidate(candidate({ sourceContactId: ' ' })), false);
  });

  it('Apollo candidate => never reusable by the Lusha local gate', () => {
    assert.equal(isActionableReusableLushaCandidate(candidate({ source: 'apollo' })), false);
    // Even a perfect Apollo row with every other field satisfied stays out.
    const perfectApollo = candidate({ source: 'apollo', sourceContactId: 'apollo-person-1' });
    assert.equal(isActionableReusableLushaCandidate(perfectApollo), false);
  });
});

// ── Suppress-only contract ──────────────────────────────────────

describe('suppress-only states never satisfy local reuse', () => {
  const cases: Array<[string, Partial<ReusableLushaCandidateRowV1>]> = [
    ['approved', { status: 'approved' }],
    ['discarded', { status: 'discarded' }],
    ['status duplicate', { status: 'duplicate' }],
    ['possible_duplicate', { duplicateStatus: 'possible_duplicate' }],
    ['exact_duplicate', { duplicateStatus: 'exact_duplicate' }],
    ['unchecked duplicate_status', { duplicateStatus: 'unchecked' }],
    ['pending_review without email', { email: null }],
  ];

  for (const [label, overrides] of cases) {
    it(`${label} => NOT reusable`, () => {
      assert.equal(isActionableReusableLushaCandidate(candidate(overrides)), false);
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
    const selection = selectActionableReusableLushaCandidates(
      CURRENT_REQUEST_ID,
      company({ accountId: ACCOUNT_A }),
      [candidate({ company: company({ accountId: ACCOUNT_A }) })],
    );
    assert.equal(selection.actionableCount, 1);
    assert.equal(selection.companyScopeKind, 'account_id');
  });

  it('account_id disagreement => NOT the same company even when HubSpot id and domain agree', () => {
    const selection = selectActionableReusableLushaCandidates(
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
    const selection = selectActionableReusableLushaCandidates(
      CURRENT_REQUEST_ID,
      company({ hubspotCompanyId: 'hs-77' }),
      [candidate({ company: company({ accountId: ACCOUNT_B, hubspotCompanyId: 'hs-77' }) })],
    );
    assert.equal(selection.actionableCount, 1);
    assert.equal(selection.companyScopeKind, 'hubspot_company_id');
  });

  it('only shared key is the normalized domain => deterministic domain match', () => {
    const selection = selectActionableReusableLushaCandidates(
      CURRENT_REQUEST_ID,
      company({ companyDomain: 'https://WWW.Acme.com/careers' }),
      [candidate({ company: company({ companyDomain: 'acme.com' }) })],
    );
    assert.equal(selection.actionableCount, 1);
    assert.equal(selection.companyScopeKind, 'company_domain');
  });

  it('different normalized domains => NOT reusable', () => {
    const selection = selectActionableReusableLushaCandidates(
      CURRENT_REQUEST_ID,
      company({ companyDomain: 'acme.com' }),
      [candidate({ company: company({ companyDomain: 'notacme.com' }) })],
    );
    assert.equal(selection.actionableCount, 0);
  });

  it('company NAME agreement alone => never reusable (no name field exists to compare)', () => {
    const nameOnlyCurrent = company();
    assert.equal(
      selectActionableReusableLushaCandidates(CURRENT_REQUEST_ID, nameOnlyCurrent, [candidate()])
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
    const selection = selectActionableReusableLushaCandidates(
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
    const result = await evaluateLushaLocalCandidateReuseGate(
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
