/**
 * Selección de proveedor POR CORRIDA.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 1 · casos 20–24.
 *
 * Offline: el núcleo es puro y recibe el entorno ya resuelto. Ni un flag leído,
 * ni una llamada a proveedor, ni un crédito.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWizardRunProvider,
  toRunProviderSelectionMetadata,
  buildProviderSelectionSignature,
  toExecutableDiscoveryProvider,
  isWizardDiscoveryProvider,
  DEFAULT_DISCOVERY_PROVIDER,
  type WizardRunProviderSelectionInput,
} from '../wizard-run-provider-selection';

/** Producción hoy: Tavily global, Apollo habilitado como capacidad. */
function baseInput(
  overrides: Partial<WizardRunProviderSelectionInput> = {},
): WizardRunProviderSelectionInput {
  return {
    authority: null,
    runOverrideEnabled: true,
    globalDefaultProvider: 'tavily',
    enabledProviders: {
      tavily: true,
      apollo_organizations: true,
      lusha_companies: false,
    },
    ...overrides,
  };
}

describe('§ 1 · selección de proveedor por corrida', () => {
  test('caso 20 — global Tavily + corrida Apollo autorizada ⇒ Apollo sólo para esa corrida', () => {
    const selection = resolveWizardRunProvider(
      baseInput({ requestedProvider: 'apollo_organizations', authority: 'admin' }),
    );

    assert.equal(selection.resolvedDiscoveryProvider, 'apollo_organizations');
    assert.equal(selection.requestedDiscoveryProvider, 'apollo_organizations');
    assert.equal(selection.providerResolutionReason, 'run_level_override_authorized');
    assert.equal(selection.isRunLevelOverride, true);
  });

  test('caso 21 — una corrida simultánea sin override sigue en Tavily', () => {
    const withOverride = resolveWizardRunProvider(
      baseInput({ requestedProvider: 'apollo_organizations', authority: 'admin' }),
    );
    const withoutOverride = resolveWizardRunProvider(baseInput());

    assert.equal(withOverride.resolvedDiscoveryProvider, 'apollo_organizations');
    assert.equal(withoutOverride.resolvedDiscoveryProvider, 'tavily');
    assert.equal(withoutOverride.providerResolutionReason, 'global_default_provider');
    assert.equal(withoutOverride.isRunLevelOverride, false);
  });

  test('caso 22 — un usuario sin autoridad que pide Apollo cae a Tavily fail-closed', () => {
    const selection = resolveWizardRunProvider(
      baseInput({ requestedProvider: 'apollo_organizations', authority: null }),
    );

    assert.equal(selection.resolvedDiscoveryProvider, 'tavily');
    assert.equal(selection.providerResolutionReason, 'requested_provider_not_authorized');
    assert.equal(selection.isRunLevelOverride, false);
  });

  test('caso 23 — con el kill switch apagado, NINGUNA corrida puede usar Apollo', () => {
    const asAdmin = resolveWizardRunProvider(
      baseInput({
        requestedProvider: 'apollo_organizations',
        authority: 'admin',
        enabledProviders: { tavily: true, apollo_organizations: false },
      }),
    );

    assert.equal(asAdmin.resolvedDiscoveryProvider, 'tavily');
    assert.equal(
      asAdmin.providerResolutionReason,
      'requested_provider_disabled_by_kill_switch',
    );

    // Y tampoco por la vía de contrato interno.
    const asContract = resolveWizardRunProvider(
      baseInput({
        requestedProvider: 'apollo_organizations',
        authority: 'internal_authorized_contract',
        enabledProviders: { tavily: true, apollo_organizations: false },
      }),
    );
    assert.equal(asContract.resolvedDiscoveryProvider, 'tavily');
  });

  test('el kill switch se evalúa ANTES que la autorización', () => {
    // Un no-admin pidiendo un proveedor apagado debe reportar el kill switch:
    // es el hecho más categórico y el que no cambia dando permisos.
    const selection = resolveWizardRunProvider(
      baseInput({
        requestedProvider: 'apollo_organizations',
        authority: null,
        enabledProviders: { tavily: true, apollo_organizations: false },
      }),
    );

    assert.equal(
      selection.providerResolutionReason,
      'requested_provider_disabled_by_kill_switch',
    );
  });

  test('caso 24 — un reintento conserva el proveedor de la corrida original', () => {
    const retry = resolveWizardRunProvider(
      baseInput({
        previousAttemptProvider: 'apollo_organizations',
        // Aunque el reintento llegue sin petición y sin autoridad.
        requestedProvider: undefined,
        authority: null,
      }),
    );

    assert.equal(retry.resolvedDiscoveryProvider, 'apollo_organizations');
    assert.equal(retry.providerResolutionReason, 'preserved_from_previous_attempt');
  });

  test('caso 24-bis — un reintento NO puede resucitar un proveedor apagado entre intentos', () => {
    const retry = resolveWizardRunProvider(
      baseInput({
        previousAttemptProvider: 'apollo_organizations',
        enabledProviders: { tavily: true, apollo_organizations: false },
      }),
    );

    assert.equal(retry.resolvedDiscoveryProvider, 'tavily');
    assert.equal(
      retry.providerResolutionReason,
      'previous_attempt_provider_disabled_fail_closed',
    );
  });

  test('un reintento no puede cambiar de proveedor a mitad', () => {
    const retry = resolveWizardRunProvider(
      baseInput({
        previousAttemptProvider: 'apollo_organizations',
        requestedProvider: 'tavily',
        authority: 'admin',
      }),
    );

    assert.equal(retry.resolvedDiscoveryProvider, 'apollo_organizations');
  });

  test('un valor de proveedor desconocido no se interpreta: Tavily fail-closed', () => {
    for (const bogus of ['apollo', 'APOLLO_ORGANIZATIONS', 'openai', 42, {}, true]) {
      const selection = resolveWizardRunProvider(
        baseInput({ requestedProvider: bogus, authority: 'admin' }),
      );
      assert.equal(selection.resolvedDiscoveryProvider, DEFAULT_DISCOVERY_PROVIDER);
      assert.equal(selection.providerResolutionReason, 'requested_provider_unknown');
    }
  });

  test('con la capacidad de override apagada, una petición se ignora y manda el global', () => {
    const selection = resolveWizardRunProvider(
      baseInput({
        requestedProvider: 'apollo_organizations',
        authority: 'admin',
        runOverrideEnabled: false,
      }),
    );

    assert.equal(selection.resolvedDiscoveryProvider, 'tavily');
    assert.equal(selection.providerResolutionReason, 'run_override_capability_disabled');
    assert.equal(selection.isRunLevelOverride, false);
  });

  test('un predeterminado global apagado cae a Tavily fail-closed', () => {
    const selection = resolveWizardRunProvider(
      baseInput({
        globalDefaultProvider: 'apollo_organizations',
        enabledProviders: { tavily: true, apollo_organizations: false },
      }),
    );

    assert.equal(selection.resolvedDiscoveryProvider, 'tavily');
    assert.equal(selection.providerResolutionReason, 'global_default_disabled_fail_closed');
  });

  test('un proveedor ausente del mapa se trata como apagado', () => {
    const selection = resolveWizardRunProvider(
      baseInput({
        requestedProvider: 'apollo_organizations',
        authority: 'admin',
        enabledProviders: { tavily: true },
      }),
    );

    assert.equal(
      selection.providerResolutionReason,
      'requested_provider_disabled_by_kill_switch',
    );
  });
});

