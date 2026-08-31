/**
 * AGENT1-LUSHA-CUT-L3 · IDENTIDAD DURABLE DE LA OPERACIÓN LÓGICA
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL DEFECTO QUE ESTA SUITE DEFIENDE
 * ═══════════════════════════════════════════════════════════════════
 *
 * La primera versión de CUT-L3 vallaba la petición con esta identidad:
 *
 *     lusha_prospecting|v1|<clientRequestId>|b<rama>|p<página>
 *
 * y `clientRequestId` lo acuña el NAVEGADOR (`crypto.randomUUID()`), fresco por
 * clic. Eso cerraba tres cosas —redelivery del mismo payload, reintento del
 * framework y `already_reserved` sobre el mismo id— y NO cerraba la única que
 * duplica cargos de verdad:
 *
 *     el proceso cae
 *       → la valla previa queda `dispatch_unsafe` / indeterminada
 *         → la usuaria vuelve a hacer clic
 *           → clientRequestId NUEVO ⇒ clave de valla NUEVA
 *             → la MISMA página lógica podía volver a llegar a Lusha
 *
 * El soporte HUMANO de Lusha confirmó que eso puede costar dos veces: no hay
 * Idempotency-Key, no hay requestId de cliente y no hay API de recuperación.
 *
 * Cada caso de aquí cuenta LLAMADAS HTTP REALES contra un `global.fetch` doblado.
 * El conteo es la aserción; lo demás es contexto.
 *
 * ═══════════════════════════════════════════════════════════════════
 * LO QUE ESTA SUITE **NO** AFIRMA
 * ═══════════════════════════════════════════════════════════════════
 *
 * 🔴 NO afirma que Lusha sea seguro de activar. No enciende ningún flag, no toca
 * Producción y no gasta un crédito.
 *
 * 🔴 NO afirma que `dispatch_unsafe` signifique que Lusha recibió la petición.
 * Significa que SellUp ya no puede probar que NO la recibiera.
 *
 * 🔴 NO añade reintentos. Eso es CUT-L4.
 *
 * Puras y offline: sin red, sin Supabase, sin Lusha, sin Apollo. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { searchLushaCompaniesV3 } from '@/server/integrations/lusha-client';
import type { LushaCompanyProspectingV3Request } from '@/server/integrations/lusha-client';
import type { LushaPreviewInput } from '@/server/prospect-batches/lusha-preview';
import { buildLushaRequestFenceKey } from '@/server/prospect-batches/lusha-request-fence';
import { createFencedLushaRunSearch } from '@/server/prospect-batches/lusha-fenced-prospecting-search';
import {
  buildLushaOperationActorScope,
  buildLushaOperationSignaturePayload,
  computeLushaOperationSignatureHash,
  resolveLushaProspectingOperation,
  LUSHA_OPERATION_SIGNATURE_VERSION,
  LUSHA_OPERATION_CAPABILITY_ABSENT_CODE,
  LUSHA_OPERATION_UNAVAILABLE_CODE,
  type LushaProspectingSearchCriteria,
} from '@/server/prospect-batches/lusha-prospecting-operation';
import {
  createFenceStoreOn,
  createFenceTable,
  type FenceTable,
} from './support/lusha-request-fence-table';
import {
  createOperationStoreOn,
  createOperationTable,
  readOperationRow,
  type OperationTable,
} from './support/lusha-prospecting-operation-table';

// ── Andamiaje ─────────────────────────────────────────────────────────────────

const USER_A = '00000000-1111-2222-3333-444444444444';
const USER_B = '00000000-1111-2222-3333-999999999999';
const RESERVATION_ID = '99999999-8888-7777-6666-555555555555';
const TIMEOUT_MS = 5_000;

/**
 * 🔴 DOS uuid de navegador DISTINTOS. Son el corazón del caso: el primer clic y el
 * segundo NUNCA comparten `clientRequestId`, porque el wizard llama a
 * `crypto.randomUUID()` cada vez que acuña una corrida.
 */
