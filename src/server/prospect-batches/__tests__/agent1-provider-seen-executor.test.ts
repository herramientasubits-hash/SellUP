/**
 * ADDENDUM PROVIDER-SEEN §§ 4, 7, 8, 10 — la memoria sobre el EJECUTOR REAL.
 *
 * El defecto que estas pruebas defienden, dicho sin rodeos: hoy la única huella
 * que queda de una empresa que un proveedor nos mostró vive DENTRO del candidato
 * persistido. Es decir, recordamos exactamente lo que no hacía falta recordar, y
 * olvidamos lo que sí: lo rechazado por macro, el duplicado exacto, el candidato
 * histórico activo y el sobrante de objetivo. Todo eso se pagó y todo eso se
 * vuelve a pagar en la corrida siguiente.
 *
 * 🔴 Datos SINTÉTICOS. Ninguna empresa real aparece aquí, y ninguna prueba afirma
 * cómo se comporta el proveedor de verdad: afirman qué hace el ejecutor con lo
 * que reciba.
 *
 * Offline: sin red, sin DB, sin cliente de Lusha, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLushaProviderNotRequiredResult,
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
import { buildProviderSeenMemory } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import type {
  ProviderSeenWriteInput,
  ProviderSeenWriteResult,
} from '@/server/prospect-batches/provider-seen/provider-seen-store';

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
const OBSERVED_AT = '2026-08-20T10:00:00.000Z';

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

function distinct(count: number, prefix: string, overrides: Partial<LushaPreviewCompany> = {}) {
  return Array.from({ length: count }, (_, i) =>
    company({
      providerCompanyId: `${prefix}-${i}`,
      name: `Sintetica ${prefix} ${i}`,
      domain: `${prefix}-${i}.example`,
      ...overrides,
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

/**
 * 🔴 Un fallo del proveedor. `results` viene POBLADO a propósito: si el ejecutor
 * dedujera la validez del tamaño de la lista en vez de leer `ok`, esta prueba
 * grabaría memoria por una respuesta que nunca existió — el defecto de #303.
 */
function failureResult(results: LushaPreviewCompany[] = distinct(3, 'fantasma')): LushaPreviewResult {
  return {
    ok: false,
    status: 'error',
    results,
    error: 'HTTP 429',
    billing: { creditsCharged: null, resultsReturned: null, expectedMaxCredits: 1 },
    warnings: [],
  } as unknown as LushaPreviewResult;
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
  writes: ProviderSeenWriteInput[];
  persistedNames: string[];
};

function makeHarness(
  script: LushaPreviewResult[],
  options: {
    checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
    activeDomains?: string[];
  } = {},
): Harness {
  const calls: Harness['calls'] = [];
  const writes: ProviderSeenWriteInput[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const persistedNames: string[] = [];

  return {
    calls,
    writes,
    persistedNames,
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
      insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
        persistedNames.push(...rows.map((r) => r.name));
        return { insertedCount: rows.length };
      },
      checkCompanyDuplicate: async (input) => (options.checker ?? noDuplicate)(input),
      fetchActiveCandidates: async (domains) =>
        (options.activeDomains ?? [])
          .filter((d) => domains.includes(d))
          .map((domain) => ({
            id: `active-${domain}`,
            name: domain,
            domain,
            normalizedName: domain,
            countryCode: 'CO',
            status: 'needs_review',
            batchId: 'batch-historico',
          })) as never,
    },
  };
}

function providerSeenOption(
  harness: Harness,
  known: { ids?: string[]; domains?: string[] } = {},
): NonNullable<LushaMultiBranchExecution['providerSeen']> {
  return {
    memory: buildProviderSeenMemory([
      ...(known.ids ?? []).map((id) => ({ providerEntityId: id, normalizedDomain: null })),
      ...(known.domains ?? []).map((domain) => ({
        providerEntityId: null,
        normalizedDomain: domain,
      })),
    ]),
    record: async (input): Promise<ProviderSeenWriteResult> => {
      harness.writes.push(input);
      return {
        written: true,
        skippedReason: null,
        newIdsRecorded: input.observations.filter((o) => o.providerEntityId !== null).length,
        newDomainsRecorded: input.observations.filter((o) => o.normalizedDomain !== null).length,
        refreshedCount: 0,
      };
    },
    now: () => OBSERVED_AT,
    correlationId: 'run-sintetica-1',
  };
}

