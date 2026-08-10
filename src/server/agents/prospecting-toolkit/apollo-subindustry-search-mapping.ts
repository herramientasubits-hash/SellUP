/**
 * apollo-subindustry-search-mapping.ts — Catálogo explícito de subindustrias.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 · § 2 y § 7.
 *
 * El defecto que cierra: la corrida QA `edb6f40c` buscó «Supermercados e
 * Hipermercados» en Colombia y Apollo recibió `retail, commerce, ecommerce,
 * retail chain, comercio`. Las cinco posiciones disponibles se llenaron con el
 * catálogo GENÉRICO del sector porque la subindustria no tenía mapping, así que
 * la señal que el usuario eligió nunca viajó.
 *
 * Este módulo es la fuente única de:
 *
 *   1. los términos POSITIVOS de una subindustria — los que sólo aparecen en un
 *      miembro real de ella;
 *   2. los términos CONTRADICTORIOS — los que, en la industria DECLARADA por el
 *      proveedor, prueban que el candidato pertenece a otro negocio.
 *
 * Los contradictorios NUNCA viajan a Apollo: `mixed_companies/search` no admite
 * exclusión de keywords, así que se aplican localmente y siempre antes de
 * cualquier operación pagada.
 *
 * ── FOLLOW-UP registrado (QUERY-QUALITY-2-FIX § 12), NO implementado aquí ──────
 *
 * La base de datos ya tiene `subindustry_search_terms`: 228 términos repartidos
 * sobre las 73 subindustrias del catálogo activo, y hoy SIN ningún consumidor. El
 * seguimiento deberá decidir si sustituye este catálogo TypeScript o si actúa como
 * capa gestionable por encima de él — y, si sustituye, cómo se auditan los términos
 * que gobiernan gasto real.
 *
 * Este PR NO añade consultas de producción, caché ni migraciones para eso: un
 * catálogo que decide qué se le compra a un proveedor no se conecta de paso. Los
 * 73 nombres viven congelados en
 * `__tests__/fixtures/sellup-subindustry-catalog-names.ts` para que la suite pueda
 * comprobar el emparejamiento contra el catálogo real sin tocar la base.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Mapping de UNA subindustria canónica.
 *
 * Forma deliberadamente pequeña y generalizable: añadir una subindustria es
 * añadir una entrada de datos, no escribir lógica.
 */
export type ApolloSubindustrySearchMapping = {
  canonicalSubindustry: string;
  positiveTerms: string[];
  contradictoryTerms: string[];
};

/** Entrada del catálogo: el mapping más las formas con que el wizard la nombra. */
type ApolloSubindustryCatalogEntry = {
  mapping: ApolloSubindustrySearchMapping;
  /** Variantes controladas (ES/EN) con las que la subindustria puede llegar. */
  aliases: string[];
};

// ─── Contradicciones ──────────────────────────────────────────────────────────

/**
 * Señales que contradicen cualquier búsqueda de comercio y consumo.
 *
 * `retail` a secas NO está aquí a propósito: es substring de `retail banking` y
 * de `retail chain`, y usarlo como contradicción descartaría minoristas reales.
 * La contradicción se lee sobre la industria DECLARADA, no sobre la descripción:
 * un supermercado con tarjeta propia menciona servicios financieros sin ser un
 * banco.
 */
export const COMMERCE_CONTRADICTORY_TERMS: readonly string[] = [
  'retail banking',
  'commercial banking',
  'investment banking',
  'banking',
  'bank',
  'financial services',
  'financial service',
  'credit institution',
  'insurance',
  'software',
  'saas',
  'consulting',
  'marketplace',
];

// ─── Catálogo ─────────────────────────────────────────────────────────────────

/**
 * Orden de `positiveTerms` = orden de prioridad al construir la consulta.
 *
 * Los cinco primeros son los que caben bajo `MAX_KEYWORDS`, así que el orden no
 * es estético: decide qué recibe Apollo.
 */
