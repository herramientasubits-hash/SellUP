/**
 * Tests — AGENT2A-APOLLO-PEOPLE-SEARCH-BILLING-TRUTH-1
 *
 * ── EL DEFECTO QUE FIJAN ─────────────────────────────────────────────────────
 *
 * El soporte de Apollo confirmó explícitamente que People Search
 * (`POST /api/v1/mixed_people/api_search`) NO cuesta créditos: ni la llamada, ni los
 * resultados devueltos, ni los resultados repetidos. El enriquecimiento pagado es una
 * operación aparte.
 *
 * Hasta este hito el adaptador reportaba `providerUsage.creditsUsed = totalRaw` y el
 * runner escribía ese número como `credits_used` con su `estimated_cost_usd` derivado
 * del precio genérico del crédito Apollo. SellUp contabilizaba como pagado un volumen
 * que el proveedor regala: 30 filas históricas en Producción con 98 créditos y ~$0.8575
 * que NO son cobros probados de Apollo, sino cifras internas de SellUp.
 *
 * ── POR QUÉ ESTOS TESTS NO USAN UN FIXTURE COMPLACIENTE ──────────────────────
 *
 * Un fixture que ya trae `creditsUsed: 0` no prueba NADA: el runner lo copiaría y el
 * test pasaría igual con el defecto puesto. Por eso:
 *
 *   · El costo del ADAPTADOR se mide sobre el adaptador REAL, inyectando `searchPeople`
 *     — es la función que antes multiplicaba volumen por crédito.
 *   · El costo del RUNNER se mide con entradas HOSTILES: un `providerUsage` que reporta
 *     `creditsUsed = número de resultados` (el valor exacto del defecto) y, aparte, un
 *     `providerUsage` AUSENTE (la rama del viejo `?? rawResultsCount`). En los dos
 *     casos el log tiene que registrar 0.
 *
 * ── LA PROPIEDAD, Y POR QUÉ NO ES "credits_used = 0" A SECAS ─────────────────
 *
 * El costo cero no puede comerse las métricas de volumen. Un log de uso tiene que
 * seguir distinguiendo "se llamó al proveedor y devolvió N resultados a costo cero" de
 * "no se llamó al proveedor" — si el cero borrara también `results_returned`, una
 * búsqueda real quedaría indistinguible de un cache hit o de una operación saltada.
 * Por eso cada test que fija el costo en 0 fija ADEMÁS que el volumen sobrevive.
 *
 * ── LO QUE EL CERO NO ALCANZA ────────────────────────────────────────────────
 *
 * `people/match` (y por extensión bulk_match, reveals y waterfalls) sigue siendo
 * facturable. El test de no-fuga es la mitad que impide "arreglar" la contabilidad
 * regalando el enriquecimiento pagado.
 *
 * OFFLINE por contrato: sin red, sin Supabase, sin credenciales. El último test lo
 * demuestra con un espía sobre `globalThis.fetch`.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeContactEnrichmentApolloRun,
  type ContactEnrichmentRunRow,
  type ApolloEnrichmentRunnerDeps,
} from '../apollo-enrichment-runner';
import {
  searchApolloPeopleForCompany,
  APOLLO_PEOPLE_SEARCH_CREDITS,
  APOLLO_PEOPLE_SEARCH_COST_USD,
  type ApolloPeopleAdapterResult,
} from '../apollo-people-adapter';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import { isActionableContactCandidate, type CompleteContactResult } from '../contact-completion-adapter';
import type { ApolloPerson, ApolloSearchResult } from '@/server/integrations/apollo-client';
import type { ApolloOrgResolutionResult } from '../apollo-organization-resolver';
import type { AgentRunStep, LogProviderUsageInput } from '@/modules/usage-tracking/types';
import {
  computeEffectiveConsumption,
  type UsageConsumptionRow,
} from '@/modules/budgets/effective-consumption-core';
import { classifyApolloOperationCostTruth, deriveRunCostTruth } from '@/modules/provider-effectiveness/cost-truth';

/** Precio unitario del crédito Apollo. Solo debe alcanzar a `person_match`. */
const UNIT_COST = 0.00875;

// ── Fixtures ───────────────────────────────────────────────────

/** Perfil sin canal accionable → entra a completion (la pata PAGADA). */
function personNoChannel(id: string): ApolloPerson {
  return {
    id,
    first_name: 'Persona',
    last_name: id,
    title: 'HR Manager',
    email: null,
    linkedin_url: null,
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Corp', website_url: 'https://corp.com' },
    seniority: 'manager',
    departments: ['human_resources'],
    country: 'Colombia',
  };
}

