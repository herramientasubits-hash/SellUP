/**
 * Source-Guided Investigation v1.12
 *
 * Generador determinístico de query packs por país/industria/subindustria.
 * Cada query pack representa intenciones comerciales de alta precisión que
 * guían la búsqueda hacia tipos concretos de empresas prospectables.
 *
 * NO hace llamadas externas.
 * NO usa Tavily, LLM, APIs.
 * Puramente determinístico.
 */

import type { SearchStrategyV1 } from './types';

export type SourceGuidedQueryPackItem = {
  query_text: string;
  query_source_key: string;
  query_type: 'source_guided';
  intent: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
};

export type SourceGuidedInvestigationInput = {
  countryCode: string;
  country: string;
  industry: string;
  subindustries: string[];
  searchStrategy: SearchStrategyV1;
  additionalCriteria?: string | null;
};

export type SourceGuidedInvestigationOutput = {
  enabled: boolean;
  version: 'source_guided_investigation_v1_12';
  generated_query_count: number;
  selected_query_count: number;
  source_guided_selected_count: number;
  fallback_selected_count: number;
  query_packs: SourceGuidedQueryPackItem[];
  blocked_source_query_count: number;
  blocked_sources: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function hasSubindustry(subindustries: string[], terms: string[]): boolean {
  const normalized = subindustries.map(normalizeKey);
  return normalized.some((s) => terms.some((t) => s.includes(t)));
}

function hasCriteria(criteria: string | null | undefined, terms: string[]): boolean {
  if (!criteria) return false;
  const normalized = normalizeKey(criteria);
  return terms.some((t) => normalized.includes(t));
}

// ─── Query packs por país/industria ──────────────────────────────────────────

/**
 * Query packs para Colombia + Tecnología.
 * Solo se generan cuando el source_key está permitido por la search strategy.
 */
const CO_TECH_QUERY_PACKS: SourceGuidedQueryPackItem[] = [
  // ── co_software_empresarial (virtual intent) ──
  // Software empresarial / ERP / CRM: 6 queries de alta precisión
  {
    query_text: 'empresa software ERP Colombia clientes corporativos sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'erp_crm_provider',
    priority: 'high',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'implementador ERP CRM Colombia servicios implementacion sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'implementation_provider',
    priority: 'high',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'software nomina recursos humanos Colombia empresas plataforma sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'hr_learning_tech',
    priority: 'high',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'plataforma LMS corporativa Colombia empresas aprendizaje sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'lms_corporate_training',
    priority: 'high',
    reason: 'edtech_subindustry',
  },
  {
    query_text: 'software empresarial Colombia casos clientes corporativos sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'enterprise_use_case',
    priority: 'high',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'proveedor SaaS empresarial Colombia ERP CRM soluciones sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'platform_vendor',
    priority: 'medium',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'software administrativo facturacion Colombia empresas corporativo sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'erp_crm_provider',
    priority: 'medium',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'empresa software gestion talento nomina Colombia plataforma sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'hr_learning_tech',
    priority: 'medium',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'empresa software facturacion electronica Colombia clientes corporativos sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'erp_crm_provider',
    priority: 'medium',
    reason: 'software_enterprise_subindustry',
  },
  {
    query_text: 'empresa BI business intelligence Colombia soluciones corporativas sitio oficial',
    query_source_key: 'co_software_empresarial',
    query_type: 'source_guided',
    intent: 'enterprise_use_case',
    priority: 'medium',
    reason: 'software_enterprise_subindustry',
  },
];

/**
 * Query packs para Colombia + Tecnología + Fintech.
 * Solo se generan cuando fintech signal está activa.
 */
const CO_TECH_FINTECH_QUERY_PACKS: SourceGuidedQueryPackItem[] = [
  {
    query_text: 'fintech pagos Colombia empresa plataforma transacciones sitio oficial',
    query_source_key: 'co_colombia_fintech',
    query_type: 'source_guided',
    intent: 'product_category',
    priority: 'high',
    reason: 'fintech_signal_active',
  },
  {
    query_text: 'open banking Colombia plataforma API financiera empresa sitio oficial',
    query_source_key: 'co_colombia_fintech',
    query_type: 'source_guided',
    intent: 'enterprise_use_case',
    priority: 'high',
    reason: 'fintech_signal_active',
  },
  {
    query_text: 'empresa fintech Colombia prestamos digitales creditos plataforma sitio oficial',
    query_source_key: 'co_colombia_fintech',
    query_type: 'source_guided',
    intent: 'product_category',
    priority: 'medium',
    reason: 'fintech_signal_active',
  },
];

/**
 * Query packs para Colombia + B2G.
 * Solo se generan cuando B2G signal está activa.
 */
const CO_B2G_QUERY_PACKS: SourceGuidedQueryPackItem[] = [
  {
    query_text: 'proveedor tecnologia sector publico Colombia software gobierno sitio oficial',
    query_source_key: 'co_secop2_proveedores',
    query_type: 'source_guided',
    intent: 'source_guided_government_proc',
    priority: 'high',
    reason: 'b2g_signal_active',
  },
  {
    query_text: 'empresa contratacion publica Colombia software licitaciones gobierno sitio oficial',
    query_source_key: 'co_secop2_proveedores',
    query_type: 'source_guided',
    intent: 'source_guided_government_proc',
    priority: 'medium',
    reason: 'b2g_signal_active',
  },
];

/**
 * Query packs para Colombia + ANDICOM explícito en additionalCriteria.
 */
const CO_ANDICOM_QUERY_PACKS: SourceGuidedQueryPackItem[] = [
  {
    query_text: 'expositor ANDICOM CINTEL Colombia TIC empresa software sitio oficial',
    query_source_key: 'co_andicom',
    query_type: 'source_guided',
    intent: 'source_guided_industry_assoc',
    priority: 'low',
    reason: 'andicom_contextual_signal',
  },
  {
    query_text: 'sponsor ANDICOM CINTEL congreso TIC Colombia empresa tecnologia sitio oficial',
    query_source_key: 'co_andicom',
    query_type: 'source_guided',
    intent: 'source_guided_industry_assoc',
    priority: 'low',
    reason: 'andicom_contextual_signal',
  },
];

// ─── Detección de señales ────────────────────────────────────────────────────

const EDTECH_TERMS = ['edtech', 'ed-tech', 'aprendizaje', 'educativo', 'learning', 'lms', 'capacitacion corporativa', 'plataforma educativa'];

const SOFTWARE_EMPRESARIAL_TERMS = ['software empresarial', 'erp', 'crm', 'saas', 'software', 'empresarial'];

const FINTECH_SUBINDUSTRY_TERMS = ['fintech', 'pagos', 'payment', 'open banking', 'open finance', 'wallet', 'adquirenci', 'banca', 'financial_technology', 'infraestructura financiera'];

const B2G_TERMS = ['gobierno', 'estado', 'publico', 'b2g', 'licitacion', 'contratacion estatal', 'proveedor estatal', 'sector publico', 'entidad publica', 'compra publica'];

const ANDICOM_TERMS = ['andicom', 'cintel', 'expositores', 'sponsors', 'evento tic', 'congreso tic'];

function detectFintechSignal(subindustries: string[], additionalCriteria: string | null | undefined): boolean {
  return hasSubindustry(subindustries, FINTECH_SUBINDUSTRY_TERMS) || hasCriteria(additionalCriteria, FINTECH_SUBINDUSTRY_TERMS);
}

function detectB2GSignal(additionalCriteria: string | null | undefined): boolean {
  return hasCriteria(additionalCriteria, B2G_TERMS);
}

function detectAndicomSignal(additionalCriteria: string | null | undefined): boolean {
  return hasCriteria(additionalCriteria, ANDICOM_TERMS);
}

function isTechOrSoftwareIndustry(industry: string): boolean {
  const n = normalizeKey(industry);
  return n.includes('tecnologia') || n.includes('tecnología') || n.includes('tech') ||
    n.includes('software') || n.includes('tic') || n.includes('ti');
}

// ─── Mapa de fuentes bloqueadas para metadata ────────────────────────────────

const NEVER_DISCOVERY_KEYS = [
  'co_rues',
  'co_personas_juridicas_cc',
  'co_siis',
];

const CONDITIONAL_DISCOVERY_KEYS = [
  'co_secop2',
  'co_secop2_proveedores',
  'co_colombia_fintech',
  'co_andicom',
];

// ─── Builder principal ───────────────────────────────────────────────────────

/**
 * Construye query packs de source-guided investigation para una combinación
 * de país/industria/subindustria.
 *
 * Reglas:
 * - co_rues, co_personas_juridicas_cc, co_siis: nunca generan queries
 * - co_secop2_proveedores: solo con señal B2G
 * - co_colombia_fintech: solo con señal fintech
 * - co_andicom: solo con mención explícita ANDICOM/CINTEL
 * - co_software_empresarial: siempre para CO + Tecnología
 *
 * La search strategy actúa como guardia adicional vía filterQueriesByStrategy.
 */
export function buildSourceGuidedInvestigationQueries(
  input: SourceGuidedInvestigationInput,
): SourceGuidedInvestigationOutput {
  const { countryCode, industry, subindustries, searchStrategy, additionalCriteria } = input;

  const code = countryCode.toUpperCase().trim();
  const allPacks: SourceGuidedQueryPackItem[] = [];

  // Solo implementado para Colombia inicialmente
  if (code !== 'CO') {
    return {
      enabled: false,
      version: 'source_guided_investigation_v1_12',
      generated_query_count: 0,
      selected_query_count: 0,
      source_guided_selected_count: 0,
      fallback_selected_count: 0,
      query_packs: [],
      blocked_source_query_count: 0,
      blocked_sources: [],
    };
  }

  // Solo implementado para Tecnología/Software
  if (!isTechOrSoftwareIndustry(industry)) {
    return {
      enabled: false,
      version: 'source_guided_investigation_v1_12',
      generated_query_count: 0,
      selected_query_count: 0,
      source_guided_selected_count: 0,
      fallback_selected_count: 0,
      query_packs: [],
      blocked_source_query_count: 0,
      blocked_sources: [],
    };
  }

  // 1. co_software_empresarial: siempre para CO + Tecnología
  allPacks.push(...CO_TECH_QUERY_PACKS);

  // 2. co_colombia_fintech: solo con señal fintech explícita
  const fintechSignal = detectFintechSignal(subindustries, additionalCriteria);
  if (fintechSignal) {
    allPacks.push(...CO_TECH_FINTECH_QUERY_PACKS);
  }

  // 3. SECOP/B2G: solo con señal B2G explícita
  const b2gSignal = detectB2GSignal(additionalCriteria);
  if (b2gSignal) {
    allPacks.push(...CO_B2G_QUERY_PACKS);
  }

  // 4. ANDICOM: solo con mención explícita en additionalCriteria
  const andicomSignal = detectAndicomSignal(additionalCriteria);
  if (andicomSignal) {
    allPacks.push(...CO_ANDICOM_QUERY_PACKS);
  }

  // ─── Filtrar por search strategy ───────────────────────────────────────────
  const allowed: SourceGuidedQueryPackItem[] = [];
  const blockedSources: Set<string> = new Set();

  for (const pack of allPacks) {
    if (searchStrategy.queryStrategy.blockedSourceKeys.includes(pack.query_source_key)) {
      blockedSources.add(pack.query_source_key);
    } else {
      allowed.push(pack);
    }
  }

  // ─── Ordenar por prioridad ─────────────────────────────────────────────────
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  allowed.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    enabled: true,
    version: 'source_guided_investigation_v1_12',
    generated_query_count: allPacks.length,
    selected_query_count: allowed.length,
    source_guided_selected_count: allowed.length,
    fallback_selected_count: 0,
    query_packs: allowed,
    blocked_source_query_count: blockedSources.size,
    blocked_sources: [...blockedSources].sort(),
  };
}

/**
 * Obtiene queries source-guided para una ronda específica desde el output
 * de buildSourceGuidedInvestigationQueries.
 * Incluye solo las queries de alta y media prioridad en R1, todas en R2.
 */
export function getSourceGuidedQueriesForRound(
  investigation: SourceGuidedInvestigationOutput,
  round: 1 | 2,
): string[] {
  if (!investigation.enabled || investigation.query_packs.length === 0) return [];

  const allowedPriorities = round === 1 ? ['high', 'medium'] : ['high', 'medium', 'low'];

  return investigation.query_packs
    .filter((q) => allowedPriorities.includes(q.priority))
    .map((q) => q.query_text);
}

/**
 * Encuentra el source_key para una query de source-guided investigation.
 * Útil para que classifyQuery pueda reconocer las nuevas queries.
 */
export function findSourceKeyForQuery(
  investigation: SourceGuidedInvestigationOutput,
  queryText: string,
): string | null {
  if (!investigation.enabled) return null;
  const match = investigation.query_packs.find((q) => q.query_text === queryText);
  return match?.query_source_key ?? null;
}
