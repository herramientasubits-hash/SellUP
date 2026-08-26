/**
 * cut6b-partial-ui-propagation.test.ts
 *
 * AGENT1-LOCAL-CUT6B-PARTIAL-UI-PROPAGATION.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * CUT-6 activó la supervivencia del aporte gratuito parcial y el servidor pasó a
 * declararlo en los cuatro `ok:false` posteriores a la capa gratuita
 * (`freeContribution`). La verificación V1 encontró que ese hecho moría en el
 * último salto: el componente del mago leía sólo `result.code` y despachaba
 * `EXECUTION_FAILED` con `{errorCode, message, retryable}`, así que el campo era
 * *write-only*:
 *
 *     DB          = 4 empresas, lote sellado ready_for_review
 *     resultado   = { ok:false, freeContribution:{ ...4... } }
 *     lo que veía
 *     la persona  = banner de error, sin conteo
 *
 * Es la misma pérdida del todo-o-nada, trasladada un salto más abajo y por
 * OMISIÓN en vez de por descarte.
 *
 * ── La invariante que se defiende ─────────────────────────────────────────────
 *
 *     filas gratuitas persistidas
 *              ↓
 *     NINGUNA capa posterior puede volver a convertir ese hecho en cero
 *
 * Estos casos cubren el tramo `EXECUTION_FAILED → reducer → copy`. El tramo
 * `servidor → acción → componente` lo cubre el guard estático hermano.
 *
 * 🔴 Lo que este corte NO hace, y sus casos lo fijan: no convierte `ok:false` en
 * éxito, no cambia la semántica del reintento, no toca proveedor, presupuesto ni
 * lote canónico, y no añade CTA al lote.
 *
 * Puro: sin DOM, sin red, sin Supabase, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { createInitialProspectWizardState, prospectWizardReducer } from '../index';
import type { ProspectWizardState } from '../index';
import {
  presentFreeContribution,
  FREE_CONTRIBUTION_TITLE,
} from '@/components/prospect-batches/chat-wizard/wizard-execution-error-map';
import type { WizardFreeContribution } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';

const BATCH_ID = '11111111-2222-3333-4444-555555555555';

const CONTRIBUTION: WizardFreeContribution = {
  batchId: BATCH_ID,
  persistedCandidates: 4,
  redirectPath: `/prospect-batches/${BATCH_ID}`,
};

function initial(): ProspectWizardState {
  return createInitialProspectWizardState({
    catalogVersion: 'v-test',
    defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
  });
}

/** Estado en el paso previo a ejecutar, que es el único desde el que se ejecuta. */
function validated(): ProspectWizardState {
  return { ...initial(), currentStep: 'validated' };
}

/** Una ejecución completa que termina en fallo, con o sin aporte. */
function failedRun(contribution: WizardFreeContribution | null): ProspectWizardState {
  const submitting = prospectWizardReducer(validated(), { type: 'BEGIN_EXECUTION' });
  return prospectWizardReducer(submitting, {
    type: 'EXECUTION_FAILED',
    errorCode: 'BUDGET_EXCEEDED',
    message: 'El presupuesto disponible no alcanza para esta corrida.',
    retryable: false,
    ...(contribution ? { freeContribution: contribution } : {}),
  });
}

// ── A · el transporte: la acción lo lleva y el reducer lo guarda ──────────────

describe('CUT-6B § 3 · A — el aporte llega al estado', () => {
  it('el estado inicial no tiene aporte que declarar', () => {
    assert.equal(initial().executionFreeContribution, null);
  });

  it('EXECUTION_FAILED con aporte lo CONSERVA entero', () => {
    const state = failedRun(CONTRIBUTION);
    assert.deepEqual(state.executionFreeContribution, CONTRIBUTION);
  });

  it('🔴 NEGATIVO B — un reducer que ignorase el campo deja el estado en null', () => {
    // Mutante: el mismo despacho, con el reducer obligado a no leer la acción.
    const ignoring = (s: ProspectWizardState): ProspectWizardState => ({
      ...s,
      executionFreeContribution: null,
    });
    const real = failedRun(CONTRIBUTION);
    const mutated = ignoring(real);
    assert.notDeepEqual(
      mutated.executionFreeContribution,
      real.executionFreeContribution,
      '🔴 si el reducer ignora el campo, el estado deja de describir la corrida',
    );
    assert.equal(mutated.executionFreeContribution, null);
  });

  it('🔴 el batchId guardado es el de la ACCIÓN, jamás uno recalculado', () => {
    const other = { ...CONTRIBUTION, batchId: '99999999-9999-9999-9999-999999999999' };
    assert.equal(failedRun(CONTRIBUTION).executionFreeContribution?.batchId, BATCH_ID);
    assert.equal(failedRun(other).executionFreeContribution?.batchId, other.batchId);
  });

  it('el fallo SIGUE siendo un fallo: error, paso y reintentabilidad intactos', () => {
    const state = failedRun(CONTRIBUTION);
    assert.equal(state.currentStep, 'validated', '🔴 el reintento es el de siempre');
    assert.deepEqual(state.executionError, {
      code: 'BUDGET_EXCEEDED',
      message: 'El presupuesto disponible no alcanza para esta corrida.',
      retryable: false,
    });
    assert.equal(state.executionStatus, null, '🔴 no se inventa un estado de éxito');
    assert.equal(state.executionBatchId, null, '🔴 ni un lote de corrida exitosa');
  });
});

