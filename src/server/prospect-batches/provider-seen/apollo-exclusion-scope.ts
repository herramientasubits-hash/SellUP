/**
 * apollo-exclusion-scope.ts — de qué corrida viene cada dominio que le pedimos a
 * Apollo que NO devuelva, y cuáles sobran.
 *
 * AGENT1-APOLLO-EXCLUSION-SAME-INDUSTRY-1.
 *
 * ── El problema ───────────────────────────────────────────────────────────────
 *
 * La lista de exclusión (`not_organization_websites_list`, tope 500) mezclaba
 * todo: los candidatos vivos del país de CUALQUIER industria y la memoria
 * provider-seen de Apollo, que es GLOBAL (la tabla no guarda país ni industria).
 * Medido en Producción el 2026-09-30 (Colombia × Tecnología, lote `b89e28ec`):
 * 500 enviados y 205 fuera por el tope, pero de las 721 empresas que Apollo ha
 * mostrado, sólo 133 eran de Colombia × Tecnología; el resto eran de México,
 * Perú, Colombia-Gobierno, Colombia-Retail. Las empresas que SÍ importaban se
 * caían por el tope y volvían como repetidas.
 *
 * ── La regla ──────────────────────────────────────────────────────────────────
 *
 * Una corrida excluye lo de SU país y SU industria. Lo demás deja de ocupar
 * sitio en la lista; si Apollo lo devuelve igualmente, lo rechazan las mismas
 * compuertas de siempre (reclamos globales «una empresa, un vendedor»,
 * duplicados, memoria de lo visto) sin costar créditos: el coste es un sitio en
 * la página, no dinero.
 *
 * 🔴 Fail-closed hacia la exclusión: un dominio sólo sale de la lista cuando
 * TODO lo que se sabe de él lo sitúa en otro país u otra industria. Sin lote,
 * sin país, sin industria reconocible o con un lote que no se pudo leer ⇒ se
 * queda en la lista, como antes de este corte.
 *
 * Puro: sin env, sin I/O.
 */

import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';

/**
 * La industria de la corrida tal como la publica el catálogo. El lector la
 * resuelve aquí, con la MISMA autoridad que el resto del asistente, para que
 * `wizard-execution-actions.ts` no abra un call-site más de la autoridad macro
 * (su guarda exige exactamente tres).
 */
export type ApolloExclusionIndustryIdentity = {
  industrySlug: string | null;
  industryName: string | null;
};

/** `null` ⇒ la industria no resuelve a una macro conocida: no hay alcance. */
export function resolveRunMacroIndustryKey(identity: ApolloExclusionIndustryIdentity): string | null {
  return resolveMacroIndustryKey({ slug: identity.industrySlug, displayName: identity.industryName });
}

export type ApolloExclusionRunScope = {
  /** `null` ⇒ no se compara el país (los candidatos vivos ya se leyeron por país). */
  countryCode: string | null;
  macroIndustryKey: string;
};

export type ApolloExclusionBatchRow = {
  id: string;
  country_code: string | null;
  industry: string | null;
};

export type ApolloExclusionBatchScope = 'in_scope' | 'out_of_scope' | 'unknown';

/**
 * Dónde cae un lote respecto de la corrida. `out_of_scope` exige una prueba
 * POSITIVA: un país conocido distinto o una industria reconocida distinta.
 * Una industria que no se resuelve a una macro conocida es `unknown`, nunca
 * `out_of_scope`.
 */
export function classifyBatchScope(
  batch: Pick<ApolloExclusionBatchRow, 'country_code' | 'industry'>,
  run: ApolloExclusionRunScope,
): ApolloExclusionBatchScope {
  const batchCountry = batch.country_code?.trim().toUpperCase() || null;
  const runCountry = run.countryCode?.trim().toUpperCase() || null;
  if (runCountry !== null && batchCountry !== null && batchCountry !== runCountry) {
    return 'out_of_scope';
  }

  const industry = batch.industry?.trim() || null;
  const batchMacro =
    industry === null ? null : resolveMacroIndustryKey({ slug: industry, displayName: industry });
  if (batchMacro !== null && batchMacro !== run.macroIndustryKey) return 'out_of_scope';

  const countryKnown = runCountry === null || batchCountry !== null;
  return countryKnown && batchMacro !== null ? 'in_scope' : 'unknown';
}

/**
 * ¿Este dominio visto sobra en la lista? Sólo si se conoce al menos un lote donde
 * se vio Y todos los lotes donde se vio están fuera de la corrida. Un lote no
 * encontrado o de alcance `unknown` lo mantiene en la lista.
 */
export function isSeenDomainOutOfScope(
  correlationIds: readonly string[],
  scopeByBatchId: ReadonlyMap<string, ApolloExclusionBatchScope>,
): boolean {
  if (correlationIds.length === 0) return false;
  return correlationIds.every((id) => scopeByBatchId.get(id) === 'out_of_scope');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La correlación de Apollo es el id del lote; cualquier otra cosa no se lee como lote. */
export function isBatchCorrelationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
