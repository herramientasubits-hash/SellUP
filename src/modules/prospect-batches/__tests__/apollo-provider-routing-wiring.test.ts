/**
 * Q3F-5BB.11E — Apollo ⇄ provider-routing wiring (OBSERVATIONAL).
 *
 * Proves the OBSERVATIONAL Apollo wiring without any provider call, DB write, or
 * env activation:
 *   1. The pure adapter builds default_ai→apollo criteria/config and a safe plan
 *      (selected='apollo', intended='default_ai', no fallback, no Lusha).
 *   2. Apollo OFF → default_ai legitimately resolves to Tavily / null; the assert
 *      tolerates that (semantics differ from Lusha's explicit intent).
 *   3. Apollo can never be a Lusha fallback (10C3 invariant preserved).
 *   4. Static safety: the adapter reads no env / Supabase / provider clients /
 *      contact-enrichment / phone reveal; the runtime wiring imports none of
 *      those either.
 *   5. Runtime (mocked deps): when the resolver selects apollo_organizations the
 *      Apollo pipeline receives additive provider_routing (selected='apollo');
 *      when it selects tavily no Apollo routing metadata is attached and Apollo
 *      is never called.
 *   6. The provider_routing block is additive (only new keys) and never coerces
 *      Apollo's known USD cost incorrectly.
 *   7. The safety assert throws on Lusha usage / a Lusha-intent Apollo plan / an
 *      enabled-but-not-selected Apollo plan.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildApolloRoutingCriteria,
  buildApolloRoutingConfig,
  buildApolloObservationalRegistry,
  assertApolloRoutingPlanSafe,
  ApolloRoutingPlanUnsafeError,
  APOLLO_ROUTING_PLAN_UNSAFE_CODE,
  APOLLO_ROUTING_SEARCH_TYPE,
} from '@/modules/prospect-batches/apollo-provider-routing-adapter';
import {
  resolveProviderRoutingPlan,
  type ProviderRoutingPlan,
} from '@/modules/prospect-batches/provider-routing';
import { executeProspectWizardGeneration } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions';
import type {
  WizardExecutionDeps,
  ReserveBudgetDepResult,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions';
import type { WizardExecutionReservationResult } from '@/modules/prospect-batches/chat-wizard-execution/wizard-idempotency';
import type { CatalogResolutionOutput } from '@/modules/prospect-batches/chat-wizard-execution/wizard-catalog-resolver';
import type { WizardApolloInput } from '@/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor';
import type { WizardTavilyInput } from '@/modules/prospect-batches/chat-wizard-execution/wizard-tavily-executor';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

const ROOT = process.cwd();

/** Narrow an unknown JSONB value to a record for assertion access. */
const rec = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;

/** Apollo cost is 10 × $0.00875 — assert within float tolerance (never exact). */
const APOLLO_USD_MAX = 0.0875;
function assertUsd(actual: unknown, expected: number): void {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs((actual as number) - expected) < 1e-9, `expected ~${expected}, got ${String(actual)}`);
}

