/**
 * Migración 166 — RLS por alcance comercial, contra PostgreSQL REAL con los roles
 * de Supabase (`authenticated` con la sesión de cada persona).
 *
 * Organigrama sintético:
 *   Mid Market (grupo raíz) ─ Región Andina (hijo)       Otro grupo
 *     · Lina   — líder, grupo raíz                          · Sara  — vendedora
 *     · Vero   — vendedora, Región Andina (por el grupo)    · Gabo  — Growth
 *     · Rubén  — vendedor SIN grupo, reporta a Lina
 *     · Iván   — vendedor INACTIVO en Región Andina
 *   · Ana  — admin          · Leo — líder sin grupo ni reportes
 *
 * No aplica NADA en Producción. Datos sintéticos.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   node --import tsx --test src/modules/access/__tests__/commercial-scope-rls-postgres.test.ts
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  resolveEmbeddedPostgres,
  SUPABASE_ROLES_SQL,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../../server/prospect-batches/__tests__/support/cut3b4-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATION_166 = readFileSync(join(repoRoot, 'supabase', 'migrations', '166_commercial_scope_rls.sql'), 'utf8');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(import.meta.url);

/**
 * Lo que la 166 necesita del esquema, con las políticas de ANTES tal como están
 * en Producción (13-11): `has_active_access(auth.uid())` en las cuatro tablas.
 */
