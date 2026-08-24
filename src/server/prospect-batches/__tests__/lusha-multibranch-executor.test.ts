/**
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 23 — contrato del ejecutor
 * multi-rama.
 *
 * Lo que estas pruebas defienden, dicho como defecto: sin ellas, un ejecutor de
 * ramas puede gastar seis créditos para conseguir lo que cabía en uno, contar la
 * misma empresa tres veces porque volvió en tres ramas, o seguir pidiendo después
 * de haber cerrado el objetivo. Las tres cosas son invisibles en producción —el
 * resultado «parece» correcto— y sólo se ven en la factura.
 *
 * `persistLushaPendingReviewBatch` es puro y todo entra inyectado, así que aquí no
 * hay red, ni DB, ni cliente de Lusha: `runSearch` es un doble que CUENTA sus
 * llamadas y responde lo que cada caso necesita.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type LushaMultiBranchExecution,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  LUSHA_DEFAULT_TARGET_GAP,
  LUSHA_RUN_MAX_RAW_RESULTS,
  decideLushaProviderRequest,
  resolveLushaExecutionBranches,
  resolveLushaProviderRequestsAllowed,
  resolveLushaRemainingGap,
  resolveLushaTargetGap,
} from '@/server/prospect-batches/lusha-multibranch-execution';
import { resolveLushaMacroSearchPlan } from '@/server/prospect-batches/lusha-macro-search-plan';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = { internalUserId: 'user-1' };

/**
 * Empresa con identidad EXPLÍCITA en las cuatro señales.
 *
 * Nada se deriva por defecto a propósito: en una suite de dedupe, una identidad
 * implícita compartida haría pasar o fallar casos por accidente.
 */
function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

