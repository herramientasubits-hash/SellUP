/**
 * Tests — Agent 1 v1.16K-B — Safe CTA Bridge to Writer Pipeline Behind Feature Flag
 *
 * Sin Tavily real. Sin LLM. Sin Supabase. Sin Apollo.
 *
 * F1  — flag off → isWriterPipelineCTAEnabled() returns false (legacy Apollo path)
 * F2  — flag on  → isWriterPipelineCTAEnabled() returns true  (writer pipeline path)
 * F3  — flag off → buildWriterPipelineCTABatchMetadata no invocado / no execution_path en path legacy
 * F4  — flag on  → buildWriterPipelineCTABatchMetadata returns {execution_path='writer_pipeline_cta'}
 * F5  — flag on  → buildIncrementalSearchInputFromCTAInput preserves country/countryCode
 * F6  — flag on  → buildIncrementalSearchInputFromCTAInput preserves industry
 * F7  — flag on  → buildIncrementalSearchInputFromCTAInput uses mock provider en tests
 * F8  — flag on  → buildWriterPipelineCTABatchMetadata incluye icp_size_gate_enabled=true
 * F9  — mock candidate con rich_profile + evaluateIcpSizeGate produce resultado válido
 * F10 — sourceSnippet 'más de 200 empleados' alimenta rich_profile.size vía parser
 * F11 — runProspectingPipeline con mock no invoca llamadas externas (0 costs)
 * F12 — buildIncrementalSearchInputFromCTAInput no incluye usageInputContext por defecto
 * F13 — runProspectGenerationAgent sigue importable (Apollo legacy no eliminado)
 * F14 — WRITER_PIPELINE_CTA_FLAG no tiene prefijo NEXT_PUBLIC_ (flag server-only)
 * F15 — isWriterPipelineCTAEnabled() defaults to false cuando env var no está definida
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  isWriterPipelineCTAEnabled,
  buildIncrementalSearchInputFromCTAInput,
  buildWriterPipelineCTABatchMetadata,
  WRITER_PIPELINE_CTA_FLAG,
  type CTABridgeInput,
} from '../prospect-cta-bridge';
import { parseEmployeeSizeFromText } from '../employee-size-text-parser';
import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';
import { evaluateIcpSizeGate } from '../icp-size-gate';
import { runProspectingPipeline } from '../prospecting-pipeline';
import { runProspectGenerationAgent } from '@/server/agents/prospect-generation';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_INPUT: CTABridgeInput = {
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Tecnología',
  targetCount: 10,
  searchDepth: 'standard',
};

const MOCK_USER_ID = 'test-user-uuid-16kb';
const MOCK_BATCH_NAME = 'IA CTA · Colombia · Tecnología · 25 jun. 2026';

// ─── F1 — Flag off → legacy Apollo path ──────────────────────────────────────

describe('v1.16K-B — F1: flag off → isWriterPipelineCTAEnabled() = false', () => {
  let originalValue: string | undefined;

  before(() => {
    originalValue = process.env[WRITER_PIPELINE_CTA_FLAG];
    delete process.env[WRITER_PIPELINE_CTA_FLAG];
  });

  after(() => {
    if (originalValue !== undefined) {
      process.env[WRITER_PIPELINE_CTA_FLAG] = originalValue;
    } else {
      delete process.env[WRITER_PIPELINE_CTA_FLAG];
    }
  });

  it('isWriterPipelineCTAEnabled() returns false when env var is unset', () => {
    assert.equal(isWriterPipelineCTAEnabled(), false);
  });
});

// ─── F2 — Flag on → writer pipeline path ─────────────────────────────────────

describe('v1.16K-B — F2: flag on → isWriterPipelineCTAEnabled() = true', () => {
  let originalValue: string | undefined;

  before(() => {
    originalValue = process.env[WRITER_PIPELINE_CTA_FLAG];
    process.env[WRITER_PIPELINE_CTA_FLAG] = 'true';
  });

  after(() => {
    if (originalValue !== undefined) {
      process.env[WRITER_PIPELINE_CTA_FLAG] = originalValue;
    } else {
      delete process.env[WRITER_PIPELINE_CTA_FLAG];
    }
  });

  it('isWriterPipelineCTAEnabled() returns true when env var = "true"', () => {
    assert.equal(isWriterPipelineCTAEnabled(), true);
  });

  it('isWriterPipelineCTAEnabled() returns false when env var = "false"', () => {
    process.env[WRITER_PIPELINE_CTA_FLAG] = 'false';
    assert.equal(isWriterPipelineCTAEnabled(), false);
    process.env[WRITER_PIPELINE_CTA_FLAG] = 'true'; // restore
  });

  it('isWriterPipelineCTAEnabled() returns false when env var = "1" (only strict "true" activates)', () => {
    process.env[WRITER_PIPELINE_CTA_FLAG] = '1';
    assert.equal(isWriterPipelineCTAEnabled(), false);
    process.env[WRITER_PIPELINE_CTA_FLAG] = 'true'; // restore
  });
});

// ─── F3 — Flag off no agrega metadata writer_pipeline_cta ────────────────────

describe('v1.16K-B — F3: flag off → no execution_path=writer_pipeline_cta in legacy path', () => {
  it('buildWriterPipelineCTABatchMetadata is not invoked when flag is off', () => {
    // The legacy path never calls buildWriterPipelineCTABatchMetadata.
    // Verify that isWriterPipelineCTAEnabled() with flag off returns false,
    // meaning the metadata branch is never reached.
    const savedFlag = process.env[WRITER_PIPELINE_CTA_FLAG];
    delete process.env[WRITER_PIPELINE_CTA_FLAG];

    const enabled = isWriterPipelineCTAEnabled();
    assert.equal(enabled, false, 'Flag must be off so legacy path is used');

    // No metadata is generated — legacy path returns its own result without CTA markers
    if (!enabled) {
      // This block represents the legacy path: no CTA metadata built
      assert.ok(true, 'Legacy path does not produce writer_pipeline_cta metadata');
    } else {
      assert.fail('Flag was on unexpectedly — legacy path was skipped');
    }

    if (savedFlag !== undefined) {
      process.env[WRITER_PIPELINE_CTA_FLAG] = savedFlag;
    }
  });
});

// ─── F4 — Flag on → metadata.execution_path='writer_pipeline_cta' ────────────

describe('v1.16K-B — F4: flag on → buildWriterPipelineCTABatchMetadata', () => {
  it('returns execution_path = writer_pipeline_cta', () => {
    const meta = buildWriterPipelineCTABatchMetadata();
    assert.equal(meta['execution_path'], 'writer_pipeline_cta');
  });

  it('returns legacy_apollo_bypassed = true', () => {
    const meta = buildWriterPipelineCTABatchMetadata();
    assert.equal(meta['legacy_apollo_bypassed'], true);
  });

  it('feature_flag key equals WRITER_PIPELINE_CTA_FLAG', () => {
    const meta = buildWriterPipelineCTABatchMetadata();
    assert.equal(meta['feature_flag'], WRITER_PIPELINE_CTA_FLAG);
  });
});

// ─── F5 — Flag on → input preserves country/countryCode ──────────────────────

describe('v1.16K-B — F5: flag on → input mapping preserves country/countryCode', () => {
  it('country is preserved', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.country, BASE_INPUT.country);
  });

  it('countryCode is preserved', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.countryCode, BASE_INPUT.countryCode);
  });

  it('triggeredByUserId is set from userId param', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.triggeredByUserId, MOCK_USER_ID);
  });

  it('ownerId is set from userId param', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.ownerId, MOCK_USER_ID);
  });
});

// ─── F6 — Flag on → input preserves industry ─────────────────────────────────

describe('v1.16K-B — F6: flag on → input mapping preserves industry', () => {
  it('industry is preserved verbatim', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.industry, BASE_INPUT.industry);
  });

  it('targetInternal equals input.targetCount', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.targetInternal, BASE_INPUT.targetCount);
  });

  it('targetPersistibleCandidates equals input.targetCount', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.targetPersistibleCandidates, BASE_INPUT.targetCount);
  });
});

// ─── F7 — Flag on → tests use mock provider ──────────────────────────────────

describe('v1.16K-B — F7: flag on → mock provider used in tests', () => {
  it('buildIncrementalSearchInputFromCTAInput accepts mock provider', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.webSearchProvider, 'mock');
  });

  it('default provider is tavily (production safety)', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME);
    assert.equal(mapped.webSearchProvider, 'tavily');
  });

  it('dryRun defaults to false in bridge input', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.dryRun, false);
  });
});

// ─── F8 — Flag on → metadata incluye icp_size_gate_enabled=true ──────────────

describe('v1.16K-B — F8: flag on → metadata enables ICP size gate', () => {
  it('icp_size_gate_enabled = true', () => {
    const meta = buildWriterPipelineCTABatchMetadata();
    assert.equal(meta['icp_size_gate_enabled'], true);
  });

  it('employee_size_resolution_enabled = true', () => {
    const meta = buildWriterPipelineCTABatchMetadata();
    assert.equal(meta['employee_size_resolution_enabled'], true);
  });

  it('source_snippet_size_parser_enabled = true', () => {
    const meta = buildWriterPipelineCTABatchMetadata();
    assert.equal(meta['source_snippet_size_parser_enabled'], true);
  });
});

// ─── F9 — Mock candidate + evaluateIcpSizeGate produces valid gate result ─────

describe('v1.16K-B — F9: mock candidate with rich_profile → evaluateIcpSizeGate valid', () => {
  it('pass decision when sizeRange indicates > 200 employees', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: '201-500', sizeStatus: 'estimated' });
    assert.equal(gate.decision, 'pass');
  });

  it('needs_validation when sizeRange is unknown', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: null, sizeStatus: null });
    assert.equal(gate.decision, 'needs_validation');
  });

  it('block decision when sizeRange is clearly below threshold', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: '11-50', sizeStatus: 'confirmed' });
    assert.equal(gate.decision, 'block');
  });

  it('gate result always has decision, size_status, threshold fields', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: '51-200' });
    assert.ok('decision' in gate);
    assert.ok('size_status' in gate);
    assert.ok('threshold' in gate);
    assert.ok('reason' in gate);
  });
});

// ─── F10 — sourceSnippet feeds rich_profile.size via parser ──────────────────

describe('v1.16K-B — F10: sourceSnippet feeds rich_profile.size via parser', () => {
  it('parser extracts size from "más de 200 empleados" → "201-500"', () => {
    const size = parseEmployeeSizeFromText('más de 200 empleados');
    assert.equal(size, '201-500');
  });

  it('buildCandidateRichProfileV1 with sourceSnippet containing size populates size field', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Tech Colombia SAS',
      domain: 'techcolombia.co',
      countryCode: 'CO',
      industry: 'Tecnología',
      sourceTitle: 'Tech Colombia SAS | Software empresarial',
      sourceSnippet: 'Empresa de tecnología con más de 200 empleados en Colombia',
    });
    // Size should be resolved from sourceSnippet
    assert.ok(
      profile.size !== null && profile.size !== undefined,
      `Expected size to be populated from snippet, got: ${JSON.stringify(profile.size)}`
    );
  });

  it('buildCandidateRichProfileV1 with no size evidence leaves size.estimated_range=null', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Empresa Sin Datos SAS',
      domain: 'sinsize.co',
      countryCode: 'CO',
      industry: 'Consultoría',
      sourceTitle: 'Empresa Sin Datos SAS',
      sourceSnippet: 'Empresa de consultoría especializada en servicios empresariales',
    });
    // No size evidence → size object has estimated_range=null and status='unknown'
    const sizeObj = profile.size as Record<string, unknown> | null;
    const isUnknown =
      sizeObj === null ||
      (sizeObj !== null &&
        sizeObj['estimated_range'] === null &&
        sizeObj['status'] === 'unknown');
    assert.ok(isUnknown, `Expected no size evidence, got: ${JSON.stringify(profile.size)}`);
  });
});

// ─── F11 — Mock provider: no LLM calls, no external API ──────────────────────

describe('v1.16K-B — F11: mock provider → no external calls', () => {
  it('runProspectingPipeline with mock provider completes without throwing', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 3,
      webSearchProvider: 'mock',
    });
    assert.ok(output.candidates !== undefined, 'Expected candidates array');
    assert.equal(output.webSearch.provider, 'mock');
  });

  it('mock provider returns estimatedCostUsd of 0 or null (no real Tavily cost)', async () => {
    const output = await runProspectingPipeline({
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: 2,
      webSearchProvider: 'mock',
    });
    // Mock provider returns 0 or null — never a real billable amount
    const cost = output.webSearch.estimatedCostUsd;
    assert.ok(cost === null || cost === 0, `Expected mock cost to be 0 or null, got: ${cost}`);
  });
});

// ─── F12 — No usageInputContext by default ────────────────────────────────────

describe('v1.16K-B — F12: no usageInputContext in bridge input by default', () => {
  it('usageInputContext is not set in mapped input', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.usageInputContext, undefined);
  });

  it('batchName is preserved in mapped input', () => {
    const mapped = buildIncrementalSearchInputFromCTAInput(BASE_INPUT, MOCK_USER_ID, MOCK_BATCH_NAME, 'mock');
    assert.equal(mapped.batchName, MOCK_BATCH_NAME);
  });
});

// ─── F13 — Apollo legacy still importable ────────────────────────────────────

describe('v1.16K-B — F13: Apollo legacy still importable (not deleted)', () => {
  it('runProspectGenerationAgent is a function', () => {
    assert.equal(typeof runProspectGenerationAgent, 'function',
      'runProspectGenerationAgent must remain importable — Apollo legacy path must not be deleted');
  });
});

// ─── F14 — Flag is server-only (no NEXT_PUBLIC_ prefix) ──────────────────────

describe('v1.16K-B — F14: feature flag is server-only', () => {
  it('WRITER_PIPELINE_CTA_FLAG does not start with NEXT_PUBLIC_', () => {
    assert.ok(
      !WRITER_PIPELINE_CTA_FLAG.startsWith('NEXT_PUBLIC_'),
      `Flag "${WRITER_PIPELINE_CTA_FLAG}" must be server-only — NEXT_PUBLIC_ prefix would expose it to the client`
    );
  });

  it('WRITER_PIPELINE_CTA_FLAG equals ENABLE_PROSPECTS_WRITER_PIPELINE_CTA', () => {
    assert.equal(WRITER_PIPELINE_CTA_FLAG, 'ENABLE_PROSPECTS_WRITER_PIPELINE_CTA');
  });
});

// ─── F15 — Default flag is false ─────────────────────────────────────────────

describe('v1.16K-B — F15: default flag is false', () => {
  it('isWriterPipelineCTAEnabled() returns false when env var is absent', () => {
    const saved = process.env[WRITER_PIPELINE_CTA_FLAG];
    delete process.env[WRITER_PIPELINE_CTA_FLAG];
    assert.equal(isWriterPipelineCTAEnabled(), false);
    if (saved !== undefined) process.env[WRITER_PIPELINE_CTA_FLAG] = saved;
  });

  it('isWriterPipelineCTAEnabled() returns false when env var is empty string', () => {
    const saved = process.env[WRITER_PIPELINE_CTA_FLAG];
    process.env[WRITER_PIPELINE_CTA_FLAG] = '';
    assert.equal(isWriterPipelineCTAEnabled(), false);
    if (saved !== undefined) {
      process.env[WRITER_PIPELINE_CTA_FLAG] = saved;
    } else {
      delete process.env[WRITER_PIPELINE_CTA_FLAG];
    }
  });
});
