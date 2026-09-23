/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17, 18, 19, 21, 23 — la parada
 * por novedad cero, sobre el EJECUTOR REAL.
 *
 * Lo que estas pruebas defienden, dicho como defecto: sin ellas una rama compra
 * su segunda página después de que la primera haya demostrado que el pozo está
 * seco. Es exactamente lo que hizo el lote `e90832f9` el 2026-08-19: 6 peticiones,
 * 60 filas crudas, 40 únicas, 0 aceptadas. Tres de esas seis peticiones fueron
 * segundas páginas de ramas ya estériles.
 *
 * 🔴 Los datos son SINTÉTICOS. Ningún nombre de empresa real aparece aquí (§ 21).
 * La prueba no afirma que el proveedor real se comporte siempre así: afirma que
 * el ejecutor, ante ese rendimiento, deja de pagar.
 *
 * Todo entra inyectado: no hay red, ni DB, ni cliente de Lusha.
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
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
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

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa Sintetica',
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

/** N empresas sintéticas con identidad totalmente distinta entre sí. */
function distinct(count: number, prefix: string): LushaPreviewCompany[] {
  return Array.from({ length: count }, (_, i) =>
    company({
      providerCompanyId: `${prefix}-${i}`,
      name: `Sintetica ${prefix} ${i}`,
      domain: `${prefix}-${i}.example`,
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

// AGENT1-LUSHA-CUT-L7 § 29 — esta fábrica emitía `confidence` 100, un valor que
// NINGÚN checker de producción produce. Con la fuerza de identidad leída de la
// confianza real, 100 no corresponde a ningún eje. Se sustituye por la que
// `sellup-duplicate-checker` emite de verdad para su intención declarada
// (`reason: 'domain'`): 95, dominio exacto — que sigue siendo un eje FUERTE, así
// que la intención de cada caso se conserva intacta.
function exactDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'existing_in_sellup',
    confidence: 95,
    input,
    matches: [
      { source: 'sellup', status: 'existing_in_sellup', confidence: 95, reason: 'domain' },
    ],
    summary: 'duplicado',
    checkedSources: ['sellup', 'hubspot'],
  };
}

type Harness = {
  deps: PersistLushaPendingReviewDeps;
  calls: Array<{ page: number | null | undefined; mainIndustryId: number | null }>;
};

function makeDeps(
  script: LushaPreviewResult[],
  checker: (input: DuplicateCheckInput) => DuplicateCheckResult = noDuplicate,
): Harness {
  const calls: Harness['calls'] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];

  return {
    calls,
    deps: {
      runSearch: async (input) => {
        const branch = (input as { industryBranch?: { mainIndustryId: number } }).industryBranch;
        calls.push({ page: input.page, mainIndustryId: branch?.mainIndustryId ?? null });
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
      checkCompanyDuplicate: async (input) => checker(input),
      fetchActiveCandidates: async () => [],
    },
  };
}

function planWithBranches(count: 1 | 2 | 3): LushaMultiBranchExecution['plan'] {
  const branches = [
    { mainIndustryId: 11, label: 'Healthcare' },
    { mainIndustryId: 12, subIndustryId: 71, label: 'Pharmaceuticals Manufacturing' },
    { mainIndustryId: 12, subIndustryId: 80, label: 'Medical Equipment' },
  ].slice(0, count);
  return { macroKey: 'health_pharma', branches };
}

function run(
  script: LushaPreviewResult[],
  execution: LushaMultiBranchExecution,
  checker?: (input: DuplicateCheckInput) => DuplicateCheckResult,
) {
  const harness = makeDeps(script, checker);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

describe('§ 21 — la forma de la QA del 2026-08-19, bajo la política NUEVA', () => {
  it('🔴 tres ramas estériles agotan su techo de SEIS, y siguen aceptando cero', async () => {
    // Antes de AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 esta misma entrada gastaba TRES
    // peticiones: cada rama paraba tras su página estéril. Ahora usa las seis que
    // su reserva ya había autorizado.
    //
    // 🔴 El techo NO se movió: `providerRequestsAllowed` sigue siendo 6, que es
    // ramas × páginas y es el mismo número del que sale la reserva. Lo que cambia
    // es que deja de devolverse sin usar lo que ya estaba comprometido — el
    // consumo EFECTIVO sube hasta el límite existente, nunca por encima.
    const { res, calls } = await run(
      [
        successResult(distinct(10, 'a')), successResult(distinct(10, 'a2')),
        successResult(distinct(10, 'b')), successResult(distinct(10, 'b2')),
        successResult(distinct(10, 'c')), successResult(distinct(10, 'c2')),
      ],
      { plan: planWithBranches(3), targetGap: 5 },
      exactDuplicate,
    );

    assert.equal(res.providerRequestsAllowed, 6, 'el techo no se movió');
    assert.equal(calls.length, 6, '🔴 ahora se usan las seis peticiones reservadas');
    assert.deepEqual(calls.map((c) => c.page), [0, 1, 0, 1, 0, 1]);
    assert.deepEqual(calls.map((c) => c.mainIndustryId), [11, 11, 12, 12, 12, 12]);

    // El dedupe y el conteo de aceptadas no se tocan: todo era duplicado exacto.
    assert.equal(res.usefulCandidatesCount, 0);
    assert.equal(res.rawResultsTotal, 60);
    assert.equal(res.multiBranch?.pagesSkippedBranchStopped, 0);
  });
});

describe('§ 23 — recorrido real de la política nueva', () => {
  it('🔴 primera página llena de CONOCIDAS y segunda con ÚTILES: se pide y se procesa la segunda', async () => {
    // Éste es el caso que la política anterior perdía, y que nuestra propia
    // operación produjo (lote `54f94a91`: página 1 rindió MÁS novedad que la 0).
    const { calls, res } = await run(
      [
        successResult(distinct(10, 'conocida')),
        successResult(distinct(3, 'util')),
      ],
      { plan: planWithBranches(1), targetGap: 5 },
      (input) => (input.domain?.startsWith('conocida') ? exactDuplicate(input) : noDuplicate(input)),
    );

    assert.equal(calls.length, 2, '🔴 la segunda página SÍ se pide');
    assert.deepEqual(calls.map((c) => c.page), [0, 1]);
    // Y se PROCESA: sus tres empresas sobreviven y se cuentan.
    assert.equal(res.usefulCandidatesCount, 3);
  });

  it('🔴 página realmente VACÍA: la rama para', async () => {
    const { calls } = await run(
      [successResult([]), successResult(distinct(5, 'nunca'))],
      { plan: planWithBranches(1), targetGap: 5 },
    );
    assert.equal(calls.length, 1, 'una página sin filas no se relee');
  });

  it('🔴 alcanzar cinco NO corta la búsqueda', async () => {
    const { calls, res } = await run(
      [successResult(distinct(5, 'primera')), successResult(distinct(2, 'extra'))],
      { plan: planWithBranches(1), targetGap: 5 },
    );
    assert.equal(calls.length, 2, 'el objetivo es un mínimo, no un tope de compra');
    assert.equal(res.usefulCandidatesCount, 7, 'las excedentes se conservan');
  });

  it('🔴 el techo de PETICIONES sigue limitando, con páginas siempre útiles', async () => {
    const { calls, res } = await run(
      [
        successResult(distinct(2, 'u0')), successResult(distinct(2, 'u1')),
        successResult(distinct(2, 'u2')),
      ],
      { plan: planWithBranches(1), targetGap: 50 },
    );
    assert.equal(res.providerRequestsAllowed, 2);
    assert.equal(calls.length, 2, 'ni una petición por encima de lo reservado');
  });

  it('B — una sola empresa nueva y útil permite la página 2', async () => {
    const { calls, res } = await run(
      [successResult(distinct(1, 'p')), successResult(distinct(1, 'q'))],
      { plan: planWithBranches(1), targetGap: 5 },
    );
    assert.equal(calls.length, 2, 'la rama sí continúa');
    assert.deepEqual(calls.map((c) => c.page), [0, 1]);
    assert.equal(res.usefulCandidatesCount, 2);
  });

  it('🔴 F — cero únicas por dedupe entre ramas ya NO cierra la rama', async () => {
    const shared = distinct(10, 'dup');
    const { calls } = await run(
      [
        successResult(shared), successResult([]),
        successResult(shared), successResult(shared),
      ],
      { plan: planWithBranches(2), targetGap: 5 },
    );
    // La rama 0 se queda las diez; la rama 1 recibe LAS MISMAS y no aporta nada
    // nuevo — pero eso ya no la cierra: agota sus dos páginas como cualquier otra.
    assert.equal(calls.length, 4, 'las dos ramas usan sus dos páginas');
  });

  it('G — una rama estéril NO impide que la siguiente se ejecute', async () => {
    const { calls, res } = await run(
      [
        successResult(distinct(10, 'seca')), successResult(distinct(10, 'seca2')),
        successResult(distinct(2, 'viva')), successResult([]),
      ],
      { plan: planWithBranches(2), targetGap: 5 },
      (input) => (input.domain?.startsWith('seca') ? exactDuplicate(input) : noDuplicate(input)),
    );

    assert.equal(calls[0]?.mainIndustryId, 11);
    assert.equal(calls[2]?.mainIndustryId, 12, 'la rama siguiente SÍ se ejecuta');
    assert.equal(res.usefulCandidatesCount, 2);
  });

  it('🔴 X6.13 · H — el mínimo alcanzado no impide intentar las demás ramas', async () => {
    const { calls, res } = await run(
      [successResult(distinct(5, 'llena'))],
      { plan: planWithBranches(3), targetGap: 5 },
    );
    assert.ok(calls.length > 1, '🔴 las ramas restantes se intentan');
    assert.equal(res.usefulCandidatesCount, 5);
  });

  it('🔴 § 19 — una rama que no aporta NUNCA se reporta como parada de CORRIDA', async () => {
    const { res } = await run(
      [successResult(distinct(10, 'z')), successResult(distinct(10, 'z2'))],
      { plan: planWithBranches(1), targetGap: 5 },
      exactDuplicate,
    );
    assert.equal(res.stopReason, 'request_cap_reached');
    assert.equal(res.remainingGapFinal, 5);
  });

  it('🔴 el motivo de parada NO afirma el objetivo aunque el hueco de COMPRA se cierre', async () => {
    // Hueco de compra cerrado (5 útiles contra un objetivo de 5) y aun así el
    // motivo informa el LÍMITE que terminó la búsqueda. La aceptación vive en
    // `accepted_for_target`, que es la única autoridad.
    const { res } = await run(
      [successResult(distinct(5, 'cierra')), successResult(distinct(1, 'mas'))],
      { plan: planWithBranches(1), targetGap: 5 },
    );
    assert.equal(res.remainingGapFinal, 0, 'el hueco de compra se cerró');
    assert.notEqual(res.stopReason as string, 'target_reached');
    assert.equal(res.stopReason, 'request_cap_reached', 'informa el límite real');
  });
});


describe('§ 14 — el hueco residual gobierna la ACEPTACIÓN', () => {
  /**
   * 🔴 SUPERSEDED POR X5.1 — AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1.
   *
   * Este caso se llamaba «un hueco de 2 acepta exactamente 2, aunque la página
   * pagada rinda 10», y ese «exactamente 2» era el defecto: ocho empresas que
   * habían superado todos los gates obligatorios se tiraban de una página YA
   * PAGADA por haber llegado después del objetivo.
   *
   * El objetivo del usuario no es un techo del universo. Las diez sobreviven.
   *
   * 🔴 PRESERVED — y lo que este caso vigilaba de verdad sigue vigilado, sólo
   * que ahora sin excepción posible: el sobrante NO es un duplicado. Antes se
   * comprobaba que los ocho descartados no inflaran `crossBranchDuplicatesRemoved`;
   * hoy no hay descartados que confundir, y el contador sigue en cero.
   */
  it('un hueco de 2 con una página de 10: las diez sobreviven, ninguna se tira', async () => {
    const { res } = await run(
      [successResult(distinct(10, 'g'))],
      { plan: planWithBranches(1), targetGap: 2 },
    );
    assert.equal(res.usefulCandidatesCount, 10, 'el objetivo no recorta supervivientes');
    // El hueco sigue siendo 2: el objetivo NO cambia, sólo deja de recortar.
    assert.equal(res.targetGap, 2);
    assert.equal(res.targetOverflowDiscarded, 0, 'ya no se descarta por sobrante');
    // 🔴 El sobrante NO es un duplicado: la página ya se pagó y su rendimiento
    // real tiene que seguir siendo legible.
    assert.equal(res.crossBranchDuplicatesRemoved, 0);
  });

  it('un hueco cerrado (0) hace que el ejecutor caiga a su objetivo por defecto, no a «cero gasto»', async () => {
    // 🔴 Propiedad deliberada: `resolveLushaTargetGap(0)` devuelve el objetivo por
    // defecto (fail-safe hacia el comportamiento de hoy). Por eso la decisión de NO
    // llamar al proveedor vive ARRIBA, en la acción, y no aquí: llegar hasta el
    // ejecutor con hueco 0 ya sería un error de orden.
    const { calls } = await run(
      [successResult(distinct(1, 'h'))],
      { plan: planWithBranches(1), targetGap: 0 },
    );
    assert.ok(calls.length >= 1);
  });
});
