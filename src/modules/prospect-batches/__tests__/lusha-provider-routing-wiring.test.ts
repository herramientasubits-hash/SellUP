/**
 * Q3F-5BB.11D — Lusha ⇄ provider-routing wiring (OBSERVATIONAL).
 *
 * Proves the OBSERVATIONAL wiring end-to-end without any provider call, DB write,
 * or env activation:
 *   1. The pure adapter builds Lusha-only criteria/config and a safe plan.
 *   2. Flag OFF → the guard returns the disabled result and NEVER runs the
 *      callback (the only path to the routing plan / runSearch / DB writes);
 *      a static ordering proof shows the routing plan lives inside run().
 *   3. Flag ON (mocked core deps) → the batch carries provider_routing +
 *      a single Lusha provider_attempt, and each candidate carries provider_trace
 *      with a consistent source_provider / source_trace.sourceProvider.
 *   4. Every pre-existing batch + candidate metadata key is preserved.
 *   5. Unknown Lusha USD cost stays null (never coerced to 0).
 *   6. The safety assert throws on Apollo / Tavily / non-Lusha plans.
 *   7. Static safety: the adapter reads no env, no Supabase, no provider clients;
 *      the Lusha runtime imports no Apollo / Tavily.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildLushaRoutingCriteria,
  buildLushaRoutingConfig,
  buildLushaObservationalRegistry,
  assertLushaRoutingPlanSafe,
  LushaRoutingPlanUnsafeError,
  LUSHA_ROUTING_PLAN_UNSAFE_CODE,
  LUSHA_ROUTING_SEARCH_TYPE,
} from '@/modules/prospect-batches/lusha-provider-routing-adapter';
import {
  resolveProviderRoutingPlan,
  buildProviderRoutingMetadata,
  type ProviderRoutingPlan,
} from '@/modules/prospect-batches/provider-routing';
import {
  guardLushaPreviewEnabled,
  buildLushaPendingReviewDisabledResult,
  LUSHA_PREVIEW_DISABLED_ERROR,
} from '@/modules/prospect-batches/lusha-preview-flag-guard';
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type LushaProviderRoutingObservation,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

const ROOT = process.cwd();

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  // AGENT1-LOCAL-CUT9A §§ 3, 8 — identidad de EJECUCIÓN + objetivo PEDIDO.
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: 5,
};

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: 'pc-1',
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: 'https://linkedin.com/company/andes',
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function successResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function emptySecondPage(): LushaPreviewResult {
  return {
    ok: true,
    status: 'empty',
    results: [],
    billing: { creditsCharged: null, resultsReturned: 0, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function noDuplicateResult(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

/** Spy deps: record every write; absence of any other dep proves no side effects. */
function makeDeps(search: LushaPreviewResult, secondPage: LushaPreviewResult = emptySecondPage()) {
  const calls = {
    searchInputs: [] as LushaPreviewInput[],
    batches: [] as LushaPendingReviewBatchRow[],
    candidateBatches: [] as LushaPendingReviewCandidateRow[][],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      calls.searchInputs.push(input);
      return (input.page ?? 0) > 0 ? secondPage : search;
    },
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      calls.batches.push(row);
      return { id: `batch-${calls.batches.length}`, adopted: false, identityEpoch: 0 };
    },
    // CUT-3B4-CORRECCIÓN — la valla es OBLIGATORIA; esta prueba modela la 126
    // SIN aplicar por la ÚNICA puerta legítima: la respuesta de la BASE.
    insertCandidatesFenced: preM126FencedInsert,
    insertCandidates: async (rows) => {
      calls.candidateBatches.push(rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => noDuplicateResult(input),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
  };
  return { deps, calls };
}

/** Build the OBSERVATIONAL routing observation exactly as the action does. */
function buildObservation(
  environment: 'production' | 'preview' = 'production',
): LushaProviderRoutingObservation {
  const routingPlan = resolveProviderRoutingPlan(
    buildLushaRoutingCriteria({ countryCode: INPUT.countryCode, macroIndustryKey: INPUT.macroIndustryKey }),
    buildLushaRoutingConfig({ environment, lushaEnabled: true }),
    buildLushaObservationalRegistry(),
  );
  const routingMetadata = buildProviderRoutingMetadata(routingPlan, {
    environment,
    fallbackAllowed: false,
    fallbackReason: 'lusha_intent_never_chains',
  });
  return { routingMetadata, routingPlan };
}

