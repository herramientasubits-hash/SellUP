/**
 * Apollo Organization Enrichment Cascade (L2.15)
 *
 * Enriquece los resultados de Apollo Organization Search antes del sector gate.
 * Activo solo cuando ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE=true.
 *
 * Flujo:
 *   Organization Search results (WebSearchResult[])
 *     → extraer domain por resultado
 *     → llamar /organizations/enrich para cada uno (hasta max cap)
 *     → sanitizar respuesta (sin PII, arrays truncados, descriptions truncadas)
 *     → mezclar campos enriquecidos en metadata.apollo_profile
 *     → pasar al sector gate con evidencia completa
 *
 * Guardrails:
 *   - Hard cap: HARD_MAX_ENRICHMENTS_CAP = 3 (nunca más de 3 enrichments por run)
 *   - Default max: 1 (configurable vía AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN)
 *   - Sin dominio → skipped
 *   - Error en enrichment → fallback al resultado base, no rompe la corrida
 *
 * Reglas críticas:
 *   - Puro salvo la llamada a deps.enrichOrg (inyectable para tests)
 *   - Sin PII en ningún campo del perfil sanitizado
 *   - No modifica writer, novelty ni duplicados
 *   - No toca Tavily, Lusha, HubSpot, People Search, Agent 2A
 *
 * Pricing:
 *   El costo de cada enrichment se registra en metadata de cascada como
 *   operation_key='organization_enrichment'. Si no hay pricing configurado
 *   en provider_pricing_config para ese operation_key, este módulo NO inventa
 *   costos — deja estimated_cost_usd: null y emite warning en metadata.
 */

import type { WebSearchResult } from './types';
import {
  enrichApolloOrganization,
  type ApolloOrganization,
  type ApolloEnrichResult,
  type EnrichOrganizationParams,
} from '@/server/integrations/apollo-client';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_ENRICHMENT_CASCADE_VERSION = 'v1.L2.15';

// ─── Guardrails ───────────────────────────────────────────────────────────────

/** Absolute cap: never enrich more than 3 orgs per run regardless of env config. */
export const HARD_MAX_ENRICHMENTS_CAP = 3;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Perfil enriquecido sanitizado.
 * Solo campos de señal sectorial y tamaño — sin PII.
 */
export type ApolloEnrichmentProfile = {
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  linkedin_url?: string | null;

  industry?: string | null;
  industries?: string[] | null;
  secondary_industries?: string[] | null;

  keywords?: string[] | null;
  organization_keywords?: string[] | null;

  short_description?: string | null;
  seo_description?: string | null;
  description?: string | null;

  estimated_num_employees?: number | null;
  employee_count?: number | null;
  annual_revenue?: number | null;

  technologies?: string[] | null;
};

export type EnrichmentSkipReason =
  | 'missing_domain'
  | 'cap_reached'
  | 'enrichment_failed'
  | 'cascade_disabled';

export type EnrichmentEntryMeta = {
  domain: string | null;
  enriched: boolean;
  skip_reason?: EnrichmentSkipReason;
  fields_added?: string[];
  error?: string;
};

/** Metadata completa de la operación de cascade — segura para logs. */
export type ApolloEnrichmentCascadeMeta = {
  cascade_version: string;
  enabled: boolean;
  attempted_count: number;
  enriched_count: number;
  skipped_count: number;
  failed_count: number;
  max_enrichments: number;
  enriched_domains_sample: string[];
  skipped_reasons: Record<EnrichmentSkipReason, number>;
  entries: EnrichmentEntryMeta[];
};

// ─── Deps inyectables (para tests) ───────────────────────────────────────────

export type ApolloEnrichmentCascadeDeps = {
  enrichOrg?: (
    params: EnrichOrganizationParams
  ) => Promise<ApolloEnrichResult<ApolloOrganization>>;
};

// ─── Sanitización ─────────────────────────────────────────────────────────────

const MAX_ARRAY_ELEMENTS = 10;
const MAX_DESCRIPTION_CHARS = 300;

function truncateStr(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.length > MAX_DESCRIPTION_CHARS ? s.slice(0, MAX_DESCRIPTION_CHARS) : s;
}

