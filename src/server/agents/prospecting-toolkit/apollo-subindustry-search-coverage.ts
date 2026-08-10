/**
 * apollo-subindustry-search-coverage.ts — contrato canónico de cobertura de
 * búsqueda por subindustria, combinando el catálogo especializado (2/73) y los
 * términos de `subindustry_search_terms` de la versión publicada (73/73 en `1.0.0`).
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · CATALOG SEARCH TERMS COVERAGE
 * ADDENDUM · §§ 2, 3, 4 y 6 · y CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2, que
 * convirtió los términos de catálogo en un input OBLIGATORIO ya resuelto: este módulo
 * ya no conoce ningún snapshot, y por tanto no puede desviarse de la versión publicada.
 *
 * ── Dos contratos independientes, a propósito (§ 4) ────────────────────────────
 *
 * Este módulo resuelve DISCOVERY: ¿existe al menos un término de búsqueda que
 * represente a esta subindustria? No decide PRECISION: ¿un candidato encontrado
 * pertenece de verdad a ella? Esa es la pregunta de
 * `apollo-subindustry-precision.ts` (`assessApolloSubindustryPrecisionForRequest`),
 * que sigue gobernada ÚNICAMENTE por `SUBINDUSTRY_ANCHOR_TERMS` /
 * `SUBINDUSTRY_ANCHOR_FAMILIES` — el mismo catálogo 2/73 de siempre. Este addendum
 * NO toca ese módulo, ni la migración 093
 * (`prospect_candidates_classification_source_check`, que clasifica CÓMO se marcó
 * `record_origin`/`rejection_reason` de una fila, no subindustrias).
 *
 * Que una subindustria tenga términos de catálogo NO la vuelve "confirmed": una
 * subindustria puede ser `covered: true` aquí y seguir sin mapping de precisión, y
 * un candidato que aparezca buscándola sigue sin poder contar hacia el objetivo
 * (`subindustryMapped: false`, `countsTowardTarget: false`) salvo que la precisión
 * la reconozca por separado. Puede persistir como `needs_review` si el resto de
 * gates lo permite (PR #235/#241), nunca como `complete_valid` por esto solo.
 *
 * ── Precedencia y deduplicación (§ 3) ──────────────────────────────────────────
 *
 * Cuando una subindustria tiene AMBAS fuentes, los términos especializados van
 * primero: son el catálogo que además gobierna precisión, así que son la señal más
 * fina que existe. Los términos de catálogo (`subindustry_search_terms`) rellenan
 * detrás, deduplicados por la misma clave singular/plural que usa el resto de la
 * ruta (`apolloKeywordDedupeKey`) para que "supermercado" del catálogo especializado
 * y una futura fila `supermercados` de la tabla no gasten dos posiciones en la
 * misma señal.
 *
 * Puro: sin env, sin I/O, sin reloj. Los resolvers de catálogo son inyectables
 * (`catalogSearchTerms`, `specializedMappings`) para que la suite pueda probar la
 * combinación sin depender de los catálogos reales.
 */

import {
  resolveApolloSubindustrySearchMapping,
  type ApolloSubindustrySearchMapping,
} from './apollo-subindustry-search-mapping';
import {
  createApolloSubindustryCatalogTermsLookup,
  type ApolloSubindustryCatalogTermsLookup,
  type ApolloSubindustryCatalogTermsResolution,
} from './apollo-subindustry-catalog-terms-resolution';
import { normalizeApolloTermKey, apolloKeywordDedupeKey } from './apollo-subindustry-query-terms';

// ─── Resolvers inyectables ────────────────────────────────────────────────────

/**
 * CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 (CASO B) — los términos de catálogo se
 * reciben YA RESUELTOS desde la versión publicada, nunca desde un snapshot estático.
 *
 * Es el mismo tipo que consume la ruta de construcción de la consulta
 * (`ApolloSubindustryCatalogTermsLookup`): una sola forma para una sola fuente. Antes
 * había un tipo local aquí y otro en el mapper, y dos formas para la misma cosa es
 * exactamente cómo se cuela una segunda fuente de verdad.
 */
