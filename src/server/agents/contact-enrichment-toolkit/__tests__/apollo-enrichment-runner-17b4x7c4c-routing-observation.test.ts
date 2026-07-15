/**
 * Tests — Apollo Enrichment Runner × Observe-Only Routing Wiring
 * (Agente 2A, Hito 17B.4X.7C.4C)
 *
 * Observe-only: no fallback is ever executed, no attempt_order=2 is ever
 * created, and no automatic provider selection happens. This suite only
 * verifies what gets RECORDED on contact_enrichment_runs after a manual
 * Apollo run completes — behavior (which provider ran, what got inserted)
 * is unchanged and already covered by apollo-enrichment-runner.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
  type RunPatch,
} from '../apollo-enrichment-runner';
import { APOLLO_NOT_CONNECTED_REASON, type ApolloPeopleAdapterResult } from '../apollo-people-adapter';
import { isActionableContactCandidate, type CompleteContactResult } from '../contact-completion-adapter';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { AgentRunStep } from '@/modules/usage-tracking/types';

function person(id: string, email: string): ApolloPerson {
  return {
    id,
    first_name: 'Persona',
    last_name: id,
    title: 'HR Manager',
    email,
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Corp', website_url: 'https://corp.com' },
    seniority: 'manager',
    departments: ['human_resources'],
    country: 'Colombia',
  };
}

function makeRun(overrides: Partial<ContactEnrichmentRunRow> = {}): ContactEnrichmentRunRow {
  return {
    id: 'run-1',
    agent_run_id: 'ar-1',
    company_name: 'Corp',
    company_domain: 'corp.com',
    company_country_code: 'CO',
    status: 'ready_to_enrich',
    summary: {
      totalCandidates: 0,
      company_resolution_source: 'sellup',
      existing_contacts_snapshot: {
        combined: { existing_emails: [], existing_linkedin_urls: [], existing_contact_names: [] },
      },
    },
    ...overrides,
  };
}

function makeHarness(initialRun: ContactEnrichmentRunRow, apolloResult: ApolloPeopleAdapterResult) {
  let store = initialRun;
  const runPatches: RunPatch[] = [];

  const deps: ApolloEnrichmentRunnerDeps = {
    loadRun: async () => store,
    updateRun: async (_id, patch) => {
      runPatches.push(patch);
      store = {
        ...store,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      };
    },
    claimRunForExecution: async (runId) => {
      if (store.id !== runId) return { status: 'not_found' };
      if (store.status !== 'ready_to_enrich') {
        return { status: 'not_ready', currentStatus: store.status };
      }
      store = { ...store, status: 'enriching' };
      return { status: 'claimed', row: store };
    },
    runApollo: async () => apolloResult,
    writeCandidates: async (_runId, candidates) => ({ inserted: candidates.length, skippedNoName: 0 }),
    completeContact: async ({ candidate, relevanceStatus }) => {
      const actionable = isActionableContactCandidate(candidate, relevanceStatus);
      return {
        status: 'skipped',
        contact: candidate,
        completedFields: [],
        wasActionableBefore: actionable,
        isActionableAfter: actionable,
        reason: actionable ? 'candidate_already_actionable' : 'insufficient_input_for_match',
      } satisfies CompleteContactResult;
    },
    loadApolloUnitCost: async () => 0.00875,
    logUsage: async () => true,
    createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
    finishStep: async () => true,
    updateAgentRun: async () => true,
  };

  return {
    deps,
    getStore: () => store,
    getRunPatches: () => runPatches,
    getLastPatch: () => runPatches[runPatches.length - 1],
  };
}

describe('executeContactEnrichmentApolloRun × routing observation (17B.4X.7C.4C)', () => {
  it('A — success with pending_review candidates: observed, not_applicable, no fallback recommended', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [person('a', 'a@corp.com'), person('b', 'b@corp.com')],
      attempts: [{ attempt: 'strict_hr_department', filters: 'dept=HR', rawResultsCount: 2 }],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 2, rawResultsCount: 2 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.candidatesCreated, 2);
    const patch = h.getLastPatch();
    assert.equal(patch.routing_mode, 'observed');
    assert.equal(patch.provider_attempt_role, 'manual');
    assert.equal(patch.fallback_reason, 'not_applicable');
    assert.equal(patch.routing_policy_version, 'contact_enrichment_routing_v1_observe_only');
    const summary = h.getStore().summary as Record<string, unknown>;
    const observation = summary.routing_observation as Record<string, unknown>;
    assert.equal(observation.would_recommend_fallback, false);
    assert.equal(observation.fallback_executed, false);
    assert.equal(observation.actual_provider, 'apollo');
    assert.equal(observation.actual_provider_was_policy_primary, true);
    // No fallback attempt: writeCandidates/runApollo were only ever called once
    // implicitly (result.candidatesCreated matches the single Apollo call).
  });

  it('B — success with zero reviewable candidates: fallback_reason=zero_reviewable_candidates, not executed', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [], // no raw results at all → zero reviewable, zero inserted
      attempts: [{ attempt: 'strict_hr_department', filters: 'dept=HR', rawResultsCount: 0 }],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 0, rawResultsCount: 0 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.candidatesCreated, 0);
    const patch = h.getLastPatch();
    assert.equal(patch.routing_mode, 'observed');
    assert.equal(patch.fallback_reason, 'zero_reviewable_candidates');
    const summary = h.getStore().summary as Record<string, unknown>;
    const observation = summary.routing_observation as Record<string, unknown>;
    assert.equal(observation.would_recommend_fallback, true);
    assert.equal(observation.fallback_executed, false);
    assert.equal(observation.automatic_routing_enabled, false);
  });

  it('C — provider_error (real Apollo call failed): fallback_reason=provider_error, not executed', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'error',
      people: [],
      attempts: [],
      reason: 'Error de red consultando Apollo: fetch failed',
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'error');
    const patch = h.getLastPatch();
    assert.equal(patch.routing_mode, 'observed');
    assert.equal(patch.fallback_reason, 'provider_error');
    assert.equal(patch.providers_used?.[0], 'apollo');
    const summary = h.getStore().summary as Record<string, unknown>;
    const observation = summary.routing_observation as Record<string, unknown>;
    assert.equal(observation.would_recommend_fallback, true);
    assert.equal(observation.fallback_executed, false);
  });

  it('F — Apollo not connected (no real call attempted): routing columns stay unset (manual)', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'error',
      people: [],
      attempts: [],
      reason: APOLLO_NOT_CONNECTED_REASON,
    };
    const h = makeHarness(makeRun(), apollo);

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const patch = h.getLastPatch();
    assert.equal(patch.routing_mode, undefined, 'no routing_mode patch when no real provider call happened');
    assert.equal(patch.provider_attempt_role, undefined);
    assert.equal(patch.fallback_reason, undefined);
    assert.equal(patch.routing_policy_version, undefined);
    const summary = h.getStore().summary as Record<string, unknown>;
    assert.equal(summary.routing_observation, undefined, 'no fabricated observation for a call that never happened');
  });

  it('never creates a second attempt / never calls Lusha from the Apollo runner (structural)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'apollo-enrichment-runner.ts'),
      'utf8',
    );
    assert.equal(source.includes('lusha-enrichment-runner'), false, 'Apollo runner must never import the Lusha runner');
    assert.equal(source.includes('attempt_order: 2'), false);
    assert.equal(/attempt_order:\s*2\b/.test(source), false);
  });
});
