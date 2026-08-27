/**
 * AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 §§ 2, 4, 5, 7, 8, 9, 10, 11 — exactitud de
 * objetivo y precisión de macro industria, escritas contra la PRIMERA corrida
 * real de Lusha en Producción.
 *
 * ── Los dos defectos que estas pruebas fijan ──────────────────────────────────
 *
 * Lote `e90832f9` (health_pharma · CO · 2026-08-19), objetivo 5:
 *
 *   · P0-A — se persistieron NUEVE. El tope de PETICIONES funcionó (paró en 3 de
 *     6 peticiones), pero dentro de una página ya pagada no había ningún tope de
 *     ACEPTACIÓN: la rama 0 dejó 4 útiles y la rama 1 empujó sus 5 revisables
 *     enteras. El objetivo se rebasó donde ya no quedaba petición que frenar.
 *   · P0-B — cinco de las nueve eran Manufacturing genérico —cervecera,
 *     electrodomésticos, concesionario, astillero, cosmética— con 100/100 y sin un
 *     solo `industry_mismatch`, porque el contraste comparaba en los dos sentidos
 *     y la palabra `Pharmaceuticals Manufacturing` CONTIENE a `Manufacturing`.
 *
 * ── Por qué la fixture no lleva marcas reales ─────────────────────────────────
 *
 * § 8 pide reproducir la FORMA, no los nombres. Una prueba anclada a «Bavaria»
 * pasaría con un `if (name === 'Bavaria')` en producción, que es exactamente la
 * solución prohibida. Aquí las empresas son anónimas y lo único que decide es la
 * industria DECLARADA y la rama que las trajo.
 *
 * Todo entra inyectado: sin red, sin DB, sin cliente de Lusha, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  persistLushaPendingReviewBatch,
  buildLushaPendingReviewCandidateRows,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type LushaMultiBranchExecution,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  canAcceptLushaUsefulCandidate,
  resolveLushaRemainingGap,
} from '@/server/prospect-batches/lusha-multibranch-execution';
import {
  assessLushaMacroPrecision,
  isLushaMacroPrecisionAdmitted,
} from '@/server/prospect-batches/lusha-macro-precision';
import { resolveLushaMacroSearchPlan } from '@/server/prospect-batches/lusha-macro-search-plan';
import { normalizeLushaPreviewCompany } from '@/server/prospect-batches/lusha-preview';
import type {
  LushaPreviewCompany,
  LushaPreviewCriteria,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  // AGENT1-LOCAL-CUT9A §§ 3, 8 — identidad de EJECUCIÓN + objetivo PEDIDO.
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: 5,
};

/** Las tres ramas REALES de `health_pharma`, del catálogo (no escritas a mano). */
const HEALTH_PHARMA_PLAN = resolveLushaMacroSearchPlan('health_pharma');

function company(
  id: string,
  industry: string,
  overrides: Partial<LushaPreviewCompany> = {},
): LushaPreviewCompany {
  return {
    providerCompanyId: id,
    name: `Empresa ${id}`,
    domain: `${id}.com`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry,
    employeesExact: 700,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 100,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function successResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud & Farmacéuticos',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function noDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

type SearchCall = {
  page: number | null | undefined;
  mainIndustryId: number | null;
  subIndustryId: number | null;
};

function makeDeps(
  script: LushaPreviewResult[],
  overrides: Partial<PersistLushaPendingReviewDeps> = {},
) {
  const calls: SearchCall[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      const branch = (
        input as { industryBranch?: { mainIndustryId: number; subIndustryId?: number | null } }
      ).industryBranch;
      calls.push({
        page: input.page,
        mainIndustryId: branch?.mainIndustryId ?? null,
        subIndustryId: branch?.subIndustryId ?? null,
      });
      return script[calls.length - 1] ?? successResult([]);
    },
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      batches.push(row);
      return { id: `batch-${batches.length}`, adopted: false, identityEpoch: 0 };
    },
    // CUT-3B4-CORRECCIÓN — la valla es OBLIGATORIA; esta prueba modela la 126
    // SIN aplicar por la ÚNICA puerta legítima: la respuesta de la BASE.
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicate(input),
    fetchActiveCandidates: async () => [],
    ...overrides,
  };

  return { deps, calls, batches, candidateRows };
}

