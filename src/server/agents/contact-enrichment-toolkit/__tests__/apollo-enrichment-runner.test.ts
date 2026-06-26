/**
 * Tests — Apollo Enrichment Runner (Agente 2A, Hito 17A.3A)
 *
 * Orquestación completa con inyección de dependencias (sin DB, sin red).
 * Verifica transiciones de estado, preservación del snapshot, manejo del
 * proveedor no conectado y que NO se crean contactos finales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import type { ApolloPeopleAdapterResult } from '../apollo-people-adapter';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { AgentRunStep } from '@/modules/usage-tracking/types';

/** Vista mínima de un candidato escrito (para inspeccionar metadata en tests). */
interface DeduplicatedContactLike {
  enrichmentMetadata: Record<string, unknown>;
}

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
        combined: {
          existing_emails: ['existing@corp.com'],
          existing_linkedin_urls: [],
          existing_contact_names: ['Contacto Existente'],
        },
      },
    },
    ...overrides,
  };
}

interface Harness {
  deps: ApolloEnrichmentRunnerDeps;
  getStore: () => ContactEnrichmentRunRow;
  getWriteCalls: () => number;
  getUsageLogged: () => boolean;
}

function makeHarness(
  initialRun: ContactEnrichmentRunRow,
  apolloResult: ApolloPeopleAdapterResult,
): Harness {
  let store = initialRun;
  let writeCalls = 0;
  let usageLogged = false;

  const deps: ApolloEnrichmentRunnerDeps = {
    loadRun: async () => store,
    updateRun: async (_id, patch) => {
      store = {
        ...store,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      };
    },
    runApollo: async () => apolloResult,
    writeCandidates: async (_runId, candidates) => {
      writeCalls += 1;
      return { inserted: candidates.length, skippedNoName: 0 };
    },
    loadApolloUnitCost: async () => 0.00875,
    logUsage: async () => {
      usageLogged = true;
      return true;
    },
    createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
    finishStep: async () => true,
  };

  return {
    deps,
    getStore: () => store,
    getWriteCalls: () => writeCalls,
    getUsageLogged: () => usageLogged,
  };
}

