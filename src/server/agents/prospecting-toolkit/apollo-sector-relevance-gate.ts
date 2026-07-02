/**
 * Apollo Sector Relevance Gate (v1.L2.12-A)
 *
 * Compuerta de relevancia sectorial para resultados Apollo Organizations.
 * Se aplica después del mapping y antes de la escritura/persistencia.
 *
 * Problema (v1.16K-AC post-mortem):
 *   Apollo devuelve empresas genéricas (Citigroup, Huawei) para búsquedas
 *   sectoriales como Educación porque "learning management system" puede
 *   aparecer en cualquier gran corporación. Sin filtro post-API, esos
 *   resultados fluyen al writer y consumen créditos sin valor.
 *
 * Extensión L2.12-A — Subindustria como gate de precisión:
 *   El parámetro `subindustry` (opcional) permite usar señales más estrictas
 *   cuando la búsqueda tiene una subindustria con mapping propio.
 *   Ejemplo: sector='Educación' + subindustry='formación corporativa' → gate
 *   rechaza universidades genéricas y solo pasa LMS vendors / corporate training.
 *   Sin `subindustry`, o si la subindustria no tiene mapping, aplica señales de sector.
 *
 * Solución:
 *   - Evaluar señales textuales en campos disponibles del candidato mapeado
 *     (title, snippet, domain, industria si existe).
 *   - Solo pasar candidatos con evidencia mínima del sector buscado.
 *   - Sectores sin mapping → passthrough (no rompe lógica existente).
 *   - Gate aplica solo cuando provider = apollo_organizations.
 *   - Tavily no afectado.
 *
 * Reglas:
 *   - Puro: sin side effects, sin llamadas externas.
 *   - No guarda API keys ni headers en metadata.
 *   - No usa blacklist por nombre de empresa como solución primaria.
 *   - Usa ausencia de evidencia sectorial como criterio de rechazo.
 */

import type { WebSearchResult } from './types';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_SECTOR_GATE_VERSION = 'v1.L2.12-A';

// ─── Términos de sector ───────────────────────────────────────────────────────

/**
 * Señales sectoriales por sector normalizado.
 * Cada array contiene términos en español e inglés que indican pertenencia al sector.
 * Si cualquiera de estas señales aparece en los campos del candidato → pasa el gate.
 */
