// Agente 2A — Apollo → Lusha phone reveal waterfall: dependencias REALES
// (AGENT2A-PHONE-WATERFALL-1)
//
// Cableado server-only del core puro (phone-reveal-waterfall-core.ts). Se sitúa
// junto a phone-reveal-recovery-deps.ts y sigue exactamente su convención: este
// módulo NO decide NADA — no aplica gates, no normaliza topes, no interpreta
// desenlaces. Solo provee I/O (Supabase service-role, la llamada a Lusha, el
// usage-log) para que TRES disparadores compartan el mismo cableado sin duplicarlo:
//   1. El START del reveal Apollo (phone-reveal-actions.ts) → crea la corrida.
//   2. El webhook de Apollo (app/api/integrations/apollo/phone-reveal/webhook).
//   3. El recovery (cron L2 y revisión manual L3, vía phone-reveal-recovery-deps).
//
// NO es 'use server': un módulo 'use server' solo puede exportar async actions, y
// aquí hay builders sincrónicos. Es server-only por sus imports (admin client +
// API key de Lusha): nunca se importa desde un componente cliente.
//
// Toda la tabla `phone_reveal_waterfall_runs` es service_role-only (migración 102,
// RLS sin política para `authenticated`), así que cada lectura y escritura pasa
// por aquí.
//
// Contrato de seguridad heredado del core: no imprime teléfono / email / linkedin
// / nombre / empresa / id de contacto Lusha / id de persona Apollo / API key ni
// payload crudo. Sin bulk, sin retry automático, sin HubSpot, sin aprobación de
// candidatos.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  isLushaPhoneRevealFallbackEnabled,
  isPhoneRevealWaterfallEnabled,
  resolveLushaSearchTimeoutMs,
} from '@/lib/feature-flags.server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { enrichLushaContactPhonesForFallback } from '@/server/integrations/lusha-phone-fallback-client';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
// Puerta de privacidad COMPARTIDA con el disparo manual de Lusha (4O-E3): una sola
// implementación de la re-comprobación de supresión + do-not-contact.
import {
  checkPhoneRevealPrivacyGate,
  loadPhoneRevealPrivacyGateCandidateRow,
  PRIVACY_GATE_CANDIDATE_SELECT,
} from './phone-reveal-privacy-gate';
import {
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from './lusha-phone-fallback-core';
import { persistCandidateLushaPhoneCollection } from './candidate-lusha-phone-collection-persistence';
// Resolución de identidad cross-provider (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-
// RESOLUTION-1). El cableado REAL vive en su propio módulo de deps; aquí sólo se
// enchufa, y sólo cuando el flag del waterfall está encendido.
import {
  loadLushaIdentityResolutionContext,
  recordLushaIdentitySearchOutcome,
  resolveLushaIdentityForCandidate,
} from './lusha-identity-resolution-deps';
import {
  continuePhoneRevealWaterfall,
  isPhoneRevealWaterfallRoleAuthorized,
  parsePhoneRevealWaterfallLushaSkippedReason,
  parsePhoneRevealWaterfallRunMode,
  PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES,
  PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS,
  PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES,
  PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES,
  startLegacyPhoneRevealWaterfall,
  type ContinuePhoneRevealWaterfallDeps,
  type ContinuePhoneRevealWaterfallResult,
  type PhoneRevealWaterfallApolloOutcome,
  type PhoneRevealWaterfallCandidateRecord,
  type LegacyPhoneRevealStartDiagnostics,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallLegacyIneligibleReason,
  type PhoneRevealWaterfallLushaLegResult,
  type PhoneRevealWaterfallRunDraft,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
  type PhoneRevealWaterfallSuppressionState,
  type StartLegacyPhoneRevealWaterfallDeps,
  type StartPhoneRevealWaterfallDeps,
} from './phone-reveal-waterfall-core';
// Observabilidad PII-free del arranque legacy
// (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1). La construcción del evento es
// PURA y vive en su propio módulo; aquí sólo se emite.
import {
  buildLegacyPhoneRevealStartEvent,
  LEGACY_START_EXCEPTION_REASON,
} from './phone-reveal-waterfall-legacy-start-gate';
// Preflight de presupuesto (AGENT2A-PHONE-WATERFALL-4D/4E): la LECTURA vive aquí porque
// este es el módulo de infraestructura; la decisión sigue siendo del core puro.
import { readPhoneRevealCreditPools } from './phone-reveal-credit-budget-deps';
// Reserva ATÓMICA (AGENT2A-PHONE-WATERFALL-4E). La atomicidad vive en la migración 104;
// estos wrappers solo la invocan y traducen su desenlace.
import {
  confirmPhoneRevealCreditReservation,
  findActivePhoneRevealCreditReservations,
  releasePhoneRevealCreditReservation,
  reservePhoneRevealCreditsAndCreateRun,
} from './phone-reveal-credit-reservation-deps';
import {
  decidePhoneRevealCreditSettlement,
  resolvePhoneRevealSettledLegCost,
  type PhoneRevealCreditReservationAndRunRequest,
  type PhoneRevealCreditSettlementAction,
} from './phone-reveal-credit-reservation-core';
import type { PhoneRevealCreditProviderKey } from './phone-reveal-credit-budget-core';
// Cierre terminal por supresión (AGENT2A-PHONE-REVEAL-4O-E1). La escritura
// condicional vive en su propio módulo; aquí solo se cablea.
import { buildTerminalPhoneSuppressionPatch } from './phone-reveal-suppression-guard';
import { persistTerminalPhoneSuppression } from './candidate-phone-suppression-persistence';
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';

/**
 * Rol SINTÉTICO con el que la pata automática entra al core del fallback de Lusha
 * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1).
 *
 * NO es —y nunca fue— el rol del operador que autorizó: en el webhook, el cron y la
 * revisión manual no hay sesión, así que no hay rol de sesión que pasar. El gate
 * admin-only del core del fallback está escrito para su botón MANUAL; esta pata
 * satisface su forma con un token de servicio, y su autoridad real se comprueba antes,
 * contra `authorized_by_role` de la corrida.
 *
 * Se nombra en vez de escribirse `'admin'` en línea para que quede claro que es un
 * token de servicio y no una afirmación sobre quién autorizó — antes de este hito el
 * literal `'admin'` en el sitio del actor se leía como «esta pata es admin-only»,
 * que ya no es cierto.
 */
const WATERFALL_LUSHA_LEG_SERVICE_ROLE_KEY = 'admin';

/** Tabla de corridas (migración 102). service_role-only. */
export const PHONE_REVEAL_WATERFALL_RUNS_TABLE = 'phone_reveal_waterfall_runs';

// ── Proyección y mapeo de la corrida ───────────────────────────

export const WATERFALL_RUN_SELECT = `id, candidate_id, status, run_mode, authorized_at,
   authorized_by, authorized_by_role, max_credits_authorized,
   apollo_attempted_at, apollo_outcome, apollo_cost_credits, apollo_cost_source,
   lusha_eligible, lusha_skipped_reason, lusha_attempted_at, lusha_outcome,
   lusha_cost_credits, lusha_cost_source,
   final_provider, completed_at, error_code,
   credit_reservation_group_id`;

/**
 * `WATERFALL_RUN_SELECT` + el claim de la búsqueda de identidad (migración 124).
 *
 * Existe como constante SEPARADA y no como una columna más del select canónico porque
 * la 124 puede no estar aplicada: con el waterfall apagado se sigue leyendo el select de
 * siempre, y la columna nueva no se menciona en ninguna consulta.
 */
export const WATERFALL_RUN_SELECT_WITH_IDENTITY_SEARCH =
  `${WATERFALL_RUN_SELECT}, lusha_identity_search_attempted_at`;

function toNumberOrNull(value: unknown): number | null {
  // `numeric` puede llegar como string desde PostgREST; se normaliza sin
  // convertir la AUSENCIA de dato en 0 (un costo no reportado no es gratis).
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function mapWaterfallRun(
  row: Record<string, unknown>,
): PhoneRevealWaterfallRunRecord {
  return {
    id: row.id as string,
    candidateId: row.candidate_id as string,
    status: row.status as PhoneRevealWaterfallRunRecord['status'],
    // Vocabulario cerrado y PARSEADO (no casteado): un valor desconocido — o la
    // ausencia de la columna en un entorno sin la migración 103 — cae a
    // `full_waterfall`, que es el default de la columna y la lectura que NUNCA
    // excusa a Apollo.
    runMode: parsePhoneRevealWaterfallRunMode(row.run_mode),
    authorizedAt: row.authorized_at as string,
    authorizedBy: row.authorized_by as string,
    authorizedByRole: (row.authorized_by_role as string | null) ?? null,
    maxCreditsAuthorized: toNumberOrNull(row.max_credits_authorized) ?? 0,
    apolloAttemptedAt: (row.apollo_attempted_at as string | null) ?? null,
    apolloOutcome:
      (row.apollo_outcome as PhoneRevealWaterfallRunRecord['apolloOutcome']) ?? null,
    apolloCostCredits: toNumberOrNull(row.apollo_cost_credits),
    apolloCostSource:
      (row.apollo_cost_source as PhoneRevealWaterfallRunRecord['apolloCostSource']) ??
      null,
    lushaEligible:
      typeof row.lusha_eligible === 'boolean' ? row.lusha_eligible : null,
    // Vocabulario cerrado y PARSEADO (no casteado): un valor fuera del contrato
    // se descarta a null en vez de llegar a la UI o a la auditoría como si fuera
    // un motivo válido.
    lushaSkippedReason: parsePhoneRevealWaterfallLushaSkippedReason(
      row.lusha_skipped_reason,
    ),
    lushaAttemptedAt: (row.lusha_attempted_at as string | null) ?? null,
    // Sólo se declara cuando la COLUMNA vino en la proyección. La distinción importa:
    // `null` afirma «no se buscó», y afirmarlo desde un select que ni pidió la columna
    // liberaría la reserva de una búsqueda que sí se pagó.
    ...('lusha_identity_search_attempted_at' in row
      ? {
          lushaIdentitySearchAttemptedAt:
            (row.lusha_identity_search_attempted_at as string | null) ?? null,
        }
      : {}),
    lushaOutcome:
      (row.lusha_outcome as PhoneRevealWaterfallRunRecord['lushaOutcome']) ?? null,
    lushaCostCredits: toNumberOrNull(row.lusha_cost_credits),
    lushaCostSource:
      (row.lusha_cost_source as PhoneRevealWaterfallRunRecord['lushaCostSource']) ??
      null,
    finalProvider:
      (row.final_provider as PhoneRevealWaterfallRunRecord['finalProvider']) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    // AGENT2A-PHONE-WATERFALL-4E. Ausente (o null) en corridas anteriores a la
    // migración 104: esas no tienen exposición reservada que liquidar, y la
    // reconciliación simplemente no encuentra nada que hacer.
    creditReservationGroupId:
      typeof row.credit_reservation_group_id === 'string'
        ? row.credit_reservation_group_id
        : null,
  };
}

/** Traduce el patch del core a las columnas reales (solo las presentes). */
function toRunUpdate(patch: PhoneRevealWaterfallRunPatch): Record<string, unknown> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.apolloOutcome !== undefined) update.apollo_outcome = patch.apolloOutcome;
  if (patch.apolloCostCredits !== undefined) {
    update.apollo_cost_credits = patch.apolloCostCredits;
  }
  if (patch.apolloCostSource !== undefined) {
    update.apollo_cost_source = patch.apolloCostSource;
  }
  if (patch.lushaOutcome !== undefined) update.lusha_outcome = patch.lushaOutcome;
  if (patch.lushaCostCredits !== undefined) {
    update.lusha_cost_credits = patch.lushaCostCredits;
  }
  if (patch.lushaCostSource !== undefined) {
    update.lusha_cost_source = patch.lushaCostSource;
  }
  if (patch.lushaSkippedReason !== undefined) {
    update.lusha_skipped_reason = patch.lushaSkippedReason;
  }
  if (patch.finalProvider !== undefined) update.final_provider = patch.finalProvider;
  if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;
  if (patch.errorCode !== undefined) update.error_code = patch.errorCode;
  return update;
}

