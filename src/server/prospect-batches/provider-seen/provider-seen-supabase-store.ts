/**
 * provider-seen-supabase-store.ts — la implementación PERSISTENTE del puerto
 * `ProviderSeenStore`, contra la tabla `provider_seen_entities`.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN §§ 4, 13
 * · AGENT1-PROVIDER-SEEN-MEMORY-2.
 *
 * ── 🔴 Existe, está probada, y NO está encendida ─────────────────────────────
 *
 * `resolveProviderSeenStore()` sigue devolviendo el NO-OP. Este módulo no lo
 * sustituye, no se importa desde ningún camino de Producción y una prueba estática
 * lo comprueba. Encenderla es una decisión de la dueña que exige, en este orden:
 * aplicar la migración en Producción y recién entonces cambiar qué devuelve ese
 * resolutor. Al revés —resolutor primero— cada corrida escribiría contra una tabla
 * que no existe.
 *
 * ── 🔴 Por qué la escritura es una FUNCIÓN de SQL y no un `upsert()` ────────
 *
 * La identidad tiene DOS índices únicos parciales (id nativo cuando existe,
 * dominio sólo cuando no). PostgREST no sabe expresar ni un destino de conflicto
 * parcial ni la mezcla ordenada que la ventana necesita, así que un `upsert()` de
 * cliente obligaría a partir la semántica entre SQL y TypeScript. Eso es
 * exactamente cómo un esquema y su cliente acaban con dos ideas distintas de qué
 * es la misma empresa. La semántica vive ENTERA en `record_provider_seen_entities`
 * y este módulo sólo transporta.
 *
 * ── 🔴 Ningún fallo de memoria puede costar dinero ──────────────────────────
 *
 * Ni `load` ni `record` lanzan. Una lectura que falla devuelve memoria VACÍA, que
 * significa 0 aciertos, 0 exclusiones nuevas y el gasto de hoy; una escritura que
 * falla se REPORTA con su motivo. Lo que nunca puede pasar es que un problema de
 * esta tabla aborte la corrida o provoque otra petición al proveedor: la memoria
 * es una optimización, y una optimización que puede tirar la operación deja de
 * serlo.
 *
 * No llama a ningún proveedor, no toca presupuesto, no escribe observabilidad de
 * gasto y no decide dedupe.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ProviderSeenEntityType,
  ProviderSeenProvider,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import {
  type ProviderSeenLoadQuery,
  type ProviderSeenRecord,
  type ProviderSeenStore,
  type ProviderSeenWriteInput,
  type ProviderSeenWriteResult,
} from './provider-seen-store';

/** La tabla. Un solo sitio la nombra. */
export const PROVIDER_SEEN_TABLE = 'provider_seen_entities';

/** La función que posee la semántica de upsert. Un solo sitio la nombra. */
export const PROVIDER_SEEN_RECORD_RPC = 'record_provider_seen_entities';

/** Motivos de escritura no realizada. Se reportan; nunca se lanzan. */
export const PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS = 'no_observations';
export const PROVIDER_SEEN_WRITE_SKIPPED_PERSISTENCE_ERROR = 'persistence_error';

type PersistedRow = {
  provider: string | null;
  provider_entity_type: string | null;
  provider_entity_id: string | null;
  normalized_domain: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  first_seen_correlation: string | null;
  last_seen_correlation: string | null;
};

function toRecord(
  row: PersistedRow,
  provider: ProviderSeenProvider,
  entityType: ProviderSeenEntityType,
): ProviderSeenRecord | null {
  const providerEntityId = row.provider_entity_id ?? null;
  const normalizedDomain = row.normalized_domain ?? null;
  // Una fila sin ninguna señal no puede existir (CHECK de la tabla). Si aparece,
  // se descarta en vez de propagarse: una identidad vacía envenenaría la memoria.
  if (providerEntityId === null && normalizedDomain === null) return null;
  if (row.first_seen_at === null || row.last_seen_at === null) return null;

  return {
    provider,
    entityType,
    providerEntityId,
    normalizedDomain,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    firstSeenCorrelation: row.first_seen_correlation ?? null,
    lastSeenCorrelation: row.last_seen_correlation ?? null,
  };
}

