/**
 * lusha-run-liability.ts — cuánto puede gastar, COMO MÁXIMO, una corrida de
 * descubrimiento de empresas con Lusha.
 *
 * AGENT1-LUSHA-BUDGET-GATE-1 § 4/§ 5.
 *
 * Por qué existe: la reserva atómica de presupuesto de Agente 1 necesita UN
 * número antes de que el proveedor exista. Apollo ya tiene el suyo
 * (`apollo-operation-pricing` → `wizard-budget-estimate`); Lusha no tenía
 * ninguno, así que su ruta llegaba al proveedor sin haber reservado nada.
 *
 * Dos cosas que este módulo NO hace, a propósito:
 *
 *   1. NO copia el modelo de costo de Apollo. Apollo cobra por resultado
 *      (1 crédito × queries × results) y además puede gastar enrichment; Lusha
 *      V3 company prospecting cobra por PETICIÓN, y esta ruta no tiene ninguna
 *      pierna de enrichment de proveedor (los resolvers oficiales leen `co_siis`,
 *      una tabla interna: 0 créditos). Reservar el techo de Apollo aquí
 *      bloquearía corridas que caben de sobra.
 *   2. NO inventa el techo. Los dos factores se IMPORTAN de las constantes que
 *      el runtime ya obedece —`LUSHA_PENDING_REVIEW_MAX_PAGES` (el `for` que
 *      pagina) y `LUSHA_PREVIEW_EXPECTED_MAX_CREDITS` (el techo por petición que
 *      el core de preview declara)— de modo que subir el número de páginas sube
 *      la reserva en el mismo commit. `assertLushaRunLiabilityCoherent` deja
 *      constancia de que el producto sigue coincidiendo con el techo que el
 *      writer ya publicaba.
 *
 * El coste en USD sale de `provider_pricing_config` (migración 081, unidad
 * `per_credit`), nunca de la observación «1 crédito por 25 resultados»: esa
 * medición del microbenchmark describe UNA respuesta, no el contrato.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB.
 */

import { LUSHA_PREVIEW_EXPECTED_MAX_CREDITS } from './lusha-preview';
import {
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
} from './lusha-pending-review';
import type { LushaCompanyProspectingPricingConfig } from '@/server/integrations/lusha-company-prospecting-billing';
import type { LushaMacroSearchPlan } from './lusha-macro-search-plan';

/**
 * Desglose del peor caso económico de una corrida Lusha.
 *
 * `maxProviderCredits` es lo que se RESERVA. `normalizedBudgetCredits` es el
 * mismo número expresado en la unidad del período de Agente 1: hoy la
 * conversión es 1:1 porque el período cuenta créditos de proveedor, y se publica
 * aparte para que un día en que dejen de ser la misma unidad el cambio tenga un
 * sitio donde ocurrir en lugar de esconderse en el llamador.
 */
export type LushaRunLiability = {
  maxPages: number;
  maxCreditsPerPage: number;
  maxProviderCredits: number;
  normalizedBudgetCredits: number;
  /** `null` cuando no hay fila de pricing activa: no se inventa un costo. */
  estimatedMaxCostUsd: number | null;
  /** Motivo por el que el USD es null, para diagnóstico. */
  pricingMissingWarning: string | null;
};

/** Fuente declarada del techo, para metadatos y tests. */
export const LUSHA_RUN_LIABILITY_SOURCE = 'lusha_company_prospecting_worst_case' as const;

/**
 * Techo de créditos de proveedor de una corrida «Buscar con IA».
 *
 * páginas (2) × créditos por página (1) = 2. No hay pierna de enrichment de
 * proveedor que sumar: si algún día la hubiera, se suma AQUÍ y la reserva la
 * cubre sin tocar el llamador.
 */
export function resolveLushaRunMaxProviderCredits(): number {
  return LUSHA_PENDING_REVIEW_MAX_PAGES * LUSHA_PREVIEW_EXPECTED_MAX_CREDITS;
}

/**
 * ¿El techo derivado sigue coincidiendo con el que el writer publica?
 *
 * `LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS` ya viajaba en el resultado de cada
 * corrida como «expectedMaxCredits». Si alguien sube las páginas y olvida ese
 * constante —o al revés— la reserva y lo que la UI promete dejarían de ser el
 * mismo número en silencio. Esto lo vuelve un fallo ruidoso.
 */
export function assertLushaRunLiabilityCoherent(): void {
  const derived = resolveLushaRunMaxProviderCredits();
  if (derived !== LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS) {
    throw new Error(
      `lusha_run_liability_incoherent: derived=${derived} declared=${LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS}`,
    );
  }
}

/**
 * Peor caso completo, con el USD resuelto desde el pricing que se le pasa.
 *
 * `pricingConfig` llega por parámetro (no se lee la DB aquí) para que el módulo
 * siga siendo puro y para que el gate de presupuesto —que sólo necesita
 * créditos— no dependa de una lectura de pricing que podría fallar.
 */
