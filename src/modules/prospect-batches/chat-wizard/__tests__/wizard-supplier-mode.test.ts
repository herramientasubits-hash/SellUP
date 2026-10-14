/**
 * Tests — «Proveedores de una empresa» en el asistente (AGENT1-SUPPLIER-SEARCH-1).
 *
 * La bandera llega del servidor en el estado inicial. Apagada: la opción sigue como
 * «Próximamente». Encendida: pide la empresa de referencia y después el mismo país ×
 * industria de siempre.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExploratoryFormInput,
  canAdvanceFromCurrentStep,
  canValidateWizard,
  createInitialProspectWizardState,
  deriveWizardMessages,
  getWizardProgress,
  prospectWizardReducer,
  validateWizardStateInvariants,
  type ProspectWizardAction,
  type ProspectWizardState,
} from '../index';
import { getWizardProgressSteps } from '../wizard-selectors';

const CATALOG_VERSION = '2.0.0';
const INDUSTRY_ID = '00000000-0000-4000-8000-000000000001';

function initial(supplierSearchEnabled: boolean): ProspectWizardState {
  return createInitialProspectWizardState({
    catalogVersion: CATALOG_VERSION,
    defaultRequestedCount: 10,
    supplierSearchEnabled,
  });
}

function run(state: ProspectWizardState, actions: ProspectWizardAction[]): ProspectWizardState {
  return actions.reduce(prospectWizardReducer, state);
}

const TO_REFERENCE: ProspectWizardAction[] = [{ type: 'START' }, { type: 'SELECT_SEARCH_MODE', mode: 'suppliers' }];

function toSummary(state: ProspectWizardState): ProspectWizardState {
  return run(state, [
    ...TO_REFERENCE,
    { type: 'SET_REFERENCE_COMPANY', value: '  Ecopetrol   S.A. ' },
    { type: 'SELECT_COUNTRY', countryCode: 'CO' },
    { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_ID },
    { type: 'SKIP_ADDITIONAL_CRITERIA' },
  ]);
}

describe('A. bandera apagada — sigue «Próximamente»', () => {
  it('no avanza desde el tipo de búsqueda y avisa', () => {
    const state = run(initial(false), TO_REFERENCE);
    assert.equal(state.currentStep, 'search_type');
    assert.ok(state.warnings.some((w) => w.code === 'MODE_COMING_SOON'));
    assert.equal(canAdvanceFromCurrentStep(state), false);
  });

  it('un estado forzado a «Proveedores» tampoco se valida', () => {
    const forced: ProspectWizardState = {
      ...toSummary(initial(true)),
      supplierSearchEnabled: false,
    };
    assert.equal(canValidateWizard(forced), false);
    assert.equal(buildExploratoryFormInput(forced), null);
  });
});

describe('B. bandera encendida — empresa de referencia', () => {
  it('pide la empresa antes del país', () => {
    const state = run(initial(true), TO_REFERENCE);
    assert.equal(state.currentStep, 'reference_company');
    assert.equal(state.warnings.length, 0);
    assert.equal(canAdvanceFromCurrentStep(state), false);
  });

  it('rechaza un nombre demasiado corto sin avanzar', () => {
    const state = run(initial(true), [...TO_REFERENCE, { type: 'SET_REFERENCE_COMPANY', value: ' a ' }]);
    assert.equal(state.currentStep, 'reference_company');
    assert.ok(state.blockingIssues.some((i) => i.code === 'REFERENCE_COMPANY_INVALID'));
  });

  it('guarda el nombre limpio y sigue al país; volver atrás regresa a la empresa', () => {
    const state = run(initial(true), [...TO_REFERENCE, { type: 'SET_REFERENCE_COMPANY', value: '  Grupo   Éxito ' }]);
    assert.equal(state.currentStep, 'country');
    assert.equal(state.referenceCompanyName, 'Grupo Éxito');
    assert.equal(run(state, [{ type: 'GO_BACK' }]).currentStep, 'reference_company');
  });

  it('el indicador de pasos incluye la empresa sólo en «Proveedores»', () => {
    assert.deepEqual(getWizardProgressSteps(CATALOG_VERSION, 'suppliers').slice(0, 3), [
      'search_type',
      'reference_company',
      'country',
    ]);
    assert.equal(getWizardProgressSteps(CATALOG_VERSION, 'exploratory').includes('reference_company'), false);
    const atCountry = run(initial(true), [...TO_REFERENCE, { type: 'SET_REFERENCE_COMPANY', value: 'Ecopetrol' }]);
    assert.equal(getWizardProgress(atCountry).currentStepIndex, 2);
  });

  it('llega al resumen, se valida y el formulario de validación es el de país × industria', () => {
    const state = toSummary(initial(true));
    assert.equal(state.currentStep, 'summary');
    assert.equal(state.referenceCompanyName, 'Ecopetrol S.A.');
    assert.equal(canValidateWizard(state), true);
    const payload = buildExploratoryFormInput(state);
    assert.equal(payload?.countryCode, 'CO');
    assert.equal(payload?.industryId, INDUSTRY_ID);
    assert.deepEqual(validateWizardStateInvariants(state), []);
  });

  it('el chat muestra la pregunta y la respuesta de la empresa', () => {
    const state = toSummary(initial(true));
    const messages = deriveWizardMessages(state, {
      countries: [{ code: 'CO', name: 'Colombia' }],
      industries: [{ id: INDUSTRY_ID, name: 'Tecnología' }],
      subindustries: [],
    });
    const ids = messages.map((m) => m.id);
    assert.ok(ids.includes('assistant-reference-company-question'));
    assert.equal(messages.find((m) => m.id === 'user-reference-company-answer')?.content, 'Ecopetrol S.A.');
    assert.ok(ids.indexOf('user-reference-company-answer') < ids.indexOf('assistant-country-question'));
  });
});

describe('C. cambiar de forma y reiniciar', () => {
  it('pasar a «Empresas por criterios» borra la empresa de referencia', () => {
    const summary = toSummary(initial(true));
    const edited = run(summary, [
      { type: 'EDIT_STEP', step: 'search_type', returnToSummary: true },
      { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' },
    ]);
    assert.equal(edited.currentStep, 'summary');
    assert.equal(edited.searchMode, 'exploratory');
    assert.equal(edited.referenceCompanyName, null);
  });

  it('pasar a «Proveedores» desde el resumen obliga a escribir la empresa y vuelve al resumen', () => {
    const exploratory = run(initial(true), [
      { type: 'START' },
      { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' },
      { type: 'SELECT_COUNTRY', countryCode: 'CO' },
      { type: 'SELECT_INDUSTRY', industryId: INDUSTRY_ID },
      { type: 'SKIP_ADDITIONAL_CRITERIA' },
    ]);
    const switched = run(exploratory, [
      { type: 'EDIT_STEP', step: 'search_type', returnToSummary: true },
      { type: 'SELECT_SEARCH_MODE', mode: 'suppliers' },
    ]);
    assert.equal(switched.currentStep, 'reference_company');
    const done = run(switched, [{ type: 'SET_REFERENCE_COMPANY', value: 'Bancolombia' }]);
    assert.equal(done.currentStep, 'summary');
    assert.equal(canValidateWizard(done), true);
  });

  it('la empresa de referencia no se puede editar fuera de «Proveedores»', () => {
    const exploratory = run(initial(true), [{ type: 'START' }, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' }]);
    const after = run(exploratory, [{ type: 'EDIT_STEP', step: 'reference_company' }]);
    assert.equal(after.currentStep, exploratory.currentStep);
  });

  it('«Comenzar de nuevo» conserva la bandera y borra la empresa', () => {
    const restarted = run(toSummary(initial(true)), [{ type: 'REQUEST_RESTART' }, { type: 'CONFIRM_RESTART' }]);
    assert.equal(restarted.supplierSearchEnabled, true);
    assert.equal(restarted.referenceCompanyName, null);
    assert.equal(run(restarted, TO_REFERENCE).currentStep, 'reference_company');
  });
});
