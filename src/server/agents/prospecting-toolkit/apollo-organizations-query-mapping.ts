/**
 * Apollo Organizations Query Mapping (v1.L2.7)
 *
 * Transforma criterios SellUp wizard → parámetros estructurados Apollo Organizations.
 *
 * Historial de correcciones:
 *   v1.16K-AA — usar q_keywords (no q_organization_name) para texto libre.
 *   v1.16K-AB — reordenar keywords educación: señales específicas primero.
 *   v1.L2.7   — subindustria con prioridad sobre sector padre.
 *               additionalCriteriaTokens del wizard fluyen a q_keywords.
 *               Metadata extendida con campos de diagnóstico L2.7.
 *
 * Estrategia de keyword building (L2.7):
 *   1. Subindustria → keywords específicas (SUBINDUSTRY_KEYWORD_MAP). Prioridad máxima.
 *   2. Sector padre → keywords generales (SECTOR_KEYWORD_MAP). Fallback si no hay subindustria.
 *   3. additionalCriteriaTokens → señales del usuario. Se agregan tras las keywords sectoriales,
 *      antes de keywords genéricas del sector.
 *   4. País siempre en organization_locations — nunca en q_keywords.
 *   5. q_organization_name vacío — Apollo lo interpreta como nombre exacto de empresa.
 *
 * Reglas:
 *   - Puro: sin side effects, sin llamadas externas.
 *   - No modifica apollo-client.ts ni SearchOrganizationsParams.
 *   - Solo usa campos que SearchOrganizationsParams ya soporta.
 *   - No guarda API keys ni headers en metadata.
 *   - Tavily no importa este módulo.
 */

import type { SearchOrganizationsParams } from '@/server/integrations/apollo-client';
import type { WebSearchInput } from './types';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_QUERY_MAPPING_VERSION = 'v1.L2.7';

// ─── Subindustria → keywords Apollo ──────────────────────────────────────────

/**
 * Mapa de subindustrias canónicas SellUp a keywords Apollo específicas.
 *
 * Prioridad sobre SECTOR_KEYWORD_MAP cuando hay subindustria.
 * Términos en inglés primero (Apollo indexa en inglés); variantes en español al final.
 * Keys normalizadas: sin acentos, minúsculas.
 */
const SUBINDUSTRY_KEYWORD_MAP: Record<string, string[]> = {
  // ── Educación ──────────────────────────────────────────────────────────────
  'educacion corporativa': [
    'corporate training', 'corporate learning', 'learning management system',
    'lms', 'workforce training', 'formacion corporativa', 'capacitacion empresarial',
  ],
  'formacion corporativa': [
    'corporate training', 'corporate learning', 'learning management system',
    'lms', 'workforce training', 'formacion corporativa', 'capacitacion empresarial',
  ],
  'lms': [
    'learning management system', 'lms', 'e-learning platform', 'online learning platform',
    'corporate training software', 'learning platform',
  ],
  'e-learning': [
    'e-learning', 'online learning', 'digital learning', 'elearning platform',
    'virtual training', 'educacion virtual',
  ],
  'educacion virtual': [
    'online learning', 'virtual learning', 'e-learning', 'digital education',
    'educacion virtual', 'capacitacion virtual',
  ],
  'capacitacion comercial': [
    'sales training', 'commercial training', 'sales enablement',
    'capacitacion en ventas', 'formacion comercial',
  ],
  // ── Tecnología ─────────────────────────────────────────────────────────────
  'software empresarial': [
    'enterprise software', 'business software', 'ERP', 'software empresarial', 'SaaS B2B',
  ],
  'erp': [
    'ERP', 'enterprise resource planning', 'business management software',
    'ERP system', 'erp software',
  ],
  'crm': [
    'CRM', 'customer relationship management', 'sales CRM',
    'crm software', 'customer management',
  ],
  'ciberseguridad': [
    'cybersecurity', 'information security', 'network security',
    'data protection', 'ciberseguridad',
  ],
  'cloud': [
    'cloud services', 'cloud computing', 'cloud infrastructure',
    'SaaS', 'cloud solutions',
  ],
  'data analytics': [
    'data analytics', 'business intelligence', 'BI', 'data science',
    'analytics platform', 'analisis de datos',
  ],
  'saas b2b': [
    'SaaS B2B', 'B2B software', 'enterprise SaaS', 'business software',
    'software as a service B2B',
  ],
  // ── Salud ──────────────────────────────────────────────────────────────────
  'salud ocupacional': [
    'occupational health', 'workplace safety', 'health and safety',
    'HSE', 'salud ocupacional', 'seguridad laboral',
  ],
  'seguridad y salud en el trabajo': [
    'occupational health and safety', 'HSE', 'workplace safety',
    'OSHAS', 'seguridad y salud ocupacional', 'SG-SST',
  ],
  'clinicas': [
    'clinic', 'outpatient clinic', 'medical clinic',
    'healthcare clinic', 'clinica medica',
  ],
  'laboratorios': [
    'medical laboratory', 'clinical laboratory', 'diagnostics lab',
    'laboratorio clinico', 'laboratorio medico',
  ],
  // ── Finanzas ───────────────────────────────────────────────────────────────
  'fintech b2b': [
    'fintech B2B', 'B2B fintech', 'financial technology B2B',
    'enterprise fintech', 'fintech empresarial',
  ],
  'pagos': [
    'payments', 'payment processing', 'payment gateway',
    'pagos digitales', 'medios de pago',
  ],
  'seguros': [
    'insurance', 'insurance services', 'insurtech',
    'seguros empresariales', 'seguros corporativos',
  ],
  'banca empresarial': [
    'corporate banking', 'business banking', 'commercial banking',
    'banca corporativa', 'servicios bancarios empresariales',
  ],
  // ── Manufactura ────────────────────────────────────────────────────────────
  'textil': [
    'textile', 'apparel', 'clothing manufacturing',
    'textil', 'industria textil',
  ],
  'automotriz': [
    'automotive', 'auto parts', 'vehicle manufacturing',
    'automotriz', 'partes automotrices',
  ],
  'packaging': [
    'packaging', 'industrial packaging', 'container packaging',
    'empaques', 'envases industriales',
  ],
  'manufactura avanzada': [
    'advanced manufacturing', 'smart manufacturing', 'Industry 4.0',
    'manufactura avanzada', 'manufactura inteligente',
  ],
};

