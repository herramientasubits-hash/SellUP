/**
 * Q3F-5BB.11B — resolver contract + invariant tests.
 *
 * Pure, offline, deterministic. No env, no provider calls, no DB. Covers the
 * 11A contract cases A–G, the hard 10C3 invariant matrix, cost handling,
 * fallback rules, and manual/explicit selection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveProviderRoutingPlan,
  DEFAULT_PROVIDER_REGISTRY,
} from '../index';
import type {
  ProviderCapabilityDescriptor,
  ProviderCapabilityRegistry,
  ProviderRoutingConfig,
  ProviderRoutingCriteria,
  RoutingIntent,
} from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const REGISTRY = DEFAULT_PROVIDER_REGISTRY;

function makeConfig(overrides: Partial<ProviderRoutingConfig> = {}): ProviderRoutingConfig {
  return {
    mode: 'observe_only',
    allowFallback: false,
    minUsefulCandidates: 5,
    enabledProviders: {},
    environment: 'production',
    ...overrides,
  };
}

/** Lusha-eligible search criteria (companies-by-criteria + mapped sector + supported country). */
function lushaEligibleCriteria(
  overrides: Partial<ProviderRoutingCriteria> = {},
): ProviderRoutingCriteria {
  return {
    intendedProvider: 'lusha',
    searchType: 'companies_by_criteria',
    countryCode: 'CO',
    sector: 'healthcare',
    needsCompanySearch: true,
    ...overrides,
  };
}

// ── Case A — Lusha eligible + enabled + observe_only ─────────────────────────

describe('11B Case A — Lusha eligible + enabled + observe_only', () => {
  const plan = resolveProviderRoutingPlan(
    lushaEligibleCriteria(),
    makeConfig({ mode: 'observe_only', enabledProviders: { lusha: true } }),
    REGISTRY,
  );

  it('selects Lusha as primary', () => {
    assert.equal(plan.intendedProvider, 'lusha');
    assert.equal(plan.selectedProvider, 'lusha');
    assert.equal(plan.wouldUseLusha, true);
  });

  it('never routes to Apollo', () => {
    assert.equal(plan.wouldUseApollo, false);
  });

  it('is dry-run only and does not execute in observe_only', () => {
    assert.equal(plan.dryRunOnly, true);
    assert.equal(plan.allowedToExecute, false);
  });
});

// ── Case B — Lusha eligible + Lusha disabled (fail-closed) ───────────────────

describe('11B Case B — Lusha eligible + disabled ⇒ fail-closed', () => {
  const plan = resolveProviderRoutingPlan(
    lushaEligibleCriteria(),
    makeConfig({ enabledProviders: { lusha: false, apollo: true } }),
    REGISTRY,
  );

  it('selects nothing (fail-closed)', () => {
    assert.equal(plan.selectedProvider, null);
  });

  it('reports lusha_preview_disabled', () => {
    assert.equal(plan.blockedReason, 'lusha_preview_disabled');
  });

  it('never falls back to Apollo and cannot execute', () => {
    assert.equal(plan.wouldUseApollo, false);
    assert.equal(plan.allowedToExecute, false);
  });
});

// ── Case C — Not Lusha eligible + default_ai ─────────────────────────────────

describe('11B Case C — default_ai path', () => {
  const criteria: ProviderRoutingCriteria = {
    intendedProvider: 'default_ai',
    searchType: 'companies_by_criteria',
    countryCode: 'JP',
    sector: 'manufacturing',
    needsCompanySearch: true,
  };

  it('defaults to Tavily when no default provider configured', () => {
    const plan = resolveProviderRoutingPlan(
      criteria,
      makeConfig({ enabledProviders: { tavily: true } }),
      REGISTRY,
    );
    assert.equal(plan.selectedProvider, 'tavily');
    assert.equal(plan.wouldUseTavily, true);
    assert.equal(plan.wouldUseApollo, false);
  });

  it('uses Apollo ONLY when config explicitly makes it the default_ai primary', () => {
    const plan = resolveProviderRoutingPlan(
      criteria,
      makeConfig({ defaultAiProvider: 'apollo', enabledProviders: { apollo: true } }),
      REGISTRY,
    );
    assert.equal(plan.selectedProvider, 'apollo');
    assert.equal(plan.wouldUseApollo, true);
  });
});

// ── Case D — Manual provider = lusha ⇒ no fallback chain ─────────────────────

