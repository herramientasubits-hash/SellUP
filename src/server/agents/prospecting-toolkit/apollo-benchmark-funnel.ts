/**
 * apollo-benchmark-funnel.ts — el embudo de Apollo company discovery, con los
 * MISMOS nombres de negocio que el de Lusha y sin un solo número fabricado.
 *
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P1-3.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────────
 *
 * La ruta Lusha ya publica su rendimiento en la fila de uso
 * (`reviewable_found_total`, `accepted_for_target_total`, `precision_rejected`,
 * `historical_active_skips`, …). La de Apollo no publicaba nada equivalente, así
 * que las dos no se podían comparar: cualquier decisión de volumen entre
 * proveedores se estaba tomando sin la mitad de los datos.
 *
 * ── 🔴 La regla que gobierna este módulo entero ──────────────────────────────
 *
 * Un campo que la ruta Apollo NO puede producir con verdad en la capa de
 * registro se publica como `null` y se NOMBRA en `fields_missing`, junto con la
 * costura exacta que falta. Jamás como 0.
 *
 * Un 0 dice «lo medimos y salió cero». Un null dice «no lo medimos». Colapsar el
 * segundo en el primero es exactamente lo que hace que un benchmark elija el
 * proveedor equivocado con total confianza.
 *
 * ── 🔴 `accepted_for_target` no se reinterpreta ──────────────────────────────
 *
 * En la ruta Lusha significa «empresas que contribuyeron REALMENTE a satisfacer
 * el objetivo pedido», y lo decide la admisión del writer. En la capa del
 * provider de Apollo ese hecho todavía no ha ocurrido: aquí sólo se sabe cuántas
 * pasaron el gate sectorial de ESTA consulta, y publicar eso bajo el mismo nombre
 * crearía una segunda definición del mismo campo — que es justamente lo que
 * haría incomparables los dos embudos. Se publica null y se nombra la costura.
 *
 * Puro: sin env, sin I/O, sin proveedor, sin DB, sin reloj.
 */

/** Clave del bloque en `metadata`. */
export const APOLLO_BENCHMARK_FUNNEL_METADATA_KEY = 'apollo_benchmark_funnel' as const;

/** Los siete campos del embudo, en el orden en que ocurren. */
export const APOLLO_BENCHMARK_FUNNEL_FIELDS = [
  'paid_raw',
  'unique',
  'provider_seen_hit',
  'historical_known',
  'duplicate',
  'precision_rejected',
  'accepted_for_target',
] as const;

export type ApolloBenchmarkFunnelField = (typeof APOLLO_BENCHMARK_FUNNEL_FIELDS)[number];

/**
 * Cómo se obtuvo cada cifra.
 *
 * `observed` — contada en el punto donde ocurre.
 * `derived`  — calculada a partir de contadores que el pipeline ya producía.
 * `missing`  — no se puede producir con verdad aquí todavía.
 */
export type ApolloBenchmarkFunnelFieldSource = 'observed' | 'derived' | 'missing';

// ─── Costuras que faltan, nombradas ───────────────────────────────────────────

/**
 * La ruta Apollo no carga la memoria provider-seen ANTES de buscar, así que no
 * hay con qué cruzar lo devuelto. Cargarla es enrutamiento —P0-3— y este corte
 * es explícitamente sólo medición.
 */
export const APOLLO_FUNNEL_SEAM_PROVIDER_SEEN_HIT =
  'apollo_route_does_not_load_provider_seen_memory_before_search' as const;

/**
 * El cruce contra candidatos históricos activos ocurre AGUAS ABAJO de este
 * provider (resolución de estado duplicado del pipeline de admisión) y su
 * resultado no vuelve a la fila de uso de la búsqueda.
 */
export const APOLLO_FUNNEL_SEAM_HISTORICAL_KNOWN =
  'historical_duplicate_state_resolved_downstream_and_not_correlated_back_to_search_usage_row' as const;

/**
 * Qué empresas satisficieron el objetivo lo decide el writer de candidatos,
 * después de agregar TODAS las consultas de la corrida. La búsqueda individual
 * no lo puede saber sin inventarlo.
 */
