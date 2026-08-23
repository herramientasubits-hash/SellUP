/**
 * Tests — el RUNTIME REAL de la resolución de identidad cross-provider
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 · PR331-R2)
 *
 * ═══════════════════════════════════════════════════════════════
 * QUÉ SE AFIRMA AQUÍ, Y POR QUÉ NO EN OTRO SITIO
 * ═══════════════════════════════════════════════════════════════
 *
 * `cross-provider-phone-identity-resolution.test.ts` prueba el core PURO: dado un mundo
 * de hechos, qué decide. Lo que NO puede ver es si ese core está enchufado a algo — un
 * core impecable con una dep opcional que nadie cablea no llama a nadie, no persiste
 * nada, y aprueba todos sus tests.
 *
 * Esta suite mira exactamente eso: el ADAPTADOR REAL
 * (`lusha-identity-resolution-deps.ts`) y su punto de cableado
 * (`buildContinueWaterfallDeps`). El contador que más se vigila es
 * `world.searchClientCalls`: en este subsistema casi todo defecto caro se manifiesta
 * como una llamada de más a `POST /v3/contacts/search`, que cobra 1 crédito por
 * petición vía `api_search` incluso cuando no devuelve resultados.
 *
 * ═══════════════════════════════════════════════════════════════
 * CONTRATO FIJADO
 * ═══════════════════════════════════════════════════════════════
 *
 *   Cliente        se reutiliza `searchLushaContactsV3()` con `getLushaApiKey()` y
 *                  `resolveLushaSearchTimeoutMs()`. NO hay un segundo cliente de Lusha.
 *   Identidad ya    identidad persistida ⇒ 0 llamadas al cliente, 0 claims, 0 RPC de
 *   conocida        persistencia. El ahorro es para siempre, no para una corrida.
 *   Camino feliz    candidato Apollo sin identidad ⇒ EXACTAMENTE 1 llamada al cliente,
 *                  1 persistencia, y un id NATIVO de Lusha de vuelta para el reveal.
 *   Terminales      0 resultados / 2 resultados / empresa que no encaja / error ⇒ NO se
 *                  devuelve id, así que el reveal no puede correr.
 *   Persistencia    escritura fallida ⇒ fail-closed. Sin id, sin reveal, y la evidencia
 *                  económica de la búsqueda conservada.
 *   Flag OFF        `ENABLE_PHONE_REVEAL_WATERFALL` apagado ⇒ la dep NO se cablea, no se
 *                  lee `contact_provider_identities`, no se invoca
 *                  `claim_lusha_identity_search` y no sale ninguna petición.
 *   Ledger          Search y Reveal comparten `reservation_group_id` y
 *                  `phone_reveal_run_id`, y se distinguen por `operation_key`.
 *   PII             ninguna fila de usage lleva datos personales ni ids de proveedor.
 *
 * Offline por construcción: sin red, sin Supabase, sin Lusha, 0 créditos.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  LUSHA_IDENTITY_SEARCH_OPERATION_KEY,
  LUSHA_PHONE_REVEAL_OPERATION_KEY,
  findForbiddenUsageLogMetadataKeys,
} from '../phone-reveal-usage-log-core';

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════
//
// Un test que pasara porque el módulo llamó de verdad a Lusha no probaría nada — y en
// este subsistema costaría dinero. Cualquier fetch que se escape queda registrado y es
// un fallo explícito.

const originalFetch = globalThis.fetch;
let httpRequests: string[] = [];

globalThis.fetch = (async (input: unknown): Promise<Response> => {
  const url =
    typeof input === 'string' ? input : ((input as { url?: string })?.url ?? String(input));
  httpRequests.push(url);
  return new Response('{}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════════
// El mundo simulado
// ═══════════════════════════════════════════════════════════════

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '33333333-3333-4333-8333-333333333333';
const AUTHORIZED_BY = '44444444-4444-4444-8444-444444444444';
const LUSHA_ID = 'lusha-contact-abc';

interface SearchClientResponse {
  ok: boolean;
  status: string;
  resultsReturned: number;
  creditsCharged?: number | null;
  requestId?: string | null;
  sanitizedResults?: Array<{
    id: string | null;
    fullName: string | null;
    title: string | null;
    companyName: string | null;
    companyDomain: string | null;
    linkedinUrl: string | null;
    has: unknown;
    canReveal: unknown;
  }>;
}

function searchResult(
  results: Array<{ id: string | null; companyName?: string | null; companyDomain?: string | null }>,
  creditsCharged: number | null = 1,
): SearchClientResponse {
  return {
    ok: true,
    status: 'success',
    resultsReturned: results.length,
    creditsCharged,
    requestId: 'req-1',
    sanitizedResults: results.map((r) => ({
      id: r.id,
      // El cliente REAL sí devuelve estos campos. Están aquí a propósito para poder
      // afirmar que el adaptador NO los propaga hacia el ledger.
      fullName: 'Ana Ruiz',
      title: 'Head of People',
      companyName: r.companyName ?? 'ACME',
      companyDomain: r.companyDomain ?? 'acme.com',
      linkedinUrl: 'https://www.linkedin.com/in/ana-ruiz',
      has: { phones: true },
      canReveal: true,
    })),
  };
}

const world = {
  waterfallEnabled: true,
  apiKey: 'lusha-key' as string | null,
  /** Filas de `contact_provider_identities` para el candidato. */
  identityRows: [] as Array<Record<string, unknown>>,
  identityReadError: null as { message: string } | null,
  candidateRow: null as Record<string, unknown> | null,
  candidateReadError: null as { message: string } | null,
  claimResult: 'claimed' as string,
  claimError: null as { message: string } | null,
  persistEnvelope: { status: 'inserted' } as Record<string, unknown>,
  persistError: null as { message: string } | null,
  searchResponse: searchResult([{ id: LUSHA_ID }]) as SearchClientResponse,
  searchThrows: false,

  // ── contadores observables ──
  searchClientCalls: 0,
  claimRpcCalls: 0,
  persistRpcCalls: 0,
  identityTableReads: 0,
  outcomeSeals: [] as Array<Record<string, unknown>>,
  usageLogs: [] as Array<Record<string, unknown>>,
  tablesTouched: [] as string[],
  rpcsCalled: [] as string[],
  /** Cadenas exactas de `select`, para poder afirmar qué COLUMNAS se piden. */
  selects: [] as Array<{ table: string; columns: string }>,
  reservationRows: [] as Array<Record<string, unknown>>,
};

function candidateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CANDIDATE_ID,
    source: 'apollo',
    source_contact_id: 'apollo-person-99',
    first_name: 'Ana',
    last_name: 'Ruiz',
    linkedin_url: 'https://www.linkedin.com/in/ana-ruiz',
    email: 'ana@acme.com',
    run: { company_name: 'ACME', company_domain: 'acme.com' },
    ...overrides,
  };
}

beforeEach(() => {
  httpRequests = [];
  world.waterfallEnabled = true;
  world.apiKey = 'lusha-key';
  world.identityRows = [];
  world.identityReadError = null;
  world.candidateRow = candidateRow();
  world.candidateReadError = null;
  world.claimResult = 'claimed';
  world.claimError = null;
  world.persistEnvelope = { status: 'inserted' };
  world.persistError = null;
  world.searchResponse = searchResult([{ id: LUSHA_ID }]);
  world.searchThrows = false;

  world.searchClientCalls = 0;
  world.claimRpcCalls = 0;
  world.persistRpcCalls = 0;
  world.identityTableReads = 0;
  world.outcomeSeals = [];
  world.usageLogs = [];
  world.tablesTouched = [];
  world.rpcsCalled = [];
  world.selects = [];
  world.reservationRows = [
    { id: 'r-search', provider_key: 'lusha', credits_reserved: 1, status: 'reserved', operation_key: 'contact_search' },
    { id: 'r-reveal', provider_key: 'lusha', credits_reserved: 5, status: 'reserved', operation_key: 'phone_reveal' },
  ];
});

/** Cadena PostgREST simulada: cualquier método encadena, y `await` resuelve. */
function chain(
  result: { data: unknown; error: { message: string } | null },
  table?: string,
): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'single', 'update', 'insert']) {
    self[method] = () => self;
  }
  self.select = (columns?: unknown) => {
    if (table && typeof columns === 'string') {
      world.selects.push({ table, columns });
    }
    return self;
  };
  self.then = (resolve: (v: unknown) => unknown): unknown => resolve(result);
  return self;
}

/**
 * Variante de `chain` que respeta la proyección: devuelve de cada fila SÓLO las
 * columnas nombradas en el `select`, igual que PostgREST.
 */
