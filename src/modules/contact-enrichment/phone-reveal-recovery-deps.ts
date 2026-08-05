// Agente 2A — Apollo Phone Reveal: dependencias REALES del recovery core
// (APOLLO-PHONE-RECOVERY-CRON-1)
//
// Cableado server-only del recovery core (phone-reveal-recovery-core.ts). Se
// extrajo 1:1 de phone-reveal-recovery-actions.ts para que lo compartan los DOS
// disparadores del recovery sin duplicar I/O:
//   1. La Server Action ADMIN-only (phone-reveal-recovery-actions.ts).
//   2. El cron programado (src/app/api/cron/phone-reveal-recovery/route.ts).
//
// Este módulo NO decide NADA: no aplica gates de rol, ni de secreto, ni de flag,
// ni normaliza caps. Solo provee I/O (Supabase service-role, Apollo GET de
// recuperación, provider_usage_logs, caché/supresión). Toda la lógica de decisión
// sigue viviendo en los cores puros.
//
// NO es 'use server': un módulo 'use server' solo puede exportar async actions, y
// `buildRecoveryCoreDeps` es sincrónico. Es server-only por sus imports (admin
// client + API key de Apollo): nunca se importa desde un componente cliente.
//
// Contrato de seguridad heredado del core: no imprime teléfono / raw_number /
// sanitized_number / email / linkedin / nombre / empresa / API key / token ni el
// payload crudo de Apollo. El recovery LEE un resultado ya producido: no llama a
// /people/match, no crea reveals y no consume créditos nuevos.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  isApolloPhoneCacheEnabled,
  isPhoneRevealWaterfallEnabled,
} from '@/lib/feature-flags.server';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { readPhoneCacheSuppression, writePhoneCacheEntry } from './phone-cache-store';
import {
  continuePhoneRevealWaterfallForCandidate,
  resolveActiveWaterfallRunId,
} from './phone-reveal-waterfall-deps';
import { fetchApolloPhoneRevealWebhookResult } from '@/server/integrations/apollo-client';
import {
  classifyWebhookResultHttpStatus,
  type PollFetchResult,
} from './phone-reveal-poll-core';
import { PHONE_REVEAL_OPERATION_KEY } from './phone-reveal-core';
import type { ApolloPhoneRevealWebhookPayload } from './phone-reveal-webhook-core';
import {
  resolveStaleRecoveryCutoffIso,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
  type StaleRecoveryQuery,
} from './phone-reveal-recovery-core';
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';

// ── Carga del candidato (proyección de recovery) ───────────────

// `apollo_person_id` + los países alimentan la escritura de caché
// (APOLLO-PHONE-CACHE-1b). Inertes con ENABLE_APOLLO_PHONE_CACHE apagado.
// `source_contact_id` añade una vía más para emparejar el tombstone de SUPRESIÓN
// (FIX 3) en candidatos de origen Apollo. Id opaco de correlación, NO PII.
export const RECOVERY_CANDIDATE_SELECT = `id, source, phone, enrichment_metadata,
   phone_reveal_provider, phone_reveal_status, phone_processing_basis,
   apollo_person_id, source_contact_id, country,
   run:contact_enrichment_runs ( account_id, company_country_code )`;

export function mapRecoveryCandidate(
  row: Record<string, unknown>,
): RecoveryCandidateRecord {
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
export async function fetchWebhookResultViaApollo(
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

// ── Selección de reveals stale (query real) ────────────────────

/**
 * Resuelve los ids de candidatos con un reveal Apollo EN VUELO y stale. La
 * selección es deliberadamente estrecha y NO se relaja para el cron:
 *   * `phone_reveal_provider = 'apollo'` (recovery es Apollo-only).
 *   * `phone_reveal_status ∈ (requested, pending)` ⇒ nunca terminales
 *     (revealed / no_phone_found / error quedan fuera).
 *   * `phone_reveal_request_id NOT NULL` ⇒ sin id de correlación no hay nada que
 *     recuperar (el recovery core igualmente exige el recovery id del START log).
 *   * `phone IS NULL` ⇒ si ya hay teléfono no se vuelve a consultar.
 *   * `phone_reveal_requested_at <= now - minAgeMinutes` ⇒ nunca candidatos
 *     recientes: se le da al webhook su ventana antes de hacer poll.
 * Orden FIFO (los más antiguos primero) y `limit` = tope de la corrida.
 */
export async function findStaleApolloPhoneRevealCandidateIds(
  query: StaleRecoveryQuery,
): Promise<string[]> {
  const admin = createSupabaseAdminClient();
  const cutoffIso = resolveStaleRecoveryCutoffIso(query.nowIso, query.minAgeMinutes);
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
}

// ── Deps reales del recovery core (server-only) ────────────────

/**
 * Cablea las dependencias reales del recovery core. Todo el I/O (Supabase
 * service-role, Apollo GET, provider_usage_logs) vive aquí; la API key nunca sale
 * del servidor. El recovery id se resuelve del START log en provider_usage_logs
 * (metadata.apollo_trace.apollo_http_request_id), NUNCA se hardcodea ni se usa
 * phone_enrichment.request_id.
 *
 * `actorUserId` es el id opaco del internal_user que dispara la recuperación, o
 * null cuando el disparador es el cron programado (no hay actor humano). Solo
 * alimenta `triggered_by` del usage-log.
 */
export function buildRecoveryCoreDeps(
  actorUserId: string | null,
): RecoverApolloPhoneRevealDeps {
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
      // Procedencia de la cifra anterior (AGENT2A-PHONE-REVEAL-4N § 6).
      if (patch.phone_reveal_cost_source !== undefined) {
        update.phone_reveal_cost_source = patch.phone_reveal_cost_source;
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
    // FIX 4: la comprobación no se pudo EVALUAR (sin person id resoluble o sin
    // cuenta). No se empareja por otros datos ni se rellena el id que falta; el
    // caso se registra con un evento de forma cerrada y sin PII.
    onSuppressionNotEvaluable: (event) => {
      console.warn(
        '[phone-reveal-recovery] suppression not evaluable:',
        event,
      );
    },

    // Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1). Se cablea SOLO con
    // ENABLE_PHONE_REVEAL_WATERFALL encendido, y cubre de una vez los DOS
    // disparadores que comparten este builder: el cron L2 y la revisión manual L3.
    //
    // Con el flag apagado las deps llegan ausentes y el recovery se comporta
    // exactamente como antes de este hito. La idempotencia entre webhook / cron /
    // L3 la garantiza el claim atómico del core del waterfall: los tres pueden ver
    // el mismo `no_phone_found` y solo uno llamará a Lusha.
    ...(isPhoneRevealWaterfallEnabled()
      ? {
          resolveWaterfallRunId: resolveActiveWaterfallRunId,
          continueWaterfall: continuePhoneRevealWaterfallForCandidate,
        }
      : {}),
  };
}
