/**
 * Verificación de la migración 142 (el BANCO de empresas) contra un PostgreSQL REAL
 * y efímero (Agente 1 · AGENT1-COMPANY-BANK-FOUNDATION-1).
 *
 * Lo que el banco promete no vive en TypeScript: vive en índices únicos PARCIALES
 * (la misma empresa no puede estar dos veces entre las filas activas), en un grafo de
 * estados que un disparador hace cumplir, en `FOR UPDATE SKIP LOCKED` (dos vendedores
 * a la vez no reciben la misma fila) y en los GRANT (sólo `service_role`). Nada de eso
 * se comprueba leyendo SQL: hay que ejecutarlo.
 *
 *   § 1 · la 142 APLICA sobre la cadena real + la 140, y reaplicarla no cambia nada;
 *   § 2 · seguridad: sólo `service_role` (tabla y funciones);
 *   § 3 · depositar: cuenta, salta lo que ya es de alguien / ya está / es inválido;
 *   § 4 · sacar: orden, límite, reserva, recuperación y carrera entre dos vendedores;
 *   § 5 · caducidad perezosa;
 *   § 6 · cerrar la extracción: assigned / invalidated / released y el grafo de estados;
 *   § 7 · una clave de una fila ya final queda libre;
 *   § 8 · el almacén de TypeScript habla con las funciones REALES (nombres de
 *         parámetros, forma del jsonb, filas devueltas).
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción. En local se SALTA con motivo
 * explícito si falta el arnés (`npm install --no-save embedded-postgres@17.6.0-beta.15`).
 * No llama a ningún proveedor, no lee un flag, no toca Producción: 0 créditos.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  applyCut3b4RealChain,
  bootstrapPlatform,
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../__tests__/support/cut3b4-real-migration-chain';

import { createCompanyBankStore } from '../company-bank-store';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → company-bank → prospect-batches → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..');

const MIGRATION_140 = '140_agent1_global_company_identity_claims.sql';
const MIGRATION_142 = '142_agent1_company_bank.sql';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let admin: PgLikeClient;
let seq = 0;

type DepositItem = {
  countryCode?: string;
  macroIndustryKey?: string;
  tier?: string;
  sourceProvider?: string;
  claims?: Array<{ type: string; key: string }>;
  payload?: unknown;
  missingFields?: string[];
  sourceBatchId?: string;
  ttlDays?: number;
};

function item(domain: string, overrides: DepositItem = {}): DepositItem {
  return {
    countryCode: 'CO',
    macroIndustryKey: 'technology',
    tier: 'ready',
    sourceProvider: 'lusha',
    claims: [{ type: 'domain', key: domain }],
    payload: { name: `Empresa ${domain}`, domain },
    missingFields: [],
    ...overrides,
  };
}

async function deposit(items: DepositItem[]): Promise<Record<string, unknown>> {
  const { rows } = await admin.query(`SELECT public.agent1_bank_deposit($1::jsonb) AS out`, [
    JSON.stringify(items),
  ]);
  return rows[0].out as Record<string, unknown>;
}

type DrawnRow = { id: string; tier: string; claims: Array<{ type: string; key: string }> };

async function draw(
  client: PgLikeClient,
  drawId: string,
  limit: number,
  opts: { country?: string; macro?: string; tiers?: string[]; reserveSeconds?: number } = {},
): Promise<DrawnRow[]> {
  const { rows } = await client.query(
    `SELECT id, tier, claims FROM public.agent1_bank_draw($1, $2, $3, $4::uuid, $5, $6::text[])`,
    [
      opts.country ?? 'CO',
      opts.macro ?? 'technology',
      limit,
      drawId,
      opts.reserveSeconds ?? 300,
      opts.tiers ?? ['ready'],
    ],
  );
  return rows as unknown as DrawnRow[];
}

async function settle(drawId: string, outcomes: unknown[]): Promise<Record<string, unknown>> {
  const { rows } = await admin.query(`SELECT public.agent1_bank_settle($1::uuid, $2::jsonb) AS out`, [
    drawId,
    JSON.stringify(outcomes),
  ]);
  return rows[0].out as Record<string, unknown>;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await admin.query(`SELECT status FROM public.agent1_company_bank WHERE id = $1`, [id]);
  return String(rows[0].status);
}

async function idByDomain(domain: string): Promise<string> {
  const { rows } = await admin.query(
    `SELECT id FROM public.agent1_company_bank WHERE claim_domain = $1 ORDER BY banked_at DESC LIMIT 1`,
    [domain],
  );
  return String(rows[0].id);
}

async function newBatch(): Promise<string> {
  seq += 1;
  const { rows } = await admin.query(`INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id`, [
    `lote-142-${seq}`,
  ]);
  return String(rows[0].id);
}

async function newCandidate(batchId: string): Promise<string> {
  seq += 1;
  const { rows } = await admin.query(
    `INSERT INTO public.prospect_candidates (batch_id, name, status) VALUES ($1, $2, 'needs_review') RETURNING id`,
    [batchId, `Empresa ${seq}`],
  );
  return String(rows[0].id);
}

async function wipeBank(): Promise<void> {
  await admin.query(`DELETE FROM public.agent1_company_bank`);
}

// ─── Adaptador de § 8 ───────────────────────────────────────────────────────────

/**
 * Un `rpc()` de PostgREST sobre el PostgreSQL real: una función escalar devuelve el
 * valor; una función de tabla, un array de filas; un error, `{code, message}`.
 */
