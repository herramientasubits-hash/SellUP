/**
 * Tests — Search Quality v1.15.6 — LinkedIn Recall Improvement
 *
 * Valida estrategia de búsqueda por variantes, caps por candidato y por batch,
 * selección de múltiples resultados, y protecciones existentes.
 *
 * Fixtures:
 *   F1  — buildLinkedInSearchQueryVariants genera variantes correctas
 *   F2  — Se detiene tras found (Query 2 no se ejecuta)
 *   F3  — Query 1 not_found, Query 2 found → found + attempted_query_count=2
 *   F4  — maxQueriesPerCandidate=1 respeta el límite
 *   F5  — Batch cap en queries totales: 4 candidatos × 2 queries, cap=5
 *   F6  — Múltiples resultados Tavily: /school/ y /jobs/ rechazados, /company/ seleccionado
 *   F7  — Todos los resultados son non-company → rejected/not_found con warnings
 *   F8  — Mi-ERP vs Odoo global → ambiguous sin boost
 *   F9  — Visiontecno vs Zoho global → ambiguous sin boost
 *   F10 — Found con confidence >=70 + stopped_after_found registrado en batch metadata
 *   F11 — not_found persiste con warning claro
 *   F12 — DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled sigue false
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
  buildLinkedInSearchQuery,
  buildLinkedInSearchQueryVariants,
} from '../linkedin-company-search';
import type { LinkedInSearchConfig, ControlledLinkedInSearchCandidate } from '../linkedin-company-search';

// ─── Shared constants ─────────────────────────────────────────────────────────

const CHECKED_AT = '2026-06-23T12:00:00.000Z';

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

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F1 — buildLinkedInSearchQueryVariants genera variantes correctas ━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

// Nota v1.16K-R-C: Q1 ahora es la variante de MAYOR recall (nombre + site:, sin
// dominio bloqueante). Q2 (fallback) añade el dominio como señal blanda sin comillas.
describe('F1 — Query variants correctas', () => {
  it('Con dominio: Q1 sin dominio (recall) y Q2 con dominio como señal blanda', () => {
    const variants = buildLinkedInSearchQueryVariants('Loggro Enterprise', 'loggro.com', 2);
    assert.strictEqual(variants.length, 2);
    assert.strictEqual(variants[0], 'site:linkedin.com/company "Loggro Enterprise"');
    assert.strictEqual(variants[1], 'site:linkedin.com/company "Loggro Enterprise" loggro.com');
  });

  it('Sin dominio genera solo Q1 (nombre único)', () => {
    const variants = buildLinkedInSearchQueryVariants('Loggro Enterprise', null, 2);
    assert.strictEqual(variants.length, 1);
    assert.strictEqual(variants[0], 'site:linkedin.com/company "Loggro Enterprise"');
  });

  it('maxQueries=1 con dominio retorna solo Q1 (la menos restrictiva, sin dominio)', () => {
    const variants = buildLinkedInSearchQueryVariants('Softland', 'softland.com', 1);
    assert.strictEqual(variants.length, 1);
    assert.strictEqual(variants[0], 'site:linkedin.com/company "Softland"');
  });

  it('Factory + factory.com.co genera variantes correctas', () => {
    const variants = buildLinkedInSearchQueryVariants('Factory', 'factory.com.co', 2);
    assert.strictEqual(variants[0], 'site:linkedin.com/company "Factory"');
    assert.strictEqual(variants[1], 'site:linkedin.com/company "Factory" factory.com.co');
  });

  it('Q1 (sin dominio) ≠ Q2 (con dominio) cuando hay dominio válido', () => {
    const q1 = buildLinkedInSearchQuery('Softland', 'softland.com');
    const q2 = buildLinkedInSearchQuery('Softland', 'softland.com', { includeDomainSignal: true });
    assert.notStrictEqual(q1, q2);
    const variants = buildLinkedInSearchQueryVariants('Softland', 'softland.com', 2);
    assert.strictEqual(variants[0], q1);
    assert.strictEqual(variants[1], q2);
  });

  it('No usa país, sector, industria, ni keywords genéricas', () => {
    const variants = buildLinkedInSearchQueryVariants('TestCo', 'testco.com', 2);
    for (const v of variants) {
      assert.ok(!v.includes('Colombia'), 'No debe incluir país');
      assert.ok(!v.includes('software'), 'No debe incluir sector');
      assert.ok(!v.includes('empresa'), 'No debe incluir keyword genérica');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F2 — Se detiene tras found (Query 2 no se ejecuta) ━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F2 — Se detiene tras found', () => {
  it('Query 1 retorna found → Query 2 no se ejecuta', async () => {
    const queriesExecuted: string[] = [];

    const trackingProvider = async (query: string): Promise<string[]> => {
      queriesExecuted.push(query);
      // v1.16K-R-C: Q1 es la variante de mayor recall (nombre, SIN dominio).
      // Q2 (fallback) añade el dominio. Aquí Q1 ya retorna found.
      if (!query.includes('softland.com')) {
        return ['https://www.linkedin.com/company/softland'];
      }
      return [];
    };

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      trackingProvider,
      CHECKED_AT,
    );

    assert.strictEqual(queriesExecuted.length, 1, 'Solo Q1 debe ejecutarse');
    assert.strictEqual(result.results[0].enrichment.status, 'found');
    assert.strictEqual(result.batchMetadata.attempted_query_count, 1);
    assert.strictEqual(result.batchMetadata.stopped_after_found, true);
  });

  it('stopped_after_found=false cuando se ejecutan todas las queries sin found', async () => {
    const mockProvider = createMockLinkedInSearchProvider({});

    const candidates = [makeSearchCandidate({ name: 'TestCo', domain: 'testco.com' })];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
    );

    // No hubo found → stopped_after_found sigue false
    assert.strictEqual(result.batchMetadata.stopped_after_found, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F3 — Query 1 not_found, Query 2 found ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F3 — Q1 not_found, Q2 found', () => {
  it('Q1 (nombre solo) retorna vacío, Q2 (con dominio) retorna found → status=found, queries=2', async () => {
    const queriesExecuted: string[] = [];

    const provider = async (query: string): Promise<string[]> => {
      queriesExecuted.push(query);
      // v1.16K-R-C: Q2 (fallback) es la que añade el dominio como señal blanda.
      // Q2 incluye 'loggro.com' → found; Q1 (nombre solo) → not_found.
      if (query.includes('loggro.com')) {
        return ['https://www.linkedin.com/company/loggroenterprise'];
      }
      return [];
    };

    const candidates = [
      makeSearchCandidate({
        name: 'Loggro Enterprise',
        domain: 'loggro.com',
        confidenceScore: 75,
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
    );

    assert.strictEqual(queriesExecuted.length, 2, 'Deben ejecutarse Q1 y Q2');
    assert.strictEqual(result.results[0].enrichment.status, 'found');
    assert.strictEqual(result.batchMetadata.attempted_query_count, 2);
    assert.strictEqual(result.batchMetadata.found_count, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F4 — maxQueriesPerCandidate=1 respeta el límite ━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F4 — maxQueriesPerCandidate respetado', () => {
  it('maxQueriesPerCandidate=1 ejecuta solo Q1 aunque Q1 sea not_found', async () => {
    const queriesExecuted: string[] = [];

    const provider = async (query: string): Promise<string[]> => {
      queriesExecuted.push(query);
      return []; // always not_found
    };

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
    ];

    await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 1 }),
      provider,
      CHECKED_AT,
    );

    assert.strictEqual(queriesExecuted.length, 1, 'Solo Q1 con maxQueriesPerCandidate=1');
    // v1.16K-R-C: Q1 es la variante de mayor recall: nombre + site:, SIN dominio bloqueante.
    assert.ok(queriesExecuted[0].includes('"Softland"'), 'Q1 debe incluir el nombre entre comillas');
    assert.ok(
      queriesExecuted[0].includes('site:linkedin.com/company'),
      'Q1 debe incluir site:linkedin.com/company',
    );
    assert.ok(!queriesExecuted[0].includes('softland.com'), 'Q1 NO debe exigir el dominio');
  });

  it('maxQueriesPerCandidate=2 con not_found en Q1 ejecuta Q2', async () => {
    const queriesExecuted: string[] = [];

    const provider = async (query: string): Promise<string[]> => {
      queriesExecuted.push(query);
      return [];
    };

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
    ];

    await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
    );

    assert.strictEqual(queriesExecuted.length, 2, 'Q1 y Q2 con maxQueriesPerCandidate=2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F5 — Batch cap en queries totales ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F5 — Batch cap en queries totales', () => {
  it('4 candidatos × 2 queries, maxPerBatch=5 → no más de 5 provider calls', async () => {
    let totalCalls = 0;

    const provider = async (_query: string): Promise<string[]> => {
      totalCalls++;
      return []; // always not_found to force both queries per candidate
    };

    const candidates = Array.from({ length: 4 }, (_, i) =>
      makeSearchCandidate({
        name: `TestCo${i}`,
        domain: `testco${i}.com`,
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxPerBatch: 5, maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
    );

    assert.ok(totalCalls <= 5, `Provider calls ${totalCalls} debe ser ≤ 5`);
    assert.strictEqual(result.batchMetadata.attempted_query_count, totalCalls);
    assert.ok(result.batchMetadata.attempted_query_count <= 5);

    const batchCapResult = result.results.find((r) => r.skipReason === 'batch_cap_reached');
    assert.ok(batchCapResult, 'Al menos un candidato debe ser skipped por batch_cap_reached');
  });

  it('Hard cap no supera 5 aunque maxPerBatch > 5', async () => {
    let totalCalls = 0;
    const provider = async (): Promise<string[]> => {
      totalCalls++;
      return [];
    };

    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeSearchCandidate({ name: `Co${i}`, domain: `co${i}.com`, confidenceScore: 75 }),
    );

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxPerBatch: 20, maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
    );

    assert.ok(totalCalls <= 5, `Hard cap: ${totalCalls} > 5`);
    assert.strictEqual(result.batchMetadata.max_per_batch, 5, 'max_per_batch debe reportar hard cap 5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F6 — Múltiples resultados: /school/ y /jobs/ rechazados ━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F6 — Múltiples resultados: selección correcta', () => {
  it('Provider retorna /school/, /company/correct, /jobs/ → selecciona /company/correct', async () => {
    const provider = async (): Promise<string[]> => {
      return [
        'https://www.linkedin.com/school/testco-university',
        'https://www.linkedin.com/company/testco-colombia',
        'https://www.linkedin.com/jobs/view/testco-jobs',
      ];
    };

    const candidates = [
      makeSearchCandidate({
        name: 'TestCo Colombia',
        domain: 'testco.com.co',
        confidenceScore: 75,
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxResultsPerQuery: 3 }),
      provider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    // El pipeline rechaza /school/ y /jobs/, selecciona /company/testco-colombia
    assert.ok(
      enrichment.status === 'found' || enrichment.status === 'ambiguous',
      `Expected found or ambiguous, got ${enrichment.status}`,
    );
    if (enrichment.company_url) {
      assert.ok(enrichment.company_url.includes('/company/'), 'URL seleccionada debe ser /company/');
      assert.ok(!enrichment.company_url.includes('/school/'), 'No debe ser /school/');
      assert.ok(!enrichment.company_url.includes('/jobs/'), 'No debe ser /jobs/');
    }

    // samples deben registrar raw_result_count y rejected counts
    const sample = result.batchMetadata.samples[0];
    assert.ok(sample, 'Debe haber al menos un sample');
    assert.strictEqual(sample.raw_result_count, 3);
    assert.ok(sample.rejected_urls_count >= 2, `Debe rechazar ≥2 URLs no-company, got ${sample.rejected_urls_count}`);
  });

  it('maxResultsPerQuery=3 está registrado en batch metadata', async () => {
    const provider = async (): Promise<string[]> => [];

    const candidates = [makeSearchCandidate()];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxResultsPerQuery: 3 }),
      provider,
      CHECKED_AT,
    );

    assert.strictEqual(result.batchMetadata.max_results_per_query, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F7 — Todos non-company → rejected/not_found con warnings ━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7 — Todos non-company paths', () => {
  it('Solo /in/, /jobs/, /school/ → status rejected o not_found, warnings presentes', async () => {
    const provider = async (): Promise<string[]> => {
      return [
        'https://www.linkedin.com/in/john-doe',
        'https://www.linkedin.com/jobs/view/12345',
        'https://www.linkedin.com/school/testco-edu',
      ];
    };

    const candidates = [
      makeSearchCandidate({ name: 'TestCo', domain: 'testco.com', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxResultsPerQuery: 3 }),
      provider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.ok(
      enrichment.status === 'rejected' || enrichment.status === 'not_found',
      `Expected rejected or not_found, got ${enrichment.status}`,
    );
    assert.ok(enrichment.warnings.length > 0, 'Debe haber warnings');
    assert.ok(enrichment.confidence < 65, `Confidence debe ser baja, fue ${enrichment.confidence}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F8 — Mi-ERP vs Odoo → ambiguous sin boost ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F8 — Mi-ERP vs Odoo global protection', () => {
  it('Search retorna Odoo LinkedIn page → ambiguous, no found, no boost', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      'mi-erp': ['https://www.linkedin.com/company/odoo'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'Mi-ERP',
        domain: 'mi-erp.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.strictEqual(enrichment.status, 'ambiguous', 'Odoo debe resultar ambiguous para Mi-ERP');
    assert.ok(enrichment.confidence < 65, `No debe haber boost (confidence ${enrichment.confidence} < 65)`);
    assert.strictEqual(result.batchMetadata.found_count, 0, 'No debe haber found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F9 — Visiontecno vs Zoho → ambiguous sin boost ━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F9 — Visiontecno vs Zoho global protection', () => {
  it('Search retorna Zoho LinkedIn page → ambiguous, no boost', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      visiontecno: ['https://www.linkedin.com/company/zoho'],
    });

    const candidates = [
      makeSearchCandidate({
        name: 'Visiontecno',
        domain: 'visiontecno.com',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig(),
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.strictEqual(enrichment.status, 'ambiguous');
    assert.ok(enrichment.confidence < 65, `No debe haber boost (confidence ${enrichment.confidence})`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F10 — Found con confidence >=70 + stopped_after_found ━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F10 — Found confidence >=70 y stopped_after_found en metadata', () => {
  it('Found en Q1 con confidence >= 70 → stopped_after_found=true, qualify para boost', async () => {
    // TestCo + testco.com + /company/testco: sourceTitle contiene 'TestCo' → slug match → confidence >=70
    // (Mismo escenario que F14 en v1-15-4, confirmado passing)
    const queriesExecuted: string[] = [];

    const provider = async (query: string): Promise<string[]> => {
      queriesExecuted.push(query);
      // Q1 incluye 'testco.com' → retorna found
      if (query.includes('testco.com') || query.includes('TestCo')) {
        return ['https://www.linkedin.com/company/testco'];
      }
      return [];
    };

    const candidates = [
      makeSearchCandidate({
        name: 'TestCo',
        domain: 'testco.com',
        sourceTitle: 'TestCo Colombia - Software ERP',
        sourceSnippet: 'TestCo ofrece software ERP para empresas en Colombia.',
        confidenceScore: 75,
        currentEnrichment: makeNotFoundEnrichment(),
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      provider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.strictEqual(enrichment.status, 'found');
    assert.ok(enrichment.confidence >= 70, `confidence ${enrichment.confidence} debe ser >=70`);
    assert.strictEqual(queriesExecuted.length, 1, 'Solo Q1 ejecutada (stop after found)');
    assert.strictEqual(result.batchMetadata.stopped_after_found, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F11 — not_found persiste con warning claro ━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F11 — not_found persiste con warning claro', () => {
  it('Provider retorna [] para todas las queries → not_found con warning', async () => {
    const mockProvider = async (): Promise<string[]> => [];

    const candidates = [
      makeSearchCandidate({
        name: 'Factory',
        domain: 'factory.com.co',
        confidenceScore: 75,
      }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
    );

    const enrichment = result.results[0].enrichment;
    assert.strictEqual(enrichment.status, 'not_found');
    assert.ok(enrichment.warnings.length > 0, 'Debe haber al menos 1 warning');
    assert.strictEqual(result.batchMetadata.not_found_count, 1);
    assert.strictEqual(result.batchMetadata.found_count, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ F12 — DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled sigue false ━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12 — Default disabled permanece false', () => {
  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.provider, 'disabled');
  });

  it('runControlledLinkedInCompanySearch no llama provider cuando enabled=false', async () => {
    let providerCalls = 0;
    const provider = async (): Promise<string[]> => {
      providerCalls++;
      return [];
    };

    const candidates = [makeSearchCandidate()];
    const result = await runControlledLinkedInCompanySearch(
      candidates,
      DEFAULT_LINKEDIN_SEARCH_CONFIG,
      provider,
      CHECKED_AT,
    );

    assert.strictEqual(providerCalls, 0);
    assert.strictEqual(result.batchMetadata.attempted_query_count, 0);
    assert.strictEqual(result.results[0].skipReason, 'feature_disabled');
  });

  it('maxQueriesPerCandidate y maxResultsPerQuery tienen defaults seguros', () => {
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.maxQueriesPerCandidate, 2);
    assert.strictEqual(DEFAULT_LINKEDIN_SEARCH_CONFIG.maxResultsPerQuery, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ━━━ Metadata v1.15.6 registrada correctamente ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ═══════════════════════════════════════════════════════════════════════════════

describe('Metadata v1.15.6 — campos nuevos en batch', () => {
  it('Batch metadata incluye attempted_query_count, attempted_candidate_count, max_queries_per_candidate', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
      loggro: ['https://www.linkedin.com/company/loggroenterprise'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
      makeSearchCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com', confidenceScore: 75 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2, maxResultsPerQuery: 3 }),
      mockProvider,
      CHECKED_AT,
    );

    const meta = result.batchMetadata;
    assert.ok(typeof meta.attempted_query_count === 'number');
    assert.ok(typeof meta.attempted_candidate_count === 'number');
    assert.strictEqual(meta.max_queries_per_candidate, 2);
    assert.strictEqual(meta.max_results_per_query, 3);
    assert.ok(typeof meta.stopped_after_found === 'boolean');

    // attempted_count backward compat
    assert.strictEqual(meta.attempted_count, meta.attempted_candidate_count);
  });

  it('Samples incluyen domain, raw_result_count, confidence, y selected_url', async () => {
    const mockProvider = createMockLinkedInSearchProvider({
      softland: ['https://www.linkedin.com/company/softland'],
    });

    const candidates = [
      makeSearchCandidate({ name: 'Softland', domain: 'softland.com', confidenceScore: 80 }),
    ];

    const result = await runControlledLinkedInCompanySearch(
      candidates,
      makeEnabledConfig({ maxQueriesPerCandidate: 2 }),
      mockProvider,
      CHECKED_AT,
    );

    const sample = result.batchMetadata.samples[0];
    assert.ok(sample, 'Debe haber al menos un sample');
    assert.ok('domain' in sample, 'Sample debe tener campo domain');
    assert.ok('raw_result_count' in sample, 'Sample debe tener raw_result_count');
    assert.ok('confidence' in sample, 'Sample debe tener confidence');
    assert.ok('selected_url' in sample, 'Sample debe tener selected_url');
    assert.ok('found_urls_count' in sample, 'Sample debe tener found_urls_count');
    assert.ok('rejected_urls_count' in sample, 'Sample debe tener rejected_urls_count');
  });
});
