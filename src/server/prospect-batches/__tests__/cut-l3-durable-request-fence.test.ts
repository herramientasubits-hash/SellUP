/**
 * AGENT1-LUSHA-CUT-L3-DURABLE-REQUEST-FENCE § 21 — la suite dedicada del corte.
 *
 * ── Qué se prueba, dicho como defecto ────────────────────────────────────────
 *
 * CUT-L2 dejó la frontera de despacho en MEMORIA y lo declaró: una caída dura
 * entre `fetch()` y la clasificación deja la petición sin testigo. Con la reserva
 * de corrida devolviendo `already_reserved` sobre el mismo `client_request_id`,
 * la re-ejecución vuelve a pedir la MISMA página. El soporte HUMANO de Lusha
 * confirmó que eso puede cobrarse dos veces: no hay Idempotency-Key, no hay
 * requestId de cliente y no hay API de recuperación.
 *
 * Cada caso de aquí es una forma concreta de volver a abrir esa ventana:
 *
 *   L3-A  el proveedor se toca sin valla durable
 *   L3-B  el primer reclamo autoriza UNA ejecución
 *   L3-C  dos trabajadores concurrentes ⇒ UNA sola llamada HTTP
 *   L3-D  caída dura DESPUÉS de la frontera ⇒ al reanudar, CERO llamadas
 *   L3-E  timeout post-despacho ⇒ indeterminado, y al reanudar CERO
 *   L3-F  499 literal ⇒ misma prohibición de replay
 *   L3-G  429 ⇒ 0 créditos por contrato, y AUN ASÍ 0 reintentos en L3
 *   L3-H  5xx ⇒ igual
 *   L3-I  éxito ⇒ EXACTAMENTE una llamada, con su evidencia
 *   L3-J  reinicio tras éxito ⇒ CERO llamadas
 *   L3-K  `already_reserved` ⇒ CERO llamadas (el P0 de la auditoría)
 *   L3-L  otra página ⇒ petición DISTINTA, no se suprime
 *   L3-M  otra rama ⇒ petición DISTINTA
 *   L3-N  rechazo local previo al envío ⇒ NO se fabrica «pudo salir»
 *   L3-O  2xx ilegible ⇒ terminal sin replay
 *
 * ── 🔴 Lo que esta suite NO afirma ──────────────────────────────────────────
 *
 * No afirma que Lusha sea seguro de activar. No añade reintentos: `429` y `5xx`
 * salen `retryable_by_contract` porque eso describe lo que el proveedor PERMITE,
 * y ejecutarlo es CUT-L4. Y no afirma que un `dispatch_unsafe` significara que
 * Lusha recibió la petición: significa que SellUp ya no puede probar que no.
 *
 * Sin red, sin Supabase, sin Lusha real, sin un solo crédito. `global.fetch` va
 * doblado y se CUENTA — que el conteo sea la aserción es deliberado: es el único
 * hecho que corresponde uno a uno con un cargo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  searchLushaCompaniesV3,
  type LushaCompanyProspectingV3Request,
} from '@/server/integrations/lusha-client';
import type { LushaPreviewInput } from '@/server/prospect-batches/lusha-preview';
import {
  buildLushaRequestFenceKey,
  isLushaRequestFenceTerminalState,
  mayReExecuteLushaFencedRequest,
  resolveLushaRequestFenceTerminalState,
  runFencedLushaProspectingRequest,
  LUSHA_REQUEST_FENCE_CAPABILITY_ABSENT_CODE,
  LUSHA_REQUEST_FENCE_KEY_VERSION,
  LUSHA_REQUEST_FENCE_STATES,
} from '@/server/prospect-batches/lusha-request-fence';
import {
  createFencedLushaRunSearch,
  LUSHA_FENCE_BLOCKED_WARNING,
  LUSHA_FENCE_MISSING_COORDINATES_CODE,
} from '@/server/prospect-batches/lusha-fenced-prospecting-search';
import { guardLushaRunBudget } from '@/modules/prospect-batches/lusha-budget-gate';
import {
  createFenceStoreOn,
  createFenceTable,
  type FenceTable,
} from './support/lusha-request-fence-table';

// ── Andamiaje ─────────────────────────────────────────────────────────────────

const CLIENT_REQUEST_ID = '11111111-2222-3333-4444-555555555555';
/**
 * 🔴 La identidad DURABLE, acuñada por el servidor. Es la que valla. El uuid del
 * navegador de arriba viaja como TRAZA y ya no gobierna nada — ver la suite
 * `cut-l3-durable-operation-identity.test.ts`, que lo defiende con guardas.
 */
