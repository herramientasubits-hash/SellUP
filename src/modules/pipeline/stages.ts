import type { PipelineStatus } from '@/modules/accounts/types';
import type { PipelineStage, PipelineStageId, PipelineStagePhase, PipelineStageState } from './types';

/**
 * Las siete etapas del proceso de venta de SellUp (modelo de los documentos de
 * estrategia). Investigar la empresa y preparar el primer contacto eran dos etapas
 * («Inteligencia de cuenta» y «Preparación y contacto»), pero el Agente 3 las hace en
 * la misma corrida: son UNA, «Primer contacto» (dueña 21-10). Las que aún no tienen
 * agente se muestran como previstas, sin inventar datos.
 */
export const PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    id: 'prospeccion',
    name: 'Prospección',
    summary:
      'La empresa entra como prospecto (IA, importación o a mano), con encaje ICP y sin duplicar HubSpot.',
    agent: 'Agente 1',
    phase: 'hecho',
    plannedText: null,
  },
  {
    id: 'enriquecimiento',
    name: 'Enriquecimiento de contactos',
    summary: 'Se identifican decisores y medios de contacto autorizados.',
    agent: 'Agente 2A',
    phase: 'hecho',
    plannedText: null,
  },
  {
    id: 'primer_contacto',
    name: 'Primer contacto',
    summary:
      'Investigación de la empresa y sus decisores, con fuentes, y qué decirle a cada decisor en cada canal: preguntas y respuestas a objeciones.',
    agent: 'Agente 3',
    phase: 'mvp',
    plannedText:
      'Investigará la empresa y a sus decisores (dónde opera, señales, hipótesis para UBITS, con fuentes) y preparará qué decirle a cada decisor en cada canal, con preguntas y respuestas a objeciones.',
  },
  {
    id: 'reunion',
    name: 'Reunión y seguimiento',
    summary:
      'Agendar y confirmar, discovery/demo y captura post-reunión: necesidades, objeciones, compromisos, próximos pasos.',
    agent: 'Agente de seguimiento post-reunión',
    phase: 'fase_2',
    plannedText:
      'Leerá la reunión (Samu) y dejará necesidades, objeciones, compromisos y próximo paso, con tareas sugeridas para HubSpot.',
  },
  {
    id: 'cotizacion',
    name: 'Cotización',
    summary: 'Propuesta económica por reglas, con aprobación, documento, versión y estado.',
    agent: 'Agente de cotización y propuesta',
    phase: 'mvp',
    plannedText:
      'Generará la propuesta económica aplicando las reglas comerciales, pedirá la aprobación que corresponda y dejará el documento y su versión.',
  },
  {
    id: 'venta_interna',
    name: 'Venta interna y negociación',
    summary: 'Business case / one-pager para el sponsor y ajuste de condiciones.',
    agent: 'Agente de business case',
    phase: 'fase_3',
    plannedText:
      'Preparará el business case y la presentación para que tu contacto venda la solución dentro de su empresa.',
  },
  {
    id: 'cierre',
    name: 'Cierre',
    summary: 'Resultado ganado/perdido con motivo; HubSpot como registro.',
    agent: 'Agente de alertas comerciales',
    phase: 'fase_2',
    plannedText:
      'Registrará el resultado y su motivo, y avisará de empresas estancadas, cotizaciones sin respuesta y compromisos vencidos.',
  },
];

export const PIPELINE_STAGE_IDS: readonly PipelineStageId[] = PIPELINE_STAGES.map((stage) => stage.id);

/** Rótulo del `Badge` de fase de cada etapa. */
export const STAGE_PHASE_LABELS: Record<PipelineStagePhase, string> = {
  hecho: 'Hecho',
  // Para quien usa SellUp, una etapa sin agente es simplemente «Próximamente»: en qué fase
  // del plan entra (MVP, Fase 2, Fase 3) es un dato interno que sigue en `phase`.
  mvp: 'Próximamente',
  fase_2: 'Próximamente',
  fase_3: 'Próximamente',
};

export function getPipelineStage(id: PipelineStageId): PipelineStage {
  const stage = PIPELINE_STAGES.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`Etapa desconocida: ${id}`);
  return stage;
}

export function stageIndex(id: PipelineStageId): number {
  return PIPELINE_STAGE_IDS.indexOf(id);
}

/** Dónde está la empresa según `pipeline_status` (lo mueven las personas y el Agente 3). */
export interface CurrentStageResolution {
  /** `null` cuando la empresa está archivada: ninguna etapa es la actual. */
  stageId: PipelineStageId | null;
  /** El sustado dentro de la etapa: «Nueva», «Lista para investigar»… */
  substatusLabel: string;
}

const CURRENT_STAGE_BY_STATUS: Record<PipelineStatus, CurrentStageResolution> = {
  new: { stageId: 'enriquecimiento', substatusLabel: 'Nueva' },
  ready_for_research: { stageId: 'primer_contacto', substatusLabel: 'Lista para investigar' },
  research_in_progress: { stageId: 'primer_contacto', substatusLabel: 'Investigación en curso' },
  ready_for_outreach: { stageId: 'primer_contacto', substatusLabel: 'Lista para contacto' },
  archived: { stageId: null, substatusLabel: 'Archivada' },
};

const STATUS_ORDER: Readonly<Record<Exclude<PipelineStatus, 'archived'>, number>> = {
  new: 0,
  ready_for_research: 1,
  research_in_progress: 2,
  ready_for_outreach: 3,
};

/**
 * El estado que cuenta para el Pipeline: si el Agente 3 ya dejó una preparación
 * usable, la empresa está «Lista para contacto» aunque su estado guardado sea
 * anterior (empresas preparadas antes de que el agente moviera el estado solo).
 * Nunca retrocede ni toca archivadas.
 */
export function withFirstContactEvidence(status: PipelineStatus, firstContactPrepared: boolean): PipelineStatus {
  if (!firstContactPrepared || status === 'archived') return status;
  return STATUS_ORDER[status] < STATUS_ORDER.ready_for_outreach ? 'ready_for_outreach' : status;
}

export function resolveCurrentStage(status: PipelineStatus): CurrentStageResolution {
  return CURRENT_STAGE_BY_STATUS[status] ?? CURRENT_STAGE_BY_STATUS.new;
}

/**
 * El estado de cada etapa en el recorrido: `prospeccion` siempre completa (la
 * empresa existe), las anteriores a la actual completas, la actual `current` y
 * las posteriores `upcoming`. Archivada: todas `archived` salvo prospección.
 */
export function resolveStageStates(status: PipelineStatus): Record<PipelineStageId, PipelineStageState> {
  const { stageId } = resolveCurrentStage(status);
  const currentIndex = stageId ? stageIndex(stageId) : -1;
  const states = {} as Record<PipelineStageId, PipelineStageState>;
  PIPELINE_STAGE_IDS.forEach((id, index) => {
    if (id === 'prospeccion') {
      states[id] = 'complete';
    } else if (currentIndex === -1) {
      states[id] = 'archived';
    } else if (index < currentIndex) {
      states[id] = 'complete';
    } else if (index === currentIndex) {
      states[id] = 'current';
    } else {
      states[id] = 'upcoming';
    }
  });
  return states;
}