// ─── Sector → keywords Apollo ─────────────────────────────────────────────────

/**
 * Mapa conservador de sectores SellUp a keywords Apollo.
 * Solo se usa cuando no hay subindustria con mapping más específico.
 *
 * v1.16K-AB: reordenado — señales específicas primero para slice(0,5) preciso.
 */
const SECTOR_KEYWORD_MAP: Record<string, string[]> = {
  educación: [
    'learning management system',
    'lms',
    'corporate training',
    'e-learning',
    'online learning',
    'formación corporativa',
    'capacitación',
    'educación virtual',
    'education management',
    'higher education',
    'education',
  ],
  tecnología: [
    'technology', 'software', 'IT services', 'SaaS', 'cloud',
    'digital transformation', 'tecnología',
  ],
  salud: [
    'healthcare', 'health', 'medical', 'pharma', 'salud', 'medicamentos',
  ],
  finanzas: [
    'financial services', 'banking', 'insurance', 'fintech', 'finanzas',
  ],
  manufactura: [
    'manufacturing', 'industrial', 'fabrication', 'manufactura', 'industria',
  ],
  retail: [
    'retail', 'commerce', 'ecommerce', 'retail chain', 'comercio',
  ],
  logística: [
    'logistics', 'supply chain', 'transportation', 'warehousing', 'logística',
  ],
  construcción: [
    'construction', 'real estate', 'engineering', 'construcción', 'ingeniería',
  ],
  energía: [
    'energy', 'oil', 'gas', 'mining', 'utilities', 'energía',
  ],
  telecomunicaciones: [
    'telecommunications', 'telecom', 'internet services', 'telco',
  ],
};

// ─── Normalize helpers ─────────────────────────────────────────────────────────

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

// ─── Lookup functions ─────────────────────────────────────────────────────────

/**
 * Busca keywords Apollo para una subindustria canónica.
 * Retorna array vacío si no hay mapping explícito para esta subindustria.
 */
export function getSubindustryKeywords(subindustry: string | null | undefined): string[] {
  if (!subindustry?.trim()) return [];
  const normalized = normalizeKey(subindustry);
  for (const [key, keywords] of Object.entries(SUBINDUSTRY_KEYWORD_MAP)) {
    if (normalized === normalizeKey(key) || normalized.includes(normalizeKey(key)) || normalizeKey(key).includes(normalized)) {
      return keywords;
    }
  }
  return [];
}

/**
 * Busca keywords Apollo para un sector dado.
 * Retorna array vacío si no hay mapping explícito.
 */
export function getSectorKeywords(sector: string | null | undefined): string[] {
  if (!sector?.trim()) return [];
  const normalized = normalizeKey(sector);
  for (const [key, keywords] of Object.entries(SECTOR_KEYWORD_MAP)) {
    if (normalized.includes(normalizeKey(key)) || normalizeKey(key).includes(normalized)) {
      return keywords;
    }
  }
  return [sector.trim()];
}

