// Verificación de permisos por rol del asistente de Slack: se ejecutan las
// consultas REALES de la fuente de datos contra un cliente de Supabase falso
// que anota cada filtro, y se comprueba que vendedor, líder y admin reciben
// exactamente el alcance de la plataforma.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAssistantDataSource } from '../data-source.server';
import { PersonFilterProblem } from '../query-helpers';

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

  it('🔴 pedir un responsable FUERA del equipo no amplía nada: no se consulta ninguna empresa y se dice «fuera de tu alcance»', async () => {
    const { client, calls } = fakeSupabase({ internal_users: [{ id: 'otro-equipo', full_name: 'Ana Ruiz', email: 'ana@x.co', manager_id: null }] });
    await assert.rejects(
      () => createAssistantDataSource(client, LEADER, OPTIONS).accounts({ responsable: 'Ana', periodo: 'todo' }, 10),
      (error: unknown) => error instanceof PersonFilterProblem && error.problema === 'fuera_de_alcance',
    );
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
  it('🔴 líder: el uso de su equipo; vendedor/Growth: no tienen Uso de IA (dueña 12-11)', async () => {
    const leader = fakeSupabase();
    await createAssistantDataSource(leader.client, LEADER, OPTIONS).aiUsage('mes');
    const leaderIn = leader.calls.find((c) => c.table === 'provider_usage_logs' && c.method === 'in');
    assert.deepEqual(leaderIn?.args, ['triggered_by', ['lead', 'v1', 'v2']]);

    const seller = fakeSupabase({ provider_usage_logs: [{ provider_key: 'apollo', status: 'success', estimated_cost_usd: 0.5, credits_used: 2, triggered_by: 'me' }] });
    const source = createAssistantDataSource(seller.client, SELLER, { ...OPTIONS, moneyVisible: false });
    assert.equal(source.usageVisible, false);
    await assert.rejects(() => source.aiUsage('mes'));
    assert.equal(seller.calls.some((c) => c.table === 'provider_usage_logs'), false);
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

// ── Feedback 11-11: «mío» vs «mi equipo», nombres parciales y ficha más amplia ──
import { cascadeIds, matchPeople } from '../query-helpers';
import { createAssistantActionResolver } from '../action-resolver.server';

const PEOPLE = [
  { id: 'elkin', full_name: 'Elkin Alexis García Salazar', email: 'egarcia@ubits.co', manager_id: null },
  { id: 'carla', full_name: 'Carla Pía Rojas', email: 'carla.rojas@ubits.co', manager_id: 'elkin' },
  { id: 'luis', full_name: 'Luis Mejía', email: 'luis.mejia@ubits.co', manager_id: 'carla' },
  { id: 'juan', full_name: 'Juan Rey', email: 'juan.rey@ubits.co', manager_id: 'elkin' },
];

describe('nombres de personas — como los escribe la gente', () => {
  it('«elkin garcia» encuentra a «Elkin Alexis García Salazar» (sin tildes, con nombre intermedio)', () => {
    assert.deepEqual(matchPeople(PEOPLE, 'elkin garcia').map((p) => p.id), ['elkin']);
    assert.deepEqual(matchPeople(PEOPLE, 'GARCÍA').map((p) => p.id), ['elkin']);
    assert.deepEqual(matchPeople(PEOPLE, 'egarcia@ubits.co').map((p) => p.id), ['elkin']);
    assert.deepEqual(matchPeople(PEOPLE, 'luis mejia').map((p) => p.id), ['luis']);
  });

  it('un nombre que no existe no coincide con nadie; uno ambiguo devuelve varios', () => {
    assert.deepEqual(matchPeople(PEOPLE, 'pedro'), []);
    assert.equal(matchPeople(PEOPLE, 'ubits').length, 4);
  });

  it('cascada: la persona y toda su gente a cargo', () => {
    assert.deepEqual(cascadeIds('carla', PEOPLE).sort(), ['carla', 'luis']);
    assert.deepEqual(cascadeIds('elkin', PEOPLE).sort(), ['carla', 'elkin', 'juan', 'luis']);
  });

  it('recordatorio/asignar: «elkin garcia» resuelve a una sola persona', async () => {
    const { client } = fakeSupabase({ internal_users: PEOPLE });
    const found = await createAssistantActionResolver(client, ADMIN).resolveActiveUser('elkin garcia');
    assert.equal(found.user?.id, 'elkin');
  });
});

describe('de quién: mío, mi equipo, de otra persona o todo', () => {
  const asAdmin = { ...OPTIONS, askerId: 'elkin' };

  it('admin «mi resumen» (de=mio): sólo lo suyo, no toda la plataforma', async () => {
    const { client, calls } = fakeSupabase({ internal_users: PEOPLE });
    const summary = await createAssistantDataSource(client, ADMIN, asAdmin).summary({ de: 'mio' });
    assert.equal(summary.alcance, 'sólo lo tuyo');
    assert.deepEqual(ors(calls, 'accounts'), [{ clause: 'owner_id.in.(elkin),created_by.in.(elkin)', options: undefined }]);
  });

  it('admin sin decir de quién: toda la plataforma (sin filtro)', async () => {
    const { client, calls } = fakeSupabase({ internal_users: PEOPLE });
    const summary = await createAssistantDataSource(client, ADMIN, asAdmin).summary({});
    assert.equal(summary.alcance, 'toda la plataforma');
    assert.deepEqual(ors(calls, 'accounts'), []);
  });

  it('«mi equipo»: quien pregunta y su gente en cascada', async () => {
    const { client, calls } = fakeSupabase({ internal_users: PEOPLE });
    await createAssistantDataSource(client, ADMIN, { ...OPTIONS, askerId: 'carla' }).accounts({ de: 'mi_equipo', periodo: 'todo' }, 10);
    assert.match(ors(calls, 'accounts')[0].clause, /^owner_id\.in\.\((carla,luis|luis,carla)\)/);
  });

  it('«el equipo de Carla» (responsable + equipo)', async () => {
    const { client, calls } = fakeSupabase({ internal_users: PEOPLE });
    await createAssistantDataSource(client, ADMIN, asAdmin).accounts({ responsable: 'carla', equipo: true, periodo: 'todo' }, 10);
    assert.match(ors(calls, 'accounts')[0].clause, /^owner_id\.in\.\((carla,luis|luis,carla)\)/);
  });

  it('🔴 vendedor pidiendo «mi equipo» o a otra persona: nunca sale de lo suyo', async () => {
    const team = fakeSupabase({ internal_users: PEOPLE });
    await createAssistantDataSource(team.client, SELLER, { ...OPTIONS, askerId: 'me' }).accounts({ de: 'mi_equipo', periodo: 'todo' }, 10);
    assert.deepEqual(ors(team.calls, 'accounts'), [{ clause: 'owner_id.in.(me),created_by.in.(me)', options: undefined }]);
    const other = fakeSupabase({ internal_users: PEOPLE });
    await assert.rejects(
      () => createAssistantDataSource(other.client, SELLER, { ...OPTIONS, askerId: 'me' }).accounts({ responsable: 'carla', periodo: 'todo' }, 10),
      (error: unknown) => error instanceof PersonFilterProblem && error.problema === 'fuera_de_alcance',
    );
    assert.equal(other.calls.some((c) => c.table === 'accounts'), false);
  });
});

describe('ficha: también por revisar y por contacto (sólo SellUp)', () => {
  it('si no está en Empresas, busca en prospectos y contactos', async () => {
    const { client, calls } = fakeSupabase({
      prospect_candidates: [{ name: 'Copec', status: 'pending_review', created_at: '2026-11-10T00:00:00Z', batch: { name: 'Chile energía', owner_id: 'me' } }],
    });
    const detail = await createAssistantDataSource(client, ADMIN, OPTIONS).accountDetail('Copec');
    assert.equal(detail.encontrada, false);
    assert.equal(detail.enProspectos?.[0]?.nombre, 'Copec');
    assert.ok(calls.some((c) => c.table === 'contacts'));
  });
});
