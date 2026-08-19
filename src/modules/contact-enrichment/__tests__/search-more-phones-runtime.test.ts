/**
 * Tests — el RUNTIME de «Buscar más números»
 * (Agente 2A · AGENT2A-SEARCH-MORE-PHONES-1)
 *
 * ═══════════════════════════════════════════════════════════════
 * QUÉ SE AFIRMA AQUÍ, Y POR QUÉ NO EN OTRO SITIO
 * ═══════════════════════════════════════════════════════════════
 *
 * Esta es la única suite que puede observar el GASTO. El planificador puro decide si una
 * compra es autorizable y el arnés de PostgreSQL decide qué queda escrito; lo que sólo se ve
 * desde aquí es cuántas veces se llamó al proveedor, en qué orden ocurrieron los gates, y qué
 * pasa cuando uno de ellos falla a mitad de la secuencia.
 *
 * Cada caso está escrito desde la consecuencia económica o de privacidad. El contador que más
 * se mira es `world.lushaCalls`: casi todos los defectos caros de este subsistema se
 * manifiestan como una llamada de más.
 *
 * ═══════════════════════════════════════════════════════════════
 * CONTRATO FIJADO
 * ═══════════════════════════════════════════════════════════════
 *
 *   Elegibilidad   plan no elegible ⇒ 0 corridas, 0 reservas, 0 llamadas. La elegibilidad la
 *                  decide el planificador REAL (no un mock): el arnés le da hechos y usa su
 *                  veredicto, así que un cambio en el planificador se ve aquí.
 *   Presupuesto    reserva rechazada ⇒ 0 llamadas. Sin exposición no hay corrida.
 *   Idempotencia   dos submits ⇒ 1 corrida, 1 claim, 1 llamada. Se prueba con presupuesto
 *                  abundante: si sólo pasara con el pozo justo, lo que bloquearía sería el
 *                  saldo y no la idempotencia.
 *   Privacidad     supresión / DNC / no evaluable ANTES del claim ⇒ 0 llamadas y 0 créditos.
 *                  Supresión bajo el LOCK ⇒ el número se retiene y el costo se conserva ENTERO.
 *   Identidad      SOLO `POST /v3/contacts/enrich` con el id NATIVO. Nunca la búsqueda general.
 *   Overrides      el cliente no puede imponer proveedor ni techo: la entrada es escalar.
 *   Desenlaces     los cuatro se distinguen, y `no_new_distinct_phone` NUNCA se colapsa en
 *                  `no_phone_found`.
 *   Liquidación    el cierre siempre pasa por `updateWaterfallRun`, que es donde vive la
 *                  reconciliación. Un fallo de persistencia no borra el costo.
 *   Agotamiento    una corrida `search_more` terminal impide una segunda compra, con
 *                  CUALQUIER desenlace — error incluido.
 *   Alcance        0 aprobaciones de candidato, 0 escrituras en contacto oficial, 0 HubSpot.
 *
 * Offline por construcción: sin red, sin Supabase, sin Lusha, 0 créditos. La atomicidad real
 * vive en las migraciones 104 y 122 y se valida contra PostgreSQL en
 * `search-more-phones-postgres.test.ts`; aquí el ledger simulado REPRODUCE sus invariantes
 * (unicidad de corrida activa por candidato, y el claim como UPDATE condicional) para que el
 * comportamiento del motor sea observable sin base de datos.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  planSearchMorePhones,
  SEARCH_MORE_MAX_CREDITS,
  type SearchMorePlannerInput,
} from '../search-more-phones-planner';

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════
//
// Cualquier `fetch` que se escape queda registrado. Un test que pasara porque el módulo llamó
// de verdad a un proveedor no probaría nada — y en este subsistema costaría dinero.

const originalFetch = globalThis.fetch;
let httpRequests: string[] = [];

globalThis.fetch = (async (input: unknown): Promise<Response> => {
  const url =
    typeof input === 'string' ? input : ((input as { url?: string })?.url ?? String(input));
  httpRequests.push(url);
  return new Response('[]', {
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
const LUSHA_CONTACT_ID = 'v1.lusha-native-token';
const ADMIN = { internalUserId: 'admin-1', roleKey: 'admin' } as const;

/**
 * Estado del proveedor en cada test.
 *
 * ── LA FORMA IMPORTA, Y ES CONTRAINTUITIVA ──────────────────────
 *
 * `ok: false` cubre SÓLO el timeout y el error de red. TODA respuesta HTTP —402, 429, 401,
 * 403, 404, 5xx— vuelve del cliente con `ok: true`, `phones: []` y un MAPEO que declara
 * `candidateStatus: 'error'`.
 *
 * Un mock que devolviera `ok: false` para un 429 escondería el defecto que este arnés existe
 * para cazar: leer `phones.length === 0` como «Lusha no tiene teléfono» registra un fallo de
 * transporte como un hecho sobre la PERSONA, y además agota la fuente para siempre.
 */
interface LushaScript {
  /** `false` ⇒ SÓLO timeout o error de red. Un error HTTP NO se expresa así. */
  ok: boolean;
  /** Teléfonos que devuelve. Vacío = contestó y no tiene… o falló con HTTP. */
  phones: readonly { number: string; phoneType: string; rawType: string | null }[];
  /** `billing.creditsCharged`. `null` = no reportado, que NUNCA es 0. */
  creditsCharged: number | null;
  /** Veredicto del clasificador. Es lo que separa `no_phone_found` de un error HTTP. */
  candidateStatus?: 'revealed' | 'no_phone_found' | 'error';
  usageStatus?: 'success' | 'error' | 'rate_limited' | 'quota_exceeded';
  errorCode?: string | null;
}

interface World {
  /** Hechos con los que el planificador REAL decide. */
  facts: {
    candidateStatus: string | null;
    source: string | null;
    sourceContactId: string | null;
    storedUnsuppressedPhoneCount: number;
    providersWithStoredProvenance: string[];
    providersAlreadySearchedForMore: string[];
    hasActivePhoneRun: boolean;
  };
  /** `null` ⇒ la lectura de preflight LANZA (fail-closed de infraestructura). */
  preflightThrows: boolean;
  featureEnabled: boolean;
  actorRoleKey: string | null;

  /** Verdictos de la puerta de privacidad, en orden. El último se repite. */
  privacyVerdicts: string[];
  privacyCalls: number;

  /** Pozo de Lusha disponible. */
  lushaPoolAvailable: number;
  /** `true` ⇒ la escritura atómica de reserva+corrida no se puede ejecutar. */
  reserveUnavailable: boolean;

  /** Corridas activas por candidato: reproduce el índice único parcial de la 102. */
  activeRuns: Map<string, string>;
  /** Claves de idempotencia ya vistas: reproduce `authorization_key`. */
  authorizationKeys: Set<string>;
  /** Patas ya reclamadas: reproduce `UPDATE … WHERE lusha_attempted_at IS NULL`. */
  claimedRuns: Set<string>;
  /** Cierres aplicados, en orden. */
  runPatches: { runId: string; patch: Record<string, unknown> }[];
  /** Reservas liquidadas por el cierre terminal. */
  settlements: { runId: string; credits: number | null; truth: string }[];

  lusha: LushaScript;
  /**
   * Credencial de Lusha. `'missing'` reproduce una clave ausente y `'throws'` el caso real en
   * que `getLushaApiKey` LANZA porque la configuración de Supabase no está disponible: los
   * dos tienen que costar 0 y no dejar la pata sellada.
   */
  apiKey: 'present' | 'missing' | 'throws';
  /** Veces que se pidió la credencial. */
  apiKeyReads: number;
  /** Ids nativos con los que se llamó a Lusha. Su LONGITUD es el contador de gasto. */
  lushaCalls: string[];
  /** `false` ⇒ el INSERT del usage-log falla y no devuelve id. */
  usageLogInsertOk: boolean;
  usageLogs: {
    providerKey: string;
    operationKey: string;
    creditsUsed: number | null;
    status: string;
    runId: string | null;
  }[];
  /**
   * Procedencia con la que se llamó al append, por número. Es lo único desde donde se puede
   * observar si la operación PAGADA correlacionó lo que compró con la corrida, la reserva y
   * la fila del ledger, o si mandó nulls.
   */
  appendedSources: {
    waterfallRunId: string | null;
    reservationId: string | null;
    providerUsageLogId: string | null;
  }[];

  /** Respuesta del append de la 122. */
  appendResult:
    | { status: string; new_distinct_phone_count: number; updated_phone_count: number }
    | 'throw';
  appendCalls: number;

  /** Escrituras que esta operación NO puede hacer. Cualquier entrada es un fallo. */
  forbiddenWrites: string[];
}

let world: World;