// ─── Keyword builder (L2.7) ───────────────────────────────────────────────────

const MAX_KEYWORDS = 5;

/**
 * Construye el array final de keywords para Apollo q_keywords.
 *
 * Prioridad:
 *   1. Subindustria keywords (máx MAX_KEYWORDS, SUBINDUSTRY_KEYWORD_MAP).
 *   2. Si hay subindustria pero no alcanza MAX_KEYWORDS → completar con sector keywords.
 *   3. Si no hay subindustria → usar solo sector keywords.
 *   4. additionalCriteriaTokens → agregar al final si hay cupo disponible.
 *
 * País nunca entra en este array — va en organization_locations.
 */
export function buildApolloKeywords(opts: {
  industry: string | null | undefined;
  subindustries: string[];
  additionalCriteriaTokens: string[];
}): {
  keywords: string[];
  subindustryKeywordsUsed: string[];
  sectorKeywordsUsed: string[];
  ignoredAdditionalCriteriaTokens: string[];
  relevanceStrategy: 'subindustry_specific' | 'sector_specific_keywords' | 'query_fallback';
} {
  const { industry, subindustries, additionalCriteriaTokens } = opts;

  // Recolectar keywords de subindustrias (primera que tenga mapping gana, luego acumula)
  const subindustryKeywords: string[] = [];
  for (const sub of subindustries) {
    const kws = getSubindustryKeywords(sub);
    for (const kw of kws) {
      if (!subindustryKeywords.includes(kw)) subindustryKeywords.push(kw);
    }
  }

  const sectorKeywords = getSectorKeywords(industry);

  let keywords: string[] = [];
  let relevanceStrategy: 'subindustry_specific' | 'sector_specific_keywords' | 'query_fallback';
  let subindustryKeywordsUsed: string[];
  let sectorKeywordsUsed: string[];

  if (subindustryKeywords.length > 0) {
    // Prioridad 1: subindustria
    keywords = subindustryKeywords.slice(0, MAX_KEYWORDS);
    subindustryKeywordsUsed = keywords;
    // Completar con sector si hay cupo
    if (keywords.length < MAX_KEYWORDS) {
      const remaining = MAX_KEYWORDS - keywords.length;
      const sectorFill = sectorKeywords.filter(k => !keywords.includes(k)).slice(0, remaining);
      keywords = [...keywords, ...sectorFill];
      sectorKeywordsUsed = sectorFill;
    } else {
      sectorKeywordsUsed = [];
    }
    relevanceStrategy = 'subindustry_specific';
  } else if (sectorKeywords.length > 0) {
    // Prioridad 2: sector
    keywords = sectorKeywords.slice(0, MAX_KEYWORDS);
    subindustryKeywordsUsed = [];
    sectorKeywordsUsed = keywords;
    relevanceStrategy = 'sector_specific_keywords';
  } else {
    // Sin mapping sectorial ni subindustrial
    subindustryKeywordsUsed = [];
    sectorKeywordsUsed = [];
    relevanceStrategy = 'query_fallback';
  }

  // Prioridad 3: additionalCriteriaTokens — solo si hay cupo
  const usedTokens: string[] = [];
  const ignoredTokens: string[] = [];
  for (const token of additionalCriteriaTokens) {
    const normalizedToken = normalizeKey(token);
    const alreadyCovered = keywords.some(k => normalizeKey(k).includes(normalizedToken) || normalizedToken.includes(normalizeKey(k)));
    if (alreadyCovered) {
      ignoredTokens.push(token);
      continue;
    }
    if (keywords.length < MAX_KEYWORDS) {
      keywords.push(token);
      usedTokens.push(token);
    } else {
      ignoredTokens.push(token);
    }
  }

  return {
    keywords,
    subindustryKeywordsUsed,
    sectorKeywordsUsed,
    ignoredAdditionalCriteriaTokens: ignoredTokens,
    relevanceStrategy,
  };
}

// ─── Tipos de output ──────────────────────────────────────────────────────────