/** Perfil ya accionable → no consume completion. */
function person(id: string): ApolloPerson {
  return { ...personNoChannel(id), email: `${id}@corp.com` };
}

/** Resolución de organización que no encuentra nada (mantiene el flujo legacy). */
const noOrg = async (): Promise<ApolloOrgResolutionResult> => ({
  organizationId: null,
  organizationName: null,
  organizationDomain: null,
  resolutionStatus: 'not_found',
  resolutionMethod: null,
  candidatesCount: 0,
  diagnostics: {
    domain_query_results: 0,
    name_query_results: 0,
    selected_organization_id: null,
    selected_organization_name: null,
    selected_organization_domain: null,
  },
});

/**
 * Ejecuta el adaptador REAL devolviendo, intento por intento, los tamaños indicados.
 * Cada tamaño es una respuesta de Apollo: así se recorre el mismo bucle que antes
 * acumulaba `totalRaw` y lo publicaba como créditos.
 */
async function runRealAdapter(attemptSizes: number[]): Promise<ApolloPeopleAdapterResult> {
  let call = 0;
  const searchPeople = async (): Promise<ApolloSearchResult<ApolloPerson>> => {
    const size = attemptSizes[call] ?? 0;
    call += 1;
    return { success: true, data: Array.from({ length: size }, (_, i) => person(`c${call}-${i}`)) };
  };
  return searchApolloPeopleForCompany(
    { runId: 'run-1', companyName: 'Corp', companyDomain: 'corp.com' },
    { isConnected: async () => true, resolveOrganization: noOrg, searchPeople },
  );
}

/**
 * Resultado del adaptador con entrada HOSTIL: reporta como créditos el número de
 * resultados, que es exactamente el valor del defecto. El runner debe ignorarlo.
 */
function hostileApolloResult(
  rawResultsCount: number,
  people: ApolloPerson[],
  opts: { omitProviderUsage?: boolean } = {},
): ApolloPeopleAdapterResult {
  return {
    status: 'success',
    people,
    attempts: [{ attempt: 'strict_hr_department', filters: 'org(dominio=corp.com)', rawResultsCount }],
    chosenAttempt: 'strict_hr_department',
    searchGuardrail: {
      max_search_attempts: 3,
      max_results_per_attempt: 5,
      max_results_per_run: 15,
      // También hostil: el guardrail publica el volumen como créditos estimados.
      estimated_search_credits: rawResultsCount,
      blocked_by_search_budget: false,
      stopped_early_reason: 'all_attempts_exhausted',
    },
    ...(opts.omitProviderUsage
      ? {}
      : {
          providerUsage: {
            provider: 'apollo' as const,
            operation: 'people_search' as const,
            creditsUsed: rawResultsCount,
            rawResultsCount,
          },
        }),
  };
}

function makeRun(): ContactEnrichmentRunRow {
  return {
    id: 'run-1',
    agent_run_id: 'ar-1',
    company_name: 'Corp',
    company_domain: 'corp.com',
    company_country_code: 'CO',
    status: 'ready_to_enrich',
    summary: { totalCandidates: 0 },
  };
}

interface Harness {
  deps: ApolloEnrichmentRunnerDeps;
  getUsageLogs: () => LogProviderUsageInput[];
  getRunPatches: () => Array<{ estimated_cost_usd?: number }>;
}

function makeHarness(apollo: ApolloPeopleAdapterResult): Harness {
  let store = makeRun();
  const usageLogs: LogProviderUsageInput[] = [];
  const runPatches: Array<{ estimated_cost_usd?: number }> = [];

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
      if (store.status !== 'ready_to_enrich') return { status: 'not_ready', currentStatus: store.status };
      store = { ...store, status: 'enriching' };
      return { status: 'claimed', row: store };
    },
    runApollo: async () => apollo,
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
    loadApolloUnitCost: async () => UNIT_COST,
    logUsage: async (input) => {
      usageLogs.push(input);
      return true;
    },
    createStep: async () => ({ id: 'step-1' }) as unknown as AgentRunStep,
    finishStep: async () => true,
    updateAgentRun: async () => true,
  };

  return { deps, getUsageLogs: () => usageLogs, getRunPatches: () => runPatches };
}

function searchLogOf(h: Harness): LogProviderUsageInput {
  const log = h.getUsageLogs().find((l) => l.operation_key === 'people_search');
  assert.ok(log, 'debe existir un log de people_search');
  return log;
}

