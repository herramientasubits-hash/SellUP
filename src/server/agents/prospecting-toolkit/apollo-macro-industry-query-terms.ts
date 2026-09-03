/**
 * apollo-macro-industry-query-terms.ts — Redacción de la consulta para UNA macro
 * industria, con control de amplitud.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 14, 15, 16, 18, 19 y 23.
 *
 * ── El defecto que este módulo cierra ─────────────────────────────────────────
 *
 * Retest de Salud, lote `74a49b01` (2026-08-12): la corrida cambió una keyword
 * respecto de RUN 1 y Apollo devolvió **las mismas 20 empresas**. La causa no fue
 * el proveedor: la consulta era un OR plano donde `health` y `healthcare`
 * convivían con los términos específicos. Un OR plano no pondera — coincide con
 * la unión —, y como los términos amplios coinciden con órdenes de magnitud más
 * empresas, el conjunto devuelto lo determinan ellos. Los específicos eran
 * INERTES: estaban en el body y no movían el resultado.
 *
 * La regla del § 15, implementada aquí:
 *
 *   **Los términos amplios no pueden dominar la hipótesis.** Viajan DESPUÉS de
 *   los específicos, racionados por un tope duro, y sólo cuando ya viaja un
 *   mínimo de términos específicos que puedan discriminar.
 *
 * No es una heurística de relevancia: es una restricción sobre lo que se le
 * pregunta al proveedor, verificable sin llamarlo (§ 23).
 *
 * ── Exclusiones ──────────────────────────────────────────────────────────────
 *
 * Nunca viajan. `mixed_companies/search` no ofrece exclusión de keywords, así que
 * enviarlas buscaría exactamente lo que excluyen. Se devuelven en el plan para
 * que el gate de evidencia y el de gasto las apliquen localmente antes de pagar.
 *
 * ── Una macro industria por corrida (§ 18) ────────────────────────────────────
 *
 * Esta función recibe UNA definición, no una lista. No hay unión, no hay ANY-OF,
 * no hay reparto round-robin entre industrias: el contrato de producto es
 * exactamente una, y el tipo lo refleja.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import { createHash } from 'node:crypto';
import { APOLLO_MAX_FILTER_VALUES } from './apollo-organizations-request-contract';
import { apolloKeywordDedupeKey, normalizeApolloTermKey } from './apollo-subindustry-query-terms';
import {
  MACRO_INDUSTRY_CATALOG_VERSION,
  macroIndustryQueryFamilyKeys,
  resolveMacroIndustryQueryFamily,
  type MacroIndustryDefinition,
} from '@/modules/macro-industry-catalog/macro-industries';

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_MACRO_INDUSTRY_QUERY_VERSION = 'v1.MIQ-1';

// ─── Control de amplitud (§ 15) ───────────────────────────────────────────────

/**
 * Cuántos términos amplios pueden viajar como MÁXIMO, pase lo que pase.
 *
 * Dos. Con el presupuesto de 25 valores de Apollo, dos amplios son ~8% de la
 * consulta y no pueden decidir el conjunto devuelto; con cinco ya lo decidían.
 * Es un tope, no una cuota: si no caben, viajan menos.
 */
export const MACRO_QUERY_MAX_BROAD_TERMS = 2;

/**
 * Cuántos términos específicos deben viajar ANTES de admitir uno solo amplio.
 *
 * Por debajo de este umbral la hipótesis no tiene con qué discriminar, y añadir
 * amplios convertiría una consulta pobre en una consulta genérica —peor, porque
 * devuelve resultados plausibles que nadie puede filtrar—. Fail-closed hacia la
 * precisión: sin específicos suficientes se prefiere una consulta estrecha.
 */
export const MACRO_QUERY_MIN_SPECIFIC_FOR_BROAD = 4;

/** Fracción máxima del presupuesto que los amplios pueden ocupar. */
export const MACRO_QUERY_MAX_BROAD_SHARE = 0.25;

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Por qué un término amplio no viajó. Código estático. */
export type MacroBroadTermWithheldReason =
  | 'broad_term_cap_reached'
  | 'insufficient_specific_terms'
  | 'keyword_budget_exhausted'
  /**
   * V3-A § 2 — la variante pedida NO es la primera familia, y una familia
   * posterior viaja sola.
   *
   * No es una limitación de presupuesto ni de cuota: es la regla de la variante.
   * Una familia posterior existe para preguntar por un dominio ESTRECHO que el OR
   * completo de la macro industria no dejaba ver; añadirle un amplio la devolvería
   * al conjunto genérico del que existe para salir.
   */
  | 'variant_family_excludes_broad';

