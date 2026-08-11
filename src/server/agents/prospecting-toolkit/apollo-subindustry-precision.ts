/**
 * apollo-subindustry-precision.ts — Precisión de SUBINDUSTRIA, separada de la
 * precisión de industria.
 *
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 · § 3.
 *
 * El defecto que cierra: el gate sectorial existente
 * (`applyApolloSectorRelevanceGate`) declara «relevante» en cuanto UN término del
 * conjunto aparece en CUALQUIER texto del candidato —título, snippet, dominio
 * incluidos—. Para «Supermercados e Hipermercados» ese conjunto contiene
 * `grocery`, así que una app de domicilios de mercado y un distribuidor B2B de
 * alimentos pasaron como empresas confirmadas de la subindustria y se
 * persistieron. Evidencia AMPLIA (`retail`, `food and beverages`, `food
 * distribution`, `grocery delivery`, `marketplace`, `wholesale`, `consumer
 * services`) no demuestra la subindustria pedida.
 *
 * Aquí la subindustria exige evidencia POSITIVA y TRAZABLE:
 *
 *   - el término que la demuestra (`subindustryEvidence[].term`);
 *   - el campo del proveedor donde apareció (`.field`);
 *   - la clase de fuente que lo respalda (`classificationSource`).
 *
 * Y separa cuatro cosas que antes eran una:
 *
 *   `industryMatch`          la INDUSTRIA declarada por el proveedor.
 *   `subindustryMatch`       el veredicto sobre la SUBINDUSTRIA pedida.
 *   `subindustryConfidence`  cuánto respalda ese veredicto la evidencia hallada.
 *   `subindustryEvidence`    qué se leyó exactamente, y dónde.
 *
 * Contrato de consumo (§ 3):
 *
 *   `confirmed`  puede contar hacia el objetivo.
 *   `ambiguous`  NO cuenta como empresa válida del objetivo. Sigue compitiendo
 *                por un enrichment: la ambigüedad es justo lo que el enrichment
 *                existe para resolver.
 *   `rejected`   no se persiste como candidato de esa búsqueda.
 *
 * Puro: sin I/O, sin env, sin reloj. Ninguna empresa está codificada por nombre —
 * las reglas son patrones de subindustria y de modelo de negocio.
 */

import type { WebSearchResult } from './types';
import {
  normalizeSubindustryIdentity,
  resolveSubindustryPrecisionIdentity,
  type SubindustryPrecisionIdentityEntry,
} from './apollo-subindustry-key-resolution';

// ─── Vocabulario del veredicto ────────────────────────────────────────────────

/** Veredicto sobre la subindustria PEDIDA. */
export type SubindustryMatchVerdict = 'confirmed' | 'ambiguous' | 'rejected';

/**
 * Veredicto sobre la INDUSTRIA que el proveedor declara. Se reporta aparte
 * porque una industria compatible (`retail`) es exactamente lo que NO demuestra
 * la subindustria, y confundirlas es el defecto que este módulo cierra.
 */
export type IndustryMatchVerdict =
  | 'confirmed'
  | 'broad_compatible'
  | 'contradictory'
  | 'unknown';

/**
 * De dónde salió la clasificación que sostiene el veredicto.
 *
 * `none` no es un valor de relleno: significa que NADA respaldó la subindustria,
 * y con él el veredicto nunca puede ser `confirmed`.
 */
export type SubindustryClassificationSource =
  | 'provider_industry'
  | 'provider_keywords'
  | 'provider_description'
  | 'commercial_name'
  | 'website_profile'
  | 'catalog_classification'
  | 'none';

/** Una pieza de evidencia, con el campo exacto del proveedor donde se leyó. */
export type SubindustryEvidenceItem = {
  /** Término del catálogo de anclas que apareció. Nunca texto libre del proveedor. */
  term: string;
  /** Campo del proveedor, con su ruta (`apollo_profile.keywords`). */
  field: string;
  source: SubindustryClassificationSource;
};

/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 6 — para una subindustria
 * COOMPUESTA (varias familias bajo una sola etiqueta), qué familia produjo la
 * confirmación. `none` cuando el veredicto no es `confirmed`, o la subindustria
 * no distingue familias.
 *
 * Una familia confirmada basta: no se exige que una empresa cumpla las tres.
 */
export type SubindustryMatchFamily =
  | 'department_store'
  | 'fashion_apparel'
  | 'footwear'
  | 'none';

/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 2 — veredicto de UNA de las
 * subindustrias pedidas, conservado aparte del veredicto agregado.
 *
 * Sin esto, saber POR QUÉ un candidato quedó ambiguo cuando el usuario pidió
 * cinco subindustrias exigiría reevaluar: el agregado sólo dice el desenlace, no
 * qué selección lo produjo.
 */
export type RequestedSubindustryEvaluation = {
  requestedSubindustry: string;
  subindustryMapped: boolean;
  subindustryMatch: SubindustryMatchVerdict;
  subindustryMatchFamily: SubindustryMatchFamily;
  subindustryConfidence: number;
  verdictReason: SubindustryVerdictReason;
};

