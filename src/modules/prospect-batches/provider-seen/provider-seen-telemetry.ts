/**
 * provider-seen-telemetry.ts — los nombres normalizados de § 10, y la línea que
 * no se cruza.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 · ADDENDUM PROVIDER-SEEN §§ 9, 10.
 *
 * ── 🔴 Nada de economía derivada (§ 9) ───────────────────────────────────────
 *
 * No hay `credits_saved` ni `usd_saved`, aquí tampoco. Un ahorro exige el
 * contrafactual —lo que la corrida HABRÍA gastado— y ese número no lo calculó
 * nadie. Lo único que se publica son hechos que alguien puede contar mirando la
 * corrida: peticiones que no se emitieron y páginas que no se compraron.
 *
 * 🔴 `requests_avoided` y `pages_avoided` se publican SÓLO cuando son
 * determinísticos, es decir cuando existe una regla que dice exactamente cuántas
 * peticiones se dejaron de emitir: hueco cerrado a cero antes de pedir, y páginas
 * segundas canceladas por rama seca. Un «habríamos pedido más» que dependa del
 * comportamiento del proveedor no entra.
 *
 * ── 🔴 `provider_seen_*` no es un ledger financiero (§ 9) ────────────────────
 *
 * M121 sigue siendo la autoridad económica y `provider_usage_logs` la
 * observabilidad de gasto. Esta memoria no participa en ninguna de las dos: sus
 * conteos describen conocimiento, no dinero.
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import type { PrePaidFreeSourceOutcome } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import type { ProviderExclusionPlan } from './provider-exclusion-planner';

/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 § 12 — cómo terminó la LECTURA, aparte de
 * cuánto trajo.
 *
 * 🔴 `loaded` no sirve para esto y no se puede reinterpretar: significa «entró
 * memoria en esta corrida», y por eso es `false` tanto con la tabla vacía como con
 * la lectura rota. Esa fusión es correcta para el plan de exclusión —sin filas no
 * hay nada que excluir, venga de donde venga— y es exactamente lo que un embudo de
 * benchmark NO puede tolerar: «se midió y salió cero» y «no se pudo medir» son la
 * diferencia entre un 0 y un null.
 *
 * Por eso el campo es NUEVO y aditivo en vez de un cambio de semántica de `loaded`:
 * los consumidores de exclusión siguen leyendo lo mismo que leían.
 */
export type ProviderSeenReadOutcome =
  /** No se intentó: no había proveedor al que excluir, o no había con qué leer. */
  | 'not_attempted'
  /** La lectura funcionó. Puede haber devuelto CERO filas, y eso es un hecho medido. */
  | 'succeeded'
  /** La lectura se intentó y no se pudo completar. No se sabe qué había. */
  | 'unavailable';

/** Lo que la carga de memoria previa rindió, ANTES de pedir nada. */
export type ProviderSeenLoadSummary = {
  /** ¿Se pudo consultar la memoria? `false` con el puerto no-op. */
  loaded: boolean;
  /** Por qué no se cargó. `null` cuando sí se cargó. */
  unavailableReason: string | null;
  idsAvailable: number;
  domainsAvailable: number;
  /**
   * CUT-2 § 12 — cómo terminó la lectura, con independencia de cuántas filas trajo.
   * Ver `ProviderSeenReadOutcome`.
   */
  readOutcome: ProviderSeenReadOutcome;
};

/**
 * Ninguna memoria previa entró en esta corrida.
 *
 * 🔴 AGENT1-PROVIDER-SEEN-MEMORY-3 — el motivo era `persistence_authority_pending`
 * mientras la tabla no existía. Con la 123 APLICADA ese texto habría pasado a ser
 * falso en la primera corrida —tabla vacía, no autoridad pendiente— y habría
 * mandado a quien lo leyera a buscar una migración que ya estaba puesta.
 *
 * El motivo de ahora es el único que es verdad en los tres casos que llegan aquí:
 * no se consultó (no había proveedor al que excluir), se consultó y no había nada,
 * o la lectura falló.
 *
 * 🔴 CUT-2 § 12 — los dos últimos ya SÍ se distinguen, pero por `readOutcome`, no
 * por `loaded`: la fusión de este constante sigue siendo la correcta para el plan de
 * exclusión (sin filas no hay nada que excluir, venga de donde venga) y la distinción
 * vive en el campo nuevo, que es quien decide si un embudo publica un 0 o un null.
 * Este valor por defecto declara `not_attempted`, que es lo que es: nadie leyó.
 */
