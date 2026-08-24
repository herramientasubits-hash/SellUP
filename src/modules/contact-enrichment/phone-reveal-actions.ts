'use server';

// Agente 2A — Apollo Phone Reveal: Server Action wrapper (APOLLO-PHONE-ASYNC-1)
//
// Thin 'use server' wrapper that wires real dependencies into the pure START
// core (phone-reveal-core.ts): the flag, the authenticated actor + role, the
// public webhook URL (env), the candidate load, the do-not-contact check, the
// single Apollo async-start call, the service-role persistence write and the
// PII-free usage log. All validation and decision logic live in the core so
// this file stays declarative.
//
// ASYNC contract (confirmed): Apollo phone reveal is asynchronous. This action
// does NOT return a phone: it STARTS the reveal (Apollo requires a webhook_url
// and returns only a request_id), persists a `requested` state and returns
// `requested` to the UI. The phone arrives later on the webhook
// (src/app/api/integrations/apollo/phone-reveal/webhook) which flips the
// candidate to `revealed` / `no_phone_found`.
//
// Gated behind ENABLE_APOLLO_PHONE_REVEAL, which is OFF in every environment as
// of this milestone: with the flag off the core short-circuits to `disabled`
// before touching auth, Apollo or the DB. If APOLLO_PHONE_REVEAL_WEBHOOK_URL is
// missing the core returns `provider_not_configured` before any Apollo call.
// This milestone does NOT activate the flag and makes NO real provider calls in
// tests. Apollo only — never Lusha, never HubSpot; the action neither creates an
// official contact nor approves the candidate.

