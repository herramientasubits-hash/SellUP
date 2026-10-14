// /ai-usage fase 3 — tablas por agente, país, rol/grupo y búsqueda (funciones puras).
//
// Reglas que fijan estas pruebas:
//   - el dinero sale SÓLO de las consultas; un costo NULL es «sin tarifa», no $0;
//   - una empresa cuenta sólo si es de una corrida real (no QA ni smoke);
//   - «entregada» tiene tres niveles: llegó a revisión, aprobada, convertida;
//   - las dimensiones se calculan igual exista o no la migración 147;
//   - a quien no ve dólares no le llega ningún importe.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { UsageLogRow, UsageRunRow } from '../usage-aggregators';
import {
  batchIdsNeedingDimensions,
  batchMatchesDimensionFilters,
  enrichLogDimensions,
  hasDimensionFilters,
  matchesDimensionFilters,
  type BatchDimensionRow,
  type DimensionedLogRow,
  type RawLogDimensions,
} from '../usage-dimension-scope';
import {
  candidateTool,
  isProductionCandidate,
  isProductionDiscard,
  providerTool,
  resolveCompanyOutcomes,
  type CompanyBatchRow,
  type CompanyCandidateRow,
} from '../company-outcomes';
import {
  aggregateAgentSteps,
  aggregateCountryTools,
  aggregateRoleGroups,
  aggregateSearchBatches,
  NO_GROUP_KEY,
  OTHER_STEP_KEY,
} from '../usage-breakdowns';
import {
  canSeeMoney,
  redactAgentSteps,
  redactCountryTools,
  redactRecentLogs,
  redactRoleGroups,
  redactSearchBatches,
  redactSummary,
} from '../money-visibility';
import type { ProviderUsageLog } from '@/modules/usage-tracking/types';

function rawLog(overrides: Partial<UsageLogRow & RawLogDimensions> = {}): UsageLogRow & RawLogDimensions {
  return {
    agent_run_id: null,
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    status: 'success',
    triggered_by: 'u1',
    credits_used: 1,
    input_tokens: 0,
    output_tokens: 0,
    results_returned: 10,
    estimated_cost_usd: 1,
    created_at: '2026-10-10T12:00:00Z',
    batch_id: 'b1',
    ...overrides,
  };
}

function batch(overrides: Partial<CompanyBatchRow> & { id: string }): CompanyBatchRow {
  return {
    created_at: '2026-10-10T10:00:00Z',
    created_by: 'u1',
    country_code: 'CO',
    industry: 'Tecnología',
    source: 'agent_1',
    name: 'Lote',
    status: 'completed',
    metadata: { apollo_discovery_taxonomy: { macro_industry_key: 'technology' } },
    ...overrides,
  };
}

function candidate(overrides: Partial<CompanyCandidateRow> & { id: string }): CompanyCandidateRow {
  return {
    batch_id: 'b1',
    status: 'needs_review',
    duplicate_status: 'no_match',
    converted_account_id: null,
    source_primary: 'apollo',
    tax_identifier: null,
    website: null,
    domain: null,
    country_code: null,
    record_origin: 'production',
    rejection_reason: null,
    classification_source: 'writer',
    review_notes: null,
    reviewed_by: null,
    metadata: null,
    ...overrides,
  };
}

const B1 = batch({ id: 'b1' });
const BATCHES = new Map<string, BatchDimensionRow>([['b1', B1]]);
const NO_RUNS = new Map<string, UsageRunRow>();

function enriched(overrides: Partial<UsageLogRow & RawLogDimensions> = {}): DimensionedLogRow {
  return enrichLogDimensions([rawLog(overrides)], BATCHES, NO_RUNS)[0];
}