describe('§ 1 · persistencia y ejecución', () => {
  test('los tres campos del contrato viajan al metadata', () => {
    const selection = resolveWizardRunProvider(
      baseInput({ requestedProvider: 'apollo_organizations', authority: 'admin' }),
    );

    assert.deepEqual(toRunProviderSelectionMetadata(selection), {
      requested_discovery_provider: 'apollo_organizations',
      resolved_discovery_provider: 'apollo_organizations',
      provider_resolution_reason: 'run_level_override_authorized',
      is_run_level_override: true,
    });
  });

  test('la firma distingue dos intentos con proveedores distintos', () => {
    const apollo = buildProviderSelectionSignature(
      resolveWizardRunProvider(
        baseInput({ requestedProvider: 'apollo_organizations', authority: 'admin' }),
      ),
    );
    const tavily = buildProviderSelectionSignature(resolveWizardRunProvider(baseInput()));

    assert.notEqual(apollo, tavily);
  });

  test('la firma es determinista para la misma selección', () => {
    const build = () =>
      buildProviderSelectionSignature(
        resolveWizardRunProvider(
          baseInput({ requestedProvider: 'apollo_organizations', authority: 'admin' }),
        ),
      );
    assert.equal(build(), build());
  });

  test('un proveedor del contrato sin ruta de ejecución no se degrada en silencio', () => {
    const selection = resolveWizardRunProvider(
      baseInput({
        requestedProvider: 'lusha_companies',
        authority: 'admin',
        enabledProviders: { tavily: true, lusha_companies: true },
      }),
    );

    assert.equal(selection.resolvedDiscoveryProvider, 'lusha_companies');
    // El wizard de empresas no lo ejecuta: null obliga al llamador a decidir.
    assert.equal(toExecutableDiscoveryProvider(selection), null);
  });

  test('el vocabulario de proveedores está cerrado', () => {
    assert.equal(isWizardDiscoveryProvider('tavily'), true);
    assert.equal(isWizardDiscoveryProvider('apollo_organizations'), true);
    assert.equal(isWizardDiscoveryProvider('lusha_companies'), true);
    assert.equal(isWizardDiscoveryProvider('apollo'), false);
    assert.equal(isWizardDiscoveryProvider(null), false);
  });
});
