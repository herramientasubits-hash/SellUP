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
 * ── 🔴 CUT-L1 · NINGÚN proveedor vivo excluye del lado del servidor (§ 5) ────
 *
 * AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION § 1. El soporte HUMANO de Lusha
 * confirmó que `POST /v3/companies/prospecting` NO soporta array de exclusión
 * server-side: ni `excludeDomains` ni `excludeCompanyIds`. Antes de este corte
 * este módulo declaraba `supportsDomainExclusion: true` para Lusha citando un
 * contrato «verificado» que nunca existió. Ese contrato HUMANO es ahora la
 * autoridad, y las dos dimensiones de Lusha están en `false`.
 *
 * Apollo ya estaba en `false` por su propio motivo (su contrato de Organization
 * Search no prueba exclusiones), así que hoy la capacidad está apagada en las dos
 * rutas — por razones DISTINTAS, y cada una lo dice con su propio motivo.
 *
 * Lo que sí se conserva es el sitio donde una capacidad real encajaría: los
 * valores se RECOGEN, se NORMALIZAN, se CUENTAN y viajan en `availableValues`; una
 * sola constante por dimensión decide si además se ENVÍAN.
 *
 * ── 🔴 «Nada enviado» ≠ «nada conocido» (§ 3) ────────────────────────────────
 *
 * Es la distinción que este módulo tiene que sostener, porque es la que un corte
 * apresurado destruye:
 *
 *   A. lo que SellUp CONOCE  → `available` / `availableValues`, íntegro.
 *   B. lo que PUEDE ENVIARSE → `sent`, hoy vacío por capacidad.
 *   C. lo que puede DECIDIR UN DUPLICADO → `dedupeAuthorityValues`, que es A menos
 *      lo que sólo aporta `provider_seen`.
 *
 * 🔴 AGENT1-LUSHA-PROVIDER-SEEN-DEDUPE-FIX — C es nueva, y su ausencia era un
 * defecto vivo en Producción: la supresión cliente se sembraba de A, así que «ya
 * pagamos por verla» pesaba lo mismo que «ya es nuestra». Ver
 * `PROVIDER_EXCLUSION_DEDUPE_AUTHORITY_SOURCES`.
 *
 * Con la capacidad apagada, `sent` queda vacío pero `availableValues` NO: es la
 * evidencia con la que la supresión CLIENTE siembra el registro de identidad de la
 * corrida. Derivar la supresión local de `sent` habría tirado esa evidencia y
 * dejado la ruta sin ninguna protección.
 *
 * `unsupportedReason` acompaña siempre al vacío, para que la telemetría no lea
 * «0 enviados» como «no había nada que enviar».
 *
 * ── 🔴 Ids y dominios se planifican POR SEPARADO ─────────────────────────────
 *
 * Nunca se calcula un tope conjunto ni una lista mezclada. Un plan de dominios
 * tiene que salir idéntico haya o no haya ids disponibles, y hay una prueba que
 * lo fija. Id de proveedor y dominio son evidencia INDEPENDIENTE, y CUT-L1 § 6 lo
 * mantiene así: ninguno se convierte en clave histórica del otro.
 *
 * ── 🔴 El tope sigue siendo NUESTRO ──────────────────────────────────────────
 *
 * `PREPAID_EXCLUSION_DOMAIN_CAP` es una decisión propia y conservadora del hito
 * base, no un límite publicado por ningún proveedor. Con las dos capacidades
 * apagadas los topes efectivos son 0, que es un HECHO de capacidad y no un número
 * mágico.
 *
 * ── 🔴 La exclusión no es autoridad de dedupe (§ 6) ──────────────────────────
 *
 * El dedupe local posterior corre entero e igual — y desde CUT-L1 es, además, la
 * ÚNICA protección: no hay exclusión previa al cobro que pueda ahorrar el crédito
 * de Prospecting de una empresa histórica.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import { planProviderExclusionDomains } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
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

