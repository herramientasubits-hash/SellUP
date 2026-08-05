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

export type ApolloSubindustryPrecisionAssessment = {
  /** Subindustria tal como se pidió. `null` cuando la búsqueda no declaró una. */
  requestedSubindustry: string | null;
  /** La subindustria pedida tiene catálogo de anclas propio. */
  subindustryMapped: boolean;
  industryMatch: IndustryMatchVerdict;
  subindustryMatch: SubindustryMatchVerdict;
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
};

/**
 * Modelos de negocio EXCLUYENTES: quien opera así no es de la subindustria
 * pedida, por muchos términos de categoría que comparta con ella.
 *
 * Un distribuidor mayorista de alimentos vende A supermercados y restaurantes;
 * su catálogo menciona los mismos productos y con frecuencia la misma palabra
 * `grocery`. Es el caso B del § 3 y su veredicto es `rejected`.
 */
const SUBINDUSTRY_EXCLUSIVE_BUSINESS_MODEL_TERMS: Record<string, string[]> = {
  'supermercados e hipermercados': [
    'wholesale distributor',
    'wholesale distribution',
    'food distributor',
    'food distribution',
    'foodservice distribution',
    'distribuidor mayorista',
    'distribucion mayorista',
    'distribuidor de alimentos',
    'distribucion de alimentos',
    'venta al por mayor',
    'b2b marketplace',
    'restaurant supply',
    'proveedor de restaurantes',
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
    'on-demand delivery',
    'domicilios',
    'aplicacion de domicilios',
    'marketplace',
    'ecommerce platform',
    'e-commerce platform',
    'quick commerce',
    'q-commerce',
    'dark store',
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

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Busca la clave de catálogo de una subindustria.
 *
 * Coincidencia bidireccional por inclusión, igual que el gate sectorial, para que
 * «Supermercados e Hipermercados (Colombia)» resuelva a la misma clave.
 */
function resolveSubindustryKey(subindustry: string | null | undefined): string | null {
  if (!subindustry?.trim()) return null;
  const normalized = normalize(subindustry);
  for (const key of Object.keys(SUBINDUSTRY_ANCHOR_TERMS)) {
    if (normalized.includes(key) || key.includes(normalized)) return key;
  }
  return null;
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
      if (!texts.some((text) => text.includes(anchor))) continue;
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
 */
function collectCommercialNameEvidence(
  title: unknown,
  anchors: readonly string[],
): SubindustryEvidenceItem[] {
  if (typeof title !== 'string') return [];
  const normalized = normalize(title);
  if (normalized === '') return [];
  const words = new Set(normalized.split(' '));

  return anchors
    .filter((anchor) =>
      anchor.includes(' ') ? normalized.includes(anchor) : words.has(anchor),
    )
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
  return terms.filter((term) => haystack.some((text) => text.includes(term)));
}

/** Clasifica la INDUSTRIA declarada. Lo contradictorio se comprueba primero. */
function classifyDeclaredIndustry(
  meta: Record<string, unknown>,
  key: string,
): IndustryMatchVerdict {
  const declared = DECLARED_INDUSTRY_FIELDS.flatMap((path) =>
    toNormalizedTexts(readPath(meta, path)),
  );
  if (declared.length === 0) return 'unknown';

  const contradictory = SUBINDUSTRY_CONTRADICTORY_INDUSTRY_TERMS[key] ?? [];
  if (contradictory.some((term) => declared.some((industry) => industry.includes(term)))) {
    return 'contradictory';
  }

  const anchors = SUBINDUSTRY_ANCHOR_TERMS[key] ?? [];
  if (anchors.some((anchor) => declared.some((industry) => industry.includes(anchor)))) {
    return 'confirmed';
  }

  const broad = SUBINDUSTRY_BROAD_INDUSTRY_TERMS[key] ?? [];
  if (broad.some((term) => declared.some((industry) => industry.includes(term)))) {
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
    subindustryMapped: false,
    industryMatch: 'unknown',
    subindustryConfidence: 0,
    subindustryEvidence: [],
    classificationSource: 'none',
    disqualifyingSignals: [],
    ...overrides,
  };
}

/**
 * Evalúa la precisión de subindustria de un candidato ya normalizado.
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

// ─── Proyección a metadata ────────────────────────────────────────────────────

/** Clave bajo la que la precisión de subindustria aterriza en el metadata. */
export const APOLLO_SUBINDUSTRY_PRECISION_METADATA_KEY = 'subindustry_precision' as const;

/** Máximo de piezas de evidencia que viajan a metadata. */
const MAX_PERSISTED_EVIDENCE = 8;

export function toApolloSubindustryPrecisionMetadata(
  input: ApolloSubindustryPrecisionAssessment,
): Record<string, unknown> {
  return {
    requested_subindustry: input.requestedSubindustry,
    subindustry_mapped: input.subindustryMapped,
    industry_match: input.industryMatch,
    subindustry_match: input.subindustryMatch,
    subindustry_confidence: input.subindustryConfidence,
    subindustry_evidence: input.subindustryEvidence
      .slice(0, MAX_PERSISTED_EVIDENCE)
      .map((item) => ({ term: item.term, field: item.field, source: item.source })),
    classification_source: input.classificationSource,
    disqualifying_signals: input.disqualifyingSignals,
    verdict_reason: input.verdictReason,
  };
}
