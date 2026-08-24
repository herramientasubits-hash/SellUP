/**
 * Tests — el disparo MANUAL de Lusha converge sobre la infraestructura
 * `legacy_lusha_only` (Agente 2A · AGENT2A-PHONE-REVEAL-4O-F-R2)
 *
 * QUÉ DEFECTO CIERRA ESTE ARCHIVO
 *
 * La auditoría 4O-F-M0 fijó `MANUAL_LUSHA_BUDGET_GATE = UNSAFE`:
 * `revealCandidatePhoneViaLushaFallbackAction` llamaba a Lusha DIRECTAMENTE — sin gate
 * presupuestal, sin reserva atómica y sin single-flight. Tres clics concurrentes sobre
 * el mismo candidato pagaban TRES veces, y la única mitigación era un `useRef` de la UI,
 * que no protege una invocación directa de la server action.
 *
 * R2 no le da una reserva propia a ese camino: lo ELIMINA. El disparo manual pasa a
 * ejecutarse sobre el motor `legacy_lusha_only`, que ya existía y ya tenía las cuatro
 * propiedades que faltaban. Lo que se prueba aquí es que el motor las conserva cuando lo
 * invoca el disparo manual, y que converger NO degradó nada de lo que el disparo manual
 * ya garantizaba.
 *
 * CONTRATO FIJADO
 *
 *   Presupuesto      0 disponible ⇒ 0 llamadas; 4 frente a 5 requeridos ⇒ 0 llamadas;
 *                    exactamente 5 ⇒ 1 corrida, 1 pata reservada, 1 llamada.
 *   Single-flight    3 invocaciones concurrentes sobre el MISMO candidato ⇒ 1 sola
 *                    operación pagada. Se prueba con presupuesto 5 Y con 100: si sólo
 *                    pasara con 5, lo que estaría bloqueando sería el saldo, no el
 *                    single-flight, y el defecto seguiría vivo en cuanto hubiera pozo.
 *   Candidatos ≠     dos candidatos distintos NO se bloquean entre sí.
 *   Ledger           el usage-log lleva el id de la corrida REAL, así que
 *                    `computeEffectiveConsumption` deduplica contra la reserva
 *                    confirmada: una llamada de 5 créditos consume 5, nunca 10.
 *   Privacidad       DNC y supresión ANTES de reservar ⇒ 0 corridas, 0 reservas, 0
 *                    llamadas, 0 créditos. DNC EN VUELO ⇒ el costo real se conserva y el
 *                    teléfono NO se persiste.
 *   Multi-teléfono   todos los teléfonos de la respuesta pagada, por la MISMA
 *                    transacción que ya usaba el waterfall. Facturación por RESPUESTA,
 *                    jamás multiplicada por `phones.length`.
 *   Flags            con `ENABLE_PHONE_REVEAL_WATERFALL = false` —su estado en
 *                    Producción— el disparo manual SIGUE funcionando: ese flag gobierna
 *                    la UX del waterfall, no la existencia de la contabilidad.
 *
 * Offline por construcción: sin red, sin Supabase real, sin Lusha, 0 créditos. La
 * atomicidad real vive en la migración 104 y se valida contra PostgreSQL en
 * `manual-lusha-legacy-run-convergence-postgres-4o-f-r2.test.ts`; aquí el ledger
 * simulado REPRODUCE sus invariantes (unicidad de pata activa por candidato+proveedor y
 * unicidad de corrida activa por candidato) para que el comportamiento del motor sea
 * observable sin base de datos.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;
let httpRequests: string[] = [];

globalThis.fetch = (async (input: unknown): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : ((input as { url?: string })?.url ?? String(input));
  httpRequests.push(url);
  return new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

const PROVIDER_HOST_FRAGMENTS = ['apollo.io', 'lusha.com', 'hubapi.com'];

function providerHttpRequests(): string[] {
  return httpRequests.filter((url) =>
    PROVIDER_HOST_FRAGMENTS.some((host) => url.includes(host)),
  );
}

// ═══════════════════════════════════════════════════════════════
// Constantes del dominio
// ═══════════════════════════════════════════════════════════════

/** Costo canónico de la pata Lusha. Es el que la modalidad legacy autoriza. */
const LUSHA_LEG_CREDITS = 5;

const ADMIN = { internalUserId: 'user-admin-1', roleKey: 'admin' };
// AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: el actor no autorizado dejó de ser un
// `commercial_manager` — ese rol SÍ puede revelar teléfono, así que ahora también puede
// autorizar esta ruta. El que se rechaza es un rol que nunca pudo revelar.
const UNAUTHORIZED = { internalUserId: 'user-seller-1', roleKey: 'seller' };

const CANDIDATE_A = 'cand-r2-a';
const CANDIDATE_B = 'cand-r2-b';

// ═══════════════════════════════════════════════════════════════
// Estado simulado: presupuesto, reservas, corridas, candidatos
// ═══════════════════════════════════════════════════════════════

interface ReservationRow {
  id: string;
  reservationGroupId: string;
  candidateId: string;
  providerKey: string;
  creditsReserved: number;
  creditsConfirmed: number | null;
  costTruth: string | null;
  status: 'reserved' | 'confirmed' | 'released';
  releaseReason: string | null;
}

interface RunRow {
  id: string;
  candidate_id: string;
  status: string;
  run_mode: string;
  authorized_at: string;
  authorized_by: string;
  authorized_by_role: string | null;
  max_credits_authorized: number;
  apollo_attempted_at: string | null;
  apollo_outcome: string | null;
  apollo_cost_credits: number | null;
  apollo_cost_source: string | null;
  lusha_eligible: boolean;
  lusha_skipped_reason: string | null;
  lusha_attempted_at: string | null;
  lusha_outcome: string | null;
  lusha_cost_credits: number | null;
  lusha_cost_source: string | null;
  final_provider: string | null;
  completed_at: string | null;
  error_code: string | null;
  credit_reservation_group_id: string | null;
}

/**
 * Estados del índice único parcial de la migración 102 (corrida ACTIVA). Copia EXACTA de
 * `PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES`: inventar un estado aquí haría que el arnés
 * no viera como activa una corrida que sí lo es, y el single-flight parecería roto (o
 * peor, parecería funcionar por el motivo equivocado).
 */
const ACTIVE_RUN_STATUSES = [
  'authorized',
  'apollo_in_flight',
  'lusha_pending',
  'lusha_running',
];

interface UsageLogRow {
  providerKey: string;
  operationKey: string;
  creditsUsed: number | null;
  status: string;
  errorCode: string | null;
  waterfallRunId: string | null;
}

