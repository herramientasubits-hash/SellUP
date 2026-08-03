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
import {
  evaluateInFlightPhoneSuppression,
  resolveInFlightSuppressionPersonId,
} from './phone-reveal-suppression-guard';
import { readPhoneCacheSuppression } from './phone-cache-store';
import {
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from './lusha-phone-fallback-core';
import {
  continuePhoneRevealWaterfall,
  parsePhoneRevealWaterfallLushaSkippedReason,
  parsePhoneRevealWaterfallRunMode,
  PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES,
  PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS,
  PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES,
  startLegacyPhoneRevealWaterfall,
  type ContinuePhoneRevealWaterfallDeps,
  type ContinuePhoneRevealWaterfallResult,
  type PhoneRevealWaterfallApolloOutcome,
  type PhoneRevealWaterfallCandidateRecord,
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
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';

/** Tabla de corridas (migración 102). service_role-only. */
export const PHONE_REVEAL_WATERFALL_RUNS_TABLE = 'phone_reveal_waterfall_runs';

// ── Proyección y mapeo de la corrida ───────────────────────────

export const WATERFALL_RUN_SELECT = `id, candidate_id, status, run_mode, authorized_at,
   authorized_by, authorized_by_role, max_credits_authorized,
   apollo_attempted_at, apollo_outcome, apollo_cost_credits, apollo_cost_source,
   lusha_eligible, lusha_skipped_reason, lusha_attempted_at, lusha_outcome,
   lusha_cost_credits, lusha_cost_source,
   final_provider, completed_at, error_code`;

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

/**
 * Proyección para decidir el waterfall. `phone` se lee para saber SI hay teléfono
 * — nunca se devuelve el número al core, solo el booleano `hasPhone`.
 * `apollo_person_id` + `run.account_id` son la clave de la re-comprobación de
 * supresión; `source` / `source_contact_id` deciden la elegibilidad Lusha.
 */
export const WATERFALL_CANDIDATE_SELECT = `id, source, source_contact_id, phone,
   email, linkedin_url, phone_reveal_status, apollo_person_id,
   run:contact_enrichment_runs ( account_id )`;

interface WaterfallCandidateRow {
  id: string;
  source: ContactSource | null;
  sourceContactId: string | null;
  hasPhone: boolean;
  phoneRevealStatus: string | null;
  email: string | null;
  linkedinUrl: string | null;
  apolloPersonId: string | null;
  accountId: string | null;
}

function mapWaterfallCandidateRow(row: Record<string, unknown>): WaterfallCandidateRow {
  const runRaw = row.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { account_id: string | null }
    | null
    | undefined;
  const phone = row.phone as string | null;
  return {
    id: row.id as string,
    source: (row.source as ContactSource | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
    hasPhone: typeof phone === 'string' && phone.trim().length > 0,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    linkedinUrl: (row.linkedin_url as string | null) ?? null,
    apolloPersonId: (row.apollo_person_id as string | null) ?? null,
    accountId: run?.account_id ?? null,
  };
}

async function loadWaterfallCandidateRow(
  candidateId: string,
): Promise<WaterfallCandidateRow | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select(WATERFALL_CANDIDATE_SELECT)
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapWaterfallCandidateRow(data as Record<string, unknown>) : null;
}

/** Proyección PII-free que consume el core (sin email/linkedin/teléfono). */
export async function loadCandidateForWaterfall(
  candidateId: string,
): Promise<PhoneRevealWaterfallCandidateRecord | null> {
  const row = await loadWaterfallCandidateRow(candidateId);
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    sourceContactId: row.sourceContactId,
    hasPhone: row.hasPhone,
    phoneRevealStatus: row.phoneRevealStatus,
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
  return {
    candidateStatus: (row.status as string | null) ?? null,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    phoneRevealProvider: (row.phone_reveal_provider as string | null) ?? null,
    phoneRevealCompletedAt:
      (row.phone_reveal_completed_at as string | null) ?? null,
    hasPhone: typeof phone === 'string' && phone.trim().length > 0,
    source: (row.source as string | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
  };
}

// ── Re-comprobación de supresión + do-not-contact ──────────────

/**
 * ¿Hay `do_not_contact` para este candidato? Espejo EXACTO de `isDoNotContact` en
 * phone-reveal-actions.ts: solo es detectable con cuenta + identidad
 * (email/linkedin); sin ellas NO se bloquea por inferencia. Ese es el mismo
 * criterio que ya gobierna el reveal Apollo, así que la pata Lusha no aplica una
 * regla distinta a la que el operador ya aceptó.
 */
async function isCandidateDoNotContact(row: WaterfallCandidateRow): Promise<boolean> {
  if (!row.accountId) return false;
  const email = row.email?.trim().toLowerCase() || null;
  const linkedin = row.linkedinUrl?.trim().toLowerCase() || null;
  if (!email && !linkedin) return false;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contacts')
    .select('id, email, linkedin_url, contact_status')
    .eq('account_id', row.accountId)
    .eq('contact_status', 'do_not_contact');
  if (error) throw new Error(error.message);

  return (data ?? []).some((c) => {
    const cEmail = typeof c.email === 'string' ? c.email.toLowerCase() : null;
    const cLinkedin =
      typeof c.linkedin_url === 'string' ? c.linkedin_url.toLowerCase() : null;
    return (
      (email !== null && cEmail === email) ||
      (linkedin !== null && cLinkedin === linkedin)
    );
  });
}

/**
 * Re-comprueba supresión (tombstone) y do-not-contact INMEDIATAMENTE antes de la
 * pata Lusha. El reveal Apollo pudo empezar horas antes: una DSAR o un
 * `do_not_contact` pueden haberse registrado en el intervalo, y la pata Lusha es
 * una llamada NUEVA a un proveedor NUEVO — hereda la autorización de costo, no el
 * veredicto de privacidad.
 *
 * Fail-closed: cualquier fallo de lectura devuelve `check_unavailable`, que el
 * core traduce en NO llamar a Lusha.
 *
 * `not_evaluable` (sin Apollo person id resoluble o sin cuenta) se trata como
 * `clear`, exactamente la política que ya aplican el START, el webhook y el
 * recovery (FIX 4): sin clave no hay tombstone que emparejar, y no se bloquea por
 * inferencia ni se hace matching difuso por teléfono/email/nombre/LinkedIn.
 */
export async function checkSuppressionAndDoNotContact(
  candidateId: string,
): Promise<PhoneRevealWaterfallSuppressionState> {
  let row: WaterfallCandidateRow | null;
  try {
    row = await loadWaterfallCandidateRow(candidateId);
  } catch {
    return 'check_unavailable';
  }
  if (!row) return 'check_unavailable';

  try {
    if (await isCandidateDoNotContact(row)) return 'do_not_contact';
  } catch {
    return 'check_unavailable';
  }

  const suppression = await evaluateInFlightPhoneSuppression({
    personId: resolveInFlightSuppressionPersonId({
      candidateApolloPersonId: row.apolloPersonId,
      candidateSource: row.source,
      candidateSourceContactId: row.sourceContactId,
    }),
    accountId: row.accountId,
    lookup: readPhoneCacheSuppression,
  });

  switch (suppression.kind) {
    case 'blocked_suppressed':
      return 'blocked_suppressed';
    case 'check_unavailable':
      return 'check_unavailable';
    case 'not_evaluable':
    case 'allowed':
    default:
      return 'clear';
  }
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
 *   * el rol se fija a 'admin' porque el core del waterfall ya revalidó que la
 *     autorización pertenece a un admin antes de llegar hasta aquí — el gate no se
 *     salta, se hereda de una comprobación que ya se hizo dos veces;
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
  maxCreditsAuthorized: number;
}): Promise<PhoneRevealWaterfallLushaLegResult> {
  const admin = createSupabaseAdminClient();

  const result = await runLushaPhoneFallbackReveal(
    {
      candidateId: args.candidateId,
      // La confirmación humana ya ocurrió: es lo que creó la corrida, con el tope
      // que el operador aceptó (13 cuando Lusha es posible). El core del fallback
      // revalida que ese tope cubra su propio mínimo de 5 créditos.
      confirmCost: true,
      expectedMaxCredits: args.maxCreditsAuthorized,
    },
    {
      flagEnabled: isLushaPhoneRevealFallbackEnabled(),
      actor: { internalUserId: args.authorizedBy, roleKey: 'admin' },
      nowIso: new Date().toISOString(),
      waterfallMode: true,
      phoneRevealWaterfallId: args.runId,

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
          return { ok: false, errorMessage: 'Lusha API key not configured' };
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
    loadCandidate: loadCandidateForWaterfall,
    findActiveRun: findActiveWaterfallRunForCandidate,
    createRun: createWaterfallRun,
  };
}

/**
 * Deps del arranque de una corrida LEGACY (AGENT2A-PHONE-WATERFALL-2). Se cablea
 * desde la server action legacy, que es el único punto con un humano autenticado.
 * NO incluye ninguna dependencia de Apollo: no hay nada que llamar.
 */
export function buildStartLegacyWaterfallDeps(actor: {
  internalUserId: string;
  roleKey: string | null;
}): StartLegacyPhoneRevealWaterfallDeps {
  return {
    flagEnabled: isPhoneRevealWaterfallEnabled(),
    actor,
    nowIso: new Date().toISOString(),
    loadLegacyEvidence: loadLegacyEvidenceForWaterfall,
    findActiveRun: findActiveWaterfallRunForCandidate,
    findLatestRun: findLatestWaterfallRunForCandidate,
    createRun: createWaterfallRun,
  };
}

/**
 * Deps de la continuación. Se cablea desde el webhook de Apollo y desde el
 * recovery (cron L2 / revisión manual L3). NO hay actor de sesión: el actor es
 * `authorized_by` de la propia corrida.
 */
export function buildContinueWaterfallDeps(): ContinuePhoneRevealWaterfallDeps {
  return {
    flagEnabled: isPhoneRevealWaterfallEnabled(),
    // El fallback Lusha sigue siendo el kill switch real de cualquier reveal
    // Lusha: el flag del waterfall solo automatiza CUÁNDO corre, no lo autoriza.
    lushaFallbackFlagEnabled: isLushaPhoneRevealFallbackEnabled(),
    nowIso: new Date().toISOString(),
    findActiveRun: findActiveWaterfallRunForCandidate,
    loadCandidate: loadCandidateForWaterfall,
    updateRun: updateWaterfallRun,
    checkSuppressionAndDoNotContact,
    claimLushaAttempt,
    callLushaLeg: callLushaFallbackLeg,
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
      buildContinueWaterfallDeps(),
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
  /** Tope que quedó autorizado (5). `null` cuando no se creó corrida. */
  maxCreditsAuthorized: number | null;
  /** true SOLO si se llegó a llamar a Lusha. */
  lushaCalled: boolean;
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
export async function startLegacyPhoneRevealWaterfallForCandidate(
  candidateId: string,
  actor: { internalUserId: string; roleKey: string | null },
): Promise<StartLegacyPhoneRevealWaterfallRuntimeResult> {
  // Fail-closed: si el store no está disponible (p. ej. las migraciones 102/103 aún
  // no aplicadas en ese entorno) NO se crea corrida y, por tanto, no se llama a
  // Lusha. Solo el mensaje mecánico del driver, sin PII.
  let started: Awaited<ReturnType<typeof startLegacyPhoneRevealWaterfall>>;
  try {
    started = await startLegacyPhoneRevealWaterfall(
      { candidateId },
      buildStartLegacyWaterfallDeps(actor),
    );
  } catch (err) {
    console.error(
      '[phone-reveal-waterfall] legacy run creation failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    return {
      outcome: 'not_started',
      reason: 'legacy_run_creation_failed',
      maxCreditsAuthorized: null,
      lushaCalled: false,
    };
  }

  if (!started.started) {
    return {
      outcome: 'not_started',
      reason: started.reason satisfies PhoneRevealWaterfallLegacyIneligibleReason,
      maxCreditsAuthorized: null,
      lushaCalled: false,
    };
  }

  // `apolloCostCredits` se OMITE deliberadamente: presente (incluso como null)
  // escribiría las columnas de costo de Apollo, y el costo histórico pertenece a la
  // autorización que realmente lo pagó. La fila ya nació con null + unknown.
  const continued = await continuePhoneRevealWaterfallForCandidate({
    candidateId,
    // Desenlace histórico ya demostrado, no fabricado.
    apolloOutcome: 'no_phone_found',
  });

  return {
    outcome: continued.outcome,
    reason: continued.reason,
    maxCreditsAuthorized: started.maxCreditsAuthorized,
    lushaCalled: continued.lushaCalled,
  };
}
