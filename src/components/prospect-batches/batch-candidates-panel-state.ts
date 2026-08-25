/**
 * batch-candidates-panel-state.ts — qué dice la ficha del lote sobre sus
 * candidatos, y a dónde manda al operador cuando la tabla heredada no los
 * muestra todos.
 *
 * AGENT1-CUT4-A1 (BATCH COUNT TRUTHFULNESS + SAFE REVIEW NAVIGATION).
 *
 * Por qué existe: el conteo del lote ya es honesto (`batch-candidate-counts`),
 * pero la tabla accionable de la ficha sigue montando `CandidateRowActions`,
 * que FUERA de Prospectos conserva el comportamiento heredado de
 * aprobar/descartar/duplicar. Meter en esa tabla los candidatos que hasta ahora
 * estaban ocultos ampliaría una superficie de acciones insegura, y eso es
 * CUT4-C, no CUT4-A1.
 *
 * El estado intermedio SEGURO es por tanto:
 *
 *   contar la verdad  +  no ampliar acciones  +  enlazar a la cola oficial
 *
 * La cola oficial ya existe: `/accounts?tab=prospectos&sourceId=<batchId>`.
 * Este módulo no crea pestaña, página ni módulo nuevos, y no duplica la cola.
 *
 * Puro: sin I/O, sin React, sin env, sin reloj. Sólo texto y una URL.
 */

import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';

export type BatchCandidatesPanelState = {
  /** Encabezado del panel. NUNCA niega la existencia de filas durables. */
  headline: string;
  hasDurableCandidates: boolean;
  /** Filas que la tabla heredada sí renderiza (superficie de acciones actual). */
  listedCount: number;
  /** Filas durables que existen pero NO están en esa tabla. */
  unlistedCount: number;
  /** Sólo se muestra el aviso cuando hay filas durables fuera de la tabla. */
  showReviewCallout: boolean;
  calloutMessage: string | null;
  /** Enlace profundo a la cola oficial de revisión, acotada a este lote. */
  prospectosHref: string;
};

function sanitizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value > 0 ? Math.floor(value) : 0;
}

function pluralizeCandidatas(count: number): string {
  return count === 1 ? '1 empresa candidata' : `${count} empresas candidatas`;
}

/** `/accounts?tab=prospectos&sourceId=<batchId>` — misma forma que ya usa el wizard. */
export function buildProspectosBatchReviewHref(batchId: string): string {
  return `${PROSPECTOS_TAB_ROUTE}&sourceId=${encodeURIComponent(batchId)}`;
}

export function resolveBatchCandidatesPanelState(input: {
  batchId: string;
  /** Total DURABLE del lote (contrato CUT-1), no el filtro de calidad de UI. */
  durableTotal: number;
  /** Cuántas filas monta hoy la tabla heredada. */
  listedCount: number;
}): BatchCandidatesPanelState {
  const listedCount = sanitizeCount(input.listedCount);
  // Una tabla con filas NUNCA puede convivir con un total de cero: si el conteo
  // durable llegara por debajo de lo ya renderizado, manda lo renderizado. El
  // panel puede quedarse corto por una lectura fallida, pero no puede negar lo
  // que el operador está viendo.
  const durableTotal = Math.max(sanitizeCount(input.durableTotal), listedCount);
  const unlistedCount = durableTotal - listedCount;
  const showReviewCallout = unlistedCount > 0;

  return {
    headline: durableTotal === 0 ? 'Sin empresas candidatas' : pluralizeCandidatas(durableTotal),
    hasDurableCandidates: durableTotal > 0,
    listedCount,
    unlistedCount,
    showReviewCallout,
    calloutMessage: showReviewCallout
      ? unlistedCount === 1
        ? 'Hay 1 candidato más en este lote que no se revisa desde esta tabla.'
        : `Hay ${unlistedCount} candidatos más en este lote que no se revisan desde esta tabla.`
      : null,
    prospectosHref: buildProspectosBatchReviewHref(input.batchId),
  };
}