interface CandidateRow {
  id: string;
  status: string;
  source: string;
  source_contact_id: string | null;
  phone: string | null;
  phone_reveal_status: string | null;
  phone_reveal_provider: string | null;
  phone_reveal_completed_at: string | null;
  phone_reveal_attempt_count: number;
  enrichment_metadata: Record<string, unknown>;
  apollo_person_id: string | null;
  run: { account_id: string | null };
}

/**
 * Candidato ELEGIBLE para la ruta: terna de evidencia completa
 * (`no_phone_found` + `provider = apollo` + `completed_at`), sin teléfono, editable y
 * con id Lusha propio. Que sea elegible es deliberado: así el único motivo posible de
 * cierre en cada test es el que ese test mide, no un gate de elegibilidad que habría
 * cortado igual — que es exactamente lo que produce un falso verde.
 */
function eligibleCandidate(id: string): CandidateRow {
  return {
    id,
    status: 'pending_review',
    source: 'lusha',
    source_contact_id: `v1.contact.${id}`,
    phone: null,
    phone_reveal_status: 'no_phone_found',
    phone_reveal_provider: 'apollo',
    phone_reveal_completed_at: '2026-07-01T10:00:00.000Z',
    phone_reveal_attempt_count: 1,
    enrichment_metadata: {},
    apollo_person_id: null,
    run: { account_id: null },
  };
}

interface World {
  /** Techo del pozo de Lusha. `null` ⇒ regla no configurada. */
  limitCredits: number | null;
  /** Consumo ya agregado del período. */
  consumedCredits: number;
  /** `true` ⇒ la lectura del pozo falla (fail-closed). */
  poolUnavailable: boolean;
  /** `unavailable` de la operación atómica (migración 104 ausente, timeout…). */
  reserveUnavailable: boolean;
  reservations: ReservationRow[];
  runs: RunRow[];
  candidates: Map<string, CandidateRow>;
  usageLogs: UsageLogRow[];
  /** Llamadas REALES al cliente de Lusha. Es la cifra que mide el gasto. */
  lushaCalls: string[];
  /** Escrituras transaccionales de la colección multi-teléfono. */
  collectionWrites: { candidateId: string; numbers: string[]; runId: string | null }[];
  /** Veredicto de la puerta de privacidad, por instante de consulta. */
  privacyGate: ('clear' | 'blocked_suppressed' | 'do_not_contact' | 'check_unavailable')[];
  privacyGateCalls: number;
  /** Teléfonos que devuelve Lusha, y créditos que reporta por RESPUESTA. */
  lushaPhones: { number: string; rawType?: string | null }[];
  lushaCreditsCharged: number | null;
  lushaFails: boolean;
  lushaNoPhone: boolean;
  /** Escrituras escalares al candidato (camino que NO usa la colección). */
  candidateUpdates: Record<string, unknown>[];
  /** La transacción de la colección lanza (migración ausente, timeout). */
  collectionFails: boolean;
  /**
   * Desenlace que declara la transacción. `persisted` cierra el candidato; `suppressed`
   * y `stale_event` NO lo cierran, y el core no puede reportarlos como `revealed`.
   */
  collectionStatus: 'persisted' | 'suppressed' | 'stale_event';
  /**
   * Veces que se INVOCÓ la operación atómica reserva+corrida. Distingue las dos capas de
   * single-flight: el guard barato del core (que no llega a invocarla) y el guard
   * autoritativo de la transacción (que la invoca y responde `already_reserved`).
   */
  reserveAttempts: number;
}

let world: World;

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    limitCredits: 100,
    consumedCredits: 0,
    poolUnavailable: false,
    reserveUnavailable: false,
    reservations: [],
    runs: [],
    candidates: new Map([
      [CANDIDATE_A, eligibleCandidate(CANDIDATE_A)],
      [CANDIDATE_B, eligibleCandidate(CANDIDATE_B)],
    ]),
    usageLogs: [],
    lushaCalls: [],
    collectionWrites: [],
    privacyGate: [],
    privacyGateCalls: 0,
    lushaPhones: [{ number: '+573001112233', rawType: 'mobile' }],
    lushaCreditsCharged: LUSHA_LEG_CREDITS,
    lushaFails: false,
    lushaNoPhone: false,
    candidateUpdates: [],
    collectionFails: false,
    collectionStatus: 'persisted',
    reserveAttempts: 0,
    ...overrides,
  };
}

/** Exposición viva contra el pozo. Es lo que la migración 104 suma en la transacción. */
function reservedCredits(): number {
  return world.reservations
    .filter((r) => r.status === 'reserved')
    .reduce((sum, r) => sum + r.creditsReserved, 0);
}

function availableCredits(): number {
  if (world.limitCredits === null) return 0;
  return world.limitCredits - world.consumedCredits - reservedCredits();
}

function nextPrivacyVerdict(): 'clear' | 'blocked_suppressed' | 'do_not_contact' | 'check_unavailable' {
  const verdict = world.privacyGate[world.privacyGateCalls] ?? 'clear';
  world.privacyGateCalls += 1;
  return verdict;
}

// ═══════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════

/** Flag del waterfall. Por defecto APAGADO: es su estado en Producción. */
let waterfallFlag = false;
/** Flag del fallback manual de Lusha: el permiso de producto de esta operación. */
let manualFallbackFlag = true;

mock.module('@/lib/feature-flags.server', {
  namedExports: {
    isPhoneRevealWaterfallEnabled: () => waterfallFlag,
    isLushaPhoneRevealFallbackEnabled: () => manualFallbackFlag,
    resolveLushaSearchTimeoutMs: () => 10_000,
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: {
    getLushaApiKey: async () => 'test-key',
  },
});

mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    enrichLushaContactPhonesForFallback: async ({ contactId }: { contactId: string }) => {
      world.lushaCalls.push(contactId);
      if (world.lushaFails) {
        return { ok: false, errorMessage: 'lusha upstream 500' };
      }
      // Forma EXACTA de `LushaPhoneFallbackClientResult`: `phoneNumber` (no `phone`),
      // `httpStatus`, y la tupla completa de `LushaPhoneFallbackStatusMapping`. Un mock
      // con nombres aproximados haría que el core cayera en su rama de respuesta
      // malformada y el arnés mediría un error en vez del camino que cada test afirma.
      if (world.lushaNoPhone) {
        return {
          ok: true,
          httpStatus: 200,
          phones: [],
          phoneNumber: null,
          phoneType: 'unknown',
          phoneRawType: null,
          creditsCharged: world.lushaCreditsCharged,
          candidateStatus: 'no_phone_found',
          usageStatus: 'success',
          costSource: 'reported',
          errorCode: null,
          availabilitySource: 'provider',
          phonesReturned: 0,
        };
      }
      const phones = world.lushaPhones.map((p) => ({
        number: p.number,
        rawType: p.rawType ?? null,
        phoneType: 'mobile',
      }));
      const [primary] = phones;
      return {
        ok: true,
        httpStatus: 200,
        phones,
        phoneNumber: primary?.number ?? null,
        phoneType: primary?.phoneType ?? 'unknown',
        phoneRawType: primary?.rawType ?? null,
        // Facturación por RESPUESTA. Nunca por número de teléfonos.
        creditsCharged: world.lushaCreditsCharged,
        candidateStatus: 'revealed',
        usageStatus: 'success',
        costSource: world.lushaCreditsCharged === null ? null : 'reported',
        errorCode: null,
        availabilitySource: 'provider',
        phonesReturned: phones.length,
      };
    },
  },
});

