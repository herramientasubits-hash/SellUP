// /ai-usage — una sola fuente de dinero y filtros coherentes (funciones puras).
//
// Todo el dinero sale de provider_usage_logs. agent_runs sólo aporta conteos,
// estados y el mapa agent_run_id → agente. Antes, «Consumo por persona» sumaba
// agent_runs.estimated_cost_usd MÁS el costo de sus logs (el costo de una
// ejecución ES la suma de sus logs), así que cada persona salía al doble.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateAgentStats,
  aggregateProviderStats,
  aggregateUsageSummary,
  aggregateUserConsumption,
  consumerIds,
  indexRunsById,
  selectLogsInScope,
  selectRunsInScope,
  UNATTRIBUTED_AGENT_KEY,
  type UsageLogRow,
  type UsageRunRow,
  type UsageScope,
} from '../usage-aggregators';
import { resolveStatusFilter } from '../usage-filter-semantics';

function run(overrides: Partial<UsageRunRow> & { id: string }): UsageRunRow {
  return {
    agent_key: 'prospect_generation',
    agent_name: 'Generación de empresas candidatas',
    status: 'completed',
    triggered_by: 'u1',
    created_at: '2026-10-10T12:00:00Z',
    results_generated: 0,
    results_approved: 0,
    estimated_cost_usd: null,
    ...overrides,
  };
}

function log(overrides: Partial<UsageLogRow> = {}): UsageLogRow {
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
    ...overrides,
  };
}

const NO_SCOPE: UsageScope = {
  since: null,
  status: resolveStatusFilter(undefined),
  userIds: null,
};

describe('aggregateUserConsumption — sin doble conteo', () => {
  it('una ejecución de $3 con tres logs de $1 cuesta $3, no $6', () => {
    const runs = [run({ id: 'r1', estimated_cost_usd: 3 })];
    const logs = [
      log({ agent_run_id: 'r1' }),
      log({ agent_run_id: 'r1' }),
      log({ agent_run_id: 'r1' }),
    ];
    const rows = aggregateUserConsumption(runs, logs, [{ id: 'u1', full_name: 'Ana', email: null }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].estimated_cost_usd, 3);
    assert.equal(rows[0].executions, 1);
    assert.equal(rows[0].provider_calls, 3);
  });

  it('una ejecución con costo pero sin logs NO suma dinero (el costo vive en los logs)', () => {
    const runs = [run({ id: 'r1', estimated_cost_usd: 9 })];
    const rows = aggregateUserConsumption(runs, [], [{ id: 'u1', full_name: 'Ana', email: null }]);
    assert.equal(rows[0].estimated_cost_usd, 0);
    assert.equal(rows[0].executions, 1);
  });

  it('un log sin costo conocido marca has_unknown_cost y no suma 0 fabricado', () => {
    const rows = aggregateUserConsumption(
      [],
      [log({ estimated_cost_usd: null }), log({ estimated_cost_usd: 2 })],
      [{ id: 'u1', full_name: 'Ana', email: null }],
    );
    assert.equal(rows[0].estimated_cost_usd, 2);
    assert.equal(rows[0].has_unknown_cost, true);
  });

  it('no corta la lista en 100 personas', () => {
    const users = Array.from({ length: 150 }, (_, i) => ({
      id: `u${i}`,
      full_name: `Persona ${String(i).padStart(3, '0')}`,
      email: null,
    }));
    const rows = aggregateUserConsumption([], [], users);
    assert.equal(rows.length, 150);
  });

  it('conserva el consumo de personas que ya no están activas', () => {
    const rows = aggregateUserConsumption(
      [],
      [log({ triggered_by: 'ex' })],
      [{ id: 'u1', full_name: 'Ana', email: null }],
      [{ id: 'ex', full_name: 'Ex', email: 'ex@x.co' }],
    );
    const ex = rows.find((r) => r.triggered_by === 'ex');
    assert.ok(ex);
    assert.equal(ex.full_name, 'Ex');
    assert.equal(ex.estimated_cost_usd, 1);
    // Quien consumió va antes que quien no.
    assert.equal(rows[0].triggered_by, 'ex');
  });

  it('consumerIds junta los ids de ejecuciones y consultas', () => {
    assert.deepEqual(
      consumerIds([run({ id: 'r1', triggered_by: 'a' })], [log({ triggered_by: 'b' }), log({ triggered_by: null })]).sort(),
      ['a', 'b'],
    );
  });
});

