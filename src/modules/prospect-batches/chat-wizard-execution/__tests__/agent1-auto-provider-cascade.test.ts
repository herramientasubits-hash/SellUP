/**
 * AGENT1-AUTO-PROVIDER-CASCADE-1 — el SISTEMA decide el proveedor: Apollo y,
 * si no alcanza, Lusha.
 *
 * Decisión de producto del 2026-09-24 (comparación con precios reales: Apollo
 * 0,00867 USD/crédito, Lusha 0,0682): Apollo principal, Lusha respaldo. Lo que
 * estas pruebas fijan:
 *
 *   § 1 · con el modo automático el predeterminado es Apollo, sin necesidad de
 *         `AGENT1_WIZARD_DISCOVERY_PROVIDER`; el interruptor de Apollo sigue
 *         mandando (apagado ⇒ Tavily, como hoy);
 *   § 2 · la pierna Lusha corre con el modo automático aunque la bandera propia
 *         del waterfall no esté; y los TRES caminos de ejecución lo preguntan
 *         por la misma regla;
 *   § 3 · con el modo automático nadie elige proveedor por corrida;
 *   § 4 · apagado, todo es exactamente como antes.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  isAgent1AutoProviderCascadeEnabled,
  isAgent1LushaFallbackEffective,
  isWizardRunProviderOverrideEffective,
} from '../../../../lib/feature-flags.server';
import { resolveWizardDiscoveryProviderVerbose } from '../wizard-provider-resolver';
import { resolveWizardRunProvider } from '../wizard-run-provider-selection';

const VARS = [
  'ENABLE_AGENT1_AUTO_PROVIDER_CASCADE',
  'ENABLE_APOLLO_COMPANY_SEARCH',
  'AGENT1_WIZARD_DISCOVERY_PROVIDER',
  'ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL',
  'ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE',
] as const;
const saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

function env(values: Partial<Record<(typeof VARS)[number], string>>) {
  for (const v of VARS) delete process.env[v];
  Object.assign(process.env, values);
}

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe('§ 1 — el principal es Apollo', () => {
  it('🔴 modo automático + Apollo encendido ⇒ Apollo, sin variable de proveedor global', () => {
    env({ ENABLE_AGENT1_AUTO_PROVIDER_CASCADE: 'true', ENABLE_APOLLO_COMPANY_SEARCH: 'true' });
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'apollo_organizations',
      reason: 'auto_provider_cascade',
    });
  });

  it('gana sobre un proveedor global explícito a Tavily', () => {
    env({
      ENABLE_AGENT1_AUTO_PROVIDER_CASCADE: 'true',
      ENABLE_APOLLO_COMPANY_SEARCH: 'true',
      AGENT1_WIZARD_DISCOVERY_PROVIDER: 'tavily',
    });
    assert.equal(resolveWizardDiscoveryProviderVerbose().provider, 'apollo_organizations');
  });

  it('🔴 el interruptor de Apollo sigue mandando: apagado ⇒ Tavily', () => {
    env({ ENABLE_AGENT1_AUTO_PROVIDER_CASCADE: 'true', ENABLE_APOLLO_COMPANY_SEARCH: 'false' });
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'tavily',
      reason: 'apollo_flag_off',
    });
  });

  it('sólo el token exacto `true` enciende el modo automático', () => {
    for (const value of ['', '1', 'yes', 'on', 'TRUEE']) {
      env({ ENABLE_AGENT1_AUTO_PROVIDER_CASCADE: value, ENABLE_APOLLO_COMPANY_SEARCH: 'true' });
      assert.equal(isAgent1AutoProviderCascadeEnabled(), false, value);
      assert.equal(resolveWizardDiscoveryProviderVerbose().provider, 'tavily', value);
    }
  });
});

describe('§ 2 — Lusha entra sola cuando Apollo no alcanza', () => {
  it('🔴 modo automático ⇒ la cascada es efectiva aunque su bandera propia no esté', () => {
    env({ ENABLE_AGENT1_AUTO_PROVIDER_CASCADE: 'true' });
    assert.equal(isAgent1LushaFallbackEffective(), true);
  });

  it('la bandera propia del waterfall sigue funcionando sola', () => {
    env({ ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL: 'true' });
    assert.equal(isAgent1LushaFallbackEffective(), true);
  });

  it('sin ninguna de las dos, no hay cascada', () => {
    env({});
    assert.equal(isAgent1LushaFallbackEffective(), false);
  });

  const root = path.resolve(__dirname, '../../../../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  it('🔴 los tres caminos de ejecución preguntan por la regla EFECTIVA', () => {
    for (const file of [
      'src/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall.server.ts',
      'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
      'src/server/agents/prospecting-toolkit/apollo-two-round/continuation-worker.server.ts',
    ]) {
      const source = read(file);
      assert.ok(source.includes('isAgent1LushaFallbackEffective'), `${file} usa la regla efectiva`);
      assert.equal(
        /isAgent1ApolloLushaWaterfallEnabled\s*\(/.test(source) ||
          /\?\?\s*isAgent1ApolloLushaWaterfallEnabled\b/.test(source),
        false,
        `${file} no lee la bandera cruda`,
      );
    }
  });

  it('la observabilidad sigue publicando la bandera cruda del waterfall', () => {
    const route = read('src/app/api/debug/agent1-apollo-config/route.ts');
    assert.match(
      route,
      /agent1_apollo_lusha_waterfall_enabled_resolved: isAgent1ApolloLushaWaterfallEnabled\(\)/,
    );
  });
});

describe('§ 3 — nadie elige proveedor por corrida', () => {
  it('🔴 modo automático ⇒ el selector por corrida queda apagado aunque su bandera esté', () => {
    env({
      ENABLE_AGENT1_AUTO_PROVIDER_CASCADE: 'true',
      ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE: 'true',
    });
    assert.equal(isWizardRunProviderOverrideEffective(), false);
  });

  it('una petición de Tavily de una administradora se ignora: corre Apollo', () => {
    const selection = resolveWizardRunProvider({
      requestedProvider: 'tavily',
      authority: 'admin',
      runOverrideEnabled: false,
      globalDefaultProvider: 'apollo_organizations',
      enabledProviders: { tavily: true, apollo_organizations: true },
    });
    assert.equal(selection.resolvedDiscoveryProvider, 'apollo_organizations');
    assert.equal(selection.providerResolutionReason, 'run_override_capability_disabled');
  });

  const root = path.resolve(__dirname, '../../../../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  it('la ejecución y la capacidad de la pantalla leen la MISMA regla', () => {
    assert.match(
      read('src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      /runOverrideEnabled:\s*isWizardRunProviderOverrideEffective\(\)/,
    );
    assert.match(
      read(
        'src/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability.server.ts',
      ),
      /const runOverrideEnabled = isWizardRunProviderOverrideEffective\(\);/,
    );
  });

  it('la página resuelve el modo en el servidor y sólo pasa el booleano', () => {
    const page = read('src/components/prospects/prospects-module-panel.tsx');
    assert.match(page, /const autoProviderCascade = isAgent1AutoProviderCascadeEnabled\(\);/);
    assert.match(page, /autoProviderCascade=\{autoProviderCascade\}/);
  });
});

describe('§ 4 — apagado, todo como antes', () => {
  it('sin modo automático el predeterminado sigue siendo Tavily', () => {
    env({ ENABLE_APOLLO_COMPANY_SEARCH: 'true' });
    assert.deepEqual(resolveWizardDiscoveryProviderVerbose(), {
      provider: 'tavily',
      reason: 'default',
    });
  });

  it('sin modo automático el selector por corrida depende sólo de su bandera', () => {
    env({ ENABLE_WIZARD_RUN_PROVIDER_OVERRIDE: 'true' });
    assert.equal(isWizardRunProviderOverrideEffective(), true);
    env({});
    assert.equal(isWizardRunProviderOverrideEffective(), false);
  });
});
