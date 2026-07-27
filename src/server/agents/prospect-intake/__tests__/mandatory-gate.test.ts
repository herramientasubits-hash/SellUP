/**
 * Q3F-5BB.10B2 — Shared mandatory gate tests.
 *
 * Exercises the pure `evaluateProspectIntakeGate` + `buildProspectIntakeGateAuditEntry`
 * across hand-built candidates and the three provider fixtures. No runtime, no
 * I/O, no provider calls, no DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateProspectIntakeGate,
  buildProspectIntakeGateAuditEntry,
  getProspectIntakeGateReasonSeverity,
  DEFAULT_PROSPECT_INTAKE_GATE_POLICY,
} from '../gate';
import { normalizeProviderDiscoveredCompany } from '../normalize';
import type {
  NormalizedProspectCandidate,
  ProspectSearchCriteria,
  ProviderDiscoveredCompany,
} from '../types';

import { mapLushaCompanyToProviderDiscoveredCompany } from '../adapters/lusha';
import { mapApolloCompanyToProviderDiscoveredCompany } from '../adapters/apollo';
import { mapWebAiCompanyToProviderDiscoveredCompany } from '../adapters/tavily';
import { lushaCompanyFixture } from './fixtures/lusha-company';
import { apolloOrganizationFixture } from './fixtures/apollo-company';
import { webAiCompanyFixture } from './fixtures/tavily-company';

/**
 * A fully-clean provider record: name + domain + matching country + headcount
 * above the minimum + a corporate LinkedIn.
 */
const CLEAN_DISCOVERED: ProviderDiscoveredCompany = {
  provider: 'lusha',
  providerRecordId: 'clean-001',
  companyName: 'Clean Co SAS',
  domain: 'clean-co.example',
  websiteUrl: 'https://clean-co.example',
  linkedinUrl: 'https://www.linkedin.com/company/clean-co',
  countryCode: 'CO',
  employeeCount: 120,
};

const CLEAN_CRITERIA: ProspectSearchCriteria = { countryCode: 'CO', minEmployees: 50 };

function normalize(
  discovered: ProviderDiscoveredCompany,
  criteria: ProspectSearchCriteria,
): NormalizedProspectCandidate {
  return normalizeProviderDiscoveredCompany(discovered, criteria);
}

// ─── A. Clean candidate ──────────────────────────────────────────────────────
describe('A. clean candidate', () => {
  it('is reviewable_clean with no hard reasons and no warnings', () => {
    const candidate = normalize(CLEAN_DISCOVERED, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'reviewable_clean');
    assert.deepEqual(result.hardReasons, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.summary.cleanForReview, true);
    assert.equal(result.summary.hardExcluded, false);
    assert.equal(result.summary.requiresHumanReview, false);
  });
});

// ─── B. Missing name (hard) ──────────────────────────────────────────────────
describe('B. missing name', () => {
  it('is hard_excluded with missing_name', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, companyName: null }, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'hard_excluded');
    assert.ok(result.hardReasons.includes('missing_name'));
    assert.equal(result.summary.hardExcluded, true);
  });
});

// ─── C. Missing domain (hard) ────────────────────────────────────────────────
describe('C. missing domain', () => {
  it('is hard_excluded with missing_domain', () => {
    const candidate = normalize(
      { ...CLEAN_DISCOVERED, domain: null, websiteUrl: null },
      CLEAN_CRITERIA,
    );
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'hard_excluded');
    assert.ok(result.hardReasons.includes('missing_domain'));
  });
});

// ─── D. Country mismatch (hard) ──────────────────────────────────────────────
describe('D. country mismatch', () => {
  it('is hard_excluded with country_mismatch', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, countryCode: 'MX' }, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'hard_excluded');
    assert.ok(result.hardReasons.includes('country_mismatch'));
  });
});

// ─── E. Known employee count below min (hard) ────────────────────────────────
describe('E. known employee count below min', () => {
  it('is hard_excluded with known_employee_count_below_min', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, employeeCount: 5 }, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'hard_excluded');
    assert.ok(result.hardReasons.includes('known_employee_count_below_min'));
  });
});

