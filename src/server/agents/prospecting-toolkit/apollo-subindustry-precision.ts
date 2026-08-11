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
import {
  buildSubindustryPrecisionRuleSetRegistry,
  SUBINDUSTRY_PRECISION_RULE_SETS,
  type SubindustryMatchFamily,
  type SubindustryPrecisionMode,
  type SubindustryPrecisionRuleSet,
} from './apollo-subindustry-precision-rule-sets';

export type {
  SubindustryMatchFamily,
  SubindustryPrecisionMode,
  SubindustryPrecisionRuleSet,
};

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
 * COMPUESTA (varias familias bajo una sola etiqueta), qué familia produjo la
 * confirmación. `none` cuando el veredicto no es `confirmed`, o la subindustria
 * no distingue familias.
 *
 * Una familia confirmada basta: no se exige que una empresa cumpla las tres.
 *
 * PHASE 2B — el TIPO vive ahora junto al mapa que lo asigna
 * (`apollo-subindustry-precision-rule-sets.ts`) y se re-exporta arriba, para que
 * ningún consumidor histórico cambie de import.
 */

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

// ─── Catálogos de señales · PHASE 2B ─────────────────────────────────────────
//
// Los cinco catálogos de términos y el mapa de familias vivían aquí como seis
// `Record<string, string[]>` indexados por clave normalizada. Ahora son un
// `SubindustryPrecisionRuleSet` por subindustria, en
// `apollo-subindustry-precision-rule-sets.ts`. El vocabulario es el MISMO,
// término por término y en el mismo orden: PHASE 2B porta, no amplía.
//
// Lo que se queda en este archivo es la MÁQUINA —matcher por tokens, campos
// clasificadores, autoridad de fuentes, techo de confianza, precedencia del
// ANY-OF— porque es igual para toda subindustria. Un evaluador por subindustria
// (`evaluateApolloSupermarket`, `evaluateApolloBanking`…) es exactamente lo que
// esta separación existe para no necesitar.

/**
 * Registro efectivo, validado en el import.
 *
 * `buildSubindustryPrecisionRuleSetRegistry` LANZA ante identidad ambigua o ancla
 * sin familia (§ 14). Al hacerlo aquí, el fallo llega en el arranque del módulo
 * —cada suite, el typecheck y el build— y nunca en una corrida con crédito ya
 * reservado.
 */
const PRECISION_RULE_SETS = buildSubindustryPrecisionRuleSetRegistry(
  SUBINDUSTRY_PRECISION_RULE_SETS,
  normalizeSubindustryIdentity,
);

/** § 12 — las reglas de precisión vigentes, para auditoría y ratchets. */
export function listSubindustryPrecisionRuleSets(): readonly SubindustryPrecisionRuleSet[] {
  return PRECISION_RULE_SETS;
}

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
 * PHASE 2A § 10 · PHASE 2B § 7 — vista de IDENTIDAD del registro de reglas.
 *
 * El resolver exact/fail-closed de PHASE 2A consume esta forma, y ahora se DERIVA
 * de los rule-sets en vez de declararse aparte. Es la diferencia entre «dos
 * registros que hay que mantener sincronizados» y uno: una regla con anclas y sin
 * identidad sería inevaluable, y una con identidad y sin anclas sería una
 * subindustria «mapeada» incapaz de confirmar a nadie.
 *
 * § 8 — `explicitAliases` sale de `precisionAliases`, que hoy está VACÍO en las
 * dos reglas. Alias de CATÁLOGO ≠ alias de PRECISIÓN: los 127 alias publicados
 * viajan con un `catalog_version_id` que la precisión no recibe, y promoverlos por
 * conveniencia admitiría palabras genéricas de una pieza (`banco`, `bank`,
 * `fintech`) como identidad.
 */
function toIdentityRegistry(
  ruleSets: readonly SubindustryPrecisionRuleSet[],
): readonly SubindustryPrecisionIdentityEntry[] {
  return ruleSets.map((ruleSet) => ({
    key: ruleSet.key,
    canonicalName: ruleSet.canonicalName,
    subindustryId: ruleSet.subindustryId,
    explicitAliases: ruleSet.precisionAliases,
  }));
}

const SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY = toIdentityRegistry(PRECISION_RULE_SETS);

/** § 10 — las subindustrias con política de precisión, para auditoría y pruebas. */
export function listSubindustryPrecisionIdentityRegistry(): SubindustryPrecisionIdentityEntry[] {
  return SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY.map((entry) => ({
    ...entry,
    explicitAliases: [...entry.explicitAliases],
  }));
}

/**
 * Claves que las reglas de precisión declaran. Sólo lectura.
 *
 * Existe para que la suite pueda probar que el registro de identidad y las reglas
 * hablan del mismo conjunto de subindustrias, sin exponer los términos. Con los
 * rule-sets, esa igualdad es estructural —las dos vistas salen del mismo array—
 * pero el ratchet se conserva: es lo que fallaría si alguien volviera a declarar
 * las dos listas por separado.
 */
