/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P0-2 — la memoria provider-seen de
 * Apollo nace en la costura compartida, ANTES de cualquier filtro local.
 *
 * Offline y determinista: `fetchPage`, `now`, `random`, `sleep` y el escritor de
 * memoria se inyectan. Un `fetch` global envenenado prueba que ninguna prueba de
 * este archivo alcanza la red. 0 créditos, 0 proveedores, 0 base de datos.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import {
  createApolloProviderSeenLedger,
  toApolloProviderSeenCandidates,
  APOLLO_PROVIDER_SEEN_RECORD_THREW,
} from '../apollo-organizations-provider-seen';
import { createInMemoryProviderSeenStore } from '@/server/prospect-batches/provider-seen/provider-seen-store';
import type {
  ProviderSeenWriteInput,
  ProviderSeenWriteResult,
} from '@/server/prospect-batches/provider-seen/provider-seen-store';

// ─── Instrumentación ──────────────────────────────────────────────────────────

let realFetchCalls = 0;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof globalThis.fetch;

beforeEach(() => {
  realFetchCalls = 0;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function okPage(organizations: Array<Record<string, unknown>>): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: { organizations },
    headers: null,
  };
}

const malformedPage: ApolloPageFetchResult = {
  ok: true,
  status: 200,
  requestSent: true,
  malformedBody: true,
  timedOut: false,
  payload: undefined,
  headers: null,
};

function errorPage(status: number): ApolloPageFetchResult {
  return {
    ok: false,
    status,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: undefined,
    headers: null,
    errorBody: `error ${status}`,
  };
}

const orgs = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `org_${offset + i}`,
    name: `Empresa ${offset + i}`,
    primary_domain: `empresa-${offset + i}.com`,
  }));

const OK_WRITE: ProviderSeenWriteResult = {
  written: true,
  skippedReason: null,
  newIdsRecorded: 0,
  newDomainsRecorded: 0,
  refreshedCount: 0,
};

type Recorded = { input: ProviderSeenWriteInput };

function spyRecorder(
  result: ProviderSeenWriteResult | (() => Promise<ProviderSeenWriteResult>) = OK_WRITE,
): { calls: Recorded[]; record: (input: ProviderSeenWriteInput) => Promise<ProviderSeenWriteResult> } {
  const calls: Recorded[] = [];
  return {
    calls,
    record: async (input) => {
      calls.push({ input });
      return typeof result === 'function' ? result() : result;
    },
  };
}

function harness(pages: ApolloPageFetchResult[]) {
  let clock = 0;
  let call = 0;
  return {
    fetchPage: async (): Promise<ApolloPageFetchResult> => {
      clock += 10;
      return pages[Math.min(call++, pages.length - 1)]!;
    },
    now: () => clock,
    random: () => 0.5,
    sleep: async () => {},
    providerSeenNow: () => '2026-08-20T00:00:00.000Z',
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_benchmark_parity_cut1',
  agentRunId: 'agent_run_1',
};

// ─── A — el tope de candidatos NO puede recortar la memoria ───────────────────

describe('P0-2 · A — provider-seen ve las 10, el acumulador se queda en 3', () => {
  it('presenta las 10 identidades pagadas aunque maxCandidates sea 3', async () => {
    const recorder = spyRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ perPage: 10, maxPages: 1, maxCandidates: 3 }),
      },
      { ...harness([okPage(orgs(10))]), recordProviderSeen: recorder.record },
    );

    assert.equal(recorder.calls.length, 1, 'una escritura por página exitosa');
    assert.equal(
      recorder.calls[0]!.input.observations.length,
      10,
      'las DIEZ identidades pagadas llegan a la memoria',
    );
    assert.ok(result.organizations.length <= 3, 'el tope local sigue mandando sobre lo recogido');
    assert.equal(result.organizations.length, 3);
    assert.equal(result.providerSeen.identitiesPresented, 10);
    assert.equal(result.providerSeen.uniqueIdentities, 10);
    assert.equal(realFetchCalls, 0);
  });

  it('la correlación es la canónica de la corrida y el instante es el inyectado', async () => {
    const recorder = spyRecorder();
    await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ perPage: 5, maxPages: 1, maxCandidates: 5 }),
      },
      { ...harness([okPage(orgs(2))]), recordProviderSeen: recorder.record },
    );

    assert.equal(recorder.calls[0]!.input.correlationId, 'run_benchmark_parity_cut1');
    assert.equal(recorder.calls[0]!.input.observedAt, '2026-08-20T00:00:00.000Z');
  });
});

// ─── B — el dedupe entre páginas NO puede recortar la memoria ─────────────────

