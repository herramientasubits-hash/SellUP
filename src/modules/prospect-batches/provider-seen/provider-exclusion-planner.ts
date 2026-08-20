/**
 * provider-exclusion-planner.ts — qué se le pide a un proveedor que NO devuelva,
 * de dónde salió cada exclusión, y qué se quedó fuera.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN §§ 5, 6, 10.
 *
 * ── Qué añade sobre `provider-exclusion-domains` ──────────────────────────────
 *
 * Aquel módulo responde «¿qué dominios viajan?». Éste responde «¿QUÉ PUEDE excluir
 * ESTE proveedor, de qué fuentes, y qué no viajó y por qué?». La diferencia
 * importa porque a partir de ahora hay más de una clase de exclusión candidata
 * (ids del proveedor) y más de una procedencia (memoria provider-seen, conocidos
 * de SellUp, dominios locales de HubSpot, la propia corrida), y un plan que no
 * sepa explicarse convierte un recorte en un misterio.
 *
 * ── 🔴 CAPACIDAD, no preferencia (§ 5) ───────────────────────────────────────
 *
 * `supportsIdExclusion` está en `false` para TODOS los proveedores, y no porque
 * excluir por id sea mala idea: porque el contrato de
 * `POST /v3/companies/prospecting` que gobierna `filters.companies.exclude` está
 * pendiente de confirmación ESCRITA del soporte humano de Lusha (Sandeep). Hasta
 * que llegue, este PR no puede depender de:
 *
 *   · `filters.companies.exclude.ids`,
 *   · la semántica de `ids` + `domains` COMBINADOS,
 *   · la estabilidad a largo plazo del id de empresa,
 *   · un máximo de elementos en el array de exclusión,
 *   · el orden entre exclusión y paginación,
 *   · si la exclusión rellena («backfill») la página o la deja corta.
 *
 * Lo que sí se construye es el sitio donde eso encajará: los ids se RECOGEN, se
 * CUENTAN y se declaran `available`, y una sola constante decide si se envían. El
 * día que llegue el contrato escrito, se cambia la capacidad y se añaden sus
 * pruebas; no se reescribe nada.
 *
 * ── 🔴 Ids y dominios se planifican POR SEPARADO ─────────────────────────────
 *
 * Nunca se calcula un tope conjunto ni una lista mezclada. Un plan de dominios
 * tiene que salir idéntico haya o no haya ids disponibles, y hay una prueba que
 * lo fija. Es la forma concreta de no depender de una semántica combinada que
 * nadie ha confirmado.
 *
 * ── 🔴 El tope sigue siendo NUESTRO ──────────────────────────────────────────
 *
 * `PREPAID_EXCLUSION_DOMAIN_CAP` es una decisión propia y conservadora del hito
 * base, no un límite publicado por ningún proveedor. No se inventa aquí un
 * «chunk size» ni un máximo de ids: mientras los ids no viajen, su tope es 0 por
 * capacidad, que es un hecho, y no un número mágico.
 *
 * ── 🔴 La exclusión no es autoridad de dedupe (§ 6) ──────────────────────────
 *
 * El proveedor puede ignorarla, puede devolver la misma empresa bajo otro dominio
 * y la lista viaja acotada. El dedupe local posterior corre entero e igual.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import {
  planProviderExclusionDomains,
  PREPAID_EXCLUSION_DOMAIN_CAP,
} from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import type { ProviderSeenProvider } from './provider-seen-identity';

// ─── Procedencias (§ 6) ───────────────────────────────────────────────────────

/**
 * De dónde puede salir una exclusión. El orden es el de la explicación, no el de
 * la petición: la petición va ordenada y deduplicada por el planificador de
 * dominios, que ya es determinista.
 */
export const PROVIDER_EXCLUSION_SOURCES = [
  'provider_seen',
  'sellup_known',
  'hubspot_local',
  'free_source_accepted',
  'same_run',
] as const;

export type ProviderExclusionSource = (typeof PROVIDER_EXCLUSION_SOURCES)[number];

