/**
 * cross-provider-phone-identity-resolution.test.ts
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1)
 *
 * Cubre los casos A–O del encargo original y los añadidos P–X.
 *
 * 0 proveedores reales, 0 créditos, 0 escrituras: todo el gasto está detrás de deps
 * inyectadas que CUENTAN las llamadas, así que "no se llamó a Lusha" es una aserción
 * sobre un contador y no una promesa.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLushaIdentitySearchQuery,
  evaluateLushaIdentitySearchResponse,
  isLushaIdentityCompanyMismatch,
  LUSHA_IDENTITY_MATCH_KEY_TO_RESOLUTION_SOURCE,
  type LushaIdentitySearchCandidateFacts,
} from '../lusha-identity-search-core';
import {
  LUSHA_IDENTITY_SEARCH_PREFLIGHT_BLOCK_REASONS,
  LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES,
  resolveLushaIdentityForWaterfall,
  type LushaIdentitySearchClaimResult,
  type LushaIdentitySearchPreflightResult,
  type LushaIdentitySearchProviderResponse,
  type ResolveLushaIdentityDeps,
} from '../lusha-identity-resolution-runtime-core';
import {
  requiresProviderIdentitySearch,
  resolveProviderNativeContactId,
  type ProviderContactIdentityRecord,
} from '../provider-contact-identity-core';
import {
  buildLushaIdentitySearchUsageLog,
  findForbiddenUsageLogMetadataKeys,
  LUSHA_IDENTITY_SEARCH_OPERATION_KEY,
  LUSHA_PHONE_REVEAL_OPERATION_KEY,
} from '../phone-reveal-usage-log-core';
import {
  evaluatePhoneRevealWaterfallLushaLeg,
  resolvePhoneRevealWaterfallMaxCredits,
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
} from '../phone-reveal-waterfall-core';
import {
  resolvePhoneRevealCreditBudgetMode,
  resolvePhoneRevealCreditBudgetProviders,
  resolvePhoneRevealCreditBudgetRequiredCredits,
  resolvePhoneRevealCreditPoolDemands,
  resolvePhoneRevealCreditRequirements,
  evaluatePhoneRevealCreditBudget,
} from '../phone-reveal-credit-budget-core';
import {
  buildPhoneRevealCreditRunCostBreakdown,
  decidePhoneRevealCreditSettlement,
  simulatePhoneRevealCreditReservation,
  type PhoneRevealCreditReservationLeg,
  type PhoneRevealCreditSettlementFacts,
} from '../phone-reveal-credit-reservation-core';

const RUN_ID = 'run-1';
const CANDIDATE_ID = 'candidate-1';
const LUSHA_ID = 'v1.token-lusha-opaco';

/** Candidato nacido en Apollo: la población entera que este hito desbloquea. */
const APOLLO_FACTS: LushaIdentitySearchCandidateFacts = {
  firstName: 'Ana',
  lastName: 'Ruiz',
  linkedinUrl: 'https://www.linkedin.com/in/ana-ruiz',
  email: 'ana@acme.com',
  companyName: 'ACME',
  companyDomain: 'acme.com',
};

interface Harness {
  deps: ResolveLushaIdentityDeps;
  searchCalls: number;
  claimCalls: number;
  /** Veces que se resolvió el prerrequisito local (la credencial) — PR331-R3. */
  preflightCalls: number;
  persisted: Array<{ providerContactId: string; matchKey: string }>;
}

function harness(opts: {
  claim?: LushaIdentitySearchClaimResult;
  /** Simula el UPDATE condicional real: el primer claim gana, los demás no. */
  claimOnce?: boolean;
  response?: LushaIdentitySearchProviderResponse;
  searchThrows?: boolean;
  /** La escritura LANZA. */
  persistThrows?: boolean;
  /** La escritura no lanza pero declara que NO quedó guardada (el caso del driver). */
  persistFails?: boolean;
  /** Otro proceso ganó la carrera write-once y su id es este. */
  persistWinnerId?: string;
  /** Veredicto del preflight local (PR331-R3). Por defecto, `ready`. */
  preflight?: LushaIdentitySearchPreflightResult;
  /** El preflight LANZA (Vault ilegible, por ejemplo). */
  preflightThrows?: boolean;
} = {}): Harness {
  let claimedOnce = false;
  const h: Harness = {
    searchCalls: 0,
    claimCalls: 0,
    preflightCalls: 0,
    persisted: [],
    deps: {
      preflightSearch: async () => {
        h.preflightCalls += 1;
        if (opts.preflightThrows) throw new Error('vault unreachable');
        return opts.preflight ?? { status: 'ready' as const };
      },
      claimIdentitySearch: async () => {
        h.claimCalls += 1;
        if (opts.claim) return opts.claim;
        if (opts.claimOnce !== false && claimedOnce) return 'already_claimed';
        claimedOnce = true;
        return 'claimed';
      },
      searchIdentity: async () => {
        h.searchCalls += 1;
        if (opts.searchThrows) throw new Error('boom con detalle sensible');
        return (
          opts.response ?? {
            outcome: { status: 'success', results: [{ id: LUSHA_ID, companyName: 'ACME', companyDomain: 'acme.com' }] },
            creditsCharged: 1,
          }
        );
      },
      persistIdentity: async (args) => {
        if (opts.persistThrows) throw new Error('write failed');
        if (opts.persistFails) return { status: 'failed' as const };
        h.persisted.push({
          providerContactId: args.providerContactId,
          matchKey: args.matchKey,
        });
        // Write-once: el id EFECTIVO es el del ganador, que puede no ser el nuestro.
        return {
          status: 'persisted' as const,
          providerContactId: opts.persistWinnerId ?? args.providerContactId,
        };
      },
    },
  };
  return h;
}

function resolveInput(overrides: {
  identities?: readonly ProviderContactIdentityRecord[];
  facts?: LushaIdentitySearchCandidateFacts;
  candidateSource?: string | null;
  candidateSourceContactId?: string | null;
} = {}) {
  return {
    candidateId: CANDIDATE_ID,
    runId: RUN_ID,
    candidateSource: overrides.candidateSource ?? 'apollo',
    candidateSourceContactId: overrides.candidateSourceContactId ?? 'apollo-person-99',
    identities: overrides.identities ?? [],
    facts: overrides.facts ?? APOLLO_FACTS,
  };
}