describe('11B Case D — manual provider selection has no fallback chain', () => {
  const plan = resolveProviderRoutingPlan(
    lushaEligibleCriteria({ intendedProvider: 'default_ai' }),
    makeConfig({
      mode: 'manual',
      allowFallback: true,
      explicitProvider: 'lusha',
      explicitProviderSource: 'manual_admin',
      fallbackChain: ['tavily'],
      enabledProviders: { lusha: true, tavily: true },
    }),
    REGISTRY,
  );

  it('selects the manually chosen provider', () => {
    assert.equal(plan.selectedProvider, 'lusha');
  });

  it('builds no fallback chain even though allowFallback + fallbackChain were set', () => {
    assert.equal(plan.fallbackChain.length, 0);
  });

  it('never routes to Apollo', () => {
    assert.equal(plan.wouldUseApollo, false);
  });
});

// ── Case E — QA explicit = lusha ⇒ no chain, never Apollo ────────────────────

describe('11B Case E — QA explicit provider', () => {
  const plan = resolveProviderRoutingPlan(
    lushaEligibleCriteria({ intendedProvider: 'default_ai' }),
    makeConfig({
      mode: 'automatic',
      allowFallback: true,
      explicitProvider: 'lusha',
      explicitProviderSource: 'qa',
      fallbackChain: ['apollo'],
      enabledProviders: { lusha: true, apollo: true },
    }),
    REGISTRY,
  );

  it('has an empty fallback chain', () => {
    assert.equal(plan.fallbackChain.length, 0);
  });

  it('never routes to Apollo even with apollo in fallbackChain', () => {
    assert.equal(plan.wouldUseApollo, false);
    assert.ok(!plan.steps.some((s) => s.provider === 'apollo' && s.status === 'selected'));
  });
});

// ── Case F — cost unknown / high risk ⇒ confirmation, no execution ───────────

describe('11B Case F — cost/risk confirmation gate', () => {
  it('unknown-cost provider requires confirmation and cannot execute', () => {
    const plan = resolveProviderRoutingPlan(
      lushaEligibleCriteria(),
      makeConfig({ mode: 'automatic', enabledProviders: { lusha: true } }),
      REGISTRY,
    );
    assert.equal(plan.estimatedCost.unknown, true);
    assert.equal(plan.requiresUserConfirmation, true);
    assert.equal(plan.allowedToExecute, false);
  });

  it('high-risk provider (Apollo) requires confirmation even with known cost', () => {
    const plan = resolveProviderRoutingPlan(
      {
        intendedProvider: 'default_ai',
        searchType: 'companies_by_criteria',
        countryCode: 'US',
        needsCompanySearch: true,
      },
      makeConfig({
        mode: 'automatic',
        defaultAiProvider: 'apollo',
        enabledProviders: { apollo: true },
      }),
      REGISTRY,
    );
    assert.equal(plan.selectedProvider, 'apollo');
    assert.equal(plan.estimatedCost.unknown, false);
    assert.equal(plan.requiresUserConfirmation, true);
    assert.equal(plan.allowedToExecute, false);
  });
});

// ── Case G — allowFallback=false ⇒ no fallback ───────────────────────────────

describe('11B Case G — allowFallback=false suppresses the chain', () => {
  const plan = resolveProviderRoutingPlan(
    {
      intendedProvider: 'default_ai',
      searchType: 'companies_by_criteria',
      countryCode: 'US',
      needsCompanySearch: true,
    },
    makeConfig({
      allowFallback: false,
      fallbackChain: ['tavily'],
      enabledProviders: { tavily: true },
    }),
    REGISTRY,
  );

  it('produces no fallback steps', () => {
    assert.equal(plan.fallbackChain.length, 0);
    assert.equal(plan.steps.length, 1);
  });
});

// ── Test 1 — 10C3 invariant matrix ───────────────────────────────────────────

