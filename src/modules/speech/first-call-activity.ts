/**
 * Agente 3 · Primera llamada — su historia como eventos (puro).
 *
 * `account_audit` tiene una lista CERRADA de acciones (CHECK de la 038), así que el
 * agente no escribe ahí: sus eventos salen de sus propias tablas (la investigación y
 * los paquetes) y se muestran donde está la actividad de la empresa: su pestaña
 * «Actividad», la de «Agentes» y el historial del Pipeline. Sin migración.
 */

import {
  FIRST_CALL_CHANNEL_LABELS,
  type FirstCallPack,
  type ResearchBrief,
} from '@/server/agents/first-call/types';

export type FirstCallEventTone = 'default' | 'primary' | 'positive' | 'negative' | 'warning' | 'info';

export interface FirstCallEvent {
  id: string;
  /** `run` = la ejecución del agente; `action` = lo que hizo la persona con el resultado. */
  kind: 'run' | 'action';
  at: string;
  title: string;
  description: string | null;
  tone: FirstCallEventTone;
}

function target(pack: Pick<FirstCallPack, 'targetName' | 'targetTitle'>): string {
  return [pack.targetName, pack.targetTitle].filter(Boolean).join(' · ') || 'Sin decisor elegido';
}

function researchEvent(brief: ResearchBrief): FirstCallEvent | null {
  if (brief.status === 'running') return null;
  const at = brief.completedAt ?? brief.createdAt;
  if (brief.status === 'failed') {
    return {
      id: `brief-${brief.id}`,
      kind: 'run',
      at,
      title: 'La investigación de la empresa no terminó',
      description: 'Se puede volver a intentar desde «Primera llamada».',
      tone: 'negative',
    };
  }
  const webFacts = brief.facts.filter((f) => f.sourceKind !== 'sellup').length;
  const parts = [
    webFacts === 1 ? '1 dato con fuente' : `${webFacts} datos con fuente`,
    brief.sources.length === 1 ? '1 fuente consultada' : `${brief.sources.length} fuentes consultadas`,
  ];
  return {
    id: `brief-${brief.id}`,
    kind: 'run',
    at,
    title: brief.status === 'sufficient' ? 'Empresa investigada' : 'Empresa investigada (parcial)',
    description: parts.join(' · '),
    tone: brief.status === 'sufficient' ? 'primary' : 'warning',
  };
}

function packEvents(pack: FirstCallPack): FirstCallEvent[] {
  const events: FirstCallEvent[] = [];
  const channel = FIRST_CALL_CHANNEL_LABELS[pack.channel];
  if (pack.status === 'failed') {
    events.push({
      id: `pack-${pack.id}`,
      kind: 'run',
      at: pack.createdAt,
      title: 'No se pudo preparar la primera llamada',
      description: `${target(pack)} · ${channel}`,
      tone: 'negative',
    });
    return events;
  }
  events.push({
    id: `pack-${pack.id}`,
    kind: 'run',
    at: pack.createdAt,
    title: pack.verifierIssues.length > 0 ? 'Primera llamada preparada (a revisar)' : 'Primera llamada preparada',
    description: `${target(pack)} · ${channel}`,
    tone: pack.verifierIssues.length > 0 ? 'warning' : 'primary',
  });
  if (pack.usedAt) {
    events.push({
      id: `pack-used-${pack.id}`,
      kind: 'action',
      at: pack.usedAt,
      title: 'Primera llamada usada',
      description: `${target(pack)} · ${channel}`,
      tone: 'positive',
    });
  }
  if (pack.discardedAt) {
    events.push({
      id: `pack-discarded-${pack.id}`,
      kind: 'action',
      at: pack.discardedAt,
      title: 'Primera llamada descartada',
      description: `${target(pack)} · ${channel}`,
      tone: 'default',
    });
  }
  return events;
}

/** De lo más reciente a lo más antiguo. */
export function buildFirstCallEvents(
  brief: ResearchBrief | null,
  packs: readonly FirstCallPack[],
): FirstCallEvent[] {
  const events = [
    ...(brief ? [researchEvent(brief)] : []).filter((e): e is FirstCallEvent => e !== null),
    ...packs.flatMap(packEvents),
  ];
  return events.sort((a, b) => b.at.localeCompare(a.at));
}
