/**
 * AGENT1-LUSHA-CUT-L5-BILLING-BLOCKS-AND-PAGE-SIZE — el contrato de BLOQUES de
 * facturación de Lusha Prospecting y la página de 25 resultados.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * Hasta CUT-L4 la economía de Prospecting descansaba sobre una OBSERVACIÓN: tres
 * peticiones de `size=10` del microbenchmark Q3F-5R devolvieron
 * `creditsCharged=1`, y el repo dedujo «1 crédito por petición». La deducción era
 * correcta por accidente —10 resultados caben en un bloque de 25— y el día que
 * alguien subiera el tamaño de página la reserva se habría quedado a la mitad del
 * gasto real sin que ninguna prueba lo dijera.
 *
 * El soporte HUMANO confirmó el contrato: `max(1, ceil(resultados / 25))`, con un
 * MÍNIMO de 1 crédito incluso cuando la consulta devuelve cero resultados.
 *
 * Y de ahí sale la segunda mitad del corte: la página pasa de 10 a 25. No para
 * hacer menos llamadas, sino para comprar MENOS de más. Con 10 la corrida compraba
 * bloques a un tercio de su capacidad; con 50 el proveedor podría devolver 26–50 y
 * cobrar dos bloques antes de que SellUp pudiera mirar si el primero ya cerraba el
 * objetivo. 25 es exactamente un bloque: se paga uno, se inspecciona, y sólo se
 * compra el siguiente si queda hueco.
 *
 * ── Lo que esta suite defiende, dicho como defecto ───────────────────────────
 *
 *   * que la página vuelva a 10 (L5-A, M1) o suba a 50 (M2);
 *   * que una consulta de CERO resultados se tase en 0 créditos (L5-E, M3) —el
 *     mínimo de un crédito es contrato, no redondeo;
 *   * que 26 resultados se tasen en 1 crédito (M4);
 *   * que la fórmula esperada SUSTITUYA a `billing.creditsCharged` como
 *     liquidación (L5-I, L5-J, L5-K, M5);
 *   * que la corrida compre otro bloque con el objetivo YA cerrado (L5-B, M6);
 *   * que los duplicados LOCALES se descuenten de los créditos del proveedor
 *     (L5-C, M7) — suprimir después de la respuesta no devuelve el crédito;
 *   * que un `size` de 51 o una página inválida lleguen a HTTP (L5-M, L5-N, M8);
 *   * que el tope de páginas del PRODUCTO suba (M9) o que la reserva crezca por
 *     encima de 2 con la política de 25/2 páginas (L5-D, M10);
 *   * que un `429` o un `5xx` empiecen a contar el mínimo de un crédito
 *     (L5-F, L5-G, L5-H, M11, M12);
 *   * que un incumplimiento de facturación del proveedor se acepte en silencio y
 *     la corrida siga comprando (L5-I, M13);
 *   * que la suite salga del check obligatorio (M14).
 *
 * 🔴 Lo que esta suite NO afirma: que Lusha sea seguro de activar; que el preview
 * pagado se haya reactivado —sigue incapacitado y su tamaño sigue siendo 10—; ni
 * que ninguna migración se haya aplicado.
 *
 * Pura y offline: `global.fetch` doblado y CONTADO, la espera de reintento
 * inyectada a cero, y toda escritura por dobles inyectados. Sin red, sin Supabase,
 * sin Lusha, sin Apollo. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateLushaProspectingBillingContrast,
  exceedsLushaProspectingResultWindow,
  expectedLushaProspectingCreditsForPageSize,
  expectedLushaProspectingCreditsForReturnedResults,
  isDispatchableLushaProspectingPage,
  isDispatchableLushaProspectingPageSize,
  LUSHA_PROSPECTING_BILLING_BLOCK_SIZE,
  LUSHA_PROSPECTING_MAX_PAGE_SIZE,
  LUSHA_PROSPECTING_MAX_PROVIDER_PAGE_INDEX,
  LUSHA_PROSPECTING_MAX_PROVIDER_PAGES,
  LUSHA_PROSPECTING_MAX_PROVIDER_RESULTS,
  LUSHA_PROSPECTING_MIN_PAGE_SIZE,
  LUSHA_PROSPECTING_PAGE_SIZE,
  shouldStopPaidPaginationOnBillingContrast,
} from '@/server/integrations/lusha-prospecting-contract';
import {
  searchLushaCompaniesV3,
  type LushaCompanyProspectingV3Request,
} from '@/server/integrations/lusha-client';
import {
  buildLushaPreviewRequest,
  LUSHA_PREVIEW_SIZE,
  resolveLushaProspectingExpectedMaxCredits,
  resolveLushaProspectingPageSize,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  persistLushaPendingReviewBatch,
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewDeps,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  estimateLushaRunCredits,
  resolveLushaMaxCreditsPerProviderRequest,
  resolveLushaRunLiability,
  resolveLushaRunMaxProviderCredits,
} from '@/server/prospect-batches/lusha-run-liability';
import { LUSHA_RUN_MAX_RAW_RESULTS } from '@/server/prospect-batches/lusha-multibranch-execution';
import { createFencedLushaRunSearch } from '@/server/prospect-batches/lusha-fenced-prospecting-search';
import { lushaNoopRetrySleep } from '@/server/prospect-batches/lusha-safe-retry-policy';
import {
  createFenceStoreOn,
  createFenceTable,
} from './support/lusha-request-fence-table';
import { preM126FencedInsert } from './support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from './support/lusha-batch-epoch-snapshot';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════
// § 25 — el modelo de bloques, puro
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-L5 · § 5 — créditos ESPERADOS según los resultados devueltos', () => {
  it('la tabla del contrato HUMANO, entera', () => {
    const table: [number, number][] = [
      [0, 1],
      [1, 1],
      [10, 1],
      [24, 1],
      [25, 1],
      [26, 2],
      [49, 2],
      [50, 2],
    ];
    for (const [returned, expected] of table) {
      assert.equal(
        expectedLushaProspectingCreditsForReturnedResults(returned),
        expected,
        `resultados=${returned}`,
      );
    }
  });

  it('🔴 CERO resultados NO es gratis: el mínimo de un crédito es contrato', () => {
    // § 10 — la regresión más cara del corte. Una consulta ejecutada que no
    // encontró nada YA se cobró; tasarla en 0 haría que la contabilidad de la
    // corrida perdiera créditos reales.
    assert.equal(expectedLushaProspectingCreditsForReturnedResults(0), 1);
    assert.notEqual(expectedLushaProspectingCreditsForReturnedResults(0), 0);
  });

  it('la frontera del bloque está en 25/26, no en otro sitio', () => {
    assert.equal(expectedLushaProspectingCreditsForReturnedResults(25), 1);
    assert.equal(expectedLushaProspectingCreditsForReturnedResults(26), 2);
  });

  it('entrada no representable ⇒ `null`, nunca un número inventado', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 51, 50_001]) {
      assert.equal(
        expectedLushaProspectingCreditsForReturnedResults(bad),
        null,
        `entrada=${String(bad)}`,
      );
    }
    assert.equal(expectedLushaProspectingCreditsForReturnedResults(null), null);
    assert.equal(expectedLushaProspectingCreditsForReturnedResults(undefined), null);
  });
});

describe('CUT-L5 · § 6 — responsabilidad de la PETICIÓN, antes de que haya respuesta', () => {
  it('la tabla de § 25, entera', () => {
    const table: [number, number][] = [
      [1, 1],
      [10, 1],
      [25, 1],
      [26, 2],
      [50, 2],
    ];
    for (const [size, expected] of table) {
      assert.equal(expectedLushaProspectingCreditsForPageSize(size), expected, `size=${size}`);
    }
  });

  it('la página de producción vale exactamente UN crédito de responsabilidad', () => {
    assert.equal(expectedLushaProspectingCreditsForPageSize(LUSHA_PROSPECTING_PAGE_SIZE), 1);
  });

  it('tamaño no representable ⇒ `null`', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 51]) {
      assert.equal(
        expectedLushaProspectingCreditsForPageSize(bad),
        null,
        `size=${String(bad)}`,
      );
    }
  });
});

describe('CUT-L5 · §§ 7, 8, 9, 23 — esperado, real y su contraste', () => {
  it('L5-J · 10 resultados y 1 crédito real: CUADRA', () => {
    const c = evaluateLushaProspectingBillingContrast({
      requestedPageSize: 25,
      resultsReturned: 10,
      creditsCharged: 1,
    });
    assert.equal(c.expectedCredits, 1);
    assert.equal(c.actualCredits, 1);
    assert.equal(c.matchesContract, true);
    assert.equal(c.exceedsRequestLiability, false);
    assert.equal(shouldStopPaidPaginationOnBillingContrast(c), false);
  });

  it('L5-K · 25 resultados y 1 crédito real: CUADRA', () => {
    const c = evaluateLushaProspectingBillingContrast({
      requestedPageSize: 25,
      resultsReturned: 25,
      creditsCharged: 1,
    });
    assert.equal(c.matchesContract, true);
    assert.equal(shouldStopPaidPaginationOnBillingContrast(c), false);
  });

  it('L5-I · 10 resultados y 2 créditos reales: NO cuadra, y el real sigue siendo 2', () => {
    const c = evaluateLushaProspectingBillingContrast({
      requestedPageSize: 25,
      resultsReturned: 10,
      creditsCharged: 2,
    });
    assert.equal(c.expectedCredits, 1);
    // 🔴 M5 — el real NO se sustituye por la fórmula, y NO se recorta a la reserva.
    assert.equal(c.actualCredits, 2);
    assert.equal(c.matchesContract, false);
    assert.equal(c.exceedsRequestLiability, true);
    assert.equal(shouldStopPaidPaginationOnBillingContrast(c), true);
  });

  it('L5-L · contrato de CLIENTE: 26 resultados esperan 2 créditos', () => {
    // Producción pide 25 y nunca llega aquí; la tasación tiene que ser correcta
    // igualmente, o el día que alguien suba el tamaño la reserva mentiría.
    const c = evaluateLushaProspectingBillingContrast({
      requestedPageSize: 50,
      resultsReturned: 26,
      creditsCharged: 2,
    });
    assert.equal(c.expectedCredits, 2);
    assert.equal(c.requestLiabilityCredits, 2);
    assert.equal(c.matchesContract, true);
    assert.equal(c.exceedsRequestLiability, false);
  });

  it('§ 23 · el proveedor dice 0 en una consulta válida: se registra 0 y se marca incumplimiento', () => {
    const c = evaluateLushaProspectingBillingContrast({
      requestedPageSize: 25,
      resultsReturned: 12,
      creditsCharged: 0,
    });
    // 🔴 Verdad primero: NO se «repara» a 1.
    assert.equal(c.actualCredits, 0);
    assert.equal(c.expectedCredits, 1);
    assert.equal(c.matchesContract, false);
  });

  it('§ 24 · sin importe legible la certeza es DESCONOCIDA, no incumplimiento', () => {
    for (const bad of [null, undefined, Number.NaN, -1]) {
      const c = evaluateLushaProspectingBillingContrast({
        requestedPageSize: 25,
        resultsReturned: 10,
        creditsCharged: bad as number | null | undefined,
      });
      assert.equal(c.actualCredits, null, String(bad));
      assert.equal(c.matchesContract, null, String(bad));
      // La ausencia de importe NO para la paginación: eso ya lo gobierna CUT-L2.
      assert.equal(shouldStopPaidPaginationOnBillingContrast(c), false, String(bad));
    }
  });
});

describe('CUT-L5 · §§ 20, 21 — los límites del PROVEEDOR, encodados', () => {
  it('las constantes son las del contrato HUMANO', () => {
    assert.equal(LUSHA_PROSPECTING_BILLING_BLOCK_SIZE, 25);
    assert.equal(LUSHA_PROSPECTING_MIN_PAGE_SIZE, 10);
    assert.equal(LUSHA_PROSPECTING_MAX_PAGE_SIZE, 50);
    assert.equal(LUSHA_PROSPECTING_MAX_PROVIDER_PAGES, 1000);
    assert.equal(LUSHA_PROSPECTING_MAX_PROVIDER_RESULTS, 50_000);
    // Base 0 (OpenAPI V3 oficial): 1000 páginas son los índices 0…999.
    assert.equal(LUSHA_PROSPECTING_MAX_PROVIDER_PAGE_INDEX, 999);
  });

  it('🔴 las tres constantes son COHERENTES entre sí', () => {
    // páginas × tamaño máximo = resultados máximos. Si alguien sube las páginas
    // sin subir los resultados, la guarda de ventana empieza a morder — que es
    // exactamente lo que debe pasar.
    assert.equal(
      LUSHA_PROSPECTING_MAX_PROVIDER_PAGES * LUSHA_PROSPECTING_MAX_PAGE_SIZE,
      LUSHA_PROSPECTING_MAX_PROVIDER_RESULTS,
    );
  });

  it('tamaño despachable: [10, 50] y entero', () => {
    assert.equal(isDispatchableLushaProspectingPageSize(10), true);
    assert.equal(isDispatchableLushaProspectingPageSize(25), true);
    assert.equal(isDispatchableLushaProspectingPageSize(50), true);
    for (const bad of [9, 51, 0, -1, 25.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(isDispatchableLushaProspectingPageSize(bad), false, String(bad));
    }
  });

  it('página despachable: [0, 999] y entera', () => {
    assert.equal(isDispatchableLushaProspectingPage(0), true);
    assert.equal(isDispatchableLushaProspectingPage(999), true);
    for (const bad of [-1, 1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(isDispatchableLushaProspectingPage(bad), false, String(bad));
    }
  });

  it('la ventana de 50.000 resultados es una invariante, no un objetivo', () => {
    assert.equal(exceedsLushaProspectingResultWindow(0, 25), false);
    assert.equal(exceedsLushaProspectingResultWindow(999, 50), false); // exactamente 50.000
    assert.equal(exceedsLushaProspectingResultWindow(999, 51), true);
    assert.equal(exceedsLushaProspectingResultWindow(1000, 50), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 26 — el andamiaje de runtime
// ═══════════════════════════════════════════════════════════════════════════

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'insurance_financial_services',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
};
const OPERATION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function company(i: number, overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: `pc-${i}`,
    name: `Co ${i}`,
    domain: `co${i}.com`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Banking',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 90,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

const manyCompanies = (n: number, base = 0): LushaPreviewCompany[] =>
  Array.from({ length: n }, (_, k) => company(base + k + 1));

function successResult(
  results: LushaPreviewCompany[],
  creditsCharged: number | null = 1,
): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: {
      creditsCharged,
      resultsReturned: results.length,
      // El techo real de una página de 25 resultados.
      expectedMaxCredits: resolveLushaProspectingExpectedMaxCredits(LUSHA_PROSPECTING_PAGE_SIZE),
    },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Banca',
      industryKey: 'insurance_financial_services',
      macroIndustryKey: 'insurance_financial_services',
      mainIndustriesIds: [7],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

const noDup = (input: DuplicateCheckInput): DuplicateCheckResult => ({
  status: 'new_candidate',
  confidence: 85,
  input,
  matches: [],
  summary: 'nuevo',
  checkedSources: ['sellup', 'hubspot'],
});

/** Toda empresa ya existe en SellUp: coincidencia EXACTA por dominio. */
const exactDup = (input: DuplicateCheckInput): DuplicateCheckResult => ({
  status: 'new_candidate',
  confidence: 0,
  input,
  matches: [
    {
      source: 'sellup',
      status: 'existing_in_sellup',
      confidence: 95,
      matchedId: '11111111-2222-4333-8444-555555555555',
      matchedName: String(input.name ?? 'Co'),
      matchedDomain: String(input.domain ?? 'co.com'),
      reason: `Dominio exacto coincide: ${String(input.domain ?? 'co.com')}`,
    },
  ],
  summary: 'duplicado exacto',
  checkedSources: ['sellup', 'hubspot'],
});

