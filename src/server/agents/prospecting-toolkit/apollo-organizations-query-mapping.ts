/**
 * Apollo Organizations Query Mapping (v1.L2.11-A)
 *
 * Transforma criterios SellUp wizard → parámetros estructurados Apollo Organizations.
 *
 * Historial de correcciones:
 *   v1.16K-AA  — usar q_keywords (no q_organization_name) para texto libre.
 *   v1.16K-AB  — reordenar keywords educación: señales específicas primero.
 *   v1.L2.7    — subindustria con prioridad sobre sector padre.
 *               additionalCriteriaTokens del wizard fluyen a q_keywords.
 *               Metadata extendida con campos de diagnóstico L2.7.
 *   v1.L2.10   — search packs estructurados por wizard intent.
 *               El pack builder genera N packs; se selecciona el pack por índice.
 *               Metadata apollo_search_pack con pack_key, intent, selected_reason.
 *               apollo_keywords_sent refleja los keywords del pack seleccionado.
 *   v1.L2.11-A — CORRECCIÓN RAÍZ: Apollo ignora silenciosamente q_keywords en
 *               /mixed_companies/search. El campo documentado es q_organization_keyword_tags[].
 *               Se envía el array de tags en lugar de la string q_keywords.
 *               Agregado mapEmployeeThresholdToApolloRanges + organization_num_employees_ranges.
 *               Metadata extendida: apollo_keyword_filter_field, apollo_keyword_tags_sent,
 *               deprecated_q_keywords_sent, apollo_employee_ranges_sent,
 *               employee_range_filter_enabled, employee_threshold_source.
 *
 * Estrategia de keyword building (L2.11-A):
 *   1. buildApolloSearchPacks analiza sector + subindustria + additionalCriteriaTokens.
 *   2. Genera packs ordenados P0 (más específico) → P2 (más amplio).
 *   3. buildApolloOrganizationsSearchParams recibe packIndex (default 0 = P0).
 *   4. El pack seleccionado determina qKeywords → q_organization_keyword_tags[] Apollo.
 *   5. Fallback: si no hay packs, usa buildApolloKeywords (L2.7) como antes.
 *   6. País siempre en organization_locations — nunca en tags.
 *   7. q_organization_name vacío — Apollo lo interpreta como nombre exacto de empresa.
 *   8. organization_num_employees_ranges: solo si targetEmployeeThreshold está en input.
 *
 * Reglas:
 *   - Puro: sin side effects, sin llamadas externas.
 *   - No modifica apollo-client.ts más allá de los campos ya declarados.
 *   - No guarda API keys ni headers en metadata.
 *   - Tavily no importa este módulo.
 */

import type { SearchOrganizationsParams } from '@/server/integrations/apollo-client';
import type { WebSearchInput } from './types';
import {
  buildApolloSearchPacks,
  selectPacksUpToMaxQueries,
  type ApolloSearchPack,
  type ApolloSearchPackBuildResult,
} from './apollo-search-pack-builder';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_QUERY_MAPPING_VERSION = 'v1.L2.11-A';

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
 *      - Si el token ya está cubierto conceptualmente → merged_duplicate (no ignored).
 *      - Si no hay cupo → ignored (no_room).
 *
 * País nunca entra en este array — va en organization_locations.
 *
 * L2.8: Distingue merged_duplicate de ignored para diagnóstico preciso.
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
  /** L2.8: tokens ya cubiertos conceptualmente por las keywords seleccionadas. */
  mergedDuplicateAdditionalCriteriaTokens: string[];
  /** L2.8: tokens del criterio adicional realmente insertados en keywords. */
  usedAdditionalCriteriaTokens: string[];
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
  // L2.8: Distinguir tokens ya cubiertos (merged_duplicate) de tokens sin cupo (ignored).
  const usedTokens: string[] = [];
  const ignoredTokens: string[] = [];
  const mergedDuplicateTokens: string[] = [];
  for (const token of additionalCriteriaTokens) {
    const normalizedToken = normalizeKey(token);
    const alreadyCovered = keywords.some(k => normalizeKey(k).includes(normalizedToken) || normalizedToken.includes(normalizeKey(k)));
    if (alreadyCovered) {
      // Token ya cubierto conceptualmente: no agregar, pero NO es "ignored" — es merged.
      mergedDuplicateTokens.push(token);
      continue;
    }
    if (keywords.length < MAX_KEYWORDS) {
      keywords.push(token);
      usedTokens.push(token);
    } else {
      // Sin cupo — genuinamente ignorado.
      ignoredTokens.push(token);
    }
  }

  return {
    keywords,
    subindustryKeywordsUsed,
    sectorKeywordsUsed,
    ignoredAdditionalCriteriaTokens: ignoredTokens,
    mergedDuplicateAdditionalCriteriaTokens: mergedDuplicateTokens,
    usedAdditionalCriteriaTokens: usedTokens,
    relevanceStrategy,
  };
}