export type ApolloSubindustryPrecisionAssessment = {
  /**
   * Subindustria cuyo veredicto GANÓ el ANY-OF (§ 2). `null` cuando la búsqueda
   * no declaró ninguna.
   *
   * Con una sola subindustria pedida es esa misma, y el campo conserva
   * exactamente el significado que tenía antes del § 2.
   */
  requestedSubindustry: string | null;
  /** § 2 — TODAS las subindustrias pedidas, en el orden en que se pidieron. */
  requestedSubindustries: string[];
  /** § 2 — veredicto individual de cada subindustria pedida. Ninguna se descarta. */
  perRequestedSubindustryEvaluations: RequestedSubindustryEvaluation[];
  /**
   * § 2 — la subindustria pedida que produjo la CONFIRMACIÓN. `null` cuando
   * ninguna confirmó: una selección ambigua no «casi» confirma.
   */
  matchedRequestedSubindustry: string | null;
  /** La subindustria pedida tiene catálogo de anclas propio. */
  subindustryMapped: boolean;
  industryMatch: IndustryMatchVerdict;
  subindustryMatch: SubindustryMatchVerdict;
  /** Familia que confirmó, para subindustrias compuestas. `none` si no aplica. */
  subindustryMatchFamily: SubindustryMatchFamily;
  /** 0–100. Nunca se reporta confianza sobre un veredicto sin evidencia. */
  subindustryConfidence: number;
  subindustryEvidence: SubindustryEvidenceItem[];
  classificationSource: SubindustryClassificationSource;
  /** Señales de MODELO DE NEGOCIO que excluyen o ponen en duda la subindustria. */
  disqualifyingSignals: string[];
  /** Código estable de por qué el veredicto es el que es. */
  verdictReason: SubindustryVerdictReason;
};

export type SubindustryVerdictReason =
  | 'subindustry_not_mapped'
  | 'anchor_evidence_confirmed'
  | 'declared_industry_contradicts'
  | 'excluded_business_model'
  | 'conflicting_business_model_with_anchor'
  | 'broad_industry_only'
  | 'no_subindustry_evidence';

// ─── Catálogos de señales ─────────────────────────────────────────────────────

/**
 * ANCLAS: términos que, por sí solos, nombran la operación de la subindustria.
 *
 * `grocery` a secas NO está aquí, y esa ausencia es deliberada: es substring de
 * `grocery delivery` y de `grocery marketplace`, y con él una app de domicilios
 * quedaba «confirmada». Lo mismo con `retail`, que ya tiene su propio historial
 * (v1.16K-AC) por ser substring de `retail banking`.
 */
/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 6 — «Tiendas por
 * Departamento, Moda y Calzado» es una etiqueta COMPUESTA: tres familias de
 * operador distintas bajo un solo nombre. Confirmar CUALQUIERA basta; no se
 * exige que una empresa cumpla las tres.
 *
 * `confeccion` y `calzado` sueltos NO son anclas (§ 5): son substring de
 * `confección industrial` y de `fabricante de calzado`, y con ellos un
 * fabricante mayorista quedaría confirmado sin una sola señal de venta al
 * consumidor. Sólo la forma compuesta con evidencia de venta/comercio cuenta.
 *
 * Declarado ANTES de `SUBINDUSTRY_ANCHOR_TERMS`, que deriva sus claves de aquí.
 */
const SUBINDUSTRY_ANCHOR_FAMILIES: Record<string, Record<string, SubindustryMatchFamily>> = {
  'tiendas por departamento, moda y calzado': {
    // Tiendas por departamento — español e inglés.
    'tienda por departamentos': 'department_store',
    'tiendas por departamentos': 'department_store',
    'almacen por departamentos': 'department_store',
    'almacenes por departamentos': 'department_store',
    'department store': 'department_store',
    'department stores': 'department_store',
    'departmental store': 'department_store',
    'departmental stores': 'department_store',

    // Moda y confección comercial.
    moda: 'fashion_apparel',
    fashion: 'fashion_apparel',
    'fashion retail': 'fashion_apparel',
    'fashion retailer': 'fashion_apparel',
    'apparel retail': 'fashion_apparel',
    'apparel retailer': 'fashion_apparel',
    'clothing store': 'fashion_apparel',
    'clothing stores': 'fashion_apparel',
    'clothing retailer': 'fashion_apparel',
    'tienda de ropa': 'fashion_apparel',
    'tiendas de ropa': 'fashion_apparel',
    'prendas de vestir': 'fashion_apparel',
    'venta de confeccion': 'fashion_apparel',
    'venta de prendas de vestir': 'fashion_apparel',

    // Calzado — sólo con evidencia de venta/tienda, nunca `calzado` a secas.
    'footwear retail': 'footwear',
    'footwear retailer': 'footwear',
    'shoe store': 'footwear',
    'shoe stores': 'footwear',
    'shoe retailer': 'footwear',
    'tienda de calzado': 'footwear',
    'tiendas de calzado': 'footwear',
    'venta de calzado': 'footwear',
  },
};

const SUBINDUSTRY_ANCHOR_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    // Español — nombran al operador, no a la categoría de producto.
    'supermercado',
    'supermercados',
    'hipermercado',
    'hipermercados',
    'autoservicio',
    'cadena de supermercados',
    'almacen de cadena',
    'tienda de descuento',
    // Inglés
    'supermarket',
    'supermarkets',
    'hypermarket',
    'hypermarkets',
    'grocery store',
    'grocery stores',
    'grocery chain',
    'grocery retailer',
    'supermarket chain',
  ],
  'tiendas por departamento, moda y calzado': Object.keys(
    SUBINDUSTRY_ANCHOR_FAMILIES['tiendas por departamento, moda y calzado'],
  ),
};

/**
 * Modelos de negocio EXCLUYENTES: quien opera así no es de la subindustria
 * pedida, por muchos términos de categoría que comparta con ella.
 *
 * Un distribuidor mayorista de alimentos vende A supermercados y restaurantes;
 * su catálogo menciona los mismos productos y con frecuencia la misma palabra
 * `grocery`. Es el caso B del § 3 y su veredicto es `rejected`.
 */
