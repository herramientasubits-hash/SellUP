/**
 * provider-seen-store.ts — el puerto de la memoria provider-seen y, desde este
 * hito, la implementación PERSISTENTE que Producción recibe de verdad.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN §§ 4, 13
 * · AGENT1-PROVIDER-SEEN-MEMORY-3.
 *
 * ── 🔴 Arqueología de esquema, con lo medido en Producción ───────────────────
 *
 * § 4 obliga a auditar el esquema ANTES de proponer una tabla. Se auditó
 * (Producción, sólo lectura, 2026-08-20) y NO existe autoridad reutilizable:
 *
 *   · `prospect_candidates` — no tiene columna de id de proveedor. El id de Lusha
 *     vive dentro de `source_trace->>'providerCompanyId'` y SÓLO cuando el
 *     candidato llegó a persistirse (66/66 candidatos Lusha lo llevan). Es decir,
 *     la huella existe justo para lo que no hace falta recordar. Y para Apollo ni
 *     eso: **0 de 10 candidatos Apollo conservan su Organization ID**, aunque el
 *     normalizador de respuesta sí lo tiene en memoria
 *     (`ApolloProviderReference.providerOrganizationId`).
 *   · `provider_suppressions` — clave única `(provider, provider_person_id)`. Es
 *     una autoridad de PRIVACIDAD sobre personas. Reutilizarla para economía de
 *     empresas repetiría literalmente el defecto que #295 corrigió: usar una clave
 *     de gasto como clave de privacidad. No se toca.
 *   · `provider_usage_logs` — UNA fila AGREGADA por corrida (#307). No tiene, ni
 *     debe tener, identidad por empresa.
 *   · `source_company_snapshots` / `source_company_signals` — memoria de fuentes
 *     OFICIALES por país, con `source_key`, `tax_id` y `raw_data`. No modelan un
 *     registro de proveedor de pago y meter Lusha ahí falsearía su semántica.
 *   · `provider_industry_raw_label_observations` — la más parecida en FORMA
 *     (`provider_key` + clave normalizada + `first/last_observed_at` +
 *     `first/last_observed_run_id`, upsert por observación). Guarda etiquetas de
 *     industria, no identidad de empresa: sirve de precedente de diseño, no de
 *     autoridad.
 *
 * Conclusión: hacía falta una tabla nueva. Se propuso
 * (`docs/agent1/provider-seen-memory-schema-proposal.md`), se escribió como
 * migración 123 y la dueña la APLICÓ en Producción —versión `20260820153919`, tabla
 * y RPC verificadas, 0 filas, `service_role` sin DELETE— ANTES de que este archivo
 * apuntara a ella.
 *
 * ── 🔴 Qué significa eso para el runtime, ahora ──────────────────────────────
 *
 * `resolveProviderSeenStore()` devuelve el store PERSISTENTE. Lo que cambia con
 * respecto al gate anterior es exactamente una cosa: la memoria ya sobrevive a la
 * corrida. Lo que NO cambia es quién decide: la memoria se lee para EXPLICAR y
 * para construir la pista de exclusión, y se escribe para recordar; el dedupe
 * local sigue siendo la única autoridad sobre qué se persiste (§ 6), y ningún
 * acierto de memoria recorta el objetivo (`residualGap`), que lo fija la capa
 * gratuita y sólo ella.
 *
 * 🔴 El orden importaba y se respetó: primero la tabla, después el resolutor. Al
 * revés, cada corrida habría escrito contra una tabla inexistente.
 *
 * ── 🔴 Un fallo de memoria no puede costar dinero ni repetir una petición ────
 *
 * Si la credencial de servidor no se puede construir —env ausente o inseguro: la
 * factoría aprobada falla CERRADA— el resolutor degrada al puerto que no persiste
 * y lo DICE con su propio motivo. No degrada al no-op de «autoridad pendiente»,
 * porque la autoridad ya existe y confundir «no hay tabla» con «no hay credencial»
 * es justo el diagnóstico que hace perder una tarde.
 *
 * 🔴 Y el doble en memoria sigue sin ser una alternativa de Producción: una memoria
 * por proceso mentiría entre despliegues y entre instancias, y una memoria que a
 * veces recuerda es peor que una que nunca lo hace, porque nadie sabría cuál de
 * las dos cosas estaba pasando cuando una corrida costó de más.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type {
  ProviderSeenEntityType,
  ProviderSeenObservation,
  ProviderSeenProvider,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { createSupabaseProviderSeenStore } from './provider-seen-supabase-store';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Una identidad recordada, con su ventana de observación. */