describe('executeContactEnrichmentApolloRun', () => {
  it('inserta candidatos y deja el run en ready_for_review', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [person('a', 'a@corp.com'), person('b', 'b@corp.com')],
      attempts: [
        { attempt: 'strict_hr_department', filters: 'org(dominio=corp.com); department=HR', rawResultsCount: 2 },
      ],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 2, rawResultsCount: 2 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'ready_for_review');
    assert.equal(result.candidatesCreated, 2);
    assert.equal(h.getStore().status, 'ready_for_review');
    assert.equal(h.getUsageLogged(), true);
  });

  it('preserva existing_contacts_snapshot y actualiza summary', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [person('a', 'a@corp.com')],
      attempts: [
        { attempt: 'strict_hr_department', filters: 'org(dominio=corp.com); department=HR', rawResultsCount: 1 },
      ],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 1, rawResultsCount: 1 },
    };
    const h = makeHarness(makeRun(), apollo);

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const summary = h.getStore().summary as Record<string, unknown>;
    // snapshot intacto
    const snapshot = summary.existing_contacts_snapshot as Record<string, unknown>;
    const combined = snapshot.combined as Record<string, unknown>;
    assert.deepEqual(combined.existing_emails, ['existing@corp.com']);
    // summary enriquecido
    assert.equal(summary.totalCandidates, 1);
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    assert.equal(apolloBlock.status, 'success');
    assert.equal(apolloBlock.inserted_candidates_count, 1);
  });

  it('omite exact_duplicates contra el snapshot (no se insertan)', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      // 'existing@corp.com' ya está en el snapshot → exact_duplicate
      people: [person('a', 'existing@corp.com'), person('b', 'nuevo@corp.com')],
      attempts: [
        { attempt: 'strict_hr_department', filters: 'org(dominio=corp.com); department=HR', rawResultsCount: 2 },
      ],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 2, rawResultsCount: 2 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.candidatesCreated, 1);
    assert.equal(result.duplicatesSkipped, 1);
    const apolloBlock = (h.getStore().summary as Record<string, unknown>)
      .apollo_enrichment as Record<string, unknown>;
    assert.equal(apolloBlock.exact_duplicates_count, 1);
  });

  it('proveedor no conectado → run failed controlado, snapshot preservado', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'error',
      people: [],
      attempts: [],
      reason: 'Apollo no está conectado o no tiene credenciales disponibles',
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'error');
    assert.equal(result.providerStatus, 'error');
    assert.equal(h.getStore().status, 'failed');
    assert.equal(h.getWriteCalls(), 0); // nunca intenta escribir candidatos
    const summary = h.getStore().summary as Record<string, unknown>;
    const snapshot = summary.existing_contacts_snapshot as Record<string, unknown>;
    assert.ok(snapshot.combined, 'snapshot debe seguir presente');
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    assert.equal(apolloBlock.status, 'error');
  });

  it('los 3 intentos en 0 → completed, no_contacts_found y search_attempts en summary', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [],
      attempts: [
        { attempt: 'strict_hr_department', filters: 'org(dominio=corp.com); department=HR', rawResultsCount: 0 },
        { attempt: 'hr_titles_without_department', filters: 'org(dominio=corp.com); titles=HR', rawResultsCount: 0 },
        { attempt: 'broad_seniorities_only', filters: 'org(dominio=corp.com); seniorities', rawResultsCount: 0 },
      ],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 0, rawResultsCount: 0 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'completed');
    assert.equal(result.totalCandidates, 0);
    assert.equal(h.getStore().status, 'completed');
    const summary = h.getStore().summary as Record<string, unknown>;
    assert.equal(summary.no_contacts_found, true);
    // snapshot intacto tras 0 resultados
    const snapshot = summary.existing_contacts_snapshot as Record<string, unknown>;
    assert.ok(snapshot.combined, 'snapshot debe seguir presente');
    // search_attempts presentes en el bloque apollo_enrichment
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    const attempts = apolloBlock.search_attempts as Array<Record<string, unknown>>;
    assert.equal(attempts.length, 3);
    assert.deepEqual(
      attempts.map((a) => a.attempt),
      ['strict_hr_department', 'hr_titles_without_department', 'broad_seniorities_only'],
    );
  });

  it('summary incluye search_attempts cuando hubo fallback con resultados', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [person('a', 'a@corp.com')],
      attempts: [
        { attempt: 'strict_hr_department', filters: 'org(dominio=corp.com); department=HR', rawResultsCount: 0 },
        { attempt: 'hr_titles_without_department', filters: 'org(dominio=corp.com); titles=HR', rawResultsCount: 4 },
      ],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 4, rawResultsCount: 4 },
    };
    const h = makeHarness(makeRun(), apollo);

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const apolloBlock = (h.getStore().summary as Record<string, unknown>)
      .apollo_enrichment as Record<string, unknown>;
    const attempts = apolloBlock.search_attempts as Array<Record<string, unknown>>;
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].raw_results_count, 0);
    assert.equal(attempts[1].raw_results_count, 4);
    assert.equal(attempts[1].attempt, 'hr_titles_without_department');
  });

  it('rechaza runs que no están en ready_to_enrich (sin mutar estado)', async () => {
    const h = makeHarness(makeRun({ status: 'completed' }), {
      status: 'success',
      people: [],
      attempts: [],
    });

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'error');
    assert.equal(h.getStore().status, 'completed'); // sin cambios
    assert.equal(h.getWriteCalls(), 0);
  });

  // ── Filtro de relevancia/calidad (Hito 17A.3B) ──────────────────────────────

  it('10 perfiles, 0 insertables (todo ruido) → completed, NO ready_for_review', async () => {
    const noise = (id: string): ApolloPerson => ({
      id,
      first_name: 'Dev',
      last_name: id,
      title: 'Software Engineer',
      email: `${id}@corp.com`,
      linkedin_url: null,
      phone_numbers: [],
      organization: null,
    });
    const people = Array.from({ length: 10 }, (_, i) => noise(`n${i}`));
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people,
      attempts: [{ attempt: 'broad_org_name_only', filters: 'org(nombre=Corp)', rawResultsCount: 10 }],
      chosenAttempt: 'broad_org_name_only',
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 10, rawResultsCount: 10 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'completed');
    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.evaluatedCount, 10);
    assert.equal(result.rejectedByRelevance, 10);
    assert.equal(result.noReviewableContactsFound, true);
    assert.equal(h.getStore().status, 'completed');
    const summary = h.getStore().summary as Record<string, unknown>;
    assert.equal(summary.no_reviewable_contacts_found, true);
    assert.equal(summary.no_contacts_found, false);
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    const filter = apolloBlock.relevance_filter as Record<string, unknown>;
    assert.equal(filter.evaluated_count, 10);
    assert.equal(filter.inserted_for_review_count, 0);
    assert.equal(filter.rejected_count, 10);
    assert.equal(filter.not_relevant_count, 10);
  });

  it('10 perfiles, 2 insertables (HR) → ready_for_review y summary cuenta insertados/rechazados', async () => {
    const noise = (id: string): ApolloPerson => ({
      id,
      first_name: 'Dev',
      last_name: id,
      title: 'Software Engineer',
      email: `${id}@corp.com`,
      linkedin_url: null,
      phone_numbers: [],
      organization: null,
    });
    const people: ApolloPerson[] = [
      ...Array.from({ length: 8 }, (_, i) => noise(`n${i}`)),
      person('hr1', 'hr1@corp.com'),
      person('hr2', 'hr2@corp.com'),
    ];
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people,
      attempts: [{ attempt: 'broad_seniorities_only', filters: 'org(dominio=corp.com); seniorities', rawResultsCount: 10 }],
      chosenAttempt: 'broad_seniorities_only',
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 10, rawResultsCount: 10 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(result.status, 'ready_for_review');
    assert.equal(result.candidatesCreated, 2);
    assert.equal(result.evaluatedCount, 10);
    assert.equal(result.rejectedByRelevance, 8);
    assert.equal(result.noReviewableContactsFound, false);
    assert.equal(h.getStore().status, 'ready_for_review');
    const summary = h.getStore().summary as Record<string, unknown>;
    const apolloBlock = summary.apollo_enrichment as Record<string, unknown>;
    const filter = apolloBlock.relevance_filter as Record<string, unknown>;
    assert.equal(filter.evaluated_count, 10);
    assert.equal(filter.inserted_for_review_count, 2);
    assert.equal(filter.rejected_count, 8);
    assert.equal(filter.high_relevance_count, 2);
  });

  it('candidatos insertados llevan relevance + apollo_search_attempt en enrichment_metadata', async () => {
    let writtenRows: DeduplicatedContactLike[] = [];
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [person('hr1', 'hr1@corp.com')],
      attempts: [{ attempt: 'org_name_hr_titles', filters: 'org(nombre=Corp); titles=HR', rawResultsCount: 1 }],
      chosenAttempt: 'org_name_hr_titles',
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 1, rawResultsCount: 1 },
    };
    const h = makeHarness(makeRun(), apollo);
    h.deps.writeCandidates = async (_runId, candidates) => {
      writtenRows = candidates as unknown as DeduplicatedContactLike[];
      return { inserted: candidates.length, skippedNoName: 0 };
    };

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    assert.equal(writtenRows.length, 1);
    const meta = writtenRows[0].enrichmentMetadata;
    assert.equal(meta.apollo_search_attempt, 'org_name_hr_titles');
    const relevance = meta.relevance as Record<string, unknown>;
    assert.equal(relevance.status, 'high_relevance');
    assert.ok(Array.isArray(relevance.matched_keywords));
  });

  it('NO crea contactos finales: solo escribe en staging vía writeCandidates', async () => {
    const apollo: ApolloPeopleAdapterResult = {
      status: 'success',
      people: [person('a', 'a@corp.com'), person('b', 'b@corp.com')],
      attempts: [
        { attempt: 'strict_hr_department', filters: 'org(dominio=corp.com); department=HR', rawResultsCount: 2 },
      ],
      providerUsage: { provider: 'apollo', operation: 'people_search', creditsUsed: 2, rawResultsCount: 2 },
    };
    const h = makeHarness(makeRun(), apollo);

    const result = await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    // El único canal de escritura de personas es el writer de staging.
    assert.equal(h.getWriteCalls(), 1);
    // El estado final es de revisión, nunca promueve a contactos reales.
    assert.equal(result.runStatus, 'ready_for_review');
  });
});
