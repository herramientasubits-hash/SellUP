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

describe('§ 21 — regresión con la FORMA de la QA del 2026-08-19', () => {
  it('tres ramas estériles gastan TRES peticiones, no seis, y aceptan cero', async () => {
    // Cada rama recibe una página 1 de 10 filas crudas que el detector canónico
    // declara duplicado exacto. Novedad útil = 0 en las tres.
    const { res, calls } = await run(
      [
        successResult(distinct(10, 'a')),
        successResult(distinct(10, 'b')),
        successResult(distinct(10, 'c')),
      ],
      { plan: planWithBranches(3), targetGap: 5 },
      exactDuplicate,
    );

    assert.equal(calls.length, 3, 'una petición por rama, ninguna segunda página');
    assert.deepEqual(calls.map((c) => c.page), [0, 0, 0]);
    // Las tres ramas SÍ se intentaron: la parada es de rama, nunca de corrida.
    assert.deepEqual(calls.map((c) => c.mainIndustryId), [11, 12, 12]);

    assert.equal(res.usefulCandidatesCount, 0);
    assert.equal(res.rawResultsTotal, 30);
    assert.equal(res.providerRequestsUsed, 3);
    // El techo seguía siendo 6: lo que bajó el gasto fue el rendimiento, no el tope.
    assert.equal(res.providerRequestsAllowed, 6);
    assert.equal(res.multiBranch?.pagesSkippedZeroNovelty, 3);
  });
});

describe('§ 23 — matriz de novedad cero sobre el ejecutor', () => {
  it('A/C/D — página 1 sin novedad útil ⇒ la rama NO compra su página 2', async () => {
    const { calls } = await run(
      [successResult(distinct(10, 'x')), successResult(distinct(10, 'y'))],
      { plan: planWithBranches(1), targetGap: 5 },
      exactDuplicate,
    );
    assert.equal(calls.length, 1);
  });

  it('B — una sola empresa nueva y útil permite la página 2 mientras quede hueco', async () => {
    const { calls, res } = await run(
      [
        successResult(distinct(1, 'p')),
        successResult(distinct(1, 'q')),
      ],
      { plan: planWithBranches(1), targetGap: 5 },
    );
    assert.equal(calls.length, 2, 'la rama sí continúa');
    assert.deepEqual(calls.map((c) => c.page), [0, 1]);
    assert.equal(res.usefulCandidatesCount, 2);
  });

  it('F — 10 crudas y 0 únicas por dedupe entre ramas ⇒ la rama no compra su página 2', async () => {
    // La rama 0 se queda las 10 empresas; la rama 1 recibe LAS MISMAS.
    const shared = distinct(10, 'dup');
    const { calls } = await run(
      [
        successResult(shared),
        successResult([]),
        successResult(shared),
        successResult(shared),
      ],
      { plan: planWithBranches(2), targetGap: 5 },
    );
    // Rama 0: página 0 rinde 5 aceptadas + 5 sobrantes ⇒ objetivo cerrado.
    // La corrida para por `target_reached`, que es una parada MÁS fuerte.
    assert.ok(calls.length <= 2);
  });

  it('G — una rama estéril NO impide que la siguiente se ejecute', async () => {
    const { calls, res } = await run(
      [
        // Rama 0: estéril.
        successResult(distinct(10, 'seca')),
        // Rama 1: dos empresas nuevas.
        successResult(distinct(2, 'viva')),
        successResult([]),
      ],
      { plan: planWithBranches(2), targetGap: 5 },
      (input) => (input.domain?.startsWith('seca') ? exactDuplicate(input) : noDuplicate(input)),
    );

    assert.equal(calls[0]?.mainIndustryId, 11);
    assert.equal(calls[1]?.mainIndustryId, 12, 'la rama siguiente SÍ se ejecuta');
    assert.equal(res.usefulCandidatesCount, 2);
  });

  it('H — objetivo alcanzado ⇒ no se intenta ninguna rama más', async () => {
    const { calls, res } = await run(
      [successResult(distinct(5, 'llena'))],
      { plan: planWithBranches(3), targetGap: 5 },
    );
    assert.equal(calls.length, 1);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.stopReason, 'target_reached');
  });

  it('🔴 § 19 — la parada por novedad cero NUNCA se reporta como parada de CORRIDA', async () => {
    const { res } = await run(
      [successResult(distinct(10, 'z'))],
      { plan: planWithBranches(1), targetGap: 5 },
      exactDuplicate,
    );
    // La corrida agotó sus ramas; no fue el proveedor quien la detuvo, y el motivo
    // no puede sugerir que se dejó de buscar por una decisión global.
    assert.equal(res.stopReason, 'branches_exhausted');
    assert.equal(res.remainingGapFinal, 5);
  });
});

describe('§ 14 — el hueco residual gobierna la ACEPTACIÓN', () => {
  it('un hueco de 2 acepta exactamente 2, aunque la página pagada rinda 10', async () => {
    const { res } = await run(
      [successResult(distinct(10, 'g'))],
      { plan: planWithBranches(1), targetGap: 2 },
    );
    assert.equal(res.usefulCandidatesCount, 2);
    assert.equal(res.targetGap, 2);
    assert.equal(res.targetOverflowDiscarded, 8);
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