/** Ejecutor con `runSearch` DOBLADO: una respuesta por página. */
function makeFlow(opts: {
  pages: LushaPreviewResult[];
  checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
}) {
  const calls = {
    pages: [] as number[],
    inputs: [] as LushaPreviewInput[],
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      const page = input.page ?? 0;
      calls.pages.push(page);
      calls.inputs.push(input);
      return opts.pages[page] ?? successResult([], null);
    },
    reserveBatch: async (row) => {
      calls.batches.push(row);
      return { id: 'batch-1', adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      calls.candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => (opts.checker ?? noDup)(input),
    fetchActiveCandidates: async () => [],
  };
  return { deps, calls };
}

const run = async (opts: Parameters<typeof makeFlow>[0]) => {
  const { deps, calls } = makeFlow(opts);
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
  return { res, calls };
};

// ── Doble de `fetch` que CAPTURA el cuerpo enviado ──────────────────────────

type FetchStep = { status?: number; body?: unknown; headers?: Record<string, string> };

function capturingFetch(steps: FetchStep[]) {
  const bodies: Record<string, unknown>[] = [];
  const fn = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const step = steps[bodies.length];
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    if (!step) throw new Error(`llamada HTTP nº ${bodies.length} inesperada`);
    const status = step.status ?? 200;
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(step.headers ?? {})) lower[k.toLowerCase()] = v;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
      text: async () => JSON.stringify(step.body ?? {}),
      json: async () => step.body ?? {},
    } as unknown as Response;
  };
  return { fn, bodies };
}

