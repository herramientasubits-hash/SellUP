/**
 * Apollo Organization Enrichment Cascade (L2.15)
 *
 * Enriquece los resultados de Apollo Organization Search antes del sector gate.
 * Activo solo cuando ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE=true.
 *
 * Flujo:
 *   Organization Search results (WebSearchResult[])
 *     → extraer domain por resultado
 *     → priorizar selección: ambiguity-first (Q3F-5AV.2, ver abajo)
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
 * Priorización ambiguity-first (Q3F-5AV.2):
 *   Post-mortem Q3F-5AV.1: con cap bajo (ej. cap=1), la selección first-N del
 *   array podía gastar el único enrichment en un candidato que YA tenía
 *   evidencia sectorial suficiente (ej. Terpel, con industry/keywords propios
 *   del search) mientras un candidato ambiguo sin evidencia (ej. Platzi,
 *   bare) quedaba sin enriquecer y era rechazado por insufficient_sector_evidence
 *   — no por ser un falso negativo real del gate, sino por starvation de
 *   evidencia inducida por el orden de selección.
 *
 *   Fix: antes de seleccionar candidatos a enriquecer, se particiona en dos
 *   buckets estables (mismo orden relativo interno que el array de entrada):
 *     1. no_pre_enrichment_evidence — domain resoluble, sin evidencia sectorial
 *        pre-enrichment (ver detectPreEnrichmentEvidenceFields).
 *     2. has_pre_enrichment_evidence — domain resoluble, con evidencia ya
 *        suficiente para que el sector gate decida sin enrichment.
 *   Se intenta enriquecer primero el bucket 1, luego el bucket 2 si queda cap.
 *   Candidatos sin dominio siguen con skip_reason='missing_domain' como antes.
 *
 *   Esto SOLO cambia qué candidato recibe la llamada enrichOrg. No cambia:
 *   cap, pricing guard, sector gate, candidate writer, ranking, ni el orden
 *   final del array de resultados retornado (updatedResults preserva el
 *   índice original de cada resultado).
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

/**
 * Q3F-5AV.2: bucket de priorización interna para selección de enrichment.
 * No afecta el orden final del array de resultados — solo qué candidato
 * recibe la llamada enrichOrg primero cuando el cap es limitado.
 */
export type ApolloEnrichmentPriorityBucket =
  | 'no_pre_enrichment_evidence'
  | 'has_pre_enrichment_evidence'
  | 'missing_domain';

export type ApolloEnrichmentPriorityReason =
  | 'domain_present_no_evidence_fields'
  | 'domain_present_evidence_fields_present'
  | 'missing_domain';

/**
 * Q3F-5AU.12: raw (pre-sanitization) industry fields from a successful
 * enrichment, transported for downstream raw-label-observation capture.
 * Intentionally narrow — no name, domain, LinkedIn URL, or any other
 * enrichment field is carried here.
 */
export type ApolloIndustryRawFields = {
  industry?: string | null;
  industries?: string[] | null;
};

export type EnrichmentEntryMeta = {
  domain: string | null;
  enriched: boolean;
  skip_reason?: EnrichmentSkipReason;
  fields_added?: string[];
  error?: string;
  /** Q3F-5AU.12: only present when enriched=true. */
  rawIndustryFields?: ApolloIndustryRawFields;
  /** Q3F-5AV.2: bucket usado para decidir el orden de selección de enrichment. */
  priority_bucket?: ApolloEnrichmentPriorityBucket;
  /** Q3F-5AV.2: razón segura (sin valores) del bucket asignado. */
  priority_reason?: ApolloEnrichmentPriorityReason;
  /**
   * Q3F-5AV.2: nombres de campos (no valores) que aportaron evidencia
   * pre-enrichment. Vacío/ausente cuando el bucket es no_pre_enrichment_evidence
   * o missing_domain.
   */
  pre_enrichment_evidence_fields?: string[];
};