const CLIENT_A = '11111111-1111-1111-1111-111111111111';
const CLIENT_B = '22222222-2222-2222-2222-222222222222';

const SEARCH_X: LushaProspectingSearchCriteria = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

/** Difiere de SEARCH_X en UN criterio pagado: otro país. */
const SEARCH_Y: LushaProspectingSearchCriteria = { ...SEARCH_X, countryCode: 'MX' };

const PREVIEW_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const SUCCESS_BODY = {
  results: [{ id: 'lusha-1', name: 'Acme', domain: 'acme.com' }],
  billing: { creditsCharged: 1 },
};

type HeaderMap = Record<string, string>;

function headersOf(map: HeaderMap) {
  const lower: HeaderMap = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/** `fetch` doblado que CUENTA los envíos. El conteo es la aserción del arreglo. */
function countingFetch(opts: { status: number; body?: unknown; headers?: HeaderMap }) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return {
      ok: opts.status >= 200 && opts.status < 300,
      status: opts.status,
      headers: headersOf(opts.headers ?? {}),
      text: async () => JSON.stringify(opts.body ?? {}),
      json: async () => opts.body ?? {},
    } as unknown as Response;
  };
  return { fn, calls };
}

async function withFetch<T>(fn: typeof globalThis.fetch, run: () => Promise<T>): Promise<T> {
  const saved = global.fetch;
  global.fetch = fn;
  try {
    return await run();
  } finally {
    global.fetch = saved;
  }
}

/**
 * UNA entrada del servidor, reconstruida con la MISMA composición que cablea
 * `runGenerateLushaPendingReviewBatch`:
 *
 *     resolver la operación lógica
 *       → si NO autoriza: cero reservas, cero peticiones, salida
 *         → si autoriza: valla por petición → cliente REAL de Lusha → `fetch()`
 *
 * 🔴 `clientRequestId` es un PARÁMETRO, no una constante del archivo. Ésa es la
 * mitad que la versión anterior no probaba: fijarlo habría hecho pasar por
 * cerrado justo el caso que estaba abierto (§ 11).
 *
 * `reserve` cuenta reservas económicas: sólo debe correr cuando la operación
 * autoriza, porque una reserva nueva tras una caída es la otra mitad del cargo.
 */
async function serverEntry(args: {
  operations: OperationTable;
  fence: FenceTable;
  internalUserId: string;
  criteria: LushaProspectingSearchCriteria;
  clientRequestId: string;
  branches?: { branchIndex: number; page: number }[];
  reservations: { count: number };
}): Promise<{ authorized: boolean; operationId: string | null; blockCode: string | null }> {
  const resolution = await resolveLushaProspectingOperation({
    store: createOperationStoreOn(args.operations),
    internalUserId: args.internalUserId,
    criteria: args.criteria,
    clientRequestId: args.clientRequestId,
  });

  if (resolution.status === 'blocked') {
    // 🔴 Cero reservas y cero peticiones. La entrada entera se detiene.
    return { authorized: false, operationId: resolution.block.operationId, blockCode: resolution.block.code };
  }

  // Sólo una operación recién acuñada llega a reservar crédito.
  args.reservations.count += 1;

  const runSearch = createFencedLushaRunSearch({
    store: createFenceStoreOn(args.fence),
    operationId: resolution.operationId,
    context: {
      triggeredByUserId: args.internalUserId,
      reservationId: RESERVATION_ID,
      clientRequestId: args.clientRequestId,
    },
    resolveApiKey: async () => 'test-key-not-real',
    searchCompanies: (
      apiKey: string,
      request: LushaCompanyProspectingV3Request,
      beforeDispatch: () => Promise<void>,
    ) => searchLushaCompaniesV3({ apiKey, timeoutMs: TIMEOUT_MS, request, beforeDispatch }),
  });

  for (const coords of args.branches ?? [{ branchIndex: 0, page: 0 }]) {
    await runSearch(PREVIEW_INPUT, coords);
  }
  return { authorized: true, operationId: resolution.operationId, blockCode: null };
}

