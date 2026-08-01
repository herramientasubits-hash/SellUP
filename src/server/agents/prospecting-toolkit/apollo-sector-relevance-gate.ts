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

export const APOLLO_SECTOR_GATE_VERSION = 'v1.L2.14-A';

// ─── Términos de sector ───────────────────────────────────────────────────────

/**
 * L2.14: Industrias que indican claramente un COMPRADOR (buyer), no un vendedor.
 * Cuando la industria Apollo es buyer y los únicos matches son señales genéricas
 * de training interno (sin señales de producto/plataforma), rechazar con
 * reason='buyer_or_non_vendor_signal'.
 *
 * Aplica solo al gate 'formacion corporativa' (subindustria estricta).
 */
const BUYER_INDUSTRY_EXCLUSION: string[] = [
  'oil', 'energy', 'petroleum', 'mining', 'gas',
  'banking', 'financial services', 'insurance', 'investment banking',
  'retail', 'consumer goods', 'food', 'beverage', 'tobacco',
  'automotive', 'manufacturing', 'construction', 'real estate',
  'telecommunications', 'utilities', 'transportation', 'logistics',
  'health care', 'healthcare', 'hospital', 'pharmaceutical',
  'government', 'military', 'defense',
];

/**
 * L2.14: Señales de PRODUCTO / PLATAFORMA que solo aplican a vendors LMS / edtech.
 * Un buyer puede tener 'employee training' pero no tendrá 'lms' o 'training platform'
 * como señal primaria de su industria.
 * Si el candidato tiene al menos una vendor_product_signal → no es buyer.
 */
const VENDOR_PRODUCT_SIGNALS: string[] = [
  'lms',
  'learning management system',
  'learning management',
  'e-learning platform',
  'elearning platform',
  'training platform',
  'learning platform',
  'online learning platform',
  'edtech',
  'ed-tech',
  'training provider',
];

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
   * A1-APOLLO-BUDGET-RECONCILIATION-1 — Retail y Consumo (señales amplias).
   *
   * NO incluye el token suelto 'retail': es substring de 'retail banking', y con
   * él Citigroup pasaba una búsqueda de retail — el mismo modo de fallo de
   * v1.16K-AC. Se usan formas que sólo aparecen en un minorista real
   * ('retailer', 'retail chain', 'retail store').
   */
  'retail y consumo': [
    // Español
    'comercio minorista',
    'minorista',
    'tienda',
    'tiendas',
    'cadena de tiendas',
    'almacen de cadena',
    'consumo masivo',
    'supermercado',
    'supermercados',
    'hipermercado',
    'hipermercados',
    // Inglés
    'retailer',
    'retail chain',
    'retail store',
    'consumer goods',
    'supermarket',
    'hypermarket',
    'grocery',
    'grocery retail',
    'grocery store',
  ],
  /**
   * A1-APOLLO-BUDGET-RECONCILIATION-1 — Supermercados e Hipermercados (estricto).
   *
   * Sólo operadores de supermercado/hipermercado y grocery retail. Excluye
   * deliberadamente 'retail' y 'comercio' genéricos, que dejarían pasar
   * cualquier gran corporación con una línea de retail.
   */
  'supermercados e hipermercados': [
    // Español
    'supermercado',
    'supermercados',
    'hipermercado',
    'hipermercados',
    'autoservicio',
    'almacen de cadena',
    'cadena de supermercados',
    'tienda de descuento',
    // Inglés
    'supermarket',
    'supermarkets',
    'hypermarket',
    'hypermarkets',
    'grocery',
    'grocery retail',
    'grocery store',
    'grocery chain',
    'retail chain',
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
  /** L2.13: campos Apollo presentes en el resultado (sin emails/teléfonos/personas). */
  evidence_fields_present?: string[];
  /** L2.13: si Apollo trajo keywords propias de la organización. */
  apollo_keywords_sample?: string[];
  /** L2.13: si Apollo trajo short_description. */
  description_present?: boolean;
  /** L2.13: industria que Apollo reporta para esta organización. */
  apollo_industry?: string | null;
  /** L2.13: cantidad de empleados que Apollo reporta. */
  apollo_employee_count?: number | null;
  /** L2.13: campos que el gate usó como evidencia (subset de evidence_fields_present). */
  provider_evidence_used?: string[];
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
  return getSectorSignalEntry(sector)?.signals ?? null;
}