export const PROVIDER_SEEN_LOAD_UNAVAILABLE: ProviderSeenLoadSummary = {
  loaded: false,
  unavailableReason: 'no_provider_seen_memory_loaded',
  idsAvailable: 0,
  domainsAvailable: 0,
  readOutcome: 'not_attempted',
};

/**
 * CUT-2 § 12 — la lectura se intentó de verdad y NO se pudo completar.
 *
 * 🔴 Distinto de `PROVIDER_SEEN_LOAD_UNAVAILABLE`: aquel dice «no entró memoria»,
 * éste dice «se preguntó y no hubo respuesta». Convertir el segundo en «cero
 * aciertos» sería inventar una medición que nunca ocurrió.
 */
export const PROVIDER_SEEN_LOAD_FAILED: ProviderSeenLoadSummary = {
  loaded: false,
  unavailableReason: 'provider_seen_memory_read_failed',
  idsAvailable: 0,
  domainsAvailable: 0,
  readOutcome: 'unavailable',
};

/**
 * CUT-2 § 12 — la lectura funcionó y la memoria estaba VACÍA.
 *
 * `loaded: false` porque ninguna memoria entró en la corrida —el plan de exclusión
 * no tiene nada que hacer con ella— y `readOutcome: 'succeeded'` porque el hecho se
 * midió. Las dos cosas son ciertas a la vez y por eso hacen falta dos campos.
 */
export const PROVIDER_SEEN_LOAD_EMPTY: ProviderSeenLoadSummary = {
  loaded: false,
  unavailableReason: 'provider_seen_memory_empty',
  idsAvailable: 0,
  domainsAvailable: 0,
  readOutcome: 'succeeded',
};

/** El rendimiento de UNA página ya pagada. */
export type ProviderSeenPageYield = {
  branchIndex: number;
  page: number;
  rawResults: number;
  /** Filas de la página que la memoria previa ya conocía. */
  providerSeenHits: number;
  /** Filas nuevas respecto a la memoria previa. */
  novelAfterProviderSeen: number;
  /** Filas útiles tras el dedupe local y los filtros de siempre. */
  novelUsefulAfterLocalDedupe: number;
};

export type ProviderSeenPaidSummary = {
  rawResults: number;
  providerSeenHits: number;
  novelAfterProviderSeen: number;
  novelUsefulAfterLocalDedupe: number;
  newIdsRecorded: number;
  newDomainsRecorded: number;
  pageYields: readonly ProviderSeenPageYield[];
  /** Motivo de parada por rama. `branch_index → reason`. */
  branchStopReasons: Readonly<Record<number, string>>;
  /**
   * Escrituras de memoria que NO llegaron a la tabla, sobre páginas YA pagadas.
   *
   * 🔴 Existe porque con el puerto persistente encendido un fallo de escritura pasó
   * de imposible a posible, y su síntoma natural —contadores de novedad en 0— es
   * idéntico al de una corrida que sencillamente no vio nada nuevo. Sin este número,
   * la memoria podría estar rota durante semanas pareciendo simplemente aburrida.
   *
   * No es un fallo de la corrida: la página ya está comprada y sus empresas ya están
   * en la mano. Es un fallo de la MEMORIA, y se reporta como tal.
   */
  writeFailures: number;
  /** El motivo de la última escritura no realizada. `null` si no hubo ninguna. */
  lastWriteSkippedReason: string | null;
};

export const EMPTY_PROVIDER_SEEN_PAID_SUMMARY: ProviderSeenPaidSummary = {
  rawResults: 0,
  providerSeenHits: 0,
  novelAfterProviderSeen: 0,
  novelUsefulAfterLocalDedupe: 0,
  newIdsRecorded: 0,
  newDomainsRecorded: 0,
  pageYields: [],
  branchStopReasons: {},
  writeFailures: 0,
  lastWriteSkippedReason: null,
};