/** Narrow an unknown JSONB value to a record / array for assertion access. */
const rec = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Strip block + line comments so source-text checks target real CODE only. */
function readCode(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ── 1. Adapter ──────────────────────────────────────────────────────────────

describe('11D adapter — criteria + config are Lusha-only, no fallback', () => {
  it('buildLushaRoutingCriteria intends Lusha, companies_by_criteria, carries country/sector', () => {
    const criteria = buildLushaRoutingCriteria({ countryCode: 'MX', macroIndustryKey: 'technology' });
    assert.equal(criteria.intendedProvider, 'lusha');
    assert.equal(criteria.searchType, 'companies_by_criteria');
    assert.equal(criteria.searchType, LUSHA_ROUTING_SEARCH_TYPE);
    assert.equal(criteria.countryCode, 'MX');
    assert.equal(criteria.sector, 'technology');
    assert.equal(criteria.needsCompanySearch, true);
  });

  it('buildLushaRoutingConfig is manual with no fallback and only Lusha enabled', () => {
    const config = buildLushaRoutingConfig({ environment: 'production', lushaEnabled: true });
    assert.equal(config.mode, 'manual');
    assert.equal(config.allowFallback, false);
    assert.deepEqual(config.fallbackChain, []);
    assert.equal(config.enabledProviders.lusha, true);
    assert.equal(config.enabledProviders.apollo, undefined);
    assert.equal(config.enabledProviders.tavily, undefined);
    assert.equal(config.environment, 'production');
  });

  it('resolved plan uses Lusha and never Apollo/Tavily', () => {
    const plan = resolveProviderRoutingPlan(
      buildLushaRoutingCriteria({ countryCode: 'CO', macroIndustryKey: 'health_pharma' }),
      buildLushaRoutingConfig({ environment: 'production', lushaEnabled: true }),
      buildLushaObservationalRegistry(),
    );
    assert.equal(plan.selectedProvider, 'lusha');
    assert.equal(plan.wouldUseLusha, true);
    assert.equal(plan.wouldUseApollo, false);
    assert.equal(plan.wouldUseTavily, false);
    assert.deepEqual(plan.fallbackChain, []);
    // The 10C3 invariant markers are always present.
    assert.equal(plan.invariants.lushaNeverFallsBackToApollo, true);
  });

  it('OBSERVATIONAL registry: coverage never blocks a live-approved Lusha search', () => {
    // A country/sector OUTSIDE the conservative 11B allowlist (e.g. JP / logistics)
    // still resolves to Lusha because the live guard is authoritative — the plan
    // must not produce a coverage "blocked" false negative. Documents the approach.
    const plan = resolveProviderRoutingPlan(
      buildLushaRoutingCriteria({ countryCode: 'JP', macroIndustryKey: 'transport_logistics' }),
      buildLushaRoutingConfig({ environment: 'production', lushaEnabled: true }),
      buildLushaObservationalRegistry(),
    );
    assert.equal(plan.selectedProvider, 'lusha');
    assert.equal(plan.wouldUseApollo, false);
    assert.equal(plan.wouldUseTavily, false);
  });

  it('flag OFF in config → plan blocks Lusha (fail-closed), still never Apollo', () => {
    const plan = resolveProviderRoutingPlan(
      buildLushaRoutingCriteria({ countryCode: 'CO', macroIndustryKey: 'health_pharma' }),
      buildLushaRoutingConfig({ environment: 'production', lushaEnabled: false }),
      buildLushaObservationalRegistry(),
    );
    assert.equal(plan.selectedProvider, null);
    assert.equal(plan.wouldUseLusha, false);
    assert.equal(plan.wouldUseApollo, false);
    assert.equal(plan.blockedReason, 'lusha_preview_disabled');
  });
});

// ── 2. Flag OFF (guard behavioral + static ordering proof) ────────────────────

describe('11D flag OFF — no routing plan is executable, no side effects', () => {
  it('guard OFF → disabled result, callback (the only path to routing/DB) never runs', async () => {
    let ran = false;
    const res = await guardLushaPreviewEnabled(
      false,
      buildLushaPendingReviewDisabledResult,
      async () => {
        // The routing plan, runSearch, insertBatch and insertCandidates all live
        // exclusively HERE — behind the guard. Flag OFF ⇒ none of it happens.
        ran = true;
        return { ok: true, status: 'success' } as never;
      },
    );
    assert.equal(ran, false);
    assert.equal(res.ok, false);
    assert.equal((res as { error: string }).error, LUSHA_PREVIEW_DISABLED_ERROR);
    assert.equal(res.batchId, null);
  });

  it('static ordering: the routing plan + persist call sit AFTER the guard call', () => {
    const src = readCode('src/modules/prospect-batches/lusha-pending-review-actions.ts');
    const guardIdx = src.indexOf('guardLushaPreviewEnabled(');
    assert.ok(guardIdx >= 0, 'guard must be present');
    for (const marker of [
      'resolveProviderRoutingPlan(',
      'assertLushaRoutingPlanSafe(',
      'persistLushaPendingReviewBatch(',
      'createClient(',
    ]) {
      const idx = src.indexOf(marker);
      assert.ok(idx > guardIdx, `${marker} must appear after the guard call (inside run())`);
    }
  });
});

// ── 3 + 4 + 5. Flag ON — additive metadata on batch + candidates ──────────────

describe('11D flag ON — additive routing metadata is stamped correctly', () => {
  it('batch carries provider_routing + a single Lusha provider_attempt', async () => {
    const { deps, calls } = makeDeps(successResult([company()]));
    const result = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, buildObservation());

    assert.equal(result.status, 'success');
    // Only Lusha ran — no Apollo/Tavily dep exists on `deps`.
    assert.equal(calls.searchInputs.length >= 1, true);

    const meta = rec(calls.batches[0].metadata);
    assert.ok(meta.provider_routing, 'provider_routing present');
    assert.equal(rec(meta.provider_routing).intended_provider, 'lusha');
    assert.equal(rec(meta.provider_routing).selected_provider, 'lusha');
    const attempts = arr(meta.provider_attempts);
    assert.equal(attempts.length, 1);
    assert.equal(rec(attempts[0]).provider, 'lusha');
    assert.equal(rec(attempts[0]).role, 'primary');
    assert.equal(rec(attempts[0]).status, 'ok');
    // Counters flow from the real pipeline.
    assert.equal(rec(attempts[0]).persisted_count, 1);
    assert.equal(rec(attempts[0]).raw_count, 1);
  });

  it('candidates carry provider_trace + consistent source_provider / sourceProvider', async () => {
    const { deps, calls } = makeDeps(successResult([company()]));
    await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, buildObservation());

    const row = calls.candidateBatches[0][0];
    const meta = rec(row.metadata);
    assert.equal(meta.source_provider, 'lusha');
    assert.ok(meta.provider_trace, 'provider_trace present');
    assert.equal(rec(meta.provider_trace).provider, 'lusha');
    assert.equal(rec(meta.provider_trace).role, 'primary');
    assert.equal(rec(meta.provider_trace).source_provider, 'lusha');
    assert.equal(rec(row.source_trace).sourceProvider, 'lusha');
  });

  it('preserves every pre-existing batch + candidate metadata key', async () => {
    const { deps, calls } = makeDeps(successResult([company()]));
    await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, buildObservation());

    const bmeta = rec(calls.batches[0].metadata);
    for (const key of [
      'provider',
      'billing',
      'duplicate_summary',
      'gate_summary',
      'source_enrichment_summary',
      'request',
      'excludedExactDuplicates',
    ]) {
      assert.ok(key in bmeta, `batch metadata must preserve ${key}`);
    }

    const cmeta = rec(calls.candidateBatches[0][0].metadata);
    for (const key of ['provider', 'duplicate_check', 'validation']) {
      assert.ok(key in cmeta, `candidate metadata must preserve ${key}`);
    }
    const strace = rec(calls.candidateBatches[0][0].source_trace);
    for (const key of ['discovery', 'duplicateResolutionVersion', 'accountDuplicateCheck']) {
      assert.ok(key in strace, `source_trace must preserve ${key}`);
    }
  });

  it('unknown Lusha USD cost is never coerced to 0 (stays null)', async () => {
    const { deps, calls } = makeDeps(successResult([company()]));
    await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, buildObservation());

    const meta = rec(calls.batches[0].metadata);
    assert.equal(rec(arr(meta.provider_attempts)[0]).estimated_cost_usd, null);
    assert.equal(rec(rec(meta.provider_routing).estimated_cost).unknown, true);
    assert.equal(rec(rec(meta.provider_routing).estimated_cost).usd_max, null);
  });

  it('WITHOUT an observation → metadata is byte-for-byte pre-11D (no routing keys)', async () => {
    const { deps, calls } = makeDeps(successResult([company()]));
    // Omit the 4th arg entirely — legacy callers must be unaffected.
    const result = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
    assert.equal(result.status, 'success');

    const bmeta = rec(calls.batches[0].metadata);
    assert.equal('provider_routing' in bmeta, false);
    assert.equal('provider_attempts' in bmeta, false);
    const cmeta = rec(calls.candidateBatches[0][0].metadata);
    assert.equal('provider_trace' in cmeta, false);
  });
});

