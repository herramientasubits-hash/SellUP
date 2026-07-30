/**
 * A1-APOLLO-WIZARD-1 — resolución del indicador de proveedor de búsqueda.
 *
 * Prueba la reducción PURA de las señales del backend a un estado presentable.
 * Sin env, sin DOM, sin red: el módulo bajo prueba no lee nada por su cuenta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWizardProviderIndicator,
  type WizardProviderIndicatorInput,
} from '../wizard-provider-indicator';

function input(
  overrides: Partial<WizardProviderIndicatorInput> = {},
): WizardProviderIndicatorInput {
  return {
    serverDiscoveryProvider: null,
    lushaRoute: null,
    skippedProvider: null,
    ...overrides,
  };
}

describe('resolveWizardProviderIndicator — proveedor resuelto por el servidor', () => {
  it('Tavily resuelto: el servidor devolvió tavily', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'default_ai' }),
      ),
      { status: 'resolved', provider: 'tavily' },
    );
  });

  it('Apollo resuelto: el servidor devolvió apollo_organizations (doble gate ON)', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({ serverDiscoveryProvider: 'apollo_organizations', lushaRoute: 'default_ai' }),
      ),
      { status: 'resolved', provider: 'apollo_organizations' },
    );
  });

  it('Lusha resuelto: la ruta efectiva honra Lusha, sin importar el default del servidor', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'lusha' }),
      ),
      { status: 'resolved', provider: 'lusha' },
    );
  });
});

describe('resolveWizardProviderIndicator — sin resolución', () => {
  it('sin proveedor del servidor queda sin resolver: no se asume un default', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(input({ serverDiscoveryProvider: null, lushaRoute: 'default_ai' })),
      { status: 'unresolved', provider: null },
    );
  });

  it('sin proveedor del servidor y sin ruta conocida también queda sin resolver', () => {
    assert.deepEqual(resolveWizardProviderIndicator(input()), {
      status: 'unresolved',
      provider: null,
    });
  });
});

describe('resolveWizardProviderIndicator — proveedor no disponible', () => {
  it('un proveedor omitido por el backend conserva su nombre', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({
          serverDiscoveryProvider: 'apollo_organizations',
          lushaRoute: 'default_ai',
          skippedProvider: 'apollo_organizations',
        }),
      ),
      { status: 'unavailable', provider: 'apollo_organizations' },
    );
  });

  it('la omisión reportada por el backend gana sobre la ruta Lusha', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({
          serverDiscoveryProvider: 'apollo_organizations',
          lushaRoute: 'lusha',
          skippedProvider: 'apollo_organizations',
        }),
      ),
      { status: 'unavailable', provider: 'apollo_organizations' },
    );
  });

  it('una ruta Lusha bloqueada no nombra proveedor: nunca hubo selección', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'blocked_lusha_disabled' }),
      ),
      { status: 'unavailable', provider: null },
    );
  });

  it('una ruta bloqueada NO se degrada al proveedor del servidor', () => {
    const result = resolveWizardProviderIndicator(
      input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'blocked_lusha_disabled' }),
    );
    assert.notEqual(result.provider, 'tavily');
  });
});

describe('resolveWizardProviderIndicator — pureza', () => {
  it('no muta la entrada', () => {
    const original = input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'default_ai' });
    const snapshot = { ...original };
    resolveWizardProviderIndicator(original);
    assert.deepEqual(original, snapshot);
  });

  it('es determinista para la misma entrada', () => {
    const args = input({ serverDiscoveryProvider: 'apollo_organizations', lushaRoute: 'default_ai' });
    assert.deepEqual(
      resolveWizardProviderIndicator(args),
      resolveWizardProviderIndicator(args),
    );
  });
});