describe('aggregateUsageSummary — KPIs sólo desde los logs', () => {
  it('el costo total es la suma de los logs, no de agent_runs', () => {
    const runs = [run({ id: 'r1', estimated_cost_usd: 100 })];
    const logs = [log({ agent_run_id: 'r1', estimated_cost_usd: 2 }), log({ estimated_cost_usd: 3 })];
    const s = aggregateUsageSummary(runs, logs);
    assert.equal(s.total_estimated_cost_usd, 5);
    assert.equal(s.total_executions, 1);
    assert.equal(s.total_provider_calls, 2);
  });

  it('el costo medio por ejecución usa sólo los logs de esas ejecuciones', () => {
    const runs = [run({ id: 'r1' }), run({ id: 'r2' })];
    const logs = [
      log({ agent_run_id: 'r1', estimated_cost_usd: 2 }),
      log({ agent_run_id: 'r2', estimated_cost_usd: 4 }),
      // Consulta suelta, sin ejecución: no infla el costo por ejecución.
      log({ agent_run_id: null, estimated_cost_usd: 10 }),
    ];
    const s = aggregateUsageSummary(runs, logs);
    assert.equal(s.avg_cost_per_run, 3);
    assert.equal(s.total_estimated_cost_usd, 16);
  });

  it('cuenta errores de proveedor y ejecuciones fallidas / en curso', () => {
    const runs = [run({ id: 'r1', status: 'failed' }), run({ id: 'r2', status: 'running' })];
    const logs = [log({ status: 'rate_limited' }), log({ status: 'success' })];
    const s = aggregateUsageSummary(runs, logs);
    assert.equal(s.failed_executions, 1);
    assert.equal(s.running_executions, 1);
    assert.equal(s.error_provider_calls, 1);
    assert.equal(s.avg_cost_per_run, 0);
  });

  it('sin ejecuciones el costo medio es null', () => {
    assert.equal(aggregateUsageSummary([], [log()]).avg_cost_per_run, null);
  });
});

describe('aggregateAgentStats — costo por agente desde los logs', () => {
  it('ignora agent_runs.estimated_cost_usd y suma los logs de cada agente', () => {
    const runs = [
      run({ id: 'r1', agent_key: 'prospect_generation', estimated_cost_usd: 50 }),
      run({ id: 'r2', agent_key: 'candidate_enrichment', agent_name: 'Enriquecimiento' }),
    ];
    const logs = [
      log({ agent_run_id: 'r1', estimated_cost_usd: 2 }),
      log({ agent_run_id: 'r2', estimated_cost_usd: 1 }),
      log({ agent_run_id: 'r2', estimated_cost_usd: null }),
    ];
    const stats = aggregateAgentStats(runs, logs, indexRunsById(runs));
    const pg = stats.find((s) => s.agent_key === 'prospect_generation');
    const ce = stats.find((s) => s.agent_key === 'candidate_enrichment');
    assert.equal(pg?.total_estimated_cost_usd, 2);
    assert.equal(pg?.has_unknown_cost, false);
    assert.equal(ce?.total_estimated_cost_usd, 1);
    assert.equal(ce?.has_unknown_cost, true);
  });

  it('un log de una ejecución fuera del periodo se atribuye a su agente igual', () => {
    const allRuns = [run({ id: 'old', created_at: '2026-01-01T00:00:00Z' })];
    const stats = aggregateAgentStats([], [log({ agent_run_id: 'old' })], indexRunsById(allRuns));
    assert.equal(stats.length, 1);
    assert.equal(stats[0].agent_key, 'prospect_generation');
    assert.equal(stats[0].total_executions, 0);
    assert.equal(stats[0].total_estimated_cost_usd, 1);
  });

  it('las consultas sin ejecución van a «sin agente» para que la tabla cuadre con el total', () => {
    const stats = aggregateAgentStats([], [log({ agent_run_id: null, estimated_cost_usd: 4 })], new Map());
    assert.equal(stats.length, 1);
    assert.equal(stats[0].agent_key, UNATTRIBUTED_AGENT_KEY);
    assert.equal(stats[0].total_estimated_cost_usd, 4);
  });

  it('cuenta ejecuciones, resultados y última ejecución desde agent_runs', () => {
    const runs = [
      run({ id: 'r1', results_generated: 10, results_approved: 4, created_at: '2026-10-01T00:00:00Z' }),
      run({ id: 'r2', status: 'failed', results_generated: 5, results_approved: 1, created_at: '2026-10-05T00:00:00Z' }),
    ];
    const [stat] = aggregateAgentStats(runs, [], indexRunsById(runs));
    assert.equal(stat.total_executions, 2);
    assert.equal(stat.completed_executions, 1);
    assert.equal(stat.failed_executions, 1);
    assert.equal(stat.total_results_generated, 15);
    assert.equal(stat.total_results_approved, 5);
    assert.equal(stat.last_run_at, '2026-10-05T00:00:00Z');
  });
});