/**
 * § 1 — nota sobre los PLURALES de las listas que RECHAZAN.
 *
 * Con el matcher por substring, `food distributor` casaba dentro de «food
 * distributors» de regalo. Con el matcher por token ya no, y perder una
 * coincidencia aquí no es un detalle de estilo: debilitaría un RECHAZO, que es
 * la dirección insegura. Por eso las formas plurales e inflexionadas se declaran
 * explícitas, igual que el módulo ya hacía con `supermercado`/`supermercados`,
 * en vez de reintroducir coincidencia difusa por sufijos —que volvería a hacer
 * casar `moda` dentro de `modas`… y de cualquier otra cosa que empiece igual.
 */
const SUBINDUSTRY_EXCLUSIVE_BUSINESS_MODEL_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    'wholesale distributor',
    'wholesale distributors',
    'wholesale distribution',
    'food distributor',
    'food distributors',
    'food distribution',
    'foodservice distribution',
    'distribuidor mayorista',
    'distribuidores mayoristas',
    'distribucion mayorista',
    'distribuidor de alimentos',
    'distribuidores de alimentos',
    'distribucion de alimentos',
    'venta al por mayor',
    'b2b marketplace',
    'restaurant supply',
    'proveedor de restaurantes',
    'proveedores de restaurantes',
  ],
};

/**
 * Modelos de negocio EN CONFLICTO: pueden coexistir con la subindustria (una
 * cadena real tiene app de domicilios) pero no la demuestran por sí solos.
 *
 * Con ancla ⇒ `ambiguous`: la evidencia se contradice y resolverla no es cosa de
 * este módulo. Sin ancla ⇒ `rejected`: sólo queda el modelo que no es el pedido.
 * Es el caso C del § 3.
 */
const SUBINDUSTRY_CONFLICTING_BUSINESS_MODEL_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    'grocery delivery',
    'delivery app',
    'delivery apps',
    'on-demand delivery',
    'domicilios',
    'aplicacion de domicilios',
    'marketplace',
    'marketplaces',
    'ecommerce platform',
    'e-commerce platform',
    'quick commerce',
    'q-commerce',
    'dark store',
    'dark stores',
    'last mile delivery',
  ],
};

/**
 * Industrias AMPLIAS: contienen a la subindustria sin demostrarla.
 *
 * Presencia de una de ellas y NADA más ⇒ `ambiguous` (caso D del § 3: una
 * empresa con `retail` genérico nunca queda `confirmed`).
 */
const SUBINDUSTRY_BROAD_INDUSTRY_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    'retail',
    'consumer goods',
    'consumer services',
    'food',
    'food and beverage',
    'food & beverages',
    'food and beverages',
    'beverages',
    'wholesale',
    'grocery',
    'comercio',
    'consumo',
  ],
  // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 5 — amplias a propósito:
  // presencia y NADA más ⇒ `ambiguous`, nunca `confirmed`. `almacen` está aquí
  // suelto porque es parte frecuente del NOMBRE comercial («Almacenes La 14») y
  // no debe, por sí solo, demostrar ninguna de las tres familias.
  'tiendas por departamento, moda y calzado': [
    'retail',
    'retailer',
    'retailers',
    'consumer goods',
    'comercio',
    'marketplace',
    'marketplaces',
    'supermarket',
    'grocery',
    'food',
    'beverage',
    'beverages',
    'manufacturer',
    'manufacturers',
    'distributor',
    'distributors',
    'wholesale',
    'shopping',
    // § 1 — con matcher por token, `almacen` ya NO cubre «Almacenes La 14»: el
    // plural se declara aparte. Ambos siguen siendo AMPLIOS a propósito (§ 5).
    'almacen',
    'almacenes',
  ],
};

/**
 * Industrias que CONTRADICEN la subindustria.
 *
 * `retail banking` y `commercial banking` se nombran explícitamente porque
 * contienen el substring `retail`, que es amplio: sin nombrarlas, la comprobación
 * de amplitud las dejaría pasar como «por confirmar».
 */
const SUBINDUSTRY_CONTRADICTORY_INDUSTRY_TERMS: Record<string, string[]> = {
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
  ],
  // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 5, caso E — la industria
  // DECLARADA contradice, sin que ningún término amplio la salve. Un fabricante
  // de alimentos que menciona `retail` en su catálogo no queda «por confirmar»:
  // su industria declarada ya dice que no es un operador de tienda/moda/calzado.
  // Se incluyen también supermercado/hipermercado — es una subindustria de
  // retail DISTINTA, no una de las tres familias de esta etiqueta.
  'tiendas por departamento, moda y calzado': [
    'food production',
    'food manufacturing',
    'fabricante de alimentos',
    'fabricantes de alimentos',
    'food and beverage manufacturing',
    'beverage manufacturing',
    'agriculture',
    'farming',
    'supermarket',
    'supermarkets',
    'supermercado',
    'supermercados',
    'hypermarket',
    'hypermarkets',
    'hipermercado',
    'hipermercados',
    'grocery store',
    'grocery stores',
    'banking',
    'financial services',
    'insurance',
    'software',
    'saas',
    'information technology',
    'consulting',
    'oil & energy',
    'mining & metals',
    'construction',
    'real estate',
    'hospital & health care',
    'pharmaceuticals',
  ],
};

// ─── Campos del proveedor ─────────────────────────────────────────────────────

/**
 * Campos CLASIFICADORES, con la fuente que representan.
 *
 * El orden es el de autoridad decreciente y decide `classificationSource` cuando
 * varias piezas de evidencia coinciden.
 *
 * `title`, `snippet`, `url` y `domain` NO están: el nombre comercial se evalúa
 * aparte y con una regla más estricta, y un snippet de resultados de búsqueda no
 * es una clasificación del proveedor.
 */