mock.module('@/modules/usage-tracking/logging', {
  namedExports: {
    logProviderUsage: async (entry: Record<string, unknown>) => {
      world.usageLogs.push({
        providerKey: String(entry.provider_key),
        operationKey: String(entry.operation_key),
        creditsUsed:
          typeof entry.credits_used === 'number' ? entry.credits_used : null,
        status: String(entry.status),
        errorCode: entry.error_code ? String(entry.error_code) : null,
        waterfallRunId:
          (entry.metadata as Record<string, unknown> | undefined)?.[
            'phone_reveal_waterfall_id'
          ] != null
            ? String(
                (entry.metadata as Record<string, unknown>)[
                  'phone_reveal_waterfall_id'
                ],
              )
            : null,
      });
    },
  },
});

/** Puerta de privacidad: UNA sola implementación, aquí simulada. */
mock.module('@/modules/contact-enrichment/phone-reveal-privacy-gate', {
  namedExports: {
    checkPhoneRevealPrivacyGate: async () => nextPrivacyVerdict(),
    // `loadCandidateForWaterfall` se apoya en esta lectura: devolver null aquí haría que
    // la continuación cerrara por `candidate_not_found` y el arnés mediría un cierre que
    // no es el que cada test afirma.
    loadPhoneRevealPrivacyGateCandidateRow: async (candidateId: string) => {
      const row = world.candidates.get(candidateId);
      if (!row) return null;
      return {
        id: row.id,
        source: row.source,
        sourceContactId: row.source_contact_id,
        hasPhone: !!row.phone,
        phoneRevealStatus: row.phone_reveal_status,
      };
    },
    PRIVACY_GATE_CANDIDATE_SELECT: 'id',
  },
});

/**
 * Escritura transaccional de la colección (migración 111). Se registra qué números
 * entraron y con qué corrida, que es lo que permite afirmar que el disparo manual dejó
 * de perder los teléfonos que ya pagó.
 */
mock.module(
  '@/modules/contact-enrichment/candidate-lusha-phone-collection-persistence',
  {
    namedExports: {
      // Firma REAL: un único objeto. Y el desenlace tiene que declarar
      // `candidate_terminalized`, porque es la transacción —no el core— la que decide si
      // el candidato quedó cerrado: sin ese campo el core hace fail-closed y devuelve
      // `error`, que es correcto pero no es el camino que estos tests miden.
      persistCandidateLushaPhoneCollection: async (args: {
        candidateId: string;
        phones?: readonly {
          displayPhone: string | null;
          normalizedPhone: string | null;
          sources?: readonly { waterfallRunId: string | null }[];
        }[];
      }) => {
        const phones = args.phones ?? [];
        world.collectionWrites.push({
          candidateId: args.candidateId,
          // `displayPhone` es el número tal como lo entregó el proveedor; el canónico
          // (`normalizedPhone`) puede diferir en formato y no es lo que se compara aquí.
          numbers: phones.map((p) => p.displayPhone ?? p.normalizedPhone ?? ''),
          // La procedencia por fuente es donde vive la correlación con la corrida.
          runId: phones[0]?.sources?.[0]?.waterfallRunId ?? null,
        });
        if (world.collectionFails) {
          throw new Error('collection transaction unavailable');
        }
        return {
          status: world.collectionStatus,
          inserted_phone_count: phones.length,
          updated_phone_count: 0,
          inserted_source_count: phones.length,
          suppressed_skipped_count: 0,
          primary_dedupe_key: phones[0]?.normalizedPhone ?? null,
          primary_persisted: true,
          candidate_scalar_updated: world.collectionStatus === 'persisted',
          candidate_terminalized: world.collectionStatus === 'persisted',
        };
      },
    },
  },
);

mock.module('@/modules/contact-enrichment/candidate-phone-suppression-persistence', {
  namedExports: {
    persistTerminalPhoneSuppression: async () => ({ ok: true, updated: 1 }),
  },
});

/** Lectura del pozo de Lusha. Fail-closed cuando `poolUnavailable`. */
mock.module('@/modules/contact-enrichment/phone-reveal-credit-budget-deps', {
  namedExports: {
    readPhoneRevealCreditPools: async (
      providerKeys: readonly string[],
    ) =>
      providerKeys.map((providerKey) => {
        if (world.poolUnavailable) {
          return { providerKey, state: { kind: 'unavailable' } };
        }
        if (world.limitCredits === null) {
          return { providerKey, state: { kind: 'not_configured' } };
        }
        return {
          providerKey,
          state: {
            kind: 'configured',
            limitCredits: world.limitCredits,
            consumedCredits: world.consumedCredits,
            reservedCredits: reservedCredits(),
            scopeType: 'global',
            scopeId: null,
            periodStart: '2026-08-01T00:00:00.000Z',
            periodEnd: '2026-08-31T23:59:59.000Z',
          },
        };
      }),
  },
});

let runSeq = 0;
let reservationSeq = 0;

/**
 * Operación ATÓMICA reserva + corrida (migración 104,
 * `reserve_and_create_phone_reveal_run`). Reproduce las DOS invariantes de unicidad que
 * el SQL impone y que son la razón por la que el single-flight funciona ANTES de pagar:
 *
 *   * `uq_phone_reveal_credit_reservations_active_leg` sobre
 *     `(candidate_id, provider_key) WHERE status = 'reserved'`;
 *   * índice único parcial de corrida ACTIVA por candidato (migración 102).
 *
 * Todo dentro de la misma sección crítica sincrónica: en el motor real es una
 * transacción, y aquí es un bloque sin `await`, que es su equivalente en un runtime de
 * un solo hilo. Es lo que hace que tres invocaciones concurrentes se serialicen igual
 * que contra Postgres.
 */