const SECTOR_SIGNAL_TERMS: Record<string, string[]> = {
  /**
   * Señales amplias de educación — cualquier tipo de empresa educativa pasa.
   * Usar cuando sector='Educación' sin subindustria específica.
   */
  educacion: [
    // Español
    'universidad',
    'colegio',
    'instituto',
    'educación',
    'educacion',
    'educativo',
    'educativa',
    'capacitación',
    'capacitacion',
    'formación',
    'formacion',
    'aprendizaje',
    'aula',
    'campus',
    'virtual',
    'e-learning',
    'elearning',
    // Inglés
    'university',
    'college',
    'school',
    'academy',
    'education',
    'educational',
    'learning',
    'training',
    'lms',
    'learning management',
    'corporate training',
    'online learning',
    'edtech',
    'ed-tech',
  ],
  /**
   * Señales estrictas de formación corporativa — solo pasan LMS vendors,
   * corporate training providers y edtech de capacitación empresarial.
   *
   * Deliberadamente excluye: 'education', 'university', 'college', 'school',
   * 'learning' genérico, 'formacion' genérico — para rechazar universidades
   * tradicionales (Politécnico, UNAL, etc.) que no son el ICP de SellUp.
   *
   * Usar cuando subindustry='formación corporativa' (o variantes normalizadas).
   */
  'formacion corporativa': [
    // Señales de plataforma / producto
    'lms',
    'learning management system',
    'learning management',
    'e-learning platform',
    'online learning platform',
    'training platform',
    'learning platform',
    'elearning platform',
    // Señales de servicio corporativo
    'corporate training',
    'corporate learning',
    'workforce training',
    'workforce development',
    'employee training',
    'capacitacion empresarial',
    'capacitacion corporativa',
    'formacion corporativa',
    'educacion corporativa',
    'training provider',
    'corporate education',
    // Señales de categoría edtech / B2B learning
    'edtech',
    'ed-tech',
    'online learning',
    'e-learning',
    'blended learning',
  ],
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Muestra de candidato para diagnóstico (sin secretos). */
export type ApolloSectorGateSample = {
  name: string;
  domain: string | null;
  matched_terms: string[];
  reason?: string;
};

/** Metadata del gate — segura para logs (sin API keys, headers ni tokens). */
export type ApolloSectorRelevanceGateMeta = {
  gate_version: string;
  /** El gate evaluó candidatos. */
  enabled: boolean;
  /** El sector fue reconocido y tiene mapping de señales. */
  sector_mapped: boolean;
  sector: string | null;
  /** Subindustria recibida (L2.12-A). Null si no se proporcionó. */
  subindustry: string | null;
  /**
   * True cuando se usaron las señales de subindustria en lugar de las de sector.
   * Indica que el gate es más estricto de lo que sería con sector solo.
   */
  subindustry_signal_used: boolean;
  strategy: 'sector_evidence_required' | 'passthrough';
  checked_count: number;
  passed_count: number;
  rejected_count: number;
  rejected_samples: ApolloSectorGateSample[];
  passed_samples: ApolloSectorGateSample[];
  reason?: string;
};

export type ApolloSectorGateResult = {
  passed: WebSearchResult[];
  metadata: ApolloSectorRelevanceGateMeta;
};

// ─── Normalización interna ────────────────────────────────────────────────────

function normalizeSector(sector: string): string {
  return sector
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Busca las señales configuradas para un sector dado. Null si no mapeado. */
function getSectorSignals(sector: string | null | undefined): string[] | null {
  if (!sector?.trim()) return null;
  const normalized = normalizeSector(sector);
  for (const [key, signals] of Object.entries(SECTOR_SIGNAL_TERMS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return signals;
    }
  }
  return null;
}

/**
 * Extrae el texto candidato de un resultado mapeado para análisis de señales.
 * Combina title, snippet, domain, url, industry, keywords y short_description.
 * Desde v1.16K-AE también extrae keywords/description desde apollo_profile.
 */
function extractCandidateText(result: WebSearchResult): string {
  const parts: string[] = [];

  if (result.title) parts.push(result.title);
  if (result.snippet) parts.push(result.snippet);

  const url = result.url ?? '';
  if (url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      parts.push(hostname);
    } catch {
      parts.push(url);
    }
  }

  // metadata puede tener campos planos (domain, industry) y apollo_profile enriquecido
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (meta) {
    const domain = meta['domain'];
    if (typeof domain === 'string' && domain) parts.push(domain);
    const industry = meta['industry'];
    if (typeof industry === 'string' && industry) parts.push(industry);

    // Campos planos (v1.16K-AE): keywords y short_description directos en metadata
    const metaKeywords = meta['keywords'];
    if (Array.isArray(metaKeywords)) {
      for (const k of metaKeywords) { if (typeof k === 'string' && k) parts.push(k); }
    }
    const metaDesc = meta['short_description'];
    if (typeof metaDesc === 'string' && metaDesc) parts.push(metaDesc);

    // apollo_profile enriquecido (v1.16K-AE): fuente más completa
    const apolloProfile = meta['apollo_profile'] as Record<string, unknown> | undefined;
    if (apolloProfile) {
      const profileKeywords = apolloProfile['keywords'];
      if (Array.isArray(profileKeywords)) {
        for (const k of profileKeywords) { if (typeof k === 'string' && k) parts.push(k); }
      }
      const profileDesc = apolloProfile['short_description'];
      if (typeof profileDesc === 'string' && profileDesc) parts.push(profileDesc);
    }
  }

  return parts.join(' ').toLowerCase();
}

/**
 * Evalúa qué señales sectoriales aparecen en el texto del candidato.
 * Retorna los términos encontrados (vacío = sin evidencia).
 */
function findMatchedTerms(text: string, signals: string[]): string[] {
  return signals.filter(term => text.includes(term.toLowerCase()));
}

/** Extrae nombre y dominio del candidato para los samples de metadata. */
function extractNameAndDomain(result: WebSearchResult): { name: string; domain: string | null } {
  const name = result.title ?? 'unknown';
  const meta = result.metadata as Record<string, unknown> | undefined;
  const domain = (typeof meta?.['domain'] === 'string' ? meta['domain'] : null);
  return { name, domain };
}

// ─── Gate principal ───────────────────────────────────────────────────────────

const MAX_SAMPLES = 5;

/**
 * Aplica el gate de relevancia sectorial a los resultados Apollo.
 *
 * @param results      Resultados ya mapeados por el provider Apollo.
 * @param sector       Sector de la búsqueda (del wizard SellUp), ej. "Educación".
 * @param provider     Provider que generó los resultados. Gate solo actúa para 'apollo_organizations'.
 * @param subindustry  (L2.12-A) Subindustria opcional. Cuando tiene mapping propio usa señales
 *                     más estrictas en lugar de las del sector padre. Ejemplo: 'formación corporativa'
 *                     rechaza universidades y solo pasa LMS vendors / corporate training providers.
 */
export function applyApolloSectorRelevanceGate(
  results: WebSearchResult[],
  sector: string | null | undefined,
  provider: string | null | undefined,
  subindustry?: string | null,
): ApolloSectorGateResult {
  // Resolver señales: subindustria primero (más específica), sector como fallback.
  const subindustrySignals = subindustry ? getSectorSignals(subindustry) : null;
  const sectorSignals = getSectorSignals(sector);
  const subindustrySignalUsed = !!(subindustrySignals);

  const baseMeta = {
    subindustry: subindustry ?? null,
    subindustry_signal_used: subindustrySignalUsed,
  };

  // Gate solo aplica para apollo_organizations
  if (provider !== 'apollo_organizations') {
    return {
      passed: results,
      metadata: {
        gate_version: APOLLO_SECTOR_GATE_VERSION,
        enabled: false,
        sector_mapped: false,
        sector: sector ?? null,
        ...baseMeta,
        strategy: 'passthrough',
        checked_count: 0,
        passed_count: results.length,
        rejected_count: 0,
        rejected_samples: [],
        passed_samples: [],
        reason: 'non_apollo_provider',
      },
    };
  }

  const signals = subindustrySignals ?? sectorSignals;

  // Sin mapping (ni sector ni subindustria) → passthrough sin bloquear
  if (!signals) {
    return {
      passed: results,
      metadata: {
        gate_version: APOLLO_SECTOR_GATE_VERSION,
        enabled: false,
        sector_mapped: false,
        sector: sector ?? null,
        ...baseMeta,
        strategy: 'passthrough',
        checked_count: 0,
        passed_count: results.length,
        rejected_count: 0,
        rejected_samples: [],
        passed_samples: [],
        reason: 'sector_not_mapped',
      },
    };
  }

  // Sector (o subindustria) mapeado → evaluar evidencia
  const passed: WebSearchResult[] = [];
  const rejected: WebSearchResult[] = [];
  const rejectedSamples: ApolloSectorGateSample[] = [];
  const passedSamples: ApolloSectorGateSample[] = [];

  for (const result of results) {
    const text = extractCandidateText(result);
    const matchedTerms = findMatchedTerms(text, signals);
    const { name, domain } = extractNameAndDomain(result);

    if (matchedTerms.length > 0) {
      passed.push(result);
      if (passedSamples.length < MAX_SAMPLES) {
        passedSamples.push({ name, domain, matched_terms: matchedTerms });
      }
    } else {
      const enrichedResult: WebSearchResult = {
        ...result,
        metadata: {
          ...(result.metadata as Record<string, unknown>),
          final_skip_reason: 'apollo_sector_relevance:insufficient_sector_evidence',
        },
      };
      rejected.push(enrichedResult);
      if (rejectedSamples.length < MAX_SAMPLES) {
        rejectedSamples.push({
          name,
          domain,
          matched_terms: [],
          reason: 'insufficient_sector_evidence',
        });
      }
    }
  }

  return {
    passed,
    metadata: {
      gate_version: APOLLO_SECTOR_GATE_VERSION,
      enabled: true,
      sector_mapped: true,
      sector: sector ?? null,
      ...baseMeta,
      strategy: 'sector_evidence_required',
      checked_count: results.length,
      passed_count: passed.length,
      rejected_count: rejected.length,
      rejected_samples: rejectedSamples,
      passed_samples: passedSamples,
    },
  };
}