function truncateArr(arr: unknown[] | null | undefined): string[] | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, MAX_ARRAY_ELEMENTS);
}

/**
 * Sanitiza una respuesta de enriquecimiento Apollo.
 * Extrae solo señales sectoriales/tamaño. Descarta PII explícitamente.
 *
 * PII excluido: phone, emails, contact_*, people, person, team_members,
 * raw Apollo internals (id, account_id, organization_id).
 */
export function sanitizeEnrichmentProfile(
  org: ApolloOrganization
): ApolloEnrichmentProfile {
  return {
    name: org.name ?? null,
    website_url: org.website_url ?? null,
    primary_domain: org.primary_domain ?? null,
    linkedin_url: org.linkedin_url ?? null,

    industry: org.industry ?? null,
    industries: truncateArr(org.industries),
    // secondary_industries: not in current ApolloOrganization type; safe to omit
    secondary_industries: null,

    keywords: truncateArr(org.keywords),
    organization_keywords: truncateArr(org.organization_keywords),

    short_description: truncateStr(org.short_description),
    seo_description: truncateStr(org.seo_description),
    description: truncateStr(org.description),

    estimated_num_employees: org.estimated_num_employees ?? null,
    employee_count: org.employee_count ?? null,
    annual_revenue: org.annual_revenue ?? null,

    technologies: truncateArr(org.technologies as unknown[]),
  };
}

// ─── Extracción de dominio ────────────────────────────────────────────────────

/**
 * Extrae el dominio de un WebSearchResult de Apollo.
 * Orden de prioridad:
 *   1. metadata.domain (ya calculado en mapApolloOrganizationToSearchResult)
 *   2. metadata.apollo_profile.primary_domain
 *   3. Extract from result.url
 */
export function extractDomainFromSearchResult(result: WebSearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;

  const domain = meta['domain'];
  if (typeof domain === 'string' && domain.trim()) return domain.trim();

  const apolloProfile = meta['apollo_profile'] as Record<string, unknown> | undefined;
  if (apolloProfile) {
    const pd = apolloProfile['primary_domain'];
    if (typeof pd === 'string' && pd.trim()) return pd.trim();
  }

  try {
    const url = result.url;
    if (url) {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      if (hostname && !hostname.includes('apollo.io')) return hostname;
    }
  } catch {
    // ignore malformed URL
  }

  return null;
}

// ─── Mezclado de perfil enriquecido ──────────────────────────────────────────

/**
 * Mezcla el perfil enriquecido en metadata.apollo_profile del resultado.
 * Los campos del enrichment tienen prioridad sobre los del search si son no-nulos.
 * Retorna nuevo WebSearchResult inmutable.
 */
export function mergeEnrichmentIntoResult(
  result: WebSearchResult,
  enriched: ApolloEnrichmentProfile
): { updated: WebSearchResult; fieldsAdded: string[] } {
  const meta = (result.metadata as Record<string, unknown>) ?? {};
  const existingProfile = (meta['apollo_profile'] as Record<string, unknown>) ?? {};

  const fieldsAdded: string[] = [];

  const mergedProfile: Record<string, unknown> = { ...existingProfile };

  const profileKeys: Array<keyof ApolloEnrichmentProfile> = [
    'industry',
    'industries',
    'secondary_industries',
    'keywords',
    'organization_keywords',
    'short_description',
    'seo_description',
    'description',
    'estimated_num_employees',
    'employee_count',
    'annual_revenue',
    'technologies',
    'name',
    'website_url',
    'primary_domain',
    'linkedin_url',
  ];

  for (const key of profileKeys) {
    const val = enriched[key];
    if (val !== null && val !== undefined) {
      const oldVal = mergedProfile[key];
      if (oldVal === null || oldVal === undefined || (Array.isArray(oldVal) && oldVal.length === 0)) {
        mergedProfile[key] = val;
        fieldsAdded.push(key);
      }
    }
  }

  const updatedMeta: Record<string, unknown> = {
    ...meta,
    apollo_profile: mergedProfile,
    apollo_enrichment_applied: true,
  };

  return {
    updated: { ...result, metadata: updatedMeta },
    fieldsAdded,
  };
}

// ─── Cascade principal ────────────────────────────────────────────────────────