/** Metadata sanitizada del mapping — sin secretos ni headers. */
export type ApolloQueryMappingMeta = {
  mapping_version: string;
  original_query: string;
  country_input: string | null;
  countryCode_input: string | null;
  sector_input: string | null;
  sector_keywords_used: string[];
  /** L2.7: keywords de subindustria usadas (vacío si no hay subindustria). */
  subindustry_keywords_used: string[];
  /** L2.7: tokens del criterio adicional del usuario enviados a Apollo. */
  additional_criteria_tokens: string[];
  /** L2.7: tokens del criterio adicional ignorados (ya cubiertos o sin cupo). */
  ignored_additional_criteria_tokens: string[];
  /** L2.7: umbral de empleados derivado del systemControls. Null si no aplica. */
  target_employee_threshold: number | null;
  apollo_keywords_sent: string | null;
  apollo_location_sent: string | null;
  q_organization_name_sent: string | null;
  requested_max_results: number;
  capped_max_results: number;
  was_capped: boolean;
  /** Estrategia de relevancia aplicada al construir las keywords. */
  relevance_strategy: 'subindustry_specific' | 'sector_specific_keywords' | 'query_fallback';
  /** True cuando las keywords genéricas del sector fueron desplazadas al final del array. */
  generic_keywords_deprioritized: boolean;
  /** L2.7: versión del normalizer de contexto aplicado. */
  normalized_context_version: 'L2.7' | null;
};

export type ApolloSearchParamsWithMeta = {
  params: SearchOrganizationsParams;
  meta: ApolloQueryMappingMeta;
};

// ─── Helper principal ─────────────────────────────────────────────────────────

/**
 * Construye los parámetros de búsqueda para Apollo Organizations.
 *
 * L2.7: subindustrias y additionalCriteriaTokens fluyen desde WebSearchInput.
 * Ambos campos son opcionales → retrocompatible con callers existentes.
 *
 * @param input           WebSearchInput con query, country, countryCode, industry,
 *                        y opcionalmente subindustries + additionalCriteriaTokens (L2.7).
 * @param cappedMaxResults Número de resultados ya capado por el guardrail del provider.
 */
export function buildApolloOrganizationsSearchParams(
  input: WebSearchInput,
  cappedMaxResults: number,
): ApolloSearchParamsWithMeta {
  const queryWords = input.query?.trim() ?? '';
  const subindustries = input.subindustries ?? [];
  const additionalCriteriaTokens = input.additionalCriteriaTokens ?? [];

  const {
    keywords,
    subindustryKeywordsUsed,
    sectorKeywordsUsed,
    ignoredAdditionalCriteriaTokens,
    relevanceStrategy,
  } = buildApolloKeywords({
    industry: input.industry,
    subindustries,
    additionalCriteriaTokens,
  });

  // Si no hay keywords desde el mapping, fallback al texto de query
  let finalKeywords = keywords;
  let effectiveStrategy = relevanceStrategy;
  if (finalKeywords.length === 0 && queryWords) {
    finalKeywords = [queryWords];
    effectiveStrategy = 'query_fallback';
  }

  const apolloKeywords = finalKeywords.join(' ').trim() || null;
  const apolloLocation = input.country?.trim() ?? null;

  const sectorKeywordsAll = getSectorKeywords(input.industry);
  const genericKeywordsDeprioritized =
    sectorKeywordsAll.length > MAX_KEYWORDS && effectiveStrategy !== 'query_fallback';

  const params: SearchOrganizationsParams = {
    // q_keywords: búsqueda libre en descripción/keywords (correcto)
    // q_organization_name: NO usar — requiere nombre exacto de empresa
    ...(apolloKeywords ? { q_keywords: apolloKeywords } : {}),
    ...(apolloLocation ? { organization_locations: [apolloLocation] } : {}),
    per_page: cappedMaxResults,
    page: 1,
  };

  const meta: ApolloQueryMappingMeta = {
    mapping_version: APOLLO_QUERY_MAPPING_VERSION,
    original_query: queryWords.slice(0, 200),
    country_input: input.country ?? null,
    countryCode_input: input.countryCode ?? null,
    sector_input: input.industry ?? null,
    sector_keywords_used: sectorKeywordsUsed,
    subindustry_keywords_used: subindustryKeywordsUsed,
    additional_criteria_tokens: additionalCriteriaTokens,
    ignored_additional_criteria_tokens: ignoredAdditionalCriteriaTokens,
    target_employee_threshold: null, // el provider puede sobreescribir si tiene ICP_SIZE_THRESHOLD
    apollo_keywords_sent: apolloKeywords,
    apollo_location_sent: apolloLocation,
    q_organization_name_sent: null,
    requested_max_results: cappedMaxResults,
    capped_max_results: cappedMaxResults,
    was_capped: false,
    relevance_strategy: effectiveStrategy,
    generic_keywords_deprioritized: genericKeywordsDeprioritized,
    normalized_context_version: 'L2.7',
  };

  return { params, meta };
}
