import 'server-only';

/**
 * ¿Siguen en la empresa? — cableado de la comprobación automática de los contactos de HubSpot al
 * buscar (CONTACT-CURRENT-EMPLOYMENT-SWEEP-1). Ver hubspot-employment-sweep-core.ts.
 *
 * Gasta con el mismo gobierno que los botones: cuota de Apollo y de Claude en Proveedores, y cada
 * consulta queda en «Uso de IA» a nombre de quien buscó. Nunca escribe en HubSpot. Nunca lanza.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { lookupApolloIdentity } from './candidate-identity-completion-providers.server';
import { runEmploymentAiForCandidate } from './current-employment-ai.server';
import {
  runEmploymentSweep,
  type EmploymentSweepCandidate,
  type EmploymentSweepSummary,
} from './hubspot-employment-sweep-core';

export const EMPLOYMENT_SWEEP_HITO = 'CONTACT-CURRENT-EMPLOYMENT-SWEEP-1';
/** Tiempo para comprobar después de la búsqueda (la ruta tiene 300 s en total). */
const DEFAULT_SWEEP_BUDGET_MS = 120_000;
/** Margen antes del tope de la ruta para la aprobación automática y la respuesta. */
const ROUTE_SAFETY_MARGIN_MS = 45_000;
const ROUTE_MAX_DURATION_MS = 300_000;
/** Por contacto: más corto que el botón, para que una consulta lenta no se coma la tanda. */
const SWEEP_AI_TIMEOUT_MS = 45_000;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapCandidate(row: Record<string, unknown>): EmploymentSweepCandidate {
  const runRaw = row.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as Record<string, unknown> | null | undefined;
  const metadata = row.enrichment_metadata;
  return {
    id: row.id as string,
    email: str(row.email),
    linkedinUrl: str(row.linkedin_url),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    title: str(row.title),
    apolloPersonId: str(row.apollo_person_id),
    companyName: str(run?.company_name),
    companyDomain: str(run?.company_domain),
    enrichmentMetadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {},
  };
}

/** Hasta cuándo se puede comprobar: lo que quede del tope de la ruta, sin pasar del presupuesto. */
export function employmentSweepDeadlineMs(nowMs: number, startedAtMs: number | null, budgetMs = DEFAULT_SWEEP_BUDGET_MS): number {
  const budgetEnd = nowMs + budgetMs;
  if (startedAtMs === null) return budgetEnd;
  return Math.min(budgetEnd, startedAtMs + ROUTE_MAX_DURATION_MS - ROUTE_SAFETY_MARGIN_MS);
}

export async function sweepHubSpotCandidatesEmployment(params: {
  runIds: readonly string[];
  triggeredBy: string | null;
  /** Cuándo empezó la petición (para no pasarse del tope de la ruta). */
  startedAtMs?: number | null;
  /** Tiempo para comprobar; con menos de ~50 s sólo alcanza Apollo (sin IA). */
  budgetMs?: number;
}): Promise<EmploymentSweepSummary | null> {
  if (params.runIds.length === 0) return null;
  const admin = createSupabaseAdminClient();
  try {
    return await runEmploymentSweep({
      async loadCandidates() {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .select(
            `id, email, linkedin_url, first_name, last_name, title, apollo_person_id, enrichment_metadata,
             run:contact_enrichment_runs ( company_name, company_domain )`,
          )
          .in('enrichment_run_id', [...params.runIds])
          .eq('status', 'pending_review')
          .eq('source', 'hubspot');
        if (error) throw new Error(error.message);
        return ((data ?? []) as Record<string, unknown>[]).map(mapCandidate);
      },
      apolloAvailable: async () => (await checkProviderQuotaAvailable('apollo')).allowed,
      lookupApollo: (query) => lookupApolloIdentity(query),
      async logApolloUsage(usage, candidateId, channel) {
        for (const entry of usage) {
          await logProviderUsage({
            provider_key: entry.provider_key,
            operation_key: entry.operation_key,
            ...(entry.credits_used === null ? {} : { credits_used: entry.credits_used }),
            estimated_cost_usd: null,
            results_returned: entry.results_returned,
            status: entry.status,
            ...(entry.error_code ? { error_code: entry.error_code } : {}),
            ...(params.triggeredBy ? { triggered_by: params.triggeredBy } : {}),
            agent_key: 'agent2a',
            agent_step: 'comprobar_empleo',
            // Sin correo ni LinkedIn: datos personales.
            metadata: { entry_mode: 'contact_search_employment_sweep', channel, candidate_id: candidateId, hito: EMPLOYMENT_SWEEP_HITO },
          });
        }
      },
      async persistApollo(candidateId, patch) {
        const update: Record<string, unknown> = { enrichment_metadata: patch.enrichment_metadata };
        if (patch.title) update.title = patch.title;
        const { error } = await admin.from('contact_enrichment_candidates').update(update).eq('id', candidateId);
        if (error) throw new Error(error.message);
        // El id de Apollo aparte: nunca pisa uno que otro proceso guardó entre la lectura y ahora.
        if (patch.apollo_person_id) {
          await admin
            .from('contact_enrichment_candidates')
            .update({ apollo_person_id: patch.apollo_person_id })
            .eq('id', candidateId)
            .is('apollo_person_id', null);
        }
      },
      async verifyWithAi(candidateId) {
        const result = await runEmploymentAiForCandidate(candidateId, {
          triggeredBy: params.triggeredBy,
          readClient: admin,
          trigger: 'contact_search',
          timeoutMs: SWEEP_AI_TIMEOUT_MS,
        });
        return result.ok && result.check ? result.check.status : null;
      },
      nowIso: () => new Date().toISOString(),
      nowMs: () => Date.now(),
      deadlineMs: employmentSweepDeadlineMs(Date.now(), params.startedAtMs ?? null, params.budgetMs),
    });
  } catch (err) {
    console.error('[employment-sweep] failed', { runIds: params.runIds, error: err instanceof Error ? err.message : err });
    return null;
  }
}
