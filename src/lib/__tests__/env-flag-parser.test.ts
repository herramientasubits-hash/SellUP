/**
 * Tests — env-flag-parser (A1-APOLLO-BUDGET-RECONCILIATION-1 §11)
 *
 * Cubre exactamente la matriz exigida por el hito:
 *   true | TRUE | " true " | false | FALSE | valor inválido | ausente
 *
 * Y comprueba que el indicador del wizard y la ejecución comparten la MISMA
 * resolución, que es el punto de §11: que lo que se muestra y lo que corre no
 * puedan divergir.
 *
 * Offline: sin red, sin Supabase, sin proveedores.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEnvValue,
  parseBooleanEnvFlag,
  parseBooleanEnvFlagVerbose,
  parseEnvEnumValue,
} from '../env-flag-parser';
import {
  resolveWizardDiscoveryProvider,
  resolveWizardDiscoveryProviderVerbose,
  WIZARD_DISCOVERY_PROVIDER_KEYS,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';
import { resolveWizardProviderIndicator } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator';

// Guard de red: cualquier fetch en estas pruebas es un defecto, no un test.
const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('network_access_forbidden_in_offline_test');
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

describe('§11 normalizeEnvValue', () => {
  it('recorta y baja a minúsculas', () => {
    assert.equal(normalizeEnvValue('  TRUE  '), 'true');
    assert.equal(normalizeEnvValue('Apollo_Organizations'), 'apollo_organizations');
  });

  it('trata ausente y vacío-tras-trim como sin valor', () => {
    assert.equal(normalizeEnvValue(undefined), null);
    assert.equal(normalizeEnvValue(null), null);
    assert.equal(normalizeEnvValue(''), null);
    assert.equal(normalizeEnvValue('   '), null);
    assert.equal(normalizeEnvValue('\n\t'), null);
  });
});

describe('§11 parseBooleanEnvFlag — matriz completa', () => {
  const cases: ReadonlyArray<[string, string | undefined, boolean]> = [
    ['true', 'true', true],
    ['TRUE', 'TRUE', true],
    ['" true " (con espacios)', ' true ', true],
    ['true con salto de línea', 'true\n', true],
    ['false', 'false', false],
    ['FALSE', 'FALSE', false],
    ['valor inválido', 'yes', false],
    ['valor inválido numérico', '1', false],
    ['ausente', undefined, false],
    ['vacío', '', false],
  ];

  for (const [label, raw, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      assert.equal(parseBooleanEnvFlag(raw), expected);
    });
  }

  it('fail-closed: sólo el token `true` habilita', () => {
    for (const raw of ['1', 'yes', 'on', 'enabled', 'True!', 'truthy', 'si']) {
      assert.equal(parseBooleanEnvFlag(raw), false, `no debería habilitar: ${raw}`);
    }
  });

  it('distingue explícitamente off / ausente / inválido', () => {
    assert.deepEqual(parseBooleanEnvFlagVerbose('true'), {
      enabled: true,
      reason: 'explicit_true',
    });
    assert.deepEqual(parseBooleanEnvFlagVerbose(' FALSE '), {
      enabled: false,
      reason: 'explicit_false',
    });
    assert.deepEqual(parseBooleanEnvFlagVerbose(undefined), {
      enabled: false,
      reason: 'not_set',
    });
    assert.deepEqual(parseBooleanEnvFlagVerbose('yes'), {
      enabled: false,
      reason: 'invalid_value',
    });
  });
});

describe('§11 parseEnvEnumValue', () => {
  it('resuelve contra la allowlist ignorando caso y espacios', () => {
    assert.equal(
      parseEnvEnumValue(' Apollo_Organizations ', WIZARD_DISCOVERY_PROVIDER_KEYS),
      'apollo_organizations',
    );
    assert.equal(parseEnvEnumValue('TAVILY', WIZARD_DISCOVERY_PROVIDER_KEYS), 'tavily');
  });

  it('un valor no reconocido es null — el caller decide el default', () => {
    assert.equal(parseEnvEnumValue('lusha', WIZARD_DISCOVERY_PROVIDER_KEYS), null);
    assert.equal(parseEnvEnumValue(undefined, WIZARD_DISCOVERY_PROVIDER_KEYS), null);
  });
});

// ── Resolver del wizard ──────────────────────────────────────────────────────

describe('§11 resolveWizardDiscoveryProvider — normalización end-to-end', () => {
  const saved = {
    provider: process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER,
    apollo: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
  };

  const setEnv = (provider?: string, apollo?: string): void => {
    if (provider === undefined) delete process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;
    else process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = provider;
    if (apollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = apollo;
  };

  after(() => {
    setEnv(saved.provider, saved.apollo);
  });

  it('ausente → tavily (default)', () => {
    setEnv(undefined, undefined);
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'tavily',
      reason: 'default',
    });
  });

  it('"TAVILY" con espacios → tavily explícito', () => {
    setEnv('  TAVILY  ', undefined);
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'tavily',
      reason: 'explicit_tavily',
    });
  });

  it('apollo con flag " TRUE " → apollo (ambas puertas normalizadas)', () => {
    setEnv(' Apollo_Organizations ', ' TRUE ');
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'apollo_organizations',
      reason: 'apollo_both_gates_on',
    });
  });

  it('apollo con flag inválido → tavily (fail-closed)', () => {
    setEnv('apollo_organizations', 'yes');
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'tavily',
      reason: 'apollo_flag_off',
    });
  });

  it('apollo con flag FALSE → tavily', () => {
    setEnv('apollo_organizations', 'FALSE');
    assert.equal(resolveWizardDiscoveryProvider(), 'tavily');
  });

  it('valor de proveedor no reconocido → tavily, con razón propia y NUNCA apollo', () => {
    setEnv('lusha', 'true');
    const resolution = resolveWizardDiscoveryProviderVerbose();
    assert.equal(resolution.provider, 'tavily');
    assert.equal(resolution.reason, 'unrecognized_provider_value');
  });

  it('el estado de Producción verificado (tavily + flag false) resuelve tavily', () => {
    // Réplica exacta de la precondición leída en /api/debug/agent1-apollo-config:
    // agent1_provider_resolved=tavily, apollo_company_search_enabled_resolved=false.
    setEnv('tavily', 'false');
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'tavily',
      reason: 'explicit_tavily',
    });
  });

  it('indicador y ejecución comparten resolución', () => {
    setEnv(' Apollo_Organizations ', 'true');
    const executionProvider = resolveWizardDiscoveryProvider();
    const indicator = resolveWizardProviderIndicator({
      serverDiscoveryProvider: executionProvider,
      lushaRoute: 'default_ai',
      skippedProvider: null,
    });
    assert.deepEqual(indicator, { status: 'resolved', provider: executionProvider });

    setEnv('tavily', 'false');
    const tavilyProvider = resolveWizardDiscoveryProvider();
    assert.deepEqual(
      resolveWizardProviderIndicator({
        serverDiscoveryProvider: tavilyProvider,
        lushaRoute: 'default_ai',
        skippedProvider: null,
      }),
      { status: 'resolved', provider: 'tavily' },
    );
  });
});