const CLASSIFYING_FIELDS: readonly {
  path: readonly string[];
  field: string;
  source: SubindustryClassificationSource;
}[] = [
  { path: ['industry'], field: 'industry', source: 'provider_industry' },
  { path: ['industries'], field: 'industries', source: 'provider_industry' },
  {
    path: ['apollo_profile', 'industry'],
    field: 'apollo_profile.industry',
    source: 'provider_industry',
  },
  {
    path: ['apollo_profile', 'industries'],
    field: 'apollo_profile.industries',
    source: 'provider_industry',
  },
  { path: ['keywords'], field: 'keywords', source: 'provider_keywords' },
  {
    path: ['apollo_profile', 'keywords'],
    field: 'apollo_profile.keywords',
    source: 'provider_keywords',
  },
  {
    path: ['apollo_profile', 'organization_keywords'],
    field: 'apollo_profile.organization_keywords',
    source: 'provider_keywords',
  },
  {
    path: ['short_description'],
    field: 'short_description',
    source: 'provider_description',
  },
  {
    path: ['apollo_profile', 'short_description'],
    field: 'apollo_profile.short_description',
    source: 'provider_description',
  },
  {
    path: ['apollo_profile', 'seo_description'],
    field: 'apollo_profile.seo_description',
    source: 'website_profile',
  },
  {
    path: ['apollo_profile', 'description'],
    field: 'apollo_profile.description',
    source: 'website_profile',
  },
];

/** Campos de INDUSTRIA declarada. Nunca descripciones: ver § 3 del gate sectorial. */
const DECLARED_INDUSTRY_FIELDS: readonly (readonly string[])[] = [
  ['industry'],
  ['industries'],
  ['apollo_profile', 'industry'],
  ['apollo_profile', 'industries'],
];

// ─── Normalización ────────────────────────────────────────────────────────────

/**
 * PHASE 2A § 3 — una sola normalización para identidad y para evidencia.
 *
 * Vivía duplicada aquí y en el resolver. Dos copias de la misma regla es cómo se
 * cuela una divergencia entre «qué subindustria es» y «qué texto la demuestra».
 */
const normalize = normalizeSubindustryIdentity;

// ─── Matching seguro de términos ──────────────────────────────────────────────

/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 1 — un término del catálogo
 * coincide como PALABRA completa o como SECUENCIA COMPLETA de palabras, nunca
 * como substring dentro de otra palabra.
 *
 * El defecto que cierra: `text.includes(term)`. Con `moda` y `fashion` como
 * anclas de la familia `fashion_apparel`, estas cinco cadenas quedaban
 * `confirmed` —y por tanto contaban hacia el objetivo— sin una sola señal de la
 * subindustria pedida:
 *
 *   «venta de cómodas y camas»      `moda` dentro de `cómodas`
 *   «servicios de acomodación»      `moda` dentro de `acomodación`
 *   «empresa acomodada»             `moda` dentro de `acomodada`
 *   «experiencia incómoda»          `moda` dentro de `incómoda`
 *   «Accommodation services»        `moda` dentro de `Accommodation`
 *
 * No se usa `\b` de JavaScript: sobre texto Unicode, `\b` considera frontera de
 * palabra el paso de un carácter de palabra ASCII a uno acentuado, así que
 * `/\bmoda\b/u` sigue casando dentro de «acomodación». La tokenización explícita
 * con `\p{L}`/`\p{N}` no tiene esa ambigüedad, y `normalize` ya quitó las tildes
 * y colapsó los espacios antes de llegar aquí.
 */
const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

function tokenize(normalizedText: string): readonly string[] {
  return normalizedText.match(TOKEN_PATTERN) ?? [];
}

/**
 * Tokens de un término del catálogo, memorizados: los catálogos son estáticos y
 * cada término se comprueba contra muchos textos por candidato.
 */
const termTokenCache = new Map<string, readonly string[]>();

function termTokens(term: string): readonly string[] {
  const cached = termTokenCache.get(term);
  if (cached !== undefined) return cached;
  const tokens = tokenize(normalize(term));
  termTokenCache.set(term, tokens);
  return tokens;
}

/**
 * `true` cuando `sequence` aparece como subsecuencia CONTIGUA de `textTokens`.
 *
 * Una secuencia vacía nunca coincide: un término del catálogo compuesto sólo de
 * puntuación no puede confirmar a nadie.
 */
