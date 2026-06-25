/**
 * Tests — Agent 1 v1.16J — Employee Size Resolver for ICP Gate
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — rich_profile.size.estimated_range="10001+"              → selectedSource=rich_profile_size, gate pass
 * F2  — rich_profile.size.estimated_range="51-200"             → selectedSource=rich_profile_size, gate block
 * F3  — rich_profile unknown + company_size="10001+"           → selectedSource=candidate_company_size, gate pass
 * F4  — rich_profile unknown + company_size="51-200"           → selectedSource=candidate_company_size, gate block
 * F5  — rich_profile unknown + company_size=null + HS=500      → selectedSource=hubspot_number_of_employees, gate pass
 * F6  — HubSpot employees=200                                  → gate block
 * F7  — rich_profile="201-500" + company_size="51-200"         → rich_profile wins, gate pass
 * F8  — company_size invalid string                            → falls through to next source or unknown
 * F9  — all sources unknown                                    → selectedSource=unknown, gate needs_validation
 * F10 — attemptedSources includes all three checked sources
 * F11 — resolveEmployeeSizeForIcpGate returns selected_source populated
 * F12 — company_size="10001+" + no rich_profile size           → gate pass
 * F13 — company_size="51-200"                                  → gate block
 * F14 — HubSpot employees=500 + no other size                  → gate pass
 * F15 — no size anywhere                                       → needs_validation
 * F16 — company_size="10001+" with null rich_profile range     → estimated_range NOT invented
 * F17 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false + DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEmployeeSizeForIcpGate,
  extractHubSpotMatchedEmployees,
  extractCandidateCompanySize,
} from '../employee-size-resolver';
import { evaluateIcpSizeGate } from '../icp-size-gate';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveAndEvaluate(input: Parameters<typeof resolveEmployeeSizeForIcpGate>[0]) {
  const resolved = resolveEmployeeSizeForIcpGate(input);
  const gateResult = evaluateIcpSizeGate(resolved.icpInput);
  return { resolved, gateResult };
}

// ─── F1 — rich_profile.size.estimated_range="10001+" ─────────────────────────

describe('F1 — rich_profile.size.estimated_range="10001+" → selectedSource=rich_profile_size, gate pass', () => {
  it('selectedSource = rich_profile_size', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '10001+', status: 'estimated', source: 'snippet' },
    });
    assert.equal(resolved.selectedSource, 'rich_profile_size');
  });

  it('selectedValue = "10001+"', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '10001+', status: 'estimated', source: 'snippet' },
    });
    assert.equal(resolved.selectedValue, '10001+');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '10001+', status: 'estimated', source: 'snippet' },
    });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F2 — rich_profile.size.estimated_range="51-200" ─────────────────────────

describe('F2 — rich_profile.size.estimated_range="51-200" → selectedSource=rich_profile_size, gate block', () => {
  it('selectedSource = rich_profile_size', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '51-200', status: 'estimated' },
    });
    assert.equal(resolved.selectedSource, 'rich_profile_size');
  });

  it('gate decision = block', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '51-200', status: 'estimated' },
    });
    assert.equal(gateResult.decision, 'block');
  });
});

// ─── F3 — rich_profile unknown + company_size="10001+" ───────────────────────

describe('F3 — rich_profile unknown + company_size="10001+" → selectedSource=candidate_company_size, gate pass', () => {
  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '10001+',
    });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '10001+',
    });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F4 — rich_profile unknown + company_size="51-200" ───────────────────────

describe('F4 — rich_profile unknown + company_size="51-200" → selectedSource=candidate_company_size, gate block', () => {
  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '51-200',
    });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = block', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '51-200',
    });
    assert.equal(gateResult.decision, 'block');
  });
});

// ─── F5 — rich_profile unknown + company_size=null + HubSpot=500 ─────────────

describe('F5 — rich_profile unknown + company_size=null + HubSpot=500 → selectedSource=hubspot_number_of_employees, gate pass', () => {
  it('selectedSource = hubspot_number_of_employees', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: null,
      matchedHubspotEmployees: 500,
    });
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
  });

  it('selectedValue = 500', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: null,
      matchedHubspotEmployees: 500,
    });
    assert.equal(resolved.selectedValue, 500);
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: null,
      matchedHubspotEmployees: 500,
    });
    assert.equal(gateResult.decision, 'pass');
  });

  it('confidence = high (HubSpot is a confirmed count)', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: null,
      matchedHubspotEmployees: 500,
    });
    assert.equal(resolved.confidence, 'high');
  });
});

// ─── F6 — HubSpot employees=200 ──────────────────────────────────────────────

describe('F6 — HubSpot employees=200 → gate block', () => {
  it('gate decision = block (200 does not exceed threshold)', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: 200,
    });
    assert.equal(gateResult.decision, 'block');
  });

  it('selectedSource = hubspot_number_of_employees', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: 200,
    });
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
  });
});

// ─── F7 — rich_profile="201-500" + company_size="51-200" → rich_profile wins ─

describe('F7 — rich_profile="201-500" + company_size="51-200" → rich_profile wins, gate pass', () => {
  it('selectedSource = rich_profile_size', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '201-500', status: 'estimated' },
      candidateCompanySize: '51-200',
    });
    assert.equal(resolved.selectedSource, 'rich_profile_size');
  });

  it('selectedValue = "201-500"', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '201-500', status: 'estimated' },
      candidateCompanySize: '51-200',
    });
    assert.equal(resolved.selectedValue, '201-500');
  });

  it('gate decision = pass (min=201 > 200)', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '201-500', status: 'estimated' },
      candidateCompanySize: '51-200',
    });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F8 — company_size invalid string ────────────────────────────────────────

describe('F8 — company_size invalid string → falls through to next source or unknown', () => {
  it('invalid string "unknown" is skipped, falls through to HubSpot if available', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null },
      candidateCompanySize: 'unknown',
      matchedHubspotEmployees: 300,
    });
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
  });

  it('invalid string with no other sources → selectedSource=unknown', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: 'n/a',
      matchedHubspotEmployees: null,
    });
    assert.equal(resolved.selectedSource, 'unknown');
  });

  it('empty string → selectedSource=unknown when no other sources', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: '',
      matchedHubspotEmployees: null,
    });
    assert.equal(resolved.selectedSource, 'unknown');
  });
});

// ─── F9 — all sources unknown ─────────────────────────────────────────────────

describe('F9 — all sources unknown → selectedSource=unknown, gate needs_validation', () => {
  it('selectedSource = unknown', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: null,
      matchedHubspotEmployees: null,
    });
    assert.equal(resolved.selectedSource, 'unknown');
  });

  it('selectedValue = null', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: null,
    });
    assert.equal(resolved.selectedValue, null);
  });

  it('gate decision = needs_validation', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: null,
    });
    assert.equal(gateResult.decision, 'needs_validation');
  });

  it('confidence = unknown', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: null,
    });
    assert.equal(resolved.confidence, 'unknown');
  });
});

// ─── F10 — attemptedSources includes all three ───────────────────────────────

describe('F10 — attemptedSources includes all three checked sources', () => {
  it('has rich_profile_size, candidate_company_size, hubspot_number_of_employees', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null },
      candidateCompanySize: null,
      matchedHubspotEmployees: null,
    });
    const sources = resolved.attemptedSources.map((s) => s.source);
    assert.ok(sources.includes('rich_profile_size'), 'missing rich_profile_size');
    assert.ok(sources.includes('candidate_company_size'), 'missing candidate_company_size');
    assert.ok(sources.includes('hubspot_number_of_employees'), 'missing hubspot_number_of_employees');
  });

  it('all three are marked unusable when no data', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: null,
    });
    assert.ok(resolved.attemptedSources.every((s) => !s.usable));
  });

  it('selected source is marked usable when data exists', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '10001+', status: 'estimated' },
    });
    const richEntry = resolved.attemptedSources.find((s) => s.source === 'rich_profile_size');
    assert.ok(richEntry?.usable);
  });

  it('stops at first usable source — later sources not recorded when early source wins', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: '10001+', status: 'estimated' },
      candidateCompanySize: '51-200',
      matchedHubspotEmployees: 100,
    });
    // Only rich_profile_size is attempted (first wins, others skipped)
    assert.equal(resolved.attemptedSources.length, 1);
    assert.equal(resolved.attemptedSources[0].source, 'rich_profile_size');
  });
});

// ─── F11 — resolver output has selected_source populated ─────────────────────

describe('F11 — resolveEmployeeSizeForIcpGate returns selected_source populated when data exists', () => {
  it('selected_source is populated (not "unknown") when there is size data', () => {
    const resolved = resolveEmployeeSizeForIcpGate({
      richProfileSize: { estimated_range: '201-500', status: 'estimated' },
    });
    assert.notEqual(resolved.selectedSource, 'unknown');
    assert.ok(resolved.selectedSource.length > 0);
  });

  it('reason string is non-empty', () => {
    const resolved = resolveEmployeeSizeForIcpGate({
      richProfileSize: { estimated_range: '201-500', status: 'estimated' },
    });
    assert.ok(resolved.reason.length > 0);
  });

  it('metadata shape includes all required fields for employee_size_resolution', () => {
    const resolved = resolveEmployeeSizeForIcpGate({
      richProfileSize: { estimated_range: '201-500', status: 'estimated' },
    });
    assert.ok('selectedSource' in resolved);
    assert.ok('selectedValue' in resolved);
    assert.ok('confidence' in resolved);
    assert.ok('reason' in resolved);
    assert.ok('attemptedSources' in resolved);
    assert.ok('icpInput' in resolved);
  });
});

// ─── F12 — company_size="10001+" + no rich_profile size → gate pass ──────────

describe('F12 — company_size="10001+" and no rich_profile size → gate pass', () => {
  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '10001+',
    });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '10001+',
    });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F13 — company_size="51-200" → gate block ────────────────────────────────

describe('F13 — company_size="51-200" → gate block', () => {
  it('gate decision = block', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: '51-200',
    });
    assert.equal(gateResult.decision, 'block');
  });
});

// ─── F14 — HubSpot employees=500 + no other size → gate pass ─────────────────

describe('F14 — HubSpot employees=500 + no other size → gate pass', () => {
  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: 500,
    });
    assert.equal(gateResult.decision, 'pass');
  });

  it('selectedSource = hubspot_number_of_employees', () => {
    const { resolved } = resolveAndEvaluate({
      richProfileSize: null,
      candidateCompanySize: null,
      matchedHubspotEmployees: 500,
    });
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
  });
});

// ─── F15 — no size anywhere → needs_validation ───────────────────────────────

describe('F15 — no size anywhere → needs_validation', () => {
  it('gate decision = needs_validation', () => {
    const { gateResult } = resolveAndEvaluate({});
    assert.equal(gateResult.decision, 'needs_validation');
  });

  it('gate requires_human_review = true', () => {
    const { gateResult } = resolveAndEvaluate({});
    assert.equal(gateResult.requires_human_review, true);
  });
});

// ─── F16 — estimated_range NOT invented ──────────────────────────────────────

describe('F16 — company_size="10001+" with null rich_profile range → estimated_range remains null', () => {
  it('resolver does NOT set estimated_range when source is company_size', () => {
    const resolved = resolveEmployeeSizeForIcpGate({
      richProfileSize: { estimated_range: null, status: 'unknown' },
      candidateCompanySize: '10001+',
    });
    // icpInput uses sizeRange from company_size but we do NOT assert estimated_range was set
    // because the resolver never writes back to richProfileSize
    assert.equal(resolved.selectedSource, 'candidate_company_size');
    assert.equal(resolved.selectedValue, '10001+');
    // icpInput.sizeRange is set from company_size
    assert.equal(resolved.icpInput.sizeRange, '10001+');
    // No employeeCount invented
    assert.equal(resolved.icpInput.employeeCount, undefined);
  });

  it('richProfileSize input is not mutated', () => {
    const richProfileSize = { estimated_range: null as string | null, status: 'unknown' as const };
    resolveEmployeeSizeForIcpGate({
      richProfileSize,
      candidateCompanySize: '10001+',
    });
    // Original object must remain unchanged
    assert.equal(richProfileSize.estimated_range, null);
  });
});

// ─── F17 — default configs unchanged ─────────────────────────────────────────

describe('F17 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false and DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false not altered', () => {
  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });
});

// ─── Extra: extractHubSpotMatchedEmployees defensivo ─────────────────────────

describe('extractHubSpotMatchedEmployees — defensivo', () => {
  it('returns null for null input', () => {
    assert.equal(extractHubSpotMatchedEmployees(null), null);
  });

  it('returns null for non-object', () => {
    assert.equal(extractHubSpotMatchedEmployees('string'), null);
  });

  it('parses numberofemployees as string number', () => {
    assert.equal(extractHubSpotMatchedEmployees({ numberofemployees: '500' }), 500);
  });

  it('parses numberofemployees as number', () => {
    assert.equal(extractHubSpotMatchedEmployees({ numberofemployees: 500 }), 500);
  });

  it('returns null for non-numeric string', () => {
    assert.equal(extractHubSpotMatchedEmployees({ numberofemployees: 'many' }), null);
  });

  it('returns null when field missing', () => {
    assert.equal(extractHubSpotMatchedEmployees({ id: 'abc123' }), null);
  });

  it('also checks numberOfEmployees (camelCase variant)', () => {
    assert.equal(extractHubSpotMatchedEmployees({ numberOfEmployees: '300' }), 300);
  });
});

// ─── Helpers para F18–F25 ─────────────────────────────────────────────────────

function resolveViaExtractor(
  candidateObj: unknown,
  richProfileSize?: Parameters<typeof resolveEmployeeSizeForIcpGate>[0]['richProfileSize'],
  matchedHubspotEmployees?: number | null,
) {
  const extracted = extractCandidateCompanySize(candidateObj);
  const resolved = resolveEmployeeSizeForIcpGate({
    richProfileSize,
    candidateCompanySize: extracted,
    matchedHubspotEmployees: matchedHubspotEmployees ?? null,
  });
  const gateResult = evaluateIcpSizeGate(resolved.icpInput);
  return { extracted, resolved, gateResult };
}

// ─── F18 — candidate.company_size="10001+" ────────────────────────────────────

describe('F18 — candidate.company_size="10001+" → selected_source=candidate_company_size, gate pass', () => {
  it('extractCandidateCompanySize returns "10001+"', () => {
    assert.equal(extractCandidateCompanySize({ company_size: '10001+' }), '10001+');
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveViaExtractor({ company_size: '10001+' });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveViaExtractor({ company_size: '10001+' });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F19 — candidate.company_size="51-200" ────────────────────────────────────

describe('F19 — candidate.company_size="51-200" → selected_source=candidate_company_size, gate block', () => {
  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveViaExtractor({ company_size: '51-200' });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = block', () => {
    const { gateResult } = resolveViaExtractor({ company_size: '51-200' });
    assert.equal(gateResult.decision, 'block');
  });
});

// ─── F20 — candidate.companySize="201-500" ────────────────────────────────────

describe('F20 — candidate.companySize="201-500" → selected_source=candidate_company_size, gate pass', () => {
  it('extractCandidateCompanySize reads camelCase field', () => {
    assert.equal(extractCandidateCompanySize({ companySize: '201-500' }), '201-500');
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveViaExtractor({ companySize: '201-500' });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = pass (min=201 > threshold 200)', () => {
    const { gateResult } = resolveViaExtractor({ companySize: '201-500' });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F21 — candidate.employee_count=500 ──────────────────────────────────────

describe('F21 — candidate.employee_count=500 → selected_source=candidate_company_size, gate pass', () => {
  it('extractCandidateCompanySize reads numeric employee_count', () => {
    const val = extractCandidateCompanySize({ employee_count: 500 });
    assert.equal(val, '500');
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveViaExtractor({ employee_count: 500 });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveViaExtractor({ employee_count: 500 });
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F22 — candidate.scoring.metadata.company_size="51-200" ──────────────────

describe('F22 — candidate.scoring.metadata.company_size="51-200" → selected_source=candidate_company_size, gate block', () => {
  it('extractCandidateCompanySize reads nested scoring.metadata.company_size', () => {
    const val = extractCandidateCompanySize({
      scoring: { metadata: { company_size: '51-200' } },
    });
    assert.equal(val, '51-200');
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveViaExtractor({
      scoring: { metadata: { company_size: '51-200' } },
    });
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = block', () => {
    const { gateResult } = resolveViaExtractor({
      scoring: { metadata: { company_size: '51-200' } },
    });
    assert.equal(gateResult.decision, 'block');
  });
});

// ─── F23 — company size ausente → fallback a HubSpot o unknown ───────────────

describe('F23 — no company size fields → falls back to HubSpot or unknown', () => {
  it('extractor returns null when no size field present', () => {
    assert.equal(extractCandidateCompanySize({ name: 'Acme', website: 'acme.com' }), null);
  });

  it('falls back to HubSpot when hubspot employees available', () => {
    const { resolved } = resolveViaExtractor(
      { name: 'Acme' },
      { estimated_range: null, status: 'unknown' },
      500,
    );
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
  });

  it('selectedSource = unknown when no source has data', () => {
    const { resolved } = resolveViaExtractor({ name: 'Acme' });
    assert.equal(resolved.selectedSource, 'unknown');
  });
});

// ─── F24 — rich_profile gana sobre candidate.company_size ────────────────────

describe('F24 — rich_profile.size.estimated_range="201-500" + candidate.company_size="51-200" → rich_profile wins, pass', () => {
  it('selectedSource = rich_profile_size', () => {
    const { resolved } = resolveViaExtractor(
      { company_size: '51-200' },
      { estimated_range: '201-500', status: 'estimated' },
    );
    assert.equal(resolved.selectedSource, 'rich_profile_size');
  });

  it('selectedValue = "201-500" (not "51-200")', () => {
    const { resolved } = resolveViaExtractor(
      { company_size: '51-200' },
      { estimated_range: '201-500', status: 'estimated' },
    );
    assert.equal(resolved.selectedValue, '201-500');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveViaExtractor(
      { company_size: '51-200' },
      { estimated_range: '201-500', status: 'estimated' },
    );
    assert.equal(gateResult.decision, 'pass');
  });
});

// ─── F25 — no muta rich_profile.size.estimated_range ────────────────────────

describe('F25 — candidate.company_size="10001+" + rich_profile.size.estimated_range=null → rich_profile not mutated', () => {
  it('rich_profile.size.estimated_range remains null after resolution', () => {
    const richProfileSize = { estimated_range: null as string | null, status: 'unknown' as const };
    resolveViaExtractor({ company_size: '10001+' }, richProfileSize);
    assert.equal(richProfileSize.estimated_range, null);
  });

  it('selectedValue = "10001+" from candidate.company_size', () => {
    const { resolved } = resolveViaExtractor(
      { company_size: '10001+' },
      { estimated_range: null, status: 'unknown' },
    );
    assert.equal(resolved.selectedValue, '10001+');
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveViaExtractor(
      { company_size: '10001+' },
      { estimated_range: null, status: 'unknown' },
    );
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });
});
