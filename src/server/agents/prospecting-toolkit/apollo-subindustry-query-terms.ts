/**
 * apollo-subindustry-query-terms.ts — términos de consulta POR subindustria y
 * cobertura ANY-OF de la consulta efectiva.
 *
 * AGENT1-MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 · §§ 1, 2, 5, 6 y 7.
 *
 * El defecto que cierra: la corrida live `ce957e2f` pidió DOS subindustrias
 * —«Tiendas por Departamento, Moda y Calzado» y «Supermercados e
 * Hipermercados»— y las dos llegaron intactas al runner (PR #245 lo dejó
 * demostrado). Pero los términos que salieron hacia Apollo fueron
 *
 *   ronda 1: supermercado · hipermercado · grocery · retailer · retail chain
 *   ronda 2: supermercado · hipermercado · grocery · cadena de tiendas · grocery retail
 *
 * Las tres primeras posiciones son el catálogo de «Supermercados e
 * Hipermercados»; las dos últimas son el respaldo GENÉRICO del sector «Retail y
 * Consumo». Ni una sola posición vino de «Tiendas por Departamento, Moda y
 * Calzado». La selección del usuario que no tenía entrada de catálogo no
 * participó en ninguna consulta pagada, y nada en la metadata lo decía: 21
 * créditos, 20 organizaciones, 0 candidatos.
 *
 * La causa era estructural, no de datos: `resolveFirstApolloSubindustrySearchMapping`
 * devolvía la PRIMERA subindustria con mapping y descartaba el resto, así que el
 * número de subindustrias que podían gobernar la consulta era uno, cualesquiera
 * fuesen las que el usuario eligiera.
 *
 * Este módulo es la pieza que faltaba, y es DELIBERADAMENTE pura:
 *
 *   1. una lista de términos POR subindustria pedida, con su procedencia;
 *   2. una intercalación round-robin que reparte las posiciones escasas entre
 *      todas ellas en vez de dárselas todas a la primera;
 *   3. una medida de COBERTURA que se calcula sobre los términos que de verdad
 *      viajaron, no sobre la intención;
 *   4. un gate FAIL-CLOSED: una consulta que no cubre todo lo seleccionado no se
 *      paga.
 *
 * Semántica: ANY-OF. `q_organization_keyword_tags` es un único array y Apollo
 * devuelve organizaciones que casan con los términos del array — es la semántica
 * que la ruta ya usaba al mezclar términos de subindustria, de intención y de
 * sector en la misma lista. Aquí NO se inventa ningún parámetro nuevo, ni se
 * concatenan las subindustrias en una frase que el proveedor leería como AND, ni
 * se emite una llamada por subindustria: se reparte el MISMO array entre todas.
 *
 * Puro: sin env, sin I/O, sin reloj, sin dependencias del proveedor.
 */

// ─── Normalización y clave de deduplicación ───────────────────────────────────

/**
 * Normaliza un término de consulta: minúsculas, sin acentos, espacios colapsados.
 *
 * Vive aquí y no en el mapper porque la cobertura y el mapper tienen que medir
 * con la MISMA regla: dos normalizaciones distintas producirían un término
 * "cubierto" para una y no para la otra.
 */
export function normalizeApolloTermKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clave de deduplicación de un keyword.
 *
 * Singular y plural de UN token colapsan (`supermercados` → `supermercado`), pero
 * una frase nunca colapsa contra uno de sus tokens: `cadena de supermercados` y
 * `supermercado` son dos señales distintas para Apollo y fusionarlas perdería
 * justamente la más específica.
 *
 * Se movió desde `apollo-organizations-query-mapping` sin cambiar una letra de su
 * comportamiento; ese módulo la reexporta para sus consumidores.
 */
export function apolloKeywordDedupeKey(term: string): string {
  return normalizeApolloTermKey(term)
    .split(' ')
    .map((token) => {
      if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
      if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
      return token;
    })
    .join(' ');
}

// ─── Términos por subindustria ────────────────────────────────────────────────

/**
 * De dónde salieron los términos de una subindustria.
 *
 * `none` es un estado de primera clase, no un array vacío disfrazado: es
 * exactamente lo que le pasaba a «Tiendas por Departamento, Moda y Calzado», y
 * distinguirlo es lo que permite bloquear antes de gastar en vez de omitirlo en
 * silencio (§ 7).
 */
export type ApolloSubindustryTermSource =
  /** Catálogo explícito de subindustrias (`apollo-subindustry-search-mapping`). */
  | 'explicit_catalog'
  /**
   * `subindustry_search_terms` (`apollo-subindustry-catalog-search-terms`) —
   * CATALOG SEARCH TERMS COVERAGE ADDENDUM. Cubre las 73 subindustrias del
   * catálogo activo; NO implica mapping de precisión (sigue en 2/73).
   */
  | 'catalog_search_terms'
  /** Mapa histórico de keywords del query mapper. */
  | 'legacy_keyword_map'
  /** Search pack curado que gobernó la consulta de esta subindustria. */
  | 'search_pack'
  /** Ninguna fuente declara términos para esta subindustria. */
  | 'none';

