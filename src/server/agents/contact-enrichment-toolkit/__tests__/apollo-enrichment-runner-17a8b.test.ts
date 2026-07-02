/**
 * Tests — Hito 17A.8B: Completion controlado para perfiles Apollo incompletos
 * pero prometedores.
 *
 * Verifica que perfiles insufficient_data con señal de rol HR entren a completion,
 * y que los guardrails y controles de calidad se mantengan. Sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasMinimalIdentityForMatch,
  selectInsufficientsForCompletion,
  MAX_COMPLETION_CANDIDATES,
  isActionableContactCandidate,
  type ClassifiedCandidate,
  type CompleteContactResult,
} from '../contact-completion-adapter';
import {
  classifyContactRelevance,
  isCompletableInsufficientProfile,
} from '../contact-relevance-classifier';
import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import type { ApolloPeopleAdapterResult } from '../apollo-people-adapter';
import type { NormalizedApolloContact } from '../contact-normalizer';
import type { DeduplicatedContact } from '../contact-deduplicator';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { AgentRunStep } from '@/modules/usage-tracking/types';

// ── Builders ────────────────────────────────────────────────────

function contact(overrides: Partial<NormalizedApolloContact> = {}): NormalizedApolloContact {
  return {
    firstName: 'Juan',
    lastName: null,
    fullName: 'Juan',
    title: 'HR Business Partner',
    seniority: 'manager',
    department: 'human resources',
    country: 'Colombia',
    linkedinUrl: null,
    email: null,
    phone: null,
    source: 'apollo',
    sourceContactId: 'apollo-x',
    confidence: 0.5,
    enrichmentMetadata: { provider: 'apollo' },
    ...overrides,
  };
}

function classifiedFrom(c: NormalizedApolloContact): ClassifiedCandidate {
  return {
    contact: c,
    relevance: classifyContactRelevance({
      fullName: c.fullName,
      firstName: c.firstName,
      lastName: c.lastName,
      title: c.title,
      email: c.email,
      linkedinUrl: c.linkedinUrl,
      phone: c.phone,
    }),
  };
}

function personIncomplete(id: string, title: string): ApolloPerson {
  return {
    id,
    first_name: 'Maria',
    last_name: null,
    title,
    email: null,
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-siesa', name: 'Siesa', website_url: 'https://siesa.com' },
    seniority: 'manager',
    departments: ['human_resources'],
    country: 'Colombia',
  };
}

function makeApolloResult(people: ApolloPerson[]): ApolloPeopleAdapterResult {
  return {
    status: 'success',
    people,
    attempts: [
      { attempt: 'org_name_hr_titles_fallback', filters: '{}', rawResultsCount: people.length },
    ],
    providerUsage: {
      provider: 'apollo',
      operation: 'people_search',
      creditsUsed: people.length,
      rawResultsCount: people.length,
    },
  };
}

function makeRun(overrides: Partial<ContactEnrichmentRunRow> = {}): ContactEnrichmentRunRow {
  return {
    id: 'run-8b',
    agent_run_id: 'ar-8b',
    company_name: 'Siesa',
    company_domain: 'siesa.com',
    company_country_code: 'CO',
    status: 'ready_to_enrich',
    summary: {
      totalCandidates: 0,
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

/** Harness mínimo para tests de integración del runner. */
function makeHarness(
  apolloResult: ApolloPeopleAdapterResult,
  completeContactFn?: ApolloEnrichmentRunnerDeps['completeContact'],
  overrides: Partial<ApolloEnrichmentRunnerDeps> = {},
): {
  deps: ApolloEnrichmentRunnerDeps;
  written: DeduplicatedContact[][];
  completionCalls: NormalizedApolloContact[];
  lastSummary: () => Record<string, unknown>;
} {
  const written: DeduplicatedContact[][] = [];
  const completionCalls: NormalizedApolloContact[] = [];
  let lastSummary: Record<string, unknown> = {};

  const deps: ApolloEnrichmentRunnerDeps = {
    loadRun: async () => makeRun(),
    updateRun: async (_id, patch) => {
      if (patch.summary) lastSummary = patch.summary;
    },
    runApollo: async () => apolloResult,
    writeCandidates: async (_runId, candidates) => {
      written.push([...candidates]);
      return { inserted: candidates.length, skippedNoName: 0 };
    },
    completeContact: completeContactFn ?? (async ({ candidate, relevanceStatus }) => {
      const actionable = isActionableContactCandidate(candidate, relevanceStatus);
      return {
        status: 'skipped',
        contact: candidate,
        completedFields: [],
        wasActionableBefore: actionable,
        isActionableAfter: actionable,
        reason: actionable ? 'candidate_already_actionable' : 'insufficient_input_for_match',
      } satisfies CompleteContactResult;
    }),
    loadApolloUnitCost: async () => 0,
    logUsage: async () => true,
    createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
    finishStep: async () => true,
    ...overrides,
  };

  return { deps, written, completionCalls, lastSummary: () => lastSummary };
}

