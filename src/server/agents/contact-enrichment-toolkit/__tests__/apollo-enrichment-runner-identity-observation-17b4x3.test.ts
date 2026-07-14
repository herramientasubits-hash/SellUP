/**
 * Tests — Apollo Enrichment Runner × Person Identity Observation
 * (Agente 2A, Hito 17B.4X.3)
 *
 * Verifica que el runner persista `apollo_person_identity_observation` en
 * `enrichment_metadata` cuando el completion result lo trae, preservando el
 * resto de la metadata existente, y que NUNCA escriba `person_identity` para
 * candidatos Apollo (reservado a Lusha). Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import type { ApolloPeopleAdapterResult } from '../apollo-people-adapter';
import type { CompleteContactResult } from '../contact-completion-adapter';
import type { ApolloPersonIdentityObservationV1 } from '../apollo-person-identity-observation';
import type { DeduplicatedContact } from '../contact-deduplicator';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { AgentRunStep } from '@/modules/usage-tracking/types';

function person(id: string): ApolloPerson {
  return {
    id,
    first_name: 'Ana',
    last_name: 'Gómez',
    title: 'HR Manager',
    email: 'ana@corp.com',
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Corp', website_url: 'https://corp.com' },
    seniority: 'manager',
    departments: ['human_resources'],
    country: 'Colombia',
  };
}

function makeRun(): ContactEnrichmentRunRow {
  return {
    id: 'run-17b4x3',
    agent_run_id: 'ar-17b4x3',
    company_name: 'Corp',
    company_domain: 'corp.com',
    company_country_code: 'CO',
    status: 'ready_to_enrich',
    summary: {
      totalCandidates: 0,
      existing_contacts_snapshot: {
        combined: { existing_emails: [], existing_linkedin_urls: [], existing_contact_names: [] },
      },
    },
  };
}

function makeApolloResult(): ApolloPeopleAdapterResult {
  return {
    status: 'success',
    people: [person('apollo-obs-1')],
    attempts: [{ attempt: 'org_name_hr_titles_fallback', filters: '{}', rawResultsCount: 1 }],
    providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 1, rawResultsCount: 1 },
  };
}

const FAKE_OBSERVATION: ApolloPersonIdentityObservationV1 = {
  search_contact_id: 'apollo-obs-1',
  search_full_name: 'Ana',
  search_linkedin_url: null,
  match_contact_id: 'apollo-obs-1',
  match_full_name: 'Ana Gómez',
  match_linkedin_url: 'https://linkedin.com/in/ana',
  match_request_signals: { id: true, linkedin: false, email: false, name: true, company: true },
  id_consistency: 'match',
  name_consistency: 'mismatch',
};

function makeHarness(completeContactFn: ApolloEnrichmentRunnerDeps['completeContact']): {
  deps: ApolloEnrichmentRunnerDeps;
  written: DeduplicatedContact[][];
} {
  const written: DeduplicatedContact[][] = [];
  const deps: ApolloEnrichmentRunnerDeps = {
    loadRun: async () => makeRun(),
    updateRun: async () => {},
    // In-memory stand-in for the atomic claim (17B.4X.7C.2) — mirrors
    // loadRun's always-ready_to_enrich fixture.
    claimRunForExecution: async () => ({ status: 'claimed', row: makeRun() }),
    runApollo: async () => makeApolloResult(),
    writeCandidates: async (_runId, candidates) => {
      written.push([...candidates]);
      return { inserted: candidates.length, skippedNoName: 0 };
    },
    completeContact: completeContactFn,
    loadApolloUnitCost: async () => 0,
    logUsage: async () => true,
    createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
    finishStep: async () => true,
  };
  return { deps, written };
}

describe('executeContactEnrichmentApolloRun — apollo_person_identity_observation', () => {
  it('persiste la observación bajo apollo_person_identity_observation preservando otra metadata', async () => {
    const completeContactFn: ApolloEnrichmentRunnerDeps['completeContact'] = async ({ candidate }) => {
      const completed: CompleteContactResult = {
        status: 'completed',
        contact: { ...candidate, linkedinUrl: 'https://linkedin.com/in/ana' },
        completedFields: ['linkedin_url'],
        wasActionableBefore: false,
        isActionableAfter: true,
        apolloPersonIdentityObservation: FAKE_OBSERVATION,
      };
      return completed;
    };

    const { deps, written } = makeHarness(completeContactFn);
    const result = await executeContactEnrichmentApolloRun('run-17b4x3', 'user-1', deps);

    assert.equal(result.status, 'ready_for_review');
    assert.equal(written.length, 1);
    const [candidate] = written[0];
    const metadata = candidate.enrichmentMetadata;

    assert.deepEqual(metadata.apollo_person_identity_observation, FAKE_OBSERVATION);
    // Metadata existente preservada (no reemplazada).
    assert.ok(metadata.relevance);
    assert.ok(metadata.company_consistency);
    assert.ok(metadata.completion);
    assert.ok(metadata.post_completion);
    // Apollo nunca escribe person_identity (reservado a Lusha).
    assert.equal('person_identity' in metadata, false);
  });

  it('candidato sin observación (no hubo intento real de match) no incluye la clave', async () => {
    const completeContactFn: ApolloEnrichmentRunnerDeps['completeContact'] = async ({ candidate }) => ({
      status: 'skipped',
      contact: candidate,
      completedFields: [],
      wasActionableBefore: true,
      isActionableAfter: true,
      reason: 'candidate_already_actionable',
    });

    const { deps, written } = makeHarness(completeContactFn);
    await executeContactEnrichmentApolloRun('run-17b4x3', 'user-1', deps);

    assert.equal(written.length, 1);
    const [candidate] = written[0];
    assert.equal('apollo_person_identity_observation' in candidate.enrichmentMetadata, false);
    assert.equal('person_identity' in candidate.enrichmentMetadata, false);
  });
});
