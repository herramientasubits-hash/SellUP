/**
 * Tests — Apollo × Pre-Paid Provider-Native Novelty Gate
 * AGENT2A-PROVIDER-NOVELTY-AND-REUSE-GATE-1
 *
 * Orquestación completa del runner con inyección de dependencias: sin red, sin
 * Supabase, sin Apollo, sin Lusha, 0 créditos. El loader de identidades
 * conocidas es un stub en memoria; `completeContact` (la pata PAGADA
 * `people/match`) es un espía que cuenta invocaciones.
 *
 * Matriz del hito cubierta aquí: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
 * 25, 26, 27, 28, 29.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import type { ApolloPeopleAdapterResult, SearchGuardrailMeta } from '../apollo-people-adapter';
import {
  isActionableContactCandidate,
  type CompleteContactResult,
} from '../contact-completion-adapter';
import type { DeduplicatedContact } from '../contact-deduplicator';
import type { ProviderIdentityCandidateRowV1 } from '../provider-native-novelty-gate';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { AgentRunStep } from '@/modules/usage-tracking/types';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

const ACCOUNT_A = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_B = '22222222-2222-2222-2222-222222222222';

const DEFAULT_SEARCH_GUARDRAIL: SearchGuardrailMeta = {
  max_search_attempts: 3,
  max_results_per_attempt: 5,
  max_results_per_run: 15,
  estimated_search_credits: 0,
  blocked_by_search_budget: false,
  stopped_early_reason: 'target_reviewable_reached',
};

/** Perfil Apollo revisable y accionable (nombre + cargo HR + email). */
function person(personId: string): ApolloPerson {
  return {
    id: personId,
    first_name: 'Persona',
    last_name: personId.toUpperCase(),
    title: 'HR Manager',
    email: `${personId}@corp.com`,
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Corp', website_url: 'https://corp.com' },
    seniority: 'manager',
    departments: ['human_resources'],
    country: 'Colombia',
  };
}

/**
 * Perfil Apollo con datos completos pero cargo NO relacionado con HR/People/
 * Learning ("software engineer" está en NEGATIVE_KEYWORDS) — clasifica
 * `not_relevant` y `shouldInsertForReview=false`, así que nunca llega a
 * `selectCandidatesForCompletion` ni a `completeContact` sin importar si el
 * gate lo trata como novedoso o conocido.
 */
function nonRelevantPerson(personId: string): ApolloPerson {
  return {
    id: personId,
    first_name: 'Persona',
    last_name: personId.toUpperCase(),
    title: 'Software Engineer',
    email: `${personId}@corp.com`,
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Corp', website_url: 'https://corp.com' },
    seniority: 'manager',
    departments: ['engineering'],
    country: 'Colombia',
  };
}

function apolloSuccessWith(people: ApolloPerson[]): ApolloPeopleAdapterResult {
  return {
    status: 'success',
    people,
    attempts: [
      {
        attempt: 'strict_hr_department',
        filters: 'org(dominio=corp.com); department=HR',
        rawResultsCount: people.length,
      },
    ],
    searchGuardrail: DEFAULT_SEARCH_GUARDRAIL,
    providerUsage: {
      provider: 'apollo',
      operation: 'people_search',
      creditsUsed: people.length,
      rawResultsCount: people.length,
    },
  };
}

function apolloSuccess(personIds: string[]): ApolloPeopleAdapterResult {
  return {
    status: 'success',
    people: personIds.map(person),
    attempts: [
      {
        attempt: 'strict_hr_department',
        filters: 'org(dominio=corp.com); department=HR',
        rawResultsCount: personIds.length,
      },
    ],
    searchGuardrail: DEFAULT_SEARCH_GUARDRAIL,
    // Entrada HOSTIL a propósito: el adaptador reporta el VOLUMEN como
    // créditos. People Search es gratis, así que el runner debe seguir
    // registrando 0 (AGENT2A-APOLLO-PEOPLE-SEARCH-BILLING-TRUTH-1).
    providerUsage: {
      provider: 'apollo',
      operation: 'people_search',
      creditsUsed: personIds.length,
      rawResultsCount: personIds.length,
    },
  };
}

