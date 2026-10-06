/**
 * Textos y reglas de pintado de la bandeja de búsquedas (AGENT1-PARALLEL-RUNS-TRAY-1).
 * Puro: sin React ni red, para probarlo.
 */

import type { AgentRun } from '@/modules/prospect-batches/agent-runs/agent-runs-store';
import type { AgentRunStatusSnapshot } from '@/modules/prospect-batches/agent-runs/agent-runs-status.server';

export const AGENT_RUNS_TRAY_COPY = {
  openPage: 'Ver todas en el chat (en curso y últimos 7 días)',
  dragHint: 'Arrastra para mover · doble clic para volver a la esquina',
  continuationOnlyTitle: 'Corrida a medias',
  regionLabel: 'Búsquedas del Agente IA',
  title: (active: number, total: number): string =>
    active > 0
      ? `${active === 1 ? '1 búsqueda en curso' : `${active} búsquedas en curso`}`
      : total === 1
        ? '1 búsqueda terminada'
        : `${total} búsquedas terminadas`,
  subtitle: 'Puedes cerrar o minimizar el chat: las búsquedas siguen aquí.',
  minimize: 'Minimizar',
  expand: 'Expandir',
  closeAll: 'Cerrar las terminadas',
  openBatch: 'Ver lote',
  dismiss: 'Quitar',
  queued: 'En espera: empieza en cuanto se libere un lugar (máximo 3 a la vez, y una sola por país e industria).',
  detached: 'Sigue en curso (lanzada antes de recargar la página).',
  succeeded: (count: number | null): string =>
    count === null ? 'Terminada.' : count === 1 ? 'Terminada: 1 empresa.' : `Terminada: ${count} empresas.`,
  failedFallback: 'No se pudo completar la búsqueda.',
} as const;

export type AgentRunView = {
  progressStatus: 'validating' | 'uploading' | 'success' | 'error';
  description: string;
  error: string | undefined;
  showLink: boolean;
  dismissible: boolean;
};

export function describeAgentRun(run: AgentRun, liveLabel: string | null): AgentRunView {
  switch (run.status) {
    case 'queued':
      return { progressStatus: 'validating', description: AGENT_RUNS_TRAY_COPY.queued, error: undefined, showLink: false, dismissible: false };
    case 'running':
      return {
        progressStatus: 'uploading',
        description: liveLabel ?? (run.detached ? AGENT_RUNS_TRAY_COPY.detached : 'Preparando la búsqueda…'),
        error: undefined,
        showLink: false,
        dismissible: false,
      };
    case 'succeeded':
      return {
        progressStatus: 'success',
        description: AGENT_RUNS_TRAY_COPY.succeeded(run.candidateCount),
        error: undefined,
        showLink: Boolean(run.redirectPath),
        dismissible: true,
      };
    default:
      return {
        progressStatus: 'error',
        description: '',
        error: run.message ?? AGENT_RUNS_TRAY_COPY.failedFallback,
        // Una corrida que falló puede haber dejado empresas guardadas: se enlaza.
        showLink: Boolean(run.redirectPath),
        dismissible: true,
      };
  }
}

/** Una corrida desligada terminó cuando su lote existe y ya no está generando. */
export function isDetachedRunFinished(status: AgentRunStatusSnapshot): boolean {
  if (!status.batch) return false;
  return status.batch.status !== 'generating' && status.batch.status !== 'draft';
}
