'use server';

// Agente 2A — Apollo Phone Reveal: RECOVERY runtime Server Actions
// (APOLLO-PHONE-RECOVERY-RUNTIME-1)
//
// Wrapper 'use server' ADMIN-ONLY que cablea las dependencias reales del recovery
// core ya mergeado (phone-reveal-recovery-core.ts, PR #139) y las ejecuta a través
// del runtime core puro (phone-reveal-recovery-runtime-core.ts). Toda la lógica de
// decisión (gate de rol, dryRun, caps, mapeo a resumen sin PII) vive en los cores;
// este archivo solo resuelve el actor autenticado y provee el I/O real
// (Supabase service-role, Apollo GET de recuperación, provider_usage_logs).
//
// NO existe UI ni cron para estas acciones en este hito: quedan expuestas para un
// paso posterior, autorizado, de recuperación controlada. Recovery NO está gateado
// por ENABLE_APOLLO_PHONE_REVEAL (ese flag solo gobierna el START, que crea
// reveals nuevos). Recovery solo LEE un resultado ya producido por un reveal
// previo autorizado: no llama a /people/match, no crea reveals y no consume
// créditos nuevos.
//
// Seguridad:
//   * ADMIN-only: sesión → internal_user activo → role key === 'admin'. Anónimo
//     redirige a /login; no-admin (seller / commercial_manager / lead) redirige a
//     /settings (fail-closed). El runtime core RE-verifica el rol (defensa en
//     profundidad).
//   * dryRun por defecto true (single y batch). Ejecución real exige dryRun=false.
//   * El resultado devuelto NUNCA incluye teléfono, raw_number, sanitized_number,
//     email, linkedin, nombre, empresa, API key, token ni el payload crudo.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isApolloPhoneCacheEnabled } from '@/lib/feature-flags.server';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { readPhoneCacheSuppression, writePhoneCacheEntry } from './phone-cache-store';
import { fetchApolloPhoneRevealWebhookResult } from '@/server/integrations/apollo-client';
import {
  classifyWebhookResultHttpStatus,
  type PollFetchResult,
} from './phone-reveal-poll-core';
import { PHONE_REVEAL_OPERATION_KEY } from './phone-reveal-core';
import type { ApolloPhoneRevealWebhookPayload } from './phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
  type StaleRecoveryQuery,
} from './phone-reveal-recovery-core';
import {
  runAdminSingleCandidateRecovery,
  runAdminStaleBatchRecovery,
  type RecoveryRuntimeActor,
  type SingleRecoveryRuntimeInput,
  type SingleRecoveryRuntimeResult,
  type BatchRecoveryRuntimeInput,
  type BatchRecoveryRuntimeResult,
} from './phone-reveal-recovery-runtime-core';
import type {
  ContactCandidateEnrichmentMetadata,
  ContactSource,
} from './types';

// ── Auth: ADMIN-only ───────────────────────────────────────────

/**
 * Resuelve el actor admin activo. Redirige a /login si no hay sesión y a
 * /settings si el usuario no es admin (mismo patrón que usage-tracking/actions).
 * Devuelve el actor para el runtime core (que re-verifica el rol). Solo retorna
 * cuando roleKey === 'admin'.
 */
async function requireAdminActor(): Promise<RecoveryRuntimeActor> {
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
  if (!internalUser) redirect('/settings');

  let roleKey: string | null = null;
  if (internalUser.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();
    roleKey = typeof role?.key === 'string' ? role.key : null;
  }
  if (roleKey !== 'admin') redirect('/settings');

  return { internalUserId: internalUser.id as string, roleKey };
}

// ── Carga del candidato (proyección de recovery) ───────────────

// `apollo_person_id` + los países alimentan la escritura de caché
// (APOLLO-PHONE-CACHE-1b). Inertes con ENABLE_APOLLO_PHONE_CACHE apagado.
// `source_contact_id` añade una vía más para emparejar el tombstone de SUPRESIÓN
// (FIX 3) en candidatos de origen Apollo. Id opaco de correlación, NO PII.
const RECOVERY_CANDIDATE_SELECT = `id, source, phone, enrichment_metadata,
   phone_reveal_provider, phone_reveal_status, phone_processing_basis,
   apollo_person_id, source_contact_id, country,
   run:contact_enrichment_runs ( account_id, company_country_code )`;

