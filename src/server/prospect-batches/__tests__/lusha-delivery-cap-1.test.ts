/**
 * AGENT1-DELIVERY-CAP-1 — el writer de Lusha entrega como MÁXIMO
 * `execution.maxDeliveredCandidates` empresas por escritura, COMPLETAS PRIMERO.
 *
 * Decisión de la dueña («opción B»): lo que no cabe NO se persiste y, por tanto,
 * NO reclama la empresa para este vendedor. El recorte va después de la admisión
 * por identidad de lote y ANTES de derivar un solo conteo, así que todo lo que el
 * núcleo publica describe las filas que de verdad escribió.
 *
 * Lo que esta suite demuestra contra `persistLushaPendingReviewBatch` REAL:
 *
 *   (a) 14 útiles + tope 10 ⇒ 10 filas escritas; la telemetría declara
 *       `delivery_cap: 10` y `delivery_capped_count: 4`.
 *   (b) COMPLETAS PRIMERO: con las completas al FINAL de la página, todas se
 *       escriben y las recortadas son incompletas (sin tamaño). Con todas
 *       iguales, lo entregado son exactamente las 10 primeras, en su orden.
 *   (c) `maxDeliveredCandidates: null` ⇒ las 14 se escriben y no aparece ninguna
 *       clave de entrega. `undefined` ⇒ se lee del entorno.
 *   (d) los contadores publicados (útiles, insertadas, aceptadas, identidades
 *       aceptadas, hueco, motivo de parada) describen las 10 escritas: el
 *       recorte NO abre un `post_admission_persistence_gap`.
 *
 * «Completa» = la empresa que X6.12 ya acredita (dominio que contiene el nombre,
 * LinkedIn de empresa, tamaño exacto, industria de la rama principal).
 * «Incompleta» = la MISMA empresa sin `employeesExact`: se persiste en revisión
 * pero no cuenta.
 *
 * Todo inyectado: sin red, sin base, sin cliente de Lusha, sin HubSpot.
 *
 * LIVE_LUSHA_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
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
import { resolveLushaMacroSearchPlan } from '@/server/prospect-batches/lusha-macro-search-plan';
import { DELIVERY_CAP_ENV_VAR } from '@/modules/prospect-batches/delivery-cap';
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const TARGET = 5;

const ACTOR = {
  internalUserId: 'user-delivery-cap',
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  requestedTarget: TARGET,
};

const HEALTH_PHARMA_PLAN = resolveLushaMacroSearchPlan('health_pharma');

/** 14 marcas distintas: el dominio contiene el nombre ⇒ el ownership acredita. */
const BRANDS = [
  'Medalfa', 'Medbeta', 'Medgamma', 'Meddelta', 'Medepsilon', 'Medzeta', 'Medeta',
  'Medtheta', 'Mediota', 'Medkappa', 'Medlambda', 'Medmu', 'Mednu', 'Medxi',
] as const;

function companyFor(index: number, complete: boolean): LushaPreviewCompany {
  const brand = BRANDS[index];
  const slug = brand.toLowerCase();
  return {
    providerCompanyId: `lusha-${slug}`,
    name: `${brand} Colombia SAS`,
    domain: `${slug}.com`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Healthcare',
    employeesExact: complete ? 700 : null,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: `https://www.linkedin.com/company/${slug}-co`,
    score: 100,
    passesGate: true,
    issues: [],
  };
}

/** Las 14 empresas; `completeIndexes` dice cuáles traen tamaño exacto. */
function buildPage(completeIndexes: ReadonlySet<number>): LushaPreviewCompany[] {
  return BRANDS.map((_, index) => companyFor(index, completeIndexes.has(index)));
}

const ALL_COMPLETE = new Set(BRANDS.map((_, index) => index));

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

/** La primera petición devuelve la página; las demás, vacías. */
function makeDeps(page: LushaPreviewCompany[]) {
  let searchCalls = 0;
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async () => {
      searchCalls += 1;
      return searchCalls === 1 ? successResult(page) : successResult([]);
    },
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      batches.push(row);
      return { id: `batch-${batches.length}`, adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicate(input),
    fetchActiveCandidates: async () => [],
  };
  return { deps, batches, candidateRows };
}

function execution(overrides: Partial<LushaMultiBranchExecution> = {}): LushaMultiBranchExecution {
  assert.ok(HEALTH_PHARMA_PLAN, 'el catálogo debe publicar el plan de health_pharma');
  return { plan: HEALTH_PHARMA_PLAN, targetGap: TARGET, creditsReserved: 6, ...overrides };
}

