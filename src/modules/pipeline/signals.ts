import type {
  PipelineSignal,
  PipelineSignalId,
  PipelineSignalInput,
  PipelineSignalSeverity,
} from './types';

/**
 * Señales de atención (doc 20): reglas fijas, sin IA. Puras y probadas.
 *
 * Cada señal cae sobre una etapa (para pintarla sobre su tarjeta) y lleva una
 * severidad (para ordenar la lista y teñir los avisos).
 */

/** Umbrales de «Sin movimiento», en días. */
export const MOVEMENT_THRESHOLDS = { notice: 7, alert: 14, critical: 21 } as const;

export const SIGNAL_LABELS: Record<PipelineSignalId, string> = {
  sin_movimiento: 'Sin movimiento',
  sin_contactos: 'Sin contactos',
  sin_responsable: 'Sin responsable',
  sin_hubspot: 'Sin sincronizar con HubSpot',
  corrida_fallida: 'Última corrida de contactos falló',
  decisor_sin_telefono: 'Decisor sin teléfono',
};

export const SIGNAL_IDS: readonly PipelineSignalId[] = [
  'sin_movimiento',
  'sin_contactos',
  'sin_responsable',
  'sin_hubspot',
  'corrida_fallida',
  'decisor_sin_telefono',
];

const SEVERITY_RANK: Record<PipelineSignalSeverity, number> = { critical: 3, alert: 2, notice: 1 };

const MS_PER_DAY = 86_400_000;

/** Días enteros desde `since` hasta `now`; nunca negativo; 0 si la fecha no se lee. */
export function daysBetween(since: string | Date | null | undefined, now: Date): number {
  if (!since) return 0;
  const date = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY));
}

export function resolveMovementSeverity(days: number): PipelineSignalSeverity | null {
  if (days >= MOVEMENT_THRESHOLDS.critical) return 'critical';
  if (days >= MOVEMENT_THRESHOLDS.alert) return 'alert';
  if (days >= MOVEMENT_THRESHOLDS.notice) return 'notice';
  return null;
}

export function computeSignals(input: PipelineSignalInput): PipelineSignal[] {
  // Una empresa archivada no reclama atención: ya no está en el tablero.
  if (input.pipelineStatus === 'archived' || input.currentStageId === null) return [];

  const signals: PipelineSignal[] = [];

  const movement = resolveMovementSeverity(input.daysSinceMovement);
  if (movement) {
    signals.push({
      id: 'sin_movimiento',
      label: `${SIGNAL_LABELS.sin_movimiento} ${input.daysSinceMovement} días`,
      severity: movement,
      stageId: input.currentStageId,
      detail: `${input.daysSinceMovement} días`,
    });
  }

  if (input.contactsTotal === 0) {
    signals.push({
      id: 'sin_contactos',
      label: SIGNAL_LABELS.sin_contactos,
      severity: 'alert',
      stageId: 'enriquecimiento',
    });
  }

  if (!input.hasOwner) {
    signals.push({
      id: 'sin_responsable',
      label: SIGNAL_LABELS.sin_responsable,
      severity: 'notice',
      stageId: 'prospeccion',
    });
  }

  if (!input.hubspotSynced) {
    signals.push({
      id: 'sin_hubspot',
      label: SIGNAL_LABELS.sin_hubspot,
      severity: 'notice',
      stageId: 'prospeccion',
    });
  }

  if (input.lastRunStatus === 'failed') {
    signals.push({
      id: 'corrida_fallida',
      label: SIGNAL_LABELS.corrida_fallida,
      severity: 'alert',
      stageId: 'enriquecimiento',
    });
  }

  if (input.decisionMakersTotal > 0 && input.decisionMakersWithPhone === 0) {
    signals.push({
      id: 'decisor_sin_telefono',
      label: SIGNAL_LABELS.decisor_sin_telefono,
      severity: 'notice',
      stageId: 'enriquecimiento',
      detail: `${input.decisionMakersTotal} ${input.decisionMakersTotal === 1 ? 'decisor' : 'decisores'}`,
    });
  }

  return signals;
}

/** La señal más grave de una lista; `null` si no hay ninguna. */
export function highestSeverity(signals: readonly PipelineSignal[]): PipelineSignalSeverity | null {
  let best: PipelineSignalSeverity | null = null;
  for (const signal of signals) {
    if (!best || SEVERITY_RANK[signal.severity] > SEVERITY_RANK[best]) best = signal.severity;
  }
  return best;
}

export function severityRank(severity: PipelineSignalSeverity | null): number {
  return severity ? SEVERITY_RANK[severity] : 0;
}
