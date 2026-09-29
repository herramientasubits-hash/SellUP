/**
 * provider-seen-memory-serialization.ts — la memoria provider-seen atraviesa JSON.
 *
 * AGENT1-CONTINUATION-PROVIDER-SEEN-REHYDRATE-1.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * `ProviderSeenMemory` es `Set` + `Set` + `Map`. La cola de continuaciones de
 * Apollo guarda el `run_input` entero como JSON, y JSON convierte TODO `Set` y
 * TODO `Map` en `{}` sin avisar. Al reanudar, `isProviderSeenKnown` llamaba
 * `memory.providerEntityIds.has(...)` sobre ese `{}`:
 *
 *     TypeError: a.providerEntityIds.has is not a function
 *
 * Medido en Producción el 2026-09-29 (México × Tecnología, lote `754e169e`): la
 * corrida se pausó por tiempo, su continuación falló en el primer intento y nunca
 * pudo completarse. Como pasa por aquí TODA corrida de Apollo que se pausa, ese
 * camino no había funcionado nunca en Producción.
 *
 * ── Qué hace este módulo ──────────────────────────────────────────────────────
 *
 *   · `serializeProviderSeenMemory` — a listas planas, que JSON sí conserva. Los
 *     datos ya no se pierden al encolar.
 *   · `reviveProviderSeenMemory` — de vuelta a `Set`/`Map`. Acepta lo que pueda
 *     llegar de la base: listas (el formato nuevo), `{}` (las filas ya encoladas
 *     antes de este corte), instancias reales (el camino sin JSON) y basura.
 *
 * 🔴 Lo ilegible degrada a memoria VACÍA, nunca lanza. La memoria provider-seen es
 * una observación económica —«esto ya lo habíamos visto»—: no descarta, no reduce
 * el objetivo y no sustituye al dedupe local (ver `isProviderSeenKnown`). Perderla
 * cuesta, a lo sumo, volver a ver una empresa; un `TypeError` en medio de una
 * corrida pagada cuesta la corrida entera.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

import type { ProviderSeenMemory } from './provider-seen-identity';

export type SerializedProviderSeenMemory = {
  providerEntityIds: string[];
  normalizedDomains: string[];
  domainLastSeenAt?: Array<[string, string]>;
};

function toStringList(value: unknown): string[] {
  const items: unknown[] =
    value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return items.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function toEntryList(value: unknown): Array<[string, string]> {
  const entries: unknown[] =
    value instanceof Map ? [...value.entries()] : Array.isArray(value) ? value : [];
  const out: Array<[string, string]> = [];
  for (const entry of entries) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'string'
    ) {
      out.push([entry[0], entry[1]]);
    }
  }
  return out;
}

/** A una forma que `JSON.stringify` conserva. Idempotente sobre su propia salida. */
export function serializeProviderSeenMemory(memory: unknown): SerializedProviderSeenMemory {
  const source = (memory ?? {}) as Record<string, unknown>;
  const lastSeen = toEntryList(source.domainLastSeenAt);
  return {
    providerEntityIds: toStringList(source.providerEntityIds),
    normalizedDomains: toStringList(source.normalizedDomains),
    ...(lastSeen.length > 0 ? { domainLastSeenAt: lastSeen } : {}),
  };
}

/** De vuelta a `Set`/`Map`. Nunca lanza: lo ilegible es memoria vacía. */
export function reviveProviderSeenMemory(raw: unknown): ProviderSeenMemory {
  const source = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lastSeen = toEntryList(source.domainLastSeenAt);
  return {
    providerEntityIds: new Set(toStringList(source.providerEntityIds)),
    normalizedDomains: new Set(toStringList(source.normalizedDomains)),
    ...(lastSeen.length > 0 ? { domainLastSeenAt: new Map(lastSeen) } : {}),
  };
}

/**
 * `priorProviderSeen` de un `run_input` (`{ available, memory }` o
 * `{ available:false, unavailableReason }`), listo para JSON.
 */
export function serializePriorProviderSeen<T>(prior: T): T {
  if (prior === null || typeof prior !== 'object') return prior;
  const record = prior as unknown as { available?: unknown; memory?: unknown };
  if (record.available !== true) return prior;
  return { ...prior, memory: serializeProviderSeenMemory(record.memory) } as T;
}

/** El inverso: lo que volvió de la base, listo para usarse. */
export function revivePriorProviderSeen<T>(prior: T): T {
  if (prior === null || typeof prior !== 'object') return prior;
  const record = prior as unknown as { available?: unknown; memory?: unknown };
  if (record.available !== true) return prior;
  return { ...prior, memory: reviveProviderSeenMemory(record.memory) } as T;
}
