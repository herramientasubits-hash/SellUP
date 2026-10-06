/**
 * «Editar búsqueda» (dueña 06-10): en vez de volver sólo al paso anterior, abre
 * «¿Qué quieres cambiar?» con cada decisión; se cambia una y el chat vuelve directo
 * al resumen sin repetir las demás. Puro: sólo el reducer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import { createInitialProspectWizardState, prospectWizardReducer } from '../wizard-reducer';
import type { ProspectWizardAction, ProspectWizardState } from '../wizard-types';

const INDUSTRY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const INDUSTRY_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function run(state: ProspectWizardState, actions: ProspectWizardAction[]): ProspectWizardState {
  return actions.reduce(prospectWizardReducer, state);
}

/** Hasta el resumen, con el catálogo indicado (v1 = con subindustrias; macro = sin). */
function atSummary(catalogVersion: string): ProspectWizardState {
  const initial = createInitialProspectWizardState({
    catalogVersion,
    defaultRequestedCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
  });
  return run(initial, [
    { type: 'START' },
    { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' },
    { type: 'SELECT_COUNTRY', countryCode: 'CO' },
    { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_A },
    ...(initial.catalogVersion === '1.0.0' ? ([{ type: 'SKIP_SUBINDUSTRIES' }] as ProspectWizardAction[]) : []),
    { type: 'SKIP_ADDITIONAL_CRITERIA' },
  ]);
}

describe('«¿Qué quieres cambiar?»', () => {
  it('nace cerrada; «Editar búsqueda» la abre y «Volver» la cierra sin tocar nada', () => {
    const summary = atSummary('1.0.0');
    assert.equal(summary.currentStep, 'summary');
    assert.equal(summary.decisionsEditorOpen, false);
    const open = prospectWizardReducer(summary, { type: 'OPEN_DECISIONS_EDITOR' });
    assert.equal(open.decisionsEditorOpen, true);
    const closed = prospectWizardReducer(open, { type: 'CLOSE_DECISIONS_EDITOR' });
    assert.deepEqual(closed, { ...summary, decisionsEditorOpen: false });
  });

  it('elegir una decisión cierra la lista y lleva a ese paso', () => {
    const open = prospectWizardReducer(atSummary('1.0.0'), { type: 'OPEN_DECISIONS_EDITOR' });
    const atCountry = prospectWizardReducer(open, { type: 'EDIT_STEP', step: 'country', returnToSummary: true });
    assert.equal(atCountry.currentStep, 'country');
    assert.equal(atCountry.decisionsEditorOpen, false);
    assert.equal(atCountry.editReturnsToSummary, true);
  });
});

describe('cambiar una decisión vuelve directo al resumen', () => {
  it('país: sin repetir industria ni criterios (y conserva la industria)', () => {
    const s = run(atSummary('1.0.0'), [
      { type: 'EDIT_STEP', step: 'country', returnToSummary: true },
      { type: 'SELECT_COUNTRY', countryCode: 'MX' },
    ]);
    assert.equal(s.currentStep, 'summary');
    assert.equal(s.countryCode, 'MX');
    assert.equal(s.industryId, INDUSTRY_A);
    assert.equal(s.editReturnsToSummary, false);
  });

  it('industria con subindustrias (v1): pregunta las subindustrias y después vuelve al resumen', () => {
    const atSubs = run(atSummary('1.0.0'), [
      { type: 'EDIT_STEP', step: 'industry', returnToSummary: true },
      { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_B },
    ]);
    assert.equal(atSubs.currentStep, 'subindustries');
    const back = prospectWizardReducer(atSubs, { type: 'SKIP_SUBINDUSTRIES' });
    assert.equal(back.currentStep, 'summary');
    assert.equal(back.industryId, INDUSTRY_B);
  });

  it('macro industria (catálogo sin subindustrias): directo al resumen', () => {
    const s = run(atSummary('2.0.0'), [
      { type: 'EDIT_STEP', step: 'industry', returnToSummary: true },
      { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_B },
    ]);
    assert.equal(s.currentStep, 'summary');
  });

  it('criterio adicional escrito: directo al resumen (sin pedir la cantidad)', () => {
    const s = run(atSummary('1.0.0'), [
      { type: 'EDIT_STEP', step: 'additional_criteria', returnToSummary: true },
      { type: 'SET_ADDITIONAL_CRITERIA', value: 'con oficinas en Quito' },
    ]);
    assert.equal(s.currentStep, 'summary');
    assert.equal(s.additionalCriteriaRaw, 'con oficinas en Quito');
  });

  it('sin «volver al resumen» el flujo paso a paso de siempre no cambia', () => {
    const s = run(atSummary('1.0.0'), [
      { type: 'EDIT_STEP', step: 'country' },
      { type: 'SELECT_COUNTRY', countryCode: 'MX' },
    ]);
    assert.equal(s.currentStep, 'industry');
  });
});
