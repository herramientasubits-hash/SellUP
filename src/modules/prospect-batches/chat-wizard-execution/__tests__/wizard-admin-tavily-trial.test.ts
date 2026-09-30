/**
 * AGENT1-TAVILY-TRIAL-1 — prueba de Tavily por corrida, sólo para administradores.
 *
 * El hueco: con `ENABLE_AGENT1_AUTO_PROVIDER_CASCADE=true` (Producción), el
 * override por corrida está apagado para todos. Probar Tavily exigía apagar el
 * modo automático o el interruptor de Apollo, lo que cambia el proveedor de TODOS
 * los vendedores durante la prueba.
 *
 * Con `ENABLE_AGENT1_ADMIN_TAVILY_TRIAL=true`:
 *   · un administrador puede pedir `tavily` para UNA corrida;
 *   · sólo `tavily`: pedir Apollo o Lusha sigue ignorándose (el modo automático
 *     manda);
 *   · un no administrador no obtiene nada;
 *   · la pierna de Lusha no corre después (la prueba mide sólo a Tavily).
 * Apagada, todo es exactamente como antes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT1_ADMIN_TAVILY_TRIAL_FLAG,
  isAgent1AdminTavilyTrialEnabled,
  isWizardRunTavilyTrialEffective,
} from '@/lib/feature-flags.server';
import {
  isAdminTavilyTrialRequest,
  resolveAdminTavilyTrialAvailable,
  resolveRunOverrideEnabledForRequest,
} from '../wizard-admin-tavily-trial';
import { resolveWizardRunProvider } from '../wizard-run-provider-selection';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const CASCADE = 'ENABLE_AGENT1_AUTO_PROVIDER_CASCADE';

describe('bandera ENABLE_AGENT1_ADMIN_TAVILY_TRIAL', () => {
  it('nombre fijo', () => assert.equal(AGENT1_ADMIN_TAVILY_TRIAL_FLAG, 'ENABLE_AGENT1_ADMIN_TAVILY_TRIAL'));

  it('fail-closed: sólo el token exacto true la enciende', () => {
    for (const v of [undefined, '', 'false', '1', 'yes', 'on']) {
      withEnv({ [AGENT1_ADMIN_TAVILY_TRIAL_FLAG]: v }, () => {
        assert.equal(isAgent1AdminTavilyTrialEnabled(), false, String(v));
      });
    }
    withEnv({ [AGENT1_ADMIN_TAVILY_TRIAL_FLAG]: 'true' }, () => assert.equal(isAgent1AdminTavilyTrialEnabled(), true));
  });

  it('sólo tiene efecto con el modo automático encendido (fuera de él ya existe el override normal)', () => {
    withEnv({ [AGENT1_ADMIN_TAVILY_TRIAL_FLAG]: 'true', [CASCADE]: 'true' }, () =>
      assert.equal(isWizardRunTavilyTrialEffective(), true));
    withEnv({ [AGENT1_ADMIN_TAVILY_TRIAL_FLAG]: 'true', [CASCADE]: undefined }, () =>
      assert.equal(isWizardRunTavilyTrialEffective(), false));
    withEnv({ [AGENT1_ADMIN_TAVILY_TRIAL_FLAG]: undefined, [CASCADE]: 'true' }, () =>
      assert.equal(isWizardRunTavilyTrialEffective(), false));
  });
});

describe('capacidad en pantalla', () => {
  it('sólo admin autenticado con la prueba efectiva', () => {
    assert.equal(resolveAdminTavilyTrialAvailable({ isAuthenticated: true, isAdmin: true, trialEffective: true }), true);
    assert.equal(resolveAdminTavilyTrialAvailable({ isAuthenticated: true, isAdmin: false, trialEffective: true }), false);
    assert.equal(resolveAdminTavilyTrialAvailable({ isAuthenticated: false, isAdmin: true, trialEffective: true }), false);
    assert.equal(resolveAdminTavilyTrialAvailable({ isAuthenticated: true, isAdmin: true, trialEffective: false }), false);
  });
});

describe('override efectivo de la petición', () => {
  it('🔴 un no admin que pide tavily a mano NO habilita el override (el resolvedor lo mandaría a Tavily)', () => {
    assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'tavily', isAdmin: false }), false);
  });

  it('prueba efectiva + petición tavily ⇒ override habilitado sólo para esa petición', () => {
    assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'tavily', isAdmin: true }), true);
    assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'apollo_organizations', isAdmin: true }), false);
    assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'lusha_companies', isAdmin: true }), false);
    assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: undefined, isAdmin: true }), false);
    assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: false, requestedProvider: 'tavily', isAdmin: true }), false);
  });

  it('el override normal (fuera del modo automático) no cambia', () => {
    for (const requestedProvider of ['tavily', 'apollo_organizations', undefined]) {
      assert.equal(resolveRunOverrideEnabledForRequest({ overrideEffective: true, trialEffective: false, requestedProvider, isAdmin: false }), true);
    }
  });

  it('reconoce la corrida de prueba: prueba efectiva, petición tavily y Tavily resuelto', () => {
    assert.equal(isAdminTavilyTrialRequest({ trialEffective: true, requestedProvider: 'tavily', resolvedProvider: 'tavily' }), true);
    assert.equal(isAdminTavilyTrialRequest({ trialEffective: true, requestedProvider: 'tavily', resolvedProvider: 'apollo_organizations' }), false);
    assert.equal(isAdminTavilyTrialRequest({ trialEffective: false, requestedProvider: 'tavily', resolvedProvider: 'tavily' }), false);
    assert.equal(isAdminTavilyTrialRequest({ trialEffective: true, requestedProvider: undefined, resolvedProvider: 'tavily' }), false);
  });
});

describe('extremo a extremo con el resolvedor puro', () => {
  const base = {
    globalDefaultProvider: 'apollo_organizations' as const,
    enabledProviders: { tavily: true, apollo_organizations: true, lusha_companies: false },
  };

  it('admin pide tavily en la prueba ⇒ corre Tavily, marcado como override', () => {
    const sel = resolveWizardRunProvider({
      ...base,
      requestedProvider: 'tavily',
      authority: 'admin',
      runOverrideEnabled: resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'tavily', isAdmin: true }),
    });
    assert.equal(sel.resolvedDiscoveryProvider, 'tavily');
    assert.equal(sel.isRunLevelOverride, true);
  });

  it('no admin pide tavily en la prueba ⇒ sigue Apollo', () => {
    const sel = resolveWizardRunProvider({
      ...base,
      requestedProvider: 'tavily',
      authority: null,
      runOverrideEnabled: resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'tavily', isAdmin: false }),
    });
    assert.equal(sel.resolvedDiscoveryProvider, 'apollo_organizations');
    assert.equal(sel.providerResolutionReason, 'run_override_capability_disabled');
  });

  it('admin pide Apollo en la prueba ⇒ la petición se ignora, manda el global', () => {
    const sel = resolveWizardRunProvider({
      ...base,
      requestedProvider: 'apollo_organizations',
      authority: 'admin',
      runOverrideEnabled: resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: 'apollo_organizations', isAdmin: true }),
    });
    assert.equal(sel.resolvedDiscoveryProvider, 'apollo_organizations');
    assert.equal(sel.isRunLevelOverride, false);
  });

  it('sin petición ⇒ Apollo (el modo automático sigue intacto)', () => {
    const sel = resolveWizardRunProvider({
      ...base,
      authority: null,
      runOverrideEnabled: resolveRunOverrideEnabledForRequest({ overrideEffective: false, trialEffective: true, requestedProvider: undefined, isAdmin: true }),
    });
    assert.equal(sel.resolvedDiscoveryProvider, 'apollo_organizations');
  });
});
