/**
 * query-hypothesis.ts — Hipótesis de consulta de la ronda 1 (estricta) y de la
 * ronda 2 (adaptativa).
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 3 y § 8.
 *
 * Dos reglas gobiernan este módulo:
 *
 * 1. La consulta NO depende de la palabra `retail`. `retail` es substring de
 *    `retail banking`, y con ella Citigroup entraba en una búsqueda de
 *    supermercados — el modo de fallo de v1.16K-AC. Las señales positivas son
 *    formas que sólo aparecen en un minorista de alimentos real.
 *
 * 2. Sólo se emiten parámetros que el contrato vigente del provider admite
 *    (`apollo-organizations-request-contract`). Apollo no ofrece exclusión de
 *    keywords en `mixed_companies/search`, así que las señales contradictorias
 *    NO se envían: se aplican localmente justo después de normalizar y siempre
 *    antes de cualquier enrichment pagado (§ 8). SIC/NAICS no se reintroducen.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

import { APOLLO_MAX_FILTER_VALUES } from '../apollo-organizations-request-contract';

// ─── Catálogo sectorial de señales ────────────────────────────────────────────

/** Señales positivas y contradictorias de un sector o subindustria. */
export type SectorSignalSet = {
  /** Términos que sólo aparecen en un miembro real del sector. */
  positive: readonly string[];
  /**
   * Términos que, en la INDUSTRIA declarada por el proveedor, contradicen el
   * sector buscado. Nunca viajan a Apollo: se penalizan localmente.
   */
  contradictory: readonly string[];
  /**
   * Sinónimos controlados que la ronda 2 puede usar y la ronda 1 no. Amplían la
   * hipótesis sin abandonar el sector.
   */
  round2Synonyms: readonly string[];
};

/**
 * Señales contradictorias que aplican a cualquier búsqueda de comercio y
 * consumo. Enumeradas por el § 3.
 */
const UNIVERSAL_CONTRADICTORY_SIGNALS: readonly string[] = [
  'retail banking',
  'commercial banking',
  'banking',
  'financial services',
  'investment banking',
  'insurance',
  'software',
  'saas',
  'consulting',
  'marketplace',
];

/**
 * Claves normalizadas → señales. Las claves se normalizan igual que la entrada
 * (minúsculas, sin acentos) para que `Supermercados e Hipermercados` y
 * `supermercados e hipermercados` resuelvan al mismo conjunto.
 */
const SECTOR_SIGNAL_CATALOG: Readonly<Record<string, SectorSignalSet>> = {
  'supermercados e hipermercados': {
    positive: [
      'supermercado',
      'supermercados',
      'hipermercado',
      'hipermercados',
      'grocery',
      'grocery store',
      'food retail',
      'cadena de supermercados',
      'retail de alimentos',
    ],
    contradictory: UNIVERSAL_CONTRADICTORY_SIGNALS,
    round2Synonyms: [
      'grocery chain',
      'grocery retail',
      'supermarket chain',
      'autoservicio',
      'tienda de descuento',
      'almacen de cadena',
      'food retailer',
    ],
  },
  'retail y consumo': {
    positive: [
      'retailer',
      'retail chain',
      'retail store',
      'comercio minorista',
      'consumo masivo',
      'supermercado',
      'hipermercado',
      'grocery',
      'consumer goods',
    ],
    contradictory: UNIVERSAL_CONTRADICTORY_SIGNALS,
    round2Synonyms: [
      'cadena de tiendas',
      'grocery retail',
      'food retail',
      'tienda por departamento',
    ],
  },
};

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

/**
 * Señales de la subindustria si existen; si no, las del sector. Null cuando
 * ninguna de las dos está en el catálogo — el llamador decide si eso bloquea.
 */
export function resolveSectorSignalSet(
  sector: string | null | undefined,
  subindustry?: string | null,
): { signals: SectorSignalSet; matchedKey: string; usedSubindustry: boolean } | null {
  const lookup = (value: string | null | undefined): { signals: SectorSignalSet; key: string } | null => {
    if (!value?.trim()) return null;
    const normalized = normalizeKey(value);
    for (const [key, signals] of Object.entries(SECTOR_SIGNAL_CATALOG)) {
      if (normalized === key || normalized.includes(key) || key.includes(normalized)) {
        return { signals, key };
      }
    }
    return null;
  };

  const fromSubindustry = lookup(subindustry);
  if (fromSubindustry) {
    return {
      signals: fromSubindustry.signals,
      matchedKey: fromSubindustry.key,
      usedSubindustry: true,
    };
  }
  const fromSector = lookup(sector);
  if (fromSector) {
    return { signals: fromSector.signals, matchedKey: fromSector.key, usedSubindustry: false };
  }
  return null;
}