/** Cierra la operación por el camino DURABLE: la RPC decide, no el llamador. */
async function completeRun(operations: OperationTable, operationId: string) {
  return createOperationStoreOn(operations).complete(operationId);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
/** Código sin comentarios: nombrar algo en prosa no es cablearlo. */
const codeOf = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ═════════════════════════════════════════════════════════════════════════════

describe('L3-ID · la firma canónica (§§ 5, 6)', () => {
  it('L3-ID-4 — el MISMO significado con las claves en otro orden da la MISMA firma', () => {
    const a = computeLushaOperationSignatureHash({
      countryCode: 'CO',
      macroIndustryKey: 'health_pharma',
      sizeBandKey: '201-5000',
      subIndustryId: null,
      searchText: null,
    });
    const b = computeLushaOperationSignatureHash({
      searchText: null,
      subIndustryId: null,
      sizeBandKey: '201-5000',
      macroIndustryKey: 'health_pharma',
      countryCode: 'CO',
    });
    assert.equal(a, b);
  });

  it('L3-ID-4 — normaliza país y texto libre sin colapsar significados distintos', () => {
    assert.equal(
      computeLushaOperationSignatureHash({ ...SEARCH_X, countryCode: 'co' }),
      computeLushaOperationSignatureHash({ ...SEARCH_X, countryCode: 'CO' }),
    );
    assert.equal(
      computeLushaOperationSignatureHash({ ...SEARCH_X, searchText: '  Clínica   Norte ' }),
      computeLushaOperationSignatureHash({ ...SEARCH_X, searchText: 'clínica norte' }),
    );
    // Un criterio pagado distinto ⇒ firma distinta. Sin colapsos accidentales.
    for (const other of [
      { ...SEARCH_X, countryCode: 'MX' },
      { ...SEARCH_X, macroIndustryKey: 'industry_manufacturing_chemicals_automotive' },
      { ...SEARCH_X, subIndustryId: 7 },
      { ...SEARCH_X, sizeBandKey: '1-50' },
      { ...SEARCH_X, searchText: 'clinica sur' },
    ] as LushaProspectingSearchCriteria[]) {
      assert.notEqual(
        computeLushaOperationSignatureHash(other),
        computeLushaOperationSignatureHash(SEARCH_X),
      );
    }
  });

  it('§ 5 — NINGÚN valor efímero entra en la firma', () => {
    const payload = buildLushaOperationSignaturePayload(SEARCH_X);
    const serialized = JSON.stringify(payload);
    for (const ephemeral of [CLIENT_A, CLIENT_B, RESERVATION_ID, USER_A]) {
      assert.equal(
        serialized.includes(ephemeral),
        false,
        `la firma no puede llevar ${ephemeral}`,
      );
    }
    for (const forbidden of ['clientRequestId', 'reservationId', 'timestamp', 'createdAt']) {
      assert.equal(Object.keys(payload).includes(forbidden), false, `sobra ${forbidden}`);
    }
    // Lo que sí describe: proveedor, superficie, versión y criterios pagados.
    assert.equal(payload.provider, 'lusha');
    assert.equal(payload.signatureVersion, LUSHA_OPERATION_SIGNATURE_VERSION);
    assert.equal(payload.countryCode, 'CO');
  });

  it('§ 14 — el ámbito del actor es la frontera que YA usa el repositorio', () => {
    assert.equal(buildLushaOperationActorScope(USER_A), `internal_user:${USER_A}`);
    assert.notEqual(
      buildLushaOperationActorScope(USER_A),
      buildLushaOperationActorScope(USER_B),
    );
    assert.throws(() => buildLushaOperationActorScope(''));
  });

  it('una firma sin criterios obligatorios LANZA en vez de acuñar una más ancha', () => {
    assert.throws(() =>
      computeLushaOperationSignatureHash({ countryCode: '', macroIndustryKey: 'x' }),
    );
    assert.throws(() =>
      computeLushaOperationSignatureHash({ countryCode: 'CO', macroIndustryKey: '  ' }),
    );
  });
});

describe('L3-ID · el clic nuevo tras la caída (§ 11) — EL P0', () => {
  it('L3-ID-1/L3-ID-2 — CLIENT_B reencuentra la operación de CLIENT_A y NO compra', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    // ── Primera invocación: CLIENT_A, SEARCH_X. Cruza la frontera y MUERE ──
    const first = await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, () => {
      // El proceso muere: ninguna liquidación llega a la tabla.
      fence.settleDisabled = true;
      return serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: SEARCH_X,
        clientRequestId: CLIENT_A,
        reservations,
      });
    });
    assert.equal(first.authorized, true);
    const OP_1 = first.operationId!;
    assert.equal(reservations.count, 1);
    // La página 0 quedó marcada y SIN liquidar: la caída dura, escrita.
    const fenced = fence.rows.get(buildLushaRequestFenceKey({ operationId: OP_1, branchIndex: 0, page: 0 }));
    assert.equal(fenced?.state, 'dispatch_unsafe');
    assert.equal(readOperationRow(operations, OP_1)?.state, 'open');

    // ── Segunda invocación: CLIENT_B — uuid de navegador NUEVO, misma búsqueda ──
    fence.settleDisabled = false;
    assert.notEqual(CLIENT_A, CLIENT_B, 'los dos clics NO comparten identidad de cliente');

    const second = await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, async () => {
      const counted = countingFetch({ status: 200, body: SUCCESS_BODY });
      global.fetch = counted.fn;
      const out = await serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: SEARCH_X,
        clientRequestId: CLIENT_B,
        reservations,
      });
      return { out, calls: counted.calls };
    });

    // 🔴 LAS TRES CIFRAS DEL CORTE.
    assert.equal(second.calls.length, 0, 'CERO peticiones al proveedor tras el clic nuevo');
    assert.equal(reservations.count, 1, 'CERO reservas nuevas');
    assert.equal(operations.operationsCreated, 1, 'CERO operaciones nuevas');

    // Y la operación devuelta es la MISMA, no una virgen.
    assert.equal(second.out.authorized, false);
    assert.equal(second.out.operationId, OP_1);
    assert.equal(readOperationRow(operations, OP_1)?.state, 'reconciliation_required');
    assert.equal(readOperationRow(operations, OP_1)?.resumeAttempts, 1);
  });

  it('L3-ID-2 — la valla NO deriva del clientRequestId: la clave sólo lleva la operación', () => {
    const key = buildLushaRequestFenceKey({ operationId: 'op-1', branchIndex: 0, page: 0 });
    assert.equal(key, 'lusha_prospecting|v2|op-1|b0|p0');
    assert.equal(key.includes(CLIENT_A), false);
    assert.equal(key.includes(CLIENT_B), false);
  });

  it('§ 11 — el bloqueo alcanza a las páginas que la corrida caída NO llegó a pedir', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    // Corrida de TRES páginas que muere tras la primera.
    await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, async () => {
      fence.settleDisabled = true;
      await serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: SEARCH_X,
        clientRequestId: CLIENT_A,
        branches: [{ branchIndex: 0, page: 0 }],
        reservations,
      });
    });
    fence.settleDisabled = false;

    // El clic nuevo pide las TRES páginas. Ninguna puede salir.
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });
    const out = await withFetch(counted.fn, () =>
      serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: SEARCH_X,
        clientRequestId: CLIENT_B,
        branches: [
          { branchIndex: 0, page: 0 },
          { branchIndex: 0, page: 1 },
          { branchIndex: 1, page: 0 },
        ],
        reservations,
      }),
    );
    assert.equal(out.authorized, false);
    // 🔴 Si el bloqueo fuera sólo de la página vieja, aquí habría DOS compras.
    assert.equal(counted.calls.length, 0);
    assert.equal(reservations.count, 1);
  });
});