export type ProviderSeenRecord = {
  provider: ProviderSeenProvider;
  entityType: ProviderSeenEntityType;
  providerEntityId: string | null;
  normalizedDomain: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Correlación de la corrida que la vio por primera vez. */
  firstSeenCorrelation: string | null;
  /** Correlación de la corrida más reciente que la volvió a ver. */
  lastSeenCorrelation: string | null;
};

export type ProviderSeenLoadQuery = {
  provider: ProviderSeenProvider;
  entityType?: ProviderSeenEntityType;
  /**
   * Tope de filas. Obligatorio: una memoria sin cota crecería hasta convertir la
   * capa gratuita en la parte cara de la corrida.
   */
  limit: number;
};

export type ProviderSeenWriteInput = {
  observations: readonly ProviderSeenObservation[];
  /** Identidad de la corrida. Sin PII. */
  correlationId: string | null;
  /** Instante observado. Lo inyecta el llamador: aquí no hay reloj. */
  observedAt: string;
};

export type ProviderSeenWriteResult = {
  /** `false` ⇒ no se escribió nada, y `skippedReason` dice por qué. */
  written: boolean;
  skippedReason: string | null;
  /** Identidades cuyo id no estaba en la memoria antes de esta escritura. */
  newIdsRecorded: number;
  /** Identidades cuyo dominio no estaba en la memoria antes de esta escritura. */
  newDomainsRecorded: number;
  /** Identidades ya conocidas cuya ventana se extendió. */
  refreshedCount: number;
};

export type ProviderSeenStore = {
  load(query: ProviderSeenLoadQuery): Promise<readonly ProviderSeenRecord[]>;
  record(input: ProviderSeenWriteInput): Promise<ProviderSeenWriteResult>;
};

export const PROVIDER_SEEN_WRITE_SKIPPED_NO_AUTHORITY = 'persistence_authority_pending';

/**
 * La tabla existe, pero esta ejecución no pudo construir una credencial de
 * servidor segura. Se distingue del motivo de arriba a propósito: «no hay tabla» y
 * «no hay credencial» se arreglan en sitios distintos.
 */
export const PROVIDER_SEEN_WRITE_SKIPPED_CLIENT_UNAVAILABLE = 'persistence_client_unavailable';

/** Tope por defecto de la carga. Decisión propia, igual que el de exclusión. */
export const PROVIDER_SEEN_LOAD_LIMIT = 500;

// ─── Puertos que no persisten ─────────────────────────────────────────────────

/**
 * Un puerto que lee vacío y no escribe, con el motivo que le corresponde.
 *
 * 🔴 El motivo NO es decorativo: es lo único que separa «todavía no hay dónde
 * escribir» de «hay dónde, pero no con qué». Una sola forma para las dos cosas
 * obligaría a adivinar cuál de los dos problemas está ocurriendo.
 */
function createNonPersistingProviderSeenStore(skippedReason: string): ProviderSeenStore {
  return {
    async load() {
      return [];
    },
    async record() {
      return {
        written: false,
        skippedReason,
        newIdsRecorded: 0,
        newDomainsRecorded: 0,
        refreshedCount: 0,
      };
    },
  };
}