export type ApolloSubindustryCatalogSearchTermsResolver = ApolloSubindustryCatalogTermsLookup;

export type ApolloSubindustrySpecializedMappingResolver = (
  subindustry: string,
) => ApolloSubindustrySearchMapping | null;

// ─── Contrato de salida ───────────────────────────────────────────────────────

export type ApolloSubindustryTermProvenanceSource = 'specialized_mapping' | 'catalog_search_term';

export type ApolloSubindustryTermProvenanceEntry = {
  term: string;
  normalizedTerm: string;
  source: ApolloSubindustryTermProvenanceSource;
};

export type ApolloSubindustrySearchCoverageReason =
  /** Sólo el catálogo especializado (2/73) aportó términos. */
  | 'specialized_mapping'
  /** Sólo `subindustry_search_terms` aportó términos. */
  | 'catalog_search_terms'
  /** Ambas fuentes aportaron términos. */
  | 'specialized_and_catalog'
  /** Ninguna fuente tiene términos para esta subindustria. */
  | 'uncovered_no_terms_available';

export type ApolloSubindustrySearchCoverageEntry = {
  /** Etiqueta EXACTA de la solicitud. Trazabilidad por selección, no por canónica. */
  requestedSubindustry: string;
  /** Posición en la solicitud, deduplicada. Nunca decide cobertura (§ 9). */
  requestPosition: number;
  /** UUID de `public.subindustries.id`. Null si ninguna fuente reconoce el nombre. */
  canonicalSubindustryId: string | null;
  /** Nombre canónico resuelto por cualquiera de las dos fuentes. Null si ninguna. */
  canonicalLabel: string | null;
  specializedTerms: string[];
  catalogTerms: string[];
  /** Especializados + catálogo, deduplicados, especializados primero. */
  effectiveTerms: string[];
  /** Un elemento por término superviviente en `effectiveTerms`, con su procedencia. */
  termSources: ApolloSubindustryTermProvenanceEntry[];
  covered: boolean;
  coverageReason: ApolloSubindustrySearchCoverageReason;
};

export type ApolloSubindustrySearchCoverageResult = {
  entries: ApolloSubindustrySearchCoverageEntry[];
  requestedCount: number;
  coveredCount: number;
  uncoveredCount: number;
  /** 1 cuando la solicitud no trajo subindustrias. */
  coverageRatio: number;
  coveredSubindustries: string[];
  uncoveredSubindustries: string[];
};

export type ApolloSubindustrySearchCoverageInput = {
  requestedSubindustries: readonly (string | null | undefined)[] | null | undefined;
  /**
   * OBLIGATORIO — términos de la versión publicada, ya resueltos. No tiene default:
   * un default estático es precisamente la segunda fuente de verdad que este addendum
   * elimina. Sin términos de catálogo, pásese `() => null` explícitamente.
   */
  catalogSearchTerms: ApolloSubindustryCatalogSearchTermsResolver;
  /** Default: `resolveApolloSubindustrySearchMapping` (catálogo especializado, 2/73). */
  specializedMappings?: ApolloSubindustrySpecializedMappingResolver;
};

/**
 * § 2 — función canónica de resolución de cobertura de búsqueda.
 *
 * Etiquetas vacías se descartan y las repetidas (por clave normalizada) colapsan en
 * la primera aparición — misma regla que `resolveApolloSubindustryTermLists`.
 */