const OPERATION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const RESERVATION_ID = '99999999-8888-7777-6666-555555555555';
const USER_ID = '00000000-1111-2222-3333-444444444444';
const TIMEOUT_MS = 5_000;

const PREVIEW_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

type HeaderMap = Record<string, string>;

function headersOf(map: HeaderMap) {
  const lower: HeaderMap = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/** `fetch` doblado que CUENTA los envíos. El conteo es la aserción del corte. */
function countingFetch(opts: {
  status: number;
  body?: unknown;
  bodyText?: string;
  headers?: HeaderMap;
  throws?: Error;
}) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (opts.throws) throw opts.throws;
    return {
      ok: opts.status >= 200 && opts.status < 300,
      status: opts.status,
      headers: headersOf(opts.headers ?? {}),
      text: async () => opts.bodyText ?? JSON.stringify(opts.body ?? {}),
      json: async () => {
        if (opts.bodyText !== undefined) return JSON.parse(opts.bodyText);
        return opts.body ?? {};
      },
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

/** El `runSearch` REAL del corte, conectado al cliente REAL de Lusha. */
function makeRunSearch(
  table: FenceTable,
  overrides?: { apiKey?: string | null },
) {
  const blocks: { code: string; reason: string; state: string | null }[] = [];
  const settlementIssues: string[] = [];
  const runSearch = createFencedLushaRunSearch({
    store: createFenceStoreOn(table),
    operationId: OPERATION_ID,
    context: {
      triggeredByUserId: USER_ID,
      reservationId: RESERVATION_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    },
    resolveApiKey: async () =>
      overrides && 'apiKey' in overrides ? overrides.apiKey! : 'test-key-not-real',
    searchCompanies: (
      apiKey: string,
      request: LushaCompanyProspectingV3Request,
      beforeDispatch: () => Promise<void>,
    ) => searchLushaCompaniesV3({ apiKey, timeoutMs: TIMEOUT_MS, request, beforeDispatch }),
    onBlocked: (b) => blocks.push({ code: b.code, reason: b.reason, state: b.state }),
    onSettlementIssue: (i) => settlementIssues.push(i.code),
  });
  return { runSearch, blocks, settlementIssues };
}

const COORD_B0_P0 = { branchIndex: 0, page: 0 };
const KEY_B0_P0 = buildLushaRequestFenceKey({
  operationId: OPERATION_ID,
  branchIndex: 0,
  page: 0,
});

const SUCCESS_BODY = {
  results: [{ id: 'lusha-1', name: 'Acme', domain: 'acme.com' }],
  billing: { creditsCharged: 1 },
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-L3 · identidad de la petición (§ 5)', () => {
  it('la clave incluye ejecución, rama y página, y NADA de contenido', () => {
    const key = buildLushaRequestFenceKey({
      operationId: OPERATION_ID,
      branchIndex: 2,
      page: 3,
    });
    assert.equal(key, `lusha_prospecting|${LUSHA_REQUEST_FENCE_KEY_VERSION}|${OPERATION_ID}|b2|p3`);
    // 🔴 Y el uuid del navegador NO aparece: dejó de ser autoridad de replay.
    assert.doesNotMatch(key, new RegExp(CLIENT_REQUEST_ID));
    // Ni país, ni sector, ni dominio, ni nombre: una valla no es un índice de datos.
    assert.doesNotMatch(key, /CO|health_pharma|acme/i);
  });

  it('L3-M/L3-L — rama y página producen claves DISTINTAS', () => {
    const base = { operationId: OPERATION_ID, branchIndex: 0, page: 0 };
    const otherPage = buildLushaRequestFenceKey({ ...base, page: 1 });
    const otherBranch = buildLushaRequestFenceKey({ ...base, branchIndex: 1 });
    assert.notEqual(otherPage, KEY_B0_P0);
    assert.notEqual(otherBranch, KEY_B0_P0);
    assert.notEqual(otherPage, otherBranch);
  });

  it('una identidad incompleta LANZA en vez de acuñar una clave más ancha', () => {
    assert.throws(() =>
      buildLushaRequestFenceKey({ operationId: '', branchIndex: 0, page: 0 }),
    );
    assert.throws(() =>
      buildLushaRequestFenceKey({ operationId: 'a|b', branchIndex: 0, page: 0 }),
    );
    assert.throws(() =>
      buildLushaRequestFenceKey({ operationId: OPERATION_ID, branchIndex: -1, page: 0 }),
    );
  });
});

describe('CUT-L3 · estados terminales derivados de CUT-L2 (§ 11)', () => {
  it('cada clase de desenlace mapea al estado que la certeza de cobro exige', () => {
    assert.equal(resolveLushaRequestFenceTerminalState('success'), 'succeeded');
    assert.equal(
      resolveLushaRequestFenceTerminalState('http_429_rate_limited'),
      'definitely_not_charged',
    );
    assert.equal(
      resolveLushaRequestFenceTerminalState('http_5xx_provider_failure'),
      'definitely_not_charged',
    );
    assert.equal(
      resolveLushaRequestFenceTerminalState('local_pre_dispatch_failure'),
      'definitely_not_charged',
    );
    assert.equal(
      resolveLushaRequestFenceTerminalState('post_send_indeterminate'),
      'indeterminate',
    );
    // 🔴 Un 2xx ilegible NO es un 5xx confirmado: el servidor pudo completar una
    // operación facturable y ser SellUp quien no supo leerla.
    assert.equal(
      resolveLushaRequestFenceTerminalState('malformed_success_payload'),
      'indeterminate',
    );
    // 🔴 `unknown`, jamás `definitely_not_charged`: nadie confirmó el 4xx genérico.
    assert.equal(
      resolveLushaRequestFenceTerminalState('http_4xx_non_retryable'),
      'unknown',
    );
  });

  it('CUT-L3 no reintenta NUNCA, ni siquiera lo que el contrato permitiría', () => {
    assert.equal(mayReExecuteLushaFencedRequest(), false);
  });

  it('`prepared` y `dispatch_unsafe` NO son terminales; los otros cuatro sí', () => {
    assert.equal(isLushaRequestFenceTerminalState('prepared'), false);
    assert.equal(isLushaRequestFenceTerminalState('dispatch_unsafe'), false);
    for (const state of ['succeeded', 'definitely_not_charged', 'indeterminate', 'unknown'] as const) {
      assert.equal(isLushaRequestFenceTerminalState(state), true);
    }
    assert.equal(LUSHA_REQUEST_FENCE_STATES.length, 6);
  });
});

describe('CUT-L3 · L3-A — sin valla durable NO se toca al proveedor', () => {
  it('la 135 sin aplicar (capability_absent) bloquea: 0 llamadas HTTP', async () => {
    const table = createFenceTable();
    table.capabilityAbsent = true;
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const { runSearch, blocks } = makeRunSearch(table);

    const result = await withFetch(fetchDouble.fn, () => runSearch(PREVIEW_INPUT, COORD_B0_P0));

    assert.equal(fetchDouble.calls.length, 0, 'sin valla no se despacha');
    assert.equal(result.ok, false);
    assert.equal(blocks[0]?.code, LUSHA_REQUEST_FENCE_CAPABILITY_ABSENT_CODE);
    assert.ok(result.warnings.includes(LUSHA_FENCE_BLOCKED_WARNING));
    assert.equal(result.providerOutcome?.providerRequestDispatched, false);
  });

  it('sin coordenadas de petición se falla CERRADO: 0 llamadas HTTP', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const { runSearch, blocks } = makeRunSearch(table);

    const result = await withFetch(fetchDouble.fn, () => runSearch(PREVIEW_INPUT));

    assert.equal(fetchDouble.calls.length, 0);
    assert.equal(result.ok, false);
    assert.equal(blocks[0]?.code, LUSHA_FENCE_MISSING_COORDINATES_CODE);
    assert.equal(table.rows.size, 0, 'no se fabrica fila para una petición sin identidad');
  });

  it('la valla escribe ANTES del envío: al llegar el fetch la fila ya es dispatch_unsafe', async () => {
    const table = createFenceTable();
    const observed: (string | undefined)[] = [];
    const fetchDouble = {
      calls: [] as string[],
      fn: async (input: RequestInfo | URL) => {
        fetchDouble.calls.push(String(input));
        // 🔴 El orden que el corte compra: cuando el primer byte puede salir, la
        // fila durable YA dice que puede haber salido.
        observed.push(table.rows.get(KEY_B0_P0)?.state);
        return {
          ok: true,
          status: 200,
          headers: headersOf({}),
          text: async () => JSON.stringify(SUCCESS_BODY),
          json: async () => SUCCESS_BODY,
        } as unknown as Response;
      },
    };
    const { runSearch } = makeRunSearch(table);
    await withFetch(fetchDouble.fn as unknown as typeof globalThis.fetch, () =>
      runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );

    assert.equal(fetchDouble.calls.length, 1);
    assert.deepEqual(observed, ['dispatch_unsafe']);
    assert.equal(table.dispatchMarks, 1);
  });
});

