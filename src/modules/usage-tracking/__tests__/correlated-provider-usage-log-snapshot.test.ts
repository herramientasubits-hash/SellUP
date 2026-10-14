// Motor correlacionado de provider_usage_logs (Apollo / Lusha) — snapshot de
// rol y grupo de quien consumió.
//
// La fila salía siempre con triggered_by_role_key y triggered_by_group_id en
// NULL (790 filas en Producción sin rol), así que los filtros de Rol y Grupo y
// las reglas de presupuesto por grupo no las veían. El logger genérico
// (logging.ts) ya resolvía ese snapshot; el motor ahora reutiliza su mismo
// helper. Inyectable: estas pruebas no usan red ni base de datos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  insertCorrelatedProviderUsageRow,
  type ProviderUsageInsertClient,
} from '../correlated-provider-usage-log';
import { resolveProviderUsageUserSnapshot } from '../logging';

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider_key: 'apollo',
    operation_key: 'organizations_search',
    estimated_cost_usd: 0.1,
    triggered_by: 'u1',
    triggered_by_role_key: null,
    triggered_by_group_id: null,
    metadata: {},
    ...overrides,
  };
}

function insertOnlyClient(errors: Array<{ message: string; code?: string } | null> = []) {
  const inserts: Record<string, unknown>[] = [];
  const client: ProviderUsageInsertClient = {
    from() {
      return {
        async insert(row) {
          inserts.push(row);
          return { error: errors[inserts.length - 1] ?? null };
        },
      };
    },
  };
  return { client, inserts };
}

const args = (row: Record<string, unknown>, correlationColumns: Record<string, unknown> = {}) => ({
  baseRow: row,
  correlationColumns,
  providerKey: 'apollo',
  operationKey: 'organizations_search',
});

describe('insertCorrelatedProviderUsageRow — snapshot de rol y grupo', () => {
  it('escribe el rol y el grupo de quien consumió', async () => {
    const { client, inserts } = insertOnlyClient();
    const out = await insertCorrelatedProviderUsageRow(args(baseRow()), {
      client,
      resolveUserSnapshot: async (id) => {
        assert.equal(id, 'u1');
        return { roleKey: 'seller', groupId: 'g1' };
      },
    });
    assert.equal(out.kind, 'logged');
    assert.equal(inserts[0].triggered_by_role_key, 'seller');
    assert.equal(inserts[0].triggered_by_group_id, 'g1');
  });

  it('sin triggered_by no consulta nada y deja el snapshot en NULL', async () => {
    const { client, inserts } = insertOnlyClient();
    let called = false;
    await insertCorrelatedProviderUsageRow(args(baseRow({ triggered_by: null })), {
      client,
      resolveUserSnapshot: async () => {
        called = true;
        return { roleKey: 'x', groupId: 'y' };
      },
    });
    assert.equal(called, false);
    assert.equal(inserts[0].triggered_by_role_key, null);
    assert.equal(inserts[0].triggered_by_group_id, null);
  });

  it('si el snapshot falla, la fila se escribe igual (el gasto nunca se pierde)', async () => {
    const { client, inserts } = insertOnlyClient();
    const out = await insertCorrelatedProviderUsageRow(args(baseRow()), {
      client,
      resolveUserSnapshot: async () => {
        throw new Error('lookup caído');
      },
    });
    assert.equal(out.kind, 'logged');
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].triggered_by_role_key, null);
  });

  it('el reintento sin columnas de correlación conserva el snapshot', async () => {
    const { client, inserts } = insertOnlyClient([
      { code: '42703', message: 'column "reservation_id" does not exist' },
      null,
    ]);
    const out = await insertCorrelatedProviderUsageRow(
      args(baseRow(), { reservation_id: 'res-1' }),
      {
        client,
        warn: () => {},
        resolveUserSnapshot: async () => ({ roleKey: 'seller', groupId: 'g1' }),
      },
    );
    assert.equal(out.kind, 'logged');
    assert.equal(inserts.length, 2);
    assert.equal(inserts[1].triggered_by_role_key, 'seller');
    assert.equal(inserts[1].triggered_by_group_id, 'g1');
    assert.equal('reservation_id' in inserts[1], false);
  });

  it('por defecto reutiliza el helper de logging.ts con el mismo cliente', async () => {
    const inserts: Record<string, unknown>[] = [];
    const tables: Record<string, Record<string, unknown>> = {
      internal_users: { role_id: 'role-1', group_id: 'g9' },
      roles: { key: 'leader' },
    };
    const client = {
      from(table: string) {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: tables[table] ?? null, error: null }) }),
          }),
          async insert(row: Record<string, unknown>) {
            inserts.push(row);
            return { error: null };
          },
        };
      },
    };
    await insertCorrelatedProviderUsageRow(args(baseRow()), { client });
    assert.equal(inserts[0].triggered_by_role_key, 'leader');
    assert.equal(inserts[0].triggered_by_group_id, 'g9');
  });

  it('un cliente que sólo inserta (pruebas viejas) deja el snapshot en NULL sin fallar', async () => {
    const { client, inserts } = insertOnlyClient();
    const out = await insertCorrelatedProviderUsageRow(args(baseRow()), { client });
    assert.equal(out.kind, 'logged');
    assert.equal(inserts[0].triggered_by_role_key, null);
  });
});

describe('resolveProviderUsageUserSnapshot (logging.ts)', () => {
  it('usuario sin rol devuelve sólo el grupo', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { role_id: null, group_id: 'g1' }, error: null }) }),
        }),
      }),
    };
    assert.deepEqual(await resolveProviderUsageUserSnapshot(client, 'u1'), {
      roleKey: null,
      groupId: 'g1',
    });
  });

  it('sin usuario o con error devuelve nulls y nunca lanza', async () => {
    assert.deepEqual(await resolveProviderUsageUserSnapshot(null, 'u1'), { roleKey: null, groupId: null });
    assert.deepEqual(await resolveProviderUsageUserSnapshot({ from: () => { throw new Error('x'); } }, 'u1'), {
      roleKey: null,
      groupId: null,
    });
  });
});
