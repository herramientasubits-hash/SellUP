import type { PipelineStatus } from '@/modules/accounts/types';
import type { PipelineStage, PipelineStageId, PipelineStagePhase, PipelineStageState } from './types';

/**
 * Las ocho etapas del proceso de venta de SellUp (modelo fijo, de los
 * documentos de estrategia). Dos ya existen en SellUp (Agente 1 y Agente 2A);
 * las demás están previstas y se muestran como tales, sin inventar datos.
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
    id: 'inteligencia',
    name: 'Inteligencia de cuenta',
    summary:
      'Brief de la cuenta: presencia regional, tamaño, señales, hipótesis UBITS, próxima acción.',
    agent: 'Agente de inteligencia de cuenta y decisores',
    phase: 'mvp',
    plannedText:
      'Armará el brief de la empresa: dónde opera, tamaño, señales comerciales, hipótesis de oportunidad UBITS y próxima acción, con sus fuentes y nivel de confianza.',
  },
  {
    id: 'preparacion',
    name: 'Preparación y contacto',
    summary:
      'Speech, preguntas y objeciones por cargo y canal; registro del resultado del contacto.',
    agent: 'Agente de speech y preparación comercial',
    phase: 'mvp',
    plannedText:
      'Preparará el speech para el decisor elegido: ángulo, versión corta, preguntas exploratorias y respuestas a objeciones, según cargo y canal.',
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
  mvp: 'Previsto · MVP',
  fase_2: 'Previsto · Fase 2',
  fase_3: 'Previsto · Fase 3',
};

export function getPipelineStage(id: PipelineStageId): PipelineStage {
  const stage = PIPELINE_STAGES.find((candidate) => candidate.id === id);
  if (!stage) throw new Error(`Etapa desconocida: ${id}`);
  return stage;
}

export function stageIndex(id: PipelineStageId): number {
  return PIPELINE_STAGE_IDS.indexOf(id);
}

/** Dónde está la empresa según `pipeline_status`, que hoy solo cambia una persona. */
export interface CurrentStageResolution {
  /** `null` cuando la empresa está archivada: ninguna etapa es la actual. */
  stageId: PipelineStageId | null;
  /** El sustado dentro de la etapa: «Nueva», «Lista para investigar»… */
  substatusLabel: string;
}

const CURRENT_STAGE_BY_STATUS: Record<PipelineStatus, CurrentStageResolution> = {
  new: { stageId: 'enriquecimiento', substatusLabel: 'Nueva' },
  ready_for_research: { stageId: 'inteligencia', substatusLabel: 'Lista para investigar' },
  research_in_progress: { stageId: 'inteligencia', substatusLabel: 'Investigación en curso' },
  ready_for_outreach: { stageId: 'preparacion', substatusLabel: 'Lista para contacto' },
  archived: { stageId: null, substatusLabel: 'Archivada' },
};

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
