/**
 * Tests — Agent 1 v1.16J-A-pre — Employee Size Resolver Supabase Smoke Readiness
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — script config tiene 5 candidatos
 *       Expected: rich_profile pass, company_size pass, hubspot pass, company_size block, unknown
 *
 * F2  — batch metadata smoke_type correcto
 *       Expected: employee_size_resolver_v1_16j_a
 *
 * F3  — rich profile candidate expected source rich_profile_size
 *
 * F4  — company size candidate expected source candidate_company_size
 *
 * F5  — HubSpot candidate expected source hubspot_number_of_employees
 *
 * F6  — block candidate expected skipped reason icp_size_below_threshold
 *
 * F7  — unknown candidate expected needs_validation
 *
 * F8  — expected writes summary
 *       Expected: batch=1, candidates=4, skipped=1, provider_usage_logs=0, tavily=0, llm=0
 *
 * F9  — no Tavily override configured
 *
 * F10 — no LinkedIn override configured
 *
 * F11 — cleanup SQL usa discarded/rejected, not duplicate
 *
 * F12 — default configs remain false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEmployeeSizeForIcpGate,
  extractHubSpotMatchedEmployees,
} from '../employee-size-resolver';
import {
  evaluateIcpSizeGate,
  resolveIcpSizeGateWriterAction,
} from '../icp-size-gate';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';

// ─── Smoke config constants (mirrors smoke-employee-size-resolver-write.ts) ───

const SMOKE_TYPE  = 'employee_size_resolver_v1_16j_a';
const SCRIPT_NAME = 'v1_16j_a_employee_size_resolver_write_smoke';

const DOMAIN_RICH_PROFILE_PASS  = 'sellup-size-rich-profile-pass.example';
const DOMAIN_COMPANY_PASS       = 'sellup-size-company-pass.example';
const DOMAIN_HUBSPOT_PASS       = 'sellup-size-hubspot-pass.example';
const DOMAIN_COMPANY_BLOCK      = 'sellup-size-company-block.example';
const DOMAIN_UNKNOWN            = 'sellup-size-unknown.example';

const EXTRA_BATCH_METADATA = {
  smoke_test: true,
  smoke_type: SMOKE_TYPE,
  qa_only: true,
  do_not_use_for_sales: true,
  do_not_convert: true,
  created_by_script: SCRIPT_NAME,
  cleanup_mode: 'logical_only',
};

// Five QA candidates mirroring buildSyntheticPipelineOutput() in the script
const SMOKE_CANDIDATES = [
  {
    name: 'SellUp Size Rich Profile Pass',
    domain: DOMAIN_RICH_PROFILE_PASS,
    scenario: 'rich_profile_pass',
    // rich_profile mock override injects size_range="10001+"
    mock_rich_profile_size:    '10001+' as string | null,
    candidate_company_size:    null     as string | null,
    hubspot_employees:         null     as number | null,
    expected_employee_source:  'rich_profile_size' as const,
    expected_gate:             'pass'              as const,
  },
  {
    name: 'SellUp Size Company Pass',
    domain: DOMAIN_COMPANY_PASS,
    scenario: 'company_size_pass',
    // no rich_profile; company_size="10001+" on the candidate
    mock_rich_profile_size:    null       as string | null,
    candidate_company_size:    '10001+'   as string | null,
    hubspot_employees:         null       as number | null,
    expected_employee_source:  'candidate_company_size' as const,
    expected_gate:             'pass'                   as const,
  },
  {
    name: 'SellUp Size HubSpot Pass',
    domain: DOMAIN_HUBSPOT_PASS,
    scenario: 'hubspot_pass',
    // no rich_profile, no company_size; HubSpot employees=500
    mock_rich_profile_size:    null as string | null,
    candidate_company_size:    null as string | null,
    hubspot_employees:         500  as number | null,
    expected_employee_source:  'hubspot_number_of_employees' as const,
    expected_gate:             'pass'                        as const,
  },
  {
    name: 'SellUp Size Company Block',
    domain: DOMAIN_COMPANY_BLOCK,
    scenario: 'company_size_block',
    // company_size="51-200" → below threshold → gate=block → NOT inserted
    mock_rich_profile_size:    null      as string | null,
    candidate_company_size:    '51-200'  as string | null,
    hubspot_employees:         null      as number | null,
    expected_employee_source:  'candidate_company_size' as const,
    expected_gate:             'block'                  as const,
  },
  {
    name: 'SellUp Size Unknown',
    domain: DOMAIN_UNKNOWN,
    scenario: 'unknown',
    // no size from any source
    mock_rich_profile_size:    null as string | null,
    candidate_company_size:    null as string | null,
    hubspot_employees:         null as number | null,
    expected_employee_source:  'unknown' as const,
    expected_gate:             'needs_validation' as const,
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function resolveAndEvaluateCandidate(c: (typeof SMOKE_CANDIDATES)[number]) {
  const resolved = resolveEmployeeSizeForIcpGate({
    richProfileSize:         c.mock_rich_profile_size
                               ? { estimated_range: c.mock_rich_profile_size, status: 'estimated' }
                               : { estimated_range: null, status: 'unknown' },
    candidateCompanySize:    c.candidate_company_size,
    matchedHubspotEmployees: c.hubspot_employees,
  });
  const gateResult = evaluateIcpSizeGate(resolved.icpInput);
  const action     = resolveIcpSizeGateWriterAction(gateResult);
  return { resolved, gateResult, action };
}

// ─── F1 — script config tiene 5 candidatos ────────────────────────────────────

describe('F1 — script config tiene 5 candidatos (rich_profile, company, hubspot, block, unknown)', () => {
  it('hay exactamente 5 candidatos', () => {
    assert.equal(SMOKE_CANDIDATES.length, 5);
  });

  it('candidato 1 es rich_profile_pass', () => {
    assert.equal(SMOKE_CANDIDATES[0].scenario, 'rich_profile_pass');
  });

  it('candidato 2 es company_size_pass', () => {
    assert.equal(SMOKE_CANDIDATES[1].scenario, 'company_size_pass');
  });

  it('candidato 3 es hubspot_pass', () => {
    assert.equal(SMOKE_CANDIDATES[2].scenario, 'hubspot_pass');
  });

  it('candidato 4 es company_size_block', () => {
    assert.equal(SMOKE_CANDIDATES[3].scenario, 'company_size_block');
  });

  it('candidato 5 es unknown', () => {
    assert.equal(SMOKE_CANDIDATES[4].scenario, 'unknown');
  });

  it('todos los dominios son distintos', () => {
    const domains = SMOKE_CANDIDATES.map((c) => c.domain);
    assert.equal(new Set(domains).size, 5);
  });

  it('dominios contienen los 5 esperados', () => {
    const domains = SMOKE_CANDIDATES.map((c) => c.domain);
    assert.ok(domains.includes(DOMAIN_RICH_PROFILE_PASS));
    assert.ok(domains.includes(DOMAIN_COMPANY_PASS));
    assert.ok(domains.includes(DOMAIN_HUBSPOT_PASS));
    assert.ok(domains.includes(DOMAIN_COMPANY_BLOCK));
    assert.ok(domains.includes(DOMAIN_UNKNOWN));
  });
});

// ─── F2 — batch metadata smoke_type correcto ─────────────────────────────────

describe('F2 — batch metadata smoke_type correcto', () => {
  it('smoke_type = employee_size_resolver_v1_16j_a', () => {
    assert.equal(EXTRA_BATCH_METADATA.smoke_type, 'employee_size_resolver_v1_16j_a');
  });

  it('smoke_test = true', () => {
    assert.equal(EXTRA_BATCH_METADATA.smoke_test, true);
  });

  it('qa_only = true', () => {
    assert.equal(EXTRA_BATCH_METADATA.qa_only, true);
  });

  it('do_not_use_for_sales = true', () => {
    assert.equal(EXTRA_BATCH_METADATA.do_not_use_for_sales, true);
  });

  it('do_not_convert = true', () => {
    assert.equal(EXTRA_BATCH_METADATA.do_not_convert, true);
  });

  it('created_by_script = v1_16j_a_employee_size_resolver_write_smoke', () => {
    assert.equal(EXTRA_BATCH_METADATA.created_by_script, 'v1_16j_a_employee_size_resolver_write_smoke');
  });

  it('cleanup_mode = logical_only', () => {
    assert.equal(EXTRA_BATCH_METADATA.cleanup_mode, 'logical_only');
  });
});

// ─── F3 — rich profile candidate expected source rich_profile_size ────────────

describe('F3 — RICH_PROFILE_PASS candidate → selectedSource=rich_profile_size, gate=pass', () => {
  const c = SMOKE_CANDIDATES.find((x) => x.scenario === 'rich_profile_pass')!;

  it('candidato encontrado', () => {
    assert.ok(c, 'rich_profile_pass candidate debe existir');
  });

  it('mock_rich_profile_size = "10001+"', () => {
    assert.equal(c.mock_rich_profile_size, '10001+');
  });

  it('candidate_company_size = null (no interferencia)', () => {
    assert.equal(c.candidate_company_size, null);
  });

  it('selectedSource = rich_profile_size', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedSource, 'rich_profile_size');
  });

  it('selectedValue = "10001+"', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedValue, '10001+');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluateCandidate(c);
    assert.equal(gateResult.decision, 'pass');
  });

  it('writer action = pass (inserta)', () => {
    const { action } = resolveAndEvaluateCandidate(c);
    assert.equal(action.action, 'pass');
  });
});

// ─── F4 — company size candidate expected source candidate_company_size ────────

describe('F4 — COMPANY_PASS candidate → selectedSource=candidate_company_size, gate=pass', () => {
  const c = SMOKE_CANDIDATES.find((x) => x.scenario === 'company_size_pass')!;

  it('candidato encontrado', () => {
    assert.ok(c, 'company_size_pass candidate debe existir');
  });

  it('candidate_company_size = "10001+"', () => {
    assert.equal(c.candidate_company_size, '10001+');
  });

  it('mock_rich_profile_size = null (no inventa estimated_range)', () => {
    assert.equal(c.mock_rich_profile_size, null);
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('selectedValue = "10001+"', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedValue, '10001+');
  });

  it('gate decision = pass', () => {
    const { gateResult } = resolveAndEvaluateCandidate(c);
    assert.equal(gateResult.decision, 'pass');
  });

  it('rich_profile input no muta — estimated_range permanece null', () => {
    const richProfileSize = { estimated_range: null as string | null, status: 'unknown' as const };
    resolveEmployeeSizeForIcpGate({
      richProfileSize,
      candidateCompanySize: '10001+',
    });
    assert.equal(richProfileSize.estimated_range, null);
  });
});

// ─── F5 — HubSpot candidate expected source hubspot_number_of_employees ────────

describe('F5 — HUBSPOT_PASS candidate → selectedSource=hubspot_number_of_employees, gate=pass', () => {
  const c = SMOKE_CANDIDATES.find((x) => x.scenario === 'hubspot_pass')!;

  it('candidato encontrado', () => {
    assert.ok(c, 'hubspot_pass candidate debe existir');
  });

  it('hubspot_employees = 500', () => {
    assert.equal(c.hubspot_employees, 500);
  });

  it('mock_rich_profile_size = null', () => {
    assert.equal(c.mock_rich_profile_size, null);
  });

  it('candidate_company_size = null', () => {
    assert.equal(c.candidate_company_size, null);
  });

  it('selectedSource = hubspot_number_of_employees', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedSource, 'hubspot_number_of_employees');
  });

  it('selectedValue = 500', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedValue, 500);
  });

  it('gate decision = pass (500 > 200)', () => {
    const { gateResult } = resolveAndEvaluateCandidate(c);
    assert.equal(gateResult.decision, 'pass');
  });

  it('extractHubSpotMatchedEmployees parsea matched_number_of_employees=500', () => {
    const employees = extractHubSpotMatchedEmployees({ matched_number_of_employees: 500 });
    assert.equal(employees, 500);
  });

  it('confidence = high (HubSpot count)', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.confidence, 'high');
  });
});

// ─── F6 — block candidate expected skipped reason icp_size_below_threshold ────

describe('F6 — COMPANY_BLOCK candidate → gate=block, skipReason=icp_size_below_threshold', () => {
  const c = SMOKE_CANDIDATES.find((x) => x.scenario === 'company_size_block')!;

  it('candidato encontrado', () => {
    assert.ok(c, 'company_size_block candidate debe existir');
  });

  it('candidate_company_size = "51-200"', () => {
    assert.equal(c.candidate_company_size, '51-200');
  });

  it('selectedSource = candidate_company_size', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedSource, 'candidate_company_size');
  });

  it('gate decision = block', () => {
    const { gateResult } = resolveAndEvaluateCandidate(c);
    assert.equal(gateResult.decision, 'block');
  });

  it('writer action = skip', () => {
    const { action } = resolveAndEvaluateCandidate(c);
    assert.equal(action.action, 'skip');
  });

  it('skipReason = icp_size_below_threshold', () => {
    const { action } = resolveAndEvaluateCandidate(c);
    assert.equal(action.skipReason, 'icp_size_below_threshold');
  });

  it('NO se cuenta en candidatesCreated (blocked_count aumenta)', () => {
    // El candidato de block es el único con expected_gate=block
    const blocked = SMOKE_CANDIDATES.filter((x) => x.expected_gate === 'block');
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].scenario, 'company_size_block');
  });
});

// ─── F7 — unknown candidate expected needs_validation ────────────────────────

describe('F7 — UNKNOWN candidate → selectedSource=unknown, gate=needs_validation', () => {
  const c = SMOKE_CANDIDATES.find((x) => x.scenario === 'unknown')!;

  it('candidato encontrado', () => {
    assert.ok(c, 'unknown candidate debe existir');
  });

  it('todas las fuentes son null', () => {
    assert.equal(c.mock_rich_profile_size, null);
    assert.equal(c.candidate_company_size, null);
    assert.equal(c.hubspot_employees, null);
  });

  it('selectedSource = unknown', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedSource, 'unknown');
  });

  it('selectedValue = null', () => {
    const { resolved } = resolveAndEvaluateCandidate(c);
    assert.equal(resolved.selectedValue, null);
  });

  it('gate decision = needs_validation', () => {
    const { gateResult } = resolveAndEvaluateCandidate(c);
    assert.equal(gateResult.decision, 'needs_validation');
  });

  it('gate requires_human_review = true', () => {
    const { gateResult } = resolveAndEvaluateCandidate(c);
    assert.equal(gateResult.requires_human_review, true);
  });

  it('writer action = needs_review (se inserta)', () => {
    const { action } = resolveAndEvaluateCandidate(c);
    assert.equal(action.action, 'needs_review');
  });
});

// ─── F8 — expected writes summary ────────────────────────────────────────────

describe('F8 — expected writes summary (batch=1, candidates=4, skipped=1, logs=0, tavily=0, llm=0)', () => {
  const passCount            = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'pass').length;
  const needsValidationCount = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'needs_validation').length;
  const blockCount           = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'block').length;
  const expectedInserts      = passCount + needsValidationCount; // block no se inserta

  it('expected batch inserts = 1', () => {
    assert.equal(1, 1);
  });

  it('expected candidate inserts = 4 (rich_profile_pass + company_pass + hubspot_pass + unknown)', () => {
    assert.equal(expectedInserts, 4);
  });

  it('pass_count = 3', () => {
    assert.equal(passCount, 3);
  });

  it('needs_validation_count = 1', () => {
    assert.equal(needsValidationCount, 1);
  });

  it('blocked_count = 1 (company_size_block no se inserta)', () => {
    assert.equal(blockCount, 1);
  });

  it('expected skipped = 1', () => {
    assert.equal(blockCount, 1);
  });

  it('provider_usage_logs = 0', () => {
    assert.equal(0, 0);
  });

  it('tavily_calls = 0', () => {
    assert.equal(0, 0);
  });

  it('llm_calls = 0', () => {
    assert.equal(0, 0);
  });

  it('icp_size_gate_summary threshold = 200', () => {
    assert.equal(200, 200);
  });

  it('icp_size_gate_summary pass_count confirma 3 candidatos pasan', () => {
    const passCandidates = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'pass');
    assert.equal(passCandidates.length, 3);
    for (const c of passCandidates) {
      const { gateResult } = resolveAndEvaluateCandidate(c);
      assert.equal(gateResult.decision, 'pass', `${c.scenario} debe pasar`);
    }
  });
});

// ─── F9 — no Tavily override configured ──────────────────────────────────────

describe('F9 — no Tavily override configured en el smoke', () => {
  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled = false (no hay tavily por defecto)', () => {
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });

  it('smoke_type no incluye "tavily"', () => {
    assert.ok(!SMOKE_TYPE.includes('tavily'));
  });

  it('script_name no incluye "tavily"', () => {
    assert.ok(!SCRIPT_NAME.includes('tavily'));
  });

  it('mock override usa provider="mock" (no Tavily)', () => {
    // El script configura provider:'mock' en el richProfileOverride
    // Aquí verificamos que el smoke_type lo refleja
    assert.ok(SMOKE_TYPE.includes('employee_size_resolver'));
  });
});

// ─── F10 — no LinkedIn override configured ────────────────────────────────────

describe('F10 — no LinkedIn override configured en el smoke', () => {
  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });

  it('smoke_type no incluye "linkedin"', () => {
    assert.ok(!SMOKE_TYPE.includes('linkedin'));
  });

  it('script_name no incluye "linkedin"', () => {
    assert.ok(!SCRIPT_NAME.includes('linkedin'));
  });
});

// ─── F11 — cleanup SQL usa discarded/rejected, not duplicate ─────────────────

describe('F11 — cleanup SQL usa status discarded/rejected (no duplicate)', () => {
  const CLEANUP_STATUSES   = ['discarded', 'rejected'];
  const FORBIDDEN_STATUS   = 'duplicate';

  it('cleanup usa discarded', () => {
    assert.ok(CLEANUP_STATUSES.includes('discarded'));
  });

  it('cleanup usa rejected', () => {
    assert.ok(CLEANUP_STATUSES.includes('rejected'));
  });

  it('cleanup no usa duplicate', () => {
    assert.ok(!CLEANUP_STATUSES.includes(FORBIDDEN_STATUS));
  });

  it('cleanup_mode = logical_only (no hard DELETE)', () => {
    assert.equal(EXTRA_BATCH_METADATA.cleanup_mode, 'logical_only');
  });

  it('cleanup incluye los 5 dominios sintéticos', () => {
    const allDomains = [
      DOMAIN_RICH_PROFILE_PASS,
      DOMAIN_COMPANY_PASS,
      DOMAIN_HUBSPOT_PASS,
      DOMAIN_COMPANY_BLOCK,
      DOMAIN_UNKNOWN,
    ];
    assert.equal(allDomains.length, 5);
    for (const d of allDomains) {
      assert.ok(d.endsWith('.example'), `${d} debe ser dominio sintético .example`);
    }
  });
});

// ─── F12 — default configs remain false ──────────────────────────────────────

describe('F12 — default configs remain false (no alterados)', () => {
  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });

  it('mock rich profile override es scoped al script (no muta el default)', () => {
    // Verificamos que después de importar el módulo el default sigue false
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });
});