function makeRun(overrides: Partial<ContactEnrichmentRunRow> = {}): ContactEnrichmentRunRow {
  return {
    id: 'run-now',
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

interface Harness {
  deps: ApolloEnrichmentRunnerDeps;
  getStore: () => ContactEnrichmentRunRow;
  /** Invocaciones de `completeContact` = superficie de la pata PAGADA people/match. */
  getPaidMatchAttempts: () => string[];
  getInsertedCandidates: () => DeduplicatedContact[];
  getUsageLogs: () => LogProviderUsageInput[];
  getSearchCalls: () => number;
  getKnownIdentityLookups: () => number;
  getFinishedSteps: () => Array<Record<string, unknown>>;
}

function makeHarness(
  initialRun: ContactEnrichmentRunRow,
  apolloResult: ApolloPeopleAdapterResult,
  knownRows: ProviderIdentityCandidateRowV1[],
): Harness {
  let store = initialRun;
  const paidMatchAttempts: string[] = [];
  const insertedCandidates: DeduplicatedContact[] = [];
  const usageLogs: LogProviderUsageInput[] = [];
  const finishedSteps: Array<Record<string, unknown>> = [];
  let searchCalls = 0;
  let knownIdentityLookups = 0;

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
    runApollo: async () => {
      searchCalls += 1;
      return apolloResult;
    },
    writeCandidates: async (_runId, candidates) => {
      insertedCandidates.push(...candidates);
      return { inserted: candidates.length, skippedNoName: 0, skippedExistingPending: 0 };
    },
    completeContact: async ({ candidate, relevanceStatus }) => {
      // Registrar la identidad que HABRÍA ido a people/match.
      paidMatchAttempts.push(candidate.sourceContactId ?? '(sin-id)');
      const actionable = isActionableContactCandidate(candidate, relevanceStatus);
      return {
        status: 'skipped',
        contact: candidate,
        completedFields: [],
        wasActionableBefore: actionable,
        isActionableAfter: actionable,
        reason: 'candidate_already_actionable',
      } satisfies CompleteContactResult;
    },
    loadApolloUnitCost: async () => 0.00875,
    logUsage: async (input) => {
      usageLogs.push(input);
      return true;
    },
    createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
    finishStep: async (_id, patch) => {
      finishedSteps.push(patch as unknown as Record<string, unknown>);
      return true;
    },
    updateAgentRun: async () => true,
    loadKnownProviderIdentities: async ({ provider }) => {
      knownIdentityLookups += 1;
      return { rows: knownRows.filter((r) => r.provider === provider), lookupError: null };
    },
  };

  return {
    deps,
    getStore: () => store,
    getPaidMatchAttempts: () => paidMatchAttempts,
    getInsertedCandidates: () => insertedCandidates,
    getUsageLogs: () => usageLogs,
    getSearchCalls: () => searchCalls,
    getKnownIdentityLookups: () => knownIdentityLookups,
    getFinishedSteps: () => finishedSteps,
  };
}

function knownRow(
  nativeId: string,
  provider: 'apollo' | 'lusha',
  company: { accountId?: string; hubspotCompanyId?: string; companyDomain?: string },
): ProviderIdentityCandidateRowV1 {
  return {
    nativeId,
    provider,
    company: {
      accountId: company.accountId ?? null,
      hubspotCompanyId: company.hubspotCompanyId ?? null,
      companyDomain: company.companyDomain ?? null,
    },
  };
}

function noveltyBlock(store: ContactEnrichmentRunRow): Record<string, unknown> {
  const summary = store.summary as Record<string, unknown>;
  const apolloBlock = summary.apollo_enrichment as Record<string, unknown> | undefined;
  return (apolloBlock?.provider_identity_novelty ?? {}) as Record<string, unknown>;
}

// ── Novel vs known ──────────────────────────────────────────────

describe('Apollo novelty gate — identidad novedosa vs conocida', () => {
  it('TEST 1 — person_id novedoso: people/match SÍ se permite', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['novel-1']),
      [],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), ['novel-1']);
    assert.equal(result.skippedKnownProviderIdentity, 0);
    assert.equal(result.candidatesCreated, 1);
  });

  it('TEST 2 — mismo person_id ya visto para el MISMO account_id: people/match NO se llama', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['known-1']),
      [knownRow('known-1', 'apollo', { accountId: ACCOUNT_A })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), []);
    assert.equal(result.skippedKnownProviderIdentity, 1);
    assert.equal(result.candidatesCreated, 0, 'no se crea candidato duplicado');
  });

  it('TEST 3 — sin account_id, mismo HubSpot company id: people/match NO se llama', async () => {
    const h = makeHarness(
      makeRun({ account_id: null, hubspot_company_id: 'hs-77' }),
      apolloSuccess(['known-1']),
      [knownRow('known-1', 'apollo', { hubspotCompanyId: 'hs-77', companyDomain: 'corp.com' })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), []);
    assert.equal(result.skippedKnownProviderIdentity, 1);
    assert.equal(noveltyBlock(h.getStore()).company_scope_kind, 'hubspot_company_id');
  });

  it('TEST 4 — sin claves más fuertes, mismo dominio normalizado: people/match NO se llama', async () => {
    const h = makeHarness(
      makeRun({ account_id: null, hubspot_company_id: null, company_domain: 'corp.com' }),
      apolloSuccess(['known-1']),
      [knownRow('known-1', 'apollo', { companyDomain: 'https://www.corp.com/about' })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), []);
    assert.equal(result.skippedKnownProviderIdentity, 1);
    assert.equal(noveltyBlock(h.getStore()).company_scope_kind, 'company_domain');
  });

  it('TEST 5 — mismo person_id visto en OTRA empresa determinista: sigue elegible al pago', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['moved-1']),
      [knownRow('moved-1', 'apollo', { accountId: ACCOUNT_B, companyDomain: 'corp.com' })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), ['moved-1']);
    assert.equal(result.skippedKnownProviderIdentity, 0);
    assert.equal(result.candidatesCreated, 1);
  });

  it('TEST 12 — un contactId de Lusha conocido NO suprime un person_id de Apollo novedoso', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['shared-id']),
      [knownRow('shared-id', 'lusha', { accountId: ACCOUNT_A })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), ['shared-id']);
    assert.equal(result.skippedKnownProviderIdentity, 0);
  });
});