/** N empresas con identidad totalmente distinta entre sí. */
function distinctCompanies(count: number, prefix: string): LushaPreviewCompany[] {
  return Array.from({ length: count }, (_, i) =>
    company({
      providerCompanyId: `${prefix}-${i}`,
      name: `${prefix} ${i}`,
      domain: `${prefix}-${i}.com`,
    }),
  );
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
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function failureResult(status: LushaPreviewResult['status'] = 'provider_error'): LushaPreviewResult {
  return {
    ...successResult([]),
    ok: false,
    status,
    billing: { creditsCharged: null, resultsReturned: null, expectedMaxCredits: 1 },
    error: 'boom',
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

/**
 * Deps con un `runSearch` que registra cada llamada y responde según un guion.
 *
 * El guion es una lista de respuestas: la llamada i devuelve `script[i]`, y si se
 * agota devuelve una página vacía. Así una prueba que espera 2 llamadas y recibe 3
 * falla por el CONTEO, no por un resultado inesperado.
 */
function makeDeps(script: LushaPreviewResult[]) {
  const calls: SearchCall[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      const branch = (input as { industryBranch?: { mainIndustryId: number; subIndustryId?: number | null } })
        .industryBranch;
      calls.push({
        page: input.page,
        mainIndustryId: branch?.mainIndustryId ?? null,
        subIndustryId: branch?.subIndustryId ?? null,
      });
      return script[calls.length - 1] ?? successResult([]);
    },
    insertBatch: async (row) => {
      batches.push(row);
      return { id: `batch-${batches.length}` };
    },
    // CUT-3B4-CORRECCIÓN — la valla es OBLIGATORIA; esta prueba modela la 126
    // SIN aplicar por la ÚNICA puerta legítima: la respuesta de la BASE.
    insertCandidatesFenced: preM126FencedInsert,
    insertCandidates: async (rows) => {
      candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicate(input),
    fetchActiveCandidates: async () => [],
  };

  return { deps, calls, batches, candidateRows };
}

function run(
  script: LushaPreviewResult[],
  execution?: LushaMultiBranchExecution,
) {
  const harness = makeDeps(script);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

/** Plan sintético de N ramas, con ids reales de la captura del proveedor. */
function planWithBranches(count: 1 | 2 | 3): LushaMultiBranchExecution['plan'] {
  const branches = [
    { mainIndustryId: 11, label: 'Healthcare' },
    { mainIndustryId: 12, subIndustryId: 71, label: 'Pharmaceuticals Manufacturing' },
    { mainIndustryId: 12, subIndustryId: 80, label: 'Medical Equipment' },
  ].slice(0, count);
  return { macroKey: 'health_pharma', branches };
}

// ── Política pura ─────────────────────────────────────────────────────────────

describe('política del ejecutor (pura)', () => {
  it('targetGap: ausente o inválido ⇒ el objetivo de hoy', () => {
    assert.equal(resolveLushaTargetGap(undefined), LUSHA_DEFAULT_TARGET_GAP);
    assert.equal(resolveLushaTargetGap(null), LUSHA_DEFAULT_TARGET_GAP);
    assert.equal(resolveLushaTargetGap(0), LUSHA_DEFAULT_TARGET_GAP);
    assert.equal(resolveLushaTargetGap(-3), LUSHA_DEFAULT_TARGET_GAP);
    assert.equal(resolveLushaTargetGap(Number.NaN), LUSHA_DEFAULT_TARGET_GAP);
    assert.equal(resolveLushaTargetGap(Number.POSITIVE_INFINITY), LUSHA_DEFAULT_TARGET_GAP);
  });

  it('targetGap: un hueco menor se respeta; uno mayor se recorta', () => {
    assert.equal(resolveLushaTargetGap(2), 2);
    assert.equal(resolveLushaTargetGap(2.9), 2);
    // Un hueco NUNCA puede subir el gasto por parámetro.
    assert.equal(resolveLushaTargetGap(50), LUSHA_DEFAULT_TARGET_GAP);
  });

  it('el objetivo por defecto NO está escrito: es el de la política vigente', () => {
    assert.equal(LUSHA_DEFAULT_TARGET_GAP, 5);
  });

  it('sin plan hay UNA rama legacy; con plan, las del plan y en su orden', () => {
    assert.deepEqual(resolveLushaExecutionBranches(null), [null]);
    assert.deepEqual(resolveLushaExecutionBranches({ branches: [] }), [null]);
    const plan = resolveLushaMacroSearchPlan('health_pharma');
    assert.deepEqual(resolveLushaExecutionBranches(plan), plan?.branches);
  });

  it('techo de peticiones: 1 rama → 2 · 2 → 4 · 3 → 6, y nunca más de 3 ramas', () => {
    assert.equal(resolveLushaProviderRequestsAllowed(1), 2);
    assert.equal(resolveLushaProviderRequestsAllowed(2), 4);
    assert.equal(resolveLushaProviderRequestsAllowed(3), 6);
    // Un número de ramas fuera de rango se acota en vez de multiplicar el gasto.
    assert.equal(resolveLushaProviderRequestsAllowed(9), 6);
    assert.equal(resolveLushaProviderRequestsAllowed(0), 2);
  });

  it('techo de filas crudas: 3 ramas × 2 páginas × 10 por página = 60', () => {
    assert.equal(LUSHA_RUN_MAX_RAW_RESULTS, 60);
  });

  it('el hueco nunca es negativo', () => {
    assert.equal(resolveLushaRemainingGap(5, 0), 5);
    assert.equal(resolveLushaRemainingGap(5, 5), 0);
    assert.equal(resolveLushaRemainingGap(5, 9), 0);
  });

  it('la decisión de pedir distingue las tres negativas', () => {
    const base = { providerRequestsUsed: 0, providerRequestsAllowed: 6, rawResultsTotal: 0 };
    assert.deepEqual(decideLushaProviderRequest({ ...base, remainingGap: 3 }), { allowed: true });
    assert.deepEqual(decideLushaProviderRequest({ ...base, remainingGap: 0 }), {
      allowed: false,
      stopReason: 'target_reached',
    });
    assert.deepEqual(
      decideLushaProviderRequest({ ...base, remainingGap: 3, providerRequestsUsed: 6 }),
      { allowed: false, stopReason: 'request_cap_reached' },
    );
    assert.deepEqual(
      decideLushaProviderRequest({ ...base, remainingGap: 3, rawResultsTotal: 60 }),
      { allowed: false, stopReason: 'raw_scan_cap_reached' },
    );
  });
});

// ── § 23 A–P ──────────────────────────────────────────────────────────────────

describe('§ 23 — ejecución de ramas y parada por objetivo', () => {
  it('A. 1 rama, la página 0 llena el objetivo → UNA petición y para', async () => {
    const { res, calls } = await run([successResult(distinctCompanies(5, 'a'))], {
      plan: planWithBranches(1),
    });
    assert.equal(calls.length, 1);
    assert.equal(res.status, 'success');
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.stopReason, 'target_reached');
    assert.equal(res.remainingGapFinal, 0);
    assert.equal(res.providerRequestsUsed, 1);
    assert.equal(res.providerRequestsAllowed, 2);
  });

  it('B. 1 rama, página 0 parcial y página 1 completa → DOS peticiones', async () => {
    const { res, calls } = await run(
      [successResult(distinctCompanies(3, 'b0')), successResult(distinctCompanies(2, 'b1'))],
      { plan: planWithBranches(1) },
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.page), [0, 1]);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.topUpTriggered, true);
  });

  it('C. 2 ramas, la rama 0 llena el objetivo → la rama 1 NUNCA se llama', async () => {
    const { res, calls } = await run([successResult(distinctCompanies(5, 'c'))], {
      plan: planWithBranches(2),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mainIndustryId, 11);
    assert.equal(res.branchCountPlanned, 2);
    assert.equal(res.branchCountAttempted, 1);
    assert.equal(res.stopReason, 'target_reached');
    // La rama omitida queda registrada como tal: no desaparece de la telemetría.
    assert.equal(res.multiBranch?.branches[1].outcome, 'not_attempted');
    assert.equal(res.multiBranch?.branches[1].providerRequests, 0);
  });

  it('D. 2 ramas, la rama 0 queda corta → la rama 1 busca SÓLO el hueco', async () => {
    const { res, calls } = await run(
      [
        successResult(distinctCompanies(2, 'd0')), // rama 0, página 0
        successResult([]), // rama 0, página 1: vacía ⇒ no hay más en esta rama
        successResult(distinctCompanies(3, 'd1')), // rama 1, página 0
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.usefulCandidatesCount, 5);
    // La rama 1 arrancó con hueco 3, no con 5.
    assert.equal(res.multiBranch?.branches[1].remainingGapBefore, 3);
    assert.equal(res.multiBranch?.branches[1].remainingGapAfter, 0);
    assert.equal(calls[2].mainIndustryId, 12);
    assert.equal(calls[2].subIndustryId, 71);
  });

  it('E. 3 ramas, objetivo alcanzado en la rama 1 → la rama 2 NUNCA se llama', async () => {
    const { res, calls } = await run(
      [
        successResult(distinctCompanies(2, 'e0')),
        successResult([]),
        successResult(distinctCompanies(3, 'e1')),
      ],
      { plan: planWithBranches(3) },
    );
    assert.equal(calls.length, 3);
    assert.equal(res.branchCountPlanned, 3);
    assert.equal(res.branchCountAttempted, 2);
    assert.equal(res.multiBranch?.branches[2].outcome, 'not_attempted');
    assert.equal(res.stopReason, 'target_reached');
  });

  it('L. una rama con 0 resultados NO es un fallo: se pasa a la siguiente', async () => {
    const { res, calls } = await run(
      [
        successResult([]), // rama 0 vacía
        successResult(distinctCompanies(5, 'l1')), // rama 1
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.ok, true);
    assert.equal(res.status, 'success');
    assert.equal(res.usefulCandidatesCount, 5);
    // Una rama vacía no consume su segunda página: nada que continuar.
    assert.equal(calls.length, 2);
    assert.equal(res.multiBranch?.branches[0].outcome, 'completed');
    assert.equal(res.multiBranch?.branches[0].providerRequests, 1);
  });

  it('N. techo de peticiones alcanzado → ninguna petición extra', async () => {
    // Dos ramas ⇒ 4 peticiones como máximo. El guion devuelve siempre 1 útil, así
    // que el objetivo (5) nunca se cierra y sólo el techo puede parar la corrida.
    const script = Array.from({ length: 10 }, (_, i) =>
      successResult(distinctCompanies(1, `n${i}`)),
    );
    const { res, calls } = await run(script, { plan: planWithBranches(2) });
    assert.equal(calls.length, 4);
    assert.equal(res.providerRequestsUsed, 4);
    assert.equal(res.providerRequestsAllowed, 4);
    assert.equal(res.stopReason, 'request_cap_reached');
    assert.ok(
      (res.providerRequestsUsed ?? 0) <= (res.providerRequestsAllowed ?? 0),
      'jamás puede pedir por encima de su techo',
    );
  });

  it('O. targetGap=2 → la corrida NUNCA busca 5', async () => {
    const { res, calls } = await run([successResult(distinctCompanies(2, 'o'))], {
      plan: planWithBranches(3),
      targetGap: 2,
    });
    assert.equal(calls.length, 1);
    assert.equal(res.targetGap, 2);
    assert.equal(res.usefulCandidatesCount, 2);
    assert.equal(res.stopReason, 'target_reached');
    assert.equal(res.branchCountAttempted, 1);
  });

  it('P. el objetivo se cierra EXACTO: ni una petición después', async () => {
    const { res, calls } = await run(
      [successResult(distinctCompanies(4, 'p0')), successResult(distinctCompanies(1, 'p1'))],
      { plan: planWithBranches(3), targetGap: 5 },
    );
    assert.equal(calls.length, 2);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.remainingGapFinal, 0);
  });
});

describe('§ 23 — dedupe de identidad en toda la corrida', () => {
  it('F. duplicados DENTRO de la misma página se cuentan una vez', async () => {
    const dup = company({ providerCompanyId: 'f1', name: 'F', domain: 'f.com' });
    const { res } = await run([successResult([dup, { ...dup }])], { plan: planWithBranches(1) });
    assert.equal(res.usefulCandidatesCount, 1);
    assert.equal(res.crossBranchDuplicatesRemoved, 1);
  });

  it('G. duplicados entre PÁGINAS de la misma rama se cuentan una vez', async () => {
    const shared = company({ providerCompanyId: 'g1', name: 'G', domain: 'g.com' });
    const { res } = await run(
      [successResult([shared]), successResult([{ ...shared }])],
      { plan: planWithBranches(1) },
    );
    assert.equal(res.usefulCandidatesCount, 1);
    assert.equal(res.crossBranchDuplicatesRemoved, 1);
  });

  it('H. duplicado entre RAMAS por id de proveedor se cuenta una vez', async () => {
    // Mismo id de proveedor, dominio distinto: sólo el id puede reconocerlo. Es el
    // caso que el `Set` de una sola clave dejaba escapar.
    const { res } = await run(
      [
        successResult([company({ providerCompanyId: 'same', name: 'Uno', domain: 'uno.com' })]),
        successResult([]),
        successResult([company({ providerCompanyId: 'same', name: 'Otro', domain: 'otro.com' })]),
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.usefulCandidatesCount, 1);
    assert.equal(res.multiBranch?.duplicateReasonCounts.provider_company_id, 1);
  });

  it('I. duplicado entre ramas por DOMINIO se cuenta una vez', async () => {
    const { res } = await run(
      [
        successResult([company({ providerCompanyId: 'i1', name: 'Uno', domain: 'mismo.com' })]),
        successResult([]),
        successResult([
          company({ providerCompanyId: 'i2', name: 'Otro', domain: 'https://www.mismo.com/' }),
        ]),
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.usefulCandidatesCount, 1);
    assert.equal(res.multiBranch?.duplicateReasonCounts.normalized_domain, 1);
  });

  it('J. duplicado entre ramas por URL de LINKEDIN se cuenta una vez', async () => {
    const { res } = await run(
      [
        successResult([
          company({
            providerCompanyId: 'j1',
            name: 'Uno',
            domain: 'j1.com',
            linkedinUrl: 'https://www.linkedin.com/company/mismo/about/?trk=x',
          }),
        ]),
        successResult([]),
        successResult([
          company({
            providerCompanyId: 'j2',
            name: 'Otro',
            domain: 'j2.com',
            linkedinUrl: 'linkedin.com/company/mismo',
          }),
        ]),
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.usefulCandidatesCount, 1);
    assert.equal(res.multiBranch?.duplicateReasonCounts.normalized_linkedin_url, 1);
  });

  it('K. sin dominio, el NOMBRE normalizado actúa de respaldo', async () => {
    // 🔑 Lo que se prueba es el DEDUPE, no la persistencia: el gate obligatorio
    // compartido excluye en duro toda empresa sin dominio (`missing_domain`), así
    // que una fila sin dominio nunca llega a candidato. El respaldo por nombre no
    // existe para producir candidatos —no puede—, sino para que la MISMA empresa
    // sin dominio no se enriquezca ni se compruebe dos veces cuando vuelve en otra
    // rama. Ese trabajo ocurre aguas abajo del dedupe y sí cuesta.
    //
    // 🔑 AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 17 — la secuencia de
    // respuestas cambió, la propiedad probada NO. Antes la rama 0 compraba
    // SIEMPRE sus dos páginas, así que el fixture tenía que interponer una página
    // vacía entre k1 y k2. Ahora una página cuyo rendimiento útil-nuevo es cero
    // —y k1 lo es: el gate obligatorio la excluye en duro por `missing_domain`—
    // cierra su rama, así que la rama 0 gasta UNA petición y k2 llega en la
    // primera de la rama 1. Ese relleno vacío ya no existe en la realidad y
    // mantenerlo aquí probaría una secuencia que el ejecutor no emite.
    const { res } = await run(
      [
        successResult([company({ providerCompanyId: 'k1', name: 'Clínica Andés', domain: null })]),
        successResult([company({ providerCompanyId: 'k2', name: 'clinica andes', domain: null })]),
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.multiBranch?.duplicateReasonCounts.normalized_name_fallback, 1);
    assert.equal(res.crossBranchDuplicatesRemoved, 1);
    // Ninguna sobrevive al gate, y eso es correcto: sin dominio no hay candidato.
    assert.equal(res.usefulCandidatesCount, 0);
    assert.equal(res.hardExcludedByGateCount, 1);
  });

  it('🔴 el nombre NO decide cuando hay dominios distintos (homónimos)', async () => {
    // «Servicios Integrales S.A.S.» existe decenas de veces con dominios y NITs
    // distintos. Colapsarlas descartaría candidatos legítimos en silencio.
    const { res } = await run(
      [
        successResult([
          company({ providerCompanyId: 'h1', name: 'Servicios Integrales', domain: 'uno.com' }),
          company({ providerCompanyId: 'h2', name: 'Servicios Integrales', domain: 'dos.com' }),
        ]),
      ],
      { plan: planWithBranches(1) },
    );
    assert.equal(res.usefulCandidatesCount, 2);
    assert.equal(res.crossBranchDuplicatesRemoved, 0);
  });

  it('un duplicado de otra rama NO se persiste ni se cuenta dos veces', async () => {
    const shared = company({ providerCompanyId: 'p1', name: 'Compartida', domain: 'compartida.com' });
    const { res, candidateRows } = await run(
      [
        successResult([shared]),
        successResult([]),
        successResult([{ ...shared }]),
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(candidateRows.length, 1);
    assert.equal(res.createdCandidatesCount, 1);
  });
});

describe('§ 23 — semántica de fallo', () => {
  it('M. un fallo tras un éxito previo CONSERVA lo ya encontrado', async () => {
    const { res, batches, candidateRows } = await run(
      [
        successResult(distinctCompanies(3, 'm0')), // rama 0 ok
        failureResult(), // rama 0, página 1 falla
      ],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.ok, true);
    assert.equal(res.status, 'success');
    assert.equal(res.usefulCandidatesCount, 3);
    assert.equal(batches.length, 1);
    assert.equal(candidateRows.length, 3);
    assert.equal(res.stopReason, 'provider_failure');
    assert.equal(res.multiBranch?.branches[0].outcome, 'provider_failure');
    // No hay tormenta de reintentos ni gasto para compensar el error.
    assert.equal(res.providerRequestsUsed, 2);
  });

  it('la PRIMERA petición fallida sin nada útil → error duro y CERO escrituras', async () => {
    const { res, batches, candidateRows } = await run([failureResult()], {
      plan: planWithBranches(3),
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'error');
    assert.equal(batches.length, 0);
    assert.equal(candidateRows.length, 0);
    assert.equal(res.pagesRequested, 1);
  });

  it('un fallo en una rama posterior no intenta las siguientes', async () => {
    const { res, calls } = await run(
      [
        successResult(distinctCompanies(1, 'x0')),
        successResult([]), // rama 0 sin más páginas útiles… (vacía ⇒ corta)
        failureResult(), // rama 1 falla
      ],
      { plan: planWithBranches(3) },
    );
    assert.equal(calls.length, 3);
    assert.equal(res.multiBranch?.branches[2].outcome, 'not_attempted');
    assert.equal(res.stopReason, 'provider_failure');
  });

  it('nada útil en ninguna rama → status empty y CERO escrituras', async () => {
    const { res, batches, candidateRows } = await run(
      [successResult([]), successResult([])],
      { plan: planWithBranches(2) },
    );
    assert.equal(res.ok, true);
    assert.equal(res.status, 'empty');
    assert.equal(batches.length, 0);
    assert.equal(candidateRows.length, 0);
    assert.equal(res.stopReason, 'no_results');
  });
});

describe('§ 2 — la rama es autoritativa en la petición', () => {
  it('cada rama manda EXACTAMENTE un main y a lo sumo un sub', async () => {
    const { calls } = await run(
      [
        successResult(distinctCompanies(1, 'r0')),
        successResult([]),
        successResult(distinctCompanies(1, 'r1')),
        successResult([]),
        successResult(distinctCompanies(1, 'r2')),
        successResult([]),
      ],
      { plan: planWithBranches(3) },
    );
    assert.deepEqual(
      calls.map((c) => ({ main: c.mainIndustryId, sub: c.subIndustryId })),
      [
        { main: 11, sub: null },
        { main: 11, sub: null },
        { main: 12, sub: 71 },
        { main: 12, sub: 71 },
        { main: 12, sub: 80 },
        { main: 12, sub: 80 },
      ],
    );
  });

  it('sin plan NO se manda rama: el preview deriva la industria del sector', async () => {
    const { res, calls } = await run([successResult(distinctCompanies(5, 's'))]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mainIndustryId, null);
    assert.equal(calls[0].subIndustryId, null);
    // Y el techo es el de siempre.
    assert.equal(res.expectedMaxCredits, 2);
    assert.equal(res.providerRequestsAllowed, 2);
    assert.equal(res.branchCountPlanned, 1);
    assert.equal(res.multiBranch?.macroKey, null);
  });
});

describe('§§ 18/19 — telemetría', () => {
  it('el lote registra la ejecución multi-rama sin PII', async () => {
    const { res, batches } = await run(
      [
        successResult(distinctCompanies(2, 't0')),
        successResult([]),
        successResult(distinctCompanies(3, 't1')),
      ],
      { plan: planWithBranches(2), creditsReserved: 4 },
    );
    const metadata = batches[0].metadata as Record<string, unknown>;
    const multi = metadata.multi_branch as Record<string, unknown>;
    assert.equal(multi.macro_key, 'health_pharma');
    assert.equal(multi.target_gap, 5);
    assert.equal(multi.branch_count_planned, 2);
    assert.equal(multi.branch_count_attempted, 2);
    assert.equal(multi.provider_requests_allowed, 4);
    assert.equal(multi.provider_requests_used, 3);
    assert.equal(multi.credits_reserved, 4);
    assert.equal(multi.credits_reported_actual, 3);
    assert.equal(multi.stop_reason, 'target_reached');
    assert.equal(multi.max_raw_results, 60);
    assert.equal((multi.branches as unknown[]).length, 2);

    // Sin PII ni payload del proveedor: sólo ids de industria, conteos y motivos.
    const serialized = JSON.stringify(multi);
    assert.doesNotMatch(serialized, /t0-0\.com|T0 0/);

    // El techo de créditos del lote es el de la CORRIDA, no el de una rama.
    const billing = metadata.billing as Record<string, unknown>;
    assert.equal(billing.expected_max_credits, 4);
    assert.equal(res.expectedMaxCredits, 4);
  });

  it('cada rama reporta sus propias cifras', async () => {
    const { res } = await run(
      [
        successResult(distinctCompanies(2, 'u0')),
        successResult([]),
        successResult(distinctCompanies(3, 'u1')),
      ],
      { plan: planWithBranches(2) },
    );
    const [first, second] = res.multiBranch?.branches ?? [];
    assert.equal(first.branchIndex, 0);
    assert.equal(first.mainIndustryId, 11);
    assert.equal(first.subIndustryId, null);
    assert.equal(first.pagesAttempted, 2);
    assert.equal(first.rawResults, 2);
    assert.equal(first.usefulResults, 2);
    assert.equal(first.remainingGapBefore, 5);
    assert.equal(first.remainingGapAfter, 3);
    assert.equal(second.branchIndex, 1);
    assert.equal(second.mainIndustryId, 12);
    assert.equal(second.subIndustryId, 71);
    assert.equal(second.usefulResults, 3);
    assert.equal(second.remainingGapAfter, 0);
  });
});