function pgRpcClient(): SupabaseClient {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      try {
        if (fn === 'agent1_bank_deposit') {
          const { rows } = await admin.query(`SELECT public.agent1_bank_deposit(p_items => $1::jsonb) AS out`, [
            JSON.stringify(args.p_items),
          ]);
          return { data: rows[0]!.out, error: null };
        }
        if (fn === 'agent1_bank_draw') {
          const { rows } = await admin.query(
            `SELECT * FROM public.agent1_bank_draw(
               p_country_code => $1, p_macro_industry_key => $2, p_limit => $3,
               p_draw_id => $4::uuid, p_reserve_seconds => $5, p_tiers => $6::text[])`,
            [args.p_country_code, args.p_macro_industry_key, args.p_limit, args.p_draw_id, args.p_reserve_seconds, args.p_tiers],
          );
          return { data: rows, error: null };
        }
        if (fn === 'agent1_bank_settle') {
          const { rows } = await admin.query(
            `SELECT public.agent1_bank_settle(p_draw_id => $1::uuid, p_outcomes => $2::jsonb) AS out`,
            [args.p_draw_id, JSON.stringify(args.p_outcomes)],
          );
          return { data: rows[0]!.out, error: null };
        }
        return { data: null, error: { code: '42883', message: `function ${fn} does not exist` } };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
  } as unknown as SupabaseClient;
}