describe('11B Test 1 — 10C3 invariant: intended Lusha NEVER uses Apollo', () => {
  const modes: ProviderRoutingConfig['mode'][] = ['observe_only', 'manual', 'automatic'];
  const bools = [true, false];

  for (const mode of modes) {
    for (const lushaEnabled of bools) {
      for (const allowFallback of bools) {
        for (const explicit of [null, 'lusha'] as const) {
          it(`mode=${mode} lushaEnabled=${lushaEnabled} allowFallback=${allowFallback} explicit=${explicit}`, () => {
            const config = makeConfig({
              mode,
              allowFallback,
              // deliberately try to sneak Apollo in through every door:
              defaultAiProvider: 'apollo',
              fallbackChain: ['apollo', 'tavily'],
              enabledProviders: { lusha: lushaEnabled, apollo: true, tavily: true },
              explicitProvider: explicit,
              explicitProviderSource: explicit ? 'qa' : null,
            });
            const plan = resolveProviderRoutingPlan(lushaEligibleCriteria(), config, REGISTRY);

            assert.equal(plan.wouldUseApollo, false, 'wouldUseApollo must be false');
            assert.ok(
              !plan.steps.some((s) => s.provider === 'apollo' && s.status === 'selected'),
              'no Apollo step may be selected',
            );
            assert.equal(plan.invariants.lushaNeverFallsBackToApollo, true);
          });
        }
      }
    }
  }
});

// ── Test 2 — fail-closed on disabled Lusha (matrix) ──────────────────────────

describe('11B Test 2 — Lusha eligible + flag off ⇒ blocked, no Apollo fallback', () => {
  for (const allowFallback of [true, false]) {
    it(`allowFallback=${allowFallback}`, () => {
      const plan = resolveProviderRoutingPlan(
        lushaEligibleCriteria(),
        makeConfig({
          allowFallback,
          fallbackChain: ['apollo', 'tavily'],
          enabledProviders: { lusha: false, apollo: true, tavily: true },
        }),
        REGISTRY,
      );
      assert.equal(plan.selectedProvider, null);
      assert.ok(plan.blockedReason);
      assert.equal(plan.wouldUseApollo, false);
    });
  }
});

// ── Test 3 — cost never treated as free ──────────────────────────────────────

describe('11B Test 3 — unknown cost is never 0', () => {
  it('Lusha (unitCostUsd=null) ⇒ unknown, usdMax=null', () => {
    const plan = resolveProviderRoutingPlan(
      lushaEligibleCriteria(),
      makeConfig({ enabledProviders: { lusha: true } }),
      REGISTRY,
    );
    assert.equal(plan.estimatedCost.unknown, true);
    assert.equal(plan.estimatedCost.usdMax, null);
    assert.notEqual(plan.estimatedCost.usdMax, 0);
    assert.equal(plan.invariants.unknownCostNeverTreatedAsZero, true);
  });

  it('Tavily (pending pricing) ⇒ unknown, requires confirmation', () => {
    const plan = resolveProviderRoutingPlan(
      {
        intendedProvider: 'default_ai',
        searchType: 'companies_by_criteria',
        countryCode: 'US',
        needsCompanySearch: true,
      },
      makeConfig({ enabledProviders: { tavily: true } }),
      REGISTRY,
    );
    assert.equal(plan.estimatedCost.unknown, true);
    assert.equal(plan.requiresUserConfirmation, true);
  });
});

// ── Test 4 — allowFallback=false ⇒ no executable fallback ────────────────────

describe('11B Test 4 — no fallback when allowFallback=false', () => {
  it('default_ai with a chain but allowFallback=false yields no fallback steps', () => {
    const plan = resolveProviderRoutingPlan(
      {
        intendedProvider: 'default_ai',
        searchType: 'companies_by_criteria',
        countryCode: 'US',
        needsCompanySearch: true,
      },
      makeConfig({
        allowFallback: false,
        fallbackChain: ['tavily'],
        enabledProviders: { tavily: true },
      }),
      REGISTRY,
    );
    assert.equal(plan.fallbackChain.length, 0);
  });
});

// ── Test 5 — fallback allowed only in default_ai and only if config permits ──