async function withFetch<T>(fn: typeof globalThis.fetch, body: () => Promise<T>): Promise<T> {
  const saved = global.fetch;
  global.fetch = fn;
  try {
    return await body();
  } finally {
    global.fetch = saved;
  }
}

/** El `runSearch` REAL: valla durable + núcleo de preview + cliente de Lusha. */
function makeRealRunSearch() {
  return createFencedLushaRunSearch({
    store: createFenceStoreOn(createFenceTable()),
    operationId: OPERATION_ID,
    context: {
      triggeredByUserId: '00000000-1111-2222-3333-444444444444',
      reservationId: '99999999-8888-7777-6666-555555555555',
      clientRequestId: ACTOR.clientRequestId,
    },
    resolveApiKey: async () => 'test-key-not-real',
    searchCompanies: (
      apiKey: string,
      request: LushaCompanyProspectingV3Request,
      beforeDispatch: () => Promise<void>,
    ) => searchLushaCompaniesV3({ apiKey, timeoutMs: 5_000, request, beforeDispatch }),
    sleep: lushaNoopRetrySleep,
  });
}

const providerBody = (n: number, creditsCharged: number | null = 1) => ({
  data: Array.from({ length: n }, (_, k) => ({
    id: `lusha-${k}`,
    name: `Co ${k}`,
    domain: `co${k}.com`,
    country: 'Colombia',
  })),
  ...(creditsCharged === null ? {} : { billing: { creditsCharged } }),
});