function freshWorld(): World {
  return {
    facts: {
      candidateStatus: 'pending_review',
      source: 'lusha',
      sourceContactId: LUSHA_CONTACT_ID,
      storedUnsuppressedPhoneCount: 1,
      // La forma canónica: revelado por APOLLO, con identidad nativa de LUSHA en la misma
      // fila, así que Lusha es la fuente que falta.
      providersWithStoredProvenance: ['apollo'],
      providersAlreadySearchedForMore: [],
      hasActivePhoneRun: false,
    },
    preflightThrows: false,
    featureEnabled: true,
    actorRoleKey: 'admin',
    privacyVerdicts: ['clear'],
    privacyCalls: 0,
    lushaPoolAvailable: 100,
    reserveUnavailable: false,
    activeRuns: new Map(),
    authorizationKeys: new Set(),
    claimedRuns: new Set(),
    runPatches: [],
    settlements: [],
    lusha: {
      ok: true,
      phones: [{ number: '+573009998877', phoneType: 'mobile', rawType: 'mobile' }],
      creditsCharged: 5,
    },
    apiKey: 'present',
    apiKeyReads: 0,
    lushaCalls: [],
    usageLogInsertOk: true,
    usageLogs: [],
    appendedSources: [],
    appendResult: {
      status: 'persisted',
      new_distinct_phone_count: 1,
      updated_phone_count: 0,
    },
    appendCalls: 0,
    forbiddenWrites: [],
  };
}

function nextPrivacyVerdict(): string {
  const index = Math.min(world.privacyCalls, world.privacyVerdicts.length - 1);
  world.privacyCalls += 1;
  return world.privacyVerdicts[index];
}

/**
 * Construye el plan con el planificador REAL a partir de los hechos del mundo.
 *
 * `privacyState` entra como ARGUMENTO y no se lee del mundo porque el veredicto lo produce la
 * puerta, y la puerta se consulta DOS veces por operación: una en el preflight y otra después
 * de crear la corrida. Leerlo del mundo haría que las dos consultas vieran el mismo valor y la
 * suite no podría expresar el caso que más importa — una DSAR registrada EN EL HUECO entre las
 * dos.
 */
function planFromWorld(privacyState: string) {
  const input: SearchMorePlannerInput = {
    featureEnabled: world.featureEnabled,
    actorRoleKey: world.actorRoleKey,
    candidateId: CANDIDATE_ID,
    candidateStatus: world.facts.candidateStatus,
    storedUnsuppressedPhoneCount: world.facts.storedUnsuppressedPhoneCount,
    source: world.facts.source,
    sourceContactId: world.facts.sourceContactId,
    providersWithStoredProvenance: world.facts.providersWithStoredProvenance,
    providersAlreadySearchedForMore: world.facts.providersAlreadySearchedForMore,
    hasActivePhoneRun: world.facts.hasActivePhoneRun,
    // El SERVIDOR nunca pasa `unknown`: la puerta real produce un hecho o `check_unavailable`.
    privacyState: privacyState as SearchMorePlannerInput['privacyState'],
  };
  return planSearchMorePhones(input);
}

// ═══════════════════════════════════════════════════════════════
// Mocks — la frontera de I/O, y nada más
// ═══════════════════════════════════════════════════════════════

// AGENT2A-SEARCH-MORE-PHONES-1H: el runtime lee EXCLUSIVAMENTE `isSearchMorePhonesEnabled`
// para decidir si «Buscar más números» existe. `isLushaPhoneRevealFallbackEnabled` YA NO
// se importa desde `search-more-phones-runtime.ts` — si volviera a importarse, este mock NO
// lo proveería y la suite fallaría al cargar el módulo, así que un acoplamiento accidental
// hacia atrás rompe la suite en vez de pasar en silencio.
mock.module('@/lib/feature-flags.server', {
  namedExports: {
    isSearchMorePhonesEnabled: () => world.featureEnabled,
    isPhoneRevealWaterfallEnabled: () => false,
    resolveLushaSearchTimeoutMs: () => 10_000,
  },
});