export type MacroIndustryQueryPlan = {
  version: typeof APOLLO_MACRO_INDUSTRY_QUERY_VERSION;
  catalogVersion: string;
  macroIndustryKey: string;
  macroIndustryDisplayName: string;

  /** Todos los términos específicos del catálogo, saneados y deduplicados. */
  specificTerms: string[];
  /** Todos los amplios del catálogo, saneados y deduplicados. */
  broadTerms: string[];
  /** Exclusiones locales. NUNCA viajan al proveedor. */
  exclusionTerms: string[];

  /** Lo que efectivamente viaja, en orden: específicos y después amplios. */
  effectiveKeywords: string[];
  /** Los amplios que sí entraron. Subconjunto de `effectiveKeywords`. */
  admittedBroadTerms: string[];
  /** Los que no entraron, con su motivo. */
  withheldBroadTerms: Array<{ term: string; reason: MacroBroadTermWithheldReason }>;

  /** Cuántos valores admite el filtro de keywords de Apollo en esta corrida. */
  keywordBudget: number;
  /** Cuántos amplios podían entrar como máximo, ya resuelto el tope y la cuota. */
  broadTermAllowance: number;

  /**
   * V3-A § 2 — familia semántica que ESTA redacción emitió, o `null` cuando la
   * consulta se redactó con el conjunto completo de `specific`.
   *
   * `null` cubre tres casos deliberadamente distinguibles por
   * `macroQueryFamiliesAvailable`: la macro industria no declara familias (lista
   * vacía), no se pidió variante, o se pidió una clave que no le pertenece. En
   * los tres el plan es el de siempre, byte por byte.
   */
  macroQueryVariantKey: string | null;
  /** Posición de la variante emitida. `null` sin variante. `0` es la primera. */
  macroQueryVariantIndex: number | null;
  /** Claves de familia que esta macro industria declara, en orden de emisión. */
  macroQueryFamiliesAvailable: string[];

  coverage: MacroIndustryQueryCoverage;
  /** Digest determinista del plan. Dos macro industrias distintas no colisionan. */
  fingerprint: string;
};

/**
 * Cobertura de la consulta EFECTIVA sobre la macro industria pedida.
 *
 * Es el análogo macro de `ApolloSubindustryQueryCoverage`, y alimenta la misma
 * precondición de bootstrap (`queryCoverageComplete`): una consulta que no
 * representa lo que el usuario pidió no puede autorizar gasto.
 */
export type MacroIndustryQueryCoverage = {
  macroIndustryKey: string;
  /** Términos específicos que efectivamente viajaron. */
  coveringSpecificTerms: string[];
  specificTermCount: number;
  /** `específicos que viajaron / específicos del catálogo`. */
  specificCoverageRatio: number;
  /** Proporción de la consulta ocupada por términos amplios. */
  broadTermShare: number;
  /**
   * `true` cuando al menos un término específico viaja Y los amplios no dominan.
   * `false` bloquea el gasto aguas arriba: la pregunta emitida no es la del
   * usuario, o es demasiado genérica para que su respuesta signifique algo.
   */
  complete: boolean;
  /** Por qué NO está completa. `null` cuando lo está. */
  incompleteReason: 'no_specific_terms_travelled' | 'broad_terms_dominate' | null;
};

// ─── Saneamiento ──────────────────────────────────────────────────────────────

function sanitizeTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term?.trim();
    if (!trimmed) continue;
    const key = apolloKeywordDedupeKey(trimmed);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(normalizeApolloTermKey(trimmed));
  }
  return out;
}

// ─── Redacción ────────────────────────────────────────────────────────────────

