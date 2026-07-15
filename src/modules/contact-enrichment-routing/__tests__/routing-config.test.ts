/**
 * Tests — Contact Enrichment Routing Config/Policy Contract
 * (Hito 17B.4X.7C.5A)
 *
 * Every assertion here proves the config contract is safe to exist in the
 * codebase WITHOUT changing any runtime behavior: automatic routing stays
 * disabled by default, the pure builder never touches process.env directly,
 * and no runner file wires this module into an execution path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG,
  CONTACT_ENRICHMENT_ROUTING_FIRST_ROLLOUT_REASON,
  CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV,
  CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV,
  CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_FLAG,
  CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION,
  CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION,
  CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_FLAG,
  buildContactEnrichmentRoutingConfigV1,
  buildContactEnrichmentRoutingPolicyFromConfig,
  type ContactEnrichmentRoutingConfigV1,
} from '../routing-config.server';
import { ROUTING_MAX_PROVIDER_ATTEMPTS_V1 } from '../types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── A. Defaults ──────────────────────────────────────────────────────────

describe('buildContactEnrichmentRoutingConfigV1 — defaults (no env)', () => {
  const config = buildContactEnrichmentRoutingConfigV1({});

  it('automaticRoutingEnabled defaults to false', () => {
    assert.equal(config.automaticRoutingEnabled, false);
  });

  it('mode defaults to observe_only', () => {
    assert.equal(config.mode, 'observe_only');
  });

  it('primaryProvider is apollo, fallbackProvider is lusha', () => {
    assert.equal(config.primaryProvider, 'apollo');
    assert.equal(config.fallbackProvider, 'lusha');
  });

  it('maxAttempts defaults to 2', () => {
    assert.equal(config.maxAttempts, 2);
  });

  it('enabledFallbackReasons excludes low_quality_results-style reasons and includes only zero_reviewable_candidates by default', () => {
    assert.deepEqual(config.enabledFallbackReasons, ['zero_reviewable_candidates']);
  });

  it('firstRolloutReason is zero_reviewable_candidates', () => {
    assert.equal(config.firstRolloutReason, 'zero_reviewable_candidates');
    assert.equal(config.firstRolloutReason, CONTACT_ENRICHMENT_ROUTING_FIRST_ROLLOUT_REASON);
  });

  it('providerErrorFallbackEnabled defaults to false', () => {
    assert.equal(config.providerErrorFallbackEnabled, false);
  });

  it('zeroReviewableFallbackEnabled defaults to true', () => {
    assert.equal(config.zeroReviewableFallbackEnabled, true);
  });

  it('budgetGuardrailEnabled defaults to false, perRequestMaxEstimatedCostUsd defaults to null', () => {
    assert.equal(config.budgetGuardrailEnabled, false);
    assert.equal(config.perRequestMaxEstimatedCostUsd, null);
  });

  it('allowManualProviderSelection is true, requireHumanReview is true', () => {
    assert.equal(config.allowManualProviderSelection, true);
    assert.equal(config.requireHumanReview, true);
  });

  it('allowHubSpotAutoWrite is false, allowPhoneReveal is false', () => {
    assert.equal(config.allowHubSpotAutoWrite, false);
    assert.equal(config.allowPhoneReveal, false);
  });

  it('policyVersion defaults to the observe-only label', () => {
    assert.equal(config.policyVersion, CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION);
  });
});

// ── B. Automatic flag false still blocks automatic mode ─────────────────

describe('buildContactEnrichmentRoutingConfigV1 — automatic flag false', () => {
  it('mode stays observe_only even when both fallback reasons are enabled', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG]: 'false',
      [CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_FLAG]: 'true',
      [CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_FLAG]: 'true',
    });
    assert.equal(config.automaticRoutingEnabled, false);
    assert.equal(config.mode, 'observe_only');
    assert.equal(config.policyVersion, CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION);
  });
});

// ── C. Automatic flag true — config-only, no execution ───────────────────

describe('buildContactEnrichmentRoutingConfigV1 — automatic flag true (config only)', () => {
  const config = buildContactEnrichmentRoutingConfigV1({
    [CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG]: 'true',
  });

  it('automaticRoutingEnabled reflects true', () => {
    assert.equal(config.automaticRoutingEnabled, true);
  });

  it('mode reflects automatic', () => {
    assert.equal(config.mode, 'automatic');
  });

  it('policyVersion reflects the automatic label', () => {
    assert.equal(config.policyVersion, CONTACT_ENRICHMENT_ROUTING_V1_AUTOMATIC_POLICY_VERSION);
  });

  it('provider order and safety invariants stay fixed regardless of the flag', () => {
    assert.equal(config.primaryProvider, 'apollo');
    assert.equal(config.fallbackProvider, 'lusha');
    assert.equal(config.allowHubSpotAutoWrite, false);
    assert.equal(config.allowPhoneReveal, false);
    assert.equal(config.requireHumanReview, true);
  });
});

// ── D. Invalid providers ──────────────────────────────────────────────────

describe('buildContactEnrichmentRoutingConfigV1 — provider order is not env-configurable', () => {
  it('no env key can flip primary/fallback order — there is no parsing path for it', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      CONTACT_ENRICHMENT_ROUTING_PRIMARY_PROVIDER: 'lusha',
      CONTACT_ENRICHMENT_ROUTING_FALLBACK_PROVIDER: 'apollo',
    });
    assert.equal(config.primaryProvider, 'apollo');
    assert.equal(config.fallbackProvider, 'lusha');
  });
});

// ── E. Invalid maxAttempts ─────────────────────────────────────────────────

describe('buildContactEnrichmentRoutingConfigV1 — maxAttempts parsing', () => {
  it('unset → default 2', () => {
    assert.equal(buildContactEnrichmentRoutingConfigV1({}).maxAttempts, 2);
  });

  it('value > cap (3) → clamps to 2', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV]: '3',
    });
    assert.equal(config.maxAttempts, ROUTING_MAX_PROVIDER_ATTEMPTS_V1);
  });

  it('value < 1 (0) → falls back to default 2', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV]: '0',
    });
    assert.equal(config.maxAttempts, 2);
  });

  it('negative value → falls back to default 2', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV]: '-5',
    });
    assert.equal(config.maxAttempts, 2);
  });

  it('non-numeric value → falls back to default 2', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV]: 'not-a-number',
    });
    assert.equal(config.maxAttempts, 2);
  });

  it('valid value 1 is accepted (stricter-than-default, no fallback attempts)', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ATTEMPTS_ENV]: '1',
    });
    assert.equal(config.maxAttempts, 1);
  });
});

// ── F. Invalid / disabled reasons ─────────────────────────────────────────

describe('buildContactEnrichmentRoutingConfigV1 — fallback reasons', () => {
  it('low_quality_results has no corresponding flag — cannot be enabled at all', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      CONTACT_ENRICHMENT_ROUTING_LOW_QUALITY_RESULTS_ENABLED: 'true',
    });
    assert.ok(!config.enabledFallbackReasons.includes('low_quality_results' as never));
  });

  it('only_duplicates has no corresponding flag — cannot be enabled at all', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      CONTACT_ENRICHMENT_ROUTING_ONLY_DUPLICATES_ENABLED: 'true',
    });
    assert.ok(!config.enabledFallbackReasons.includes('only_duplicates' as never));
  });

  it('provider_error stays behind its own flag, off by default', () => {
    const disabled = buildContactEnrichmentRoutingConfigV1({});
    assert.ok(!disabled.enabledFallbackReasons.includes('provider_error'));

    const enabled = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_FLAG]: 'true',
    });
    assert.ok(enabled.enabledFallbackReasons.includes('provider_error'));
  });

  it('zero_reviewable_candidates is permitted (on by default, can be explicitly disabled)', () => {
    const onByDefault = buildContactEnrichmentRoutingConfigV1({});
    assert.ok(onByDefault.enabledFallbackReasons.includes('zero_reviewable_candidates'));

    const explicitlyDisabled = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_FLAG]: 'false',
    });
    assert.ok(!explicitlyDisabled.enabledFallbackReasons.includes('zero_reviewable_candidates'));
  });
});

// ── G. Budget cap parsing ──────────────────────────────────────────────────

describe('buildContactEnrichmentRoutingConfigV1 — budget cap parsing', () => {
  it('empty/unset → no cap (budgetGuardrailEnabled=false, cost=null)', () => {
    const config = buildContactEnrichmentRoutingConfigV1({});
    assert.equal(config.budgetGuardrailEnabled, false);
    assert.equal(config.perRequestMaxEstimatedCostUsd, null);
  });

  it('valid positive value → parsed and guardrail enabled', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV]: '2.5',
    });
    assert.equal(config.budgetGuardrailEnabled, true);
    assert.equal(config.perRequestMaxEstimatedCostUsd, 2.5);
  });

  it('zero or negative value → ignored safely (no cap)', () => {
    const zero = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV]: '0',
    });
    const negative = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV]: '-1',
    });
    assert.equal(zero.budgetGuardrailEnabled, false);
    assert.equal(zero.perRequestMaxEstimatedCostUsd, null);
    assert.equal(negative.budgetGuardrailEnabled, false);
    assert.equal(negative.perRequestMaxEstimatedCostUsd, null);
  });

  it('non-numeric value → ignored safely (no cap)', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_MAX_ESTIMATED_COST_USD_ENV]: 'abc',
    });
    assert.equal(config.budgetGuardrailEnabled, false);
    assert.equal(config.perRequestMaxEstimatedCostUsd, null);
  });
});

// ── H. Policy builder ──────────────────────────────────────────────────────

describe('buildContactEnrichmentRoutingPolicyFromConfig', () => {
  it('default config → valid policy with Apollo primary, Lusha fallback, correct reasons', () => {
    const config = buildContactEnrichmentRoutingConfigV1({});
    const result = buildContactEnrichmentRoutingPolicyFromConfig(config);
    assert.equal(result.valid, true);
    if (!result.valid) throw new Error('expected valid');
    assert.equal(result.policy.candidatePrimaryProvider, 'apollo');
    assert.equal(result.policy.fallbackProvider, 'lusha');
    assert.deepEqual(result.policy.enabledFallbackReasons, ['zero_reviewable_candidates']);
    assert.equal(result.policy.maxProviderAttempts, ROUTING_MAX_PROVIDER_ATTEMPTS_V1);
  });

  it('config with maxAttempts=1 → the pure evaluator rejects it (structural cap fixed at 2)', () => {
    const config: ContactEnrichmentRoutingConfigV1 = {
      ...buildContactEnrichmentRoutingConfigV1({}),
      maxAttempts: 1,
    };
    const result = buildContactEnrichmentRoutingPolicyFromConfig(config);
    assert.equal(result.valid, false);
    if (result.valid) throw new Error('expected invalid');
    assert.ok(result.errors.some((e) => e.code === 'invalid_max_provider_attempts'));
  });

  it('policy builder never throws even with all reasons enabled', () => {
    const config = buildContactEnrichmentRoutingConfigV1({
      [CONTACT_ENRICHMENT_ROUTING_PROVIDER_ERROR_FALLBACK_FLAG]: 'true',
      [CONTACT_ENRICHMENT_ROUTING_ZERO_REVIEWABLE_FALLBACK_FLAG]: 'true',
    });
    const result = buildContactEnrichmentRoutingPolicyFromConfig(config);
    assert.equal(result.valid, true);
  });
});

// ── I. Observe-only path stays untouched by this module ──────────────────

describe('observe-only path independence', () => {
  it('CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION matches the literal used by routing-observation-wiring.ts', () => {
    const wiringSource = readFileSync(
      path.join(
        __dirname,
        '../../../server/agents/contact-enrichment-toolkit/routing-observation-wiring.ts',
      ),
      'utf8',
    );
    assert.ok(
      wiringSource.includes(
        `'${CONTACT_ENRICHMENT_ROUTING_V1_OBSERVE_ONLY_POLICY_VERSION}'`,
      ),
      'routing-observation-wiring.ts must still define the same observe-only policy version string',
    );
  });
});

// ── J. No execution wiring — static source scan ───────────────────────────

describe('no execution wiring — static source scan', () => {
  const runnerFiles = [
    '../../../server/agents/contact-enrichment-toolkit/apollo-enrichment-runner.ts',
    '../../../server/agents/contact-enrichment-toolkit/lusha-enrichment-runner.ts',
    '../../../server/agents/contact-enrichment-toolkit/routing-observation-wiring.ts',
    '../../../server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator.ts',
  ];

  for (const relativePath of runnerFiles) {
    it(`${relativePath} does not import routing-config.server`, () => {
      const source = readFileSync(path.join(__dirname, relativePath), 'utf8');
      assert.ok(
        !source.includes('routing-config.server') && !source.includes('routing-config'),
        `${relativePath} must not import the automatic routing config contract in this hito`,
      );
    });

    it(`${relativePath} does not call the automatic policy builder or getContactEnrichmentRoutingConfigV1`, () => {
      const source = readFileSync(path.join(__dirname, relativePath), 'utf8');
      assert.ok(!source.includes('buildContactEnrichmentRoutingPolicyFromConfig'));
      assert.ok(!source.includes('getContactEnrichmentRoutingConfigV1'));
    });

    it(`${relativePath} does not create attemptOrder: 2 (a second, automatic attempt)`, () => {
      const source = readFileSync(path.join(__dirname, relativePath), 'utf8');
      assert.ok(
        !/attemptOrder:\s*2\b/.test(source),
        `${relativePath} must not create a second (fallback) attempt`,
      );
    });
  }

  it('this module never calls Apollo or Lusha runner functions', () => {
    const source = readFileSync(path.join(__dirname, '../routing-config.server.ts'), 'utf8');
    assert.ok(!source.includes('executeContactEnrichmentApolloRun'));
    assert.ok(!source.includes('executeContactEnrichmentLushaRun'));
    assert.ok(!source.includes('runContactEnrichmentApollo'));
    assert.ok(!source.includes('runContactEnrichmentLusha'));
  });
});