/** Strip block + line comments so source-text checks target real CODE only. */
function readCode(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Build the OBSERVATIONAL Apollo plan exactly as the wiring does. */
function buildApolloPlan(
  apolloEnabled: boolean,
  environment: 'production' | 'preview' | 'development' = 'production',
): ProviderRoutingPlan {
  return resolveProviderRoutingPlan(
    buildApolloRoutingCriteria({ countryCode: 'CO', sectorKey: 'tecnologia' }),
    buildApolloRoutingConfig({ environment, apolloEnabled }),
    buildApolloObservationalRegistry(),
  );
}

// ── 1. Adapter — criteria + config are default_ai→apollo, no fallback ─────────

describe('11E adapter — default_ai→apollo criteria/config, no fallback', () => {
  it('buildApolloRoutingCriteria intends default_ai, companies_by_criteria, company-only', () => {
    const criteria = buildApolloRoutingCriteria({ countryCode: 'MX', sectorKey: 'salud' });
    assert.equal(criteria.intendedProvider, 'default_ai');
    assert.equal(criteria.searchType, 'companies_by_criteria');
    assert.equal(criteria.searchType, APOLLO_ROUTING_SEARCH_TYPE);
    assert.equal(criteria.countryCode, 'MX');
    assert.equal(criteria.sector, 'salud');
    assert.equal(criteria.needsCompanySearch, true);
    // Company discovery only — never people / contact enrichment.
    assert.equal(criteria.needsPeopleSearch, false);
    assert.equal(criteria.needsEnrichment, false);
  });

  it('buildApolloRoutingConfig is observe_only, no fallback, apollo as default_ai', () => {
    const config = buildApolloRoutingConfig({ environment: 'production', apolloEnabled: true });
    assert.equal(config.mode, 'observe_only');
    assert.equal(config.allowFallback, false);
    assert.deepEqual(config.fallbackChain, []);
    assert.equal(config.defaultAiProvider, 'apollo');
    assert.equal(config.enabledProviders.apollo, true);
    assert.equal(config.enabledProviders.lusha, undefined);
    assert.equal(config.enabledProviders.tavily, undefined);
    assert.equal(config.environment, 'production');
    assert.equal(config.minUsefulCandidates, 5);
  });

  it('resolved plan (apollo ON) selects Apollo, needs confirmation, known USD cost', () => {
    const plan = buildApolloPlan(true);
    assert.equal(plan.intendedProvider, 'default_ai');
    assert.equal(plan.selectedProvider, 'apollo');
    assert.equal(plan.wouldUseApollo, true);
    assert.equal(plan.wouldUseLusha, false);
    assert.equal(plan.wouldUseTavily, false);
    assert.deepEqual(plan.fallbackChain, []);
    // Apollo is high-risk → confirmation required.
    assert.equal(plan.requiresUserConfirmation, true);
    // observe_only ⇒ dry-run only, never auto-executes.
    assert.equal(plan.dryRunOnly, true);
    assert.equal(plan.allowedToExecute, false);
    // Apollo USD cost IS known: 10 credits × $0.00875 = $0.0875.
    assert.equal(plan.estimatedCost.unknown, false);
    assert.equal(plan.estimatedCost.credits, 10);
    assertUsd(plan.estimatedCost.usdMax, APOLLO_USD_MAX);
    // The 10C3 invariant markers are always present.
    assert.equal(plan.invariants.lushaNeverFallsBackToApollo, true);
  });
});

// ── 2. Apollo OFF — default_ai may resolve Tavily / null (NOT unsafe) ─────────

describe('11E Apollo OFF — default_ai resolves elsewhere; assert tolerates it', () => {
  it('apolloEnabled=false → plan does not select Apollo (blocked / null)', () => {
    const plan = buildApolloPlan(false);
    // With no fallback chain and Apollo disabled, nothing is selectable.
    assert.equal(plan.selectedProvider, null);
    assert.equal(plan.wouldUseApollo, false);
    assert.equal(plan.wouldUseLusha, false);
  });

  it('assertApolloRoutingPlanSafe does NOT throw for a null/tavily plan when Apollo OFF', () => {
    const nullPlan = buildApolloPlan(false);
    assert.doesNotThrow(() => assertApolloRoutingPlanSafe(nullPlan, { apolloEnabled: false }));

    // A hypothetical Tavily selection under Apollo-off is also tolerated.
    const tavilyPlan: ProviderRoutingPlan = {
      ...nullPlan,
      selectedProvider: 'tavily',
      wouldUseTavily: true,
    };
    assert.doesNotThrow(() => assertApolloRoutingPlanSafe(tavilyPlan, { apolloEnabled: false }));
  });
});

// ── 3. No Lusha fallback — 10C3 invariant preserved by the Apollo adapter ─────

describe('11E no Lusha fallback — 10C3 invariant intact', () => {
  it('a Lusha intent never produces wouldUseApollo=true (belt-and-suspenders)', () => {
    // Even if someone mislabeled the intent as Lusha but pointed default_ai at
    // apollo, the resolver's hard 10C3 override keeps Apollo out.
    const plan = resolveProviderRoutingPlan(
      { intendedProvider: 'lusha', searchType: 'companies_by_criteria', countryCode: 'CO', sector: 'tecnologia', needsCompanySearch: true },
      buildApolloRoutingConfig({ environment: 'production', apolloEnabled: true }),
      buildApolloObservationalRegistry(),
    );
    assert.equal(plan.wouldUseApollo, false);
    assert.equal(plan.invariants.lushaNeverFallsBackToApollo, true);
  });

  it('Apollo adapter config never enables Lusha and never lists a fallback chain', () => {
    const config = buildApolloRoutingConfig({ environment: 'preview', apolloEnabled: true });
    assert.equal(config.enabledProviders.lusha, undefined);
    assert.deepEqual(config.fallbackChain, []);
    assert.equal(config.allowFallback, false);
  });
});

// ── 4. Static safety — adapter is pure; wiring avoids Lusha/contact/phone ─────

describe('11E static safety — pure adapter, scoped wiring', () => {
  const ADAPTER = 'src/modules/prospect-batches/apollo-provider-routing-adapter.ts';
  const WIRING = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';

  it('adapter reads no process.env', () => {
    assert.doesNotMatch(readCode(ADAPTER), /process\.env/);
  });

  it('adapter imports no Supabase / DB client', () => {
    assert.doesNotMatch(readCode(ADAPTER), /supabase|createClient/i);
  });

  it('adapter imports no provider runtime clients', () => {
    const code = readCode(ADAPTER);
    assert.doesNotMatch(code, /apollo-client|apollo-organizations|apollo-cost|lusha-client|lusha-preview|tavily|web-search/i);
  });

  it('adapter imports no contact-enrichment / apollo phone reveal', () => {
    const importPaths = [...readCode(ADAPTER).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const p of importPaths) {
      assert.doesNotMatch(p, /contact-enrichment/i, `adapter must not import ${p}`);
      assert.doesNotMatch(p, /phone-reveal|phone_reveal|apollo-phone/i, `adapter must not import ${p}`);
    }
  });

  it('adapter performs no fetch / DB write', () => {
    const code = readCode(ADAPTER);
    assert.doesNotMatch(code, /\bfetch\s*\(/);
    assert.doesNotMatch(code, /\.(insert|upsert|delete)\s*\(|\.from\(\s*['"]/);
  });

  it('runtime wiring imports no contact-enrichment / apollo phone reveal', () => {
    const importPaths = [...readCode(WIRING).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const p of importPaths) {
      assert.doesNotMatch(p, /contact-enrichment/i, `wiring must not import ${p}`);
      assert.doesNotMatch(p, /phone-reveal|phone_reveal|apollo-phone/i, `wiring must not import ${p}`);
    }
  });
});

// ── 5 + 6. Runtime (mocked deps) — observational batch routing metadata ───────

const VALID_INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174001';
const VALID_SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-426614174002';
const CATALOG_VERSION = 'v2024-01';
const BATCH_A = 'batch-a-uuid-0001';
const FAKE_USER_ID = 'user-fake-uuid-0002';
const FAKE_RESERVATION_ID = 'reservation-fake-0001';

const VALID_REQUEST_FULL = {
  countryCode: 'CO',
  industryId: VALID_INDUSTRY_ID,
  subindustryIds: [VALID_SUBINDUSTRY_ID],
  additionalCriteriaRaw: null,
  catalogVersion: CATALOG_VERSION,
  clientRequestId: '423e4567-e89b-12d3-a456-426614174003',
};

const FAKE_CATALOG_RESOLUTION: CatalogResolutionOutput = {
  country: { code: 'CO', name: 'Colombia' },
  catalog: { version: CATALOG_VERSION },
  industry: { id: VALID_INDUSTRY_ID, slug: 'tecnologia', name: 'Tecnología' },
  subindustries: [
    { id: VALID_SUBINDUSTRY_ID, slug: 'saas', name: 'SaaS', applicableCountries: ['CO'] },
  ],
};

function makePipelineOutput(batchId: string, candidatesCreated = 5): IncrementalSearchOutput {
  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      webSearchProvider: 'apollo_organizations',
      targetInternal: 25,
      existingBatchId: batchId,
      triggeredByUserId: FAKE_USER_ID,
      ownerId: FAKE_USER_ID,
      dryRun: false,
    },
    candidates: [],
    candidatesCount: 0,
    usefulCandidatesCount: candidatesCreated,
    candidatesCreated,
    metadata: { rounds: [], dry_run: false },
    warnings: [],
    batchId,
  } as unknown as IncrementalSearchOutput;
}

type RuntimeSpies = {
  apolloCalls: WizardApolloInput[];
  tavilyCalls: WizardTavilyInput[];
};

function makeDeps(
  provider: 'apollo_organizations' | 'tavily',
  spies: RuntimeSpies,
): WizardExecutionDeps {
  return {
    getActiveUserId: async () => FAKE_USER_ID,
    resolveCatalog: async () => FAKE_CATALOG_RESOLUTION,
    checkTavilyAvailability: async () => true,
    // A1-APOLLO-WIZARD-1: el preflight de Apollo falla cerrado, así que las
    // pruebas de la ruta Apollo deben declararlo disponible.
    checkApolloAvailability: async () => ({ available: true } as const),
    reserveBudget: async () =>
      ({ status: 'reserved', reservationId: FAKE_RESERVATION_ID, creditsReserved: 10 } satisfies ReserveBudgetDepResult),
    confirmBudget: async () => ({ status: 'confirmed' }),
    releaseBudget: async () => ({ status: 'released' }),
    readConsumedCredits: async () => 10,
    reserveSlot: async () =>
      ({ status: 'reserved', batchId: BATCH_A } satisfies WizardExecutionReservationResult),
    runTavilyPipeline: async (input) => {
      spies.tavilyCalls.push(input);
      return makePipelineOutput(BATCH_A);
    },
    runApolloPipeline: async (input) => {
      spies.apolloCalls.push(input);
      return makePipelineOutput(BATCH_A);
    },
    resolveProvider: () => provider,
    markBatchFailed: async () => undefined,
  };
}

async function withExecutionFlag<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  try {
    return await fn();
  } finally {
    if (saved !== undefined) process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved;
    else delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
  }
}

describe('11E runtime — Apollo selection attaches observational provider_routing', () => {
  it('apollo_organizations → Apollo pipeline receives additive provider_routing (selected=apollo)', async () => {
    const spies: RuntimeSpies = { apolloCalls: [], tavilyCalls: [] };
    const result = await withExecutionFlag(() =>
      executeProspectWizardGeneration(VALID_REQUEST_FULL, makeDeps('apollo_organizations', spies)),
    );

    assert.equal(result.ok, true);
    // Apollo ran; Tavily never called.
    assert.equal(spies.apolloCalls.length, 1);
    assert.equal(spies.tavilyCalls.length, 0);

    const extra = rec(spies.apolloCalls[0]!.extraBatchMetadata);
    const routing = rec(extra.provider_routing);
    assert.ok(extra.provider_routing, 'provider_routing present in extraBatchMetadata');
    assert.equal(routing.contract_version, 'provider_routing_v1');
    assert.equal(routing.intended_provider, 'default_ai');
    assert.equal(routing.selected_provider, 'apollo');
    assert.equal(routing.mode, 'observe_only');
    assert.equal(routing.fallback_allowed, false);
    assert.equal(routing.dry_run_only, true);
    assert.equal(routing.requires_confirmation, true);
    assert.equal(routing.blocked_reason, null);
    // Apollo USD cost is known and correct — never coerced.
    const cost = rec(routing.estimated_cost);
    assert.equal(cost.unknown, false);
    assert.equal(cost.credits_max, 10);
    assertUsd(cost.usd_max, APOLLO_USD_MAX);
  });

  it('la metadata observacional lleva SÓLO claves conocidas y aditivas', async () => {
    const spies: RuntimeSpies = { apolloCalls: [], tavilyCalls: [] };
    await withExecutionFlag(() =>
      executeProspectWizardGeneration(VALID_REQUEST_FULL, makeDeps('apollo_organizations', spies)),
    );
    const extra = rec(spies.apolloCalls[0]!.extraBatchMetadata);

    // El propósito de esta prueba no es "exactamente una clave": es que el
    // cableado sólo pueda AÑADIR claves conocidas y jamás quitar ni sobrescribir
    // metadata del lote. Cada clave nueva exige pasar por aquí de forma
    // deliberada, que es justamente lo que hace de guardia.
    //
    // A1-APOLLO-TWO-ROUND-QUALITY-1 § 1 añade `run_provider_selection`: los tres
    // campos de la selección de proveedor por corrida (solicitado, resuelto y
    // motivo). Son códigos estáticos y booleanos — ni claves, ni tokens, ni
    // consultas.
    assert.deepEqual(
      Object.keys(extra).sort(),
      ['provider_routing', 'run_provider_selection'],
    );

    const selection = rec(extra.run_provider_selection);
    assert.equal(selection.resolved_discovery_provider, 'apollo_organizations');
    assert.equal(selection.is_run_level_override, false);
  });

  it('tavily → no Apollo routing metadata and Apollo pipeline never called', async () => {
    const spies: RuntimeSpies = { apolloCalls: [], tavilyCalls: [] };
    const result = await withExecutionFlag(() =>
      executeProspectWizardGeneration(VALID_REQUEST_FULL, makeDeps('tavily', spies)),
    );

    assert.equal(result.ok, true);
    assert.equal(spies.apolloCalls.length, 0, 'Apollo must not be called for the Tavily path');
    assert.equal(spies.tavilyCalls.length, 1);
    // The Tavily executor input has no provider_routing (Tavily routing = future hito).
    const tavilyInput = spies.tavilyCalls[0]! as unknown as Record<string, unknown>;
    assert.equal('extraBatchMetadata' in tavilyInput, false);
  });
});

// ── 7. Safety assert ──────────────────────────────────────────────────────────

describe('11E safety assert — never Lusha, never Lusha→Apollo, apollo-when-enabled', () => {
  const safePlan = buildApolloPlan(true);

  it('a safe Apollo plan (apollo ON, selected=apollo) passes', () => {
    assert.doesNotThrow(() => assertApolloRoutingPlanSafe(safePlan, { apolloEnabled: true }));
  });

  it('wouldUseLusha=true throws APOLLO_ROUTING_PLAN_UNSAFE', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, wouldUseLusha: true };
    assert.throws(
      () => assertApolloRoutingPlanSafe(unsafe, { apolloEnabled: true }),
      (err: unknown) =>
        err instanceof ApolloRoutingPlanUnsafeError &&
        err.code === APOLLO_ROUTING_PLAN_UNSAFE_CODE &&
        err.reason === 'would_use_lusha',
    );
  });

  it('a Lusha-intent plan with wouldUseApollo=true throws (10C3 defensive)', () => {
    const unsafe: ProviderRoutingPlan = {
      ...safePlan,
      intendedProvider: 'lusha',
      wouldUseApollo: true,
    };
    assert.throws(
      () => assertApolloRoutingPlanSafe(unsafe, { apolloEnabled: true }),
      (err: unknown) =>
        err instanceof ApolloRoutingPlanUnsafeError &&
        err.reason === 'lusha_intent_would_use_apollo',
    );
  });

  it('apollo ENABLED but selectedProvider !== apollo throws', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, selectedProvider: 'tavily', wouldUseApollo: false };
    assert.throws(
      () => assertApolloRoutingPlanSafe(unsafe, { apolloEnabled: true }),
      (err: unknown) =>
        err instanceof ApolloRoutingPlanUnsafeError &&
        err.reason === 'selected_provider_not_apollo',
    );
  });

  it('apollo ENABLED but selectedProvider null throws — never a silent skip', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, selectedProvider: null, wouldUseApollo: false };
    assert.throws(
      () => assertApolloRoutingPlanSafe(unsafe, { apolloEnabled: true }),
      ApolloRoutingPlanUnsafeError,
    );
  });
});
