/**
 * Query Planner — Novelty-Aware Discovery (Hito 16AB.43.24)
 *
 * Complementa al query-builder añadiendo:
 *   - Metadata de familia de query (lms_corporate_training, case_study, etc.)
 *   - Decisiones de source gating (co_colombia_fintech, co_secop2, etc.)
 *   - Estrategia de ronda 2 (broaden_angle cuando R1 tiene bajo persistable)
 *
 * Puramente determinístico — sin I/O, sin llamadas externas.
 * No reemplaza query-builder: lo anota y extiende.
 */

import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
} from './query-builder';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type QueryFamily =
  | 'lms_corporate_training'
  | 'erp_crm_provider'
  | 'product_category'
  | 'enterprise_use_case'
  | 'regional_city'
  | 'case_study'
  | 'partner_ecosystem'
  | 'implementation_provider'
  | 'hr_learning_tech'
  | 'software_factory'
  | 'platform_vendor'
  | 'source_guided_industry_assoc'
  | 'source_guided_government_proc'
  | 'general';

export type QueryNoveltyStrategy =
  | 'baseline'
  | 'avoid_seen_domains'
  | 'broaden_angle'
  | 'source_shift';

export type PlannedQuery = {
  query_text: string;
  query_type: 'standard' | 'source_guided' | 'diversification';
  query_family: QueryFamily;
  round_number: 1 | 2;
  novelty_strategy: QueryNoveltyStrategy;
};

export type SourceGatingDecision = {
  source_key: string;
  allowed: boolean;
  reason: string;
};

export type DiscoveryQueryPlan = {
  round1_queries: PlannedQuery[];
  round2_queries: PlannedQuery[];
  round2_strategy: QueryNoveltyStrategy;
  round2_trigger: string;
  source_gating_decisions: SourceGatingDecision[];
  families_r1: QueryFamily[];
  families_r2: QueryFamily[];
  secop_excluded: boolean;
};

// ─── Helpers de detección ─────────────────────────────────────────────────────

