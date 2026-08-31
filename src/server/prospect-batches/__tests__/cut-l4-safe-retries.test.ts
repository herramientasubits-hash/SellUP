/**
 * AGENT1-LUSHA-CUT-L4-SAFE-RETRIES § 39 — la suite dedicada del corte.
 *
 * ── Qué se prueba, dicho como defecto ────────────────────────────────────────
 *
 * CUT-L2 obtuvo del soporte HUMANO de Lusha que `429` y `5xx` devuelven CERO
 * créditos, y lo dejó anotado como contrato del proveedor sin ejecutarlo. CUT-L3
 * puso la valla durable y fue explícito: CUALQUIER fila de valla existente
 * bloquea la re-ejecución. El resultado es que hoy una limitación de tasa
 * —recuperable, gratuita y esperable en una API con cuota por minuto— tira la
 * corrida entera.
 *
 * CUT-L4 abre exactamente UNA puerta, y cada caso de aquí es una forma concreta
 * de abrirla de más:
 *
 *   L4-A  429 → éxito         2 llamadas, créditos = los del éxito
 *   L4-B  503 → éxito         igual
 *   L4-C  429 → 429           2 llamadas, 0 créditos, NO hay intento 3
 *   L4-D  503 → 503           igual
 *   L4-E  429 → 503           igual
 *   L4-F  503 → 429           igual
 *   L4-G  499                 1 llamada. Pudo cobrarse.
 *   L4-H  timeout post-envío  1 llamada
 *   L4-I  conexión caída      1 llamada
 *   L4-J  400 genérico        1 llamada
 *   L4-K  2xx ilegible        1 llamada
 *   L4-L  rechazo local       0 llamadas, y NINGÚN intento 2 automático
 *   L4-M  éxito al primero    1 llamada, y NO hay intento 2
 *   L4-N  503 → timeout       2 llamadas, final indeterminado, NO hay 3
 *   L4-O  429 → 499           igual
 *   L4-P  la marca del 2 falla ⇒ segunda llamada = 0
 *   L4-Q  dos reclamos concurrentes del intento 2 ⇒ 1 fila, 1 llamada
 *   L4-R  caída tras marcar el intento 2 ⇒ no hay intento 3
 *   L4-T  clientRequestId cambia ⇒ la identidad NO cambia
 *   L4-U  candidatos tras reintento exitoso: EXACTAMENTE una vez
 *   L4-V  provider-seen tras reintento exitoso: EXACTAMENTE una vez
 *   L4-W  503 + éxito(1) ⇒ créditos totales = 1
 *   L4-X  429 + 429       ⇒ créditos totales = 0
 *
 * ── 🔴 Lo que esta suite NO afirma ──────────────────────────────────────────
 *
 * No afirma que Lusha sea seguro de activar. No afirma que `dispatch_unsafe`
 * signifique que Lusha recibió la petición —significa que SellUp ya no puede
 * probar que no—. Y no afirma que un reintento recupere nada: recuperar es
 * posible, y cuando no lo es, el corte se limita a no haber cobrado de más.
 *
 * Sin red, sin Supabase, sin Lusha real, sin un solo crédito. `global.fetch` va
 * doblado y se CUENTA — que el conteo sea la aserción es deliberado: es el único
 * hecho que corresponde uno a uno con un cargo. La espera va doblada a cero: una
 * suite que durmiera un segundo por caso acabaría fuera del check obligatorio.
 *
 * MIGRACIÓN 136: APLICADA EN PRODUCCIÓN = NO.
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
import type { LushaPreviewInput, LushaPreviewResult } from '@/server/prospect-batches/lusha-preview';
import {
  buildLushaRequestFenceKey,
  mayReExecuteLushaFencedRequest,
  runFencedLushaProspectingRequest,
  type LushaRequestFenceSettlement,
} from '@/server/prospect-batches/lusha-request-fence';
import { createFencedLushaRunSearch } from '@/server/prospect-batches/lusha-fenced-prospecting-search';
import {
  decideLushaSafeRetry,
  LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST,
  LUSHA_SAFE_RETRY_INITIAL_DELAY_MS,
  LUSHA_SAFE_RETRY_OUTCOME_CLASSES,
  lushaNoopRetrySleep,
} from '@/server/prospect-batches/lusha-safe-retry-policy';
import { classifyLushaProspectingOutcome } from '@/server/integrations/lusha-prospecting-failure-taxonomy';
import {
  createFenceStoreOn,
  createFenceTable,
  readAttempts,
  readFenceRow,
  type FenceTable,
} from './support/lusha-request-fence-table';

// ── Andamiaje ─────────────────────────────────────────────────────────────────

const CLIENT_REQUEST_ID = '11111111-2222-3333-4444-555555555555';
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

const COORD_B0_P0 = { branchIndex: 0, page: 0 };
const KEY_B0_P0 = buildLushaRequestFenceKey({
  operationId: OPERATION_ID,
  branchIndex: 0,
  page: 0,
});

type HeaderMap = Record<string, string>;

function headersOf(map: HeaderMap) {
  const lower: HeaderMap = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/** Un desenlace HTTP del doble, por INTENTO. */
type FetchStep = {
  status?: number;
  body?: unknown;
  bodyText?: string;
  headers?: HeaderMap;
  throws?: Error;
};

/**
 * `fetch` doblado y SECUENCIADO: un desenlace por intento, en orden.
 *
 * 🔴 Que sea una secuencia y no una respuesta fija es lo que hace comprobable el
 * corte entero. Con una respuesta fija, «429 y luego éxito» no se puede escribir,
 * y sin poder escribirlo la afirmación «el reintento recupera» sería prosa.
 *
 * 🔴 Y el doble se queda SIN pasos a propósito en vez de repetir el último: si un
 * tercer intento llegara a ocurrir, esta suite tiene que FALLAR ruidosamente, no
 * absorberlo.
 */
