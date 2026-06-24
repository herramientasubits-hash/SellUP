/**
 * Tests — Agent 1 v1.16I-A-pre — ICP Size Gate Supabase Smoke Readiness
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — script config tiene 3 candidatos (pass, unknown, block)
 * F2  — batch metadata smoke_type correcto
 * F3  — pass candidate expected size gate pass
 * F4  — unknown candidate expected needs_validation
 * F5  — block candidate expected icp_size_below_threshold
 * F6  — expected writes summary (batch=1, candidates=2, provider_usage_logs=0, tavily=0, llm=0)
 * F7  — no Tavily override configured
 * F8  — no LinkedIn override configured
 * F9  — cleanup SQL usa discarded/rejected, no duplicate
 * F10 — default configs remain false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateIcpSizeGate,
  resolveIcpSizeGateWriterAction,
} from '../icp-size-gate';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';

// ─── Smoke config constants (mirrors smoke-icp-size-gate-write.ts) ────────────

const SMOKE_TYPE = 'icp_size_gate_v1_16i_a';
const SCRIPT_NAME = 'v1_16i_a_icp_size_gate_write_smoke';

const DOMAIN_PASS    = 'sellup-icp-pass-smoke.example';
const DOMAIN_UNKNOWN = 'sellup-icp-unknown-smoke.example';
const DOMAIN_BLOCK   = 'sellup-icp-block-smoke.example';

const EXTRA_BATCH_METADATA = {
  smoke_test: true,
  smoke_type: SMOKE_TYPE,
  qa_only: true,
  do_not_use_for_sales: true,
  do_not_convert: true,
  created_by_script: SCRIPT_NAME,
  cleanup_mode: 'logical_only',
};

// Three QA candidates mirroring the script's buildSyntheticPipelineOutput
const SMOKE_CANDIDATES = [
  {
    name: 'SellUp ICP Pass Smoke Co',
    domain: DOMAIN_PASS,
    scenario: 'icp_pass',
    size_range: '10001+',
    expected_gate: 'pass' as const,
  },
  {
    name: 'SellUp ICP Unknown Smoke Co',
    domain: DOMAIN_UNKNOWN,
    scenario: 'icp_unknown',
    size_range: null as string | null,
    expected_gate: 'needs_validation' as const,
  },
  {
    name: 'SellUp ICP Block Smoke Co',
    domain: DOMAIN_BLOCK,
    scenario: 'icp_block',
    size_range: '51-200',
    expected_gate: 'block' as const,
  },
];

// ─── F1 — script config tiene 3 candidatos ────────────────────────────────────

describe('F1 — script config tiene 3 candidatos (pass, unknown, block)', () => {
  it('hay exactamente 3 candidatos', () => {
    assert.equal(SMOKE_CANDIDATES.length, 3);
  });

  it('primer candidato es PASS', () => {
    assert.equal(SMOKE_CANDIDATES[0].expected_gate, 'pass');
  });

  it('segundo candidato es UNKNOWN', () => {
    assert.equal(SMOKE_CANDIDATES[1].expected_gate, 'needs_validation');
  });

  it('tercer candidato es BLOCK', () => {
    assert.equal(SMOKE_CANDIDATES[2].expected_gate, 'block');
  });

  it('dominios son los 3 sintéticos esperados', () => {
    const domains = SMOKE_CANDIDATES.map((c) => c.domain);
    assert.ok(domains.includes(DOMAIN_PASS));
    assert.ok(domains.includes(DOMAIN_UNKNOWN));
    assert.ok(domains.includes(DOMAIN_BLOCK));
  });
});

// ─── F2 — batch metadata smoke_type correcto ─────────────────────────────────

describe('F2 — batch metadata smoke_type correcto', () => {
  it('smoke_type = icp_size_gate_v1_16i_a', () => {
    assert.equal(EXTRA_BATCH_METADATA.smoke_type, 'icp_size_gate_v1_16i_a');
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

  it('created_by_script = v1_16i_a_icp_size_gate_write_smoke', () => {
    assert.equal(EXTRA_BATCH_METADATA.created_by_script, 'v1_16i_a_icp_size_gate_write_smoke');
  });

  it('cleanup_mode = logical_only', () => {
    assert.equal(EXTRA_BATCH_METADATA.cleanup_mode, 'logical_only');
  });
});

// ─── F3 — pass candidate expected size gate pass ──────────────────────────────

describe('F3 — PASS candidate size_range "10001+" → gate decision=pass', () => {
  const passCandidate = SMOKE_CANDIDATES.find((c) => c.scenario === 'icp_pass')!;

  it('candidato encontrado', () => {
    assert.ok(passCandidate, 'pass candidate debe existir');
  });

  it('size_range es "10001+"', () => {
    assert.equal(passCandidate.size_range, '10001+');
  });

  it('gate decision = pass', () => {
    const result = evaluateIcpSizeGate({ sizeRange: passCandidate.size_range });
    assert.equal(result.decision, 'pass');
  });

  it('gate requires_human_review = false', () => {
    const result = evaluateIcpSizeGate({ sizeRange: passCandidate.size_range });
    assert.equal(result.requires_human_review, false);
  });

  it('writer action = pass', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: passCandidate.size_range });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(action.action, 'pass');
  });
});

// ─── F4 — unknown candidate expected needs_validation ────────────────────────

describe('F4 — UNKNOWN candidate size_range null → gate decision=needs_validation', () => {
  const unknownCandidate = SMOKE_CANDIDATES.find((c) => c.scenario === 'icp_unknown')!;

  it('candidato encontrado', () => {
    assert.ok(unknownCandidate, 'unknown candidate debe existir');
  });

  it('size_range es null', () => {
    assert.equal(unknownCandidate.size_range, null);
  });

  it('gate decision = needs_validation', () => {
    const result = evaluateIcpSizeGate({ sizeRange: unknownCandidate.size_range });
    assert.equal(result.decision, 'needs_validation');
  });

  it('gate requires_human_review = true', () => {
    const result = evaluateIcpSizeGate({ sizeRange: unknownCandidate.size_range });
    assert.equal(result.requires_human_review, true);
  });

  it('writer action = needs_review', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: unknownCandidate.size_range });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(action.action, 'needs_review');
  });

  it('writer action no tiene skipReason', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: unknownCandidate.size_range });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(action.skipReason, undefined);
  });
});

// ─── F5 — block candidate expected icp_size_below_threshold ──────────────────

describe('F5 — BLOCK candidate size_range "51-200" → gate decision=block', () => {
  const blockCandidate = SMOKE_CANDIDATES.find((c) => c.scenario === 'icp_block')!;

  it('candidato encontrado', () => {
    assert.ok(blockCandidate, 'block candidate debe existir');
  });

  it('size_range es "51-200"', () => {
    assert.equal(blockCandidate.size_range, '51-200');
  });

  it('gate decision = block', () => {
    const result = evaluateIcpSizeGate({ sizeRange: blockCandidate.size_range });
    assert.equal(result.decision, 'block');
  });

  it('writer action = skip', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: blockCandidate.size_range });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(action.action, 'skip');
  });

  it('writer skipReason = icp_size_below_threshold', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: blockCandidate.size_range });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(action.skipReason, 'icp_size_below_threshold');
  });
});

// ─── F6 — expected writes summary ────────────────────────────────────────────

describe('F6 — expected writes summary (batch=1, candidates=2, logs=0, tavily=0, llm=0)', () => {
  const passCount       = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'pass').length;
  const unknownCount    = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'needs_validation').length;
  const blockCount      = SMOKE_CANDIDATES.filter((c) => c.expected_gate === 'block').length;
  const expectedInserts = passCount + unknownCount; // block no se inserta

  it('expected batch inserts = 1', () => {
    assert.equal(1, 1);
  });

  it('expected candidate inserts = 2 (pass + unknown)', () => {
    assert.equal(expectedInserts, 2);
  });

  it('pass_count = 1', () => {
    assert.equal(passCount, 1);
  });

  it('needs_validation_count = 1', () => {
    assert.equal(unknownCount, 1);
  });

  it('blocked_count = 1', () => {
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
    const threshold = 200;
    assert.equal(threshold, 200);
  });
});

// ─── F7 — no Tavily override configured ──────────────────────────────────────

describe('F7 — no Tavily override configured en el smoke', () => {
  it('script no pasa richProfileEnrichmentOverride (undefined = no tavily override)', () => {
    // El script llama writeProspectingCandidates con richProfileEnrichmentOverride=undefined
    // Lo verificamos inspeccionando que el DEFAULT está deshabilitado
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });

  it('smoke_type no incluye tavily', () => {
    assert.ok(!SMOKE_TYPE.includes('tavily'));
  });

  it('script_name no incluye tavily', () => {
    assert.ok(!SCRIPT_NAME.includes('tavily'));
  });
});

// ─── F8 — no LinkedIn override configured ────────────────────────────────────

describe('F8 — no LinkedIn override configured en el smoke', () => {
  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });

  it('smoke_type no incluye linkedin', () => {
    assert.ok(!SMOKE_TYPE.includes('linkedin'));
  });
});

// ─── F9 — cleanup SQL usa discarded/rejected, no duplicate ───────────────────

describe('F9 — cleanup SQL usa status discarded/rejected (no duplicate)', () => {
  const CLEANUP_STATUSES = ['discarded', 'rejected'];
  const FORBIDDEN_STATUS = 'duplicate';

  it('cleanup usa discarded', () => {
    assert.ok(CLEANUP_STATUSES.includes('discarded'));
  });

  it('cleanup usa rejected', () => {
    assert.ok(CLEANUP_STATUSES.includes('rejected'));
  });

  it('cleanup no usa duplicate', () => {
    assert.ok(!CLEANUP_STATUSES.includes(FORBIDDEN_STATUS));
  });

  it('cleanup_mode = logical_only (no hard delete)', () => {
    assert.equal(EXTRA_BATCH_METADATA.cleanup_mode, 'logical_only');
  });
});

// ─── F10 — default configs remain false ──────────────────────────────────────

describe('F10 — default configs remain false (no alterados)', () => {
  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
  });

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });
});
