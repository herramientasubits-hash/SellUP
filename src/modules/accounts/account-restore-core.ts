/**
 * «Restaurar empresa» (dueña 25-11) — núcleo puro: a qué estado vuelve y cuándo NO se puede.
 *
 * Archivar no borra nada (`archived_at`, `archived_by`, `pipeline_status = 'archived'`);
 * restaurar deshace eso. Sólo admin, como archivar (decisión 6).
 */

import type { PipelineStatus } from './types';

/** Estados a los que puede volver una empresa (todos menos «archivada»). */
const RESTORABLE: ReadonlySet<string> = new Set<PipelineStatus>([
  'new',
  'ready_for_research',
  'research_in_progress',
  'ready_for_outreach',
]);

/** El estado con que vuelve: el que tenía al archivarla (si quedó registrado) o «Nueva». */
export function restoredPipelineStatus(previous: unknown): PipelineStatus {
  return typeof previous === 'string' && RESTORABLE.has(previous) ? (previous as PipelineStatus) : 'new';
}

/** Una ficha ACTIVA de la misma empresa (mismo Company ID de HubSpot o mismo dominio). */
export interface ActiveTwin {
  id: string;
  name: string;
}

/**
 * Por qué no se restaura: ya hay otra ficha activa de la misma empresa (volvió a entrar
 * con otra ficha). Restaurarla la duplicaría: se dice cuál es.
 */
export function restoreConflictMessage(twin: ActiveTwin | null): string | null {
  if (!twin) return null;
  return `No se puede restaurar: ya hay una ficha activa de esta empresa («${twin.name}»). Trabaja en esa.`;
}

/** Lo que se guarda en la auditoría al archivar, para poder restaurar al mismo estado. */
export function archiveAuditDetails(previousStatus: string | null | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return previousStatus && previousStatus !== 'archived'
    ? { ...extra, previous_pipeline_status: previousStatus }
    : { ...extra };
}
