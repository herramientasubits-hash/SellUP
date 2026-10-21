/**
 * AGENT1-CRITERIA-QUICK-WINS-1 § 2 — «por qué salieron pocas». La función sólo
 * NOMBRA lo que la ruta ya decidió; con la meta cumplida no dice nada.
 * Sin Supabase real. Sin proveedores.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildWizardShortfallReasons, type WizardShortfallInput } from '../wizard-shortfall-reasons';

const BASE: WizardShortfallInput = {
  targetReached: false,
  freeLayerFailed: false,
  tavilyFirstOutcome: null,
  apolloNotStartedReason: null,
  lushaSkipReason: null,
  lushaFailureCode: null,
  claudeSkipReason: null,
};

const codes = (input: Partial<WizardShortfallInput>) =>
  buildWizardShortfallReasons({ ...BASE, ...input }).map((r) => r.code);

describe('buildWizardShortfallReasons', () => {
  it('con la meta cumplida no devuelve motivos aunque algo haya fallado', () => {
    assert.deepEqual(codes({ targetReached: true, freeLayerFailed: true, claudeSkipReason: 'failed' }), []);
  });

  it('sin fallos ni saltos relevantes no inventa motivos', () => {
    assert.deepEqual(codes({ lushaSkipReason: 'target_reached', claudeSkipReason: 'flag_disabled' }), []);
  });

  it('nombra los motivos en el orden de la corrida', () => {
    assert.deepEqual(
      codes({
        freeLayerFailed: true,
        tavilyFirstOutcome: 'failed',
        apolloNotStartedReason: 'no_time',
        lushaFailureCode: 'BUDGET_EXCEEDED',
        claudeSkipReason: 'not_enough_time',
      }),
      ['free_layer_failed', 'tavily_failed', 'apollo_no_time', 'lusha_failed', 'claude_no_time'],
    );
  });

  it('Tavily sin tiempo y Apollo sin tiempo dicen «sin tiempo» una sola vez', () => {
    assert.deepEqual(codes({ tavilyFirstOutcome: 'short_no_time', apolloNotStartedReason: 'no_time' }), ['apollo_no_time']);
    assert.deepEqual(codes({ tavilyFirstOutcome: 'short_no_time' }), ['tavily_no_time']);
  });

  it('industria sin mapear, continuación pendiente y fallo de pierna de Lusha', () => {
    assert.deepEqual(codes({ lushaSkipReason: 'macro_industry_unmapped' }), ['industry_unmapped']);
    assert.deepEqual(codes({ lushaSkipReason: 'apollo_pending_continuation' }), ['apollo_pending_continuation']);
    assert.deepEqual(codes({ lushaSkipReason: 'leg_failed' }), ['lusha_failed']);
    assert.deepEqual(codes({ apolloNotStartedReason: 'quota_exhausted' }), ['apollo_quota_exhausted']);
  });

  it('cada motivo trae una frase para el vendedor', () => {
    const reasons = buildWizardShortfallReasons({ ...BASE, freeLayerFailed: true, claudeSkipReason: 'failed' });
    for (const r of reasons) assert.ok(r.message.length > 10, r.code);
  });
});

describe('cableado en la ruta del wizard (estático)', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
    'utf8',
  );

  it('la ruta publica los motivos en la traza y en el resultado', () => {
    assert.match(src, /shortfall_reasons: shortfallReasons\.map/);
    assert.match(src, /\.\.\.\(shortfallReasons\.length > 0 \? \{ shortfallReasons \} : \{\}\)/);
  });

  it('los errores de capa gratuita, Tavily, pipeline y Claude ya no se tragan en silencio', () => {
    assert.match(src, /\[Agent1Wizard\] la capa gratuita falló/);
    assert.match(src, /\[Agent1Wizard\] Tavily primero falló/);
    assert.match(src, /\[Agent1Wizard\] el pipeline del proveedor falló/);
    assert.match(src, /\[Agent1Wizard\] la búsqueda de Claude falló/);
  });
});