describe('Migración 142 (banco de empresas) contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m142-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54441,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    admin = postgres.getPgClient();
    await admin.connect();
    await bootstrapPlatform(admin);
    await applyCut3b4RealChain(admin, repoRoot);
    await admin.query(readMigration(repoRoot, MIGRATION_140));
    await admin.query(readMigration(repoRoot, MIGRATION_142));
  });

  after(async () => {
    try {
      await admin?.end();
    } catch {
      /* ya cerrado */
    }
    try {
      await postgres?.stop();
    } catch {
      /* ya parado */
    }
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  // ─── § 1 ────────────────────────────────────────────────────────────────────

  it('§ 1 — reaplicar la 142 no falla ni cambia una fila', async () => {
    await wipeBank();
    await deposit([item('reaplicar.com.co')]);
    const before = await admin.query(`SELECT count(*)::int AS n FROM public.agent1_company_bank`);
    await admin.query(readMigration(repoRoot, MIGRATION_142));
    const after = await admin.query(`SELECT count(*)::int AS n FROM public.agent1_company_bank`);
    assert.equal(after.rows[0].n, before.rows[0].n);
  });

  // ─── § 2 ────────────────────────────────────────────────────────────────────

  it('§ 2 — sólo service_role: ni anon ni authenticated leen, escriben ni ejecutan', async () => {
    const privilege = async (sql: string): Promise<boolean> => {
      const { rows } = await admin.query(sql);
      return rows[0].ok === true;
    };
    for (const role of ['anon', 'authenticated']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        assert.equal(
          await privilege(`SELECT has_table_privilege('${role}', 'public.agent1_company_bank', '${p}') AS ok`),
          false,
          `${role} tiene ${p}`,
        );
      }
      for (const fn of [
        'public.agent1_bank_deposit(jsonb)',
        'public.agent1_bank_draw(text, text, int, uuid, int, text[])',
        'public.agent1_bank_settle(uuid, jsonb)',
      ]) {
        assert.equal(
          await privilege(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS ok`),
          false,
          `${role} ejecuta ${fn}`,
        );
      }
    }
    assert.equal(
      await privilege(`SELECT has_table_privilege('service_role', 'public.agent1_company_bank', 'INSERT') AS ok`),
      true,
    );
    assert.equal(
      await privilege(
        `SELECT has_function_privilege('service_role', 'public.agent1_bank_deposit(jsonb)', 'EXECUTE') AS ok`,
      ),
      true,
    );
  });

  it('§ 2 — service_role SÍ puede depositar y sacar de verdad (con su rol, no como superusuario)', async () => {
    await wipeBank();
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE service_role');
      const dep = await admin.query(`SELECT public.agent1_bank_deposit($1::jsonb) AS out`, [
        JSON.stringify([item('servicio.com.co')]),
      ]);
      assert.equal((dep.rows[0].out as { deposited: number }).deposited, 1);
      const drawn = await admin.query(
        `SELECT id FROM public.agent1_bank_draw('CO', 'technology', 1, $1::uuid, 300, ARRAY['ready'])`,
        [randomUUID()],
      );
      assert.equal(drawn.rows.length, 1);
      await admin.query('COMMIT');
    } catch (e) {
      await admin.query('ROLLBACK');
      throw e;
    }
  });

  it('§ 2 — un vendedor autenticado NO puede ejecutar nada del banco', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE authenticated');
      await assert.rejects(
        admin.query(`SELECT public.agent1_bank_deposit('[]'::jsonb)`),
        (e: { code?: string }) => e.code === '42501',
      );
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  // ─── § 3 ────────────────────────────────────────────────────────────────────

  it('§ 3 — deposita y cuenta; el mismo dominio otra vez ⇒ skipped_in_bank', async () => {
    await wipeBank();
    const first = await deposit([item('a.com.co'), item('b.com.co')]);
    assert.equal(first.deposited, 2);
    const again = await deposit([item('a.com.co'), item('c.com.co')]);
    assert.equal(again.deposited, 1);
    assert.equal(again.skipped_in_bank, 1);
  });

  it('§ 3 — 🔴 una empresa con reclamo global ACTIVO no entra; liberado, sí', async () => {
    await wipeBank();
    const batch = await newBatch();
    const candidate = await newCandidate(batch);
    await admin.query(
      `INSERT INTO public.agent1_company_identity_claims (claim_type, claim_key, candidate_id, batch_id)
       VALUES ('domain', 'reclamada.com.co', $1, $2)`,
      [candidate, batch],
    );
    const blocked = await deposit([item('reclamada.com.co')]);
    assert.equal(blocked.deposited, 0);
    assert.equal(blocked.skipped_claimed, 1);

    // El descarte libera el reclamo (disparador de la 140) y la empresa vuelve a poder entrar.
    await admin.query(`UPDATE public.prospect_candidates SET status = 'discarded' WHERE id = $1`, [candidate]);
    const freed = await deposit([item('reclamada.com.co')]);
    assert.equal(freed.deposited, 1);
  });

  it('§ 3 — 🔴 las cuatro señales se comprueban contra los reclamos (no sólo el dominio)', async () => {
    await wipeBank();
    const batch = await newBatch();
    const candidate = await newCandidate(batch);
    await admin.query(
      `INSERT INTO public.agent1_company_identity_claims (claim_type, claim_key, candidate_id, batch_id)
       VALUES ('fiscal', 'CO:NIT:900123456', $1, $2), ('linkedin', 'acme-sa', $1, $2),
              ('provider_entity', 'apollo:abc123', $1, $2)`,
      [candidate, batch],
    );
    const out = await deposit([
      item('otro1.com', { claims: [{ type: 'fiscal', key: 'CO:NIT:900123456' }] }),
      item('otro2.com', { claims: [{ type: 'domain', key: 'otro2.com' }, { type: 'linkedin', key: 'acme-sa' }] }),
      item('otro3.com', { claims: [{ type: 'provider_entity', key: 'apollo:abc123' }] }),
      item('libre.com'),
    ]);
    assert.equal(out.skipped_claimed, 3);
    assert.equal(out.deposited, 1);
  });

  it('§ 3 — lo inválido se cuenta y NO tumba a los demás', async () => {
    await wipeBank();
    const out = await deposit([
      item('buena.com.co'),
      item('mal-pais.com', { countryCode: 'Colombia' }),
      item('mal-macro.com', { macroIndustryKey: 'Technology Raro' }),
      item('mal-tier.com', { tier: 'ready', missingFields: ['employee_count'] }),
      item('mal-tier2.com', { tier: 'to_complete', missingFields: [] }),
      item('mal-fuente.com', { sourceProvider: 'otra' }),
      item('mal-payload.com', { payload: ['no', 'objeto'] }),
      item('sin-claims.com', { claims: [] }),
      item('payload-enorme.com', { payload: { x: 'a'.repeat(20000) } }),
    ]);
    assert.equal(out.deposited, 1);
    assert.equal(out.skipped_invalid, 8);
  });

  it('§ 3 — la caducidad se acota entre 1 y 180 días', async () => {
    await wipeBank();
    await deposit([
      item('ttl-0.com', { ttlDays: 0 }),
      item('ttl-999.com', { ttlDays: 999 }),
      item('ttl-default.com'),
    ]);
    const { rows } = await admin.query(
      `SELECT claim_domain,
              round(extract(epoch FROM (expires_at - banked_at)) / 86400)::int AS days
         FROM public.agent1_company_bank ORDER BY claim_domain`,
    );
    const days = Object.fromEntries(rows.map((r) => [String(r.claim_domain), Number(r.days)]));
    assert.equal(days['ttl-0.com'], 1);
    assert.equal(days['ttl-999.com'], 180);
    assert.equal(days['ttl-default.com'], 60);
  });

  // ─── § 4 ────────────────────────────────────────────────────────────────────

  it('§ 4 — saca primero las listas y las más antiguas, respeta el límite y la macro/país', async () => {
    await wipeBank();
    await admin.query(`
      INSERT INTO public.agent1_company_bank
        (country_code, macro_industry_key, tier, source_provider, claim_domain, payload, missing_fields, banked_at, expires_at)
      VALUES
        ('CO','technology','to_complete','lusha','pc-vieja.com','{}','{size}', now()-interval '5 days', now()+interval '50 days'),
        ('CO','technology','ready','lusha','lista-nueva.com','{}','{}', now()-interval '1 day',  now()+interval '50 days'),
        ('CO','technology','ready','lusha','lista-vieja.com','{}','{}', now()-interval '4 days', now()+interval '50 days'),
        ('CO','health_pharma','ready','lusha','otra-macro.com','{}','{}', now()-interval '9 days', now()+interval '50 days'),
        ('PE','technology','ready','lusha','otro-pais.com','{}','{}', now()-interval '9 days', now()+interval '50 days')`);
    const drawn = await draw(admin, randomUUID(), 5);
    assert.deepEqual(
      drawn.map((r) => r.claims[0]!.key),
      ['lista-vieja.com', 'lista-nueva.com'],
      'por defecto sólo `ready`, la más antigua primero, sin otra macro ni otro país',
    );
    const withIncomplete = await draw(admin, randomUUID(), 5, { tiers: ['ready', 'to_complete'] });
    assert.deepEqual(withIncomplete.map((r) => r.claims[0]!.key), ['pc-vieja.com']);
  });

  it('§ 4 — 🔴 con límite menor que lo disponible se llevan LAS MÁS ANTIGUAS (se usan antes de caducar)', async () => {
    await wipeBank();
    await admin.query(`
      INSERT INTO public.agent1_company_bank
        (country_code, macro_industry_key, tier, source_provider, claim_domain, payload, missing_fields, banked_at, expires_at)
      VALUES
        ('CO','technology','ready','lusha','nueva.com','{}','{}', now()-interval '1 day',  now()+interval '59 days'),
        ('CO','technology','ready','lusha','media.com','{}','{}', now()-interval '10 days', now()+interval '50 days'),
        ('CO','technology','ready','lusha','antigua.com','{}','{}', now()-interval '30 days', now()+interval '30 days')`);
    const one = await draw(admin, randomUUID(), 1);
    assert.deepEqual(one.map((r) => r.claims[0]!.key), ['antigua.com']);
    const two = await draw(admin, randomUUID(), 1);
    assert.deepEqual(two.map((r) => r.claims[0]!.key), ['media.com']);
  });

  it('§ 4 — 🔴 sacar RESERVA: lo reservado no se vuelve a entregar', async () => {
    await wipeBank();
    await deposit([item('x1.com'), item('x2.com'), item('x3.com')]);
    const one = await draw(admin, randomUUID(), 2);
    assert.equal(one.length, 2);
    const two = await draw(admin, randomUUID(), 5);
    assert.equal(two.length, 1);
    assert.ok(!one.some((a) => two.some((b) => b.id === a.id)));
  });

  it('§ 4 — 🔴 una reserva vencida (el proceso murió) vuelve a ser elegible sola', async () => {
    await wipeBank();
    await deposit([item('muerta.com')]);
    const first = await draw(admin, randomUUID(), 1, { reserveSeconds: 30 });
    assert.equal(first.length, 1);
    await admin.query(
      `UPDATE public.agent1_company_bank SET reserved_until = now() - interval '1 minute' WHERE id = $1`,
      [first[0]!.id],
    );
    const second = await draw(admin, randomUUID(), 1);
    assert.equal(second.length, 1);
    assert.equal(second[0]!.id, first[0]!.id);
  });

  it('§ 4 — 🔴 dos vendedores a la vez NUNCA reciben la misma empresa (SKIP LOCKED)', async () => {
    await wipeBank();
    await deposit(Array.from({ length: 5 }, (_, i) => item(`carrera${i}.com`)));
    const other = postgres.getPgClient();
    await other.connect();
    try {
      await admin.query('BEGIN');
      await other.query('BEGIN');
      const a = await draw(admin, randomUUID(), 3);
      const b = await draw(other, randomUUID(), 3);
      await admin.query('COMMIT');
      await other.query('COMMIT');
      assert.equal(a.length, 3);
      assert.equal(b.length, 2, 'el segundo se lleva sólo las que quedaban, sin esperar');
      const ids = new Set([...a, ...b].map((r) => r.id));
      assert.equal(ids.size, 5);
    } finally {
      await other.end();
    }
  });

  it('§ 4 — el límite se acota a 50 y 0 no saca nada', async () => {
    await wipeBank();
    await deposit(Array.from({ length: 3 }, (_, i) => item(`lim${i}.com`)));
    assert.equal((await draw(admin, randomUUID(), 0)).length, 0);
    assert.equal((await draw(admin, randomUUID(), 9999)).length, 3);
  });

  // ─── § 5 ────────────────────────────────────────────────────────────────────

  it('§ 5 — 🔴 una fila caducada NO se entrega y se marca expired al sacar', async () => {
    await wipeBank();
    await admin.query(`
      INSERT INTO public.agent1_company_bank
        (country_code, macro_industry_key, tier, source_provider, claim_domain, payload, missing_fields, banked_at, expires_at)
      VALUES
        ('CO','technology','ready','lusha','caducada.com','{}','{}', now()-interval '70 days', now()-interval '10 days'),
        ('CO','technology','ready','lusha','vigente.com','{}','{}',  now()-interval '2 days',  now()+interval '58 days')`);
    const drawn = await draw(admin, randomUUID(), 5);
    assert.deepEqual(drawn.map((r) => r.claims[0]!.key), ['vigente.com']);
    assert.equal(await statusOf(await idByDomain('caducada.com')), 'expired');
  });

  it('§ 5 — 🔴 aunque haya más caducadas de las que la limpieza perezosa alcanza (200), NINGUNA se entrega', async () => {
    await wipeBank();
    await admin.query(`
      INSERT INTO public.agent1_company_bank
        (country_code, macro_industry_key, tier, source_provider, claim_domain, payload, missing_fields, banked_at, expires_at)
      SELECT 'CO','technology','ready','lusha','vencida' || g || '.com','{}','{}',
             now()-interval '90 days' + (g || ' seconds')::interval, now()-interval '30 days'
        FROM generate_series(1, 230) g`);
    await deposit([item('unica-vigente.com')]);
    const drawn = await draw(admin, randomUUID(), 1);
    assert.deepEqual(drawn.map((r) => r.claims[0]!.key), ['unica-vigente.com']);
  });

  // ─── § 6 ────────────────────────────────────────────────────────────────────

  it('§ 6 — assigned / invalidated / released, y sólo toca lo reservado por ESTA extracción', async () => {
    await wipeBank();
    await deposit([item('s1.com'), item('s2.com'), item('s3.com')]);
    const drawId = randomUUID();
    const drawn = await draw(admin, drawId, 3);
    const [a, b, c] = drawn.map((r) => r.id) as [string, string, string];
    const batch = await newBatch();
    const candidate = await newCandidate(batch);

    const out = await settle(drawId, [
      { id: a, outcome: 'assigned', batchId: batch, candidateId: candidate },
      { id: b, outcome: 'invalidated', reason: 'claimed_elsewhere' },
      { id: c, outcome: 'released' },
      { id: randomUUID(), outcome: 'released' },
      { id: a, outcome: 'nonsense' },
    ]);
    assert.deepEqual(
      { assigned: out.assigned, invalidated: out.invalidated, released: out.released, ignored: out.ignored },
      { assigned: 1, invalidated: 1, released: 1, ignored: 2 },
    );
    assert.equal(await statusOf(a), 'assigned');
    assert.equal(await statusOf(b), 'invalidated');
    assert.equal(await statusOf(c), 'banked');

    const { rows } = await admin.query(
      `SELECT assigned_batch_id, assigned_candidate_id, assigned_at, draw_id, reserved_until
         FROM public.agent1_company_bank WHERE id = $1`,
      [a],
    );
    assert.equal(rows[0].assigned_batch_id, batch);
    assert.equal(rows[0].assigned_candidate_id, candidate);
    assert.ok(rows[0].assigned_at);
    assert.equal(rows[0].draw_id, null);
    assert.equal(rows[0].reserved_until, null);
  });

  it('§ 6 — 🔴 una extracción ajena (otro draw_id) no puede cerrar la fila', async () => {
    await wipeBank();
    await deposit([item('ajena.com')]);
    const drawn = await draw(admin, randomUUID(), 1);
    const out = await settle(randomUUID(), [{ id: drawn[0]!.id, outcome: 'assigned' }]);
    assert.equal(out.assigned, 0);
    assert.equal(out.ignored, 1);
    assert.equal(await statusOf(drawn[0]!.id), 'reserved');
  });

  it('§ 6 — 🔴 un estado final no se toca, y una transición fuera del grafo se rechaza', async () => {
    await wipeBank();
    await deposit([item('final.com'), item('sigue-banked.com')]);
    const drawId = randomUUID();
    const drawn = await draw(admin, drawId, 1);
    await settle(drawId, [{ id: drawn[0]!.id, outcome: 'invalidated', reason: 'x' }]);

    await assert.rejects(
      admin.query(`UPDATE public.agent1_company_bank SET status = 'banked' WHERE id = $1`, [drawn[0]!.id]),
      (e: { code?: string }) => e.code === '23514',
      'invalidated es final',
    );
    const stillBanked = await idByDomain(drawn[0]!.claims[0]!.key === 'final.com' ? 'sigue-banked.com' : 'final.com');
    assert.equal(await statusOf(stillBanked), 'banked');
    await assert.rejects(
      admin.query(`UPDATE public.agent1_company_bank SET status = 'assigned', assigned_at = now() WHERE id = $1`, [
        stillBanked,
      ]),
      (e: { code?: string }) => e.code === '23514',
      'banked -> assigned no existe: se pasa por reserved',
    );
  });

  it('§ 6 — las columnas de identidad y contenido quedan fijas aunque alguien intente cambiarlas', async () => {
    await wipeBank();
    await deposit([item('fija.com', { payload: { name: 'Original' } })]);
    const id = await idByDomain('fija.com');
    await admin.query(
      `UPDATE public.agent1_company_bank
          SET payload = '{"name":"Otra"}', claim_domain = 'cambiada.com', country_code = 'PE', tier = 'to_complete'
        WHERE id = $1`,
      [id],
    );
    const { rows } = await admin.query(
      `SELECT payload, claim_domain, country_code, tier FROM public.agent1_company_bank WHERE id = $1`,
      [id],
    );
    assert.deepEqual(rows[0].payload, { name: 'Original' });
    assert.equal(rows[0].claim_domain, 'fija.com');
    assert.equal(rows[0].country_code, 'CO');
    assert.equal(rows[0].tier, 'ready');
  });

  // ─── § 7 ────────────────────────────────────────────────────────────────────

  it('§ 7 — 🔴 la clave de una fila FINAL queda libre: la empresa puede volver a entrar', async () => {
    await wipeBank();
    await deposit([item('vuelve.com')]);
    const drawId = randomUUID();
    const drawn = await draw(admin, drawId, 1);
    await settle(drawId, [{ id: drawn[0]!.id, outcome: 'invalidated', reason: 'hubspot_duplicate' }]);
    const again = await deposit([item('vuelve.com')]);
    assert.equal(again.deposited, 1, 'una fila invalidada no bloquea la clave');
    const dup = await deposit([item('vuelve.com')]);
    assert.equal(dup.skipped_in_bank, 1, 'pero la activa sí');
  });

  it('depositar → sacar → cerrar, de punta a punta', async () => {
    await wipeBank();
    const store = createCompanyBankStore(pgRpcClient());
    const batch = await newBatch();
    const candidate = await newCandidate(batch);
    await admin.query(
      `INSERT INTO public.agent1_company_identity_claims (claim_type, claim_key, candidate_id, batch_id)
       VALUES ('domain', 'ya-es-de-alguien.com.co', $1, $2)`,
      [candidate, batch],
    );

    const dep = await store.deposit([
      { ...item('uno.com.co'), claims: [{ type: 'domain', key: 'uno.com.co' }], payload: { name: 'Uno' } } as never,
      { ...item('dos.com.co'), claims: [{ type: 'fiscal', key: 'CO:NIT:900111222' }, { type: 'linkedin', key: 'dos-sa' }], payload: { name: 'Dos' } } as never,
      { ...item('ya-es-de-alguien.com.co') } as never,
      { ...item('uno.com.co') } as never,
      { ...item('mal.com.co'), countryCode: 'co' } as never,
    ]);
    assert.deepEqual(dep, { status: 'ok', deposited: 2, skippedClaimed: 1, skippedInBank: 1, skippedInvalid: 1 });

    const drawn = await store.draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 5 });
    assert.equal(drawn.status, 'ok');
    if (drawn.status !== 'ok') return;
    assert.equal(drawn.companies.length, 2);
    const dos = drawn.companies.find((c) => c.payload.name === 'Dos')!;
    assert.deepEqual(
      [...dos.claims].sort((a, b) => a.type.localeCompare(b.type)),
      [
        { type: 'fiscal', key: 'CO:NIT:900111222' },
        { type: 'linkedin', key: 'dos-sa' },
      ],
    );
    assert.equal(dos.tier, 'ready');
    assert.equal(dos.sourceProvider, 'lusha');

    const uno = drawn.companies.find((c) => c.payload.name === 'Uno')!;
    const out = await store.settle(drawn.drawId, [
      { id: uno.id, outcome: 'assigned', batchId: batch, candidateId: candidate },
      { id: dos.id, outcome: 'released' },
    ]);
    assert.deepEqual(out, { status: 'ok', assigned: 1, invalidated: 0, released: 1, ignored: 0 });
    assert.equal(await statusOf(dos.id), 'banked');
    assert.equal(await statusOf(uno.id), 'assigned');

    // Y lo liberado se puede volver a sacar.
    const again = await store.draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 5 });
    assert.equal(again.status === 'ok' ? again.companies.length : -1, 1);
  });

  it('una función ausente se ve como `unavailable`, no como una excepción', async () => {
    const client = {
      async rpc() {
        return { data: null, error: { code: '42883', message: 'function does not exist' } };
      },
    } as unknown as SupabaseClient;
    const r = await createCompanyBankStore(client).draw({ countryCode: 'CO', macroIndustryKey: 'technology', limit: 1 });
    assert.equal(r.status, 'unavailable');
  });
});