describe('CUT-L3 · L3-B / L3-C — reclamo y concurrencia (§ 8)', () => {
  it('L3-B — el primer reclamo autoriza UNA ejecución', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const { runSearch } = makeRunSearch(table);
    const result = await withFetch(fetchDouble.fn, () => runSearch(PREVIEW_INPUT, COORD_B0_P0));
    assert.equal(fetchDouble.calls.length, 1);
    assert.equal(result.ok, true);
    assert.equal(table.claimsGranted, 1);
  });

  it('L3-C — dos trabajadores sobre la MISMA petición ⇒ 1 sola llamada HTTP', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    // Dos «procesos» distintos, cada uno con su store, contra la misma tabla.
    const a = makeRunSearch(table);
    const b = makeRunSearch(table);

    const [ra, rb] = await withFetch(fetchDouble.fn, () =>
      Promise.all([
        a.runSearch(PREVIEW_INPUT, COORD_B0_P0),
        b.runSearch(PREVIEW_INPUT, COORD_B0_P0),
      ]),
    );

    assert.equal(fetchDouble.calls.length, 1, 'el duplicado NO puede pedir al proveedor');
    assert.equal(table.claimsGranted, 1);
    const okCount = [ra, rb].filter((r) => r.ok).length;
    assert.equal(okCount, 1);
    const blocked = [...a.blocks, ...b.blocks];
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0]?.reason, 'already_fenced');
  });
});