describe('enrichLogDimensions — lo mismo con y sin la migración 147', () => {
  it('sin columnas: agente, paso, país, industria y forma salen de las reglas y del lote', () => {
    const log = enriched({ provider_key: 'anthropic', operation_key: 'company_domain_search', log_found: 'true' });
    assert.equal(log.agent_key, 'agent1');
    assert.equal(log.agent_step, 'rescate_web');
    assert.equal(log.country_code, 'CO');
    assert.equal(log.macro_industry_key, 'technology');
    assert.equal(log.search_mode, 'exploratory');
    assert.equal(log.found, true);
  });

  it('con columnas: lo que trae la base gana', () => {
    const log = enriched({ country_code: 'PE', agent_key: 'agent1', agent_step: 'apollo', search_mode: 'competitors' });
    assert.equal(log.country_code, 'PE');
    assert.equal(log.search_mode, 'competitors');
  });

  it('sólo se piden los lotes de las consultas que no traen dimensiones', () => {
    const logs = [
      rawLog({ batch_id: 'b1' }),
      rawLog({ batch_id: 'b2', country_code: 'CO', macro_industry_key: 'x', search_mode: 'exploratory' }),
      rawLog({ batch_id: null }),
    ];
    assert.deepEqual(batchIdsNeedingDimensions(logs), ['b1']);
  });

  it('filtros de país, industria, paso y forma', () => {
    const log = enriched();
    assert.equal(hasDimensionFilters({}), false);
    assert.equal(matchesDimensionFilters(log, { countryCode: 'CO', agentStep: 'apollo' }), true);
    assert.equal(matchesDimensionFilters(log, { countryCode: 'MX' }), false);
    assert.equal(matchesDimensionFilters(log, { macroIndustryKey: 'retail' }), false);
    assert.equal(matchesDimensionFilters(log, { searchMode: 'import' }), false);
    assert.equal(batchMatchesDimensionFilters(B1, { countryCode: 'CO', macroIndustryKey: 'technology' }), true);
    assert.equal(batchMatchesDimensionFilters(B1, { searchMode: 'import' }), false);
  });
});

describe('company-outcomes — empresas entregadas en tres niveles', () => {
  const batches = new Map([['b1', B1]]);

  it('una fila de QA o smoke no cuenta', () => {
    assert.equal(isProductionCandidate(candidate({ id: 'c1' }), B1), true);
    assert.equal(isProductionCandidate(candidate({ id: 'c2', record_origin: 'qa' }), B1), false);
    assert.equal(isProductionCandidate(candidate({ id: 'c3', record_origin: 'smoke_test' }), B1), false);
  });

  it('llegó a revisión, aprobada y convertida; número fiscal y web', () => {
    const outcomes = resolveCompanyOutcomes(
      [
        candidate({ id: 'c1', tax_identifier: '900', website: 'https://a.co' }),
        candidate({ id: 'c2', status: 'approved', domain: 'b.co' }),
        candidate({ id: 'c3', status: 'converted_to_account', converted_account_id: 'acc' }),
        candidate({ id: 'c4', record_origin: 'qa', status: 'approved' }),
      ],
      batches,
      new Set(),
    );
    assert.equal(outcomes.length, 3);
    assert.deepEqual(
      outcomes.map((o) => [o.candidateId, o.approved, o.converted, o.hasTaxId, o.hasWebsite, o.countryCode]),
      [
        ['c1', false, false, true, true, 'CO'],
        ['c2', true, false, false, true, 'CO'],
        ['c3', true, true, false, false, 'CO'],
      ],
    );
  });

  it('herramienta: banco gana; fuentes públicas = buscador gratis; web_ai, Apollo, Lusha', () => {
    assert.equal(candidateTool('apollo', true), 'banco');
    assert.equal(candidateTool('public_source', false), 'gratis');
    assert.equal(candidateTool('denue_mexico', false), 'gratis');
    assert.equal(candidateTool('web_ai', false), 'web_ai');
    assert.equal(candidateTool('lusha', false), 'lusha');
    assert.equal(candidateTool('manual', false), 'otros');
    assert.equal(providerTool('anthropic'), 'claude');
    assert.equal(providerTool('tavily'), 'web_ai');
    assert.equal(providerTool('hubspot'), 'otros');
  });

  it('un descarte de una corrida real cuenta; uno de QA no', () => {
    assert.equal(isProductionDiscard({ batch_id: 'b1', country_code: 'CO', source_primary: 'apollo' }, B1), true);
    const qaBatch = batch({ id: 'qa', metadata: { qa_only: true } });
    assert.equal(isProductionDiscard({ batch_id: 'qa', country_code: 'CO', source_primary: 'apollo' }, qaBatch), false);
  });
});