// ── Status semantics through the runner ──────────────────────────

describe('Apollo novelty gate — todo estado del candidato cuenta como ya visto', () => {
  // Los cuatro estados producen la MISMA fila de evidencia para el gate
  // (provider + native id + empresa), así que se ejercitan como un solo
  // contrato: si el estado influyera, alguno de estos casos pagaría de nuevo.
  for (const status of ['pending_review', 'approved', 'discarded', 'duplicate'] as const) {
    it(`TEST 6/7/8 — candidato histórico en estado ${status}: people/match NO se llama`, async () => {
      const h = makeHarness(
        makeRun({ account_id: ACCOUNT_A }),
        apolloSuccess(['known-1']),
        [knownRow('known-1', 'apollo', { accountId: ACCOUNT_A })],
      );

      const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

      assert.deepEqual(h.getPaidMatchAttempts(), [], `status ${status}`);
      assert.equal(result.skippedKnownProviderIdentity, 1);
    });
  }

  it('TEST 9 — identidad conocida a la que le falta el email: sigue fuera del pago AUTOMÁTICO', async () => {
    const withoutEmail = apolloSuccess(['known-1']);
    withoutEmail.people[0] = { ...withoutEmail.people[0], email: null };

    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      withoutEmail,
      [knownRow('known-1', 'apollo', { accountId: ACCOUNT_A })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    // El refresco dirigido de campos faltantes es un hito POSTERIOR: aquí el
    // rerun automático simplemente no vuelve a pagar.
    assert.deepEqual(h.getPaidMatchAttempts(), []);
    assert.equal(result.skippedKnownProviderIdentity, 1);
    assert.equal(result.candidatesCreated, 0);
  });
});

// ── People Search remains free and untouched ─────────────────────

describe('Apollo novelty gate — People Search intacto y gratis', () => {
  it('TEST 10 — People Search se ejecuta igual y sigue en 0 créditos / 0 USD', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['known-1', 'known-2']),
      [
        knownRow('known-1', 'apollo', { accountId: ACCOUNT_A }),
        knownRow('known-2', 'apollo', { accountId: ACCOUNT_A }),
      ],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.equal(h.getSearchCalls(), 1, 'la búsqueda gratuita se ejecuta igual');
    const searchLog = h.getUsageLogs().find((l) => l.operation_key === 'people_search');
    assert.ok(searchLog, 'la fila de la llamada REAL y gratuita debe existir');
    assert.equal(searchLog.credits_used, 0);
    assert.equal(searchLog.estimated_cost_usd, 0);
    assert.equal(searchLog.status, 'success');
    // El volumen operativo NO se pierde por el gate.
    assert.equal(searchLog.results_returned, 2);
    assert.equal(result.rawResultsCount, 2);
    assert.equal(result.normalizedCount, 2, 'la normalización de la búsqueda no se recorta');
  });

  it('TEST 11 — 5 resultados, 3 conocidos, 2 novedosos: como máximo 2 people/match', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['k-1', 'n-1', 'k-2', 'n-2', 'k-3']),
      [
        knownRow('k-1', 'apollo', { accountId: ACCOUNT_A }),
        knownRow('k-2', 'apollo', { accountId: ACCOUNT_A }),
        knownRow('k-3', 'apollo', { accountId: ACCOUNT_A }),
      ],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts().sort(), ['n-1', 'n-2']);
    assert.equal(h.getPaidMatchAttempts().length, 2);
    assert.equal(result.skippedKnownProviderIdentity, 3);
    assert.equal(result.candidatesCreated, 2);
    // Una sola lectura batch para los 5 person_id, nunca una por resultado.
    assert.equal(h.getKnownIdentityLookups(), 1);
  });
});

