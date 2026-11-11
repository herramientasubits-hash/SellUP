// Verificación de permisos por rol del asistente de Slack: se ejecutan las
// consultas REALES de la fuente de datos contra un cliente de Supabase falso
// que anota cada filtro, y se comprueba que vendedor, líder y admin reciben
// exactamente el alcance de la plataforma.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAssistantDataSource } from '../data-source.server';

type Call = { table: string; method: string; args: unknown[] };

function fakeSupabase(responses: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
      for (const m of ['select', 'eq', 'in', 'is', 'or', 'ilike', 'gte', 'order', 'limit', 'range', 'maybeSingle']) {
        builder[m] = chain(m);
      }
      builder.then = (resolve: (v: unknown) => unknown) => {
        const isSingle = calls.some((c) => c.table === table && c.method === 'maybeSingle');
        const data = responses[table] ?? [];
        return Promise.resolve(resolve({ data: isSingle ? data[0] ?? null : data, count: data.length, error: null }));
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const SELLER = { canViewAll: false, allowedUserIds: ['me'], isRestrictedToSelf: true };
const LEADER = { canViewAll: false, allowedUserIds: ['lead', 'v1', 'v2'], isRestrictedToSelf: false };
const ADMIN = { canViewAll: true, allowedUserIds: [], isRestrictedToSelf: false };
const OPTIONS = { appUrl: 'https://app.example', moneyVisible: true, now: new Date('2026-11-11T20:00:00Z') };

const ors = (calls: Call[], table: string) =>
  calls.filter((c) => c.table === table && c.method === 'or').map((c) => ({ clause: String(c.args[0]), options: c.args[1] }));

describe('permisos por rol — empresas', () => {
  it('🔴 vendedor: sólo empresas de las que es responsable o que creó', async () => {
    const { client, calls } = fakeSupabase();
    await createAssistantDataSource(client, SELLER, OPTIONS).accounts({ periodo: 'todo' }, 10);
    assert.deepEqual(ors(calls, 'accounts'), [{ clause: 'owner_id.in.(me),created_by.in.(me)', options: undefined }]);
  });

  it('🔴 líder: las de todo su equipo (en cascada), con el texto en el MISMO filtro', async () => {
    const { client, calls } = fakeSupabase();
    await createAssistantDataSource(client, LEADER, OPTIONS).accounts({ texto: 'Copec', periodo: 'todo' }, 10);
    const [{ clause }] = ors(calls, 'accounts');
    assert.match(clause, /^and\(or\(owner_id\.in\.\(lead,v1,v2\),created_by\.in\.\(lead,v1,v2\)\),or\(name\.ilike\.%Copec%/);
  });

  it('admin: sin filtro de alcance', async () => {
    const { client, calls } = fakeSupabase();
    await createAssistantDataSource(client, ADMIN, OPTIONS).accounts({ periodo: 'todo' }, 10);
    assert.deepEqual(ors(calls, 'accounts'), []);
    assert.equal(calls.some((c) => c.table === 'accounts' && c.method === 'in'), false);
  });

  it('🔴 pedir un responsable FUERA del equipo no amplía nada: no se consulta ninguna empresa', async () => {
    const { client, calls } = fakeSupabase({ internal_users: [{ id: 'otro-equipo' }] });
    const result = await createAssistantDataSource(client, LEADER, OPTIONS).accounts({ responsable: 'Ana', periodo: 'todo' }, 10);
    assert.equal(result.total, 0);
    assert.equal(calls.some((c) => c.table === 'accounts'), false);
  });

  it('🔴 ficha de una empresa: también con el alcance del vendedor', async () => {
    const { client, calls } = fakeSupabase();
    const detail = await createAssistantDataSource(client, SELLER, OPTIONS).accountDetail('Copec');
    assert.equal(detail.encontrada, false);
    assert.match(ors(calls, 'accounts')[0].clause, /^and\(or\(owner_id\.in\.\(me\),created_by\.in\.\(me\)\),or\(name\.ilike/);
  });
});

describe('permisos por rol — contactos', () => {
  it('🔴 vendedor: sólo contactos de empresas de su alcance (filtro en la empresa embebida)', async () => {
    const { client, calls } = fakeSupabase();
    await createAssistantDataSource(client, SELLER, OPTIONS).contacts({ cargo: 'talento' }, 10);
    const contactOrs = ors(calls, 'contacts');
    assert.deepEqual(
      contactOrs.find((o) => (o.options as { referencedTable?: string } | undefined)?.referencedTable === 'account'),
      { clause: 'owner_id.in.(me),created_by.in.(me)', options: { referencedTable: 'account' } },
    );
    assert.ok(contactOrs.some((o) => o.clause.startsWith('job_title.ilike.%talento%')));
  });
});

describe('permisos por rol — prospectos', () => {
  it('🔴 vendedor: sus búsquedas y lo que tiene asignado (regla de «Por revisar»)', async () => {
    const { client, calls } = fakeSupabase({ prospect_batches: [{ id: 'b1' }] });
    await createAssistantDataSource(client, SELLER, OPTIONS).prospects({ estado: 'por_revisar', periodo: 'todo' }, 10);
    assert.deepEqual(ors(calls, 'prospect_batches'), [{ clause: 'owner_id.in.(me),created_by.in.(me)', options: undefined }]);
    assert.deepEqual(ors(calls, 'prospect_candidates'), [
      { clause: 'assigned_to.in.(me),and(assigned_to.is.null,batch_id.in.(b1))', options: undefined },
    ]);
    const statuses = calls.find((c) => c.table === 'prospect_candidates' && c.method === 'in');
    assert.deepEqual(statuses?.args, ['status', ['needs_review', 'generated', 'normalized']]);
  });

  it('descartados: el estado cambia, el alcance no', async () => {
    const { client, calls } = fakeSupabase({ prospect_batches: [{ id: 'b1' }] });
    const result = await createAssistantDataSource(client, SELLER, OPTIONS).prospects({ estado: 'descartados', periodo: 'todo' }, 10);
    const statuses = calls.find((c) => c.table === 'prospect_candidates' && c.method === 'in');
    assert.deepEqual(statuses?.args, ['status', ['discarded']]);
    assert.match(result.enlace, /view=descartadas/);
  });
});

describe('permisos por rol — uso de IA', () => {
  it('🔴 líder: el uso de su equipo; vendedor: el suyo y SIN dólares', async () => {
    const leader = fakeSupabase();
    await createAssistantDataSource(leader.client, LEADER, OPTIONS).aiUsage('mes');
    const leaderIn = leader.calls.find((c) => c.table === 'provider_usage_logs' && c.method === 'in');
    assert.deepEqual(leaderIn?.args, ['triggered_by', ['lead', 'v1', 'v2']]);

    const seller = fakeSupabase({ provider_usage_logs: [{ provider_key: 'apollo', status: 'success', estimated_cost_usd: 0.5, credits_used: 2, triggered_by: 'me' }] });
    const usage = await createAssistantDataSource(seller.client, SELLER, { ...OPTIONS, moneyVisible: false }).aiUsage('mes');
    assert.equal(usage.costoUsd, null);
    assert.equal(usage.porProveedor[0].costoUsd, null);
    assert.equal(usage.creditos, 2);
    assert.deepEqual(usage.porPersona, []);
  });

  it('admin: todo, con dólares', async () => {
    const { client, calls } = fakeSupabase({ provider_usage_logs: [{ provider_key: 'anthropic', status: 'success', estimated_cost_usd: 1.234, credits_used: 0, triggered_by: 'u1' }] });
    const usage = await createAssistantDataSource(client, ADMIN, OPTIONS).aiUsage('mes');
    assert.equal(calls.some((c) => c.table === 'provider_usage_logs' && c.method === 'in'), false);
    assert.equal(usage.costoUsd, 1.23);
    assert.equal(usage.alcance, 'toda la plataforma');
  });
});

describe('permisos por rol — resumen', () => {
  it('🔴 vendedor: cada total del resumen va con su alcance', async () => {
    const { client, calls } = fakeSupabase();
    await createAssistantDataSource(client, SELLER, OPTIONS).summary();
    assert.deepEqual(ors(calls, 'accounts'), [{ clause: 'owner_id.in.(me),created_by.in.(me)', options: undefined }]);
    assert.ok(ors(calls, 'prospect_batches').every((o) => o.clause === 'owner_id.in.(me),created_by.in.(me)'));
    assert.deepEqual(
      ors(calls, 'contacts').find((o) => (o.options as { referencedTable?: string } | undefined)?.referencedTable === 'accounts')?.clause,
      'owner_id.in.(me),created_by.in.(me)',
    );
  });
});