// ─── Tipos de output ──────────────────────────────────────────────────────────

/** Metadata del search pack seleccionado — L2.10. */
export type ApolloSearchPackMeta = {
  pack_key: string;
  pack_label: string;
  intent: string;
  priority: 'P0' | 'P1' | 'P2';
  /** Razón por la que se seleccionó este pack (índice, cap, etc.). */
  selected_reason: string;
  /** Total de packs disponibles generados por el builder. */
  available_pack_count: number;
  /** True si el cap maxQueries=1 forzó la selección del primer pack. */
  qa_cap_selected_first_pack: boolean;
  /** Tokens de criterio adicional que influyeron en los keywords de este pack. */
  criteria_tokens_influencing: string[];
  /** Estrategia usada por el builder para generar los packs. */
  build_strategy: string;
};

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
  /** L2.7: tokens del criterio adicional ignorados (sin cupo). */
  ignored_additional_criteria_tokens: string[];
  /** L2.8: tokens del criterio adicional ya cubiertos conceptualmente por las keywords seleccionadas. */
  additional_criteria_tokens_merged_duplicates: string[];
  /** L2.8: tokens del criterio adicional realmente insertados en keywords. */
  additional_criteria_tokens_used: string[];
  /** L2.8: estrategia de merge de keywords aplicada. */
  keyword_merge_strategy: 'subindustry_first_with_strong_criteria_replacement';
  /** L2.7: umbral de empleados derivado del systemControls. Null si no aplica. */
  target_employee_threshold: number | null;
  /** Backward-compat: join de tags enviados (string). Para diagnóstico. */
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
  /** L2.7/L2.10/L2.11: versión del normalizer de contexto aplicado. */
  normalized_context_version: 'L2.7' | 'L2.10' | 'L2.11' | null;
  /** L2.10: metadata del search pack seleccionado. Null si se usó fallback L2.7. */
  apollo_search_pack: ApolloSearchPackMeta | null;
  /** L2.10/L2.11: keywords del pack seleccionado enviadas a Apollo (array, para diagnóstico). */
  apollo_keywords_sent_array: string[];
  /** L2.11: campo Apollo usado para keywords. Siempre "q_organization_keyword_tags". */
  apollo_keyword_filter_field: 'q_organization_keyword_tags';
  /** L2.11: tags enviados como q_organization_keyword_tags (igual a apollo_keywords_sent_array). */
  apollo_keyword_tags_sent: string[];
  /** L2.11: confirma que q_keywords obsoleto NO se envía. */
  deprecated_q_keywords_sent: false;
  /** L2.11: rangos de empleados enviados a Apollo. Vacío si no hay threshold. */
  apollo_employee_ranges_sent: string[];
  /** L2.11: true si se envió organization_num_employees_ranges. */
  employee_range_filter_enabled: boolean;
  /** L2.11: fuente del threshold de empleados. Null si no aplica. */
  employee_threshold_source: 'input.targetEmployeeThreshold' | null;
};

export type ApolloSearchParamsWithMeta = {
  params: SearchOrganizationsParams;
  meta: ApolloQueryMappingMeta;
};

// ─── Employee range mapping (L2.11) ──────────────────────────────────────────

/**
 * Rangos de empleados soportados por Apollo Organization Search.
 * Orden ascendente — se envían desde el umbral en adelante.
 */
const APOLLO_EMPLOYEE_RANGES: string[] = [
  '200,500',
  '500,1000',
  '1000,5000',
  '5000,10000',
  '10000,20000',
  '20000,50000',
  '50000,1000000',
];