// ── Tests: isCompletableInsufficientProfile ───────────────────────

describe('isCompletableInsufficientProfile', () => {
  it('retorna true para perfil insufficient_data con categoría HR detectada', () => {
    // Nombre parcial (1 token) sin canal → insufficient_data, pero rol HR
    const result = classifyContactRelevance({
      fullName: 'Juan',
      firstName: 'Juan',
      lastName: null,
      title: 'HR Manager',
      email: null,
      linkedinUrl: null,
      phone: null,
    });
    assert.equal(result.relevanceStatus, 'insufficient_data');
    assert.notEqual(result.matchedCategory, null);
    assert.equal(isCompletableInsufficientProfile(result), true);
  });

  it('retorna false para perfil insufficient_data sin señal de rol HR', () => {
    const result = classifyContactRelevance({
      fullName: 'Pedro',
      firstName: 'Pedro',
      lastName: null,
      title: 'Software Engineer',
      email: null,
      linkedinUrl: null,
      phone: null,
    });
    assert.equal(result.relevanceStatus, 'insufficient_data');
    assert.equal(result.matchedCategory, null);
    assert.equal(isCompletableInsufficientProfile(result), false);
  });

  it('retorna false para perfiles que no son insufficient_data', () => {
    const high = classifyContactRelevance({
      fullName: 'Ana López',
      firstName: 'Ana',
      lastName: 'López',
      title: 'HR Director',
      email: 'ana@corp.com',
      linkedinUrl: null,
      phone: null,
    });
    assert.equal(high.relevanceStatus, 'high_relevance');
    assert.equal(isCompletableInsufficientProfile(high), false);
  });
});

// ── Tests: hasMinimalIdentityForMatch ────────────────────────────

describe('hasMinimalIdentityForMatch', () => {
  it('retorna true con first_name parcial (sin apellido, sin canal)', () => {
    assert.equal(
      hasMinimalIdentityForMatch(contact({ firstName: 'Juan', lastName: null })),
      true,
    );
  });

  it('retorna true con solo email (sin nombre)', () => {
    assert.equal(
      hasMinimalIdentityForMatch(contact({ firstName: null, lastName: null, email: 'juan@corp.com' })),
      true,
    );
  });

  it('retorna true con linkedin_url', () => {
    assert.equal(
      hasMinimalIdentityForMatch(
        contact({ firstName: null, lastName: null, linkedinUrl: 'https://linkedin.com/in/juan' }),
      ),
      true,
    );
  });

  it('retorna false sin ningún identificador', () => {
    assert.equal(
      hasMinimalIdentityForMatch(
        contact({ firstName: null, lastName: null, email: null, linkedinUrl: null }),
      ),
      false,
    );
  });
});

// ── Tests: selectInsufficientsForCompletion ──────────────────────

