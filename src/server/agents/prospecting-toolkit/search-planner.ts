/**
 * Search Planner v0 — Discovery Intent Planning (Hito 16AC)
 *
 * Capa explícita de planificación antes de ejecutar queries Tavily.
 * Produce un objeto estructurado que documenta la estrategia de búsqueda,
 * source strategy, query families y políticas de evidencia.
 *
 * Reglas clave:
 * - RUES nunca aparece como fuente primaria de discovery (solo legal_validation_future).
 * - Blogs, landings, foros, glosarios y marketplaces son bloqueados como source types.
 * - Tamaño desconocido no bloquea: avanza a revisión humana (unknown_allowed_for_manual_review).
 * - Gate de tamaño NO implementado en v0; la política queda registrada para uso futuro.
 *
 * Puramente determinístico — sin I/O, sin llamadas externas.
 * Compatible con el flujo actual: no cambia queries ni gates existentes.
 */

import { buildDiscoveryQueryPlan } from './query-planner';
import type { QueryFamily } from './query-planner';
import type { SearchDepth } from './types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type SearchDiscoveryMode = 'exploratory';

export type AllowedSourceType =
  | 'official_company_site'
  | 'industry_association'
  | 'sector_directory'
  | 'customer_case_study'
  | 'trusted_business_database'
  | 'linkedin_company'
  | 'corporate_locations_page';

export type BlockedSourceType =
  | 'blog'
  | 'generic_article'
  | 'marketplace'
  | 'forum'
  | 'glossary'
  | 'landing_page'
  | 'job_board'
  | 'social_post'
  | 'generic_partner_page';

export type SourceApproach = 'hybrid_sector_signal_and_web_validation';

export type SourceStrategy = {
  primaryDiscoveryApproach: SourceApproach;
  /** Fuentes explícitamente excluidas de discovery primario. */
  doNotUseAsPrimary: string[];
  allowedSourceTypes: AllowedSourceType[];
  blockedSourceTypes: BlockedSourceType[];
};

export type QueryFamilyPriority = 'high' | 'medium' | 'low';

export type QueryFamilyPlan = {
  key: string;
  family: QueryFamily;
  intent: string;
  priority: QueryFamilyPriority;
  queryCount: number;
  round: 1 | 2;
  queries: string[];
};

export type EmployeeCountPolicy =
  | 'unknown_allowed_for_manual_review'
  | 'require_confirmed_minimum';

export type MinimumEvidencePolicy = {
  requiresOfficialDomain: boolean;
  requiresCountrySignal: boolean;
  requiresBusinessActivitySignal: boolean;
  requiresCanonicalIndustry: boolean;
  employeeCountPolicy: EmployeeCountPolicy;
  employeeCountThreshold: number;
  employeeCountNote: string;
};

export type NegativeMemoryPolicy = {
  respectDiscardedRejectedBlockedWithinDays: number;
  blockCandidatesWithNullReviewedAt: boolean;
};

export type SizePolicyStatus = 'not_blocking';

export type SizePolicy = {
  status: SizePolicyStatus;
  gateImplemented: boolean;
  thresholdMinEmployees: number;
  unknownAllowed: boolean;
  unknownRequiresHumanReview: true;
  unknownSizeStatus: 'unknown';
  note: string;
};

export type SearchPlanMetadata = {
  planVersion: 'search_planner_v0';
  generatedAt: string;
  searchDepth: SearchDepth;
  targetCount: number;
  secopExcluded: boolean;
  round1QueryCount: number;
  round2QueryCount: number;
  queryFamiliesR1: QueryFamily[];
  queryFamiliesR2: QueryFamily[];
};

export type SearchPlanV0 = {
  mode: SearchDiscoveryMode;
  countryCode: string;
  countryName: string;
  canonicalIndustry: string;
  subindustries: string[];
  additionalCriteria: string | null;
  sourceStrategy: SourceStrategy;
  queryFamilies: QueryFamilyPlan[];
  minimumEvidencePolicy: MinimumEvidencePolicy;
  negativeMemoryPolicy: NegativeMemoryPolicy;
  sizePolicy: SizePolicy;
  metadata: SearchPlanMetadata;
};

