/**
 * Tests — techo de espera de la búsqueda de empresas en HubSpot
 * (AGENT2A-PROD-INCIDENT · incidente B, contact search).
 *
 * Incidente de Producción: buscar una empresa en el drawer «Enriquecer
 * contactos» se quedaba indefinidamente en «Buscando en SellUp y HubSpot…».
 *
 * Esta petición era el ÚNICO `fetch` del flujo sin techo de espera. Sin techo, un
 * HubSpot que no responde deja el server action esperando para siempre: la
 * plataforma acaba matando la invocación y el cliente se queda con el spinner.
 *
 * Casos cubiertos:
 *   A. la petición lleva un AbortSignal (sin él no hay techo posible)
 *   B. el techo por defecto es un número de milisegundos usable
 *   C. el techo es configurable por llamada y el signal lo respeta
 *   D. un techo ya vencido aborta: la petición NO se queda esperando
 *   E. el rechazo del abort se propaga (los llamadores lo convierten en tipado)
 *   F. sigue siendo una petición de solo lectura al endpoint de búsqueda
 *
 * Antes del fix, A/C/D/E fallan y B no compila (no existía la constante).
 *
 * 0 red real: `fetch` está sustituido en todos los casos menos D, donde el abort
 * ocurre antes de que se intente cualquier conexión. 0 escrituras en HubSpot,
 * 0 proveedores de pago, 0 créditos, 0 PII.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  postHubSpotCompanySearch,
  HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS,
  HUBSPOT_COMPANY_SEARCH_URL,
} from '../hubspot-company-search-request';

const FAKE_TOKEN = 'fake-hubspot-token';
const FAKE_BODY = { query: 'Empresa Ficticia', limit: 5 };

type FetchCall = { url: string; init: RequestInit };

const calls: FetchCall[] = [];
let originalFetch: typeof globalThis.fetch;

function installFetch(impl: (url: string, init: RequestInit) => Promise<Response>): void {
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return impl(String(input), init ?? {});
  }) as typeof globalThis.fetch;
}

function emptyOk(): Promise<Response> {
  return Promise.resolve({ ok: true, json: async () => ({ results: [] }) } as unknown as Response);
}

describe('AGENT2A-PROD-INCIDENT — techo de espera de HubSpot company search', () => {
  before(() => {
    originalFetch = globalThis.fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it('A. la petición lleva un AbortSignal', async () => {
    installFetch(() => emptyOk());

    await postHubSpotCompanySearch(FAKE_TOKEN, FAKE_BODY);

    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].init.signal instanceof AbortSignal,
      'sin AbortSignal la espera no tiene techo: es el defecto del incidente',
    );
    assert.equal(calls[0].init.signal?.aborted, false, 'no debe llegar abortado de entrada');
  });

  it('B. el techo por defecto es un número de milisegundos usable', () => {
    assert.equal(typeof HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS, 'number');
    assert.ok(
      Number.isFinite(HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS) &&
        HUBSPOT_COMPANY_SEARCH_TIMEOUT_MS > 0,
      'un techo no finito o no positivo no acota nada',
    );
  });

  it('C. el techo es configurable por llamada y el signal lo respeta', async () => {
    installFetch(() => emptyOk());

    await postHubSpotCompanySearch(FAKE_TOKEN, FAKE_BODY, 25);
    const signal = calls[0].init.signal as AbortSignal;
    assert.equal(signal.aborted, false, 'aún no ha vencido');

    // Se espera a que venza el techo diminuto: el signal debe abortarse SOLO.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(
      signal.aborted,
      true,
      'al vencer el techo el signal debe abortar por su cuenta',
    );
  });

  it('D. un techo ya vencido aborta la petición en vez de esperar', async () => {
    // Sin doble de `fetch`: con techo 0 el abort ocurre antes de intentar
    // cualquier conexión, así que no sale nada a la red.
    globalThis.fetch = originalFetch;

    await assert.rejects(
      () => postHubSpotCompanySearch(FAKE_TOKEN, FAKE_BODY, 0),
      (err: unknown) => {
        const name = (err as { name?: string }).name;
        assert.ok(
          name === 'TimeoutError' || name === 'AbortError',
          `el fallo debe ser un abort, no otro error (fue: ${String(name)})`,
        );
        return true;
      },
      'un techo vencido debe TERMINAR la petición, no dejarla esperando',
    );
  });

  it('E. el rechazo del abort se propaga al llamador', async () => {
    installFetch(() =>
      Promise.reject(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      ),
    );

    // Propagar es lo correcto: es lo que distingue «HubSpot no contestó» de
    // «HubSpot contestó sin coincidencias». Los llamadores ya lo capturan.
    await assert.rejects(() => postHubSpotCompanySearch(FAKE_TOKEN, FAKE_BODY), /aborted/);
  });

  it('F. sigue siendo una petición de solo lectura al endpoint de búsqueda', async () => {
    installFetch(() => emptyOk());

    await postHubSpotCompanySearch(FAKE_TOKEN, FAKE_BODY);

    assert.equal(calls[0].url, HUBSPOT_COMPANY_SEARCH_URL);
    assert.equal(calls[0].init.method, 'POST', 'la búsqueda de HubSpot es un POST de lectura');
    assert.ok(
      HUBSPOT_COMPANY_SEARCH_URL.includes('/objects/companies/search'),
      'el endpoint debe seguir siendo el de búsqueda, no uno de escritura',
    );
  });
});