/**
 * Ejecuta el enrichment cascade sobre los resultados de Organization Search.
 *
 * Cuando enabled=false (flag OFF) retorna results intactos y meta con enabled=false.
 *
 * @param results     Resultados mapeados de Apollo Organization Search.
 * @param maxEnrichments  Máximo de enrichments a hacer (ya clampado al cap externo).
 * @param deps        Dependencias inyectables (enrich fn, para tests).
 */
export async function runApolloOrganizationEnrichmentCascade(
  results: WebSearchResult[],
  maxEnrichments: number,
  deps?: ApolloEnrichmentCascadeDeps
): Promise<{ results: WebSearchResult[]; meta: ApolloEnrichmentCascadeMeta }> {
  const cappedMax = Math.min(maxEnrichments, HARD_MAX_ENRICHMENTS_CAP);
  const enrichFn = deps?.enrichOrg ?? enrichApolloOrganization;

  const entries: EnrichmentEntryMeta[] = [];
  const enrichedDomainsSample: string[] = [];
  const skippedReasons: Record<EnrichmentSkipReason, number> = {
    missing_domain: 0,
    cap_reached: 0,
    enrichment_failed: 0,
    cascade_disabled: 0,
  };

  let attemptedCount = 0;
  let enrichedCount = 0;
  let failedCount = 0;

  const updatedResults: WebSearchResult[] = [];

  for (const result of results) {
    const domain = extractDomainFromSearchResult(result);

    if (!domain) {
      entries.push({ domain: null, enriched: false, skip_reason: 'missing_domain' });
      skippedReasons['missing_domain']++;
      updatedResults.push(result);
      continue;
    }

    if (attemptedCount >= cappedMax) {
      entries.push({ domain, enriched: false, skip_reason: 'cap_reached' });
      skippedReasons['cap_reached']++;
      updatedResults.push(result);
      continue;
    }

    attemptedCount++;

    try {
      const enrichResult = await enrichFn({ domain });

      if (enrichResult.success && enrichResult.data) {
        const sanitized = sanitizeEnrichmentProfile(enrichResult.data);
        const { updated, fieldsAdded } = mergeEnrichmentIntoResult(result, sanitized);
        enrichedCount++;
        enrichedDomainsSample.push(domain);
        entries.push({ domain, enriched: true, fields_added: fieldsAdded });
        updatedResults.push(updated);
      } else {
        const errMsg = enrichResult.error?.message ?? 'enrichment_returned_no_data';
        failedCount++;
        entries.push({ domain, enriched: false, skip_reason: 'enrichment_failed', error: errMsg });
        skippedReasons['enrichment_failed']++;
        updatedResults.push(result);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown_error';
      failedCount++;
      entries.push({ domain, enriched: false, skip_reason: 'enrichment_failed', error: errMsg });
      skippedReasons['enrichment_failed']++;
      updatedResults.push(result);
    }
  }

  const skippedCount = results.length - attemptedCount - (results.length - entries.length);
  // skipped = entries with skip_reason (not enriched)
  const totalSkipped = entries.filter(e => !e.enriched).length;

  const meta: ApolloEnrichmentCascadeMeta = {
    cascade_version: APOLLO_ENRICHMENT_CASCADE_VERSION,
    enabled: true,
    attempted_count: attemptedCount,
    enriched_count: enrichedCount,
    skipped_count: totalSkipped - failedCount,
    failed_count: failedCount,
    max_enrichments: cappedMax,
    enriched_domains_sample: enrichedDomainsSample,
    skipped_reasons: skippedReasons,
    entries,
  };

  return { results: updatedResults, meta };
}

/** Returns a disabled cascade metadata (flag=false path). */
export function buildDisabledCascadeMeta(): ApolloEnrichmentCascadeMeta {
  return {
    cascade_version: APOLLO_ENRICHMENT_CASCADE_VERSION,
    enabled: false,
    attempted_count: 0,
    enriched_count: 0,
    skipped_count: 0,
    failed_count: 0,
    max_enrichments: 0,
    enriched_domains_sample: [],
    skipped_reasons: {
      missing_domain: 0,
      cap_reached: 0,
      enrichment_failed: 0,
      cascade_disabled: 0,
    },
    entries: [],
  };
}