function run(
  script: LushaPreviewResult[],
  execution?: LushaMultiBranchExecution,
  overrides?: Partial<PersistLushaPendingReviewDeps>,
) {
  const harness = makeDeps(script, overrides);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

function healthPharmaExecution(targetGap: number): LushaMultiBranchExecution {
  assert.ok(HEALTH_PHARMA_PLAN, 'el catálogo debe publicar el plan de health_pharma');
  return { plan: HEALTH_PHARMA_PLAN, targetGap, creditsReserved: 6 };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10 — PRECISIÓN
// ─────────────────────────────────────────────────────────────────────────────

const BRANCH_MAIN_HEALTHCARE = { mainIndustryId: 11, label: 'Healthcare' } as const;
const BRANCH_SUB_PHARMA = {
  mainIndustryId: 12,
  subIndustryId: 71,
  label: 'Pharmaceuticals Manufacturing',
} as const;
const BRANCH_MAIN_MANUFACTURING = { mainIndustryId: 12, label: 'Manufacturing' } as const;

function precision(
  macroIndustryKey: string,
  branch: typeof BRANCH_MAIN_HEALTHCARE | typeof BRANCH_SUB_PHARMA | typeof BRANCH_MAIN_MANUFACTURING | null,
  declaredIndustry: string | null,
) {
  return assessLushaMacroPrecision({
    macroIndustryKey,
    branch,
    branchIndex: 0,
    declaredIndustry,
  });
}

describe('§ 10 — precisión de macro industria, branch-aware', () => {
  it('A — health_pharma + rama 12/71 + "Manufacturing" ⇒ NO confirmado, NO útil', () => {
    const verdict = precision('health_pharma', BRANCH_SUB_PHARMA, 'Manufacturing');
    assert.notEqual(verdict.verdict, 'confirmed');
    assert.equal(verdict.reason, 'sub_industry_branch_parent_only');
    assert.equal(isLushaMacroPrecisionAdmitted(verdict), false);
  });

  it('B — health_pharma + rama 12/71 + "Pharmaceuticals Manufacturing" ⇒ confirmado', () => {
    const verdict = precision('health_pharma', BRANCH_SUB_PHARMA, 'Pharmaceuticals Manufacturing');
    assert.equal(verdict.verdict, 'confirmed');
    assert.equal(isLushaMacroPrecisionAdmitted(verdict), true);
  });

  it('C — health_pharma + rama main 11 + "Healthcare" ⇒ válido', () => {
    const verdict = precision('health_pharma', BRANCH_MAIN_HEALTHCARE, 'Healthcare');
    assert.equal(verdict.verdict, 'confirmed');
    assert.equal(verdict.reason, 'branch_main_industry_declared');
  });

  it('D — la macro cuyo main ES Manufacturing SÍ admite "Manufacturing"', () => {
    // El rechazo de Manufacturing es de la RAMA, no global: en
    // `industry_manufacturing_chemicals_automotive` el main 12 desnudo es la forma
    // aprobada de la macro, y rechazarlo ahí vaciaría una macro entera.
    const verdict = precision(
      'industry_manufacturing_chemicals_automotive',
      BRANCH_MAIN_MANUFACTURING,
      'Manufacturing',
    );
    assert.equal(verdict.verdict, 'confirmed');
    assert.equal(verdict.reason, 'branch_main_industry_declared');
  });

  it('E — una señal de otra macro (alimentos) se RECHAZA por exclusión canónica', () => {
    const verdict = precision('health_pharma', BRANCH_SUB_PHARMA, 'Food & Beverages');
    assert.equal(verdict.verdict, 'rejected');
    assert.equal(verdict.reason, 'excluding_industry_declared');
    assert.equal(isLushaMacroPrecisionAdmitted(verdict), false);
  });

  it('F — el padre genérico NO puede ganar por substring inverso', () => {
    // La etiqueta de la rama CONTIENE la industria declarada. Ese es el sentido
    // prohibido, y es el que produjo el defecto en Producción.
    assert.ok('Pharmaceuticals Manufacturing'.includes('Manufacturing'));
    assert.notEqual(precision('health_pharma', BRANCH_SUB_PHARMA, 'Manufacturing').verdict, 'confirmed');
    // Y la comparación canónica del catálogo tampoco lo salva.
    assert.notEqual(precision('health_pharma', null, 'Manufacturing').verdict, 'confirmed');
  });

  it('sin industria declarada NO se confirma: la ausencia no demuestra nada', () => {
    const verdict = precision('health_pharma', BRANCH_MAIN_HEALTHCARE, null);
    assert.equal(verdict.verdict, 'ambiguous');
    assert.equal(verdict.reason, 'no_declared_industry');
    assert.equal(isLushaMacroPrecisionAdmitted(verdict), false);
  });

  it('una macro que el catálogo no reconoce es fail-closed', () => {
    const verdict = precision('education', BRANCH_MAIN_HEALTHCARE, 'Healthcare');
    assert.equal(verdict.verdict, 'ambiguous');
    assert.equal(verdict.reason, 'macro_industry_unresolved');
    assert.equal(isLushaMacroPrecisionAdmitted(verdict), false);
  });

  it('la procedencia de rama viaja en el veredicto, sin payload del proveedor', () => {
    const verdict = assessLushaMacroPrecision({
      macroIndustryKey: 'health_pharma',
      branch: BRANCH_SUB_PHARMA,
      branchIndex: 1,
      declaredIndustry: 'Pharmaceuticals Manufacturing',
    });
    assert.deepEqual(verdict.branch, {
      branchIndex: 1,
      mainIndustryId: 12,
      subIndustryId: 71,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 4 — el contraste de calidad ya no confirma al revés
// ─────────────────────────────────────────────────────────────────────────────

function criteria(matchKeywords: string[]): LushaPreviewCriteria {
  return {
    expectedCountryName: 'Colombia',
    expectedCountryIso2: 'CO',
    industryKey: 'health_pharma',
    sectorLabel: 'Salud & Farmacéuticos',
    matchKeywords,
    sizeBand: { min: 201, max: 5000 },
    minScore: 70,
  };
}

describe('§ 4 — `industryMatches` es asimétrico', () => {
  it('un padre amplio ya NO coincide con una palabra específica que lo contiene', () => {
    const normalized = normalizeLushaPreviewCompany(
      { id: 'x', name: 'X', domain: 'x.com', country: 'Colombia', countryIso2: 'CO', industry: 'Manufacturing', employeeCountExact: 700 },
      criteria(['Healthcare', 'Pharmaceuticals Manufacturing', 'Medical Equipment']),
    );
    assert.ok(normalized.issues.includes('industry_mismatch'));
    assert.equal(normalized.score, 80);
  });

  it('la palabra específica SÍ coincide cuando la declarada la contiene', () => {
    const normalized = normalizeLushaPreviewCompany(
      { id: 'x', name: 'X', domain: 'x.com', country: 'Colombia', countryIso2: 'CO', industry: 'Pharmaceuticals Manufacturing', employeeCountExact: 700 },
      criteria(['Healthcare', 'Pharmaceuticals Manufacturing']),
    );
    assert.equal(normalized.issues.includes('industry_mismatch'), false);
    assert.equal(normalized.score, 100);
  });

  it('MUTACIÓN — restaurar el sentido inverso vuelve a romper el contraste', () => {
    // La mutación exacta que se prohíbe: `palabra.includes(declarada)`.
    const declared = 'manufacturing';
    const keyword = 'pharmaceuticals manufacturing';
    const forwardOnly = declared.includes(keyword);
    const withInverse = declared.includes(keyword) || keyword.includes(declared);
    assert.equal(forwardOnly, false, 'el sentido vivo NO puede confirmar');
    assert.equal(withInverse, true, 'el sentido inverso es exactamente el defecto');
  });

  it('RATCHET — el `||` invertido no vuelve al código de `industryMatches`', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/server/prospect-batches/lusha-preview.ts'),
      'utf8',
    );
    const fn = source.slice(
      source.indexOf('function industryMatches('),
      source.indexOf('function employeesOutOfBand('),
    );
    assert.ok(fn.length > 0, 'la función debe existir');
    assert.equal(
      fn.includes('normalizedKeyword.includes(normalized)'),
      false,
      'el contraste inverso está prohibido: confirma un padre con el nombre de su hija',
    );
    assert.ok(fn.includes('normalized.includes(normalizedKeyword)'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 9 — EXACTITUD DE OBJETIVO
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 9 — el objetivo se cumple EXACTAMENTE', () => {
  it('política pura: el tope de aceptación es el hueco restante', () => {
    assert.equal(canAcceptLushaUsefulCandidate(5, 4), true);
    assert.equal(canAcceptLushaUsefulCandidate(5, 5), false);
    assert.equal(canAcceptLushaUsefulCandidate(5, 9), false);
    assert.equal(resolveLushaRemainingGap(5, 9), 0);
  });

  it('A — objetivo 5, rama 0 da 4 y rama 1 ofrece 5 ⇒ se persisten EXACTAMENTE 5', () => {
    // Ésta es la forma literal del lote de Producción, con marcas anónimas.
    const branch0 = successResult(
      Array.from({ length: 4 }, (_, i) => company(`h${i}`, 'Healthcare')),
    );
    const branch1 = successResult([
      company('m0', 'Manufacturing'),
      company('m1', 'Manufacturing'),
      company('m2', 'Manufacturing'),
      company('m3', 'Manufacturing'),
      company('p0', 'Pharmaceuticals Manufacturing'),
    ]);
    return run([branch0, branch1], healthPharmaExecution(5)).then(({ res, calls, candidateRows }) => {
      assert.equal(res.status, 'success');
      assert.equal(res.usefulCandidatesCount, 5);
      assert.equal(candidateRows.length, 5);
      // La farmacéutica REAL cierra el hueco; los cuatro genéricos no.
      assert.deepEqual(
        candidateRows.map((r) => r.industry).sort(),
        ['Healthcare', 'Healthcare', 'Healthcare', 'Healthcare', 'Pharmaceuticals Manufacturing'],
      );
      // Rama 2 (12/80) nunca se pide.
      assert.equal(calls.length, 2);
      assert.equal(res.precisionRejectedTotal, 4);
      assert.equal(res.targetOverflowDiscarded, 0);
      assert.equal(res.remainingGapFinal, 0);
      assert.equal(res.stopReason, 'target_reached');
    });
  });

  it('B — objetivo 2 y una primera página con 10 revisables ⇒ 2, sin segunda petición', () => {
    const page = successResult(
      Array.from({ length: 10 }, (_, i) => company(`h${i}`, 'Healthcare')),
    );
    return run([page], healthPharmaExecution(2)).then(({ res, calls, candidateRows }) => {
      assert.equal(res.usefulCandidatesCount, 2);
      assert.equal(candidateRows.length, 2);
      assert.equal(calls.length, 1, 'una sola petición: el objetivo se cerró en la primera');
      assert.equal(res.reviewableFoundTotal, 10);
      assert.equal(res.targetOverflowDiscarded, 8);
    });
  });

  it('C — 10 en la página y sólo 1 con precisión ⇒ útiles sube 1, no 10', () => {
    const page = successResult([
      ...Array.from({ length: 9 }, (_, i) => company(`m${i}`, 'Manufacturing')),
      company('p0', 'Pharmaceuticals Manufacturing'),
    ]);
    // Una sola rama (la que estrecha por sub 71) para aislar el efecto.
    const execution: LushaMultiBranchExecution = {
      plan: { macroKey: 'health_pharma', branches: [BRANCH_SUB_PHARMA] },
      targetGap: 5,
      creditsReserved: 2,
    };
    return run([page, successResult([])], execution).then(({ res, candidateRows }) => {
      assert.equal(res.usefulCandidatesCount, 1);
      assert.equal(candidateRows.length, 1);
      assert.equal(res.precisionRejectedTotal, 9);
      assert.equal(res.reviewableFoundTotal, 1);
      assert.equal(res.targetOverflowDiscarded, 0);
    });
  });

  it('D — un sobrante NO se contabiliza como duplicado ni como descarte del guard', () => {
    const page = successResult(
      Array.from({ length: 8 }, (_, i) => company(`h${i}`, 'Healthcare')),
    );
    return run([page], healthPharmaExecution(5)).then(({ res }) => {
      assert.equal(res.usefulCandidatesCount, 5);
      assert.equal(res.targetOverflowDiscarded, 3);
      // Ninguno de los conteos de dedupe se mueve por un sobrante.
      assert.equal(res.excludedExactDuplicatesCount, 0);
      assert.equal(res.skippedActiveDuplicatesCount, 0);
      assert.equal(res.crossBranchDuplicatesRemoved, 0);
      assert.equal(res.skippedCount, 0);
      assert.equal(res.possibleDuplicatesCount, 0);
    });
  });

  it('E — la facturación sigue describiendo la respuesta ENTERA que se pagó', () => {
    const page = successResult(
      Array.from({ length: 10 }, (_, i) => company(`h${i}`, 'Healthcare')),
    );
    return run([page], healthPharmaExecution(2)).then(({ res, batches }) => {
      // 10 filas devueltas y 1 crédito cobrado, aunque sólo 2 se persistan.
      assert.equal(res.resultsReturned, 10);
      assert.equal(res.creditsCharged, 1);
      assert.equal(res.rawResultsTotal, 10);
      assert.equal(res.pagesRequested, 1);
      const billing = (batches[0].metadata as { billing: Record<string, unknown> }).billing;
      assert.equal(billing.results_returned, 10);
      assert.equal(billing.credits_charged, 1);
    });
  });

  it('MUTACIÓN — sin el tope de aceptación, el objetivo se rebasa (el defecto real)', () => {
    // Reproduce la aritmética del bucle antiguo: aceptar todo lo revisable.
    const reviewablePerPage = [4, 5];
    const withoutCap = reviewablePerPage.reduce((n, page) => n + page, 0);
    const withCap = reviewablePerPage.reduce(
      (n, page) => n + Math.min(page, resolveLushaRemainingGap(5, n)),
      0,
    );
    assert.equal(withoutCap, 9, 'es exactamente lo que persistió Producción');
    assert.equal(withCap, 5);
  });

  it('la telemetría del lote publica los tres desenlaces nuevos', () => {
    const page = successResult([
      ...Array.from({ length: 7 }, (_, i) => company(`h${i}`, 'Healthcare')),
      ...Array.from({ length: 3 }, (_, i) => company(`x${i}`, 'Mining & Metals')),
    ]);
    return run([page], healthPharmaExecution(5)).then(({ res, batches }) => {
      const multi = (batches[0].metadata as { multi_branch: Record<string, unknown> }).multi_branch;
      assert.equal(multi.target_gap, 5);
      assert.equal(multi.accepted_for_target_total, 5);
      assert.equal(multi.reviewable_found_total, 7);
      assert.equal(multi.target_overflow_discarded, 2);
      assert.equal(multi.precision_rejected_total, 3);
      assert.equal(res.usefulCandidatesCount, 5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 11 — LA DEDUPE HISTÓRICA NO SE DEBILITA
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 11 — la memoria histórica de duplicados sigue intacta', () => {
  it('el duplicado exacto de HubSpot se excluye ANTES de mirar precisión', () => {
    const page = successResult([
      company('d0', 'Healthcare'),
      company('h0', 'Healthcare'),
    ]);
    return run([page, successResult([])], healthPharmaExecution(5), {
      checkCompanyDuplicate: async (input) =>
        input.domain === 'd0.com'
          ? {
              status: 'existing_in_hubspot',
              confidence: 92,
              input,
              matches: [
                {
                  source: 'hubspot',
                  status: 'existing_in_hubspot',
                  confidence: 92,
                  reason: 'Dominio exacto coincide en HubSpot: d0.com',
                  matchedName: 'D0',
                  matchedDomain: 'd0.com',
                  matchedHubspotCompanyId: '1',
                },
              ],
              summary: 'duplicado',
              checkedSources: ['sellup', 'hubspot'],
            }
          : noDuplicate(input),
    }).then(({ res, candidateRows }) => {
      assert.equal(res.excludedExactDuplicatesCount, 1);
      assert.equal(candidateRows.length, 1);
      assert.equal(candidateRows[0].domain, 'h0.com');
      // Un duplicado exacto NUNCA se contabiliza como rechazo de precisión.
      assert.equal(res.precisionRejectedTotal, 0);
    });
  });

  it('el guard de candidatos activos sigue descartando, y no se confunde con precisión', () => {
    const page = successResult([company('a0', 'Healthcare'), company('h0', 'Healthcare')]);
    return run([page, successResult([])], healthPharmaExecution(5), {
      fetchActiveCandidates: async () => [
        {
          id: 'existing-1',
          name: 'Empresa a0',
          normalized_name: 'empresa a0',
          domain: 'a0.com',
          country_code: 'CO',
          status: 'needs_review',
        } as never,
      ],
    }).then(({ res, candidateRows }) => {
      assert.equal(res.skippedActiveDuplicatesCount, 1);
      assert.equal(candidateRows.length, 1);
      assert.equal(candidateRows[0].domain, 'h0.com');
      assert.equal(res.precisionRejectedTotal, 0);
    });
  });

  it('un posible duplicado sigue persistiéndose para revisión', () => {
    const page = successResult([company('p0', 'Healthcare')]);
    return run([page, successResult([])], healthPharmaExecution(5), {
      checkCompanyDuplicate: async (input) => ({
        status: 'possible_duplicate',
        confidence: 65,
        input,
        matches: [
          {
            source: 'hubspot',
            status: 'possible_duplicate',
            confidence: 65,
            reason: 'Nombre similar por contenido en HubSpot: "p0"',
            matchedName: 'P0',
            matchedDomain: 'p0.co',
            matchedHubspotCompanyId: '2',
          },
        ],
        summary: 'posible',
        checkedSources: ['sellup', 'hubspot'],
      }),
    }).then(({ res, candidateRows }) => {
      assert.equal(res.possibleDuplicatesCount, 1);
      assert.equal(candidateRows.length, 1);
      assert.equal(candidateRows[0].duplicate_status, 'possible_duplicate');
    });
  });

  it('la identidad ya vista en OTRA rama se sigue descartando una sola vez', () => {
    const shared = company('s0', 'Healthcare');
    return run(
      [successResult([shared]), successResult([shared, company('h1', 'Healthcare')])],
      healthPharmaExecution(5),
    ).then(({ res }) => {
      assert.equal(res.crossBranchDuplicatesRemoved, 1);
      assert.equal(res.usefulCandidatesCount, 2);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §§ 7 y 12 — PROCEDENCIA Y TAMAÑO EN LA FILA PERSISTIDA
// ─────────────────────────────────────────────────────────────────────────────

describe('§§ 7/12 — lo que la fila persistida declara', () => {
  it('§ 7 — el candidato lleva su rama y su veredicto de precisión', () => {
    const branch0 = successResult([company('h0', 'Healthcare')]);
    const branch1 = successResult([company('p0', 'Pharmaceuticals Manufacturing')]);
    return run([branch0, successResult([]), branch1], healthPharmaExecution(5)).then(
      ({ candidateRows }) => {
        const rows = candidateRows.map((r) => r.metadata as Record<string, unknown>);
        const provenances = rows.map((m) => m.branch_provenance);
        assert.deepEqual(provenances[0], {
          branch_index: 0,
          main_industry_id: 11,
          sub_industry_id: null,
        });
        assert.deepEqual(provenances[1], {
          branch_index: 1,
          main_industry_id: 12,
          sub_industry_id: 71,
        });
        const precision0 = rows[0].macro_precision as Record<string, unknown>;
        assert.equal(precision0.macro_precision_verdict, 'confirmed');
        assert.equal(precision0.macro_industry_key, 'health_pharma');
        assert.equal(precision0.macro_precision_reason, 'branch_main_industry_declared');
        const precision1 = rows[1].macro_precision as Record<string, unknown>;
        assert.equal(precision1.macro_precision_reason, 'branch_sub_industry_declared');
      },
    );
  });

  it('§ 12 — el conteo exacto llega a la columna tipada Y al gate ICP canónico', () => {
    const rows = buildLushaPendingReviewCandidateRows('batch-1', [
      {
        company: company('h0', 'Healthcare', { employeesExact: 682 }),
        resolution: {
          dbDuplicateStatus: 'no_match',
          matchedAccountId: null,
          matchedHubspotCompanyId: null,
          accountDuplicateCheck: 'no_match',
          hubSpotDuplicateCheck: 'no_match',
          activeCandidateDuplicateCheck: 'no_match',
          activeGuardReason: null,
          duplicateDetails: null,
        } as never,
      },
    ]);
    assert.equal(rows[0].employee_count, 682);
    assert.equal(rows[0].employee_count_source, 'lusha');
    assert.equal(rows[0].company_size, '682');
    const gate = (rows[0].metadata as { icp_size_gate: Record<string, unknown> }).icp_size_gate;
    assert.equal(gate.decision, 'pass');
    assert.equal(gate.threshold, 200);
  });

  it('§ 12 — sin conteo del proveedor NO se inventa tamaño: la columna queda nula', () => {
    const rows = buildLushaPendingReviewCandidateRows('batch-1', [
      {
        company: company('h0', 'Healthcare', {
          employeesExact: null,
          employeesMin: null,
          employeesMax: null,
        }),
        resolution: {
          dbDuplicateStatus: 'no_match',
          matchedAccountId: null,
          matchedHubspotCompanyId: null,
          accountDuplicateCheck: 'no_match',
          hubSpotDuplicateCheck: 'no_match',
          activeCandidateDuplicateCheck: 'no_match',
          activeGuardReason: null,
          duplicateDetails: null,
        } as never,
      },
    ]);
    assert.equal(rows[0].employee_count, null);
    assert.equal(rows[0].employee_count_source, null);
    const gate = (rows[0].metadata as { icp_size_gate: Record<string, unknown> }).icp_size_gate;
    // «Desconocido» NUNCA es «menor que el umbral»: el gate canónico pide validación.
    assert.equal(gate.decision, 'needs_validation');
  });

  it('§ 12 — `employee_count_status` se deja SIN escribir a propósito', () => {
    const rows = buildLushaPendingReviewCandidateRows('batch-1', [
      {
        company: company('h0', 'Healthcare', { employeesExact: 682 }),
        resolution: {
          dbDuplicateStatus: 'no_match',
          matchedAccountId: null,
          matchedHubspotCompanyId: null,
          accountDuplicateCheck: 'no_match',
          hubSpotDuplicateCheck: 'no_match',
          activeCandidateDuplicateCheck: 'no_match',
          activeGuardReason: null,
          duplicateDetails: null,
        } as never,
      },
    ]);
    // El CHECK de la columna sólo admite un vocabulario de umbral 100
    // (`confirmed_100_plus`…), y el ICP de SellUp son 200. Escribirlo obligaría a
    // afirmar un umbral que no es el del producto.
    assert.equal('employee_count_status' in rows[0], false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// § 6 — FORMA DE LA PETICIÓN (auditoría sin coste)
// ─────────────────────────────────────────────────────────────────────────────

describe('§ 6 — la petición que el código emite por rama', () => {
  it('cada rama emite su main y su sub, sin aplanar y sin caer al main desnudo', () => {
    const pages = [successResult([]), successResult([]), successResult([])];
    return run(pages, healthPharmaExecution(5)).then(({ calls }) => {
      // Página vacía ⇒ la rama no pide su segunda página: una petición por rama.
      assert.deepEqual(calls, [
        { page: 0, mainIndustryId: 11, subIndustryId: null },
        { page: 0, mainIndustryId: 12, subIndustryId: 71 },
        { page: 0, mainIndustryId: 12, subIndustryId: 80 },
      ]);
    });
  });
});
