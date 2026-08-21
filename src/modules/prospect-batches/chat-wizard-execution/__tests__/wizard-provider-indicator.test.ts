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

  it('SÓLO una omisión del backend produce «no disponible»', () => {
    // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — la ruta de Lusha no la produce.
    for (const lushaRoute of ['default_ai', 'blocked_lusha_disabled', 'lusha', null] as const) {
      const result = resolveWizardProviderIndicator(
        input({ serverDiscoveryProvider: 'tavily', lushaRoute }),
      );
      assert.notEqual(result.status, 'unavailable', `ruta ${lushaRoute} marcó no disponible`);
    }
  });
});

describe('resolveWizardProviderIndicator — la ruta Lusha bloqueada no oculta al proveedor real', () => {
  // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — con `ENABLE_LUSHA_PREVIEW` apagado y
  // criterios Lusha-elegibles (p. ej. Colombia + Salud) el indicador decía «no
  // disponible» mientras la búsqueda la iba a correr Tavily o Apollo. Nombraba la
  // indisponibilidad de un proveedor OCULTO que el usuario nunca eligió.
  it('nombra al proveedor que el servidor resolvió para el discovery', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'blocked_lusha_disabled' }),
      ),
      { status: 'resolved', provider: 'tavily' },
    );
  });

  it('nombra Apollo cuando Apollo es el proveedor de la corrida', () => {
    assert.deepEqual(
      resolveWizardProviderIndicator(
        input({
          serverDiscoveryProvider: 'tavily',
          lushaRoute: 'blocked_lusha_disabled',
          runResolvedProvider: 'apollo_organizations',
        }),
      ),
      { status: 'resolved', provider: 'apollo_organizations' },
    );
  });

  it('nunca nombra Lusha con la ruta bloqueada: Lusha no corre', () => {
    const result = resolveWizardProviderIndicator(
      input({ serverDiscoveryProvider: 'tavily', lushaRoute: 'blocked_lusha_disabled' }),
    );
    assert.notEqual(result.provider, 'lusha');
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