/** Términos atribuibles a UNA subindustria pedida, en orden de prioridad. */
export type ApolloSubindustryTermList = {
  /**
   * Etiqueta EXACTA que trajo la solicitud. La procedencia se conserva por
   * SELECCIÓN y no por canónica: dos etiquetas distintas que resuelven a la misma
   * entrada de catálogo siguen siendo dos selecciones del usuario, y colapsarlas
   * borraría cuál de las dos quedó cubierta (§ 10 H).
   */
  requestedSubindustry: string;
  /** Posición en la solicitud. Trazabilidad; NUNCA decide cobertura (§ 5). */
  requestPosition: number;
  /** Nombre canónico del catálogo explícito. Null en las demás fuentes. */
  canonicalSubindustry: string | null;
  termSource: ApolloSubindustryTermSource;
  /** Orden = prioridad. El primero es el que la intercalación reparte primero. */
  terms: string[];
};

/** Resolución de términos de UNA subindustria. La inyecta el mapper. */
export type ApolloSubindustryTermResolution = {
  canonicalSubindustry: string | null;
  termSource: ApolloSubindustryTermSource;
  terms: readonly string[];
};

export type ApolloSubindustryTermResolver = (
  subindustry: string,
) => ApolloSubindustryTermResolution;

/**
 * Una lista de términos por subindustria PEDIDA, en el orden de la solicitud.
 *
 * Etiquetas vacías se descartan (no son una selección) y las repetidas colapsan
 * en la primera aparición: la misma selección dos veces no es dos selecciones, y
 * mantener dos entradas con la misma clave rompería el mapa de procedencia.
 */
export function resolveApolloSubindustryTermLists(
  subindustries: readonly (string | null | undefined)[] | null | undefined,
  resolve: ApolloSubindustryTermResolver,
): ApolloSubindustryTermList[] {
  const seen = new Set<string>();
  const lists: ApolloSubindustryTermList[] = [];

  for (const raw of subindustries ?? []) {
    const label = raw?.trim();
    if (!label) continue;
    const key = normalizeApolloTermKey(label);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);

    const resolution = resolve(label);
    lists.push({
      requestedSubindustry: label,
      requestPosition: lists.length,
      canonicalSubindustry: resolution.canonicalSubindustry,
      termSource: resolution.terms.length > 0 ? resolution.termSource : 'none',
      terms: [...resolution.terms],
    });
  }

  return lists;
}

/** Reemplaza los términos de las subindustrias indicadas. Inmutable. */
export function withApolloSubindustryTerms(
  lists: readonly ApolloSubindustryTermList[],
  matches: (list: ApolloSubindustryTermList) => boolean,
  terms: readonly string[],
  termSource: ApolloSubindustryTermSource,
): ApolloSubindustryTermList[] {
  return lists.map((list) =>
    matches(list)
      ? { ...list, terms: [...terms], termSource: terms.length > 0 ? termSource : 'none' }
      : { ...list, terms: [...list.terms] },
  );
}

// ─── Intercalación round-robin ────────────────────────────────────────────────

/** Resultado de intercalar los términos de varias subindustrias. */
export type ApolloInterleavedSubindustryTerms = {
  /** Términos deduplicados, en orden de reparto. */
  terms: string[];
  /**
   * Subindustrias pedidas que aportaron cada término superviviente.
   *
   * § 10 G — cuando dos subindustrias declaran el mismo término, el término viaja
   * UNA vez y las dos figuran como procedencia. Deduplicar sin esto convertiría
   * una señal compartida en una señal de la primera.
   */
  provenanceByTerm: Record<string, string[]>;
};

/**
 * Reparte las posiciones escasas de la consulta entre TODAS las subindustrias.
 *
 * Round-robin por profundidad: el primer término de cada subindustria, luego el
 * segundo de cada una, y así. Con `N` subindustrias que declaran términos, las
 * primeras `N` posiciones llevan una señal de cada una — que es exactamente lo
 * que hace falta para que el truncamiento a cinco no expulse a la última
 * selección del usuario.
 *
 * § 5 — permutar la solicitud permuta el orden del array pero NO cambia el
 * conjunto de subindustrias representadas: `[A, B]` produce `a1, b1, a2, …` y
 * `[B, A]` produce `b1, a1, b2, …`, y las dos cubren `{A, B}`.
 */