/**
 * Convierte un umbral mínimo de empleados en los rangos Apollo correspondientes.
 *
 * threshold=200  → ["200,500","500,1000","1000,5000","5000,10000","10000,20000","20000,50000","50000,1000000"]
 * threshold=500  → ["500,1000","1000,5000","5000,10000","10000,20000","20000,50000","50000,1000000"]
 * threshold=null → []
 *
 * Puro: sin side effects.
 */
export function mapEmployeeThresholdToApolloRanges(threshold: number | null | undefined): string[] {
  if (threshold == null) return [];
  return APOLLO_EMPLOYEE_RANGES.filter(range => {
    const rangeStart = parseInt(range.split(',')[0], 10);
    return rangeStart >= threshold;
  });
}

// ─── Helper principal ─────────────────────────────────────────────────────────

/**
 * Construye los parámetros de búsqueda para Apollo Organizations.
 *
 * L2.7:  subindustrias y additionalCriteriaTokens fluyen desde WebSearchInput.
 * L2.10: usa search packs estructurados (buildApolloSearchPacks) para seleccionar
 *        los keywords más específicos según wizard intent.
 *        packIndex selecciona qué pack usar (default 0 = P0, el más específico).
 *        maxQueries se usa solo para calcular qa_cap_selected_first_pack en metadata.
 *        Si no hay packs disponibles, fallback transparente al builder L2.7.
 *
 * @param input            WebSearchInput con query, country, countryCode, industry,
 *                         subindustries, additionalCriteriaTokens.
 * @param cappedMaxResults Número de resultados ya capado por el guardrail del provider.
 * @param opts             Opciones L2.10: packIndex (default 0), maxQueries (default 1).
 */