export type SearchPlanInput = {
  country: string;
  countryCode: string;
  industry: string;
  subindustries?: string[];
  additionalCriteria?: string | null;
  targetCount?: number;
  searchDepth?: SearchDepth;
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const ALLOWED_SOURCE_TYPES: AllowedSourceType[] = [
  'official_company_site',
  'industry_association',
  'sector_directory',
  'customer_case_study',
  'trusted_business_database',
  'linkedin_company',
  'corporate_locations_page',
];

const BLOCKED_SOURCE_TYPES: BlockedSourceType[] = [
  'blog',
  'generic_article',
  'marketplace',
  'forum',
  'glossary',
  'landing_page',
  'job_board',
  'social_post',
  'generic_partner_page',
];

const QUERY_FAMILY_INTENTS: Record<QueryFamily, string> = {
  lms_corporate_training: 'find LMS and corporate e-learning platforms',
  erp_crm_provider: 'find ERP, CRM and HRIS providers',
  product_category: 'find companies by product category in the sector',
  enterprise_use_case: 'find companies addressing enterprise use cases',
  regional_city: 'confirm operation in target country by city or region',
  case_study: 'find companies through case studies and success stories',
  partner_ecosystem: 'find companies through partner and ecosystem signals',
  implementation_provider: 'find implementation and consulting providers',
  hr_learning_tech: 'find HR technology and learning tech companies',
  software_factory: 'find software factories and nearshore providers',
  platform_vendor: 'find SaaS platform vendors',
  source_guided_industry_assoc: 'find companies through trusted industry associations',
  source_guided_government_proc: 'find companies through public procurement signals',
  general: 'general company discovery in the sector',
};

function getQueryFamilyPriority(family: QueryFamily, round: 1 | 2): QueryFamilyPriority {
  if (round === 1) {
    if (family === 'source_guided_industry_assoc') return 'high';
    if (family === 'erp_crm_provider') return 'high';
    if (family === 'enterprise_use_case') return 'high';
    return 'medium';
  }
  // Round 2 is broader/diversification — generally lower priority
  if (family === 'regional_city') return 'medium';
  return 'low';
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Construye un Search Plan v0 estructurado antes de ejecutar queries de búsqueda.
 *
 * El plan documenta la estrategia de discovery sin ejecutar ninguna búsqueda real.
 * Delega la construcción de queries al query-planner existente (sin duplicar lógica).
 *
 * RUES queda explícitamente en doNotUseAsPrimary — solo sirve para validación legal futura
 * una vez que el candidato ya tiene señales de fit comercial.
 */
export function buildSearchPlan(input: SearchPlanInput): SearchPlanV0 {
  const {
    country,
    countryCode,
    industry,
    subindustries = [],
    additionalCriteria = null,
    targetCount = 10,
    searchDepth = 'standard',
  } = input;

  const discoveryPlan = buildDiscoveryQueryPlan({
    industry,
    country,
    subindustries,
    additionalCriteria,
  });

  // Agrupar queries en familias por ronda
  const familyPlanMap = new Map<string, QueryFamilyPlan>();

  for (const q of discoveryPlan.round1_queries) {
    const key = `${q.query_family}_r1`;
    if (!familyPlanMap.has(key)) {
      familyPlanMap.set(key, {
        key,
        family: q.query_family,
        intent: QUERY_FAMILY_INTENTS[q.query_family],
        priority: getQueryFamilyPriority(q.query_family, 1),
        queryCount: 0,
        round: 1,
        queries: [],
      });
    }
    const plan = familyPlanMap.get(key)!;
    plan.queryCount++;
    plan.queries.push(q.query_text);
  }

  for (const q of discoveryPlan.round2_queries) {
    const key = `${q.query_family}_r2`;
    if (!familyPlanMap.has(key)) {
      familyPlanMap.set(key, {
        key,
        family: q.query_family,
        intent: QUERY_FAMILY_INTENTS[q.query_family],
        priority: getQueryFamilyPriority(q.query_family, 2),
        queryCount: 0,
        round: 2,
        queries: [],
      });
    }
    const plan = familyPlanMap.get(key)!;
    plan.queryCount++;
    plan.queries.push(q.query_text);
  }

  const queryFamilies = Array.from(familyPlanMap.values());

  return {
    mode: 'exploratory',
    countryCode,
    countryName: country,
    canonicalIndustry: industry,
    subindustries,
    additionalCriteria,
    sourceStrategy: {
      primaryDiscoveryApproach: 'hybrid_sector_signal_and_web_validation',
      doNotUseAsPrimary: ['RUES', 'co_rues'],
      allowedSourceTypes: ALLOWED_SOURCE_TYPES,
      blockedSourceTypes: BLOCKED_SOURCE_TYPES,
    },
    queryFamilies,
    minimumEvidencePolicy: {
      requiresOfficialDomain: true,
      requiresCountrySignal: true,
      requiresBusinessActivitySignal: true,
      requiresCanonicalIndustry: true,
      employeeCountPolicy: 'unknown_allowed_for_manual_review',
      employeeCountThreshold: 200,
      employeeCountNote:
        'Candidatos con tamaño desconocido avanzan a revisión humana. ' +
        'size_status=unknown, requires_human_review=true. ' +
        'Confianza no puede ser Alta solo por inferencia de tamaño.',
    },
    negativeMemoryPolicy: {
      respectDiscardedRejectedBlockedWithinDays: 90,
      blockCandidatesWithNullReviewedAt: true,
    },
    sizePolicy: {
      status: 'not_blocking',
      gateImplemented: false,
      thresholdMinEmployees: 200,
      unknownAllowed: true,
      unknownRequiresHumanReview: true,
      unknownSizeStatus: 'unknown',
      note:
        'Gate de tamaño no implementado en v0. ' +
        'employee_count <= 200 → futuro descarte (ICP mínimo). ' +
        'employee_count desconocido → revisión humana requerida.',
    },
    metadata: {
      planVersion: 'search_planner_v0',
      generatedAt: new Date().toISOString(),
      searchDepth,
      targetCount,
      secopExcluded: discoveryPlan.secop_excluded,
      round1QueryCount: discoveryPlan.round1_queries.length,
      round2QueryCount: discoveryPlan.round2_queries.length,
      queryFamiliesR1: discoveryPlan.families_r1,
      queryFamiliesR2: discoveryPlan.families_r2,
    },
  };
}
