// /ai-usage — desplegar ANTES de aplicar la migración 147 no rompe la página.
//
// Si las columnas nuevas de provider_usage_logs todavía no existen, la lectura
// lo detecta, vuelve a pedir sin ellas y calcula agente, paso, país, industria
// y forma en memoria con las mismas reglas. Un error que NO es «falta la
// columna» sigue siendo un error (nunca se convierte en «sin consumo»).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isMissingDimensionColumnError, loadUsageDataset } from '../usage-dataset';
import type { AdminClient } from '../queries';

type Row = Record<string, unknown>;

/** Cliente mínimo: devuelve las filas de cada tabla por páginas y registra los select. */
function fakeClient(tables: Record<string, Row[]>, options: { columnsExist: boolean; failLogs?: string }) {
  const selects: string[] = [];
  const client = {
    from(table: string) {
      let columns = '';
      const builder = {
        select(cols: string) {
          columns = cols;
          selects.push(`${table}: ${cols}`);
          return builder;
        },
        gte: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        range(from: number, to: number) {
          if (table === 'provider_usage_logs') {
            if (options.failLogs) return Promise.resolve({ data: null, error: { message: options.failLogs } });
            if (!options.columnsExist && /agent_key/.test(columns)) {
              return Promise.resolve({
                data: null,
                error: { message: 'column provider_usage_logs.agent_key does not exist' },
              });
            }
          }
          return Promise.resolve({ data: (tables[table] ?? []).slice(from, to + 1), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as AdminClient, selects };
}

const LOGS: Row[] = [
  {
    id: 'l1',
    agent_run_id: null,
    batch_id: 'b1',
    provider_key: 'anthropic',
    operation_key: 'company_domain_search',
    status: 'success',
    triggered_by: 'u1',
    credits_used: null,
    input_tokens: 10,
    output_tokens: 5,
    results_returned: 1,
    estimated_cost_usd: 0.2,
    created_at: '2026-10-10T10:00:00Z',
    log_flow: 'claude_rescue',
    log_found: 'true',
  },
  {
    id: 'l2',
    agent_run_id: null,
    batch_id: 'b2',
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    status: 'success',
    triggered_by: 'u1',
    credits_used: 1,
    input_tokens: 0,
    output_tokens: 0,
    results_returned: 25,
    estimated_cost_usd: 0.5,
    created_at: '2026-10-10T11:00:00Z',
    log_flow: null,
    log_found: null,
  },
];
const BATCHES: Row[] = [
  { id: 'b1', country_code: 'co', source: 'agent_1', adt: 'technology', ccs: null, lro: null },
  { id: 'b2', country_code: 'PE', source: 'agent_1', adt: null, ccs: 'retail', lro: null },
];

describe('loadUsageDataset — tolera que la 147 no esté aplicada', () => {
  it('sin las columnas: vuelve a leer sin ellas y calcula las dimensiones en memoria', async () => {
    const { client, selects } = fakeClient(
      { agent_runs: [], provider_usage_logs: LOGS, prospect_batches: BATCHES },
      { columnsExist: false },
    );
    const data = await loadUsageDataset(client, {}, { mode: 'none' }, {});
    assert.equal(data.dimensionsAvailable, false);
    assert.equal(selects.filter((s) => s.startsWith('provider_usage_logs')).length, 2);
    assert.deepEqual(
      data.logsInScope.map((l) => [l.agent_key, l.agent_step, l.country_code, l.macro_industry_key, l.search_mode, l.found]),
      [
        ['agent1', 'rescate_web', 'CO', 'technology', 'exploratory', true],
        ['agent1', 'apollo', 'PE', 'retail', 'exploratory', null],
      ],
    );
  });

  it('los filtros de país y paso funcionan también sin la 147', async () => {
    const { client } = fakeClient(
      { agent_runs: [], provider_usage_logs: LOGS, prospect_batches: BATCHES },
      { columnsExist: false },
    );
    const data = await loadUsageDataset(client, {}, { mode: 'none' }, { countryCode: 'PE', agentStep: 'apollo' });
    assert.deepEqual(data.logsInScope.map((l) => l.id), ['l2']);
  });

  it('con las columnas: usa lo que trae la base y no pide lotes que no hacen falta', async () => {
    const withColumns = LOGS.map((l) => ({
      ...l,
      agent_key: 'agent1',
      agent_step: 'manual',
      country_code: 'MX',
      macro_industry_key: 'government',
      search_mode: 'exploratory',
    }));
    const { client, selects } = fakeClient(
      { agent_runs: [], provider_usage_logs: withColumns, prospect_batches: BATCHES },
      { columnsExist: true },
    );
    const data = await loadUsageDataset(client, {}, { mode: 'none' }, {});
    assert.equal(data.dimensionsAvailable, true);
    assert.ok(data.logsInScope.every((l) => l.country_code === 'MX' && l.agent_step === 'manual'));
    assert.equal(selects.some((s) => s.startsWith('prospect_batches')), false);
  });

  it('otro error de lectura sigue siendo un error', async () => {
    const { client } = fakeClient(
      { agent_runs: [], provider_usage_logs: LOGS, prospect_batches: BATCHES },
      { columnsExist: true, failLogs: 'permission denied for table provider_usage_logs' },
    );
    await assert.rejects(() => loadUsageDataset(client, {}, { mode: 'none' }, {}), /no se pudo leer provider_usage_logs/);
  });

  it('sólo «falta la columna de la 147» cuenta como migración pendiente', () => {
    assert.equal(isMissingDimensionColumnError('column provider_usage_logs.country_code does not exist'), true);
    assert.equal(
      isMissingDimensionColumnError("Could not find the 'agent_step' column of 'provider_usage_logs' in the schema cache"),
      true,
    );
    assert.equal(isMissingDimensionColumnError('permission denied for table provider_usage_logs'), false);
    assert.equal(isMissingDimensionColumnError(null), false);
  });
});