const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text UNIQUE NOT NULL);
CREATE TABLE public.organization_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  parent_group_id uuid REFERENCES public.organization_groups(id)
);
CREATE TABLE public.internal_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE,
  full_name     text,
  access_status text NOT NULL DEFAULT 'active',
  role_id       uuid REFERENCES public.roles(id),
  group_id      uuid REFERENCES public.organization_groups(id),
  manager_id    uuid REFERENCES public.internal_users(id)
);
ALTER TABLE public.internal_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_row ON public.internal_users FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_active_access(p_auth_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM internal_users WHERE auth_user_id = p_auth_user_id AND access_status = 'active');
$$;

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES public.internal_users(id),
  created_by uuid REFERENCES public.internal_users(id)
);
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  account_id uuid REFERENCES public.accounts(id),
  created_by uuid REFERENCES public.internal_users(id)
);
CREATE TABLE public.prospect_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES public.internal_users(id),
  created_by uuid REFERENCES public.internal_users(id)
);
CREATE TABLE public.prospect_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.prospect_batches(id) ON DELETE CASCADE,
  name text NOT NULL,
  assigned_to uuid REFERENCES public.internal_users(id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','contacts','prospect_batches','prospect_candidates'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY active_users_can_read_%s ON public.%I FOR SELECT TO authenticated USING (has_active_access(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY active_users_can_insert_%s ON public.%I FOR INSERT TO authenticated WITH CHECK (has_active_access(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY active_users_can_update_%s ON public.%I FOR UPDATE TO authenticated USING (has_active_access(auth.uid())) WITH CHECK (has_active_access(auth.uid()))', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT SELECT ON public.internal_users, public.roles, public.organization_groups TO authenticated;
`;

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let db: PgLikeClient;

type Person = { id: string; auth: string };
const people: Record<string, Person> = {};
const ids: Record<string, string> = {};

async function one(sql: string, values: unknown[] = []): Promise<string> {
  const { rows } = await db.query(sql, values);
  return String(rows[0].id);
}

async function person(key: string, role: string, opts: { group?: string; manager?: string; status?: string } = {}) {
  const auth = randomUUID();
  const id = await one(
    `INSERT INTO public.internal_users (auth_user_id, full_name, access_status, role_id, group_id, manager_id)
     VALUES ($1, $2, $3, (SELECT id FROM public.roles WHERE key = $4), $5, $6) RETURNING id`,
    [auth, key, opts.status ?? 'active', role, opts.group ?? null, opts.manager ?? null],
  );
  people[key] = { id, auth };
}

/** Corre `sql` como `authenticated` con la sesión de `who` (o de nadie). */
async function as<T extends Record<string, unknown>>(who: string | null, sql: string, values: unknown[] = []): Promise<T[]> {
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL ROLE authenticated');
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [who ? people[who].auth : '']);
    const { rows } = await db.query(sql, values);
    await db.query('COMMIT');
    return rows as T[];
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

const names = async (who: string | null, table: string) =>
  (await as<{ name: string }>(who, `SELECT name FROM public.${table} ORDER BY name`)).map((r) => r.name);

describe('Migración 166 — RLS por alcance comercial', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m166-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54466,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    db = postgres.getPgClient();
    await db.connect();
    await db.query(SUPABASE_ROLES_SQL);
    await db.query(SCHEMA_SQL);

    for (const key of ['admin', 'commercial_lead', 'commercial_manager', 'seller_bd', 'growth']) {
      await db.query(`INSERT INTO public.roles (key) VALUES ($1)`, [key]);
    }
    const root = await one(`INSERT INTO public.organization_groups (name) VALUES ('Mid Market') RETURNING id`);
    const andina = await one(`INSERT INTO public.organization_groups (name, parent_group_id) VALUES ('Andina', $1) RETURNING id`, [root]);
    const other = await one(`INSERT INTO public.organization_groups (name) VALUES ('Otro') RETURNING id`);

    await person('ana', 'admin');
    await person('lina', 'commercial_lead', { group: root });
    await person('vero', 'seller_bd', { group: andina });
    await person('ruben', 'seller_bd', { manager: people.lina.id });
    await person('ivan', 'seller_bd', { group: andina, status: 'suspended' });
    await person('sara', 'seller_bd', { group: other });
    await person('gabo', 'growth', { group: other });
    await person('leo', 'commercial_lead');

    const acc = (name: string, owner: string | null, creator: string | null) =>
      one(`INSERT INTO public.accounts (name, owner_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [
        name, owner ? people[owner].id : null, creator ? people[creator].id : null,
      ]);
    ids.accVero = await acc('A-vero', 'vero', 'vero');
    ids.accRuben = await acc('A-ruben', 'ruben', 'ruben');
    ids.accIvan = await acc('A-ivan', 'ivan', 'ivan');
    ids.accSara = await acc('A-sara', 'sara', 'sara');
    ids.accSaraParaVero = await acc('A-sara-de-vero', 'vero', 'sara'); // la creó Sara, responsable Vero
    ids.accGabo = await acc('A-gabo', 'gabo', 'gabo');
    ids.accSinDueno = await acc('A-sin-dueno', null, null);

    for (const [acct, name] of [[ids.accVero, 'C-vero'], [ids.accSara, 'C-sara'], [ids.accSaraParaVero, 'C-sara-de-vero']] as const) {
      await db.query(`INSERT INTO public.contacts (full_name, account_id) VALUES ($1, $2)`, [name, acct]);
    }

    const batch = (name: string, owner: string | null, creator: string) =>
      one(`INSERT INTO public.prospect_batches (name, owner_id, created_by) VALUES ($1, $2, $3) RETURNING id`, [
        name, owner ? people[owner].id : null, people[creator].id,
      ]);
    ids.batchVero = await batch('B-vero', 'vero', 'vero');
    ids.batchSara = await batch('B-sara', 'sara', 'sara');
    ids.batchGrowthParaVero = await batch('B-gabo', null, 'gabo'); // Growth lanzó; asignó una a Vero

    const cand = (batchId: string, name: string, assigned: string | null) =>
      one(`INSERT INTO public.prospect_candidates (batch_id, name, assigned_to) VALUES ($1, $2, $3) RETURNING id`, [
        batchId, name, assigned ? people[assigned].id : null,
      ]);
    ids.candVero = await cand(ids.batchVero, 'P-vero', null);
    ids.candSara = await cand(ids.batchSara, 'P-sara', null);
    ids.candGaboAVero = await cand(ids.batchGrowthParaVero, 'P-gabo-asignada-a-vero', 'vero');
    ids.candGaboLibre = await cand(ids.batchGrowthParaVero, 'P-gabo-libre', null);

    await db.query(MIGRATION_166);
  });

  after(async () => {
    if (!EmbeddedPostgresCtor) return;
    await db.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('empresas', () => {
    it('admin: todo', async () => {
      assert.equal((await names('ana', 'accounts')).length, 7);
    });

    it('🔴 vendedora: sólo las suyas (responsable o creadora)', async () => {
      assert.deepEqual(await names('vero', 'accounts'), ['A-sara-de-vero', 'A-vero']);
    });

    it('🔴 la que creó una empresa y se la dio a otro equipo también la sigue viendo (como la app)', async () => {
      assert.deepEqual(await names('sara', 'accounts'), ['A-sara', 'A-sara-de-vero']);
    });

    it('🔴 líder: su grupo en cascada + sus reportes; no otro grupo ni personas inactivas', async () => {
      assert.deepEqual(await names('lina', 'accounts'), ['A-ruben', 'A-sara-de-vero', 'A-vero']);
    });

    it('líder sin grupo ni reportes: sólo lo suyo (nunca todo)', async () => {
      assert.deepEqual(await names('leo', 'accounts'), []);
    });

    it('Growth: sólo lo suyo', async () => {
      assert.deepEqual(await names('gabo', 'accounts'), ['A-gabo']);
    });

    it('persona inactiva o sin sesión: nada', async () => {
      assert.deepEqual(await names('ivan', 'accounts'), []);
      assert.deepEqual(await names(null, 'accounts'), []);
    });
  });

  describe('contactos (van con su empresa)', () => {
    it('vendedora y líder ven los de sus empresas; admin todos', async () => {
      const contactNames = async (who: string) =>
        (await as<{ full_name: string }>(who, `SELECT full_name FROM public.contacts ORDER BY 1`)).map((r) => r.full_name);
      assert.deepEqual(await contactNames('vero'), ['C-sara-de-vero', 'C-vero']);
      assert.deepEqual(await contactNames('lina'), ['C-sara-de-vero', 'C-vero']);
      assert.deepEqual(await contactNames('gabo'), []);
      assert.equal((await contactNames('ana')).length, 3);
    });
  });

  describe('búsquedas y candidatas', () => {
    it('🔴 la búsqueda de otro con una candidata asignada se ve, pero sólo con esa candidata', async () => {
      assert.deepEqual(await names('vero', 'prospect_batches'), ['B-gabo', 'B-vero']);
      assert.deepEqual(await names('vero', 'prospect_candidates'), ['P-gabo-asignada-a-vero', 'P-vero']);
    });

    it('quien lanzó la búsqueda ve todas sus candidatas (también la asignada a otra)', async () => {
      assert.deepEqual(await names('gabo', 'prospect_candidates'), ['P-gabo-asignada-a-vero', 'P-gabo-libre']);
    });

    it('líder: lo de su equipo, en cascada', async () => {
      assert.deepEqual(await names('lina', 'prospect_batches'), ['B-gabo', 'B-vero']);
      assert.deepEqual(await names('lina', 'prospect_candidates'), ['P-gabo-asignada-a-vero', 'P-vero']);
    });

    it('otra vendedora no ve nada del equipo de Lina', async () => {
      assert.deepEqual(await names('sara', 'prospect_batches'), ['B-sara']);
      assert.deepEqual(await names('sara', 'prospect_candidates'), ['P-sara']);
    });

    it('las políticas de búsquedas y candidatas no se llaman en bucle (embed en las dos direcciones)', async () => {
      const rows = await as<{ n: number }>(
        'vero',
        `SELECT count(*)::int AS n FROM public.prospect_candidates c JOIN public.prospect_batches b ON b.id = c.batch_id`,
      );
      assert.equal(rows[0].n, 2);
    });
  });

  describe('escritura', () => {
    it('🔴 nadie actualiza por id una fila fuera de su alcance', async () => {
      const upd = async (who: string, table: string, id: string) =>
        (await as(who, `UPDATE public.${table} SET name = name WHERE id = $1 RETURNING id`, [id])).length;
      assert.equal(await upd('vero', 'accounts', ids.accSara), 0);
      assert.equal(await upd('vero', 'prospect_batches', ids.batchSara), 0);
      assert.equal(await upd('vero', 'prospect_candidates', ids.candSara), 0);
      assert.equal(await upd('vero', 'prospect_candidates', ids.candGaboLibre), 0, 'de la búsqueda ajena, sólo la asignada');
      assert.equal(await upd('vero', 'prospect_candidates', ids.candGaboAVero), 1);
      assert.equal(await upd('lina', 'accounts', ids.accRuben), 1);
      assert.equal(await upd('ana', 'accounts', ids.accSara), 1);
      const contact = await as('vero', `UPDATE public.contacts SET full_name = full_name WHERE account_id = $1 RETURNING id`, [ids.accSara]);
      assert.equal(contact.length, 0);
    });

    it('un líder reasigna a alguien de fuera una empresa que su equipo creó (sigue visible por el creador)', async () => {
      const rows = await as('lina', `UPDATE public.accounts SET owner_id = $1 WHERE id = $2`, [people.sara.id, ids.accRuben]);
      assert.deepEqual(rows, []);
      const { rows: after } = await db.query(`SELECT owner_id FROM public.accounts WHERE id = $1`, [ids.accRuben]);
      assert.equal(after[0].owner_id, people.sara.id);
      await db.query(`UPDATE public.accounts SET owner_id = $1 WHERE id = $2`, [people.ruben.id, ids.accRuben]);
    });

    it('🔴 con la sesión, sacar una fila del propio alcance falla: la app reasigna con el cliente de servicio', async () => {
      // Creada por Sara (fuera), responsable Vero (dentro): reasignarla a Gabo la saca del
      // alcance de Lina, y Postgres exige que la fila nueva también se pueda leer.
      await assert.rejects(
        as('lina', `UPDATE public.accounts SET owner_id = $1 WHERE id = $2`, [people.gabo.id, ids.accSaraParaVero]),
        /row-level security/,
      );
      const { rows } = await db.query(`SELECT owner_id FROM public.accounts WHERE id = $1`, [ids.accSaraParaVero]);
      assert.equal(rows[0].owner_id, people.vero.id);
    });

    it('INSERT … RETURNING de lo propio sigue funcionando (empresa a nombre de otro, creada por mí)', async () => {
      const rows = await as<{ id: string }>(
        'vero',
        `INSERT INTO public.accounts (name, owner_id, created_by) VALUES ('A-nueva', $1, $2) RETURNING id`,
        [people.sara.id, people.vero.id],
      );
      assert.equal(rows.length, 1);
      const batch = await as<{ id: string }>(
        'gabo',
        `INSERT INTO public.prospect_batches (name, created_by) VALUES ('B-nueva', $1) RETURNING id`,
        [people.gabo.id],
      );
      const cand = await as<{ id: string }>(
        'gabo',
        `INSERT INTO public.prospect_candidates (batch_id, name) VALUES ($1, 'P-nueva') RETURNING id`,
        [batch[0].id],
      );
      assert.equal(cand.length, 1);
      await db.query(`DELETE FROM public.prospect_batches WHERE name = 'B-nueva'`);
      await db.query(`DELETE FROM public.accounts WHERE name = 'A-nueva'`);
    });

    it('sin política de borrado: la sesión no borra nada', async () => {
      const rows = await as('ana', `DELETE FROM public.accounts WHERE id = $1 RETURNING id`, [ids.accSinDueno]);
      assert.equal(rows.length, 0);
    });
  });

  describe('permisos y reaplicación', () => {
    it('las funciones son SECURITY DEFINER con search_path fijo; anon no las ejecuta', async () => {
      const { rows } = await db.query(
        `SELECT p.proname, p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname LIKE 'commercial_scope_%' ORDER BY 1`,
      );
      assert.equal(rows.length, 5);
      for (const row of rows) {
        assert.equal(row.prosecdef, true, String(row.proname));
        assert.deepEqual(row.proconfig, ['search_path=pg_catalog, public, pg_temp'], String(row.proname));
        assert.equal(row.anon_exec, false, String(row.proname));
        assert.equal(row.auth_exec, true, String(row.proname));
      }
    });

    it('las políticas viejas («cualquier persona activa») ya no existen', async () => {
      const { rows } = await db.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'active_users_can_%'
            AND cmd IN ('SELECT','UPDATE') AND tablename IN ('accounts','contacts','prospect_batches','prospect_candidates')`,
      );
      assert.deepEqual(rows, []);
    });

    it('service_role sigue viéndolo todo', async () => {
      await db.query('BEGIN');
      await db.query('SET LOCAL ROLE service_role');
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.accounts`);
      await db.query('COMMIT');
      assert.equal(rows[0].n, 7);
    });

    it('reaplicar la 166 no cambia nada', async () => {
      await db.query(MIGRATION_166);
      assert.deepEqual(await names('vero', 'accounts'), ['A-sara-de-vero', 'A-vero']);
    });
  });
});
