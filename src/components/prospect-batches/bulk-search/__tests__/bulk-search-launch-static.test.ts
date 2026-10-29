/**
 * Búsqueda masiva · asistente (PR 3) — contrato ESTÁTICO: la cantidad sólo la
 * ve Growth en Prospección masiva, el BD sigue igual, el tope se confirma y la
 * búsqueda se lanza con los criterios ya validados.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

const PANEL = read('components/prospects/prospects-module-panel.tsx');
const ACTIVE_STEP = read('components/prospect-batches/chat-wizard/wizard-active-step.tsx');
const REDUCER = read('modules/prospect-batches/chat-wizard/wizard-reducer.ts');
const SUMMARY = read('components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx');
const WIZARD = read('components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx');
const LAUNCH = read('components/prospect-batches/bulk-search/bulk-search-launch.tsx');

describe('quién la ve', () => {
  it('es la quinta forma de Rumbo, en el mismo asistente de Empresas (dueña 28-10)', () => {
    assert.ok(ACTIVE_STEP.includes('state.bulkSearchEnabled === true'));
    assert.ok(ACTIVE_STEP.includes("dispatch({ type: 'SELECT_BULK_SEARCH' })"));
    assert.ok(WIZARD.includes('bulkSearchEnabled: bulkSearch !== null'));
  });

  it('el reductor sólo la acepta si el servidor la ofreció, y la monta sobre «por criterios»', () => {
    assert.ok(REDUCER.includes("state.bulkSearchEnabled !== true) return state;"));
    assert.ok(REDUCER.includes("{ type: 'SELECT_SEARCH_MODE', mode: 'exploratory' }"));
  });

  it('la superficie la resuelve el servidor (bandera y rol), no la pantalla', () => {
    assert.ok(PANEL.includes("from '@/modules/prospect-batches/bulk-search/bulk-search-service.server'"));
    assert.ok(PANEL.includes('const bulkSearch = await resolveBulkSearchSurfaceForCurrentUser();'));
  });
});

describe('el resumen', () => {
  it('se ofrece con las MISMAS condiciones que «Generar prospectos», sólo en su forma', () => {
    const start = SUMMARY.indexOf('const showBulkSearch =');
    const rule = SUMMARY.slice(start, SUMMARY.indexOf(';', start));
    for (const condition of [
      'isBulkIntent',
      'bulkSearch !== null',
      '!isCompetitorSearch',
      '!useLushaFinalSearch',
      'discoveryAvailability.available',
      'executionEnabled',
      '!isPersistenceBlocked',
      '!isBudgetBlocked',
    ]) {
      assert.ok(rule.includes(condition), `falta ${condition}`);
    }
  });

  it('con «Muchas empresas» elegida no se ofrece la búsqueda normal', () => {
    assert.ok(SUMMARY.includes('{!isBulkIntent &&\n        !useLushaFinalSearch &&'));
    assert.ok(SUMMARY.includes('Generar prospectos'));
  });
});

describe('confirmar y lanzar', () => {
  it('sin confirmar el tope no se puede lanzar', () => {
    assert.ok(LAUNCH.includes('disabled={!confirmed || pending}'));
    assert.ok(LAUNCH.includes('Confirmo hasta'));
  });

  it('si el servidor calcula otro tope, se muestra el suyo y se vuelve a confirmar', () => {
    assert.ok(LAUNCH.includes('setEstimates('));
    assert.ok(LAUNCH.includes('setConfirmed(false)'));
  });

  it('una cantidad que no cabe en el presupuesto se ve apagada y dice por qué', () => {
    assert.ok(LAUNCH.includes('disabled={!option.allowed}'));
    assert.ok(LAUNCH.includes('option.blockedReason'));
  });

  it('lanza con los criterios ya validados y avisa al Centro de procesos', () => {
    const start = WIZARD.indexOf('async function handleBulkLaunch');
    const body = WIZARD.slice(start, WIZARD.indexOf('// ── Execution', start));
    assert.ok(body.includes("state.currentStep !== 'validated'"));
    for (const field of ['countryCode:', 'industryId:', 'subindustryIds:', 'additionalCriteriaRaw:', 'catalogVersion:']) {
      assert.ok(body.includes(field), `falta ${field}`);
    }
    assert.equal(body.includes('requestedDiscoveryProvider'), false, 'la búsqueda masiva no elige proveedor');
    assert.ok(body.includes('BULK_SEARCH_STARTED_EVENT'));
  });
});

describe('al lanzar, la misma espera que cualquier búsqueda (dueña 28-10)', () => {
  const launch = WIZARD.slice(WIZARD.indexOf('async function handleBulkLaunch'), WIZARD.indexOf('// ── Execution'));
  it('el asistente no se cierra: entra a «corriendo» con la ronda en curso', () => {
    assert.doesNotMatch(launch, /onClose\(\)/);
    assert.match(launch, /dispatch\(\{ type: 'BEGIN_EXECUTION' \}\)/);
    assert.match(launch, /setRunningRequestId\(result\.search\.currentRoundRequestId\)/);
  });
  it('la espera es el SubmittingPanel de siempre y termina en el panel final de siempre', () => {
    assert.match(WIZARD, /<SubmittingPanel clientRequestId=\{runningRequestId\} startedAtMs=\{bulkRun\?\.startedAtMs\} \/>/);
    assert.match(launch, /dispatch\(finished\)/);
    assert.match(launch, /bulkWizardSuccessAction\(view\)/);
    // El único despacho de éxito literal sigue siendo el de la búsqueda normal (guarda CUT-8).
    assert.equal(WIZARD.split("type: 'EXECUTION_SUCCEEDED'").length - 1, 1);
  });
});