// ── Cost / observability of the skip ────────────────────────────

describe('Apollo novelty gate — costo y observabilidad del skip', () => {
  it('TEST 25/26/27 — un skip genera 0 llamadas de enrich, 0 créditos y 0 USD', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['known-1', 'known-2', 'known-3']),
      [
        knownRow('known-1', 'apollo', { accountId: ACCOUNT_A }),
        knownRow('known-2', 'apollo', { accountId: ACCOUNT_A }),
        knownRow('known-3', 'apollo', { accountId: ACCOUNT_A }),
      ],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.equal(h.getPaidMatchAttempts().length, 0);
    assert.equal(result.completionAttempted, 0);
    assert.equal(result.completionCompleted, 0);
    assert.equal(result.estimatedCostUsd, 0);
    assert.equal(result.candidatesCreated, 0);
    assert.equal(h.getInsertedCandidates().length, 0);
  });

  it('TEST 28 — no se escribe ninguna fila de éxito falsa por la llamada evitada', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['known-1']),
      [knownRow('known-1', 'apollo', { accountId: ACCOUNT_A })],
    );

    await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    const logs = h.getUsageLogs();
    // Exactamente una fila: la búsqueda REAL (gratis). Ninguna de person_match.
    assert.equal(logs.length, 1);
    assert.equal(logs[0].operation_key, 'people_search');
    assert.equal(
      logs.some((l) => l.operation_key === 'person_match'),
      false,
      'una llamada que no ocurrió no puede tener fila de uso',
    );
  });

  it('TEST 24 — el skip queda contado en summary y en el step del run', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['k-1', 'n-1']),
      [knownRow('k-1', 'apollo', { accountId: ACCOUNT_A })],
    );

    await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    const block = noveltyBlock(h.getStore());
    assert.equal(block.provider, 'apollo');
    assert.equal(block.gate_applied, true);
    assert.equal(block.company_scope_kind, 'account_id');
    assert.equal(block.evaluated_provider_identity_count, 2);
    assert.equal(block.known_provider_identity_ids_count, 1);
    assert.equal(block.novel_provider_identity_count, 1);
    assert.equal(block.skipped_known_provider_identity_count, 1);
    // PR #315 — no se reintroduce la métrica de ahorro no demostrada.
    assert.equal('avoided_paid_provider_calls_count' in block, false);

    const step = h.getFinishedSteps().at(-1) as Record<string, unknown>;
    const stepMeta = step.metadata as Record<string, unknown>;
    assert.equal(stepMeta.skipped_known_provider_identity_count, 1);
    assert.equal(stepMeta.novel_provider_identity_count, 1);
  });

  it('la metadata del gate no expone ids crudos del proveedor', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['secret-person-id']),
      [knownRow('secret-person-id', 'apollo', { accountId: ACCOUNT_A })],
    );

    await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.equal(
      JSON.stringify(noveltyBlock(h.getStore())).includes('secret-person-id'),
      false,
    );
  });
});

// ── Regression: the late dedupe barrier still runs ───────────────

