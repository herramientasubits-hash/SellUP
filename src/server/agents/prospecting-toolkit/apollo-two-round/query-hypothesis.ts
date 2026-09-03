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
import {
  interleaveApolloSubindustryTerms,
  type ApolloSubindustryTermList,
} from '../apollo-subindustry-query-terms';

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
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 9 — la subindustria que la corrida
   * live `ce957e2f` eligió y que este catálogo no conocía.
   *
   * Sin entrada propia, `resolveSectorSignalSet` caía al conjunto de «Retail y
   * Consumo» y la hipótesis de las dos rondas se redactaba con señales genéricas
   * del sector. Sus términos específicos viven aquí y en el catálogo de búsqueda
   * (`apollo-subindustry-search-mapping`): el de aquí redacta la hipótesis y las
   * exclusiones locales, el de allí gobierna los keywords que viajan.
   */
  'tiendas por departamento, moda y calzado': {
    positive: [
      'department store',
      'tienda por departamento',
      'almacen por departamentos',
      'apparel retail',
      'footwear retail',
      'fashion retail',
      'tienda de ropa',
    ],
    contradictory: UNIVERSAL_CONTRADICTORY_SIGNALS,
    round2Synonyms: [
      'department stores',
      'clothing retail',
      'ropa y calzado',
      'cadena de tiendas de ropa',
      'apparel chain',
      'footwear chain',
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

/**
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 2 — señales de TODAS las
 * subindustrias pedidas, no de la primera.
 *
 * Devuelve una resolución por subindustria (null cuando no está en el catálogo) y
 * el respaldo sectorial por separado. Quien redacta decide cómo repartir; lo que
 * este resolvedor NO hace es elegir una ganadora.
 *
 * El respaldo sectorial se usa como cola, nunca como sustituto: con `[A, B]` donde
 * sólo A está en el catálogo, mandar el conjunto del sector y llamarlo «cobertura
 * de B» es precisamente la omisión silenciosa que el § 7 bloquea.
 */
export function resolveSectorSignalSets(
  sector: string | null | undefined,
  subindustries: readonly string[],
): {
  perSubindustry: {
    subindustry: string;
    resolved: { signals: SectorSignalSet; matchedKey: string } | null;
  }[];
  sectorFallback: { signals: SectorSignalSet; matchedKey: string } | null;
  /** True cuando ninguna subindustria ni el sector están en el catálogo. */
  allSignalsMissing: boolean;
} {
  const perSubindustry = subindustries
    .map((subindustry) => subindustry?.trim())
    .filter((subindustry): subindustry is string => !!subindustry)
    .map((subindustry) => {
      const resolved = resolveSectorSignalSet(null, subindustry);
      return {
        subindustry,
        resolved: resolved ? { signals: resolved.signals, matchedKey: resolved.matchedKey } : null,
      };
    });

  const fromSector = resolveSectorSignalSet(sector, null);
  const sectorFallback = fromSector
    ? { signals: fromSector.signals, matchedKey: fromSector.matchedKey }
    : null;

  return {
    perSubindustry,
    sectorFallback,
    allSignalsMissing:
      sectorFallback === null && perSubindustry.every((entry) => entry.resolved === null),
  };
}

/**
 * § 2 — términos de una fase (positivos o sinónimos de ronda 2) repartidos
 * round-robin entre las subindustrias que los declaran, con el sector como cola.
 */
function buildInterleavedSignalTerms(
  sets: ReturnType<typeof resolveSectorSignalSets>,
  pick: (signals: SectorSignalSet) => readonly string[],
): { terms: string[]; provenanceByTerm: Record<string, string[]> } {
  const lists: ApolloSubindustryTermList[] = sets.perSubindustry
    .filter((entry) => entry.resolved !== null)
    .map((entry, index) => ({
      requestedSubindustry: entry.subindustry,
      requestPosition: index,
      canonicalSubindustry: entry.resolved?.matchedKey ?? null,
      termSource: 'explicit_catalog' as const,
      terms: [...pick(entry.resolved!.signals)],
    }));

  const interleaved = interleaveApolloSubindustryTerms(lists);
  const sectorTail = sets.sectorFallback ? [...pick(sets.sectorFallback.signals)] : [];

  return {
    terms: [...interleaved.terms, ...sectorTail],
    provenanceByTerm: interleaved.provenanceByTerm,
  };
}

// ─── Hipótesis ────────────────────────────────────────────────────────────────

export type ApolloTwoRoundQueryContext = {
  country: string | null;
  countryCode: string | null;
  sector: string | null;
  /**
   * § 1 — TODAS las subindustrias pedidas, en el orden de la solicitud.
   *
   * Antes era `subindustry: string | null`, alimentado por
   * `primarySubindustryForQueryDrafting`. Ese campo era el segundo cuello de
   * botella FIRST-ONLY de la cadena: la hipótesis de las dos rondas se redactaba
   * con las señales de la primera selección y las demás no aparecían ni en los
   * términos ni en las exclusiones locales.
   */
  subindustries: readonly string[];
  /** Ciudades o regiones objetivo, cuando forman parte de la intención. */
  targetLocations?: readonly string[];
  /** Rangos de empleados ya mapeados al vocabulario de Apollo. */
  employeeRanges?: readonly string[];
  /**
   * A1-APOLLO-QUERY-QUALITY-V3-A § 2 — familias semánticas que la macro industria
   * de esta corrida declara, en orden de emisión.
   *
   * Vacío o ausente ⇒ la corrida NO es macro o su macro industria no está
   * migrada, y las dos rondas se redactan exactamente como antes del hito. Este
   * módulo no resuelve el catálogo: recibe las claves ya resueltas, igual que
   * recibe las subindustrias.
   */
  macroQueryFamilies?: readonly string[];
};

/**
 * Parámetros de Apollo que la hipótesis emite. Sólo claves del allowlist del
 * contrato; el resto del body (page, per_page) lo gobierna el presupuesto.
 */
export type ApolloTwoRoundQueryParameters = {
  locations: string[];
  keywordTags: string[];
  employeeRanges: string[];
  /**
   * QUERY-QUALITY-2 § 3 — página que la ronda pide. La ronda 1 siempre es la 1;
   * la ronda 2 puede ser la 2 cuando no hay variante de términos y el proveedor
   * declaró más de una página.
   */
  page: number;
};

/**
 * QUERY-QUALITY-2 § 3 — huella NORMALIZADA de los parámetros que SALEN hacia el
 * proveedor.
 *
 * Es la única medida honesta de "esta ronda es distinta": la corrida QA
 * `edb6f40c` ejecutó dos rondas cuyo `request_fingerprint` de Apollo era
 * byte-idéntico y sólo cambiaba el texto humano de `query_hypothesis`. Ese texto
 * no viaja al proveedor y no puede traer un solo resultado nuevo.
 *
 * Normaliza igual que el contrato: minúsculas, sin acentos, arrays ordenados.
 * Incluye la página, porque la página SÍ cambia lo que Apollo devuelve.
 */
export function buildApolloRoundProviderFingerprint(
  parameters: ApolloTwoRoundQueryParameters,
): string {
  const normalizeList = (values: readonly string[]): string =>
    [...values].map(normalizeKey).filter((value) => value !== '').sort().join(',');

  return [
    `organization_locations=${normalizeList(parameters.locations)}`,
    `organization_num_employees_ranges=${normalizeList(parameters.employeeRanges)}`,
    `page=${parameters.page}`,
    `q_organization_keyword_tags=${normalizeList(parameters.keywordTags)}`,
  ].join('|');
}

/**
 * SCALE-SECOND-ROUND-FIX-1B § 1 — términos EFECTIVOS que las dos rondas comparten.
 *
 * Existe porque «las huellas efectivas difieren» resultó ser una prueba demasiado
 * débil. En la corrida live `eae6d47f` (2026-08-05T17:59Z) la ronda 2 salió con
 * `[supermercado, hipermercado, grocery, grocery chain, grocery retail]` frente a
 * `[supermercado, hipermercado, grocery, grocery store, food retail]` de la ronda 1:
 * huellas distintas, tres de cinco términos compartidos y, con `page=1` y
 * `per_page=5`, las MISMAS cinco empresas de vuelta —cinco créditos por cero
 * organizaciones nuevas—. Un solo término compartido basta para que la ventana de
 * la página 1 se solape, así que la comparación es de intersección, no de igualdad.
 *
 * Normaliza igual que el resto del módulo (minúsculas, sin acentos) y devuelve los
 * términos tal como los envió la ronda 2, sin repetirlos.
 */
export function findSharedEffectiveKeywords(
  round1EffectiveKeywords: readonly string[],
  round2EffectiveKeywords: readonly string[],
): string[] {
  const round1 = new Set(
    round1EffectiveKeywords.map(normalizeKey).filter((value) => value !== ''),
  );
  const shared: string[] = [];
  const alreadyShared = new Set<string>();
  for (const keyword of round2EffectiveKeywords) {
    const normalized = normalizeKey(keyword);
    if (normalized === '' || !round1.has(normalized) || alreadyShared.has(normalized)) continue;
    alreadyShared.add(normalized);
    shared.push(keyword);
  }
  return shared;
}

/** QUERY-QUALITY-2 § 3 — de dónde salió la variante de la ronda 2. */
export type ApolloRound2VariantStrategy =
  /** Conjunto alternativo de términos específicos del catálogo. */
  | 'alternative_specific_terms'
  /** Hipótesis regional o lingüística alternativa válida. */
  | 'alternative_region_hypothesis'
  /** Página 2 de la misma búsqueda, con `total_pages >= 2` declarado. */
  | 'same_query_next_page'
  /** No existe variante real: la ronda no debe ejecutarse. */
  | 'no_real_variant';

export type ApolloTwoRoundQueryHypothesis = {
  roundNumber: number;
  /** Descripción legible de la hipótesis. Va a metadata, no a Apollo. */
  queryHypothesis: string;
  /** Parámetros sanitizados que sí viajan al proveedor. */
  queryParameters: ApolloTwoRoundQueryParameters;
  /** § 3 — huella normalizada de lo que SALE. Es lo que decide si difiere. */
  providerRequestFingerprint: string;
  /** Términos aplicados localmente porque Apollo no admite exclusiones. */
  locallyExcludedTerms: string[];
  /** Por qué la hipótesis de la ronda 2 difiere de la de la ronda 1. */
  queryAdaptationReason: string | null;
  requestedResultLimit: number;
  /** True cuando ni las subindustrias ni el sector tenían señales en el catálogo. */
  sectorSignalsMissing: boolean;
  /**
   * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — qué subindustrias pedidas
   * aportaron cada término de la hipótesis. Vacío cuando sólo habló el sector.
   */
  subindustryTermProvenance: Record<string, string[]>;
  /**
   * V3-A § 2 — familia semántica que esta ronda pide emitir. `null` cuando la
   * macro industria no declara familias (o la corrida no es macro).
   *
   * Viaja hasta `WebSearchInput.macroQueryVariantKey`, y es lo que hace que dos
   * rondas de la misma macro industria tengan planes de búsqueda distintos.
   */
  macroQueryVariantKey: string | null;
  /** V3-A § 5 — familias disponibles, para que la observabilidad distinga casos. */
  macroQueryFamiliesAvailable: string[];
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

/** Etiqueta legible de las subindustrias pedidas. Sólo para el texto humano. */
function contextLabel(context: ApolloTwoRoundQueryContext): string {
  const subindustries = context.subindustries
    .map((subindustry) => subindustry?.trim())
    .filter((subindustry): subindustry is string => !!subindustry);
  if (subindustries.length > 0) return subindustries.join(' | ');
  return context.sector?.trim() || 'sin sector';
}

/** Términos contradictorios de TODAS las subindustrias pedidas, más el sector. */
function collectContradictoryTerms(
  sets: ReturnType<typeof resolveSectorSignalSets>,
): string[] {
  const terms: string[] = [];
  for (const entry of sets.perSubindustry) {
    if (entry.resolved) terms.push(...entry.resolved.signals.contradictory);
  }
  if (sets.sectorFallback) terms.push(...sets.sectorFallback.signals.contradictory);
  return terms;
}

/**
 * V3-A § 2 — claves de familia declaradas, saneadas y sin repetir.
 *
 * El saneamiento importa: una lista con huecos o duplicados haría que la ronda 2
 * eligiera «la segunda» y acabara emitiendo la misma que la ronda 1 — una segunda
 * búsqueda pagada por el mismo plan, que es justo lo que este hito elimina.
 */
function macroQueryFamilyKeys(context: ApolloTwoRoundQueryContext): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of context.macroQueryFamilies ?? []) {
    const trimmed = key?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }
  return keys;
}

/**
 * Ronda 1 — la hipótesis MÁS específica disponible.
 *
 * Prefiere las señales de las subindustrias sobre las del sector: buscar
 * "Supermercados e Hipermercados" con las señales amplias de "Retail y Consumo"
 * es exactamente la imprecisión que este hito corrige.
 *
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 3 — con varias subindustrias pedidas,
 * la ronda 1 lleva una señal de CADA una por delante del respaldo sectorial. No se
 * sacrifica la segunda, la tercera, la cuarta ni la quinta por ser posteriores.
 */
export function buildRound1Hypothesis(
  context: ApolloTwoRoundQueryContext,
  requestedResultLimit: number,
): ApolloTwoRoundQueryHypothesis {
  const sets = resolveSectorSignalSets(context.sector, context.subindustries);
  const positive = buildInterleavedSignalTerms(sets, (signals) => signals.positive);

  const label = contextLabel(context);
  const countryLabel = context.country?.trim() || context.countryCode?.trim() || 'sin país';

  // V3-A § 2 — la ronda 1 emite SIEMPRE la primera familia. Es la única que lleva
  // términos amplios, así que es la que conserva el comportamiento calibrado.
  const families = macroQueryFamilyKeys(context);

  const queryParameters: ApolloTwoRoundQueryParameters = {
    locations: dedupeTrimmed([context.country, ...(context.targetLocations ?? [])]),
    keywordTags: dedupeTrimmed(positive.terms),
    employeeRanges: dedupeTrimmed(context.employeeRanges ?? []),
    page: 1,
  };

  return {
    roundNumber: 1,
    queryHypothesis: `${label} en ${countryLabel} — señales estrictas de subindustria`,
    queryParameters,
    providerRequestFingerprint: buildApolloRoundProviderFingerprint(queryParameters),
    locallyExcludedTerms: dedupeTrimmed(collectContradictoryTerms(sets)),
    queryAdaptationReason: null,
    requestedResultLimit,
    sectorSignalsMissing: sets.allSignalsMissing,
    subindustryTermProvenance: positive.provenanceByTerm,
    macroQueryVariantKey: families[0] ?? null,
    macroQueryFamiliesAvailable: [...families],
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
  /**
   * QUERY-QUALITY-2 § 3 — `total_pages` que el proveedor declaró en la ronda 1.
   *
   * Es la única condición que autoriza la página 2 como variante: pedir una
   * página que el proveedor no declara es pagar por una respuesta vacía.
   */
  providerTotalPages?: number | null;
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
): ApolloRound2Hypothesis {
  const round1 = buildRound1Hypothesis(context, requestedResultLimit);
  const sets = resolveSectorSignalSets(context.sector, context.subindustries);

  /**
   * V3-A §§ 2 y 4 — la variante de FAMILIA se decide antes que nada.
   *
   * La ronda 2 pide la SIGUIENTE familia declarada. Es una hipótesis
   * genuinamente distinta —otro subconjunto de términos específicos del mismo
   * catálogo—, así que cae en `alternative_specific_terms`, el primer eslabón de
   * la cadena del § 3, y arranca en la página 1.
   *
   * La página 1 no es una preferencia estética: un conjunto de términos distinto
   * produce otro `search_plan_fingerprint`, y un plan nuevo es un universo de
   * paginación INDEPENDIENTE del que la ronda 1 recorrió. Empezar en la 2 saltaría
   * la primera página de un universo que nadie ha comprado todavía.
   */
  const families = macroQueryFamilyKeys(context);
  const round2FamilyKey =
    families.length >= 2 && families[1] !== families[0] ? families[1] : null;
  const familyVariantActive = round2FamilyKey !== null;

  // § 3 — los sinónimos también se reparten round-robin: la variante de la ronda 2
  // conserva la cobertura de la ronda 1 en vez de estrecharse a un solo dominio.
  const synonymTerms = buildInterleavedSignalTerms(sets, (signals) => signals.round2Synonyms);
  const synonyms = synonymTerms.terms;
  // Las señales de la ronda 1 que no dieron elegibles siguen valiendo como
  // ancla del sector; los sinónimos van DELANTE para que, con el tope de
  // valores, la consulta 2 sea genuinamente distinta y no la 1 recortada.
  //
  // 🔴 V3-A § 4 — salvo cuando la ronda 2 cambia de familia. Ahí las anclas de la
  // ronda 1 NO se heredan, y no por elegancia: estas etiquetas viajan como
  // criterio adicional hasta `effectiveKeywordTags`, y un solo término efectivo
  // compartido activa el suelo de página 2 de SCALE-SECOND-ROUND-FIX-1B. Ese
  // suelo existe para cuando las dos rondas comparten universo; con una familia
  // nueva el universo es otro, y arrastrar el ancla haría que la ronda 2 se
  // saltara la página 1 de un plan que nadie ha comprado.
  //
  // La resta es contra la ronda 1 ya redactada, no contra el catálogo: es la
  // lista concreta que va a salir la que no puede solaparse.
  const round1TagKeys = new Set(
    round1.queryParameters.keywordTags.map(normalizeKey).filter((value) => value !== ''),
  );
  const keywordTags = familyVariantActive
    ? dedupeTrimmed(synonyms).filter((term) => !round1TagKeys.has(normalizeKey(term)))
    : dedupeTrimmed([...synonyms, ...round1.queryParameters.keywordTags]);

  const locations = dedupeTrimmed([
    ...(context.targetLocations ?? []),
    context.country,
  ]);

  const locallyExcludedTerms = dedupeTrimmed([
    ...collectContradictoryTerms(sets),
    ...(feedback.falsePositiveTerms ?? []),
  ]);

  const label = contextLabel(context);
  const countryLabel = context.country?.trim() || context.countryCode?.trim() || 'sin país';

  const adaptationParts: string[] = [];
  if (synonyms.length > 0) adaptationParts.push('sinonimos_controlados');
  if ((context.targetLocations ?? []).length > 0) adaptationParts.push('ciudades_objetivo');
  if (feedback.excludedSeenOrganizationCount > 0) adaptationParts.push('excluye_organizaciones_vistas');
  if (feedback.observedRejectionReasons.length > 0) adaptationParts.push('motivos_de_descarte_ronda_1');
  if ((feedback.falsePositiveTerms ?? []).length > 0) adaptationParts.push('terminos_negativos_de_falsos_positivos');

  // ── § 3: elección de variante, en orden de preferencia ──────────────────────
  //
  //   1. conjunto alternativo de términos específicos;
  //   2. hipótesis regional o lingüística alternativa válida;
  //   3. página 2 de la misma búsqueda cuando el proveedor declara total_pages≥2;
  //   4. sin variante real ⇒ la ronda se omite.
  //
  // El criterio NO es el texto humano de `query_hypothesis`: es la huella
  // normalizada de lo que sale hacia Apollo. Dos rondas con el mismo body son la
  // misma búsqueda cobrada dos veces, por muy distinta que suene su descripción.
  const termsChanged =
    keywordTags.map(normalizeKey).join('|') !==
    round1.queryParameters.keywordTags.map(normalizeKey).join('|');
  const locationsChanged =
    locations.map(normalizeKey).join('|') !==
    round1.queryParameters.locations.map(normalizeKey).join('|');

  const totalPages =
    typeof feedback.providerTotalPages === 'number' &&
    Number.isFinite(feedback.providerTotalPages)
      ? feedback.providerTotalPages
      : null;
  const nextPageAvailable = totalPages !== null && totalPages >= 2;

  let variantStrategy: ApolloRound2VariantStrategy;
  let queryParameters: ApolloTwoRoundQueryParameters;

  if (familyVariantActive) {
    // V3-A § 4 — la familia manda, y manda ANTES que la cadena existente.
    //
    // Sin esta rama, una macro industria cuyo sector SÍ tiene señales en
    // `SECTOR_SIGNAL_CATALOG` podía caer en `same_query_next_page` y pedir la
    // página 2: `withRequestedPage` no sabe que el plan cambió, y el `max()` del
    // orquestador tomaría el 2 de la hipótesis por encima del 1 del cursor del
    // plan nuevo. La corrección es declarar la variante correcta aquí, no tocar
    // ninguna de las dos piezas de aguas abajo.
    variantStrategy = 'alternative_specific_terms';
    queryParameters = {
      locations,
      keywordTags,
      employeeRanges: round1.queryParameters.employeeRanges,
      page: 1,
    };
    adaptationParts.push('familia_semantica_alternativa');
  } else if (termsChanged) {
    variantStrategy = 'alternative_specific_terms';
    queryParameters = {
      locations,
      keywordTags,
      employeeRanges: round1.queryParameters.employeeRanges,
      page: 1,
    };
  } else if (locationsChanged) {
    variantStrategy = 'alternative_region_hypothesis';
    queryParameters = {
      locations,
      keywordTags,
      employeeRanges: round1.queryParameters.employeeRanges,
      page: 1,
    };
  } else if (nextPageAvailable) {
    // Sin variante de términos ni de región, la única forma de traer algo nuevo
    // es otra página. Repetir la página 1 con el mismo filtro está prohibido.
    variantStrategy = 'same_query_next_page';
    queryParameters = {
      locations: round1.queryParameters.locations,
      keywordTags: round1.queryParameters.keywordTags,
      employeeRanges: round1.queryParameters.employeeRanges,
      page: 2,
    };
    adaptationParts.push('pagina_2_de_la_misma_busqueda');
  } else {
    variantStrategy = 'no_real_variant';
    queryParameters = {
      locations,
      keywordTags,
      employeeRanges: round1.queryParameters.employeeRanges,
      page: 1,
    };
  }

  const providerRequestFingerprint = buildApolloRoundProviderFingerprint(queryParameters);
  const differsFromRound1 =
    providerRequestFingerprint !== round1.providerRequestFingerprint;

  return {
    roundNumber: 2,
    queryHypothesis:
      familyVariantActive
        ? `${label} en ${countryLabel} — familia semántica «${round2FamilyKey}», ` +
          'excluyendo señales financieras y organizaciones ya vistas'
        : variantStrategy === 'same_query_next_page'
          ? `${label} en ${countryLabel} — misma búsqueda, página 2, ` +
            'excluyendo señales financieras y organizaciones ya vistas'
          : `${label} en ${countryLabel} — sinónimos controlados y regiones objetivo, ` +
            'excluyendo señales financieras y organizaciones ya vistas',
    queryParameters,
    providerRequestFingerprint,
    locallyExcludedTerms,
    queryAdaptationReason:
      adaptationParts.length > 0 ? adaptationParts.join('+') : 'sin_senales_de_adaptacion',
    requestedResultLimit,
    sectorSignalsMissing: sets.allSignalsMissing,
    // § 3 — la procedencia de la ronda 2 une los sinónimos repartidos con las
    // anclas heredadas de la ronda 1: las dos rondas declaran a quién representan.
    subindustryTermProvenance: {
      ...round1.subindustryTermProvenance,
      ...synonymTerms.provenanceByTerm,
    },
    // V3-A § 2 — sin familia siguiente, la ronda 2 emite la MISMA que la ronda 1
    // y todo se comporta como antes del hito.
    macroQueryVariantKey: round2FamilyKey ?? round1.macroQueryVariantKey,
    macroQueryFamiliesAvailable: [...families],
    differsFromRound1,
    variantStrategy,
  };
}

/** Hipótesis de la ronda 2, con su veredicto de diferencia y su variante. */
export type ApolloRound2Hypothesis = ApolloTwoRoundQueryHypothesis & {
  differsFromRound1: boolean;
  variantStrategy: ApolloRound2VariantStrategy;
};

/**
 * QUERY-QUALITY-2-FIX § 4 — la MISMA hipótesis pidiendo otra página.
 *
 * Existe porque la variante «página 2» sólo puede decidirse DESPUÉS de comprobar
 * que el request efectivo de la ronda 2 colapsó al de la ronda 1: la hipótesis, por
 * sí sola, no sabe qué términos sobrevivirán a la prioridad y al truncamiento. El
 * orquestador construye la ronda 2, compara el body efectivo y, sólo si resultó
 * idéntico y el proveedor declaró `total_pages >= 2`, vuelve a pedirla con esta
 * función.
 *
 * Inmutable: devuelve una hipótesis nueva y recalcula la huella. `differsFromRound1`
 * se recalcula contra la huella de hipótesis de la ronda 1 que el llamador aporta —
 * la decisión económica final la toma el orquestador con la huella EFECTIVA, no con
 * este campo.
 */
export function withRequestedPage(
  hypothesis: ApolloRound2Hypothesis,
  page: number,
  round1Fingerprint: string | null,
): ApolloRound2Hypothesis {
  const requestedPage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  if (requestedPage === hypothesis.queryParameters.page) return hypothesis;

  const queryParameters: ApolloTwoRoundQueryParameters = {
    ...hypothesis.queryParameters,
    locations: [...hypothesis.queryParameters.locations],
    keywordTags: [...hypothesis.queryParameters.keywordTags],
    employeeRanges: [...hypothesis.queryParameters.employeeRanges],
    page: requestedPage,
  };
  const providerRequestFingerprint = buildApolloRoundProviderFingerprint(queryParameters);
  const adaptationParts = (hypothesis.queryAdaptationReason ?? '')
    .split('+')
    .filter((part) => part !== '' && part !== 'sin_senales_de_adaptacion');
  if (!adaptationParts.includes('pagina_2_de_la_misma_busqueda')) {
    adaptationParts.push('pagina_2_de_la_misma_busqueda');
  }

  return {
    ...hypothesis,
    queryParameters,
    providerRequestFingerprint,
    variantStrategy: 'same_query_next_page',
    queryAdaptationReason: adaptationParts.join('+'),
    queryHypothesis: `${hypothesis.queryHypothesis} — página ${requestedPage}`,
    differsFromRound1:
      round1Fingerprint === null || providerRequestFingerprint !== round1Fingerprint,
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
      page: hypothesis.queryParameters.page,
    },
    // § 12 — la observabilidad del próximo QA no puede depender del texto humano.
    provider_request_fingerprint: hypothesis.providerRequestFingerprint,
    page: hypothesis.queryParameters.page,
    specific_terms_sent: hypothesis.queryParameters.keywordTags,
    locally_excluded_terms: hypothesis.locallyExcludedTerms,
    query_adaptation_reason: hypothesis.queryAdaptationReason,
    requested_result_limit: hypothesis.requestedResultLimit,
    sector_signals_missing: hypothesis.sectorSignalsMissing,
    // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — a quién representa cada término.
    subindustry_term_provenance: hypothesis.subindustryTermProvenance,
    // V3-A § 5 — qué familia emitió esta ronda y cuáles había para elegir.
    macro_query_variant_key: hypothesis.macroQueryVariantKey,
    macro_query_families_available: hypothesis.macroQueryFamiliesAvailable,
  };
}
