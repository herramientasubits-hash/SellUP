/**
 * provider-seen-identity.ts — la identidad que se RECUERDA de una empresa que un
 * proveedor de pago ya nos mostró.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN §§ 4, 5, 6.
 *
 * ── El agujero que este módulo empieza a cerrar ───────────────────────────────
 *
 * Hoy la única huella que queda de una empresa devuelta por un proveedor vive
 * DENTRO del candidato persistido: `prospect_candidates.source_trace.providerCompanyId`
 * (medido en Producción: 66 de 66 candidatos Lusha lo llevan). Es decir, la
 * memoria existe exactamente para las empresas que NO hacía falta recordar —las
 * que ya tenemos— y desaparece para las que sí:
 *
 *   · rechazada por precisión de macro,
 *   · duplicado exacto,
 *   · candidato histórico activo,
 *   · sobrante de objetivo,
 *   · rechazada por el writer,
 *   · descartada,
 *   · nunca persistida.
 *
 * Todas ésas se pagaron y todas se olvidan, así que la corrida siguiente vuelve a
 * pagarlas. La memoria provider-seen es independiente de `prospect_candidates`
 * justamente por eso (§ 4, § 23).
 *
 * ── 🔴 Qué se guarda y qué NO ────────────────────────────────────────────────
 *
 * Se guarda IDENTIDAD DE REGISTRO DEL PROVEEDOR: el id que el proveedor emitió y
 * el dominio normalizado, cuando existen. No se guarda el perfil, ni el nombre,
 * ni el tamaño, ni la industria, ni nada que un contrato de proveedor pueda
 * prohibir redistribuir. Recordar «ya vi este id» no es conservar el dato que se
 * compró.
 *
 * ── 🔴 Una empresa sin dominio SIGUE siendo identificable (§ 22.12) ───────────
 *
 * El id del proveedor basta por sí solo. La condición para NO recordar nada es
 * que falten LAS DOS señales; en ese caso no se fabrica ninguna —§ 22(I) del hito
 * base ya prohibía inventar un dominio— y la observación se cuenta como
 * `unidentifiable`, que es un hecho, no un descarte silencioso.
 *
 * ── 🔴 Por qué el dominio se normaliza con el normalizador de EXCLUSIÓN ──────
 *
 * El repo tiene dos normalizadores de dominio vivos: `normalizeDomain` (dedupe de
 * la corrida Lusha, laxo) y `normalizeExclusionDomain` (la lista que viaja al
 * proveedor, estricto). Un dominio recordado tiene UN solo consumidor: el plan de
 * exclusión y la reconciliación entre corridas. Si se guardara con el laxo y se
 * enviara con el estricto, un dominio recordado podría no coincidir jamás con uno
 * enviado y la memoria sería inerte sin que nada fallara. Se guarda con el mismo
 * con el que se envía, y punto.
 *
 * El dedupe de la corrida NO cambia: sigue siendo `lusha-run-identity-registry`
 * con su propio normalizador (§ 7, «no degradar PR302»).
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

import { normalizeExclusionDomain } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';

// ─── Vocabulario provider-neutral (§ 4) ───────────────────────────────────────

/**
 * Proveedores de PAGO cuya respuesta puede generar memoria.
 *
 * 🔴 La lista es cerrada a propósito. Es la frontera que impide que una fuente
 * gratuita (`co_siis`), HubSpot, un fixture o un mock entren en la memoria de lo
 * pagado (§ 4, lista de exclusiones). Ampliarla es una decisión, no un descuido.
 */
export const PROVIDER_SEEN_PAID_PROVIDERS = ['lusha', 'apollo'] as const;

export type ProviderSeenProvider = (typeof PROVIDER_SEEN_PAID_PROVIDERS)[number];