const APOLLO_SUBINDUSTRY_CATALOG: readonly ApolloSubindustryCatalogEntry[] = [
  {
    mapping: {
      canonicalSubindustry: 'Supermercados e Hipermercados',
      positiveTerms: [
        'supermercado',
        'hipermercado',
        'grocery',
        'food retail',
        'cadena de supermercados',
        'grocery store',
        'supermarket',
        'hypermarket',
        'grocery chain',
        'autoservicio',
        'almacen de cadena',
        'retail de alimentos',
        'food retailer',
      ],
      contradictoryTerms: [...COMMERCE_CONTRADICTORY_TERMS],
    },
    aliases: [
      'supermercados e hipermercados',
      'supermercados',
      'hipermercados',
      'supermercado',
      'hipermercado',
      'supermarkets and hypermarkets',
      'supermarkets',
      'hypermarkets',
      'grocery',
      'grocery retail',
      'grocery stores',
      'food retail',
      'retail de alimentos',
      'autoservicios',
    ],
  },
  {
    /**
     * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 9 — la subindustria de la corrida
     * live `ce957e2f` que NO tenía entrada.
     *
     * El usuario la eligió junto a «Supermercados e Hipermercados» y las dos
     * llegaron al runner, pero sin términos declarados no había nada suyo que
     * mandar: las cinco posiciones se llenaron con el catálogo de la otra
     * subindustria y con el respaldo genérico del sector. Con el reparto
     * round-robin del § 2 la ausencia de esta entrada ya no se resolvería
     * silenciosamente —el gate del § 7 bloquearía la búsqueda antes de pagar—, y
     * eso convertiría en inejecutable una selección legítima del wizard.
     *
     * Las frases van primero a propósito: son las que sobreviven al truncamiento a
     * cinco posiciones. `moda`, `calzado`, `apparel` y `footwear` a secas quedan en
     * la cola, donde amplían el ANY-OF sólo cuando hay hueco.
     */
    mapping: {
      canonicalSubindustry: 'Tiendas por Departamento, Moda y Calzado',
      positiveTerms: [
        'department store',
        'tienda por departamento',
        'almacen por departamentos',
        'apparel retail',
        'footwear retail',
        'fashion retail',
        'tienda de ropa',
        'ropa y calzado',
        'clothing retail',
        'apparel',
        'footwear',
        'moda',
        'calzado',
      ],
      contradictoryTerms: [...COMMERCE_CONTRADICTORY_TERMS],
    },
    aliases: [
      'tiendas por departamento, moda y calzado',
      'tiendas por departamento',
      'tienda por departamento',
      'moda y calzado',
      'ropa y calzado',
      'department stores',
      'department store',
      'apparel and footwear',
      'fashion and apparel',
      'fashion and footwear',
    ],
  },
];

// ─── Normalización ────────────────────────────────────────────────────────────

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Emparejamiento de alias ──────────────────────────────────────────────────

/**
 * QUERY-QUALITY-2-FIX § 8 — ¿el nombre de subindustria recibido ES este alias?
 *
 * La versión anterior emparejaba con `normalized.includes(alias) ||
 * alias.includes(normalized)`, y esa segunda mitad es demasiado ancha: cualquier
 * palabra suelta contenida en un alias resolvía la entrada completa. Con los alias
 * de este catálogo, `Retail` caía dentro de `grocery retail`, `Alimentos` dentro de
 * `retail de alimentos` y `Food` dentro de `food retail`, así que tres sectores
 * genéricos resolvían a «Supermercados e Hipermercados» y heredaban sus términos y
 * sus contradicciones — decisiones que cuestan créditos.
 *
 * Reglas, en este orden:
 *   1. igualdad canónica normalizada;
 *   2. alias completo normalizado, también por igualdad;
 *   3. alias de DOS O MÁS palabras presente en la entrada como secuencia de
 *      palabras completas — «Supermercados e Hipermercados (Retail)» sigue
 *      resolviendo, y ningún token aislado puede hacerlo.
 *
 * Un alias de una sola palabra sólo empareja por igualdad: es lo que impide que
 * `retail`, `alimentos` o `food` arrastren una subindustria entera.
 */