export function buildApolloOrganizationsSearchParams(
  input: WebSearchInput,
  cappedMaxResults: number,
  opts?: { packIndex?: number; maxQueries?: number },
): ApolloSearchParamsWithMeta {
  const queryWords = input.query?.trim() ?? '';
  const subindustries = input.subindustries ?? [];
  const additionalCriteriaTokens = input.additionalCriteriaTokens ?? [];
  const packIndex = opts?.packIndex ?? 0;
  const maxQueries = opts?.maxQueries ?? 1;

  // ── L2.10: intentar construir packs ─────────────────────────────────────────
  const packBuildResult = buildApolloSearchPacks({
    sector: input.industry,
    subindustries,
    additionalCriteriaTokens,
  });

  const packSelection = selectPacksUpToMaxQueries(packBuildResult, maxQueries);
  const selectedPack: ApolloSearchPack | null = packBuildResult.packs[packIndex] ?? null;

  // ── Decidir keywords: pack (L2.10) o fallback keyword builder (L2.7) ────────
  let finalKeywords: string[];
  let effectiveStrategy: 'subindustry_specific' | 'sector_specific_keywords' | 'query_fallback';
  let subindustryKeywordsUsed: string[];
  let sectorKeywordsUsed: string[];
  let ignoredAdditionalCriteriaTokens: string[];
  let mergedDuplicateAdditionalCriteriaTokens: string[];
  let usedAdditionalCriteriaTokens: string[];
  let apolloSearchPackMeta: ApolloSearchPackMeta | null = null;

  if (selectedPack) {
    // Camino L2.10: usar keywords del pack seleccionado
    finalKeywords = selectedPack.qKeywords;
    // Mapear buildStrategy → effectiveStrategy para preservar semántica L2.7
    effectiveStrategy = packBuildResult.buildStrategy === 'subindustry_specific_packs'
      ? 'subindustry_specific'
      : 'sector_specific_keywords';
    subindustryKeywordsUsed = packBuildResult.buildStrategy === 'subindustry_specific_packs'
      ? finalKeywords
      : [];
    sectorKeywordsUsed = packBuildResult.buildStrategy === 'sector_fallback_packs'
      ? finalKeywords
      : [];
    ignoredAdditionalCriteriaTokens = [];
    mergedDuplicateAdditionalCriteriaTokens = packBuildResult.criteriaTokensMergedDuplicateP0;
    usedAdditionalCriteriaTokens = packBuildResult.criteriaTokensInfluencingP0;

    apolloSearchPackMeta = {
      pack_key: selectedPack.packKey,
      pack_label: selectedPack.packLabel,
      intent: selectedPack.intent,
      priority: selectedPack.priority,
      selected_reason: packIndex === 0
        ? `first_pack_selected (pack_index=0, priority=${selectedPack.priority})`
        : `pack_index=${packIndex} requested`,
      available_pack_count: packBuildResult.availablePackCount,
      qa_cap_selected_first_pack: packSelection.qaCapSelectedFirstPack,
      criteria_tokens_influencing: packBuildResult.criteriaTokensInfluencingP0,
      build_strategy: packBuildResult.buildStrategy,
    };
  } else {
    // Fallback L2.7: usar keyword builder clásico
    const kwResult = buildApolloKeywords({
      industry: input.industry,
      subindustries,
      additionalCriteriaTokens,
    });
    finalKeywords = kwResult.keywords;
    effectiveStrategy = kwResult.relevanceStrategy;
    subindustryKeywordsUsed = kwResult.subindustryKeywordsUsed;
    sectorKeywordsUsed = kwResult.sectorKeywordsUsed;
    ignoredAdditionalCriteriaTokens = kwResult.ignoredAdditionalCriteriaTokens;
    mergedDuplicateAdditionalCriteriaTokens = kwResult.mergedDuplicateAdditionalCriteriaTokens;
    usedAdditionalCriteriaTokens = kwResult.usedAdditionalCriteriaTokens;
  }

  // Si no hay keywords desde ningún camino, fallback al texto de query
  if (finalKeywords.length === 0 && queryWords) {
    finalKeywords = [queryWords];
    effectiveStrategy = 'query_fallback';
  }

  // L2.11: usar tags array; apollo_keywords_sent como string para backward compat
  const apolloKeywordTagsSent = finalKeywords;
  const apolloKeywordsSentStr = finalKeywords.join(' ').trim() || null;
  const apolloLocation = input.country?.trim() ?? null;

  // L2.11: employee ranges desde targetEmployeeThreshold
  const employeeThreshold = input.targetEmployeeThreshold ?? null;
  const employeeRangesSent = mapEmployeeThresholdToApolloRanges(employeeThreshold);
  const employeeRangeFilterEnabled = employeeRangesSent.length > 0;

  const sectorKeywordsAll = getSectorKeywords(input.industry);
  const genericKeywordsDeprioritized =
    sectorKeywordsAll.length > MAX_KEYWORDS && effectiveStrategy !== 'query_fallback';

  const params: SearchOrganizationsParams = {
    // L2.11: q_organization_keyword_tags reemplaza q_keywords (que Apollo ignoraba silenciosamente)
    // q_organization_name: NO usar — requiere nombre exacto de empresa
    ...(apolloKeywordTagsSent.length > 0 ? { q_organization_keyword_tags: apolloKeywordTagsSent } : {}),
    ...(apolloLocation ? { organization_locations: [apolloLocation] } : {}),
    ...(employeeRangeFilterEnabled ? { organization_num_employees_ranges: employeeRangesSent } : {}),
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
    additional_criteria_tokens_merged_duplicates: mergedDuplicateAdditionalCriteriaTokens,
    additional_criteria_tokens_used: usedAdditionalCriteriaTokens,
    keyword_merge_strategy: 'subindustry_first_with_strong_criteria_replacement' as const,
    target_employee_threshold: employeeThreshold,
    apollo_keywords_sent: apolloKeywordsSentStr,
    apollo_location_sent: apolloLocation,
    q_organization_name_sent: null,
    requested_max_results: cappedMaxResults,
    capped_max_results: cappedMaxResults,
    was_capped: false,
    relevance_strategy: effectiveStrategy,
    generic_keywords_deprioritized: genericKeywordsDeprioritized,
    normalized_context_version: 'L2.11',
    apollo_search_pack: apolloSearchPackMeta,
    apollo_keywords_sent_array: finalKeywords,
    apollo_keyword_filter_field: 'q_organization_keyword_tags',
    apollo_keyword_tags_sent: apolloKeywordTagsSent,
    deprecated_q_keywords_sent: false,
    apollo_employee_ranges_sent: employeeRangesSent,
    employee_range_filter_enabled: employeeRangeFilterEnabled,
    employee_threshold_source: employeeThreshold != null ? 'input.targetEmployeeThreshold' : null,
  };

  return { params, meta };
}