describe('P0-2 · B — una organización repetida en la página 2 sigue llegando a la memoria', () => {
  it('la identidad pagada de la página 2 se presenta antes del salto por duplicado', async () => {
    const recorder = spyRecorder();
    const page = okPage(orgs(3));
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ perPage: 3, maxPages: 2, maxCandidates: 6 }),
      },
      { ...harness([page, page]), recordProviderSeen: recorder.record },
    );

    assert.equal(recorder.calls.length, 2, 'las DOS páginas pagadas escriben memoria');
    assert.equal(recorder.calls[1]!.input.observations.length, 3, 'la página 2 presenta sus 3');
    // El dedupe local sigue funcionando: sólo 3 organizaciones distintas quedan.
    assert.equal(result.organizations.length, 3);
    assert.equal(result.providerSeen.identitiesPresented, 6, 'presentadas: 3 + 3');
    assert.equal(result.providerSeen.uniqueIdentities, 3, 'únicas: 3');
    assert.equal(result.providerSeen.crossPageDuplicateIdentities, 3);
    assert.equal(realFetchCalls, 0);
  });
});

// ─── C — una respuesta inválida NUNCA genera memoria ──────────────────────────

describe('P0-2 · C — sin respuesta válida no hay nada visto', () => {
  it('un cuerpo malformado no escribe memoria', async () => {
    const recorder = spyRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1 }) },
      { ...harness([malformedPage]), recordProviderSeen: recorder.record },
    );

    assert.equal(recorder.calls.length, 0, 'ninguna escritura');
    assert.equal(result.providerSeen.attempted, false);
    assert.equal(result.providerSeen.identitiesPresented, 0);
  });

  it('un error HTTP no escribe memoria', async () => {
    const recorder = spyRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1 }) },
      { ...harness([errorPage(500)]), recordProviderSeen: recorder.record },
    );

    assert.equal(recorder.calls.length, 0);
    assert.equal(result.providerSeen.attempted, false);
  });

  it('una respuesta VÁLIDA y vacía es un hecho, no un fallo: se intenta y no hay identidades', async () => {
    const recorder = spyRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1 }) },
      { ...harness([okPage([])]), recordProviderSeen: recorder.record },
    );

    assert.equal(recorder.calls.length, 0, 'no hay observaciones que escribir');
    assert.equal(result.providerSeen.attempted, true, 'pero SÍ se presentó una respuesta válida');
    assert.deepEqual(result.providerSeen.blockedReasons, ['no_identifiable_results']);
    // 🔴 «Vacío» y «ilegible» no pueden colapsar en el mismo motivo.
    assert.ok(!result.providerSeen.blockedReasons.includes('provider_response_invalid'));
  });
});

// ─── D — una fila sin id NI dominio se cuenta, no se inventa ──────────────────

describe('P0-2 · D — identidad ausente: contrato honesto', () => {
  it('sin id ni dominio no se fabrica identidad; con sólo id sí se recuerda', async () => {
    const recorder = spyRecorder();
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 5, maxPages: 1, maxCandidates: 5 }) },
      {
        ...harness([
          okPage([
            { id: 'org_with_id', name: 'Sólo id' },
            { name: 'Sin nada', primary_domain: null },
            { id: 'org_full', name: 'Completa', primary_domain: 'completa.com' },
          ]),
        ]),
        recordProviderSeen: recorder.record,
      },
    );

    const observations = recorder.calls[0]!.input.observations;
    assert.equal(observations.length, 2, 'la fila sin id NI dominio no genera observación');
    assert.equal(observations[0]!.providerEntityId, 'org_with_id');
    assert.equal(observations[0]!.normalizedDomain, null, 'no se inventa un dominio');
    assert.equal(observations[1]!.normalizedDomain, 'completa.com');
    assert.equal(result.providerSeen.unidentifiableResults, 0,
      'una fila sin id la descarta el normalizador antes de llegar aquí');
  });

  it('sólo el dominio PRIMARIO se recuerda: los alias no se expanden en este corte', async () => {
    const recorder = spyRecorder();
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 5, maxPages: 1, maxCandidates: 5 }) },
      {
        ...harness([
          okPage([
            {
              id: 'org_alias',
              name: 'Con alias',
              primary_domain: 'principal.com',
              all_domains: ['alias-uno.com', 'alias-dos.com'],
            },
          ]),
        ]),
        recordProviderSeen: recorder.record,
      },
    );

    const observations = recorder.calls[0]!.input.observations;
    assert.equal(observations.length, 1, 'UNA fila por organización, nunca una por alias');
    assert.equal(observations[0]!.normalizedDomain, 'principal.com');
  });
});

// ─── E — un fallo de memoria no puede tirar una página ya pagada ──────────────

