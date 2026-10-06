/**
 * Textos y reglas de pintado de la bandeja de búsquedas (AGENT1-PARALLEL-RUNS-TRAY-1).
 * Puro: sin React ni red, para probarlo.
 */

import type { AgentRun } from '@/modules/prospect-batches/agent-runs/agent-runs-store';
import type { AgentRunStatusSnapshot } from '@/modules/prospect-batches/agent-runs/agent-runs-status.server';

export const AGENT_RUNS_TRAY_COPY = {
  /** Centro de procesos de la cabecera (port de Thema `app-shell/ProcessCenter`). */
  processCenter: 'Centro de procesos',
  none: 'Nada en proceso',
  running: (count: number): string => `${count} en curso`,
  waiting: (count: number): string => `${count} en espera`,
  done: (count: number): string => (count === 1 ? '1 terminada' : `${count} terminadas`),
  failed: (count: number): string => `${count} con error`,
  emptyTitle: 'No hay nada en proceso',
  emptyHint: 'Las búsquedas del Agente IA que lances aparecen aquí con su avance, y se quedan cuando terminan.',
  keepRunning: 'Siguen corriendo aunque cierres el panel',
  history: 'Historial',
  collapse: 'Plegar',
  expand: 'Desplegar',
  progressOf: (title: string): string => `Avance de ${title}`,
  openPage: 'Ver todas en el chat (en curso y últimos 7 días)',
  closeAll: 'Quitar de la lista las búsquedas terminadas',
  clearFinished: 'Limpiar',
  openBatch: 'Ver lote',
  openRun: 'Abrir',
  viewRun: 'Ver',
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

/** El estado de una fila del Centro de procesos (mismos cuatro que Thema). */
export type ProcessState = 'running' | 'waiting' | 'done' | 'failed';

export function agentRunProcessState(run: AgentRun): ProcessState {
  if (run.status === 'running') return 'running';
  if (run.status === 'queued') return 'waiting';
  return run.status === 'succeeded' ? 'done' : 'failed';
}

/**
 * La línea de resumen del Centro de procesos. Lo terminado y lo fallido sólo se
 * nombran si los hay: así, en el caso normal, cabe en una línea.
 */
export function processCenterSummary(counts: Readonly<Record<ProcessState, number>>): string {
  const total = counts.running + counts.waiting + counts.done + counts.failed;
  if (total === 0) return AGENT_RUNS_TRAY_COPY.none;
  return [
    AGENT_RUNS_TRAY_COPY.running(counts.running),
    AGENT_RUNS_TRAY_COPY.waiting(counts.waiting),
    ...(counts.done ? [AGENT_RUNS_TRAY_COPY.done(counts.done)] : []),
    ...(counts.failed ? [AGENT_RUNS_TRAY_COPY.failed(counts.failed)] : []),
  ].join(' · ');
}

/**
 * Qué hace el botón de una fila del Centro de procesos. Una búsqueda TERMINADA (o
 * fallida que dejó empresas) con lote va directo al lote; lo demás abre la corrida
 * en el chat (el avance, o el error). Dueña 06-10: «Ver lote» no debe abrir el chat.
 */
export type ProcessRowAction = { kind: 'batch'; href: string } | { kind: 'run' };

export function processRowAction(run: AgentRun): ProcessRowAction {
  const state = agentRunProcessState(run);
  if ((state === 'done' || state === 'failed') && run.redirectPath) return { kind: 'batch', href: run.redirectPath };
  return { kind: 'run' };
}
