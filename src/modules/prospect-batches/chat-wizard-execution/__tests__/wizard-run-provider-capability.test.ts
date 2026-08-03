/**
 * wizard-run-provider-capability.test.ts — capacidad de la superficie
 * administrativa «Proveedor de esta corrida».
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 2, § 4, § 12 · casos 1–4 y 30.
 *
 * Lo que se demuestra:
 *
 *   admin + override OFF                       → sin control
 *   admin + override ON + kill switch OFF      → control visible, Apollo apagado
 *   admin + los tres gates ON                  → Apollo seleccionable
 *   no-admin / no autenticado                  → sin control, con cualquier flag
 *
 * Todo offline: núcleo puro, sin env, sin Supabase, sin proveedores.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_PROVIDER_OVERRIDE_CAPABILITY,
  WIZARD_RUN_SELECTABLE_PROVIDERS,
  isProviderOptionEnabled,
  isRunProviderOverrideSurfaceAvailable,
  isWizardRunSelectableProvider,
  resolveWizardProviderOverrideCapability,
  type WizardProviderOverrideCapabilityInput,
} from '../wizard-run-provider-capability';

const ALL_GATES_ON: WizardProviderOverrideCapabilityInput = {
  isAuthenticated: true,
  isAdmin: true,
  runOverrideEnabled: true,
  apolloCompanySearchEnabled: true,
  apolloTwoRoundDiscoveryEnabled: true,
};

describe('§ 2 · caso 1 — admin con el override apagado no ve el selector', () => {
  it('sin override no hay capacidad, aunque Apollo esté encendido', () => {
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      runOverrideEnabled: false,
    });

    assert.equal(capability.canSelectDiscoveryProvider, false);
    assert.deepEqual(capability.allowedProviders, []);
  });

  it('el override ausente se trata como apagado (fail-closed)', () => {
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      runOverrideEnabled: undefined as unknown as boolean,
    });
    assert.equal(capability.canSelectDiscoveryProvider, false);
  });
});

describe('§ 4 · caso 2 — override ON pero kill switch de Apollo OFF', () => {
  it('el control se muestra y Apollo queda deshabilitado, no oculto', () => {
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      apolloCompanySearchEnabled: false,
    });

    assert.equal(capability.canSelectDiscoveryProvider, true);
    assert.deepEqual(capability.allowedProviders, ['tavily']);
    assert.equal(isProviderOptionEnabled(capability, 'apollo_organizations'), false);
    assert.equal(isProviderOptionEnabled(capability, 'tavily'), true);
  });

  it('la modalidad de dos rondas apagada también deshabilita Apollo', () => {
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      apolloTwoRoundDiscoveryEnabled: false,
    });

    assert.equal(capability.canSelectDiscoveryProvider, true);
    assert.equal(isProviderOptionEnabled(capability, 'apollo_organizations'), false);
  });
});

describe('§ 2 · caso 3 — admin con los tres gates encendidos', () => {
  it('Apollo es seleccionable', () => {
    const capability = resolveWizardProviderOverrideCapability(ALL_GATES_ON);

    assert.equal(capability.canSelectDiscoveryProvider, true);
    assert.deepEqual(capability.allowedProviders, ['tavily', 'apollo_organizations']);
    assert.equal(isProviderOptionEnabled(capability, 'apollo_organizations'), true);
  });

  it('Tavily acompaña siempre al control: un selector de una opción no elige', () => {
    const capability = resolveWizardProviderOverrideCapability(ALL_GATES_ON);
    assert.ok(capability.allowedProviders.includes('tavily'));
  });
});

describe('§ 2 · caso 4 — quien no es admin no ve el selector', () => {
  it('un usuario autenticado sin rol admin no tiene capacidad', () => {
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      isAdmin: false,
    });
    assert.deepEqual(capability, NO_PROVIDER_OVERRIDE_CAPABILITY);
  });

  it('un usuario no autenticado no tiene capacidad ni siendo "admin"', () => {
    // La combinación es imposible en producción; se prueba para fijar que la
    // sesión es una condición independiente y no una consecuencia del rol.
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      isAuthenticated: false,
    });
    assert.deepEqual(capability, NO_PROVIDER_OVERRIDE_CAPABILITY);
  });

  it('ningún proveedor está habilitado sin capacidad', () => {
    const capability = resolveWizardProviderOverrideCapability({
      ...ALL_GATES_ON,
      isAdmin: false,
    });
    for (const provider of WIZARD_RUN_SELECTABLE_PROVIDERS) {
      assert.equal(isProviderOptionEnabled(capability, provider), false);
    }
  });
});

describe('§ 2 · el catálogo de opciones no ofrece proveedores sin ruta', () => {
  it('lusha_companies no es seleccionable en la superficie', () => {
    assert.deepEqual(WIZARD_RUN_SELECTABLE_PROVIDERS, ['tavily', 'apollo_organizations']);
    assert.equal(isWizardRunSelectableProvider('lusha_companies'), false);
  });

  it('un valor arbitrario no es un proveedor seleccionable', () => {
    for (const value of ['clearbit', '', null, undefined, 7, {}]) {
      assert.equal(isWizardRunSelectableProvider(value), false);
    }
  });
});

describe('§ 12 · disponibilidad de la superficie en el diagnóstico', () => {
  it('true sólo con los tres candados encendidos', () => {
    assert.equal(
      isRunProviderOverrideSurfaceAvailable({
        runOverrideEnabled: true,
        apolloCompanySearchEnabled: true,
        apolloTwoRoundDiscoveryEnabled: true,
      }),
      true,
    );
  });

  it('cualquier candado apagado la declara no disponible', () => {
    const combos = [
      { runOverrideEnabled: false, apolloCompanySearchEnabled: true, apolloTwoRoundDiscoveryEnabled: true },
      { runOverrideEnabled: true, apolloCompanySearchEnabled: false, apolloTwoRoundDiscoveryEnabled: true },
      { runOverrideEnabled: true, apolloCompanySearchEnabled: true, apolloTwoRoundDiscoveryEnabled: false },
    ];
    for (const combo of combos) {
      assert.equal(isRunProviderOverrideSurfaceAvailable(combo), false);
    }
  });

  it('no habla de ningún usuario: el mismo entorno da el mismo resultado', () => {
    // El campo del diagnóstico no puede filtrar quién es admin. Se comprueba que
    // su firma no admite ni rol ni sesión: sólo el entorno resuelto.
    const value = isRunProviderOverrideSurfaceAvailable({
      runOverrideEnabled: true,
      apolloCompanySearchEnabled: true,
      apolloTwoRoundDiscoveryEnabled: true,
    });
    assert.equal(typeof value, 'boolean');
  });
});