// ── Lectura / escritura de corridas ────────────────────────────

/**
 * Corrida NO terminal del candidato. Como mucho puede haber una (índice único
 * parcial de la migración 102), así que un `maybeSingle()` es suficiente.
 */
export async function findActiveWaterfallRunForCandidate(
  candidateId: string,
): Promise<PhoneRevealWaterfallRunRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
    .select(WATERFALL_RUN_SELECT)
    .eq('candidate_id', candidateId)
    .in('status', PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES as unknown as string[])
    .order('authorized_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapWaterfallRun(data as Record<string, unknown>) : null;
}

/**
 * Corrida MÁS RECIENTE del candidato, terminal o no. Dos consumidores, la MISMA fila:
 *   * el bloque de auditoría del drawer — una vez cerrada, la corrida sigue siendo lo
 *     que el operador necesita ver ("Apollo intentó, Lusha se omitió por X");
 *   * el gate de reautorización legacy (AGENT2A-PHONE-WATERFALL-2C), que clasifica su
 *     CLASE con `classifyPhoneRevealWaterfallLegacyHistory`.
 *
 * El desempate por `created_at` importa justo por el segundo: dos corridas del mismo
 * candidato pueden compartir `authorized_at` al milisegundo (el reloj del proceso tiene
 * resolución de ms), y sin desempate "la más reciente" quedaría a merced del orden
 * físico de las filas. La clasificación tiene que ser determinista.
 */
export async function findLatestWaterfallRunForCandidate(
  candidateId: string,
): Promise<PhoneRevealWaterfallRunRecord | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
    .select(WATERFALL_RUN_SELECT)
    .eq('candidate_id', candidateId)
    .order('authorized_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapWaterfallRun(data as Record<string, unknown>) : null;
}

/**
 * Id de la corrida ACTIVA, solo para correlacionar el usage-log. Best-effort por
 * contrato: cualquier fallo devuelve null en vez de propagar, porque perder la
 * correlación es aceptable y perder un teléfono ya pagado no lo es.
 */
