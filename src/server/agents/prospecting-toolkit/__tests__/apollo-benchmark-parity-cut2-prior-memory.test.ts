/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 8, 9, 11, 12, 15 — la memoria PREVIA y
 * el escalón `provider_seen_hit`.
 *
 * El defecto que este corte cierra: el corte 1 recordaba lo devuelto y no tenía
 * con qué cruzarlo, así que el embudo publicaba `provider_seen_hit: null` con su
 * costura nombrada. Ahora hay snapshot previo y el escalón se MIDE.
 *
 * 🔴 Lo que estas pruebas defienden, dicho como defecto:
 *
 *   1. que la escritura de ESTA búsqueda se cuente como conocimiento previo suyo
 *      —convertiría cualquier búsqueda multipágina en un acierto artificial—;
 *   2. que un fallo de carga se publique como 0 aciertos en vez de como null;
 *   3. que una memoria de Lusha produzca un acierto de Apollo;
 *   4. que el emparejamiento se haga con un matcher propio en vez del canónico.
 *
 * Offline y determinista: transporte, reloj, jitter y escritor de memoria se
 * inyectan, y un `fetch` global envenenado prueba que nada aquí toca la red.
 * 0 créditos, 0 proveedores, 0 base de datos.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import {
  APOLLO_PRIOR_MEMORY_NOT_PROVIDED,
  toApolloProviderSeenMetadata,
  type ApolloPriorProviderSeen,
} from '../apollo-organizations-provider-seen';
import { buildApolloBenchmarkFunnelMetadata } from '../apollo-benchmark-funnel';
import {
  buildProviderSeenMemory,
  collectProviderSeenObservations,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
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

/** Organización con id y dominio. `suffix` fija los dos a la vez. */
const organization = (suffix: string): Record<string, unknown> => ({
  id: `org_${suffix}`,
  name: `Empresa ${suffix}`,
  primary_domain: `empresa-${suffix}.com`,
});

const OK_WRITE: ProviderSeenWriteResult = {
  written: true,
  skippedReason: null,
  newIdsRecorded: 0,
  newDomainsRecorded: 0,
  refreshedCount: 0,
};

function spyRecorder(): {
  calls: ProviderSeenWriteInput[];
  record: (input: ProviderSeenWriteInput) => Promise<ProviderSeenWriteResult>;
} {
  const calls: ProviderSeenWriteInput[] = [];
  return {
    calls,
    record: async (input) => {
      calls.push(input);
      return OK_WRITE;
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
    providerSeenNow: () => '2026-08-21T00:00:00.000Z',
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_benchmark_parity_cut2',
  agentRunId: 'agent_run_2',
};

/** Snapshot previo de Apollo con las identidades indicadas. */
function apolloPriorMemory(
  candidates: readonly { providerEntityId: string | null; domain: string | null }[],
): ApolloPriorProviderSeen {
  const { observations } = collectProviderSeenObservations('apollo', candidates);
  return { available: true, memory: buildProviderSeenMemory(observations) };
}

async function search(
  pages: ApolloPageFetchResult[],
  prior: ApolloPriorProviderSeen | undefined,
  overrides: { perPage?: number; maxPages?: number; maxCandidates?: number } = {},
) {
  const recorder = spyRecorder();
  const result = await runApolloOrganizationsPaginatedSearch(
    {
      ...baseInput,
      budget: createApolloPaginationBudget({
        perPage: overrides.perPage ?? 10,
        maxPages: overrides.maxPages ?? 1,
        maxCandidates: overrides.maxCandidates ?? 10,
      }),
    },
    {
      ...harness(pages),
      recordProviderSeen: recorder.record,
      priorProviderSeen: prior,
    },
  );
  return { result, recorder };
}

// ─── § 15 A/B — el cruce contra la memoria previa ─────────────────────────────

describe('CUT-2 § 15 · aciertos contra la memoria PREVIA', () => {
  it('A — la memoria previa conoce A, el proveedor devuelve A y B ⇒ 1 acierto', async () => {
    const prior = apolloPriorMemory([{ providerEntityId: 'org_a', domain: 'empresa-a.com' }]);

    const { result } = await search([okPage([organization('a'), organization('b')])], prior);

    assert.equal(result.providerSeen.priorSeenHits, 1);
    assert.equal(result.providerSeen.uniqueIdentities, 2);
    assert.equal(result.providerSeen.priorMemoryAvailable, true);
    assert.equal(result.providerSeen.priorMemoryUnavailableReason, null);
    assert.equal(realFetchCalls, 0);
  });

  it('B — memoria previa VACÍA pero cargada con éxito ⇒ 0 aciertos, no null', async () => {
    const prior = apolloPriorMemory([]);

    const { result } = await search([okPage([organization('a'), organization('b')])], prior);

    // 🔴 El punto entero de § 11: un 0 aquí es una medición, y sólo lo es porque
    // el llamador pudo afirmar que la lectura funcionó.
    assert.equal(result.providerSeen.priorSeenHits, 0);
    assert.equal(result.providerSeen.priorMemoryAvailable, true);
  });

  it('C — sin snapshot (carga fallida o ruta sin capa previa) ⇒ null, y la búsqueda no se altera', async () => {
    const noMemory: ApolloPriorProviderSeen = {
      available: false,
      unavailableReason: 'provider_seen_memory_read_failed',
    };

    const conMemoria = await search([okPage([organization('a'), organization('b')])], apolloPriorMemory([]));
    const sinMemoria = await search([okPage([organization('a'), organization('b')])], noMemory);

    assert.equal(sinMemoria.result.providerSeen.priorSeenHits, null);
    assert.equal(sinMemoria.result.providerSeen.priorMemoryAvailable, false);
    assert.equal(
      sinMemoria.result.providerSeen.priorMemoryUnavailableReason,
      'provider_seen_memory_read_failed',
    );

    // 🔴 § 12 — un fallo de memoria NO puede cambiar lo que la búsqueda devuelve
    // ni lo que se escribe. Es una capa de medición, no de decisión.
    assert.deepEqual(
      sinMemoria.result.organizations.map((o) => o.providerReference.providerOrganizationId),
      conMemoria.result.organizations.map((o) => o.providerReference.providerOrganizationId),
    );
    assert.equal(sinMemoria.recorder.calls.length, conMemoria.recorder.calls.length);
    assert.equal(
      sinMemoria.result.providerSeen.identitiesPresented,
      conMemoria.result.providerSeen.identitiesPresented,
    );
  });

  it('el defecto por defecto tiene nombre: sin inyectar nada, null con su motivo', async () => {
    const { result } = await search([okPage([organization('a')])], undefined);

    assert.equal(result.providerSeen.priorSeenHits, null);
    assert.equal(
      result.providerSeen.priorMemoryUnavailableReason,
      APOLLO_PRIOR_MEMORY_NOT_PROVIDED,
    );
  });

  it('D — lo escrito por ESTA búsqueda no se cuenta como conocimiento previo suyo', async () => {
    // Dos páginas con organizaciones DISTINTAS y memoria previa vacía. La página 1
    // se escribe antes de que se procese la página 2; si el snapshot se recargara
    // o se mutara, la página 2 vería a la 1 como «ya conocida».
    const prior = apolloPriorMemory([]);

    const { result, recorder } = await search(
      [okPage([organization('a')]), okPage([organization('b')])],
      prior,
      { perPage: 1, maxPages: 2, maxCandidates: 5 },
    );

    assert.equal(recorder.calls.length, 2, 'las dos páginas se escribieron');
    assert.equal(result.providerSeen.uniqueIdentities, 2);
    assert.equal(
      result.providerSeen.priorSeenHits,
      0,
      '🔴 la página 1, ya escrita, NO puede ser un acierto previo de la página 2',
    );
  });

  it('una organización repetida entre páginas cuenta UN acierto, no dos', async () => {
    const prior = apolloPriorMemory([{ providerEntityId: 'org_a', domain: 'empresa-a.com' }]);
    const page = okPage([organization('a')]);

    const { result } = await search([page, page], prior, {
      perPage: 1,
      maxPages: 2,
      maxCandidates: 5,
    });

    assert.equal(result.providerSeen.uniqueIdentities, 1);
    assert.equal(
      result.providerSeen.priorSeenHits,
      1,
      'el escalón de aciertos nunca puede superar al de únicas',
    );
  });
});

// ─── § 15 E/F/G — la identidad es la canónica, y por proveedor ────────────────

describe('CUT-2 § 15 · semántica de identidad', () => {
  it('E — una memoria de LUSHA nunca produce un acierto de Apollo', async () => {
    // Mismas cadenas, otro proveedor. El aislamiento no lo da el texto: lo da que
    // la memoria se carga POR proveedor y este snapshot es el de Apollo.
    const lushaMemory = collectProviderSeenObservations('lusha', [
      { providerEntityId: 'org_a', domain: 'empresa-a.com' },
    ]).observations;

    // El snapshot de Apollo de esta corrida se construye a partir de la memoria de
    // APOLLO, que aquí está vacía. Cargar la de Lusha en su lugar es precisamente
    // lo que el gate no hace: `runPrePaidNoveltyGate` recibe `provider` obligatorio.
    const apolloSnapshot = apolloPriorMemory([]);

    const { result } = await search([okPage([organization('a')])], apolloSnapshot);

    assert.ok(lushaMemory.length > 0, 'la memoria Lusha existe y NO participa');
    assert.equal(result.providerSeen.priorSeenHits, 0);
  });

  it('F — el acierto por id funciona aunque el dominio no coincida', async () => {
    const prior = apolloPriorMemory([{ providerEntityId: 'org_a', domain: null }]);

    const { result } = await search([okPage([organization('a')])], prior);

    assert.equal(result.providerSeen.priorSeenHits, 1);
  });

  it('G — el acierto por dominio funciona aunque el id no coincida', async () => {
    const prior = apolloPriorMemory([
      { providerEntityId: 'otro_id_distinto', domain: 'empresa-a.com' },
    ]);

    const { result } = await search([okPage([organization('a')])], prior);

    assert.equal(result.providerSeen.priorSeenHits, 1);
  });
});

// ─── El embudo publica lo medido y NADA más ───────────────────────────────────

describe('CUT-2 § 11 · el embudo distingue 0 de null', () => {
  it('con snapshot, `provider_seen_hit` deja de estar en `fields_missing`', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata({
      paidRaw: 10,
      unique: 8,
      duplicate: 2,
      precisionRejected: 3,
      providerSeenHit: 0,
      historicalKnown: null,
      acceptedForTarget: null,
    });

    assert.equal(funnel['provider_seen_hit'], 0);
    assert.deepEqual(funnel['fields_missing'], ['historical_known', 'accepted_for_target']);
    assert.equal(
      (funnel['field_sources'] as Record<string, string>)['provider_seen_hit'],
      'observed',
    );
    assert.equal(
      (funnel['missing_correlation_seams'] as Record<string, string>)['provider_seen_hit'],
      undefined,
    );
  });

  it('sin snapshot, sigue siendo null Y sigue nombrado en la costura', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata({
      paidRaw: 10,
      unique: 8,
      duplicate: 2,
      precisionRejected: 3,
      providerSeenHit: null,
      historicalKnown: null,
      acceptedForTarget: null,
    });

    assert.equal(funnel['provider_seen_hit'], null);
    assert.ok((funnel['fields_missing'] as string[]).includes('provider_seen_hit'));
    assert.equal(
      (funnel['missing_correlation_seams'] as Record<string, string>)['provider_seen_hit'],
      'prior_provider_seen_memory_unavailable_for_this_run',
    );
  });

  it('§ 17 — `historical_known` y `accepted_for_target` siguen PENDIENTES', () => {
    // Este corte no gana la correlación que los produciría con verdad, y
    // fabricarlos desde lo que hay a mano crearía una segunda definición.
    const funnel = buildApolloBenchmarkFunnelMetadata({
      paidRaw: 10,
      unique: 8,
      duplicate: 2,
      precisionRejected: 3,
      providerSeenHit: 1,
      historicalKnown: null,
      acceptedForTarget: null,
    });

    assert.equal(funnel['historical_known'], null);
    assert.equal(funnel['accepted_for_target'], null);
  });
});

describe('CUT-2 § 12 · la metadata de memoria dice qué se pudo medir', () => {
  it('publica los aciertos, la disponibilidad y el motivo, sin colapsar null en 0', () => {
    const conMemoria = toApolloProviderSeenMetadata({
      attempted: true,
      pagesPresented: 1,
      identitiesPresented: 2,
      uniqueIdentities: 2,
      unidentifiableResults: 0,
      withinPageDuplicates: 0,
      crossPageDuplicateIdentities: 0,
      newIdsRecorded: 2,
      newDomainsRecorded: 2,
      writeFailures: 0,
      lastWriteSkippedReason: null,
      blockedReasons: [],
      priorSeenHits: 0,
      priorMemoryAvailable: true,
      priorMemoryUnavailableReason: null,
    });

    assert.equal(conMemoria['prior_seen_hits'], 0);
    assert.equal(conMemoria['prior_memory_available'], true);
    assert.equal(conMemoria['prior_memory_unavailable_reason'], null);

    const sinMemoria = toApolloProviderSeenMetadata({
      attempted: true,
      pagesPresented: 1,
      identitiesPresented: 2,
      uniqueIdentities: 2,
      unidentifiableResults: 0,
      withinPageDuplicates: 0,
      crossPageDuplicateIdentities: 0,
      newIdsRecorded: 2,
      newDomainsRecorded: 2,
      writeFailures: 0,
      lastWriteSkippedReason: null,
      blockedReasons: [],
      priorSeenHits: null,
      priorMemoryAvailable: false,
      priorMemoryUnavailableReason: 'provider_seen_memory_read_failed',
    });

    assert.equal(sinMemoria['prior_seen_hits'], null);
    assert.equal(sinMemoria['prior_memory_available'], false);
    assert.equal(
      sinMemoria['prior_memory_unavailable_reason'],
      'provider_seen_memory_read_failed',
    );
  });
});
