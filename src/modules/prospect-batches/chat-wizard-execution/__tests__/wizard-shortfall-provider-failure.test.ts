import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWizardShortfallReasons, type WizardShortfallInput } from '../wizard-shortfall-reasons';

const base: WizardShortfallInput = {
  targetReached: false,
  freeLayerFailed: false,
  tavilyFirstOutcome: null,
  apolloNotStartedReason: null,
  lushaSkipReason: null,
  lushaFailureCode: null,
  claudeSkipReason: null,
};

test('Claude sin créditos aparece como motivo con la frase del proveedor', () => {
  const reasons = buildWizardShortfallReasons({
    ...base,
    claudeProviderFailure: 'Claude se quedó sin créditos. Pide a un administrador que recargue el saldo de Claude y vuelve a intentarlo.',
  });
  assert.deepEqual(reasons.map((r) => r.code), ['provider_failed']);
  assert.match(reasons[0].message, /Claude se quedó sin créditos/);
});

test('Lusha sin créditos se dice así, no «falló»', () => {
  const reasons = buildWizardShortfallReasons({ ...base, lushaFailureCode: 'insufficient_credits' });
  assert.deepEqual(reasons.map((r) => r.code), ['provider_failed']);
  assert.match(reasons[0].message, /Lusha se quedó sin créditos/);
});

test('un fallo de Lusha sin causa conocida sigue siendo «lusha_failed»', () => {
  const reasons = buildWizardShortfallReasons({ ...base, lushaFailureCode: 'something_odd' });
  assert.deepEqual(reasons.map((r) => r.code), ['lusha_failed']);
});

test('con la meta cumplida no hay motivos', () => {
  assert.deepEqual(buildWizardShortfallReasons({ ...base, targetReached: true, claudeProviderFailure: 'x' }), []);
});