function plan(count: 1 | 2 | 3): LushaMultiBranchExecution['plan'] {
  const branches = [
    { mainIndustryId: 11, label: 'Healthcare' },
    { mainIndustryId: 12, subIndustryId: 71, label: 'Pharmaceuticals Manufacturing' },
    { mainIndustryId: 12, subIndustryId: 80, label: 'Medical Equipment' },
  ].slice(0, count);
  return { macroKey: 'health_pharma', branches };
}

function recordedIds(harness: Harness): string[] {
  return harness.writes.flatMap((w) =>
    w.observations.map((o) => o.providerEntityId ?? `domain:${o.normalizedDomain}`),
  );
}

describe('§ 4 — se recuerda lo que se pagó, sea cual sea su desenlace', () => {
  it('§ 11.9 — un DUPLICADO EXACTO se recuerda igual, aunque no se persista nada', async () => {
    const harness = makeHarness([successResult(distinct(4, 'dup'))], {
      checker: exactDuplicate,
    });
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(res.usefulCandidatesCount, 0, 'nada útil…');
    assert.deepEqual(harness.persistedNames, [], '…y nada persistido…');
    // …pero las cuatro quedaron recordadas: la corrida siguiente ya no las paga.
    assert.deepEqual(recordedIds(harness), ['dup-0', 'dup-1', 'dup-2', 'dup-3']);
  });

  it('§ 11.10 — un CANDIDATO HISTÓRICO ACTIVO se recuerda igual', async () => {
    const companies = distinct(3, 'hist');
    const harness = makeHarness([successResult(companies)], {
      activeDomains: companies.map((c) => c.domain!),
    });
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(res.skippedActiveDuplicatesCount, 3);
    assert.equal(res.usefulCandidatesCount, 0);
    assert.deepEqual(recordedIds(harness), ['hist-0', 'hist-1', 'hist-2']);
  });

  it('§ 11.11 — el SOBRANTE de objetivo se recuerda igual', async () => {
    // Objetivo 2, la página trae 5. Tres son sobrante: ya se pagaron.
    const harness = makeHarness([successResult(distinct(5, 'over'))]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 2,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(res.usefulCandidatesCount, 2, '§ 11.24 — el objetivo EXACTO sigue intacto');
    assert.equal(res.targetOverflowDiscarded, 3);
    assert.deepEqual(recordedIds(harness), ['over-0', 'over-1', 'over-2', 'over-3', 'over-4']);
  });

  it('§ 11.8 — una empresa RECHAZADA POR PRECISIÓN de macro se recuerda igual', async () => {
    // Industria declarada que el catálogo no confirma para `health_pharma`.
    const harness = makeHarness([
      successResult(distinct(3, 'offmacro', { industry: 'Construction' })),
    ]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.ok(res.precisionRejectedTotal! > 0, 'la precisión rechazó');
    assert.equal(res.usefulCandidatesCount, 0);
    assert.deepEqual(recordedIds(harness), ['offmacro-0', 'offmacro-1', 'offmacro-2']);
  });

  it('§ 11.12 — una empresa SIN dominio se recuerda por su id de proveedor', async () => {
    const harness = makeHarness([
      successResult([company({ providerCompanyId: 'v1.solo-id', name: 'Sin Web', domain: null })]),
    ]);
    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(harness.writes.length, 1);
    assert.equal(harness.writes[0]!.observations[0]!.providerEntityId, 'v1.solo-id');
    assert.equal(harness.writes[0]!.observations[0]!.normalizedDomain, null);
  });
});

describe('§ 4 — lo que NUNCA genera memoria', () => {
  it('§ 11.13 — la corrida que NO llega al proveedor no escribe memoria', async () => {
    // Éste es el caso real de «sin petición»: la capa gratuita cerró el objetivo
    // y la acción sale ANTES de construir el ejecutor, con este resultado. Nunca
    // hay respuesta de proveedor, luego nunca hay nada que recordar.
    const result = buildLushaProviderNotRequiredResult({
      batchId: 'batch-gratis',
      createdCandidatesCount: 5,
      targetGap: 5,
      message: 'sin proveedor',
    });

    assert.equal(result.providerRequestsUsed, 0);
    assert.equal(result.rawResultsTotal, 0);
    assert.equal(result.creditsChargedTotal, 0);
    // Y no hay bloque de memoria: no existió una respuesta que observar.
    assert.equal(result.multiBranch, undefined);
  });

  it('§ 11.14 — un fallo del proveedor NO fabrica memoria, ni con cuerpo poblado', async () => {
    const harness = makeHarness([failureResult()]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(harness.calls.length, 1, 'la petición SÍ se emitió');
    assert.equal(harness.writes.length, 0, 'pero no hubo respuesta válida que recordar');
    assert.equal(res.ok, false);
  });

  it('§ 4 — una respuesta válida y VACÍA no escribe: no hay identidad que guardar', async () => {
    const harness = makeHarness([successResult([])]);
    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });
    assert.equal(harness.writes.length, 0);
  });

  it('§ 4 — un fallo de la MEMORIA no tira la corrida ya pagada', async () => {
    const harness = makeHarness([successResult(distinct(3, 'ok'))]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: {
        ...providerSeenOption(harness),
        record: async () => {
          throw new Error('memoria caída');
        },
      },
    });

    assert.equal(res.ok, true, 'la página ya estaba pagada: no se pierde lo comprado');
    assert.equal(res.usefulCandidatesCount, 3);
  });
});