// ─── F. employeeCount null → warning ─────────────────────────────────────────
describe('F. unknown employee count', () => {
  it('is reviewable_with_warnings with employee_count_unknown, never hard', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, employeeCount: null }, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'reviewable_with_warnings');
    assert.ok(result.warnings.includes('employee_count_unknown'));
    assert.ok(!result.hardReasons.includes('known_employee_count_below_min'));
    assert.equal(result.summary.requiresHumanReview, true);
  });
});

// ─── G. Missing corporate LinkedIn → warning ─────────────────────────────────
describe('G. missing corporate LinkedIn', () => {
  it('is reviewable_with_warnings with missing_corporate_linkedin, never hard', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, linkedinUrl: null }, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'reviewable_with_warnings');
    assert.ok(result.warnings.includes('missing_corporate_linkedin'));
    assert.ok(!result.hardReasons.includes('missing_corporate_linkedin'));
  });
});

// ─── H. Personal LinkedIn rejected by normalizer → warning ───────────────────
describe('H. personal LinkedIn rejected by normalizer', () => {
  it('leaves corporateLinkedinUrl null and warns missing_corporate_linkedin', () => {
    const candidate = normalize(
      { ...CLEAN_DISCOVERED, linkedinUrl: 'https://www.linkedin.com/in/some-person' },
      CLEAN_CRITERIA,
    );
    assert.equal(candidate.corporateLinkedinUrl, null);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'reviewable_with_warnings');
    assert.ok(result.warnings.includes('missing_corporate_linkedin'));
  });
});

// ─── I. Multiple hard reasons ────────────────────────────────────────────────
describe('I. multiple hard reasons', () => {
  it('is hard_excluded and keeps every hard reason', () => {
    const candidate = normalize(
      { ...CLEAN_DISCOVERED, companyName: null, domain: null, websiteUrl: null, countryCode: 'MX' },
      CLEAN_CRITERIA,
    );
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'hard_excluded');
    assert.ok(result.hardReasons.includes('missing_name'));
    assert.ok(result.hardReasons.includes('missing_domain'));
    assert.ok(result.hardReasons.includes('country_mismatch'));
  });
});

// ─── J. Warning + hard together ──────────────────────────────────────────────
describe('J. warning + hard together', () => {
  it('is hard_excluded but may still carry warnings for audit', () => {
    // Below-min headcount (hard) + missing LinkedIn (warning).
    const candidate = normalize(
      { ...CLEAN_DISCOVERED, employeeCount: 5, linkedinUrl: null },
      CLEAN_CRITERIA,
    );
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(result.decision, 'hard_excluded');
    assert.ok(result.hardReasons.includes('known_employee_count_below_min'));
    assert.ok(result.warnings.includes('missing_corporate_linkedin'));
  });
});

// ─── K. Provider-agnostic ────────────────────────────────────────────────────
describe('K. provider-agnostic consistency', () => {
  it('applies the same criteria across Lusha / Apollo / Tavily fixtures', () => {
    // All three fixtures have a name + domain; apply each provider's own country.
    const lusha = evaluateProspectIntakeGate(
      normalize(mapLushaCompanyToProviderDiscoveredCompany(lushaCompanyFixture), {
        countryCode: 'CO',
        minEmployees: 10,
      }),
      { countryCode: 'CO', minEmployees: 10 },
    );
    const apollo = evaluateProspectIntakeGate(
      normalize(mapApolloCompanyToProviderDiscoveredCompany(apolloOrganizationFixture), {
        countryCode: 'MX',
        minEmployees: 10,
      }),
      { countryCode: 'MX', minEmployees: 10 },
    );
    const tavily = evaluateProspectIntakeGate(
      normalize(mapWebAiCompanyToProviderDiscoveredCompany(webAiCompanyFixture), {
        countryCode: 'PE',
        minEmployees: 10,
      }),
      { countryCode: 'PE', minEmployees: 10 },
    );

    // Lusha fixture is complete → clean. Apollo has no corporate LinkedIn? it
    // does (globex company URL) but no… it has one, and headcount 1200 ≥ 10 →
    // clean. Tavily has no LinkedIn and no employees → warnings, never hard.
    assert.equal(lusha.decision, 'reviewable_clean');
    assert.equal(lusha.summary.hardExcluded, false);
    assert.equal(apollo.summary.hardExcluded, false);
    assert.equal(tavily.summary.hardExcluded, false);
    assert.equal(tavily.decision, 'reviewable_with_warnings');
    assert.ok(tavily.warnings.includes('missing_corporate_linkedin'));
    assert.ok(tavily.warnings.includes('employee_count_unknown'));
  });
});