export type ProviderExclusionInputs = {
  /** Ids del proveedor vistos en corridas ANTERIORES. */
  providerSeenIds?: Iterable<string | null | undefined>;
  /** Dominios vistos en corridas ANTERIORES. */
  providerSeenDomains?: Iterable<string | null | undefined>;
  /** Dominios de cuentas y candidatos activos de SellUp. */
  sellupKnownDomains?: Iterable<string | null | undefined>;
  /**
   * Dominios de HubSpot que YA están disponibles localmente.
   *
   * 🔴 Nunca una enumeración del CRM: § 30(E) del hito base lo prohíbe y la
   * comprobación canónica contra HubSpot sigue siendo POR CANDIDATO.
   */
  hubspotLocalDomains?: Iterable<string | null | undefined>;
  /** Dominios de empresas que la fuente gratuita ya aceptó en esta corrida. */
  freeSourceAcceptedDomains?: Iterable<string | null | undefined>;
  /** Ids ya devueltos en ESTA corrida (otras ramas/páginas). */
  sameRunProviderIds?: Iterable<string | null | undefined>;
  /** Dominios ya devueltos en ESTA corrida. */
  sameRunDomains?: Iterable<string | null | undefined>;
};

// ─── Capacidad por proveedor (§ 5) ────────────────────────────────────────────

export type ProviderExclusionCapability = {
  provider: ProviderSeenProvider;
  supportsDomainExclusion: boolean;
  supportsIdExclusion: boolean;
  domainCap: number;
  idCap: number;
  /**
   * Por qué una capacidad está apagada. Viaja a la telemetría para que «0
   * enviados» nunca se lea como «no había nada que enviar».
   */
  idExclusionUnsupportedReason: string | null;
  domainExclusionUnsupportedReason: string | null;
};

/**
 * Lusha: dominios SÍ —es lo único que el repo tiene verificado del contrato V3 y
 * lo que la ruta ya emite en Producción—, ids NO mientras el contrato escrito no
 * llegue.
 */
export const LUSHA_EXCLUSION_CAPABILITY: ProviderExclusionCapability = {
  provider: 'lusha',
  supportsDomainExclusion: true,
  supportsIdExclusion: false,
  domainCap: PREPAID_EXCLUSION_DOMAIN_CAP,
  idCap: 0,
  idExclusionUnsupportedReason: 'lusha_exclude_ids_contract_unconfirmed',
  domainExclusionUnsupportedReason: null,
};

/**
 * Apollo: ninguna. Su contrato de Organization Search no prueba exclusiones, y el
 * hito base ya decidió no enviarle ninguna por esa razón.
 */
export const APOLLO_EXCLUSION_CAPABILITY: ProviderExclusionCapability = {
  provider: 'apollo',
  supportsDomainExclusion: false,
  supportsIdExclusion: false,
  domainCap: 0,
  idCap: 0,
  idExclusionUnsupportedReason: 'apollo_exclusion_contract_unverified',
  domainExclusionUnsupportedReason: 'apollo_exclusion_contract_unverified',
};

const CAPABILITIES: Record<ProviderSeenProvider, ProviderExclusionCapability> = {
  lusha: LUSHA_EXCLUSION_CAPABILITY,
  apollo: APOLLO_EXCLUSION_CAPABILITY,
};