// ── 6. Safety assert ─────────────────────────────────────────────────────────

describe('11D safety assert — never Apollo/Tavily, never non-Lusha', () => {
  const safePlan = resolveProviderRoutingPlan(
    buildLushaRoutingCriteria({ countryCode: 'CO', macroIndustryKey: 'health_pharma' }),
    buildLushaRoutingConfig({ environment: 'production', lushaEnabled: true }),
    buildLushaObservationalRegistry(),
  );

  it('a safe Lusha plan passes', () => {
    assert.doesNotThrow(() => assertLushaRoutingPlanSafe(safePlan));
  });

  it('wouldUseApollo=true throws LUSHA_ROUTING_PLAN_UNSAFE', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, wouldUseApollo: true };
    assert.throws(
      () => assertLushaRoutingPlanSafe(unsafe),
      (err: unknown) =>
        err instanceof LushaRoutingPlanUnsafeError &&
        err.code === LUSHA_ROUTING_PLAN_UNSAFE_CODE &&
        err.reason === 'would_use_apollo',
    );
  });

  it('wouldUseTavily=true throws LUSHA_ROUTING_PLAN_UNSAFE', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, wouldUseTavily: true };
    assert.throws(
      () => assertLushaRoutingPlanSafe(unsafe),
      (err: unknown) =>
        err instanceof LushaRoutingPlanUnsafeError && err.reason === 'would_use_tavily',
    );
  });

  it('selectedProvider !== lusha throws LUSHA_ROUTING_PLAN_UNSAFE', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, selectedProvider: 'tavily' };
    assert.throws(
      () => assertLushaRoutingPlanSafe(unsafe),
      (err: unknown) =>
        err instanceof LushaRoutingPlanUnsafeError &&
        err.reason === 'selected_provider_not_lusha',
    );
  });

  it('null selectedProvider (blocked) throws — never a silent fall-through', () => {
    const unsafe: ProviderRoutingPlan = { ...safePlan, selectedProvider: null };
    assert.throws(() => assertLushaRoutingPlanSafe(unsafe), LushaRoutingPlanUnsafeError);
  });
});

