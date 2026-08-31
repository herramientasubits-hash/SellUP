/**
 * AGENT1-LUSHA-CUT-L2-FAILURE-SEMANTICS § R — la suite dedicada del corte.
 *
 * ── El hecho HUMANO que gobierna todo esto ───────────────────────────────────
 *
 * El soporte de Lusha confirmó, por un agente HUMANO, para
 * `POST /v3/companies/prospecting`:
 *
 *   · 429  ⇒ rate limit ⇒ 0 créditos ⇒ desenlace SEGURO;
 *   · 5xx  ⇒ fallo del servidor ⇒ 0 créditos ⇒ desenlace SEGURO;
 *   · petición DESPACHADA cuya respuesta se pierde (timeout, conexión cerrada,
 *     499) ⇒ Lusha PUDO procesarla y cobrar, y NO hay Idempotency-Key, ni
 *     requestId de cliente, ni API de recuperación, ni replay seguro.
 *
 * Y los headers de cuota reales:
 *
 *     x-rate-limit-minute · x-minute-requests-left
 *     x-rate-limit-daily  · x-daily-requests-left
 *
 * ── 🔴 Lo que esta suite NO afirma ──────────────────────────────────────────
 *
 * No afirma que Lusha sea seguro de activar. CUT-L2 clasifica y publica; la
 * frontera de despacho es de MEMORIA. Una caída dura del proceso entre el
 * `fetch()` y la clasificación sigue dejando la petición sin testigo, y cerrar
 * esa ventana con estado persistido es CUT-L3.
 *
 * No añade reintentos. Que 429 y 5xx salgan `retryable_by_contract` describe lo
 * que el proveedor PERMITE, no una capacidad que este corte encienda.
 *
 * Sin red, sin DB, sin cliente real de Lusha, sin un solo crédito.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  classifyLushaProspectingOutcome,
  lushaBillingSettledFromParsedCredits,
  mayAutomaticallyRetryLushaProspecting,
  lushaOutcomeMayHaveBeenCharged,
} from '@/server/integrations/lusha-prospecting-failure-taxonomy';
import {
  LUSHA_RATE_LIMIT_HEADER_NAMES,
  parseLushaRateLimitHeaders,
  readLushaProviderRequestId,
} from '@/server/integrations/lusha-rate-limit-headers';
import {
  searchLushaCompaniesV3,
  type LushaCompanyProspectingV3Filters,
} from '@/server/integrations/lusha-client';
import {
  executeLushaPreview,
  type LushaPreviewInput,
} from '@/server/prospect-batches/lusha-preview';

// ── Andamiaje ─────────────────────────────────────────────────────────────────

const FAKE_API_KEY = 'test-key-not-real';
const TIMEOUT_MS = 5_000;

const VALID_FILTERS: LushaCompanyProspectingV3Filters = {
  companies: { include: { locations: [{ country: 'Colombia' }], mainIndustriesIds: [11] } },
};

const PREVIEW_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

type HeaderMap = Record<string, string>;

function headersOf(map: HeaderMap) {
  // `Headers.get()` es case-insensitive por especificación; el doble lo imita
  // para que la suite no pase por una comparación más laxa que la real.
  const lower: HeaderMap = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/** Respuesta HTTP simulada. `bodyText` permite un cuerpo que NO es JSON. */