describe('CUT-L3 · L3-D — caída dura DESPUÉS de la frontera (§ 7, § 9-B)', () => {
  it('al reanudar NO se repite la petición y el estado queda indeterminado', async () => {
    const table = createFenceTable();
    // Proceso 1: cruza la frontera y MUERE — la liquidación nunca llega.
    table.settleDisabled = true;
    const crashingFetch = countingFetch({
      status: 200,
      body: SUCCESS_BODY,
      throws: new Error('proceso terminado'),
    });
    const first = makeRunSearch(table);
    await withFetch(crashingFetch.fn, () => first.runSearch(PREVIEW_INPUT, COORD_B0_P0));

    assert.equal(crashingFetch.calls.length, 1);
    assert.equal(
      table.rows.get(KEY_B0_P0)?.state,
      'dispatch_unsafe',
      'la frontera dejó testigo aunque el proceso muriera',
    );

    // Proceso 2: arranca de nuevo contra la MISMA tabla durable.
    table.settleDisabled = false;
    const resumeFetch = countingFetch({ status: 200, body: SUCCESS_BODY });
    const second = makeRunSearch(table);
    const result = await withFetch(resumeFetch.fn, () =>
      second.runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );

    assert.equal(resumeFetch.calls.length, 0, 'CERO llamadas tras reanudar');
    assert.equal(result.ok, false);
    assert.equal(second.blocks[0]?.state, 'dispatch_unsafe');
    assert.equal(
      table.rows.get(KEY_B0_P0)?.state,
      'dispatch_unsafe',
      'el bloqueo NO reescribe el estado del dueño de la fila',
    );
  });
});

describe('CUT-L3 · L3-E / L3-F / L3-O — desenlaces INDETERMINADOS (§ 11)', () => {
  const indeterminateCases = [
    {
      name: 'L3-E — timeout después del despacho',
      fetchOpts: { status: 0, throws: Object.assign(new Error('abort'), { name: 'AbortError' }) },
    },
    {
      name: 'L3-F — 499 literal',
      fetchOpts: { status: 499 },
    },
    {
      name: 'L3-O — 2xx con cuerpo ilegible',
      fetchOpts: { status: 200, bodyText: '[]' },
    },
  ];

  for (const testCase of indeterminateCases) {
    it(`${testCase.name} ⇒ indeterminate, y al reanudar 0 llamadas`, async () => {
      const table = createFenceTable();
      const first = countingFetch(testCase.fetchOpts as Parameters<typeof countingFetch>[0]);
      const runner = makeRunSearch(table);
      await withFetch(first.fn, () => runner.runSearch(PREVIEW_INPUT, COORD_B0_P0));

      assert.equal(first.calls.length, 1);
      const row = table.rows.get(KEY_B0_P0);
      assert.equal(row?.state, 'indeterminate');
      assert.equal(row?.settlement?.billingCertainty, 'potentially_charged');
      assert.equal(row?.settlement?.retryContract, 'do_not_automatically_retry');

      const resume = countingFetch({ status: 200, body: SUCCESS_BODY });
      const second = makeRunSearch(table);
      await withFetch(resume.fn, () => second.runSearch(PREVIEW_INPUT, COORD_B0_P0));
      assert.equal(resume.calls.length, 0, 'un indeterminado NUNCA se repite solo');
    });
  }
});