/**
 * 🔴 AGENT1-LUSHA-PROVIDER-SEEN-DEDUPE-FIX § 1 — las procedencias que SÍ pueden
 * decidir un duplicado.
 *
 * ── El defecto que esta separación cierra ────────────────────────────────────
 *
 * Corrida de Producción del 2026-09-01/02 (CO / technology, fingerprint
 * `7aa292ef…`, tres peticiones idénticas): la PRIMERA persistió 5 candidatos y
 * dejó los 25 dominios devueltos en la memoria provider-seen. La SEGUNDA y la
 * TERCERA volvieron a pedir la misma página —Lusha V3 no excluye del lado del
 * servidor, así que la petición no puede pedir «no me devuelvas éstos»—, cobraron
 * su crédito, y sembraron esos 25 dominios como «conocidos». Las 25 filas cayeron
 * con motivo `known_domain_seed`, `useful.length` quedó en 0, y la corrida salió
 * por `status: 'empty'`: sin lote, sin candidatos, con el crédito cobrado y sin
 * telemetría durable que lo explicara.
 *
 * ── Por qué `provider_seen` NO es autoridad ──────────────────────────────────
 *
 * Las otras cuatro procedencias responden «esta empresa YA ES NUESTRA»: una cuenta
 * de SellUp, una empresa en HubSpot, una que la fuente gratuita ya aceptó en esta
 * misma corrida, o una que otra rama/página de esta corrida ya entregó.
 *
 * `provider_seen` responde otra cosa: «ya PAGAMOS por verla». Eso incluye a las
 * que se descartaron por sobrante de objetivo (`target_overflow_discarded`) y a
 * las que se rechazaron por precisión — empresas que nadie posee y que son
 * candidatas legítimas en la corrida siguiente. Tratarlas como propias es
 * exactamente lo que `provider-exclusion-planner` § 6 prohíbe: «la exclusión no es
 * autoridad de dedupe».
 *
 * ── Lo que este recorte NO pretende ──────────────────────────────────────────
 *
 * No ahorra ningún crédito, y no se afirma que lo haga. Mientras Lusha V3 no
 * excluya server-side, una empresa ya vista puede volver a cobrarse: eso lo fijó
 * CUT-L1 y sigue siendo cierto. Lo que cambia es que el resultado de esa página
 * pagada deje de tirarse entero.
 */
export const PROVIDER_EXCLUSION_DEDUPE_AUTHORITY_SOURCES: readonly ProviderExclusionSource[] =
  Object.freeze(PROVIDER_EXCLUSION_SOURCES.filter((source) => source !== 'provider_seen'));

/** ¿Puede esta procedencia decidir por sí sola que una empresa es duplicada? */
export function isProviderExclusionDedupeAuthority(source: ProviderExclusionSource): boolean {
  return source !== 'provider_seen';
}

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
 * 🔴 CUT-L1 § 1 — el motivo CANÓNICO, y es el mismo para las dos dimensiones
 * porque el hecho es uno: `POST /v3/companies/prospecting` no tiene bloque de
 * exclusión del lado del servidor. No es «pendiente de confirmar»: está
 * confirmado, por un humano, en NEGATIVO.
 */
export const LUSHA_NO_SERVER_SIDE_EXCLUSION_REASON =
  'lusha_v3_no_server_side_exclusion_human_confirmed';

/**
 * Lusha: NINGUNA exclusión server-side. Ni dominios ni ids.
 *
 * 🔴 CUT-L1 § 1 — confirmado por el soporte HUMANO de Lusha. Los dominios
 * conocidos siguen recogiéndose y siguen viajando en `availableValues`; lo que no
 * ocurre es que salgan en la petición.
 */
