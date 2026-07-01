/**
 * Apollo Organizations Query Mapping (v1.16K-AA)
 *
 * Transforma criterios SellUp wizard → parámetros estructurados Apollo Organizations.
 *
 * Problema diagnosticado:
 *   La versión anterior pasaba input.query (frase web estilo Tavily,
 *   ej. "sector educativo Colombia servicios corporativo") al campo
 *   q_organization_name, que Apollo interpreta como nombre exacto de empresa.
 *   Resultado: 0 coincidencias siempre.
 *
 * Solución:
 *   - Usar q_keywords para texto libre (búsqueda más amplia en Apollo).
 *   - Derivar keywords estructuradas del sector/industria cuando existe mapping.
 *   - Usar organization_locations para país (no dentro del texto de query).
 *   - No enviar frases web largas innecesarias.
 *
 * Reglas:
 *   - Puro: sin side effects, sin llamadas externas.
 *   - No modifica apollo-client.ts ni SearchOrganizationsParams.
 *   - Solo usa campos que SearchOrganizationsParams ya soporta.
 *   - No guarda API keys ni headers en metadata.
 */

import type { SearchOrganizationsParams } from '@/server/integrations/apollo-client';
import type { WebSearchInput } from './types';

// ─── Constantes ───────────────────────────────────────────────────────────────

export const APOLLO_QUERY_MAPPING_VERSION = 'v1.16K-AA';

// ─── Sector → keywords Apollo ─────────────────────────────────────────────────

/**
 * Mapa conservador de sectores SellUp a keywords Apollo.
 * Apollo busca estas palabras en campos de descripción y keywords de la empresa.
 *
 * Preferimos términos en inglés porque Apollo indexa en inglés.
 * Añadimos variantes en español para empresas latinas.
 */
const SECTOR_KEYWORD_MAP: Record<string, string[]> = {
  educación: [
    'education', 'e-learning', 'elearning', 'corporate training',
    'higher education', 'lms', 'learning management', 'training', 'educación',
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

/**
 * Normaliza el nombre de sector para lookup en el mapa.
 * Remueve acentos, pasa a minúsculas.
 */
function normalizeSector(sector: string): string {
  return sector
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/**
 * Busca keywords Apollo para un sector dado.
 * Retorna array vacío si no hay mapping explícito.
 */
export function getSectorKeywords(sector: string | null | undefined): string[] {
  if (!sector?.trim()) return [];
  const normalized = normalizeSector(sector);
  for (const [key, keywords] of Object.entries(SECTOR_KEYWORD_MAP)) {
    if (normalized.includes(normalizeSector(key)) || normalizeSector(key).includes(normalized)) {
      return keywords;
    }
  }
  // Fallback: usar el sector original como keyword simple
  return [sector.trim()];
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
  apollo_keywords_sent: string | null;
  apollo_location_sent: string | null;
  q_organization_name_sent: string | null;
  requested_max_results: number;
  capped_max_results: number;
  was_capped: boolean;
};

export type ApolloSearchParamsWithMeta = {
  params: SearchOrganizationsParams;
  meta: ApolloQueryMappingMeta;
};

// ─── Helper principal ─────────────────────────────────────────────────────────

/**
 * Construye los parámetros de búsqueda para Apollo Organizations a partir de
 * los criterios del wizard SellUp.
 *
 * Estrategia:
 *   1. Cuando hay sector/industria: combinar keywords del sector con
 *      country name en q_keywords (no q_organization_name).
 *   2. Cuando hay solo query de texto: usar q_keywords (no q_organization_name).
 *   3. País siempre en organization_locations (filtro estructurado).
 *   4. q_organization_name queda vacío — no matchear nombres exactos.
 *
 * @param input           WebSearchInput con query, country, countryCode, industry.
 * @param cappedMaxResults Número de resultados ya capado por el guardrail del provider.
 */
export function buildApolloOrganizationsSearchParams(
  input: WebSearchInput,
  cappedMaxResults: number,
): ApolloSearchParamsWithMeta {
  const sectorKeywords = getSectorKeywords(input.industry);

  // Construir q_keywords:
  //   - Con sector keywords: usar solo las keywords del sector (max 5).
  //     La frase web del wizard no tiene valor como keyword Apollo; se guarda en meta.
  //   - Sin sector keywords: usar la query como keyword libre (fallback).
  const queryWords = input.query?.trim() ?? '';

  let keywordParts: string[];
  if (sectorKeywords.length > 0) {
    keywordParts = sectorKeywords.slice(0, 5);
  } else {
    keywordParts = [queryWords].filter(Boolean);
  }

  const apolloKeywords = keywordParts.join(' ').trim() || null;
  const apolloLocation = input.country?.trim() ?? null;

  const params: SearchOrganizationsParams = {
    // q_keywords: búsqueda libre en descripción/keywords de la empresa (correcto)
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
    sector_keywords_used: sectorKeywords,
    apollo_keywords_sent: apolloKeywords,
    apollo_location_sent: apolloLocation,
    q_organization_name_sent: null,
    requested_max_results: cappedMaxResults,
    capped_max_results: cappedMaxResults,
    was_capped: false, // el caller lo rellena con el valor real del cap
  };

  return { params, meta };
}