describe('CUT-L3 · L3-G / L3-H — 0 créditos por contrato, 0 reintentos aquí (§ 17)', () => {
  for (const status of [429, 500, 503] as const) {
    it(`HTTP ${status} ⇒ definitely_not_charged + retryable_by_contract, y 0 reintentos`, async () => {
      const table = createFenceTable();
      const fetchDouble = countingFetch({ status, bodyText: 'error' });
      const runner = makeRunSearch(table);
      await withFetch(fetchDouble.fn, () => runner.runSearch(PREVIEW_INPUT, COORD_B0_P0));

      assert.equal(fetchDouble.calls.length, 1, 'exactamente UNA petición: CUT-L3 no reintenta');
      const row = table.rows.get(KEY_B0_P0);
      assert.equal(row?.state, 'definitely_not_charged');
      assert.equal(row?.settlement?.billingCertainty, 'definitely_not_charged');
      assert.equal(row?.settlement?.retryContract, 'retryable_by_contract');

      // Y al reanudar tampoco: la elegibilidad de reintento es CUT-L4.
      const resume = countingFetch({ status: 200, body: SUCCESS_BODY });
      const second = makeRunSearch(table);
      await withFetch(resume.fn, () => second.runSearch(PREVIEW_INPUT, COORD_B0_P0));
      assert.equal(resume.calls.length, 0);
    });
  }

  it('un 4xx genérico sale `unknown`, nunca hereda la garantía del 429', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 403, bodyText: 'forbidden' });
    const runner = makeRunSearch(table);
    await withFetch(fetchDouble.fn, () => runner.runSearch(PREVIEW_INPUT, COORD_B0_P0));
    const row = table.rows.get(KEY_B0_P0);
    assert.equal(row?.state, 'unknown');
    assert.equal(row?.settlement?.billingCertainty, 'unknown');
  });
});

describe('CUT-L3 · L3-I / L3-J — éxito y reinicio tras éxito', () => {
  it('L3-I — exactamente una llamada, con evidencia terminal correcta', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({
      status: 200,
      body: SUCCESS_BODY,
      headers: {
        'x-request-id': 'lusha-trace-abc',
        'x-rate-limit-minute': '60',
        'x-minute-requests-left': '59',
        'x-rate-limit-daily': '1000',
        'x-daily-requests-left': '999',
      },
    });
    const runner = makeRunSearch(table);
    const result = await withFetch(fetchDouble.fn, () =>
      runner.runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );

    assert.equal(fetchDouble.calls.length, 1);
    assert.equal(result.ok, true);
    const row = table.rows.get(KEY_B0_P0);
    assert.equal(row?.state, 'succeeded');
    assert.equal(row?.settlement?.creditsCharged, 1);
    assert.equal(row?.settlement?.billingCertainty, 'settled_from_provider');
    // § 12 — el `x-request-id` se PERSISTE como traza…
    assert.equal(row?.settlement?.providerRequestId, 'lusha-trace-abc');
    // …y NO es la clave de la valla.
    assert.doesNotMatch(KEY_B0_P0, /lusha-trace-abc/);
    // § 13 — la cuota viaja si estaba, sin ampliar el alcance del corte.
    assert.equal(row?.settlement?.rateLimit?.minuteRemaining, 59);
    assert.equal(row?.settlement?.rateLimit?.dailyLimit, 1000);
  });

  it('L3-J — reinicio tras éxito ⇒ 0 llamadas al proveedor', async () => {
    const table = createFenceTable();
    const first = countingFetch({ status: 200, body: SUCCESS_BODY });
    await withFetch(first.fn, () => makeRunSearch(table).runSearch(PREVIEW_INPUT, COORD_B0_P0));
    assert.equal(first.calls.length, 1);

    const resume = countingFetch({ status: 200, body: SUCCESS_BODY });
    const second = makeRunSearch(table);
    const result = await withFetch(resume.fn, () =>
      second.runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );
    assert.equal(resume.calls.length, 0, 'repetir una búsqueda que salió bien es pagarla dos veces');
    assert.equal(result.ok, false);
    assert.equal(second.blocks[0]?.state, 'succeeded');
    assert.equal(table.rows.get(KEY_B0_P0)?.state, 'succeeded');
  });
});