const persistedLushaIdentity: ProviderContactIdentityRecord = {
  candidateId: CANDIDATE_ID,
  providerKey: 'lusha',
  providerContactId: LUSHA_ID,
  resolutionSource: 'provider_search_linkedin_url',
};

// ═══════════════════════════════════════════════════════════════
// A — candidato Apollo sin id Lusha, LinkedIn exacto
// ═══════════════════════════════════════════════════════════════

describe('A — candidato Apollo sin id Lusha, LinkedIn exacto', () => {
  test('search devuelve 1 match → id persistido y el reveal recibe ESE id', async () => {
    const h = harness();
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);

    assert.equal(result.status, 'ready');
    assert.equal(h.searchCalls, 1, 'exactamente UNA petición, nunca una cascada');
    if (result.status !== 'ready') return;
    assert.equal(result.contactId, LUSHA_ID);
    assert.equal(result.searched, true);
    assert.equal(result.runOutcome, 'resolved');
    assert.deepEqual(h.persisted, [{ providerContactId: LUSHA_ID, matchKey: 'linkedin_url' }]);
  });

  test('la prioridad elige LinkedIn cuando también hay email y nombre+empresa', () => {
    const query = buildLushaIdentitySearchQuery(APOLLO_FACTS);
    assert.equal(query?.matchKey, 'linkedin_url');
    // Y manda SOLO ese identificador: nada de mezclar anclas en una misma petición.
    assert.deepEqual(query?.contact, { linkedinUrl: APOLLO_FACTS.linkedinUrl });
  });

  test('la persistencia ocurre ANTES de que el reveal pueda arrancar', async () => {
    const order: string[] = [];
    const h = harness();
    const deps: ResolveLushaIdentityDeps = {
      ...h.deps,
      persistIdentity: async (args) => {
        order.push('persist');
        return h.deps.persistIdentity(args);
      },
    };
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), deps);
    order.push('reveal-could-start');
    assert.equal(result.status, 'ready');
    assert.deepEqual(order, ['persist', 'reveal-could-start']);
  });
});

// ═══════════════════════════════════════════════════════════════
// B — id Lusha ya persistido
// ═══════════════════════════════════════════════════════════════

describe('B — id Lusha ya persistido', () => {
  test('0 llamadas a Search, 0 claims, reveal directo', async () => {
    const h = harness();
    const result = await resolveLushaIdentityForWaterfall(
      resolveInput({ identities: [persistedLushaIdentity] }),
      h.deps,
    );
    assert.equal(result.status, 'ready');
    assert.equal(h.searchCalls, 0);
    assert.equal(h.claimCalls, 0, 'ni siquiera se reclama: no hay nada que pagar');
    if (result.status !== 'ready') return;
    assert.equal(result.contactId, LUSHA_ID);
    assert.equal(result.searched, false);
    assert.equal(result.runOutcome, 'reused_persisted');
    assert.equal(result.searchCreditsCharged, null);
  });

  test('un candidato NACIDO en Lusha tampoco paga búsqueda', async () => {
    const h = harness();
    const result = await resolveLushaIdentityForWaterfall(
      resolveInput({ candidateSource: 'lusha', candidateSourceContactId: LUSHA_ID }),
      h.deps,
    );
    assert.equal(result.status, 'ready');
    assert.equal(h.searchCalls, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// C / D / E / F — desenlaces que NO revelan
// ═══════════════════════════════════════════════════════════════

describe('C — Search 0 resultados', () => {
  test('terminal seguro, 0 reveal, y el crédito cobrado se reconoce', async () => {
    const h = harness({ response: { outcome: { status: 'no_results' }, creditsCharged: 1 } });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.skippedReason, 'lusha_identity_not_found');
    assert.equal(result.runOutcome, 'not_found');
    assert.equal(result.searchCreditsCharged, 1);
    assert.equal(h.persisted.length, 0);
  });
});

describe('D — Search múltiples resultados', () => {
  test('ambigüedad fail-closed: NUNCA se elige el primero', async () => {
    const h = harness({
      response: {
        outcome: {
          status: 'success',
          results: [
            { id: 'v1.uno', companyName: 'ACME', companyDomain: 'acme.com' },
            { id: 'v1.dos', companyName: 'ACME', companyDomain: 'acme.com' },
          ],
        },
        creditsCharged: 1,
      },
    });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.skippedReason, 'lusha_identity_ambiguous');
    assert.equal(h.persisted.length, 0, 'no se persiste ninguna de las dos');
  });

  test('identidad única pero de OTRA empresa también es ambigua', async () => {
    const h = harness({
      response: {
        outcome: {
          status: 'success',
          results: [{ id: 'v1.otro', companyName: 'Otra', companyDomain: 'otra.com' }],
        },
        creditsCharged: 1,
      },
    });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.skippedReason, 'lusha_identity_ambiguous');
  });

  test('la incompatibilidad se decide por REFUTACIÓN, no por suposición', () => {
    // Sin dato en el resultado no se puede refutar nada: no es un mismatch.
    assert.equal(
      isLushaIdentityCompanyMismatch({
        candidate: { companyName: 'ACME', companyDomain: 'acme.com' },
        result: { id: 'x', companyName: null, companyDomain: null },
      }),
      false,
    );
    // `www.` y mayúsculas no son diferencias de identidad.
    assert.equal(
      isLushaIdentityCompanyMismatch({
        candidate: { companyName: null, companyDomain: 'acme.com' },
        result: { id: 'x', companyName: null, companyDomain: 'WWW.Acme.com' },
      }),
      false,
    );
    // El dominio manda sobre el nombre.
    assert.equal(
      isLushaIdentityCompanyMismatch({
        candidate: { companyName: 'ACME', companyDomain: 'acme.com' },
        result: { id: 'x', companyName: 'ACME', companyDomain: 'otra.com' },
      }),
      true,
    );
  });
});

describe('E — Search error', () => {
  test('0 reveal y el costo NO se asume cero', async () => {
    const h = harness({
      response: { outcome: { status: 'provider_error' }, creditsCharged: null },
    });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.skippedReason, 'lusha_identity_error');
    assert.equal(result.searched, true, 'la petición salió: pudo cobrarse');
    assert.equal(result.searchCreditsCharged, null, 'desconocido, jamás 0');
  });

  test('un throw del cliente se trata como error del proveedor, no como gratis', async () => {
    const h = harness({ searchThrows: true });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, true);
    assert.equal(result.searchCreditsCharged, null);
  });

  test('un único resultado SIN id utilizable es error, no "no encontrado"', () => {
    const outcome = evaluateLushaIdentitySearchResponse({
      candidate: { companyName: 'ACME', companyDomain: 'acme.com' },
      matchKey: 'email',
      response: { status: 'success', results: [{ id: '   ', companyName: null, companyDomain: null }] },
    });
    assert.deepEqual(outcome, { status: 'error', reason: 'unreadable_response' });
  });
});