describe('aggregateAgentSteps — por agente y paso', () => {
  it('cuenta consultas, errores, créditos y dinero; costo por web encontrada', () => {
    const logs = [
      enriched({ provider_key: 'anthropic', operation_key: 'company_domain_search', log_found: 'true', estimated_cost_usd: 0.3, credits_used: null }),
      enriched({ provider_key: 'anthropic', operation_key: 'company_domain_search', log_found: 'false', estimated_cost_usd: 0.3, credits_used: null }),
      enriched({ provider_key: 'anthropic', operation_key: 'company_domain_search', status: 'error', estimated_cost_usd: null }),
      enriched({ provider_key: 'apollo', operation_key: 'person_match', credits_used: 2, estimated_cost_usd: 1 }),
    ];
    const { agents, steps } = aggregateAgentSteps(logs);
    const rescue = steps.find((s) => s.agentStep === 'rescate_web');
    assert.ok(rescue);
    assert.equal(rescue.calls, 3);
    assert.equal(rescue.errors, 1);
    assert.equal(rescue.hasUnknownCost, true);
    assert.equal(rescue.resultMetric, 'webs_found');
    assert.equal(rescue.resultCount, 1);
    assert.ok(Math.abs((rescue.costPerResultUsd ?? 0) - 0.6) < 1e-9);
    assert.equal(rescue.unknownCreditCalls, 2);
    const contacts = steps.find((s) => s.agentKey === 'agent2a');
    assert.equal(contacts?.agentStep, 'identificar_contacto');
    assert.equal(contacts?.resultMetric, null);
    assert.deepEqual(
      agents.map((a) => [a.agentKey, a.calls, a.steps]),
      [
        ['agent2a', 1, 1],
        ['agent1', 3, 1],
      ],
    );
  });
});

describe('aggregateCountryTools — país × herramienta', () => {
  it('empresas, descartes y costo por aprobada, con fila total por país', () => {
    const outcomes = resolveCompanyOutcomes(
      [
        candidate({ id: 'c1', status: 'approved', tax_identifier: '1' }),
        candidate({ id: 'c2', source_primary: 'public_source', status: 'approved' }),
        candidate({ id: 'c3', source_primary: 'web_ai' }),
      ],
      new Map([['b1', B1]]),
      new Set(),
    );
    const logs = [
      enriched({ provider_key: 'apollo', estimated_cost_usd: 4 }),
      enriched({ provider_key: 'anthropic', operation_key: 'company_classification', estimated_cost_usd: 1 }),
      enriched({ provider_key: 'tavily', operation_key: 'multi_query_web_search', estimated_cost_usd: null }),
      enriched({ batch_id: null, estimated_cost_usd: 100 }),
    ];
    const rows = aggregateCountryTools(outcomes, [{ countryCode: 'CO', tool: 'apollo' }], logs);
    const byTool = new Map(rows.filter((r) => r.countryCode === 'CO').map((r) => [r.tool, r]));
    assert.deepEqual([...byTool.keys()], ['total', 'gratis', 'web_ai', 'claude', 'apollo']);
    const total = byTool.get('total')!;
    assert.equal(total.reachedReview, 3);
    assert.equal(total.approved, 2);
    assert.equal(total.discarded, 1);
    // El costo sin país (consulta sin lote) no se reparte en ningún país.
    assert.equal(total.costUsd, 5);
    assert.equal(total.hasUnknownCost, true);
    assert.equal(total.costPerApprovedUsd, 2.5);
    assert.equal(byTool.get('apollo')!.costPerApprovedUsd, 4);
    assert.equal(byTool.get('gratis')!.costUsd, 0);
    assert.equal(byTool.get('web_ai')!.hasUnknownCost, true);
  });
});

describe('aggregateRoleGroups — rol y grupo del momento de la consulta', () => {
  it('usa la foto del log si existe y, si no, el rol de hoy; aprobadas por quien creó el lote', () => {
    const logs = [
      enriched({ triggered_by: 'u1', triggered_by_role_key: 'commercial_lead', estimated_cost_usd: 2 }),
      enriched({ triggered_by: 'u1', estimated_cost_usd: 1 }),
      enriched({ triggered_by: 'u2', estimated_cost_usd: 3 }),
    ];
    const outcomes = resolveCompanyOutcomes(
      [candidate({ id: 'c1', status: 'approved' }), candidate({ id: 'c2', status: 'approved' })],
      new Map([['b1', B1]]),
      new Set(),
    );
    const result = aggregateRoleGroups(logs, outcomes, new Map([['b1', B1]]), [
      { id: 'u1', name: 'Ana', email: null, roleKey: 'seller', groupId: 'g1' },
      { id: 'u2', name: 'Beto', email: null, roleKey: 'seller', groupId: null },
    ]);
    const roles = new Map(result.roles.map((r) => [r.id, r]));
    assert.equal(roles.get('commercial_lead')?.costUsd, 2);
    assert.equal(roles.get('seller')?.costUsd, 4);
    assert.equal(roles.get('seller')?.approved, 2);
    assert.equal(roles.get('seller')?.costPerApprovedUsd, 2);
    const groups = new Map(result.groups.map((g) => [g.id, g]));
    assert.equal(groups.get('g1')?.costUsd, 3);
    assert.equal(groups.get(NO_GROUP_KEY)?.costUsd, 3);
    const ana = result.people.find((p) => p.userId === 'u1');
    assert.equal(ana?.calls, 2);
    assert.equal(ana?.approved, 2);
    assert.equal(ana?.costUsd, 3);
  });
});