function normalizeForDetection(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** True si al menos una subindustria es fintech/pagos. */
function hasFintechSubindustry(subindustries: string[]): boolean {
  return subindustries.some((s) => {
    const n = normalizeForDetection(s);
    return n.includes('fintech') || n.includes('pagos') || n.includes('payment');
  });
}

/** True si hay contexto de gobierno/contratación pública en subindustrias o criteria. */
function hasGovernmentContext(subindustries: string[], additionalCriteria: string | null): boolean {
  const governmentTerms = [
    'gobierno', 'government', 'publico', 'estado', 'contratacion',
    'secop', 'b2g', 'entidades', 'sector publico', 'licitacion',
  ];
  const allText = normalizeForDetection(
    [...subindustries, additionalCriteria ?? ''].join(' '),
  );
  return governmentTerms.some((t) => allText.includes(t));
}

/** True si el contexto es EdTech o SaaS/ERP/CRM sin gobierno. */
function isEdTechOrSaasContext(subindustries: string[]): boolean {
  const edtechSaasTerms = ['edtech', 'ed-tech', 'saas', 'erp', 'crm', 'plataforma'];
  return subindustries.some((s) => {
    const n = normalizeForDetection(s);
    return edtechSaasTerms.some((t) => n.includes(t));
  });
}

// ─── Clasificación de queries existentes a familias ───────────────────────────

function classifyQueryToFamily(queryText: string): QueryFamily {
  const q = normalizeForDetection(queryText);

  if (q.includes('fedesoft')) return 'source_guided_industry_assoc';
  if (q.includes('colombia fintech') || q.includes('fintech asociadas')) return 'source_guided_industry_assoc';
  if (q.includes('andicom')) return 'partner_ecosystem';
  if (q.includes('secop')) return 'source_guided_government_proc';

  if (q.includes('lms') || q.includes('aprendizaje corporativo') || q.includes('tecnologia educativa') || q.includes('e-learning')) return 'lms_corporate_training';
  if (q.includes('erp') || q.includes('crm') || q.includes('nomina') || q.includes('gestion')) return 'erp_crm_provider';
  if (q.includes('ciberseguridad') || q.includes('cibersecurity') || q.includes('proteccion datos')) return 'enterprise_use_case';
  if (q.includes('cloud') || q.includes('infraestructura') || q.includes('servicios ti')) return 'enterprise_use_case';
  if (q.includes('medellin') || q.includes('cali') || q.includes('bogota') || q.includes('barranquilla')) return 'regional_city';
  if (q.includes('caso') || q.includes('case') || q.includes('caso de exito')) return 'case_study';
  if (q.includes('implementador') || q.includes('implementaci')) return 'implementation_provider';
  if (q.includes('hr tech') || q.includes('hr-tech') || q.includes('recursos humanos')) return 'hr_learning_tech';
  if (q.includes('nearshore') || q.includes('offshore') || q.includes('fabrica')) return 'software_factory';
  if (q.includes('saas') || q.includes('plataforma') || q.includes('partner')) return 'platform_vendor';

  return 'product_category';
}

// ─── Construcción del plan ────────────────────────────────────────────────────

/**
 * Construye un plan de queries anotado con familias, estrategia y source gating.
 *
 * Las queries de texto son las mismas que producen buildCleanMultiQueryDiscoveryQueries
 * y buildExpandedMultiQueryDiscoveryQueries. El planner añade metadata semántica
 * sin cambiar los textos base.
 *
 * Decisiones de source gating:
 *   co_colombia_fintech → solo si fintech subindustry
 *   co_secop2           → solo si gobierno/contratación pública
 *   co_fedesoft         → permitido para tecnología/software
 *   co_andicom          → permitido para tecnología (con cuidado de ruido)
 *   co_microsoft_partners → reclasificado manual_signal_only (sin NIT, sin API), no usar como source-guided query
 */
export function buildDiscoveryQueryPlan(params: {
  industry: string;
  country: string;
  subindustries: string[];
  additionalCriteria: string | null;
  round1PersistableCount?: number;
  minPersistableThreshold?: number;
}): DiscoveryQueryPlan {
  const {
    industry,
    country,
    subindustries,
    additionalCriteria,
    round1PersistableCount,
    minPersistableThreshold = 3,
  } = params;

  const includeFintech = subindustries.length === 0 || hasFintechSubindustry(subindustries);
  const includeSecop = hasGovernmentContext(subindustries, additionalCriteria);
  const secopExcluded = !includeSecop;

  // Source gating decisions (trazabilidad)
  const sourceGatingDecisions: SourceGatingDecision[] = [
    {
      source_key: 'co_colombia_fintech',
      allowed: includeFintech,
      reason: includeFintech
        ? 'subindustry_fintech_present_or_general_search'
        : 'subindustry_not_fintech',
    },
    {
      source_key: 'co_secop2',
      allowed: includeSecop,
      reason: includeSecop
        ? 'government_context_detected'
        : 'non_government_subindustry_default_exclude',
    },
    {
      source_key: 'co_fedesoft',
      allowed: true,
      reason: 'tech_software_industry_always_allowed',
    },
    {
      source_key: 'co_andicom',
      allowed: true,
      reason: 'tech_industry_allowed_with_event_noise_filter',
    },
  ];

  // Determinar estrategia de R2
  const r2NeedsNewAngle =
    round1PersistableCount !== undefined && round1PersistableCount < minPersistableThreshold;
  const round2Strategy: QueryNoveltyStrategy = r2NeedsNewAngle ? 'broaden_angle' : 'baseline';
  const round2Trigger = r2NeedsNewAngle
    ? `low_persistable_after_novelty (${round1PersistableCount} < ${minPersistableThreshold})`
    : 'standard_second_round';

  // Generar queries R1 (usa builder existente con gating de SECOP implícito via excluir SECOP de R1)
  const r1Texts = buildCleanMultiQueryDiscoveryQueries(industry, country, subindustries);
  const round1Queries: PlannedQuery[] = r1Texts.map((q) => ({
    query_text: q,
    query_type: (q.toLowerCase().includes('fedesoft') || q.toLowerCase().includes('colombia fintech'))
      ? 'source_guided'
      : 'standard',
    query_family: classifyQueryToFamily(q),
    round_number: 1 as const,
    novelty_strategy: 'baseline' as const,
  }));

  // Generar queries R2 (usa builder con SECOP gating explícito)
  const excludeSources = secopExcluded ? ['co_secop2'] : [];
  const r2Texts = buildExpandedMultiQueryDiscoveryQueries(
    industry,
    country,
    subindustries,
    { excludeSources },
  );
  const round2Queries: PlannedQuery[] = r2Texts.map((q) => ({
    query_text: q,
    query_type: (
      q.toLowerCase().includes('andicom') ||
      q.toLowerCase().includes('secop') ||
      q.toLowerCase().includes('implementador software')
    )
      ? 'source_guided'
      : 'standard',
    query_family: classifyQueryToFamily(q),
    round_number: 2 as const,
    novelty_strategy: round2Strategy,
  }));

  const familiesR1 = [...new Set(round1Queries.map((q) => q.query_family))];
  const familiesR2 = [...new Set(round2Queries.map((q) => q.query_family))];

  return {
    round1_queries: round1Queries,
    round2_queries: round2Queries,
    round2_strategy: round2Strategy,
    round2_trigger: round2Trigger,
    source_gating_decisions: sourceGatingDecisions,
    families_r1: familiesR1,
    families_r2: familiesR2,
    secop_excluded: secopExcluded,
  };
}

/**
 * Determina si hay estrategia de diversificación disponible para una ronda adicional.
 * True cuando R2 usa al menos una familia distinta de las usadas en R1.
 */
export function hasDiversificationAvailable(plan: DiscoveryQueryPlan): boolean {
  const r1Set = new Set(plan.families_r1);
  return plan.families_r2.some((f) => !r1Set.has(f));
}