function tokensContainSequence(
  textTokens: readonly string[],
  sequence: readonly string[],
): boolean {
  if (sequence.length === 0 || sequence.length > textTokens.length) return false;
  for (let start = 0; start <= textTokens.length - sequence.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (textTokens[start + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Coincidencia segura de UN término del catálogo contra UN texto ya normalizado.
 *
 * Exportada para que las pruebas puedan ejercitar el matcher directamente, sin
 * tener que construir un candidato completo para cada cadena adversarial.
 */
export function matchesCatalogTerm(normalizedText: string, term: string): boolean {
  return tokensContainSequence(tokenize(normalizedText), termTokens(term));
}

/** Coincidencia segura contra una lista de textos ya normalizados. */
function someTextMatches(normalizedTexts: readonly string[], term: string): boolean {
  const sequence = termTokens(term);
  if (sequence.length === 0) return false;
  return normalizedTexts.some((text) => tokensContainSequence(tokenize(text), sequence));
}

function readPath(meta: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = meta;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Proyecta un valor del proveedor a la lista de textos normalizados que aporta. */
function toNormalizedTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = normalize(value);
    return normalized === '' ? [] : [normalized];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => toNormalizedTexts(entry));
  }
  return [];
}

/**
 * PHASE 2A § 10 — registro de identidad de las subindustrias CON política de
 * precisión. Dos entradas, las mismas dos de siempre.
 *
 * Se declara aquí, junto a los catálogos que indexa, y la suite verifica que sus
 * claves son EXACTAMENTE las de `SUBINDUSTRY_ANCHOR_TERMS`
 * (`listSubindustryPrecisionAnchorKeys`): una subindustria con anclas y sin
 * identidad sería inevaluable, y una con identidad y sin anclas sería una
 * subindustria «mapeada» que no puede confirmar a nadie.
 *
 * `explicitAliases` está VACÍO a propósito (§ 4): hoy la precisión recibe una
 * etiqueta de texto sin la versión del catálogo que la resolvió, así que conectar
 * los 127 alias publicados crearía una segunda fuente de verdad. Es la decisión
 * de Phase 2B — ver `SubindustryPrecisionPhase2BInput`.
 *
 * `subindustryId` es `null` por el mismo motivo: ningún consumidor lo trae aún.
 */
const SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY: readonly SubindustryPrecisionIdentityEntry[] = [
  {
    key: 'supermercados e hipermercados',
    canonicalName: 'Supermercados e Hipermercados',
    subindustryId: null,
    explicitAliases: [],
  },
  {
    key: 'tiendas por departamento, moda y calzado',
    canonicalName: 'Tiendas por Departamento, Moda y Calzado',
    subindustryId: null,
    explicitAliases: [],
  },
];

/** § 10 — las subindustrias con política de precisión, para auditoría y pruebas. */
export function listSubindustryPrecisionIdentityRegistry(): SubindustryPrecisionIdentityEntry[] {
  return SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY.map((entry) => ({
    ...entry,
    explicitAliases: [...entry.explicitAliases],
  }));
}

/**
 * Claves que los catálogos de ANCLAS declaran. Sólo lectura.
 *
 * Existe para que la suite pueda probar que el registro de identidad y los
 * catálogos de precisión hablan del mismo conjunto de subindustrias, sin exponer
 * los términos.
 */
export function listSubindustryPrecisionAnchorKeys(): string[] {
  return Object.keys(SUBINDUSTRY_ANCHOR_TERMS);
}

/**
 * Clave de catálogo de una subindustria, resuelta sólo por coincidencia EXACTA.
 *
 * PHASE 2A §§ 1, 2 y 9 — sustituye la contención bidireccional por substring
 * (`normalized.includes(key) || key.includes(normalized)`), que hacía que
 * `"super"`, `"moda"`, `"calzado"` y hasta las cadenas de una sola letra `"a"`,
 * `"e"`, `"s"`, `"o"` e `"y"` resolvieran a una subindustria real y heredaran su
 * catálogo de anclas, exclusiones y contradicciones —decisiones que deciden si un
 * candidato cuenta hacia el objetivo y si se persiste—. El ganador, además, lo
 * elegía el orden de `Object.keys`.
 *
 * Ahora: id exacto, canónico normalizado exacto, alias explícito normalizado
 * exacto, o `null`. Sin fallback al sector padre, sin clave más cercana, sin
 * primera entrada del registro y sin mapping por defecto.
 */
function resolveSubindustryKey(subindustry: string | null | undefined): string | null {
  return (
    resolveSubindustryPrecisionIdentity(
      { label: subindustry ?? null },
      SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY,
    )?.key ?? null
  );
}

// ─── Lectura de evidencia ─────────────────────────────────────────────────────

/**
 * Anclas encontradas en campos clasificadores, con su procedencia.
 *
 * Un término se atribuye al campo donde REALMENTE apareció. Concatenar todos los
 * textos y buscar sobre la mezcla es lo que hacía imposible decir «de dónde salió
 * esta confirmación», que es justo lo que el § 3 exige poder responder.
 */
function collectAnchorEvidence(
  meta: Record<string, unknown>,
  anchors: readonly string[],
): SubindustryEvidenceItem[] {
  const evidence: SubindustryEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const descriptor of CLASSIFYING_FIELDS) {
    const texts = toNormalizedTexts(readPath(meta, descriptor.path));
    if (texts.length === 0) continue;
    for (const anchor of anchors) {
      // § 1 — palabra o frase completa, nunca substring. Ver `matchesCatalogTerm`.
      if (!someTextMatches(texts, anchor)) continue;
      const dedupeKey = `${descriptor.field}|${anchor}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      evidence.push({ term: anchor, field: descriptor.field, source: descriptor.source });
    }
  }

  return evidence;
}

/**
 * Ancla en el NOMBRE COMERCIAL.
 *
 * Sólo cuenta cuando el ancla aparece como palabra del nombre: «Supermercados
 * X» es inequívoco, «Supermundo» no contiene la operación aunque contenga las
 * letras. Por eso se comprueba con límites de palabra y no por substring.
 *
 * § 1 — el ancla de VARIAS palabras usa el mismo matcher por secuencia de
 * tokens que el resto del módulo. Antes caía a `normalized.includes(anchor)`, la
 * misma comparación por substring que dejaba pasar «Comodas del Norte» para el
 * ancla compuesta equivalente.
 */
function collectCommercialNameEvidence(
  title: unknown,
  anchors: readonly string[],
): SubindustryEvidenceItem[] {
  if (typeof title !== 'string') return [];
  const normalized = normalize(title);
  if (normalized === '') return [];

  return anchors
    .filter((anchor) => matchesCatalogTerm(normalized, anchor))
    .map((anchor) => ({
      term: anchor,
      field: 'title',
      source: 'commercial_name' as const,
    }));
}

/** Términos de modelo de negocio presentes en cualquier campo clasificador. */
function collectBusinessModelSignals(
  meta: Record<string, unknown>,
  terms: readonly string[],
): string[] {
  const haystack = CLASSIFYING_FIELDS.flatMap((descriptor) =>
    toNormalizedTexts(readPath(meta, descriptor.path)),
  );
  if (haystack.length === 0) return [];
  return terms.filter((term) => someTextMatches(haystack, term));
}

/**
 * Clasifica la INDUSTRIA declarada. Lo contradictorio se comprueba primero.
 *
 * § 1 — el campo `industry` usa el MISMO matcher seguro que el resto de los
 * campos clasificadores. Era el que más daño hacía por substring: una industria
 * declarada «Accommodation and Food Services» activaba el ancla `moda` y
 * devolvía `confirmed` para «Tiendas por Departamento, Moda y Calzado».
 */
function classifyDeclaredIndustry(
  meta: Record<string, unknown>,
  key: string,
): IndustryMatchVerdict {
  const declared = DECLARED_INDUSTRY_FIELDS.flatMap((path) =>
    toNormalizedTexts(readPath(meta, path)),
  );
  if (declared.length === 0) return 'unknown';

  const contradictory = SUBINDUSTRY_CONTRADICTORY_INDUSTRY_TERMS[key] ?? [];
  if (contradictory.some((term) => someTextMatches(declared, term))) {
    return 'contradictory';
  }

  const anchors = SUBINDUSTRY_ANCHOR_TERMS[key] ?? [];
  if (anchors.some((anchor) => someTextMatches(declared, anchor))) {
    return 'confirmed';
  }

  const broad = SUBINDUSTRY_BROAD_INDUSTRY_TERMS[key] ?? [];
  if (broad.some((term) => someTextMatches(declared, term))) {
    return 'broad_compatible';
  }

  return 'unknown';
}

// ─── Confianza ────────────────────────────────────────────────────────────────

/**
 * Autoridad de cada fuente. Una industria declarada por el proveedor pesa más
 * que una descripción de marketing, y ambas más que el nombre comercial.
 */
const SOURCE_AUTHORITY: Record<SubindustryClassificationSource, number> = {
  catalog_classification: 95,
  provider_industry: 90,
  provider_keywords: 80,
  provider_description: 75,
  website_profile: 70,
  commercial_name: 65,
  none: 0,
};

/** La fuente de mayor autoridad entre la evidencia hallada. */
function strongestSource(
  evidence: readonly SubindustryEvidenceItem[],
): SubindustryClassificationSource {
  let best: SubindustryClassificationSource = 'none';
  for (const item of evidence) {
    if (SOURCE_AUTHORITY[item.source] > SOURCE_AUTHORITY[best]) best = item.source;
  }
  return best;
}

/** Techo de confianza para un veredicto que NO confirma. */
const AMBIGUOUS_CONFIDENCE_CAP = 40;

// ─── Evaluación ───────────────────────────────────────────────────────────────

function assessment(
  overrides: Partial<ApolloSubindustryPrecisionAssessment> &
    Pick<ApolloSubindustryPrecisionAssessment, 'subindustryMatch' | 'verdictReason'>,
): ApolloSubindustryPrecisionAssessment {
  return {
    requestedSubindustry: null,
    requestedSubindustries: [],
    perRequestedSubindustryEvaluations: [],
    matchedRequestedSubindustry: null,
    subindustryMapped: false,
    industryMatch: 'unknown',
    subindustryMatchFamily: 'none',
    subindustryConfidence: 0,
    subindustryEvidence: [],
    classificationSource: 'none',
    disqualifyingSignals: [],
    ...overrides,
  };
}

/**
 * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 6 — familia que produjo
 * la confirmación, para subindustrias compuestas. `none` cuando la
 * subindustria no distingue familias, o ningún término de evidencia tiene una
 * familia asociada.
 */
function resolveFamilyForEvidence(
  key: string,
  evidence: readonly SubindustryEvidenceItem[],
): SubindustryMatchFamily {
  const families = SUBINDUSTRY_ANCHOR_FAMILIES[key];
  if (!families) return 'none';
  for (const item of evidence) {
    const family = families[item.term];
    if (family) return family;
  }
  return 'none';
}

/**
 * Núcleo: evalúa UNA subindustria pedida contra la evidencia del candidato.
 *
 * Privado a propósito. El único camino público es el evaluador ANY-OF del § 2,
 * para que no exista un consumidor capaz de mirar una sola de las cinco
 * selecciones posibles del usuario sin darse cuenta.
 *
 * Los campos del § 2 (`requestedSubindustries`,
 * `perRequestedSubindustryEvaluations`, `matchedRequestedSubindustry`) los
 * rellena el ANY-OF: aquí quedan en su valor por defecto.
 */
function assessSingleRequestedSubindustry(
  result: WebSearchResult,
  subindustry: string | null | undefined,
): ApolloSubindustryPrecisionAssessment {
  const requestedSubindustry = subindustry?.trim() ? subindustry.trim() : null;
  const key = resolveSubindustryKey(requestedSubindustry);

  if (key === null) {
    return assessment({
      requestedSubindustry,
      subindustryMapped: false,
      subindustryMatch: 'ambiguous',
      verdictReason: 'subindustry_not_mapped',
    });
  }

  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const anchors = SUBINDUSTRY_ANCHOR_TERMS[key] ?? [];
  const industryMatch = classifyDeclaredIndustry(meta, key);

  const base = {
    requestedSubindustry,
    subindustryMapped: true,
    industryMatch,
  };

  // 1. La industria declarada contradice: no hay ancla que lo compense. Es el
  //    caso Citigroup y se resuelve antes de mirar nada más.
  if (industryMatch === 'contradictory') {
    return assessment({
      ...base,
      subindustryMatch: 'rejected',
      verdictReason: 'declared_industry_contradicts',
    });
  }

  const evidence = [
    ...collectAnchorEvidence(meta, anchors),
    ...collectCommercialNameEvidence(result.title, anchors),
  ];
  const exclusive = collectBusinessModelSignals(
    meta,
    SUBINDUSTRY_EXCLUSIVE_BUSINESS_MODEL_TERMS[key] ?? [],
  );
  const conflicting = collectBusinessModelSignals(
    meta,
    SUBINDUSTRY_CONFLICTING_BUSINESS_MODEL_TERMS[key] ?? [],
  );

  // 2. Modelo de negocio excluyente: quien distribuye al por mayor no es el
  //    operador buscado, comparta o no su vocabulario de producto (caso B).
  if (exclusive.length > 0) {
    return assessment({
      ...base,
      subindustryMatch: 'rejected',
      subindustryEvidence: evidence,
      disqualifyingSignals: [...exclusive, ...conflicting],
      verdictReason: 'excluded_business_model',
    });
  }

  // 3. Modelo en conflicto (caso C). Con ancla la evidencia se contradice y
  //    queda ambigua; sin ancla sólo hay el modelo que no es el pedido.
  if (conflicting.length > 0) {
    return assessment({
      ...base,
      subindustryMatch: evidence.length > 0 ? 'ambiguous' : 'rejected',
      subindustryConfidence:
        evidence.length > 0
          ? Math.min(AMBIGUOUS_CONFIDENCE_CAP, SOURCE_AUTHORITY[strongestSource(evidence)])
          : 0,
      subindustryEvidence: evidence,
      classificationSource: evidence.length > 0 ? strongestSource(evidence) : 'none',
      disqualifyingSignals: conflicting,
      verdictReason:
        evidence.length > 0
          ? 'conflicting_business_model_with_anchor'
          : 'excluded_business_model',
    });
  }

  // 4. Ancla limpia: evidencia positiva, trazable y sin modelo que la desmienta
  //    (casos A y E).
  if (evidence.length > 0) {
    const source = strongestSource(evidence);
    return assessment({
      ...base,
      subindustryMatch: 'confirmed',
      subindustryMatchFamily: resolveFamilyForEvidence(key, evidence),
      subindustryConfidence: SOURCE_AUTHORITY[source],
      subindustryEvidence: evidence,
      classificationSource: source,
      verdictReason: 'anchor_evidence_confirmed',
    });
  }

  // 5. Sólo industria amplia (caso D) o nada en absoluto: ambiguo. Sigue siendo
  //    el único estado que puede competir por un enrichment.
  return assessment({
    ...base,
    subindustryMatch: 'ambiguous',
    verdictReason:
      industryMatch === 'broad_compatible' ? 'broad_industry_only' : 'no_subindustry_evidence',
  });
}

// ─── § 2 · ANY-OF sobre las subindustrias pedidas ─────────────────────────────
//
// El defecto que cierra: el wizard permite hasta CINCO subindustrias y la
// búsqueda Apollo las consulta con semántica ANY-OF, pero la precisión sólo
// evaluaba `subindustries[0]`. Una empresa que demostraba la segunda, tercera,
// cuarta o quinta selección del usuario quedaba `ambiguous` —y fuera del
// objetivo— por una evidencia que nadie había mirado.

/**
 * Precedencia del ANY-OF: una confirmación gana a cualquier duda, y una duda
 * gana a un rechazo.
 *
 * `rejected` es el más débil a propósito: con semántica ANY-OF, que una de las
 * subindustrias pedidas quede descartada no dice nada sobre las demás. Sólo
 * cuando TODAS quedan rechazadas el candidato queda rechazado.
 */
const VERDICT_PRECEDENCE: Record<SubindustryMatchVerdict, number> = {
  confirmed: 3,
  ambiguous: 2,
  rejected: 1,
};

/**
 * Puntúa un veredicto para elegir el ganador del ANY-OF.
 *
 * El desempate por `subindustryMapped` sólo actúa entre dudas: ante
 * `[mapeada ambigua, sin mapeo]` gana la MAPEADA, porque su ambigüedad es un
 * hecho medido —hay catálogo y la evidencia no alcanzó— mientras «sin mapeo»
 * sólo dice que SellUp aún no sabe evaluarla. Reportar la segunda escondería que
 * la primera sí se evaluó.
 */
function verdictScore(assessment: ApolloSubindustryPrecisionAssessment): number {
  return VERDICT_PRECEDENCE[assessment.subindustryMatch] * 10 + (assessment.subindustryMapped ? 1 : 0);
}

/**
 * Etiquetas pedidas, saneadas: sin vacías, sin duplicados y en el orden pedido.
 *
 * La deduplicación compara en forma normalizada pero CONSERVA la etiqueta
 * original: es la que el usuario eligió y la que la ficha muestra.
 *
 * FINAL MULTI-SUBINDUSTRY SPEND-GATE ADDENDUM § 2 — se exporta para que los gates
 * de GASTO saneen la lista EXACTAMENTE igual que la precisión. Dos normalizadores
 * distintos podrían diferir en qué cuenta como duplicado, y entonces el conjunto
 * de subindustrias que decide si se paga dejaría de ser el que decide si cuenta.
 */
export function normalizeRequestedSubindustries(
  requested: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!Array.isArray(requested)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const entry of requested) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const key = normalize(trimmed);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }
  return labels;
}

/**
 * Evalúa la precisión de subindustria con semántica ANY-OF sobre TODAS las
 * subindustrias que la búsqueda pidió.
 *
 * Contrato (§ 2):
 *
 *   cualquiera confirmada            ⇒ `confirmed`; puede contar si el resto del
 *                                      contrato de completitud también pasa.
 *   ninguna confirmada, alguna duda  ⇒ `ambiguous` (o sin mapeo); NO cuenta.
 *   todas rechazadas                 ⇒ `rejected`; no se persiste.
 *   una rechazada y otra confirmada  ⇒ `confirmed` (gana el ANY-OF).
 *   una mapeada confirmada y otra
 *   sin mapeo                        ⇒ `confirmed`.
 *
 * Sin subindustrias pedidas el resultado es idéntico al de antes de este § —las
 * búsquedas SIN subindustria no cambian de comportamiento en ningún punto.
 *
 * Puro.
 */
export function assessApolloSubindustryPrecisionForRequest(
  result: WebSearchResult,
  requestedSubindustries: readonly (string | null | undefined)[] | null | undefined,
): ApolloSubindustryPrecisionAssessment {
  const requested = normalizeRequestedSubindustries(requestedSubindustries);

  if (requested.length === 0) {
    return assessSingleRequestedSubindustry(result, null);
  }

  const evaluated = requested.map((label) => ({
    label,
    assessment: assessSingleRequestedSubindustry(result, label),
  }));

  // Estable: sólo una puntuación ESTRICTAMENTE mayor desplaza al ganador, así
  // que ante empate manda el orden en que el usuario pidió las subindustrias.
  let winner = evaluated[0];
  for (const candidate of evaluated.slice(1)) {
    if (verdictScore(candidate.assessment) > verdictScore(winner.assessment)) winner = candidate;
  }

  return {
    ...winner.assessment,
    requestedSubindustries: requested,
    perRequestedSubindustryEvaluations: evaluated.map(({ label, assessment }) => ({
      requestedSubindustry: label,
      subindustryMapped: assessment.subindustryMapped,
      subindustryMatch: assessment.subindustryMatch,
      subindustryMatchFamily: assessment.subindustryMatchFamily,
      subindustryConfidence: assessment.subindustryConfidence,
      verdictReason: assessment.verdictReason,
    })),
    matchedRequestedSubindustry:
      winner.assessment.subindustryMatch === 'confirmed' ? winner.label : null,
  };
}

/**
 * Evalúa la precisión de subindustria de un candidato ya normalizado.
 *
 * Firma histórica de UNA subindustria, conservada porque es la que usan las
 * suites y los consumidores que sólo tienen una. Delega en el evaluador ANY-OF,
 * así que no existe una segunda implementación de la regla que pueda diverger.
 *
 * Sin subindustria pedida, o con una que no tiene catálogo de anclas, el
 * resultado es `ambiguous` con `subindustryMapped: false`. Es deliberado y es
 * fail-closed hacia el OBJETIVO —una subindustria sin política no confirma a
 * nadie— sin ser fail-closed hacia el gasto: el consumidor sigue pudiendo tratar
 * `subindustryMapped: false` como «esta búsqueda no pide precisión de
 * subindustria» y regirse por el gate sectorial de siempre.
 *
 * Puro.
 */
export function assessApolloSubindustryPrecision(
  result: WebSearchResult,
  subindustry: string | null | undefined,
): ApolloSubindustryPrecisionAssessment {
  return assessApolloSubindustryPrecisionForRequest(result, [subindustry]);
}

// ─── Proyección a metadata ────────────────────────────────────────────────────

/** Clave bajo la que la precisión de subindustria aterriza en el metadata. */
export const APOLLO_SUBINDUSTRY_PRECISION_METADATA_KEY = 'subindustry_precision' as const;

/** Máximo de piezas de evidencia que viajan a metadata. */
const MAX_PERSISTED_EVIDENCE = 8;

/**
 * Máximo de evaluaciones por subindustria que viajan a metadata.
 *
 * El wizard permite cinco; el techo es 8 para que una ampliación del wizard no
 * truncase en silencio antes de que nadie lo note. Si alguna vez se supera, el
 * conteo real sigue disponible en `requested_subindustries`, que NO se recorta.
 */
const MAX_PERSISTED_REQUESTED_EVALUATIONS = 8;

export function toApolloSubindustryPrecisionMetadata(
  input: ApolloSubindustryPrecisionAssessment,
): Record<string, unknown> {
  return {
    requested_subindustry: input.requestedSubindustry,
    // § 2 — las CINCO selecciones posibles, no sólo la que ganó el ANY-OF.
    requested_subindustries: input.requestedSubindustries,
    matched_requested_subindustry: input.matchedRequestedSubindustry,
    matched_subindustry_family: input.subindustryMatchFamily,
    per_requested_subindustry_evaluations: input.perRequestedSubindustryEvaluations
      .slice(0, MAX_PERSISTED_REQUESTED_EVALUATIONS)
      .map((item) => ({
        requested_subindustry: item.requestedSubindustry,
        subindustry_mapped: item.subindustryMapped,
        subindustry_match: item.subindustryMatch,
        subindustry_match_family: item.subindustryMatchFamily,
        subindustry_confidence: item.subindustryConfidence,
        verdict_reason: item.verdictReason,
      })),
    subindustry_mapped: input.subindustryMapped,
    industry_match: input.industryMatch,
    subindustry_match: input.subindustryMatch,
    subindustry_match_family: input.subindustryMatchFamily,
    subindustry_confidence: input.subindustryConfidence,
    subindustry_evidence: input.subindustryEvidence
      .slice(0, MAX_PERSISTED_EVIDENCE)
      .map((item) => ({ term: item.term, field: item.field, source: item.source })),
    classification_source: input.classificationSource,
    disqualifying_signals: input.disqualifyingSignals,
    verdict_reason: input.verdictReason,
  };
}