// El PLANIFICADOR es real. Lo que se simula es la LECTURA que le da los hechos.
mock.module('@/modules/contact-enrichment/search-more-phones-read', {
  namedExports: {
    readSearchMorePreflight: async () => {
      if (world.preflightThrows) throw new Error('preflight read failed');
      // La lectura REAL consulta la puerta de privacidad, así que el arnés consume un
      // veredicto aquí. Sin esto, la re-comprobación del runtime recibiría el PRIMER valor y
      // la suite no podría expresar «autorizado en el preflight, suprimido un instante
      // después», que es exactamente el hueco que la segunda puerta existe para cerrar.
      const observedPrivacy = nextPrivacyVerdict();
      const plan = planFromWorld(observedPrivacy);
      return {
        facts: {
          candidateId: CANDIDATE_ID,
          candidateStatus: world.facts.candidateStatus,
          source: world.facts.source,
          sourceContactId: world.facts.sourceContactId,
          storedUnsuppressedPhoneCount: world.facts.storedUnsuppressedPhoneCount,
          providersWithStoredProvenance: world.facts.providersWithStoredProvenance,
          providersAlreadySearchedForMore: world.facts.providersAlreadySearchedForMore,
          hasActivePhoneRun: world.facts.hasActivePhoneRun,
          privacyState: observedPrivacy,
        },
        summary: {
          candidateId: CANDIDATE_ID,
          storedPhoneCount: world.facts.storedUnsuppressedPhoneCount,
          hasLushaNativeIdentity: world.facts.source === 'lusha',
          hasActivePhoneRun: world.facts.hasActivePhoneRun,
          lushaAlreadySearched:
            world.facts.providersAlreadySearchedForMore.includes('lusha'),
          lushaHasStoredProvenance:
            world.facts.providersWithStoredProvenance.includes('lusha'),
          plan,
        },
      };
    },
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-privacy-gate', {
  namedExports: {
    checkPhoneRevealPrivacyGate: async () => nextPrivacyVerdict(),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-credit-budget-deps', {
  namedExports: {
    readPhoneRevealCreditPools: async (providerKeys: readonly string[]) => {
      // Que se pida SÓLO el pozo de Lusha es parte del contrato: pedir el de Apollo lo haría
      // capaz de bloquear una operación que Apollo no ejecuta.
      assert.deepEqual(
        [...providerKeys],
        ['lusha'],
        'search_more sólo puede leer el pozo de Lusha',
      );
      // Forma EXACTA de `PhoneRevealCreditPool[]`: una LISTA de `{ providerKey, state }`, y
      // la disponibilidad se DERIVA de `limitCredits - consumedCredits`. Un mock con un
      // `available` plano haría que el core cayera en su rama fail-closed y el arnés mediría
      // un bloqueo de presupuesto en vez del camino que cada test afirma.
      const LIMIT = 1000;
      return [
        {
          providerKey: 'lusha',
          state: {
            kind: 'configured',
            limitCredits: LIMIT,
            consumedCredits: LIMIT - world.lushaPoolAvailable,
            scopeType: 'global',
            scopeId: null,
            periodStart: '2026-08-01',
            periodEnd: '2026-08-31',
          },
        },
      ];
    },
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-credit-reservation-deps', {
  namedExports: {
    reservePhoneRevealCreditsAndCreateRun: async (args: {
      reservation: {
        candidateId: string;
        authorizationKey: string;
        reservationGroupId: string;
        legs: readonly { providerKey: string; credits: number }[];
      };
      run: Record<string, unknown>;
    }) => {
      const { reservation, run } = args;

      if (world.reserveUnavailable) {
        return { status: 'unavailable', detail: 'reserve_and_create_rpc_error' };
      }

      // Golpe idempotente: la MISMA clave devuelve la corrida que ya existía.
      if (world.authorizationKeys.has(reservation.authorizationKey)) {
        return {
          status: 'already_created',
          runId: world.activeRuns.get(reservation.candidateId) ?? 'run-1',
          reservationGroupId: reservation.reservationGroupId,
        };
      }

      // El TECHO que se reserva es el que se va a poder cobrar. Se afirma aquí y no sólo en
      // el resultado porque es lo que ocupa el pozo.
      assert.deepEqual(
        reservation.legs.map((leg) => leg.providerKey),
        ['lusha'],
        'una corrida search_more reserva UNA pata, y es de Lusha',
      );
      assert.equal(reservation.legs[0].credits, SEARCH_MORE_MAX_CREDITS);
      assert.equal(run.run_mode, 'search_more');
      assert.equal(
        run.status,
        'lusha_pending',
        'nacer en `authorized` dejaría la pata inalcanzable para el claim',
      );
      assert.equal(
        run.apollo_attempted_at,
        null,
        'Apollo no corre bajo esta autorización: su timestamp no se inventa',
      );

      if (reservation.legs[0].credits > world.lushaPoolAvailable) {
        return {
          status: 'insufficient_credits',
          legs: [
            {
              providerKey: 'lusha',
              requiredCredits: reservation.legs[0].credits,
              availableCredits: world.lushaPoolAvailable,
            },
          ],
        };
      }

      // ÍNDICE ÚNICO PARCIAL de la 102, reproducido: una corrida activa por candidato.
      if (world.activeRuns.has(reservation.candidateId)) {
        return { status: 'already_reserved' };
      }

      const runId = `run-${world.activeRuns.size + 1}`;
      world.activeRuns.set(reservation.candidateId, runId);
      world.authorizationKeys.add(reservation.authorizationKey);
      return {
        status: 'created',
        runId,
        reservationGroupId: reservation.reservationGroupId,
        reservations: [
          {
            id: `res-${runId}`,
            providerKey: 'lusha',
            creditsReserved: reservation.legs[0].credits,
          },
        ],
      };
    },
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-deps', {
  namedExports: {
    // CLAIM ATÓMICO reproducido: el segundo intento sobre la misma corrida devuelve false.
    claimLushaAttempt: async (runId: string) => {
      if (world.claimedRuns.has(runId)) return false;
      world.claimedRuns.add(runId);
      return true;
    },
    updateWaterfallRun: async (runId: string, patch: Record<string, unknown>) => {
      world.runPatches.push({ runId, patch });
      // La LIQUIDACIÓN vive enganchada a este paso en el código real. Se reproduce para que
      // «se liquidó» sea observable: costo reportado ⇒ esa cifra; desconocido ⇒ el TOPE,
      // nunca 0 y nunca release.
      const TERMINAL = [
        'completed_apollo',
        'completed_lusha',
        'exhausted',
        'error',
        'aborted',
      ];
      if (typeof patch.status === 'string' && TERMINAL.includes(patch.status)) {
        const attempted = world.claimedRuns.has(runId);
        const credits =
          typeof patch.lushaCostCredits === 'number' ? patch.lushaCostCredits : null;
        world.settlements.push({
          runId,
          credits: attempted ? (credits ?? SEARCH_MORE_MAX_CREDITS) : null,
          truth: !attempted
            ? 'released'
            : credits === null
              ? 'assumed_cap'
              : 'reported',
        });
        world.activeRuns.delete(CANDIDATE_ID);
      }
    },
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: {
    getLushaApiKey: async () => {
      world.apiKeyReads += 1;
      // LANZAR es un caso REAL, no una hipótesis: cuando las variables de Supabase no están
      // disponibles esta función tira. Un arnés que sólo devolviera `null` dejaría sin cubrir
      // la mitad del camino, y una excepción no atrapada aquí abortaría la operación DESPUÉS
      // del claim, que es justo el defecto que se está cerrando.
      if (world.apiKey === 'throws') {
        throw new Error('enrichment_configuration_unavailable');
      }
      return world.apiKey === 'missing' ? null : 'test-key';
    },
  },
});

mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    // ÚNICA vía sancionada: enriquecimiento POR ID. Este mock no expone ninguna función de
    // búsqueda general, así que si el runtime la buscara, fallaría al importar.
    enrichLushaContactPhonesForFallback: async ({
      contactId,
      allowPhoneReveal,
    }: {
      contactId: string;
      allowPhoneReveal: boolean;
    }) => {
      assert.equal(allowPhoneReveal, true, 'el reveal se pide explícitamente');
      world.lushaCalls.push(contactId);
      if (!world.lusha.ok) {
        return { ok: false, errorMessage: 'lusha upstream 500' };
      }
      const phones = world.lusha.phones;
      const elected = phones.length > 0 ? phones[0] : null;
      const candidateStatus =
        world.lusha.candidateStatus ?? (phones.length > 0 ? 'revealed' : 'no_phone_found');
      return {
        ok: true,
        httpStatus: 200,
        phones,
        phoneNumber: elected?.number ?? null,
        phoneType: elected?.phoneType ?? 'unknown',
        phoneRawType: elected?.rawType ?? null,
        creditsCharged: world.lusha.creditsCharged,
        // Forma EXACTA de `LushaPhoneFallbackStatusMapping`, que viaja aplanada en la
        // respuesta `ok: true`.
        candidateStatus,
        usageStatus:
          world.lusha.usageStatus ?? (candidateStatus === 'error' ? 'error' : 'success'),
        errorCode: world.lusha.errorCode ?? null,
        costSource: world.lusha.creditsCharged === null ? 'unknown' : 'reported',
        availabilitySource: null,
        phonesReturned: phones.length,
      };
    },
  },
});

/**
 * El ledger del proveedor.
 *
 * `logProviderUsageReturningId` es una función NUEVA junto a `logProviderUsage`, no un cambio
 * de ésta: decenas de llamadores dependen de que la original devuelva `boolean`. Las dos se
 * exportan aquí para que un import de la antigua siga resolviendo.
 *
 * Devuelve `{ ok, id }` con la MISMA forma que la real, incluido el caso en que el insert
 * falla: `{ ok: false, id: null }`. Ese caso importa porque la procedencia tiene que quedar
 * con `provider_usage_log_id = null` SÓLO cuando el log genuinamente no se escribió — nunca
 * porque el runtime tirase el id que sí obtuvo.
 */
let usageLogSeq = 0;

mock.module('@/modules/usage-tracking/logging', {
  namedExports: {
    logProviderUsage: async () => true,
    logProviderUsageReturningId: async (entry: Record<string, unknown>) => {
      const metadata = (entry.metadata as Record<string, unknown> | undefined) ?? {};
      world.usageLogs.push({
        providerKey: String(entry.provider_key),
        operationKey: String(entry.operation_key),
        creditsUsed: typeof entry.credits_used === 'number' ? entry.credits_used : null,
        status: String(entry.status),
        runId:
          typeof metadata.phone_reveal_waterfall_id === 'string'
            ? metadata.phone_reveal_waterfall_id
            : null,
      });
      if (!world.usageLogInsertOk) return { ok: false, id: null };
      usageLogSeq += 1;
      return { ok: true, id: `usage-log-${usageLogSeq}` };
    },
  },
});

mock.module('@/modules/contact-enrichment/candidate-search-more-phone-append-persistence', {
  namedExports: {
    appendCandidateSearchMorePhones: async (request: {
      candidateId: string;
      phones: readonly { sources?: readonly Record<string, unknown>[] }[];
    }) => {
      world.appendCalls += 1;
      // La procedencia va en `sources` (PLURAL) de cada teléfono canónico: un mismo número
      // puede acumular varias observaciones, y es cada una la que lleva su correlación.
      for (const phone of request.phones) {
        for (const source of phone.sources ?? []) {
          world.appendedSources.push({
            waterfallRunId:
              typeof source.waterfallRunId === 'string' ? source.waterfallRunId : null,
            reservationId:
              typeof source.reservationId === 'string' ? source.reservationId : null,
            providerUsageLogId:
              typeof source.providerUsageLogId === 'string'
                ? source.providerUsageLogId
                : null,
          });
        }
      }
      // TODOS los teléfonos de la respuesta, no sólo el primero. Es la propiedad que 4O-D
      // compró y que este camino no puede perder.
      assert.equal(
        request.phones.length,
        world.lusha.phones.length,
        'la colección tiene que llevar TODOS los números que Lusha devolvió',
      );
      if (world.appendResult === 'throw') {
        throw new Error('append rpc failed');
      }
      return {
        ...world.appendResult,
        inserted_phone_count: world.appendResult.new_distinct_phone_count,
        inserted_source_count: 1,
        suppressed_skipped_count: 0,
        primary_dedupe_key: 'abc',
        primary_persisted: true,
        candidate_scalar_updated: false,
      };
    },
  },
});

// Superficies que esta operación NO puede tocar. Se cablean para que un import accidental
// quede REGISTRADO en vez de pasar desapercibido.
mock.module('@/modules/contact-enrichment/candidate-lusha-phone-collection-persistence', {
  namedExports: {
    persistCandidateLushaPhoneCollection: async () => {
      world.forbiddenWrites.push('terminal_reveal_writer');
      return { status: 'persisted', candidate_terminalized: true };
    },
  },
});

// El módulo se importa DENTRO de `before` y no en el tope del fichero: tsx compila `.ts` a
// CJS, así que un `await` de nivel superior no compila. El `import()` diferido además
// garantiza que los `mock.module` de arriba ya estén registrados cuando el runtime resuelva
// sus dependencias.
let executeSearchMorePhonesForCandidate: typeof import('../search-more-phones-runtime').executeSearchMorePhonesForCandidate;
let SEARCH_MORE_LUSHA_OPERATION_KEY: string;

before(async () => {
  const mod = await import('../search-more-phones-runtime');
  executeSearchMorePhonesForCandidate = mod.executeSearchMorePhonesForCandidate;
  SEARCH_MORE_LUSHA_OPERATION_KEY = mod.SEARCH_MORE_LUSHA_OPERATION_KEY;
});

async function run() {
  return executeSearchMorePhonesForCandidate({
    candidateId: CANDIDATE_ID,
    actor: { ...ADMIN },
  });
}

beforeEach(() => {
  world = freshWorld();
  httpRequests = [];
  // El contador del ledger vive fuera del mundo (el mock se registra una sola vez), así que se
  // reinicia aquí: sin esto los ids se acumularían entre casos y un aserto sobre
  // `usage-log-1` mediría el orden de ejecución de la suite, no el runtime.
  usageLogSeq = 0;
});

// ═══════════════════════════════════════════════════════════════

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · el camino que SÍ paga', () => {
  it('§10 CASE C — un número nuevo: `revealed`, 1 adicional, y se liquida con el costo REAL', async () => {
    const result = await run();

    assert.equal(result.outcome, 'new_phones_found');
    assert.equal(result.newDistinctPhoneCount, 1);
    assert.equal(result.lushaOutcome, 'revealed');
    assert.equal(result.maxCreditsAuthorized, SEARCH_MORE_MAX_CREDITS);
    assert.equal(world.lushaCalls.length, 1, 'UNA llamada, sin retry');
    assert.equal(world.appendCalls, 1);

    const settlement = world.settlements.at(-1);
    assert.equal(settlement?.credits, 5);
    assert.equal(settlement?.truth, 'reported');
  });

  it('el techo autorizado es 5 — nunca los 8 de Apollo ni los 13 del waterfall', async () => {
    const result = await run();
    assert.equal(result.maxCreditsAuthorized, 5);
    assert.notEqual(result.maxCreditsAuthorized, 8);
    assert.notEqual(result.maxCreditsAuthorized, 13);
  });

  it('§17 el usage-log lleva `operation_key` PROPIO y el id de la corrida REAL', async () => {
    await run();
    const log = world.usageLogs.at(-1);
    assert.equal(log?.providerKey, 'lusha');
    assert.equal(
      log?.operationKey,
      SEARCH_MORE_LUSHA_OPERATION_KEY,
      'mezclarlo con el del reveal sumaría créditos de dos operaciones distintas',
    );
    assert.notEqual(log?.operationKey, 'person_phone_reveal');
    // Comparte identidad de corrida con la reserva, así que `computeEffectiveConsumption`
    // deduplica: una llamada de 5 créditos consume 5, nunca 10.
    assert.equal(log?.runId, world.runPatches.at(-1)?.runId);
  });

  it('§7 la llamada usa el id NATIVO de Lusha y NADA más', async () => {
    await run();
    assert.deepEqual(world.lushaCalls, [LUSHA_CONTACT_ID]);
  });

  it('§7/§17 NUNCA se toca la búsqueda general de Lusha ni ningún host de proveedor', async () => {
    await run();
    // El cliente está mockeado, así que ni un `fetch` debería haber salido. Si aparece uno,
    // significa que alguna ruta se saltó la frontera de I/O sancionada.
    assert.deepEqual(
      httpRequests.filter((url) => /lusha\.com|apollo\.io|hubapi\.com/.test(url)),
      [],
    );
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · nada se gasta sin autorización', () => {
  it('§20.12 reserva RECHAZADA por saldo ⇒ 0 llamadas a Lusha', async () => {
    world.lushaPoolAvailable = 4;
    const result = await run();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'insufficient_credits');
    assert.equal(world.lushaCalls.length, 0, 'sin exposición reservada NO se llama');
    assert.equal(world.appendCalls, 0);
    assert.equal(result.maxCreditsAuthorized, null);
  });

  it('§20.12 la escritura atómica NO disponible ⇒ 0 llamadas, y NO se culpa al saldo', async () => {
    world.reserveUnavailable = true;
    const result = await run();

    assert.equal(result.outcome, 'not_started');
    assert.equal(
      result.reason,
      'run_creation_unavailable',
      'el saldo se verificó bien: decir `insufficient_credits` describiría un problema que no tuvo',
    );
    assert.equal(world.lushaCalls.length, 0);
  });

  it('una lectura de preflight que LANZA es fail-closed, y no se reporta como «no elegible»', async () => {
    world.preflightThrows = true;
    const result = await run();

    assert.equal(result.outcome, 'not_started');
    assert.equal(
      result.reason,
      'preflight_unavailable',
      'el candidato puede aplicar perfectamente: lo que falló fue mirar',
    );
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§20.7 un rol NO admin ⇒ 0 corridas y 0 llamadas, aunque invoque el runtime directo', async () => {
    world.actorRoleKey = 'commercial_manager';
    const result = await run();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'role_not_allowed');
    assert.equal(world.activeRuns.size, 0);
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§20.1 sin teléfono guardado ⇒ 0 llamadas (ahí toca «Revelar teléfono»)', async () => {
    world.facts.storedUnsuppressedPhoneCount = 0;
    const result = await run();
    assert.equal(result.reason, 'no_stored_phone');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§20.3 sin identidad nativa de Lusha ⇒ 0 llamadas y NUNCA una búsqueda por nombre', async () => {
    world.facts.source = 'apollo';
    world.facts.sourceContactId = 'a1b2c3d4e5f60718293a4b5c';
    const result = await run();

    assert.equal(result.reason, 'missing_person_identity');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§20.4 Lusha ya tiene procedencia almacenada ⇒ 0 llamadas (su respuesta ya está)', async () => {
    world.facts.providersWithStoredProvenance = ['apollo', 'lusha'];
    const result = await run();

    assert.equal(result.reason, 'no_additional_provider');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§20.6 con una corrida de teléfono ACTIVA ⇒ 0 llamadas', async () => {
    world.facts.hasActivePhoneRun = true;
    const result = await run();

    assert.equal(result.reason, 'active_run_exists');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§20.5/§18 una corrida `search_more` TERMINAL impide una segunda compra', async () => {
    world.facts.providersAlreadySearchedForMore = ['lusha'];
    const result = await run();

    assert.equal(result.reason, 'providers_exhausted');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('§18 el agotamiento NO depende del desenlace: un `error` previo tampoco reabre', async () => {
    // El planificador lee que la corrida fue TERMINAL, no cómo terminó. Los cuatro
    // desenlaces —`revealed`, `no_phone_found`, `no_new_distinct_phone`, `error`— producen la
    // misma entrada, así que un fallo del proveedor no compra un reintento pagado.
    world.facts.providersAlreadySearchedForMore = ['lusha'];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await run();
      assert.equal(result.outcome, 'not_started');
      assert.equal(result.reason, 'providers_exhausted');
    }
    assert.equal(world.lushaCalls.length, 0, 'ni una llamada en tres intentos');
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · idempotencia', () => {
  it('§20.13/§20.14 DOS submits ⇒ 1 corrida, 1 claim y 1 SOLA llamada a Lusha', async () => {
    // Pozo ABUNDANTE a propósito: si esto sólo pasara con el pozo justo, lo que estaría
    // bloqueando la segunda compra sería el saldo y no la idempotencia — y el defecto
    // seguiría vivo en cuanto hubiera créditos.
    world.lushaPoolAvailable = 1000;

    const [first, second] = await Promise.all([run(), run()]);

    assert.equal(world.lushaCalls.length, 1, 'UNA sola llamada pagada');
    assert.equal(world.appendCalls <= 1, true, 'como máximo una escritura');

    // Uno gana; el otro es rechazado ANTES de pagar por el índice único de corrida activa.
    const outcomes = [first.outcome, second.outcome].sort();
    assert.ok(
      outcomes.includes('new_phones_found'),
      `uno de los dos tenía que completarse: ${JSON.stringify(outcomes)}`,
    );
    const loser = [first, second].find((r) => r.outcome !== 'new_phones_found');
    assert.ok(
      loser?.reason === 'active_run_exists' || loser?.outcome === 'already_attempted',
      `el perdedor tiene que salir por el índice único o por el claim: ${JSON.stringify(loser)}`,
    );
  });

  it('el CLAIM perdido no cierra la corrida ajena ni vuelve a llamar', async () => {
    // La corrida existe y su pata ya está reclamada por otro disparador.
    world.activeRuns.clear();
    world.claimedRuns.add('run-1');

    const result = await run();

    assert.equal(result.outcome, 'already_attempted');
    assert.equal(result.reason, 'lusha_claim_lost');
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(
      world.runPatches.length,
      0,
      'cerrar la corrida ajena le robaría el cierre al que sí está pagando',
    );
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · privacidad', () => {
  // ── LAS DOS COLUMNAS SE AFIRMAN JUNTAS ──────────────────────
  //
  // `error_code` y `lusha_skipped_reason` describen el bloqueo por separado, y el vocabulario
  // del waterfall los distingue A PROPÓSITO: el efecto de los tres estados es idéntico
  // (fail-closed, 0 llamadas), la AFIRMACIÓN no.
  //
  // Estos casos existen porque afirmar sólo `error_code` dejaba pasar un defecto REAL: el
  // runtime escribía `lusha_skipped_reason = 'suppressed'` para los TRES, así que una
  // comprobación que no se pudo hacer quedaba registrada como una supresión CONFIRMADA. La
  // columna que la UI y la auditoría leen decía un hecho que nadie estableció.
  for (const privacyCase of [
    {
      label: 'supresión CONFIRMADA',
      verdict: 'blocked_suppressed',
      errorCode: 'blocked_suppressed',
      skippedReason: 'suppressed',
      status: 'aborted',
    },
    {
      label: 'comprobación NO EVALUABLE',
      verdict: 'check_unavailable',
      errorCode: 'suppression_check_unavailable',
      // NUNCA `'suppressed'`: no se obtuvo ningún veredicto que confirmar.
      skippedReason: 'suppression_check_unavailable',
      status: 'error',
    },
    {
      label: 'do_not_contact',
      verdict: 'do_not_contact',
      errorCode: 'do_not_contact',
      skippedReason: 'dnc',
      status: 'aborted',
    },
  ]) {
    it(`§20.15 ${privacyCase.label} ANTES del claim ⇒ 0 llamadas, y las DOS columnas dicen la verdad`, async () => {
      world.privacyVerdicts = ['clear', privacyCase.verdict];
      const result = await run();

      assert.equal(result.outcome, 'privacy_blocked');
      assert.equal(result.lushaCalled, false);
      assert.equal(world.lushaCalls.length, 0, 'fail-closed: el efecto es el mismo');
      assert.equal(result.lushaOutcome, null, 'la pata nunca se intentó');

      const patch = world.runPatches.at(-1)?.patch;
      assert.equal(patch?.errorCode, privacyCase.errorCode);
      assert.equal(
        patch?.lushaSkippedReason,
        privacyCase.skippedReason,
        'colapsar los tres en `suppressed` convierte una comprobación imposible en un hecho',
      );
      assert.equal(patch?.status, privacyCase.status);
      // La pata no se intentó, así que la exposición se LIBERA entera.
      assert.equal(world.settlements.at(-1)?.truth, 'released');
    });
  }

  it('§20.16 una comprobación IMPOSIBLE nunca se registra como una supresión CONFIRMADA', async () => {
    world.privacyVerdicts = ['clear', 'check_unavailable'];
    await run();
    const patch = world.runPatches.at(-1)?.patch;
    assert.notEqual(
      patch?.lushaSkippedReason,
      'suppressed',
      'SellUp no declara un veredicto de privacidad que nunca obtuvo',
    );
    assert.notEqual(patch?.errorCode, 'blocked_suppressed');
  });

  it('la privacidad se resuelve DOS veces: en el preflight y otra vez tras crear la corrida', async () => {
    await run();
    assert.equal(
      world.privacyCalls,
      2,
      'entre el preflight y la llamada pueden pasar minutos: el veredicto NO se hereda',
    );
  });

  it('§11 supresión bajo el LOCK: se retiene el NÚMERO y el costo se conserva ENTERO', async () => {
    world.appendResult = {
      status: 'suppressed',
      new_distinct_phone_count: 0,
      updated_phone_count: 0,
    };
    const result = await run();

    assert.equal(result.outcome, 'privacy_blocked');
    assert.equal(result.newDistinctPhoneCount, 0);
    assert.equal(world.lushaCalls.length, 1, 'Lusha YA se llamó y YA cobró');

    // El gasto se registra ENTERO: fingir 0 aquí perdería un cobro real.
    const patch = world.runPatches.at(-1)?.patch;
    assert.equal(patch?.lushaCostCredits, 5);
    assert.equal(patch?.lushaCostSource, 'reported');
    assert.equal(world.settlements.at(-1)?.credits, 5);
    assert.equal(
      world.usageLogs.at(-1)?.creditsUsed,
      5,
      'el usage-log vive fuera de la transacción para sobrevivir a este bloqueo',
    );
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · la credencial NO puede fabricar un gasto', () => {
  // ── POR QUÉ ESTE BLOQUE EXISTE ──────────────────────────────
  //
  // La credencial se resolvía DESPUÉS del claim atómico. Con una clave ausente, la corrida
  // quedaba con `lusha_attempted_at` sellado y CERO llamadas al proveedor; la liquidación no
  // puede saber desde la fila que la llamada no salió, ve una pata INTENTADA sin costo
  // reportado, y aplica su regla conservadora: confirmar el TOPE. Resultado: 5 créditos
  // ocupados por una operación que no llamó a nadie.
  //
  // Ser conservador es correcto cuando el proveedor PUDO haber cobrado. Aquí no pudo, porque
  // nadie lo llamó: la cifra no era prudente, era falsa.
  //
  // Leer la clave no es una llamada al proveedor y no cuesta un crédito, así que resolverla
  // antes del claim no adelanta ningún gasto — sólo evita inventar una pata intentada.
  for (const keyCase of [
    { label: 'ausente', apiKey: 'missing' as const },
    { label: 'ilegible (getLushaApiKey LANZA)', apiKey: 'throws' as const },
  ]) {
    it(`§17 clave ${keyCase.label} ⇒ 0 llamadas, 0 usage-logs y la reserva se LIBERA`, async () => {
      world.apiKey = keyCase.apiKey;
      const result = await run();

      // 4 · 0 llamadas al proveedor.
      assert.equal(world.lushaCalls.length, 0, 'no se llamó a nadie');
      // 9 · 0 filas en el ledger: no hay consumo que registrar.
      assert.equal(world.usageLogs.length, 0, 'un usage-log afirmaría un consumo inexistente');
      // 5 · el claim NO se tomó.
      assert.equal(
        world.claimedRuns.size,
        0,
        'el claim se toma DESPUÉS de la credencial: sellarlo antes fabrica la pata intentada',
      );
      // 7 · la exposición se libera entera.
      const settlement = world.settlements.at(-1);
      assert.equal(
        settlement?.truth,
        'released',
        'pata NO intentada ⇒ release. Confirmar el TOPE aquí ocuparía 5 créditos por 0 llamadas',
      );
      // 8 · 0 créditos confirmados.
      assert.equal(settlement?.credits, null, 'no hay ninguna cifra que confirmar');

      // 10 · la corrida terminal no miente sobre lo que Lusha contestó.
      const patch = world.runPatches.at(-1)?.patch;
      assert.equal(patch?.errorCode, 'lusha_api_key_missing');
      assert.equal(
        patch?.lushaOutcome,
        undefined,
        'un `lusha_outcome` afirmaría que Lusha respondió algo',
      );
      assert.notEqual(patch?.lushaOutcome, 'error');
      assert.equal(patch?.lushaCostCredits, null);
      assert.equal(patch?.lushaCostSource, 'unknown', 'no reportado, y jamás 0');

      assert.equal(result.lushaCalled, false);
      assert.equal(result.lushaOutcome, null);
      assert.equal(
        result.outcome,
        'not_started',
        '`provider_error` diría que el proveedor falló, y el proveedor nunca fue llamado',
      );
      assert.equal(result.reason, 'lusha_api_key_missing');
      assert.equal(result.newDistinctPhoneCount, 0);
      // La colección no se toca: no hay nada que añadir.
      assert.equal(world.appendCalls, 0);
    });
  }

  it('6 · la credencial se lee ANTES del claim, no después', async () => {
    // Se observa por el ORDEN: con la clave ausente el claim no puede haberse tomado, y la
    // credencial sí se leyó. Al revés —claim primero— el contador de claims sería 1.
    world.apiKey = 'missing';
    await run();
    assert.equal(world.apiKeyReads, 1, 'la credencial se resolvió');
    assert.equal(world.claimedRuns.size, 0, 'y el claim NO se tomó');
  });

  it('la corrida SÍ se creó y se cerró terminal: no queda nada vivo bloqueando al candidato', async () => {
    world.apiKey = 'missing';
    await run();
    // Terminal ⇒ el índice único parcial de la 102 queda libre, así que un reintento
    // posterior (con la clave configurada) no choca contra una corrida fantasma.
    assert.equal(world.runPatches.length, 1);
    assert.equal(world.runPatches.at(-1)?.patch.status, 'error');
    assert.equal(world.activeRuns.size, 0);
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · procedencia de una compra PAGADA', () => {
  // «Buscar más números» cuesta dinero, así que cada número que entra por aquí tiene que poder
  // señalar las TRES cosas que lo respaldan: la corrida que lo autorizó, la reserva que
  // sostuvo su costo y la fila del ledger que lo registró. Mandar `null` en dos de las tres
  // obligaba a reconstruir la cadena por grupo de reserva o por ventana de tiempo.
  it('11+12+13 · las tres correlaciones viajan, y son las de ESTA operación', async () => {
    const result = await run();
    assert.equal(result.outcome, 'new_phones_found');

    const runId = world.runPatches.at(-1)?.runId;
    const source = world.appendedSources.at(-1);

    assert.equal(source?.waterfallRunId, runId, 'la corrida EXACTA de esta compra');
    assert.equal(
      source?.reservationId,
      `res-${runId}`,
      'la reserva EXACTA que respaldó el costo, tomada del resultado de la transacción',
    );
    assert.equal(
      source?.providerUsageLogId,
      'usage-log-1',
      'la fila EXACTA del ledger: descartar el id que el insert devolvió ya no es aceptable',
    );
    assert.notEqual(source?.reservationId, null);
    assert.notEqual(source?.providerUsageLogId, null);
  });

  it('12 · la reserva se toma del resultado atómico, sin una consulta extra a la base', async () => {
    // El arnés no expone ninguna lectura de reservas: si el runtime necesitara una consulta
    // para conocer el id, no habría de dónde sacarlo y el aserto de abajo fallaría.
    await run();
    assert.equal(world.appendedSources.at(-1)?.reservationId, 'res-run-1');
  });

  it('14 · un número DUPLICADO conserva la misma correlación de procedencia', async () => {
    // El teléfono canónico ya existía: la 122 no inserta otro, pero sí una fila de
    // procedencia nueva. Esa fila describe una compra REAL y por eso lleva los mismos tres
    // ids — es lo que permite saber qué se pagó por reconfirmar un número que ya se tenía.
    world.appendResult = {
      status: 'persisted',
      new_distinct_phone_count: 0,
      updated_phone_count: 1,
    };
    const result = await run();

    assert.equal(result.lushaOutcome, 'no_new_distinct_phone');
    assert.equal(result.newDistinctPhoneCount, 0);

    const runId = world.runPatches.at(-1)?.runId;
    const source = world.appendedSources.at(-1);
    assert.equal(source?.waterfallRunId, runId);
    assert.equal(source?.reservationId, `res-${runId}`);
    assert.equal(source?.providerUsageLogId, 'usage-log-1');
  });

  it('14 · si el usage-log FALLA, el id es null pero el gasto real NO se borra', async () => {
    // El proveedor ya cobró. Que su ledger no se pudiera escribir no puede convertirse en
    // «no pasó nada»: la corrida y la reserva siguen contando el gasto ENTERO, y la
    // procedencia lleva `null` sólo porque el log genuinamente no existe.
    world.usageLogInsertOk = false;
    const result = await run();

    assert.equal(result.outcome, 'new_phones_found');
    assert.equal(world.lushaCalls.length, 1, 'el proveedor SÍ corrió');

    const runId = world.runPatches.at(-1)?.runId;
    const source = world.appendedSources.at(-1);
    assert.equal(
      source?.providerUsageLogId,
      null,
      'null porque el log falló, no porque se tirara un id que sí se obtuvo',
    );
    // Lo que NO se pierde: las otras dos correlaciones y el costo.
    assert.equal(source?.waterfallRunId, runId);
    assert.equal(source?.reservationId, `res-${runId}`);
    assert.equal(world.runPatches.at(-1)?.patch.lushaCostCredits, 5);
    assert.equal(world.settlements.at(-1)?.credits, 5);
    assert.equal(world.settlements.at(-1)?.truth, 'reported');
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · un costo NO REPORTADO no es un costo CERO', () => {
  // Corrección de semántica: `costSource` nulo / `unknown` significa «no se reportó», y NO es
  // prueba de que el proveedor no cobrara. El clasificador sólo registra 0 cuando
  // `billing.creditsCharged` dice explícitamente 0.
  //
  // De ahí se sigue lo único que importa operativamente: de un 402 o un 429 no se deduce que
  // fueran gratuitos, así que no habilitan ningún reintento «seguro».
  for (const unpaidClaim of [
    { label: '402', usageStatus: 'quota_exceeded' as const, errorCode: 'insufficient_credits' },
    { label: '429', usageStatus: 'rate_limited' as const, errorCode: 'rate_limited' },
  ]) {
    it(`15+16+17+18 · un ${unpaidClaim.label} es error, con costo DESCONOCIDO y sin reintento`, async () => {
      world.lusha = {
        ok: true,
        phones: [],
        creditsCharged: null,
        candidateStatus: 'error',
        usageStatus: unpaidClaim.usageStatus,
        errorCode: unpaidClaim.errorCode,
      };

      const result = await run();

      // 15/16 · error, nunca «no hay teléfono».
      assert.equal(result.outcome, 'provider_error');
      assert.equal(result.lushaOutcome, 'error');
      assert.notEqual(result.lushaOutcome, 'no_phone_found');

      // 17 · un costo no reportado NO se convierte en 0 en ninguna columna.
      const patch = world.runPatches.at(-1)?.patch;
      assert.equal(patch?.lushaCostCredits, null, 'no reportado se guarda como null');
      assert.notEqual(patch?.lushaCostCredits, 0, 'jamás 0: eso afirmaría que fue gratis');
      assert.equal(patch?.lushaCostSource, 'unknown');
      assert.notEqual(patch?.lushaCostSource, 'reported');
      assert.equal(
        world.usageLogs.at(-1)?.creditsUsed,
        null,
        'el ledger tampoco infiere 0 de un costo que nadie reportó',
      );
      // La liquidación conservadora: desconocido ⇒ el TOPE, nunca release, nunca 0.
      assert.equal(world.settlements.at(-1)?.truth, 'assumed_cap');
      assert.equal(world.settlements.at(-1)?.credits, SEARCH_MORE_MAX_CREDITS);

      // 18 · una sola llamada. No hay reintento automático, y tampoco se habilita uno manual
      // «porque no cobró»: eso exigiría evidencia del contrato del proveedor.
      assert.equal(world.lushaCalls.length, 1, 'sin retry');
    });
  }
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · los cuatro desenlaces', () => {
  it('§10 CASE A — `phones: []` ⇒ `no_phone_found`, y NO se llama al append', async () => {
    world.lusha.phones = [];
    const result = await run();

    assert.equal(result.outcome, 'no_new_phones');
    assert.equal(result.lushaOutcome, 'no_phone_found');
    assert.equal(
      world.appendCalls,
      0,
      'no hay nada que añadir: fabricar un `no_incoming_phones` inventaría un hecho',
    );
    // Contestar «no tengo» también se cobra.
    assert.equal(world.runPatches.at(-1)?.patch.lushaCostCredits, 5);
  });

  it('§10 CASE B — sólo duplicados ⇒ `no_new_distinct_phone`, NUNCA `no_phone_found`', async () => {
    world.appendResult = {
      status: 'persisted',
      new_distinct_phone_count: 0,
      updated_phone_count: 1,
    };
    const result = await run();

    assert.equal(result.outcome, 'no_new_phones');
    assert.equal(
      result.lushaOutcome,
      'no_new_distinct_phone',
      'colapsarlo en `no_phone_found` afirmaría que Lusha no tiene teléfono, y lo tiene',
    );
    assert.notEqual(result.lushaOutcome, 'no_phone_found');
    assert.notEqual(result.lushaOutcome, 'revealed');
    assert.equal(result.newDistinctPhoneCount, 0);
    // Y se cobró igual.
    assert.equal(world.runPatches.at(-1)?.patch.lushaCostCredits, 5);
    assert.equal(world.settlements.at(-1)?.credits, 5);
  });

  it('§10 CASE D — fallo del proveedor ⇒ `error`, y NUNCA se degrada a not-found', async () => {
    world.lusha.ok = false;
    const result = await run();

    assert.equal(result.outcome, 'provider_error');
    assert.equal(result.lushaOutcome, 'error');
    assert.notEqual(
      result.lushaOutcome,
      'no_phone_found',
      'un fallo de red no es evidencia de que Lusha no tenga teléfono',
    );
    assert.equal(world.appendCalls, 0);
    assert.equal(world.usageLogs.at(-1)?.status, 'error');
  });

  it('§11 un append que FALLA no borra el costo: se cierra como error y se liquida', async () => {
    world.appendResult = 'throw';
    const result = await run();

    assert.equal(result.outcome, 'provider_error');
    assert.equal(world.lushaCalls.length, 1, 'Lusha ya cobró');
    assert.equal(
      world.usageLogs.at(-1)?.creditsUsed,
      5,
      'el usage-log se escribió ANTES de persistir, para sobrevivir a este fallo',
    );
    assert.equal(world.settlements.at(-1)?.credits, 5);
  });

  // ── Los errores HTTP NO son «no hay teléfono» ────────────────
  //
  // Estos cuatro casos cazan un defecto REAL que esta suite encontró: el runtime derivaba el
  // desenlace de `phones.length`, y como el cliente devuelve `ok: true` con `phones: []` para
  // TODA respuesta HTTP, un 429 o un 5xx quedaban registrados como `no_phone_found`.
  //
  // Las dos consecuencias eran caras: el ledger afirmaba que Lusha no tiene teléfono para esa
  // persona (falso, y §10 lo prohíbe), y el planificador marcaba a Lusha AGOTADA para ese
  // candidato (§18), retirando el CTA para siempre por una caída pasajera.
  for (const httpFailure of [
    { label: '429 rate limited', usageStatus: 'rate_limited' as const, errorCode: 'rate_limited' },
    {
      label: '402 sin crédito en el plan',
      usageStatus: 'quota_exceeded' as const,
      errorCode: 'insufficient_credits',
    },
    { label: '5xx del proveedor', usageStatus: 'error' as const, errorCode: 'provider_error' },
    {
      label: '403 sin la entitlement de phones',
      usageStatus: 'error' as const,
      errorCode: 'provider_permission_error',
    },
  ]) {
    it(`§10 un ${httpFailure.label} es \`error\`, NUNCA \`no_phone_found\``, async () => {
      world.lusha = {
        // El cliente devuelve `ok: true` para todo error HTTP. Ésta es la trampa.
        ok: true,
        phones: [],
        creditsCharged: null,
        candidateStatus: 'error',
        usageStatus: httpFailure.usageStatus,
        errorCode: httpFailure.errorCode,
      };

      const result = await run();

      assert.equal(result.outcome, 'provider_error');
      assert.equal(
        result.lushaOutcome,
        'error',
        'registrarlo como `no_phone_found` afirmaría un hecho sobre la PERSONA a partir de un fallo de TRANSPORTE',
      );
      assert.notEqual(result.lushaOutcome, 'no_phone_found');
      assert.equal(result.reason, httpFailure.errorCode, 'el código REAL, no un genérico');
      // La colección NO se toca: no hay nada que añadir y nada que afirmar.
      assert.equal(world.appendCalls, 0);
      // El usage-log conserva la CLASE del fallo, que es la granularidad que el ledger ya
      // tenía para esta pata.
      assert.equal(world.usageLogs.at(-1)?.status, httpFailure.usageStatus);
    });
  }

  it('§18 el copy y el ledger de un 429 NO afirman que la fuente esté vacía', async () => {
    // La consecuencia de §18 que hace caro el defecto: el planificador lee que la corrida fue
    // TERMINAL, así que Lusha queda agotada. Que el desenlace sea `error` y no
    // `no_phone_found` es lo que deja el rastro honesto de POR QUÉ se agotó — y lo que permite
    // que la dueña decida si ese caso merece una reautorización manual.
    world.lusha = {
      ok: true,
      phones: [],
      creditsCharged: null,
      candidateStatus: 'error',
      usageStatus: 'rate_limited',
      errorCode: 'rate_limited',
    };
    await run();
    const patch = world.runPatches.at(-1)?.patch;
    assert.equal(patch?.lushaOutcome, 'error');
    assert.equal(patch?.status, 'error');
    assert.notEqual(patch?.status, 'exhausted', '`exhausted` es el cierre de «la fuente no tiene»');
  });

  it('§11 un costo NO reportado se liquida con el TOPE, nunca con 0', async () => {
    world.lusha.creditsCharged = null;
    const result = await run();

    assert.equal(result.outcome, 'new_phones_found');
    const patch = world.runPatches.at(-1)?.patch;
    assert.equal(patch?.lushaCostCredits, null, 'no reportado NO es 0');
    assert.equal(patch?.lushaCostSource, 'unknown');
    assert.equal(world.settlements.at(-1)?.credits, SEARCH_MORE_MAX_CREDITS);
    assert.equal(world.settlements.at(-1)?.truth, 'assumed_cap');
  });

  it('la corrida SIEMPRE se cierra: una viva bloquearía el botón para siempre', async () => {
    for (const script of [
      () => {
        world.lusha.phones = [];
      },
      () => {
        world.lusha.ok = false;
      },
      () => {
        world.appendResult = 'throw';
      },
      () => {
        world.appendResult = {
          status: 'persisted',
          new_distinct_phone_count: 0,
          updated_phone_count: 1,
        };
      },
    ]) {
      world = freshWorld();
      script();
      await run();
      const TERMINAL = ['completed_lusha', 'exhausted', 'error', 'aborted'];
      assert.ok(
        TERMINAL.includes(String(world.runPatches.at(-1)?.patch.status)),
        `la corrida quedó en ${world.runPatches.at(-1)?.patch.status}`,
      );
    }
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · runtime · el reveal INICIAL no se toca', () => {
  it('§9/§20.30 ningún patch de la corrida reescribe una columna del reveal del candidato', async () => {
    await run();

    // El patch describe la CORRIDA, no el candidato. Si aquí apareciera una clave del reveal,
    // el cierre estaría re-atribuyendo el teléfono de Apollo a Lusha.
    const FORBIDDEN = [
      'phoneRevealProvider',
      'phoneRevealRequestedAt',
      'phoneRevealCompletedAt',
      'phoneRevealCostCredits',
      'phoneRevealCostSource',
      'phoneRevealStatus',
      'phoneRevealAttemptCount',
    ];
    for (const { patch } of world.runPatches) {
      for (const key of FORBIDDEN) {
        assert.equal(
          key in patch,
          false,
          `el patch de la corrida NO puede llevar ${key}: describe el reveal INICIAL`,
        );
      }
    }
  });

  it('§9 el writer TERMINAL del reveal (111/120) NUNCA se invoca por esta ruta', async () => {
    await run();
    assert.deepEqual(
      world.forbiddenWrites,
      [],
      'usar el writer terminal pondría provider=lusha sobre un número de Apollo y borraría su costo',
    );
  });

  it('§20.37/38/39 0 aprobaciones, 0 escrituras en contacto oficial y 0 HubSpot', async () => {
    await run();

    // Ninguna de esas superficies se importa en el runtime, así que la comprobación fuerte es
    // estática (ver la suite de contrato de imports). Aquí se afirma la consecuencia
    // observable: ni un `fetch` a HubSpot y ninguna escritura prohibida registrada.
    assert.deepEqual(
      httpRequests.filter((url) => url.includes('hubapi.com')),
      [],
    );
    assert.deepEqual(world.forbiddenWrites, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// GUARDAS ESTÁTICAS — lo que ninguna ejecución puede demostrar
// ═══════════════════════════════════════════════════════════════
//
// Los casos de arriba observan el comportamiento con las dependencias simuladas. Estas
// guardas leen el FICHERO, y cubren justo lo que un mock no puede: que la garantía no depende
// de que el arnés haya cableado bien las cosas, sino de que la llamada peligrosa NO EXISTE en
// el código.

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, '..');
const readModule = (name: string): string =>
  readFileSync(join(moduleDir, name), 'utf8');

/** Quita comentarios de línea y de bloque: sólo queda lo EJECUTABLE. */
function executable(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('AGENT2A-SEARCH-MORE-PHONES-1 · el preflight sólo puede LEER', () => {
  const read = executable(readModule('search-more-phones-read.ts'));

  it('§3 la lectura de preflight NO contiene ninguna llamada de escritura', () => {
    // El sondeo de la UI llama a esta cadena en bucle. Si aquí existiera un `.insert()`, un
    // `.update()`, un `.delete()` o un `.rpc()`, mirar la pantalla podría escribir o gastar —
    // y «sondear no gasta» dejaría de ser una propiedad del código para pasar a ser una
    // intención de quien lo escribió.
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      assert.equal(
        read.includes(forbidden),
        false,
        `la lectura de preflight no puede contener ${forbidden}`,
      );
    }
  });

  it('§3 la lectura de preflight NO importa ningún camino que gaste', () => {
    for (const forbidden of [
      'lusha-phone-fallback-client',
      'apollo',
      'phone-reveal-credit-reservation-deps',
      'phone-reveal-credit-budget-deps',
      'usage-tracking/logging',
      'append_candidate_search_more_phones',
      'candidate-search-more-phone-append-persistence',
    ]) {
      assert.equal(
        read.includes(forbidden),
        false,
        `la lectura de preflight no puede alcanzar ${forbidden}`,
      );
    }
  });

  it('§2 la privacidad la resuelve la puerta REAL, no una aproximación local', () => {
    // Si este módulo derivara la privacidad por su cuenta, el veredicto que la UI muestra y el
    // que bloquea la llamada a Lusha podrían discrepar — y la primera divergencia sería un
    // botón que ofrece una compra que el servidor va a rechazar por supresión.
    assert.match(read, /checkPhoneRevealPrivacyGate/);
    assert.equal(
      read.includes("privacyState: 'clear'"),
      false,
      'el estado de privacidad NUNCA se fija a mano',
    );
  });

  it('§3 el id nativo de Lusha NO viaja al resumen que cruza al navegador', () => {
    // Los HECHOS lo llevan (la llamada a Lusha lo necesita) pero el RESUMEN sólo lleva un
    // booleano. Es la diferencia entre lo que el servidor sabe y lo que el navegador recibe.
    const summaryBlock = read.slice(read.indexOf('export interface SearchMorePreflightSummary'));
    const summaryShape = summaryBlock.slice(0, summaryBlock.indexOf('}'));
    assert.equal(
      /sourceContactId/.test(summaryShape),
      false,
      'el id de contacto de proveedor es PII: no cruza al navegador',
    );
    assert.match(summaryShape, /hasLushaNativeIdentity/);
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · el runtime no puede alcanzar lo prohibido', () => {
  const runtime = executable(readModule('search-more-phones-runtime.ts'));

  it('§7 NO existe ninguna ruta a la búsqueda GENERAL de personas de Lusha', () => {
    // La entrada es el id nativo y sólo el id nativo. Cualquier búsqueda por nombre, email o
    // empresa sería la Fase 2, que está explícitamente fuera de alcance.
    assert.match(
      runtime,
      /enrichLushaContactPhonesForFallback/,
      'la única vía sancionada es el enriquecimiento POR ID',
    );
    for (const forbidden of [
      'searchLushaContacts',
      'lusha-contact-search',
      'prospecting/search',
      '/v2/person',
      'firstName',
      'companyName',
      'linkedinUrl',
    ]) {
      assert.equal(
        runtime.includes(forbidden),
        false,
        `el runtime no puede alcanzar ${forbidden}: sería enlace difuso o búsqueda general`,
      );
    }
  });

  it('§9 el runtime NO usa el writer TERMINAL del reveal', () => {
    // Ése escribe SIEMPRE `phone_reveal_provider` y el costo: en `search_more` atribuiría un
    // número de Apollo a Lusha y borraría lo que costó el reveal de Apollo.
    for (const forbidden of [
      'persistCandidateLushaPhoneCollection',
      'persist_candidate_lusha_phone_reveal_result',
      'candidate-lusha-phone-collection-persistence',
    ]) {
      assert.equal(runtime.includes(forbidden), false, `el runtime no puede usar ${forbidden}`);
    }
    assert.match(runtime, /appendCandidateSearchMorePhones/);
  });

  it('§20.37/38/39 el runtime NO aprueba, NO toca el contacto oficial y NO llama a HubSpot', () => {
    for (const forbidden of [
      'approveContactCandidate',
      'approve_contact_candidate_with_phones',
      'contact_phones',
      'hubspot',
      'HubSpot',
    ]) {
      assert.equal(runtime.includes(forbidden), false, `el runtime no puede alcanzar ${forbidden}`);
    }
  });

  it('§4 el runtime NO puede insertar la corrida por su cuenta: sólo por la RPC atómica', () => {
    // `createWaterfallRun` es el INSERT suelto. Usarlo aquí crearía la corrida FUERA de la
    // transacción que reserva los créditos, que es exactamente la reserva huérfana que 4F
    // cerró.
    assert.equal(runtime.includes('createWaterfallRun'), false);
    assert.match(runtime, /reserveWaterfallCreditsAndCreateRunOrBlock/);
  });

  it('§12 el resultado es PII-MINIMIZADO: ni teléfono, ni id de corrida, ni id nativo', () => {
    const resultBlock = runtime.slice(runtime.indexOf('export interface SearchMoreRuntimeResult'));
    const resultShape = resultBlock.slice(0, resultBlock.indexOf('\n}'));
    for (const forbidden of ['runId', 'reservationId', 'phone', 'contactId', 'sourceContactId']) {
      assert.equal(
        new RegExp(`\\b${forbidden}\\b`).test(resultShape),
        false,
        `el resultado no puede llevar ${forbidden}`,
      );
    }
  });
});

describe('AGENT2A-SEARCH-MORE-PHONES-1 · la acción no acepta overrides del cliente', () => {
  const actions = executable(readModule('search-more-phones-actions.ts'));

  it('§12/§20.18/§20.19 la compra recibe EXACTAMENTE `{ candidateId }`', () => {
    // La forma del argumento es la PRIMERA defensa. El gate de rol impide que un no admin
    // gaste, pero no impediría que un admin —o un script con su sesión— pidiera un techo de 50.
    const signature = actions.slice(
      actions.indexOf('export async function searchMoreCandidatePhonesAction'),
    );
    const params = signature.slice(0, signature.indexOf('):'));
    assert.match(params, /candidateId:\s*string/);
    for (const forbidden of ['provider', 'maxCredits', 'creditCap', 'privacyState', 'contactId']) {
      assert.equal(
        params.includes(forbidden),
        false,
        `la acción no puede aceptar ${forbidden} del cliente: lo DERIVA el servidor`,
      );
    }
  });

  it('§12 la acción NO llama al proveedor por su cuenta: delega en el runtime', () => {
    for (const forbidden of [
      'enrichLushaContactPhonesForFallback',
      'getLushaApiKey',
      'reservePhoneRevealCreditsAndCreateRun',
      'claimLushaAttempt',
    ]) {
      assert.equal(actions.includes(forbidden), false, `la acción no puede alcanzar ${forbidden}`);
    }
    assert.match(actions, /executeSearchMorePhonesForCandidate/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 1J — EL CTA ES UNA ACCIÓN DIRECTA, Y EL MODAL NO PUEDE VOLVER
// ═══════════════════════════════════════════════════════════════
//
// DOS ratchets de este bloque se INVIERTEN a propósito, y ninguno se borra:
//
//   * «la invocación vive dentro del handler de CONFIRMACIÓN» pasa a vivir dentro de
//     `handleSearchMore`, el handler del propio botón. La propiedad que protegía —UN SOLO
//     sitio de llamada, así que no hay un segundo camino capaz de gastar— se conserva
//     INTACTA, y es la que sigue afirmándose con un conteo exacto;
//   * «el `onClick` sólo abre el modal» se invierte a su contrario exacto: el `onClick`
//     ejecuta. Es la decisión de producto de 1J, y sustituirla por nada habría dejado el
//     `onClick` sin ninguna guarda.
//
// A cambio se AÑADE la guarda que 1J necesita y antes no existía: el fichero no puede montar
// ningún diálogo. Sin ella, «quitamos el modal» sería una afirmación sobre un commit y no
// sobre el código, y volver a montarlo no rompería nada.
describe('AGENT2A-SEARCH-MORE-PHONES-1J · el CTA gasta en UN clic y sin diálogo', () => {
  const ctaPath = join(
    moduleDir,
    '..',
    '..',
    'components',
    'contact-enrichment',
    'candidate-search-more-phones-cta.tsx',
  );
  const cta = executable(readFileSync(ctaPath, 'utf8'));

  it('§14/§20.9 la acción que PAGA se invoca en UN solo sitio', () => {
    // La propiedad central del hito, afirmada sobre el fichero: UN solo sitio de llamada
    // significa que no puede haber un segundo camino —un efecto, un reintento automático—
    // que gaste al margen del clic del operador.
    //
    // Se cuentan SITIOS DE LLAMADA (`nombre(`) y no apariciones del nombre: el fichero también
    // lo menciona en un `ReturnType<typeof …>`, que es una referencia de TIPO y se borra al
    // compilar. Contar nombres haría que añadir una anotación de tipo rompiera la guarda, y la
    // tentación entonces sería subir el número — es decir, aflojarla justo donde importa.
    const callSites = cta.split('searchMoreCandidatePhonesAction(').length - 1;
    assert.equal(callSites, 1, 'UNA sola invocación, dentro de `handleSearchMore`');
    assert.match(
      cta,
      /handleSearchMore[\s\S]{0,900}searchMoreCandidatePhonesAction/,
      'la invocación tiene que vivir dentro del handler del BOTÓN',
    );
  });

  it('§3/§4 el `onClick` del CTA invoca la compra DIRECTAMENTE: no abre nada', () => {
    // La inversión de 1J. Antes: `onClick={() => setConfirmOpen(true)}`.
    assert.match(cta, /onClick=\{\(\) => void handleSearchMore\(\)\}/);
    assert.equal(
      cta.includes('setConfirmOpen'),
      false,
      'el estado del modal desaparece con el modal',
    );
  });

  it('§3 el CTA no monta NINGÚN diálogo, ni de radix ni propio', () => {
    // Se lee el fichero SIN comentarios (la prosa de arriba explica por qué se retiró el
    // modal y nombrarlo ahí no puede contar como montarlo).
    for (const forbidden of [
      '@/components/ui/dialog',
      '@/components/ui/alert-dialog',
      '@/components/ui/sheet',
      '@radix-ui/react-dialog',
      '@radix-ui/react-alert-dialog',
    ]) {
      assert.equal(cta.includes(forbidden), false, `el CTA no puede importar ${forbidden}`);
    }
    for (const forbidden of [
      '<Dialog',
      '<AlertDialog',
      '<DialogContent',
      '<AlertDialogContent',
      '<Sheet',
      'DialogFooter',
    ]) {
      assert.equal(cta.includes(forbidden), false, `el CTA no puede renderizar ${forbidden}`);
    }
  });

  it('§9 la divulgación de costo es FAIL-CLOSED: sin línea de costo no hay botón', () => {
    // La guarda que sustituye al modal. Un clic que gasta exige que el techo y la fuente se
    // hayan podido escribir; si no, no se pinta el botón — nunca se pinta sin la línea.
    assert.match(cta, /getSearchMoreCostDisclosure/);
    assert.match(cta, /if \(!costDisclosure\) return null;/);
  });

  it('§2 el CTA usa el botón SECUNDARIO canónico, no un enlace de texto', () => {
    // El mismo `variant`/`size`/`className` que «Revelar teléfono», «Revisar resultado ahora»
    // y el fallback manual de Lusha, que viven en este mismo panel. Antes era un `ghost` con
    // `px-0` y `hover:underline`: la operación más cara del bloque con el peso visual más bajo.
    assert.match(cta, /variant="outline"/);
    assert.equal(cta.includes('variant="ghost"'), false);
    assert.equal(cta.includes('hover:underline'), false);
    assert.match(cta, /className="h-7 gap-1\.5 text-xs"/);
  });

  it('§15 el CTA no importa ningún cliente de proveedor ni el reservador de créditos', () => {
    for (const forbidden of [
      'lusha-phone-fallback-client',
      'phone-reveal-credit-reservation-deps',
      'phone-reveal-credit-budget-deps',
      'search-more-phones-runtime',
      'supabase',
    ]) {
      assert.equal(cta.includes(forbidden), false, `el CTA no puede alcanzar ${forbidden}`);
    }
  });

  it('§15/§16 el refresco está ACOTADO: un bucle sin techo fue el defecto de #279', () => {
    assert.match(cta, /PREFLIGHT_REFRESH_MAX_ATTEMPTS/);
    assert.match(cta, /attempt < PREFLIGHT_REFRESH_MAX_ATTEMPTS/);
    // Y lo único que el refresco llama es la LECTURA.
    assert.match(cta, /getSearchMorePhonesPreflightAction/);
  });

  it('§20.13 el pestillo anti-doble-clic vive en un REF, no en estado', () => {
    // Un segundo clic llega ANTES de que React haya re-renderizado con `running`, así que un
    // booleano de estado no lo pararía.
    assert.match(cta, /const inFlight = React\.useRef\(false\)/);
    assert.match(cta, /if \(inFlight\.current\) return;/);
  });
});