describe('aggregateProviderStats — «sin tarifa» se cuenta, no se suma como 0', () => {
  it('cuenta las consultas sin costo conocido', () => {
    const [stat] = aggregateProviderStats([
      log({ provider_key: 'tavily', estimated_cost_usd: null }),
      log({ provider_key: 'tavily', estimated_cost_usd: null }),
      log({ provider_key: 'tavily', estimated_cost_usd: 0.5 }),
    ]);
    assert.equal(stat.unknown_cost_operations, 2);
    assert.equal(stat.has_unknown_cost, true);
    assert.equal(stat.total_estimated_cost_usd, 0.5);
    assert.equal(stat.total_calls, 3);
  });
});

describe('selectLogsInScope / selectRunsInScope — los mismos filtros en los dos lados', () => {
  const runs = [
    run({ id: 'r1', agent_key: 'prospect_generation', status: 'completed', triggered_by: 'u1' }),
    run({ id: 'r2', agent_key: 'candidate_enrichment', status: 'running', triggered_by: 'u2' }),
  ];
  const byId = indexRunsById(runs);
  const logs = [
    log({ agent_run_id: 'r1', provider_key: 'apollo', status: 'success', triggered_by: 'u1' }),
    log({ agent_run_id: 'r2', provider_key: 'tavily', status: 'error', triggered_by: 'u2' }),
    log({ agent_run_id: null, provider_key: 'lusha', status: 'success', triggered_by: 'u1' }),
  ];

  it('Agente filtra las consultas por su ejecución', () => {
    const scope: UsageScope = { ...NO_SCOPE, agentKey: 'candidate_enrichment' };
    const inScope = selectLogsInScope(logs, byId, scope);
    assert.deepEqual(inScope.map((l) => l.provider_key), ['tavily']);
  });

  it('Estado «Completado» encuentra consultas success (ya no da 0)', () => {
    const scope: UsageScope = { ...NO_SCOPE, status: resolveStatusFilter('completed') };
    assert.equal(selectLogsInScope(logs, byId, scope).length, 2);
    assert.deepEqual(selectRunsInScope(runs, logs, scope).map((r) => r.id), ['r1']);
  });

  it('Estado «En curso» toma las consultas de las ejecuciones en curso', () => {
    const scope: UsageScope = { ...NO_SCOPE, status: resolveStatusFilter('running') };
    assert.deepEqual(selectLogsInScope(logs, byId, scope).map((l) => l.agent_run_id), ['r2']);
  });

  it('Proveedor también filtra las ejecuciones: sólo las que usaron ese proveedor', () => {
    const scope: UsageScope = { ...NO_SCOPE, providerKey: 'apollo' };
    const scopedLogs = selectLogsInScope(logs, byId, scope);
    assert.deepEqual(selectRunsInScope(runs, scopedLogs, scope).map((r) => r.id), ['r1']);
  });

  it('Persona / rol / grupo (ids) se aplica a ejecuciones y consultas', () => {
    const scope: UsageScope = { ...NO_SCOPE, userIds: ['u2'] };
    assert.deepEqual(selectRunsInScope(runs, logs, scope).map((r) => r.id), ['r2']);
    assert.deepEqual(selectLogsInScope(logs, byId, scope).map((l) => l.triggered_by), ['u2']);
  });

  it('Periodo se aplica a los dos lados', () => {
    const scope: UsageScope = { ...NO_SCOPE, since: '2026-10-11T00:00:00Z' };
    assert.equal(selectRunsInScope(runs, logs, scope).length, 0);
    assert.equal(selectLogsInScope(logs, byId, scope).length, 0);
  });
});