export const APOLLO_FUNNEL_SEAM_ACCEPTED_FOR_TARGET =
  'target_satisfaction_decided_by_candidate_writer_across_all_queries_not_correlated_back_to_search_usage_row' as const;

/**
 * Sobre qué población se contó `precision_rejected`.
 *
 * 🔴 Importa y por eso se publica: el gate sectorial evalúa lo que quedó DESPUÉS
 * del dedupe entre páginas y del tope de candidatos, no las filas crudas que se
 * pagaron. Sin esta etiqueta, alguien restaría `precision_rejected` de `paid_raw`
 * y obtendría un número que no significa nada.
 */
export const APOLLO_FUNNEL_PRECISION_REJECTED_BASIS =
  'apollo_sector_relevance_gate_over_collected_after_local_filters' as const;

export type ApolloBenchmarkFunnelInput = {
  /** Filas que Apollo devolvió, ANTES de dedupe y truncado locales. */
  paidRaw: number;
  /** Identidades únicas de proveedor dentro de lo devuelto. */
  unique: number;
  /** Repetidas dentro de la página y entre páginas de la MISMA búsqueda. */
  duplicate: number;
  /** Rechazadas por el gate sectorial de esta búsqueda. `null` si no corrió. */
  precisionRejected: number | null;
  /** `null` mientras la memoria no se cargue en esta ruta. */
  providerSeenHit: number | null;
  /** `null` mientras el cruce histórico no vuelva a esta fila. */
  historicalKnown: number | null;
  /** `null` mientras el writer no correlacione su admisión con esta fila. */
  acceptedForTarget: number | null;
};

/**
 * Construye el bloque del embudo.
 *
 * Los nombres son planos y snake_case a propósito: si un consumidor tuviera que
 * reconstruirlos concatenando rutas de un objeto anidado, el nombre acordado
 * dejaría de existir en la práctica.
 */
export function buildApolloBenchmarkFunnelMetadata(
  input: ApolloBenchmarkFunnelInput,
): Record<string, unknown> {
  const values: Record<ApolloBenchmarkFunnelField, number | null> = {
    paid_raw: input.paidRaw,
    unique: input.unique,
    provider_seen_hit: input.providerSeenHit,
    historical_known: input.historicalKnown,
    duplicate: input.duplicate,
    precision_rejected: input.precisionRejected,
    accepted_for_target: input.acceptedForTarget,
  };

  const sources: Record<ApolloBenchmarkFunnelField, ApolloBenchmarkFunnelFieldSource> = {
    paid_raw: 'observed',
    unique: 'observed',
    provider_seen_hit: input.providerSeenHit === null ? 'missing' : 'observed',
    historical_known: input.historicalKnown === null ? 'missing' : 'observed',
    duplicate: 'observed',
    precision_rejected: input.precisionRejected === null ? 'missing' : 'derived',
    accepted_for_target: input.acceptedForTarget === null ? 'missing' : 'derived',
  };

  const missingSeams: Record<string, string> = {};
  if (input.providerSeenHit === null) {
    missingSeams['provider_seen_hit'] = APOLLO_FUNNEL_SEAM_PROVIDER_SEEN_HIT;
  }
  if (input.historicalKnown === null) {
    missingSeams['historical_known'] = APOLLO_FUNNEL_SEAM_HISTORICAL_KNOWN;
  }
  if (input.acceptedForTarget === null) {
    missingSeams['accepted_for_target'] = APOLLO_FUNNEL_SEAM_ACCEPTED_FOR_TARGET;
  }

  return {
    ...values,
    field_sources: sources,
    // 🔴 Los nombres de lo que NO se midió, explícitos. Sin esta lista, un null
    // se lee como un descuido en vez de como un límite declarado.
    fields_missing: APOLLO_BENCHMARK_FUNNEL_FIELDS.filter(
      (field) => values[field] === null,
    ),
    missing_correlation_seams: missingSeams,
    precision_rejected_basis:
      input.precisionRejected === null ? null : APOLLO_FUNNEL_PRECISION_REJECTED_BASIS,
  };
}
