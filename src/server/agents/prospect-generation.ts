/**
 * Agente 1 — Generación de Empresas Candidatas
 *
 * Cascada MVP (en orden):
 *   1. Apollo: búsqueda de empresas por país/industria
 *   2. HubSpot: deduplicación por dominio o nombre (solo lectura)
 *
 * No usa Lusha, IA web, ni fuentes públicas.
 * No crea ni actualiza datos en HubSpot.
 */

import { createClient as createAdminClient } from '@supabase/supabase-js';
import { searchApolloOrganizations, type ApolloOrganization } from '@/server/integrations/apollo-client';
import { checkHubSpotCompanyDuplicate } from '@/server/integrations/hubspot-company-search';
import {
  createAgentRun,
  updateAgentRun,
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
  logResultQualityEvent,
} from '@/modules/usage-tracking/logging';

// ============================================================
// Types
// ============================================================

export interface ProspectGenerationParams {
  country: string;
  countryCode: string;
  industry: string;
  targetCount: number;
  searchDepth: 'basic' | 'standard';
  internalUserId: string;
}

export interface ProspectGenerationResult {
  success: boolean;
  batchId: string | null;
  agentRunId: string | null;
  candidatesCreated: number;
  estimatedCostUsd: number;
  error?: string;
}

interface NormalizedCandidate {
  name: string;
  normalizedName: string;
  website: string | null;
  domain: string | null;
  country: string;
  countryCode: string;
  city: string | null;
  industry: string;
  companySize: string | null;
  sourcePrimary: 'apollo';
  duplicateStatus: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'unchecked';
  matchedHubspotCompanyId: string | null;
  confidenceScore: number;
  dataCompletenessScore: number;
  estimatedCostUsd: number;
  apolloId: string;
}

// ============================================================
// Admin client
// ============================================================

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ============================================================
// Apollo cost estimation via provider_pricing_config
// ============================================================

interface ApolloCostEstimate {
  creditsUsed: number;
  estimatedCostUsd: number;
  pricingSource: 'provider_pricing_config' | 'missing_config';
  unitCostUsd: number | null;
  pricingBasis: string;
  note: string;
}