/**
 * A1-APOLLO-TWO-ROUND-QUALITY-1: igual que `getSectorSignals` pero devolviendo
 * también la CLAVE que coincidió. La clave es lo que permite consultar las
 * tablas de industria amplia y de industria contradictoria del § 5, que están
 * indexadas por sector.
 */
function getSectorSignalEntry(
  sector: string | null | undefined,
): { key: string; signals: string[] } | null {
  if (!sector?.trim()) return null;
  const normalized = normalizeSector(sector);
  for (const [key, signals] of Object.entries(SECTOR_SIGNAL_TERMS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { key, signals };
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

    // apollo_profile enriquecido — fuente más completa (v1.16K-AE, extended L2.14)
    const apolloProfile = meta['apollo_profile'] as Record<string, unknown> | undefined;
    if (apolloProfile) {
      // industry escalar
      const profileIndustry = apolloProfile['industry'];
      if (typeof profileIndustry === 'string' && profileIndustry) parts.push(profileIndustry);
      // L2.14: industries array alternativo
      const profileIndustries = apolloProfile['industries'];
      if (Array.isArray(profileIndustries)) {
        for (const i of profileIndustries) { if (typeof i === 'string' && i) parts.push(i); }
      }
      // keywords array
      const profileKeywords = apolloProfile['keywords'];
      if (Array.isArray(profileKeywords)) {
        for (const k of profileKeywords) { if (typeof k === 'string' && k) parts.push(k); }
      }
      // L2.14: organization_keywords array alternativo
      const profileOrgKeywords = apolloProfile['organization_keywords'];
      if (Array.isArray(profileOrgKeywords)) {
        for (const k of profileOrgKeywords) { if (typeof k === 'string' && k) parts.push(k); }
      }
      // short_description
      const profileDesc = apolloProfile['short_description'];
      if (typeof profileDesc === 'string' && profileDesc) parts.push(profileDesc);
      // L2.14: seo_description
      const profileSeoDesc = apolloProfile['seo_description'];
      if (typeof profileSeoDesc === 'string' && profileSeoDesc) parts.push(profileSeoDesc);
      // L2.14: description (full)
      const profileFullDesc = apolloProfile['description'];
      if (typeof profileFullDesc === 'string' && profileFullDesc) parts.push(profileFullDesc);
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

/** Extrae nombre, dominio y evidencia del candidato para los samples de metadata. */
function extractCandidateDiagnostics(result: WebSearchResult): {
  name: string;
  domain: string | null;
  evidenceFieldsPresent: string[];
  apolloKeywordsSample: string[];
  descriptionPresent: boolean;
  apolloIndustry: string | null;
  apolloEmployeeCount: number | null;
} {
  const name = result.title ?? 'unknown';
  const meta = result.metadata as Record<string, unknown> | undefined;
  const domain = typeof meta?.['domain'] === 'string' ? meta['domain'] : null;

  const evidenceFieldsPresent: string[] = [];
  if (result.title) evidenceFieldsPresent.push('title');
  if (result.snippet) evidenceFieldsPresent.push('snippet');
  if (domain) evidenceFieldsPresent.push('domain');

  let apolloIndustry: string | null = null;
  let apolloEmployeeCount: number | null = null;
  let apolloKeywordsSample: string[] = [];
  let descriptionPresent = false;

  if (meta) {
    const industry = meta['industry'];
    if (typeof industry === 'string' && industry) {
      evidenceFieldsPresent.push('industry');
      apolloIndustry = industry;
    }
    const empCount = meta['employee_count'];
    if (typeof empCount === 'number') {
      evidenceFieldsPresent.push('employee_count');
      apolloEmployeeCount = empCount;
    }
    const kws = meta['keywords'];
    if (Array.isArray(kws) && kws.length > 0) {
      evidenceFieldsPresent.push('keywords');
      apolloKeywordsSample = (kws as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 5);
    }
    const desc = meta['short_description'];
    if (typeof desc === 'string' && desc) {
      evidenceFieldsPresent.push('short_description');
      descriptionPresent = true;
    }
    const apolloProfile = meta['apollo_profile'] as Record<string, unknown> | undefined;
    if (apolloProfile) {
      // industry escalar desde apollo_profile
      const profileIndustry = apolloProfile['industry'];
      if (typeof profileIndustry === 'string' && profileIndustry && !apolloIndustry) {
        evidenceFieldsPresent.push('apollo_profile.industry');
        apolloIndustry = profileIndustry;
      }
      // L2.14: industries array
      const profileIndustries = apolloProfile['industries'];
      if (Array.isArray(profileIndustries) && profileIndustries.length > 0) {
        evidenceFieldsPresent.push('apollo_profile.industries');
        if (!apolloIndustry) {
          apolloIndustry = (profileIndustries as unknown[]).find((i): i is string => typeof i === 'string') ?? null;
        }
      }
      // keywords array
      const profileKws = apolloProfile['keywords'];
      if (Array.isArray(profileKws) && profileKws.length > 0 && !evidenceFieldsPresent.includes('keywords')) {
        evidenceFieldsPresent.push('apollo_profile.keywords');
        apolloKeywordsSample = (profileKws as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 5);
      }
      // L2.14: organization_keywords array
      const profileOrgKws = apolloProfile['organization_keywords'];
      if (Array.isArray(profileOrgKws) && profileOrgKws.length > 0 && apolloKeywordsSample.length === 0) {
        evidenceFieldsPresent.push('apollo_profile.organization_keywords');
        apolloKeywordsSample = (profileOrgKws as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 5);
      }
      // short_description
      const profileDesc = apolloProfile['short_description'];
      if (typeof profileDesc === 'string' && profileDesc && !descriptionPresent) {
        evidenceFieldsPresent.push('apollo_profile.short_description');
        descriptionPresent = true;
      }
      // L2.14: seo_description
      const profileSeoDesc = apolloProfile['seo_description'];
      if (typeof profileSeoDesc === 'string' && profileSeoDesc && !descriptionPresent) {
        evidenceFieldsPresent.push('apollo_profile.seo_description');
        descriptionPresent = true;
      }
      // L2.14: description full
      const profileFullDesc = apolloProfile['description'];
      if (typeof profileFullDesc === 'string' && profileFullDesc && !descriptionPresent) {
        evidenceFieldsPresent.push('apollo_profile.description');
        descriptionPresent = true;
      }
    }
  }

  return { name, domain, evidenceFieldsPresent, apolloKeywordsSample, descriptionPresent, apolloIndustry, apolloEmployeeCount };
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

  // L2.14: buyer exclusion activa solo para gate estricto de subindustria.
  //
  // A1-APOLLO-BUDGET-RECONCILIATION-1: además, sólo para el gate al que fue
  // escrita ('formacion corporativa'). La regla dice "industria compradora +
  // sin señal de producto LMS ⇒ rechazar", y BUYER_INDUSTRY_EXCLUSION incluye
  // 'retail'. Aplicada al gate de supermercados rechazaría a TODOS los
  // supermercados reales: su industria Apollo es 'retail' y ninguno vende un
  // LMS. La distinción comprador/vendedor sólo tiene sentido cuando lo buscado
  // ES un vendedor de formación.
  const buyerExclusionActive =
    subindustrySignalUsed && signals === SECTOR_SIGNAL_TERMS['formacion corporativa'];

  for (const result of results) {
    const text = extractCandidateText(result);
    const matchedTerms = findMatchedTerms(text, signals);
    const diag = extractCandidateDiagnostics(result);

    // L2.14: buyer exclusion — rechaza empresas cuya industria es claramente compradora
    // cuando el único match son señales genéricas de training interno (sin señales de producto).
    let buyerRejected = false;
    let buyerRejectionReason: string | undefined;
    if (buyerExclusionActive && matchedTerms.length > 0 && diag.apolloIndustry) {
      const industryLower = diag.apolloIndustry.toLowerCase();
      const isBuyerIndustry = BUYER_INDUSTRY_EXCLUSION.some(b => industryLower.includes(b));
      if (isBuyerIndustry) {
        const hasVendorProductSignal = VENDOR_PRODUCT_SIGNALS.some(s => text.includes(s.toLowerCase()));
        if (!hasVendorProductSignal) {
          buyerRejected = true;
          buyerRejectionReason = 'buyer_or_non_vendor_signal';
        }
      }
    }

    if (matchedTerms.length > 0 && !buyerRejected) {
      passed.push(result);
      if (passedSamples.length < MAX_SAMPLES) {
        passedSamples.push({
          name: diag.name,
          domain: diag.domain,
          matched_terms: matchedTerms,
          evidence_fields_present: diag.evidenceFieldsPresent,
          apollo_keywords_sample: diag.apolloKeywordsSample,
          description_present: diag.descriptionPresent,
          apollo_industry: diag.apolloIndustry,
          apollo_employee_count: diag.apolloEmployeeCount,
          provider_evidence_used: matchedTerms.flatMap(t =>
            diag.evidenceFieldsPresent.filter(f => text.includes(t.toLowerCase()) && (f === 'industry' || f === 'keywords' || f === 'short_description' || f === 'snippet' || f.startsWith('apollo_profile'))),
          ).filter((v, i, a) => a.indexOf(v) === i),
        });
      }
    } else {
      const rejectReason = buyerRejected
        ? (buyerRejectionReason ?? 'buyer_or_non_vendor_signal')
        : 'insufficient_sector_evidence';
      const enrichedResult: WebSearchResult = {
        ...result,
        metadata: {
          ...(result.metadata as Record<string, unknown>),
          final_skip_reason: `apollo_sector_relevance:${rejectReason}`,
        },
      };
      rejected.push(enrichedResult);
      if (rejectedSamples.length < MAX_SAMPLES) {
        rejectedSamples.push({
          name: diag.name,
          domain: diag.domain,
          matched_terms: buyerRejected ? matchedTerms : [],
          reason: rejectReason,
          evidence_fields_present: diag.evidenceFieldsPresent,
          apollo_keywords_sample: diag.apolloKeywordsSample,
          description_present: diag.descriptionPresent,
          apollo_industry: diag.apolloIndustry,
          apollo_employee_count: diag.apolloEmployeeCount,
          provider_evidence_used: [],
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

// ─── Evaluación fail-closed para operaciones PAGADAS ──────────────────────────
//
// A1-APOLLO-BUDGET-RECONCILIATION-1.
//
// `applyApolloSectorRelevanceGate` es el gate de PRESENTACIÓN: decide qué
// resultados ya pagados vale la pena persistir, y un sector sin mapping deja
// pasar todo para que un mapping faltante no vacíe un lote en silencio. Ese
// passthrough es correcto ahí y se conserva.
//
// NO es correcto antes de una operación PAGADA. Organization Enrichment cobra un
// crédito por llamada, así que "no tengo mapping de este sector, enriquece todo"
// convierte un hueco de configuración en gasto real sobre candidatos que nadie
// evaluó. Para operaciones pagadas, la ausencia de política falla CERRADO.

/**
 * Veredicto de relevancia sectorial para una operación que va a gastar créditos.
 *
 * `relevant`
 *   Sector mapeado y el candidato coincide.
 *
 * `sector_not_mapped`
 *   No hay conjunto de señales para este sector/subindustria. Fail-closed: sin
 *   política no se autoriza gasto.
 *
 * `sector_relevance_contradicted`
 *   El proveedor SÍ describió el sector de esta empresa y no coincide. Hay
 *   evidencia y contradice. Citigroup en una búsqueda de supermercados cae aquí.
 *
 * `sector_evidence_missing_needs_enrichment`
 *   El proveedor no describió sector alguno. No hay nada que contradiga ni que
 *   confirmar, y resolver esa ambigüedad es exactamente para lo que existe el
 *   enrichment (su orden ambiguity-first enriquece estos candidatos PRIMERO,
 *   Q3F-5AV.2). Es elegible bajo el cap — deliberadamente NO es un passthrough
 *   genérico: es un motivo estructurado que dice por qué se paga.
 */
export type ApolloPaidSectorRelevanceDecision =
  | 'relevant'
  | 'sector_not_mapped'
  | 'sector_relevance_contradicted'
  | 'sector_evidence_missing_needs_enrichment';

export type ApolloPaidSectorRelevanceResult = {
  decision: ApolloPaidSectorRelevanceDecision;
  /** Términos que coincidieron. Vacío en toda decisión que no sea `relevant`. */
  matchedTerms: string[];
  /** True cuando se usó el conjunto estricto de subindustria. */
  subindustrySignalUsed: boolean;
  /** Campos con carga sectorial que el proveedor sí entregó. */
  sectorEvidenceFields: string[];
};

// ─── A1-APOLLO-TWO-ROUND-QUALITY-1 § 5 — clasificación de la industria ────────
//
// El contrato antiguo tenía dos estados donde hacen falta tres. Cualquier
// candidato con evidencia sectorial que no coincidiera con las señales estrictas
// quedaba `sector_relevance_contradicted`, así que un supermercado real cuya
// única industria declarada por Apollo es la categoría amplia `retail` —el caso
// habitual— se rechazaba ANTES del enrichment y no podía siquiera competir por
// resolver su propia ambigüedad. El § 5 lo separa: `retail` no demuestra
// supermercado, pero tampoco lo contradice.

/**
 * Industrias AMPLIAS que contienen al sector buscado sin demostrarlo.
 *
 * Estar aquí no acepta al candidato: lo mantiene con evidencia insuficiente, que
 * es el único estado que puede competir por un enrichment.
 */
const SECTOR_BROAD_COMPATIBLE_INDUSTRY_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    'retail',
    'consumer goods',
    'food',
    'food and beverage',
    'food & beverages',
    'wholesale',
    'consumer services',
    'comercio',
    'consumo',
  ],
  'retail y consumo': [
    'retail',
    'consumer goods',
    'consumer services',
    'wholesale',
    'food',
    'comercio',
    'consumo',
  ],
};

/**
 * Industrias que CONTRADICEN el sector buscado.
 *
 * `retail banking` y `commercial banking` aparecen explícitamente: contienen el
 * substring `retail` y sin nombrarlas la comprobación de industria amplia las
 * dejaría pasar.
 */
const SECTOR_CONTRADICTORY_INDUSTRY_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    'retail banking',
    'commercial banking',
    'investment banking',
    'banking',
    'financial services',
    'finance',
    'insurance',
    'capital markets',
    'software',
    'saas',
    'information technology',
    'consulting',
    'marketplace',
  ],
  'retail y consumo': [
    'retail banking',
    'commercial banking',
    'investment banking',
    'banking',
    'financial services',
    'insurance',
    'capital markets',
  ],
};

/** Veredicto sobre la industria que el proveedor DECLARA para el candidato. */
type DeclaredIndustryClass = 'contradictory' | 'broad_compatible' | 'unclassified';

/**
 * Industrias declaradas por el proveedor.
 *
 * Sólo campos de industria: ni title, ni snippet, ni descripción. La descripción
 * de un supermercado real menciona con frecuencia "servicios financieros"
 * (tarjeta propia, crédito de consumo) y leer eso como contradicción rechazaría
 * justo a los candidatos correctos.
 */
function collectDeclaredIndustryTerms(result: WebSearchResult): string[] {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return [];

  const terms: string[] = [];
  const pushString = (value: unknown) => {
    if (typeof value === 'string' && value.trim() !== '') terms.push(value);
  };
  const pushArray = (value: unknown) => {
    if (Array.isArray(value)) for (const item of value) pushString(item);
  };

  pushString(meta['industry']);
  const profile = meta['apollo_profile'] as Record<string, unknown> | undefined;
  if (profile) {
    pushString(profile['industry']);
    pushArray(profile['industries']);
  }
  return terms;
}

/**
 * Clasifica la industria declarada respecto del sector buscado.
 *
 * Lo contradictorio se comprueba primero por precedencia de substring
 * ('retail banking' ⊃ 'retail'), y basta UNA industria contradictoria para que
 * el candidato lo sea: una empresa que Apollo describe a la vez como banca y
 * como retail no es la evidencia de supermercado que autoriza gasto.
 */
function classifyDeclaredIndustryForSector(
  result: WebSearchResult,
  sectorKey: string,
): DeclaredIndustryClass {
  const declared = collectDeclaredIndustryTerms(result).map(normalizeSector);
  if (declared.length === 0) return 'unclassified';

  const contradictory = SECTOR_CONTRADICTORY_INDUSTRY_TERMS[sectorKey] ?? [];
  for (const term of contradictory) {
    if (declared.some((industry) => industry.includes(term))) return 'contradictory';
  }

  const broad = SECTOR_BROAD_COMPATIBLE_INDUSTRY_TERMS[sectorKey] ?? [];
  for (const term of broad) {
    if (declared.some((industry) => industry.includes(term))) return 'broad_compatible';
  }

  return 'unclassified';
}

/**
 * Campos que contienen una AFIRMACIÓN de sector.
 *
 * title, snippet y domain quedan fuera a propósito: el nombre de una empresa no
 * dice de forma fiable a qué industria pertenece, y leer su ausencia como
 * "sector equivocado" rechazaría a todo candidato cuyo nombre no se
 * autodescriba.
 */
function collectSectorEvidenceFields(result: WebSearchResult): string[] {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return [];

  const present: string[] = [];
  const pushIfString = (value: unknown, field: string) => {
    if (typeof value === 'string' && value.trim() !== '') present.push(field);
  };
  const pushIfNonEmptyArray = (value: unknown, field: string) => {
    if (Array.isArray(value) && value.some((v) => typeof v === 'string' && v.trim() !== '')) {
      present.push(field);
    }
  };

  pushIfString(meta['industry'], 'industry');
  pushIfNonEmptyArray(meta['keywords'], 'keywords');
  pushIfString(meta['short_description'], 'short_description');

  const profile = meta['apollo_profile'] as Record<string, unknown> | undefined;
  if (profile) {
    pushIfString(profile['industry'], 'apollo_profile.industry');
    pushIfNonEmptyArray(profile['industries'], 'apollo_profile.industries');
    pushIfNonEmptyArray(profile['keywords'], 'apollo_profile.keywords');
    pushIfNonEmptyArray(profile['organization_keywords'], 'apollo_profile.organization_keywords');
    pushIfString(profile['short_description'], 'apollo_profile.short_description');
    pushIfString(profile['seo_description'], 'apollo_profile.seo_description');
    pushIfString(profile['description'], 'apollo_profile.description');
  }

  return present;
}

/**
 * Evalúa la relevancia sectorial de un candidato para una operación pagada.
 *
 * Falla cerrado donde fallar cerrado significa algo:
 *   - un sector sin mapping nunca autoriza gasto: no hay política que aplicar;
 *   - un candidato que el proveedor describe como de OTRO sector tampoco.
 *
 * Pero la ausencia de evidencia se trata como ausencia, no como contradicción.
 * Bloquear ese caso dejaría a la cascada sin candidatos — justo los que existe
 * para resolver — sin bloquear nada tipo Citigroup: a Citigroup se le rechaza
 * porque Apollo dice "banking", no porque Apollo no diga nada. Los candidatos
 * que sigan siendo irrelevantes tras el enrichment los rechaza igualmente el
 * gate de presentación, que corre sobre el perfil ya enriquecido.
 *
 * Puro — sin efectos secundarios, sin llamadas al proveedor.
 */
export function evaluateApolloSectorRelevanceForPaidOperation(
  result: WebSearchResult,
  sector: string | null | undefined,
  subindustry?: string | null,
): ApolloPaidSectorRelevanceResult {
  const subindustryEntry = subindustry ? getSectorSignalEntry(subindustry) : null;
  const entry = subindustryEntry ?? getSectorSignalEntry(sector);
  const subindustrySignalUsed = subindustryEntry !== null;
  const sectorEvidenceFields = collectSectorEvidenceFields(result);

  if (!entry) {
    return {
      decision: 'sector_not_mapped',
      matchedTerms: [],
      subindustrySignalUsed,
      sectorEvidenceFields,
    };
  }

  const text = extractCandidateText(result);
  const matchedTerms = findMatchedTerms(text, entry.signals);

  if (matchedTerms.length > 0) {
    return { decision: 'relevant', matchedTerms, subindustrySignalUsed, sectorEvidenceFields };
  }

  // A1-APOLLO-TWO-ROUND-QUALITY-1 § 5 — sin señales específicas, la INDUSTRIA
  // declarada decide, y decide en este orden:
  //
  //   contradictoria  → rechazo antes del enrichment (Citigroup: 'retail banking')
  //   amplia          → evidencia INSUFICIENTE, no contradicción. Un supermercado
  //                     real cuya única industria Apollo es 'retail' cae aquí y
  //                     puede competir por un enrichment que resuelva la duda.
  //   ninguna         → se conserva el criterio previo: hay evidencia sectorial
  //                     de otro tipo y no coincide ⇒ contradicción.
  //
  // El orden importa: 'retail banking' CONTIENE 'retail'. Comprobar primero lo
  // amplio dejaría pasar a la banca minorista como "supermercado por confirmar",
  // que es el modo de fallo de v1.16K-AC con otro nombre.
  const industryClass = classifyDeclaredIndustryForSector(result, entry.key);

  if (industryClass === 'contradictory') {
    return {
      decision: 'sector_relevance_contradicted',
      matchedTerms: [],
      subindustrySignalUsed,
      sectorEvidenceFields,
    };
  }
  if (industryClass === 'broad_compatible') {
    return {
      decision: 'sector_evidence_missing_needs_enrichment',
      matchedTerms: [],
      subindustrySignalUsed,
      sectorEvidenceFields,
    };
  }

  return {
    decision:
      sectorEvidenceFields.length > 0
        ? 'sector_relevance_contradicted'
        : 'sector_evidence_missing_needs_enrichment',
    matchedTerms: [],
    subindustrySignalUsed,
    sectorEvidenceFields,
  };
}