describe('11B Test 5 — controlled fallback rules', () => {
  it('default_ai (Apollo primary) + Tavily fallback ⇒ eligible, confirm-gated fallback step', () => {
    // The only permitted cross-provider fallback is Tavily↔Apollo WITHIN the
    // default_ai context. Here Apollo is the default_ai primary and Tavily is a
    // fallback-eligible target; the Tavily step is selected but confirm-gated.
    const plan = resolveProviderRoutingPlan(
      {
        intendedProvider: 'default_ai',
        searchType: 'companies_by_criteria',
        countryCode: 'US',
        needsCompanySearch: true,
      },
      makeConfig({
        allowFallback: true,
        defaultAiProvider: 'apollo',
        fallbackChain: ['tavily'],
        enabledProviders: { apollo: true, tavily: true },
      }),
      REGISTRY,
    );
    const tavilyStep = plan.fallbackChain.find((s) => s.provider === 'tavily');
    assert.ok(tavilyStep, 'a tavily fallback step must exist');
    assert.equal(tavilyStep?.role, 'fallback');
    assert.equal(tavilyStep?.status, 'selected');
    assert.equal(
      tavilyStep?.requiresUserConfirmation,
      true,
      'fallback steps must require confirmation',
    );
  });

  it('Apollo is never an eligible fallback target (blocked fallback_not_eligible)', () => {
    const plan = resolveProviderRoutingPlan(
      {
        intendedProvider: 'default_ai',
        searchType: 'companies_by_criteria',
        countryCode: 'US',
        needsCompanySearch: true,
      },
      makeConfig({
        allowFallback: true,
        defaultAiProvider: 'tavily',
        fallbackChain: ['apollo'],
        enabledProviders: { tavily: true, apollo: true },
      }),
      REGISTRY,
    );
    const apolloStep = plan.steps.find((s) => s.provider === 'apollo');
    assert.ok(apolloStep);
    assert.equal(apolloStep?.status, 'blocked');
    assert.equal(apolloStep?.blockedReason, 'fallback_not_eligible');
    assert.equal(plan.wouldUseApollo, false);
  });

  it('Lusha intent never chains to Tavily (or anything)', () => {
    const plan = resolveProviderRoutingPlan(
      lushaEligibleCriteria(),
      makeConfig({
        allowFallback: true,
        fallbackChain: ['tavily'],
        enabledProviders: { lusha: true, tavily: true },
      }),
      REGISTRY,
    );
    assert.equal(plan.fallbackChain.length, 0);
    assert.equal(plan.wouldUseTavily, false);
  });
});

// ── Test — allowedToExecute CAN be true (gate is not hardwired) ──────────────

describe('11B — execution IS allowed when known-cost, low-risk, automatic, no confirmation', () => {
  it('a known-cost low-risk provider executes in automatic mode', () => {
    const cheap: ProviderCapabilityDescriptor = {
      id: 'test_cheap',
      label: 'Test Cheap',
      enabledFlag: null,
      canRunInProduction: true,
      canRunInPreview: true,
      supportsCompanySearch: true,
      supportsPeopleSearch: true,
      supportsEnrichment: true,
      supportedCountries: 'all',
      supportedIndustries: 'all',
      requiredCriteria: ['searchType'],
      costModel: {
        creditsPerUnit: 1,
        resultsPerCredit: 10,
        maxBillableUnits: 1,
        expectedMaxCredits: 1,
        unitCostUsd: 0.001,
        currency: 'USD',
        pricingStatus: 'known',
      },
      fallbackEligible: true,
      riskLevel: 'low',
    };
    const registry: ProviderCapabilityRegistry = { test_cheap: cheap };
    const plan = resolveProviderRoutingPlan(
      {
        intendedProvider: 'test_cheap' as RoutingIntent,
        searchType: 'companies_by_criteria',
        countryCode: 'US',
        needsCompanySearch: true,
      },
      makeConfig({ mode: 'automatic', enabledProviders: { test_cheap: true } }),
      registry,
    );
    assert.equal(plan.selectedProvider, 'test_cheap');
    assert.equal(plan.estimatedCost.unknown, false);
    assert.equal(plan.requiresUserConfirmation, false);
    assert.equal(plan.allowedToExecute, true);
  });
});

// ── Test 6 — manual/explicit provider ⇒ chain=[] (both sources) ──────────────

describe('11B Test 6 — explicit provider has no fallback chain', () => {
  for (const source of ['qa', 'manual_admin'] as const) {
    it(`explicitProviderSource=${source}`, () => {
      const plan = resolveProviderRoutingPlan(
        {
          intendedProvider: 'default_ai',
          searchType: 'companies_by_criteria',
          countryCode: 'US',
          needsCompanySearch: true,
        },
        makeConfig({
          mode: 'manual',
          allowFallback: true,
          explicitProvider: 'tavily',
          explicitProviderSource: source,
          fallbackChain: ['web_ai'],
          enabledProviders: { tavily: true },
        }),
        REGISTRY,
      );
      assert.equal(plan.selectedProvider, 'tavily');
      assert.equal(plan.fallbackChain.length, 0);
    });
  }
});