describe('aggregateSearchBatches — una fila por búsqueda', () => {
  it('empresas por herramienta, costo por paso y costo por aprobada', () => {
    const b2 = batch({ id: 'b2', created_at: '2026-10-11T10:00:00Z', country_code: 'PE', source: 'imported', metadata: {} });
    const outcomes = resolveCompanyOutcomes(
      [
        candidate({ id: 'c1', status: 'approved' }),
        candidate({ id: 'c2', source_primary: 'web_ai' }),
      ],
      new Map([['b1', B1]]),
      new Set(['c1']),
    );
    const logs = [
      enriched({ estimated_cost_usd: 2 }),
      enriched({ provider_key: 'openai', operation_key: 'x', estimated_cost_usd: 1 }),
      enriched({ estimated_cost_usd: null }),
    ];
    const rows = aggregateSearchBatches([B1, b2], outcomes, logs);
    assert.deepEqual(rows.map((r) => r.batchId), ['b2', 'b1']);
    const first = rows[1];
    assert.deepEqual(first.companiesByTool, { banco: 1, web_ai: 1 });
    assert.equal(first.reachedReview, 2);
    assert.equal(first.approved, 1);
    assert.deepEqual(first.costByStep, { apollo: 2, [OTHER_STEP_KEY]: 1 });
    assert.equal(first.totalCostUsd, 3);
    assert.equal(first.hasUnknownCost, true);
    assert.equal(first.costPerApprovedUsd, 3);
    assert.equal(rows[0].searchMode, 'import');
    assert.equal(rows[0].costPerApprovedUsd, null);
  });
});

describe('money-visibility — dólares sólo para administración y líderes', () => {
  it('quién ve dinero', () => {
    assert.equal(canSeeMoney({ viewAll: true, roleKey: 'seller' }), true);
    assert.equal(canSeeMoney({ viewAll: false, roleKey: 'commercial_lead' }), true);
    assert.equal(canSeeMoney({ viewAll: false, roleKey: 'commercial_manager' }), true);
    assert.equal(canSeeMoney({ viewAll: false, roleKey: 'seller' }), false);
    assert.equal(canSeeMoney({ viewAll: false, roleKey: null }), false);
  });

  it('a quien no ve dinero no le llega ningún importe', () => {
    const steps = aggregateAgentSteps([enriched({ estimated_cost_usd: 5 })]);
    const red = redactAgentSteps(steps);
    assert.equal(red.steps[0].costUsd, null);
    assert.equal(red.agents[0].costUsd, null);
    assert.equal(red.steps[0].credits, 1, 'los créditos sí se ven');

    const country = redactCountryTools(aggregateCountryTools([], [], [enriched({ estimated_cost_usd: 5 })]));
    assert.ok(country.every((r) => r.costUsd === null && r.costPerApprovedUsd === null));

    const roles = redactRoleGroups(aggregateRoleGroups([enriched()], [], new Map(), []).roles);
    assert.ok(roles.every((r) => r.costUsd === null));

    const searches = redactSearchBatches(aggregateSearchBatches([B1], [], [enriched({ estimated_cost_usd: 5 })]));
    assert.deepEqual(searches[0].costByStep, {});
    assert.equal(searches[0].totalCostUsd, null);

    const summary = redactSummary({
      total_executions: 1,
      running_executions: 0,
      failed_executions: 0,
      total_provider_calls: 1,
      error_provider_calls: 0,
      total_estimated_cost_usd: 9,
      has_unknown_cost: true,
      distinct_providers: 1,
      avg_cost_per_run: 9,
    });
    assert.equal(summary.total_estimated_cost_usd, 0);
    assert.equal(summary.avg_cost_per_run, null);

    const [log] = redactRecentLogs([
      {
        estimated_cost_usd: 1,
        real_cost_usd: 1,
        metadata: { pricing: { unit_cost_usd: 0.2 }, run_correlation: { billing_state: 'unknown' } },
      } as unknown as ProviderUsageLog,
    ]);
    assert.equal(log.estimated_cost_usd, null);
    assert.deepEqual(log.metadata, { run_correlation: { billing_state: 'unknown' } });
  });
});