// ── B · el ciclo de vida: un aporte pertenece a UNA ejecución ─────────────────

describe('CUT-6B § 5 · B — el aporte obsoleto se limpia', () => {
  it('🔴 NEGATIVO D — un intento NUEVO borra el aporte del anterior', () => {
    const afterFailure = failedRun(CONTRIBUTION);
    assert.deepEqual(afterFailure.executionFreeContribution, CONTRIBUTION);

    const retrying = prospectWizardReducer(afterFailure, { type: 'BEGIN_EXECUTION' });
    assert.equal(
      retrying.executionFreeContribution,
      null,
      '🔴 sin esto, el intento en curso hereda un hecho de otra corrida',
    );
  });

  it('🔴 NEGATIVO E — un fallo SIN aporte no puede enseñar el aporte anterior', () => {
    const first = failedRun(CONTRIBUTION);
    const retrying = prospectWizardReducer(first, { type: 'BEGIN_EXECUTION' });
    const second = prospectWizardReducer(retrying, {
      type: 'EXECUTION_FAILED',
      errorCode: 'GENERATION_FAILED',
      message: 'El pipeline de búsqueda falló durante la ejecución.',
      retryable: false,
    });

    assert.equal(
      second.executionFreeContribution,
      null,
      '🔴 anunciar 4 empresas que esta corrida no dejó es peor que el silencio',
    );
    assert.equal(presentFreeContribution(second.executionFreeContribution), null);
  });

  it('el éxito limpia el aporte: su conteo combinado ya es la verdad', () => {
    const afterFailure = failedRun(CONTRIBUTION);
    const retrying = prospectWizardReducer(afterFailure, { type: 'BEGIN_EXECUTION' });
    const ok = prospectWizardReducer(retrying, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospect-batches/${BATCH_ID}`,
      status: 'success_target_reached',
      targetReached: true,
      targetPersistibleCandidates: 10,
    });
    assert.equal(ok.currentStep, 'success');
    assert.equal(ok.executionFreeContribution, null, '🔴 dos cifras para una corrida');
  });

  it('reiniciar el mago lo borra', () => {
    const afterFailure = failedRun(CONTRIBUTION);
    const restarted = prospectWizardReducer(afterFailure, { type: 'CONFIRM_RESTART' });
    assert.equal(restarted.executionFreeContribution, null);
  });

  /**
   * 🔴 El aviso se pinta DENTRO del bloque de error, así que un aporte que
   * sobreviviera al error quedaría vivo en el estado y mudo en la pantalla — un
   * hecho que el mago dice tener y no enseña. La invariante lo prohíbe de raíz:
   * el aporte nunca dura más que el error que lo enmarca.
   */
  it('🔴 el aporte NUNCA sobrevive al error que lo enmarca', () => {
    const failed = failedRun(CONTRIBUTION);
    const transitions: ProspectWizardState[] = [
      failed,
      prospectWizardReducer(failed, { type: 'EDIT_STEP', step: 'country' }),
      prospectWizardReducer(failed, { type: 'BEGIN_EXECUTION' }),
      prospectWizardReducer(failed, { type: 'CONFIRM_RESTART' }),
      prospectWizardReducer(failed, { type: 'CLEAR_FEEDBACK' }),
    ];
    for (const state of transitions) {
      if (state.executionFreeContribution !== null) {
        assert.notEqual(
          state.executionError,
          null,
          '🔴 aporte vivo sin error que lo pinte = un hecho invisible',
        );
      }
    }
  });
});

// ── C · el copy: qué se dice y qué NO se dice ─────────────────────────────────

describe('CUT-6B § 4 · C — el texto declara sólo lo probado', () => {
  it('🔴 NEGATIVO C — con aporte > 0 el conteo APARECE en el texto', () => {
    const notice = presentFreeContribution({ persistedCandidates: 4 });
    assert.notEqual(notice, null);
    assert.equal(notice!.title, FREE_CONTRIBUTION_TITLE);
    assert.ok(
      notice!.message.includes('4'),
      '🔴 un aviso que no dice cuántas quedaron no cierra la omisión',
    );
    assert.ok(notice!.message.includes('revisar'));
  });

  it('singular y plural concuerdan', () => {
    assert.ok(presentFreeContribution({ persistedCandidates: 1 })!.message.startsWith('1 empresa '));
    assert.ok(presentFreeContribution({ persistedCandidates: 2 })!.message.startsWith('2 empresas '));
  });

  it('🔴 aporte ausente o en CERO no produce aviso', () => {
    assert.equal(presentFreeContribution(null), null);
    assert.equal(presentFreeContribution(undefined), null);
    assert.equal(presentFreeContribution({ persistedCandidates: 0 }), null, '🔴 cero no es aporte');
  });

  it('🔴 el copy NO niega el consumo ni inventa el objetivo', () => {
    const message = presentFreeContribution({ persistedCandidates: 4 })!.message;
    for (const forbidden of ['sin costo', 'sin cargo', 'gratis', 'de 10', 'crédito']) {
      assert.ok(
        !message.toLowerCase().includes(forbidden),
        `🔴 «${forbidden}» afirmaría algo que un fallo no puede sostener`,
      );
    }
  });
});