mock.module('@/modules/contact-enrichment/phone-reveal-credit-reservation-deps', {
  namedExports: {
    PHONE_REVEAL_CREDIT_RESERVATIONS_TABLE: 'phone_reveal_credit_reservations',
    PHONE_REVEAL_CREDIT_CONFIRM_FN: 'confirm_phone_reveal_credits',
    PHONE_REVEAL_CREDIT_RELEASE_FN: 'release_phone_reveal_credits',
    PHONE_REVEAL_CREDIT_RESERVE_AND_CREATE_RUN_FN:
      'reserve_and_create_phone_reveal_run',

    reservePhoneRevealCreditsAndCreateRun: async ({
      reservation,
      run,
    }: {
      reservation: {
        candidateId: string;
        reservationGroupId: string;
        authorizationKey: string;
        legs: readonly { providerKey: string; credits: number }[];
      };
      run: Record<string, unknown>;
    }) => {
      world.reserveAttempts += 1;
      if (world.reserveUnavailable) {
        return { status: 'unavailable', detail: 'function_missing' };
      }

      const candidateId = reservation.candidateId;

      // ── sección crítica ──
      const hasActiveLeg = world.reservations.some(
        (r) =>
          r.status === 'reserved' &&
          r.candidateId === candidateId &&
          reservation.legs.some((leg) => leg.providerKey === r.providerKey),
      );
      const hasActiveRun = world.runs.some(
        (r) => r.candidate_id === candidateId && ACTIVE_RUN_STATUSES.includes(r.status),
      );
      if (hasActiveLeg || hasActiveRun) return { status: 'already_reserved' };

      if (world.limitCredits === null) {
        return {
          status: 'budget_not_configured',
          legs: reservation.legs.map((leg) => ({
            providerKey: leg.providerKey,
            requiredCredits: leg.credits,
            availableCredits: null,
          })),
        };
      }

      const required = reservation.legs.reduce((s, leg) => s + leg.credits, 0);
      if (availableCredits() < required) {
        return {
          status: 'insufficient_credits',
          legs: reservation.legs.map((leg) => ({
            providerKey: leg.providerKey,
            requiredCredits: leg.credits,
            availableCredits: availableCredits(),
          })),
        };
      }

      runSeq += 1;
      const runId = `run-r2-${runSeq}`;
      const reservations: ReservationRow[] = reservation.legs.map((leg) => {
        reservationSeq += 1;
        return {
          id: `res-r2-${reservationSeq}`,
          reservationGroupId: reservation.reservationGroupId,
          candidateId,
          providerKey: leg.providerKey,
          creditsReserved: leg.credits,
          creditsConfirmed: null,
          costTruth: null,
          status: 'reserved',
          releaseReason: null,
        };
      });
      world.reservations.push(...reservations);
      world.runs.push({
        id: runId,
        candidate_id: candidateId,
        status: String(run.status ?? 'lusha_pending'),
        run_mode: String(run.run_mode ?? 'legacy_lusha_only'),
        authorized_at: String(run.authorized_at ?? new Date(0).toISOString()),
        authorized_by: String(run.authorized_by ?? ''),
        authorized_by_role: (run.authorized_by_role as string | null) ?? null,
        max_credits_authorized: Number(run.max_credits_authorized ?? 0),
        apollo_attempted_at: (run.apollo_attempted_at as string | null) ?? null,
        apollo_outcome: (run.apollo_outcome as string | null) ?? null,
        apollo_cost_credits: null,
        apollo_cost_source: (run.apollo_cost_source as string | null) ?? null,
        lusha_eligible: run.lusha_eligible === true,
        lusha_skipped_reason: (run.lusha_skipped_reason as string | null) ?? null,
        lusha_attempted_at: null,
        lusha_outcome: null,
        lusha_cost_credits: null,
        lusha_cost_source: null,
        final_provider: null,
        completed_at: null,
        error_code: null,
        credit_reservation_group_id: reservation.reservationGroupId,
      });
      // ── fin sección crítica ──

      return {
        status: 'created',
        runId,
        reservationGroupId: reservation.reservationGroupId,
        reservations: reservations.map((r) => ({
          id: r.id,
          providerKey: r.providerKey,
          creditsReserved: r.creditsReserved,
        })),
      };
    },

    findActivePhoneRevealCreditReservations: async (groupId: string) =>
      world.reservations
        .filter((r) => r.reservationGroupId === groupId && r.status === 'reserved')
        .map((r) => ({
          id: r.id,
          providerKey: r.providerKey,
          creditsReserved: r.creditsReserved,
        })),

    confirmPhoneRevealCreditReservation: async ({
      reservationId,
      credits,
      costTruth,
    }: {
      reservationId: string;
      credits: number;
      costTruth: string;
    }) => {
      const row = world.reservations.find((r) => r.id === reservationId);
      if (row) {
        row.status = 'confirmed';
        row.creditsConfirmed = credits;
        row.costTruth = costTruth;
      }
      return { ok: true };
    },

    releasePhoneRevealCreditReservation: async ({
      reservationId,
      reason,
    }: {
      reservationId: string;
      reason: string;
    }) => {
      const row = world.reservations.find((r) => r.id === reservationId);
      if (row) {
        row.status = 'released';
        row.releaseReason = reason;
      }
      return { ok: true };
    },
  },
});

/** Cadena encadenable/thenable con la forma de `@supabase/supabase-js`. */
function chain(result: { data: unknown; error: unknown }): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const m of [
    'select',
    'eq',
    'in',
    'gt',
    'is',
    'not',
    'order',
    'limit',
    'maybeSingle',
    'single',
  ]) {
    self[m] = () => self;
  }
  self.then = (resolve: (v: { data: unknown; error: unknown }) => unknown): unknown =>
    resolve(result);
  return self;
}

/**
 * Consulta sobre `phone_reveal_waterfall_runs`. Los filtros se CAPTURAN en vez de
 * ignorarse: `findWaterfallRunById` busca por `id` y `findActiveWaterfallRunForCandidate`
 * por `candidate_id` + estado. Devolver "la última corrida" a las dos haría que, con dos
 * candidatos en vuelo, la liquidación de B resolviera la corrida de A — y el arnés
 * mediría un doble conteo que el motor no tiene.
 */
