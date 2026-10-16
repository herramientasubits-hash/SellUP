/**
 * AGENT1-SEARCH-AUDIT-1 — «Competidores de una empresa» nunca es la ruta Lusha de
 * la pantalla final, y el aviso de competidores dice la verdad sobre Apollo.
 *
 * Puro + lectura del fuente: no monta React ni carga acciones de servidor.
 *   LIVE_APOLLO_CALLS = 0 · LIVE_LUSHA_CALLS = 0 · PRODUCTION_WRITES = 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWizardLushaFinalRouteInEffect } from '../wizard-lusha-final-route';

const LUSHA_READY = {
  autoProviderCascade: false,
  lushaPreviewEnabled: true,
  lushaRouteHonored: true,
  hasLushaInput: true,
};

describe('isWizardLushaFinalRouteInEffect', () => {
  it('exploratoria con país × macro aptos y modo automático apagado ⇒ ruta Lusha (sin cambios)', () => {
    assert.equal(isWizardLushaFinalRouteInEffect({ ...LUSHA_READY, searchMode: 'exploratory' }), true);
  });

  it('competidores con las MISMAS condiciones ⇒ nunca Lusha', () => {
    assert.equal(isWizardLushaFinalRouteInEffect({ ...LUSHA_READY, searchMode: 'competitors' }), false);
  });

  it('modo automático encendido ⇒ no hay ruta Lusha aparte en ningún modo', () => {
    assert.equal(
      isWizardLushaFinalRouteInEffect({ ...LUSHA_READY, searchMode: 'exploratory', autoProviderCascade: true }),
      false,
    );
  });

  it('vista previa apagada, proveedor no Lusha o sin input ⇒ no hay ruta Lusha', () => {
    const base = { ...LUSHA_READY, searchMode: 'exploratory' as const };
    assert.equal(isWizardLushaFinalRouteInEffect({ ...base, lushaPreviewEnabled: false }), false);
    assert.equal(isWizardLushaFinalRouteInEffect({ ...base, lushaRouteHonored: false }), false);
    assert.equal(isWizardLushaFinalRouteInEffect({ ...base, hasLushaInput: false }), false);
  });
});

describe('aviso de «Competidores» en la pantalla final', () => {
  const summary = readFileSync(
    join(process.cwd(), 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx'),
    'utf-8',
  );

  it('ya no afirma que no usa créditos de Apollo (Apollo es el último recurso desde #712/#716)', () => {
    assert.doesNotMatch(summary, /No usa créditos de Apollo/);
  });

  it('nombra el tope real: hasta 3 créditos de Apollo por país', () => {
    assert.match(summary, /hasta 3 créditos de\s+Apollo por país/);
  });
});