// ─── Hipótesis ────────────────────────────────────────────────────────────────

export type ApolloTwoRoundQueryContext = {
  country: string | null;
  countryCode: string | null;
  sector: string | null;
  subindustry: string | null;
  /** Ciudades o regiones objetivo, cuando forman parte de la intención. */
  targetLocations?: readonly string[];
  /** Rangos de empleados ya mapeados al vocabulario de Apollo. */
  employeeRanges?: readonly string[];
};

/**
 * Parámetros de Apollo que la hipótesis emite. Sólo claves del allowlist del
 * contrato; el resto del body (page, per_page) lo gobierna el presupuesto.
 */
export type ApolloTwoRoundQueryParameters = {
  locations: string[];
  keywordTags: string[];
  employeeRanges: string[];
};

export type ApolloTwoRoundQueryHypothesis = {
  roundNumber: number;
  /** Descripción legible de la hipótesis. Va a metadata, no a Apollo. */
  queryHypothesis: string;
  /** Parámetros sanitizados que sí viajan al proveedor. */
  queryParameters: ApolloTwoRoundQueryParameters;
  /** Términos aplicados localmente porque Apollo no admite exclusiones. */
  locallyExcludedTerms: string[];
  /** Por qué la hipótesis de la ronda 2 difiere de la de la ronda 1. */
  queryAdaptationReason: string | null;
  requestedResultLimit: number;
  /** True cuando el sector no tenía señales en el catálogo. */
  sectorSignalsMissing: boolean;
};

function dedupeTrimmed(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.slice(0, APOLLO_MAX_FILTER_VALUES);
}

/**
 * Ronda 1 — la hipótesis MÁS específica disponible.
 *
 * Prefiere las señales de la subindustria sobre las del sector: buscar
 * "Supermercados e Hipermercados" con las señales amplias de "Retail y Consumo"
 * es exactamente la imprecisión que este hito corrige.
 */
export function buildRound1Hypothesis(
  context: ApolloTwoRoundQueryContext,
  requestedResultLimit: number,
): ApolloTwoRoundQueryHypothesis {
  const resolved = resolveSectorSignalSet(context.sector, context.subindustry);
  const positive = resolved ? [...resolved.signals.positive] : [];

  const label = context.subindustry?.trim() || context.sector?.trim() || 'sin sector';
  const countryLabel = context.country?.trim() || context.countryCode?.trim() || 'sin país';

  return {
    roundNumber: 1,
    queryHypothesis: `${label} en ${countryLabel} — señales estrictas de subindustria`,
    queryParameters: {
      locations: dedupeTrimmed([context.country, ...(context.targetLocations ?? [])]),
      keywordTags: dedupeTrimmed(positive),
      employeeRanges: dedupeTrimmed(context.employeeRanges ?? []),
    },
    locallyExcludedTerms: resolved ? [...resolved.signals.contradictory] : [],
    queryAdaptationReason: null,
    requestedResultLimit,
    sectorSignalsMissing: resolved === null,
  };
}

/** Lo que la ronda 1 dejó ver, y que la ronda 2 usa para adaptarse. */
export type Round1Feedback = {
  /** Cuántas empresas elegibles faltan para el objetivo. */
  remainingTarget: number;
  /** Identidades ya vistas que la ronda 2 no puede volver a procesar. */
  excludedSeenOrganizationCount: number;
  /**
   * Motivos de descarte observados en la ronda 1, en códigos estáticos. Guían la
   * adaptación sin arrastrar datos de las empresas descartadas.
   */
  observedRejectionReasons: readonly string[];
  /** Términos derivados de falsos positivos de la ronda 1. */
  falsePositiveTerms?: readonly string[];
};

/**
 * Ronda 2 — adaptativa.
 *
 * NUNCA repite la consulta de la ronda 1: si la hipótesis resultante fuese
 * idéntica, gastar una segunda búsqueda no puede traer nada nuevo. Cuando no hay
 * sinónimos ni ciudades disponibles con que diferenciarla, se declara y el
 * orquestador omite la ronda en vez de pagar por la misma consulta dos veces.
 */
