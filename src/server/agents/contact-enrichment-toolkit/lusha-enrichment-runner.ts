/**
 * Lusha Enrichment Runner — Agente 2A · Hito 17B.3
 *
 * Skeleton seguro. No hace llamadas reales a la API de Lusha.
 * No crea candidatos. No escribe en Supabase. No activa phone reveal.
 * La implementación live queda para 17B.4.
 */

import {
  isLushaContactEnrichmentEnabled,
} from '@/lib/feature-flags.server';
import { hasLushaApiKey } from '@/server/services/lusha-connection';

export type LushaRunnerStatus =
  | 'disabled'
  | 'missing_api_key'
  | 'not_implemented';

export type LushaRunnerResult = {
  ok: boolean;
  status: LushaRunnerStatus;
  runId: string;
  candidatesCreated: 0;
  message: string;
};

/**
 * Skeleton del runner de enriquecimiento Lusha.
 *
 * 17B.3: El runner nunca llega a llamar la API real.
 * - Si flag disabled → status: 'disabled'
 * - Si flag enabled + sin key → status: 'missing_api_key'
 * - Si flag enabled + key presente → status: 'not_implemented' (hasta 17B.4)
 *
 * No modifica contact_enrichment_runs. No crea agent_run_steps.
 * No inserta provider_usage_logs. No escribe candidatos.
 */
export async function executeContactEnrichmentLushaRun(
  runId: string,
  _triggeredBy: string
): Promise<LushaRunnerResult> {
  if (!isLushaContactEnrichmentEnabled()) {
    return {
      ok: false,
      status: 'disabled',
      runId,
      candidatesCreated: 0,
      message: 'Lusha contact enrichment is disabled (ENABLE_LUSHA_CONTACT_ENRICHMENT=false).',
    };
  }

  const hasKey = await hasLushaApiKey().catch(() => false);
  if (!hasKey) {
    return {
      ok: false,
      status: 'missing_api_key',
      runId,
      candidatesCreated: 0,
      message: 'LUSHA_API_KEY is not configured. Store the key via the settings panel.',
    };
  }

  // Flag enabled + key present → skeleton placeholder until 17B.4.
  return {
    ok: false,
    status: 'not_implemented',
    runId,
    candidatesCreated: 0,
    message: 'Lusha live enrichment is not yet implemented (pending 17B.4).',
  };
}
