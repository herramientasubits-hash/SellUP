/**
 * Pipeline · señales de atención (doc 20) — contrato PURO: cada regla, los
 * umbrales 7/14/21 de «Sin movimiento» y la etapa sobre la que cae cada señal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSignals,
  daysBetween,
  highestSeverity,
  resolveMovementSeverity,
} from '../signals';
import type { PipelineSignalInput } from '../types';

const NOW = new Date('2026-10-01T12:00:00Z');

/** Una empresa sana: ningún motivo de atención. */
const HEALTHY: PipelineSignalInput = {
  pipelineStatus: 'new',
  currentStageId: 'enriquecimiento',
  daysSinceMovement: 2,
  contactsTotal: 3,
  decisionMakersTotal: 1,
  decisionMakersWithPhone: 1,
  hasOwner: true,
  hubspotSynced: true,
  lastRunStatus: 'completed',
};

const ids = (input: Partial<PipelineSignalInput>) => computeSignals({ ...HEALTHY, ...input }).map((s) => s.id);

describe('Señales — días', () => {
  it('cuenta días enteros y nunca negativos; una fecha ilegible vale 0', () => {
    assert.equal(daysBetween('2026-09-24T12:00:00Z', NOW), 7);
    assert.equal(daysBetween('2026-09-30T23:00:00Z', NOW), 0);
    assert.equal(daysBetween('2026-10-05T00:00:00Z', NOW), 0);
    assert.equal(daysBetween('no es fecha', NOW), 0);
    assert.equal(daysBetween(null, NOW), 0);
  });

  it('umbrales: aviso a 7, alerta a 14, crítico a 21', () => {
    assert.equal(resolveMovementSeverity(6), null);
    assert.equal(resolveMovementSeverity(7), 'notice');
    assert.equal(resolveMovementSeverity(13), 'notice');
    assert.equal(resolveMovementSeverity(14), 'alert');
    assert.equal(resolveMovementSeverity(20), 'alert');
    assert.equal(resolveMovementSeverity(21), 'critical');
    assert.equal(resolveMovementSeverity(60), 'critical');
  });
});

describe('Señales — reglas', () => {
  it('una empresa sana no tiene señales', () => {
    assert.deepEqual(computeSignals(HEALTHY), []);
  });

  it('«Sin movimiento N días» cae sobre la etapa actual con su severidad', () => {
    const [signal] = computeSignals({ ...HEALTHY, daysSinceMovement: 21, currentStageId: 'inteligencia' });
    assert.equal(signal.id, 'sin_movimiento');
    assert.equal(signal.severity, 'critical');
    assert.equal(signal.stageId, 'inteligencia');
    assert.equal(signal.label, 'Sin movimiento 21 días');
  });

  it('«Sin contactos» con 0 contactos, sobre enriquecimiento', () => {
    const signals = computeSignals({ ...HEALTHY, contactsTotal: 0, decisionMakersTotal: 0 });
    assert.deepEqual(signals.map((s) => [s.id, s.stageId, s.severity]), [['sin_contactos', 'enriquecimiento', 'alert']]);
  });

  it('«Sin responsable» con owner nulo', () => {
    assert.deepEqual(ids({ hasOwner: false }), ['sin_responsable']);
  });

  it('«Sin sincronizar con HubSpot» cuando no está sincronizada', () => {
    assert.deepEqual(ids({ hubspotSynced: false }), ['sin_hubspot']);
  });

  it('«Última corrida de contactos falló» solo cuando la más reciente es failed', () => {
    assert.deepEqual(ids({ lastRunStatus: 'failed' }), ['corrida_fallida']);
    assert.deepEqual(ids({ lastRunStatus: 'completed' }), []);
    assert.deepEqual(ids({ lastRunStatus: null }), []);
  });

  it('«Decisor sin teléfono» solo si hay decisores y ninguno tiene teléfono revelado', () => {
    assert.deepEqual(ids({ decisionMakersTotal: 2, decisionMakersWithPhone: 0 }), ['decisor_sin_telefono']);
    assert.deepEqual(ids({ decisionMakersTotal: 2, decisionMakersWithPhone: 1 }), []);
    assert.deepEqual(ids({ decisionMakersTotal: 0, decisionMakersWithPhone: 0 }), []);
  });

  it('una empresa archivada no reclama atención', () => {
    assert.deepEqual(
      computeSignals({
        ...HEALTHY,
        pipelineStatus: 'archived',
        currentStageId: null,
        contactsTotal: 0,
        hasOwner: false,
        hubspotSynced: false,
        daysSinceMovement: 90,
      }),
      [],
    );
  });

  it('se acumulan y la más grave manda', () => {
    const signals = computeSignals({
      ...HEALTHY,
      daysSinceMovement: 14,
      contactsTotal: 0,
      decisionMakersTotal: 0,
      hasOwner: false,
    });
    assert.deepEqual(
      signals.map((s) => s.id),
      ['sin_movimiento', 'sin_contactos', 'sin_responsable'],
    );
    assert.equal(highestSeverity(signals), 'alert');
    assert.equal(highestSeverity([]), null);
  });
});