export function buildRound2Hypothesis(
  context: ApolloTwoRoundQueryContext,
  feedback: Round1Feedback,
  requestedResultLimit: number,
): ApolloTwoRoundQueryHypothesis & { differsFromRound1: boolean } {
  const round1 = buildRound1Hypothesis(context, requestedResultLimit);
  const resolved = resolveSectorSignalSet(context.sector, context.subindustry);

  const synonyms = resolved ? [...resolved.signals.round2Synonyms] : [];
  // Las señales de la ronda 1 que no dieron elegibles siguen valiendo como
  // ancla del sector; los sinónimos van DELANTE para que, con el tope de
  // valores, la consulta 2 sea genuinamente distinta y no la 1 recortada.
  const keywordTags = dedupeTrimmed([...synonyms, ...round1.queryParameters.keywordTags]);

  const locations = dedupeTrimmed([
    ...(context.targetLocations ?? []),
    context.country,
  ]);

  const contradictory = resolved ? [...resolved.signals.contradictory] : [];
  const locallyExcludedTerms = dedupeTrimmed([
    ...contradictory,
    ...(feedback.falsePositiveTerms ?? []),
  ]);

  const label = context.subindustry?.trim() || context.sector?.trim() || 'sin sector';
  const countryLabel = context.country?.trim() || context.countryCode?.trim() || 'sin país';

  const adaptationParts: string[] = [];
  if (synonyms.length > 0) adaptationParts.push('sinonimos_controlados');
  if ((context.targetLocations ?? []).length > 0) adaptationParts.push('ciudades_objetivo');
  if (feedback.excludedSeenOrganizationCount > 0) adaptationParts.push('excluye_organizaciones_vistas');
  if (feedback.observedRejectionReasons.length > 0) adaptationParts.push('motivos_de_descarte_ronda_1');
  if ((feedback.falsePositiveTerms ?? []).length > 0) adaptationParts.push('terminos_negativos_de_falsos_positivos');

  // "Difiere" mide el único eje que puede traer resultados nuevos del proveedor:
  // los parámetros enviados. Excluir localmente organizaciones ya vistas no
  // cambia lo que Apollo devuelve y por tanto no justifica una segunda búsqueda.
  const differsFromRound1 =
    keywordTags.join('|') !== round1.queryParameters.keywordTags.join('|') ||
    locations.join('|') !== round1.queryParameters.locations.join('|');

  return {
    roundNumber: 2,
    queryHypothesis:
      `${label} en ${countryLabel} — sinónimos controlados y regiones objetivo, ` +
      'excluyendo señales financieras y organizaciones ya vistas',
    queryParameters: {
      locations,
      keywordTags,
      employeeRanges: round1.queryParameters.employeeRanges,
    },
    locallyExcludedTerms,
    queryAdaptationReason:
      adaptationParts.length > 0 ? adaptationParts.join('+') : 'sin_senales_de_adaptacion',
    requestedResultLimit,
    sectorSignalsMissing: resolved === null,
    differsFromRound1,
  };
}

// ─── Evaluación de contradicción local ────────────────────────────────────────

/**
 * ¿La industria declarada por el proveedor contradice el sector buscado?
 *
 * Compara SÓLO contra la industria declarada, no contra el texto completo del
 * candidato: el nombre o la descripción de un supermercado real pueden mencionar
 * "servicios financieros" (tarjeta propia, crédito de consumo) sin que la
 * empresa sea un banco.
 */
export function isContradictoryIndustry(
  declaredIndustry: string | null | undefined,
  signals: SectorSignalSet,
): { contradictory: boolean; matchedTerm: string | null } {
  if (!declaredIndustry?.trim()) return { contradictory: false, matchedTerm: null };
  const normalized = normalizeKey(declaredIndustry);
  for (const term of signals.contradictory) {
    if (normalized.includes(normalizeKey(term))) {
      return { contradictory: true, matchedTerm: term };
    }
  }
  return { contradictory: false, matchedTerm: null };
}

/** Metadata sanitizada de una hipótesis. Sólo términos de catálogo, sin PII. */
export function toQueryHypothesisMetadata(
  hypothesis: ApolloTwoRoundQueryHypothesis,
): Record<string, unknown> {
  return {
    round_number: hypothesis.roundNumber,
    query_hypothesis: hypothesis.queryHypothesis,
    query_parameters_sanitized: {
      organization_locations: hypothesis.queryParameters.locations,
      q_organization_keyword_tags: hypothesis.queryParameters.keywordTags,
      organization_num_employees_ranges: hypothesis.queryParameters.employeeRanges,
    },
    locally_excluded_terms: hypothesis.locallyExcludedTerms,
    query_adaptation_reason: hypothesis.queryAdaptationReason,
    requested_result_limit: hypothesis.requestedResultLimit,
    sector_signals_missing: hypothesis.sectorSignalsMissing,
  };
}