describe('L3-ID · la repetición legítima sigue viva (§§ 8, 12)', () => {
  it('L3-ID-3 — una operación CERRADA permite acuñar otra para la MISMA búsqueda', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });
    const first = await withFetch(counted.fn, () =>
      serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: SEARCH_X,
        clientRequestId: CLIENT_A,
        reservations,
      }),
    );
    const OP_1 = first.operationId!;
    assert.equal(counted.calls.length, 1);

    // La corrida terminó DURABLEMENTE: la petición se liquidó `succeeded`.
    assert.equal((await completeRun(operations, OP_1)).status, 'completed');
    assert.equal(readOperationRow(operations, OP_1)?.state, 'completed');

    // Más adelante, un clic nuevo con la MISMA búsqueda. Es legítimo.
    const later = countingFetch({ status: 200, body: SUCCESS_BODY });
    const second = await withFetch(later.fn, () =>
      serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: SEARCH_X,
        clientRequestId: CLIENT_B,
        reservations,
      }),
    );
    assert.equal(second.authorized, true, 'una búsqueda futura NO puede quedar vetada');
    assert.notEqual(second.operationId, OP_1, 'OP_2 ≠ OP_1');
    assert.equal(operations.operationsCreated, 2);
    assert.equal(later.calls.length, 1);
  });

  it('L3-ID-4 — una búsqueda materialmente distinta acuña su propia operación', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    const a = await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations }),
    );
    const b = await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_Y, clientRequestId: CLIENT_B, reservations }),
    );
    assert.equal(a.authorized, true);
    assert.equal(b.authorized, true, 'SEARCH_Y no puede colapsar con SEARCH_X');
    assert.notEqual(a.operationId, b.operationId);
    assert.equal(operations.operationsCreated, 2);
  });

  it('L3-ID-5 — dos actores con criterios semánticamente iguales NO colisionan', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    // El primero deja su operación SIN resolver.
    await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, async () => {
      fence.settleDisabled = true;
      await serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations });
    });
    fence.settleDisabled = false;

    // El SEGUNDO actor, misma búsqueda. No puede heredar el bloqueo del primero.
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });
    const other = await withFetch(counted.fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_B, criteria: SEARCH_X, clientRequestId: CLIENT_B, reservations }),
    );
    assert.equal(other.authorized, true, 'un actor no puede robar ni heredar la operación de otro');
    assert.equal(counted.calls.length, 1);
    assert.equal(operations.operationsCreated, 2);
  });
});