describe('CUT-L3 · L3-K — `already_reserved` ya NO puede replayar (§ 15)', () => {
  it('la reserva de corrida sigue invocando run(), y la valla detiene el proveedor', async () => {
    const table = createFenceTable();

    // Corrida 1: reserva concedida, petición ejecutada y liquidada.
    const first = countingFetch({ status: 200, body: SUCCESS_BODY });
    await withFetch(first.fn, () =>
      guardLushaRunBudget<{ blocked: boolean }>(
        async () => ({
          status: 'reserved' as const,
          reservationId: RESERVATION_ID,
          creditsReserved: 2,
        }),
        () => ({ blocked: true }),
        async () => {
          await makeRunSearch(table).runSearch(PREVIEW_INPUT, COORD_B0_P0);
          return { blocked: false };
        },
        2,
      ),
    );
    assert.equal(first.calls.length, 1);

    // Corrida 2: MISMO `client_request_id` ⇒ la RPC responde `already_reserved`.
    const replay = countingFetch({ status: 200, body: SUCCESS_BODY });
    const second = makeRunSearch(table);
    let runInvoked = false;
    await withFetch(replay.fn, () =>
      guardLushaRunBudget<{ blocked: boolean }>(
        async () => ({
          status: 'already_reserved' as const,
          reservationId: RESERVATION_ID,
          creditsReserved: 2,
        }),
        () => ({ blocked: true }),
        async () => {
          runInvoked = true;
          await second.runSearch(PREVIEW_INPUT, COORD_B0_P0);
          return { blocked: false };
        },
        2,
      ),
    );

    // 🔴 La costura EXACTA de la auditoría: la reserva SIGUE autorizando `run()`
    // —eso no cambia en este corte— y aun así el proveedor no se toca.
    assert.equal(runInvoked, true, 'la reserva sigue invocando run() con already_reserved');
    assert.equal(replay.calls.length, 0, 'la valla de PETICIÓN es la que detiene el replay');
    assert.equal(second.blocks[0]?.reason, 'already_fenced');
  });
});

describe('CUT-L3 · L3-L / L3-M — otra página y otra rama son peticiones DISTINTAS', () => {
  it('L3-L — la página 1 no hereda la valla de la página 0', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const runner = makeRunSearch(table);
    await withFetch(fetchDouble.fn, async () => {
      await runner.runSearch({ ...PREVIEW_INPUT, page: 0 }, { branchIndex: 0, page: 0 });
      await runner.runSearch({ ...PREVIEW_INPUT, page: 1 }, { branchIndex: 0, page: 1 });
    });
    assert.equal(fetchDouble.calls.length, 2, 'dos páginas son dos peticiones legítimas');
    assert.equal(table.rows.size, 2);
    assert.equal(runner.blocks.length, 0);
  });

  it('L3-M — la rama 1 no hereda la valla de la rama 0 en la misma página', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const runner = makeRunSearch(table);
    await withFetch(fetchDouble.fn, async () => {
      await runner.runSearch(PREVIEW_INPUT, { branchIndex: 0, page: 0 });
      await runner.runSearch(PREVIEW_INPUT, { branchIndex: 1, page: 0 });
    });
    assert.equal(fetchDouble.calls.length, 2);
    assert.equal(table.rows.size, 2);
    assert.equal(runner.blocks.length, 0);
  });
});