/** Q3F-5AV.2: conteo de candidatos por bucket de priorización — seguro para logs. */
export type ApolloEnrichmentBucketCounts = {
  no_evidence: number;
  has_evidence: number;
  missing_domain: number;
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
  /** Q3F-5AV.2: conteo de candidatos por bucket de priorización ambiguity-first. */
  bucket_counts: ApolloEnrichmentBucketCounts;
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

// ─── Detección de evidencia pre-enrichment (Q3F-5AV.2) ───────────────────────

/**
 * Campos (nombres, no valores) que el sector gate ya usa como evidencia
 * sectorial (ver apollo-sector-relevance-gate.ts extractCandidateText /
 * extractCandidateDiagnostics). Deliberadamente NO incluye name, domain,
 * country, city, linkedin_url ni ningún dato personal — esos no son
 * evidencia sectorial.
 */
const FLAT_EVIDENCE_FIELDS: ReadonlyArray<{ key: string; path: string }> = [
  { key: 'industry', path: 'metadata.industry' },
  { key: 'industries', path: 'metadata.industries' },
  { key: 'keywords', path: 'metadata.keywords' },
  { key: 'organization_keywords', path: 'metadata.organization_keywords' },
  { key: 'short_description', path: 'metadata.short_description' },
  { key: 'seo_description', path: 'metadata.seo_description' },
  { key: 'description', path: 'metadata.description' },
];

const APOLLO_PROFILE_EVIDENCE_FIELDS: ReadonlyArray<{ key: string; path: string }> = [
  { key: 'industry', path: 'metadata.apollo_profile.industry' },
  { key: 'industries', path: 'metadata.apollo_profile.industries' },
  { key: 'keywords', path: 'metadata.apollo_profile.keywords' },
  { key: 'organization_keywords', path: 'metadata.apollo_profile.organization_keywords' },
  { key: 'short_description', path: 'metadata.apollo_profile.short_description' },
  { key: 'seo_description', path: 'metadata.apollo_profile.seo_description' },
  { key: 'description', path: 'metadata.apollo_profile.description' },
];

function hasNonEmptyEvidenceValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(v => typeof v === 'string' && v.trim().length > 0);
  return false;
}

/**
 * Detecta qué campos de evidencia sectorial pre-enrichment están presentes
 * en un WebSearchResult, ANTES de llamar a enrichOrg. Usa exactamente los
 * mismos campos que el sector gate consume como evidencia (ver
 * apollo-sector-relevance-gate.ts), para que "tiene evidencia" en la
 * cascada signifique lo mismo que "tiene evidencia" en el gate.
 *
 * Retorna solo NOMBRES de campos (rutas), nunca valores — seguro para logs.
 */
export function detectPreEnrichmentEvidenceFields(result: WebSearchResult): string[] {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return [];

  const found: string[] = [];

  for (const { key, path } of FLAT_EVIDENCE_FIELDS) {
    if (hasNonEmptyEvidenceValue(meta[key])) found.push(path);
  }

  const apolloProfile = meta['apollo_profile'] as Record<string, unknown> | undefined;
  if (apolloProfile) {
    for (const { key, path } of APOLLO_PROFILE_EVIDENCE_FIELDS) {
      if (hasNonEmptyEvidenceValue(apolloProfile[key])) found.push(path);
    }
  }

  return found;
}