export type BuildMacroIndustryQueryPlanInput = {
  definition: MacroIndustryDefinition;
  /**
   * Presupuesto de valores del filtro de keywords. Por defecto el máximo que el
   * contrato del proveedor admite. Se inyecta para que las pruebas puedan
   * ejercitar presupuestos estrechos sin tocar el contrato.
   */
  keywordBudget?: number;
  /**
   * § 19 — términos derivados del criterio adicional del usuario.
   *
   * Viajan al FINAL, después de específicos y amplios, y **no cuentan como
   * cobertura**: el criterio adicional puede modificar la consulta pero no
   * confirma la macro industria (§ 19). Deliberadamente no entran en la cubeta
   * de específicos: si lo hicieran, escribir «hospital» en el campo libre de una
   * búsqueda de Retail haría que la consulta pareciera cubierta.
   */
  additionalCriteriaTerms?: readonly string[];
  /** Versión del catálogo que gobierna. Por defecto la del catálogo macro. */
  catalogVersion?: string;
  /**
   * V3-A § 2 — familia semántica a emitir.
   *
   * Ausente, `null` o desconocida ⇒ el plan se redacta con TODOS los `specific`,
   * exactamente como antes de este hito. La variante no se adivina: una clave que
   * la macro industria no declara no puede estrechar la consulta en silencio.
   */
  variantKey?: string | null;
};

/**
 * Construye el plan de consulta de una macro industria.
 *
 * Determinista: la misma definición y el mismo presupuesto producen el mismo
 * plan y la misma huella, sin reloj ni entorno. Es lo que permite comparar
 * hipótesis offline (§ 23).
 */