/** Hechos observados sobre lo que NO se emitió. Nunca créditos ni dólares. */
export type AvoidedWorkFacts = {
  /** Peticiones que no se emitieron por una regla determinista. */
  requestsAvoided: number;
  /** Páginas que no se compraron por una regla determinista. */
  pagesAvoided: number;
};

export type ProviderSeenTelemetryInput = {
  freeSource: PrePaidFreeSourceOutcome;
  providerSeen: ProviderSeenLoadSummary;
  exclusionPlan: ProviderExclusionPlan;
  paid?: ProviderSeenPaidSummary;
  avoided?: AvoidedWorkFacts;
};

/**
 * Construye el bloque `provider_seen` del `metadata` del lote.
 *
 * Nombres exactamente los de § 10, en snake_case y planos: si el consumidor tiene
 * que reconstruir un nombre concatenando rutas de un objeto anidado, el nombre
 * acordado deja de existir en la práctica.
 */
export function buildProviderSeenTelemetry(
  input: ProviderSeenTelemetryInput,
): Record<string, unknown> {
  const free = input.freeSource;
  const paid = input.paid ?? EMPTY_PROVIDER_SEEN_PAID_SUMMARY;
  const plan = input.exclusionPlan;

  return {
    // ── Fuente de país (gratuita) ──────────────────────────────────────────
    country_source_attempted: free.attempted,
    country_source_raw: free.rawReturned,
    country_source_macro_confirmed: free.macroConfirmed,
    // «Conocidas» = las que SellUp o HubSpot ya tenían. No incluye ambiguas ni
    // rechazadas: ésas no son conocidas, son no confirmadas.
    country_source_known: free.sellupKnown + free.hubspotKnown,
    country_source_novel_accepted: free.acceptedNovel,

    // ── Memoria de proveedor ───────────────────────────────────────────────
    provider_seen_loaded: input.providerSeen.loaded,
    provider_seen_unavailable_reason: input.providerSeen.unavailableReason,
    provider_seen_ids_available: input.providerSeen.idsAvailable,
    provider_seen_domains_available: input.providerSeen.domainsAvailable,

    // ── Exclusiones ────────────────────────────────────────────────────────
    provider_exclusion_ids_available: plan.ids.available,
    provider_exclusion_domains_available: plan.domains.available,
    provider_exclusion_ids_sent: plan.ids.sent.length,
    provider_exclusion_domains_sent: plan.domains.sent.length,
    provider_exclusion_ids_unsupported_reason: plan.ids.unsupportedReason,
    provider_exclusion_domains_unsupported_reason: plan.domains.unsupportedReason,

    // ── Lo pagado ──────────────────────────────────────────────────────────
    paid_raw_results: paid.rawResults,
    provider_seen_hits_after_response: paid.providerSeenHits,
    provider_new_ids_recorded: paid.newIdsRecorded,
    provider_new_domains_recorded: paid.newDomainsRecorded,
    novel_after_provider_seen: paid.novelAfterProviderSeen,
    novel_useful_after_local_dedupe: paid.novelUsefulAfterLocalDedupe,
    branch_page_novelty_yield: paid.pageYields.map((entry) => ({
      branch_index: entry.branchIndex,
      page: entry.page,
      raw_results: entry.rawResults,
      provider_seen_hits: entry.providerSeenHits,
      novel_after_provider_seen: entry.novelAfterProviderSeen,
      novel_useful_after_local_dedupe: entry.novelUsefulAfterLocalDedupe,
    })),
    branch_stop_reason: { ...paid.branchStopReasons },

    // ── Salud de la memoria. Un 0 aquí es la única forma de leer los contadores
    //    de novedad de arriba como «no había nada nuevo» y no como «no se guardó».
    provider_seen_write_failures: paid.writeFailures,
    provider_seen_write_skipped_reason: paid.lastWriteSkippedReason,

    // ── Trabajo NO emitido. Hechos, no ahorros. Ver la cabecera. ───────────
    requests_avoided: input.avoided?.requestsAvoided ?? 0,
    pages_avoided: input.avoided?.pagesAvoided ?? 0,
  };
}
