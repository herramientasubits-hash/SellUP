/**
 * «Verificar con IA» — conexión con Supabase, Claude y el registro de gasto
 * (CONTACT-CURRENT-EMPLOYMENT-AI-1). La usan el botón (acción del servidor, con el alcance ya
 * comprobado) y la comprobación automática al buscar contactos (CONTACT-CURRENT-EMPLOYMENT-SWEEP-1).
 * No escribe en HubSpot ni llama a Apollo o Lusha.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { runAnthropicConversation } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveActiveAnthropicModel } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-batch-candidates.server';
import { estimateClassifierCost } from '@/server/agents/prospecting-toolkit/claude-classifier/cost';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from '@/server/agents/prospecting-toolkit/claude-classifier/types';
import {
  verifyCandidateEmploymentWithAi,
  type EmploymentAiCandidate,
  type VerifyEmploymentWithAiResult,
} from './current-employment-ai-runner';

const EMPLOYMENT_AI_TIMEOUT_MS = 60_000;
const EMPLOYMENT_AI_OPERATION_KEY = 'contact_employment_ai_check';

const CANDIDATE_SELECT = `id, full_name, first_name, last_name, title, linkedin_url, enrichment_metadata,
   run:contact_enrichment_runs ( company_name, company_domain )`;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapCandidate(row: Record<string, unknown>): EmploymentAiCandidate {
  const runRaw = row.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as Record<string, unknown> | null | undefined;
  const metadata = row.enrichment_metadata;
  const fullName = str(row.full_name) ?? ([str(row.first_name), str(row.last_name)].filter(Boolean).join(' ') || null);
  return {
    id: row.id as string,
    fullName,
    title: str(row.title),
    linkedinUrl: str(row.linkedin_url),
    companyName: str(run?.company_name),
    companyDomain: str(run?.company_domain),
    countryName: null,
    enrichmentMetadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {},
  };
}

export interface EmploymentAiRunContext {
  /** Quién gasta (va a «Uso de IA»). */
  triggeredBy: string | null;
  /** Con qué se lee el candidato: la sesión del usuario (botón) o el servicio (búsqueda). */
  readClient: SupabaseClient;
  /** Desde dónde se gastó, para el registro. */
  trigger: 'manual' | 'contact_search';
  timeoutMs?: number;
}

/** Verifica UN candidato con Claude. El llamador ya comprobó el alcance. Nunca lanza. */
export async function runEmploymentAiForCandidate(
  candidateId: string,
  context: EmploymentAiRunContext,
): Promise<VerifyEmploymentWithAiResult> {
  let apiKey = '';
  const startedMs = Date.now();
  try {
    return await verifyCandidateEmploymentWithAi(candidateId, {
      nowIso: () => new Date().toISOString(),
      async loadCandidate(id) {
        const { data, error } = await context.readClient
          .from('contact_enrichment_candidates')
          .select(CANDIDATE_SELECT)
          .eq('id', id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapCandidate(data as Record<string, unknown>) : null;
      },
      async resolveModel() {
        const active = await resolveActiveAnthropicModel();
        if ('error' in active) return active;
        apiKey = active.apiKey;
        return { model: active.model };
      },
      checkQuota: () => checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY),
      runConversation: (body) =>
        runAnthropicConversation({ apiKey, body, timeoutMs: context.timeoutMs ?? EMPLOYMENT_AI_TIMEOUT_MS }),
      async persist(id, patch) {
        const update: Record<string, unknown> = { enrichment_metadata: patch.enrichment_metadata };
        if (patch.title) update.title = patch.title;
        const { error } = await createSupabaseAdminClient().from('contact_enrichment_candidates').update(update).eq('id', id);
        if (error) throw new Error(error.message);
      },
      async logUsage(entry) {
        const cost = entry.usage ? estimateClassifierCost(entry.usage, entry.model) : null;
        await logProviderUsage({
          provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
          operation_key: EMPLOYMENT_AI_OPERATION_KEY,
          agent_key: 'agent2a',
          agent_step: 'verificar_cargo_ia',
          model: entry.model,
          input_tokens: entry.usage?.inputTokens ?? 0,
          output_tokens: entry.usage?.outputTokens ?? 0,
          results_returned: entry.verdict && entry.verdict !== 'unknown' ? 1 : 0,
          estimated_cost_usd: cost?.usd ?? null,
          status: entry.status,
          ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
          duration_ms: Date.now() - startedMs,
          ...(context.triggeredBy ? { triggered_by: context.triggeredBy } : {}),
          // Sin nombre ni empresa de la persona: sólo el id y el resultado.
          metadata: {
            flow: 'contact_employment_ai_check',
            trigger: context.trigger,
            candidate_id: candidateId,
            verdict: entry.verdict,
            rejection: entry.rejection,
            web_searches: entry.usage?.webSearchRequests ?? 0,
            pricing_source: cost?.pricingSource ?? null,
          },
        });
      },
    });
  } catch {
    return { ok: false, status: 'provider_error', rejection: null, check: null };
  }
}