describe('§§ 7, 8 — lo que este PR NO puede degradar', () => {
  it('§ 11.16 / § 11.25 — PR302 intacto: el duplicado entre RAMAS se sigue eliminando', async () => {
    const shared = company({
      providerCompanyId: 'v1.compartida',
      name: 'Compartida',
      domain: 'compartida.example',
    });
    const harness = makeHarness([
      successResult([shared, ...distinct(1, 'a')]),
      successResult([shared, ...distinct(1, 'b')]),
    ]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(2),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(res.crossBranchDuplicatesRemoved, 1);
    assert.equal(res.usefulCandidatesCount, 3, 'la compartida cuenta UNA vez');
    // 🔴 Pero la memoria SÍ la ve las dos veces: registrar es anterior al dedupe.
    // Recordar dos veces la misma identidad es idempotente en el almacén; no
    // registrarla en la segunda rama sería heredar el criterio del filtro.
    assert.equal(recordedIds(harness).filter((id) => id === 'v1.compartida').length, 2);
  });

  it('§ 11.17 / § 11.18 — página 1 sin novedad útil ⇒ la rama para, la SIGUIENTE rama sigue', async () => {
    const harness = makeHarness(
      [
        successResult(distinct(10, 'a')),
        successResult(distinct(10, 'b')),
      ],
      { checker: exactDuplicate },
    );
    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(2),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.deepEqual(harness.calls.map((c) => c.page), [0, 0], 'ninguna segunda página');
    assert.deepEqual(
      harness.calls.map((c) => c.mainIndustryId),
      [11, 12],
      'la rama B sí se intentó: la parada es de RAMA',
    );
    assert.equal(harness.writes.length, 2, 'las dos páginas pagadas se recordaron');
  });

  it('§ 11.19 — objetivo alcanzado ⇒ no se pide la rama siguiente', async () => {
    const harness = makeHarness([
      successResult(distinct(5, 'a')),
      successResult(distinct(5, 'b')),
    ]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(2),
      targetGap: 5,
      providerSeen: providerSeenOption(harness),
    });

    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(harness.calls.length, 1, 'una sola petición');
    assert.equal(res.stopReason, 'target_reached');
  });
});

describe('§ 10 — telemetría de la memoria', () => {
  it('publica aciertos, novedad y rendimiento por página, sin inventar economía', async () => {
    // La memoria ya conocía dos de las cinco empresas de la página.
    const harness = makeHarness([successResult(distinct(5, 'p'))]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: providerSeenOption(harness, { ids: ['p-0', 'p-1'] }),
    });

    const seen = res.multiBranch?.providerSeen;
    assert.ok(seen, 'el bloque existe cuando se pasó la memoria');
    assert.equal(seen!.rawResults, 5);
    assert.equal(seen!.providerSeenHits, 2);
    assert.equal(seen!.novelAfterProviderSeen, 3);
    assert.equal(seen!.pageYields.length, 1);
    assert.equal(seen!.pageYields[0]!.novelUsefulAfterLocalDedupe, 5);

    // 🔴 Un acierto NO descarta: las cinco siguen siendo candidatas útiles. La
    // memoria observa; el dedupe local decide.
    assert.equal(res.usefulCandidatesCount, 5);
  });

  it('sin memoria inyectada el bloque NO se emite: la metadata conserva su forma previa', async () => {
    const harness = makeHarness([successResult(distinct(2, 'q'))]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
    });

    assert.equal(res.multiBranch?.providerSeen, undefined);
    assert.equal(harness.writes.length, 0);
    assert.equal(res.usefulCandidatesCount, 2, 'y el resultado es el de siempre');
  });
});
