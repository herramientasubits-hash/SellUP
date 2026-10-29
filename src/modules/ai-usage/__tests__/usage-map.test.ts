// «Mapa de uso»: atribución por rol, grupo, país, persona y líder; tonos por fila;
// «cuándo se usa» en la hora de Colombia. Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUsageMap,
  usageMapTone,
  zonedSlot,
  NO_LEADER_KEY,
  type UsageMapInput,
  type UsageMapMatrix,
} from '../usage-map';
import type { DimensionedLogRow } from '../usage-dimension-scope';

function log(over: Partial<DimensionedLogRow>): DimensionedLogRow {
  return {
    agent_run_id: null, provider_key: 'apollo', operation_key: null, status: 'success', triggered_by: 'ana',
    credits_used: 1, input_tokens: null, output_tokens: null, results_returned: null, estimated_cost_usd: 0.5,
    created_at: '2026-10-27T15:00:00.000Z', batch_id: null, agent_key: 'agent1', agent_step: null,
    country_code: 'CO', macro_industry_key: null, search_mode: null, triggered_by_role_key: null,
    triggered_by_group_id: null, log_flow: null, found: null,
    ...over,
  };
}

const PEOPLE = [
  { id: 'ana', roleKey: 'vendedor', groupId: 'g-mid', managerId: 'lia' },
  { id: 'beto', roleKey: 'vendedor', groupId: 'g-ent', managerId: null },
  { id: 'lia', roleKey: 'lider', groupId: 'g-mid', managerId: null },
];

function input(over: Partial<UsageMapInput> = {}): UsageMapInput {
  const batches = [
    { id: 'b1', created_by: 'ana', country_code: 'CO' },
    { id: 'b2', created_by: 'beto', country_code: 'MX' },
  ];
  return {
    logs: [
      log({ batch_id: 'b1' }),
      log({ batch_id: 'b1', agent_key: 'agent2a' }),
      log({ triggered_by: 'beto', country_code: 'MX', batch_id: 'b2', estimated_cost_usd: 1 }),
    ],
    outcomes: [
      { batchId: 'b1', countryCode: 'CO', approved: true },
      { batchId: 'b1', countryCode: 'CO', approved: false },
      { batchId: 'b2', countryCode: 'MX', approved: false },
    ],
    searches: batches,
    batchesById: new Map(batches.map((b) => [b.id, b])),
    people: PEOPLE,
    moneyVisible: true,
    ...over,
  };
}

function cell(m: UsageMapMatrix, metric: string, column: string): number | null {
  const row = m.rows.find((r) => r.metric.key === metric)!;
  return row.cells[m.columns.indexOf(column)].value;
}

describe('buildUsageMap — atribución', () => {
  const map = buildUsageMap(input());

  it('por persona: consultas, búsquedas, empresas y tasa', () => {
    const m = map.matrices.persona;
    assert.equal(cell(m, 'consultas', 'ana'), 2);
    assert.equal(cell(m, 'busquedas', 'ana'), 1);
    assert.equal(cell(m, 'revision', 'ana'), 2);
    assert.equal(cell(m, 'aprobadas', 'ana'), 1);
    assert.equal(cell(m, 'tasa', 'ana'), 0.5);
    assert.equal(cell(m, 'tasa', 'beto'), 0);
  });

  it('por agente: cada agente tiene su fila', () => {
    const m = map.matrices.persona;
    assert.equal(cell(m, 'agente:agent1', 'ana'), 1);
    assert.equal(cell(m, 'agente:agent2a', 'ana'), 1);
    assert.deepEqual(map.agentsInUse, ['agent1', 'agent2a']);
  });

  it('por líder: el jefe directo; sin jefe ⇒ «Sin líder»', () => {
    const m = map.matrices.lider;
    assert.equal(cell(m, 'consultas', 'lia'), 2);
    assert.equal(cell(m, 'consultas', NO_LEADER_KEY), 1);
  });

  it('por país y por grupo', () => {
    assert.equal(cell(map.matrices.pais, 'consultas', 'MX'), 1);
    assert.equal(cell(map.matrices.grupo, 'personas', 'g-mid'), 1);
    assert.equal(cell(map.matrices.rol, 'personas', 'vendedor'), 2);
  });

  it('el rol del momento de la consulta manda sobre el de hoy', () => {
    const m = buildUsageMap(input({ logs: [log({ triggered_by_role_key: 'growth' })] })).matrices.rol;
    assert.equal(cell(m, 'consultas', 'growth'), 1);
  });

  it('total y costo por aprobada', () => {
    const row = map.matrices.rol.rows.find((r) => r.metric.key === 'costo_aprobada')!;
    assert.equal(row.total, 2);
    assert.equal(map.matrices.rol.rows.find((r) => r.metric.key === 'consultas')!.total, 3);
  });

  it('sin dinero visible no hay filas de costo', () => {
    const m = buildUsageMap(input({ moneyVisible: false })).matrices.rol;
    assert.equal(m.rows.some((r) => r.metric.money), false);
  });

  it('columnas de más a menos uso', () => {
    assert.deepEqual(map.matrices.persona.columns, ['ana', 'beto']);
  });
});

describe('cuándo se usa — hora de Colombia', () => {
  it('15:00 UTC del martes 27-10 = martes 10:00 en Bogotá', () => {
    assert.deepEqual(zonedSlot('2026-10-27T15:00:00.000Z'), { weekday: 1, hour: 10, day: '2026-10-27' });
  });
  it('la matriz día × hora y la serie diaria cuentan las consultas', () => {
    const map = buildUsageMap(input());
    assert.equal(map.weekHours[1][10], 3);
    assert.deepEqual(map.daily, [{ day: '2026-10-27', byAgent: { agent1: 2, agent2a: 1 } }]);
  });
});

describe('usageMapTone — cada fila con su escala', () => {
  it('más es mejor: comparado con el mayor', () => {
    assert.equal(usageMapTone(10, [10, 5, 1], 'higher'), 'very-high');
    assert.equal(usageMapTone(5, [10, 5, 1], 'higher'), 'mid');
    assert.equal(usageMapTone(1, [10, 5, 1], 'higher'), 'very-low');
  });
  it('menos es mejor: el más barato es el «muy alto»', () => {
    assert.equal(usageMapTone(2, [2, 8], 'lower'), 'very-high');
    assert.equal(usageMapTone(8, [2, 8], 'lower'), 'low');
  });
  it('neutro: intensidad de marca, sin semáforo', () => {
    assert.equal(usageMapTone(10, [10, 1], 'neutral'), 'brand-4');
    assert.equal(usageMapTone(0, [10, 0], 'neutral'), 'none');
  });
  it('sin dato ⇒ none', () => {
    assert.equal(usageMapTone(null, [1, null], 'higher'), 'none');
  });
});