async function estimateApolloCost(resultsReturned: number): Promise<ApolloCostEstimate> {
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from('provider_pricing_config')
      .select('unit_cost_usd')
      .eq('provider_key', 'apollo')
      .eq('operation_key', 'credit')
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    if (!data) {
      return {
        creditsUsed: resultsReturned,
        estimatedCostUsd: 0,
        pricingSource: 'missing_config',
        unitCostUsd: null,
        pricingBasis: 'no_config_available',
        note: 'Sin configuración activa en provider_pricing_config para apollo/credit',
      };
    }

    const unitCostUsd = Number(data.unit_cost_usd);
    const creditsUsed = resultsReturned;
    const estimatedCostUsd = creditsUsed * unitCostUsd;

    return {
      creditsUsed,
      estimatedCostUsd,
      pricingSource: 'provider_pricing_config',
      unitCostUsd,
      pricingBasis: 'estimated_per_result_as_credit',
      note: `${creditsUsed} crédito(s) estimado(s) × $${unitCostUsd} USD`,
    };
  } catch {
    return {
      creditsUsed: resultsReturned,
      estimatedCostUsd: 0,
      pricingSource: 'missing_config',
      unitCostUsd: null,
      pricingBasis: 'config_read_error',
      note: 'Error al leer provider_pricing_config',
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function mapEmployeeCount(count: number | null): string | null {
  if (!count) return null;
  if (count <= 10) return '1-10 empleados';
  if (count <= 50) return '11-50 empleados';
  if (count <= 200) return '51-200 empleados';
  if (count <= 500) return '201-500 empleados';
  if (count <= 1000) return '501-1,000 empleados';
  if (count <= 5000) return '1,001-5,000 empleados';
  return '5,001+ empleados';
}

function computeDataCompleteness(org: ApolloOrganization): number {
  const fields = [org.name, org.website_url, org.country, org.city, org.industry, org.employee_count];
  const filled = fields.filter((f) => f !== null && f !== undefined && f !== '').length;
  return Math.round((filled / fields.length) * 100);
}

function computeConfidence(org: ApolloOrganization, hasDomain: boolean): number {
  let score = 50;
  if (hasDomain) score += 20;
  if (org.website_url) score += 10;
  if (org.country) score += 10;
  if (org.industry) score += 5;
  if (org.employee_count) score += 5;
  return Math.min(score, 100);
}

// Maps SellUp industry labels (Spanish) to Apollo q_keywords (English).
// Apollo's mixed_companies/search uses q_keywords for full-text filtering on
// industry tags and company descriptions. IDs from organization_industry_tag_ids
// are not used here because Apollo's internal ID catalog is not available locally.
// Limitation: keyword matching is approximate; Apollo may still return companies
// outside the sector if their profile matches unrelated terms.
const INDUSTRY_KEYWORD_MAP: Record<string, string> = {
  'Tecnología': 'technology software IT services SaaS',
  'Servicios financieros / Fintech': 'financial services fintech banking insurance',
  'Retail / E-commerce': 'retail e-commerce commerce shopping',
  'Manufactura': 'manufacturing industrial production',
  'Salud / Healthcare': 'healthcare health medical pharma hospital',
  'Educación / EdTech': 'education edtech learning school university',
  'Logística / Transporte': 'logistics transport shipping freight supply chain',
  'Energía / Utilities': 'energy utilities oil gas electricity renewable',
  'Construcción / Real Estate': 'construction real estate property infrastructure',
  'Medios / Publicidad': 'media advertising marketing publishing',
  'Agroindustria': 'agriculture agribusiness farming food production',
  'Minería': 'mining extraction minerals',
  'Telecomunicaciones': 'telecommunications telecom internet broadband',
  'Consultoría / Servicios profesionales': 'consulting professional services advisory',
  'Alimentos y bebidas': 'food beverage consumer goods',
  'Automotriz': 'automotive vehicles car dealership',
  'Gobierno / Sector público': 'government public sector municipal',
};

export function mapIndustryToApolloKeywords(industry: string): string | undefined {
  return INDUSTRY_KEYWORD_MAP[industry];
}

// ============================================================
// Main agent orchestrator
// ============================================================

export async function runProspectGenerationAgent(
  params: ProspectGenerationParams
): Promise<ProspectGenerationResult> {
  const { country, countryCode, industry, targetCount, searchDepth, internalUserId } = params;
  const safeCount = Math.min(targetCount, 25);
  const startedAt = Date.now();

  // Step 1: Create agent_run
  const agentRun = await createAgentRun({
    agent_key: 'prospect_generation',
    agent_name: 'Generación de empresas candidatas',
    triggered_by: internalUserId,
    results_requested: safeCount,
    input_params: { country, countryCode, industry, targetCount: safeCount, searchDepth },
    metadata: { cascade: ['apollo', 'hubspot'], version: '1.0.0' },
  });

  if (!agentRun) {
    return { success: false, batchId: null, agentRunId: null, candidatesCreated: 0, estimatedCostUsd: 0, error: 'No se pudo crear agent_run' };
  }

  const admin = getAdminClient();
  const now = new Date();
  const batchName = `Agente 1 · ${country} · ${industry} · ${now.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  // Step 2: Create prospect_batch
  const { data: batch, error: batchError } = await admin
    .from('prospect_batches')
    .insert({
      name: batchName,
      country,
      country_code: countryCode,
      industry,
      target_count: safeCount,
      search_depth: searchDepth,
      status: 'generating',
      source: 'agent_1',
      agent_run_id: agentRun.id,
      owner_id: internalUserId,
      created_by: internalUserId,
      metadata: { agent_key: 'prospect_generation', cascade: ['apollo', 'hubspot'] },
    })
    .select()
    .single();

  if (batchError || !batch) {
    await updateAgentRun(agentRun.id, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: `Error al crear lote: ${batchError?.message}`,
    });
    return { success: false, batchId: null, agentRunId: agentRun.id, candidatesCreated: 0, estimatedCostUsd: 0, error: `Error al crear lote: ${batchError?.message}` };
  }

  let totalEstimatedCost = 0;

  try {
    // ── Step: validate_input ──────────────────────────────────
    const validateStep = await createAgentRunStep({
      agent_run_id: agentRun.id,
      step_key: 'validate_input',
      step_name: 'Validar parámetros de entrada',
    });
    await finishAgentRunStep(validateStep!.id, {
      status: 'success',
      metadata: { country, industry, targetCount: safeCount, searchDepth },
    });

    // ── Step: apollo_company_search ───────────────────────────
    const apolloStepStart = Date.now();
    const apolloStep = await createAgentRunStep({
      agent_run_id: agentRun.id,
      step_key: 'apollo_company_search',
      step_name: 'Búsqueda de empresas en Apollo',
      provider_key: 'apollo',
    });

    const industryKeywords = mapIndustryToApolloKeywords(industry);
    const apolloResult = await searchApolloOrganizations({
      organization_locations: [country],
      ...(industryKeywords ? { q_keywords: industryKeywords } : {}),
      per_page: safeCount,
      page: 1,
    });

    const apolloDuration = Date.now() - apolloStepStart;
    const apolloCompanies = apolloResult.data ?? [];

    const apolloCost = await estimateApolloCost(apolloCompanies.length);
    totalEstimatedCost += apolloCost.estimatedCostUsd;

    await logProviderUsage({
      agent_run_id: agentRun.id,
      agent_run_step_id: apolloStep?.id,
      provider_key: 'apollo',
      operation_key: 'mixed_companies_search',
      credits_used: apolloCost.creditsUsed,
      results_returned: apolloCompanies.length,
      estimated_cost_usd: apolloCost.estimatedCostUsd,
      status: apolloResult.success ? 'success' : 'error',
      error_message: apolloResult.error?.message,
      duration_ms: apolloDuration,
      triggered_by: internalUserId,
      metadata: {
        country,
        per_page: safeCount,
        total_available: apolloResult.total ?? 0,
        pricing_source: apolloCost.pricingSource,
        pricing_basis: apolloCost.pricingBasis,
        unit_cost_usd: apolloCost.unitCostUsd,
        credits_estimation_note: apolloCost.note,
      },
    });

    await finishAgentRunStep(apolloStep!.id, {
      status: apolloResult.success ? 'success' : 'error',
      results_returned: apolloCompanies.length,
      results_useful: apolloCompanies.length,
      estimated_cost_usd: apolloCost.estimatedCostUsd,
      real_cost_usd: undefined,
      duration_ms: apolloDuration,
      error_message: apolloResult.error?.message,
      metadata: {
        pricing_source: apolloCost.pricingSource,
        credits_used: apolloCost.creditsUsed,
        unit_cost_usd: apolloCost.unitCostUsd,
      },
    });

    if (!apolloResult.success || apolloCompanies.length === 0) {
      await admin.from('prospect_batches').update({ status: 'failed', metadata: { error: apolloResult.error?.message ?? 'Apollo no devolvió resultados' } }).eq('id', batch.id);
      await updateAgentRun(agentRun.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        estimated_cost_usd: totalEstimatedCost,
        error_message: apolloResult.error?.message ?? 'Apollo no devolvió resultados',
      });
      return { success: false, batchId: batch.id, agentRunId: agentRun.id, candidatesCreated: 0, estimatedCostUsd: totalEstimatedCost, error: apolloResult.error?.message ?? 'Apollo no devolvió resultados' };
    }

    // Take only what we need
    const targetCompanies = apolloCompanies.slice(0, safeCount);

    // ── Step: hubspot_duplicate_check ─────────────────────────
    const hubspotStepStart = Date.now();
    const hubspotStep = await createAgentRunStep({
      agent_run_id: agentRun.id,
      step_key: 'hubspot_duplicate_check',
      step_name: 'Verificación de duplicados en HubSpot',
      provider_key: 'hubspot',
    });

    const dupResults = await Promise.all(
      targetCompanies.map(async (org) => {
        const domain = extractDomain(org.website_url);
        return checkHubSpotCompanyDuplicate({ domain: domain ?? undefined, companyName: org.name ?? undefined });
      })
    );

    const hubspotDuration = Date.now() - hubspotStepStart;
    const duplicatesFound = dupResults.filter((r) => r.hasDuplicate).length;

    await logProviderUsage({
      agent_run_id: agentRun.id,
      agent_run_step_id: hubspotStep?.id,
      provider_key: 'hubspot',
      operation_key: 'crm_companies_search',
      results_returned: targetCompanies.length,
      estimated_cost_usd: 0,
      status: 'success',
      duration_ms: hubspotDuration,
      triggered_by: internalUserId,
      metadata: { checked: targetCompanies.length, duplicates_found: duplicatesFound, skipped: dupResults.every((r) => r.skipped) },
    });

    await finishAgentRunStep(hubspotStep!.id, {
      status: 'success',
      results_returned: targetCompanies.length,
      results_useful: targetCompanies.length - duplicatesFound,
      estimated_cost_usd: 0,
      duration_ms: hubspotDuration,
      metadata: { duplicates_found: duplicatesFound },
    });

    // ── Step: normalize_candidates ────────────────────────────
    const normalizeStep = await createAgentRunStep({
      agent_run_id: agentRun.id,
      step_key: 'normalize_candidates',
      step_name: 'Normalizar candidatos',
    });

    const normalized: NormalizedCandidate[] = targetCompanies.map((org, i) => {
      const domain = extractDomain(org.website_url);
      const dupResult = dupResults[i];
      const hasDuplicate = dupResult?.hasDuplicate ?? false;
      const isDomainMatch = hasDuplicate && !!domain;

      let duplicateStatus: NormalizedCandidate['duplicateStatus'] = 'no_match';
      if (dupResult?.skipped) duplicateStatus = 'unchecked';
      else if (isDomainMatch) duplicateStatus = 'exact_duplicate';
      else if (hasDuplicate) duplicateStatus = 'possible_duplicate';

      const matchedHsId = hasDuplicate ? (dupResult.matches[0]?.id ?? null) : null;

      return {
        name: org.name ?? 'Empresa sin nombre',
        normalizedName: normalizeName(org.name ?? 'empresa sin nombre'),
        website: org.website_url,
        domain,
        country,
        countryCode,
        city: org.city ?? null,
        industry,
        companySize: mapEmployeeCount(org.employee_count),
        sourcePrimary: 'apollo',
        duplicateStatus,
        matchedHubspotCompanyId: matchedHsId,
        confidenceScore: computeConfidence(org, !!domain),
        dataCompletenessScore: computeDataCompleteness(org),
        estimatedCostUsd: 0,
        apolloId: org.id,
      };
    });

    await finishAgentRunStep(normalizeStep!.id, {
      status: 'success',
      results_returned: normalized.length,
      results_useful: normalized.length,
    });

    // ── Step: create_candidates ───────────────────────────────
    const createStep = await createAgentRunStep({
      agent_run_id: agentRun.id,
      step_key: 'create_candidates',
      step_name: 'Crear empresas candidatas',
    });

    const candidateInserts = normalized.map((c) => ({
      batch_id: batch.id,
      name: c.name,
      normalized_name: c.normalizedName,
      website: c.website,
      domain: c.domain,
      country: c.country,
      country_code: c.countryCode,
      city: c.city,
      industry: c.industry,
      company_size: c.companySize,
      source_primary: c.sourcePrimary,
      sources_checked: [
        { provider: 'apollo', checked_at: new Date().toISOString() },
        { provider: 'hubspot', checked_at: new Date().toISOString(), result: c.duplicateStatus },
      ],
      duplicate_status: c.duplicateStatus,
      matched_hubspot_company_id: c.matchedHubspotCompanyId,
      confidence_score: c.confidenceScore,
      data_completeness_score: c.dataCompletenessScore,
      estimated_cost_usd: c.estimatedCostUsd,
      status: 'needs_review',
      metadata: { apollo_id: c.apolloId, generated_by: 'agent_1' },
    }));

    const { data: insertedCandidates, error: insertError } = await admin
      .from('prospect_candidates')
      .insert(candidateInserts)
      .select('id, name, duplicate_status');

    if (insertError || !insertedCandidates) {
      throw new Error(`Error al insertar candidatos: ${insertError?.message}`);
    }

    // Log result_quality_events
    await Promise.all(
      insertedCandidates.map(async (c) => {
        await logResultQualityEvent({
          agent_run_id: agentRun.id,
          result_type: 'company',
          result_id: c.id,
          event_type: 'generated',
          source_key: 'apollo',
          performed_by: internalUserId,
        });
        if (c.duplicate_status === 'exact_duplicate' || c.duplicate_status === 'possible_duplicate') {
          await logResultQualityEvent({
            agent_run_id: agentRun.id,
            result_type: 'company',
            result_id: c.id,
            event_type: 'duplicate_detected',
            source_key: 'hubspot',
            performed_by: internalUserId,
            notes: c.duplicate_status,
          });
        }
      })
    );

    await finishAgentRunStep(createStep!.id, {
      status: 'success',
      results_returned: insertedCandidates.length,
      results_useful: insertedCandidates.length,
    });

    // ── Step: finalize_batch ──────────────────────────────────
    const finalizeStep = await createAgentRunStep({
      agent_run_id: agentRun.id,
      step_key: 'finalize_batch',
      step_name: 'Finalizar lote',
    });

    await admin
      .from('prospect_batches')
      .update({
        status: 'ready_for_review',
        estimated_cost_usd: totalEstimatedCost,
        completed_at: new Date().toISOString(),
        metadata: {
          agent_key: 'prospect_generation',
          cascade: ['apollo', 'hubspot'],
          candidates_created: insertedCandidates.length,
          duplicates_found: duplicatesFound,
          duration_ms: Date.now() - startedAt,
        },
      })
      .eq('id', batch.id);

    await finishAgentRunStep(finalizeStep!.id, {
      status: 'success',
      duration_ms: Date.now() - startedAt,
    });

    await updateAgentRun(agentRun.id, {
      status: 'completed',
      results_generated: insertedCandidates.length,
      results_unique: insertedCandidates.filter((c) => c.duplicate_status === 'no_match' || c.duplicate_status === 'unchecked').length,
      estimated_cost_usd: totalEstimatedCost,
      finished_at: new Date().toISOString(),
      metadata: { batch_id: batch.id, duration_ms: Date.now() - startedAt },
    });

    return {
      success: true,
      batchId: batch.id,
      agentRunId: agentRun.id,
      candidatesCreated: insertedCandidates.length,
      estimatedCostUsd: totalEstimatedCost,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error inesperado en el agente';

    await admin
      .from('prospect_batches')
      .update({ status: 'failed', metadata: { error: msg } })
      .eq('id', batch.id);

    await updateAgentRun(agentRun.id, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      estimated_cost_usd: totalEstimatedCost,
      error_message: msg,
    });

    return {
      success: false,
      batchId: batch.id,
      agentRunId: agentRun.id,
      candidatesCreated: 0,
      estimatedCostUsd: totalEstimatedCost,
      error: msg,
    };
  }
}