// ─── L. Audit entry ──────────────────────────────────────────────────────────
describe('L. audit entry', () => {
  it('is bounded and safe (no raw payload), with provider/name/domain/reasons', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, employeeCount: 5 }, CLEAN_CRITERIA);
    const result = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    const entry = buildProspectIntakeGateAuditEntry(candidate, result);

    assert.equal(entry.provider, 'lusha');
    assert.equal(entry.name, 'Clean Co SAS');
    assert.equal(entry.domain, 'clean-co.example');
    assert.equal(entry.decision, 'hard_excluded');
    assert.equal(entry.reason, 'known_employee_count_below_min');
    assert.ok(entry.reasons.includes('known_employee_count_below_min'));
    assert.equal(entry.countryCode, 'CO');
    assert.equal(entry.requestedCountryCode, 'CO');
    assert.equal(entry.hasCorporateLinkedin, true);

    // Bounded: the entry exposes only the known safe keys — no payload/raw leak.
    const allowed = new Set([
      'provider',
      'decision',
      'reason',
      'reasons',
      'name',
      'domain',
      'employeeCount',
      'countryCode',
      'requestedCountryCode',
      'hasCorporateLinkedin',
    ]);
    for (const key of Object.keys(entry)) {
      assert.ok(allowed.has(key), `unexpected audit key "${key}"`);
    }
  });
});

// ─── M. Policy override ──────────────────────────────────────────────────────
describe('M. policy override', () => {
  it('requireCorporateLinkedin=true turns a missing LinkedIn into a hard exclude', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, linkedinUrl: null }, CLEAN_CRITERIA);
    const strict = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA, {
      requireCorporateLinkedin: true,
    });
    assert.equal(strict.decision, 'hard_excluded');
    assert.ok(strict.hardReasons.includes('missing_corporate_linkedin'));

    // Default stays soft.
    const lenient = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.equal(lenient.decision, 'reviewable_with_warnings');
    assert.ok(lenient.warnings.includes('missing_corporate_linkedin'));
  });

  it('does not mutate the shared default policy', () => {
    const before = JSON.stringify(DEFAULT_PROSPECT_INTAKE_GATE_POLICY);
    evaluateProspectIntakeGate(normalize(CLEAN_DISCOVERED, CLEAN_CRITERIA), CLEAN_CRITERIA, {
      requireDomain: false,
    });
    assert.equal(JSON.stringify(DEFAULT_PROSPECT_INTAKE_GATE_POLICY), before);
  });
});

// ─── Reason severity + purity ────────────────────────────────────────────────
describe('reason severity + purity', () => {
  it('classifies hard vs warning reasons correctly', () => {
    assert.equal(getProspectIntakeGateReasonSeverity('missing_name'), 'hard');
    assert.equal(getProspectIntakeGateReasonSeverity('missing_domain'), 'hard');
    assert.equal(getProspectIntakeGateReasonSeverity('country_mismatch'), 'hard');
    assert.equal(getProspectIntakeGateReasonSeverity('known_employee_count_below_min'), 'hard');
    assert.equal(getProspectIntakeGateReasonSeverity('employee_count_unknown'), 'warning');
    assert.equal(getProspectIntakeGateReasonSeverity('missing_corporate_linkedin'), 'warning');
    assert.equal(getProspectIntakeGateReasonSeverity('low_provider_confidence'), 'warning');
  });

  it('does not mutate the candidate', () => {
    const candidate = normalize(CLEAN_DISCOVERED, CLEAN_CRITERIA);
    const snapshot = JSON.stringify(candidate);
    evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA, { requireCorporateLinkedin: true });
    assert.equal(JSON.stringify(candidate), snapshot);
  });

  it('is deterministic (same inputs → deep-equal result)', () => {
    const candidate = normalize({ ...CLEAN_DISCOVERED, employeeCount: null }, CLEAN_CRITERIA);
    const a = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    const b = evaluateProspectIntakeGate(candidate, CLEAN_CRITERIA);
    assert.deepEqual(a, b);
  });
});