describe('L3-ID · concurrencia y cierre (§§ 9, 15)', () => {
  it('L3-ID-6 — dos entradas simultáneas con clientRequestId distintos ⇒ UNA operación', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });

    const [a, b] = await withFetch(counted.fn, () =>
      Promise.all([
        serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations }),
        serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_B, reservations }),
      ]),
    );

    assert.equal(operations.operationsCreated, 1, 'exactamente UNA operación lógica');
    assert.equal([a.authorized, b.authorized].filter(Boolean).length, 1, 'sólo una entrada autoriza');
    assert.equal(reservations.count, 1, 'como mucho UNA reserva');
    assert.ok(counted.calls.length <= 1, 'como mucho UNA compra');
    // La perdedora se correlaciona con la ganadora, no con una operación virgen.
    const loser = a.authorized ? b : a;
    const winner = a.authorized ? a : b;
    assert.equal(loser.operationId, winner.operationId);
  });

  it('L3-ID-10 — la operación NO se cierra mientras una petición siga sin liquidar', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    const run = await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, async () => {
      fence.settleDisabled = true;
      return serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations });
    });
    const OP_1 = run.operationId!;

    // 🔴 El proveedor devolvió 200 y la valla está marcada. Aun así NO se cierra:
    // la petición no tiene verdad de facturación asentada.
    const closed = await completeRun(operations, OP_1);
    assert.equal(closed.status, 'blocked_unsettled_requests');
    assert.equal(readOperationRow(operations, OP_1)?.state, 'reconciliation_required');
  });

  it('L3-ID-8/W4 — éxito del proveedor + caída antes de persistir ⇒ sin recompra', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    // Éxito del proveedor, valla marcada… y el proceso cae ANTES de persistir.
    const run = await withFetch(countingFetch({ status: 200, body: SUCCESS_BODY }).fn, async () => {
      fence.settleDisabled = true;
      return serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations });
    });
    const OP_1 = run.operationId!;
    fence.settleDisabled = false;

    // 🔴 Nadie llama a `complete`: la persistencia de candidatos LANZA cuando
    // falla, así que ese camino nunca llega al cierre.
    assert.notEqual(readOperationRow(operations, OP_1)?.state, 'completed');

    // El clic nuevo se topa con la operación sin resolver.
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });
    const retry = await withFetch(counted.fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_B, reservations }),
    );
    assert.equal(counted.calls.length, 0, 'replay del proveedor = 0');
    assert.equal(retry.authorized, false);
    assert.equal(reservations.count, 1);
    // La operación sigue SIN resolver y lo DICE: no hay pérdida silenciosa.
    const state = readOperationRow(operations, OP_1)?.state;
    assert.equal(state, 'reconciliation_required');
    assert.notEqual(state, 'completed');
  });

  it('§ 9 — un 429 liquidado SÍ cierra: no se veta una búsqueda que no costó nada', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };

    const run = await withFetch(countingFetch({ status: 429, body: {} }).fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations }),
    );
    const OP_1 = run.operationId!;
    const fenced = fence.rows.get(buildLushaRequestFenceKey({ operationId: OP_1, branchIndex: 0, page: 0 }));
    assert.equal(fenced?.state, 'definitely_not_charged');
    assert.equal((await completeRun(operations, OP_1)).status, 'completed');
  });
});