describe('CUT-L3 · L3-N — rechazo local previo al envío (§ 21)', () => {
  it('sin credencial: 0 llamadas, y la fila NO dice «pudo salir»', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const runner = makeRunSearch(table, { apiKey: null });

    const result = await withFetch(fetchDouble.fn, () =>
      runner.runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );

    assert.equal(fetchDouble.calls.length, 0);
    assert.equal(result.ok, false);
    const row = table.rows.get(KEY_B0_P0);
    assert.equal(row?.dispatched, false, 'la frontera NUNCA se marcó');
    assert.equal(row?.state, 'definitely_not_charged');
    assert.equal(table.dispatchMarks, 0);
  });

  it('industria no soportada: mismo trato, y no se fabrica estado de despacho', async () => {
    const table = createFenceTable();
    const fetchDouble = countingFetch({ status: 200, body: SUCCESS_BODY });
    const runner = makeRunSearch(table);
    await withFetch(fetchDouble.fn, () =>
      runner.runSearch(
        { ...PREVIEW_INPUT, macroIndustryKey: 'sector_que_no_existe' },
        COORD_B0_P0,
      ),
    );
    assert.equal(fetchDouble.calls.length, 0);
    assert.equal(table.dispatchMarks, 0);
    assert.equal(table.rows.get(KEY_B0_P0)?.state, 'definitely_not_charged');
  });
});

describe('CUT-L3 · el ejecutor puro no puede saltarse el orden', () => {
  it('si `beforeDispatch` no se invoca y el trabajo LANZA, se liquida sin cargo', async () => {
    const table = createFenceTable();
    const store = createFenceStoreOn(table);
    await assert.rejects(
      runFencedLushaProspectingRequest<never>({
        store,
        identity: { operationId: OPERATION_ID, branchIndex: 0, page: 0 },
        context: {
          triggeredByUserId: USER_ID,
          reservationId: RESERVATION_ID,
          clientRequestId: CLIENT_REQUEST_ID,
        },
        run: async () => {
          throw new Error('boom');
        },
        settlementFrom: () => null,
      }),
    );
    const row = table.rows.get(KEY_B0_P0);
    assert.equal(row?.state, 'definitely_not_charged');
    assert.equal(table.dispatchMarks, 0);
  });

  it('si `beforeDispatch` SÍ se invocó y el trabajo LANZA, se liquida INDETERMINADO', async () => {
    const table = createFenceTable();
    const store = createFenceStoreOn(table);
    await assert.rejects(
      runFencedLushaProspectingRequest<never>({
        store,
        identity: { operationId: OPERATION_ID, branchIndex: 0, page: 0 },
        context: {
          triggeredByUserId: USER_ID,
          reservationId: RESERVATION_ID,
          clientRequestId: CLIENT_REQUEST_ID,
        },
        run: async (beforeDispatch) => {
          await beforeDispatch();
          throw new Error('boom');
        },
        settlementFrom: () => null,
      }),
    );
    const row = table.rows.get(KEY_B0_P0);
    assert.equal(row?.state, 'indeterminate');
    assert.equal(row?.settlement?.billingCertainty, 'potentially_charged');
  });
});

// ── Guardas estáticas: el ORDEN y el ALCANCE ─────────────────────────────────