export function listSubindustryPrecisionAnchorKeys(): string[] {
  return PRECISION_RULE_SETS.map((ruleSet) => ruleSet.key);
}

/**
 * Regla de precisión de una subindustria, resuelta sólo por coincidencia EXACTA.
 *
 * PHASE 2A §§ 1, 2 y 9 — sustituye la contención bidireccional por substring
 * (`normalized.includes(key) || key.includes(normalized)`), que hacía que
 * `"super"`, `"moda"`, `"calzado"` y hasta las cadenas de una sola letra `"a"`,
 * `"e"`, `"s"`, `"o"` e `"y"` resolvieran a una subindustria real y heredaran su
 * catálogo de anclas, exclusiones y contradicciones —decisiones que deciden si un
 * candidato cuenta hacia el objetivo y si se persiste—. El ganador, además, lo
 * elegía el orden de `Object.keys`.
 *
 * Ahora: id exacto, canónico normalizado exacto, alias de precisión normalizado
 * exacto, o `null`. Sin fallback al sector padre, sin clave más cercana, sin
 * primera entrada del registro y sin mapping por defecto.
 *
 * PHASE 2B § 7 — el registro NO se itera aquí buscando parecidos. La resolución
 * sigue siendo la del § 2 de PHASE 2A; lo único que cambia es que devuelve la
 * regla completa en vez de su clave, para que el evaluador no tenga que volver a
 * indexar seis catálogos por separado.
 */