describe('selectInsufficientsForCompletion', () => {
  it('selecciona perfil insufficient_data con señal HR e identidad mínima', () => {
    const c = contact({ firstName: 'Maria', lastName: null, fullName: 'Maria', title: 'HR Manager' });
    const item = classifiedFrom(c);
    assert.equal(item.relevance.relevanceStatus, 'insufficient_data');

    const result = selectInsufficientsForCompletion([item], 0, 3);
    assert.equal(result.length, 1);
  });

  it('no selecciona insufficient_data sin señal de rol HR (irrelevante)', () => {
    const c = contact({
      firstName: 'Carlos',
      lastName: null,
      fullName: 'Carlos',
      title: 'Software Engineer',
    });
    const item = classifiedFrom(c);
    assert.equal(item.relevance.relevanceStatus, 'insufficient_data');

    const result = selectInsufficientsForCompletion([item], 0, 3);
    assert.equal(result.length, 0);
  });

  it('respeta el tope máximo total (no supera MAX si ya hay revisables seleccionados)', () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      classifiedFrom(
        contact({
          firstName: `Maria${i}`,
          lastName: null,
          fullName: `Maria${i}`,
          title: 'HR Manager',
          sourceContactId: `id-${i}`,
        }),
      ),
    );

    // Ya hay 2 revisables seleccionados, tope = 3 → solo 1 insuficiente cabe
    const result = selectInsufficientsForCompletion(candidates, 2, 3);
    assert.equal(result.length, 1);
  });

  it('devuelve vacío si ya se alcanzó el tope con revisables', () => {
    const c = contact({ firstName: 'Maria', fullName: 'Maria', title: 'HR Manager' });
    const item = classifiedFrom(c);
    const result = selectInsufficientsForCompletion([item], 3, 3);
    assert.equal(result.length, 0);
  });

  it('no selecciona insufficient_data sin identidad mínima para match', () => {
    const item: ClassifiedCandidate = {
      contact: contact({ firstName: null, lastName: null, email: null, linkedinUrl: null }),
      relevance: classifyContactRelevance({
        fullName: null,
        firstName: null,
        lastName: null,
        title: 'HR Manager',
        email: null,
        linkedinUrl: null,
        phone: null,
      }),
    };
    const result = selectInsufficientsForCompletion([item], 0, 3);
    assert.equal(result.length, 0);
  });
});

// ── Tests de integración: runner con perfiles incompletos ────────

