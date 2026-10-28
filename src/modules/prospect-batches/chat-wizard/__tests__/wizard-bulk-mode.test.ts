/**
 * Tests — «Muchas empresas por criterios», la quinta forma de Rumbo (dueña 28-10).
 *
 * La ofrece el servidor (bandera + Growth o admin) en el estado inicial. Son
 * las preguntas de «Empresas por criterios» y, al final, la cantidad y el tope.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialProspectWizardState,
  deriveWizardMessages,
  prospectWizardReducer,
  searchModeDisplayLabel,
  type ProspectWizardAction,
  type ProspectWizardState,
} from '../index';

function initial(bulkSearchEnabled: boolean): ProspectWizardState {
  return createInitialProspectWizardState({ catalogVersion: '2.0.0', defaultRequestedCount: 10, bulkSearchEnabled });
}

function run(state: ProspectWizardState, actions: ProspectWizardAction[]): ProspectWizardState {
  return actions.reduce(prospectWizardReducer, state);
}

const atSearchType = (state: ProspectWizardState) => run(state, [{ type: 'START' }]);

describe('«Muchas empresas por criterios»', () => {
  it('sin la oferta del servidor no se puede elegir', () => {
    const state = atSearchType(initial(false));
    assert.equal(state.currentStep, 'search_type');
    assert.equal(prospectWizardReducer(state, { type: 'SELECT_BULK_SEARCH' }), state);
  });

  it('con la oferta, son las preguntas de «por criterios» marcadas como masiva', () => {
    const state = run(atSearchType(initial(true)), [{ type: 'SELECT_BULK_SEARCH' }]);
    assert.equal(state.searchMode, 'exploratory');
    assert.equal(state.bulkIntent, true);
    assert.equal(state.currentStep, 'country');
    assert.equal(searchModeDisplayLabel(state), 'Muchas empresas por criterios');
  });

  it('el chat dice la forma elegida con su nombre', () => {
    const state = run(atSearchType(initial(true)), [{ type: 'SELECT_BULK_SEARCH' }]);
    const answer = deriveWizardMessages(state, { countries: [], industries: [], subindustries: [] }).find((message) => message.id === 'user-search-type-answer');
    assert.equal(answer?.content, 'Muchas empresas por criterios');
  });

  it('elegir otra de las cuatro formas deja de ser masiva', () => {
    const bulk = run(atSearchType(initial(true)), [{ type: 'SELECT_BULK_SEARCH' }]);
    const back = run({ ...bulk, currentStep: 'search_type' }, [{ type: 'SELECT_SEARCH_MODE', mode: 'exploratory' }]);
    assert.equal(back.bulkIntent, false);
    assert.equal(searchModeDisplayLabel(back), 'Empresas por criterios');
  });

  it('«Comenzar de nuevo» conserva la oferta del servidor', () => {
    const bulk = run(atSearchType(initial(true)), [{ type: 'SELECT_BULK_SEARCH' }]);
    const restarted = run(bulk, [{ type: 'REQUEST_RESTART' }, { type: 'CONFIRM_RESTART' }]);
    assert.equal(restarted.bulkSearchEnabled, true);
    assert.equal(restarted.bulkIntent, false);
  });
});
