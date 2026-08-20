/**
 * provider-seen-store.ts — el puerto de la memoria provider-seen, y por qué hoy
 * su implementación de Producción no escribe nada.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN §§ 4, 13.
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
 * Conclusión: hace falta una tabla nueva. § 13 del addendum dice STOP y reportar
 * antes de improvisar una migración, y § 0 prohíbe aplicarla. Así que este PR
 * construye el puerto y NO escribe migración: la propuesta mínima está en
 * `docs/agent1/provider-seen-memory-schema-proposal.md`.
 *
 * ── 🔴 Qué significa eso para el runtime ─────────────────────────────────────
 *
 * Producción recibe `NO_OP_PROVIDER_SEEN_STORE`: lee vacío y no escribe. La
 * consecuencia es deliberada y comprobable: memoria vacía ⇒ 0 aciertos ⇒ 0
 * exclusiones por provider-seen ⇒ la corrida se comporta EXACTAMENTE como antes
 * de este PR. Ni un crédito de diferencia. El día que la migración se autorice,
 * lo único que cambia es qué implementación devuelve `resolveProviderSeenStore`.
 *
 * 🔴 Y no, el no-op no se sustituye por el doble en memoria «mientras tanto»: una
 * memoria por proceso mentiría entre despliegues y entre instancias, y una memoria
 * que a veces recuerda es peor que una que nunca lo hace, porque nadie sabría cuál
 * de las dos cosas estaba pasando cuando una corrida costó de más.
 */

import type {
  ProviderSeenEntityType,
  ProviderSeenObservation,
  ProviderSeenProvider,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';

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

/** Tope por defecto de la carga. Decisión propia, igual que el de exclusión. */
export const PROVIDER_SEEN_LOAD_LIMIT = 500;

// ─── Producción: no-op declarado ──────────────────────────────────────────────

export const NO_OP_PROVIDER_SEEN_STORE: ProviderSeenStore = {
  async load() {
    return [];
  },
  async record() {
    return {
      written: false,
      skippedReason: PROVIDER_SEEN_WRITE_SKIPPED_NO_AUTHORITY,
      newIdsRecorded: 0,
      newDomainsRecorded: 0,
      refreshedCount: 0,
    };
  },
};

/**
 * Estado de la persistencia, publicado para que la telemetría pueda decir la
 * verdad en vez de dejar un 0 sin explicación.
 */
export const PROVIDER_SEEN_PERSISTENCE_STATUS = 'pending_schema_authority' as const;

/**
 * La implementación que usa Producción.
 *
 * Devuelve el no-op mientras no exista la tabla. Es una función y no una
 * constante para que el día del cambio haya UN solo sitio que tocar.
 */
export function resolveProviderSeenStore(): ProviderSeenStore {
  return NO_OP_PROVIDER_SEEN_STORE;
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
          records.set(key, {
            ...existing,
            // Un dominio que llega tarde COMPLETA la fila; nunca la borra.
            normalizedDomain: existing.normalizedDomain ?? observation.normalizedDomain,
            lastSeenAt: input.observedAt,
            lastSeenCorrelation: input.correlationId,
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
