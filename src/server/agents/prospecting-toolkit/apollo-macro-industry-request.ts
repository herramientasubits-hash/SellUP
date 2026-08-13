/**
 * apollo-macro-industry-request.ts — Contexto macro de UNA solicitud de
 * descubrimiento: qué taxonomía la gobierna, qué macro industria pidió, y con
 * qué consulta se redacta.
 *
 * AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 · §§ 8, 11, 13 y 18.
 *
 * ── Por qué existe una sola puerta ────────────────────────────────────────────
 *
 * Tres consumidores necesitan la misma respuesta y no pueden calcularla cada uno
 * por su cuenta sin arriesgarse a discrepar:
 *
 *   - el redactor de la consulta, para saber qué keywords viajan;
 *   - el proveedor, para declarar las precondiciones de bootstrap OBSERVADAS;
 *   - el runner, para elegir la vía de admisión posterior al enrichment.
 *
 * Si el redactor creyera que la corrida es macro y el proveedor que es legacy, la
 * consulta se redactaría con términos macro y las precondiciones se evaluarían
 * contra un catálogo de subindustrias vacío: gasto autorizado sobre una pregunta
 * que nadie validó. Una sola función resuelve el contexto y los tres la llaman.
 *
 * ── El bloqueo estructural que resuelve (§ 11) ────────────────────────────────
 *
 * La precondición `catalogTermsResolved` del bootstrap (#274) se calculaba como
 * `subindustryCatalogTerms != null`. Bajo el catálogo v2 no hay subindustrias, y
 * por tanto `subindustry_search_terms` está vacía y esa resolución es `null`:
 * TODA corrida macro habría quedado `catalog_terms_unresolved`, sin autorización
 * de bootstrap, sin enrichment y sin candidatos — el mismo deadlock que #274
 * cerró, reabierto por la puerta de al lado.
 *
 * Aquí la equivalencia es explícita: en modo macro, «los términos se resolvieron
 * contra el catálogo activo» significa que la macro industria pedida existe en el
 * catálogo de la versión declarada y produjo términos específicos. Ni más
 * permisivo ni más laxo: sigue siendo una comprobación, no una excepción.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import {
  buildMacroIndustryQueryPlan,
  type MacroIndustryQueryPlan,
} from './apollo-macro-industry-query-terms';
import {
  resolveDiscoveryTaxonomyCapability,
  type DiscoveryTaxonomyCapability,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import {
  resolveMacroIndustryByDisplayName,
  type MacroIndustryDefinition,
} from '@/modules/macro-industry-catalog/macro-industries';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Por qué una corrida en modo macro no pudo resolver su macro industria. */
export type MacroIndustryRequestBlockReason =
  | 'macro_industry_not_in_catalog'
  | 'no_specific_terms_for_macro_industry';

export type ApolloMacroIndustryRequestContext =
  | {
      /** La corrida NO va por la taxonomía macro. Todo lo demás sigue igual. */
      mode: 'industry_subindustry';
      capability: DiscoveryTaxonomyCapability;
    }
  | {
      mode: 'macro_industry';
      capability: DiscoveryTaxonomyCapability;
      definition: MacroIndustryDefinition;
      plan: MacroIndustryQueryPlan;
      blockReason: null;
    }
  | {
      /** Modo macro, pero la petición no se pudo resolver. Fail-closed. */
      mode: 'macro_industry';
      capability: DiscoveryTaxonomyCapability;
      definition: null;
      plan: null;
      blockReason: MacroIndustryRequestBlockReason;
    };

export type ResolveApolloMacroIndustryRequestInput = {
  /** Nombre canónico de la industria tal como el catálogo lo devolvió. */
  industry?: string | null;
  /** Versión del catálogo con la que se resolvió la selección. */
  selectionCatalogVersion?: string | null;
  /** § 19 — tokens del criterio adicional. Modifican la consulta, no la taxonomía. */
  additionalCriteriaTokens?: readonly string[] | null;
  /** Presupuesto de keywords. Inyectable para pruebas. */
  keywordBudget?: number;
};

/**
 * Resuelve el contexto macro de una solicitud.
 *
 * Devuelve `industry_subindustry` para toda corrida que no sea del catálogo
 * macro, incluidas las de versión desconocida: una versión que este código no
 * reconoce NUNCA activa la vía nueva (ver `discovery-taxonomy-capability`).
 */
export function resolveApolloMacroIndustryRequest(
  input: ResolveApolloMacroIndustryRequestInput,
): ApolloMacroIndustryRequestContext {
  const capability = resolveDiscoveryTaxonomyCapability(input.selectionCatalogVersion);

  if (capability.mode !== 'macro_industry') {
    return { mode: 'industry_subindustry', capability };
  }

  const definition = resolveMacroIndustryByDisplayName(input.industry);
  if (!definition) {
    return {
      mode: 'macro_industry',
      capability,
      definition: null,
      plan: null,
      blockReason: 'macro_industry_not_in_catalog',
    };
  }

  const plan = buildMacroIndustryQueryPlan({
    definition,
    additionalCriteriaTerms: input.additionalCriteriaTokens ?? [],
    catalogVersion: capability.catalogVersion ?? undefined,
    ...(input.keywordBudget !== undefined ? { keywordBudget: input.keywordBudget } : {}),
  });

  if (plan.coverage.coveringSpecificTerms.length === 0) {
    return {
      mode: 'macro_industry',
      capability,
      definition: null,
      plan: null,
      blockReason: 'no_specific_terms_for_macro_industry',
    };
  }

  return { mode: 'macro_industry', capability, definition, plan, blockReason: null };
}

// ─── Precondiciones de bootstrap en modo macro (§ 11) ─────────────────────────

/**
 * Las dos precondiciones de catálogo del bootstrap, calculadas para el modo
 * macro.
 *
 * `catalogTermsResolved`   La macro industria pedida existe en el catálogo de la
 *                          versión declarada Y produjo términos específicos. Es
 *                          la MISMA pregunta que en el modo legacy —«¿los
 *                          criterios salieron del catálogo activo?»— sobre el
 *                          catálogo que gobierna esta taxonomía.
 * `queryCoverageComplete`  La consulta EFECTIVA representa la macro industria
 *                          pedida con al menos un término específico y sin que
 *                          los amplios la dominen. Se mide sobre lo que viaja,
 *                          nunca sobre la hipótesis (misma disciplina que #274).
 */
export type MacroIndustryBootstrapPreconditions = {
  catalogTermsResolved: boolean;
  queryCoverageComplete: boolean;
};

export function macroIndustryBootstrapPreconditions(
  context: ApolloMacroIndustryRequestContext,
): MacroIndustryBootstrapPreconditions {
  if (context.mode !== 'macro_industry' || context.plan === null) {
    return { catalogTermsResolved: false, queryCoverageComplete: false };
  }
  return {
    catalogTermsResolved: true,
    queryCoverageComplete: context.plan.coverage.complete,
  };
}
