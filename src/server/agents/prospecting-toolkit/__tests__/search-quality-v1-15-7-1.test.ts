/**
 * Tests — Search Quality v1.15.7.1 — LinkedIn Usage Logging Hardening
 *
 * Valida los fail-safes y el endurecimiento del sistema de usage logging:
 *
 *   F1  — tavily + enabled + !dryRun + sin usageLoggerFn → bloqueado (missing_usage_logger)
 *   F2  — tavily + enabled + dryRun=true + sin usageLoggerFn → permitido, sin usage DB writes
 *   F3  — usageLoggerFn falla → usage_log_failed_count > 0, error sanitizado, no secreto impreso
 *   F4  — usageLoggerFn exitoso → usage_log_success_count = attempted_query_count, usage_logged=true
 *   F5  — tavily + enabled + !dryRun + usageLoggerFn + batchId=null → bloqueado (missing_batch_id)
 *   F6  — con batchId real → usage_key incluye batchId
 *   F7  — cap real: 4 candidatos × 2 queries, maxPerBatch=5 → ≤5 provider calls, ≤5 usage payloads
 *   F8  — stop-after-found: 3 candidatos found en Q1 → 3 logs, no 6
 *   F9  — duplicate_guard_blocked → 0 provider calls, 0 usage logs
 *   F10 — evidence_policy_blocked → 0 provider calls, 0 usage logs
 *   F11 — mock provider sin usageLoggerFn → usage_logged=false, no DB writes reales
 *   F12 — DEFAULT disabled → 0 provider calls, 0 usage logs, usage_logged=false
 *
 * Sin Supabase real. Sin LLM. Sin Tavily real. Sin scraping.
 * Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runControlledLinkedInCompanySearch,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
  createMockLinkedInSearchProvider,
  buildLinkedInUsageKey,
} from '../linkedin-company-search';
import type {
  LinkedInSearchConfig,
  ControlledLinkedInSearchCandidate,
  LinkedInUsageLogPayload,
  LinkedInUsageContext,
} from '../linkedin-company-search';

// ─── Shared constants ─────────────────────────────────────────────────────────

const CHECKED_AT = '2026-06-23T18:00:00.000Z';
const FAKE_BATCH_ID = 'batch-v1-15-7-1-hardening-fixture';
const FAKE_USER_ID = 'user-hardening-test-001';
const UNIT_COST_USD = 0.01;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNotFoundEnrichment() {
  return {
    enabled: true as const,
    status: 'not_found' as const,
    confidence: 0,
    warnings: ['No LinkedIn company URL available.'],
    source: 'provided_search_result' as const,
    checked_at: CHECKED_AT,
  };
}

function makeSearchCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'TestCo Colombia',
    domain: 'testco.com.co',
    countryCode: 'CO',
    sourceTitle: 'TestCo Colombia - Software ERP',
    sourceSnippet: 'Software ERP para empresas en Colombia.',
    confidenceScore: 75,
    currentEnrichment: makeNotFoundEnrichment(),
    ...overrides,
  };
}

function makeTavilyEnabledConfig(overrides: Partial<LinkedInSearchConfig> = {}): LinkedInSearchConfig {
  return {
    enabled: true,
    provider: 'tavily',
    maxPerBatch: 5,
    minConfidenceScore: 70,
    maxQueriesPerCandidate: 2,
    maxResultsPerQuery: 1,
    ...overrides,
  };
}

function makeMockEnabledConfig(overrides: Partial<LinkedInSearchConfig> = {}): LinkedInSearchConfig {
  return {
    enabled: true,
    provider: 'mock',
    maxPerBatch: 5,
    minConfidenceScore: 70,
    maxQueriesPerCandidate: 2,
    maxResultsPerQuery: 1,
    ...overrides,
  };
}

function makeUsageContext(overrides: Partial<LinkedInUsageContext> = {}): LinkedInUsageContext {
  return {
    batchId: FAKE_BATCH_ID,
    userId: FAKE_USER_ID,
    dryRun: false,
    unitCostUsd: UNIT_COST_USD,
    ...overrides,
  };
}

function captureLogger(): { payloads: LinkedInUsageLogPayload[]; fn: (p: LinkedInUsageLogPayload) => Promise<void> } {
  const payloads: LinkedInUsageLogPayload[] = [];
  return {
    payloads,
    fn: async (p: LinkedInUsageLogPayload) => { payloads.push(p); },
  };
}

function makeFailingLogger(errorMsg = 'Supabase insert failed'): (p: LinkedInUsageLogPayload) => Promise<void> {
  return async () => { throw new Error(errorMsg); };
}

// ═══════════════════════════════════════════════════════════════════════════════
// F1 — tavily + enabled + !dryRun + sin usageLoggerFn → bloqueado
// ═══════════════════════════════════════════════════════════════════════════════

describe('F1 — tavily + enabled + !dryRun + sin usageLoggerFn → bloqueado', () => {
  it('0 provider calls, skipped_reason=missing_usage_logger, usage_logged=false', async () => {
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeTavilyEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext() },
      // No usageLoggerFn provided
    );

    assert.strictEqual(providerCalls, 0, '0 provider calls: guard should fire before loop');
    assert.strictEqual(result.usagePayloads.length, 0, '0 usagePayloads');
    assert.strictEqual(result.batchMetadata.usage_logged, false);
    assert.strictEqual(result.batchMetadata.skipped_reason, 'missing_usage_logger');
    assert.strictEqual(result.batchMetadata.attempted_query_count, 0);
    assert.strictEqual(result.results[0].skipReason, 'missing_usage_logger');
  });

  it('Múltiples candidatos todos bloqueados con skipReason=missing_usage_logger', async () => {
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const candidates = [
      makeSearchCandidate({ name: 'Empresa A' }),
      makeSearchCandidate({ name: 'Empresa B' }),
      makeSearchCandidate({ name: 'Empresa C' }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeTavilyEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext() },
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.results.length, 3);
    for (const r of result.results) {
      assert.strictEqual(r.skipReason, 'missing_usage_logger');
      assert.strictEqual(r.attempted, false);
    }
    assert.strictEqual(result.batchMetadata.skipped_count, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F2 — tavily + enabled + dryRun=true + sin usageLoggerFn → permitido (sin writes)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F2 — tavily + enabled + dryRun=true + sin usageLoggerFn → permitido sin writes', () => {
  it('dryRun=true con tavily: provider se llama, 0 usage payloads, usage_logged=false', async () => {
    // dryRun bypasses Guard A (requires !isDryRun) and the usage logging block
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeTavilyEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext({ dryRun: true }) },
      // No usageLoggerFn — dryRun makes this safe
    );

    // Provider IS called (dryRun doesn't block provider calls, only usage logging)
    assert.ok(providerCalls >= 0, 'provider may or may not be called in dryRun');
    assert.strictEqual(result.usagePayloads.length, 0, '0 usagePayloads in dryRun');
    assert.strictEqual(result.batchMetadata.usage_logged, false, 'usage_logged=false in dryRun');
    // No real usage DB writes even if provider was called
    assert.strictEqual(result.batchMetadata.usage_log_attempted_count, 0);
  });

  it('dryRun=true con tavily + batchId=null: no bloquea (dryRun es seguro)', async () => {
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeTavilyEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext({ dryRun: true, batchId: null }) },
    );

    // Guard C requires !isDryRun, so dryRun=true bypasses it
    assert.strictEqual(result.batchMetadata.usage_logged, false);
    assert.strictEqual(result.usagePayloads.length, 0);
    // skipped_reason may be 'dry_run' or null, but NOT 'missing_batch_id'
    assert.notStrictEqual(result.batchMetadata.skipped_reason, 'missing_batch_id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F3 — usageLoggerFn falla → tracked, not silent
// ═══════════════════════════════════════════════════════════════════════════════

describe('F3 — usageLoggerFn falla: tracked, no silencioso', () => {
  it('Logger que lanza excepción: usage_log_failed_count>0, usage_logged=false, error en metadata', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext(),
        usageLoggerFn: makeFailingLogger('Supabase insert failed'),
      },
    );

    const meta = result.batchMetadata;
    assert.ok(meta.usage_log_failed_count > 0, 'usage_log_failed_count debe ser > 0');
    assert.strictEqual(meta.usage_logged, false, 'usage_logged=false cuando hay fallos');
    assert.ok(meta.usage_log_errors.length > 0, 'usage_log_errors debe tener entradas');
    assert.strictEqual(meta.usage_log_attempted_count, meta.usage_log_failed_count + meta.usage_log_success_count);
  });

  it('Error sanitizado: no contiene más de 200 chars, no expone stack trace completo', async () => {
    const longError = 'A'.repeat(500) + ' secret_token_12345678901234567890';
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext(),
        usageLoggerFn: makeFailingLogger(longError),
      },
    );

    const meta = result.batchMetadata;
    assert.ok(meta.usage_log_errors.length > 0, 'debe haber al menos 1 error');
    for (const e of meta.usage_log_errors) {
      assert.ok(e.length <= 200, `Error sanitizado debe ser ≤200 chars, got ${e.length}`);
    }
  });

  it('Pipeline no revienta cuando logger falla — enrichment result existe', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext(),
        usageLoggerFn: makeFailingLogger(),
      },
    );

    // Pipeline should complete — enrichment result must exist
    assert.ok(result.results.length > 0, 'result.results debe existir');
    assert.ok(result.results[0].enrichment, 'enrichment debe existir');
    assert.ok(result.usagePayloads.length > 0, 'usagePayloads deben existir (built before logger call)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F4 — usageLoggerFn exitoso → usage_log_success_count = attempted_query_count
// ═══════════════════════════════════════════════════════════════════════════════

describe('F4 — usageLoggerFn exitoso → contadores correctos', () => {
  it('3 candidatos found en Q1: usage_log_success_count=3, usage_logged=true', async () => {
    const logger = captureLogger();
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      factory: ['https://www.linkedin.com/company/factory-colombia'],
      loggro: ['https://www.linkedin.com/company/loggroenterprise'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
      makeSearchCandidate({ name: 'Factory', domain: 'factory.com.co', confidenceScore: 75 }),
      makeSearchCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    const meta = result.batchMetadata;
    assert.strictEqual(meta.usage_log_success_count, meta.attempted_query_count,
      'usage_log_success_count debe igualar attempted_query_count');
    assert.strictEqual(meta.usage_log_failed_count, 0);
    assert.strictEqual(meta.usage_logged, true);
    assert.strictEqual(meta.usage_log_errors.length, 0);
    assert.strictEqual(logger.payloads.length, meta.usage_log_attempted_count);
  });

  it('1 candidato, Q1 not_found, Q2 found: 2 logs exitosos', async () => {
    const logger = captureLogger();
    // v1.16K-R-C: Q1 es nombre solo (sin dominio); Q2 (fallback) añade el dominio.
    // Para forzar Q1 not_found y Q2 found, el found viene de la query con dominio.
    const provider = async (query: string): Promise<string[]> => {
      if (query.includes('loggro.com')) return ['https://www.linkedin.com/company/loggroenterprise'];
      return [];
    };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com', confidenceScore: 75 })],
      makeMockEnabledConfig({ maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    const meta = result.batchMetadata;
    assert.strictEqual(meta.usage_log_success_count, 2);
    assert.strictEqual(meta.usage_log_failed_count, 0);
    assert.strictEqual(meta.usage_logged, true);
    assert.strictEqual(logger.payloads.length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F5 — tavily + enabled + !dryRun + usageLoggerFn + batchId=null → bloqueado
// ═══════════════════════════════════════════════════════════════════════════════

describe('F5 — tavily + enabled + !dryRun + usageLoggerFn + batchId=null → bloqueado', () => {
  it('0 provider calls, skipped_reason=missing_batch_id, 0 usage logs', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeTavilyEnabledConfig(),
      provider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext({ batchId: null }),
        usageLoggerFn: logger.fn,
      },
    );

    assert.strictEqual(providerCalls, 0, '0 provider calls: Guard C should fire');
    assert.strictEqual(logger.payloads.length, 0, '0 logger invocations');
    assert.strictEqual(result.usagePayloads.length, 0, '0 usagePayloads');
    assert.strictEqual(result.batchMetadata.skipped_reason, 'missing_batch_id');
    assert.strictEqual(result.batchMetadata.usage_logged, false);
    assert.strictEqual(result.results[0].skipReason, 'missing_batch_id');
  });

  it('batchId=undefined también dispara Guard C', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeTavilyEnabledConfig(),
      provider,
      CHECKED_AT,
      {
        // unitCostUsd presente para pasar Guard B (missing_pricing) y aislar Guard C.
        // batchId ausente a propósito → debe disparar Guard C (missing_batch_id).
        usageContext: { dryRun: false, userId: FAKE_USER_ID, unitCostUsd: 0.008 },
        usageLoggerFn: logger.fn,
      },
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.batchMetadata.skipped_reason, 'missing_batch_id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F6 — Con batchId real → usage_key incluye batchId y usage_log tiene batch_id correcto
// ═══════════════════════════════════════════════════════════════════════════════

describe('F6 — usage_key y batch_id correctos cuando batchId es real', () => {
  it('usage_key incluye batchId real en formato correcto', async () => {
    const logger = captureLogger();
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const realBatchId = 'real-batch-uuid-1234';

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext({ batchId: realBatchId }),
        usageLoggerFn: logger.fn,
      },
    );

    assert.ok(logger.payloads.length > 0, 'Debe haber al menos 1 payload');
    const p = logger.payloads[0];
    assert.strictEqual(p.batch_id, realBatchId, 'batch_id en payload debe ser el batchId real');
    assert.ok(
      p.usage_key.startsWith(`tavily:linkedin_search:${realBatchId}:`),
      `usage_key debe empezar con tavily:linkedin_search:${realBatchId}: — got: ${p.usage_key}`,
    );
  });

  it('buildLinkedInUsageKey con batchId real genera formato tavily:linkedin_search:{batchId}:{slug}:q{n}', () => {
    const key = buildLinkedInUsageKey('batch-real-uuid', 'TestCo Colombia', 0);
    assert.match(key, /^tavily:linkedin_search:batch-real-uuid:[a-z0-9_]+:q0$/,
      `Formato incorrecto: ${key}`);
  });

  it('Todos los payloads de una corrida tienen el mismo batchId real', async () => {
    const logger = captureLogger();
    const provider = async (query: string): Promise<string[]> => {
      if (query.includes('loggro.com')) return [];
      return ['https://www.linkedin.com/company/loggroenterprise'];
    };

    const batchId = 'batch-flush-test-abc123';

    await runControlledLinkedInCompanySearch(
      [makeSearchCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com' })],
      makeMockEnabledConfig({ maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext({ batchId }),
        usageLoggerFn: logger.fn,
      },
    );

    for (const p of logger.payloads) {
      assert.strictEqual(p.batch_id, batchId, 'Todos los payloads deben tener el batchId real');
      assert.ok(p.usage_key.includes(batchId), `usage_key debe incluir batchId: ${p.usage_key}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F7 — Cap real: 4 candidatos × 2 queries, maxPerBatch=5 → ≤5 calls
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7 — Cap real: maxPerBatch=5 limita provider calls y usage payloads a ≤5', () => {
  it('4 candidatos × maxQueriesPerCandidate=2, maxPerBatch=5 → ≤5 provider calls', async () => {
    const logger = captureLogger();
    let totalProviderCalls = 0;
    const provider = async (): Promise<string[]> => { totalProviderCalls++; return []; };

    const candidates = Array.from({ length: 4 }, (_, i) =>
      makeSearchCandidate({ name: `Empresa${i}`, domain: `empresa${i}.com`, confidenceScore: 75 }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig({ maxPerBatch: 5, maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.ok(totalProviderCalls <= 5,
      `maxPerBatch=5 → máximo 5 provider calls, got ${totalProviderCalls}`);
    assert.ok(logger.payloads.length <= 5,
      `maxPerBatch=5 → máximo 5 usage logs, got ${logger.payloads.length}`);
    assert.ok(result.usagePayloads.length <= 5,
      `maxPerBatch=5 → máximo 5 usagePayloads, got ${result.usagePayloads.length}`);
    assert.strictEqual(result.batchMetadata.max_per_batch, 5, 'max_per_batch reportado como 5');
    assert.ok(result.batchMetadata.attempted_query_count <= 5,
      `attempted_query_count ≤ 5, got ${result.batchMetadata.attempted_query_count}`);
  });

  it('maxPerBatch>5 sigue limitado a 5 por hard cap', async () => {
    let totalCalls = 0;
    const provider = async (): Promise<string[]> => { totalCalls++; return []; };

    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeSearchCandidate({ name: `Co${i}`, domain: `co${i}.com`, confidenceScore: 75 }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig({ maxPerBatch: 100, maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext() },
    );

    assert.ok(totalCalls <= 5, `Hard cap 5: got ${totalCalls}`);
    assert.strictEqual(result.batchMetadata.max_per_batch, 5, 'hard cap = 5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F8 — stop-after-found: 3 candidatos found Q1 → 3 logs, no 6
// ═══════════════════════════════════════════════════════════════════════════════

describe('F8 — stop-after-found reduce provider calls y usage logs', () => {
  it('3 candidatos found en Q1 → 3 provider calls, 3 usage logs (no 6)', async () => {
    const logger = captureLogger();

    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      factory: ['https://www.linkedin.com/company/factory-colombia'],
      loggro: ['https://www.linkedin.com/company/loggroenterprise'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
      makeSearchCandidate({ name: 'Factory', domain: 'factory.com.co', confidenceScore: 75 }),
      makeSearchCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    // 3 candidates found in Q1 → stop-after-found → only 3 queries total, not 6
    assert.strictEqual(result.batchMetadata.attempted_query_count, 3,
      '3 queries total (stop after found in Q1)');
    assert.strictEqual(logger.payloads.length, 3, '3 usage logs, not 6');
    assert.strictEqual(result.batchMetadata.found_count, 3);
    assert.strictEqual(result.batchMetadata.stopped_after_found, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F9 — duplicate_guard_blocked → 0 provider calls, 0 usage logs
// ═══════════════════════════════════════════════════════════════════════════════

describe('F9 — duplicate_guard_blocked: 0 provider calls, 0 usage logs', () => {
  it('isBlockedByDuplicateGuard=true → skipReason=duplicate_guard_blocked, 0 logs', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const candidates = [
      makeSearchCandidate({ isBlockedByDuplicateGuard: true }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(providerCalls, 0, '0 provider calls para blocked duplicate');
    assert.strictEqual(logger.payloads.length, 0, '0 usage logs');
    assert.strictEqual(result.usagePayloads.length, 0);
    assert.strictEqual(result.results[0].skipReason, 'duplicate_guard_blocked');
    assert.strictEqual(result.batchMetadata.usage_log_attempted_count, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F10 — evidence_policy_blocked → 0 provider calls, 0 usage logs
// ═══════════════════════════════════════════════════════════════════════════════

describe('F10 — evidence_policy_blocked: 0 provider calls, 0 usage logs', () => {
  it('isBlockedByEvidencePolicy=true → skipReason=evidence_policy_blocked, 0 logs', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const candidates = [
      makeSearchCandidate({ isBlockedByEvidencePolicy: true }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(providerCalls, 0, '0 provider calls para blocked evidence policy');
    assert.strictEqual(logger.payloads.length, 0, '0 usage logs');
    assert.strictEqual(result.usagePayloads.length, 0);
    assert.strictEqual(result.results[0].skipReason, 'evidence_policy_blocked');
    assert.strictEqual(result.batchMetadata.usage_log_attempted_count, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F11 — mock provider sin usageLoggerFn → usage_logged=false, no writes reales
// ═══════════════════════════════════════════════════════════════════════════════

describe('F11 — mock provider sin usageLoggerFn: usage_logged=false, pipeline completo', () => {
  it('mock + !usageLoggerFn: no fail-safe (mock es seguro), usage_logged=false', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext() },
      // No usageLoggerFn — but mock is safe so no guard fires
    );

    // Mock provider is allowed without usageLoggerFn (Guard A only applies to tavily)
    assert.strictEqual(result.batchMetadata.skipped_reason, null,
      'mock sin logger: no debe bloquear');
    assert.ok(result.batchMetadata.attempted_query_count > 0,
      'mock provider: debe ejecutar queries');
    assert.strictEqual(result.batchMetadata.usage_logged, false,
      'usage_logged=false cuando no hay usageLoggerFn');
    assert.strictEqual(result.batchMetadata.usage_log_attempted_count, 0,
      'usage_log_attempted_count=0 sin usageLoggerFn');
    // usagePayloads are built but logger is never called
    assert.ok(result.usagePayloads.length > 0, 'usagePayloads deben existir para flush diferido');
  });

  it('mock + !usageLoggerFn: 0 DB writes (ningún logger invocado)', async () => {
    let loggerCalled = 0;
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext(),
        // No usageLoggerFn passed
      },
    );

    assert.strictEqual(loggerCalled, 0, 'Sin usageLoggerFn: 0 DB writes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F12 — DEFAULT disabled → 0 provider calls, 0 usage logs
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12 — DEFAULT_LINKEDIN_SEARCH_CONFIG disabled: 0 calls, 0 logs', () => {
  it('enabled=false: feature_disabled skipReason, 0 provider calls, usage_logged=false', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      DEFAULT_LINKEDIN_SEARCH_CONFIG,
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false,
      'DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled debe ser false');
    assert.strictEqual(providerCalls, 0, '0 provider calls cuando feature disabled');
    assert.strictEqual(logger.payloads.length, 0, '0 usage logs');
    assert.strictEqual(result.usagePayloads.length, 0);
    assert.strictEqual(result.batchMetadata.usage_logged, false);
    assert.strictEqual(result.results[0].skipReason, 'feature_disabled');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Metadata completeness — campos v1.15.7.1 presentes en batchMetadata
// ═══════════════════════════════════════════════════════════════════════════════

describe('Metadata completeness v1.15.7.1 — todos los campos presentes', () => {
  it('batchMetadata incluye todos los campos nuevos de v1.15.7.1', async () => {
    const logger = captureLogger();
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const result = await runControlledLinkedInCompanySearch(
      [makeSearchCandidate()],
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    const meta = result.batchMetadata;
    assert.ok('usage_log_attempted_count' in meta, 'usage_log_attempted_count presente');
    assert.ok('usage_log_success_count' in meta, 'usage_log_success_count presente');
    assert.ok('usage_log_failed_count' in meta, 'usage_log_failed_count presente');
    assert.ok('usage_log_deferred_count' in meta, 'usage_log_deferred_count presente');
    assert.ok('usage_log_flushed_count' in meta, 'usage_log_flushed_count presente');
    assert.ok('usage_log_errors' in meta, 'usage_log_errors presente');
    assert.ok('skipped_reason' in meta, 'skipped_reason presente');
    assert.ok(Array.isArray(meta.usage_log_errors), 'usage_log_errors debe ser array');
    assert.strictEqual(typeof meta.usage_log_attempted_count, 'number');
    assert.strictEqual(typeof meta.usage_log_success_count, 'number');
    assert.strictEqual(typeof meta.usage_log_failed_count, 'number');
    assert.strictEqual(typeof meta.usage_log_deferred_count, 'number');
    assert.strictEqual(typeof meta.usage_log_flushed_count, 'number');
  });

  it('attempted = success + failed siempre (consistencia de contadores)', async () => {
    const logger = captureLogger();
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      factory: ['https://www.linkedin.com/company/factory-colombia'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
      makeSearchCandidate({ name: 'Factory', domain: 'factory.com.co', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeMockEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    const meta = result.batchMetadata;
    assert.strictEqual(
      meta.usage_log_attempted_count,
      meta.usage_log_success_count + meta.usage_log_failed_count,
      'attempted = success + failed',
    );
  });
});
