/**
 * A1-APOLLO-WIZARD-1 — Preflight de disponibilidad de Apollo en el wizard.
 *
 * Puro por inyección de dependencias. Offline: ninguna comprobación llega a
 * Apollo, a Supabase ni al Vault.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateWizardApolloAvailability,
  buildWizardApolloSkippedResult,
  type WizardApolloAvailabilityDeps,
  type WizardApolloSkipReason,
} from '../wizard-apollo-availability';

// Todas las puertas abiertas — cada prueba cierra sólo la que le interesa.
function allOpen(
  overrides: Partial<WizardApolloAvailabilityDeps> = {},
): WizardApolloAvailabilityDeps {
  return {
    isFeatureEnabled: () => true,
    isProviderCapabilityAvailable: async () => true,
    isRolePermitted: async () => true,
    hasBudgetAvailable: async () => true,
    isProviderConfigured: async () => true,
    hasCredential: async () => true,
    ...overrides,
  };
}

describe('A1-APOLLO-WIZARD-1 · disponibilidad de Apollo', () => {
  it('disponible sólo cuando todas las puertas están abiertas', async () => {
    const result = await evaluateWizardApolloAvailability(allOpen());
    assert.deepEqual(result, { available: true });
  });

  // ── Caso 20: feature flag OFF ──────────────────────────────────────────────
  it('con el flag apagado omite el proveedor sin consultar nada más', async () => {
    let otherChecksRun = 0;
    const result = await evaluateWizardApolloAvailability(
      allOpen({
        isFeatureEnabled: () => false,
        isProviderCapabilityAvailable: async () => { otherChecksRun++; return true; },
        hasCredential: async () => { otherChecksRun++; return true; },
      }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'feature_disabled' });
    assert.equal(otherChecksRun, 0, 'no debe tocar nada más si la feature está apagada');
  });

  it('el flag apagado es el default: fail-closed', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ isFeatureEnabled: () => false }),
    );
    assert.equal(result.available, false);
  });

  // ── Caso 22: capability gate ───────────────────────────────────────────────
  it('omite cuando la capability del catálogo no está disponible', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ isProviderCapabilityAvailable: async () => false }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'capability_unavailable' });
  });

  it('un fallo del catálogo omite el proveedor: nunca habilita otra ruta', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({
        isProviderCapabilityAvailable: async () => { throw new Error('catálogo caído'); },
      }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'availability_check_failed' });
  });

  it('omite cuando el rol no está permitido', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ isRolePermitted: async () => false }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'role_not_permitted' });
  });

  it('omite cuando no hay presupuesto disponible', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ hasBudgetAvailable: async () => false }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'budget_unavailable' });
  });

  it('omite cuando el proveedor no está configurado', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ isProviderConfigured: async () => false }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'provider_not_configured' });
  });

  // ── Caso 21: credencial ausente ────────────────────────────────────────────
  it('omite cuando falta la credencial, antes de reservar presupuesto', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ hasCredential: async () => false }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'credential_unavailable' });
  });

  it('un fallo al leer la credencial omite el proveedor', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ hasCredential: async () => { throw new Error('vault caído'); } }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'availability_check_failed' });
  });

  it('un fallo al leer el flag también falla cerrado', async () => {
    const result = await evaluateWizardApolloAvailability(
      allOpen({ isFeatureEnabled: () => { throw new Error('env roto'); } }),
    );
    assert.deepEqual(result, { available: false, skipReason: 'availability_check_failed' });
  });

  // ── Orden de las comprobaciones ────────────────────────────────────────────
  it('comprueba en orden de menor radio de daño y se detiene en la primera cerrada', async () => {
    const calls: string[] = [];
    await evaluateWizardApolloAvailability({
      isFeatureEnabled: () => { calls.push('flag'); return true; },
      isProviderCapabilityAvailable: async () => { calls.push('capability'); return true; },
      isRolePermitted: async () => { calls.push('role'); return true; },
      hasBudgetAvailable: async () => { calls.push('budget'); return false; },
      isProviderConfigured: async () => { calls.push('configured'); return true; },
      hasCredential: async () => { calls.push('credential'); return true; },
    });
    assert.deepEqual(calls, ['flag', 'capability', 'role', 'budget']);
  });

  it('emite el motivo al sumidero de observabilidad, sin PII', () => {
    const logged: WizardApolloSkipReason[] = [];
    return evaluateWizardApolloAvailability(
      allOpen({ hasCredential: async () => false, logSkip: (reason) => logged.push(reason) }),
    ).then(() => {
      assert.deepEqual(logged, ['credential_unavailable']);
    });
  });
});

describe('A1-APOLLO-WIZARD-1 · resultado estructurado de proveedor omitido', () => {
  it('no lleva lote, candidatos ni coste', () => {
    const result = buildWizardApolloSkippedResult('credential_unavailable');
    assert.equal(result.provider, 'apollo_organizations');
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'credential_unavailable');
    assert.equal(result.creditsUsed, 0);
    assert.equal(result.pagesProcessed, 0);
    assert.equal(result.resultsFound, 0);
    assert.equal('batchId' in result, false);
  });

  it('cada motivo tiene un mensaje al usuario', () => {
    const reasons: WizardApolloSkipReason[] = [
      'feature_disabled',
      'capability_unavailable',
      'role_not_permitted',
      'budget_unavailable',
      'provider_not_configured',
      'credential_unavailable',
      'availability_check_failed',
    ];
    for (const reason of reasons) {
      const result = buildWizardApolloSkippedResult(reason);
      assert.ok(result.message.length > 0, `${reason} necesita mensaje`);
    }
  });

  it('el mensaje no revela qué flag, rol o credencial desbloquearía la ruta', () => {
    const sensitive = [
      'ENABLE_APOLLO', 'flag', 'credential', 'api key', 'apollo', 'admin', 'vault', 'role',
    ];
    for (const reason of ['feature_disabled', 'credential_unavailable', 'role_not_permitted'] as const) {
      const message = buildWizardApolloSkippedResult(reason).message.toLowerCase();
      for (const term of sensitive) {
        assert.equal(
          message.includes(term.toLowerCase()),
          false,
          `el mensaje de ${reason} no debe mencionar "${term}"`,
        );
      }
    }
  });
});