/** True cuando el resultado ya tiene evidencia sectorial suficiente pre-enrichment. */
export function hasPreEnrichmentEvidence(result: WebSearchResult): boolean {
  return detectPreEnrichmentEvidenceFields(result).length > 0;
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

/** Q3F-5AV.2: entrada analizada de un resultado antes de decidir enrichment. */
type AnalyzedCandidate = {
  index: number;
  domain: string | null;
  priorityBucket: ApolloEnrichmentPriorityBucket;
  priorityReason: ApolloEnrichmentPriorityReason;
  evidenceFields: string[];
};

function analyzeCandidate(result: WebSearchResult, index: number): AnalyzedCandidate {
  const domain = extractDomainFromSearchResult(result);

  if (!domain) {
    return {
      index,
      domain: null,
      priorityBucket: 'missing_domain',
      priorityReason: 'missing_domain',
      evidenceFields: [],
    };
  }

  const evidenceFields = detectPreEnrichmentEvidenceFields(result);
  if (evidenceFields.length > 0) {
    return {
      index,
      domain,
      priorityBucket: 'has_pre_enrichment_evidence',
      priorityReason: 'domain_present_evidence_fields_present',
      evidenceFields,
    };
  }

  return {
    index,
    domain,
    priorityBucket: 'no_pre_enrichment_evidence',
    priorityReason: 'domain_present_no_evidence_fields',
    evidenceFields: [],
  };
}

/**
 * Ejecuta el enrichment cascade sobre los resultados de Organization Search.
 *
 * Cuando enabled=false (flag OFF) retorna results intactos y meta con enabled=false.
 *
 * Q3F-5AV.2: la selección de QUÉ candidato se enriquece primero es
 * ambiguity-first (ver detectPreEnrichmentEvidenceFields arriba), pero el
 * array `results` retornado preserva siempre el orden de entrada.
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

  // Q3F-5AV.2: analizar todos los candidatos primero — cada uno recuerda su
  // índice original para que el array final preserve el orden de entrada.
  const analyzed = results.map((result, index) => analyzeCandidate(result, index));

  const noEvidenceQueue = analyzed.filter(a => a.priorityBucket === 'no_pre_enrichment_evidence');
  const hasEvidenceQueue = analyzed.filter(a => a.priorityBucket === 'has_pre_enrichment_evidence');
  const missingDomainCandidates = analyzed.filter(a => a.priorityBucket === 'missing_domain');

  // Orden de selección para enrichment: ambiguity-first. Dentro de cada
  // bucket se conserva el orden relativo original (partición estable).
  const enrichmentSelectionOrder: AnalyzedCandidate[] = [...noEvidenceQueue, ...hasEvidenceQueue];

  const bucketCounts: ApolloEnrichmentBucketCounts = {
    no_evidence: noEvidenceQueue.length,
    has_evidence: hasEvidenceQueue.length,
    missing_domain: missingDomainCandidates.length,
  };

  const entryByIndex = new Map<number, EnrichmentEntryMeta>();
  const updatedResultByIndex = new Map<number, WebSearchResult>();

  const skippedReasons: Record<EnrichmentSkipReason, number> = {
    missing_domain: 0,
    cap_reached: 0,
    enrichment_failed: 0,
    cascade_disabled: 0,
  };

  let attemptedCount = 0;
  let enrichedCount = 0;
  let failedCount = 0;
  const enrichedDomainsSample: string[] = [];

  for (const candidate of missingDomainCandidates) {
    entryByIndex.set(candidate.index, {
      domain: null,
      enriched: false,
      skip_reason: 'missing_domain',
      priority_bucket: 'missing_domain',
      priority_reason: 'missing_domain',
    });
    skippedReasons['missing_domain']++;
  }

  for (const candidate of enrichmentSelectionOrder) {
    const evidenceFields = candidate.evidenceFields.length ? candidate.evidenceFields : undefined;

    if (attemptedCount >= cappedMax) {
      entryByIndex.set(candidate.index, {
        domain: candidate.domain,
        enriched: false,
        skip_reason: 'cap_reached',
        priority_bucket: candidate.priorityBucket,
        priority_reason: candidate.priorityReason,
        pre_enrichment_evidence_fields: evidenceFields,
      });
      skippedReasons['cap_reached']++;
      continue;
    }

    attemptedCount++;
    const domain = candidate.domain as string;
    const originalResult = results[candidate.index] as WebSearchResult;

    try {
      const enrichResult = await enrichFn({ domain });

      if (enrichResult.success && enrichResult.data) {
        const rawIndustryFields: ApolloIndustryRawFields = {
          industry: enrichResult.data.industry ?? null,
          industries: enrichResult.data.industries ?? null,
        };
        const sanitized = sanitizeEnrichmentProfile(enrichResult.data);
        const { updated, fieldsAdded } = mergeEnrichmentIntoResult(originalResult, sanitized);
        enrichedCount++;
        enrichedDomainsSample.push(domain);
        updatedResultByIndex.set(candidate.index, updated);
        entryByIndex.set(candidate.index, {
          domain,
          enriched: true,
          fields_added: fieldsAdded,
          rawIndustryFields,
          priority_bucket: candidate.priorityBucket,
          priority_reason: candidate.priorityReason,
          pre_enrichment_evidence_fields: evidenceFields,
        });
      } else {
        const errMsg = enrichResult.error?.message ?? 'enrichment_returned_no_data';
        failedCount++;
        entryByIndex.set(candidate.index, {
          domain,
          enriched: false,
          skip_reason: 'enrichment_failed',
          error: errMsg,
          priority_bucket: candidate.priorityBucket,
          priority_reason: candidate.priorityReason,
          pre_enrichment_evidence_fields: evidenceFields,
        });
        skippedReasons['enrichment_failed']++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown_error';
      failedCount++;
      entryByIndex.set(candidate.index, {
        domain,
        enriched: false,
        skip_reason: 'enrichment_failed',
        error: errMsg,
        priority_bucket: candidate.priorityBucket,
        priority_reason: candidate.priorityReason,
        pre_enrichment_evidence_fields: evidenceFields,
      });
      skippedReasons['enrichment_failed']++;
    }
  }

  // Q3F-5AV.2: reconstruir en el orden ORIGINAL de `results` — la
  // priorización solo afectó el orden de selección para enrichOrg, nunca
  // el orden final del array retornado.
  const updatedResults: WebSearchResult[] = results.map((result, index) => updatedResultByIndex.get(index) ?? result);
  const entries: EnrichmentEntryMeta[] = results.map((_, index) => entryByIndex.get(index) as EnrichmentEntryMeta);

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
    bucket_counts: bucketCounts,
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
    bucket_counts: {
      no_evidence: 0,
      has_evidence: 0,
      missing_domain: 0,
    },
  };
}