export function resolveLushaRunLiability(
  pricingConfig: LushaCompanyProspectingPricingConfig | null = null,
): LushaRunLiability {
  assertLushaRunLiabilityCoherent();

  const maxProviderCredits = resolveLushaRunMaxProviderCredits();
  const hasPricing =
    pricingConfig !== null && typeof pricingConfig.unit_cost_usd === 'number';

  return {
    maxPages: LUSHA_PENDING_REVIEW_MAX_PAGES,
    maxCreditsPerPage: LUSHA_PREVIEW_EXPECTED_MAX_CREDITS,
    maxProviderCredits,
    // 1:1 hoy. Ver la nota del tipo.
    normalizedBudgetCredits: maxProviderCredits,
    estimatedMaxCostUsd: hasPricing
      ? maxProviderCredits * pricingConfig.unit_cost_usd
      : null,
    pricingMissingWarning: hasPricing
      ? null
      : 'Lusha company_prospecting_v3 pricing config not found. estimatedMaxCostUsd cannot be computed.',
  };
}

/**
 * Créditos que la corrida debe RESERVAR antes de tocar a Lusha.
 *
 * Espeja el papel de `estimateCreditsForProvider` para Apollo/Tavily. Se
 * mantiene aparte de esa función a propósito: `WizardDiscoveryProviderKey` es
 * `'tavily' | 'apollo_organizations'` y ensanchar esa unión con `'lusha'`
 * volvería a Lusha SELECCIONABLE en el radio de «Proveedor de esta corrida».
 * Lusha es un proveedor oculto; su economía se comparte, su visibilidad no.
 */
export function estimateLushaRunCredits(): number {
  return resolveLushaRunLiability().normalizedBudgetCredits;
}

/** Metadatos seguros (sin secretos) del techo, para logs y tests. */
export function toLushaRunLiabilityMetadata(
  liability: LushaRunLiability,
): Record<string, unknown> {
  return {
    source: LUSHA_RUN_LIABILITY_SOURCE,
    max_pages: liability.maxPages,
    max_credits_per_page: liability.maxCreditsPerPage,
    max_provider_credits: liability.maxProviderCredits,
    normalized_budget_credits: liability.normalizedBudgetCredits,
    estimated_max_cost_usd: liability.estimatedMaxCostUsd,
  };
}

// ── Techo por PLAN de macro industria (§ 4 de PLAN-CATALOG-1) ─────────────────

/**
 * Peor caso económico de una macro industria compuesta.
 *
 * Cada rama de `LushaMacroSearchPlan` es una búsqueda propia y se pagina por
 * separado, así que el techo se multiplica por el número de ramas:
 *
 *     ramas × LUSHA_PENDING_REVIEW_MAX_PAGES × créditos por página
 *     1 rama → 2 · 2 ramas → 4 · 3 ramas → 6
 *
 * Con el catálogo aprobado el máximo del catálogo entero es **6**
 * (`energy_mining_environment` y `services_company`, de 3 ramas cada una).
 *
 * ── 🔴 Por qué NADIE llama a esto todavía ─────────────────────────────────────
 *
 * `estimateLushaRunCredits()` sigue siendo la única función que la reserva usa,
 * y sigue devolviendo 2. Esto NO es un olvido de cableado: el ejecutor de hoy
 * pagina una sola búsqueda, así que una corrida real no puede gastar más de 2 y
 * reservar 6 bloquearía corridas que caben. El día que el ejecutor itere ramas,
 * el número que reserva y el número que puede gastar cambian EN EL MISMO commit,
 * y esta función es la que ya está probada para ese momento.
 *
 * El tipo llega por `import type`: este módulo no crea ninguna arista de runtime
 * hacia el catálogo, y una suite estática vigila esa propiedad.
 *
 * Puro: `plan` entra por parámetro y sólo se lee `branches.length`.
 */
export function resolveLushaMacroPlanMaxProviderCredits(
  plan: Pick<LushaMacroSearchPlan, 'branches'>,
): number {
  return plan.branches.length * resolveLushaRunMaxProviderCredits();
}

/**
 * El techo de la macro industria MÁS cara del catálogo que se le pase.
 *
 * Es la cifra que un futuro gate de presupuesto multi-rama tendría que poder
 * cubrir en el peor caso. Se calcula sobre los planes recibidos —no sobre una
 * constante— para que añadir una rama a cualquier macro lo mueva solo.
 */
export function resolveLushaMacroCatalogMaxProviderCredits(
  plans: readonly Pick<LushaMacroSearchPlan, 'branches'>[],
): number {
  return plans.reduce(
    (max, plan) => Math.max(max, resolveLushaMacroPlanMaxProviderCredits(plan)),
    0,
  );
}