function runsQuery(): Record<string, unknown> & { resolveTarget: () => RunRow | null } {
  const self: Record<string, unknown> = {};
  let idFilter: string | null = null;
  let candidateFilter: string | null = null;
  let wantsActive = false;
  for (const m of ['select', 'gt', 'is', 'not', 'order', 'limit']) {
    self[m] = () => self;
  }
  self.eq = (column: unknown, value: unknown) => {
    if (typeof value === 'string') {
      if (column === 'id') idFilter = value;
      if (column === 'candidate_id') candidateFilter = value;
    }
    if (column === 'status') wantsActive = true;
    return self;
  };
  self.in = () => {
    wantsActive = true;
    return self;
  };
  self.maybeSingle = () => self;
  self.single = () => self;

  const resolveTarget = (): RunRow | null => {
    if (idFilter) return world.runs.find((r) => r.id === idFilter) ?? null;
    const scoped = candidateFilter
      ? world.runs.filter((r) => r.candidate_id === candidateFilter)
      : world.runs;
    const pool = wantsActive
      ? scoped.filter((r) => ACTIVE_RUN_STATUSES.includes(r.status))
      : scoped;
    return pool[pool.length - 1] ?? null;
  };

  self.then = (resolve: (v: { data: unknown; error: unknown }) => unknown): unknown =>
    resolve({ data: resolveTarget(), error: null });
  self.resolveTarget = resolveTarget;
  return self as Record<string, unknown> & { resolveTarget: () => RunRow | null };
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'phone_reveal_waterfall_runs') {
          const q = runsQuery();
          return {
            ...q,
            update: (patch: Record<string, unknown>) => {
              // El UPDATE lleva su propio `.eq('id', …)`: se aplica a ESA corrida, no a
              // "la última activa". Con dos corridas en vuelo lo segundo pisaría la ajena.
              const inner = runsQuery();
              const apply = () => {
                const target = inner.resolveTarget();
                if (!target) return { data: [], error: null };
                // CLAIM ATÓMICO: el UPDATE real lleva `is('lusha_attempted_at', null)` en
                // su WHERE, así que el segundo disparador que observa la MISMA corrida
                // actualiza 0 filas. Reproducirlo es lo que hace que `lusha_claim_lost`
                // sea alcanzable en el arnés en vez de un camino muerto.
                if (
                  patch.lusha_attempted_at !== undefined &&
                  target.lusha_attempted_at !== null
                ) {
                  return { data: [], error: null };
                }
                Object.assign(target, patch);
                return { data: [{ id: target.id }], error: null };
              };
              const wrapper: Record<string, unknown> = {};
              // `claimLushaAttempt` encadena `.eq().is().in().gt().select()`. Omitir
              // cualquiera de esos métodos hace que el claim lance, el motor lo trague
              // como `noop` y el arnés mida un cierre inexistente.
              for (const m of ['select', 'in', 'is', 'not', 'gt', 'lt', 'order', 'limit']) {
                wrapper[m] = () => wrapper;
              }
              wrapper.eq = (column: unknown, value: unknown) => {
                (inner.eq as (c: unknown, v: unknown) => unknown)(column, value);
                return wrapper;
              };
              wrapper.then = (
                resolve: (v: { data: unknown; error: unknown }) => unknown,
              ): unknown => resolve(apply());
              return wrapper;
            },
          };
        }
        if (table === 'contact_enrichment_candidates') {
          const self: Record<string, unknown> = {};
          // Igual que en las corridas: el id se captura del filtro en vez de devolver
          // siempre el mismo candidato.
          let id: string | null = null;
          for (const m of ['select', 'in', 'is', 'order', 'limit']) {
            self[m] = () => self;
          }
          self.eq = (column: unknown, value: unknown) => {
            if (column === 'id' && typeof value === 'string') id = value;
            return self;
          };
          self.maybeSingle = () => self;
          self.single = () => self;
          self.update = (patch: Record<string, unknown>) => {
            world.candidateUpdates.push(patch);
            const inner = { ...self };
            inner.eq = (column: unknown, value: unknown) => {
              if (column === 'id' && typeof value === 'string') id = value;
              return chain({ data: [{ id: value }], error: null });
            };
            return inner;
          };
          self.then = (
            resolve: (v: { data: unknown; error: unknown }) => unknown,
          ): unknown =>
            resolve({
              data: id ? (world.candidates.get(id) ?? null) : null,
              error: null,
            });
          return self;
        }
        return chain({ data: null, error: null });
      },
      rpc: () => chain({ data: null, error: null }),
    }),
  },
});

// El claim atómico de la pata usa el admin client de arriba (UPDATE condicional). Para
// que el arnés sea determinista se mockea su módulo: devuelve `true` la PRIMERA vez por
// corrida y `false` después, que es exactamente lo que hace el UPDATE condicional real.
const claimedRuns = new Set<string>();

// ═══════════════════════════════════════════════════════════════
// Import del motor DESPUÉS de los mocks
// ═══════════════════════════════════════════════════════════════

// El import es dinámico y va en `before`: los mocks tienen que estar registrados antes
// de que el módulo bajo prueba resuelva sus dependencias, y el transform de este
// proyecto no admite top-level await.
let executeLegacyLushaOnlyPhoneReveal: typeof import('../legacy-lusha-only-reveal-engine')['executeLegacyLushaOnlyPhoneReveal'];
let computeEffectiveConsumption: typeof import('@/modules/budgets/effective-consumption-core')['computeEffectiveConsumption'];

before(async () => {
  ({ executeLegacyLushaOnlyPhoneReveal } = await import(
    '../legacy-lusha-only-reveal-engine'
  ));
  ({ computeEffectiveConsumption } = await import(
    '@/modules/budgets/effective-consumption-core'
  ));
});

beforeEach(() => {
  world = freshWorld();
  httpRequests = [];
  waterfallFlag = false;
  manualFallbackFlag = true;
  claimedRuns.clear();
});

/** Atajo: ejecuta el disparo manual sobre el candidato indicado. */
function reveal(candidateId = CANDIDATE_A, actor = ADMIN) {
  return executeLegacyLushaOnlyPhoneReveal({ candidateId, actor });
}

function confirmedCredits(): number {
  return world.reservations
    .filter((r) => r.status === 'confirmed')
    .reduce((s, r) => s + (r.creditsConfirmed ?? 0), 0);
}