import { redirect } from 'next/navigation';
import { readPhoneRevealSuppression } from './provider-suppression-store';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import {
  isApolloPhoneCacheEnabled,
  isApolloPhoneRevealEnabled,
  isPhoneRevealWaterfallEnabled,
} from '@/lib/feature-flags.server';
import { startApolloPhoneReveal } from '@/server/integrations/apollo-client';
import { sanitizeApolloErrorMessage } from './apollo-error-hint';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  hashProviderPersonId,
  readPhoneCacheEntry,
  touchPhoneCacheEntry,
} from './phone-cache-store';
import type { PhoneCacheHitUsageLogEntry } from './phone-cache-core';
import {
  redactDriverMessage,
  runRevealCandidatePhone,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneResult,
  type RevealCandidateRecord,
  type ApolloPhoneRevealStartCallResult,
  type RevealCacheHitPersistencePatch,
  type RevealStartPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from './phone-reveal-core';
import {
  mapApolloStartStatusToWaterfallPatch,
  startPhoneRevealWaterfall,
} from './phone-reveal-waterfall-core';
import {
  buildStartWaterfallDeps,
  updateWaterfallRun,
} from './phone-reveal-waterfall-deps';
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';

// Env con la URL pública del webhook async de Apollo (sin NEXT_PUBLIC). No se
// exporta: este archivo es 'use server' y solo puede exportar async actions.
const APOLLO_PHONE_REVEAL_WEBHOOK_URL_ENV = 'APOLLO_PHONE_REVEAL_WEBHOOK_URL';

// ── Auth + rol del actor ──────────────────────────────────────

/** Cliente service_role para mutar staging (mismo patrón que candidate-review). */
function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

/** Resuelve la URL pública del webhook desde env (sin exponerla al cliente). */
function resolveWebhookUrl(): string | null {
  const raw = process.env[APOLLO_PHONE_REVEAL_WEBHOOK_URL_ENV];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * Resuelve el usuario interno activo y su role key. Redirige a /login si no hay
 * usuario. El role key alimenta el gate de rol del core (admin /
 * commercial_manager). No hay fallback dev que salte el rol: un actor sin rol
 * conocido queda no autorizado en el core.
 */
async function resolveActorForReveal(): Promise<{
  internalUserId: string;
  roleKey: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');

  let roleKey: string | null = null;
  if (internalUser.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();
    roleKey = typeof role?.key === 'string' ? role.key : null;
  }

  return { internalUserId: internalUser.id, roleKey };
}

// ── Carga del candidato ────────────────────────────────────────

// `apollo_person_id` (mig. 098) y los dos campos de país alimentan el fast path
// de caché (APOLLO-PHONE-CACHE-1b). Se leen siempre: son datos que ya estaban en
// la fila, y con el flag de caché apagado el core simplemente no los usa.
const REVEAL_CANDIDATE_SELECT = `id, source, source_contact_id, email, linkedin_url,
   first_name, last_name, phone, enrichment_metadata, phone_reveal_status,
   phone_reveal_attempt_count, apollo_person_id, country,
   run:contact_enrichment_runs ( account_id, company_name, company_country_code )`;

function mapRevealCandidate(row: unknown): RevealCandidateRecord {
  const r = row as Record<string, unknown>;
  const runRaw = r.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | {
        account_id: string | null;
        company_name: string | null;
        company_country_code: string | null;
      }
    | null
    | undefined;
  return {
    id: r.id as string,
    accountId: run?.account_id ?? null,
    // Origen del candidato: gate anti-contaminación del Apollo id (sólo 'apollo'
    // reenvía source_contact_id como Apollo person id; Lusha/otros lo omiten).
    source: (r.source as ContactSource | null) ?? null,
    sourceContactId: (r.source_contact_id as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    linkedinUrl: (r.linkedin_url as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    organizationName: run?.company_name ?? null,
    existingPhone: (r.phone as string | null) ?? null,
    enrichmentMetadata:
      (r.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
    phoneRevealStatus: (r.phone_reveal_status as string | null) ?? null,
    phoneRevealAttemptCount:
      typeof r.phone_reveal_attempt_count === 'number'
        ? r.phone_reveal_attempt_count
        : 0,
    // Clave y alcance del fast path de caché (APOLLO-PHONE-CACHE-1b). Inertes
    // mientras ENABLE_APOLLO_PHONE_CACHE esté apagado.
    apolloPersonId: (r.apollo_person_id as string | null) ?? null,
    candidateCountry: (r.country as string | null) ?? null,
    runCompanyCountryCode: run?.company_country_code ?? null,
  };
}

// ── Normalización del error Apollo (sin PII) ───────────────────

function safeApolloErrorCode(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'apollo_reveal_start_failed';
  // Solo códigos cortos/mecánicos (p.ej. HTTP_422). Nada de mensajes libres.
  const code = raw.trim().slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(code) ? code : 'apollo_reveal_start_failed';
}

// ── Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1) ───────

/**
 * Resultado del gate del waterfall que corre ANTES del START de Apollo.
 *
 * `no_waterfall` es "no hay corrida que abrir" — una decisión, no un fallo — y el
 * reveal Apollo legacy continúa. `infrastructure_unavailable` es "el waterfall SÍ
 * se pidió y NO se pudo registrar", y detiene la operación completa.
 */
type PhoneRevealWaterfallStartGate =
  | { kind: 'no_waterfall' }
  | { kind: 'started'; runId: string }
  | { kind: 'infrastructure_unavailable'; errorCode: string }
  /**
   * AGENT2A-PHONE-WATERFALL-4D: algún pozo no cubre su pata. El core lo detectó ANTES
   * del INSERT y ANTES de reservar, así que no hay corrida ni exposición que liberar.
   */
  | { kind: 'insufficient_credits' }
  /**
   * AGENT2A-PHONE-WATERFALL-4E: algún proveedor exigido no tiene regla de crédito, así
   * que no hay disponibilidad que reservar. Mismas garantías de cero efectos.
   */
  | { kind: 'budget_not_configured' }
  /** El presupuesto no se pudo verificar. Fail-closed, mismas garantías de cero efectos. */
  | { kind: 'credit_balance_unavailable' }
  /**
   * AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2: el tope que el operador ACEPTÓ es
   * menor que el que la modalidad real exige. El core lo detectó DESPUÉS de resolver la
   * modalidad y ANTES del preflight de presupuesto y de la transacción de reserva, así
   * que no hay corrida, ni exposición, ni proveedor que deshacer.
   */
  | {
      kind: 'authorization_ceiling_mismatch';
      requiredMaxCredits: number | null;
      acceptedMaxCredits: number | null;
    };

/**
 * Código PII-free que viaja al resultado y al log cuando la corrida no se pudo
 * registrar. Deliberadamente genérico: el detalle mecánico del driver va al log
 * del servidor, no al cliente.
 */
const WATERFALL_RUN_UNAVAILABLE_ERROR_CODE = 'waterfall_run_unavailable';

/**
 * Abre la corrida del waterfall ANTES del START de Apollo
 * (AGENT2A-PHONE-WATERFALL-2A).
 *
 * La corrida es PRECONDICIÓN de ejecutar proveedores cuando el waterfall está
 * activo: con `ENABLE_PHONE_REVEAL_WATERFALL` encendido, el administrador autorizó
 * un waterfall AUDITADO, así que si su corrida no se puede crear no debe correr
 * ningún proveedor. Antes esto era best-effort y el reveal Apollo continuaba por la
 * ruta legacy; ese comportamiento no estaba aprobado y es lo que este gate corrige.
 *
 * Se distingue con precisión entre dos cosas que antes se colapsaban en `null`:
 *
 *   * WATERFALL NO SOLICITADO / NO APLICABLE ⇒ `no_waterfall`, y el reveal Apollo
 *     legacy sigue exactamente como antes de este hito:
 *       - flag apagado (ni se resuelve el resto);
 *       - rol no autorizado — un actor SIN permiso de revelar teléfono nunca
 *         alcanza la 2ª pata; el gate de rol corre en el core ANTES de tocar
 *         infraestructura, así que tampoco consulta la tabla 102. Un
 *         `commercial_manager` SÍ está autorizado desde
 *         AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: el rol dejó de decidir QUÉ
 *         flujo corre;
 *       - candidato inválido o inexistente — el propio core de Apollo los rechaza
 *         sin llamar al proveedor, y el operador debe ver ESE motivo, no un fallo
 *         de auditoría;
 *       - ya existe una autorización viva (`active_run_exists`) o el índice único
 *         parcial rechazó el INSERT (`create_conflict`, Postgres 23505): en los dos
 *         casos la corrida SÍ está registrada, es de otra autorización, y el reveal
 *         Apollo responderá `already_pending`.
 *
 *   * WATERFALL SOLICITADO Y NO INICIADO ⇒ `infrastructure_unavailable`. Cubre
 *     CUALQUIER fallo que impida crear la corrida (tabla 102 ausente con `42P01` o
 *     `PGRST205`, timeout `57014`, credenciales, un INSERT que no devuelve id…). La
 *     garantía NO depende de reconocer un código de Postgres concreto: se derrota
 *     por excepción, así que un error nuevo o desconocido también cierra el paso.
 *
 * El carácter best-effort se conserva donde sí corresponde — reconciliación,
 * webhook y recovery — porque allí un fallo de auditoría no puede convertir un
 * callback correcto en 5xx. Aquí no: aquí todavía no se ha gastado nada.
 */
async function startWaterfallRunOrBlock(
  candidateId: string,
  actor: { internalUserId: string; roleKey: string | null },
  /**
   * Tope que el operador aceptó en la UI, TAL CUAL llegó del cliente. Viaja hasta aquí
   * porque el techo humano tiene que compararse contra la modalidad real ANTES de
   * reservar, y la modalidad solo se conoce dentro del arranque
   * (AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2).
   */
  acceptedMaxCredits: number | undefined,
): Promise<PhoneRevealWaterfallStartGate> {
  if (!isPhoneRevealWaterfallEnabled()) return { kind: 'no_waterfall' };

  let started: Awaited<ReturnType<typeof startPhoneRevealWaterfall>>;
  try {
    started = await startPhoneRevealWaterfall(
      { candidateId, acceptedMaxCredits },
      buildStartWaterfallDeps(actor),
    );
  } catch (err) {
    // Observabilidad sin PII: solo el mensaje mecánico del driver, ya redactado.
    console.error(
      '[phone-reveal-waterfall] run creation failed, aborting before any provider:',
      redactDriverMessage(err),
    );
    return {
      kind: 'infrastructure_unavailable',
      errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
    };
  }

  if (started.started) return { kind: 'started', runId: started.runId };

  switch (started.reason) {
    case 'feature_disabled':
    case 'role_not_allowed':
    case 'invalid_candidate':
    case 'candidate_not_found':
    case 'active_run_exists':
    case 'create_conflict':
      return { kind: 'no_waterfall' };
    // AGENT2A-PHONE-WATERFALL-4D. NO son `no_waterfall`: dejar continuar el reveal
    // Apollo legacy sería gastar exactamente los créditos que el preflight acaba de
    // declarar indisponibles.
    case 'insufficient_credits':
      return { kind: 'insufficient_credits' };
    case 'budget_not_configured':
      return { kind: 'budget_not_configured' };
    case 'credit_balance_unavailable':
      return { kind: 'credit_balance_unavailable' };
    // AGENT2A-PHONE-WATERFALL-4F. El saldo se verificó bien; lo que no se pudo fue
    // ESCRIBIR la reserva y la corrida (la migración 104 no está aplicada, timeout,
    // credenciales…). Es exactamente el mismo caso que la tabla 102 ausente —el
    // waterfall se autorizó y su corrida no existe— así que se trata igual: se corta
    // antes de cualquier proveedor y el operador lee un fallo de infraestructura, no
    // uno de saldo que no tuvo.
    case 'run_creation_unavailable':
      return {
        kind: 'infrastructure_unavailable',
        errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
      };
    // AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2. NO es `no_waterfall`: dejar caer el
    // reveal Apollo legacy convertiría exactamente el bug que se está cerrando —el
    // operador autorizó 8, la modalidad real vale 14— en un gasto de 8 que tampoco pidió
    // bajo esa lectura. La autorización obsoleta se vuelve a pedir; no se reinterpreta.
    case 'authorization_ceiling_mismatch':
      return {
        kind: 'authorization_ceiling_mismatch',
        requiredMaxCredits: started.requiredMaxCredits ?? null,
        acceptedMaxCredits: started.acceptedMaxCredits ?? null,
      };
    default: {
      // Un motivo NUEVO rompe la compilación aquí a propósito: decidir si una
      // razón inédita puede seguir gastando proveedores es una decisión de
      // producto, no un default silencioso. En runtime, fail-closed.
      const exhaustive: never = started.reason;
      console.error(
        '[phone-reveal-waterfall] unhandled start reason, aborting before any provider:',
        String(exhaustive),
      );
      return {
        kind: 'infrastructure_unavailable',
        errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
      };
    }
  }
}

/**
 * Reconcilia la corrida con el resultado del START de Apollo, BEST-EFFORT.
 *
 * `requested` (camino feliz asíncrono) no toca nada: la corrida sigue
 * `apollo_in_flight` y la cerrarán el webhook o el recovery. Cualquier otro status
 * la cierra ya — incluido un hit de caché (terminal e inmediato) y cualquier gate
 * que impidió llamar a Apollo — para que no quede una corrida activa ocupando el
 * índice único parcial y bloqueando un intento posterior legítimo.
 */
async function reconcileWaterfallAfterApolloStart(
  runId: string,
  apolloStartStatus: string,
): Promise<void> {
  const patch = mapApolloStartStatusToWaterfallPatch(
    apolloStartStatus,
    new Date().toISOString(),
  );
  if (!patch) return;
  try {
    await updateWaterfallRun(runId, patch);
  } catch (err) {
    console.error(
      '[phone-reveal-waterfall] run reconciliation failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}

// ── Server Action ──────────────────────────────────────────────

/**
 * INICIA el reveal asíncrono de teléfono de UN candidato vía Apollo, de forma
 * explícita, confirmada y auditada. Individual (no bulk), no automática, detrás
 * de ENABLE_APOLLO_PHONE_REVEAL. Devuelve un resultado seguro para la UI (sin
 * PII): en el camino feliz devuelve `requested` (solicitud aceptada, esperando
 * el webhook); el teléfono NO viaja en el resultado.
 */
export async function revealCandidatePhoneAction(
  input: RevealCandidatePhoneInput,
): Promise<RevealCandidatePhoneResult> {
  // Con el flag apagado no resolvemos actor ni tocamos DB: el core corta antes.
  const flagEnabled = isApolloPhoneRevealEnabled();
  if (!flagEnabled) {
    return runRevealCandidatePhone(input, {
      flagEnabled: false,
      actor: { internalUserId: '', roleKey: null },
      nowIso: new Date().toISOString(),
      webhookUrl: null,
      loadCandidate: async () => null,
      isDoNotContact: async () => false,
      startRevealViaApollo: async () => ({ ok: false, errorCode: 'disabled' }),
      persist: async () => {},
      logUsage: async () => {},
    });
  }

  const actor = await resolveActorForReveal();
  const supabase = await createClient();
  const admin = getServiceRoleClient();

  // Waterfall Apollo → Lusha: la corrida se abre ANTES del START para que el
  // webhook (que puede llegar en segundos) encuentre siempre la autorización, y
  // para que el usage-log del START ya lleve `phone_reveal_waterfall_id`. Con el
  // flag apagado o un rol no admin no hay corrida y todo queda como antes.
  const waterfallGate = await startWaterfallRunOrBlock(
    input.candidateId,
    actor,
    input.expectedMaxCredits,
  );

  // AGENT2A-PHONE-WATERFALL-2A: el waterfall se pidió y su corrida no se pudo
  // registrar ⇒ se corta AQUÍ, antes de `runRevealCandidatePhone`, que es el único
  // punto que llama a Apollo y el único que escribe un usage-log. Por construcción:
  // 0 llamadas a Apollo, 0 llamadas a Lusha, 0 usage-logs, ninguna corrida parcial
  // y 0 créditos. No se finge que Apollo se intentó y no se devuelve `ok: true`.
  if (waterfallGate.kind === 'infrastructure_unavailable') {
    return {
      ok: false,
      status: 'waterfall_infrastructure_unavailable',
      requestAccepted: false,
      errorCode: waterfallGate.errorCode,
    };
  }

  // AGENT2A-PHONE-WATERFALL-4D: el preflight de saldo cortó ANTES del INSERT de la
  // corrida, así que también corta antes de `runRevealCandidatePhone`, que es el
  // único punto que llama a Apollo y el único que escribe un usage-log. Por
  // construcción: 0 corridas, 0 llamadas a proveedor, 0 usage-logs y 0 créditos.
  if (waterfallGate.kind === 'insufficient_credits') {
    return {
      ok: false,
      status: 'insufficient_credits',
      requestAccepted: false,
      errorCode: 'insufficient_credits',
    };
  }
  // AGENT2A-PHONE-WATERFALL-4E: sin regla de crédito no hay disponibilidad que reservar,
  // así que no se ejecuta ningún proveedor. Es un motivo PROPIO y no un
  // `insufficient_credits`: decirle al operador que faltan créditos cuando lo que falta
  // es la configuración del presupuesto lo manda a pedir créditos que no resolverán nada.
  if (waterfallGate.kind === 'budget_not_configured') {
    return {
      ok: false,
      status: 'budget_not_configured',
      requestAccepted: false,
      errorCode: 'budget_not_configured',
    };
  }
  if (waterfallGate.kind === 'credit_balance_unavailable') {
    return {
      ok: false,
      status: 'credit_balance_unavailable',
      requestAccepted: false,
      errorCode: 'credit_balance_unavailable',
    };
  }
  // AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2: el techo que el operador vio y aceptó
  // no cubre lo que esta modalidad exige. El core cortó ANTES del preflight de
  // presupuesto y ANTES de `reserve_and_create_phone_reveal_run`, y este `return` va
  // ANTES de `runRevealCandidatePhone`, que es el único punto que llama a Apollo y el
  // único que escribe un usage-log. Por construcción: 0 reservas, 0 corridas, 0 llamadas
  // a Apollo, 0 llamadas a Lusha, 0 usage-logs y 0 créditos.
  //
  // Los dos enteros van al log del servidor, no al cliente: la UI no necesita el número
  // para actuar —recarga su vista previa, que es la autoridad— y así no puede acabar
  // reenviando un tope que le dictó una respuesta de error.
  if (waterfallGate.kind === 'authorization_ceiling_mismatch') {
    console.warn(
      '[phone-reveal-waterfall] authorization ceiling mismatch, aborting before any reservation:',
      `required=${waterfallGate.requiredMaxCredits ?? 'unknown'}`,
      `accepted=${waterfallGate.acceptedMaxCredits ?? 'unknown'}`,
    );
    return {
      ok: false,
      status: 'authorization_ceiling_mismatch',
      requestAccepted: false,
      errorCode: 'authorization_ceiling_mismatch',
    };
  }

  const waterfallRunId =
    waterfallGate.kind === 'started' ? waterfallGate.runId : null;

  const result = await runRevealCandidatePhone(input, {
    flagEnabled: true,
    actor,
    nowIso: new Date().toISOString(),
    webhookUrl: resolveWebhookUrl(),
    // Solo alimenta la metadata del usage-log del START: no cambia ningún gate.
    phoneRevealWaterfallId: waterfallRunId,

    loadCandidate: async (candidateId): Promise<RevealCandidateRecord | null> => {
      const { data, error } = await supabase
        .from('contact_enrichment_candidates')
        .select(REVEAL_CANDIDATE_SELECT)
        .eq('id', candidateId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapRevealCandidate(data) : null;
    },

    isDoNotContact: async (candidate): Promise<boolean> => {
      // Detección fiable solo cuando hay cuenta + identidad (email/linkedin).
      // Sin cuenta (HubSpot-only/manual) no hay forma segura → no bloquea.
      const accountId = candidate.accountId;
      if (!accountId) return false;
      const identifiers: string[] = [];
      if (candidate.email) identifiers.push(candidate.email);
      if (candidate.linkedinUrl) identifiers.push(candidate.linkedinUrl);
      if (identifiers.length === 0) return false;

      const { data, error } = await supabase
        .from('contacts')
        .select('id, email, linkedin_url, contact_status')
        .eq('account_id', accountId)
        .eq('contact_status', 'do_not_contact');
      if (error) throw new Error(error.message);

      const email = candidate.email?.toLowerCase() ?? null;
      const linkedin = candidate.linkedinUrl?.toLowerCase() ?? null;
      return (data ?? []).some((c) => {
        const cEmail =
          typeof c.email === 'string' ? c.email.toLowerCase() : null;
        const cLinkedin =
          typeof c.linkedin_url === 'string' ? c.linkedin_url.toLowerCase() : null;
        return (
          (email !== null && cEmail === email) ||
          (linkedin !== null && cLinkedin === linkedin)
        );
      });
    },

    startRevealViaApollo: async (
      params,
    ): Promise<ApolloPhoneRevealStartCallResult> => {
      const result = await startApolloPhoneReveal(params);
      if (!result.success) {
        // errorCode: mecánico (HTTP_422) → columna del candidato.
        // errorHint: razón sanitizada del body → solo usage-log (sin PII/secretos).
        return {
          ok: false,
          errorCode: safeApolloErrorCode(result.error?.error),
          errorHint: sanitizeApolloErrorMessage(result.error?.message),
          trace: result.trace ?? null,
        };
      }
      // HTTP 200: handle async (phone_enrichment.request_id) o, si no se creó job,
      // el código específico (no_async_job_created / skipped_without_request_id).
      // La traza técnica (sin PII) va al usage-log.
      return {
        ok: true,
        requestId: result.requestId ?? null,
        noAsyncJobCode: result.noAsyncJobCode ?? null,
        trace: result.trace ?? null,
      };
    },

    persist: async (
      candidateId,
      patch: RevealStartPersistencePatch,
    ): Promise<void> => {
      const update: Record<string, unknown> = {
        phone_reveal_status: patch.phone_reveal_status,
        phone_reveal_request_id: patch.phone_reveal_request_id,
        phone_reveal_requested_at: patch.phone_reveal_requested_at,
        phone_reveal_completed_at: patch.phone_reveal_completed_at,
        phone_revealed_by: patch.phone_revealed_by,
        phone_reveal_provider: patch.phone_reveal_provider,
        phone_reveal_cost_credits: patch.phone_reveal_cost_credits,
        phone_reveal_cost_usd: patch.phone_reveal_cost_usd,
        phone_reveal_error_code: patch.phone_reveal_error_code,
        phone_reveal_attempt_count: patch.phone_reveal_attempt_count,
        phone_processing_basis: patch.phone_processing_basis,
        phone_processing_basis_note: patch.phone_processing_basis_note,
      };
      // Apollo person id (APOLLO-PHONE-CACHE-1a): sólo se escribe cuando el core
      // resolvió un id Apollo válido. Nunca sobrescribe uno previo con null/inválido.
      if (patch.apollo_person_id) {
        update.apollo_person_id = patch.apollo_person_id;
      }
      const { error } = await admin
        .from('contact_enrichment_candidates')
        .update(update)
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    },

    logUsage: async (entry: PhoneRevealUsageLogEntry): Promise<void> => {
      await logProviderUsage({
        provider_key: entry.provider,
        operation_key: entry.operationKey,
        credits_used: entry.creditsUsed ?? undefined,
        estimated_cost_usd: entry.costUsd,
        status: entry.status,
        error_code: entry.errorCode ?? undefined,
        triggered_by: entry.triggeredBy,
        results_returned: 0,
        metadata: entry.metadata,
      });
    },

    // ── Cumplimiento de supresión (FIX 2) ──────────────────────
    // Se cablea SIEMPRE, fuera del flag: `ENABLE_APOLLO_PHONE_CACHE` decide si se
    // REUTILIZA un teléfono ya pagado, no si se respeta una supresión registrada.
    // La lectura pide solo `suppressed_at`, así que con el flag apagado se
    // comprueba el tombstone sin leer ningún teléfono. Requiere la migración 099
    // aplicada: sin la tabla, la comprobación falla y el reveal se detiene
    // (fail-closed, 0 créditos) en vez de saltarse la supresión.
    lookupPhoneCacheSuppression: readPhoneRevealSuppression,
    onSuppressionCheckUnavailable: (message: string): void => {
      console.error('[phone-cache] suppression check unavailable:', message);
    },
    // FIX 4: sin Apollo person id resoluble (o sin cuenta) la supresión NO se
    // puede evaluar, y el caso se registra para que sea visible. El evento tiene
    // forma cerrada y sin PII: fase, estado, candidato y cuenta.
    //
    // P0 (AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1, PR #289): el reveal NO continúa.
    // Hasta ese hito este comentario decía que sí, y era cierto entonces; desde el
    // hito el core devuelve `suppression_check_unavailable` y se detiene sin llamar
    // al proveedor (0 créditos). Sigue sin emparejarse por teléfono/email/nombre/
    // LinkedIn ni rellenarse el id que falta: eso seguiría siendo inferencia. Este
    // sumidero solo AUDITA — no decide nada.
    onSuppressionNotEvaluable: (event): void => {
      console.warn('[phone-cache] suppression not evaluable:', event);
    },

    // ── Fast path de caché (APOLLO-PHONE-CACHE-1b) ─────────────
    // Con ENABLE_APOLLO_PHONE_CACHE apagado (default de producción) el core no
    // invoca ninguna de estas deps: cero reutilización de teléfonos, cero
    // escrituras de caché, y el camino Apollo queda como antes de este hito.
    cacheEnabled: isApolloPhoneCacheEnabled(),
    hashProviderPersonId,
    lookupPhoneCache: readPhoneCacheEntry,
    touchPhoneCacheEntry,

    // FIX H4: un fallo de la búsqueda en caché se registra con el mensaje del
    // driver y NADA más — sin teléfono, sin id de persona, sin datos del
    // contacto. El core ya devolvió `cache_unavailable` sin llamar a Apollo.
    onCacheLookupUnavailable: (message: string): void => {
      console.error('[phone-cache] cache lookup unavailable:', message);
    },

    // FIX H4-b: los efectos posteriores al hit no pueden tumbar la acción. El
    // core ya devolvió un estado seguro (o mantuvo el hit) y entrega un mensaje
    // mecánico YA redactado — nunca el error crudo del driver, que puede citar el
    // teléfono o el id de persona del payload.
    onCacheHitPersistFailed: (message: string): void => {
      console.error('[phone-cache] cache hit persistence failed:', message);
    },
    onCacheHitUsageLogFailed: (message: string): void => {
      console.error('[phone-cache] cache hit usage log failed:', message);
    },

    persistCacheHit: async (
      candidateId,
      patch: RevealCacheHitPersistencePatch,
    ): Promise<void> => {
      const { error } = await admin
        .from('contact_enrichment_candidates')
        .update({
          phone: patch.phone,
          enrichment_metadata: patch.enrichment_metadata,
          phone_reveal_status: patch.phone_reveal_status,
          phone_reveal_provider: patch.phone_reveal_provider,
          phone_reveal_request_id: patch.phone_reveal_request_id,
          phone_revealed_at: patch.phone_revealed_at,
          phone_reveal_completed_at: patch.phone_reveal_completed_at,
          phone_revealed_by: patch.phone_revealed_by,
          phone_reveal_cost_credits: patch.phone_reveal_cost_credits,
          phone_reveal_cost_usd: patch.phone_reveal_cost_usd,
          phone_reveal_error_code: patch.phone_reveal_error_code,
          phone_reveal_attempt_count: patch.phone_reveal_attempt_count,
          phone_processing_basis: patch.phone_processing_basis,
          phone_processing_basis_note: patch.phone_processing_basis_note,
          apollo_person_id: patch.apollo_person_id,
        })
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    },

    logCacheHitUsage: async (entry: PhoneCacheHitUsageLogEntry): Promise<void> => {
      await logProviderUsage({
        provider_key: entry.provider,
        // operation_key propio: NUNCA se mezcla con person_phone_reveal ni con
        // organizations_search. credits_used = 0 porque no hubo llamada.
        operation_key: entry.operationKey,
        credits_used: entry.creditsUsed,
        estimated_cost_usd: entry.costUsd,
        status: entry.status,
        triggered_by: entry.triggeredBy,
        results_returned: 1,
        metadata: entry.metadata,
      });
    },
  });

  // Reconciliación del waterfall: solo cuando se abrió una corrida. `requested`
  // la deja en vuelo; cualquier otro desenlace del START la cierra ya.
  if (waterfallRunId) {
    await reconcileWaterfallAfterApolloStart(waterfallRunId, result.status);
  }

  return result;
}