function resolveSubindustryRuleSet(
  subindustry: string | null | undefined,
  ruleSets: readonly SubindustryPrecisionRuleSet[],
  identityRegistry: readonly SubindustryPrecisionIdentityEntry[],
): SubindustryPrecisionRuleSet | null {
  const resolved = resolveSubindustryPrecisionIdentity(
    { label: subindustry ?? null },
    identityRegistry,
  );
  if (resolved === null) return null;
  return ruleSets.find((ruleSet) => ruleSet.key === resolved.key) ?? null;
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
  ruleSet: SubindustryPrecisionRuleSet,
): IndustryMatchVerdict {
  const declared = DECLARED_INDUSTRY_FIELDS.flatMap((path) =>
    toNormalizedTexts(readPath(meta, path)),
  );
  if (declared.length === 0) return 'unknown';

  if (
    ruleSet.contradictoryProviderIndustries.some((term) => someTextMatches(declared, term))
  ) {
    return 'contradictory';
  }

  // PHASE 2B § 3 — «provider industry matches» NO es una lista aparte: la
  // industria declarada se comprueba contra las MISMAS anclas. Duplicarlas en el
  // rule-set crearía dos verdades que podrían divergir al editar una sola.
  if (ruleSet.anchors.some((anchor) => someTextMatches(declared, anchor))) {
    return 'confirmed';
  }

  if (ruleSet.broadProviderIndustries.some((term) => someTextMatches(declared, term))) {
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
  ruleSet: SubindustryPrecisionRuleSet,
  evidence: readonly SubindustryEvidenceItem[],
): SubindustryMatchFamily {
  const families = ruleSet.anchorFamilies;
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
  ruleSets: readonly SubindustryPrecisionRuleSet[],
  identityRegistry: readonly SubindustryPrecisionIdentityEntry[],
): ApolloSubindustryPrecisionAssessment {
  const requestedSubindustry = subindustry?.trim() ? subindustry.trim() : null;
  const ruleSet = resolveSubindustryRuleSet(requestedSubindustry, ruleSets, identityRegistry);

  if (ruleSet === null) {
    return assessment({
      requestedSubindustry,
      subindustryMapped: false,
      subindustryMatch: 'ambiguous',
      verdictReason: 'subindustry_not_mapped',
    });
  }

  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const anchors = ruleSet.anchors;
  const industryMatch = classifyDeclaredIndustry(meta, ruleSet);

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
  const exclusive = collectBusinessModelSignals(meta, ruleSet.exclusiveBusinessModels);
  const conflicting = collectBusinessModelSignals(meta, ruleSet.conflictingBusinessModels);

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
      subindustryMatchFamily: resolveFamilyForEvidence(ruleSet, evidence),
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
function verdictScore(verdict: {
  subindustryMatch: SubindustryMatchVerdict;
  subindustryMapped: boolean;
}): number {
  return VERDICT_PRECEDENCE[verdict.subindustryMatch] * 10 + (verdict.subindustryMapped ? 1 : 0);
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
  options?: SubindustryPrecisionEvaluationOptions,
): ApolloSubindustryPrecisionAssessment {
  const ruleSets = options?.ruleSets ?? PRECISION_RULE_SETS;
  const identityRegistry =
    ruleSets === PRECISION_RULE_SETS
      ? SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY
      : toIdentityRegistry(ruleSets);
  const requested = normalizeRequestedSubindustries(requestedSubindustries);

  if (requested.length === 0) {
    return assessSingleRequestedSubindustry(result, null, ruleSets, identityRegistry);
  }

  const evaluated = requested.map((label) => ({
    label,
    assessment: assessSingleRequestedSubindustry(result, label, ruleSets, identityRegistry),
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
  options?: SubindustryPrecisionEvaluationOptions,
): ApolloSubindustryPrecisionAssessment {
  return assessApolloSubindustryPrecisionForRequest(result, [subindustry], options);
}

// ─── § 9 · modo de la regla y veredicto OPERATIVO ─────────────────────────────
//
// El defecto que este § previene, antes de que exista: hasta aquí el veredicto de
// precisión es UNO, y lo leen dos consumidores que deciden dinero —el pliegue
// sectorial del runner (`foldSubindustryPrecisionIntoSectorState`) y el contrato de
// completitud (`resolveCandidateSubindustryRequirement`)—. Añadir una subindustria
// nueva con reglas sin calibrar significaría, hoy, que sus ramas NEGATIVAS
// (`ambiguous`, `rejected`) empiezan a mover el estado sectorial, a convocar
// enrichments y a impedir persistencias desde el primer despliegue.
//
// `confirm_only` separa esas dos lecturas: el veredicto DIAGNÓSTICO conserva las
// tres ramas —es lo que la ficha muestra y lo que la calibración necesita leer— y
// el veredicto OPERATIVO admite sólo la rama positiva. Una regla nueva puede así
// aportar evidencia sin poder perjudicar.
//
// Ninguna regla de producción usa `confirm_only` todavía (§ 9). Con las dos reglas
// vigentes en `full`, el veredicto operativo es IDÉNTICO al diagnóstico, término
// por término, y el ratchet de la suite lo comprueba sobre toda la matriz.

/** § 18 — inyección del registro. Producción lo omite; las pruebas de Phase 2C no. */
export type SubindustryPrecisionEvaluationOptions = {
  /**
   * Reglas con las que evaluar. Por defecto, las de producción.
   *
   * Existe para que una regla NUEVA —incluida una `confirm_only`— pueda probarse de
   * extremo a extremo sin registrarse en producción y sin tocar el evaluador, que
   * es la condición del § 18.
   */
  ruleSets?: readonly SubindustryPrecisionRuleSet[];
};

/**
 * Veredicto OPERATIVO: lo único que un consumidor con efecto económico puede leer.
 *
 * `precisionMode` es DIAGNÓSTICO y sólo diagnóstico: nombra el modo de la regla que
 * produjo la contribución GANADORA —o `null` cuando ninguna contribuyó—, y ante
 * empate lo decide el orden en que el usuario pidió las subindustrias. NO es el modo
 * agregado de la evaluación, y por eso ningún consumidor económico puede leerlo:
 * hacerlo ataría una decisión de dinero a ese desempate. Los dos campos que SÍ
 * deciden —`subindustryMapped` y `subindustryMatch`— son invariantes al orden.
 * El ratchet de la suite comprueba que nadie fuera de este módulo lo lee.
 */
export type OperationalSubindustryVerdict = {
  subindustryMapped: boolean;
  subindustryMatch: SubindustryMatchVerdict;
  precisionMode: SubindustryPrecisionMode | null;
};

/**
 * Sin contribución operativa.
 *
 * Es exactamente la forma que el módulo ya usaba para «subindustria sin política»
 * (`subindustryMapped: false`, `subindustryMatch: 'ambiguous'`), y por eso el
 * pliegue la trata como identidad y el contrato de completitud la reporta como
 * `unmapped`: el comportamiento base/fail-closed existente, sin rama nueva.
 */
const NO_OPERATIONAL_CONTRIBUTION: OperationalSubindustryVerdict = {
  subindustryMapped: false,
  subindustryMatch: 'ambiguous',
  precisionMode: null,
};

/**
 * Proyección de UNA evaluación al plano operativo, según el modo de su regla.
 *
 * `null` significa ABSTENCIÓN: esta subindustria no participa en el ANY-OF
 * operativo. Es distinto de `NO_OPERATIONAL_CONTRIBUTION`, y la diferencia decide
 * dinero — ver el § de abajo.
 */
function projectOneOperationalVerdict(
  evaluation: { subindustryMapped: boolean; subindustryMatch: SubindustryMatchVerdict },
  mode: SubindustryPrecisionMode | null,
): OperationalSubindustryVerdict | null {
  if (!evaluation.subindustryMapped || mode === null) return NO_OPERATIONAL_CONTRIBUTION;
  if (mode === 'full') {
    return {
      subindustryMapped: true,
      subindustryMatch: evaluation.subindustryMatch,
      precisionMode: 'full',
    };
  }
  // `confirm_only`: sólo la rama positiva cruza al plano operativo. `ambiguous` y
  // `rejected` no se convierten en otra cosa —siguen siendo el diagnóstico— y
  // ABSTIENEN a la regla en vez de hacerla contribuir con un veredicto neutro.
  //
  // MIXED-MODE ANY-OF FINAL PREFLIGHT § 7 — el defecto que esta distinción cierra.
  // Antes, la rama negativa devolvía `NO_OPERATIONAL_CONTRIBUTION`, que es un
  // participante REAL del ANY-OF: «sin mapeo, ambigua», y por precedencia una duda
  // sin mapeo (20) le gana a un rechazo mapeado (11). Efecto medido: una regla
  // `full` que rechazaba —`sector_evidence_contradictory`, o sea rechazo definitivo
  // y candidato no persistido— pasaba a `sector_evidence_confirmed` en cuanto se
  // pedía junto a una `confirm_only` cuyo veredicto era `ambiguous`. Es decir, la
  // rama NEGATIVA de una regla sin calibrar movía la economía de la corrida, que es
  // exactamente lo que `confirm_only` existe para impedir (§ 9).
  //
  // «Sin mapeo» sí participa, y debe seguir haciéndolo: que SellUp no sepa evaluar
  // una subindustria pedida es un hecho sobre la petición, y rescatar del rechazo
  // ANY-OF es el comportamiento histórico de las reglas `full`. Abstenerse es otra
  // cosa: la regla existe, midió, y su medición no está autorizada a decidir.
  return evaluation.subindustryMatch === 'confirmed'
    ? { subindustryMapped: true, subindustryMatch: 'confirmed', precisionMode: 'confirm_only' }
    : null;
}

/**
 * Veredicto OPERATIVO de un assessment, con semántica ANY-OF.
 *
 * Usa la MISMA máquina de precedencia que el veredicto diagnóstico
 * (`verdictScore`): una confirmación gana a cualquier duda, una duda gana a un
 * rechazo, y sólo una puntuación estrictamente mayor desplaza al ganador —así que
 * el orden en que el usuario pidió las subindustrias no decide el veredicto, sólo
 * rompe empates igual que antes—.
 *
 * Cuando el assessment no trae evaluaciones por subindustria —un candidato
 * restaurado de un checkpoint antiguo, o una fixture sintética— se proyecta el
 * agregado. Y si una etiqueta MAPEADA no resuelve en el registro recibido, el modo
 * se asume `full`: es el más estricto de los dos, y es el comportamiento histórico.
 * Suponer `confirm_only` ahí sería desactivar rechazos que hoy sí aplican.
 *
 * Puro.
 */
export function projectOperationalSubindustryVerdict(
  assessment: ApolloSubindustryPrecisionAssessment,
  options?: SubindustryPrecisionEvaluationOptions,
): OperationalSubindustryVerdict {
  const ruleSets = options?.ruleSets ?? PRECISION_RULE_SETS;
  const identityRegistry =
    ruleSets === PRECISION_RULE_SETS
      ? SUBINDUSTRY_PRECISION_IDENTITY_REGISTRY
      : toIdentityRegistry(ruleSets);

  const evaluations =
    assessment.perRequestedSubindustryEvaluations.length > 0
      ? assessment.perRequestedSubindustryEvaluations.map((evaluation) => ({
          label: evaluation.requestedSubindustry,
          subindustryMapped: evaluation.subindustryMapped,
          subindustryMatch: evaluation.subindustryMatch,
        }))
      : [
          {
            label: assessment.requestedSubindustry,
            subindustryMapped: assessment.subindustryMapped,
            subindustryMatch: assessment.subindustryMatch,
          },
        ];

  let winner: OperationalSubindustryVerdict | null = null;
  for (const evaluation of evaluations) {
    const mode = evaluation.subindustryMapped
      ? (resolveSubindustryRuleSet(evaluation.label, ruleSets, identityRegistry)?.mode ?? 'full')
      : null;
    const projected = projectOneOperationalVerdict(evaluation, mode);
    // Abstención: la regla no entra en la agregación. Saltarla —en vez de dejarla
    // competir con un veredicto neutro— es lo que garantiza que una `confirm_only`
    // negativa deje el resultado EXACTAMENTE como estaría sin ella (§ 7).
    if (projected === null) continue;
    if (winner === null || verdictScore(projected) > verdictScore(winner)) winner = projected;
  }

  // Todas se abstuvieron (o no había ninguna): comportamiento base/fail-closed de
  // siempre. Ninguna rama nueva.
  return winner ?? NO_OPERATIONAL_CONTRIBUTION;
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