// ═══════════════════════════════════════════════════════════════
// 1. Contrato de flags — el eje de R2
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 2 + § 36 — flag de PRODUCTO vs infraestructura DURABLE', () => {
  it('con ENABLE_PHONE_REVEAL_WATERFALL apagado el disparo manual SIGUE funcionando', async () => {
    waterfallFlag = false;
    manualFallbackFlag = true;

    const result = await reveal();

    // La UX del waterfall está inactiva y aun así la operación de un solo proveedor se
    // ejecutó: es la separación que R2 introduce. Si el motor leyera el flag del
    // waterfall, esto sería `not_started/feature_disabled`.
    assert.equal(result.outcome, 'lusha_revealed');
    assert.equal(world.lushaCalls.length, 1);
    assert.equal(world.runs.length, 1);
    assert.equal(world.runs[0].run_mode, 'legacy_lusha_only');
  });

  it('el flag del fallback manual sigue siendo el kill switch: apagado ⇒ 0 de todo', async () => {
    manualFallbackFlag = false;

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'feature_disabled');
    assert.equal(world.runs.length, 0);
    assert.equal(world.reservations.length, 0);
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(world.usageLogs.length, 0);
    assert.equal(providerHttpRequests().length, 0);
  });

  it('con el flag del waterfall ENCENDIDO el desenlace es el mismo (no hay 2ª operación)', async () => {
    waterfallFlag = true;

    const result = await reveal();

    assert.equal(result.outcome, 'lusha_revealed');
    // UNA corrida y UNA llamada: encender la UX del waterfall no duplica la operación.
    assert.equal(world.runs.length, 1);
    assert.equal(world.lushaCalls.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Autorización y elegibilidad
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 9 + § 10 — auth y elegibilidad intactas', () => {
  it('un rol sin permiso de revelar es rechazado en el servidor, sin leer ni escribir nada', async () => {
    const result = await reveal(CANDIDATE_A, UNAUTHORIZED);

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'role_not_allowed');
    assert.equal(world.runs.length, 0);
    assert.equal(world.reservations.length, 0);
    assert.equal(world.lushaCalls.length, 0);
  });

  it('un candidato cuyo `no_phone_found` lo produjo LUSHA no es elegible: no se re-compra la misma respuesta', async () => {
    const candidate = world.candidates.get(CANDIDATE_A)!;
    candidate.phone_reveal_provider = 'lusha';

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'apollo_evidence_missing');
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(world.reservations.length, 0);
  });

  it('un candidato que YA tiene teléfono no vuelve a pagar', async () => {
    world.candidates.get(CANDIDATE_A)!.phone = '+573009998877';

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'existing_phone_present');
    assert.equal(world.lushaCalls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Presupuesto — § 14/15/16/43
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 14-16 — el gate presupuestal existe y bloquea ANTES del proveedor', () => {
  it('disponible 0 ⇒ 0 corridas, 0 reservas, 0 llamadas, 0 usage-logs, 0 créditos', async () => {
    world.limitCredits = LUSHA_LEG_CREDITS;
    world.consumedCredits = LUSHA_LEG_CREDITS; // available = 0

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'insufficient_credits');
    assert.equal(world.runs.length, 0);
    assert.equal(world.reservations.length, 0);
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(world.usageLogs.length, 0);
    assert.equal(providerHttpRequests().length, 0);
  });

  it('disponible 4 frente a 5 requeridos ⇒ 0 llamadas al proveedor', async () => {
    world.limitCredits = 10;
    world.consumedCredits = 6; // available = 4

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'insufficient_credits');
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(world.reservations.length, 0);
  });

  it('disponible EXACTAMENTE 5 ⇒ 1 corrida legacy, 1 pata reservada, 1 llamada', async () => {
    world.limitCredits = LUSHA_LEG_CREDITS;
    world.consumedCredits = 0; // available = 5

    const result = await reveal();

    assert.equal(result.outcome, 'lusha_revealed');
    assert.equal(world.runs.length, 1);
    assert.equal(world.runs[0].run_mode, 'legacy_lusha_only');
    assert.equal(world.runs[0].max_credits_authorized, LUSHA_LEG_CREDITS);
    // Apollo NO se inventa: ni timestamp, ni costo, ni pata.
    assert.equal(world.runs[0].apollo_attempted_at, null);
    assert.equal(world.runs[0].apollo_cost_credits, null);
    assert.equal(
      world.reservations.filter((r) => r.providerKey === 'lusha').length,
      1,
    );
    assert.equal(
      world.reservations.some((r) => r.providerKey === 'apollo'),
      false,
      'nunca se reserva una pata Apollo en esta modalidad',
    );
    assert.equal(world.lushaCalls.length, 1);
  });

  it('regla de crédito ausente ⇒ budget_not_configured, 0 llamadas', async () => {
    world.limitCredits = null;

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'budget_not_configured');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('lectura del pozo caída ⇒ fail-closed, 0 llamadas', async () => {
    world.poolUnavailable = true;

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'credit_balance_unavailable');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('la escritura atómica no disponible ⇒ infraestructura, NUNCA "no elegible"', async () => {
    world.reserveUnavailable = true;

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'run_creation_unavailable');
    assert.equal(world.runs.length, 0);
    assert.equal(world.reservations.length, 0);
    assert.equal(world.lushaCalls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Single-flight — § 17/18/35, el corazón de R2
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 17 — single-flight del MISMO candidato', () => {
  it('3 invocaciones concurrentes con presupuesto 5 ⇒ 1 sola operación pagada', async () => {
    world.limitCredits = LUSHA_LEG_CREDITS;

    const results = await Promise.all([reveal(), reveal(), reveal()]);

    assert.equal(world.lushaCalls.length, 1);
    assert.equal(world.runs.length, 1);
    assert.equal(results.filter((r) => r.outcome === 'lusha_revealed').length, 1);
  });

  it('3 invocaciones concurrentes con presupuesto ABUNDANTE (100) ⇒ 1 sola operación pagada', async () => {
    // Este es el test que importa. Con presupuesto 5 el saldo podría estar haciendo el
    // trabajo del single-flight y el defecto seguiría vivo en cuanto hubiera pozo. Con
    // 100 créditos disponibles, lo único que puede impedir la segunda y la tercera
    // llamada es la unicidad de pata activa / corrida activa DENTRO de la transacción.
    world.limitCredits = 100;

    const results = await Promise.all([reveal(), reveal(), reveal()]);

    assert.equal(world.lushaCalls.length, 1, 'una sola llamada pagada');
    assert.equal(world.runs.length, 1, 'una sola corrida');
    assert.equal(
      world.reservations.filter((r) => r.candidateId === CANDIDATE_A).length,
      1,
      'una sola reserva',
    );

    // Los perdedores NO pagaron y lo dicen con un motivo de concurrencia, no de saldo.
    const losers = results.filter((r) => r.outcome !== 'lusha_revealed');
    assert.equal(losers.length, 2);
    for (const loser of losers) {
      assert.equal(loser.outcome, 'not_started');
      assert.equal(loser.reason, 'active_run_exists');
      assert.equal(loser.lushaCalled, false);
    }

    // Y el consumo efectivo es de UNA operación, no de tres.
    assert.equal(confirmedCredits(), LUSHA_LEG_CREDITS);
  });

  it('una corrida ya ACTIVA se para en el guard barato del core, SIN invocar la transacción', async () => {
    // Dos capas de single-flight, y este test las distingue:
    //
    //   1. el guard BARATO del core (`findActiveRun`), que evita incluso la RPC;
    //   2. el guard AUTORITATIVO de la transacción (`already_reserved`), que es el que
    //      resuelve las carreras reales porque es el único atómico.
    //
    // Los dos desembocan en `active_run_exists`, así que sin medir `reserveAttempts`
    // serían indistinguibles y perder la capa 1 pasaría inadvertido.
    world.runs.push({
      id: 'run-preexisting',
      candidate_id: CANDIDATE_A,
      status: 'lusha_pending',
      run_mode: 'legacy_lusha_only',
      authorized_at: new Date().toISOString(),
      authorized_by: ADMIN.internalUserId,
      authorized_by_role: 'admin',
      max_credits_authorized: LUSHA_LEG_CREDITS,
      apollo_attempted_at: null,
      apollo_outcome: 'no_phone_found',
      apollo_cost_credits: null,
      apollo_cost_source: 'unknown',
      lusha_eligible: true,
      lusha_skipped_reason: null,
      lusha_attempted_at: null,
      lusha_outcome: null,
      lusha_cost_credits: null,
      lusha_cost_source: null,
      final_provider: null,
      completed_at: null,
      error_code: null,
      credit_reservation_group_id: 'group-preexisting',
    });

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'active_run_exists');
    assert.equal(
      world.reserveAttempts,
      0,
      'el guard barato del core evita incluso invocar la operación atómica',
    );
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(world.runs.length, 1, 'no se creó una segunda corrida');
  });

  it('un segundo intento SECUENCIAL tras revelar no vuelve a pagar', async () => {
    const first = await reveal();
    assert.equal(first.outcome, 'lusha_revealed');

    // El candidato ya tiene teléfono tras el reveal: el gate de elegibilidad lo para.
    world.candidates.get(CANDIDATE_A)!.phone = world.lushaPhones[0].number;

    const second = await reveal();

    assert.equal(second.outcome, 'not_started');
    assert.equal(world.lushaCalls.length, 1, 'sigue habiendo UNA sola llamada pagada');
  });
});

describe('R2 · § 18 — candidatos DISTINTOS no se bloquean entre sí', () => {
  it('A y B con presupuesto suficiente ejecutan los dos', async () => {
    world.limitCredits = 100;

    const [a, b] = await Promise.all([reveal(CANDIDATE_A), reveal(CANDIDATE_B)]);

    assert.equal(a.outcome, 'lusha_revealed');
    assert.equal(b.outcome, 'lusha_revealed');
    assert.equal(world.lushaCalls.length, 2);
    assert.equal(world.runs.length, 2);
    // El single-flight es POR CANDIDATO, no un cerrojo global.
    assert.equal(confirmedCredits(), LUSHA_LEG_CREDITS * 2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Privacidad — § 11/12/22/23/46
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 11-12 — DNC y supresión ANTES de reservar', () => {
  it('do_not_contact previo ⇒ 0 corridas, 0 reservas, 0 llamadas, 0 créditos', async () => {
    world.privacyGate = ['do_not_contact'];

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'do_not_contact');
    // El orden exigido se cumple: la puerta va ANTES de la reserva.
    assert.equal(world.runs.length, 0, 'no se crea corrida para un candidato bloqueado');
    assert.equal(world.reservations.length, 0, 'no se reserva exposición');
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(providerHttpRequests().length, 0);
  });

  it('supresión previa ⇒ mismas garantías de cero efectos', async () => {
    world.privacyGate = ['blocked_suppressed'];

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(result.reason, 'blocked_suppressed');
    assert.equal(world.runs.length, 0);
    assert.equal(world.reservations.length, 0);
    assert.equal(world.lushaCalls.length, 0);
  });

  it('la puerta NO verificable bloquea igual (fail-closed) y se registra distinto', async () => {
    world.privacyGate = ['check_unavailable'];

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    // Se afirma "no se pudo comprobar", no "está suprimido": el efecto es el mismo, la
    // afirmación no.
    assert.equal(result.reason, 'suppression_check_unavailable');
    assert.equal(world.lushaCalls.length, 0);
    assert.equal(world.reservations.length, 0);
  });
});

describe('R2 · § 23 — DNC EN VUELO conserva el costo y retiene el número', () => {
  it('la puerta previa pasa, la posterior encuentra do_not_contact ⇒ 0 persistencia del teléfono, costo intacto', async () => {
    // Secuencia de veredictos: [pre-reserva] clear, [pre-llamada waterfall] clear,
    // [pre-llamada core] clear, [POST-respuesta] do_not_contact.
    world.privacyGate = ['clear', 'clear', 'clear', 'do_not_contact'];

    const result = await reveal();

    // La llamada SÍ ocurrió y SÍ se cobró: el crédito no se puede "des-gastar".
    assert.equal(world.lushaCalls.length, 1);
    assert.equal(result.lushaCalled, true);

    // Lo que se retiene es el NÚMERO: la colección no se escribe.
    assert.equal(
      world.collectionWrites.length,
      0,
      'un DNC en vuelo no puede dejar el número persistido',
    );

    // Y el costo REAL queda contabilizado, íntegro.
    const paid = world.usageLogs.filter((l) => l.creditsUsed === LUSHA_LEG_CREDITS);
    assert.equal(paid.length, 1, 'el usage-log lleva los créditos reales');
    assert.equal(paid[0].errorCode, 'do_not_contact');
  });

  it('esta protección viene de la INYECCIÓN manual de la puerta, no del waterfall', async () => {
    // Si `manualInvocation` dejara de inyectar `checkPrivacyGate`, la puerta posterior
    // no existiría y el número se persistiría. La cuenta de consultas a la puerta lo
    // delata: la ruta manual consulta DESPUÉS de la respuesta.
    world.privacyGate = ['clear', 'clear', 'clear', 'clear'];

    await reveal();

    assert.ok(
      world.privacyGateCalls >= 4,
      `la puerta manual se consulta también tras la respuesta (llamadas: ${world.privacyGateCalls})`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Multi-teléfono y facturación — § 20/25/45
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 20 + § 25 — multi-teléfono por la MISMA transacción, facturación por respuesta', () => {
  it('WORK + MOBILE: los dos números de la respuesta pagada se persisten', async () => {
    world.lushaPhones = [
      { number: '+5712223344', rawType: 'work' },
      { number: '+573001112233', rawType: 'mobile' },
    ];

    const result = await reveal();

    assert.equal(result.outcome, 'lusha_revealed');
    assert.equal(world.collectionWrites.length, 1);
    assert.deepEqual(world.collectionWrites[0].numbers.sort(), [
      '+5712223344',
      '+573001112233',
    ].sort());
  });

  it('3 teléfonos ⇒ 3 filas, 1 sola llamada y 5 créditos (NO 15)', async () => {
    world.lushaPhones = [
      { number: '+5712223344', rawType: 'work' },
      { number: '+573001112233', rawType: 'mobile' },
      { number: '+573004445566', rawType: 'personal_mobile' },
    ];
    world.lushaCreditsCharged = LUSHA_LEG_CREDITS;

    await reveal();

    assert.equal(world.collectionWrites[0].numbers.length, 3);
    assert.equal(world.lushaCalls.length, 1);
    // La facturación es por RESPUESTA. Multiplicarla por `phones.length` sería el
    // defecto que este assert impide.
    assert.equal(confirmedCredits(), LUSHA_LEG_CREDITS);
    const credited = world.usageLogs
      .filter((l) => l.creditsUsed !== null)
      .reduce((s, l) => s + (l.creditsUsed ?? 0), 0);
    assert.equal(credited, LUSHA_LEG_CREDITS);
  });

  it('la colección se escribe correlacionada con la corrida REAL, no con null', async () => {
    await reveal();

    assert.equal(world.collectionWrites.length, 1);
    assert.equal(
      world.collectionWrites[0].runId,
      world.runs[0].id,
      'la procedencia de los teléfonos apunta a la corrida que los pagó',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Ledger — § 26/27/44, la razón principal de usar la corrida real
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 26 — el usage-log comparte identidad de corrida con la reserva', () => {
  it('usage 5 + reserva confirmada 5 ⇒ consumo efectivo 5, NUNCA 10', async () => {
    await reveal();

    const runId = world.runs[0].id;

    // 1. El usage-log lleva el id de la corrida REAL. Sin esto no hay deduplicación
    //    posible y el mismo gasto se cuenta dos veces.
    const lushaLog = world.usageLogs.find((l) => l.creditsUsed === LUSHA_LEG_CREDITS);
    assert.ok(lushaLog, 'existe un usage-log con el costo real');
    assert.equal(lushaLog.waterfallRunId, runId);

    // 2. La reserva quedó CONFIRMADA con ese mismo costo.
    const confirmed = world.reservations.filter((r) => r.status === 'confirmed');
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].creditsConfirmed, LUSHA_LEG_CREDITS);

    // 3. El consumo efectivo se calcula con la MISMA función que el resto del sistema.
    const effective = computeEffectiveConsumption({
      usageLogs: world.usageLogs.map((l) => ({
        providerKey: l.providerKey,
        creditsUsed: l.creditsUsed,
        estimatedCostUsd: null,
        waterfallRunId: l.waterfallRunId,
      })),
      reservations: world.reservations.map((r) => ({
        providerKey: r.providerKey,
        status: r.status,
        creditsReserved: r.creditsReserved,
        creditsConfirmed: r.creditsConfirmed,
        costTruth: r.costTruth as 'reported' | 'assumed_cap' | null,
        // `runId` es el lado de CONVENIENCIA y puede ser null; el autoritativo es el
        // grupo. Se deja null a propósito para que la deduplicación tenga que resolverse
        // por `reservationGroupId` → corrida, que es el camino real en Producción.
        runId: null,
        reservationGroupId: r.reservationGroupId,
      })),
      runIdByReservationGroupId: new Map([
        [world.runs[0].credit_reservation_group_id!, runId],
      ]),
    });

    assert.equal(effective.credits, LUSHA_LEG_CREDITS, 'consumo efectivo = 5');
    assert.notEqual(effective.credits, LUSHA_LEG_CREDITS * 2, 'jamás 10');
    assert.equal(effective.breakdown.excludedUsageLogCount, 1, 'el usage-log se dedujo');
    assert.equal(effective.reservedCredits, 0, 'no queda exposición viva');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Liquidación — § 28-33/47
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 28-33 — liquidación en todos los desenlaces', () => {
  it('éxito ⇒ corrida terminal, reserva confirmada 5, 0 exposición viva', async () => {
    await reveal();

    const run = world.runs[0];
    assert.equal(run.final_provider, 'lusha');
    assert.ok(run.completed_at, 'la corrida quedó terminal');
    assert.equal(confirmedCredits(), LUSHA_LEG_CREDITS);
    assert.equal(reservedCredits(), 0, 'no hay reserva colgada');
  });

  it('no_phone_found ⇒ el costo real queda contado y no queda exposición viva', async () => {
    world.lushaNoPhone = true;

    const result = await reveal();

    assert.equal(result.outcome, 'lusha_no_phone_found');
    assert.equal(world.lushaCalls.length, 1);
    // La llamada ocurrió y se cobró: el costo se conserva, no se regala.
    assert.equal(confirmedCredits(), LUSHA_LEG_CREDITS);
    assert.equal(reservedCredits(), 0);
    // Y el candidato NO queda con teléfono.
    assert.equal(world.collectionWrites.length, 0);
  });

  it('error del proveedor ⇒ no queda exposición viva y el candidato no se cierra con teléfono', async () => {
    world.lushaFails = true;

    const result = await reveal();

    assert.equal(result.outcome, 'lusha_error');
    assert.equal(world.collectionWrites.length, 0);
    assert.equal(reservedCredits(), 0, 'la liquidación corre también en el error');
  });

  it('el proveedor NO reportó costo ⇒ se confirma con el TOPE, nunca 0 y nunca release', async () => {
    world.lushaCreditsCharged = null;

    await reveal();

    // Un costo desconocido jamás se representa como 0: se asume el tope autorizado.
    assert.equal(confirmedCredits(), LUSHA_LEG_CREDITS);
    const confirmed = world.reservations.find((r) => r.status === 'confirmed');
    assert.equal(confirmed?.costTruth, 'assumed_cap');
  });

  it('supresión EN VUELO ⇒ costo 5 contado, 0 teléfono persistido, reserva liquidada', async () => {
    world.privacyGate = ['clear', 'clear', 'clear', 'blocked_suppressed'];

    await reveal();

    assert.equal(world.lushaCalls.length, 1);
    assert.equal(world.collectionWrites.length, 0);
    assert.equal(reservedCredits(), 0, 'la reserva no se queda colgada');
    const paid = world.usageLogs.filter((l) => l.creditsUsed === LUSHA_LEG_CREDITS);
    assert.equal(paid.length, 1);
    assert.equal(paid[0].errorCode, 'blocked_suppressed');
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. § 38 — invocación directa del servidor
// ═══════════════════════════════════════════════════════════════

describe('R2 · § 38 — la seguridad no depende de la UI', () => {
  it('invocación directa con presupuesto 0 ⇒ 0 llamadas', async () => {
    world.limitCredits = 0;

    const result = await reveal();

    assert.equal(result.outcome, 'not_started');
    assert.equal(world.lushaCalls.length, 0);
  });

  it('3 invocaciones directas concurrentes ⇒ 1 operación pagada como máximo', async () => {
    world.limitCredits = 100;

    await Promise.all([reveal(), reveal(), reveal()]);

    // Sin `useRef`, sin botón deshabilitado, sin nada de cliente: el límite es del
    // servidor. Esta es la garantía que 4O-F-M0 declaró AUSENTE.
    assert.equal(world.lushaCalls.length, 1);
  });
});