describe('executeContactEnrichmentApolloRun — 17A.8B', () => {
  it('perfil incomplete HR entra a completion y se convierte en candidato revisable', async () => {
    const completionCalls: NormalizedApolloContact[] = [];

    const { deps, written } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Business Partner')]),
      async (input) => {
        completionCalls.push(input.candidate);
        return {
          status: 'completed',
          contact: {
            ...input.candidate,
            email: 'maria@siesa.com',
            firstName: 'Maria',
            lastName: 'Gomez',
            fullName: 'Maria Gomez',
          },
          completedFields: ['email', 'full_name'],
          wasActionableBefore: false,
          isActionableAfter: true,
          providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
        } satisfies CompleteContactResult;
      },
    );

    const result = await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    assert.equal(completionCalls.length, 1, 'debe intentar completion del perfil incompleto');
    assert.equal(result.candidatesCreated, 1, 'debe crear 1 candidato tras completion exitosa');
    assert.equal(result.actionableContactsCount, 1);

    const insertedContacts = written.flat();
    assert.equal(insertedContacts.length, 1);
    assert.equal(insertedContacts[0]?.email, 'maria@siesa.com');
  });

  it('perfil incompleto irrelevante (no HR) no entra a completion', async () => {
    const completionCalls: NormalizedApolloContact[] = [];

    const { deps } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'Software Engineer')]),
      async (input) => {
        completionCalls.push(input.candidate);
        return {
          status: 'completed',
          contact: { ...input.candidate, email: 'dev@siesa.com' },
          completedFields: ['email'],
          wasActionableBefore: false,
          isActionableAfter: true,
          providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
        };
      },
    );

    const result = await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    assert.equal(completionCalls.length, 0, 'no debe intentar completion de perfil no HR');
    assert.equal(result.candidatesCreated, 0);
  });

  it('perfil incompleto HR que completion no mejora sigue descartado', async () => {
    const { deps, written } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Business Partner')]),
      async (input) => ({
        // Completion no mejoró los datos: sin email ni linkedin
        status: 'completed',
        contact: input.candidate,
        completedFields: [],
        wasActionableBefore: false,
        isActionableAfter: false,
        providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
      }),
    );

    const result = await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    assert.equal(result.candidatesCreated, 0, 'sin canal accionable no se inserta candidato');
    assert.equal(written.flat().length, 0);
  });

  it('máximo 3 perfiles incompletos prometedores entran a completion', async () => {
    const completionCalls: NormalizedApolloContact[] = [];
    const manyIncomplete = Array.from({ length: 5 }, (_, i) =>
      personIncomplete(`p${i}`, 'HR Manager'),
    );

    const { deps } = makeHarness(
      makeApolloResult(manyIncomplete),
      async (input) => {
        completionCalls.push(input.candidate);
        return {
          status: 'completed',
          contact: { ...input.candidate, email: `maria${completionCalls.length}@siesa.com`, fullName: 'Maria Gomez' },
          completedFields: ['email'],
          wasActionableBefore: false,
          isActionableAfter: true,
          providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
        };
      },
    );

    await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    assert.ok(
      completionCalls.length <= MAX_COMPLETION_CANDIDATES,
      `completion no debe superar ${MAX_COMPLETION_CANDIDATES} (fue ${completionCalls.length})`,
    );
  });

  it('perfil completado con email pasa a candidato reviewable si es relevante', async () => {
    const { deps, written } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'People Manager')]),
      async (input) => ({
        status: 'completed',
        contact: { ...input.candidate, email: 'maria@siesa.com', fullName: 'Maria Gomez' },
        completedFields: ['email', 'full_name'],
        wasActionableBefore: false,
        isActionableAfter: true,
        providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
      }),
    );

    const result = await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    assert.equal(result.candidatesCreated, 1);
    assert.equal(written.flat().length, 1);
  });

  it('no se insertan candidatos si completion no mejora los datos', async () => {
    const { deps, written } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Business Partner')]),
      async (input) => ({
        status: 'skipped',
        contact: input.candidate,
        completedFields: [],
        wasActionableBefore: false,
        isActionableAfter: false,
        reason: 'no_match_data',
      }),
    );

    const result = await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    assert.equal(result.candidatesCreated, 0);
    assert.equal(written.flat().length, 0);
  });

  it('summary incluye eligible_from_insufficient_data_count', async () => {
    const { deps, lastSummary } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Business Partner')]),
      async (input) => ({
        status: 'completed',
        contact: { ...input.candidate, email: 'maria@siesa.com', fullName: 'Maria Gomez' },
        completedFields: ['email', 'full_name'],
        wasActionableBefore: false,
        isActionableAfter: true,
        providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
      }),
    );

    await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    const summary = lastSummary();
    const apolloEnrichment = summary.apollo_enrichment as Record<string, unknown>;
    const completion = apolloEnrichment?.contact_completion as Record<string, unknown>;
    assert.ok(completion !== undefined, 'contact_completion debe existir en summary');
    assert.equal(completion.eligible_from_insufficient_data_count, 1);
  });

  it('relevance_filter incluye sent_to_completion_from_insufficient_count', async () => {
    const { deps, lastSummary } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Business Partner')]),
      async (input) => ({
        status: 'completed',
        contact: { ...input.candidate, email: 'maria@siesa.com', fullName: 'Maria Gomez' },
        completedFields: ['email', 'full_name'],
        wasActionableBefore: false,
        isActionableAfter: true,
        providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
      }),
    );

    await executeContactEnrichmentApolloRun('run-8b', 'user-1', deps);

    const summary = lastSummary();
    const apolloEnrichment = summary.apollo_enrichment as Record<string, unknown>;
    const relevanceFilter = apolloEnrichment?.relevance_filter as Record<string, unknown>;
    assert.ok(relevanceFilter !== undefined, 'relevance_filter debe existir en summary');
    assert.equal(relevanceFilter.sent_to_completion_from_insufficient_count, 1);
    assert.equal(relevanceFilter.insufficient_data_count, 1);
  });
});

// ── Tests: 17A.8C — Trazabilidad créditos completion/person_match ─