describe('Apollo novelty gate — regresión del dedupe final', () => {
  it('TEST 29 — para identidades novedosas el dedupe existente sigue ejecutándose', async () => {
    // 'dup-1' NO es una identidad conocida del proveedor, pero su email ya
    // está en el snapshot de contactos existentes: debe seguir cayendo por el
    // deduplicador de siempre, no por el novelty gate.
    const run = makeRun({
      account_id: ACCOUNT_A,
      summary: {
        totalCandidates: 0,
        company_resolution_source: 'sellup',
        existing_contacts_snapshot: {
          combined: {
            existing_emails: ['dup-1@corp.com'],
            existing_linkedin_urls: [],
            existing_contact_names: [],
          },
        },
      },
    });
    const h = makeHarness(run, apolloSuccess(['dup-1', 'fresh-1']), []);

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.equal(result.skippedKnownProviderIdentity, 0, 'el gate no lo tocó');
    assert.equal(result.exactDuplicates, 1, 'el dedupe final sí lo detectó');
    assert.equal(result.candidatesCreated, 1);
    assert.deepEqual(
      h.getInsertedCandidates().map((c) => c.sourceContactId),
      ['fresh-1'],
    );
  });

  it('el gate se salta por completo si el run no tiene ninguna clave determinista', async () => {
    const h = makeHarness(
      makeRun({ account_id: null, hubspot_company_id: null, company_domain: null }),
      apolloSuccess(['known-1']),
      [knownRow('known-1', 'apollo', { accountId: ACCOUNT_A })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.equal(h.getKnownIdentityLookups(), 0, 'no se consulta sin scope');
    assert.deepEqual(h.getPaidMatchAttempts(), ['known-1'], 'falla ABIERTO');
    assert.equal(result.skippedKnownProviderIdentity, 0);
    assert.equal(noveltyBlock(h.getStore()).gate_skipped_reason, 'no_deterministic_company_key');
  });

  it('un error de lectura no bloquea el run ni suprime identidades', async () => {
    const h = makeHarness(makeRun({ account_id: ACCOUNT_A }), apolloSuccess(['x-1']), []);
    const deps: ApolloEnrichmentRunnerDeps = {
      ...h.deps,
      loadKnownProviderIdentities: async () => ({ rows: [], lookupError: 'timeout' }),
    };

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', deps);

    assert.equal(result.status, 'ready_for_review');
    assert.equal(result.skippedKnownProviderIdentity, 0);
    assert.equal(noveltyBlock(h.getStore()).gate_skipped_reason, 'lookup_error');
  });
});

// ── PR #315 correction: skip count is not a paid-call-avoidance claim ──
//
// The gate runs BEFORE relevance classification and BEFORE completion
// eligibility selection. A known identity can be skipped by the gate even
// though — had the gate not existed — it would have been rejected by
// `classifyNormalizedContact` (relevance) or never selected by
// `selectCandidatesForCompletion`, and therefore would NEVER have reached
// the paid `people/match` call anyway. These tests prove the observability
// no longer claims otherwise.

describe('PR #315 — el skip NO afirma una llamada pagada evitada (Apollo)', () => {
  it('COUNTERFACTUAL 1 — identidad conocida que habría fallado relevancia: 0 people/match, sin métrica de ahorro', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccessWith([nonRelevantPerson('known-nonrelevant')]),
      [knownRow('known-nonrelevant', 'apollo', { accountId: ACCOUNT_A })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), []);
    assert.equal(result.skippedKnownProviderIdentity, 1);

    // Prueba del contrafactual: el MISMO perfil, pero NOVEDOSO (no conocido),
    // tampoco habría llegado a people/match — la relevancia lo rechaza antes.
    // Es decir, este skip concreto no evitó ningún cargo: nunca iba a haberlo.
    const novelHarness = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccessWith([nonRelevantPerson('novel-nonrelevant')]),
      [],
    );
    await executeContactEnrichmentApolloRun('run-now', 'user-1', novelHarness.deps);
    assert.deepEqual(
      novelHarness.getPaidMatchAttempts(),
      [],
      'un perfil no relevante nunca llega a people/match, sea conocido o novedoso',
    );

    const block = noveltyBlock(h.getStore());
    assert.equal(block.skipped_known_provider_identity_count, 1);
    assert.equal('avoided_paid_provider_calls_count' in block, false);
  });

  it('COUNTERFACTUAL 2 — identidad conocida que SÍ habría sido elegible a completion: sigue sin afirmar ahorro', async () => {
    const h = makeHarness(
      makeRun({ account_id: ACCOUNT_A }),
      apolloSuccess(['known-eligible']),
      [knownRow('known-eligible', 'apollo', { accountId: ACCOUNT_A })],
    );

    const result = await executeContactEnrichmentApolloRun('run-now', 'user-1', h.deps);

    assert.deepEqual(h.getPaidMatchAttempts(), []);
    assert.equal(result.skippedKnownProviderIdentity, 1, 'el conteo de skip sigue siendo veraz');

    const block = noveltyBlock(h.getStore());
    assert.equal(block.skipped_known_provider_identity_count, 1);
    // Ningún contador de ahorro inventado, ni aquí ni en el step del run.
    assert.equal('avoided_paid_provider_calls_count' in block, false);
    const step = h.getFinishedSteps().at(-1) as Record<string, unknown>;
    const stepMeta = step.metadata as Record<string, unknown>;
    assert.equal('avoided_paid_provider_calls_count' in stepMeta, false);
  });
});