function mockFetch(opts: {
  status: number;
  body?: unknown;
  bodyText?: string;
  headers?: HeaderMap;
}) {
  const calls: { url: string; body: unknown }[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    let parsed: unknown;
    if (typeof init?.body === 'string') {
      try { parsed = JSON.parse(init.body); } catch { parsed = init.body; }
    }
    calls.push({ url: String(input), body: parsed });
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

/** `fetch` que SALE y luego revienta: el caso post-despacho del § A3. */
function throwingFetch(err: Error) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    throw err;
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

// __tests__ → prospect-batches → server → src → raíz del repo
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const readRepoFile = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');

function search() {
  return searchLushaCompaniesV3({
    apiKey: FAKE_API_KEY,
    timeoutMs: TIMEOUT_MS,
    request: { filters: VALID_FILTERS, pagination: { page: 0, size: 10 } },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// L2-A · 429 — contrato humano: 0 créditos, reintentable POR CONTRATO
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-A — HTTP 429', () => {
  it('clasifica rate limit con cobro descartado y contrato reintentable', async () => {
    const { fn, calls } = mockFetch({
      status: 429,
      bodyText: 'Too Many Requests',
      headers: {
        'x-rate-limit-minute': '100',
        'x-minute-requests-left': '0',
        'x-request-id': 'req-429',
      },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(calls.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.outcome?.outcomeClass, 'http_429_rate_limited');
    assert.equal(result.outcome?.billingCertainty, 'definitely_not_charged');
    assert.equal(result.outcome?.retryContract, 'retryable_by_contract');
    assert.equal(result.outcome?.httpStatus, 429);
    assert.equal(result.outcome?.providerRequestDispatched, true);

    // Los headers se leen incluso en el error: es justo cuando más importan.
    assert.equal(result.rateLimit?.minuteLimit, 100);
    assert.equal(result.rateLimit?.minuteRemaining, 0, 'cuota agotada de verdad');
    assert.equal(result.providerRequestId, 'req-429');

    // Un error NO es «cero empresas»: no se inventa ni un candidato.
    assert.equal(result.resultsReturned, 0);
    assert.equal(result.results, undefined);
  });

  it('CUT-L2 no introduce ningún reintento: una sola llamada HTTP', async () => {
    const { fn, calls } = mockFetch({ status: 429, bodyText: 'rate limited' });
    await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(calls.length, 1, 'clasificar retryable NO es reintentar');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-B / L2-C · 5xx — contrato humano: 0 créditos
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-B/L2-C — HTTP 5xx', () => {
  for (const status of [500, 502, 503, 504]) {
    it(`HTTP ${status} ⇒ fallo de proveedor, cobro descartado, reintentable por contrato`, async () => {
      const { fn, calls } = mockFetch({ status, bodyText: 'server error' });
      const result = await withFetch(fn as typeof globalThis.fetch, search);

      assert.equal(result.ok, false);
      assert.equal(result.outcome?.outcomeClass, 'http_5xx_provider_failure');
      assert.equal(result.outcome?.billingCertainty, 'definitely_not_charged');
      assert.equal(result.outcome?.retryContract, 'retryable_by_contract');
      assert.equal(result.outcome?.httpStatus, status);
      assert.equal(calls.length, 1, 'sin motor de reintentos nuevo');
    });
  }

  it('5xx NO se confunde con 429: son clases distintas', () => {
    const s5 = classifyLushaProspectingOutcome({ httpStatus: 500, requestDispatched: true });
    const s429 = classifyLushaProspectingOutcome({ httpStatus: 429, requestDispatched: true });
    assert.notEqual(s5.outcomeClass, s429.outcomeClass);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-D · 499 literal — indeterminado, NO un 4xx ordinario
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-D — HTTP 499', () => {
  it('499 es post-envío indeterminado y posiblemente cobrado', async () => {
    const { fn } = mockFetch({ status: 499, bodyText: 'client closed request' });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.outcome?.outcomeClass, 'post_send_indeterminate');
    assert.equal(result.outcome?.billingCertainty, 'potentially_charged');
    assert.equal(result.outcome?.retryContract, 'do_not_automatically_retry');
    assert.equal(result.outcome?.httpStatus, 499);
  });

  it('499 NO cae en la lectura genérica de 4xx', () => {
    const o = classifyLushaProspectingOutcome({ httpStatus: 499, requestDispatched: true });
    assert.notEqual(o.outcomeClass, 'http_4xx_non_retryable');
    assert.equal(mayAutomaticallyRetryLushaProspecting(o), false);
    assert.equal(lushaOutcomeMayHaveBeenCharged(o), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-E / L2-F · fallo DESPUÉS del despacho — la corrección P0 del corte
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-E — timeout tras despachar', () => {
  it('AbortError post-despacho ⇒ despachada, posiblemente cobrada, sin reintento', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    const { fn, calls } = throwingFetch(abort);

    const result = await withFetch(fn as unknown as typeof globalThis.fetch, search);

    assert.equal(calls.length, 1, 'la petición SALIÓ');
    assert.equal(result.outcome?.providerRequestDispatched, true);
    assert.equal(result.outcome?.outcomeClass, 'post_send_indeterminate');
    assert.equal(result.outcome?.billingCertainty, 'potentially_charged');
    assert.equal(result.outcome?.retryContract, 'do_not_automatically_retry');
    assert.equal(result.outcome?.httpStatus, null);
    // Sin respuesta no hay trace ni cuota, y no se fabrican.
    assert.equal(result.providerRequestId, null);
    assert.equal(result.rateLimit?.anyHeaderPresent, false);
  });
});

describe('L2-F — fallo de transporte tras despachar', () => {
  for (const [name, message] of [
    ['ECONNRESET', 'read ECONNRESET'],
    ['ETIMEDOUT', 'connect ETIMEDOUT'],
    ['TypeError', 'fetch failed'],
    ['SocketError', 'socket hang up'],
  ] as const) {
    it(`${name} post-despacho se degrada CERRADO (posiblemente cobrado)`, async () => {
      const { fn, calls } = throwingFetch(new Error(message));
      const result = await withFetch(fn as unknown as typeof globalThis.fetch, search);

      assert.equal(calls.length, 1);
      assert.equal(result.outcome?.providerRequestDispatched, true);
      assert.equal(result.outcome?.billingCertainty, 'potentially_charged');
      assert.equal(result.outcome?.retryContract, 'do_not_automatically_retry');
      // 🔴 Un error de red genérico NO prueba que la petición no saliera.
      assert.notEqual(result.outcome?.outcomeClass, 'local_pre_dispatch_failure');
      assert.notEqual(result.outcome?.billingCertainty, 'definitely_not_charged');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-G · fallo PROBADO antes del despacho
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-G — fallo local previo al despacho', () => {
  it('credencial ausente antes del fetch ⇒ requestDispatched=false', async () => {
    let searchCalled = 0;
    const result = await executeLushaPreview(
      {
        resolveApiKey: async () => null,
        searchCompanies: async () => {
          searchCalled++;
          throw new Error('no debe llamarse');
        },
      },
      PREVIEW_INPUT,
    );

    assert.equal(searchCalled, 0, 'nunca se tocó al proveedor');
    assert.equal(result.status, 'provider_unavailable');
    assert.equal(result.providerOutcome?.providerRequestDispatched, false);
    assert.equal(result.providerOutcome?.outcomeClass, 'local_pre_dispatch_failure');
    assert.equal(result.providerOutcome?.billingCertainty, 'definitely_not_charged');
    assert.equal(result.providerOutcome?.retryContract, 'safe_to_retry_not_dispatched');
  });

  it('validación local del cliente (size < 10) no despacha y no afirma envío', async () => {
    const { fn, calls } = mockFetch({ status: 200, body: { results: [] } });
    const result = await withFetch(fn as typeof globalThis.fetch, () =>
      searchLushaCompaniesV3({
        apiKey: FAKE_API_KEY,
        timeoutMs: TIMEOUT_MS,
        request: { filters: VALID_FILTERS, pagination: { page: 0, size: 1 } },
      }),
    );

    assert.equal(calls.length, 0, 'no hubo HTTP');
    assert.equal(result.outcome?.providerRequestDispatched, false);
    assert.equal(result.outcome?.outcomeClass, 'local_pre_dispatch_failure');
    assert.equal(result.outcome?.billingCertainty, 'definitely_not_charged');
    // Compatibilidad: el `status` público no cambió.
    assert.equal(result.status, 'provider_error');
  });

  it('filtros ausentes tampoco despachan', async () => {
    const { fn, calls } = mockFetch({ status: 200, body: { results: [] } });
    const result = await withFetch(fn as typeof globalThis.fetch, () =>
      searchLushaCompaniesV3({ apiKey: FAKE_API_KEY, timeoutMs: TIMEOUT_MS, request: {} }),
    );

    assert.equal(calls.length, 0);
    assert.equal(result.outcome?.providerRequestDispatched, false);
    assert.equal(result.outcome?.retryContract, 'safe_to_retry_not_dispatched');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-H · 4xx genérico — separado del 429, y SIN garantía de cero cobro
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-H — 4xx genérico', () => {
  for (const status of [400, 401, 402, 403, 404, 409, 422, 451]) {
    it(`HTTP ${status} no es 429, no es 5xx, no es timeout, y no se reintenta`, async () => {
      const { fn, calls } = mockFetch({ status, bodyText: 'client error' });
      const result = await withFetch(fn as typeof globalThis.fetch, search);

      assert.equal(result.outcome?.outcomeClass, 'http_4xx_non_retryable');
      assert.equal(result.outcome?.retryContract, 'do_not_automatically_retry');
      assert.equal(calls.length, 1);

      // 🔴 El soporte humano confirmó 0 créditos para 429 y 5xx. De estos NO dijo
      // nada, así que `unknown` — extenderles la garantía del 429 sería inventar
      // contrato, y justo hacia el lado que nos conviene.
      assert.equal(result.outcome?.billingCertainty, 'unknown');
      assert.notEqual(result.outcome?.billingCertainty, 'definitely_not_charged');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-I / L2-J · 2xx
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-I — 2xx válido', () => {
  it('el parseo de candidatos y la facturación siguen intactos', async () => {
    const { fn } = mockFetch({
      status: 200,
      body: {
        results: [
          { id: 'c1', name: 'Acme', domain: 'acme.com', employeeCount: { exact: 300 } },
          { id: 'c2', name: 'Globex', domain: 'globex.com', employeeCount: { exact: 900 } },
        ],
        total: 2,
        billing: { creditsCharged: 1 },
      },
      headers: { 'x-request-id': 'req-ok' },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.resultsReturned, 2);
    assert.equal(result.results?.[0]?.name, 'Acme');
    assert.equal(result.results?.[1]?.domain, 'globex.com');
    assert.equal(result.totalAvailable, 2);
    assert.equal(result.creditsCharged, 1);

    assert.equal(result.outcome?.outcomeClass, 'success');
    // El proveedor liquidó: eso SÍ es autoridad de facturación.
    assert.equal(result.outcome?.billingCertainty, 'settled_from_provider');
    // Repetir una búsqueda que ya salió bien es pagarla dos veces.
    assert.equal(result.outcome?.retryContract, 'do_not_automatically_retry');
  });

  it('2xx sin bloque billing ⇒ certeza unknown, nunca un cero fabricado', async () => {
    const { fn } = mockFetch({ status: 200, body: { results: [{ id: 'c1', name: 'Acme' }] } });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.outcome?.outcomeClass, 'success');
    assert.equal(result.outcome?.billingCertainty, 'unknown');
    assert.equal(result.creditsCharged, null, 'no se inventa creditsCharged = 0');
  });
});

describe('L2-J — 2xx con cuerpo malformado', () => {
  it('JSON ilegible NO se convierte en página vacía exitosa', async () => {
    const { fn } = mockFetch({ status: 200, bodyText: '<html>gateway</html>' });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.ok, false, 'degrada CERRADO');
    assert.notEqual(result.status, 'no_results');
    assert.equal(result.outcome?.outcomeClass, 'malformed_success_payload');
    assert.equal(result.resultsReturned, 0);

    // 🔴 El servidor pudo completar una operación facturable y ser SellUp quien
    // no supo leer la respuesta. Un 2xx malformado NO equivale a un 5xx.
    assert.equal(result.outcome?.billingCertainty, 'potentially_charged');
    assert.notEqual(result.outcome?.billingCertainty, 'definitely_not_charged');
    assert.equal(result.outcome?.retryContract, 'do_not_automatically_retry');
    assert.equal(result.creditsCharged, undefined, 'no se afirma 0 créditos');
  });

  it('un top-level que no es objeto también degrada cerrado', async () => {
    const { fn } = mockFetch({ status: 200, bodyText: '[1,2,3]' });
    const result = await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(result.ok, false);
    assert.equal(result.outcome?.outcomeClass, 'malformed_success_payload');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-Q · AUTORIDAD DE LIQUIDACIÓN DEL ÉXITO
//
// El contrato HUMANO nombra un único dato autoritativo del cargo real:
// `billing.creditsCharged`. De ahí la regla:
//
//     importe parseado LEÍBLE   ⇒ settled_from_provider
//     importe parseado ausente  ⇒ unknown
//
// 🔴 El defecto que este bloque fija: la certeza se derivaba de la PRESENCIA del
// bloque `billing`, así que un `{"billing": {}}` publicaba
// `settled_from_provider` junto a un `creditsCharged: null`. Dos afirmaciones
// que se contradicen, y la falsa era justo la que decía «el proveedor liquidó».
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-Q — el importe liquida, no el sobre `billing`', () => {
  it('el predicado canónico: sólo un importe leíble liquida', () => {
    // Importes REALES del proveedor — el 0 explícito incluido.
    assert.equal(lushaBillingSettledFromParsedCredits(2), true);
    assert.equal(lushaBillingSettledFromParsedCredits(1), true);
    assert.equal(lushaBillingSettledFromParsedCredits(0), true, '0 explícito SÍ liquida');

    // Ausencia de importe — nunca liquidación.
    assert.equal(lushaBillingSettledFromParsedCredits(null), false);
    assert.equal(lushaBillingSettledFromParsedCredits(undefined), false);

    // 🔴 NaN/Infinity no son importes LEÍDOS. No pueden venir de un JSON válido,
    // pero tampoco pueden colarse como liquidación si alguien los fabrica.
    assert.equal(lushaBillingSettledFromParsedCredits(Number.NaN), false);
    assert.equal(lushaBillingSettledFromParsedCredits(Number.POSITIVE_INFINITY), false);
  });

  it('A — liquidación explícita: creditsCharged = 2 ⇒ settled_from_provider', async () => {
    const { fn } = mockFetch({
      status: 200,
      body: { results: [{ id: 'c1', name: 'Acme' }], billing: { creditsCharged: 2 } },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success');
    assert.equal(result.creditsCharged, 2);
    assert.equal(result.outcome?.billingCertainty, 'settled_from_provider');
  });

  it('B — cero explícito: creditsCharged = 0 ⇒ settled_from_provider', async () => {
    const { fn } = mockFetch({
      status: 200,
      body: { results: [{ id: 'c1', name: 'Acme' }], billing: { creditsCharged: 0 } },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    // 🔴 El 0 no se rechaza «porque Prospecting normalmente cobra un mínimo». La
    // pregunta de la certeza es únicamente si el proveedor liquidó el valor, y
    // aquí lo liquidó: dijo cero.
    assert.equal(result.creditsCharged, 0);
    assert.equal(result.outcome?.billingCertainty, 'settled_from_provider');
  });

  it('C — `{"billing": {}}` ⇒ creditsCharged null y certeza unknown', async () => {
    const { fn } = mockFetch({
      status: 200,
      body: { results: [{ id: 'c1', name: 'Acme' }], billing: {} },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.creditsCharged, null, 'no se inventa un importe');
    // El sobre existe y sigue publicándose como diagnóstico…
    assert.equal(result.billingPresent, true);
    // …pero NO es liquidación. Éste es el defecto que cierra el corte.
    assert.equal(result.outcome?.billingCertainty, 'unknown');
    assert.notEqual(
      result.outcome?.billingCertainty,
      'settled_from_provider',
      'la presencia del bloque `billing` no puede volver a valer como liquidación',
    );
  });

  it('D — sin bloque `billing` ⇒ creditsCharged null y certeza unknown', async () => {
    const { fn } = mockFetch({ status: 200, body: { results: [{ id: 'c1', name: 'Acme' }] } });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.creditsCharged, null);
    assert.equal(result.billingPresent, false);
    assert.equal(result.outcome?.billingCertainty, 'unknown');
  });

  it('E — creditsCharged malformado ⇒ null y unknown, sin lanzar', async () => {
    // Formas que el extractor de billing YA existente no acepta como importe.
    const malformed: unknown[] = [null, '2', 'invalid', true, [], {}, { amount: 2 }];

    for (const creditsCharged of malformed) {
      const { fn } = mockFetch({
        status: 200,
        body: { results: [{ id: 'c1', name: 'Acme' }], billing: { creditsCharged } },
      });
      const result = await withFetch(fn as typeof globalThis.fetch, search);

      assert.equal(result.ok, true, `no lanza con creditsCharged=${JSON.stringify(creditsCharged)}`);
      assert.equal(
        result.creditsCharged,
        null,
        `importe ilegible no se convierte en cero: ${JSON.stringify(creditsCharged)}`,
      );
      assert.equal(
        result.outcome?.billingCertainty,
        'unknown',
        `importe ilegible no liquida: ${JSON.stringify(creditsCharged)}`,
      );
    }
  });

  it('la MISMA autoridad rige la rama sin resultados', async () => {
    // Un sobre vacío en la rama `no_results` sufría exactamente el mismo defecto.
    const empty = mockFetch({ status: 200, body: { results: [], total: 0, billing: {} } });
    const emptyResult = await withFetch(empty.fn as typeof globalThis.fetch, search);
    assert.equal(emptyResult.status, 'no_results');
    assert.equal(emptyResult.creditsCharged, null);
    assert.equal(emptyResult.outcome?.billingCertainty, 'unknown');

    // Y con importe liquidado —el 0 que Lusha devuelve en vivo para 0 resultados—
    // sí se afirma liquidación.
    const settled = mockFetch({
      status: 200,
      body: { results: [], total: 0, billing: { creditsCharged: 0 } },
    });
    const settledResult = await withFetch(settled.fn as typeof globalThis.fetch, search);
    assert.equal(settledResult.status, 'no_results');
    assert.equal(settledResult.creditsCharged, 0);
    assert.equal(settledResult.outcome?.billingCertainty, 'settled_from_provider');
  });

  it('la certeza publicada y el importe publicado no se contradicen', async () => {
    // Invariante del corte: `settled_from_provider` ⟺ hay importe leíble. Se
    // comprueba sobre las cuatro formas de cuerpo, en un solo barrido.
    const bodies: { body: Record<string, unknown>; settled: boolean }[] = [
      { body: { results: [{ id: 'c1' }], billing: { creditsCharged: 2 } }, settled: true },
      { body: { results: [{ id: 'c1' }], billing: { creditsCharged: 0 } }, settled: true },
      { body: { results: [{ id: 'c1' }], billing: {} }, settled: false },
      { body: { results: [{ id: 'c1' }] }, settled: false },
    ];

    for (const { body, settled } of bodies) {
      const { fn } = mockFetch({ status: 200, body });
      const result = await withFetch(fn as typeof globalThis.fetch, search);
      const claimsSettled = result.outcome?.billingCertainty === 'settled_from_provider';
      assert.equal(claimsSettled, settled, `certeza esperada para ${JSON.stringify(body)}`);
      assert.equal(
        claimsSettled,
        typeof result.creditsCharged === 'number',
        `la certeza debe acompañar al importe en ${JSON.stringify(body)}`,
      );
    }
  });

  it('la liquidación NO altera la taxonomía de fallo', async () => {
    // Un `settled_from_provider` sólo puede salir de un 2xx. Ningún fallo hereda
    // autoridad de facturación por tener bloque `billing` en el cuerpo de error.
    const { fn } = mockFetch({ status: 500, bodyText: '{"billing":{"creditsCharged":2}}' });
    const result = await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(result.outcome?.outcomeClass, 'http_5xx_provider_failure');
    assert.equal(result.outcome?.billingCertainty, 'definitely_not_charged');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-R · EL RATCHET DE CI
//
// Un corte cuyas guardas no corren en el check obligatorio no defiende nada:
// mergea igual. `automatic-routing-tests.yml` enumera sus pasos a mano, así que
// añadir el script a `package.json` no lo mete en el check — hay que invocarlo.
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-R — la suite de CUT-L2 corre en el check obligatorio', () => {
  it('el script existe y ejecuta ESTE archivo', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts['test:a1-lusha-cut-l2-failure-semantics'];
    assert.ok(script, 'el script test:a1-lusha-cut-l2-failure-semantics debe existir');
    assert.ok(
      script.includes('cut-l2-failure-semantics.test.ts'),
      'el script debe correr la suite dedicada del corte',
    );
  });

  it('el workflow del check obligatorio INVOCA el script', () => {
    const workflow = readRepoFile('.github/workflows/automatic-routing-tests.yml');
    // Se exige la línea `run:`, no la mención en prosa: un comentario que nombre
    // el script no lo ejecuta, y es exactamente el fallo que esta guarda pincha.
    // Se afirma sobre un BOOLEANO y no con `assert.match`, para que al fallar el
    // informe diga qué falta en vez de volcar las 250 000 letras del workflow.
    assert.equal(
      /^\s*run:\s*npm run test:a1-lusha-cut-l2-failure-semantics\s*$/m.test(workflow),
      true,
      'automatic-routing-tests.yml debe ejecutar npm run test:a1-lusha-cut-l2-failure-semantics',
    );
  });

  it('CUT-L1 sigue en el check: este corte no desplaza al anterior', () => {
    const workflow = readRepoFile('.github/workflows/automatic-routing-tests.yml');
    assert.equal(
      /^\s*run:\s*npm run test:a1-lusha-cut-l1-client-side-exclusion\s*$/m.test(workflow),
      true,
      'el paso de CUT-L1 debe seguir en el check obligatorio',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-K / L2-L · headers de cuota confirmados por el soporte HUMANO
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-K — headers de rate limit exactos', () => {
  it('los cuatro nombres confirmados son los que se leen', () => {
    assert.equal(LUSHA_RATE_LIMIT_HEADER_NAMES.minuteLimit, 'x-rate-limit-minute');
    assert.equal(LUSHA_RATE_LIMIT_HEADER_NAMES.minuteRemaining, 'x-minute-requests-left');
    assert.equal(LUSHA_RATE_LIMIT_HEADER_NAMES.dailyLimit, 'x-rate-limit-daily');
    assert.equal(LUSHA_RATE_LIMIT_HEADER_NAMES.dailyRemaining, 'x-daily-requests-left');
  });

  it('parsea los números exactos del contrato humano', async () => {
    const { fn } = mockFetch({
      status: 200,
      body: { results: [] },
      headers: {
        'x-rate-limit-minute': '100',
        'x-minute-requests-left': '73',
        'x-rate-limit-daily': '5000',
        'x-daily-requests-left': '4217',
      },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.rateLimit?.minuteLimit, 100);
    assert.equal(result.rateLimit?.minuteRemaining, 73);
    assert.equal(result.rateLimit?.dailyLimit, 5000);
    assert.equal(result.rateLimit?.dailyRemaining, 4217);
    assert.equal(result.rateLimit?.anyHeaderPresent, true);
  });

  it('los headers OBSOLETOS ya no son la fuente', async () => {
    // Sólo llegan los viejos: si el runtime siguiera leyéndolos, esto pasaría.
    const { fn } = mockFetch({
      status: 200,
      body: { results: [] },
      headers: {
        'x-ratelimit-limit': '999',
        'x-ratelimit-remaining': '888',
        'x-ratelimit-reset': '1720000000',
      },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.rateLimit?.minuteLimit, null);
    assert.equal(result.rateLimit?.minuteRemaining, null);
    assert.equal(result.rateLimit?.anyHeaderPresent, false);
  });

  it('no se hardcodea ningún tope de plan (40–300 RPM era ilustrativo)', () => {
    const src = parseLushaRateLimitHeaders(headersOf({ 'x-rate-limit-minute': '40' }));
    assert.equal(src.minuteLimit, 40, 'el header manda');
    const other = parseLushaRateLimitHeaders(headersOf({ 'x-rate-limit-minute': '7' }));
    assert.equal(other.minuteLimit, 7, 'un valor fuera del rango citado se respeta igual');
  });
});

describe('L2-L — headers ausentes o corruptos', () => {
  it('ausentes ⇒ null, sin lanzar', () => {
    const snap = parseLushaRateLimitHeaders(headersOf({}));
    assert.equal(snap.minuteLimit, null);
    assert.equal(snap.minuteRemaining, null);
    assert.equal(snap.dailyLimit, null);
    assert.equal(snap.dailyRemaining, null);
    assert.equal(snap.anyHeaderPresent, false);
  });

  it('valores no numéricos, vacíos, decimales o negativos ⇒ null, sin lanzar', () => {
    const snap = parseLushaRateLimitHeaders(
      headersOf({
        'x-rate-limit-minute': 'abc',
        'x-minute-requests-left': '   ',
        'x-rate-limit-daily': '-5',
        'x-daily-requests-left': '12.5',
      }),
    );
    assert.equal(snap.minuteLimit, null);
    assert.equal(snap.minuteRemaining, null);
    assert.equal(snap.dailyLimit, null, 'un contador de cuota no puede ser negativo');
    assert.equal(snap.dailyRemaining, null);
    assert.equal(snap.anyHeaderPresent, false);
  });

  it('"0" es un valor REAL, no un ausente', () => {
    const snap = parseLushaRateLimitHeaders(headersOf({ 'x-minute-requests-left': '0' }));
    assert.equal(snap.minuteRemaining, 0, 'cuota agotada ≠ header ausente');
    assert.equal(snap.anyHeaderPresent, true);
  });

  it('un objeto de headers hostil no rompe el parseo', () => {
    const hostile = { get: () => { throw new Error('boom'); } };
    const snap = parseLushaRateLimitHeaders(hostile);
    assert.equal(snap.anyHeaderPresent, false);
    assert.equal(readLushaProviderRequestId(hostile), null);
  });

  it('headers ausentes no rompen la respuesta completa', async () => {
    const { fn } = mockFetch({ status: 200, body: { results: [], total: 0 } });
    const result = await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(result.ok, true);
    assert.equal(result.rateLimit?.anyHeaderPresent, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-M / L2-N / L2-O · trace de petición
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-M — x-request-id capturado', () => {
  it('se captura EXACTAMENTE el header del servidor', async () => {
    const { fn } = mockFetch({
      status: 200,
      body: { results: [] },
      headers: { 'x-request-id': 'req_abc123' },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(result.providerRequestId, 'req_abc123');
  });

  it('también se captura en un fallo — es cuando más sirve para soporte', async () => {
    const { fn } = mockFetch({
      status: 500,
      bodyText: 'boom',
      headers: { 'x-request-id': 'req_err_9' },
    });
    const result = await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(result.providerRequestId, 'req_err_9');
  });
});

describe('L2-N — sin x-request-id', () => {
  it('ausente ⇒ null, sin sustituto fabricado', async () => {
    const { fn } = mockFetch({ status: 200, body: { results: [] } });
    const result = await withFetch(fn as typeof globalThis.fetch, search);
    assert.equal(result.providerRequestId, null);
  });

  it('vacío o sólo espacios ⇒ null', () => {
    assert.equal(readLushaProviderRequestId(headersOf({ 'x-request-id': '   ' })), null);
    assert.equal(readLushaProviderRequestId(headersOf({})), null);
  });
});

describe('L2-O — el id de SellUp NO es el id de Lusha', () => {
  it('un client_request_id de SellUp jamás se publica como providerRequestId', async () => {
    // El wizard viaja con un `client_request_id` UUID propio. Si el runtime lo
    // usara como sustituto del header, esto lo cazaría.
    const SELLUP_CLIENT_REQUEST_ID = '11111111-1111-4111-8111-111111111111';
    const { fn } = mockFetch({ status: 200, body: { results: [] } });
    const result = await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(result.providerRequestId, null);
    assert.notEqual(result.providerRequestId, SELLUP_CLIENT_REQUEST_ID);
  });

  // 🔴 Las DOS ramas de 2xx se prueban a propósito. Con sólo la de cero
  // resultados, una mutación que aliase el id en la rama con resultados pasaba
  // verde: el fixture nunca llegaba a ejecutarla. Lo encontró la batería M7.
  for (const [label, results] of [
    ['sin resultados (rama no_results)', []],
    ['con resultados (rama success)', [{ id: 'c1', name: 'Acme', domain: 'acme.com' }]],
  ] as const) {
    it(`el trace del proveedor sale SÓLO del header, no del cuerpo — ${label}`, async () => {
      // El cuerpo trae un `requestId` distinto: `requestId` (legacy) puede leerlo,
      // pero `providerRequestId` es el header y nada más.
      const { fn } = mockFetch({
        status: 200,
        body: { results, requestId: 'body-level-id' },
        headers: { 'x-request-id': 'header-level-id' },
      });
      const result = await withFetch(fn as typeof globalThis.fetch, search);

      assert.equal(result.providerRequestId, 'header-level-id');
      assert.equal(result.requestId, 'body-level-id', 'el campo legacy no cambia');
      assert.notEqual(result.providerRequestId, result.requestId);
    });
  }

  it('x-request-id se publica en AMBAS ramas de 2xx', async () => {
    for (const results of [[], [{ id: 'c1', name: 'Acme' }]]) {
      const { fn } = mockFetch({
        status: 200,
        body: { results },
        headers: { 'x-request-id': 'req_both' },
      });
      const result = await withFetch(fn as typeof globalThis.fetch, search);
      assert.equal(result.providerRequestId, 'req_both');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § H · el indeterminado NO puede llegar a un replay automático
// ═══════════════════════════════════════════════════════════════════════════

describe('§ H — replay automático cerrado para el indeterminado', () => {
  it('la consulta canónica niega el reintento del indeterminado', () => {
    const indeterminate = classifyLushaProspectingOutcome({
      httpStatus: null,
      requestDispatched: true,
      timedOut: true,
    });
    assert.equal(mayAutomaticallyRetryLushaProspecting(indeterminate), false);

    const malformed = classifyLushaProspectingOutcome({
      httpStatus: 200,
      requestDispatched: true,
      malformedBody: true,
    });
    assert.equal(mayAutomaticallyRetryLushaProspecting(malformed), false);

    const http499 = classifyLushaProspectingOutcome({ httpStatus: 499, requestDispatched: true });
    assert.equal(mayAutomaticallyRetryLushaProspecting(http499), false);

    // Lo que el contrato SÍ permite (aunque este corte no lo ejecute):
    assert.equal(
      mayAutomaticallyRetryLushaProspecting(
        classifyLushaProspectingOutcome({ httpStatus: 429, requestDispatched: true }),
      ),
      true,
    );
    assert.equal(
      mayAutomaticallyRetryLushaProspecting(
        classifyLushaProspectingOutcome({ httpStatus: 503, requestDispatched: true }),
      ),
      true,
    );
  });

  it('un timeout post-despacho no produce una segunda llamada HTTP', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    const { fn, calls } = throwingFetch(abort);
    await withFetch(fn as unknown as typeof globalThis.fetch, search);
    assert.equal(calls.length, 1, 'cero replay');
  });

  it('el núcleo compartido tampoco reintenta tras un indeterminado', async () => {
    let providerCalls = 0;
    const result = await executeLushaPreview(
      {
        resolveApiKey: async () => FAKE_API_KEY,
        searchCompanies: async () => {
          providerCalls++;
          return {
            ok: false,
            status: 'provider_timeout' as const,
            resultsReturned: 0,
            outcome: classifyLushaProspectingOutcome({
              httpStatus: null,
              requestDispatched: true,
              timedOut: true,
            }),
          };
        },
      },
      PREVIEW_INPUT,
    );

    assert.equal(providerCalls, 1, 'una y sólo una petición');
    assert.equal(result.ok, false);
    assert.equal(result.providerOutcome?.outcomeClass, 'post_send_indeterminate');
    assert.equal(result.providerOutcome?.retryContract, 'do_not_automatically_retry');
    assert.equal(result.providerOutcome?.billingCertainty, 'potentially_charged');
    // Un fallo NO es «cero empresas»: no se fabrican candidatos.
    assert.equal(result.results.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § P · las dos rutas reales comparten la MISMA taxonomía
// ═══════════════════════════════════════════════════════════════════════════

describe('§ P — paridad entre rutas', () => {
  it('el núcleo compartido publica el desenlace del proveedor tal cual', async () => {
    for (const [status, expected] of [
      [429, 'http_429_rate_limited'],
      [500, 'http_5xx_provider_failure'],
      [499, 'post_send_indeterminate'],
      [400, 'http_4xx_non_retryable'],
    ] as const) {
      const { fn } = mockFetch({ status, bodyText: 'x' });
      const result = await withFetch(fn as typeof globalThis.fetch, () =>
        executeLushaPreview(
          {
            resolveApiKey: async () => FAKE_API_KEY,
            searchCompanies: (apiKey, request) =>
              searchLushaCompaniesV3({ apiKey, timeoutMs: TIMEOUT_MS, request }),
          },
          PREVIEW_INPUT,
        ),
      );
      assert.equal(result.providerOutcome?.outcomeClass, expected, `status ${status}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2-P · CUT-L1 no se regresa
// ═══════════════════════════════════════════════════════════════════════════

describe('L2-P — regresión de CUT-L1', () => {
  it('la petición emitida NO lleva bloque de exclusión', async () => {
    const { fn, calls } = mockFetch({ status: 200, body: { results: [] } });
    await withFetch(fn as typeof globalThis.fetch, search);

    assert.equal(calls.length, 1);
    const body = calls[0]?.body as Record<string, unknown>;
    const filters = body['filters'] as Record<string, unknown>;
    const companies = filters['companies'] as Record<string, unknown>;

    assert.equal(companies['exclude'], undefined, 'Lusha V3 no soporta exclusión server-side');
    assert.ok(companies['include'], 'la petición es de INCLUSIÓN pura');
    assert.ok(!JSON.stringify(body).includes('exclude'), 'ni rastro de exclusión en el body');
  });

  it('el núcleo compartido tampoco reintroduce exclusión', async () => {
    const { fn, calls } = mockFetch({ status: 200, body: { results: [] } });
    await withFetch(fn as typeof globalThis.fetch, () =>
      executeLushaPreview(
        {
          resolveApiKey: async () => FAKE_API_KEY,
          searchCompanies: (apiKey, request) =>
            searchLushaCompaniesV3({ apiKey, timeoutMs: TIMEOUT_MS, request }),
        },
        PREVIEW_INPUT,
      ),
    );

    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(calls[0]?.body).includes('exclude'));
  });
});
