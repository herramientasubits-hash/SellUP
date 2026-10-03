/**
 * Pipeline · etapas — contrato PURO: las 8 etapas fijas y el mapeo de los 5
 * `pipeline_status` a la etapa actual y al estado de cada etapa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_IDS,
  STAGE_PHASE_LABELS,
  getPipelineStage,
  resolveCurrentStage,
  resolveStageStates,
} from '../stages';

describe('Pipeline · etapas — modelo fijo', () => {
  it('son exactamente las 8 etapas, en este orden', () => {
    assert.deepEqual(PIPELINE_STAGE_IDS, [
      'prospeccion',
      'enriquecimiento',
      'inteligencia',
      'preparacion',
      'reunion',
      'cotizacion',
      'venta_interna',
      'cierre',
    ]);
  });

  it('solo Prospección y Enriquecimiento están hechas; las demás son previstas con texto del agente', () => {
    for (const stage of PIPELINE_STAGES) {
      const isDone = stage.id === 'prospeccion' || stage.id === 'enriquecimiento';
      assert.equal(stage.phase === 'hecho', isDone, stage.id);
      assert.equal(stage.plannedText === null, isDone, stage.id);
      assert.ok(stage.agent.length > 0);
    }
    assert.equal(getPipelineStage('prospeccion').agent, 'Agente 1');
    assert.equal(getPipelineStage('enriquecimiento').agent, 'Agente 2A');
    assert.equal(getPipelineStage('cotizacion').phase, 'mvp');
    assert.equal(getPipelineStage('venta_interna').phase, 'fase_3');
    assert.equal(getPipelineStage('cierre').phase, 'fase_2');
  });

  it('lo que aún no tiene agente se rotula «Próximamente», sin jerga de fases', () => {
    assert.equal(STAGE_PHASE_LABELS.hecho, 'Hecho');
    assert.equal(STAGE_PHASE_LABELS.mvp, 'Próximamente');
    assert.equal(STAGE_PHASE_LABELS.fase_2, 'Próximamente');
    assert.equal(STAGE_PHASE_LABELS.fase_3, 'Próximamente');
  });
});

describe('Pipeline · etapas — dónde está la empresa', () => {
  it('mapea los 5 estados a su etapa actual y su sustado', () => {
    assert.deepEqual(resolveCurrentStage('new'), { stageId: 'enriquecimiento', substatusLabel: 'Nueva' });
    assert.deepEqual(resolveCurrentStage('ready_for_research'), {
      stageId: 'inteligencia',
      substatusLabel: 'Lista para investigar',
    });
    assert.deepEqual(resolveCurrentStage('research_in_progress'), {
      stageId: 'inteligencia',
      substatusLabel: 'Investigación en curso',
    });
    assert.deepEqual(resolveCurrentStage('ready_for_outreach'), {
      stageId: 'preparacion',
      substatusLabel: 'Lista para contacto',
    });
    assert.deepEqual(resolveCurrentStage('archived'), { stageId: null, substatusLabel: 'Archivada' });
  });

  it('prospección siempre completa; anteriores completas, actual «current», posteriores pendientes', () => {
    const states = resolveStageStates('ready_for_outreach');
    assert.equal(states.prospeccion, 'complete');
    assert.equal(states.enriquecimiento, 'complete');
    assert.equal(states.inteligencia, 'complete');
    assert.equal(states.preparacion, 'current');
    assert.equal(states.reunion, 'upcoming');
    assert.equal(states.cierre, 'upcoming');
  });

  it('una empresa nueva está en enriquecimiento y lo demás pendiente', () => {
    const states = resolveStageStates('new');
    assert.equal(states.prospeccion, 'complete');
    assert.equal(states.enriquecimiento, 'current');
    assert.equal(states.inteligencia, 'upcoming');
  });

  it('archivada: ninguna etapa es actual; prospección completa, el resto archivado', () => {
    const states = resolveStageStates('archived');
    assert.equal(states.prospeccion, 'complete');
    for (const id of PIPELINE_STAGE_IDS.filter((stage) => stage !== 'prospeccion')) {
      assert.equal(states[id], 'archived', id);
    }
  });
});