/**
 * El puerto que no persiste porque no hay autoridad de esquema.
 *
 * Sigue existiendo —y sigue siendo el valor por defecto del gate cuando nadie le
 * inyecta un store, y el que usan las pruebas que quieren memoria vacía— aunque la
 * migración ya esté aplicada: es el fail-soft explícito del diseño.
 */
export const NO_OP_PROVIDER_SEEN_STORE: ProviderSeenStore =
  createNonPersistingProviderSeenStore(PROVIDER_SEEN_WRITE_SKIPPED_NO_AUTHORITY);

/**
 * El puerto que no persiste porque la credencial de servidor no se pudo construir.
 * Fail-soft del resolutor: la corrida sigue y gasta lo de siempre.
 */
export const CLIENT_UNAVAILABLE_PROVIDER_SEEN_STORE: ProviderSeenStore =
  createNonPersistingProviderSeenStore(PROVIDER_SEEN_WRITE_SKIPPED_CLIENT_UNAVAILABLE);

/**
 * Estado de la persistencia, publicado para que la telemetría pueda decir la
 * verdad en vez de dejar un 0 sin explicación.
 *
 * 🔴 Ratchet invertido en AGENT1-PROVIDER-SEEN-MEMORY-3: la migración 123 está
 * APLICADA en Producción (`20260820153919`), así que declarar «pendiente» habría
 * pasado de ser una advertencia útil a ser un dato falso.
 */
export const PROVIDER_SEEN_PERSISTENCE_STATUS = 'schema_applied' as const;

/**
 * La implementación que usa Producción.
 *
 * 🔴 UN solo sitio decide. Devuelve el store persistente contra
 * `provider_seen_entities`; si la factoría aprobada no puede producir un cliente
 * —falla CERRADA cuando el env falta o es inseguro— degrada al puerto que no
 * persiste y que lo dice, en vez de lanzar. Lanzar aquí tumbaría una corrida por un
 * problema de memoria, que es exactamente lo que la memoria no puede permitirse:
 * una optimización que puede tirar la operación deja de serlo.
 *
 * Se llama UNA vez por corrida desde el cableado de servidor; no memoriza el
 * cliente en un singleton de módulo para no arrastrar credenciales entre
 * invocaciones de un runtime que se reutiliza.
 */
export function resolveProviderSeenStore(): ProviderSeenStore {
  try {
    return createSupabaseProviderSeenStore(createSupabaseAdminClient());
  } catch {
    return CLIENT_UNAVAILABLE_PROVIDER_SEEN_STORE;
  }
}

/**
 * `false` cuando el lote no traía ninguna observación. No es un fallo: es una
 * respuesta válida sin nada identificable, y decirlo es más honesto que devolver
 * una escritura de cero filas como si hubiera ocurrido.
 */
export const PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS = 'no_observations';

/** Orden temporal robusto: dos instantes ISO pueden venir con husos distintos. */
function isBefore(candidate: string, reference: string): boolean {
  const a = Date.parse(candidate);
  const b = Date.parse(reference);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a < b;
}

/**
 * La regla del dominio, en un solo sitio:
 *
 *   · un nulo NUNCA borra —la ausencia de observación no es observación de ausencia;
 *   · un dominio que llega donde no había nada COMPLETA, aunque sea más viejo:
 *     completar no pierde nada;
 *   · entre dos no nulos gana el que no sea más viejo.
 */
function mergeNormalizedDomain(
  stored: string | null,
  observed: string | null,
  observedIsNotOlder: boolean,
): string | null {
  if (observed === null) return stored;
  if (stored === null) return observed;
  return observedIsNotOlder ? observed : stored;
}

// ─── Doble en memoria: SÓLO pruebas ───────────────────────────────────────────

/**
 * Memoria en proceso, con la MISMA semántica de upsert que tendría la tabla:
 * clave por `(provider, entityType, id ?? dominio)`, `first_seen_*` inmutable y
 * `last_seen_*` reescrito en cada observación.
 *
 * 🔴 Existe para que las pruebas puedan demostrar el comportamiento
 * cross-corrida sin base de datos —una corrida escribe, la siguiente lee— y para
 * que la semántica esperada esté fijada por pruebas ANTES de que la migración se
 * autorice. No se usa en Producción (ver la cabecera).
 */