describe('17A.8C — actual_credits_total refleja créditos reales de person_match', () => {
  /** person_match devuelve persona pero sin campos nuevos (como Siesa). */
  function makeMatchNoNewFields(): ApolloEnrichmentRunnerDeps['completeContact'] {
    return async (input) => ({
      status: 'completed',
      contact: input.candidate,
      completedFields: [],
      wasActionableBefore: false,
      isActionableAfter: false,
      providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
    });
  }

  it('3 person_match con completedFields vacíos → actual_credits_total = 3', async () => {
    // Simula el caso Siesa: 3 perfiles insufficient_data con señal HR,
    // Apollo retorna persona pero sin email/linkedin/phone nuevos.
    const people = [
      personIncomplete('p1', 'HR Manager'),
      personIncomplete('p2', 'People Manager'),
      personIncomplete('p3', 'HR Business Partner'),
    ];
    const { deps, lastSummary } = makeHarness(
      makeApolloResult(people),
      makeMatchNoNewFields(),
    );

    await executeContactEnrichmentApolloRun('run-8b', undefined, deps);

    const summary = lastSummary();
    const completion = (summary.apollo_enrichment as Record<string, unknown>)
      ?.contact_completion as Record<string, unknown>;
    const guardrail = completion?.cost_guardrail as Record<string, unknown>;

    assert.ok(guardrail, 'cost_guardrail debe existir en contact_completion');
    assert.equal(guardrail.actual_credits_total, 3, 'actual_credits_total debe ser 3 (1 por person_match)');
    assert.equal(guardrail.actual_credits_phone, 0, 'actual_credits_phone debe ser 0');
    assert.equal(guardrail.actual_credits_email, 3, 'actual_credits_email = total - phone = 3');
  });

  it('actual_credits_phone = 0 cuando phone completion está desactivado', async () => {
    const { deps, lastSummary } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Manager')]),
      makeMatchNoNewFields(),
    );

    await executeContactEnrichmentApolloRun('run-8b', undefined, deps);

    const summary = lastSummary();
    const completion = (summary.apollo_enrichment as Record<string, unknown>)
      ?.contact_completion as Record<string, unknown>;
    const guardrail = completion?.cost_guardrail as Record<string, unknown>;

    assert.equal(guardrail.phone_completion_enabled, false);
    assert.equal(guardrail.actual_credits_phone, 0);
  });

  it('person_match consume créditos pero no produce canal accionable → no crea candidato, sí registra créditos', async () => {
    const { deps, written, lastSummary } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Manager')]),
      makeMatchNoNewFields(),
    );

    const result = await executeContactEnrichmentApolloRun('run-8b', undefined, deps);

    assert.equal(result.candidatesCreated, 0, 'no debe crear candidato sin canal accionable');
    assert.equal(written.flat().length, 0);

    const summary = lastSummary();
    const completion = (summary.apollo_enrichment as Record<string, unknown>)
      ?.contact_completion as Record<string, unknown>;
    const guardrail = completion?.cost_guardrail as Record<string, unknown>;
    assert.ok(
      (guardrail.actual_credits_total as number) > 0,
      'se deben registrar créditos aunque no se cree candidato',
    );
  });

  it('logUsage de person_match incluye metadata de completion', async () => {
    const logs: Parameters<typeof import('@/modules/usage-tracking/logging').logProviderUsage>[0][] = [];
    const { deps } = makeHarness(
      makeApolloResult([personIncomplete('p1', 'HR Manager')]),
      makeMatchNoNewFields(),
      { logUsage: async (entry) => { logs.push(entry); return true; } },
    );

    await executeContactEnrichmentApolloRun('run-8b', undefined, deps);

    const matchLog = logs.find((l) => l.operation_key === 'person_match');
    assert.ok(matchLog, 'debe existir un log con operation_key = person_match');

    const meta = matchLog.metadata as Record<string, unknown>;
    assert.ok('company_name' in meta, 'metadata debe incluir company_name');
    assert.ok('attempted_count' in meta, 'metadata debe incluir attempted_count');
    assert.ok('completed_fields_count' in meta, 'metadata debe incluir completed_fields_count');
    assert.ok('actual_completion_credits_total' in meta, 'metadata debe incluir actual_completion_credits_total');
    assert.ok('actual_completion_credits_phone' in meta, 'metadata debe incluir actual_completion_credits_phone');
    assert.ok('phone_completion_enabled' in meta, 'metadata debe incluir phone_completion_enabled');
    assert.equal(meta.source, 'contact_enrichment_completion');
    assert.equal(meta.phone_completion_enabled, false);
  });

  it('si attempted_count = 0, actual_credits_total = 0 (no se llamó a person_match)', async () => {
    // Todos los perfiles son accionables de por sí → se saltan, 0 intentos
    const { deps, lastSummary } = makeHarness(
      makeApolloResult([]),
    );

    await executeContactEnrichmentApolloRun('run-8b', undefined, deps);

    const summary = lastSummary();
    const completion = (summary.apollo_enrichment as Record<string, unknown>)
      ?.contact_completion as Record<string, unknown>;
    const guardrail = completion?.cost_guardrail as Record<string, unknown>;

    assert.equal(guardrail.attempted_count ?? 0, 0);
    assert.equal(guardrail.actual_credits_total, 0);
  });
});