export function resolveApolloSubindustrySearchCoverage(
  input: ApolloSubindustrySearchCoverageInput,
): ApolloSubindustrySearchCoverageResult {
  const catalogResolve = input.catalogSearchTerms;
  const specializedResolve = input.specializedMappings ?? resolveApolloSubindustrySearchMapping;

  const seen = new Set<string>();
  const entries: ApolloSubindustrySearchCoverageEntry[] = [];

  for (const raw of input.requestedSubindustries ?? []) {
    const label = raw?.trim();
    if (!label) continue;
    const key = normalizeApolloTermKey(label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);

    const specialized = specializedResolve(label);
    const catalog = catalogResolve(label);

    const specializedTerms = specialized ? [...specialized.positiveTerms] : [];
    const catalogTerms = catalog ? [...catalog.terms] : [];

    // Precedencia: especializado primero, catálogo detrás. Dedupe por la MISMA
    // clave singular/plural que usa el reparto round-robin, para que un término
    // compartido entre las dos fuentes no gaste dos posiciones de la consulta.
    const dedupeSeen = new Set<string>();
    const effectiveTerms: string[] = [];
    const termSources: ApolloSubindustryTermProvenanceEntry[] = [];

    for (const term of specializedTerms) {
      const dedupeKey = apolloKeywordDedupeKey(term);
      if (dedupeKey === '' || dedupeSeen.has(dedupeKey)) continue;
      dedupeSeen.add(dedupeKey);
      effectiveTerms.push(term);
      termSources.push({ term, normalizedTerm: dedupeKey, source: 'specialized_mapping' });
    }
    for (const term of catalogTerms) {
      const dedupeKey = apolloKeywordDedupeKey(term);
      if (dedupeKey === '' || dedupeSeen.has(dedupeKey)) continue;
      dedupeSeen.add(dedupeKey);
      effectiveTerms.push(term);
      termSources.push({ term, normalizedTerm: dedupeKey, source: 'catalog_search_term' });
    }

    const canonicalLabel = specialized?.canonicalSubindustry ?? catalog?.canonicalSubindustry ?? null;
    const canonicalSubindustryId = catalog?.canonicalSubindustryId ?? null;
    const covered = effectiveTerms.length > 0;

    let coverageReason: ApolloSubindustrySearchCoverageReason;
    if (!covered) {
      coverageReason = 'uncovered_no_terms_available';
    } else if (specializedTerms.length > 0 && catalogTerms.length > 0) {
      coverageReason = 'specialized_and_catalog';
    } else if (specializedTerms.length > 0) {
      coverageReason = 'specialized_mapping';
    } else {
      coverageReason = 'catalog_search_terms';
    }

    entries.push({
      requestedSubindustry: label,
      requestPosition: entries.length,
      canonicalSubindustryId,
      canonicalLabel,
      specializedTerms,
      catalogTerms,
      effectiveTerms,
      termSources,
      covered,
      coverageReason,
    });
  }

  const coveredSubindustries = entries.filter((entry) => entry.covered).map((entry) => entry.requestedSubindustry);
  const uncoveredSubindustries = entries
    .filter((entry) => !entry.covered)
    .map((entry) => entry.requestedSubindustry);

  return {
    entries,
    requestedCount: entries.length,
    coveredCount: coveredSubindustries.length,
    uncoveredCount: uncoveredSubindustries.length,
    coverageRatio: entries.length === 0 ? 1 : coveredSubindustries.length / entries.length,
    coveredSubindustries,
    uncoveredSubindustries,
  };
}

// ─── Metadata (§ 12) ──────────────────────────────────────────────────────────

/** § 12 — metadata de diagnóstico. Sólo términos de catálogo: sin secretos, sin PII. */
export function toApolloSubindustrySearchCoverageMetadata(
  result: ApolloSubindustrySearchCoverageResult,
): Record<string, unknown> {
  return {
    requested_count: result.requestedCount,
    covered_count: result.coveredCount,
    uncovered_count: result.uncoveredCount,
    coverage_ratio: result.coverageRatio,
    covered_subindustries: result.coveredSubindustries,
    uncovered_subindustries: result.uncoveredSubindustries,
    entries: result.entries.map((entry) => ({
      requested_subindustry: entry.requestedSubindustry,
      request_position: entry.requestPosition,
      canonical_subindustry_id: entry.canonicalSubindustryId,
      canonical_label: entry.canonicalLabel,
      specialized_terms: entry.specializedTerms,
      catalog_terms: entry.catalogTerms,
      effective_terms: entry.effectiveTerms,
      term_sources: entry.termSources,
      covered: entry.covered,
      coverage_reason: entry.coverageReason,
    })),
  };
}

// ─── Auditoría del catálogo completo (§ 6) ────────────────────────────────────

