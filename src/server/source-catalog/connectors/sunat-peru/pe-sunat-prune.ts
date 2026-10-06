/**
 * pe-sunat-prune.ts — ¿puede el cargador de Perú borrar las filas que la carga de
 * HOY ya no trae? SOURCES-PE-PRUNE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Cada recarga escribe todas sus filas con la misma hora de importación. Las filas
 * de esa fuente con una hora ANTERIOR son las que el archivo nuevo ya no trae:
 * sociedades que dejaron de estar activas y habidas (8.211 en `pe_sunat_registry`
 * el 06-10-2026) o alias que una regla nueva descarta. Borrarlas es la única forma
 * de que una recarga deje la fuente igual al archivo.
 *
 * Frenos, porque un borrado equivocado vacía una fuente que usa cada corrida:
 *   - Nunca en una carga reanudada (`--offset`): las filas escritas en el intento
 *     anterior tienen otra hora y se borrarían aunque sigan en el archivo.
 *   - Nunca si esta corrida no escribió nada.
 *   - Nunca más del 10 % de la fuente, salvo que se pida explícitamente con
 *     `--prune-max-fraction`.
 */

/** Fracción máxima de la fuente que el cargador borra sin permiso explícito. */
export const PE_PRUNE_DEFAULT_MAX_FRACTION = 0.1;

export type PeSunatPruneDecision =
  | { action: 'delete'; staleRows: number }
  | { action: 'skip'; reason: 'nothing_stale' }
  | { action: 'refuse'; reason: 'resumed_run' | 'nothing_written' | 'too_many_stale' };

/** Decide si se borran las `staleRows` filas viejas de una fuente con `totalRows` filas. */
export function decidePeSunatPrune(input: {
  totalRows: number;
  staleRows: number;
  rowsWrittenThisRun: number;
  offset: number;
  maxFraction?: number;
}): PeSunatPruneDecision {
  if (input.offset > 0) return { action: 'refuse', reason: 'resumed_run' };
  if (input.rowsWrittenThisRun <= 0) return { action: 'refuse', reason: 'nothing_written' };
  if (input.staleRows <= 0) return { action: 'skip', reason: 'nothing_stale' };
  const maxFraction = input.maxFraction ?? PE_PRUNE_DEFAULT_MAX_FRACTION;
  if (input.totalRows <= 0 || input.staleRows / input.totalRows > maxFraction) {
    return { action: 'refuse', reason: 'too_many_stale' };
  }
  return { action: 'delete', staleRows: input.staleRows };
}