function projectingChain(
  table: string,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  let columns: string[] | null = null;
  for (const method of ['eq', 'in', 'is', 'order', 'limit']) {
    self[method] = () => self;
  }
  self.select = (raw?: unknown) => {
    if (typeof raw === 'string') {
      world.selects.push({ table, columns: raw });
      columns = raw.split(',').map((c) => c.trim()).filter(Boolean);
    }
    return self;
  };
  self.then = (resolve: (v: unknown) => unknown): unknown =>
    resolve({
      data: rows.map((row) =>
        columns === null
          ? row
          : Object.fromEntries(
              columns.filter((c) => c in row).map((c) => [c, row[c]]),
            ),
      ),
      error: null,
    });
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        world.tablesTouched.push(table);

        if (table === 'contact_provider_identities') {
          world.identityTableReads += 1;
          return chain(
            {
              data: world.identityReadError ? null : world.identityRows,
              error: world.identityReadError,
            },
            table,
          );
        }
        if (table === 'contact_enrichment_candidates') {
          return chain(
            {
              data: world.candidateReadError ? null : world.candidateRow,
              error: world.candidateReadError,
            },
            table,
          );
        }
        if (table === 'phone_reveal_credit_reservations') {
          // PROYECTA como PostgREST: una columna que el `select` no pide NO vuelve. Sin
          // esto el test no podría distinguir «no se pidió operation_key» de «se pidió y
          // se ignoró», que es justo la diferencia que aquí importa.
          return projectingChain(table, world.reservationRows);
        }
        if (table === 'phone_reveal_waterfall_runs') {
          const base = chain(
            {
              data: { credit_reservation_group_id: GROUP_ID, authorized_by: AUTHORIZED_BY },
              error: null,
            },
            table,
          );
          return {
            ...base,
            select: (columns?: unknown) => {
              if (typeof columns === 'string') world.selects.push({ table, columns });
              return base;
            },
            update: (patch: Record<string, unknown>) => {
              world.outcomeSeals.push(patch);
              return chain({ data: null, error: null });
            },
          };
        }
        return chain({ data: null, error: null });
      },
      rpc: (fn: string, params: Record<string, unknown>) => {
        world.rpcsCalled.push(fn);
        if (fn === 'claim_lusha_identity_search') {
          world.claimRpcCalls += 1;
          return chain({
            data: world.claimError ? null : world.claimResult,
            error: world.claimError,
          });
        }
        if (fn === 'persist_contact_provider_identity') {
          world.persistRpcCalls += 1;
          // El adaptador tiene que mandar SIEMPRE 'lusha': mandar el proveedor del
          // candidato es literalmente el alias que este hito prohíbe.
          assert.equal(params.p_provider_key, 'lusha');
          return chain({
            data: world.persistError ? null : world.persistEnvelope,
            error: world.persistError,
          });
        }
        return chain({ data: null, error: null });
      },
    }),
  },
});