describe('F — Search timeout', () => {
  test('0 reveal, fail-closed', async () => {
    const h = harness({
      response: { outcome: { status: 'provider_timeout' }, creditsCharged: null },
    });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.skippedReason, 'lusha_identity_error');
  });
});

// ═══════════════════════════════════════════════════════════════
// G / H / I — privacidad y presupuesto: 0 search Y 0 reveal
// ═══════════════════════════════════════════════════════════════
//
// Estos tres se prueban en el nivel del waterfall, en el archivo
// cross-provider-phone-identity-waterfall.test.ts, porque la propiedad que
// importa es POSICIONAL: la búsqueda tiene que quedar por DETRÁS de la puerta
// de privacidad y por DELANTE del claim del reveal.

// ═══════════════════════════════════════════════════════════════
// J — dos ejecuciones concurrentes
// ═══════════════════════════════════════════════════════════════

describe('J — dos ejecuciones concurrentes', () => {
  test('máximo 1 search pagado: el claim atómico decide', async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      resolveLushaIdentityForWaterfall(resolveInput(), h.deps),
      resolveLushaIdentityForWaterfall(resolveInput(), h.deps),
    ]);
    assert.equal(h.claimCalls, 2, 'las dos lo intentan');
    assert.equal(h.searchCalls, 1, 'solo una paga');
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, ['claim_lost', 'ready']);
  });

  test('el perdedor no escribe NADA', async () => {
    const h = harness({ claim: 'already_claimed' });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'claim_lost');
    assert.equal(h.searchCalls, 0);
    assert.equal(h.persisted.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// K — Search OK pero reveal no_phone_found
// ═══════════════════════════════════════════════════════════════

describe('K — Search resuelve pero el reveal no encuentra teléfono', () => {
  test('el siguiente intento NO vuelve a Search: la identidad ya está persistida', async () => {
    const h = harness();
    const first = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(first.status, 'ready');
    assert.equal(h.searchCalls, 1);

    // El reveal terminaliza en `no_phone_found` (fuera de este core). Un intento
    // POSTERIOR vuelve con la identidad ya en la tabla.
    const second = await resolveLushaIdentityForWaterfall(
      resolveInput({ identities: [persistedLushaIdentity] }),
      h.deps,
    );
    assert.equal(second.status, 'ready');
    assert.equal(h.searchCalls, 1, 'sigue habiendo UNA sola búsqueda pagada');
    if (second.status !== 'ready') return;
    assert.equal(second.searched, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// L / V — caída entre la resolución y el reveal
// ═══════════════════════════════════════════════════════════════

describe('L / V — caída después de persistir la identidad', () => {
  test('la recuperación REUSA el id y hace 0 búsquedas', async () => {
    const h = harness({ claim: 'already_claimed' });
    // Estado tras la caída: claim tomado (ya se pagó) e identidad persistida.
    const result = await resolveLushaIdentityForWaterfall(
      resolveInput({ identities: [persistedLushaIdentity] }),
      h.deps,
    );
    assert.equal(result.status, 'ready');
    assert.equal(h.searchCalls, 0, 'recovery search calls = 0');
    assert.equal(h.claimCalls, 0, 'no hace falta reclamar lo que ya está resuelto');
    if (result.status !== 'ready') return;
    assert.equal(result.contactId, LUSHA_ID);
  });

  test('caída ANTES de persistir: no se repite el gasto ni se inventa una identidad', async () => {
    const h = harness({ claim: 'already_claimed' });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'claim_lost');
    assert.equal(h.searchCalls, 0, 'jamás un segundo cobro');
    assert.equal(h.persisted.length, 0);
  });

  // ── PERSISTENCIA OBLIGATORIA (PR331-R2, BLOCKER 1) ────────────────────────────
  //
  // Este bloque sustituye al test anterior, que afirmaba lo contrario («si la
  // persistencia falla, el reveal de ESTA corrida sigue»). La regla es ahora que una
  // identidad recién resuelta DEBE quedar almacenada de forma duradera ANTES de que se
  // permita el reveal: revelar sin persistir deja al candidato con teléfono y sin
  // identidad, que es el estado que obliga a la corrida siguiente a volver a comprar el
  // mismo dato. El crédito no se «aprovecha»: se convierte en el primero de una serie.
  for (const variant of [
    { label: 'la escritura LANZA', opts: { persistThrows: true } },
    { label: 'la escritura declara que no guardó', opts: { persistFails: true } },
  ] as const) {
    describe(`persistencia fallida — ${variant.label}`, () => {
      test('fail-closed: 1 búsqueda, 0 reveal, resultado != ready', async () => {
        const h = harness(variant.opts);
        const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);

        assert.notEqual(result.status, 'ready', 'el reveal NO puede continuar');
        assert.equal(result.status, 'blocked');
        assert.equal(h.searchCalls, 1, 'search calls = 1');
        // No hay dep de reveal en este core: que el reveal no corra se demuestra con
        // `status !== 'ready'`, que es la ÚNICA señal con la que el waterfall lo lanza.
        // La contraparte cableada se prueba en cross-provider-phone-identity-waterfall.
        if (result.status !== 'blocked') return;
        assert.equal(result.skippedReason, 'lusha_identity_not_persisted');
      });

      test('la evidencia económica del Search se CONSERVA: nunca se liquida a 0', async () => {
        const h = harness(variant.opts);
        const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
        if (result.status !== 'blocked') {
          assert.fail('se esperaba blocked');
          return;
        }
        // `searched: true` es lo que hace que la reserva de la búsqueda se CONFIRME en
        // vez de liberarse. Sin él, el crédito gastado se regalaría.
        assert.equal(result.searched, true, 'la petición salió y se pagó');
        assert.equal(
          result.runOutcome,
          'resolved_not_persisted',
          'el desenlace dice a la vez que se cobró y que la identidad se perdió',
        );
      });

      test('la identidad NO se pierde en silencio: el desenlace la declara', async () => {
        const h = harness(variant.opts);
        const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
        if (result.status !== 'blocked') {
          assert.fail('se esperaba blocked');
          return;
        }
        // Ni `resolved` (afirmaría que hay un id guardado) ni `error` (afirmaría que
        // falló el proveedor). Un valor propio, que es lo que un auditor necesita.
        assert.notEqual(result.runOutcome, 'resolved');
        assert.notEqual(result.runOutcome, 'error');
        assert.ok(
          LUSHA_IDENTITY_SEARCH_RUN_OUTCOMES.includes(result.runOutcome),
          'el desenlace pertenece al vocabulario cerrado que la 124 refleja',
        );
      });

      test('NO se reintenta la búsqueda automáticamente', async () => {
        const h = harness(variant.opts);
        await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
        assert.equal(h.searchCalls, 1, 'exactamente una, jamás un segundo cobro');
        assert.equal(h.claimCalls, 1, 'un solo claim, que además queda tomado');
      });
    });
  }

  test('carrera write-once: se revela el id del GANADOR, no el nuestro', async () => {
    const h = harness({ persistWinnerId: 'lusha-winner-777' });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready') return;
    // Revelar contra nuestro id sería revelar contra uno que nadie almacenó.
    assert.equal(result.contactId, 'lusha-winner-777');
    assert.notEqual(result.contactId, LUSHA_ID);
  });
});

// ═══════════════════════════════════════════════════════════════
// M / N — usage logs
// ═══════════════════════════════════════════════════════════════

describe('M — usage logs de Search y Reveal separados y correlacionados', () => {
  const searchLog = buildLushaIdentitySearchUsageLog({
    reservationGroupId: 'group-1',
    runId: RUN_ID,
    matchKey: 'linkedin_url',
    outcome: 'resolved',
    creditsCharged: 1,
    resultsReturned: 1,
    durationMs: 120,
  });

  test('operation_key distingue búsqueda de reveal', () => {
    assert.equal(searchLog.provider_key, 'lusha');
    assert.equal(searchLog.operation_key, LUSHA_IDENTITY_SEARCH_OPERATION_KEY);
    assert.notEqual(LUSHA_IDENTITY_SEARCH_OPERATION_KEY, LUSHA_PHONE_REVEAL_OPERATION_KEY);
  });

  test('las dos filas comparten la correlación de la MISMA autorización', () => {
    assert.equal(searchLog.metadata?.reservation_group_id, 'group-1');
    assert.equal(searchLog.metadata?.phone_reveal_run_id, RUN_ID);
  });

  test('costo desconocido NO se escribe como 0', () => {
    const unknown = buildLushaIdentitySearchUsageLog({
      reservationGroupId: 'group-1',
      runId: RUN_ID,
      matchKey: 'email',
      outcome: 'not_found',
      creditsCharged: null,
      resultsReturned: 0,
      durationMs: 90,
    });
    assert.equal('credits_used' in unknown, false, 'ausente, nunca 0');
    assert.equal(unknown.estimated_cost_usd, null, 'null EXPLÍCITO, nunca 0');
  });

  test('la suma económica se reconstruye desde la liquidación, no desde los logs', () => {
    const breakdown = buildPhoneRevealCreditRunCostBreakdown({
      settlement: [
        { action: 'confirm', reservationId: 'r1', providerKey: 'apollo', operationKey: 'phone_reveal', credits: 8, costTruth: 'reported' },
        { action: 'confirm', reservationId: 'r2', providerKey: 'lusha', operationKey: 'contact_search', credits: 1, costTruth: 'reported' },
        { action: 'confirm', reservationId: 'r3', providerKey: 'lusha', operationKey: 'phone_reveal', credits: 5, costTruth: 'assumed_cap' },
      ],
    });
    assert.equal(breakdown.apolloPhoneRevealCredits, 8);
    assert.equal(breakdown.lushaIdentitySearchCredits, 1);
    assert.equal(breakdown.lushaPhoneRevealCredits, 5);
    assert.equal(breakdown.lushaTotalCredits, 6, 'search + reveal');
    assert.equal(breakdown.totalCredits, 14, 'apollo + lusha');
  });

  test('una pata sin confirmar deja el componente en null, jamás en 0', () => {
    const breakdown = buildPhoneRevealCreditRunCostBreakdown({
      settlement: [
        { action: 'confirm', reservationId: 'r2', providerKey: 'lusha', operationKey: 'contact_search', credits: 1, costTruth: 'reported' },
        { action: 'release', reservationId: 'r3', providerKey: 'lusha', operationKey: 'phone_reveal', reason: 'leg_never_attempted' },
      ],
    });
    assert.equal(breakdown.lushaPhoneRevealCredits, null);
    assert.equal(breakdown.lushaTotalCredits, 1);
    assert.equal(breakdown.hasUnsettledLeg, true);
  });
});

describe('N — no PII en logs', () => {
  test('ninguna fila de usage lleva datos personales ni ids de proveedor', () => {
    for (const matchKey of ['linkedin_url', 'email', 'name_company_domain', 'name_company_name'] as const) {
      const log = buildLushaIdentitySearchUsageLog({
        reservationGroupId: 'group-1',
        runId: RUN_ID,
        matchKey,
        outcome: 'resolved',
        creditsCharged: 1,
        resultsReturned: 1,
        durationMs: 100,
      });
      assert.deepEqual(
        findForbiddenUsageLogMetadataKeys(log),
        [],
        `la fila de ${matchKey} no puede llevar claves prohibidas`,
      );
      const serialized = JSON.stringify(log);
      for (const secret of [
        APOLLO_FACTS.email,
        APOLLO_FACTS.linkedinUrl,
        APOLLO_FACTS.firstName,
        APOLLO_FACTS.lastName,
        APOLLO_FACTS.companyName,
        APOLLO_FACTS.companyDomain,
        LUSHA_ID,
        'apollo-person-99',
      ]) {
        assert.equal(
          serialized.includes(String(secret)),
          false,
          `${secret} no puede aparecer en la telemetría`,
        );
      }
    }
  });

  test('el detector recorre en profundidad, no solo el primer nivel', () => {
    assert.deepEqual(
      findForbiddenUsageLogMetadataKeys({ metadata: { cost: { email: 'x@y.z' } } }),
      ['email'],
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// O — Apollo no regresiona
// ═══════════════════════════════════════════════════════════════

describe('O — las rutas Apollo existentes no cambian', () => {
  test('sin identidad ni datos con que buscar, el tope sigue siendo 8', () => {
    const leg = evaluatePhoneRevealWaterfallLushaLeg({
      source: 'apollo',
      sourceContactId: 'apollo-person-99',
    });
    assert.equal(leg.eligible, false);
    assert.equal(leg.skippedReason, 'missing_lusha_contact_id');
    assert.equal(
      resolvePhoneRevealWaterfallMaxCredits(leg.eligible),
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
    );
  });

  test('un candidato Lusha nativo sigue en 13, no en 14', () => {
    const leg = evaluatePhoneRevealWaterfallLushaLeg({
      source: 'lusha',
      sourceContactId: LUSHA_ID,
      identitySearchFacts: APOLLO_FACTS,
    });
    assert.equal(leg.eligible, true);
    assert.equal(leg.requiresIdentitySearch, false);
    assert.equal(
      resolvePhoneRevealWaterfallMaxCredits(leg.eligible, leg.requiresIdentitySearch),
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    );
  });

  test('el id de Apollo NUNCA se devuelve como identidad de Lusha', () => {
    assert.equal(
      resolveProviderNativeContactId({
        providerKey: 'lusha',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [],
      }),
      null,
    );
    // Y a la inversa: el mapa está scopeado por proveedor.
    assert.equal(
      resolveProviderNativeContactId({
        providerKey: 'apollo',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [persistedLushaIdentity],
      })?.contactId,
      'apollo-person-99',
    );
  });

  test('las modalidades anteriores conservan su tope exacto', () => {
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('full_waterfall'), 13);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('apollo_only'), 8);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('legacy_lusha_only'), 5);
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits('search_more_lusha'), 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// P — candidato Apollo sin id Lusha: tope 14
// ═══════════════════════════════════════════════════════════════

describe('P — authorization cap = 14', () => {
  test('candidato Apollo con LinkedIn: elegible, exige búsqueda, tope 14', () => {
    const leg = evaluatePhoneRevealWaterfallLushaLeg({
      source: 'apollo',
      sourceContactId: 'apollo-person-99',
      identitySearchFacts: APOLLO_FACTS,
    });
    assert.equal(leg.eligible, true);
    assert.equal(leg.requiresIdentitySearch, true);
    assert.equal(
      resolvePhoneRevealWaterfallMaxCredits(leg.eligible, leg.requiresIdentitySearch),
      14,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH, 14);
  });

  test('14 = 8 Apollo + 1 búsqueda + 5 teléfono, y el desglose lo demuestra', () => {
    const mode = 'full_waterfall_with_identity_search';
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits(mode), 14);
    assert.deepEqual(resolvePhoneRevealCreditRequirements(mode), [
      { providerKey: 'apollo', operationKey: 'phone_reveal', credits: 8 },
      { providerKey: 'lusha', operationKey: 'contact_search', credits: 1 },
      { providerKey: 'lusha', operationKey: 'phone_reveal', credits: 5 },
    ]);
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS, 1);
  });

  test('los pozos a leer son DOS, no tres: Lusha es un solo saldo', () => {
    assert.deepEqual(
      [...resolvePhoneRevealCreditBudgetProviders('full_waterfall_with_identity_search')],
      ['apollo', 'lusha'],
    );
  });

  test('la demanda sobre el pozo de Lusha es 6, no 1 y 5 por separado', () => {
    const demands = resolvePhoneRevealCreditPoolDemands('full_waterfall_with_identity_search');
    const lusha = demands.find((d) => d.providerKey === 'lusha');
    assert.equal(lusha?.credits, 6);
    assert.deepEqual([...(lusha?.operationKeys ?? [])], ['contact_search', 'phone_reveal']);
  });

  test('🔴 un pozo de Lusha con 5 NO autoriza una corrida que puede gastar 6', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: 'full_waterfall_with_identity_search',
      budget: {
        model: 'per_provider',
        pools: [
          { providerKey: 'apollo', state: { kind: 'configured', limitCredits: 100, consumedCredits: 0, scopeType: 'global', scopeId: null, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z' } },
          { providerKey: 'lusha', state: { kind: 'configured', limitCredits: 5, consumedCredits: 0, scopeType: 'global', scopeId: null, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z' } },
        ],
      },
    });
    assert.equal(verdict.decision, 'insufficient_credits');
    const lushaLeg = verdict.legs.find((l) => l.providerKey === 'lusha');
    assert.equal(lushaLeg?.requiredCredits, 6, 'se pregunta por 6, no por 1 ni por 5');
  });
});

// ═══════════════════════════════════════════════════════════════
// Q — candidato con id Lusha: sin reserva de búsqueda
// ═══════════════════════════════════════════════════════════════

describe('Q — identidad ya persistida ⇒ no se reserva ni se llama a Search', () => {
  test('la modalidad es full_waterfall (13) y no incluye contact_search', () => {
    const mode = resolvePhoneRevealCreditBudgetMode({
      legacyLushaOnly: false,
      lushaEligible: true,
      lushaIdentityResolved: true,
    });
    assert.equal(mode, 'full_waterfall');
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits(mode), 13);
    assert.equal(
      resolvePhoneRevealCreditRequirements(mode).some(
        (r) => r.operationKey === 'contact_search',
      ),
      false,
      'no se cobra por averiguar lo que ya sabemos',
    );
  });

  test('sin identidad resuelta la modalidad sube a 14', () => {
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({
        legacyLushaOnly: false,
        lushaEligible: true,
        lushaIdentityResolved: false,
      }),
      'full_waterfall_with_identity_search',
    );
  });

  test('requiresProviderIdentitySearch es la señal que lo decide, antes del clic', () => {
    assert.equal(
      requiresProviderIdentitySearch({
        providerKey: 'lusha',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [persistedLushaIdentity],
      }),
      false,
    );
    assert.equal(
      requiresProviderIdentitySearch({
        providerKey: 'lusha',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [],
      }),
      true,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// R / S / T — liquidación de la búsqueda
// ═══════════════════════════════════════════════════════════════

function settlementFacts(
  overrides: Partial<PhoneRevealCreditSettlementFacts> = {},
): PhoneRevealCreditSettlementFacts {
  return {
    isTerminal: true,
    apolloAttempted: true,
    apolloCostCredits: 8,
    apolloCostSource: 'reported',
    lushaAttempted: false,
    lushaCostCredits: null,
    lushaCostSource: null,
    ...overrides,
  };
}

const RESERVED_LEGS = [
  { id: 'r1', providerKey: 'apollo' as const, operationKey: 'phone_reveal' as const, creditsReserved: 8 },
  { id: 'r2', providerKey: 'lusha' as const, operationKey: 'contact_search' as const, creditsReserved: 1 },
  { id: 'r3', providerKey: 'lusha' as const, operationKey: 'phone_reveal' as const, creditsReserved: 5 },
];

describe('R — Search reporta creditsCharged = 1', () => {
  test('se liquida 1 con verdad reported', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({
        lushaIdentitySearchAttempted: true,
        lushaIdentitySearchCostCredits: 1,
        lushaIdentitySearchCostSource: 'reported',
      }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find(
      (a) => a.providerKey === 'lusha' && a.operationKey === 'contact_search',
    );
    assert.equal(search?.action, 'confirm');
    if (search?.action !== 'confirm') return;
    assert.equal(search.credits, 1);
    assert.equal(search.costTruth, 'reported');
  });
});

describe('S — Search no reporta costo', () => {
  test('se liquida al TOPE (1) con assumed_cap, nunca 0 ni release', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({
        lushaIdentitySearchAttempted: true,
        lushaIdentitySearchCostCredits: null,
        lushaIdentitySearchCostSource: null,
      }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find(
      (a) => a.providerKey === 'lusha' && a.operationKey === 'contact_search',
    );
    assert.equal(search?.action, 'confirm');
    if (search?.action !== 'confirm') return;
    assert.equal(search.credits, 1);
    assert.equal(search.costTruth, 'assumed_cap');
  });

  test('una búsqueda que NUNCA se emitió sí se libera', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({ lushaIdentitySearchAttempted: false }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find(
      (a) => a.providerKey === 'lusha' && a.operationKey === 'contact_search',
    );
    assert.equal(search?.action, 'release');
  });
});

describe('T — Search 0 resultados pero el proveedor cobra 1', () => {
  test('se liquida 1 y el reveal se libera sin cobrar', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({
        lushaIdentitySearchAttempted: true,
        lushaIdentitySearchCostCredits: 1,
        lushaIdentitySearchCostSource: 'reported',
        lushaAttempted: false,
      }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find((a) => a.operationKey === 'contact_search');
    const reveal = settlement.find(
      (a) => a.providerKey === 'lusha' && a.operationKey === 'phone_reveal',
    );
    assert.equal(search?.action, 'confirm');
    if (search?.action === 'confirm') assert.equal(search.credits, 1);
    assert.equal(reveal?.action, 'release', 'el reveal nunca corrió: se devuelve entero');

    const breakdown = buildPhoneRevealCreditRunCostBreakdown({ settlement });
    assert.equal(breakdown.lushaIdentitySearchCredits, 1);
    assert.equal(breakdown.lushaPhoneRevealCredits, null);
    assert.equal(breakdown.lushaTotalCredits, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// U — la identidad se persiste ANTES del reveal
// ═══════════════════════════════════════════════════════════════

describe('U — provider identity persisted before reveal starts', () => {
  test('la procedencia registrada nombra la clave EXACTA de la coincidencia', async () => {
    for (const [facts, expectedMatch] of [
      [APOLLO_FACTS, 'linkedin_url'],
      [{ ...APOLLO_FACTS, linkedinUrl: null }, 'email'],
      [{ ...APOLLO_FACTS, linkedinUrl: null, email: null }, 'name_company_domain'],
      [{ ...APOLLO_FACTS, linkedinUrl: null, email: null, companyDomain: null }, 'name_company_name'],
    ] as const) {
      const h = harness({
        response: {
          outcome: { status: 'success', results: [{ id: LUSHA_ID, companyName: 'ACME', companyDomain: 'acme.com' }] },
          creditsCharged: 1,
        },
      });
      const result = await resolveLushaIdentityForWaterfall(
        resolveInput({ facts: facts as LushaIdentitySearchCandidateFacts }),
        h.deps,
      );
      assert.equal(result.status, 'ready');
      assert.equal(h.searchCalls, 1, 'una sola petición por prioridad, nunca cuatro');
      assert.equal(h.persisted[0]?.matchKey, expectedMatch);
      assert.ok(
        LUSHA_IDENTITY_MATCH_KEY_TO_RESOLUTION_SOURCE[expectedMatch].startsWith(
          'provider_search_',
        ),
      );
    }
  });

  test('sin nombre completo ni ancla de empresa NO se emite petición: 0 créditos', async () => {
    const h = harness();
    const result = await resolveLushaIdentityForWaterfall(
      resolveInput({
        facts: {
          firstName: 'Ana',
          lastName: null,
          linkedinUrl: null,
          email: null,
          companyName: 'ACME',
          companyDomain: 'acme.com',
        },
      }),
      h.deps,
    );
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.skippedReason, 'lusha_identity_unresolvable');
    assert.equal(result.runOutcome, 'no_identifier');
    assert.equal(result.searched, false);
    assert.equal(h.searchCalls, 0);
    assert.equal(h.claimCalls, 0, 'ni se reclama: reclamar sin llamar cobraría de más');
  });
});

// ═══════════════════════════════════════════════════════════════
// W — tres patas en un mismo grupo de reserva
// ═══════════════════════════════════════════════════════════════

describe('W — el mismo reservation group admite las tres patas', () => {
  const pool = {
    limitCredits: 100,
    consumedCredits: 0,
    scopeType: 'global' as const,
    scopeId: null,
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
  };
  const legs: PhoneRevealCreditReservationLeg[] = [
    { providerKey: 'apollo', operationKey: 'phone_reveal', credits: 8, ...pool },
    { providerKey: 'lusha', operationKey: 'contact_search', credits: 1, ...pool },
    { providerKey: 'lusha', operationKey: 'phone_reveal', credits: 5, ...pool },
  ];

  test('las tres se reservan y sus identidades (proveedor × operación) son únicas', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      { candidateId: CANDIDATE_ID, authorizedBy: 'user-1', reservationGroupId: 'group-1', legs },
      [],
    );
    assert.equal(outcome.status, 'reserved');
    if (outcome.status !== 'reserved') return;
    assert.equal(outcome.reservations.length, 3);
    const identities = outcome.reservations.map(
      (r) => `${r.providerKey}/${r.operationKey}`,
    );
    assert.deepEqual([...identities].sort(), [
      'apollo/phone_reveal',
      'lusha/contact_search',
      'lusha/phone_reveal',
    ]);
    assert.equal(new Set(identities).size, 3, 'ninguna colisiona con otra');
  });

  test('🔴 el saldo de Lusha se pregunta UNA vez por 6, no dos veces por 1 y 5', () => {
    const tight = legs.map((leg) =>
      leg.providerKey === 'lusha' ? { ...leg, limitCredits: 5 } : leg,
    );
    const outcome = simulatePhoneRevealCreditReservation(
      { candidateId: CANDIDATE_ID, authorizedBy: 'user-1', reservationGroupId: 'group-1', legs: tight },
      [],
    );
    assert.equal(outcome.status, 'insufficient_credits');
    if (outcome.status !== 'insufficient_credits') return;
    assert.equal(outcome.legs.length, 1, 'UN rechazo por pozo, no uno por pata');
    assert.equal(outcome.legs[0].requiredCredits, 6);
    assert.equal(outcome.legs[0].availableCredits, 5);
  });

  test('con 6 justos sí se reserva', () => {
    const exact = legs.map((leg) =>
      leg.providerKey === 'lusha' ? { ...leg, limitCredits: 6 } : leg,
    );
    const outcome = simulatePhoneRevealCreditReservation(
      { candidateId: CANDIDATE_ID, authorizedBy: 'user-1', reservationGroupId: 'group-1', legs: exact },
      [],
    );
    assert.equal(outcome.status, 'reserved');
  });
});

// ═══════════════════════════════════════════════════════════════
// X — compatibilidad hacia atrás
// ═══════════════════════════════════════════════════════════════

describe('X — reservas y corridas legacy se siguen interpretando igual', () => {
  test('una pata SIN operationKey se lee como phone_reveal', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({
        lushaAttempted: true,
        lushaCostCredits: 5,
        lushaCostSource: 'reported',
      }),
      // Exactamente la forma que producía un caller anterior a la migración 124.
      reservedLegs: [
        { id: 'r1', providerKey: 'apollo', creditsReserved: 8 },
        { id: 'r2', providerKey: 'lusha', creditsReserved: 5 },
      ],
    });
    assert.equal(settlement.length, 2);
    for (const action of settlement) {
      assert.equal(action.operationKey, 'phone_reveal');
      assert.equal(action.action, 'confirm');
    }
    const breakdown = buildPhoneRevealCreditRunCostBreakdown({ settlement });
    assert.equal(breakdown.apolloPhoneRevealCredits, 8);
    assert.equal(breakdown.lushaPhoneRevealCredits, 5);
    assert.equal(breakdown.lushaIdentitySearchCredits, null, 'no hubo búsqueda');
    assert.equal(breakdown.totalCredits, 13, 'el total legacy sigue siendo 13');
  });

  test('una corrida legacy sin sello de búsqueda no inventa un gasto de búsqueda', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      // `lushaIdentitySearchAttempted` ausente: una corrida anterior a 124.
      facts: settlementFacts({ lushaAttempted: true, lushaCostCredits: 5, lushaCostSource: 'reported' }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find((a) => a.operationKey === 'contact_search');
    assert.equal(search?.action, 'release', 'ausente ⇒ nunca se intentó ⇒ se devuelve');
  });

  test('una petición de reserva SIN operationKey produce la misma pata de siempre', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      {
        candidateId: CANDIDATE_ID,
        authorizedBy: 'user-1',
        reservationGroupId: 'group-1',
        legs: [
          {
            providerKey: 'apollo',
            credits: 8,
            limitCredits: 100,
            consumedCredits: 0,
            scopeType: 'global',
            scopeId: null,
            periodStart: '2026-08-01T00:00:00.000Z',
            periodEnd: '2026-09-01T00:00:00.000Z',
          },
        ],
      },
      [],
    );
    assert.equal(outcome.status, 'reserved');
    if (outcome.status !== 'reserved') return;
    assert.equal(outcome.reservations[0].operationKey, 'phone_reveal');
  });

  test('resolvePhoneRevealWaterfallMaxCredits sin el 2º argumento devuelve 13 / 8', () => {
    assert.equal(resolvePhoneRevealWaterfallMaxCredits(true), 13);
    assert.equal(resolvePhoneRevealWaterfallMaxCredits(false), 8);
  });

  test('resolvePhoneRevealCreditBudgetMode sin la señal nueva es conservador', () => {
    // Sin saber si la identidad está resuelta se reserva de MÁS, nunca de menos.
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({ legacyLushaOnly: false, lushaEligible: true }),
      'full_waterfall_with_identity_search',
    );
    assert.equal(
      resolvePhoneRevealCreditBudgetMode({ legacyLushaOnly: true, lushaEligible: true }),
      'legacy_lusha_only',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Y — PR331-R3: el CLAIM significa «una petición pagada va a salir»
// ═══════════════════════════════════════════════════════════════
//
// La frontera que fija este bloque es económica, no de código: la liquidación decide
// entre liberar y confirmar-al-tope mirando UN solo hecho, `lusha_identity_search_
// attempted_at`, que es exactamente lo que el claim escribe. Así que un claim tomado sin
// petición emitida cobra 1 crédito que nadie gastó.
//
//   A. PETICIÓN NO EMITIDA          → 0 claims, 0 llamadas, searched=false, RELEASE
//   B. EMITIDA O POSIBLEMENTE EMITIDA → claim=1, searched=true, CONFIRM (tope si mudo)

describe('Y — prerrequisitos locales resueltos ANTES del claim', () => {
  test('sin credencial: 0 claims, 0 llamadas, searched=false', async () => {
    const h = harness({ preflight: { status: 'unavailable', reason: 'no_credential' } });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);

    assert.equal(h.preflightCalls, 1);
    assert.equal(h.claimCalls, 0, 'el claim NO se toma: nada se va a emitir');
    assert.equal(h.searchCalls, 0);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, false, 'no se emitió petición ⇒ no se pudo cobrar');
    assert.equal(result.searchCreditsCharged, null);
    assert.equal(result.runOutcome, 'error');
    assert.equal(result.skippedReason, 'lusha_identity_error');
    assert.deepEqual(h.persisted, []);
  });

  test('un preflight que LANZA tampoco reclama: el fallo es nuestro y anterior al byte', async () => {
    const h = harness({ preflightThrows: true });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);

    assert.equal(h.claimCalls, 0);
    assert.equal(h.searchCalls, 0);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, false);
  });

  test('sin credencial + pata reservada ⇒ RELEASE, jamás confirm assumed_cap', async () => {
    const h = harness({ preflight: { status: 'unavailable', reason: 'no_credential' } });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;

    // La corrida se cierra terminal y la liquidación lee el sello del claim, que sigue
    // sin tomarse: `searched:false` y `attempted:false` son el MISMO hecho.
    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({ lushaIdentitySearchAttempted: result.searched }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find(
      (a) => a.providerKey === 'lusha' && a.operationKey === 'contact_search',
    );
    assert.equal(search?.action, 'release');
    if (search?.action !== 'release') return;
    assert.equal(search.reason, 'leg_never_attempted');

    // Y el desglose no le atribuye ni un crédito a la búsqueda.
    const breakdown = buildPhoneRevealCreditRunCostBreakdown({ settlement });
    assert.equal(breakdown.lushaIdentitySearchCredits, null);
  });

  test('identidad ya persistida: 0 preflight, 0 claims, 0 llamadas', async () => {
    const h = harness();
    const result = await resolveLushaIdentityForWaterfall(
      resolveInput({ identities: [persistedLushaIdentity] }),
      h.deps,
    );
    assert.equal(result.status, 'ready');
    assert.equal(h.preflightCalls, 0, 'ni siquiera se mira la credencial');
    assert.equal(h.claimCalls, 0);
    assert.equal(h.searchCalls, 0);
  });

  test('sin identificador buscable: 0 preflight, 0 claims, 0 llamadas', async () => {
    const h = harness();
    const result = await resolveLushaIdentityForWaterfall(
      resolveInput({
        facts: {
          firstName: 'Ana',
          lastName: null,
          linkedinUrl: null,
          email: null,
          companyName: null,
          companyDomain: null,
        },
      }),
      h.deps,
    );
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.runOutcome, 'no_identifier');
    assert.equal(result.searched, false);
    assert.equal(h.preflightCalls, 0, 'no hay petición posible: no se resuelve nada');
    assert.equal(h.claimCalls, 0);
    assert.equal(h.searchCalls, 0);
  });

  test('el orden es preflight → claim → petición, y nunca otro', async () => {
    const order: string[] = [];
    const h = harness();
    const deps: ResolveLushaIdentityDeps = {
      preflightSearch: async () => {
        order.push('preflight');
        return h.deps.preflightSearch();
      },
      claimIdentitySearch: async (runId) => {
        order.push('claim');
        return h.deps.claimIdentitySearch(runId);
      },
      searchIdentity: async (args) => {
        order.push('search');
        return h.deps.searchIdentity(args);
      },
      persistIdentity: h.deps.persistIdentity,
    };
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), deps);
    assert.equal(result.status, 'ready');
    assert.deepEqual(order, ['preflight', 'claim', 'search']);
  });

  test('un timeout TRAS invocar al cliente sigue siendo cobrado: claim=1, confirm al tope', async () => {
    const h = harness({
      response: { outcome: { status: 'provider_timeout' }, creditsCharged: null },
    });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);

    assert.equal(h.claimCalls, 1);
    assert.equal(h.searchCalls, 1);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, true, 'la petición SALIÓ: el costo es desconocido, no cero');

    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({ lushaIdentitySearchAttempted: result.searched }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find(
      (a) => a.providerKey === 'lusha' && a.operationKey === 'contact_search',
    );
    assert.equal(search?.action, 'confirm');
    if (search?.action !== 'confirm') return;
    assert.equal(search.credits, 1);
    assert.equal(search.costTruth, 'assumed_cap');
  });

  test('un throw del cliente ya invocado se asume cobrado, no gratis', async () => {
    const h = harness({ searchThrows: true });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(h.claimCalls, 1);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, true);
    assert.equal(result.runOutcome, 'error');
  });

  test('un provider_error TRAS invocar al cliente conserva la liquidación conservadora', async () => {
    const h = harness({
      response: { outcome: { status: 'provider_error' }, creditsCharged: null },
    });
    const result = await resolveLushaIdentityForWaterfall(resolveInput(), h.deps);
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') return;
    assert.equal(result.searched, true);

    const settlement = decidePhoneRevealCreditSettlement({
      facts: settlementFacts({ lushaIdentitySearchAttempted: result.searched }),
      reservedLegs: RESERVED_LEGS,
    });
    const search = settlement.find((a) => a.operationKey === 'contact_search');
    assert.equal(search?.action, 'confirm');
    if (search?.action !== 'confirm') return;
    assert.equal(search.costTruth, 'assumed_cap');
  });

  test('el preflight NO transporta la credencial: su veredicto es un enum cerrado', () => {
    // Contrato estructural: cualquier campo extra sería una vía para que un secreto
    // cruzara al core y de ahí a la telemetría.
    const ready: LushaIdentitySearchPreflightResult = { status: 'ready' };
    assert.deepEqual(Object.keys(ready), ['status']);
    for (const reason of LUSHA_IDENTITY_SEARCH_PREFLIGHT_BLOCK_REASONS) {
      const blocked: LushaIdentitySearchPreflightResult = { status: 'unavailable', reason };
      assert.deepEqual(Object.keys(blocked).sort(), ['reason', 'status']);
    }
  });
});