export async function resolveActiveWaterfallRunId(
  candidateId: string,
): Promise<string | null> {
  try {
    const run = await findActiveWaterfallRunForCandidate(candidateId);
    return run?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * INSERT de la corrida. Devuelve null SOLO cuando el índice único parcial la
 * rechaza (código Postgres 23505): eso NO es un error, significa que otra corrida
 * activa ganó la carrera y el reveal Apollo devolverá `already_pending`.
 *
 * AGENT2A-PHONE-WATERFALL-2A: cualquier otro desenlace LANZA, incluido el caso
 * anómalo "el INSERT no devolvió id". `null` es la única señal de "ya existe una
 * autorización viva", y el caller la usa para seguir con el reveal legacy; si se
 * devolviera también cuando no se sabe si la fila quedó escrita, el reveal
 * continuaría sobre una corrida imposible de correlacionar ni de cerrar — es
 * decir, exactamente la corrida parcial que este contrato prohíbe.
 */
export async function createWaterfallRun(
  draft: PhoneRevealWaterfallRunDraft,
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
    .insert({
      candidate_id: draft.candidateId,
      status: draft.status,
      run_mode: draft.runMode,
      authorized_at: draft.authorizedAt,
      authorized_by: draft.authorizedBy,
      authorized_by_role: draft.authorizedByRole,
      max_credits_authorized: draft.maxCreditsAuthorized,
      // null en modalidad legacy: Apollo no corre bajo esta autorización y su
      // timestamp NO se inventa (AGENT2A-PHONE-WATERFALL-2).
      apollo_attempted_at: draft.apolloAttemptedAt,
      // Solo presentes en modalidad legacy, donde el desenlace histórico ya se
      // conoce. `apollo_cost_credits` se deja sin escribir a propósito: la columna
      // es nullable y su valor correcto es NULL — un costo no atribuible a esta
      // autorización nunca se representa como 0.
      ...(draft.apolloOutcome !== undefined
        ? { apollo_outcome: draft.apolloOutcome }
        : {}),
      ...(draft.apolloCostSource !== undefined
        ? { apollo_cost_source: draft.apolloCostSource }
        : {}),
      lusha_eligible: draft.lushaEligible,
      lusha_skipped_reason: draft.lushaSkippedReason,
      // AGENT2A-PHONE-WATERFALL-4E: la asociación con la exposición reservada va DENTRO
      // del INSERT. Así no existe ni un instante en el que haya una corrida cuya reserva
      // no se pueda encontrar para liquidarla.
      credit_reservation_group_id: draft.creditReservationGroupId,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === '23505') return null;
    throw new Error(error.message);
  }
  const id = (data as Record<string, unknown> | null)?.id;
  if (typeof id !== 'string' || !id.trim()) {
    // El driver no reportó error pero tampoco devolvió el id: no se puede afirmar
    // que la corrida exista NI que no exista. Se falla fuerte para que el caller
    // aplique el fail-closed en vez de tratarlo como un conflicto benigno.
    throw new Error('phone_reveal_waterfall_runs insert returned no id');
  }
  return id;
}

/**
 * Corrida por id. La necesita la reconciliación de la reserva: liquidar exige leer los
 * hechos TERMINALES de la fila (qué pata se intentó y qué costó cada una) y no el patch
 * que acabó de aplicarse, que puede ser parcial.
 */
export async function findWaterfallRunById(
  runId: string,
  /**
   * `includeIdentitySearch` añade `lusha_identity_search_attempted_at` (migración 124).
   * AUSENTE POR DEFECTO: sin ella la consulta es la de siempre y no menciona una
   * columna que puede no existir.
   */
  options?: { includeIdentitySearch?: boolean },
): Promise<PhoneRevealWaterfallRunRecord | null> {
  const admin = createSupabaseAdminClient();
  // Dos ramas con su literal propio (ver la nota equivalente en
  // phone-reveal-credit-reservation-deps.ts): el parser de tipos del `select` de
  // supabase-js no acepta una unión de literales.
  const row$ = options?.includeIdentitySearch
    ? admin
        .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
        .select(WATERFALL_RUN_SELECT_WITH_IDENTITY_SEARCH)
        .eq('id', runId)
        .maybeSingle()
    : admin
        .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
        .select(WATERFALL_RUN_SELECT)
        .eq('id', runId)
        .maybeSingle();
  const { data, error } = await row$;
  if (error) throw new Error(error.message);
  return data ? mapWaterfallRun(data as Record<string, unknown>) : null;
}

export async function updateWaterfallRun(
  runId: string,
  patch: PhoneRevealWaterfallRunPatch,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
    .update(toRunUpdate(patch))
    .eq('id', runId);
  if (error) throw new Error(error.message);

  // AGENT2A-PHONE-WATERFALL-4E. Este UPDATE es el ÚNICO paso por el que pasan TODOS los
  // cierres de una corrida —webhook de Apollo, cron L2, revisión manual L3, cierre tras
  // el START y cierre de la pata Lusha—, así que es el sitio correcto para reconciliar la
  // exposición reservada: engancharla aquí cubre todos los caminos sin que ninguno tenga
  // que acordarse. Solo se dispara en patches TERMINALES: mientras la corrida pueda
  // gastar, la exposición se mantiene ENTERA.
  if (patch.status !== undefined && PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(patch.status)) {
    await reconcilePhoneRevealCreditReservationForRun(runId);
  }
}

/**
 * Liquida la exposición reservada de una corrida TERMINAL, pata por pata
 * (AGENT2A-PHONE-WATERFALL-4E).
 *
 * BEST-EFFORT por contrato: un fallo aquí no puede convertir un webhook correcto de
 * Apollo en un 5xx (eso provocaría reintentos que no resuelven nada) ni degradar una
 * recuperación válida. El estado conservador ante un fallo es dejar la fila `reserved`:
 * la exposición sigue ocupada, así que el error nunca se traduce en créditos regalados.
 *
 * La DECISIÓN es del core puro (`decidePhoneRevealCreditSettlement`): pata no intentada ⇒
 * release; pata intentada con costo reportado ⇒ confirm con ese costo; pata intentada con
 * costo desconocido ⇒ confirm con el TOPE (`assumed_cap`), nunca 0 y nunca release.
 */
export async function reconcilePhoneRevealCreditReservationForRun(
  runId: string,
): Promise<void> {
  // Grano por OPERACIÓN sólo con el waterfall encendido: es el mismo gate que enchufa la
  // resolución de identidad, así que las dos caras —quién puede reservar una búsqueda y
  // quién sabe liquidarla— se encienden juntas. Apagado, ni la columna `operation_key` ni
  // `lusha_identity_search_attempted_at` se mencionan en ninguna consulta, y la
  // liquidación es la de siempre.
  const identityAware = isPhoneRevealWaterfallEnabled();
  try {
    const run = await findWaterfallRunById(runId, {
      includeIdentitySearch: identityAware,
    });
    // Sin grupo no hay exposición que liquidar (corrida anterior a la migración 104).
    if (!run?.creditReservationGroupId) return;

    const reservedLegs = await findActivePhoneRevealCreditReservations(
      run.creditReservationGroupId,
      { includeOperationKey: identityAware },
    );
    if (reservedLegs.length === 0) return;

    const actions = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES.includes(run.status),
        apolloAttempted: run.apolloAttemptedAt !== null,
        apolloCostCredits: run.apolloCostCredits,
        apolloCostSource: run.apolloCostSource,
        lushaAttempted: run.lushaAttemptedAt !== null,
        lushaCostCredits: run.lushaCostCredits,
        lushaCostSource: run.lushaCostSource,
        // Verdad de EMISIÓN de la pata de reveal, leída del cierre de la corrida
        // (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1). El claim dice que la pata se
        // tomó; este código dice si además llegó a salir una petición. Sólo un
        // vocabulario cerrado de bloqueos LOCALES libera; cualquier otro valor —o su
        // ausencia— liquida como siempre.
        lushaRevealErrorCode: run.errorCode,
        // La pata de BÚSQUEDA se liquida por su PROPIO claim, nunca por el del reveal.
        // Su costo NO se declara a propósito: la 124 no crea columna para él, así que
        // queda desconocido y el core lo confirma al TOPE (`assumed_cap`) — que es lo
        // conservador y lo correcto, porque Lusha cobra 1 por petición a `api_search`
        // aunque no devuelva resultados. Un 0 aquí regalaría un crédito ya gastado.
        ...(identityAware
          ? {
              lushaIdentitySearchAttempted:
                (run.lushaIdentitySearchAttemptedAt ?? null) !== null,
            }
          : {}),
      },
      reservedLegs,
    });

    await Promise.all(
      actions.map((action) =>
        action.action === 'confirm'
          ? confirmPhoneRevealCreditReservation({
              reservationId: action.reservationId,
              credits: action.credits,
              costTruth: action.costTruth,
            })
          : releasePhoneRevealCreditReservation({
              reservationId: action.reservationId,
              reason: action.reason,
            }),
      ),
    );

    // Paridad económica del candidato Apollo (AGENT2A-PHONE-REVEAL-4N § 6). Se hace
    // DESPUÉS de liquidar, porque hasta aquí la cifra no existe: Apollo no reporta lo que
    // cobra, así que el webhook solo pudo dejar `unknown` / null y el número real es el
    // que la reserva acaba de confirmar. Best-effort igual que el resto de este cierre.
    await writeApolloSettledCostBestEffort(run, actions);
  } catch (err) {
    console.error(
      '[phone-reveal-credit-reservation] settlement failed, exposure stays reserved:',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

/**
 * Escribe en el candidato el costo ECONÓMICO de la pata Apollo recién liquidada.
 *
 * SOLO cuando Apollo es el proveedor que el candidato describe (`final_provider = apollo`).
 * En un waterfall completo donde Apollo no encontró nada y Lusha sí, las columnas de costo
 * del candidato describen el reveal de LUSHA —las escribió su propio camino con su costo
 * reportado— y sobrescribirlas con los 8 de Apollo convertiría el registro del candidato en
 * una cifra que no corresponde a su teléfono. El costo de esa pata Apollo sigue contabilizado
 * donde importa para el presupuesto: en su reserva confirmada.
 *
 * Solo toca escrituras FUTURAS: se ejecuta en el instante en que una corrida se vuelve
 * terminal, y una corrida ya terminal no vuelve a pasar por aquí (sus patas ya no están
 * `reserved`, así que la reconciliación sale antes de llegar a este punto).
 */
async function writeApolloSettledCostBestEffort(
  run: PhoneRevealWaterfallRunRecord,
  actions: readonly PhoneRevealCreditSettlementAction[],
): Promise<void> {
  if (run.finalProvider !== 'apollo') return;

  const settled = resolvePhoneRevealSettledLegCost({ providerKey: 'apollo', settlement: actions });
  if (!settled) return;

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('contact_enrichment_candidates')
      .update({
        phone_reveal_cost_credits: settled.credits,
        phone_reveal_cost_source: settled.costSource,
      })
      .eq('id', run.candidateId);
    if (error) throw new Error(error.message);
  } catch (err) {
    // Un fallo aquí NO invalida la liquidación: los créditos ya están confirmados y el
    // presupuesto ya los cuenta. El candidato se queda con el costo `unknown` que escribió
    // el webhook, que es una cifra honesta, no una falsa.
    console.error(
      '[phone-reveal-credit-reservation] apollo settled cost not persisted on candidate:',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

/**
 * CLAIM ATÓMICO de la pata Lusha. Es UN solo UPDATE condicional, así que dos
 * disparadores concurrentes (webhook + cron, o cron + revisión manual L3) no
 * pueden reclamar la misma pata: el segundo actualiza 0 filas.
 *
 * Condiciones, todas necesarias:
 *   * `lusha_attempted_at IS NULL` — nadie la ha tomado todavía;
 *   * `status IN ('apollo_in_flight','lusha_pending')` — la corrida sigue viva y
 *     no está ya corriendo Lusha;
 *   * `authorized_at > now() - 24h` — la autorización humana no ha vencido. Se
 *     comprueba también AQUÍ, y no solo en el core, para que el TTL sea una
 *     condición de la escritura y no dependa del reloj del proceso que decidió.
 *
 * Devuelve true SOLO si actualizó exactamente una fila.
 */
export async function claimLushaAttempt(runId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const ttlCutoffIso = new Date(
    Date.now() - PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS * 3_600_000,
  ).toISOString();
  const { data, error } = await admin
    .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
    .update({
      lusha_attempted_at: nowIso,
      status: 'lusha_running',
      updated_at: nowIso,
    })
    .eq('id', runId)
    .is('lusha_attempted_at', null)
    .in('status', PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES as unknown as string[])
    .gt('authorized_at', ttlCutoffIso)
    .select('id');
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length === 1;
}

// ── Candidato (proyección del waterfall) ───────────────────────
//
// 4O-E3: la proyección, su lector y la re-comprobación de privacidad se mudaron a
// `phone-reveal-privacy-gate.ts` para que el disparo MANUAL de Lusha ejecute
// exactamente la misma puerta y no una copia con las mismas reglas escritas dos
// veces. Aquí solo queda la proyección PII-free que consume el core.
//
// `WATERFALL_CANDIDATE_SELECT` se conserva como alias porque nombra el contrato de
// lectura del waterfall en las suites existentes.

export const WATERFALL_CANDIDATE_SELECT = PRIVACY_GATE_CANDIDATE_SELECT;

/**
 * Proyección PII-free que consume el core (sin email/linkedin/teléfono).
 *
 * `options.includeIdentityFacts` añade lo que la resolución de identidad cross-provider
 * necesita (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1): las identidades
 * provider-native ya persistidas y los hechos con los que se PODRÍA construir una
 * búsqueda. Con eso el core puede decidir, ANTES del clic, si el tope es 14 o 13, y en
 * la continuación si la pata Lusha es alcanzable pagando una búsqueda.
 *
 * AUSENTE POR DEFECTO, y eso es lo que mantiene el código inerte con
 * `ENABLE_PHONE_REVEAL_WATERFALL` apagado: sin esta opción no se lee
 * `contact_provider_identities` (tabla de la migración 124, que puede no existir aún) y
 * la proyección es BYTE-IDÉNTICA a la anterior al hito — un candidato sin id Lusha
 * propio sigue saliendo como `missing_lusha_contact_id`.
 *
 * Los hechos son BEST-EFFORT y las identidades NO: si las identidades no se pueden
 * leer, la lectura entera falla hacia arriba en vez de devolver «ninguna», porque
 * «ninguna» significaría «hay que pagar una búsqueda» y podría estar comprando algo
 * que ya teníamos.
 */
export async function loadCandidateForWaterfall(
  candidateId: string,
  options?: { includeIdentityFacts?: boolean },
): Promise<PhoneRevealWaterfallCandidateRecord | null> {
  const row = await loadPhoneRevealPrivacyGateCandidateRow(candidateId);
  if (!row) return null;

  const base: PhoneRevealWaterfallCandidateRecord = {
    id: row.id,
    source: row.source,
    sourceContactId: row.sourceContactId,
    hasPhone: row.hasPhone,
    phoneRevealStatus: row.phoneRevealStatus,
  };
  if (!options?.includeIdentityFacts) return base;

  const context = await loadLushaIdentityResolutionContext(candidateId);
  if (!context) return base;
  return {
    ...base,
    providerIdentities: context.identities,
    identitySearchFacts: context.facts,
  };
}

// ── Evidencia legacy (AGENT2A-PHONE-WATERFALL-2) ───────────────

/**
 * Columnas que demuestran un intento Apollo histórico terminado sin teléfono. Se
 * lee `phone` solo para derivar `hasPhone` — el número nunca sale de esta función.
 * `status` alimenta el pre-filtro de candidato no editable.
 */
const WATERFALL_LEGACY_EVIDENCE_SELECT = `id, status, phone, source, source_contact_id,
   phone_reveal_status, phone_reveal_provider, phone_reveal_completed_at`;

/**
 * Carga la evidencia PERSISTIDA del intento Apollo histórico. No infiere nada de la
 * UI, no consulta a Apollo y no toca la caché: son columnas canónicas del candidato,
 * escritas por los caminos terminales de Apollo (webhook y recovery), que persisten
 * `phone_reveal_status` + `phone_reveal_provider` + `phone_reveal_completed_at`
 * juntos.
 */
export async function loadLegacyEvidenceForWaterfall(
  candidateId: string,
  /**
   * `includeIdentityFacts` añade lo que la continuación cross-provider necesita
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1): las identidades
   * provider-native ya persistidas y los hechos con los que se PODRÍA comprar la que
   * falta. Con eso el arranque legacy decide, ANTES del clic, si el tope es 5 o 6.
   *
   * AUSENTE POR DEFECTO, y eso es lo que mantiene el código inerte con
   * `ENABLE_PHONE_REVEAL_WATERFALL` apagado y con la migración 124 sin aplicar: sin la
   * opción no se lee `contact_provider_identities` y la evidencia es BYTE-IDÉNTICA a la
   * anterior al hito — un candidato sin id Lusha propio sigue saliendo
   * `missing_lusha_contact_id`.
   *
   * Las identidades NO son best-effort: si no se pueden leer, la lectura entera falla
   * hacia arriba en vez de devolver «ninguna». «Ninguna» significaría «hay que pagar
   * una búsqueda», y podría estar comprando un id que ya teníamos guardado.
   */
  options?: { includeIdentityFacts?: boolean },
): Promise<PhoneRevealWaterfallLegacyEvidence | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select(WATERFALL_LEGACY_EVIDENCE_SELECT)
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const phone = row.phone as string | null;
  const base: PhoneRevealWaterfallLegacyEvidence = {
    candidateStatus: (row.status as string | null) ?? null,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    phoneRevealProvider: (row.phone_reveal_provider as string | null) ?? null,
    phoneRevealCompletedAt:
      (row.phone_reveal_completed_at as string | null) ?? null,
    hasPhone: typeof phone === 'string' && phone.trim().length > 0,
    source: (row.source as string | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
  };
  if (!options?.includeIdentityFacts) return base;

  // MISMA lectura que `loadCandidateForWaterfall`, y a propósito: si el arranque legacy
  // resolviera la identidad con otra consulta, podría decidir un tope que la
  // continuación —que sí usa esa— no fuera capaz de ejecutar.
  const context = await loadLushaIdentityResolutionContext(candidateId);
  if (!context) return base;
  return {
    ...base,
    providerIdentities: context.identities,
    identitySearchFacts: context.facts,
  };
}

// ── Re-comprobación de supresión + do-not-contact ──────────────

/**
 * Re-comprueba supresión (tombstone) y do-not-contact INMEDIATAMENTE antes de la
 * pata Lusha. El reveal Apollo pudo empezar horas antes: una DSAR o un
 * `do_not_contact` pueden haberse registrado en el intervalo, y la pata Lusha es
 * una llamada NUEVA a un proveedor NUEVO — hereda la autorización de costo, no el
 * veredicto de privacidad.
 *
 * 4O-E3: la implementación vive en `phone-reveal-privacy-gate.ts` y es LA MISMA que
 * ejecuta ahora el disparo manual de Lusha. Esta función se conserva como el nombre
 * con el que el core del waterfall inyecta la dep; delega y no decide nada por su
 * cuenta, así que los dos caminos no pueden divergir en reglas ni en precedencia.
 */
export async function checkSuppressionAndDoNotContact(
  candidateId: string,
): Promise<PhoneRevealWaterfallSuppressionState> {
  return checkPhoneRevealPrivacyGate(candidateId);
}

// ── Pata Lusha (fallback existente, en modo waterfall) ─────────

const LUSHA_FALLBACK_CANDIDATE_SELECT =
  'id, status, source, source_contact_id, phone, enrichment_metadata, phone_reveal_status, phone_reveal_attempt_count';

function mapLushaFallbackCandidate(
  row: Record<string, unknown>,
): LushaPhoneFallbackCandidateRecord {
  return {
    id: row.id as string,
    status: (row.status as string | null) ?? null,
    source: (row.source as ContactSource | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
    existingPhone: (row.phone as string | null) ?? null,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    phoneRevealAttemptCount:
      typeof row.phone_reveal_attempt_count === 'number'
        ? row.phone_reveal_attempt_count
        : 0,
    enrichmentMetadata:
      (row.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
  };
}

/**
 * Ejecuta la pata Lusha reutilizando el core del fallback ya validado
 * (`runLushaPhoneFallbackReveal`) en MODO WATERFALL. Diferencias respecto al
 * disparo manual, todas deliberadas:
 *
 *   * el actor es el operador ALMACENADO en la autorización (`authorized_by`), no
 *     una sesión: aquí no hay humano presente y no se pueden usar server actions
 *     (redirigen a /login desde un webhook o un cron);
 *   * el rol con el que se entra al core del fallback es un TOKEN SINTÉTICO de
 *     servicio (`WATERFALL_LUSHA_LEG_SERVICE_ROLE_KEY`), no el rol del operador: el
 *     core del fallback tiene su propio gate admin-only pensado para el botón MANUAL,
 *     y aquí no hay sesión que gatear. La autoridad REAL de esta pata es
 *     `authorized_by_role` de la corrida, que se revalida abajo contra la autoridad
 *     canónica del reveal (`isPhoneRevealWaterfallRoleAuthorized`) ANTES de construir
 *     el token — el gate no se salta, se evalúa aquí de forma explícita
 *     (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1);
 *   * `waterfallMode: true` ⇒ un `no_phone_found` o un error de Lusha NO
 *     sobrescriben el candidato: ese resultado vive en la corrida;
 *   * `phoneRevealWaterfallId` viaja al usage-log para correlacionar las patas SIN
 *     sumar créditos.
 *
 * Una sola llamada, sin retry. Nunca HubSpot, nunca bulk, nunca search de Lusha.
 */
export async function callLushaFallbackLeg(args: {
  candidateId: string;
  runId: string;
  authorizedBy: string;
  /**
   * `authorized_by_role` de la corrida. Autoridad REAL de la pata: se revalida contra
   * `isPhoneRevealWaterfallRoleAuthorized` antes de llamar a Lusha
   * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1). `null` ⇒ no autorizado.
   */
  authorizedByRole: string | null;
  maxCreditsAuthorized: number;
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2 — invocación MANUAL de administración.
   *
   * `false` (defecto) = las dos rutas automáticas que ya existían: el waterfall
   * completo y la continuación legacy disparada por el webhook / cron / revisión L3.
   * Su comportamiento queda BYTE-IDÉNTICO: sin `checkPrivacyGate` inyectado y con
   * `waterfallMode: true`.
   *
   * `true` = el disparo manual admin-only, que converge sobre esta misma pata para
   * heredar la reserva atómica y la corrida real, pero conserva las DOS propiedades
   * que su contrato ya tenía y que la ruta automática no necesita:
   *
   *   1. `checkPrivacyGate` inyectado ⇒ la puerta de privacidad se evalúa también
   *      DESPUÉS de la respuesta de Lusha. La transacción de las migraciones 111/113
   *      revisa tombstones por número y supresión por persona bajo el lock, pero NO
   *      lee `do_not_contact`: sin esta inyección, converger perdería en silencio la
   *      protección de `do_not_contact` EN VUELO que 4O-E3 añadió a este camino.
   *      No se cablea en la ruta automática (§24): allí el core ya ejecutó esa misma
   *      puerta antes de autorizar la corrida.
   *   2. `waterfallMode: false` ⇒ un `no_phone_found` o un error SÍ se persisten en el
   *      candidato, que es la semántica observable que el disparo manual ya tenía. En
   *      la ruta automática ese resultado vive sólo en la corrida.
   */
  manualInvocation?: boolean;
  /**
   * Id NATIVO de Lusha ya resuelto por el paso de identidad de la corrida
   * (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1).
   *
   * EL PARÁMETRO QUE FALTABA. El core del waterfall ya lo pasaba —su dep
   * `callLushaLeg` lo declara `lushaContactId?: string` desde
   * AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1— pero esta firma no lo
   * recibía, así que se descartaba en silencio. TypeScript no podía avisar: una
   * función cuyo objeto de parámetros declara MENOS propiedades es asignable a una
   * que declara más, de modo que el contrato y su implementación divergieron sin
   * error de compilación.
   *
   * Consecuencia exacta en Producción (corrida 2a49e0f7): la búsqueda de identidad
   * se pagó, resolvió y persistió, y aun así el reveal no tenía id con el que pedir
   * el teléfono. `resolveLushaContactId` sólo podía mirar el candidato, cuyo
   * `source` es 'apollo', así que devolvía null → `missing_lusha_contact_id` →
   * cero peticiones emitidas → cierre con el genérico `lusha_reveal_error`.
   *
   * Nunca transporta un id de otro proveedor: lo rellena el resolutor de identidad,
   * que consulta `provider_key = 'lusha'`.
   */
  lushaContactId?: string;
}): Promise<PhoneRevealWaterfallLushaLegResult> {
  // Revalidación EXPLÍCITA del rol que autorizó, contra la autoridad canónica del
  // reveal. Es la última puerta antes de que el token sintético entre al core del
  // fallback, y existe para que ese token no pueda convertir una autorización
  // inválida en una llamada pagada: sin ella, cualquier corrida que llegara hasta aquí
  // gastaría créditos de Lusha como si la hubiera autorizado un admin.
  if (!isPhoneRevealWaterfallRoleAuthorized(args.authorizedByRole)) {
    // Bloqueo LOCAL: no sale ninguna petición, así que la reserva del reveal se
    // libera en vez de confirmarse al tope.
    return {
      status: 'error',
      creditsCharged: null,
      errorCode: 'role_not_allowed',
      requestEmitted: false,
    };
  }

  const admin = createSupabaseAdminClient();
  const manual = args.manualInvocation === true;

  const result = await runLushaPhoneFallbackReveal(
    {
      candidateId: args.candidateId,
      // La confirmación humana ya ocurrió: es lo que creó la corrida, con el tope
      // que el operador aceptó (13 cuando Lusha es posible). El core del fallback
      // revalida que ese tope cubra su propio mínimo de 5 créditos.
      confirmCost: true,
      expectedMaxCredits: args.maxCreditsAuthorized,
      // Se omite la clave entera cuando no hay identidad resuelta, en vez de viajar
      // como `undefined` explícito: así el disparo manual —que no tiene paso de
      // identidad— conserva EXACTAMENTE la resolución de id que ya tenía.
      ...(args.lushaContactId ? { resolvedLushaContactId: args.lushaContactId } : {}),
    },
    {
      flagEnabled: isLushaPhoneRevealFallbackEnabled(),
      actor: {
        internalUserId: args.authorizedBy,
        roleKey: WATERFALL_LUSHA_LEG_SERVICE_ROLE_KEY,
      },
      nowIso: new Date().toISOString(),
      waterfallMode: !manual,
      phoneRevealWaterfallId: args.runId,
      // Sólo en la invocación manual (ver `manualInvocation`). En la ruta automática
      // esta clave queda AUSENTE, y el bloque entero del core sigue sin ejecutarse.
      ...(manual ? { checkPrivacyGate: checkPhoneRevealPrivacyGate } : {}),

      // AGENT2A-PHONE-REVEAL-4O-D. Cableada AQUÍ y solo aquí: esta función es el
      // único punto por el que pasan TODAS las rutas que llegan a Lusha — el
      // waterfall completo, la continuación legacy y, desde
      // AGENT2A-PHONE-REVEAL-4O-F-R2, también el disparo manual de administración,
      // que converge sobre esta misma pata en vez de mantener su propio cableado.
      // Hay UNA sola implementación multi-teléfono de Lusha, no dos copias.
      //
      // Con la dep presente, el camino `revealed` persiste TODOS los teléfonos de
      // la respuesta, sus procedencias, el principal, el escalar y el estado
      // terminal en UNA transacción (migración 111). Si esa escritura falla, el
      // core falla cerrado: el candidato no se cierra y no se vuelve a llamar a
      // Lusha.
      persistPhoneCollection: persistCandidateLushaPhoneCollection,
      // AGENT2A-PHONE-REVEAL-4O-E1. Cableada en el MISMO punto y por la misma razón:
      // esta función es el único camino por el que la transacción de Lusha puede
      // responder `suppressed`, y ese resultado tiene que dejar el candidato terminal
      // (`error` + `blocked_suppressed`) en vez de devolverlo a `no_phone_found`, que
      // es el estado que lo hace elegible para otro reveal pagado del MISMO número
      // suprimido. Escritura condicional: no puede pisar un resultado concurrente.
      persistTerminalSuppression: persistTerminalPhoneSuppression,
      // La reserva de esta pata se liquida por su propia función (migración 104) y
      // su id no viaja hasta aquí. null en vez de inventar una correlación, misma
      // convención que la captura del otro proveedor.
      phoneCollectionReservationId: null,

      loadCandidate: async (candidateId) => {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .select(LUSHA_FALLBACK_CANDIDATE_SELECT)
          .eq('id', candidateId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapLushaFallbackCandidate(data as Record<string, unknown>) : null;
      },

      callLusha: async ({ contactId }) => {
        const apiKey = await getLushaApiKey();
        if (!apiKey) {
          // Sin credencial no se emite nada. `preflight` lo declara como el fallo
          // NUESTRO que es, para que la reserva del reveal se libere en vez de
          // confirmarse al tope por una petición inexistente.
          return {
            ok: false,
            errorMessage: 'Lusha API key not configured',
            failureKind: 'preflight',
          };
        }
        return enrichLushaContactPhonesForFallback({
          apiKey,
          timeoutMs: resolveLushaSearchTimeoutMs(),
          contactId,
          allowPhoneReveal: true,
        });
      },

      // Solo se invoca en el camino `revealed` (waterfallMode suprime los demás).
      persist: async (
        candidateId: string,
        patch: LushaPhoneFallbackPersistencePatch,
      ): Promise<void> => {
        const update: Record<string, unknown> = {
          phone_reveal_status: patch.phone_reveal_status,
          phone_reveal_provider: patch.phone_reveal_provider,
          // Higiene del id de correlación (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 10).
          // Este camino es el que reveló CON LUSHA tras un intento Apollo previo, así
          // que es exactamente donde un id Apollo huérfano quedaría junto a
          // `phone_reveal_provider = 'lusha'`. Se escribe siempre, incluso `null`.
          phone_reveal_request_id: patch.phone_reveal_request_id,
          phone_revealed_at: patch.phone_revealed_at,
          phone_reveal_completed_at: patch.phone_reveal_completed_at,
          phone_revealed_by: patch.phone_revealed_by,
          phone_reveal_cost_credits: patch.phone_reveal_cost_credits,
          phone_reveal_cost_source: patch.phone_reveal_cost_source,
          phone_reveal_error_code: patch.phone_reveal_error_code,
          phone_reveal_attempt_count: patch.phone_reveal_attempt_count,
        };
        if (patch.phone !== undefined) update.phone = patch.phone;
        if (patch.enrichment_metadata !== undefined) {
          update.enrichment_metadata = patch.enrichment_metadata;
        }
        const { error } = await admin
          .from('contact_enrichment_candidates')
          .update(update)
          .eq('id', candidateId);
        if (error) throw new Error(error.message);
      },

      // Diagnóstico estructurado de la pata (AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1).
      // MISMA convención que el evento del arranque legacy: `console.info` con el
      // payload serializado, PII-free por el TIPO del evento. No escribe en
      // `provider_usage_logs` a propósito: una pata que NO emitió petición no puede
      // dejar una fila que afirme que hubo una llamada al proveedor.
      logRevealAttemptOutcome: async (event) => {
        console.info(
          '[phone-reveal-waterfall] lusha reveal attempt outcome:',
          JSON.stringify(event),
        );
      },

      logUsage: async (entry: LushaPhoneFallbackUsageLogEntry): Promise<void> => {
        await logProviderUsage({
          provider_key: entry.provider,
          // operation_key PROPIO de Lusha: nunca se mezcla con Apollo's
          // `person_phone_reveal`, así que los créditos de las dos patas quedan en
          // filas separadas y jamás sumados.
          operation_key: entry.operationKey,
          credits_used: entry.creditsUsed ?? undefined,
          status: entry.status,
          error_code: entry.errorCode ?? undefined,
          triggered_by: entry.triggeredBy,
          results_returned: entry.status === 'success' ? 1 : 0,
          metadata: { ...entry.metadata },
        });
      },
    },
  );

  return {
    status: result.status,
    creditsCharged: result.creditsCharged ?? null,
    errorCode: result.errorCode,
    // Verdad de emisión, propagada tal cual desde el core. Es lo que permite a la
    // liquidación distinguir «la pata se reclamó» de «la pata pagó».
    requestEmitted: result.requestEmitted === true,
  };
}

// ── Builders de deps ───────────────────────────────────────────

/**
 * Deps del arranque de la corrida. Se cablea desde el START del reveal Apollo
 * (phone-reveal-actions.ts), que es el único punto con un humano autenticado.
 */
export function buildStartWaterfallDeps(actor: {
  internalUserId: string;
  roleKey: string | null;
}): StartPhoneRevealWaterfallDeps {
  return {
    flagEnabled: isPhoneRevealWaterfallEnabled(),
    actor,
    nowIso: new Date().toISOString(),
    // MISMO gate y MISMOS hechos que la continuación: el tope que el operador acepta y
    // las patas que se reservan tienen que salir de la misma lectura que después decide
    // si hay que pagar la búsqueda. Resolverlo con datos distintos en los dos momentos
    // es exactamente cómo se autoriza 13 y se gasta 14.
    loadCandidate: (candidateId: string) =>
      loadCandidateForWaterfall(candidateId, {
        includeIdentityFacts: isPhoneRevealWaterfallEnabled(),
      }),
    findActiveRun: findActiveWaterfallRunForCandidate,
    ...buildCreditReservationDeps(actor.internalUserId),
  };
}

/**
 * Deps de crédito compartidas por los DOS arranques
 * (AGENT2A-PHONE-WATERFALL-4D/4E). Una sola función porque el contrato es el mismo: el
 * core decide de qué proveedores pedir presupuesto y qué reservar, y este módulo solo
 * provee el I/O.
 */
function buildCreditReservationDeps(internalUserId: string) {
  return {
    // Presupuesto POR PROVEEDOR, con la identidad del pozo que la reserva necesita.
    readCreditPools: (providerKeys: readonly PhoneRevealCreditProviderKey[]) =>
      readPhoneRevealCreditPools(providerKeys, internalUserId),
    // AGENT2A-PHONE-WATERFALL-4F: reserva y corrida son UNA escritura. El borrador se
    // traduce aquí a nombres de columna; el core no conoce el esquema.
    reserveCreditsAndCreateRun: (args: {
      reservation: PhoneRevealCreditReservationAndRunRequest;
      run: PhoneRevealWaterfallRunDraft;
    }) =>
      reservePhoneRevealCreditsAndCreateRun({
        reservation: args.reservation,
        run: toWaterfallRunRpcPayload(args.run),
      }),
    // `crypto.randomUUID()` es del runtime, no del core puro: por eso llega inyectado.
    newReservationGroupId: () => crypto.randomUUID(),
    // Clave de idempotencia: una por autorización, generada ANTES de la operación.
    newAuthorizationKey: () => crypto.randomUUID(),
    // AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1 — la re-lectura que convierte un
    // conflicto en un hecho comprobado. Es la MISMA lectura que el arranque hace antes
    // de reservar (`findActiveWaterfallRunForCandidate`), a propósito: la pregunta es la
    // misma —«¿hay una corrida viva para este candidato?»— y responderla con dos
    // implementaciones distintas admitiría que una dijera que sí donde la otra dice que
    // no. NO llama a proveedores y no gasta créditos: sólo lee.
    findActiveRunAfterConflict: findActiveWaterfallRunForCandidate,
  };
}

/**
 * Borrador de corrida → payload `p_run` de la RPC. Mismos nombres de columna y mismas
 * omisiones deliberadas que `createWaterfallRun`: `apollo_cost_credits` NO se escribe
 * (su valor correcto es NULL — un costo no atribuible a esta autorización jamás se
 * representa como 0), y los campos sólo presentes en la modalidad legacy se omiten en
 * `full_waterfall` en vez de viajar como null explícito.
 *
 * `credit_reservation_group_id` y `authorization_key` NO viajan aquí: la RPC los escribe
 * desde sus propios parámetros, que son la autoridad.
 */
function toWaterfallRunRpcPayload(
  draft: PhoneRevealWaterfallRunDraft,
): Record<string, unknown> {
  return {
    status: draft.status,
    run_mode: draft.runMode,
    authorized_at: draft.authorizedAt,
    authorized_by_role: draft.authorizedByRole,
    max_credits_authorized: draft.maxCreditsAuthorized,
    apollo_attempted_at: draft.apolloAttemptedAt,
    ...(draft.apolloOutcome !== undefined
      ? { apollo_outcome: draft.apolloOutcome }
      : {}),
    ...(draft.apolloCostSource !== undefined
      ? { apollo_cost_source: draft.apolloCostSource }
      : {}),
    lusha_eligible: draft.lushaEligible,
    lusha_skipped_reason: draft.lushaSkippedReason,
  };
}

/**
 * Deps del arranque de una corrida LEGACY (AGENT2A-PHONE-WATERFALL-2). Se cablea
 * desde la server action legacy, que es el único punto con un humano autenticado.
 * NO incluye ninguna dependencia de Apollo: no hay nada que llamar.
 */
export function buildStartLegacyWaterfallDeps(
  actor: {
    internalUserId: string;
    roleKey: string | null;
  },
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2 — separa el flag de PRODUCTO/UX de la
   * INFRAESTRUCTURA DURABLE de contabilidad.
   *
   * Omitido (defecto) = `ENABLE_PHONE_REVEAL_WATERFALL`, byte-idéntico a antes: la
   * server action legacy sigue exigiendo el flag del waterfall.
   *
   * Presente = el llamador ya resolvió su PROPIO permiso de producto y lo pasa. Lo
   * usa el motor `legacy_lusha_only` del disparo manual, que está autorizado por
   * `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`.
   *
   * `ENABLE_PHONE_REVEAL_WATERFALL=false` sigue significando exactamente lo que
   * significaba —la UX del waterfall Apollo→Lusha está inactiva— y NO significa que
   * la base de datos no pueda contener una corrida `legacy_lusha_only`: esa corrida
   * es la representación duradera de una operación real de un solo proveedor.
   */
  options?: {
    flagEnabled?: boolean;
    /**
     * Cablea la puerta de privacidad PREVIA A LA RESERVA. Se pasa como bandera y no
     * como función para que el único punto que decide QUÉ puerta se usa siga siendo
     * este módulo: hay una sola implementación (`checkPhoneRevealPrivacyGate`).
     *
     * Ausente ⇒ la clave NO aparece en el objeto de deps (no viaja como `undefined`),
     * así que la superficie de deps de la ruta legacy automática queda EXACTAMENTE
     * como estaba.
     */
    gatePrivacyBeforeReserving?: boolean;
    /**
     * AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1 — ¿esta entrada a la ruta
     * legacy puede COMPRAR la identidad Lusha que le falta al candidato?
     *
     * Omitido = `ENABLE_PHONE_REVEAL_WATERFALL`, que es el MISMO gate que enchufa la
     * resolución de identidad en la continuación. Las dos caras se encienden juntas a
     * propósito: reservar el crédito de búsqueda sin poder ejecutarla dejaría
     * exposición ocupada para nada, y ejecutarla sin haberla reservado gastaría un
     * crédito que nadie autorizó.
     *
     * `false` EXPLÍCITO lo pasa el disparo manual `legacy_lusha_only`, cuya UI enseña 5
     * y cuya autorización reserva UNA pata de teléfono. Ese camino queda EXACTAMENTE
     * como estaba: sin hechos de identidad leídos, sin tope de 6 y sin búsqueda.
     */
    identitySearchAllowed?: boolean;
  },
): StartLegacyPhoneRevealWaterfallDeps {
  // Una sola decisión, usada en los DOS sitios que tienen que coincidir: qué se lee del
  // candidato y qué se le permite al core. Separarlas dejaría al core evaluando la vía
  // de pago sobre hechos que nadie cargó (veredicto falso: «no hay con qué buscar») o
  // leyendo `contact_provider_identities` en un entorno donde la 124 no está aplicada.
  const identitySearchAllowed =
    options?.identitySearchAllowed ?? isPhoneRevealWaterfallEnabled();
  return {
    flagEnabled: options?.flagEnabled ?? isPhoneRevealWaterfallEnabled(),
    actor,
    identitySearchAllowed,
    ...(options?.gatePrivacyBeforeReserving
      ? {
          // FAIL-CLOSED en el borde de I/O, no en el core: `checkPhoneRevealPrivacyGate`
          // LANZA cuando no puede leer (tabla ausente, timeout), y una excepción que
          // subiera hasta el llamador se traduciría en `legacy_run_creation_failed` — un
          // motivo de infraestructura que NO afirma nada sobre privacidad. Aquí se
          // convierte en `check_unavailable`, que bloquea igual que un tombstone
          // confirmado y lo REGISTRA como lo que es: una lectura que falló.
          // Mismo tratamiento que ya aplica `continuePhoneRevealWaterfall`.
          checkPrivacyGateBeforeReserving: async (candidateId: string) => {
            try {
              return await checkSuppressionAndDoNotContact(candidateId);
            } catch {
              return 'check_unavailable' as const;
            }
          },
        }
      : {}),
    nowIso: new Date().toISOString(),
    loadLegacyEvidence: (candidateId: string) =>
      loadLegacyEvidenceForWaterfall(candidateId, {
        includeIdentityFacts: identitySearchAllowed,
      }),
    findActiveRun: findActiveWaterfallRunForCandidate,
    findLatestRun: findLatestWaterfallRunForCandidate,
    // El core pide SOLO el pozo de Lusha en esta modalidad: Apollo no se ejecuta bajo
    // esta autorización, así que su presupuesto no puede bloquearla ni ocuparse.
    ...buildCreditReservationDeps(actor.internalUserId),
  };
}

/**
 * Deps de la continuación. Se cablea desde el webhook de Apollo y desde el
 * recovery (cron L2 / revisión manual L3). NO hay actor de sesión: el actor es
 * `authorized_by` de la propia corrida.
 */
export function buildContinueWaterfallDeps(options?: {
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2. Misma separación que en
   * `buildStartLegacyWaterfallDeps`: omitido = `ENABLE_PHONE_REVEAL_WATERFALL`
   * (webhook, cron L2, revisión L3 y server action legacy, sin cambios).
   */
  flagEnabled?: boolean;
  /**
   * Pata Lusha alternativa. Omitida = la automática. El motor manual pasa la variante
   * `manualInvocation: true`, que conserva la puerta de privacidad posterior a la
   * respuesta y la persistencia de los desenlaces que no revelan. Scoped a la
   * invocación manual: la ruta automática nunca la recibe.
   */
  callLushaLeg?: ContinuePhoneRevealWaterfallDeps['callLushaLeg'];
}): ContinuePhoneRevealWaterfallDeps {
  // ── EL GATE DE LA RESOLUCIÓN DE IDENTIDAD ────────────────────────────────────
  //
  // Se resuelve contra la VARIABLE DE ENTORNO, deliberadamente, y NO contra
  // `options.flagEnabled`. No es lo mismo:
  //
  //   * `options.flagEnabled` lo pasa el motor manual `legacy_lusha_only`, que está
  //     autorizado por `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` y cuya autorización reserva
  //     UNA pata de 5 — sin crédito de búsqueda. Darle la resolución de identidad le
  //     dejaría pagar una búsqueda que nadie reservó ni le enseñó al operador;
  //   * `ENABLE_PHONE_REVEAL_WATERFALL` es el flag cuyo preflight sí puede llegar a
  //     reservar `lusha/contact_search`.
  //
  // Consecuencia práctica, y es la que hace que este PR pueda desplegarse ANTES de
  // aplicar la migración 124: con la variable apagada no se enchufa nada, así que no se
  // lee `contact_provider_identities`, no se lee `operation_key`, no se invoca
  // `claim_lusha_identity_search` y no sale ninguna petición. El código queda presente
  // e INERTE.
  const identityResolutionWired = isPhoneRevealWaterfallEnabled();

  return {
    flagEnabled: options?.flagEnabled ?? isPhoneRevealWaterfallEnabled(),
    // El fallback Lusha sigue siendo el kill switch real de cualquier reveal
    // Lusha: el flag del waterfall solo automatiza CUÁNDO corre, no lo autoriza.
    lushaFallbackFlagEnabled: isLushaPhoneRevealFallbackEnabled(),
    nowIso: new Date().toISOString(),
    findActiveRun: findActiveWaterfallRunForCandidate,
    // Los hechos de identidad se leen SOLO con el flag del waterfall encendido. Sin
    // ellos la elegibilidad de la pata Lusha es la de antes del hito, que es
    // exactamente el comportamiento inerte que se quiere en Producción hoy.
    loadCandidate: (candidateId: string) =>
      loadCandidateForWaterfall(candidateId, {
        includeIdentityFacts: identityResolutionWired,
      }),
    updateRun: updateWaterfallRun,
    checkSuppressionAndDoNotContact,
    claimLushaAttempt,
    callLushaLeg: options?.callLushaLeg ?? callLushaFallbackLeg,
    // ── Resolución de identidad nativa de Lusha ──────────────────────────────
    //
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1. Las DOS deps se enchufan
    // juntas o no se enchufan: sellar un desenlace sin poder resolverlo, o resolverlo
    // sin sellarlo, son los dos estados que dejarían la auditoría mintiendo.
    ...(identityResolutionWired
      ? {
          resolveLushaIdentity: resolveLushaIdentityForCandidate,
          recordIdentitySearchOutcome: recordLushaIdentitySearchOutcome,
        }
      : {}),
    // AGENT2A-PHONE-REVEAL-4O-E1 § 7. Se cablea SIN flag propio: el gate previo a
    // Lusha ya existe y ya bloquea la llamada; lo único que añade esta dep es que la
    // decisión de privacidad quede también en el candidato, que es donde la leen el
    // gate de elegibilidad del fallback pagado, el cron y la revisión manual.
    //
    // La escritura es condicional por contrato (ver
    // `persistTerminalPhoneSuppression`): exige que la fila siga en el estado que el
    // core observó, así que no puede pisar un resultado concurrente.
    terminalizeSuppressedCandidate: async ({ candidateId, expectedStatuses }) =>
      persistTerminalPhoneSuppression(
        candidateId,
        buildTerminalPhoneSuppressionPatch({
          expectedStatuses,
          nowIso: new Date().toISOString(),
          // El gate es PRE-CALL: Lusha no se llamó, así que no hay costo nuevo que
          // declarar y las columnas de costo del candidato NO se tocan — siguen
          // describiendo la pata Apollo que ya se cerró y se pagó. Lo que quedó
          // reservado y no se gastó lo libera la liquidación de la corrida
          // (`leg_never_attempted`), no este rastro.
        }),
      ),
  };
}

/**
 * Punto de entrada BEST-EFFORT que cablean el webhook y el recovery. Nunca lanza:
 * un fallo aquí no puede convertir un callback correcto de Apollo en un 5xx (eso
 * provocaría reintentos que no resuelven nada) ni degradar una recuperación
 * válida. El error se registra sin PII y se devuelve un resultado neutro.
 *
 * Con `ENABLE_PHONE_REVEAL_WATERFALL` apagado el core sale en el primer gate sin
 * tocar la base de datos.
 */
export async function continuePhoneRevealWaterfallForCandidate(args: {
  candidateId: string;
  apolloOutcome: PhoneRevealWaterfallApolloOutcome;
  /**
   * Créditos que Apollo reportó en ESTA corrida. OPCIONAL: omitirlo (o pasar
   * `undefined`) significa "no toques las columnas de costo de Apollo", que es lo
   * correcto en la modalidad legacy — el costo histórico pertenece a la autorización
   * que realmente lo pagó. `null` presente sí escribe null + unknown.
   */
  apolloCostCredits?: number | null;
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2. Omitido = cableado automático de siempre (webhook,
   * cron L2, revisión L3). El motor manual pasa su flag de producto y su pata Lusha
   * con la puerta de privacidad posterior a la respuesta.
   */
  depsOverride?: Parameters<typeof buildContinueWaterfallDeps>[0];
}): Promise<ContinuePhoneRevealWaterfallResult> {
  try {
    return await continuePhoneRevealWaterfall(
      {
        candidateId: args.candidateId,
        apolloOutcome: args.apolloOutcome,
        // La clave se OMITE cuando no llega, en vez de reenviarse como undefined:
        // el core distingue "ausente" (no tocar las columnas de costo de Apollo) de
        // "null" (escribir null + unknown), y esa distinción es lo que impide
        // re-atribuir un costo histórico a la autorización legacy.
        ...('apolloCostCredits' in args
          ? { apolloCostCredits: args.apolloCostCredits }
          : {}),
      },
      buildContinueWaterfallDeps(args.depsOverride),
    );
  } catch (err) {
    // Solo el mensaje mecánico del driver, sin PII: este módulo nunca imprime
    // teléfono, identidad ni ids de proveedor.
    console.error(
      '[phone-reveal-waterfall] continuation failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return { outcome: 'noop', reason: 'continuation_failed', lushaCalled: false };
  }
}

// ── Arranque legacy completo (AGENT2A-PHONE-WATERFALL-2) ────────

export type StartLegacyPhoneRevealWaterfallRuntimeOutcome =
  | ContinuePhoneRevealWaterfallResult['outcome']
  | 'not_started';

export interface StartLegacyPhoneRevealWaterfallRuntimeResult {
  outcome: StartLegacyPhoneRevealWaterfallRuntimeOutcome;
  /** Motivo mecánico y PII-free. `null` en los caminos correctos. */
  reason: string | null;
  /** Tope que quedó autorizado (5 o 6). `null` cuando no se creó corrida. */
  maxCreditsAuthorized: number | null;
  /** true SOLO si se llegó a llamar a Lusha. */
  lushaCalled: boolean;
  /**
   * true cuando el tope autorizado incluye la búsqueda de identidad
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). `null` cuando no se creó
   * corrida: ahí la modalidad no llegó a decidirse, y un `false` afirmaría que se
   * evaluó y salió que no.
   */
  requiresIdentitySearch: boolean | null;
  /**
   * Solo en `authorization_ceiling_mismatch`: qué exigía la modalidad real y qué había
   * aceptado el operador. `null` en cualquier otro camino.
   */
  requiredMaxCredits: number | null;
  acceptedMaxCredits: number | null;
  /**
   * Hechos OBSERVADOS por el arranque, PII-free
   * (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1). `null` sólo cuando el arranque
   * lanzó y no hubo nada que observar.
   */
  diagnostics: LegacyPhoneRevealStartDiagnostics | null;
}

/**
 * Arranca la corrida legacy y CONTINÚA de inmediato hacia la pata Lusha usando el
 * MISMO core que el webhook, el cron L2 y la revisión manual L3.
 *
 * Por qué el arranque encadena la continuación en vez de tener su propia lógica: en
 * la modalidad legacy no hay ningún evento de Apollo que dispare la 2ª pata más
 * tarde — Apollo ya terminó hace tiempo. Así que el propio arranque hace de
 * disparador, y lo hace pasando `apolloOutcome: 'no_phone_found'`, que NO es un
 * valor inventado: es el desenlace terminal histórico que la evidencia del candidato
 * acaba de demostrar y que el INSERT transcribió en `apollo_outcome`.
 *
 * Al reusar `continuePhoneRevealWaterfall` hereda, sin duplicar nada: revalidación
 * de rol contra la autorización almacenada, TTL de 24 h, re-comprobación de
 * supresión/DNC fail-closed, CLAIM ATÓMICO (una sola llamada a Lusha aunque otro
 * disparador observe la misma corrida), registro de costo en la columna de Lusha y
 * cierre sin retry automático.
 *
 * La corrida se crea ANTES de cualquier llamada a Lusha. Si la creación falla, no se
 * llama a nada.
 */
/**
 * Emite el evento estructurado del arranque legacy
 * (AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1).
 *
 * Se emite en TODAS las salidas del arranque —éxito, rechazo y excepción—, porque un
 * evento que sólo aparece cuando algo va bien no sirve para diagnosticar lo que va mal.
 * El payload es PII-free por el TIPO del evento: booleanos, enteros y literales
 * cerrados, sin `candidateId` y sin ninguna clave por la que pudiera colarse un nombre,
 * un correo, un LinkedIn, un teléfono o un id nativo de proveedor.
 */
function emitLegacyStartOutcome(
  args: Parameters<typeof buildLegacyPhoneRevealStartEvent>[0],
): void {
  console.info(
    '[phone-reveal-waterfall] legacy start outcome:',
    JSON.stringify(buildLegacyPhoneRevealStartEvent(args)),
  );
}

export async function startLegacyPhoneRevealWaterfallForCandidate(
  candidateId: string,
  actor: { internalUserId: string; roleKey: string | null },
  /**
   * AGENT2A-PHONE-REVEAL-4O-F-R2 — punto de reutilización del MOTOR ECONÓMICO.
   *
   * Omitido = la server action legacy, byte-idéntica: flag del waterfall en el
   * arranque y en la continuación, y pata Lusha automática.
   *
   * Presente = el disparo manual admin-only, que reutiliza EXACTAMENTE esta
   * secuencia —preflight de presupuesto, `reserve_and_create_phone_reveal_run`
   * (reserva + corrida `legacy_lusha_only` en UNA transacción), claim atómico,
   * puerta de privacidad previa, UNA llamada a Lusha, usage-log correlacionado con
   * la corrida REAL, persistencia multi-teléfono y liquidación de la reserva— en vez
   * de mantener una segunda implementación pagada de la misma operación.
   */
  options?: {
    /** Permiso de PRODUCTO ya resuelto por el llamador. */
    flagEnabled?: boolean;
    /** Pata Lusha alternativa (scoped a la invocación manual). */
    callLushaLeg?: ContinuePhoneRevealWaterfallDeps['callLushaLeg'];
  },
  /**
   * Tope que el operador ACEPTÓ en la UI
   * (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1). Parámetro PROPIO y no un
   * campo de `options` porque `options` significa «esta invocación es el disparo
   * manual», y el techo humano aplica a las DOS entradas.
   *
   * Ausente ⇒ el suelo conservador de la ruta legacy (5), nunca la modalidad requerida.
   */
  acceptedMaxCredits?: number,
): Promise<StartLegacyPhoneRevealWaterfallRuntimeResult> {
  // Fail-closed: si el store no está disponible (p. ej. las migraciones 102/103 aún
  // no aplicadas en ese entorno) NO se crea corrida y, por tanto, no se llama a
  // Lusha. Solo el mensaje mecánico del driver, sin PII.
  const normalizedAccepted =
    typeof acceptedMaxCredits === 'number' && Number.isFinite(acceptedMaxCredits)
      ? acceptedMaxCredits
      : null;

  let started: Awaited<ReturnType<typeof startLegacyPhoneRevealWaterfall>>;
  try {
    started = await startLegacyPhoneRevealWaterfall(
      { candidateId, acceptedMaxCredits },
      buildStartLegacyWaterfallDeps(
        actor,
        options
          ? {
              flagEnabled: options.flagEnabled,
              // El disparo manual exige el orden DNC → RESERVA.
              gatePrivacyBeforeReserving: true,
              // Y NO puede comprar la identidad Lusha
              // (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1): su UI enseña 5,
              // su autorización reserva UNA pata de teléfono, y darle la vía de pago
              // le dejaría gastar un crédito que el operador nunca vio. Explícito y no
              // por omisión: la omisión aquí significa «lo decide el flag», y este
              // camino lo tiene decidido.
              identitySearchAllowed: false,
            }
          : {
              // AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1 — la ruta legacy
              // AUTOMÁTICA también cablea la puerta de privacidad ANTES de reservar.
              //
              // No relaja nada: el veredicto y su precedencia son los mismos, los
              // produce la MISMA implementación (`checkPhoneRevealPrivacyGate`) y
              // sigue siendo fail-closed en las tres ramas. Lo que cambia es DÓNDE
              // corta. Antes, un candidato bloqueado creaba una corrida y reservaba
              // créditos para cerrarla acto seguido sin llamar a nadie: el efecto
              // económico neto ya era 0 —la liquidación libera la pata no intentada—
              // pero quedaban una corrida y una reserva que nadie podía llegar a
              // gastar, y durante ese intervalo la exposición estaba ocupada contra el
              // pozo de Lusha. Ahora son 0 escrituras, que es lo que el contrato de
              // privacidad afirma.
              //
              // La puerta de `continuePhoneRevealWaterfall` NO se sustituye: sigue
              // corriendo después, sobre el estado ya reservado, y es la que cubre la
              // ventana entre la reserva y la llamada al proveedor.
              gatePrivacyBeforeReserving: true,
            },
      ),
    );
  } catch (err) {
    console.error(
      '[phone-reveal-waterfall] legacy run creation failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    // Una LECTURA que falla no es un hecho del candidato. Se registra como lo que es,
    // y el wrapper lo traduce a infraestructura — nunca a «ya no aplica».
    emitLegacyStartOutcome({
      started: null,
      outerFlagEnabled: options?.flagEnabled ?? isPhoneRevealWaterfallEnabled(),
      acceptedMaxCredits: normalizedAccepted,
    });
    return {
      outcome: 'not_started',
      reason: LEGACY_START_EXCEPTION_REASON,
      maxCreditsAuthorized: null,
      lushaCalled: false,
      requiresIdentitySearch: null,
      requiredMaxCredits: null,
      acceptedMaxCredits: null,
      diagnostics: null,
    };
  }

  emitLegacyStartOutcome({
    started,
    outerFlagEnabled: options?.flagEnabled ?? isPhoneRevealWaterfallEnabled(),
    acceptedMaxCredits: normalizedAccepted,
  });

  if (!started.started) {
    return {
      outcome: 'not_started',
      reason: started.reason satisfies PhoneRevealWaterfallLegacyIneligibleReason,
      maxCreditsAuthorized: null,
      lushaCalled: false,
      // La modalidad no llegó a autorizarse: no se afirma nada sobre ella.
      requiresIdentitySearch: null,
      // Presentes SOLO en el rechazo por techo, que es el único que los produce.
      requiredMaxCredits: started.requiredMaxCredits ?? null,
      acceptedMaxCredits: started.acceptedMaxCredits ?? null,
      diagnostics: started.diagnostics,
    };
  }

  // `apolloCostCredits` se OMITE deliberadamente: presente (incluso como null)
  // escribiría las columnas de costo de Apollo, y el costo histórico pertenece a la
  // autorización que realmente lo pagó. La fila ya nació con null + unknown.
  const continued = await continuePhoneRevealWaterfallForCandidate({
    candidateId,
    // Desenlace histórico ya demostrado, no fabricado.
    apolloOutcome: 'no_phone_found',
    // El MISMO permiso y la MISMA pata que autorizaron el arranque: si la
    // continuación resolviera el flag por su cuenta, el motor manual crearía la
    // corrida (y reservaría los créditos) y acto seguido saldría en `feature_disabled`
    // dejando la exposición ocupada sin llamar a nadie.
    ...(options ? { depsOverride: options } : {}),
  });

  return {
    outcome: continued.outcome,
    reason: continued.reason,
    maxCreditsAuthorized: started.maxCreditsAuthorized,
    lushaCalled: continued.lushaCalled,
    requiresIdentitySearch: started.requiresIdentitySearch === true,
    requiredMaxCredits: null,
    acceptedMaxCredits: null,
    diagnostics: started.diagnostics,
  };
}
