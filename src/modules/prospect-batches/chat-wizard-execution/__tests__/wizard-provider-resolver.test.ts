/**
 * Tests — Wizard Provider Resolver (v1.16K-Y)
 *
 * Verifica la lógica de doble gate para resolver el provider de discovery del wizard:
 *   - Sin env → tavily (default)
 *   - AGENT1_WIZARD_DISCOVERY_PROVIDER=tavily → tavily (explícito)
 *   - AGENT1_WIZARD_DISCOVERY_PROVIDER=apollo_organizations + ENABLE_APOLLO_COMPANY_SEARCH=false → tavily (flag off)
 *   - AGENT1_WIZARD_DISCOVERY_PROVIDER=apollo_organizations + ENABLE_APOLLO_COMPANY_SEARCH=true → apollo_organizations
 *
 * No hace llamadas reales. No consume créditos.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWizardDiscoveryProvider,
  resolveWizardDiscoveryProviderVerbose,
} from '../wizard-provider-resolver';

// ── Helpers ───────────────────────────────────────────────────────────────────

type EnvSnapshot = {
  AGENT1_WIZARD_DISCOVERY_PROVIDER: string | undefined;
  ENABLE_APOLLO_COMPANY_SEARCH: string | undefined;
};

function snapshotEnv(): EnvSnapshot {
  return {
    AGENT1_WIZARD_DISCOVERY_PROVIDER: process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER,
    ENABLE_APOLLO_COMPANY_SEARCH: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  if (snapshot.AGENT1_WIZARD_DISCOVERY_PROVIDER === undefined) {
    delete process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;
  } else {
    process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = snapshot.AGENT1_WIZARD_DISCOVERY_PROVIDER;
  }
  if (snapshot.ENABLE_APOLLO_COMPANY_SEARCH === undefined) {
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  } else {
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = snapshot.ENABLE_APOLLO_COMPANY_SEARCH;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('P1: default (no env set) → tavily', () => {
  let snapshot: EnvSnapshot;
  beforeEach(() => {
    snapshot = snapshotEnv();
    delete process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER;
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });
  afterEach(() => restoreEnv(snapshot));

  it('resolveWizardDiscoveryProvider returns tavily', () => {
    assert.equal(resolveWizardDiscoveryProvider(), 'tavily');
  });

  it('verbose resolution has reason=default', () => {
    const res = resolveWizardDiscoveryProviderVerbose();
    assert.equal(res.provider, 'tavily');
    assert.equal(res.reason, 'default');
  });
});

describe('P2: AGENT1_WIZARD_DISCOVERY_PROVIDER=tavily → tavily (explícito)', () => {
  let snapshot: EnvSnapshot;
  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = 'tavily';
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });
  afterEach(() => restoreEnv(snapshot));

  it('resolveWizardDiscoveryProvider returns tavily', () => {
    assert.equal(resolveWizardDiscoveryProvider(), 'tavily');
  });

  it('verbose resolution has reason=explicit_tavily', () => {
    const res = resolveWizardDiscoveryProviderVerbose();
    assert.equal(res.provider, 'tavily');
    assert.equal(res.reason, 'explicit_tavily');
  });
});

describe('P3: apollo_organizations + ENABLE_APOLLO_COMPANY_SEARCH=false → tavily (flag off)', () => {
  let snapshot: EnvSnapshot;
  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = 'apollo_organizations';
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'false';
  });
  afterEach(() => restoreEnv(snapshot));

  it('resolveWizardDiscoveryProvider returns tavily — Apollo flag off', () => {
    assert.equal(resolveWizardDiscoveryProvider(), 'tavily');
  });

  it('verbose resolution has reason=apollo_flag_off', () => {
    const res = resolveWizardDiscoveryProviderVerbose();
    assert.equal(res.provider, 'tavily');
    assert.equal(res.reason, 'apollo_flag_off');
  });

  it('Apollo API is NOT called (structural: returns tavily without Apollo executor)', () => {
    // If provider resolves to tavily, Apollo executor is never selected.
    // This test asserts no Apollo reference in the resolution path.
    const provider = resolveWizardDiscoveryProvider();
    assert.notEqual(provider, 'apollo_organizations');
  });
});

describe('P3b: apollo_organizations + ENABLE_APOLLO_COMPANY_SEARCH absent → tavily (flag off)', () => {
  let snapshot: EnvSnapshot;
  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = 'apollo_organizations';
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });
  afterEach(() => restoreEnv(snapshot));

  it('resolveWizardDiscoveryProvider returns tavily when flag env is absent', () => {
    assert.equal(resolveWizardDiscoveryProvider(), 'tavily');
  });

  it('verbose has reason=apollo_flag_off when flag absent', () => {
    const res = resolveWizardDiscoveryProviderVerbose();
    assert.equal(res.provider, 'tavily');
    assert.equal(res.reason, 'apollo_flag_off');
  });
});

describe('P4: apollo_organizations + ENABLE_APOLLO_COMPANY_SEARCH=true → apollo_organizations', () => {
  let snapshot: EnvSnapshot;
  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = 'apollo_organizations';
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  });
  afterEach(() => restoreEnv(snapshot));

  it('resolveWizardDiscoveryProvider returns apollo_organizations', () => {
    assert.equal(resolveWizardDiscoveryProvider(), 'apollo_organizations');
  });

  it('verbose resolution has reason=apollo_both_gates_on', () => {
    const res = resolveWizardDiscoveryProviderVerbose();
    assert.equal(res.provider, 'apollo_organizations');
    assert.equal(res.reason, 'apollo_both_gates_on');
  });
});

describe('P5: unknown provider value → tavily (default fallback)', () => {
  let snapshot: EnvSnapshot;
  beforeEach(() => {
    snapshot = snapshotEnv();
    process.env.AGENT1_WIZARD_DISCOVERY_PROVIDER = 'unknown_provider_xyz';
    delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
  });
  afterEach(() => restoreEnv(snapshot));

  it('resolveWizardDiscoveryProvider returns tavily for unknown value', () => {
    assert.equal(resolveWizardDiscoveryProvider(), 'tavily');
  });

  it('verbose has reason=default for unknown value', () => {
    const res = resolveWizardDiscoveryProviderVerbose();
    assert.equal(res.provider, 'tavily');
    assert.equal(res.reason, 'default');
  });
});
