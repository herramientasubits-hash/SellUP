/**
 * lusha-domain-exclusion.ts — qué dominios se le pide a Lusha que NO devuelva.
 *
 * AGENT1-LUSHA-DOMAIN-EXCLUSION-1.
 *
 * El 2026-10-15 el soporte de Lusha (Kamal) probó contra la API que
 * `POST /v3/companies/prospecting` acepta `filters.companies.exclude.domains`
 * (CUT-L1 lo había retirado por una respuesta anterior que decía que no existía).
 * Lusha cobra 1 crédito por petición de hasta 25 resultados, también si vuelve
 * vacía: cada empresa ya nuestra que deja de venir es un hueco que ocupa una nueva.
 *
 * ── Qué se excluye ───────────────────────────────────────────────────────────
 *
 * SÓLO lo que ya es NUESTRO (`dedupeAuthorityValues` del plan: cuentas de SellUp,
 * HubSpot local, lo que la capa gratuita aceptó). NUNCA `provider_seen` a secas:
 * «ya pagamos por verla» incluye empresas que sólo sobraron del objetivo y que son
 * candidatas legítimas en la corrida siguiente (misma regla que la supresión
 * cliente, PROVIDER-SEEN-DEDUPE-FIX).
 *
 * ── Por qué la lista es FIJA durante la corrida ──────────────────────────────
 *
 * Se calcula una vez, antes de pedir. Si cada página excluyera además lo devuelto
 * por las anteriores, la página 1 de la consulta filtrada saltaría 25 empresas que
 * nunca se vieron (el conjunto se encoge y la paginación se desplaza). Los
 * repetidos dentro de la corrida los sigue quitando el registro de identidad.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

import type { ProviderExclusionPlan } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';

/** Tope propio de dominios por petición (Lusha no publica uno; el de Apollo es 500). */
export const LUSHA_DOMAIN_EXCLUSION_CAP = 500;

export type LushaDomainExclusion = {
  /** La bandera estaba encendida. */
  enabled: boolean;
  /** Los que viajan en cada petición de la corrida (normalizados, orden estable). */
  domains: readonly string[];
  /** Cuántos dominios nuestros se conocían. */
  available: number;
  /** Conocidos que no viajaron por el tope. */
  omittedDueToCap: number;
};

export const LUSHA_DOMAIN_EXCLUSION_DISABLED: LushaDomainExclusion = Object.freeze({
  enabled: false,
  domains: Object.freeze([]) as readonly string[],
  available: 0,
  omittedDueToCap: 0,
});

export function resolveLushaDomainExclusion(input: {
  enabled: boolean;
  plan: ProviderExclusionPlan | null | undefined;
  cap?: number;
}): LushaDomainExclusion {
  const ours = input.plan?.domains.dedupeAuthorityValues ?? [];
  if (!input.enabled) return { ...LUSHA_DOMAIN_EXCLUSION_DISABLED, available: ours.length };
  const cap = Math.max(0, Math.trunc(input.cap ?? LUSHA_DOMAIN_EXCLUSION_CAP));
  const domains = ours.slice(0, cap);
  return { enabled: true, domains, available: ours.length, omittedDueToCap: ours.length - domains.length };
}

/** Vista serializable para la metadata del lote. Sólo conteos, sin dominios. */
export function toLushaDomainExclusionMetadata(exclusion: LushaDomainExclusion): Record<string, unknown> {
  return {
    enabled: exclusion.enabled,
    sent: exclusion.domains.length,
    available: exclusion.available,
    omitted_cap: exclusion.omittedDueToCap,
  };
}