function mapRecoveryCandidate(row: Record<string, unknown>): RecoveryCandidateRecord {
  const runRaw = row.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { account_id: string | null; company_country_code: string | null }
    | null
    | undefined;
  return {
    id: row.id as string,
    accountId: run?.account_id ?? null,
    phoneRevealProvider: (row.phone_reveal_provider as string | null) ?? null,
    source: (row.source as ContactSource | null) ?? null,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    existingPhone: (row.phone as string | null) ?? null,
    enrichmentMetadata:
      (row.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
    phoneProcessingBasis: (row.phone_processing_basis as string | null) ?? null,
    apolloPersonId: (row.apollo_person_id as string | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
    candidateCountry: (row.country as string | null) ?? null,
    runCompanyCountryCode: run?.company_country_code ?? null,
  };
}

// ── Mapeo del recovery GET a PollFetchResult ───────────────────

/**
 * Ejecuta el GET real de recuperación y lo mapea a PollFetchResult SIN imprimir ni
 * loguear el body. 200 con objeto ⇒ result (el recovery core extrae de forma
 * defensiva los teléfonos); 200 sin cuerpo ⇒ no_result_yet; 404 ⇒ not_found
 * (ambiguo, nunca no_phone_found); 401/403 ⇒ unauthorized (posible falta de scope).
 */
async function fetchWebhookResultViaApollo(
  recoveryRequestId: string,
): Promise<PollFetchResult> {
  const { status, body } = await fetchApolloPhoneRevealWebhookResult(recoveryRequestId);
  switch (classifyWebhookResultHttpStatus(status)) {
    case 'ok':
      return body && typeof body === 'object'
        ? { kind: 'result', payload: body as ApolloPhoneRevealWebhookPayload }
        : { kind: 'no_result_yet' };
    case 'not_found':
      return { kind: 'not_found' };
    case 'unauthorized':
      return { kind: 'unauthorized' };
    case 'error':
    default:
      return { kind: 'error', code: `apollo_webhook_result_http_${status}` };
  }
}

// ── Deps reales del recovery core (server-only) ────────────────

/**
 * Cablea las dependencias reales del recovery core. Todo el I/O (Supabase
 * service-role, Apollo GET, provider_usage_logs) vive aquí; la API key nunca sale
 * del servidor. El recovery id se resuelve del START log en provider_usage_logs
 * (metadata.apollo_trace.apollo_http_request_id), NUNCA se hardcodea ni se usa
 * phone_enrichment.request_id.
 */
function buildRecoveryCoreDeps(actorUserId: string | null): RecoverApolloPhoneRevealDeps {
  const admin = createSupabaseAdminClient();
  return {
    nowIso: new Date().toISOString(),

    loadCandidate: async (candidateId): Promise<RecoveryCandidateRecord | null> => {
      const { data, error } = await admin
        .from('contact_enrichment_candidates')
        .select(RECOVERY_CANDIDATE_SELECT)
        .eq('id', candidateId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapRecoveryCandidate(data as Record<string, unknown>) : null;
    },

    resolveRecoveryRequestId: async (candidateId): Promise<string | null> => {
      // START log del candidato: metadata.reveal_phase='start' con la traza segura
      // apollo_trace.apollo_http_request_id (id de recovery). Se toma el más
      // reciente. NUNCA es phone_enrichment.request_id.
      const { data, error } = await admin
        .from('provider_usage_logs')
        .select('metadata')
        .eq('operation_key', PHONE_REVEAL_OPERATION_KEY)
        .eq('metadata->>candidate_id', candidateId)
        .eq('metadata->>reveal_phase', 'start')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const meta = (data?.metadata as Record<string, unknown> | null) ?? null;
      const trace = (meta?.apollo_trace as Record<string, unknown> | null) ?? null;
      const id = trace?.apollo_http_request_id;
      return typeof id === 'string' && id.trim() ? id.trim() : null;
    },

    fetchWebhookResult: fetchWebhookResultViaApollo,

    persist: async (candidateId, patch: RecoveryPersistencePatch): Promise<void> => {
      const update: Record<string, unknown> = {
        phone_reveal_last_checked_at: patch.phone_reveal_last_checked_at,
      };
      if (patch.phone !== undefined) update.phone = patch.phone;
      if (patch.enrichment_metadata !== undefined) {
        update.enrichment_metadata = patch.enrichment_metadata;
      }
      if (patch.phone_reveal_status !== undefined) {
        update.phone_reveal_status = patch.phone_reveal_status;
      }
      if (patch.phone_reveal_completed_at !== undefined) {
        update.phone_reveal_completed_at = patch.phone_reveal_completed_at;
      }
      if (patch.phone_revealed_at !== undefined) {
        update.phone_revealed_at = patch.phone_revealed_at;
      }
      if (patch.phone_reveal_provider !== undefined) {
        update.phone_reveal_provider = patch.phone_reveal_provider;
      }
      if (patch.phone_reveal_cost_credits !== undefined) {
        update.phone_reveal_cost_credits = patch.phone_reveal_cost_credits;
      }
      if (patch.phone_reveal_error_code !== undefined) {
        update.phone_reveal_error_code = patch.phone_reveal_error_code;
      }
      if (patch.phone_processing_basis !== undefined) {
        update.phone_processing_basis = patch.phone_processing_basis;
      }
      // Apollo person id (APOLLO-PHONE-CACHE-1a): sólo se escribe cuando el core
      // extrajo un id Apollo válido del payload recuperado. Nunca fuerza ni
      // sobrescribe con null/inválido.
      if (patch.apollo_person_id) {
        update.apollo_person_id = patch.apollo_person_id;
      }
      const { error } = await admin
        .from('contact_enrichment_candidates')
        .update(update)
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    },

    logUsage: async (entry: RecoveryUsageLogEntry): Promise<void> => {
      await logProviderUsage({
        provider_key: entry.provider,
        operation_key: entry.operationKey,
        credits_used: entry.creditsUsed ?? undefined,
        status: entry.status,
        error_code: entry.errorCode ?? undefined,
        triggered_by: entry.triggeredBy ?? actorUserId ?? undefined,
        results_returned: entry.metadata.phone_present ? 1 : 0,
        metadata: entry.metadata,
      });
    },

    // Caché del reveal recuperado (APOLLO-PHONE-CACHE-1b). El flag se evalúa
    // aquí; con ENABLE_APOLLO_PHONE_CACHE apagado el store sale inmediatamente
    // sin leer ni escribir. Nunca lanza: la caché no puede romper el recovery.
    cacheRevealedPhone: async (cacheInput) =>
      writePhoneCacheEntry(cacheInput, isApolloPhoneCacheEnabled()),

    // Supresión en vuelo (FIX 3). Sin condicionar al flag de caché: una DSAR
    // registrada entre el START y este poll tiene que bloquear la persistencia
    // tardía del teléfono con la caché encendida o apagada. La lectura pide solo
    // `suppressed_at`, así que con el flag apagado no se lee ningún número. Si
    // LANZA, el core no persiste teléfono y el candidato sigue recuperable.
    lookupPhoneCacheSuppression: readPhoneCacheSuppression,
    onSuppressionCheckUnavailable: (message) => {
      console.error(
        '[phone-reveal-recovery] suppression check unavailable:',
        message,
      );
    },
  };
}

// ── Server Action — Modo 1: recuperación de UN candidato ───────

/**
 * Recupera de forma controlada UN reveal Apollo en vuelo (requested/pending) cuyo
 * webhook nunca llegó. ADMIN-only. dryRun default true (valida y resuelve el
 * recovery id sin consultar Apollo ni escribir). Devuelve un resumen seguro (sin
 * PII). Para escribir de verdad hay que pasar dryRun=false explícito.
 */
export async function recoverCandidatePhoneAction(
  input: SingleRecoveryRuntimeInput,
): Promise<SingleRecoveryRuntimeResult> {
  const actor = await requireAdminActor();
  const deps = buildRecoveryCoreDeps(actor.internalUserId);
  return runAdminSingleCandidateRecovery(input, {
    actor,
    recoverCandidate: (coreInput) =>
      recoverApolloPhoneRevealForCandidate(coreInput, deps),
  });
}

// ── Server Action — Modo 2: recuperación batch de stale ────────

/**
 * Recupera en lote reveals Apollo stale (requested/pending sin webhook). ADMIN-only.
 * dryRun default true, maxCandidates default 5 (hard cap 10), minAgeMinutes default
 * 15 (los caps los aplica el recovery core). NO es cron ni auto-run: un humano
 * admin la dispara. Devuelve solo conteos (sin PII).
 */
export async function recoverStalePhonesAction(
  input: BatchRecoveryRuntimeInput,
): Promise<BatchRecoveryRuntimeResult> {
  const actor = await requireAdminActor();
  const deps = buildRecoveryCoreDeps(actor.internalUserId);
  return runAdminStaleBatchRecovery(input, {
    actor,
    recoverStale: (coreInput) =>
      recoverStaleApolloPhoneRevealRequests(coreInput, {
        nowIso: deps.nowIso,
        findStaleCandidateIds: async (query: StaleRecoveryQuery): Promise<string[]> => {
          const admin = createSupabaseAdminClient();
          const cutoffIso = new Date(
            new Date(query.nowIso).getTime() - query.minAgeMinutes * 60_000,
          ).toISOString();
          const { data, error } = await admin
            .from('contact_enrichment_candidates')
            .select('id')
            .eq('phone_reveal_provider', 'apollo')
            .in('phone_reveal_status', ['requested', 'pending'])
            .not('phone_reveal_request_id', 'is', null)
            .is('phone', null)
            .lte('phone_reveal_requested_at', cutoffIso)
            .order('phone_reveal_requested_at', { ascending: true })
            .limit(query.maxCandidates);
          if (error) throw new Error(error.message);
          return (data ?? [])
            .map((r) => (typeof r.id === 'string' ? r.id : null))
            .filter((id): id is string => id !== null);
        },
        recoverOne: async (candidateId) => {
          const result = await recoverApolloPhoneRevealForCandidate(
            {
              candidateId,
              actorUserId: actor.internalUserId,
              reason: input.reason ?? 'manual_admin_stale_recovery',
            },
            deps,
          );
          return result.outcome;
        },
      }),
  });
}