describe('L3-ID · fallo CERRADO de la operación (§ 21)', () => {
  it('L3-ID-9 — sin la 135 aplicada NO se reserva ni se despacha', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    operations.capabilityAbsent = true;
    const reservations = { count: 0 };
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });

    const out = await withFetch(counted.fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations }),
    );
    assert.equal(out.authorized, false);
    assert.equal(out.blockCode, LUSHA_OPERATION_CAPABILITY_ABSENT_CODE);
    assert.equal(counted.calls.length, 0);
    assert.equal(reservations.count, 0);
  });

  it('L3-ID-9 — una avería de la RPC tampoco abre desvío', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    operations.failClaim = true;
    const reservations = { count: 0 };
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });

    const out = await withFetch(counted.fn, () =>
      serverEntry({ operations, fence, internalUserId: USER_A, criteria: SEARCH_X, clientRequestId: CLIENT_A, reservations }),
    );
    assert.equal(out.authorized, false);
    assert.equal(counted.calls.length, 0);
    assert.equal(reservations.count, 0);
  });

  it('§ 21 — una entrada con criterios inválidos falla CERRADO, no abierto', async () => {
    const fence = createFenceTable();
    const operations = createOperationTable(fence);
    const reservations = { count: 0 };
    const counted = countingFetch({ status: 200, body: SUCCESS_BODY });

    const out = await withFetch(counted.fn, () =>
      serverEntry({
        operations,
        fence,
        internalUserId: USER_A,
        criteria: { countryCode: '', macroIndustryKey: '' },
        clientRequestId: CLIENT_A,
        reservations,
      }),
    );
    assert.equal(out.authorized, false);
    assert.equal(counted.calls.length, 0);
    assert.equal(reservations.count, 0);
    assert.equal(operations.operationsCreated, 0);
  });
});