function sequencedFetch(steps: FetchStep[]) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL) => {
    const step = steps[calls.length];
    calls.push(String(input));
    if (!step) {
      throw new Error(
        `intento HTTP nº ${calls.length} inesperado: el corte permite como máximo ${LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST}`,
      );
    }
    if (step.throws) throw step.throws;
    const status = step.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: headersOf(step.headers ?? {}),
      text: async () => step.bodyText ?? JSON.stringify(step.body ?? {}),
      json: async () => {
        if (step.bodyText !== undefined) return JSON.parse(step.bodyText);
        return step.body ?? {};
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

/** Espera doblada a CERO, y CONTADA: el retardo se afirma, no se sufre. */
function countingSleep() {
  const waits: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  return { sleep, waits };
}

/** El `runSearch` REAL del corte, conectado al cliente REAL de Lusha. */
function makeRunSearch(
  table: FenceTable,
  opts?: { apiKey?: string | null; sleep?: (ms: number) => Promise<void> },
) {
  const retries: { attemptNo: number; outcomeClass: string | null }[] = [];
  const refusals: string[] = [];
  const runSearch = createFencedLushaRunSearch({
    store: createFenceStoreOn(table),
    operationId: OPERATION_ID,
    context: {
      triggeredByUserId: USER_ID,
      reservationId: RESERVATION_ID,
      clientRequestId: CLIENT_REQUEST_ID,
    },
    resolveApiKey: async () =>
      opts && 'apiKey' in opts ? (opts.apiKey ?? null) : 'test-key-not-real',
    searchCompanies: (
      apiKey: string,
      request: LushaCompanyProspectingV3Request,
      beforeDispatch: () => Promise<void>,
    ) => searchLushaCompaniesV3({ apiKey, timeoutMs: TIMEOUT_MS, request, beforeDispatch }),
    sleep: opts?.sleep ?? lushaNoopRetrySleep,
    onRetry: (e) => retries.push({ attemptNo: e.attemptNo, outcomeClass: e.outcomeClass }),
    onRetryRefused: (e) => refusals.push(e.code),
  });
  return { runSearch, retries, refusals };
}

const SUCCESS_BODY = {
  results: [{ id: 'lusha-1', name: 'Acme', domain: 'acme.com' }],
  billing: { creditsCharged: 1 },
};

/**
 * Escenario canónico: UNA petición lógica, la secuencia de desenlaces dada.
 *
 * Devuelve el resultado FINAL —lo único que el ejecutor de páginas ve— junto con
 * el conteo de llamadas HTTP y el historial durable de intentos.
 */
async function runScenario(steps: FetchStep[], opts?: { sleep?: (ms: number) => Promise<void> }) {
  const table = createFenceTable();
  const { runSearch, retries, refusals } = makeRunSearch(table, { sleep: opts?.sleep });
  const { fn, calls } = sequencedFetch(steps);
  const result = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
    runSearch(PREVIEW_INPUT, COORD_B0_P0),
  );
  return {
    result,
    httpCalls: calls.length,
    attempts: readAttempts(table, KEY_B0_P0),
    row: readFenceRow(table, KEY_B0_P0),
    table,
    retries,
    refusals,
  };
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * 🔴 Las guardas estáticas de abajo leen CÓDIGO, no prosa.
 *
 * Este repo ya se quemó con esto: una guarda que grepea el archivo crudo confunde
 * NOMBRAR una cosa con HACERLA. Esta migración explica en un comentario que «no
 * concede DELETE ni TRUNCATE a nadie», y una guarda ingenua leería ese comentario
 * como la infracción que el comentario promete no cometer.
 *
 * Se quitan los comentarios ANTES de mirar. Lo que queda es lo que la base ejecuta.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function stripTsComments(ts: string): string {
  return ts
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * Créditos que UN intento aporta a la corrida, según su evidencia durable.
 *
 * 🔴 Se calcula aquí, en la suite, y no en producción, y eso es deliberado: la
 * cifra que producción usa sigue siendo la del resultado FINAL de la página, sin
 * tocar. Lo que esta función permite afirmar es la propiedad económica del corte
 * —429 y 5xx aportan 0— sin cambiar cómo se liquida la reserva, que es alcance de
 * CUT-L5.
 */
function attemptCredits(settlement: LushaRequestFenceSettlement | null): number {
  if (settlement === null) return 0;
  if (settlement.billingCertainty === 'definitely_not_charged') return 0;
  return typeof settlement.creditsCharged === 'number' ? settlement.creditsCharged : 0;
}

const totalAttemptCredits = (attempts: { settlement: LushaRequestFenceSettlement | null }[]) =>
  attempts.reduce((sum, a) => sum + attemptCredits(a.settlement), 0);

// ─────────────────────────────────────────────────────────────────────────────

describe('CUT-L4 · la política, antes que el motor (§ 2, § 3, § 4)', () => {
  it('el techo es DOS intentos: el original y UNO más', () => {
    assert.equal(LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST, 2);
  });

  it('el retardo inicial es 1000 ms, como recomienda la guía de Lusha para 429/5xx', () => {
    assert.equal(LUSHA_SAFE_RETRY_INITIAL_DELAY_MS, 1000);
  });

  it('sólo 429 y 5xx son reintentables — la lista es EXHAUSTIVA', () => {
    assert.deepEqual([...LUSHA_SAFE_RETRY_OUTCOME_CLASSES].sort(), [
      'http_429_rate_limited',
      'http_5xx_provider_failure',
    ]);
  });

  it('la política CONSUME la taxonomía de CUT-L2 en vez de releer el status', () => {
    // El 429 canónico, tal y como CUT-L2 lo emite.
    const outcome = classifyLushaProspectingOutcome({ httpStatus: 429, requestDispatched: true });
    const decision = decideLushaSafeRetry({
      attemptNo: 1,
      state: 'definitely_not_charged',
      outcomeClass: outcome.outcomeClass,
      billingCertainty: outcome.billingCertainty,
      retryContract: outcome.retryContract,
    });
    assert.deepEqual(decision, { allowed: true, nextAttemptNo: 2 });
  });

  it('los seis desenlaces NO probados a cero NO autorizan reintento (§ 15)', () => {
    const notFree: { status: number | null; timedOut?: boolean; malformedBody?: boolean }[] = [
      { status: 499 },
      { status: null, timedOut: true },
      { status: null },
      { status: 400 },
      { status: 403 },
      { status: 200, malformedBody: true },
    ];
    for (const c of notFree) {
      const outcome = classifyLushaProspectingOutcome({
        httpStatus: c.status,
        requestDispatched: true,
        timedOut: c.timedOut,
        malformedBody: c.malformedBody,
      });
      const decision = decideLushaSafeRetry({
        attemptNo: 1,
        // El estado terminal que la valla derivaría de ese desenlace.
        state:
          outcome.billingCertainty === 'definitely_not_charged'
            ? 'definitely_not_charged'
            : 'indeterminate',
        outcomeClass: outcome.outcomeClass,
        billingCertainty: outcome.billingCertainty,
        retryContract: outcome.retryContract,
      });
      assert.equal(decision.allowed, false, `${outcome.outcomeClass} NO puede autorizar`);
    }
  });

  it('L4-L — el rechazo local previo al envío es gratis y AUN ASÍ no se reintenta', () => {
    const outcome = classifyLushaProspectingOutcome({ httpStatus: null, requestDispatched: false });
    // Es verdad que no costó nada…
    assert.equal(outcome.billingCertainty, 'definitely_not_charged');
    assert.equal(outcome.retryContract, 'safe_to_retry_not_dispatched');
    // …y aun así CUT-L4 no lo reintenta: su alcance es lo que el PROVEEDOR
    // confirmó gratis, y un rechazo local es un fallo de SellUp que repetirlo un
    // segundo después volvería a producir.
    const decision = decideLushaSafeRetry({
      attemptNo: 1,
      state: 'definitely_not_charged',
      outcomeClass: outcome.outcomeClass,
      billingCertainty: outcome.billingCertainty,
      retryContract: outcome.retryContract,
    });
    assert.equal(decision.allowed, false);
  });

  it('un intento 2 ya consumido no autoriza un intento 3', () => {
    const decision = decideLushaSafeRetry({
      attemptNo: 2,
      state: 'definitely_not_charged',
      outcomeClass: 'http_429_rate_limited',
      billingCertainty: 'definitely_not_charged',
      retryContract: 'retryable_by_contract',
    });
    assert.deepEqual(decision, { allowed: false, reason: 'attempts_exhausted' });
  });

  it('🔴 `mayReExecuteLushaFencedRequest` SIGUE devolviendo false (§ 6)', () => {
    // El reintento NO se consiguió ablandando la valla de CUT-L3. Si esto cambia,
    // cualquier fila existente —incluida la que quedó `dispatch_unsafe` tras una
    // caída, que es la que pudo pagarse— volvería a ser replayable.
    assert.equal(mayReExecuteLushaFencedRequest(), false);
  });
});

describe('CUT-L4 · el reintento que SÍ ocurre (§ 20, § 21)', () => {
  it('L4-A — 429 → éxito: DOS llamadas, y los créditos son los del éxito', async () => {
    const s = await runScenario([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.result.ok, true);
    assert.equal(s.result.billing.creditsCharged, 1);
    assert.equal(s.attempts.length, 2);
    assert.equal(s.attempts[0]!.state, 'definitely_not_charged');
    assert.equal(s.attempts[1]!.state, 'succeeded');
    // El 429 aportó CERO. El éxito aportó su importe. Total: 1, no 2.
    assert.equal(totalAttemptCredits(s.attempts), 1);
    assert.deepEqual(s.retries, [{ attemptNo: 2, outcomeClass: 'http_429_rate_limited' }]);
  });

  it('L4-B — 503 → éxito: DOS llamadas, un crédito', async () => {
    const s = await runScenario([{ status: 503 }, { status: 200, body: SUCCESS_BODY }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.result.ok, true);
    assert.equal(s.attempts[0]!.settlement?.outcomeClass, 'http_5xx_provider_failure');
    assert.equal(s.attempts[1]!.state, 'succeeded');
    assert.equal(totalAttemptCredits(s.attempts), 1);
  });

  it('L4-C — 429 → 429: DOS llamadas, CERO créditos, y NO hay intento 3', async () => {
    const s = await runScenario([{ status: 429 }, { status: 429 }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.result.ok, false);
    assert.equal(s.attempts.length, 2);
    for (const a of s.attempts) {
      assert.equal(a.state, 'definitely_not_charged');
      assert.equal(a.settlement?.billingCertainty, 'definitely_not_charged');
    }
    assert.equal(totalAttemptCredits(s.attempts), 0);
    // 🔴 Y NO se inventan créditos: el proveedor no reportó importe y el contrato
    // humano dice cero. Ni `null` publicado como cargo, ni un 1 conservador.
    assert.equal(s.result.billing.creditsCharged, null);
  });

  it('L4-D — 503 → 503: igual', async () => {
    const s = await runScenario([{ status: 503 }, { status: 500 }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts.length, 2);
    assert.equal(totalAttemptCredits(s.attempts), 0);
  });

  it('L4-E — 429 → 5xx: dos intentos, ninguno cobrado, sin tercero', async () => {
    const s = await runScenario([{ status: 429 }, { status: 502 }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts.length, 2);
    assert.equal(s.attempts[1]!.settlement?.outcomeClass, 'http_5xx_provider_failure');
    assert.equal(totalAttemptCredits(s.attempts), 0);
  });

  it('L4-F — 5xx → 429: idem', async () => {
    const s = await runScenario([{ status: 500 }, { status: 429 }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts.length, 2);
    assert.equal(s.attempts[1]!.settlement?.outcomeClass, 'http_429_rate_limited');
    assert.equal(totalAttemptCredits(s.attempts), 0);
  });

  it('la espera de 1000 ms ocurre UNA vez y ANTES del segundo envío', async () => {
    const { sleep, waits } = countingSleep();
    const s = await runScenario([{ status: 429 }, { status: 200, body: SUCCESS_BODY }], { sleep });
    assert.deepEqual(waits, [LUSHA_SAFE_RETRY_INITIAL_DELAY_MS]);
    assert.equal(s.httpCalls, 2);
  });

  it('sin reintento no se espera nada', async () => {
    const { sleep, waits } = countingSleep();
    await runScenario([{ status: 200, body: SUCCESS_BODY }], { sleep });
    assert.deepEqual(waits, []);
  });
});

describe('CUT-L4 · los desenlaces que NO se reintentan (§ 15)', () => {
  const single: [string, FetchStep][] = [
    ['L4-G · 499', { status: 499 }],
    ['L4-J · 400 genérico', { status: 400 }],
    ['L4-K · 2xx ilegible', { status: 200, bodyText: 'no-json' }],
    ['L4-M · éxito al primer intento', { status: 200, body: SUCCESS_BODY }],
  ];

  for (const [label, step] of single) {
    it(`${label} ⇒ EXACTAMENTE una llamada HTTP`, async () => {
      const s = await runScenario([step]);
      assert.equal(s.httpCalls, 1, 'un solo despacho');
      assert.equal(s.attempts.length, 1, 'un solo intento durable');
    });
  }

  it('L4-H — timeout post-envío ⇒ 1 llamada, y el intento queda indeterminado', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const s = await runScenario([{ throws: abort }]);
    assert.equal(s.httpCalls, 1);
    assert.equal(s.attempts.length, 1);
    assert.equal(s.attempts[0]!.state, 'indeterminate');
    assert.equal(s.attempts[0]!.settlement?.billingCertainty, 'potentially_charged');
  });

  it('L4-I — conexión cerrada tras el envío ⇒ 1 llamada, indeterminado', async () => {
    const reset = new Error('socket hang up');
    (reset as unknown as { code: string }).code = 'ECONNRESET';
    const s = await runScenario([{ throws: reset }]);
    assert.equal(s.httpCalls, 1);
    assert.equal(s.attempts[0]!.state, 'indeterminate');
  });

  it('L4-L — sin credencial: CERO llamadas y CERO intentos 2', async () => {
    const table = createFenceTable();
    const { runSearch } = makeRunSearch(table, { apiKey: null });
    const { fn, calls } = sequencedFetch([]);
    const result = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );
    assert.equal(calls.length, 0, 'el proveedor no se toca');
    assert.equal(result.ok, false);
    const attempts = readAttempts(table, KEY_B0_P0);
    assert.equal(attempts.length, 1, 'no se reclama un intento 2 automático');
    assert.equal(attempts[0]!.dispatched, false, 'la frontera no se cruzó');
  });

  it('L4-N — 503 → timeout: dos intentos, final INDETERMINADO, ningún tercero', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const s = await runScenario([{ status: 503 }, { throws: abort }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts.length, 2);
    assert.equal(s.attempts[0]!.state, 'definitely_not_charged');
    assert.equal(s.attempts[1]!.state, 'indeterminate');
    assert.equal(s.attempts[1]!.settlement?.billingCertainty, 'potentially_charged');
    // 🔴 A partir de aquí NADA automático vuelve a llamar: la operación no puede
    // reconciliarse sola.
    assert.equal(s.row?.state, 'indeterminate');
  });

  it('L4-O — 429 → 499: dos intentos y se acabó', async () => {
    const s = await runScenario([{ status: 429 }, { status: 499 }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts.length, 2);
    assert.equal(s.attempts[1]!.state, 'indeterminate');
    assert.equal(s.attempts[1]!.settlement?.outcomeClass, 'post_send_indeterminate');
  });

  it('429 → 2xx ilegible: el segundo pudo cobrarse, y no hay tercero', async () => {
    const s = await runScenario([{ status: 429 }, { status: 200, bodyText: '<html>' }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts[1]!.settlement?.outcomeClass, 'malformed_success_payload');
    assert.equal(s.attempts[1]!.settlement?.billingCertainty, 'potentially_charged');
  });

  it('5xx → 4xx genérico: el segundo no está probado a cero, y se detiene ahí', async () => {
    const s = await runScenario([{ status: 500 }, { status: 402 }]);
    assert.equal(s.httpCalls, 2);
    assert.equal(s.attempts[1]!.settlement?.billingCertainty, 'unknown');
    assert.equal(s.attempts.length, 2);
  });
});

describe('CUT-L4 · durabilidad y carreras (§ 16, § 18, § 27)', () => {
  it('L4-P — si la marca del intento 2 falla, la segunda llamada NO sale', async () => {
    const table = createFenceTable();
    const base = createFenceStoreOn(table);
    let marks = 0;
    const store = {
      ...base,
      claimRetryAttempt: base.claimRetryAttempt!.bind(base),
      // La primera marca pasa; la del intento 2 se DENIEGA.
      markDispatchUnsafe: async (fenceKey: string) => {
        marks += 1;
        if (marks === 1) return base.markDispatchUnsafe(fenceKey);
        return { status: 'failed' as const, code: 'fence_mark_rpc_threw' };
      },
    };
    const runSearch = createFencedLushaRunSearch({
      store,
      operationId: OPERATION_ID,
      context: {
        triggeredByUserId: USER_ID,
        reservationId: RESERVATION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
      },
      resolveApiKey: async () => 'test-key-not-real',
      searchCompanies: (apiKey, request, beforeDispatch) =>
        searchLushaCompaniesV3({ apiKey, timeoutMs: TIMEOUT_MS, request, beforeDispatch }),
      sleep: lushaNoopRetrySleep,
    });
    const { fn, calls } = sequencedFetch([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    const result = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );
    // 🔴 UNA sola llamada: el intento 2 se reclamó pero jamás cruzó la frontera.
    // El cliente de Lusha atrapa la denegación y la publica como rechazo local
    // PROBADO antes del envío — cero bytes, cero cargo. Es el mismo camino que
    // CUT-L3 estableció para el intento 1, heredado sin excepciones.
    assert.equal(calls.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.providerOutcome?.outcomeClass, 'local_pre_dispatch_failure');
    assert.equal(result.providerOutcome?.providerRequestDispatched, false);
    const attempts = readAttempts(table, KEY_B0_P0);
    assert.equal(attempts.length, 2, 'el intento 2 quedó reclamado y sin despachar');
    assert.equal(attempts[1]!.dispatched, false);
    // 🔴 Y NO se liquida: la fila la gobierna otro dueño, así que degradarla desde
    // aquí borraría justo la incertidumbre que hay que conservar.
    assert.equal(attempts[1]!.state, 'prepared');
    // Ni se abre un tercero.
    assert.equal(table.retryClaimsGranted, 1);
  });

  it('L4-Q — dos trabajadores reclamando el intento 2: UNA fila, UNA llamada', async () => {
    const table = createFenceTable();
    // Un intento 1 ya liquidado a 429, exactamente como lo dejaría una corrida.
    const store = createFenceStoreOn(table);
    await store.claim(
      { operationId: OPERATION_ID, branchIndex: 0, page: 0 },
      { triggeredByUserId: USER_ID, reservationId: RESERVATION_ID, clientRequestId: CLIENT_REQUEST_ID },
    );
    await store.markDispatchUnsafe(KEY_B0_P0);
    await store.settle(KEY_B0_P0, {
      state: 'definitely_not_charged',
      outcomeClass: 'http_429_rate_limited',
      billingCertainty: 'definitely_not_charged',
      retryContract: 'retryable_by_contract',
      httpStatus: 429,
      providerRequestId: 'req-1',
      creditsCharged: null,
      resultsReturned: 0,
      rateLimit: null,
    });

    // Dos «procesos» distintos sobre la MISMA tabla durable.
    const a = createFenceStoreOn(table);
    const b = createFenceStoreOn(table);
    const [ra, rb] = await Promise.all([
      a.claimRetryAttempt!(KEY_B0_P0),
      b.claimRetryAttempt!(KEY_B0_P0),
    ]);
    const granted = [ra, rb].filter((r) => r.status === 'claimed');
    const refused = [ra, rb].filter((r) => r.status !== 'claimed');
    assert.equal(granted.length, 1, 'sólo un trabajador reclama el intento 2');
    assert.equal(refused.length, 1);
    assert.equal(table.retryClaimsGranted, 1);
    assert.equal(readAttempts(table, KEY_B0_P0).length, 2, 'exactamente dos filas de intento');
  });

  it('L4-R — caída tras marcar el intento 2 ⇒ ningún intento 3', async () => {
    const table = createFenceTable();
    const { runSearch } = makeRunSearch(table);
    // El proceso «muere» tras la marca: la liquidación nunca llega.
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const { fn, calls } = sequencedFetch([{ status: 429 }, { throws: abort }]);
    const result = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );
    assert.equal(calls.length, 2);
    assert.equal(result.ok, false);
    const attempts = readAttempts(table, KEY_B0_P0);
    assert.equal(attempts.length, 2, 'no se abrió un tercero');
    assert.equal(attempts[1]!.dispatched, true, 'el intento 2 sí cruzó la frontera');
  });

  it('un intento 2 en vuelo NO borra la evidencia del intento 1 (§ 7)', async () => {
    const s = await runScenario([{ status: 503 }, { status: 200, body: SUCCESS_BODY }]);
    const first = s.attempts[0]!;
    assert.equal(first.attemptNo, 1);
    assert.equal(first.settlement?.httpStatus, 503);
    assert.equal(first.settlement?.outcomeClass, 'http_5xx_provider_failure');
    // La proyección de la valla es la del ÚLTIMO intento; el historial NO.
    assert.equal(s.row?.state, 'succeeded');
  });

  it('sin liquidación durable del intento 1 NO se reintenta', async () => {
    const table = createFenceTable();
    // `settleDisabled` modela un proceso que ya no puede escribir: la certeza de
    // «costó 0» existiría sólo en memoria, y eso NUNCA autoriza.
    table.settleDisabled = true;
    const { runSearch } = makeRunSearch(table);
    const { fn, calls } = sequencedFetch([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );
    assert.equal(calls.length, 1, 'sin evidencia escrita no hay segunda llamada');
  });

  it('§ 37 — con la 135 aplicada y la 136 AUSENTE, el reintento se deshabilita', async () => {
    const table = createFenceTable();
    table.retryCapabilityAbsent = true;
    const { runSearch, refusals } = makeRunSearch(table);
    const { fn, calls } = sequencedFetch([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    const result = await withFetch(fn as unknown as typeof globalThis.fetch, () =>
      runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );
    // La petición INICIAL conserva la protección de CUT-L3 y se ejecuta…
    assert.equal(calls.length, 1);
    assert.equal(result.ok, false);
    // …y el reintento no ocurre. Jamás una segunda llamada sin valla.
    assert.equal(readAttempts(table, KEY_B0_P0).length, 1);
    assert.ok(refusals.length >= 1, 'la negativa queda registrada, no silenciada');
  });

  it('una valla SIN capacidad de reclamo de reintento no puede reintentar', async () => {
    // Un doble anterior al corte —sin `claimRetryAttempt`— es exactamente lo que
    // un despliegue viejo o un test heredado inyectan. Debe degradar a CUT-L3.
    const table = createFenceTable();
    const base = createFenceStoreOn(table);
    const legacyStore = {
      claim: base.claim,
      markDispatchUnsafe: base.markDispatchUnsafe,
      settle: base.settle,
    };
    const outcome = await runFencedLushaProspectingRequest<{ tag: string }>({
      store: legacyStore,
      identity: { operationId: OPERATION_ID, branchIndex: 0, page: 0 },
      context: {
        triggeredByUserId: USER_ID,
        reservationId: RESERVATION_ID,
        clientRequestId: CLIENT_REQUEST_ID,
      },
      run: async (beforeDispatch) => {
        await beforeDispatch();
        return { tag: 'rate-limited' };
      },
      settlementFrom: () => ({
        state: 'definitely_not_charged',
        outcomeClass: 'http_429_rate_limited',
        billingCertainty: 'definitely_not_charged',
        retryContract: 'retryable_by_contract',
        httpStatus: 429,
        providerRequestId: null,
        creditsCharged: null,
        resultsReturned: 0,
        rateLimit: null,
      }),
      sleep: lushaNoopRetrySleep,
    });
    assert.equal(outcome.status, 'executed');
    if (outcome.status === 'executed') {
      assert.equal(outcome.attemptsUsed, 1);
      assert.equal(outcome.retried, false);
    }
  });
});

describe('CUT-L4 · identidad y traza (§ 5, § 33, L4-T)', () => {
  it('L4-T — un clientRequestId nuevo NO cambia la identidad de la petición', () => {
    const first = buildLushaRequestFenceKey({ operationId: OPERATION_ID, branchIndex: 0, page: 0 });
    const second = buildLushaRequestFenceKey({ operationId: OPERATION_ID, branchIndex: 0, page: 0 });
    assert.equal(first, second);
    assert.doesNotMatch(first, new RegExp(CLIENT_REQUEST_ID));
    // Y el número de intento TAMPOCO entra en la clave: la clave nombra la
    // PETICIÓN LÓGICA, y los intentos cuelgan de ella.
    assert.doesNotMatch(first, /\|a[0-9]/);
  });

  it('L4-T — el reintento no acuña operación nueva: la clave es la misma', async () => {
    const s = await runScenario([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    assert.equal(s.table.rows.size, 1, 'UNA petición lógica, no dos');
    assert.equal(s.row?.operationId, OPERATION_ID);
  });

  it('L4-33 — cada intento conserva SU `x-request-id`, y son DISTINTOS', async () => {
    const s = await runScenario([
      { status: 429, headers: { 'x-request-id': 'req-attempt-1' } },
      { status: 200, body: SUCCESS_BODY, headers: { 'x-request-id': 'req-attempt-2' } },
    ]);
    assert.equal(s.attempts[0]!.settlement?.providerRequestId, 'req-attempt-1');
    assert.equal(s.attempts[1]!.settlement?.providerRequestId, 'req-attempt-2');
    assert.notEqual(
      s.attempts[0]!.settlement?.providerRequestId,
      s.attempts[1]!.settlement?.providerRequestId,
    );
    // 🔴 Y NINGUNO es la clave de valla: sólo existe DESPUÉS de la respuesta.
    assert.doesNotMatch(KEY_B0_P0, /req-attempt/);
  });

  it('§ 32 — cada intento guarda SU instantánea de cuota, con los headers de V3', async () => {
    const s = await runScenario([
      {
        status: 429,
        headers: {
          'x-rate-limit-minute': '60',
          'x-minute-requests-left': '0',
          'x-rate-limit-daily': '1000',
          'x-daily-requests-left': '400',
        },
      },
      {
        status: 200,
        body: SUCCESS_BODY,
        headers: {
          'x-rate-limit-minute': '60',
          'x-minute-requests-left': '59',
          'x-rate-limit-daily': '1000',
          'x-daily-requests-left': '399',
        },
      },
    ]);
    assert.equal(s.attempts[0]!.settlement?.rateLimit?.minuteRemaining, 0);
    assert.equal(s.attempts[1]!.settlement?.rateLimit?.minuteRemaining, 59);
    assert.equal(s.attempts[1]!.settlement?.rateLimit?.dailyRemaining, 399);
  });
});

describe('CUT-L4 · río abajo: candidatos, provider-seen y facturación (§ 28, § 29, § 30)', () => {
  it('L4-U — tras un reintento exitoso, el ejecutor ve UN resultado, no dos', async () => {
    const s = await runScenario([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    // `runSearch` devuelve UNA sola vez: el reintento vive DEBAJO de la
    // abstracción de página, así que el bucle de ramas no puede procesar el 429.
    const final: LushaPreviewResult = s.result;
    assert.equal(final.ok, true);
    assert.equal(final.results.length, 1);
    assert.equal(final.results[0]?.domain, 'acme.com');
  });

  it('L4-V — el 429 NO publica resultados: provider-seen no puede inventar empresas', async () => {
    const s = await runScenario([{ status: 429 }, { status: 429 }]);
    assert.equal(s.result.ok, false);
    assert.equal(s.result.results.length, 0);
    // Y en el caso recuperado, las empresas del ÉXITO se publican una vez.
    const ok = await runScenario([{ status: 429 }, { status: 200, body: SUCCESS_BODY }]);
    assert.equal(ok.result.results.length, 1);
  });

  it('L4-W — 503 + éxito(1): la corrida recibe UN crédito, no dos', async () => {
    const s = await runScenario([{ status: 503 }, { status: 200, body: SUCCESS_BODY }]);
    // Lo que el ejecutor de páginas suma es `result.billing.creditsCharged`, y es
    // el del intento que de verdad lo reportó.
    assert.equal(s.result.billing.creditsCharged, 1);
    assert.equal(totalAttemptCredits(s.attempts), 1);
  });

  it('L4-X — 429 + 429: cero créditos, y ni un importe fabricado', async () => {
    const s = await runScenario([{ status: 429 }, { status: 429 }]);
    assert.equal(totalAttemptCredits(s.attempts), 0);
    assert.equal(s.result.billing.creditsCharged, null);
  });

  it('§ 30 — el reintento NO altera la contabilidad de la corrida frente a un solo 429', async () => {
    // 🔴 La comparación ES el punto, y por eso la línea base tiene que ser la
    // corrida SIN capacidad de reintento —la 136 ausente—, no un doble al que se
    // le acaben los pasos. Si el reintento convirtiera despachos en créditos,
    // estas dos corridas diferirían. No difieren.
    const baselineTable = createFenceTable();
    baselineTable.retryCapabilityAbsent = true;
    const baseline = makeRunSearch(baselineTable);
    const baselineFetch = sequencedFetch([{ status: 429 }]);
    const single = await withFetch(baselineFetch.fn as unknown as typeof globalThis.fetch, () =>
      baseline.runSearch(PREVIEW_INPUT, COORD_B0_P0),
    );

    const retried = await runScenario([{ status: 429 }, { status: 429 }]);

    assert.equal(single.billing.creditsCharged, retried.result.billing.creditsCharged);
    assert.equal(single.billing.resultsReturned, retried.result.billing.resultsReturned);
    assert.equal(single.billing.expectedMaxCredits, retried.result.billing.expectedMaxCredits);
    assert.equal(single.ok, retried.result.ok);
    // Lo único que cambia es el número de DESPACHOS, que es telemetría, no cargo.
    assert.equal(baselineFetch.calls.length, 1);
    assert.equal(retried.httpCalls, 2);
  });
});

describe('CUT-L4 · alcance: lo que este corte NO movió (§ 31, § 34, § 44)', () => {
  const fence = stripTsComments(read('src/server/prospect-batches/lusha-request-fence.ts'));
  const policyRaw = read('src/server/prospect-batches/lusha-safe-retry-policy.ts');
  const policy = stripTsComments(policyRaw);
  const migrationRaw = read(
    'supabase/migrations/136_agent1_lusha_prospecting_safe_retry_attempts.sql',
  );
  const migration = stripSqlComments(migrationRaw);
  const preview = read('src/server/prospect-batches/lusha-preview.ts');

  it('§ 34 — CUT-L4 no reabre el preview pagado por ninguna ruta nueva', () => {
    // Ni la política ni la migración conocen el preview. Que la acción de preview
    // siga capada es asunto de CUT-L3 y su suite; lo que aquí se defiende es que
    // este corte no le abrió una puerta lateral.
    assert.doesNotMatch(policy, /preview/i);
    assert.doesNotMatch(migration, /preview/i);
  });

  it('§ 31 — la política no menciona reservas, presupuesto, page size ni objetivo', () => {
    for (const forbidden of [/reserv/i, /budget/i, /pageSize/i, /creditsReserved/i]) {
      assert.doesNotMatch(policy, forbidden);
    }
  });

  it('§ 31 — la migración 136 no toca presupuesto ni reservas', () => {
    assert.doesNotMatch(migration, /wizard_budget_reservations/);
    assert.doesNotMatch(migration, /provider_usage_logs/);
  });

  it('§ 4 — sólo hay UN temporizador, y está aislado en la espera de producción', () => {
    // Sobre el código, no sobre la prosa: el comentario de arriba del módulo
    // NOMBRA `setTimeout` para explicar por qué no se usa en la decisión, y una
    // guarda que leyera el archivo crudo contaría ese comentario como el defecto.
    const occurrences = policy.match(/setTimeout/g) ?? [];
    assert.equal(occurrences.length, 1, 'un solo temporizador, y aislado');
    assert.match(policy, /lushaRealRetrySleep/);
    // Y la decisión no lo toca: `decideLushaSafeRetry` es pura.
    const decision = policy.slice(
      policy.indexOf('export function decideLushaSafeRetry'),
      policy.indexOf('export type LushaRetrySleep'),
    );
    assert.doesNotMatch(decision, /setTimeout|Date\.now|Math\.random/);
  });

  it('§ 10 — la 135 sigue sin una sola línea de CUT-L4', () => {
    // La 135 está MERGEADA en main y es inmutable. Nombra a CUT-L4 en su prosa
    // —para decir que el reintento sería de otro corte— así que lo que se afirma
    // aquí es lo que EJECUTA, no lo que menciona.
    const m135 = stripSqlComments(
      read('supabase/migrations/135_agent1_lusha_prospecting_request_fence.sql'),
    );
    assert.match(m135, /CREATE TABLE IF NOT EXISTS public\.lusha_prospecting_request_fence/);
    assert.doesNotMatch(m135, /lusha_prospecting_request_attempts/);
    assert.doesNotMatch(m135, /claim_lusha_prospecting_retry_attempt/);
    assert.doesNotMatch(m135, /latest_attempt_no/);
    assert.doesNotMatch(m135, /attempts_used/);
  });

  it('§ 3 — no existe un tercer intento en ninguna de las dos mitades del techo', () => {
    // Runtime.
    assert.match(policy, /LUSHA_MAX_ATTEMPTS_PER_LOGICAL_REQUEST = 2/);
    // Esquema: el CHECK de la tabla y la guarda de la RPC.
    assert.match(migration, /attempt_no >= 1 AND attempt_no <= 2/);
    assert.match(migration, /v_next_no > 2/);
  });

  it('§ 5 — la clave de valla sigue sin `clientRequestId` y sin `x-request-id`', () => {
    const start = fence.indexOf('export function buildLushaRequestFenceKey');
    const end = fence.indexOf('export type LushaRequestFenceState');
    assert.ok(start > 0 && end > start, 'el constructor de la clave sigue donde estaba');
    const keyBuilder = fence.slice(start, end);
    assert.doesNotMatch(keyBuilder, /clientRequestId/);
    assert.doesNotMatch(keyBuilder, /providerRequestId/);
    assert.doesNotMatch(keyBuilder, /attemptNo/, 'la clave nombra la PETICIÓN, no el intento');
    assert.match(keyBuilder, /operationId/);
  });

  it('§ 14 — la RPC de reintento exige las CUATRO condiciones de facturación', () => {
    assert.match(migration, /v_last_state <> 'definitely_not_charged'/);
    assert.match(migration, /v_last_billing IS DISTINCT FROM 'definitely_not_charged'/);
    assert.match(migration, /v_last_contract IS DISTINCT FROM 'retryable_by_contract'/);
    assert.match(
      migration,
      /v_last_class NOT IN \('http_429_rate_limited', 'http_5xx_provider_failure'\)/,
    );
  });

  it('§ 17 — reclamo y cierre serializan sobre la MISMA fila de operación', () => {
    const forUpdateOnOperations =
      migration.match(/FROM public\.lusha_prospecting_operations\s+WHERE operation_id = [^\n]*\n\s*FOR UPDATE/g) ?? [];
    // El reclamo inicial, el de reintento y el cierre: los TRES.
    assert.ok(
      forUpdateOnOperations.length >= 3,
      `se esperaban al menos 3 bloqueos FOR UPDATE sobre la operación, hubo ${forUpdateOnOperations.length}`,
    );
  });

  it('§ 35 — la superficie SQL nueva conserva la postura de seguridad', () => {
    assert.match(migration, /SET search_path = pg_catalog, public, pg_temp/);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(
      migration,
      /REVOKE ALL ON TABLE public\.lusha_prospecting_request_attempts FROM anon/,
    );
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.claim_lusha_prospecting_retry_attempt\(text\) FROM authenticated/,
    );
    // Sin DELETE y sin TRUNCATE para nadie. Sobre el SQL EJECUTABLE: la migración
    // promete en un comentario que no los concede, y una guarda cruda leería esa
    // promesa como la infracción.
    assert.doesNotMatch(migration, /GRANT[^;]*DELETE/i);
    assert.doesNotMatch(migration, /GRANT[^;]*TRUNCATE/i);
    assert.doesNotMatch(migration, /\bDROP TABLE\b/i);
    // …y la prosa SÍ lo promete, que es como debe leerse un registro de gasto.
    assert.match(migrationRaw, /Sin DELETE y sin TRUNCATE/);
  });

  it('§ 8 — el historial de intentos no tiene dónde guardar payload de proveedor', () => {
    const table = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS public.lusha_prospecting_request_attempts'),
      migration.indexOf('CREATE INDEX IF NOT EXISTS idx_lusha_prospecting_request_attempts_operation'),
    );
    assert.ok(table.length > 0, 'la tabla existe en el SQL ejecutable');
    for (const forbidden of [/company_name/i, /\bdomain\b/i, /api_key/i, /authorization/i, /payload/i]) {
      assert.doesNotMatch(table, forbidden);
    }
  });

  it('§ 11 — el backfill es idempotente, determinista y no destructivo', () => {
    const start = migration.indexOf('INSERT INTO public.lusha_prospecting_request_attempts (');
    const end = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.claim_lusha_prospecting_request(',
    );
    assert.ok(start > 0 && end > start, 'el backfill precede a las funciones');
    const backfill = migration.slice(start, end);
    assert.match(backfill, /ON CONFLICT \(fence_key, attempt_no\) DO NOTHING/);
    assert.doesNotMatch(backfill, /\bDELETE\b/i);
    assert.doesNotMatch(backfill, /\bUPDATE\b/i);
    // Sin relojes nuevos: cada sello sale de la propia fila de valla, así que
    // reaplicar la migración no puede producir un backfill distinto.
    assert.doesNotMatch(backfill, /\bnow\(\)/);
  });

  it('§ 44 — el preview no cambió su tope de créditos esperado', () => {
    assert.match(preview, /LUSHA_PREVIEW_EXPECTED_MAX_CREDITS/);
  });
});