export function interleaveApolloSubindustryTerms(
  lists: readonly ApolloSubindustryTermList[],
  dedupeKey: (term: string) => string = apolloKeywordDedupeKey,
): ApolloInterleavedSubindustryTerms {
  const maxDepth = lists.reduce((max, list) => Math.max(max, list.terms.length), 0);
  const terms: string[] = [];
  const provenanceByTerm: Record<string, string[]> = {};
  const keyToTerm = new Map<string, string>();

  for (let depth = 0; depth < maxDepth; depth++) {
    for (const list of lists) {
      const term = list.terms[depth];
      if (term === undefined) continue;
      const trimmed = term.trim();
      if (trimmed === '') continue;
      const key = dedupeKey(trimmed);
      if (key === '') continue;

      const existing = keyToTerm.get(key);
      if (existing === undefined) {
        keyToTerm.set(key, trimmed);
        terms.push(trimmed);
        provenanceByTerm[trimmed] = [list.requestedSubindustry];
        continue;
      }
      const provenance = provenanceByTerm[existing];
      if (provenance && !provenance.includes(list.requestedSubindustry)) {
        provenance.push(list.requestedSubindustry);
      }
    }
  }

  return { terms, provenanceByTerm };
}

/**
 * Posiciones que la consulta debe reservar para señales de subindustria.
 *
 * Es el SUELO de cobertura: una posición por cada subindustria pedida que declara
 * términos, hasta el tope de posiciones disponibles. Sin él, la reserva de dos
 * posiciones para la intención escrita por el usuario podía dejar fuera a la
 * cuarta y la quinta selección; con él, cinco subindustrias caben en cinco
 * posiciones y la intención cede — que es la única resolución posible sin subir
 * el número de llamadas pagadas (§ 4).
 */
export function apolloSubindustryCoverageFloor(
  lists: readonly ApolloSubindustryTermList[],
  maxKeywords: number,
): number {
  const withTerms = lists.filter((list) => list.terms.length > 0).length;
  return Math.min(withTerms, Math.max(0, maxKeywords));
}

// ─── Cobertura ────────────────────────────────────────────────────────────────

/** § 6 — cobertura de la consulta EFECTIVA sobre las subindustrias pedidas. */
export type ApolloSubindustryQueryCoverage = {
  /** Subindustrias pedidas, deduplicadas, en el orden de la solicitud. */
  requestedSubindustries: string[];
  /** Las que tienen al menos un término en la consulta efectiva. */
  coveredSubindustries: string[];
  /** Las que no tienen ninguno. Vacío en una consulta correcta. */
  uncoveredSubindustries: string[];
  coverageCount: number;
  /** `covered / requested`. 1 cuando la solicitud no trajo subindustrias. */
  coverageRatio: number;
  /** Qué términos efectivos representan a cada subindustria pedida. */
  effectiveKeywordsBySubindustry: Record<string, string[]>;
  /** Términos efectivos sin subindustria atribuible (sector, intención libre). */
  unattributedEffectiveKeywords: string[];
  /** True cuando toda subindustria pedida está representada. */
  complete: boolean;
};

/**
 * Calcula la cobertura contra los términos que EFECTIVAMENTE viajaron.
 *
 * Se mide sobre `effectiveKeywords` —el array ya priorizado, deduplicado y
 * truncado— y no sobre la hipótesis: la hipótesis describe la intención, y la
 * corrida `ce957e2f` demuestra que una intención que menciona dos subindustrias
 * puede colapsar en un body que sólo representa a una.
 *
 * La atribución es por clave de deduplicación, así que `supermercados` en la
 * consulta cubre `supermercado` del catálogo y no hace falta que coincidan letra
 * por letra.
 */
export function computeApolloSubindustryQueryCoverage(input: {
  lists: readonly ApolloSubindustryTermList[];
  effectiveKeywords: readonly string[];
  dedupeKey?: (term: string) => string;
}): ApolloSubindustryQueryCoverage {
  const dedupeKey = input.dedupeKey ?? apolloKeywordDedupeKey;
  const requestedSubindustries = input.lists.map((list) => list.requestedSubindustry);

  const keysByList = input.lists.map(
    (list) => new Set(list.terms.map((term) => dedupeKey(term)).filter((key) => key !== '')),
  );

  const effectiveKeywordsBySubindustry: Record<string, string[]> = {};
  for (const subindustry of requestedSubindustries) {
    effectiveKeywordsBySubindustry[subindustry] = [];
  }
  const unattributedEffectiveKeywords: string[] = [];

  for (const keyword of input.effectiveKeywords) {
    const trimmed = keyword?.trim();
    if (!trimmed) continue;
    const key = dedupeKey(trimmed);
    if (key === '') continue;

    let attributed = false;
    input.lists.forEach((list, index) => {
      if (!keysByList[index].has(key)) return;
      attributed = true;
      const bucket = effectiveKeywordsBySubindustry[list.requestedSubindustry];
      if (bucket && !bucket.includes(trimmed)) bucket.push(trimmed);
    });
    if (!attributed && !unattributedEffectiveKeywords.includes(trimmed)) {
      unattributedEffectiveKeywords.push(trimmed);
    }
  }

  const coveredSubindustries = requestedSubindustries.filter(
    (subindustry) => (effectiveKeywordsBySubindustry[subindustry] ?? []).length > 0,
  );
  const uncoveredSubindustries = requestedSubindustries.filter(
    (subindustry) => (effectiveKeywordsBySubindustry[subindustry] ?? []).length === 0,
  );

  return {
    requestedSubindustries,
    coveredSubindustries,
    uncoveredSubindustries,
    coverageCount: coveredSubindustries.length,
    coverageRatio:
      requestedSubindustries.length === 0
        ? 1
        : coveredSubindustries.length / requestedSubindustries.length,
    effectiveKeywordsBySubindustry,
    unattributedEffectiveKeywords,
    complete: uncoveredSubindustries.length === 0,
  };
}