// ═══════════════════════════════════════════════════════════════════════════
// L5-A — el tamaño que de verdad viaja
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-L5 · L5-A — la ruta PAGADA pide 25', () => {
  it('🔴 el cuerpo HTTP real lleva `pagination.size = 25`', async () => {
    const { fn, bodies } = capturingFetch([{ body: providerBody(25) }]);
    const { deps } = makeFlow({ pages: [] });
    await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      persistLushaPendingReviewBatch(
        { ...deps, runSearch: makeRealRunSearch() },
        INPUT,
        ACTOR,
      ),
    );
    assert.equal(bodies.length, 1);
    const pagination = (bodies[0] as { pagination?: { page: number; size: number } }).pagination;
    assert.deepEqual(pagination, { page: 0, size: 25 });
    // M1/M2 — ni 10 ni 50.
    assert.notEqual(pagination?.size, 10);
    assert.notEqual(pagination?.size, 50);
  });

  it('el ejecutor pasa el tamaño como POLÍTICA DE SERVIDOR, no lo hereda de la entrada', async () => {
    const { calls } = await run({ pages: [successResult(manyCompanies(25))] });
    assert.equal(calls.inputs[0]?.pageSize, LUSHA_PROSPECTING_PAGE_SIZE);
    // La entrada de la server action NO lo traía.
    assert.equal(INPUT.pageSize, undefined);
  });

  it('🔴 el PREVIEW no se movió: sin `pageSize` la petición sigue siendo de 10', () => {
    const p = buildLushaPreviewRequest({
      countryName: 'Colombia',
      mainIndustriesIds: [7],
      page: 0,
    }).pagination;
    assert.equal(p?.size, LUSHA_PREVIEW_SIZE);
    assert.equal(p?.size, 10);
  });

  it('el resolutor de tamaño recorta al rango despachable y degrada al preview', () => {
    assert.equal(resolveLushaProspectingPageSize(25), 25);
    assert.equal(resolveLushaProspectingPageSize(50), 50);
    assert.equal(resolveLushaProspectingPageSize(51), LUSHA_PROSPECTING_MAX_PAGE_SIZE);
    assert.equal(resolveLushaProspectingPageSize(3), LUSHA_PROSPECTING_MIN_PAGE_SIZE);
    for (const absent of [null, undefined, Number.NaN, 12.5]) {
      assert.equal(resolveLushaProspectingPageSize(absent), LUSHA_PREVIEW_SIZE, String(absent));
    }
  });

  it('el techo por petición sigue al tamaño: 25 → 1, 50 → 2', () => {
    assert.equal(resolveLushaProspectingExpectedMaxCredits(25), 1);
    assert.equal(resolveLushaProspectingExpectedMaxCredits(50), 2);
    assert.equal(resolveLushaProspectingExpectedMaxCredits(undefined), 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L5-B/C/D/E — la economía de la corrida
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-L5 · §§ 15, 17 — un bloque a la vez', () => {
  it('L5-B · la página 1 cierra el objetivo ⇒ NO se compra la página 2', async () => {
    const { res, calls } = await run({ pages: [successResult(manyCompanies(25), 1)] });
    assert.equal(res.status, 'success');
    // 🔴 M6 — una sola petición. Éste es el motivo entero de elegir 25 y no 50:
    // con 50 el proveedor ya habría cobrado el segundo bloque aquí.
    assert.deepEqual(calls.pages, [0]);
    assert.equal(res.pagesRequested, 1);
    assert.equal(res.creditsChargedTotal, 1);
    assert.equal(res.usefulCandidatesCount, LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES);
    assert.equal(res.billingContract?.matchesContract, true);
  });

  it('L5-C · 25 empresas ya conocidas: el crédito se pagó igual y nada cerró hueco', async () => {
    const { res, calls } = await run({
      pages: [successResult(manyCompanies(25), 1), successResult(manyCompanies(25, 100), 1)],
      checker: exactDup,
    });
    // 🔴 M7 — suprimir en el CLIENTE no devuelve el crédito: la consulta ya se
    // cobró antes de que SellUp mirara un solo dominio.
    assert.equal(res.creditsChargedTotal, 1);
    assert.equal(res.usefulCandidatesCount, 0);
    assert.equal(res.excludedExactDuplicatesCount, 25);
    // 🔴 Y NO se compra el bloque siguiente de esa rama. Esto NO es CUT-L5: es la
    // política de novedad cero de CUT-9, que ya prohíbe releer un pozo que la
    // página anterior demostró seco. Este corte la CONSERVA — comprar el segundo
    // bloque aquí sería gastar más, no menos.
    assert.deepEqual(calls.pages, [0]);
  });

  it('§ 17 · queda hueco tras el primer bloque ⇒ el segundo SÍ se compra', async () => {
    const { res, calls } = await run({
      pages: [successResult(manyCompanies(2), 1), successResult(manyCompanies(3, 100), 1)],
    });
    assert.deepEqual(calls.pages, [0, 1]);
    assert.equal(res.usefulCandidatesCount, 5);
    // L5-D — dos páginas de ≤25 ⇒ 2 créditos, que es EXACTAMENTE el techo.
    assert.equal(res.creditsChargedTotal, 2);
    assert.equal(res.expectedMaxCredits, 2);
  });

  it('L5-D · el techo de la corrida sigue siendo 2 con la política de 25/2 páginas', async () => {
    const { res } = await run({
      pages: [successResult(manyCompanies(2), 1), successResult(manyCompanies(3, 100), 1)],
    });
    // 🔴 M10 — la reserva no crece porque la página creciera: 25 resultados son UN
    // bloque, así que el crédito por petición sigue siendo 1.
    assert.equal(res.expectedMaxCredits, resolveLushaRunMaxProviderCredits());
    assert.equal(res.expectedMaxCredits, 2);
    assert.ok((res.creditsChargedTotal ?? 0) <= res.expectedMaxCredits);
  });

  it('L5-E · éxito con CERO resultados: el proveedor cobra 1 y el contrato lo espera', async () => {
    const { res, calls } = await run({ pages: [successResult([], 1)] });
    // 🔴 M3 — 0 resultados NO implica 0 créditos.
    assert.equal(res.creditsChargedTotal, 1);
    assert.equal(res.billingContract?.expectedCreditsTotal, 1);
    assert.equal(res.billingContract?.matchesContract, true);
    assert.deepEqual(calls.pages, [0]);
  });

  it('L5-O · páginas solapadas: lo repetido no cuenta dos veces hacia el objetivo', async () => {
    // Página 0: 1,2,3 · Página 1: 2,3,4 → sólo 4 es nuevo.
    const { res, calls } = await run({
      pages: [
        successResult([company(1), company(2), company(3)], 1),
        successResult([company(2), company(3), company(4)], 1),
      ],
    });
    assert.deepEqual(calls.pages, [0, 1]);
    assert.equal(res.usefulCandidatesCount, 4);
    // 🔴 El dedupe de CLIENTE se conserva íntegro tras cambiar el tamaño de
    // página, y NO reduce lo facturado: se pagaron las dos consultas.
    assert.equal(res.creditsChargedTotal, 2);
  });
});

describe('CUT-L5 · §§ 8, 9 — el incumplimiento de facturación para la compra', () => {
  it('L5-I · 10 resultados cobrados a 2: se registra 2 y NO se compra otra página', async () => {
    const { res, calls } = await run({
      pages: [successResult(manyCompanies(2), 2), successResult(manyCompanies(3, 100), 1)],
    });
    // 🔴 M5 — el real se conserva tal cual. Nada se recorta a la reserva.
    assert.equal(res.creditsChargedTotal, 2);
    // 🔴 M13 — y la corrida deja de comprar: sin esto, un proveedor que cobra el
    // doble seguiría cobrando el doble página tras página en silencio.
    assert.deepEqual(calls.pages, [0]);
    assert.equal(res.billingContract?.matchesContract, false);
    assert.equal(res.billingContract?.mismatchedPages, 1);
    assert.equal(res.billingContract?.exceededRequestLiability, true);
    assert.equal(res.billingContract?.expectedCreditsTotal, 1);
    assert.equal(res.billingContract?.actualCreditsTotal, 2);
  });

  it('L5-J · 10 resultados cobrados a 1: cuadra y la corrida sigue su curso', async () => {
    const { res, calls } = await run({
      pages: [successResult(manyCompanies(2), 1), successResult(manyCompanies(3, 100), 1)],
    });
    assert.deepEqual(calls.pages, [0, 1]);
    assert.equal(res.billingContract?.matchesContract, true);
    assert.equal(res.billingContract?.mismatchedPages, 0);
    assert.equal(res.billingContract?.exceededRequestLiability, false);
  });

  it('L5-K · 25 resultados cobrados a 1: cuadra', async () => {
    const { res } = await run({ pages: [successResult(manyCompanies(25), 1)] });
    assert.equal(res.billingContract?.expectedCreditsTotal, 1);
    assert.equal(res.billingContract?.actualCreditsTotal, 1);
    assert.equal(res.billingContract?.matchesContract, true);
  });

  it('el resumen publica el bloque y el tamaño pedido, no sólo el veredicto', async () => {
    const { res } = await run({ pages: [successResult(manyCompanies(25), 1)] });
    assert.equal(res.billingContract?.billingBlockSize, LUSHA_PROSPECTING_BILLING_BLOCK_SIZE);
    assert.equal(res.billingContract?.requestedPageSize, LUSHA_PROSPECTING_PAGE_SIZE);
    assert.equal(res.billingContract?.requestLiabilityCreditsPerPage, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L5-F/G/H — CUT-L4 con la página de 25
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-L5 · §§ 11, 12, 27 — los reintentos de CUT-L4 no heredan el mínimo', () => {
  const scenario = async (steps: FetchStep[]) => {
    const { fn, bodies } = capturingFetch(steps);
    const { deps, calls } = makeFlow({ pages: [] });
    const res = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      persistLushaPendingReviewBatch(
        { ...deps, runSearch: makeRealRunSearch() },
        INPUT,
        ACTOR,
      ),
    );
    return { res, calls, httpCalls: bodies.length, bodies };
  };

  it('L5-F · 503 → éxito con 0 resultados: 2 intentos HTTP, 1 crédito total', async () => {
    const { res, httpCalls, bodies } = await scenario([
      { status: 503, body: {} },
      { body: providerBody(0, 1) },
    ]);
    assert.equal(httpCalls, 2);
    // 🔴 M12 — el `5xx` sigue costando CERO. El único crédito es el del éxito.
    assert.equal(res.creditsChargedTotal, 1);
    // Los dos intentos pidieron el mismo bloque de 25: el reintento no re-negocia
    // el tamaño ni compra de más.
    for (const b of bodies) {
      assert.equal((b as { pagination?: { size: number } }).pagination?.size, 25);
    }
  });

  it('L5-G · 429 → éxito con 25 resultados: 2 intentos HTTP, 1 crédito total', async () => {
    const { res, httpCalls } = await scenario([
      { status: 429, body: {} },
      { body: providerBody(25, 1) },
    ]);
    assert.equal(httpCalls, 2);
    // 🔴 M11 — el `429` sigue costando CERO.
    assert.equal(res.creditsChargedTotal, 1);
  });

  it('L5-H · 503 → 503: 2 intentos HTTP y CERO créditos', async () => {
    const { res, httpCalls } = await scenario([
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    assert.equal(httpCalls, 2);
    assert.equal(res.creditsChargedTotal, null);
    assert.equal(res.ok, false);
  });

  it('429 → 429: 2 intentos HTTP y CERO créditos', async () => {
    const { res, httpCalls } = await scenario([
      { status: 429, body: {} },
      { status: 429, body: {} },
    ]);
    assert.equal(httpCalls, 2);
    assert.equal(res.creditsChargedTotal, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L5-M/N — los límites, en el cliente
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-L5 · § 20 — un tamaño o una página inválidos NO llegan a HTTP', () => {
  const call = async (pagination: { page: number; size: number }) => {
    const { fn, bodies } = capturingFetch([]);
    const result = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      searchLushaCompaniesV3({
        apiKey: 'test-key-not-real',
        timeoutMs: 5_000,
        request: {
          filters: { companies: { include: { locations: [{ country: 'Colombia' }] } } },
          pagination,
        },
      }),
    );
    return { result, httpCalls: bodies.length };
  };

  it('L5-M · `size = 51` ⇒ 0 llamadas HTTP y fallo PROBADO antes del envío', async () => {
    const { result, httpCalls } = await call({ page: 0, size: 51 });
    // 🔴 M8 — cero bytes, cero créditos.
    assert.equal(httpCalls, 0);
    assert.equal(result.ok, false);
    assert.equal(result.outcome?.providerRequestDispatched, false);
    assert.equal(result.outcome?.billingCertainty, 'definitely_not_charged');
  });

  it('`size = 9` sigue rechazado por el mínimo del proveedor (regresión)', async () => {
    const { result, httpCalls } = await call({ page: 0, size: 9 });
    assert.equal(httpCalls, 0);
    assert.equal(result.ok, false);
    assert.match(String(result.errorMessage), /must not be less than 10/);
  });

  it('`size = 50` SÍ se despacha: el tope es del proveedor, no de este corte', async () => {
    const { fn, bodies } = capturingFetch([{ body: providerBody(1, 2) }]);
    await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      searchLushaCompaniesV3({
        apiKey: 'test-key-not-real',
        timeoutMs: 5_000,
        request: {
          filters: { companies: { include: { locations: [{ country: 'Colombia' }] } } },
          pagination: { page: 0, size: 50 },
        },
      }),
    );
    assert.equal(bodies.length, 1);
  });

  it('L5-N · página inválida ⇒ 0 llamadas HTTP', async () => {
    for (const page of [-1, 1000, 1.5]) {
      const { result, httpCalls } = await call({ page, size: 25 });
      assert.equal(httpCalls, 0, `page=${page}`);
      assert.equal(result.ok, false, `page=${page}`);
      assert.equal(result.outcome?.providerRequestDispatched, false, `page=${page}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 14, 16, 28, 29 — alcance: lo que este corte NO movió
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-L5 · alcance y trinquetes', () => {
  const contract = read('src/server/integrations/lusha-prospecting-contract.ts');
  const writer = read('src/server/prospect-batches/lusha-pending-review.ts');
  const preview = read('src/server/prospect-batches/lusha-preview.ts');
  const limits = read('src/server/prospect-batches/lusha-pending-review-limits.ts');

  it('M1/M2 · la página de producción es 25 y sale del bloque de facturación', () => {
    assert.equal(LUSHA_PROSPECTING_PAGE_SIZE, 25);
    assert.equal(LUSHA_PROSPECTING_PAGE_SIZE, LUSHA_PROSPECTING_BILLING_BLOCK_SIZE);
    assert.match(
      contract,
      /LUSHA_PROSPECTING_PAGE_SIZE\s*=\s*LUSHA_PROSPECTING_BILLING_BLOCK_SIZE/,
    );
    // 🔴 Y el writer la usa: la constante correcta sin cablear no vale nada.
    assert.match(writer, /pageSize:\s*LUSHA_PROSPECTING_PAGE_SIZE/);
  });

  it('M9 · el tope de páginas del PRODUCTO no se movió', () => {
    assert.equal(LUSHA_PENDING_REVIEW_MAX_PAGES, 2);
    assert.match(limits, /LUSHA_PENDING_REVIEW_MAX_PAGES\s*=\s*2/);
    assert.match(writer, /page\s*<\s*LUSHA_PENDING_REVIEW_MAX_PAGES/);
    // El proveedor permite 1000; SellUp no. Capacidad ≠ política.
    assert.notEqual(LUSHA_PENDING_REVIEW_MAX_PAGES, LUSHA_PROSPECTING_MAX_PROVIDER_PAGES);
  });

  it('M10 · la reserva sigue siendo 2, y sigue derivada', () => {
    assert.equal(resolveLushaMaxCreditsPerProviderRequest(), 1);
    assert.equal(resolveLushaRunMaxProviderCredits(), 2);
    assert.equal(estimateLushaRunCredits(), 2);
    assert.equal(resolveLushaRunLiability().normalizedBudgetCredits, 2);
    assert.equal(resolveLushaRunLiability().maxCreditsPerPage, 1);
    // Tres ramas siguen valiendo 6, ni más ni menos.
    assert.equal(
      estimateLushaRunCredits({ branches: [{}, {}, {}] as never }),
      6,
    );
  });

  it('§ 15 · el efecto económico: mismo techo de créditos, más candidatos vistos', () => {
    // Antes: 2 páginas × 10 = 20 resultados como máximo, 2 créditos.
    // Ahora: 2 páginas × 25 = 50 resultados como máximo, los mismos 2 créditos.
    const maxResultsPerBranch = LUSHA_PENDING_REVIEW_MAX_PAGES * LUSHA_PROSPECTING_PAGE_SIZE;
    assert.equal(maxResultsPerBranch, 50);
    assert.equal(resolveLushaRunMaxProviderCredits(), 2);
    // Y el techo de filas crudas de la corrida escaló con la página, en vez de
    // convertirse en un recorte de ramas.
    assert.equal(LUSHA_RUN_MAX_RAW_RESULTS, 3 * LUSHA_PENDING_REVIEW_MAX_PAGES * 25);
  });

  it('🔴 el preview pagado sigue incapacitado y su tamaño sigue siendo 10', () => {
    assert.equal(LUSHA_PREVIEW_SIZE, 10);
    assert.match(preview, /LUSHA_PREVIEW_SIZE\s*=\s*10/);
  });

  it('§ 28 · CUT-L5 no añade ninguna migración', () => {
    const migrations = read('supabase/migrations/135_agent1_lusha_prospecting_request_fence.sql');
    assert.ok(migrations.length > 0);
    // El techo del repo sigue en 136 (la de CUT-L4). Nada de 137.
    assert.throws(() =>
      read('supabase/migrations/137_agent1_lusha_prospecting_billing_blocks.sql'),
    );
  });

  it('M14 · la suite está cableada al check OBLIGATORIO', () => {
    const pkg = read('package.json');
    assert.match(pkg, /"test:a1-lusha-cut-l5-billing-blocks"/);
    assert.match(pkg, /cut-l5-billing-blocks-page-size\.test\.ts/);
    const ci = read('.github/workflows/automatic-routing-tests.yml');
    assert.match(ci, /npm run test:a1-lusha-cut-l5-billing-blocks/);
  });

  it('🔴 el contrato NO sustituye a `billing.creditsCharged` como liquidación', () => {
    // M5, como guarda estática: el writer suma lo REAL, y lo esperado va aparte.
    assert.match(writer, /creditsChargedTotal\s*=\s*addCredits\(creditsChargedTotal,\s*pageCredits\)/);
    assert.match(writer, /actualCreditsTotal:\s*creditsChargedTotal/);
    // El módulo de contrato no lee ni escribe nada: puro.
    assert.doesNotMatch(contract, /\bfetch\s*\(/);
    assert.doesNotMatch(contract, /process\.env/);
    assert.doesNotMatch(contract, /supabase/i);
  });
});