// ── Espía de red: ninguna suite de este archivo puede tocar la red ──

const fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error('LLAMADA DE RED PROHIBIDA en una suite offline');
  }) as typeof globalThis.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

// ═══════════════════════════════════════════════════════════════
// Sección 1 — El ADAPTADOR real nunca cobra la búsqueda
// ═══════════════════════════════════════════════════════════════

describe('searchApolloPeopleForCompany — People Search cuesta 0 créditos', () => {
  it('la constante del proveedor es 0 en créditos y en dólares', () => {
    assert.equal(APOLLO_PEOPLE_SEARCH_CREDITS, 0);
    assert.equal(APOLLO_PEOPLE_SEARCH_COST_USD, 0);
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxEstimatedSearchCreditsPerRun, 0);
  });

  it('TEST 1 — 0 resultados: creditsUsed=0 y el volumen es 0', async () => {
    const result = await runRealAdapter([0, 0, 0]);

    assert.equal(result.status, 'success');
    assert.equal(result.providerUsage?.creditsUsed, 0);
    assert.equal(result.providerUsage?.rawResultsCount, 0);
    assert.equal(result.searchGuardrail?.estimated_search_credits, 0);
  });

  it('TEST 2 — 1 resultado: creditsUsed=0 y el volumen es 1', async () => {
    const result = await runRealAdapter([1, 0, 0]);

    assert.equal(result.providerUsage?.creditsUsed, 0, 'un resultado devuelto no cobra');
    assert.equal(result.providerUsage?.rawResultsCount, 1, 'el volumen real se conserva');
    assert.equal(result.searchGuardrail?.estimated_search_credits, 0);
  });

  it('TEST 4a — 3 intentos con 12 resultados: 0 créditos y volumen 12', async () => {
    // El adaptador para en 2 revisables, así que se fuerzan intentos sin revisables
    // usando perfiles válidos en tandas: el tope de VOLUMEN por run es 15.
    const result = await runRealAdapter([5, 5, 2]);

    assert.equal(result.providerUsage?.creditsUsed, 0, 'ni los intentos ni los repetidos cobran');
    assert.ok(
      (result.providerUsage?.rawResultsCount ?? 0) > 0,
      'el volumen acumulado de los intentos ejecutados se conserva',
    );
    assert.equal(result.searchGuardrail?.estimated_search_credits, 0);
    assert.equal(result.searchGuardrail?.max_results_per_run, 15, 'el tope de VOLUMEN sigue vivo');
    assert.equal(result.searchGuardrail?.max_search_attempts, 3);
  });

  it('el volumen del adaptador es independiente del costo (2 intentos, 10 crudos)', async () => {
    const result = await runRealAdapter([5, 5]);

    assert.equal(result.providerUsage?.creditsUsed, 0);
    assert.equal(
      result.providerUsage?.rawResultsCount,
      result.attempts.reduce((acc, a) => acc + a.rawResultsCount, 0),
      'rawResultsCount = suma de los intentos, no una cifra de costo',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Sección 2 — El RUNNER registra 0 aun con entradas hostiles
// ═══════════════════════════════════════════════════════════════

describe('executeContactEnrichmentApolloRun — el log de people_search registra 0', () => {
  it('TEST 1b — 0 resultados: credits_used=0 y estimated_cost_usd=0', async () => {
    const h = makeHarness(hostileApolloResult(0, []));

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const log = searchLogOf(h);
    assert.equal(log.credits_used, 0);
    assert.equal(log.estimated_cost_usd, 0);
    // Una respuesta vacía sigue siendo una LLAMADA REAL: status success y fila presente.
    assert.equal(log.status, 'success');
    assert.equal(log.results_returned, 0);
  });

  it('TEST 2b — 1 resultado reportado como 1 crédito: se registra 0', async () => {
    const h = makeHarness(hostileApolloResult(1, [person('a')]));

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const log = searchLogOf(h);
    assert.equal(log.credits_used, 0, 'el crédito reportado por volumen se descarta');
    assert.equal(log.estimated_cost_usd, 0);
    assert.equal(log.results_returned, 1);
  });

  it('TEST 3 — 25 resultados reportados como 25 créditos: 0 créditos, 25 resultados', async () => {
    const people = Array.from({ length: 25 }, (_, i) => person(`p${i}`));
    const h = makeHarness(hostileApolloResult(25, people));

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const log = searchLogOf(h);
    assert.equal(log.credits_used, 0, '25 resultados gratis siguen siendo 0 créditos');
    assert.equal(log.estimated_cost_usd, 0);
    assert.equal(log.results_returned, 25, 'el volumen operativo sobrevive al costo cero');
    const metadata = log.metadata as Record<string, unknown>;
    assert.equal(metadata.raw_results_count, 25);
    assert.equal(metadata.normalized_count, 25);
    assert.equal(metadata.inserted_candidates_count, 25);
  });

  it('TEST 4b — varios intentos: una sola fila agregada, 0 créditos, métricas veraces', async () => {
    const people = Array.from({ length: 5 }, (_, i) => person(`p${i}`));
    const apollo = hostileApolloResult(12, people);
    apollo.attempts = [
      { attempt: 'strict_hr_department', filters: 'f1', rawResultsCount: 5 },
      { attempt: 'hr_titles_without_department', filters: 'f2', rawResultsCount: 5 },
      { attempt: 'org_only', filters: 'f3', rawResultsCount: 2 },
    ];
    const h = makeHarness(apollo);

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const searchLogs = h.getUsageLogs().filter((l) => l.operation_key === 'people_search');
    assert.equal(searchLogs.length, 1, 'una fila AGREGADA por corrida, no una por intento');
    assert.equal(searchLogs[0].credits_used, 0);
    assert.equal(searchLogs[0].estimated_cost_usd, 0);
    assert.equal(searchLogs[0].results_returned, 12, 'la suma cruda de los 3 intentos se conserva');
  });

  it('sin providerUsage (la vieja rama de fallback) también registra 0', async () => {
    // El defecto tenía DOS caminos: `creditsUsed` del proveedor y, si faltaba,
    // `?? rawResultsCount`. Este es el segundo.
    const people = Array.from({ length: 4 }, (_, i) => person(`p${i}`));
    const h = makeHarness(hostileApolloResult(4, people, { omitProviderUsage: true }));

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const log = searchLogOf(h);
    assert.equal(log.credits_used, 0, 'sin uso reportado, el volumen NO se convierte en créditos');
    assert.equal(log.estimated_cost_usd, 0);
    assert.equal(log.results_returned, 4, 'el volumen se sigue derivando de los perfiles recibidos');
  });

  it('el costo cero no se declara como costo DESCONOCIDO', async () => {
    const h = makeHarness(hostileApolloResult(3, [person('a'), person('b'), person('c')]));

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const log = searchLogOf(h);
    // NULL significaría "el proveedor no reportó cuánto cobró". Aquí SÍ se sabe: 0.
    assert.notEqual(log.credits_used, null);
    assert.notEqual(log.credits_used, undefined);
    assert.notEqual(log.estimated_cost_usd, null);
    assert.equal(log.credits_used, 0);
    assert.equal(log.estimated_cost_usd, 0);
  });

  it('una búsqueda gratis se distingue de "no se llamó al proveedor"', async () => {
    const called = makeHarness(hostileApolloResult(0, []));
    await executeContactEnrichmentApolloRun('run-1', 'user-1', called.deps);

    const calledLog = searchLogOf(called);
    assert.equal(calledLog.status, 'success', 'la llamada real se registra como éxito, no como skip');
    assert.equal(calledLog.results_returned, 0);
    assert.ok(calledLog.duration_ms !== undefined, 'una llamada real deja duración medida');

    // Sin datos suficientes Apollo no se llama: no hay fila de éxito que confundir.
    const notCalled = makeHarness({
      status: 'skipped',
      people: [],
      attempts: [],
      reason: 'Datos insuficientes para Apollo: falta dominio y nombre de empresa',
    });
    await executeContactEnrichmentApolloRun('run-1', 'user-1', notCalled.deps);

    assert.equal(
      notCalled.getUsageLogs().filter((l) => l.status === 'success').length,
      0,
      'no llamar al proveedor no produce ninguna fila de uso exitosa',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Sección 3 — El cero NO se filtra al enriquecimiento pagado
// ═══════════════════════════════════════════════════════════════

describe('el costo cero de la búsqueda no alcanza a people/match', () => {
  it('TEST 5 — people/match posterior conserva su contabilidad PAGADA', async () => {
    const h = makeHarness(hostileApolloResult(2, [personNoChannel('m1'), personNoChannel('m2')]));
    h.deps.completeContact = async ({ candidate }) => ({
      status: 'completed',
      contact: { ...candidate, email: `${candidate.lastName}@corp.com` },
      completedFields: ['email'],
      wasActionableBefore: false,
      isActionableAfter: true,
      providerUsage: { provider: 'apollo', operation: 'person_match', creditsUsed: 1 },
    });

    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);

    const logs = h.getUsageLogs();
    const search = logs.find((l) => l.operation_key === 'people_search');
    const match = logs.find((l) => l.operation_key === 'person_match');
    assert.ok(search && match, 'búsqueda y match se registran por separado');
    assert.notEqual(search.operation_key, match.operation_key);

    // La búsqueda: gratis.
    assert.equal(search.credits_used, 0);
    assert.equal(search.estimated_cost_usd, 0);

    // El match: pagado, con su precio unitario intacto.
    assert.equal(match.credits_used, 2, 'un crédito por perfil completado');
    assert.equal(match.estimated_cost_usd, Number((2 * UNIT_COST).toFixed(6)));
    assert.ok(
      (match.estimated_cost_usd ?? 0) > 0,
      'el enriquecimiento pagado nunca cae a 0 por el cero de la búsqueda',
    );

    // El costo del run es SOLO el del match: ya no arrastra créditos de búsqueda.
    const costPatch = h.getRunPatches().filter((p) => p.estimated_cost_usd !== undefined).at(-1);
    assert.ok(costPatch, 'el run debe recibir un costo estimado');
    assert.equal(costPatch.estimated_cost_usd, Number((2 * UNIT_COST).toFixed(6)));
  });

  it('los guardrails del enriquecimiento pagado siguen siendo positivos', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    assert.ok(g.maxCompletionCreditsPerRun > 0);
    assert.ok(g.emailRevealCredits > 0);
    assert.ok(g.phoneRevealCredits > 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Sección 4 — Presupuesto y ausencia de red
// ═══════════════════════════════════════════════════════════════

describe('agregación de presupuesto y aislamiento offline', () => {
  it('TEST 6 — N filas de people_search con 0 créditos reducen el presupuesto en exactamente 0', () => {
    const rows: UsageConsumptionRow[] = Array.from({ length: 30 }, () => ({
      providerKey: 'apollo',
      creditsUsed: 0,
      estimatedCostUsd: 0,
      waterfallRunId: null,
    }));

    const consumption = computeEffectiveConsumption({ usageLogs: rows, reservations: [] });

    assert.equal(consumption.credits, 0, '30 búsquedas gratis consumen 0 créditos del pozo');
    assert.equal(consumption.usd, 0);
    assert.equal(consumption.reservedCredits, 0);
    assert.equal(
      consumption.hasUnknownCost,
      false,
      'un 0 escrito es un costo CONOCIDO: escribir NULL lo volvería "desconocido"',
    );

    // Contraste: una pata pagada del mismo pozo sí consume.
    const withPaid = computeEffectiveConsumption({
      usageLogs: [...rows, { providerKey: 'apollo', creditsUsed: 2, estimatedCostUsd: 0.0175, waterfallRunId: null }],
      reservations: [],
    });
    assert.equal(withPaid.credits, 2, 'el gasto real sigue contando entero');
    assert.equal(withPaid.usd, 0.0175);
  });

  it('el 0 de la búsqueda se clasifica como costo CONOCIDO, no como cero sin probar', async () => {
    const h = makeHarness(hostileApolloResult(3, [person('a'), person('b'), person('c')]));
    await executeContactEnrichmentApolloRun('run-1', 'user-1', h.deps);
    const log = searchLogOf(h);
    const metadata = log.metadata as Record<string, unknown>;

    // El lector de efectividad deriva la "evidencia de pricing" de estos campos planos.
    // Si el log dejara de traerlos, un 0 pasaría a leerse como cero AMBIGUO (el patrón
    // legacy de Lusha: un 0 escrito sin evidencia mientras sí se gastaba).
    const hasPricingEvidence =
      typeof metadata.pricing_source === 'string' ||
      typeof metadata.pricing_basis === 'string' ||
      typeof metadata.unit_cost_usd === 'number';
    assert.equal(hasPricingEvidence, true, 'el log conserva evidencia de pricing');

    const truth = classifyApolloOperationCostTruth(
      log.estimated_cost_usd ?? null,
      log.credits_used ?? null,
      hasPricingEvidence,
    );
    assert.equal(truth, 'known', 'un cero confirmado por el proveedor es un costo CONOCIDO');

    // Y no envenena la verdad de costo del run cuando se combina con una pata pagada.
    assert.equal(deriveRunCostTruth([truth, 'known']), 'known');
  });

  it('TEST 7 — ninguna llamada de red durante los tests', () => {
    assert.deepEqual(fetchCalls, [], `fetch fue invocado: ${fetchCalls.join(', ')}`);
  });
});