/** Cobertura vacía — la solicitud no trajo subindustrias. */
export function emptyApolloSubindustryQueryCoverage(): ApolloSubindustryQueryCoverage {
  return {
    requestedSubindustries: [],
    coveredSubindustries: [],
    uncoveredSubindustries: [],
    coverageCount: 0,
    coverageRatio: 1,
    effectiveKeywordsBySubindustry: {},
    unattributedEffectiveKeywords: [],
    complete: true,
  };
}

// ─── Gate fail-closed antes del gasto ─────────────────────────────────────────

/** Código estático del bloqueo. Seguro de loggear: no lleva datos de la corrida. */
export const APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON =
  'apollo_subindustry_query_coverage_incomplete' as const;

/** § 7 — copy administrativa exacta del bloqueo. */
export const APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_COPY =
  'No se pudo construir una búsqueda que cubriera todas las subindustrias ' +
  'seleccionadas. No se consumieron créditos.';

export type ApolloSubindustryCoverageSpendVerdict = {
  /** False ⇒ no se emite la búsqueda pagada. */
  allowed: boolean;
  /** Código estático. Null cuando está permitido. */
  blockReason: typeof APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON | null;
  /** Copy administrativa. Null cuando está permitido. */
  adminCopy: string | null;
  coverage: ApolloSubindustryQueryCoverage;
};

/**
 * § 7 — ¿se puede pagar esta búsqueda?
 *
 * Regla, sin excepciones: si la solicitud trajo subindustrias y la consulta
 * efectiva no representa a todas, NO se ejecuta Apollo y no se consume ningún
 * crédito. Una búsqueda que omite en silencio un criterio que el usuario eligió
 * gasta su presupuesto en una pregunta que él no hizo — es lo que pasó en
 * `ce957e2f` con 21 créditos.
 *
 * Sin subindustrias pedidas el gate no aplica: una búsqueda sectorial no omite
 * nada. Fail-closed sobre lo pedido, no sobre lo no pedido.
 */
export function evaluateApolloSubindustryCoverageSpendGate(
  coverage: ApolloSubindustryQueryCoverage,
): ApolloSubindustryCoverageSpendVerdict {
  if (coverage.requestedSubindustries.length === 0 || coverage.complete) {
    return { allowed: true, blockReason: null, adminCopy: null, coverage };
  }
  return {
    allowed: false,
    blockReason: APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_REASON,
    adminCopy: APOLLO_SUBINDUSTRY_COVERAGE_BLOCK_COPY,
    coverage,
  };
}

// ─── Metadata ─────────────────────────────────────────────────────────────────

/** § 6 — metadata de cobertura. Sólo términos de catálogo: sin secretos, sin PII. */
export function toApolloSubindustryQueryCoverageMetadata(
  coverage: ApolloSubindustryQueryCoverage,
): Record<string, unknown> {
  return {
    requested_subindustries: coverage.requestedSubindustries,
    query_covered_subindustries: coverage.coveredSubindustries,
    query_uncovered_subindustries: coverage.uncoveredSubindustries,
    query_coverage_count: coverage.coverageCount,
    query_coverage_ratio: coverage.coverageRatio,
    query_coverage_complete: coverage.complete,
    effective_keywords_by_subindustry: coverage.effectiveKeywordsBySubindustry,
    unattributed_effective_keywords: coverage.unattributedEffectiveKeywords,
  };
}

/** § 6 — procedencia declarada de los términos, por subindustria pedida. */
export function toApolloSubindustryTermProvenanceMetadata(
  lists: readonly ApolloSubindustryTermList[],
): Record<string, unknown>[] {
  return lists.map((list) => ({
    requested_subindustry: list.requestedSubindustry,
    request_position: list.requestPosition,
    canonical_subindustry: list.canonicalSubindustry,
    term_source: list.termSource,
    term_count: list.terms.length,
    terms: list.terms,
  }));
}