function readCount(payload: unknown, key: string): number {
  if (payload === null || typeof payload !== 'object') return 0;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * El store persistente.
 *
 * El cliente se INYECTA. No se resuelve aquí dentro para que la elección de
 * credencial siga viviendo en el cableado de servidor —donde ya vive la del resto
 * del hito— y para que las pruebas puedan ejercitar el transporte sin red.
 */
export function createSupabaseProviderSeenStore(client: SupabaseClient): ProviderSeenStore {
  return {
    async load(query: ProviderSeenLoadQuery): Promise<readonly ProviderSeenRecord[]> {
      const entityType: ProviderSeenEntityType = query.entityType ?? 'company';
      // El tope es OBLIGATORIO y se sanea aquí: una carga sin cota convertiría la
      // capa gratuita en la parte cara de la corrida.
      const limit = Math.max(0, Math.trunc(query.limit));
      if (limit === 0) return [];

      try {
        const { data, error } = await client
          .from(PROVIDER_SEEN_TABLE)
          .select(
            'provider, provider_entity_type, provider_entity_id, normalized_domain, ' +
              'first_seen_at, last_seen_at, first_seen_correlation, last_seen_correlation',
          )
          .eq('provider', query.provider)
          .eq('provider_entity_type', entityType)
          // Orden DETERMINISTA: lo más reciente primero y `id` como desempate, para
          // que dos corridas idénticas carguen exactamente la misma página.
          .order('last_seen_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(limit);

        if (error || !data) return [];

        const records: ProviderSeenRecord[] = [];
        // `select()` con columnas por cadena no puede inferir la forma; el doble paso
        // por `unknown` es el que el compilador exige, y `toRecord` valida cada fila.
        for (const row of data as unknown as PersistedRow[]) {
          const record = toRecord(row, query.provider, entityType);
          if (record !== null) records.push(record);
        }
        return records;
      } catch {
        return [];
      }
    },

    async record(input: ProviderSeenWriteInput): Promise<ProviderSeenWriteResult> {
      // Defensa de frontera: el tipo ya garantiza al menos una señal, pero `record`
      // es un borde público y una fila sin identidad ocuparía cupo sin poder
      // coincidir jamás. La tabla la rechazaría; aquí ni siquiera viaja.
      const payload = input.observations
        .filter((o) => o.providerEntityId !== null || o.normalizedDomain !== null)
        .map((o) => ({
          provider: o.provider,
          entity_type: o.entityType,
          provider_entity_id: o.providerEntityId,
          normalized_domain: o.normalizedDomain,
        }));

      if (payload.length === 0) {
        return {
          written: false,
          skippedReason: PROVIDER_SEEN_WRITE_SKIPPED_NO_OBSERVATIONS,
          newIdsRecorded: 0,
          newDomainsRecorded: 0,
          refreshedCount: 0,
        };
      }

      try {
        const { data, error } = await client.rpc(PROVIDER_SEEN_RECORD_RPC, {
          p_observations: payload,
          p_correlation: input.correlationId,
          p_observed_at: input.observedAt,
        });

        if (error) {
          return {
            written: false,
            skippedReason: PROVIDER_SEEN_WRITE_SKIPPED_PERSISTENCE_ERROR,
            newIdsRecorded: 0,
            newDomainsRecorded: 0,
            refreshedCount: 0,
          };
        }

        return {
          written: true,
          skippedReason: null,
          newIdsRecorded: readCount(data, 'new_ids_recorded'),
          newDomainsRecorded: readCount(data, 'new_domains_recorded'),
          refreshedCount: readCount(data, 'refreshed_count'),
        };
      } catch {
        return {
          written: false,
          skippedReason: PROVIDER_SEEN_WRITE_SKIPPED_PERSISTENCE_ERROR,
          newIdsRecorded: 0,
          newDomainsRecorded: 0,
          refreshedCount: 0,
        };
      }
    },
  };
}