describe('CUT-L3 · guardas estáticas de orden y alcance', () => {
  const client = read('src/server/integrations/lusha-client.ts');

  it('la valla se espera ANTES del `fetch()` de Prospecting, no después', () => {
    const marker = 'await input.beforeDispatch();';
    const fetchCall = "const response = await fetch(`${LUSHA_BASE_URL}/v3/companies/prospecting`";
    const markerAt = client.indexOf(marker);
    const fetchAt = client.indexOf(fetchCall);
    assert.notEqual(markerAt, -1, 'el cliente debe esperar la valla durable');
    assert.notEqual(fetchAt, -1);
    assert.ok(markerAt < fetchAt, 'persistir → COMMIT → fetch, en ese orden');
    // Y no hay un segundo `fetch` de Prospecting que la esquive. Se cuenta sobre
    // el CÓDIGO, sin comentarios: la documentación del módulo nombra el endpoint
    // varias veces, y nombrarlo no es llamarlo.
    const clientCode = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(
      clientCode.split('/v3/companies/prospecting`').length - 1,
      1,
      'una sola llamada al endpoint de Prospecting en todo el cliente',
    );
  });

  it('la valla de Lusha no depende de la de Apollo: dos contratos, dos proveedores', () => {
    // Agente 1 ya tiene `apollo-two-round/page-fence.ts`. Compartir código habría
    // propagado a Lusha una semántica de facturación que su contrato humano no
    // concede (Apollo clasifica sus 4xx genéricos como `not_charged`; para Lusha
    // nadie lo confirmó salvo el 429). Se comparte el CRITERIO, no la tabla.
    for (const rel of [
      'src/server/prospect-batches/lusha-request-fence.ts',
      'src/server/prospect-batches/lusha-request-fence-store.ts',
      'src/server/prospect-batches/lusha-fenced-prospecting-search.ts',
    ]) {
      assert.doesNotMatch(read(rel).replace(/\/\*[\s\S]*?\*\//g, ''), /apollo/i, rel);
    }
    // Y a la inversa: la valla de Apollo no aprende nada de Lusha.
    assert.doesNotMatch(
      read('src/server/agents/prospecting-toolkit/apollo-two-round/page-fence.ts'),
      /lusha_prospecting_request_fence/i,
    );
  });

  it('CUT-L3 no añade motor de reintentos (§ 17)', () => {
    const fence = read('src/server/prospect-batches/lusha-request-fence.ts');
    const composition = read('src/server/prospect-batches/lusha-fenced-prospecting-search.ts');
    for (const src of [fence, composition]) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(code, /setTimeout|backoff|maxAttempts|retryCount|for\s*\(\s*let\s+attempt/i);
    }
  });

  it('la ruta de preview ya NO puede ejecutar Prospecting pagado (§ 16)', () => {
    const preview = read('src/modules/prospect-batches/lusha-preview-actions.ts');
    const code = preview.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /searchLushaCompaniesV3\s*\(/);
    assert.match(code, /rejectUnfencedLushaProspecting/);
  });

  it('economía intacta (§ 18): página, tope de páginas y techo de créditos', () => {
    const limits = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    const preview = read('src/server/prospect-batches/lusha-preview.ts');
    assert.match(limits, /LUSHA_PENDING_REVIEW_MAX_PAGES\s*=\s*\d+/);
    assert.match(preview, /LUSHA_PREVIEW_EXPECTED_MAX_CREDITS\s*=\s*1\s+as\s+const/);
  });

  it('la migración 135 existe, no se aplica en remoto y no guarda payload de proveedor', () => {
    const sql = read('supabase/migrations/135_agent1_lusha_prospecting_request_fence.sql');
    // 🔴 Contar sobre el archivo CRUDO confunde «nombrarlo» con «declararlo»: la
    // migración explica en prosa por qué fija `search_path`, y esa frase inflaba el
    // conteo. Se cuenta sobre el SQL sin comentarios de línea.
    const ddl = sql.replace(/^\s*--.*$/gm, '');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.lusha_prospecting_request_fence/);
    assert.match(sql, /fence_key\s+text\s+PRIMARY KEY/);
    // Las CINCO RPC, todas con `search_path` fijado.
    //
    // 🔴 Eran tres. Las dos nuevas son las de la OPERACIÓN lógica durable, y su
    // postura de seguridad tiene que ser la MISMA que la de la valla: quien pudiera
    // acuñar o cerrar operaciones a mano podría desbloquearse el gasto.
    for (const fn of [
      'claim_or_resume_lusha_prospecting_operation',
      'complete_lusha_prospecting_operation',
      'claim_lusha_prospecting_request',
      'mark_lusha_prospecting_request_dispatched',
      'settle_lusha_prospecting_request',
    ]) {
      assert.ok(sql.includes(`public.${fn}`), `falta la RPC ${fn}`);
    }
    assert.equal(
      ddl.split('SET search_path = pg_catalog, public, pg_temp').length - 1,
      5,
      'las cinco funciones fijan search_path',
    );
    assert.equal(
      ddl.split('SECURITY DEFINER').length - 1,
      5,
      'las cinco funciones son SECURITY DEFINER',
    );
    // Ni `anon` ni `authenticated` pueden tocar la valla.
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.lusha_prospecting_request_fence\s*\n\s*TO service_role;/);
    // La tabla de operaciones tiene la MISMA postura: sin DELETE ni TRUNCATE, ni
    // siquiera para `service_role`. Una identidad económica que el runtime puede
    // borrar no es una identidad.
    assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.lusha_prospecting_operations\s*\n\s*TO service_role;/);
    assert.doesNotMatch(sql, /GRANT[^\n]*TO (anon|authenticated)/);
    assert.doesNotMatch(sql, /GRANT[^\n]*DELETE[^\n]*lusha_prospecting/);
    // Sin columnas de payload del proveedor.
    for (const forbidden of ['company_name', 'raw_response', 'api_key', 'response_body']) {
      assert.equal(sql.includes(forbidden), false, `la valla no puede guardar ${forbidden}`);
    }
  });
});
