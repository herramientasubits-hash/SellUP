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
const GROWTH = read('app/(sellup)/growth/page.tsx');
const SUMMARY = read('components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx');
const WIZARD = read('components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx');
const LAUNCH = read('components/prospect-batches/bulk-search/bulk-search-launch.tsx');

describe('quién la ve', () => {
  it('solo Prospección masiva la pide', () => {
    assert.ok(GROWTH.includes('loadGenerateProspectsAgent({ bulkSearch: true })'));
  });

  it('las pestañas de Empresas siguen sin ella (el BD no ve el paso de cantidad)', () => {
    assert.ok(PANEL.includes('? await resolveGenerateProspectsAgent()'), 'Por revisar la pide sin búsqueda masiva');
    assert.ok(PANEL.includes('generateAgent={loadGenerateProspectsAgent()}'), 'Descartadas la pide sin búsqueda masiva');
    assert.ok(PANEL.includes('options.bulkSearch ? await resolveBulkSearchSurfaceForCurrentUser() : null'));
  });

  it('la superficie la resuelve el servidor (bandera y rol), no la pantalla', () => {
    assert.ok(PANEL.includes("from '@/modules/prospect-batches/bulk-search/bulk-search-service.server'"));
  });
});

describe('el resumen', () => {
  it('se ofrece con las MISMAS condiciones que «Generar prospectos», solo por criterios', () => {
    const start = SUMMARY.indexOf('const showBulkSearch =');
    const rule = SUMMARY.slice(start, SUMMARY.indexOf(';', start));
    for (const condition of [
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

  it('la búsqueda normal sigue a mano, en segundo plano', () => {
    assert.ok(SUMMARY.includes("variant={showBulkSearch ? 'outline' : 'default'}"));
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
