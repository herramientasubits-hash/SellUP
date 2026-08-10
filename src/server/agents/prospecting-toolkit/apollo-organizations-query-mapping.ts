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
 *   5. Fallback: si no hay pack aplicable, buildPrioritizedApolloKeywords (§ 1).
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
  matchApolloSearchPackDomainForSubindustry,
  selectPacksUpToMaxQueries,
  type ApolloSearchPack,
  type ApolloSearchPackBuildResult,
} from './apollo-search-pack-builder';
import { resolveApolloSubindustrySearchMapping } from './apollo-subindustry-search-mapping';
import {
  apolloKeywordDedupeKey,
  apolloSubindustryCoverageFloor,
  computeApolloSubindustryQueryCoverage,
  interleaveApolloSubindustryTerms,
  resolveApolloSubindustryTermLists,
  toApolloSubindustryTermProvenanceMetadata,
  withApolloSubindustryTerms,
  type ApolloSubindustryQueryCoverage,
  type ApolloSubindustryTermList,
  type ApolloSubindustryTermResolution,
} from './apollo-subindustry-query-terms';

/**
 * La clave de deduplicación vive en `apollo-subindustry-query-terms` para que el
 * reparto de términos y la medida de cobertura usen exactamente la misma regla. Se
 * reexporta porque este módulo era su origen y sus consumidores la importan de
 * aquí.
 */
export { apolloKeywordDedupeKey };

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_QUERY_MAPPING_VERSION = 'v1.L2.13';

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

// ─── Prioridad de términos (QUERY-QUALITY-2 § 1) ──────────────────────────────

/** Posiciones que la consulta puede llevar. Techo de Apollo para esta ruta. */
const MAX_KEYWORDS = 5;

/**
 * QUERY-QUALITY-2-FIX § 9 — `buildApolloKeywords` (L2.7/L2.8) ya no existe.
 *
 * Llenaba las cinco posiciones con el catálogo del sector ANTES de mirar la
 * subindustria o lo que el usuario escribió: es exactamente la prioridad que la
 * corrida QA `edb6f40c` demostró equivocada. Desde el § 1 la única fuente de
 * prioridad es `buildPrioritizedApolloKeywords`, y se borró en vez de dejarse
 * exportada: un segundo builder sin consumidores es una segunda política esperando
 * a que alguien la vuelva a llamar.
 */

/**
 * Posiciones que se reservan para señales específicas (subindustria + intención
 * escrita por el usuario) cuando existe al menos una.
 */
export const MIN_SPECIFIC_KEYWORD_SLOTS = 3;
/** Posiciones que los términos GENÉRICOS del sector pueden ocupar como mucho. */
export const MAX_GENERIC_KEYWORD_SLOTS = 2;

export type ApolloKeywordPriorityStrategy =
  /** Sólo señales específicas: los genéricos ni siquiera hicieron falta. */
  | 'specific_only'
  /** Señales específicas primero, genéricos rellenando el cupo restante. */
  | 'specific_first_with_generic_fill'
  /** Sin señales específicas: el sector general es el único respaldo. */
  | 'sector_general_fallback'
  /** Ni subindustria ni sector mapeados. */
  | 'no_mapped_keywords';

/**
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 1 — términos de UNA subindustria,
 * mirando las dos fuentes que este módulo conoce, en orden de especificidad.
 *
 * Es el resolvedor que el reparto round-robin inyecta, y también el que define qué
 * significa «esta subindustria es cubrible»: sin términos en ninguna de las dos
 * fuentes no hay nada suyo que enviar, y el § 7 lo trata como un bloqueo antes del
 * gasto en vez de como una omisión silenciosa.
 */
export function resolveApolloSubindustryQueryTerms(
  subindustry: string,
): ApolloSubindustryTermResolution {
  const explicit = resolveApolloSubindustrySearchMapping(subindustry);
  if (explicit !== null) {
    return {
      canonicalSubindustry: explicit.canonicalSubindustry,
      termSource: 'explicit_catalog',
      terms: explicit.positiveTerms,
    };
  }
  const legacy = getSubindustryKeywords(subindustry);
  if (legacy.length > 0) {
    return { canonicalSubindustry: null, termSource: 'legacy_keyword_map', terms: legacy };
  }
  return { canonicalSubindustry: null, termSource: 'none', terms: [] };
}