export function createInMemoryProviderSeenStore(
  seed: readonly ProviderSeenRecord[] = [],
): ProviderSeenStore & { snapshot(): readonly ProviderSeenRecord[] } {
  const records = new Map<string, ProviderSeenRecord>();

  const keyOf = (
    provider: ProviderSeenProvider,
    entityType: ProviderSeenEntityType,
    providerEntityId: string | null,
    normalizedDomain: string | null,
  ): string =>
    `${provider}:${entityType}:${providerEntityId !== null ? `id:${providerEntityId}` : `domain:${normalizedDomain ?? ''}`}`;

  for (const record of seed) {
    records.set(
      keyOf(record.provider, record.entityType, record.providerEntityId, record.normalizedDomain),
      record,
    );
  }

  return {
    async load(query) {
      const entityType = query.entityType ?? 'company';
      const limit = Math.max(0, Math.trunc(query.limit));
      return [...records.values()]
        .filter((record) => record.provider === query.provider && record.entityType === entityType)
        .slice(0, limit);
    },

    async record(input) {
      if (input.observations.length === 0) {
        return {
          written: false,
          skippedReason: PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS,
          newIdsRecorded: 0,
          newDomainsRecorded: 0,
          refreshedCount: 0,
        };
      }

      const knownIds = new Set<string>();
      const knownDomains = new Set<string>();
      for (const record of records.values()) {
        if (record.providerEntityId !== null) knownIds.add(record.providerEntityId);
        if (record.normalizedDomain !== null) knownDomains.add(record.normalizedDomain);
      }

      let newIdsRecorded = 0;
      let newDomainsRecorded = 0;
      let refreshedCount = 0;

      for (const observation of input.observations) {
        const key = keyOf(
          observation.provider,
          observation.entityType,
          observation.providerEntityId,
          observation.normalizedDomain,
        );
        const existing = records.get(key);

        if (observation.providerEntityId !== null && !knownIds.has(observation.providerEntityId)) {
          newIdsRecorded++;
          knownIds.add(observation.providerEntityId);
        }
        if (observation.normalizedDomain !== null && !knownDomains.has(observation.normalizedDomain)) {
          newDomainsRecorded++;
          knownDomains.add(observation.normalizedDomain);
        }

        if (existing) {
          refreshedCount++;
          // La MISMA mezcla que hace `record_provider_seen_entities` en SQL. Está
          // escrita dos veces porque hay dos implementaciones del puerto, no porque
          // haya dos reglas: `first_seen_*` no se mueve, `last_seen_at` sólo avanza,
          // la correlación sigue al instante que ganó y el dominio se completa o se
          // reemplaza por una observación NO nula que no sea más vieja.
          const notOlder = !isBefore(input.observedAt, existing.lastSeenAt);
          records.set(key, {
            ...existing,
            normalizedDomain: mergeNormalizedDomain(
              existing.normalizedDomain,
              observation.normalizedDomain,
              notOlder,
            ),
            lastSeenAt: notOlder ? input.observedAt : existing.lastSeenAt,
            lastSeenCorrelation: notOlder ? input.correlationId : existing.lastSeenCorrelation,
          });
          continue;
        }

        records.set(key, {
          provider: observation.provider,
          entityType: observation.entityType,
          providerEntityId: observation.providerEntityId,
          normalizedDomain: observation.normalizedDomain,
          firstSeenAt: input.observedAt,
          lastSeenAt: input.observedAt,
          firstSeenCorrelation: input.correlationId,
          lastSeenCorrelation: input.correlationId,
        });
      }

      return {
        written: true,
        skippedReason: null,
        newIdsRecorded,
        newDomainsRecorded,
        refreshedCount,
      };
    },

    snapshot() {
      return [...records.values()];
    },
  };
}