export function buildMacroIndustryQueryPlan(
  input: BuildMacroIndustryQueryPlanInput,
): MacroIndustryQueryPlan {
  const { definition } = input;
  const catalogVersion = input.catalogVersion ?? MACRO_INDUSTRY_CATALOG_VERSION;
  const keywordBudget = Math.max(
    0,
    Math.floor(input.keywordBudget ?? APOLLO_MAX_FILTER_VALUES),
  );

  /**
   * V3-A § 2 — la variante decide QUÉ cubeta de específicos redacta la consulta.
   *
   * Sin variante resuelta, `specificTerms` es la lista completa del catálogo y
   * todo lo que sigue es idéntico al comportamiento anterior al hito: los mismos
   * keywords, en el mismo orden, con la misma huella.
   */
  const macroQueryFamiliesAvailable = macroIndustryQueryFamilyKeys(definition);
  const resolvedFamily = resolveMacroIndustryQueryFamily(definition, input.variantKey);
  const macroQueryVariantKey = resolvedFamily?.family.key ?? null;
  const macroQueryVariantIndex = resolvedFamily?.index ?? null;
  /**
   * Sólo la PRIMERA familia lleva amplios. Es la que hereda el racionamiento
   * calibrado del § 15; las posteriores viajan solas por diseño.
   */
  const variantExcludesBroad = macroQueryVariantIndex !== null && macroQueryVariantIndex > 0;

  const specificTerms = sanitizeTerms(
    resolvedFamily ? resolvedFamily.family.terms : definition.discovery.specific,
  );
  const broadTerms = sanitizeTerms(definition.discovery.broad);
  const exclusionTerms = sanitizeTerms(definition.discovery.exclusions);
  const additionalTerms = sanitizeTerms(input.additionalCriteriaTerms ?? []);

  // 1. Los específicos primero y sin ración: son los que discriminan.
  const effectiveKeywords: string[] = [];
  const usedKeys = new Set<string>();
  const push = (term: string): boolean => {
    if (effectiveKeywords.length >= keywordBudget) return false;
    const key = apolloKeywordDedupeKey(term);
    if (usedKeys.has(key)) return false;
    usedKeys.add(key);
    effectiveKeywords.push(term);
    return true;
  };

  const coveringSpecificTerms: string[] = [];
  for (const term of specificTerms) {
    if (push(term)) coveringSpecificTerms.push(term);
  }

  // 2. Los amplios, sólo si hay con qué discriminar y dentro del tope.
  //
  //    El tope es el MENOR de: la constante dura, la cuota proporcional del
  //    presupuesto, y lo que quede libre. Tomar el mínimo —y no el máximo— es lo
  //    que impide que un presupuesto generoso reabra el modo de fallo.
  const proportionalAllowance = Math.floor(keywordBudget * MACRO_QUERY_MAX_BROAD_SHARE);
  const hasEnoughSpecific = coveringSpecificTerms.length >= MACRO_QUERY_MIN_SPECIFIC_FOR_BROAD;
  /**
   * V3-A § 2 — cuota medida sobre lo que la VARIANTE emite, no sobre el
   * presupuesto.
   *
   * `proportionalAllowance` raciona contra `keywordBudget` (25), que es el techo
   * del filtro y no lo que va a viajar. Con el catálogo completo la diferencia no
   * importaba: 2 amplios sobre 16 términos son el 12,5%. Con una familia de cinco
   * específicos, esos mismos 2 amplios son el 28,6% — por encima de
   * `MACRO_QUERY_MAX_BROAD_SHARE`, así que la cobertura salía `broad_terms_dominate`
   * y la precondición de bootstrap bloqueaba el gasto de la variante entera.
   *
   * La cota es la que despeja la propia definición de la cuota:
   *
   *     b / (s + b) <= SHARE   ⇔   b <= s · SHARE / (1 - SHARE)
   *
   * Con SHARE = 0,25 eso es `floor(s / 3)`. Se aplica SÓLO cuando hay variante
   * resuelta: sin ella el plan tiene que ser byte por byte el de antes del hito,
   * y una tercera cota podría recortar amplios en definiciones sintéticas con
   * pocos específicos.
   */
  const shareBoundedAllowance =
    resolvedFamily === null
      ? Number.POSITIVE_INFINITY
      : Math.floor(
          (coveringSpecificTerms.length * MACRO_QUERY_MAX_BROAD_SHARE) /
            (1 - MACRO_QUERY_MAX_BROAD_SHARE),
        );
  const broadTermAllowance =
    hasEnoughSpecific && !variantExcludesBroad
      ? Math.max(
          0,
          Math.min(MACRO_QUERY_MAX_BROAD_TERMS, proportionalAllowance, shareBoundedAllowance),
        )
      : 0;

  const admittedBroadTerms: string[] = [];
  const withheldBroadTerms: Array<{ term: string; reason: MacroBroadTermWithheldReason }> = [];

  for (const term of broadTerms) {
    // V3-A — la regla de la variante se evalúa ANTES que el recuento de
    // específicos: el motivo publicado tiene que nombrar la causa REAL, y una
    // familia posterior no lleva amplios aunque tenga específicos de sobra.
    if (variantExcludesBroad) {
      withheldBroadTerms.push({ term, reason: 'variant_family_excludes_broad' });
      continue;
    }
    if (!hasEnoughSpecific) {
      withheldBroadTerms.push({ term, reason: 'insufficient_specific_terms' });
      continue;
    }
    if (admittedBroadTerms.length >= broadTermAllowance) {
      withheldBroadTerms.push({ term, reason: 'broad_term_cap_reached' });
      continue;
    }
    if (!push(term)) {
      withheldBroadTerms.push({ term, reason: 'keyword_budget_exhausted' });
      continue;
    }
    admittedBroadTerms.push(term);
  }

  // 3. § 19 — el criterio adicional va al final y no cuenta como cobertura.
  for (const term of additionalTerms) push(term);

  const broadTermShare =
    effectiveKeywords.length === 0 ? 0 : admittedBroadTerms.length / effectiveKeywords.length;

  const coverage: MacroIndustryQueryCoverage = {
    macroIndustryKey: definition.key,
    coveringSpecificTerms,
    specificTermCount: coveringSpecificTerms.length,
    specificCoverageRatio:
      specificTerms.length === 0 ? 0 : coveringSpecificTerms.length / specificTerms.length,
    broadTermShare,
    complete: coveringSpecificTerms.length > 0 && broadTermShare <= MACRO_QUERY_MAX_BROAD_SHARE,
    incompleteReason:
      coveringSpecificTerms.length === 0
        ? 'no_specific_terms_travelled'
        : broadTermShare > MACRO_QUERY_MAX_BROAD_SHARE
          ? 'broad_terms_dominate'
          : null,
  };

  return {
    version: APOLLO_MACRO_INDUSTRY_QUERY_VERSION,
    catalogVersion,
    macroIndustryKey: definition.key,
    macroIndustryDisplayName: definition.displayName,
    specificTerms,
    broadTerms,
    exclusionTerms,
    effectiveKeywords,
    admittedBroadTerms,
    withheldBroadTerms,
    keywordBudget,
    broadTermAllowance,
    macroQueryVariantKey,
    macroQueryVariantIndex,
    macroQueryFamiliesAvailable,
    coverage,
    fingerprint: fingerprintMacroIndustryQueryPlan({
      catalogVersion,
      macroIndustryKey: definition.key,
      effectiveKeywords,
      exclusionTerms,
    }),
  };
}