describe('L3-ID · guardas estáticas del cableado real (§§ 7, 22)', () => {
  const ACTION = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';

  it('L3-ID-7 — la clave de valla se construye con la OPERACIÓN, no con el cliente', () => {
    const fence = codeOf('src/server/prospect-batches/lusha-request-fence.ts');
    // La identidad sólo admite `operationId`; `clientRequestId` vive en el contexto.
    assert.match(fence, /export type LushaRequestFenceIdentity = \{[^}]*operationId: string;/);
    assert.doesNotMatch(
      fence,
      /export type LushaRequestFenceIdentity = \{[^}]*clientRequestId/,
      'clientRequestId NO puede volver a la identidad de la valla',
    );
    // Y la clave se arma con esa identidad, rama y página. Nada más.
    assert.match(fence, /const operationId = assertKeyComponent\(identity\.operationId, 'operationId'\)/);
    assert.doesNotMatch(fence, /assertKeyComponent\(identity\.clientRequestId/);
  });

  it('§ 7 — la puerta de operación va ANTES de la reserva y ANTES del proveedor', () => {
    const action = codeOf(ACTION);
    const gate = action.indexOf('resolveLushaProspectingOperation(');
    const reserve = action.indexOf('reserveLushaRunCredits(');
    const fence = action.indexOf('createFencedLushaRunSearch(');
    const free = action.indexOf('runPrePaidNoveltyDiscovery(');
    assert.ok(gate > 0, 'la acción resuelve la operación lógica');
    assert.ok(gate < reserve, 'la operación se resuelve ANTES de reservar crédito');
    assert.ok(gate < fence, 'la operación se resuelve ANTES de vallar peticiones');
    assert.ok(gate < free, 'la operación se resuelve ANTES incluso de la mitad gratuita');
  });

  it('§ 7 — un bloqueo de operación devuelve fallo y NO sigue a la reserva', () => {
    const action = codeOf(ACTION);
    assert.match(
      action,
      /if \(operation\.status === 'blocked'\)[\s\S]{0,400}?return buildLushaPendingReviewFailure\(/,
    );
    // Sin credencial no hay siquiera store: fallo CERRADO antes de nada, y con el
    // código canónico — no con una cadena escrita a mano en el sitio del fallo.
    assert.match(action, /operationStore === null[\s\S]{0,200}?return buildLushaPendingReviewFailure\(/);
    assert.match(action, /LUSHA_OPERATION_UNAVAILABLE_CODE/);
    assert.equal(LUSHA_OPERATION_UNAVAILABLE_CODE, 'lusha_prospecting_operation_unavailable');
  });

  it('§ 9 — el cierre ocurre DESPUÉS del cuerpo y NUNCA dentro del catch', () => {
    const action = codeOf(ACTION);
    const body = action.indexOf('runLushaPendingReviewUnderOperation({');
    const close = action.indexOf('completeLushaOperationObservably(operationStore');
    assert.ok(body > 0 && close > body, 'se cierra después de que el cuerpo devuelva');
    // El catch de la ruta reservada NO puede cerrar la operación: una corrida que
    // lanzó es exactamente la que debe quedarse sin resolver (W4).
    const catchBlock = action.slice(action.indexOf('} catch (err: unknown) {'));
    assert.equal(
      catchBlock.includes('completeLushaOperationObservably'),
      false,
      'un fallo NO puede cerrar la operación',
    );
  });

  it('§ 7 — la valla recibe `operationId`, y el clientRequestId sólo como traza', () => {
    const action = codeOf(ACTION);
    assert.match(action, /createFencedLushaRunSearch\(\{[\s\S]{0,400}?operationId,/);
    assert.doesNotMatch(
      action,
      /createFencedLushaRunSearch\(\{\s*store,\s*clientRequestId,/,
      'clientRequestId NO puede volver a ser la identidad de la valla',
    );
    assert.match(action, /context: \{[\s\S]{0,300}?clientRequestId,/);
  });

  it('§ 30 — economía intacta: ni página, ni tope, ni techo de créditos cambian', () => {
    const limits = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    const preview = read('src/server/prospect-batches/lusha-preview.ts');
    assert.match(limits, /LUSHA_PENDING_REVIEW_MAX_PAGES\s*=\s*\d+/);
    assert.match(preview, /LUSHA_PREVIEW_EXPECTED_MAX_CREDITS\s*=\s*1\s+as\s+const/);
  });

  it('§ 24 — el operation_id NO lleva número de intento (compatibilidad CUT-L4)', () => {
    const op = codeOf('src/server/prospect-batches/lusha-prospecting-operation.ts');
    for (const forbidden of ['attempt', 'retryCount', 'tryNumber']) {
      assert.equal(
        new RegExp(`${forbidden}`, 'i').test(op.replace(/reconciliation/gi, '')),
        false,
        `la identidad de operación no puede llevar ${forbidden}`,
      );
    }
    // Y CUT-L3 sigue sin reintentar.
    assert.doesNotMatch(op, /setTimeout|retryDelay|backoff/i);
  });

  it('§ 20 — la migración define la tabla de operaciones y su unicidad PARCIAL', () => {
    const sql = read('supabase/migrations/135_agent1_lusha_prospecting_request_fence.sql');
    const ddl = sql.replace(/^\s*--.*$/gm, '');
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS public\.lusha_prospecting_operations/);
    assert.match(ddl, /operation_id\s+uuid\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
    // 🔴 La unicidad es PARCIAL. Total sería un dedupe permanente de consultas.
    assert.match(
      ddl,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_lusha_prospecting_operations_one_unresolved[\s\S]*?WHERE state IN \('open', 'reconciliation_required'\)/,
    );
    // La valla cuelga de la operación, con FK y SIN cascada destructiva.
    assert.match(ddl, /operation_id\s+uuid\s+NOT NULL\s*\n\s*REFERENCES public\.lusha_prospecting_operations\(operation_id\)/);
    assert.doesNotMatch(ddl, /ON DELETE CASCADE/);
    // Y no guarda los criterios, sólo su hash.
    for (const forbidden of ['search_text', 'macro_industry', 'country_code', 'raw_criteria']) {
      assert.equal(sql.includes(forbidden), false, `la operación no puede guardar ${forbidden}`);
    }
  });
});

/**
 * § 28 — EL TRINQUETE DE CI.
 *
 * 🔴 Esto existe por un precedente concreto: CUT-L2 escribió su suite y no la
 * enchufó al check obligatorio, así que una regresión podía mergear igual.
 * `automatic-routing-tests.yml` enumera sus pasos A MANO — no hay descubrimiento
 * automático—, de modo que un archivo de pruebas nuevo NO entra al check por
 * existir. Estas guardas fallan si alguien lo desconecta.
 *
 * 🔴 Y cubren las TRES suites de CUT-L3, no sólo la nueva: la de valla ya estaba
 * en el workflow pero NADIE la ratcheteaba, que es la misma manera de perderla.
 */
describe('L3-ID · el trinquete de CI (§ 28)', () => {
  const WORKFLOW = '.github/workflows/automatic-routing-tests.yml';
  const SCRIPTS = [
    'test:a1-lusha-cut-l3-durable-operation-identity',
    'test:a1-lusha-cut-l3-durable-request-fence',
    'test:a1-lusha-cut-l3-fence:postgres',
  ];

  it('las tres suites de CUT-L3 existen como script de npm', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of SCRIPTS) {
      assert.ok(pkg.scripts[script], `falta el script ${script}`);
    }
    // Y el de identidad apunta al archivo de ESTA suite.
    assert.match(
      pkg.scripts[SCRIPTS[0]!]!,
      /cut-l3-durable-operation-identity\.test\.ts/,
    );
  });

  it('el check OBLIGATORIO ejecuta las tres', () => {
    const workflow = read(WORKFLOW);
    for (const script of SCRIPTS) {
      assert.ok(
        workflow.includes(`npm run ${script}`),
        `automatic-routing-tests.yml debe ejecutar npm run ${script}`,
      );
    }
  });

  it('la suite de PostgreSQL real corre con el arnés OBLIGATORIO', () => {
    const workflow = read(WORKFLOW);
    // Sin esta variable el arnés se salta solo cuando falta la dependencia, y un
    // paso que se salta solo es un paso decorativo.
    assert.match(
      workflow,
      /npm run test:a1-lusha-cut-l3-fence:postgres[\s\S]{0,200}?SELLUP_REQUIRE_POSTGRES_HARNESS: '1'/,
    );
  });
});