// ── 7. Static safety ─────────────────────────────────────────────────────────

describe('11D static safety — adapter is pure; Lusha runtime avoids Apollo/Tavily', () => {
  const ADAPTER = 'src/modules/prospect-batches/lusha-provider-routing-adapter.ts';

  it('adapter reads no process.env', () => {
    assert.doesNotMatch(readCode(ADAPTER), /process\.env/);
  });

  it('adapter imports no Supabase / DB client', () => {
    assert.doesNotMatch(readCode(ADAPTER), /supabase|createClient/i);
  });

  it('adapter imports no provider runtime clients', () => {
    const code = readCode(ADAPTER);
    assert.doesNotMatch(code, /lusha-client|lusha-preview|lusha-pending-review/i);
    assert.doesNotMatch(code, /apollo-|tavily-|web-search/i);
  });

  it('adapter performs no fetch / DB write', () => {
    const code = readCode(ADAPTER);
    assert.doesNotMatch(code, /\bfetch\s*\(/);
    assert.doesNotMatch(code, /\.(insert|upsert|delete)\s*\(|\.from\(\s*['"]/);
  });

  it('Lusha runtime (core + action) imports no Apollo / Tavily module', () => {
    for (const rel of [
      'src/server/prospect-batches/lusha-pending-review.ts',
      'src/modules/prospect-batches/lusha-pending-review-actions.ts',
    ]) {
      const importPaths = [...readCode(rel).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const p of importPaths) {
        assert.doesNotMatch(p, /apollo/i, `${rel} must not import ${p}`);
        assert.doesNotMatch(p, /tavily/i, `${rel} must not import ${p}`);
      }
    }
  });
});