describe('P0-2 · E — fail-soft, contado y nunca silencioso', () => {
  it('una escritura que LANZA no detiene la búsqueda y queda contada', async () => {
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1, maxCandidates: 3 }) },
      {
        ...harness([okPage(orgs(3))]),
        recordProviderSeen: async () => {
          throw new Error('memoria caída');
        },
      },
    );

    assert.equal(result.organizations.length, 3, 'la página comprada NO se pierde');
    assert.notEqual(result.stopReason, 'error_terminated', 'la memoria no puede terminar la búsqueda');
    assert.equal(result.terminalError, null, 'un fallo de memoria no es un fallo de proveedor');
    assert.equal(result.providerSeen.writeFailures, 1);
    assert.equal(result.providerSeen.lastWriteSkippedReason, APOLLO_PROVIDER_SEEN_RECORD_THREW);
  });

  it('un store que no persiste queda contado con SU motivo', async () => {
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1, maxCandidates: 3 }) },
      {
        ...harness([okPage(orgs(3))]),
        recordProviderSeen: async () => ({
          written: false,
          skippedReason: 'persistence_client_unavailable',
          newIdsRecorded: 0,
          newDomainsRecorded: 0,
          refreshedCount: 0,
        }),
      },
    );

    assert.equal(result.providerSeen.writeFailures, 1);
    assert.equal(result.providerSeen.lastWriteSkippedReason, 'persistence_client_unavailable');
  });

  it('«sin observaciones» NO cuenta como fallo de memoria', () => {
    const ledger = createApolloProviderSeenLedger();
    ledger.noteWrite({
      written: false,
      skippedReason: 'no_observations',
      newIdsRecorded: 0,
      newDomainsRecorded: 0,
      refreshedCount: 0,
    });
    assert.equal(ledger.summary().writeFailures, 0);
    assert.equal(ledger.summary().lastWriteSkippedReason, null);
  });

  it('sin recorder inyectado la búsqueda sigue y el embudo se mide igual', async () => {
    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1, maxCandidates: 3 }) },
      { ...harness([okPage(orgs(3))]) },
    );

    assert.equal(result.organizations.length, 3);
    assert.equal(result.providerSeen.identitiesPresented, 3);
    assert.equal(result.providerSeen.writeFailures, 0);
  });
});

// ─── F — el contrato del store sigue siendo idempotente ───────────────────────

describe('P0-2 · F — repetir una página no duplica memoria', () => {
  it('dos escrituras de la misma página dejan las mismas filas', async () => {
    const store = createInMemoryProviderSeenStore();
    const observations = toApolloProviderSeenCandidates([
      {
        providerReference: { provider: 'apollo', providerOrganizationId: 'org_1', providerAccountId: null },
        primaryDomain: 'uno.com',
      },
      {
        providerReference: { provider: 'apollo', providerOrganizationId: 'org_2', providerAccountId: null },
        primaryDomain: 'dos.com',
      },
    ] as never);

    assert.equal(observations.length, 2);

    const write = async () =>
      store.record({
        observations: observations.map((candidate) => ({
          provider: 'apollo' as const,
          entityType: 'company' as const,
          providerEntityId: candidate.providerEntityId ?? null,
          normalizedDomain: candidate.domain ?? null,
        })),
        correlationId: 'run_1',
        observedAt: '2026-08-20T00:00:00.000Z',
      });

    const first = await write();
    const second = await write();

    assert.equal(first.newIdsRecorded, 2);
    assert.equal(second.newIdsRecorded, 0, 'la segunda escritura no descubre nada nuevo');
    assert.equal(second.refreshedCount, 2, 'sólo extiende la ventana');
    assert.equal(store.snapshot().length, 2, 'sigue habiendo DOS filas');
  });
});

// ─── Aislamiento entre proveedores ────────────────────────────────────────────

describe('P0-2 · aislamiento — la identidad de Apollo no se mezcla con la de Lusha', () => {
  it('la observación lleva el proveedor `apollo` y nadie suprime a nadie', async () => {
    const recorder = spyRecorder();
    await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget({ perPage: 3, maxPages: 1, maxCandidates: 3 }) },
      { ...harness([okPage(orgs(2))]), recordProviderSeen: recorder.record },
    );

    for (const observation of recorder.calls[0]!.input.observations) {
      assert.equal(observation.provider, 'apollo');
      assert.equal(observation.entityType, 'company');
    }
  });

  it('un id de Apollo y un id de Lusha con el mismo texto son filas DISTINTAS', async () => {
    const store = createInMemoryProviderSeenStore();
    await store.record({
      observations: [
        { provider: 'lusha', entityType: 'company', providerEntityId: 'shared_id', normalizedDomain: null },
      ],
      correlationId: 'run_lusha',
      observedAt: '2026-08-20T00:00:00.000Z',
    });
    await store.record({
      observations: [
        { provider: 'apollo', entityType: 'company', providerEntityId: 'shared_id', normalizedDomain: null },
      ],
      correlationId: 'run_apollo',
      observedAt: '2026-08-20T00:00:01.000Z',
    });

    assert.equal(store.snapshot().length, 2, 'dos proveedores, dos memorias');
    assert.equal((await store.load({ provider: 'apollo', limit: 10 })).length, 1);
    assert.equal((await store.load({ provider: 'lusha', limit: 10 })).length, 1);
  });
});