async function run(page: LushaPreviewCompany[], exec: LushaMultiBranchExecution) {
  const harness = makeDeps(page);
  const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, exec);
  return { res, ...harness };
}

/** Con el entorno controlado: la variable se fija (o se borra) y se restaura. */
async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[DELIVERY_CAP_ENV_VAR];
  if (value === undefined) delete process.env[DELIVERY_CAP_ENV_VAR];
  else process.env[DELIVERY_CAP_ENV_VAR] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[DELIVERY_CAP_ENV_VAR];
    else process.env[DELIVERY_CAP_ENV_VAR] = previous;
  }
}

function writtenDomains(rows: LushaPendingReviewCandidateRow[]): string[] {
  return rows.map((row) => row.domain as string);
}

function domainOf(index: number): string {
  return `${BRANDS[index].toLowerCase()}.com`;
}

// ─── Pruebas ─────────────────────────────────────────────────────────────────

describe('AGENT1-DELIVERY-CAP-1 — writer Lusha: tope de entrega por vendedor', () => {
  it('(a) 14 útiles + tope 10 ⇒ 10 filas y la telemetría declara 4 recortadas', async () => {
    const { res, batches, candidateRows } = await run(
      buildPage(ALL_COMPLETE),
      execution({ maxDeliveredCandidates: 10 }),
    );

    assert.equal(res.ok, true);
    assert.equal(res.status, 'success');
    assert.equal(batches.length, 1);
    assert.equal(candidateRows.length, 10, 'exactamente 10 filas escritas');
    assert.equal(res.createdCandidatesCount, 10);

    const telemetry = res.batchIdentityMetrics as Record<string, unknown>;
    assert.equal(telemetry.delivery_cap, 10);
    assert.equal(telemetry.delivery_capped_count, 4);
  });

  it('(a) la metadata del lote describe lo ENTREGADO (10), no lo devuelto (14)', async () => {
    const { batches } = await run(
      buildPage(ALL_COMPLETE),
      execution({ maxDeliveredCandidates: 10 }),
    );
    const metadata = batches[0].metadata as Record<string, unknown>;
    const duplicateSummary = metadata.duplicate_summary as Record<string, unknown>;
    assert.equal(duplicateSummary.total_useful_persisted, 10);
    const multiBranch = metadata.multi_branch as Record<string, unknown>;
    assert.equal(multiBranch.useful_results_total, 10);
    assert.equal(multiBranch.accepted_for_target_total, 10);
  });

  it('🔴 (a) la metadata PERSISTIDA del lote declara el recorte (tope, entregadas, recortadas)', async () => {
    const { batches } = await run(buildPage(ALL_COMPLETE), execution({ maxDeliveredCandidates: 10 }));
    const metadata = batches[0].metadata as Record<string, unknown>;
    assert.deepEqual(metadata.delivery_cap, { cap: 10, delivered_count: 10, capped_count: 4 });
  });

  it('(a) sin recorte el lote no lleva el bloque', async () => {
    const { batches } = await run(buildPage(ALL_COMPLETE), execution({ maxDeliveredCandidates: null }));
    assert.equal((batches[0].metadata as Record<string, unknown>).delivery_cap, undefined);
  });

  it('🔴 un tope explícito por debajo del objetivo se sube al objetivo (misma regla que Apollo)', async () => {
    const { candidateRows } = await run(buildPage(ALL_COMPLETE), execution({ maxDeliveredCandidates: 3, targetGap: 5 }));
    assert.equal(candidateRows.length, 5);
  });

  it('(b) con todas iguales, lo entregado son exactamente las 10 primeras, en su orden', async () => {
    const { candidateRows } = await run(
      buildPage(ALL_COMPLETE),
      execution({ maxDeliveredCandidates: 10 }),
    );
    assert.deepEqual(
      writtenDomains(candidateRows),
      BRANDS.slice(0, 10).map((_, index) => domainOf(index)),
    );
  });

  it('(b) 🔴 COMPLETAS PRIMERO: con las completas AL FINAL de la página, todas se escriben', async () => {
    // 0..5 incompletas (sin tamaño), 6..13 completas. Un recorte por orden de
    // llegada se habría llevado cuatro completas (10..13).
    const completeIndexes = new Set([6, 7, 8, 9, 10, 11, 12, 13]);
    const { res, candidateRows } = await run(
      buildPage(completeIndexes),
      execution({ maxDeliveredCandidates: 10 }),
    );

    assert.equal(candidateRows.length, 10);
    const domains = writtenDomains(candidateRows);
    for (const index of completeIndexes) {
      assert.ok(domains.includes(domainOf(index)), `${domainOf(index)} (completa) debe escribirse`);
    }

    // Las recortadas son las cuatro ÚLTIMAS incompletas (2..5); entran 0 y 1.
    const capped = BRANDS.map((_, index) => index).filter((index) => !domains.includes(domainOf(index)));
    assert.deepEqual(capped, [2, 3, 4, 5]);
    for (const index of capped) {
      assert.equal(completeIndexes.has(index), false, `${domainOf(index)} recortada es incompleta`);
    }

    // Lo entregado conserva el ORDEN ORIGINAL de la página.
    assert.deepEqual(domains, [0, 1, 6, 7, 8, 9, 10, 11, 12, 13].map(domainOf));

    // Las 8 completas son exactamente las aceptadas.
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 8);
    assert.equal(res.acceptedCandidateIdentities?.length, 8);
    assert.equal((res.batchIdentityMetrics as Record<string, unknown>).delivery_capped_count, 4);
  });

  it('(c) tope null ⇒ las 14 se escriben y no aparece ninguna clave de entrega', async () => {
    // Aun con la variable de entorno puesta: `null` explícito manda sobre el entorno.
    const { res, candidateRows, batches } = await withEnv('10', () =>
      run(buildPage(ALL_COMPLETE), execution({ maxDeliveredCandidates: null })),
    );

    assert.equal(candidateRows.length, 14);
    assert.equal(res.createdCandidatesCount, 14);
    assert.equal(res.usefulCandidatesCount, 14);
    const telemetry = res.batchIdentityMetrics as Record<string, unknown>;
    assert.equal('delivery_cap' in telemetry, false);
    assert.equal('delivery_capped_count' in telemetry, false);
    assert.doesNotMatch(JSON.stringify(batches[0].metadata), /delivery_cap/);
  });

  it('(c) tope undefined ⇒ se lee del entorno: con la variable en 10, 10 filas', async () => {
    const { res, candidateRows } = await withEnv('10', () =>
      run(buildPage(ALL_COMPLETE), execution()),
    );
    assert.equal(candidateRows.length, 10);
    assert.equal((res.batchIdentityMetrics as Record<string, unknown>).delivery_cap, 10);
    assert.equal((res.batchIdentityMetrics as Record<string, unknown>).delivery_capped_count, 4);
  });

  it('(c) tope undefined y sin variable de entorno ⇒ las 14 (X6.13 intacto)', async () => {
    const { res, candidateRows } = await withEnv(undefined, () =>
      run(buildPage(ALL_COMPLETE), execution()),
    );
    assert.equal(candidateRows.length, 14);
    assert.equal('delivery_cap' in (res.batchIdentityMetrics as Record<string, unknown>), false);
  });

  it('(c) una variable de entorno por debajo del objetivo se ignora ⇒ las 14', async () => {
    const { candidateRows } = await withEnv('3', () =>
      run(buildPage(ALL_COMPLETE), execution()),
    );
    assert.equal(candidateRows.length, 14);
  });

  it('(d) los contadores describen las 10 escritas: sin hueco de persistencia por el recorte', async () => {
    const completeIndexes = new Set([6, 7, 8, 9, 10, 11, 12, 13]);
    const { res, candidateRows } = await run(
      buildPage(completeIndexes),
      execution({ maxDeliveredCandidates: 10 }),
    );

    assert.equal(candidateRows.length, 10);
    assert.equal(res.usefulCandidatesCount, 10, 'útiles = lo entregado');
    assert.equal(res.insertedCandidatesCount, 10, 'insertadas = lo entregado');
    assert.equal(res.createdCandidatesCount, 10);
    assert.equal(res.multiBranch?.usefulResultsTotal, 10);
    assert.equal(res.multiBranch?.acceptedCountExact, true, 'la escritura fue TOTAL');
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 8);
    assert.equal(res.remainingGapFinal, 0);
    assert.equal(res.multiBranch?.remainingGapFinal, 0);
    assert.notEqual(res.stopReason, 'post_admission_persistence_gap');
    assert.notEqual(res.multiBranch?.stopReason, 'post_admission_persistence_gap');
    // El recorte NO es el descarte por cupo de aceptación retirado por X6.13.
    assert.equal(res.targetOverflowDiscarded, 0);

    // Identidad y conteo de lote: 10 admitidas, 10 persistidas.
    const telemetry = res.batchIdentityMetrics as Record<string, unknown>;
    assert.equal(telemetry.persisted_unique, 10);
  });
});