export const LUSHA_EXCLUSION_CAPABILITY: ProviderExclusionCapability = {
  provider: 'lusha',
  supportsDomainExclusion: false,
  supportsIdExclusion: false,
  domainCap: 0,
  idCap: 0,
  idExclusionUnsupportedReason: LUSHA_NO_SERVER_SIDE_EXCLUSION_REASON,
  domainExclusionUnsupportedReason: LUSHA_NO_SERVER_SIDE_EXCLUSION_REASON,
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
  /** Cuántos valores únicos y utilizables conoce SellUp. */
  available: number;
  /**
   * 🔴 CUT-L1 § 3 — los valores conocidos EN SÍ, ya normalizados, deduplicados y
   * en orden determinista. SOBREVIVEN a la capacidad apagada: son evidencia
   * LOCAL, no una petición.
   *
   * 🔴 NO es de aquí de donde se siembra la supresión cliente: eso es
   * `dedupeAuthorityValues`. Ver AGENT1-LUSHA-PROVIDER-SEEN-DEDUPE-FIX.
   */
  availableValues: readonly T[];
  /**
   * 🔴 AGENT1-LUSHA-PROVIDER-SEEN-DEDUPE-FIX § 2 — el subconjunto de
   * `availableValues` cuya procedencia SÍ prueba propiedad, y por tanto el único
   * que puede sembrar la supresión cliente del registro de identidad.
   *
   * Es `availableValues` menos lo que sólo aporta `provider_seen`. Un valor que
   * llega por DOS procedencias —vista antes Y cuenta de SellUp— sigue aquí: lo que
   * se retira es la procedencia, no el valor.
   *
   * Se calcula con el MISMO colector que `availableValues` (misma normalización,
   * mismo dedupe, mismo orden), así que las dos vistas no pueden divergir en nada
   * que no sea la procedencia.
   */
  dedupeAuthorityValues: readonly T[];
  /**
   * Los que realmente viajan al proveedor. Vacío si la capacidad está apagada —y
   * hoy lo está en las dos rutas vivas, cada una por su motivo.
   */
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
  // 🔴 PROVIDER-SEEN-DEDUPE-FIX § 2 — se acumula EN PARALELO, con el mismo
  // normalizador y el mismo dedupe. Un segundo recorrido posterior sobre
  // `ordered` no podría reconstruir la procedencia: aquí es donde se conoce.
  const dedupeAuthority = new Set<string>();

  for (const contribution of contributions) {
    for (const raw of contribution.values) {
      const id = normalizeId(raw);
      if (id === null) continue;
      bySource[contribution.source]++;
      unique.add(id);
      if (isProviderExclusionDedupeAuthority(contribution.source)) dedupeAuthority.add(id);
    }
  }

  const ordered = [...unique].sort();
  const orderedAuthority = [...dedupeAuthority].sort();

  if (!capability.supportsIdExclusion) {
    return {
      available: ordered.length,
      // 🔴 CUT-L1 § 3 — lo conocido sobrevive a la capacidad apagada.
      availableValues: ordered,
      dedupeAuthorityValues: orderedAuthority,
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
    availableValues: ordered,
    dedupeAuthorityValues: orderedAuthority,
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
  // 🔴 PROVIDER-SEEN-DEDUPE-FIX § 2 — la lista de las procedencias con autoridad,
  // recogida cruda para pasarla por el MISMO colector canónico. No se filtra
  // después sobre los normalizados: se filtra ANTES, que es donde la procedencia
  // todavía existe.
  const dedupeAuthorityRaw: (string | null | undefined)[] = [];

  for (const contribution of contributions) {
    for (const raw of contribution.values) {
      all.push(raw);
      bySource[contribution.source]++;
      if (isProviderExclusionDedupeAuthority(contribution.source)) dedupeAuthorityRaw.push(raw);
    }
  }

  // 🔴 Se REUSA el colector del hito base: normalización, dedupe, orden
  // determinista y recorte contado ya son suyos. Duplicarlos aquí crearía dos
  // listas que podrían divergir y sólo una viaja al proveedor.
  //
  // 🔴 CUT-L1 § 3 — y por eso `availableValues` sale también de él: hay UN
  // normalizador de dominios de exclusión, no dos.
  const base = planProviderExclusionDomains(all, capability.domainCap);
  // El MISMO colector, con el mismo tope: sólo cambia el conjunto de entrada.
  const authority = planProviderExclusionDomains(dedupeAuthorityRaw, capability.domainCap);

  if (!capability.supportsDomainExclusion) {
    return {
      available: base.available,
      // 🔴 CUT-L1 § 3 — ÉSTA es la línea que impide que el corte tire la
      // evidencia: la capacidad apagada vacía `sent`, jamás lo conocido.
      availableValues: base.availableValues,
      dedupeAuthorityValues: authority.availableValues,
      sent: [],
      omittedDueToCap: 0,
      omittedDueToCapability: base.available,
      bySource,
      unsupportedReason: capability.domainExclusionUnsupportedReason,
    };
  }

  return {
    available: base.available,
    availableValues: base.availableValues,
    dedupeAuthorityValues: authority.availableValues,
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
    // 🔴 PROVIDER-SEEN-DEDUPE-FIX § 5 — la TERCERA cifra. Sin ella, «37 conocidos,
    // 0 enviados» no dice cuántos de esos 37 podían de verdad tumbar una empresa,
    // y la diferencia entre 37 y 12 es la diferencia entre una corrida vacía y una
    // con candidatos.
    provider_exclusion_domains_dedupe_authority: plan.domains.dedupeAuthorityValues.length,
    provider_exclusion_domains_sent: plan.domains.sent.length,
    provider_exclusion_domains_omitted_cap: plan.domains.omittedDueToCap,
    provider_exclusion_domains_omitted_capability: plan.domains.omittedDueToCapability,
    provider_exclusion_domains_by_source: { ...plan.domains.bySource },
    provider_exclusion_domains_unsupported_reason: plan.domains.unsupportedReason,
    provider_exclusion_ids_available: plan.ids.available,
    provider_exclusion_ids_dedupe_authority: plan.ids.dedupeAuthorityValues.length,
    provider_exclusion_ids_sent: plan.ids.sent.length,
    provider_exclusion_ids_omitted_cap: plan.ids.omittedDueToCap,
    provider_exclusion_ids_omitted_capability: plan.ids.omittedDueToCapability,
    provider_exclusion_ids_by_source: { ...plan.ids.bySource },
    provider_exclusion_ids_unsupported_reason: plan.ids.unsupportedReason,
  };
}
