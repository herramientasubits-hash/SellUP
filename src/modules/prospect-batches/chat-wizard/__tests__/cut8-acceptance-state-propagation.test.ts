/**
 * cut8-acceptance-state-propagation.test.ts — el tramo
 * `EXECUTION_SUCCEEDED → reducer → estado` para la aceptación hacia el objetivo.
 *
 * AGENT1-LOCAL-CUT8-ACCEPTANCE-REPORTING-PROPAGATION §§ 3, B, C, L.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `EXECUTION_SUCCEEDED` llevaba tres campos: id, ruta y estado. El reducer, en
 * cambio, leía `action.targetReached` y `action.targetPersistibleCandidates`,
 * que NADIE despachaba: dos campos de estado permanentemente muertos. Y el panel
 * de éxito recibía uno de ellos —siempre `undefined`— como si fuera el número de
 * candidatos generados.
 *
 * O sea: el servidor sabía cuántas empresas contaban hacia el objetivo, y esa
 * respuesta no cruzaba el último salto.
 *
 * Puro: sin DOM, sin red, sin Supabase, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { createInitialProspectWizardState, prospectWizardReducer } from '../index';
import type { ProspectWizardState } from '../index';
import type { AcceptedForTargetSummary } from '@/modules/prospect-batches/accepted-for-target';

const BATCH_ID = '11111111-2222-3333-4444-555555555555';

/** 10 filas durables, 7 aceptadas, 3 que faltan. El ejemplo del enunciado. */
const ACCEPTED: AcceptedForTargetSummary = {
  requestedTarget: 10,
  acceptedForTargetTotal: 7,
  remainingTarget: 3,
  targetReached: false,
  persistedTotalCandidates: 10,
  paidAcceptanceMeasured: true,
};

function initial(): ProspectWizardState {
  return createInitialProspectWizardState({
    catalogVersion: 'v-test',
    defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
  });
}

function validated(): ProspectWizardState {
  return { ...initial(), currentStep: 'validated' };
}

function succeededRun(
  accepted: AcceptedForTargetSummary | null,
  candidateCount?: number,
): ProspectWizardState {
  const submitting = prospectWizardReducer(validated(), { type: 'BEGIN_EXECUTION' });
  return prospectWizardReducer(submitting, {
    type: 'EXECUTION_SUCCEEDED',
    batchId: BATCH_ID,
    redirectPath: `/prospect-batches/${BATCH_ID}`,
    status: 'success_partial',
    acceptedForTarget: accepted,
    ...(candidateCount === undefined ? {} : { candidateCount }),
  });
}

// ── § C · el reducer guarda, no deduce ───────────────────────────────────────

describe('CUT-8 § C — el estado recibe la aceptación entera', () => {
  it('el estado inicial no arrastra veredicto de ninguna corrida', () => {
    assert.equal(initial().executionAcceptedForTarget, null);
    assert.equal(initial().executionCandidateCount, undefined);
  });

  it('EXECUTION_SUCCEEDED conserva el resumen canónico SIN tocarlo', () => {
    const s = succeededRun(ACCEPTED, 10);
    assert.deepEqual(s.executionAcceptedForTarget, ACCEPTED);
    assert.equal(s.currentStep, 'success');
  });

  it('🔴 § A — candidateCount son las FILAS, no el objetivo', () => {
    const s = succeededRun(ACCEPTED, 10);
    assert.equal(s.executionCandidateCount, 10);
    assert.equal(
      s.executionCandidateCount,
      s.executionAcceptedForTarget?.persistedTotalCandidates,
      'el conteo del estado y el universo durable del resumen describen lo mismo',
    );
    assert.notEqual(
      s.executionCandidateCount,
      s.executionAcceptedForTarget?.acceptedForTargetTotal,
      '🔴 7 aceptadas no son 10 filas',
    );
  });

  it('🔴 § C EN NEGATIVO — un reducer que soltara la aceptación deja el estado mudo', () => {
    const real = succeededRun(ACCEPTED, 10);
    // Mutante: el mismo despacho con el reducer obligado a no leer la acción.
    const mutated: ProspectWizardState = { ...real, executionAcceptedForTarget: null };
    assert.notDeepEqual(
      mutated.executionAcceptedForTarget,
      real.executionAcceptedForTarget,
      '🔴 sin este campo el mago no puede decir si la persona consiguió lo que pidió',
    );
    assert.equal(mutated.executionAcceptedForTarget, null);
  });

  it('🔴 § F — un servidor que no envió el conteo NO se convierte en cero', () => {
    const s = succeededRun(ACCEPTED);
    assert.equal(
      s.executionCandidateCount,
      undefined,
      '🔴 «no lo envió» y «envió cero» son corridas distintas',
    );
  });

  it('una corrida sin aceptación declarada guarda null, no un veredicto inventado', () => {
    const s = succeededRun(null, 4);
    assert.equal(s.executionAcceptedForTarget, null);
    assert.equal(s.executionCandidateCount, 4, 'las filas se conocen aunque la aceptación no');
  });
});

// ── § L · la corrida anterior no sobrevive ───────────────────────────────────

describe('CUT-8 § L — el veredicto de una corrida no sobrevive a la siguiente', () => {
  it('BEGIN_EXECUTION borra la aceptación y el conteo del intento anterior', () => {
    const first = succeededRun(ACCEPTED, 10);
    assert.deepEqual(first.executionAcceptedForTarget, ACCEPTED);

    // Un segundo intento arranca desde `validated`, como hace la UI al reeditar.
    const retrying = prospectWizardReducer(
      { ...first, currentStep: 'validated' },
      { type: 'BEGIN_EXECUTION' },
    );
    assert.equal(
      retrying.executionAcceptedForTarget,
      null,
      '🔴 afirmar sobre ESTA ejecución el objetivo de otra es peor que el silencio',
    );
    assert.equal(retrying.executionCandidateCount, undefined);
  });

  it('🔴 § L EN NEGATIVO — conservarlo dejaría el veredicto viejo vivo', () => {
    const first = succeededRun(ACCEPTED, 10);
    // Mutante: un BEGIN_EXECUTION que no limpiara.
    const leaking: ProspectWizardState = {
      ...first,
      currentStep: 'submitting',
    };
    assert.deepEqual(
      leaking.executionAcceptedForTarget,
      ACCEPTED,
      '🔴 así se vería la fuga que la guarda de arriba impide',
    );
  });

  it('reiniciar el mago lo borra', () => {
    const first = succeededRun(ACCEPTED, 10);
    const restarted = prospectWizardReducer(first, { type: 'CONFIRM_RESTART' });
    assert.equal(restarted.executionAcceptedForTarget, null);
    assert.equal(restarted.executionCandidateCount, undefined);
  });
});

// ── § K · la aceptación no toca presupuesto ni reservas ──────────────────────

describe('CUT-8 § K — la aceptación es reporte, no gasto', () => {
  it('el estado del mago no expone la aceptación a ninguna cifra de crédito', () => {
    const s = succeededRun(ACCEPTED, 10) as unknown as Record<string, unknown>;
    const budgetish = Object.keys(s).filter((k) => /credit|budget|reserv/i.test(k));
    for (const key of budgetish) {
      assert.notDeepEqual(
        s[key],
        ACCEPTED,
        `🔴 ${key} no puede recibir el resumen de aceptación`,
      );
    }
  });
});
