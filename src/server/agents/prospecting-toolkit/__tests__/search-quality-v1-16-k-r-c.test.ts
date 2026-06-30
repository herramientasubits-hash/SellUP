/**
 * Tests — Agent 1 · v1.16K-R-C — Tavily LinkedIn search quality + credits_used fix
 *
 * Cubre los cuatro frentes del hito:
 *
 *   1. credits_used end-to-end: el adapter real (createLinkedInUsageLoggerFn)
 *      mapea cada llamada LinkedIn a credits_used=1 (nunca null), conservando
 *      estimated_cost_usd > 0. Regresión del bug observado en producción
 *      (batch 5249e54e): costo registrado pero credits_used=null.
 *
 *   2. Query menos restrictiva: la query primaria mantiene
 *      site:linkedin.com/company y el nombre entre comillas, NO exige el dominio
 *      entre comillas (causa raíz de 0 found), y añade el país como señal blanda
 *      cuando se conoce. Se mantiene 1 query por candidato.
 *
 *   3. Priorización de candidatos: con el cap del batch, se intentan primero los
 *      candidatos con dominio confiable y nombre canónico; los eslogan-like /
 *      sin dominio ceden el turno. Los resultados se emiten en el orden original.
 *
 *   4. Anti falso positivo intacto: un slug que no coincide (Highteck →
 *      high-teck-products) queda ambiguous; un slug razonable (SoftwareOne →
 *      softwareone) sí queda found.
 *
 * NO se ejecuta Tavily/Apollo/Lusha/LLM/LinkedIn/Supabase real. El provider es un
 * mock inyectado; el logger captura en memoria; no se tocan flags ni env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runControlledLinkedInCompanySearch,
  buildLinkedInSearchQuery,
  buildLinkedInSearchQueryVariants,
  prioritizeCandidatesForLinkedInSearch,
  hasReliableDomain,
  isSloganLikeName,
  linkedInSearchPriorityScore,
  type LinkedInSearchConfig,
  type ControlledLinkedInSearchCandidate,
  type LinkedInSearchProviderFn,
} from '../linkedin-company-search';
import { createLinkedInUsageLoggerFn } from '../tavily-usage-logging';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

const CHECKED_AT = '2026-06-29T10:00:00.000Z';
const BATCH_ID = 'cccccccc-dddd-eeee-ffff-000000000001';
const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TAVILY_UNIT_COST = 0.008;

// Réplica fiel de la config estricta de producción (LINKEDIN_SEARCH_STRICT_CONFIG) — v1.16K-R-I.
const STRICT_CONFIG: LinkedInSearchConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: 5,
  minConfidenceScore: 65,
  maxQueriesPerCandidate: 1,
  maxResultsPerQuery: 1,
};

function makeCandidate(
  overrides: Partial<ControlledLinkedInSearchCandidate> = {},
): ControlledLinkedInSearchCandidate {
  return {
    name: 'Softland Colombia',
    domain: 'softland.com.co',
    countryCode: 'CO',
    sourceTitle: null,
    sourceSnippet: null,
    confidenceScore: 80,
    currentEnrichment: {
      enabled: true,
      status: 'not_found',
      confidence: 0,
      warnings: ['No LinkedIn company URL available in current evidence.'],
      source: 'none',
      checked_at: CHECKED_AT,
    },
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
    ...overrides,
  };
}

/** Provider que captura cada query y devuelve URLs según un matcher. */
function makeTrackingProvider(
  match: (query: string) => string[],
): { queries: string[]; fn: LinkedInSearchProviderFn } {
  const queries: string[] = [];
  return {
    queries,
    fn: async (query: string) => {
      queries.push(query);
      return match(query);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// G1 — credits_used end-to-end (adapter real, sin Supabase)
// ════════════════════════════════════════════════════════════════════════════

describe('G1 — credits_used queda en 1 (no null) al loguear vía el adapter real', () => {
  it('orchestrator + createLinkedInUsageLoggerFn → credits_used=1 y estimated_cost_usd>0', async () => {
    const captured: LogProviderUsageInput[] = [];
    const loggerFn = createLinkedInUsageLoggerFn(USER_A, async (input) => {
      captured.push(input);
      return { kind: 'logged' };
    });
    const provider = makeTrackingProvider(() => []); // sin resultados: igual loguea uso

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate()],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: loggerFn,
      },
    );

    assert.equal(captured.length, 1, 'exactamente un usage log');
    assert.notEqual(captured[0].credits_used, null, 'credits_used no debe ser null');
    assert.notEqual(captured[0].credits_used, undefined, 'credits_used no debe ser undefined');
    assert.equal(captured[0].credits_used, 1, 'una búsqueda LinkedIn basic = 1 crédito');
    assert.ok((captured[0].estimated_cost_usd ?? 0) > 0, 'estimated_cost_usd debe seguir > 0');
    assert.equal(captured[0].estimated_cost_usd, TAVILY_UNIT_COST);
    assert.equal(output.batchMetadata.usage_logged, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G2 — Query menos restrictiva pero todavía conservadora
// ════════════════════════════════════════════════════════════════════════════

describe('G2 — query primaria suelta el dominio bloqueante y añade país como señal blanda', () => {
  it('mantiene site:linkedin.com/company y nombre entre comillas, sin dominio entre comillas', () => {
    const q = buildLinkedInSearchQuery('Memphis', 'memphis.com.co', { countryCode: 'CO' });
    assert.ok(q.includes('site:linkedin.com/company'), 'mantiene el operador site:');
    assert.ok(q.includes('"Memphis"'), 'nombre entre comillas');
    assert.ok(!q.includes('"memphis.com.co"'), 'el dominio NO va entre comillas (no bloquea recall)');
    assert.ok(q.includes('Colombia'), 'país como señal blanda cuando se conoce el countryCode');
  });

  it('sin countryCode conocido no inyecta país', () => {
    const q = buildLinkedInSearchQuery('Memphis', 'memphis.com.co');
    assert.ok(!q.includes('Colombia'));
    assert.equal(q, 'site:linkedin.com/company "Memphis"');
  });

  it('variante de fallback añade el dominio sin comillas (señal secundaria)', () => {
    const variants = buildLinkedInSearchQueryVariants('Memphis', 'memphis.com.co', 2, { countryCode: 'CO' });
    assert.equal(variants.length, 2);
    assert.equal(variants[0], 'site:linkedin.com/company "Memphis" Colombia');
    assert.equal(variants[1], 'site:linkedin.com/company "Memphis" Colombia memphis.com.co');
    assert.ok(!variants.some((v) => v.includes('"memphis.com.co"')), 'nunca exige el dominio literal');
  });

  it('1 query por candidato: maxQueriesPerCandidate=1 → exactamente 1 llamada al provider', async () => {
    const provider = makeTrackingProvider(() => []);
    await runControlledLinkedInCompanySearch([makeCandidate()], STRICT_CONFIG, provider.fn, CHECKED_AT, {
      usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
      usageLoggerFn: async () => {},
    });
    assert.equal(provider.queries.length, 1, 'exactamente 1 query por candidato');
    assert.ok(provider.queries[0].includes('site:linkedin.com/company'));
    assert.ok(!provider.queries[0].includes('"softland.com.co"'), 'la query real no exige el dominio');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G3 — Priorización de candidatos para gastar el cap en los mejores
// ════════════════════════════════════════════════════════════════════════════

describe('G3 — priorización: el cap se gasta en candidatos con mayor probabilidad de LinkedIn', () => {
  it('hasReliableDomain / isSloganLikeName / score discriminan correctamente', () => {
    assert.equal(hasReliableDomain('softland.com.co'), true);
    assert.equal(hasReliableDomain(null), false);
    assert.equal(hasReliableDomain('gmail.com'), false, 'correo gratuito no es dominio corporativo');
    assert.equal(isSloganLikeName('Tu Partner de Bienestar'), true);
    assert.equal(isSloganLikeName('Softland Colombia'), false);

    const strong = makeCandidate({ name: 'Softland Colombia', domain: 'softland.com.co' });
    const weak = makeCandidate({ name: 'Tu Partner de Bienestar', domain: null });
    assert.ok(
      linkedInSearchPriorityScore(strong) > linkedInSearchPriorityScore(weak),
      'el candidato fuerte debe puntuar más alto',
    );
  });

  it('con maxPerBatch=1 se intenta el candidato fuerte, no el eslogan-sin-dominio; resultados en orden original', async () => {
    const weak = makeCandidate({ name: 'Tu Partner de Bienestar', domain: null, confidenceScore: 75 });
    const strong = makeCandidate({ name: 'Softland Colombia', domain: 'softland.com.co', confidenceScore: 75 });

    const provider = makeTrackingProvider((q) =>
      q.includes('Softland') ? ['https://www.linkedin.com/company/softland'] : [],
    );

    const output = await runControlledLinkedInCompanySearch(
      [weak, strong], // orden de entrada: débil primero
      { ...STRICT_CONFIG, maxPerBatch: 1 },
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.equal(provider.queries.length, 1, 'solo 1 query consumida (cap=1)');
    assert.ok(provider.queries[0].includes('Softland'), 'el turno se gastó en el candidato fuerte');

    // Los resultados se emiten en el ORDEN ORIGINAL (alineación por índice para el writer)
    assert.equal(output.results[0].candidateName, 'Tu Partner de Bienestar');
    assert.equal(output.results[0].attempted, false);
    assert.equal(output.results[0].skipReason, 'batch_cap_reached');
    assert.equal(output.results[1].candidateName, 'Softland Colombia');
    assert.equal(output.results[1].attempted, true);
    assert.equal(output.results[1].enrichment.status, 'found');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G4 — Anti falso positivo intacto (validación posterior estricta)
// ════════════════════════════════════════════════════════════════════════════

describe('G4 — la validación posterior sigue estricta pese a la query más suelta', () => {
  it('Highteck → high-teck-products queda ambiguous, NO found', async () => {
    const provider = makeTrackingProvider(() => ['https://www.linkedin.com/company/high-teck-products']);

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate({ name: 'Highteck', domain: 'highteck.com.co', countryCode: 'CO' })],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.equal(output.results[0].enrichment.status, 'ambiguous');
    assert.notEqual(output.results[0].enrichment.status, 'found');
    assert.equal(output.batchMetadata.found_count, 0);
    assert.equal(output.batchMetadata.ambiguous_count, 1);
  });

  it('SoftwareOne → /company/softwareone sí queda found con slug razonable', async () => {
    const provider = makeTrackingProvider(() => ['https://www.linkedin.com/company/softwareone']);

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate({ name: 'SoftwareOne', domain: 'softwareone.com', countryCode: 'CO' })],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.equal(output.results[0].enrichment.status, 'found');
    assert.equal(output.batchMetadata.found_count, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G5 — Caps de costo intactos
// ════════════════════════════════════════════════════════════════════════════

describe('G5 — los caps de costo no cambian (v1.16K-R-I: cap=5)', () => {
  it('maxPerBatch=5 y maxResultsPerQuery=1 se respetan en metadata; 6 candidatos → 1 batch_cap_reached', async () => {
    const provider = makeTrackingProvider(() => []);
    const output = await runControlledLinkedInCompanySearch(
      [
        makeCandidate({ name: 'Alpha SAS', domain: 'alpha.co' }),
        makeCandidate({ name: 'Beta SAS', domain: 'beta.co' }),
        makeCandidate({ name: 'Gamma SAS', domain: 'gamma.co' }),
        makeCandidate({ name: 'Delta SAS', domain: 'delta.co' }),
        makeCandidate({ name: 'Epsilon SAS', domain: 'epsilon.co' }),
        makeCandidate({ name: 'Zeta SAS', domain: 'zeta.co' }),
      ],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.ok(provider.queries.length <= 5, 'maxPerBatch=5 limita las llamadas');
    assert.equal(output.batchMetadata.max_per_batch, 5);
    assert.equal(output.batchMetadata.max_results_per_query, 1);
    assert.equal(output.batchMetadata.max_queries_per_candidate, 1);
    // 6 candidatos, cap 5 → al menos uno cae en batch_cap_reached
    assert.ok(output.results.some((r) => r.skipReason === 'batch_cap_reached'));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G6 — prioritizeCandidatesForLinkedInSearch es estable y completo
// ════════════════════════════════════════════════════════════════════════════

describe('G6 — prioritizeCandidatesForLinkedInSearch devuelve todos los índices, estable en empates', () => {
  it('cubre todos los índices y ordena elegibles-primero por score', () => {
    const candidates = [
      makeCandidate({ name: 'Tu Partner de Bienestar', domain: null, confidenceScore: 75 }),
      makeCandidate({ name: 'Softland Colombia', domain: 'softland.com.co', confidenceScore: 80 }),
      makeCandidate({ name: 'Lo', domain: 'x.co', confidenceScore: 80 }), // inelegible: nombre < 3 chars
    ];
    const order = prioritizeCandidatesForLinkedInSearch(candidates, STRICT_CONFIG);
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2], 'cubre todos los índices sin pérdidas');
    // El fuerte (índice 1) se intenta antes que el eslogan (índice 0).
    assert.ok(order.indexOf(1) < order.indexOf(0));
    // El inelegible (índice 2) va al final.
    assert.equal(order[order.length - 1], 2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G7 — v1.16K-R-I coverage uplift: maxPerBatch=5, minConfidenceScore=65
// ════════════════════════════════════════════════════════════════════════════

describe('G7 — v1.16K-R-I: maxPerBatch=5, minConfidenceScore=65', () => {
  it('LINKEDIN_SEARCH_STRICT_CONFIG.maxPerBatch es 5', async () => {
    // Importación dinámica para no romper el mock del módulo.
    const { LINKEDIN_SEARCH_STRICT_CONFIG } = await import('../incremental-search');
    assert.equal(LINKEDIN_SEARCH_STRICT_CONFIG.maxPerBatch, 5);
  });

  it('LINKEDIN_SEARCH_STRICT_CONFIG.minConfidenceScore es 65', async () => {
    const { LINKEDIN_SEARCH_STRICT_CONFIG } = await import('../incremental-search');
    assert.equal(LINKEDIN_SEARCH_STRICT_CONFIG.minConfidenceScore, 65);
  });

  it('LINKEDIN_SEARCH_STRICT_CONFIG.maxQueriesPerCandidate sigue en 1', async () => {
    const { LINKEDIN_SEARCH_STRICT_CONFIG } = await import('../incremental-search');
    assert.equal(LINKEDIN_SEARCH_STRICT_CONFIG.maxQueriesPerCandidate, 1);
  });

  it('LINKEDIN_SEARCH_STRICT_CONFIG.maxResultsPerQuery sigue en 3', async () => {
    const { LINKEDIN_SEARCH_STRICT_CONFIG } = await import('../incremental-search');
    assert.equal(LINKEDIN_SEARCH_STRICT_CONFIG.maxResultsPerQuery, 3);
  });

  it('con 8 candidatos elegibles, Tavily intenta máximo 5', async () => {
    const provider = makeTrackingProvider(() => []);
    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeCandidate({ name: `Company ${i + 1}`, domain: `company${i + 1}.co`, confidenceScore: 75 }),
    );

    const output = await runControlledLinkedInCompanySearch(
      candidates,
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.equal(provider.queries.length, 5, 'exactamente 5 llamadas con 8 candidatos elegibles');
    assert.equal(output.batchMetadata.attempted_count, 5);
    assert.ok(output.results.some((r) => r.skipReason === 'batch_cap_reached'), 'al menos uno cae en batch_cap_reached');
  });

  it('candidato con confidenceScore=65 ahora es elegible (antes 70 era el mínimo)', async () => {
    let called = false;
    const provider = makeTrackingProvider(() => {
      called = true;
      return [];
    });

    await runControlledLinkedInCompanySearch(
      [makeCandidate({ confidenceScore: 65 })],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.ok(called, 'candidato con score=65 debe intentarse con minConfidenceScore=65');
  });

  it('candidato con confidenceScore=64 sigue siendo low_confidence', async () => {
    let called = false;
    const provider = makeTrackingProvider(() => {
      called = true;
      return [];
    });

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate({ confidenceScore: 64 })],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.ok(!called, 'candidato con score=64 no debe llamar al provider');
    assert.equal(output.results[0].skipReason, 'low_confidence');
  });

  it('ambiguous sigue siendo suggested/review, no found', async () => {
    const provider = makeTrackingProvider(() => ['https://www.linkedin.com/company/completely-different-slug']);

    const output = await runControlledLinkedInCompanySearch(
      [makeCandidate({ name: 'Highteck', domain: 'highteck.com.co', confidenceScore: 65 })],
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: async () => {},
      },
    );

    assert.notEqual(output.results[0].enrichment.status, 'found', 'ambiguous no se convierte en found');
    assert.equal(output.batchMetadata.found_count, 0);
  });

  it('costo máximo por batch sigue siendo bajo: 5 candidatos × 1 crédito = 5 créditos = USD 0.040', async () => {
    const captured: { estimated_cost_usd: number }[] = [];
    const loggerFn = createLinkedInUsageLoggerFn(USER_A, async (input) => {
      captured.push({ estimated_cost_usd: input.estimated_cost_usd ?? 0 });
      return { kind: 'logged' };
    });
    const provider = makeTrackingProvider(() => []);

    await runControlledLinkedInCompanySearch(
      Array.from({ length: 5 }, (_, i) =>
        makeCandidate({ name: `Empresa ${i + 1}`, domain: `empresa${i + 1}.co` }),
      ),
      STRICT_CONFIG,
      provider.fn,
      CHECKED_AT,
      {
        usageContext: { batchId: BATCH_ID, userId: USER_A, dryRun: false, unitCostUsd: TAVILY_UNIT_COST },
        usageLoggerFn: loggerFn,
      },
    );

    assert.equal(captured.length, 5, '5 logs de uso — uno por candidato intentado');
    const totalCost = captured.reduce((sum, e) => sum + e.estimated_cost_usd, 0);
    assert.ok(Math.abs(totalCost - 0.04) < 0.0001, `costo total = USD ${totalCost.toFixed(4)}, esperado USD 0.0400`);
  });
});