export type ApolloSubindustryCatalogCoverageAudit = {
  subindustriesTotal: number;
  queryCoveredSubindustries: number;
  queryUncoveredSubindustries: number;
  uncoveredLabels: string[];
};

/**
 * § 7 — ¿cuántas subindustrias de UNA resolución concreta pueden construir una
 * búsqueda? Recorre los nombres canónicos uno por uno, sin fallback al sector padre.
 *
 * CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 — audita una RESOLUCIÓN, no un snapshot.
 *
 * Antes esta función tenía defaults: leía los 73 nombres del snapshot estático y sus
 * términos del mismo sitio. Eso la volvía una aserción sobre el repositorio, no sobre
 * el catálogo publicado — y era la última vía por la que el snapshot podía quedarse
 * como fuente de verdad. Ahora la resolución es un parámetro obligatorio: la suite le
 * pasa la lectura congelada de la versión `1.0.0` (73/73), y una auditoría contra otra
 * versión publicada le pasa esa otra.
 */
export function auditApolloSubindustryCatalogSearchCoverage(input: {
  resolution: ApolloSubindustryCatalogTermsResolution;
  specializedMappings?: ApolloSubindustrySpecializedMappingResolver;
}): ApolloSubindustryCatalogCoverageAudit {
  const subindustryNames = input.resolution.entries.map((entry) => entry.canonicalSubindustry);

  const result = resolveApolloSubindustrySearchCoverage({
    requestedSubindustries: subindustryNames,
    catalogSearchTerms: createApolloSubindustryCatalogTermsLookup(input.resolution),
    specializedMappings: input.specializedMappings,
  });

  return {
    subindustriesTotal: subindustryNames.length,
    queryCoveredSubindustries: result.coveredCount,
    queryUncoveredSubindustries: result.uncoveredCount,
    uncoveredLabels: result.uncoveredSubindustries,
  };
}

// ─── Fail-closed pre-spend (§ 5) ──────────────────────────────────────────────

/** Código estático del bloqueo. Seguro de loggear: no lleva datos de la corrida. */
export const APOLLO_SUBINDUSTRY_SEARCH_COVERAGE_BLOCK_REASON =
  'apollo_subindustry_search_coverage_incomplete' as const;

/** § 5 — copy administrativa exacta del bloqueo. */
export const APOLLO_SUBINDUSTRY_SEARCH_COVERAGE_BLOCK_COPY =
  'No se pudo construir una búsqueda para todas las subindustrias seleccionadas. ' +
  'No se consumieron créditos.';

export type ApolloSubindustrySearchCoverageSpendVerdict = {
  allowed: boolean;
  blockReason: typeof APOLLO_SUBINDUSTRY_SEARCH_COVERAGE_BLOCK_REASON | null;
  adminCopy: string | null;
  coverage: ApolloSubindustrySearchCoverageResult;
};

/**
 * § 5 — ¿hay al menos una fuente de términos para CADA subindustria pedida?
 *
 * Este es el gate de DISCOVERY sobre la unión de fuentes (especializada + catálogo),
 * evaluado ANTES de construir la consulta. Es un chequeo previo y más barato que
 * `evaluateApolloSubindustryCoverageSpendGate` (que mide sobre los keywords que
 * DE VERDAD viajaron, después del reparto y el truncamiento): si ni siquiera existe
 * una fuente de términos, no hace falta construir nada para saber que va a bloquear.
 * No sustituye a ese gate — lo antecede.
 */
export function evaluateApolloSubindustrySearchCoverageSpendGate(
  coverage: ApolloSubindustrySearchCoverageResult,
): ApolloSubindustrySearchCoverageSpendVerdict {
  if (coverage.requestedCount === 0 || coverage.uncoveredCount === 0) {
    return { allowed: true, blockReason: null, adminCopy: null, coverage };
  }
  return {
    allowed: false,
    blockReason: APOLLO_SUBINDUSTRY_SEARCH_COVERAGE_BLOCK_REASON,
    adminCopy: APOLLO_SUBINDUSTRY_SEARCH_COVERAGE_BLOCK_COPY,
    coverage,
  };
}
