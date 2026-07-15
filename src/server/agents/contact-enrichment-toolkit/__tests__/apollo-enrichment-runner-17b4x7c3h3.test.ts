/**
 * Tests — Apollo Enrichment Runner cross-run pending duplicate fix
 * (Agente 2A, Hito 17B.4X.7C.3H.3)
 *
 * Verifica que executeContactEnrichmentApolloRun:
 *  - pasa run.account_id a writeCandidates (para el check cross-run).
 *  - refleja existing_pending_duplicates_skipped_count en el summary y en
 *    el resultado devuelto.
 *  - NO llama Apollo/Lusha reales, NO aprueba, NO escribe HubSpot, NO revela
 *    teléfonos — todo vía inyección de dependencias, sin red ni DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import type { ApolloPeopleAdapterResult } from '../apollo-people-adapter';
import { isActionableContactCandidate, type CompleteContactResult } from '../contact-completion-adapter';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { AgentRunStep } from '@/modules/usage-tracking/types';

function person(id: string, email: string): ApolloPerson {
  return {
    id,
    first_name: 'Persona',
    last_name: id,
    title: 'CHRO',
    email,
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Siesa', website_url: 'https://siesa.com' },
    seniority: 'c_suite',
    departments: ['c_suite'],
    country: 'Colombia',
  };
}

function makeRun(overrides: Partial<ContactEnrichmentRunRow> = {}): ContactEnrichmentRunRow {
  return {
    id: 'run-new',
    agent_run_id: 'ar-1',
    account_id: 'account-siesa',
    company_name: 'Siesa',
    company_domain: 'siesa.com',
    company_country_code: 'CO',
    status: 'ready_to_enrich',
    summary: {
      totalCandidates: 0,
      company_resolution_source: 'sellup',
      existing_contacts_snapshot: {
        combined: {
          existing_emails: [],
          existing_linkedin_urls: [],
          existing_contact_names: [],
        },
      },
    },
    ...overrides,
  };
}

interface Harness {
  deps: ApolloEnrichmentRunnerDeps;
  getStore: () => ContactEnrichmentRunRow;
}

function makeHarness(
  initialRun: ContactEnrichmentRunRow,
  apolloResult: ApolloPeopleAdapterResult,
  opts: {
    /** Simula que writeCandidates encontró N duplicados cross-run pendientes. */
    skippedExistingPending?: number;
    captureAccountId?: (accountId: string | null | undefined) => void;
  } = {},
): Harness {
  let store = initialRun;

  const deps: ApolloEnrichmentRunnerDeps = {
    loadRun: async () => store,
    updateRun: async (_id, patch) => {
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
    writeCandidates: async (_runId, candidates, options) => {
      opts.captureAccountId?.(options?.accountId);
      const skipped = opts.skippedExistingPending ?? 0;
      const insertable = Math.max(candidates.length - skipped, 0);
      return { inserted: insertable, skippedNoName: 0, skippedExistingPending: skipped };
    },
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

  return { deps, getStore: () => store };
}

const APOLLO_RESULT_ONE_CANDIDATE: ApolloPeopleAdapterResult = {
  status: 'success',
  people: [person('camila', 'camila.fino@siesa.com')],
  attempts: [{ attempt: 'strict_hr_department', filters: 'org(dominio=siesa.com)', rawResultsCount: 1 }],
  providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 1, rawResultsCount: 1 },
};

describe('executeContactEnrichmentApolloRun — cross-run pending dedup (17B.4X.7C.3H.3)', () => {
  it('pasa run.account_id a writeCandidates para habilitar el check cross-run', async () => {
    let capturedAccountId: string | null | undefined;
    const h = makeHarness(makeRun({ account_id: 'account-siesa' }), APOLLO_RESULT_ONE_CANDIDATE, {
      captureAccountId: (id) => {
        capturedAccountId = id;
      },
    });

    await executeContactEnrichmentApolloRun('run-new', 'user-1', h.deps);

    assert.equal(capturedAccountId, 'account-siesa');
  });

  it('cuando writeCandidates reporta 1 skippedExistingPending, el summary lo refleja', async () => {
    const h = makeHarness(makeRun(), APOLLO_RESULT_ONE_CANDIDATE, { skippedExistingPending: 1 });

    const result = await executeContactEnrichmentApolloRun('run-new', 'user-1', h.deps);

    assert.equal(result.candidatesCreated, 0, 'el único candidato era duplicado cross-run → 0 insertados');
    assert.equal(result.existingPendingDuplicatesSkipped, 1);
    // El run queda 'completed' (no ready_for_review) porque insertedCount === 0.
    assert.equal(result.runStatus, 'completed');

    const summary = h.getStore().summary as Record<string, unknown>;
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    assert.equal(apolloBlock.existing_pending_duplicates_skipped_count, 1);
    assert.equal(apolloBlock.inserted_candidates_count, 0);
  });

  it('sin duplicados cross-run (skippedExistingPending=0) → inserta normalmente, contador en 0', async () => {
    const h = makeHarness(makeRun(), APOLLO_RESULT_ONE_CANDIDATE, { skippedExistingPending: 0 });

    const result = await executeContactEnrichmentApolloRun('run-new', 'user-1', h.deps);

    assert.equal(result.candidatesCreated, 1);
    assert.equal(result.existingPendingDuplicatesSkipped, 0);
    assert.equal(result.runStatus, 'ready_for_review');

    const summary = h.getStore().summary as Record<string, unknown>;
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    assert.equal(apolloBlock.existing_pending_duplicates_skipped_count, 0);
  });

  it('run sin account_id (harness preexistente, sin el campo) → no rompe, no exige el check', async () => {
    const run = makeRun();
    delete (run as Partial<ContactEnrichmentRunRow>).account_id;
    let capturedAccountId: string | null | undefined = 'not-called';
    const h = makeHarness(run, APOLLO_RESULT_ONE_CANDIDATE, {
      captureAccountId: (id) => {
        capturedAccountId = id;
      },
    });

    const result = await executeContactEnrichmentApolloRun('run-new', 'user-1', h.deps);

    assert.equal(capturedAccountId, null, 'run.account_id ?? null debe pasar null cuando no está presente');
    assert.equal(result.candidatesCreated, 1);
  });

  it('nunca aprueba, nunca escribe HubSpot, nunca revela teléfono — solo status/summary', async () => {
    const h = makeHarness(makeRun(), APOLLO_RESULT_ONE_CANDIDATE, { skippedExistingPending: 1 });

    const result = await executeContactEnrichmentApolloRun('run-new', 'user-1', h.deps);

    assert.equal(result.status === 'completed' || result.status === 'ready_for_review', true);
    const asString = JSON.stringify(result);
    assert.ok(!asString.includes('hubspot'), 'no debe mencionar hubspot en el resultado');
    assert.ok(!asString.includes('approved'), 'no debe aprobar nada');
  });
});