function tokenize(value: string): string[] {
  return normalizeKey(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '');
}

function containsTokenSequence(
  inputTokens: readonly string[],
  aliasTokens: readonly string[],
): boolean {
  if (aliasTokens.length === 0 || aliasTokens.length > inputTokens.length) return false;
  for (let start = 0; start <= inputTokens.length - aliasTokens.length; start++) {
    let matched = true;
    for (let offset = 0; offset < aliasTokens.length; offset++) {
      if (inputTokens[start + offset] !== aliasTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

export function matchesApolloSubindustryAlias(
  subindustryInput: string,
  alias: string,
): boolean {
  const normalizedInput = normalizeKey(subindustryInput);
  const normalizedAlias = normalizeKey(alias);
  if (normalizedInput === '' || normalizedAlias === '') return false;
  if (normalizedInput === normalizedAlias) return true;

  const aliasTokens = tokenize(normalizedAlias);
  // Un alias de una sola palabra NO se busca dentro de la entrada: sería volver a
  // la contención ancha por la puerta de atrás.
  if (aliasTokens.length < 2) return false;
  return containsTokenSequence(tokenize(normalizedInput), aliasTokens);
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

/** Todas las subindustrias con mapping explícito. Sólo lectura. */
export function listApolloSubindustrySearchMappings(): ApolloSubindustrySearchMapping[] {
  return APOLLO_SUBINDUSTRY_CATALOG.map((entry) => ({
    canonicalSubindustry: entry.mapping.canonicalSubindustry,
    positiveTerms: [...entry.mapping.positiveTerms],
    contradictoryTerms: [...entry.mapping.contradictoryTerms],
  }));
}

/**
 * Mapping de una subindustria, o null si no está en el catálogo.
 *
 * El emparejamiento lo define `matchesApolloSubindustryAlias` (§ 8): igualdad
 * canónica, igualdad de alias, o alias de dos o más palabras presente como
 * secuencia de palabras completas. «Supermercados e Hipermercados (Retail)» y
 * «supermercados» resuelven a la misma entrada; `Retail`, `Alimentos` y `Food`, a
 * ninguna. Un valor vacío nunca resuelve.
 */
export function resolveApolloSubindustrySearchMapping(
  subindustry: string | null | undefined,
): ApolloSubindustrySearchMapping | null {
  if (!subindustry?.trim()) return null;
  const normalized = normalizeKey(subindustry);
  if (normalized === '') return null;

  for (const entry of APOLLO_SUBINDUSTRY_CATALOG) {
    const candidates = [entry.mapping.canonicalSubindustry, ...entry.aliases];
    for (const alias of candidates) {
      if (!matchesApolloSubindustryAlias(normalized, alias)) continue;
      return {
        canonicalSubindustry: entry.mapping.canonicalSubindustry,
        positiveTerms: [...entry.mapping.positiveTerms],
        contradictoryTerms: [...entry.mapping.contradictoryTerms],
      };
    }
  }
  return null;
}

/**
 * TODAS las subindustrias pedidas que tienen mapping explícito, en el orden de la
 * solicitud.
 *
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 1 — sustituye a
 * `resolveFirstApolloSubindustrySearchMapping`, que devolvía la PRIMERA y
 * descartaba el resto. Ese `return` dentro del bucle era la causa raíz de
 * `ce957e2f`: por muchas subindustrias que el usuario eligiera, exactamente una
 * podía gobernar los términos de la consulta, y con `[A, B]` la que se quedaba
 * fuera era B —o A, si A no tenía entrada—.
 *
 * Se borró en vez de dejarse exportada: un resolvedor de un solo valor sin
 * consumidores es una política FIRST-ONLY esperando a que alguien la vuelva a
 * llamar.
 *
 * `matchedInput` conserva la etiqueta EXACTA que trajo la solicitud, no la
 * canónica: la procedencia es por selección del usuario (§ 10 H).
 */
export function resolveAllApolloSubindustrySearchMappings(
  subindustries: readonly (string | null | undefined)[] | null | undefined,
): { mapping: ApolloSubindustrySearchMapping; matchedInput: string }[] {
  const resolved: { mapping: ApolloSubindustrySearchMapping; matchedInput: string }[] = [];
  for (const subindustry of subindustries ?? []) {
    const mapping = resolveApolloSubindustrySearchMapping(subindustry);
    if (mapping !== null) {
      resolved.push({ mapping, matchedInput: (subindustry ?? '').trim() });
    }
  }
  return resolved;
}

// ─── Contradicción con señales GRATUITAS ──────────────────────────────────────

/**
 * Evidencia gratuita de identidad de un candidato.
 *
 * Sólo campos DECLARADOS. La descripción general se excluye a propósito: un
 * supermercado real que financia compras la menciona, y bloquearlo por eso sería
 * repetir el falso negativo simétrico al de Citigroup.
 */
export type ApolloFreeSectorEvidence = {
  declaredIndustry?: string | null;
  declaredIndustries?: readonly string[] | null;
  keywords?: readonly string[] | null;
  organizationName?: string | null;
};

export type ApolloFreeSectorContradictionVerdict = {
  contradictory: boolean;
  /** Término contradictorio observado. Null cuando no hay contradicción. */
  matchedContradictoryTerm: string | null;
  /** Campo declarado donde se observó. Null cuando no hay contradicción. */
  matchedField: 'declared_industry' | 'declared_industries' | null;
  /** Términos positivos de la subindustria hallados en evidencia declarada. */
  matchedPositiveTerms: string[];
  /** True cuando una señal positiva desactivó una contradicción observada. */
  overriddenByPositiveEvidence: boolean;
};

function includesTerm(haystack: string, term: string): boolean {
  const normalizedTerm = normalizeKey(term);
  if (normalizedTerm === '') return false;
  return haystack.includes(normalizedTerm);
}

/**
 * ¿La evidencia gratuita CONTRADICE la subindustria buscada?
 *
 * Reglas, en este orden:
 *   1. la contradicción se busca sólo en la industria declarada (`industry`,
 *      `industries[]`);
 *   2. una señal positiva de la subindustria en industria declarada, keywords o
 *      nombre DESACTIVA la contradicción — es un minorista de alimentos que
 *      además menciona un servicio financiero, no un banco;
 *   3. sin industria declarada no hay contradicción: la ausencia de evidencia no
 *      es evidencia en contra.
 *
 * Un veredicto `contradictory: true` debe impedir el enrichment: es exactamente
 * el crédito que la corrida QA gastó en Citigroup.
 */
export function evaluateApolloFreeSectorContradiction(
  evidence: ApolloFreeSectorEvidence,
  mapping: ApolloSubindustrySearchMapping | null,
): ApolloFreeSectorContradictionVerdict {
  const empty: ApolloFreeSectorContradictionVerdict = {
    contradictory: false,
    matchedContradictoryTerm: null,
    matchedField: null,
    matchedPositiveTerms: [],
    overriddenByPositiveEvidence: false,
  };
  if (mapping === null) return empty;

  const declaredIndustry = normalizeKey(evidence.declaredIndustry ?? '');
  const declaredIndustries = normalizeKey((evidence.declaredIndustries ?? []).join(' | '));
  const identityText = normalizeKey(
    [
      evidence.declaredIndustry ?? '',
      ...(evidence.declaredIndustries ?? []),
      ...(evidence.keywords ?? []),
      evidence.organizationName ?? '',
    ].join(' | '),
  );

  const matchedPositiveTerms = mapping.positiveTerms.filter((term) =>
    includesTerm(identityText, term),
  );

  let matchedContradictoryTerm: string | null = null;
  let matchedField: ApolloFreeSectorContradictionVerdict['matchedField'] = null;
  for (const term of mapping.contradictoryTerms) {
    if (includesTerm(declaredIndustry, term)) {
      matchedContradictoryTerm = term;
      matchedField = 'declared_industry';
      break;
    }
    if (includesTerm(declaredIndustries, term)) {
      matchedContradictoryTerm = term;
      matchedField = 'declared_industries';
      break;
    }
  }

  if (matchedContradictoryTerm === null) {
    return { ...empty, matchedPositiveTerms };
  }
  if (matchedPositiveTerms.length > 0) {
    return {
      contradictory: false,
      matchedContradictoryTerm: null,
      matchedField: null,
      matchedPositiveTerms,
      overriddenByPositiveEvidence: true,
    };
  }

  return {
    contradictory: true,
    matchedContradictoryTerm,
    matchedField,
    matchedPositiveTerms,
    overriddenByPositiveEvidence: false,
  };
}

/**
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 1 — el MISMO veredicto, evaluado con
 * ANY-OF sobre todas las subindustrias pedidas.
 *
 * Este era el último consumidor FIRST-ONLY que decidía GASTO y que el ADDENDUM de
 * PR #241 no alcanzó: el runner resolvía una sola mapping con
 * `resolveFirstApolloSubindustrySearchMapping` y con ella juzgaba la
 * contradicción. Con `[Tiendas por Departamento, Supermercados]` la mapping que
 * gobernaba era la de supermercados, así que una tienda por departamento cuya
 * industria declarada mencionara un término contradictorio se bloqueaba sin que
 * sus propias señales positivas pudieran desactivarlo — y con la solicitud
 * permutada el veredicto podía cambiar.
 *
 * Semántica ANY-OF, coherente con los otros cuatro gates: basta que UNA
 * subindustria pedida no resulte contradicha para que el candidato no lo esté. Se
 * conserva la evidencia positiva observada de todas ellas.
 *
 * El cap NO se mueve: esto decide QUIÉN compite por un enrichment, no cuántos se
 * ejecutan. El tope sigue siendo cinco enrichments y veinticinco créditos, con una
 * subindustria o con cinco.
 */
export function evaluateApolloFreeSectorContradictionAnyOf(
  evidence: ApolloFreeSectorEvidence,
  mappings: readonly ApolloSubindustrySearchMapping[],
): ApolloFreeSectorContradictionVerdict {
  if (mappings.length === 0) return evaluateApolloFreeSectorContradiction(evidence, null);

  const verdicts = mappings.map((mapping) =>
    evaluateApolloFreeSectorContradiction(evidence, mapping),
  );

  const matchedPositiveTerms: string[] = [];
  for (const verdict of verdicts) {
    for (const term of verdict.matchedPositiveTerms) {
      if (!matchedPositiveTerms.includes(term)) matchedPositiveTerms.push(term);
    }
  }

  const surviving = verdicts.find((verdict) => !verdict.contradictory) ?? null;
  if (surviving !== null) {
    return {
      contradictory: false,
      matchedContradictoryTerm: null,
      matchedField: null,
      matchedPositiveTerms,
      // Una sola subindustria rescatada por evidencia positiva ya es un rescate.
      overriddenByPositiveEvidence: verdicts.some((v) => v.overriddenByPositiveEvidence),
    };
  }

  // Ninguna sobrevivió: la contradicción se reporta con el primer término
  // observado, que es el que un diagnóstico necesita nombrar.
  const first = verdicts[0];
  return {
    contradictory: true,
    matchedContradictoryTerm: first.matchedContradictoryTerm,
    matchedField: first.matchedField,
    matchedPositiveTerms,
    overriddenByPositiveEvidence: false,
  };
}
