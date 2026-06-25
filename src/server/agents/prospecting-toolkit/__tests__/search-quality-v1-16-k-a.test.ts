/**
 * Tests — Agent 1 v1.16K-A — Source Snippet Size Supabase Smoke Readiness
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * Valida que el smoke script está correctamente configurado para escribir
 * en Supabase el tamaño detectado desde sourceTitle/sourceSnippet.
 *
 * F1  — script config tiene 4 candidatos con los escenarios correctos
 * F2  — batch metadata smoke_type = source_snippet_size_v1_16k_a
 * F3  — snippet pass: "más de 500 colaboradores" → parseEmployeeSizeFromText → "501-1000"
 * F4  — snippet block: "51-200 empleados" → parseEmployeeSizeFromText → "51-200"
 * F5  — false positive clientes → parseEmployeeSizeFromText → null
 * F6  — no size evidence → parseEmployeeSizeFromText → null
 * F7  — expected writes summary: batch=1, candidates=3, skipped=1, logs=0, tavily=0, llm=0
 * F8  — no Tavily / richProfileEnrichmentOverride configurado
 * F9  — no LinkedIn override configurado (default disabled)
 * F10 — cleanup SQL usa discarded para candidatos y completed para batch, no duplicate
 * F11 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG y DEFAULT_LINKEDIN_SEARCH_CONFIG permanecen false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseEmployeeSizeFromText } from '../employee-size-text-parser';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';
import {
  SMOKE_TYPE,
  SMOKE_SCENARIOS,
  EXPECTED_WRITES,
  EXTRA_BATCH_METADATA,
  buildSyntheticPipelineOutput,
  buildCleanupSql,
} from '../../../../../scripts/agent1/smoke-source-snippet-size-write';

// ─── F1 — Script config tiene 4 candidatos ────────────────────────────────────

describe('v1.16K-A — F1: Smoke config scenarios', () => {

  it('tiene exactamente 4 candidatos smoke', () => {
    assert.equal(SMOKE_SCENARIOS.length, 4);
  });

  it('primer escenario es snippet_pass', () => {
    const s = SMOKE_SCENARIOS[0];
    assert.equal(s.scenario, 'snippet_pass');
    assert.ok(s.domain.includes('pass'), `expected domain to include 'pass', got ${s.domain}`);
  });

  it('segundo escenario es snippet_block', () => {
    const s = SMOKE_SCENARIOS[1];
    assert.equal(s.scenario, 'snippet_block');
    assert.ok(s.domain.includes('block'), `expected domain to include 'block', got ${s.domain}`);
  });

  it('tercer escenario es false_positive_clients', () => {
    const s = SMOKE_SCENARIOS[2];
    assert.equal(s.scenario, 'false_positive_clients');
    assert.ok(s.domain.includes('false-positive'), `expected domain to include 'false-positive', got ${s.domain}`);
  });

  it('cuarto escenario es no_size_evidence', () => {
    const s = SMOKE_SCENARIOS[3];
    assert.equal(s.scenario, 'no_size_evidence');
    assert.ok(s.domain.includes('no-size'), `expected domain to include 'no-size', got ${s.domain}`);
  });

  it('solo snippet_block no debe insertarse', () => {
    const notInserted = SMOKE_SCENARIOS.filter((s) => !s.expectedInserted);
    assert.equal(notInserted.length, 1);
    assert.equal(notInserted[0].scenario, 'snippet_block');
  });

  it('3 candidatos deben insertarse', () => {
    const inserted = SMOKE_SCENARIOS.filter((s) => s.expectedInserted);
    assert.equal(inserted.length, 3);
  });
});

// ─── F2 — Batch metadata smoke_type ──────────────────────────────────────────

describe('v1.16K-A — F2: Batch metadata', () => {

  it('EXTRA_BATCH_METADATA.smoke_type = source_snippet_size_v1_16k_a', () => {
    assert.equal(EXTRA_BATCH_METADATA['smoke_type'], 'source_snippet_size_v1_16k_a');
  });

  it('SMOKE_TYPE = source_snippet_size_v1_16k_a', () => {
    assert.equal(SMOKE_TYPE, 'source_snippet_size_v1_16k_a');
  });

  it('EXTRA_BATCH_METADATA contiene smoke_test=true y qa_only=true', () => {
    assert.equal(EXTRA_BATCH_METADATA['smoke_test'], true);
    assert.equal(EXTRA_BATCH_METADATA['qa_only'], true);
    assert.equal(EXTRA_BATCH_METADATA['do_not_use_for_sales'], true);
    assert.equal(EXTRA_BATCH_METADATA['do_not_convert'], true);
    assert.equal(EXTRA_BATCH_METADATA['cleanup_mode'], 'logical_only');
  });

  it('pipelineOutput metadata contiene smoke_type correcto', () => {
    const output = buildSyntheticPipelineOutput();
    const meta = output.metadata as Record<string, unknown>;
    assert.equal(meta['smoke_type'], 'source_snippet_size_v1_16k_a');
  });
});

// ─── F3 — Snippet pass: "más de 500 colaboradores" → "501-1000" ───────────────

describe('v1.16K-A — F3: parseEmployeeSizeFromText snippet pass', () => {

  it('snippetPass sourceSnippet contains "más de 500 colaboradores"', () => {
    const passScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_pass');
    assert.ok(passScenario, 'snippet_pass scenario must exist');
    assert.ok(
      passScenario.sourceSnippet.includes('más de 500 colaboradores'),
      `expected sourceSnippet to include "más de 500 colaboradores", got: ${passScenario.sourceSnippet}`,
    );
  });

  it('parseEmployeeSizeFromText("...más de 500 colaboradores...") → "501-1000"', () => {
    const passScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_pass')!;
    const combined = `${passScenario.sourceTitle} ${passScenario.sourceSnippet}`;
    const result = parseEmployeeSizeFromText(combined);
    assert.equal(result, '501-1000');
  });

  it('scenario.expectedSizeRange = "501-1000"', () => {
    const passScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_pass')!;
    assert.equal(passScenario.expectedSizeRange, '501-1000');
  });

  it('scenario.expectedIcpDecision = "pass"', () => {
    const passScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_pass')!;
    assert.equal(passScenario.expectedIcpDecision, 'pass');
  });
});

// ─── F4 — Snippet block: "51-200 empleados" → "51-200" ───────────────────────

describe('v1.16K-A — F4: parseEmployeeSizeFromText snippet block', () => {

  it('snippetBlock sourceSnippet contains "51-200 empleados"', () => {
    const blockScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_block');
    assert.ok(blockScenario, 'snippet_block scenario must exist');
    assert.ok(
      blockScenario.sourceSnippet.includes('51-200 empleados'),
      `expected sourceSnippet to include "51-200 empleados", got: ${blockScenario.sourceSnippet}`,
    );
  });

  it('parseEmployeeSizeFromText("...51-200 empleados...") → "51-200"', () => {
    const blockScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_block')!;
    const combined = `${blockScenario.sourceTitle} ${blockScenario.sourceSnippet}`;
    const result = parseEmployeeSizeFromText(combined);
    assert.equal(result, '51-200');
  });

  it('scenario.expectedSizeRange = "51-200"', () => {
    const blockScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_block')!;
    assert.equal(blockScenario.expectedSizeRange, '51-200');
  });

  it('scenario.expectedIcpDecision = "block"', () => {
    const blockScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_block')!;
    assert.equal(blockScenario.expectedIcpDecision, 'block');
  });

  it('snippet_block expectedSkipReason = icp_size_below_threshold', () => {
    const blockScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'snippet_block')!;
    assert.equal(blockScenario.expectedSkipReason, 'icp_size_below_threshold');
  });
});

// ─── F5 — False positive clientes → null ─────────────────────────────────────

describe('v1.16K-A — F5: parseEmployeeSizeFromText false positive (clientes)', () => {

  it('false_positive sourceSnippet contains "más de 500 clientes"', () => {
    const fpScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'false_positive_clients');
    assert.ok(fpScenario, 'false_positive_clients scenario must exist');
    assert.ok(
      fpScenario.sourceSnippet.includes('500 clientes'),
      `expected sourceSnippet to include "500 clientes", got: ${fpScenario.sourceSnippet}`,
    );
  });

  it('parseEmployeeSizeFromText("...más de 500 clientes...") → null', () => {
    const fpScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'false_positive_clients')!;
    const combined = `${fpScenario.sourceTitle} ${fpScenario.sourceSnippet}`;
    const result = parseEmployeeSizeFromText(combined);
    assert.equal(result, null, `"clientes" is NOT an employee keyword — expected null, got ${result}`);
  });

  it('scenario.expectedSizeRange = null', () => {
    const fpScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'false_positive_clients')!;
    assert.equal(fpScenario.expectedSizeRange, null);
  });

  it('scenario.expectedIcpDecision = "needs_validation"', () => {
    const fpScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'false_positive_clients')!;
    assert.equal(fpScenario.expectedIcpDecision, 'needs_validation');
  });
});

// ─── F6 — No size evidence → null ────────────────────────────────────────────

describe('v1.16K-A — F6: parseEmployeeSizeFromText no size evidence', () => {

  it('no_size_evidence sourceSnippet has no employee size signal', () => {
    const nsScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'no_size_evidence');
    assert.ok(nsScenario, 'no_size_evidence scenario must exist');
    // Should have no number + employee keyword combination
    const result = parseEmployeeSizeFromText(nsScenario.sourceSnippet);
    assert.equal(result, null);
  });

  it('parseEmployeeSizeFromText on no_size combined text → null', () => {
    const nsScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'no_size_evidence')!;
    const combined = `${nsScenario.sourceTitle} ${nsScenario.sourceSnippet}`;
    const result = parseEmployeeSizeFromText(combined);
    assert.equal(result, null);
  });

  it('scenario.expectedSizeRange = null', () => {
    const nsScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'no_size_evidence')!;
    assert.equal(nsScenario.expectedSizeRange, null);
  });

  it('scenario.expectedIcpDecision = "needs_validation"', () => {
    const nsScenario = SMOKE_SCENARIOS.find((s) => s.scenario === 'no_size_evidence')!;
    assert.equal(nsScenario.expectedIcpDecision, 'needs_validation');
  });
});

// ─── F7 — Expected writes summary ────────────────────────────────────────────

describe('v1.16K-A — F7: Expected writes summary', () => {

  it('EXPECTED_WRITES.batch = 1', () => {
    assert.equal(EXPECTED_WRITES.batch, 1);
  });

  it('EXPECTED_WRITES.candidates = 3 (PASS + FALSE_POSITIVE + NO_SIZE)', () => {
    assert.equal(EXPECTED_WRITES.candidates, 3);
  });

  it('EXPECTED_WRITES.skipped = 1 (BLOCK)', () => {
    assert.equal(EXPECTED_WRITES.skipped, 1);
  });

  it('EXPECTED_WRITES.provider_usage_logs = 0', () => {
    assert.equal(EXPECTED_WRITES.provider_usage_logs, 0);
  });

  it('EXPECTED_WRITES.tavily = 0', () => {
    assert.equal(EXPECTED_WRITES.tavily, 0);
  });

  it('EXPECTED_WRITES.llm = 0', () => {
    assert.equal(EXPECTED_WRITES.llm, 0);
  });

  it('pipelineOutput.metadata.tavily_calls = 0', () => {
    const output = buildSyntheticPipelineOutput();
    const meta = output.metadata as Record<string, unknown>;
    assert.equal(meta['tavily_calls'], 0);
  });

  it('pipelineOutput.metadata.llm_calls = 0', () => {
    const output = buildSyntheticPipelineOutput();
    const meta = output.metadata as Record<string, unknown>;
    assert.equal(meta['llm_calls'], 0);
  });
});

// ─── F8 — No Tavily / richProfileEnrichmentOverride ──────────────────────────

describe('v1.16K-A — F8: No Tavily override configured', () => {

  it('pipelineOutput.metadata.rich_profile_enrichment_override = false', () => {
    const output = buildSyntheticPipelineOutput();
    const meta = output.metadata as Record<string, unknown>;
    assert.equal(meta['rich_profile_enrichment_override'], false);
  });

  it('pipelineOutput.metadata.provider = mock (no real Tavily)', () => {
    const output = buildSyntheticPipelineOutput();
    const meta = output.metadata as Record<string, unknown>;
    assert.equal(meta['provider'], 'mock');
  });

  it('pipelineOutput.webSearch.provider = mock', () => {
    const output = buildSyntheticPipelineOutput();
    assert.equal(output.webSearch.provider, 'mock');
  });

  it('EXPECTED_WRITES.tavily = 0 confirma que no hay override de Tavily', () => {
    assert.equal(EXPECTED_WRITES.tavily, 0);
  });
});

// ─── F9 — No LinkedIn override configurado ───────────────────────────────────

describe('v1.16K-A — F9: No LinkedIn override configurado', () => {

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });

  it('buildSyntheticPipelineOutput no incluye linkedInSearchOverride', () => {
    // La función solo retorna ProspectingPipelineOutput, no un override de LinkedIn.
    // Verificamos que el output no tiene ningún campo de LinkedIn habilitado.
    const output = buildSyntheticPipelineOutput();
    const meta = output.metadata as Record<string, unknown>;
    // No debe haber campo de linkedin_search_override ni linkedin_calls
    assert.equal(meta['linkedin_calls'], undefined);
  });
});

// ─── F10 — Cleanup SQL usa discarded/rejected para candidatos y completed para batch ──

describe('v1.16K-A — F10: Cleanup SQL status values', () => {

  it('cleanup SQL contiene "discarded" para candidatos', () => {
    const sql = buildCleanupSql('test-batch-id');
    assert.ok(
      sql.includes("status = 'discarded'"),
      'cleanup SQL debe contener status = \'discarded\' para candidatos',
    );
  });

  it("cleanup SQL contiene \"completed\" para batch (no 'discarded')", () => {
    const sql = buildCleanupSql('test-batch-id');
    assert.ok(
      sql.includes("status = 'completed'"),
      'cleanup SQL debe contener status = \'completed\' para el batch',
    );
  });

  it("cleanup SQL NO usa 'duplicate' como status", () => {
    const sql = buildCleanupSql('test-batch-id');
    assert.ok(
      !sql.includes("status = 'duplicate'"),
      'cleanup SQL NO debe contener status = \'duplicate\'',
    );
  });

  it('cleanup SQL incluye los 4 dominios smoke', () => {
    const sql = buildCleanupSql();
    for (const s of SMOKE_SCENARIOS) {
      assert.ok(sql.includes(s.domain), `cleanup SQL debe incluir dominio ${s.domain}`);
    }
  });

  it("cleanup batch con batchId usa WHERE id = '<id>'", () => {
    const batchId = 'abc-123-uuid';
    const sql = buildCleanupSql(batchId);
    assert.ok(
      sql.includes(`WHERE id = '${batchId}'`),
      `expected SQL to include WHERE id = '${batchId}'`,
    );
  });

  it("cleanup batch sin batchId usa WHERE metadata->>'smoke_type' = ...", () => {
    const sql = buildCleanupSql();
    assert.ok(
      sql.includes(`metadata->>'smoke_type' = '${SMOKE_TYPE}'`),
      'expected SQL to use smoke_type filter when no batchId provided',
    );
  });
});

// ─── F11 — Default configs remain false ──────────────────────────────────────

describe('v1.16K-A — F11: Default configs remain false', () => {

  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled = false', () => {
    assert.equal(
      DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled,
      false,
      'DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled must remain false — never touch production default',
    );
  });

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(
      DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled,
      false,
      'DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled must remain false — never touch production default',
    );
  });

  it('buildSyntheticPipelineOutput tiene 4 candidatos (igual que SMOKE_SCENARIOS)', () => {
    const output = buildSyntheticPipelineOutput();
    assert.equal(output.candidates.length, SMOKE_SCENARIOS.length);
    assert.equal(output.candidates.length, 4);
  });

  it('todos los candidatos del pipeline tienen qualityLabel = high_quality_new', () => {
    const output = buildSyntheticPipelineOutput();
    for (const c of output.candidates) {
      assert.equal(
        c.scoring.qualityLabel,
        'high_quality_new',
        `candidate ${c.name} must have qualityLabel high_quality_new`,
      );
    }
  });

  it('ningún candidato tiene website (null) — smoke usa dominios sintéticos sin URL real', () => {
    const output = buildSyntheticPipelineOutput();
    for (const c of output.candidates) {
      assert.equal(c.website, null, `candidate ${c.name} must have website=null`);
    }
  });
});
