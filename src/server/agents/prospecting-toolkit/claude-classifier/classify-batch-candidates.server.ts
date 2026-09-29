/**
 * Agente 1 · Clasificador Claude — dependencias reales (sólo servidor).
 *
 * Reutiliza lo que ya existe: modelo activo de Configuración → IA, credencial en
 * Vault, cuota de «Presupuesto y créditos», catálogo publicado, descarga segura
 * de `website-verifier` y el logger común de `provider_usage_logs`.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { loadActiveDiscoveryCatalog } from '@/modules/industry-catalog/discovery-catalog-loader';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { getAiProviderCredential } from '@/server/services/ai-connection';
import { fetchSafePageHtml } from '../website-verifier';
import {
  IN_PROGRESS_STALE_AFTER_MS,
  mergeClassificationIntoMetadata,
  type ClassifiableCandidateRow,
} from './classification-metadata';
import { buildLiveClassifyCompanyDeps, classifyCompany } from './classify-company';
import type { ActiveAnthropicModel, ClassifyBatchDeps } from './classify-batch-candidates';
import {
  CLASSIFICATION_IN_PROGRESS_OUTCOME,
  CLAUDE_CLASSIFICATION_METADATA_KEY,
  CLAUDE_CLASSIFIER_PROVIDER_KEY,
  type ClassifierCatalogIndustry,
} from './types';

/** Fila única de `ai_active_config` (misma constante que `ai-config/actions.ts`). */
const AI_ACTIVE_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

async function resolveActiveAnthropicModel(): Promise<ActiveAnthropicModel | { error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('ai_active_config')
    .select('ai_providers!active_provider_id(key), ai_models!active_model_id(key)')
    .eq('id', AI_ACTIVE_CONFIG_ID)
    .maybeSingle();
  if (error) return { error: `active_config_read_failed:${error.message}` };

  const row = data as { ai_providers?: { key?: string } | null; ai_models?: { key?: string } | null } | null;
  const providerKey = row?.ai_providers?.key ?? null;
  const model = row?.ai_models?.key ?? null;
  if (providerKey !== CLAUDE_CLASSIFIER_PROVIDER_KEY || !model) {
    return { error: `active_provider_is_not_anthropic:${providerKey ?? 'none'}` };
  }

  const credential = await getAiProviderCredential(CLAUDE_CLASSIFIER_PROVIDER_KEY);
  if (!credential.success || !credential.apiKey) {
    return { error: `credential_unavailable:${credential.error ?? 'unknown'}` };
  }
  return { model, apiKey: credential.apiKey };
}

async function loadClassifierCatalog(): Promise<ClassifierCatalogIndustry[]> {
  const catalog = await loadActiveDiscoveryCatalog();
  return catalog.industries.map((industry) => ({
    industryId: industry.id,
    industryName: industry.name,
    industryDescription: industry.description,
    subindustries: catalog.subindustries
      .filter((s) => s.industryId === industry.id)
      .map((s) => ({ id: s.id, name: s.name, description: s.description ?? null })),
  }));
}

async function loadBatchCandidates(batchId: string): Promise<ClassifiableCandidateRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('prospect_candidates')
    .select('id, industry_id, name, website, domain, country_code, country, status, metadata')
    .eq('batch_id', batchId)
    .eq('status', 'needs_review');
  if (error) throw new Error(`candidates_read_failed:${error.message}`);
  return (data ?? []) as ClassifiableCandidateRow[];
}

/** Reintentos si otro proceso escribió la fila entre la lectura y la escritura. */
const SAVE_MAX_ATTEMPTS = 3;

/**
 * Escritura con control de concurrencia optimista: sólo actualiza `metadata`
 * (nunca `status`, así no dispara el trigger de reclamos globales), sólo si el
 * candidato sigue «para revisión» y sólo si `updated_at` no cambió desde la
 * lectura. Una marca «en proceso» no pisa la marca vigente de otra corrida.
 */
async function saveClassification(
  candidateId: string,
  classification: Parameters<typeof mergeClassificationIntoMetadata>[1],
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const isClaim = classification.outcome === CLASSIFICATION_IN_PROGRESS_OUTCOME;

  for (let attempt = 0; attempt < SAVE_MAX_ATTEMPTS; attempt++) {
    const current = await admin
      .from('prospect_candidates')
      .select('metadata, status, updated_at')
      .eq('id', candidateId)
      .maybeSingle();
    if (current.error || !current.data) {
      console.error('[claude-classifier] metadata read failed:', current.error?.message ?? 'not_found');
      return false;
    }
    const row = current.data as { metadata: Record<string, unknown> | null; status: string; updated_at: string };
    if (row.status !== 'needs_review') return false;
    if (isClaim && isFreshlyClaimed(row.metadata, Date.now())) return false;

    const { data, error } = await admin
      .from('prospect_candidates')
      .update({ metadata: mergeClassificationIntoMetadata(row.metadata, classification) })
      .eq('id', candidateId)
      .eq('status', 'needs_review')
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) {
      console.error('[claude-classifier] metadata write failed:', error.message);
      return false;
    }
    if (Array.isArray(data) && data.length === 1) return true;
  }
  console.error('[claude-classifier] metadata write lost the race', SAVE_MAX_ATTEMPTS, 'times');
  return false;
}

function isFreshlyClaimed(metadata: Record<string, unknown> | null, nowMs: number): boolean {
  const previous = metadata?.[CLAUDE_CLASSIFICATION_METADATA_KEY] as
    | { outcome?: unknown; started_at?: unknown }
    | undefined;
  if (previous?.outcome !== CLASSIFICATION_IN_PROGRESS_OUTCOME || typeof previous.started_at !== 'string') {
    return false;
  }
  return nowMs - Date.parse(previous.started_at) < IN_PROGRESS_STALE_AFTER_MS;
}

export function buildLiveClassifyBatchDeps(): ClassifyBatchDeps {
  return {
    resolveActiveModel: resolveActiveAnthropicModel,
    checkQuota: () => checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY),
    loadCatalog: loadClassifierCatalog,
    loadCandidates: loadBatchCandidates,
    classify: (company, catalog, active) =>
      classifyCompany(
        { company, catalog, model: active.model },
        buildLiveClassifyCompanyDeps(active.apiKey, (website) => fetchSafePageHtml(website)),
      ),
    logUsage: logProviderUsage,
    saveClassification,
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}