/**
 * Cobertura macro medida contra los keywords que EFECTIVAMENTE viajaron.
 *
 * El plan describe lo que el redactor quiso enviar; el contrato del proveedor
 * deduplica y trunca por su cuenta (`APOLLO_MAX_FILTER_VALUES`). La única medida
 * que describe lo que Apollo va a recibir es ésta, y es la que gobierna el gasto
 * — misma disciplina que la cobertura de subindustria del addendum de catálogo.
 *
 * Puro.
 */
export function computeMacroIndustryQueryCoverage(input: {
  definition: MacroIndustryDefinition;
  effectiveKeywords: readonly string[];
}): MacroIndustryQueryCoverage {
  const specificTerms = sanitizeTerms(input.definition.discovery.specific);
  const broadTerms = sanitizeTerms(input.definition.discovery.broad);

  const effectiveKeys = new Set(
    input.effectiveKeywords
      .map((keyword) => apolloKeywordDedupeKey(keyword?.trim() ?? ''))
      .filter((key) => key !== ''),
  );

  const coveringSpecificTerms = specificTerms.filter((term) =>
    effectiveKeys.has(apolloKeywordDedupeKey(term)),
  );
  const travellingBroadTerms = broadTerms.filter((term) =>
    effectiveKeys.has(apolloKeywordDedupeKey(term)),
  );

  const total = effectiveKeys.size;
  const broadTermShare = total === 0 ? 0 : travellingBroadTerms.length / total;

  return {
    macroIndustryKey: input.definition.key,
    coveringSpecificTerms,
    specificTermCount: coveringSpecificTerms.length,
    specificCoverageRatio:
      specificTerms.length === 0 ? 0 : coveringSpecificTerms.length / specificTerms.length,
    broadTermShare,
    complete: coveringSpecificTerms.length > 0 && broadTermShare <= MACRO_QUERY_MAX_BROAD_SHARE,
    incompleteReason:
      coveringSpecificTerms.length === 0
        ? 'no_specific_terms_travelled'
        : broadTermShare > MACRO_QUERY_MAX_BROAD_SHARE
          ? 'broad_terms_dominate'
          : null,
  };
}

/**
 * Huella determinista del plan.
 *
 * Cubre la versión del catálogo, la clave canónica, los términos que VIAJAN en
 * su orden real y las exclusiones. Dos macro industrias con hipótesis
 * materialmente distintas no pueden compartir huella; una misma macro industria
 * redactada dos veces siempre produce la misma (§ 23).
 */
export function fingerprintMacroIndustryQueryPlan(input: {
  catalogVersion: string;
  macroIndustryKey: string;
  effectiveKeywords: readonly string[];
  exclusionTerms: readonly string[];
}): string {
  const canonical = [
    input.catalogVersion,
    input.macroIndustryKey,
    input.effectiveKeywords.join('|'),
    [...input.exclusionTerms].sort().join('|'),
  ].join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ─── Proyección a metadata ────────────────────────────────────────────────────

/** Bloque plano y sin PII con lo que gobernó la consulta macro. */
export function toMacroIndustryQueryMetadata(
  plan: MacroIndustryQueryPlan,
): Record<string, unknown> {
  return {
    macro_industry_query_version: plan.version,
    macro_industry_key: plan.macroIndustryKey,
    macro_industry_catalog_version: plan.catalogVersion,
    macro_industry_effective_keywords: plan.effectiveKeywords,
    macro_industry_specific_terms_travelled: plan.coverage.coveringSpecificTerms,
    macro_industry_broad_terms_admitted: plan.admittedBroadTerms,
    macro_industry_broad_terms_withheld: plan.withheldBroadTerms,
    macro_industry_broad_term_share: plan.coverage.broadTermShare,
    macro_industry_query_coverage_complete: plan.coverage.complete,
    macro_industry_query_incomplete_reason: plan.coverage.incompleteReason,
    macro_industry_query_fingerprint: plan.fingerprint,
    // V3-A § 5 — la observabilidad tiene que distinguir «no había familias» de
    // «se emitió F1» y de «se emitió F2». Dos campos, no uno: sin la lista de
    // disponibles, un `null` no dice si la macro industria está migrada.
    macro_query_variant_key: plan.macroQueryVariantKey,
    macro_query_families_available: plan.macroQueryFamiliesAvailable,
    // Las exclusiones se declaran para auditoría, y se declara que NO viajaron.
    macro_industry_local_exclusion_terms: plan.exclusionTerms,
    macro_industry_exclusions_sent_to_provider: false,
  };
}