mock.module('@/lib/feature-flags.server', {
  namedExports: {
    isPhoneRevealWaterfallEnabled: () => world.waterfallEnabled,
    isPhoneRevealWaterfallFlagConfigured: () => true,
    isLushaPhoneRevealFallbackEnabled: () => true,
    resolveLushaSearchTimeoutMs: () => 10_000,
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: {
    getLushaApiKey: async () => world.apiKey,
  },
});

// EL cliente canónico. Que esta suite lo cuente es la prueba de que no existe un
// segundo cliente: si el adaptador hablara con Lusha por otra vía, el contador se
// quedaría en 0 y el `fetch` interceptado registraría la llamada.
mock.module('@/server/integrations/lusha-client', {
  namedExports: {
    searchLushaContactsV3: async (input: Record<string, unknown>) => {
      world.searchClientCalls += 1;
      // El contrato del endpoint: UN item por petición, con la credencial y el timeout
      // resueltos por las autoridades canónicas.
      assert.equal(input.apiKey, 'lusha-key');
      assert.equal(input.timeoutMs, 10_000);
      assert.equal((input.contacts as unknown[]).length, 1);
      if (world.searchThrows) throw new Error('network exploded with sensitive detail');
      return world.searchResponse;
    },
  },
});

mock.module('@/modules/usage-tracking/logging', {
  namedExports: {
    logProviderUsage: async (entry: Record<string, unknown>) => {
      world.usageLogs.push(entry);
      return true;
    },
  },
});

// El adaptador se carga en un hook y NO con un `await` de nivel superior: tsx compila
// estos .ts a CJS, donde el top-level await no existe (trampa ya documentada del repo).
type IdentityDepsModule = typeof import('../lusha-identity-resolution-deps');
let identityDeps: IdentityDepsModule;

before(async () => {
  identityDeps = await import('../lusha-identity-resolution-deps');
});

function resolve() {
  return identityDeps.resolveLushaIdentityForCandidate({
    candidateId: CANDIDATE_ID,
    runId: RUN_ID,
  });
}

const persistedLushaRow = {
  candidate_id: CANDIDATE_ID,
  provider_key: 'lusha',
  provider_contact_id: LUSHA_ID,
  resolution_source: 'provider_search_linkedin_url',
};

// ═══════════════════════════════════════════════════════════════
// 3 — Camino feliz: candidato Apollo, ninguna identidad Lusha
// ═══════════════════════════════════════════════════════════════

describe('adaptador real — candidato Apollo sin identidad Lusha', () => {
  it('EXACTAMENTE 1 llamada al cliente, 1 persistencia, y el id nativo de vuelta', async () => {
    const result = await resolve();

    assert.equal(world.searchClientCalls, 1, 'search client calls = 1');
    assert.equal(world.persistRpcCalls, 1, 'persist = 1');
    assert.equal(world.claimRpcCalls, 1, 'un solo claim');
    assert.equal(result.status, 'ready', 'el reveal puede continuar');
    if (result.status !== 'ready') return;
    assert.equal(result.contactId, LUSHA_ID);
    assert.equal(result.runOutcome, 'resolved');
  });

  it('el id que viaja al reveal es el de LUSHA, nunca el de Apollo', async () => {
    const result = await resolve();
    if (result.status !== 'ready') {
      assert.fail('se esperaba ready');
      return;
    }
    // El HTTP 422 del RCA del reveal asíncrono era exactamente esto: el id de Apollo
    // enviado a Lusha.
    assert.notEqual(result.contactId, 'apollo-person-99');
    assert.equal(result.contactId, LUSHA_ID);
  });

  it('el claim va ANTES de la petición, y la persistencia ANTES del id devuelto', async () => {
    await resolve();
    assert.deepEqual(world.rpcsCalled, [
      'claim_lusha_identity_search',
      'persist_contact_provider_identity',
    ]);
  });

  it('reutiliza las autoridades canónicas: 0 fetch propio', async () => {
    await resolve();
    assert.deepEqual(httpRequests, [], 'ninguna petición real salió de este proceso');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 — Identidad ya persistida
// ═══════════════════════════════════════════════════════════════

describe('adaptador real — identidad ya persistida', () => {
  beforeEach(() => {
    world.identityRows = [persistedLushaRow];
  });

  it('0 llamadas al cliente de búsqueda', async () => {
    const result = await resolve();
    assert.equal(world.searchClientCalls, 0, 'search client calls = 0');
    assert.equal(result.status, 'ready');
  });

  it('0 claims y 0 escrituras: no se toca nada que ya está resuelto', async () => {
    await resolve();
    assert.equal(world.claimRpcCalls, 0);
    assert.equal(world.persistRpcCalls, 0);
  });

  it('reutiliza el id persistido y lo declara como reuso, no como compra', async () => {
    const result = await resolve();
    if (result.status !== 'ready') {
      assert.fail('se esperaba ready');
      return;
    }
    assert.equal(result.contactId, LUSHA_ID);
    assert.equal(result.runOutcome, 'reused_persisted');
    assert.equal(result.searched, false);
  });

  it('0 filas de usage: no hubo gasto que contabilizar', async () => {
    await resolve();
    assert.equal(world.usageLogs.length, 0);
  });

  it('una identidad de APOLLO no vale como identidad de Lusha', async () => {
    world.identityRows = [
      {
        candidate_id: CANDIDATE_ID,
        provider_key: 'apollo',
        provider_contact_id: 'apollo-person-99',
        resolution_source: 'provider_native_origin',
      },
    ];
    const result = await resolve();
    // Hay identidad, pero no la del proveedor que va a cobrar: se busca.
    assert.equal(world.searchClientCalls, 1);
    assert.equal(result.status, 'ready');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 / 5 — Desenlaces terminales: ninguno habilita un reveal
// ═══════════════════════════════════════════════════════════════

describe('adaptador real — desenlaces terminales', () => {
  const cases = [
    {
      label: '0 resultados',
      arrange: () => {
        world.searchResponse = { ok: true, status: 'no_results', resultsReturned: 0, creditsCharged: 1 };
      },
      skippedReason: 'lusha_identity_not_found',
      runOutcome: 'not_found',
    },
    {
      label: '2 resultados (jamás se elige el primero)',
      arrange: () => {
        world.searchResponse = searchResult([{ id: 'lusha-a' }, { id: 'lusha-b' }]);
      },
      skippedReason: 'lusha_identity_ambiguous',
      runOutcome: 'ambiguous',
    },
    {
      label: '1 resultado con empresa que NO encaja',
      arrange: () => {
        world.searchResponse = searchResult([
          { id: 'lusha-x', companyName: 'Otra', companyDomain: 'otra.com' },
        ]);
      },
      skippedReason: 'lusha_identity_ambiguous',
      runOutcome: 'ambiguous',
    },
    {
      label: 'timeout del proveedor',
      arrange: () => {
        world.searchResponse = { ok: false, status: 'provider_timeout', resultsReturned: 0 };
      },
      skippedReason: 'lusha_identity_error',
      runOutcome: 'error',
    },
    {
      label: 'saldo insuficiente en el proveedor (NO es "no existe")',
      arrange: () => {
        world.searchResponse = { ok: false, status: 'insufficient_credits', resultsReturned: 0 };
      },
      skippedReason: 'lusha_identity_error',
      runOutcome: 'error',
    },
  ] as const;

  for (const c of cases) {
    it(`${c.label} ⇒ sin id, sin reveal`, async () => {
      c.arrange();
      const result = await resolve();

      assert.equal(result.status, 'blocked', 'el reveal NO puede continuar');
      if (result.status !== 'blocked') return;
      assert.equal(result.skippedReason, c.skippedReason);
      assert.equal(result.runOutcome, c.runOutcome);
      // La petición salió: su reserva se liquida, nunca se libera como si fuese gratis.
      assert.equal(result.searched, true);
      assert.equal(world.searchClientCalls, 1, 'una sola petición, sin cascada');
      assert.equal(world.persistRpcCalls, 0, 'nada que persistir');
    });
  }

  it('sin identificador exacto NO se emite petición: 0 llamadas y 0 créditos', async () => {
    world.candidateRow = candidateRow({
      linkedin_url: null,
      email: null,
      last_name: null,
      run: { company_name: null, company_domain: null },
    });
    const result = await resolve();

    assert.equal(world.searchClientCalls, 0, 'search client calls = 0');
    assert.equal(world.claimRpcCalls, 0, 'ni se reclama lo que no se va a pedir');
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.runOutcome, 'no_identifier');
    assert.equal(result.searched, false, 'no costó nada');
  });

  it('un throw del cliente NO se lee como costo 0', async () => {
    world.searchThrows = true;
    const result = await resolve();
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.runOutcome, 'error');
    assert.equal(result.searched, true, 'la petición pudo salir y cobrarse');
  });

  it('claim perdido ⇒ 0 llamadas, 0 escrituras', async () => {
    world.claimResult = 'already_claimed';
    const result = await resolve();
    assert.equal(result.status, 'claim_lost');
    assert.equal(world.searchClientCalls, 0);
    assert.equal(world.persistRpcCalls, 0);
  });

  it('claim con RPC ausente (migración 124 sin aplicar) ⇒ fail-closed, 0 llamadas', async () => {
    world.claimError = { message: 'function claim_lusha_identity_search does not exist' };
    const result = await resolve();
    // Un fallo de infraestructura NUNCA es permiso para gastar.
    assert.equal(result.status, 'claim_lost');
    assert.equal(world.searchClientCalls, 0, 'search client calls = 0');
  });

  it('sin credencial de Lusha ⇒ 0 llamadas al cliente y fail-closed', async () => {
    world.apiKey = null;
    const result = await resolve();
    assert.equal(world.searchClientCalls, 0);
    assert.equal(result.status, 'blocked');
  });

  it('identidades ilegibles ⇒ NO se busca a ciegas', async () => {
    world.identityReadError = { message: 'relation contact_provider_identities does not exist' };
    const result = await resolve();
    // Buscar aquí podría estar comprando algo que ya teníamos.
    assert.equal(world.searchClientCalls, 0, 'search client calls = 0');
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 1 — Persistencia obligatoria, vista desde el adaptador
// ═══════════════════════════════════════════════════════════════

describe('adaptador real — la persistencia es una precondición', () => {
  const failures = [
    { label: 'el driver reporta error', arrange: () => { world.persistError = { message: 'write failed' }; } },
    { label: 'invalid_input', arrange: () => { world.persistEnvelope = { status: 'invalid_input' }; } },
    { label: 'candidate_not_found', arrange: () => { world.persistEnvelope = { status: 'candidate_not_found' }; } },
    {
      label: 'already_present SIN id legible (no se asume que sea el nuestro)',
      arrange: () => { world.persistEnvelope = { status: 'already_present' }; },
    },
  ] as const;

  for (const f of failures) {
    it(`${f.label} ⇒ sin reveal, con la evidencia del gasto conservada`, async () => {
      f.arrange();
      const result = await resolve();

      assert.equal(result.status, 'blocked');
      if (result.status !== 'blocked') return;
      assert.equal(result.skippedReason, 'lusha_identity_not_persisted');
      assert.equal(result.runOutcome, 'resolved_not_persisted');
      assert.equal(result.searched, true, 'la búsqueda se pagó y se declara');
      assert.equal(world.searchClientCalls, 1, 'y NO se repite');
    });
  }

  it('already_present CON id del ganador ⇒ se revela el id del ganador', async () => {
    world.persistEnvelope = {
      status: 'already_present',
      provider_contact_id: 'lusha-winner-777',
    };
    const result = await resolve();
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') return;
    assert.equal(result.contactId, 'lusha-winner-777');
  });

  it('el desenlace de la persistencia fallida SÍ llega al ledger', async () => {
    world.persistEnvelope = { status: 'invalid_input' };
    await resolve();
    assert.equal(world.usageLogs.length, 1, 'el crédito gastado se registra');
    assert.equal(
      (world.usageLogs[0]?.metadata as Record<string, unknown>)?.identity_outcome,
      'resolved_not_persisted',
      'el ledger no oculta que la identidad se perdió',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 8 / 9 — El ledger
// ═══════════════════════════════════════════════════════════════

describe('adaptador real — provider_usage_logs', () => {
  it('operation_key distingue la búsqueda del reveal', async () => {
    await resolve();
    assert.equal(world.usageLogs.length, 1);
    const log = world.usageLogs[0]!;
    assert.equal(log.provider_key, 'lusha');
    assert.equal(log.operation_key, LUSHA_IDENTITY_SEARCH_OPERATION_KEY);
    assert.notEqual(log.operation_key, LUSHA_PHONE_REVEAL_OPERATION_KEY);
  });

  it('correlaciona con la MISMA autorización que paga el reveal', async () => {
    await resolve();
    const metadata = world.usageLogs[0]?.metadata as Record<string, unknown>;
    assert.equal(metadata.reservation_group_id, GROUP_ID);
    assert.equal(metadata.phone_reveal_run_id, RUN_ID);
  });

  it('declara el TIPO de identificador usado, nunca el dato', async () => {
    await resolve();
    const metadata = world.usageLogs[0]?.metadata as Record<string, unknown>;
    assert.equal(metadata.match_key, 'linkedin_url');
    const serialized = JSON.stringify(world.usageLogs[0]);
    for (const secret of [
      'ana@acme.com',
      'linkedin.com/in/ana-ruiz',
      'Ana',
      'Ruiz',
      'ACME',
      'acme.com',
      LUSHA_ID,
      'apollo-person-99',
      'lusha-key',
    ]) {
      assert.ok(
        !serialized.includes(secret),
        `la fila de usage no puede contener ${secret}`,
      );
    }
  });

  it('ninguna clave prohibida, a ninguna profundidad', async () => {
    await resolve();
    assert.deepEqual(findForbiddenUsageLogMetadataKeys(world.usageLogs[0]), []);
  });

  it('un costo NO reportado se registra como desconocido, jamás como 0', async () => {
    world.searchResponse = searchResult([{ id: LUSHA_ID }], null);
    await resolve();
    const log = world.usageLogs[0]!;
    // La clave se OMITE: un 0 afirmaría que la llamada fue gratis, y Lusha cobra 1 por
    // petición a `api_search`. La liquidación lo confirma al tope con `assumed_cap`.
    assert.ok(!('credits_used' in log), 'credits_used ausente, no 0');
    assert.equal(log.estimated_cost_usd, null, 'costo desconocido explícito, no 0');
  });

  // El SELLO no lo emite el resolutor: lo invoca el core del waterfall como dep
  // separada (`recordIdentitySearchOutcome`), justo para que un fallo del sello no
  // impida cerrar la corrida. Aquí se prueba el ESCRITOR; que el core lo llame lo
  // prueba cross-provider-phone-identity-waterfall.test.ts.
  it('el escritor del sello deja el desenlace en la columna de la 124', async () => {
    await identityDeps.recordLushaIdentitySearchOutcome({
      runId: RUN_ID,
      outcome: 'resolved_not_persisted',
      creditsCharged: 1,
    });
    assert.equal(world.outcomeSeals.length, 1);
    assert.equal(
      world.outcomeSeals[0]?.lusha_identity_search_outcome,
      'resolved_not_persisted',
    );
  });

  it('el sello NO escribe una columna de costo: la 124 no la crea', async () => {
    await identityDeps.recordLushaIdentitySearchOutcome({
      runId: RUN_ID,
      outcome: 'resolved',
      creditsCharged: 1,
    });
    // Su costo ya tiene dos hogares autoritativos —la fila de reserva y la de
    // provider_usage_logs— y una tercera copia sólo podría contradecirlos.
    const patch = world.outcomeSeals[0]!;
    const serialized = JSON.stringify(patch);
    assert.ok(!serialized.includes('cost'), 'ninguna columna de costo');
    assert.ok(!serialized.includes('credits'), 'ninguna columna de créditos');
  });
});

// ═══════════════════════════════════════════════════════════════
// 7 — Flag OFF: el código está desplegado e INERTE
// ═══════════════════════════════════════════════════════════════

describe('flag OFF — nada se cablea y nada se lee', () => {
  const importDeps = async () => import('../phone-reveal-waterfall-deps');

  it('con el flag apagado la dep de identidad NO se cablea', async () => {
    world.waterfallEnabled = false;
    const { buildContinueWaterfallDeps } = await importDeps();
    const deps = buildContinueWaterfallDeps();

    assert.equal(
      'resolveLushaIdentity' in deps,
      false,
      'sin la dep, el bloque entero del core no existe',
    );
    assert.equal('recordIdentitySearchOutcome' in deps, false);
  });

  it('con el flag encendido SÍ se cablea, y con el adaptador REAL', async () => {
    world.waterfallEnabled = true;
    const { buildContinueWaterfallDeps } = await importDeps();
    const deps = buildContinueWaterfallDeps();

    assert.equal(typeof deps.resolveLushaIdentity, 'function');
    assert.equal(typeof deps.recordIdentitySearchOutcome, 'function');
    assert.equal(
      deps.resolveLushaIdentity,
      identityDeps.resolveLushaIdentityForCandidate,
      'la dep es el adaptador real, no un stub',
    );
  });

  it('`flagEnabled` del motor MANUAL no enciende la búsqueda pagada', async () => {
    // El motor `legacy_lusha_only` está autorizado por otro flag y su autorización
    // reserva UNA pata de 5, sin crédito de búsqueda. Si su `flagEnabled: true`
    // encendiera la identidad, pagaría una búsqueda que nadie reservó ni le enseñó al
    // operador.
    world.waterfallEnabled = false;
    const { buildContinueWaterfallDeps } = await importDeps();
    const deps = buildContinueWaterfallDeps({ flagEnabled: true });

    assert.equal(deps.flagEnabled, true, 'el motor manual sí conserva su permiso');
    assert.equal('resolveLushaIdentity' in deps, false, 'pero NO la búsqueda pagada');
  });

  it('con el flag apagado NO se lee contact_provider_identities', async () => {
    world.waterfallEnabled = false;
    const { loadCandidateForWaterfall } = await importDeps();
    world.tablesTouched = [];
    world.identityTableReads = 0;

    const deps = (await importDeps()).buildContinueWaterfallDeps();
    await deps.loadCandidate(CANDIDATE_ID);

    assert.equal(
      world.identityTableReads,
      0,
      'la tabla de la 124 no se toca: puede no existir todavía',
    );
    assert.ok(
      !world.tablesTouched.includes('contact_provider_identities'),
      'ni se menciona en ninguna consulta',
    );
    // Y la proyección explícita sin la opción tampoco la lee.
    await loadCandidateForWaterfall(CANDIDATE_ID);
    assert.equal(world.identityTableReads, 0);
  });

  it('con el flag apagado no se invoca ningún RPC nuevo ni sale ninguna petición', async () => {
    world.waterfallEnabled = false;
    const { buildContinueWaterfallDeps } = await importDeps();
    const deps = buildContinueWaterfallDeps();
    await deps.loadCandidate(CANDIDATE_ID);

    assert.deepEqual(world.rpcsCalled, [], '0 RPC');
    assert.equal(world.searchClientCalls, 0, '0 llamadas al proveedor');
    assert.deepEqual(httpRequests, [], '0 peticiones reales');
  });
});

// ═══════════════════════════════════════════════════════════════
// 14 — Liquidación: las DOS patas de Lusha, por separado
// ═══════════════════════════════════════════════════════════════
//
// El core ya decide bien por (proveedor × operación) —eso lo prueba
// cross-provider-phone-identity-resolution.test.ts—, pero esa decisión sólo sirve si la
// LECTURA le entrega el `operation_key`. Sin él las dos patas de Lusha llegan como
// `phone_reveal`, la búsqueda hereda los hechos del reveal, y se libera un crédito que
// ya se gastó o se cobra dos veces el mismo.

describe('liquidación — la lectura de reservas conoce la operación', () => {
  const importReservationDeps = async () =>
    import('../phone-reveal-credit-reservation-deps');

  it('con el grano pedido, cada pata llega con su operación', async () => {
    const { findActivePhoneRevealCreditReservations } = await importReservationDeps();
    const legs = await findActivePhoneRevealCreditReservations(GROUP_ID, {
      includeOperationKey: true,
    });

    assert.equal(legs.length, 2);
    assert.equal(legs.find((l) => l.id === 'r-search')?.operationKey, 'contact_search');
    assert.equal(legs.find((l) => l.id === 'r-reveal')?.operationKey, 'phone_reveal');
    const select = world.selects.find((s) => s.table === 'phone_reveal_credit_reservations');
    assert.ok(select?.columns.includes('operation_key'));
  });

  it('SIN el grano pedido no se menciona `operation_key` en la consulta', async () => {
    const { findActivePhoneRevealCreditReservations } = await importReservationDeps();
    const legs = await findActivePhoneRevealCreditReservations(GROUP_ID);

    const select = world.selects.find((s) => s.table === 'phone_reveal_credit_reservations');
    assert.ok(
      select && !select.columns.includes('operation_key'),
      'la columna de la 124 no se toca: puede no existir todavía',
    );
    // Y las patas caen al default por la vía canónica, que es lo que TODA fila anterior
    // a la 124 realmente es.
    for (const leg of legs) {
      assert.equal(leg.operationKey, undefined);
    }
  });

  it('un `operation_key` fuera del vocabulario NO viaja: cae al default', async () => {
    world.reservationRows = [
      { id: 'r-x', provider_key: 'lusha', credits_reserved: 5, status: 'reserved', operation_key: 'algo_inventado' },
    ];
    const { findActivePhoneRevealCreditReservations } = await importReservationDeps();
    const legs = await findActivePhoneRevealCreditReservations(GROUP_ID, {
      includeOperationKey: true,
    });
    assert.equal(legs.length, 1);
    assert.equal(legs[0]?.operationKey, undefined, 'parseado, nunca casteado');
  });

  it('la lectura de la corrida pide el claim de la búsqueda sólo cuando se le pide', async () => {
    const { findWaterfallRunById } = await import('../phone-reveal-waterfall-deps');

    world.selects = [];
    await findWaterfallRunById(RUN_ID, { includeIdentitySearch: true });
    assert.ok(
      world.selects
        .find((s) => s.table === 'phone_reveal_waterfall_runs')
        ?.columns.includes('lusha_identity_search_attempted_at'),
    );

    world.selects = [];
    await findWaterfallRunById(RUN_ID);
    assert.ok(
      !world.selects
        .find((s) => s.table === 'phone_reveal_waterfall_runs')
        ?.columns.includes('lusha_identity_search_attempted_at'),
      'sin pedirlo, la columna de la 124 no aparece en la consulta',
    );
  });
});
