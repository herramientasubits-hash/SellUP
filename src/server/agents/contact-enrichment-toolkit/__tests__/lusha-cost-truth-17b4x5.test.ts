/**
 * Tests — Lusha Cost Truth · Agente 2A · 17B.4X.5
 *
 * Covers:
 *   - loadActiveLushaCreditPricing null-safety (missing config → never a 0 fallback)
 *   - computeLushaCreditCostComponent (with an injected pricing loader — no DB)
 *   - lushaSearchUnknownCostComponent (search is always unknown)
 *   - buildLushaRunCostSummaryFields / noProviderCallAttemptedCostSummaryFields
 *   - buildProviderUsageLogInsertPayload (estimated_cost_usd null-write contract)
 *
 * All pure / dependency-injected. No live Supabase. No provider calls. No DB writes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeLushaCreditCostComponent,
  lushaSearchUnknownCostComponent,
  buildLushaRunCostSummaryFields,
  noProviderCallAttemptedCostSummaryFields,
  type LushaRunCostComponentV1,
} from '../lusha-enrichment-runner';
import { loadActiveLushaCreditPricing } from '../../../../modules/usage-tracking/provider-pricing';
import { buildProviderUsageLogInsertPayload } from '../../../../modules/usage-tracking/logging';

const LUSHA_UNIT_COST = 0.08823529;

function stubPricing(unitCostUsd: number) {
  return async () => ({
    pricingConfigId: 'pricing-row-1',
    providerKey: 'lusha',
    operationKey: 'credit',
    unit: 'per_credit' as const,
    unitCostUsd,
  });
}

const stubMissingPricing = async () => null;

// ─── loadActiveLushaCreditPricing — null-safety ────────────────────────────

describe('loadActiveLushaCreditPricing', () => {
  it('returns null (never a fabricated 0) when Supabase credentials are unavailable', async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const result = await loadActiveLushaCreditPricing();
      assert.equal(result, null);
    } finally {
      if (origUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    }
  });
});

// ─── computeLushaCreditCostComponent / lushaSearchUnknownCostComponent ─────

describe('computeLushaCreditCostComponent', () => {
  it('TEST 6: enrich, credits=1, active pricing → estimated 0.08823529', async () => {
    const component = await computeLushaCreditCostComponent(
      'lusha_contact_enrich',
      1,
      undefined,
      stubPricing(LUSHA_UNIT_COST),
    );

    assert.equal(component.truthSource, 'estimated');
    assert.equal(component.estimatedCostUsd, Number(LUSHA_UNIT_COST.toFixed(6)));
    assert.equal(component.realCostUsd, null);
    assert.equal(component.costTrace.truth_source, 'estimated');
    if (component.costTrace.truth_source === 'estimated') {
      assert.equal(component.costTrace.unit_cost_usd_snapshot, LUSHA_UNIT_COST);
      assert.equal(component.costTrace.pricing_config_id, 'pricing-row-1');
      assert.equal(component.costTrace.pricing_provider_key, 'lusha');
      assert.equal(component.costTrace.pricing_operation_key, 'credit');
      assert.equal(component.costTrace.credit_unit_assumption, undefined);
    }
  });

  it('a configured zero unit cost remains a valid estimated 0, not unknown', async () => {
    const component = await computeLushaCreditCostComponent(
      'lusha_contact_enrich',
      3,
      undefined,
      stubPricing(0),
    );

    assert.equal(component.truthSource, 'estimated');
    assert.equal(component.estimatedCostUsd, 0);
  });

  it('TEST 7: credits null → unknown/credits_not_available (pricing never consulted)', async () => {
    let pricingCalled = false;
    const component = await computeLushaCreditCostComponent(
      'lusha_contact_enrich',
      null,
      undefined,
      async () => { pricingCalled = true; return null; },
    );

    assert.equal(pricingCalled, false, 'pricing loader must not be called when credits are unknown');
    assert.equal(component.truthSource, 'unknown');
    assert.equal(component.estimatedCostUsd, null);
    assert.equal(component.costTrace.truth_source, 'unknown');
    if (component.costTrace.truth_source === 'unknown') {
      assert.equal(component.costTrace.unknown_reason, 'credits_not_available');
    }
  });

  it('credits undefined → unknown/credits_not_available (same as null)', async () => {
    const component = await computeLushaCreditCostComponent(
      'lusha_contact_enrich',
      undefined,
      undefined,
      stubMissingPricing,
    );

    assert.equal(component.truthSource, 'unknown');
    if (component.costTrace.truth_source === 'unknown') {
      assert.equal(component.costTrace.unknown_reason, 'credits_not_available');
    }
  });

  it('TEST 8: credits known but pricing unavailable → unknown/pricing_not_available', async () => {
    const component = await computeLushaCreditCostComponent(
      'lusha_contact_enrich',
      2,
      undefined,
      stubMissingPricing,
    );

    assert.equal(component.truthSource, 'unknown');
    assert.equal(component.estimatedCostUsd, null);
    if (component.costTrace.truth_source === 'unknown') {
      assert.equal(component.costTrace.unknown_reason, 'pricing_not_available');
    }
  });

  it('TEST 9: prospecting aggregated credits=4 → correct multiplication + fungibility assumption trace', async () => {
    const component = await computeLushaCreditCostComponent(
      'lusha_contact_prospecting',
      4,
      'prospecting_and_enrich_treated_as_fungible',
      stubPricing(LUSHA_UNIT_COST),
    );

    assert.equal(component.truthSource, 'estimated');
    assert.equal(component.estimatedCostUsd, Number((4 * LUSHA_UNIT_COST).toFixed(6)));
    if (component.costTrace.truth_source === 'estimated') {
      assert.equal(
        component.costTrace.credit_unit_assumption,
        'prospecting_and_enrich_treated_as_fungible',
      );
    }
  });

  it('TEST 10: search is always unknown/search_credit_cost_not_mapped', () => {
    const component = lushaSearchUnknownCostComponent();

    assert.equal(component.operationKey, 'lusha_contact_search');
    assert.equal(component.truthSource, 'unknown');
    assert.equal(component.estimatedCostUsd, null);
    if (component.costTrace.truth_source === 'unknown') {
      assert.equal(component.costTrace.unknown_reason, 'search_credit_cost_not_mapped');
    }
  });
});

// ─── buildLushaRunCostSummaryFields / noProviderCallAttemptedCostSummaryFields ──

describe('buildLushaRunCostSummaryFields', () => {
  const estimatedComponent: LushaRunCostComponentV1 = {
    operationKey: 'lusha_contact_enrich',
    estimatedCostUsd: 0.1,
    realCostUsd: null,
    truthSource: 'estimated',
    costTrace: {
      truth_source: 'estimated',
      pricing_provider_key: 'lusha',
      pricing_operation_key: 'credit',
      pricing_unit: 'per_credit',
      unit_cost_usd_snapshot: 0.1,
    },
  };
  const unknownComponent: LushaRunCostComponentV1 = lushaSearchUnknownCostComponent();

  it('TEST 15: all estimated components → run truth estimated, complete numeric total', () => {
    const fields = buildLushaRunCostSummaryFields([estimatedComponent]);

    assert.equal(fields.cost_truth_source, 'estimated');
    assert.equal(fields.known_cost_subtotal_usd, 0.1);
    assert.equal(fields.unknown_cost_component_count, 0);
  });

  it('TEST 16: estimated + unknown → run truth unknown, known subtotal preserved', () => {
    const fields = buildLushaRunCostSummaryFields([estimatedComponent, unknownComponent]);

    assert.equal(fields.cost_truth_source, 'unknown');
    assert.equal(fields.known_cost_subtotal_usd, 0.1);
    assert.equal(fields.unknown_cost_component_count, 1);
  });

  it('TEST 17: all unknown → run truth unknown, known subtotal 0 (not free)', () => {
    const fields = buildLushaRunCostSummaryFields([unknownComponent]);

    assert.equal(fields.cost_truth_source, 'unknown');
    assert.equal(fields.known_cost_subtotal_usd, 0);
    assert.equal(fields.unknown_cost_component_count, 1);
  });

  it('TEST 17b: zero components (operation attempted, no signal) → unknown, not free', () => {
    const fields = buildLushaRunCostSummaryFields([]);

    assert.equal(fields.cost_truth_source, 'unknown');
    assert.equal(fields.known_cost_subtotal_usd, 0);
    assert.equal(fields.unknown_cost_component_count, 0);
  });

  it('no provider call attempted → true zero, estimated (not unknown)', () => {
    const fields = noProviderCallAttemptedCostSummaryFields();

    assert.equal(fields.cost_truth_source, 'estimated');
    assert.equal(fields.known_cost_subtotal_usd, 0);
    assert.equal(fields.unknown_cost_component_count, 0);
  });
});

// ─── buildProviderUsageLogInsertPayload — estimated_cost_usd write contract ─

describe('buildProviderUsageLogInsertPayload', () => {
  const emptySnapshot = { roleKey: null, groupId: null };

  it('TEST 11: explicit null → payload carries null', () => {
    const payload = buildProviderUsageLogInsertPayload(
      { provider_key: 'lusha', operation_key: 'lusha_contact_search', estimated_cost_usd: null },
      emptySnapshot,
    );

    assert.equal(payload['estimated_cost_usd'], null);
  });

  it('TEST 12: explicit zero → payload carries 0 (valid known cost)', () => {
    const payload = buildProviderUsageLogInsertPayload(
      { provider_key: 'lusha', operation_key: 'lusha_contact_prospecting', estimated_cost_usd: 0 },
      emptySnapshot,
    );

    assert.equal(payload['estimated_cost_usd'], 0);
  });

  it('TEST 13: explicit positive number → payload carries exact value', () => {
    const payload = buildProviderUsageLogInsertPayload(
      {
        provider_key: 'lusha',
        operation_key: 'lusha_contact_enrich',
        estimated_cost_usd: LUSHA_UNIT_COST,
      },
      emptySnapshot,
    );

    assert.equal(payload['estimated_cost_usd'], LUSHA_UNIT_COST);
  });

  it('TEST 14: omitted estimated_cost_usd → backward-compatible default of 0', () => {
    const payload = buildProviderUsageLogInsertPayload(
      { provider_key: 'apollo', operation_key: 'mixed_companies_search' },
      emptySnapshot,
    );

    assert.equal(payload['estimated_cost_usd'], 0);
  });

  it('real_cost_usd is always null regardless of estimated_cost_usd', () => {
    const payload = buildProviderUsageLogInsertPayload(
      {
        provider_key: 'lusha',
        operation_key: 'lusha_contact_enrich',
        estimated_cost_usd: LUSHA_UNIT_COST,
      },
      emptySnapshot,
    );

    assert.equal(payload['real_cost_usd'], null);
  });
});