export function isProviderSeenPaidProvider(value: string): value is ProviderSeenProvider {
  return (PROVIDER_SEEN_PAID_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Qué clase de entidad se recuerda.
 *
 * Hoy sólo `company`. Existe como campo —y no como supuesto implícito— porque la
 * memoria de personas es un problema DISTINTO con reglas de privacidad propias
 * (`provider_suppressions` ya lo gobierna) y mezclarlas en una sola clave sería
 * exactamente el error que #295 corrigió: usar una clave de GASTO como clave de
 * privacidad.
 */
export const PROVIDER_SEEN_ENTITY_TYPES = ['company'] as const;

export type ProviderSeenEntityType = (typeof PROVIDER_SEEN_ENTITY_TYPES)[number];

/** Una identidad recordable. Al menos una de las dos señales es no nula. */
export type ProviderSeenObservation = {
  provider: ProviderSeenProvider;
  entityType: ProviderSeenEntityType;
  /** Id nativo del proveedor, tal cual lo emitió. `null` si no lo trajo. */
  providerEntityId: string | null;
  /** Dominio normalizado con el normalizador de exclusión. `null` si no lo trajo. */
  normalizedDomain: string | null;
};

/** Lo mínimo que hace falta leer de un resultado de proveedor. */
export type ProviderSeenCandidateInput = {
  providerEntityId?: string | null;
  domain?: string | null;
};

/**
 * Clave estable de una observación. Determinista y sin PII.
 *
 * El id manda cuando existe: es la señal más fuerte y la única que sobrevive a
 * que la empresa cambie de web. El dominio es el respaldo.
 */
export function providerSeenObservationKey(observation: ProviderSeenObservation): string {
  const signal =
    observation.providerEntityId !== null
      ? `id:${observation.providerEntityId}`
      : `domain:${observation.normalizedDomain ?? ''}`;
  return `${observation.provider}:${observation.entityType}:${signal}`;
}

function normalizeProviderEntityId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resuelve la identidad recordable de UN resultado.
 *
 * `null` ⇒ no hay nada que recordar. No es un fallo y no se sustituye por nada.
 */
export function resolveProviderSeenObservation(
  provider: ProviderSeenProvider,
  candidate: ProviderSeenCandidateInput,
  entityType: ProviderSeenEntityType = 'company',
): ProviderSeenObservation | null {
  const providerEntityId = normalizeProviderEntityId(candidate.providerEntityId);
  const normalizedDomain = normalizeExclusionDomain(candidate.domain);

  if (providerEntityId === null && normalizedDomain === null) return null;

  return { provider, entityType, providerEntityId, normalizedDomain };
}

// ─── Lote ─────────────────────────────────────────────────────────────────────

export type ProviderSeenObservationBatch = {
  /** Identidades únicas, en el ORDEN de llegada del proveedor. */
  observations: readonly ProviderSeenObservation[];
  /** Resultados sin id NI dominio. No se recuerdan; se cuentan. */
  unidentifiableCount: number;
  /** Resultados repetidos dentro del mismo lote. */
  duplicateCount: number;
};

/**
 * Convierte una página de resultados en identidades únicas.
 *
 * El orden de llegada se conserva —y no se ordena— porque una observación no es
 * una lista que viaje a nadie: es una escritura. Reordenarla sólo cambiaría el
 * orden de los upserts sin ganar nada, mientras que conservarlo hace que un
 * volcado de la memoria se pueda leer contra la respuesta cruda.
 */
export function collectProviderSeenObservations(
  provider: ProviderSeenProvider,
  candidates: readonly ProviderSeenCandidateInput[],
  entityType: ProviderSeenEntityType = 'company',
): ProviderSeenObservationBatch {
  const seen = new Set<string>();
  const observations: ProviderSeenObservation[] = [];
  let unidentifiableCount = 0;
  let duplicateCount = 0;

  for (const candidate of candidates) {
    const observation = resolveProviderSeenObservation(provider, candidate, entityType);
    if (observation === null) {
      unidentifiableCount++;
      continue;
    }
    const key = providerSeenObservationKey(observation);
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    observations.push(observation);
  }

  return { observations, unidentifiableCount, duplicateCount };
}

// ─── Consulta de la memoria ya cargada ────────────────────────────────────────

/**
 * La memoria de corridas ANTERIORES, ya cargada y en forma consultable.
 *
 * Dos conjuntos independientes y nunca una clave combinada: § 5 prohíbe depender
 * de semánticas de ids + dominios mezclados mientras el contrato humano de Lusha
 * no llegue, y esa prohibición empieza aquí, en cómo se guarda en memoria.
 */
export type ProviderSeenMemory = {
  providerEntityIds: ReadonlySet<string>;
  normalizedDomains: ReadonlySet<string>;
};

export const EMPTY_PROVIDER_SEEN_MEMORY: ProviderSeenMemory = {
  providerEntityIds: new Set<string>(),
  normalizedDomains: new Set<string>(),
};

export function buildProviderSeenMemory(
  records: readonly Pick<ProviderSeenObservation, 'providerEntityId' | 'normalizedDomain'>[],
): ProviderSeenMemory {
  const providerEntityIds = new Set<string>();
  const normalizedDomains = new Set<string>();
  for (const record of records) {
    if (record.providerEntityId !== null) providerEntityIds.add(record.providerEntityId);
    if (record.normalizedDomain !== null) normalizedDomains.add(record.normalizedDomain);
  }
  return { providerEntityIds, normalizedDomains };
}

/**
 * ¿Este resultado ya lo habíamos pagado en una corrida anterior?
 *
 * 🔴 Un acierto NO decide nada por sí solo: no descarta, no reduce el objetivo y
 * no sustituye al dedupe local, que sigue siendo la autoridad (§ 6). Es una
 * observación económica —«esto ya lo habíamos visto»— y su único uso legítimo
 * hoy es alimentar el plan de exclusión y la telemetría.
 */
export function isProviderSeenKnown(
  memory: ProviderSeenMemory,
  observation: ProviderSeenObservation,
): boolean {
  if (
    observation.providerEntityId !== null &&
    memory.providerEntityIds.has(observation.providerEntityId)
  ) {
    return true;
  }
  return (
    observation.normalizedDomain !== null &&
    memory.normalizedDomains.has(observation.normalizedDomain)
  );
}

export function countProviderSeenHits(
  memory: ProviderSeenMemory,
  observations: readonly ProviderSeenObservation[],
): number {
  let hits = 0;
  for (const observation of observations) {
    if (isProviderSeenKnown(memory, observation)) hits++;
  }
  return hits;
}