export function resolveProviderExclusionCapability(
  provider: ProviderSeenProvider,
): ProviderExclusionCapability {
  return CAPABILITIES[provider];
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

export type ProviderExclusionDimensionPlan<T> = {
  /** Valores únicos y utilizables que SellUp conoce. */
  available: number;
  /** Los que realmente viajan. Vacío si la capacidad está apagada. */
  sent: readonly T[];
  /** Conocidos que no viajaron por el tope propio. */
  omittedDueToCap: number;
  /** Conocidos que no viajaron porque el proveedor no soporta la dimensión. */
  omittedDueToCapability: number;
  /** Cuántos aportó cada procedencia, antes de deduplicar entre procedencias. */
  bySource: Record<ProviderExclusionSource, number>;
  /** `null` cuando la dimensión está soportada. */
  unsupportedReason: string | null;
};

export type ProviderExclusionPlan = {
  provider: ProviderSeenProvider;
  domains: ProviderExclusionDimensionPlan<string>;
  ids: ProviderExclusionDimensionPlan<string>;
};

function emptyBySource(): Record<ProviderExclusionSource, number> {
  return {
    provider_seen: 0,
    sellup_known: 0,
    hubspot_local: 0,
    free_source_accepted: 0,
    same_run: 0,
  };
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Plan de ids. No usa el planificador de dominios: un id no es un host y
 * normalizarlo como tal lo destruiría (`v1.ZpAq…` no tiene TLD).
 *
 * La selección bajo tope es lexicográfica, igual que la de dominios, por el mismo
 * motivo: dos corridas idénticas deben emitir la misma petición.
 */
function planIdDimension(
  capability: ProviderExclusionCapability,
  contributions: readonly { source: ProviderExclusionSource; values: Iterable<string | null | undefined> }[],
): ProviderExclusionDimensionPlan<string> {
  const bySource = emptyBySource();
  const unique = new Set<string>();

  for (const contribution of contributions) {
    for (const raw of contribution.values) {
      const id = normalizeId(raw);
      if (id === null) continue;
      bySource[contribution.source]++;
      unique.add(id);
    }
  }

  const ordered = [...unique].sort();

  if (!capability.supportsIdExclusion) {
    return {
      available: ordered.length,
      sent: [],
      omittedDueToCap: 0,
      omittedDueToCapability: ordered.length,
      bySource,
      unsupportedReason: capability.idExclusionUnsupportedReason,
    };
  }

  const cap = Math.max(0, Math.trunc(capability.idCap));
  const sent = ordered.slice(0, cap);
  return {
    available: ordered.length,
    sent,
    omittedDueToCap: ordered.length - sent.length,
    omittedDueToCapability: 0,
    bySource,
    unsupportedReason: null,
  };
}

function planDomainDimension(
  capability: ProviderExclusionCapability,
  contributions: readonly { source: ProviderExclusionSource; values: Iterable<string | null | undefined> }[],
): ProviderExclusionDimensionPlan<string> {
  const bySource = emptyBySource();
  const all: (string | null | undefined)[] = [];

  for (const contribution of contributions) {
    for (const raw of contribution.values) {
      all.push(raw);
      bySource[contribution.source]++;
    }
  }

  // 🔴 Se REUSA el planificador del hito base: normalización, dedupe, orden
  // determinista y recorte contado ya son suyos. Duplicarlos aquí crearía dos
  // listas que podrían divergir y sólo una viaja al proveedor.
  const base = planProviderExclusionDomains(all, capability.domainCap);

  if (!capability.supportsDomainExclusion) {
    return {
      available: base.available,
      sent: [],
      omittedDueToCap: 0,
      omittedDueToCapability: base.available,
      bySource,
      unsupportedReason: capability.domainExclusionUnsupportedReason,
    };
  }

  return {
    available: base.available,
    sent: base.sent,
    omittedDueToCap: base.omittedDueToCap,
    omittedDueToCapability: 0,
    bySource,
    unsupportedReason: null,
  };
}

/**
 * Construye el plan explicable de exclusión de un proveedor.
 *
 * 🔴 Las dos dimensiones se calculan de forma INDEPENDIENTE. `planDomainDimension`
 * no recibe ni un solo id y `planIdDimension` no recibe ni un solo dominio, de
 * modo que ninguna semántica combinada puede colarse por accidente.
 */
export function planProviderExclusions(
  provider: ProviderSeenProvider,
  inputs: ProviderExclusionInputs,
  capability: ProviderExclusionCapability = resolveProviderExclusionCapability(provider),
): ProviderExclusionPlan {
  const domains = planDomainDimension(capability, [
    { source: 'provider_seen', values: inputs.providerSeenDomains ?? [] },
    { source: 'sellup_known', values: inputs.sellupKnownDomains ?? [] },
    { source: 'hubspot_local', values: inputs.hubspotLocalDomains ?? [] },
    { source: 'free_source_accepted', values: inputs.freeSourceAcceptedDomains ?? [] },
    { source: 'same_run', values: inputs.sameRunDomains ?? [] },
  ]);

  const ids = planIdDimension(capability, [
    { source: 'provider_seen', values: inputs.providerSeenIds ?? [] },
    { source: 'same_run', values: inputs.sameRunProviderIds ?? [] },
  ]);

  return { provider: capability.provider, domains, ids };
}

/** Vista serializable del plan. snake_case, sin PII. */
export function toProviderExclusionPlanMetadata(
  plan: ProviderExclusionPlan,
): Record<string, unknown> {
  return {
    provider: plan.provider,
    provider_exclusion_domains_available: plan.domains.available,
    provider_exclusion_domains_sent: plan.domains.sent.length,
    provider_exclusion_domains_omitted_cap: plan.domains.omittedDueToCap,
    provider_exclusion_domains_omitted_capability: plan.domains.omittedDueToCapability,
    provider_exclusion_domains_by_source: { ...plan.domains.bySource },
    provider_exclusion_domains_unsupported_reason: plan.domains.unsupportedReason,
    provider_exclusion_ids_available: plan.ids.available,
    provider_exclusion_ids_sent: plan.ids.sent.length,
    provider_exclusion_ids_omitted_cap: plan.ids.omittedDueToCap,
    provider_exclusion_ids_omitted_capability: plan.ids.omittedDueToCapability,
    provider_exclusion_ids_by_source: { ...plan.ids.bySource },
    provider_exclusion_ids_unsupported_reason: plan.ids.unsupportedReason,
  };
}