function dedupeKeywords(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term?.trim();
    if (!trimmed) continue;
    const key = apolloKeywordDedupeKey(trimmed);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Un término del catálogo sectorial es GENÉRICO cuando es una sola palabra
 * (`retail`, `comercio`, `ecommerce`) y ESPECÍFICO cuando es una frase
 * (`retail chain`, `learning management system`).
 *
 * Es una regla de forma, no de opinión: una sola palabra de sector describe el
 * sector entero; una frase describe un tipo de empresa dentro de él.
 */
export function isGenericSectorKeyword(term: string): boolean {
  return !normalizeKey(term).includes(' ');
}

export type PrioritizedApolloKeywordsResult = {
  keywords: string[];
  /** Señales específicas disponibles antes de aplicar el límite. */
  specificTokensAvailable: string[];
  /** Señales específicas que sí viajaron a Apollo. */
  specificTokensUsed: string[];
  /** Términos del catálogo sectorial (genéricos) que viajaron. */
  sectorTokensUsed: string[];
  /** Señales específicas que el límite dejó fuera. */
  ignoredSpecificTokens: string[];
  /** Términos genéricos que el cupo dejó fuera. */
  ignoredGenericTokens: string[];
  keywordPriorityStrategy: ApolloKeywordPriorityStrategy;
  /**
   * Primera subindustria del catálogo explícito que aportó términos. Diagnóstico y
   * continuidad de lectura; NO es «la que gobierna»: desde el § 2 gobiernan todas.
   */
  matchedSubindustry: string | null;
  /** § 1 — TODAS las subindustrias del catálogo explícito que aportaron términos. */
  matchedSubindustries: string[];
  /** § 1 — términos atribuibles a cada subindustria pedida, con su procedencia. */
  subindustryTermLists: ApolloSubindustryTermList[];
  /** § 10 G — qué subindustrias aportaron cada término superviviente. */
  subindustryTermProvenance: Record<string, string[]>;
  /** § 2 — posiciones reservadas para cubrir una señal por subindustria. */
  subindustryCoverageFloor: number;
  relevanceStrategy: 'subindustry_specific' | 'sector_specific_keywords' | 'query_fallback';
};

/**
 * Construye los keywords de Apollo con la prioridad del § 1.
 *
 *   subindustrias seleccionadas (TODAS, repartidas round-robin)
 *     → intención escrita por el usuario
 *       → catálogo sectorial específico (frases)
 *         → sector general como respaldo (palabras sueltas)
 *
 * Reglas de cupo, con `MAX_KEYWORDS = 5`:
 *   - existiendo señales específicas, los genéricos ocupan como mucho DOS
 *     posiciones, y ninguna si las específicas llenan las cinco;
 *   - sin ninguna señal específica, el sector general es el único respaldo y
 *     puede ocupar todas las posiciones — es eso o una consulta vacía.
 *
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 2 y § 4 — el reparto entre
 * subindustrias, y el SUELO de cobertura:
 *
 *   - los términos ya no salen de la primera subindustria con mapping, sino de la
 *     intercalación round-robin de todas: primero el término más específico de
 *     cada una, luego el segundo de cada una, y así;
 *   - el `subindustryLead` nunca baja del número de subindustrias cubribles, así
 *     que con cinco selecciones las cinco posiciones llevan una señal de cada una.
 *     Con cinco subindustrias la intención escrita cede su cupo — y eso es
 *     deliberado: la alternativa sería una llamada pagada por subindustria, que el
 *     § 4 prohíbe. Lo que cede queda declarado en `ignoredSpecificTokens`.
 *
 * El número de llamadas al proveedor NO cambia por esto: cambia el reparto DENTRO
 * del único array de keywords que la llamada ya llevaba.
 *
 * La deduplicación (textual y de singular/plural) ocurre ANTES del límite: de
 * otro modo `supermercado` y `supermercados` gastarían dos de las cinco
 * posiciones en la misma señal.
 *
 * Puro.
 */
export function buildPrioritizedApolloKeywords(opts: {
  industry: string | null | undefined;
  subindustries: readonly string[];
  additionalCriteriaTokens: readonly string[];
  maxKeywords?: number;
}): PrioritizedApolloKeywordsResult {
  const maxKeywords = opts.maxKeywords ?? MAX_KEYWORDS;

  // 1. Subindustrias: una lista de términos POR selección (catálogo explícito
  //    primero, mapa histórico después), repartidas round-robin.
  const subindustryTermLists = resolveApolloSubindustryTermLists(
    opts.subindustries,
    resolveApolloSubindustryQueryTerms,
  );
  const interleaved = interleaveApolloSubindustryTerms(
    subindustryTermLists,
    apolloKeywordDedupeKey,
  );
  const subindustryTerms = interleaved.terms;
  const matchedSubindustries = subindustryTermLists
    .filter((list) => list.termSource === 'explicit_catalog')
    .map((list) => list.canonicalSubindustry)
    .filter((name): name is string => name !== null);

  // 2. Intención escrita por el usuario.
  const intentTokens = [...opts.additionalCriteriaTokens];

  // 3/4. Catálogo sectorial, partido en específico (frases) y genérico (palabras).
  const sectorCatalog = opts.industry ? getSectorKeywords(opts.industry) : [];
  const sectorSpecificTerms = sectorCatalog.filter((term) => !isGenericSectorKeyword(term));
  const sectorGenericTerms = sectorCatalog.filter(isGenericSectorKeyword);

  // La intención se intercala DESPUÉS de la subindustria pero sin quedar
  // sepultada: si el usuario escribió algo, se le reservan hasta dos posiciones
  // por delante de la cola de la subindustria.
  const reservedIntentSlots = Math.min(intentTokens.length, MAX_GENERIC_KEYWORD_SLOTS);
  // § 2 — el suelo de cobertura gana a la reserva de intención. Sin esta línea,
  // `[A, B, C, D, E]` mandaría sólo tres señales de subindustria y dos selecciones
  // del usuario no viajarían.
  const coverageFloor = apolloSubindustryCoverageFloor(subindustryTermLists, maxKeywords);
  const subindustryLead = Math.max(
    coverageFloor,
    Math.max(0, maxKeywords - reservedIntentSlots),
  );

  const specificAvailable = dedupeKeywords([
    ...subindustryTerms.slice(0, subindustryLead),
    ...intentTokens,
    ...subindustryTerms.slice(subindustryLead),
    ...sectorSpecificTerms,
  ]);
  const genericAvailable = dedupeKeywords(sectorGenericTerms).filter(
    (term) =>
      !specificAvailable.some(
        (specific) => apolloKeywordDedupeKey(specific) === apolloKeywordDedupeKey(term),
      ),
  );

  if (specificAvailable.length === 0) {
    const sectorTokensUsed = genericAvailable.slice(0, maxKeywords);
    return {
      keywords: sectorTokensUsed,
      specificTokensAvailable: [],
      specificTokensUsed: [],
      sectorTokensUsed,
      ignoredSpecificTokens: [],
      ignoredGenericTokens: genericAvailable.slice(maxKeywords),
      keywordPriorityStrategy:
        sectorTokensUsed.length > 0 ? 'sector_general_fallback' : 'no_mapped_keywords',
      matchedSubindustry: null,
      matchedSubindustries: [],
      subindustryTermLists,
      subindustryTermProvenance: interleaved.provenanceByTerm,
      subindustryCoverageFloor: coverageFloor,
      relevanceStrategy:
        sectorTokensUsed.length > 0 ? 'sector_specific_keywords' : 'query_fallback',
    };
  }

  const specificTokensUsed = specificAvailable.slice(0, maxKeywords);
  const genericBudget = Math.min(
    MAX_GENERIC_KEYWORD_SLOTS,
    Math.max(0, maxKeywords - specificTokensUsed.length),
  );
  const sectorTokensUsed = genericAvailable.slice(0, genericBudget);

  return {
    keywords: [...specificTokensUsed, ...sectorTokensUsed],
    specificTokensAvailable: specificAvailable,
    specificTokensUsed,
    sectorTokensUsed,
    ignoredSpecificTokens: specificAvailable.slice(specificTokensUsed.length),
    ignoredGenericTokens: genericAvailable.slice(sectorTokensUsed.length),
    keywordPriorityStrategy:
      sectorTokensUsed.length === 0 ? 'specific_only' : 'specific_first_with_generic_fill',
    matchedSubindustry: matchedSubindustries[0] ?? null,
    matchedSubindustries,
    subindustryTermLists,
    subindustryTermProvenance: interleaved.provenanceByTerm,
    subindustryCoverageFloor: coverageFloor,
    relevanceStrategy:
      subindustryTerms.length > 0 ? 'subindustry_specific' : 'sector_specific_keywords',
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
  /** L2.13: ID de experimento activo. Null si no hay experimento activo. */
  apollo_experiment_id: string | null;
  /** L2.13: Variante de experimento seleccionada. Null si no hay experimento. */
  apollo_experiment_variant: string | null;
  /** L2.13: Etiqueta legible del experimento. Null si no hay experimento. */
  apollo_experiment_label: string | null;
  /** L2.11: rangos de empleados enviados a Apollo. Vacío si no hay threshold. */
  apollo_employee_ranges_sent: string[];
  /** L2.11: true si se envió organization_num_employees_ranges. */
  employee_range_filter_enabled: boolean;
  /** L2.11: fuente del threshold de empleados. Null si no aplica. */
  employee_threshold_source: 'input.targetEmployeeThreshold' | null;
  // ── QUERY-QUALITY-2 § 1: prioridad de términos ────────────────────────────
  /** Señales específicas disponibles antes de aplicar el límite. */
  specific_tokens_available: string[];
  /** Señales específicas que efectivamente viajaron a Apollo. */
  specific_tokens_used: string[];
  /** Términos genéricos del sector que viajaron a Apollo. */
  sector_tokens_used: string[];
  /** Señales específicas que el límite dejó fuera. */
  ignored_specific_tokens: string[];
  /** Términos genéricos que el cupo de dos posiciones dejó fuera. */
  ignored_generic_tokens: string[];
  /** Estrategia de prioridad aplicada. */
  keyword_priority_strategy: ApolloKeywordPriorityStrategy | 'search_pack_selected';
  /**
   * Primera subindustria del catálogo explícito que aportó términos. Se conserva
   * para continuidad de lectura; la lista completa está en el campo siguiente.
   */
  matched_subindustry_mapping: string | null;
  // ── MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 §§ 1, 2 y 6 ──────────────────
  /** TODAS las subindustrias del catálogo explícito que aportaron términos. */
  matched_subindustry_mappings: string[];
  /** § 6 — procedencia declarada de los términos, por subindustria pedida. */
  subindustry_term_provenance: Record<string, unknown>[];
  /** § 10 G — qué subindustrias aportaron cada término superviviente. */
  subindustry_term_provenance_by_term: Record<string, string[]>;
  /** § 2 — posiciones reservadas para cubrir una señal por subindustria. */
  subindustry_coverage_floor: number;
  /** § 6 — cobertura de la consulta sobre las subindustrias pedidas. */
  requested_subindustries: string[];
  query_covered_subindustries: string[];
  query_uncovered_subindustries: string[];
  query_coverage_count: number;
  query_coverage_ratio: number;
  query_coverage_complete: boolean;
  effective_keywords_by_subindustry: Record<string, string[]>;
  /** Términos sin subindustria atribuible: sector o intención libre. */
  unattributed_effective_keywords: string[];
};

export type ApolloSearchParamsWithMeta = {
  params: SearchOrganizationsParams;
  meta: ApolloQueryMappingMeta;
  /**
   * § 6 — términos que GOBERNARON la consulta, por subindustria pedida.
   *
   * Va fuera de `meta` porque no es metadata para persistir: es lo que el
   * constructor del request efectivo necesita para volver a medir la cobertura
   * sobre el body final del contrato, en vez de fiarse de la medida previa.
   */
  subindustryTermLists: ApolloSubindustryTermList[];
  /** § 6 — cobertura medida sobre los keywords que este mapper produjo. */
  subindustryCoverage: ApolloSubindustryQueryCoverage;
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

  // ── QUERY-QUALITY-2 § 1: la subindustria del catálogo explícito manda ───────
  //
  // Un search pack sólo puede ganar cuando la subindustria seleccionada NO tiene
  // mapping propio. Con mapping, sus términos son la señal más específica que
  // existe y ningún pack de sector puede desplazarlos.
  const prioritized = buildPrioritizedApolloKeywords({
    industry: input.industry,
    subindustries,
    additionalCriteriaTokens,
  });
  // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — y con DOS o más selecciones el
  // pack tampoco puede ganar: un pack es el conjunto curado de UN dominio, así que
  // gobernar con él dejaría fuera a las demás subindustrias pedidas. Con una sola
  // selección la ruta de packs queda intacta, byte por byte.
  const subindustryMappingWins =
    prioritized.matchedSubindustries.length > 0 ||
    prioritized.subindustryTermLists.length > 1;

  // ── L2.10: intentar construir packs ─────────────────────────────────────────
  const packBuildResult = buildApolloSearchPacks({
    sector: input.industry,
    subindustries,
    additionalCriteriaTokens,
  });

  const packSelection = selectPacksUpToMaxQueries(packBuildResult, maxQueries);
  const selectedPack: ApolloSearchPack | null = subindustryMappingWins
    ? null
    : (packBuildResult.packs[packIndex] ?? null);

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
    // QUERY-QUALITY-2 § 1: prioridad específica antes que genérica. Sustituye al
    // builder L2.7, que llenaba las cinco posiciones con el catálogo del sector
    // antes de mirar la subindustria o lo que el usuario escribió.
    finalKeywords = prioritized.keywords;
    effectiveStrategy = prioritized.relevanceStrategy;
    subindustryKeywordsUsed = prioritized.specificTokensUsed;
    sectorKeywordsUsed = prioritized.sectorTokensUsed;
    ignoredAdditionalCriteriaTokens = additionalCriteriaTokens.filter((token) =>
      prioritized.ignoredSpecificTokens.includes(token),
    );
    mergedDuplicateAdditionalCriteriaTokens = additionalCriteriaTokens.filter(
      (token) =>
        !prioritized.specificTokensUsed.includes(token) &&
        !prioritized.ignoredSpecificTokens.includes(token),
    );
    usedAdditionalCriteriaTokens = additionalCriteriaTokens.filter((token) =>
      prioritized.specificTokensUsed.includes(token),
    );
  }

  // Si no hay keywords desde ningún camino, fallback al texto de query
  if (finalKeywords.length === 0 && queryWords) {
    finalKeywords = [queryWords];
    effectiveStrategy = 'query_fallback';
  }

  // ── MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 §§ 6 y 7: cobertura ────────────
  //
  // Se mide sobre `finalKeywords` —lo que de verdad va a viajar— y contra los
  // términos que GOBERNARON la consulta. Cuando manda un pack, sus keywords son
  // los términos de la subindustria que lo seleccionó: atribuirlos es lo honesto,
  // porque el pack es su catálogo curado y no un respaldo sectorial.
  const governingTermLists = selectedPack
    ? withApolloSubindustryTerms(
        prioritized.subindustryTermLists,
        (list) =>
          matchApolloSearchPackDomainForSubindustry(list.requestedSubindustry) !== null,
        finalKeywords,
        'search_pack',
      )
    : prioritized.subindustryTermLists;
  const subindustryCoverage = computeApolloSubindustryQueryCoverage({
    lists: governingTermLists,
    effectiveKeywords: finalKeywords,
    dedupeKey: apolloKeywordDedupeKey,
  });

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
    apollo_experiment_id: selectedPack?.packKey === 'variant_a_current_tags' ? 'variant_a_current_tags' : null,
    apollo_experiment_variant: selectedPack?.packKey === 'variant_a_current_tags' ? 'variant_a_current_tags' : null,
    apollo_experiment_label: selectedPack?.packKey === 'variant_a_current_tags' ? 'Corporate training + LMS provider tags' : null,
    apollo_employee_ranges_sent: employeeRangesSent,
    employee_range_filter_enabled: employeeRangeFilterEnabled,
    employee_threshold_source: employeeThreshold != null ? 'input.targetEmployeeThreshold' : null,
    // QUERY-QUALITY-2 § 1 — por qué la consulta lleva estos términos y no otros.
    // Con un pack seleccionado, la prioridad la decidió el pack: se declara así
    // en vez de reportar el cálculo que no gobernó la consulta.
    specific_tokens_available: prioritized.specificTokensAvailable,
    specific_tokens_used: selectedPack ? finalKeywords : prioritized.specificTokensUsed,
    sector_tokens_used: selectedPack ? [] : prioritized.sectorTokensUsed,
    ignored_specific_tokens: selectedPack ? [] : prioritized.ignoredSpecificTokens,
    ignored_generic_tokens: selectedPack ? [] : prioritized.ignoredGenericTokens,
    keyword_priority_strategy: selectedPack
      ? 'search_pack_selected'
      : prioritized.keywordPriorityStrategy,
    matched_subindustry_mapping: prioritized.matchedSubindustry,
    // ── MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 §§ 1, 2 y 6 ────────────────
    matched_subindustry_mappings: prioritized.matchedSubindustries,
    subindustry_term_provenance: toApolloSubindustryTermProvenanceMetadata(
      governingTermLists,
    ),
    subindustry_term_provenance_by_term: prioritized.subindustryTermProvenance,
    subindustry_coverage_floor: prioritized.subindustryCoverageFloor,
    requested_subindustries: subindustryCoverage.requestedSubindustries,
    query_covered_subindustries: subindustryCoverage.coveredSubindustries,
    query_uncovered_subindustries: subindustryCoverage.uncoveredSubindustries,
    query_coverage_count: subindustryCoverage.coverageCount,
    query_coverage_ratio: subindustryCoverage.coverageRatio,
    query_coverage_complete: subindustryCoverage.complete,
    effective_keywords_by_subindustry: subindustryCoverage.effectiveKeywordsBySubindustry,
    unattributed_effective_keywords: subindustryCoverage.unattributedEffectiveKeywords,
  };

  return { params, meta, subindustryTermLists: governingTermLists, subindustryCoverage };
}
