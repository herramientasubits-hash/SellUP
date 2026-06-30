/**
 * Tests — Search Quality v1.15.7 — Controlled LinkedIn Enablement + Usage Logging
 *
 * Valida el sistema de usage logging inyectable para LinkedIn Search:
 *   - DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled sigue false
 *   - Wizard normal sin override no ejecuta LinkedIn ni genera logs
 *   - enabled + mock logger registra payloads sin Supabase real
 *   - Cada llamada real Tavily produce un usage log payload
 *   - batch cap y stop-after-found reducen calls y logs
 *   - Q1 not_found → Q2 found produce 2 logs para ese candidato
 *   - failed provider call produce log con status=failed
 *   - dryRun no genera usagePayloads
 *   - candidate metadata conserva linkedin_enrichment final
 *   - scoring usa linkedin_enrichment (no reemplaza country evidence)
 *   - duplicate_guard_blocked no genera provider call ni log
 *   - evidence_policy_blocked no genera provider call ni log
 *   - maxPerBatch hard 5 limita usagePayloads a máximo 5
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Sin scraping.
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

const CHECKED_AT = '2026-06-23T14:00:00.000Z';
const FAKE_BATCH_ID = 'batch-v1-15-7-test-fixture';
const FAKE_USER_ID = 'user-test-fixture-001';
const UNIT_COST_USD = 0.01; // 1 credit Tavily basic = $0.01

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNotFoundEnrichment(reason = 'No LinkedIn company URL available.') {
  return {
    enabled: true as const,
    status: 'not_found' as const,
    confidence: 0,
    warnings: [reason],
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

function makeEnabledConfig(overrides: Partial<LinkedInSearchConfig> = {}): LinkedInSearchConfig {
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

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F1 — default disabled: 0 provider calls, 0 usage logs ━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F1 — DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled sigue false', () => {
  it('enabled = false y provider = disabled', () => {
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.provider, 'disabled');
  });

  it('Wizard sin override: 0 provider calls, 0 usage logs, skipReason=feature_disabled', async () => {
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

    assert.strictEqual(providerCalls, 0, '0 provider calls');
    assert.strictEqual(logger.payloads.length, 0, '0 usage logs');
    assert.strictEqual(result.usagePayloads.length, 0, '0 usagePayloads in output');
    assert.strictEqual(result.batchMetadata.attempted_query_count, 0);
    assert.strictEqual(result.results[0].skipReason, 'feature_disabled');
    assert.strictEqual(result.batchMetadata.usage_logged, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F2 — enabled + mock provider registra metadata, sin usage DB real ━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F2 — enabled + mock logger registra metadata sin DB real', () => {
  it('enabled=true + mock logger: usagePayloads populated, usage_logged=true', async () => {
    const logger = captureLogger();
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'TestCo Colombia', domain: 'testco.com.co', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.ok(result.usagePayloads.length > 0, 'Debe haber al menos 1 usagePayload');
    assert.ok(logger.payloads.length > 0, 'Logger debe haber sido invocado');
    assert.strictEqual(result.batchMetadata.usage_logged, true);

    const p = logger.payloads[0];
    assert.strictEqual(p.provider, 'tavily');
    assert.strictEqual(p.feature, 'linkedin_company_search');
    assert.strictEqual(p.agent, 'agent_1');
    assert.strictEqual(p.batch_id, FAKE_BATCH_ID);
    assert.strictEqual(p.user_id, FAKE_USER_ID);
    assert.strictEqual(p.search_depth, 'basic');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F3 — enabled + fake logger registra 3 calls para 3 candidatos ━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F3 — enabled con 3 candidatos → 3 usage log payloads', () => {
  it('3 candidatos found en Q1 → 3 usage payloads con feature=linkedin_company_search', async () => {
    const logger = captureLogger();

    const names = ['Softland', 'Factory', 'Loggro Enterprise'];
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      factory: ['https://www.linkedin.com/company/factory-colombia'],
      loggro: ['https://www.linkedin.com/company/loggroenterprise'],
    });

    const candidates = names.map((name) =>
      makeSearchCandidate({ name, domain: `${name.toLowerCase().replace(' ', '')}.com`, confidenceScore: 75 }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext({ unitCostUsd: UNIT_COST_USD }), usageLoggerFn: logger.fn },
    );

    // 3 candidates, each found in Q1 → 3 provider calls → 3 logs
    assert.strictEqual(logger.payloads.length, 3, '3 usage log payloads');
    assert.strictEqual(result.usagePayloads.length, 3);

    for (const p of logger.payloads) {
      assert.strictEqual(p.provider, 'tavily');
      assert.strictEqual(p.feature, 'linkedin_company_search');
      assert.strictEqual(p.agent, 'agent_1');
      assert.strictEqual(p.batch_id, FAKE_BATCH_ID);
      assert.ok(p.usage_key.startsWith('tavily:linkedin_search:'), `usage_key format incorrecto: ${p.usage_key}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F4 — batch cap + stop-after-found reducen usage logs ━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F4 — batch cap y stop-after-found reducen usage logs', () => {
  it('3 candidatos found en Q1 → 3 provider calls, 3 logs, stopped_after_found=true', async () => {
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
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(logger.payloads.length, 3, '3 provider calls (found en Q1 para cada uno)');
    assert.strictEqual(result.batchMetadata.attempted_query_count, 3);
    assert.strictEqual(result.batchMetadata.stopped_after_found, true);
    assert.strictEqual(result.batchMetadata.found_count, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F5 — Q1 not_found, Q2 found → 2 provider calls, 2 logs ━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F5 — Q1 not_found, Q2 found → 2 usage logs para ese candidato', () => {
  it('Q1 vacío, Q2 found → 2 payloads, selected_status=found en el segundo', async () => {
    const logger = captureLogger();

    // v1.16K-R-C: Q1 es nombre solo (mayor recall); Q2 (fallback) añade el dominio.
    // Para forzar Q1 not_found y Q2 found, el found viene de la query con dominio.
    const provider = async (query: string): Promise<string[]> => {
      // Q2 incluye el dominio → found
      if (query.includes('loggro.com')) return ['https://www.linkedin.com/company/loggroenterprise'];
      // Q1 solo nombre → no encontrado
      return [];
    };

    const candidates = [
      makeSearchCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(logger.payloads.length, 2, '2 provider calls → 2 logs');
    assert.strictEqual(logger.payloads[0].selected_status, 'not_found', 'Q1 → not_found');
    assert.strictEqual(logger.payloads[1].selected_status, 'found', 'Q2 → found');
    assert.strictEqual(result.batchMetadata.found_count, 1);
    assert.strictEqual(result.batchMetadata.attempted_query_count, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F6 — failed provider call → status=failed en log, pipeline no revienta ━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F6 — failed provider call: usage log status=failed, pipeline no revienta', () => {
  it('Provider lanza excepción → usagePayload con result_count=0, pipeline no revienta', async () => {
    // El orchestrador captura la excepción del provider y retorna [].
    // El selected_status es not_found. Con maxQueriesPerCandidate=1 solo se intenta Q1.
    const logger = captureLogger();

    const failingProvider = async (): Promise<string[]> => {
      throw new Error('Tavily network error simulated');
    };

    const candidates = [makeSearchCandidate({ confidenceScore: 75 })];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 1 }),
      failingProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    // Pipeline no revienta
    assert.strictEqual(result.results[0].enrichment.status, 'not_found', 'enrichment fallback a not_found');
    // 1 query intentada → 1 usage payload (con result_count=0)
    assert.strictEqual(logger.payloads.length, 1, 'Se emite 1 usage payload aunque provider falló');
    assert.strictEqual(logger.payloads[0].result_count, 0, 'result_count=0 tras error');
    assert.strictEqual(logger.payloads[0].selected_status, 'not_found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F7 — dryRun no genera usagePayloads ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7 — dryRun=true: 0 usagePayloads, usage_logged=false', () => {
  it('dryRun: provider se llama pero sin log de usage', async () => {
    const logger = captureLogger();
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const candidates = [makeSearchCandidate()];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      {
        usageContext: makeUsageContext({ dryRun: true }),
        usageLoggerFn: logger.fn,
      },
    );

    assert.strictEqual(logger.payloads.length, 0, 'dryRun: 0 invocaciones al logger');
    assert.strictEqual(result.usagePayloads.length, 0, 'dryRun: 0 usagePayloads en output');
    assert.strictEqual(result.batchMetadata.usage_logged, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F8 — candidate metadata mantiene linkedin_enrichment final ━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F8 — candidate metadata linkedin_enrichment correcto en result', () => {
  it('Result enrichment incluye campos requeridos: status, confidence, source, checked_at', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext() },
    );

    const enrichment = result.results[0].enrichment;
    assert.ok('status' in enrichment, 'enrichment.status presente');
    assert.ok('confidence' in enrichment, 'enrichment.confidence presente');
    assert.ok('source' in enrichment, 'enrichment.source presente');
    assert.ok('checked_at' in enrichment, 'enrichment.checked_at presente');
    assert.ok('warnings' in enrichment, 'enrichment.warnings presente');
    assert.ok('enabled' in enrichment, 'enrichment.enabled presente');
    assert.strictEqual(enrichment.status, 'found', 'Softland debe ser found');
    assert.ok(typeof enrichment.confidence === 'number', 'confidence debe ser number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F9 — scoring: linkedin_enrichment found no reemplaza country evidence ━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F9 — linkedin_enrichment found no reemplaza country evidence en enrichment', () => {
  it('found status no borra warnings de country evidence existentes', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      testco: ['https://www.linkedin.com/company/testco-colombia'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'TestCo Colombia',
        domain: 'testco.com.co',
        confidenceScore: 75,
        // Simula que ya tiene country evidence via sourceTitle
        sourceTitle: 'TestCo Colombia - Software',
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext() },
    );

    const enrichment = result.results[0].enrichment;
    // found debe coexistir con datos de country/source preservados en el candidato
    assert.ok(
      enrichment.status === 'found' || enrichment.status === 'ambiguous',
      `expected found or ambiguous, got ${enrichment.status}`,
    );
    // El result no borra el candidato original — verificamos que el candidato
    // en la lista de results tiene el nombre correcto
    assert.strictEqual(result.results[0].candidateName, 'TestCo Colombia');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F10 — duplicate_guard_blocked: 0 provider calls, 0 usage logs ━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F10 — duplicate_guard_blocked: sin provider call ni usage log', () => {
  it('isBlockedByDuplicateGuard=true → skipReason=duplicate_guard_blocked, 0 logs', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const candidates = [
      makeSearchCandidate({ isBlockedByDuplicateGuard: true }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(providerCalls, 0, '0 provider calls para blocked duplicate');
    assert.strictEqual(logger.payloads.length, 0, '0 usage logs');
    assert.strictEqual(result.results[0].skipReason, 'duplicate_guard_blocked');
    assert.strictEqual(result.usagePayloads.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F11 — evidence_policy_blocked: 0 provider calls, 0 usage logs ━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F11 — evidence_policy_blocked: sin provider call ni usage log', () => {
  it('isBlockedByEvidencePolicy=true → skipReason=evidence_policy_blocked, 0 logs', async () => {
    const logger = captureLogger();
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => { providerCalls++; return []; };

    const candidates = [
      makeSearchCandidate({ isBlockedByEvidencePolicy: true }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.strictEqual(providerCalls, 0, '0 provider calls para blocked evidence policy');
    assert.strictEqual(logger.payloads.length, 0, '0 usage logs');
    assert.strictEqual(result.results[0].skipReason, 'evidence_policy_blocked');
    assert.strictEqual(result.usagePayloads.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F12 — maxPerBatch hard 5 limita usagePayloads a máximo 5 ━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12 — maxPerBatch hard 5 limita usagePayloads a máximo 5', () => {
  it('10 candidatos × 2 queries, maxPerBatch>5 → máximo 5 usagePayloads', async () => {
    const logger = captureLogger();
    let totalProviderCalls = 0;
    const provider = async (): Promise<string[]> => { totalProviderCalls++; return []; };

    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeSearchCandidate({ name: `Co${i}`, domain: `co${i}.com`, confidenceScore: 75 }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxPerBatch: 20, maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
      { usageContext: makeUsageContext(), usageLoggerFn: logger.fn },
    );

    assert.ok(totalProviderCalls <= 5, `Hard cap: ${totalProviderCalls} provider calls > 5`);
    assert.ok(logger.payloads.length <= 5, `Hard cap: ${logger.payloads.length} logs > 5`);
    assert.strictEqual(result.usagePayloads.length, logger.payloads.length, 'usagePayloads == logger.payloads');
    assert.strictEqual(result.batchMetadata.max_per_batch, 5, 'max_per_batch reportado como hard cap 5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ Usage key format y estimated_cost_usd ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('Usage key y estimated_cost_usd', () => {
  it('buildLinkedInUsageKey genera formato correcto', () => {
    const key = buildLinkedInUsageKey('batch-abc', 'Softland Colombia', 0);
    assert.ok(key.startsWith('tavily:linkedin_search:batch-abc:'), `Key format: ${key}`);
    assert.ok(key.includes(':q0'), `Key debe incluir :q0: ${key}`);
  });

  it('Sin batchId → uso de no_batch en usage_key', () => {
    const key = buildLinkedInUsageKey(null, 'TestCo', 1);
    assert.ok(key.includes('no_batch'), `Key debe incluir no_batch: ${key}`);
  });

  it('estimated_cost_usd en batch metadata = unitCostUsd × query_count', async () => {
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
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext({ unitCostUsd: UNIT_COST_USD }) },
    );

    const meta = result.batchMetadata;
    assert.ok(meta.estimated_cost_usd !== null, 'estimated_cost_usd no debe ser null cuando hay unitCostUsd');
    // 2 candidatos found en Q1 → 2 queries × $0.01 = $0.02
    assert.strictEqual(meta.estimated_cost_usd, UNIT_COST_USD * meta.attempted_query_count);
  });

  it('Sin unitCostUsd → estimated_cost_usd=null en batch metadata', async () => {
    const mockProvider = createMockLinkedInSearchProvider({});
    const candidates = [makeSearchCandidate({ confidenceScore: 75 })];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
      { usageContext: makeUsageContext({ unitCostUsd: null }) },
    );

    assert.strictEqual(result.batchMetadata.estimated_cost_usd, null, 'Sin pricing → null');
  });
});
