/**
 * 164 — El teléfono de HubSpot (o manual) no se reemplaza por el de Apollo / Lusha.
 *
 * Corre la migración 164 en PostgreSQL REAL sobre tablas mínimas con las columnas que los
 * triggers leen, y comprueba los caminos que importan: reveal sobre un candidato de
 * HubSpot, reveal sobre un candidato de proveedor, supresión, aprobación (UPDATE al
 * principal de la colección) y edición manual de un contacto oficial.
 *
 * Arnés opcional como el resto de suites `-postgres` (`npm install --no-save
 * embedded-postgres@17.6.0-beta.15`); con `SELLUP_REQUIRE_POSTGRES_HARNESS=1` (CI) no
 * resolverlo es un error, no un skip.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATION = join(repoRoot, 'supabase/migrations/164_keep_crm_phone_over_provider_phone.sql');

type PgLikeClient = {
  connect: () => Promise<void>;
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};
type EmbeddedPostgresLike = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: () => PgLikeClient;
};

let EmbeddedPostgresCtor: (new (options: Record<string, unknown>) => EmbeddedPostgresLike) | null = null;
let harnessSkipReason: string | false = false;
try {
  const require = createRequire(import.meta.url);
  const mod = require('embedded-postgres') as {
    default?: new (options: Record<string, unknown>) => EmbeddedPostgresLike;
  };
  const ctor = mod.default ?? (mod as unknown as new (o: Record<string, unknown>) => EmbeddedPostgresLike);
  if (typeof ctor === 'function') EmbeddedPostgresCtor = ctor;
  else harnessSkipReason = 'embedded-postgres resolvió sin constructor utilizable';
} catch {
  harnessSkipReason =
    'embedded-postgres no está instalado (`npm install --no-save embedded-postgres@17.6.0-beta.15`)';
}
if (harnessSkipReason && process.env.SELLUP_REQUIRE_POSTGRES_HARNESS === '1') {
  throw new Error(`SELLUP_REQUIRE_POSTGRES_HARNESS=1 y el arnés no resolvió: ${harnessSkipReason}`);
}

const HUBSPOT_PHONE = '+1 809 555 0101';
const APOLLO_PHONE = '+18095550199';

describe('164 — el teléfono de HubSpot/manual no se reemplaza por uno de proveedor', { skip: harnessSkipReason }, () => {
  let postgres: EmbeddedPostgresLike;
  let client: PgLikeClient;
  let dataDir = '';

  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-164-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54464,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await client.query(`
      CREATE TABLE public.contact_enrichment_candidates (
        id text PRIMARY KEY,
        phone text,
        phone_reveal_status text,
        enrichment_metadata jsonb DEFAULT '{}'::jsonb
      );
      CREATE TABLE public.contacts (
        id text PRIMARY KEY,
        phone text,
        phone_type text,
        phone_source text,
        phone_raw_type text,
        phone_revealed_at timestamptz,
        metadata jsonb DEFAULT '{}'::jsonb
      );`);
    await client.query(readFileSync(MIGRATION, 'utf8'));
  });

  after(async () => {
    await client?.end().catch(() => undefined);
    await postgres?.stop().catch(() => undefined);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  async function candidate(id: string): Promise<Record<string, unknown>> {
    return (await client.query('SELECT * FROM contact_enrichment_candidates WHERE id = $1', [id])).rows[0];
  }
  async function contact(id: string): Promise<Record<string, unknown>> {
    return (await client.query('SELECT * FROM contacts WHERE id = $1', [id])).rows[0];
  }
  /** Lo que escribe un reveal (RPC 120 / caché / waterfall). */
  async function reveal(id: string, number: string | null): Promise<void> {
    await client.query(
      `UPDATE contact_enrichment_candidates
          SET phone = $2, phone_reveal_status = 'revealed',
              enrichment_metadata = enrichment_metadata || jsonb_build_object('phone',
                jsonb_build_object('number', $2::text, 'source', 'apollo_reveal'))
        WHERE id = $1`,
      [id, number],
    );
  }

  describe('candidatos', () => {
    it('reveal sobre un candidato de HubSpot: conserva el número de HubSpot y no le pega la procedencia de Apollo', async () => {
      await client.query(
        `INSERT INTO contact_enrichment_candidates VALUES ('c-hs', $1, NULL, '{"hubspot_first": true}')`,
        [HUBSPOT_PHONE],
      );
      await reveal('c-hs', APOLLO_PHONE);
      const row = await candidate('c-hs');
      assert.equal(row.phone, HUBSPOT_PHONE);
      assert.equal(row.phone_reveal_status, 'revealed', 'el estado terminal del reveal sí se escribe');
      const meta = row.enrichment_metadata as Record<string, Record<string, unknown>>;
      assert.equal(meta.phone, undefined);
      assert.equal(meta.hubspot_first as unknown, true);
      // El de Apollo queda a la vista, aparte.
      assert.deepEqual(meta.provider_phone, { number: APOLLO_PHONE, source: 'apollo_reveal' });
    });

    it('un reveal que vuelve sin número tampoco borra el de HubSpot', async () => {
      await client.query(
        `INSERT INTO contact_enrichment_candidates VALUES ('c-hs-empty', $1, 'pending', '{}')`,
        [HUBSPOT_PHONE],
      );
      await reveal('c-hs-empty', null);
      const row = await candidate('c-hs-empty');
      assert.equal(row.phone, HUBSPOT_PHONE);
      assert.equal((row.enrichment_metadata as Record<string, unknown>).provider_phone, undefined);
    });

    it('la supresión (vaciar sin reveal) sí borra el número', async () => {
      await client.query(
        `INSERT INTO contact_enrichment_candidates VALUES ('c-supp', $1, NULL, '{}')`,
        [HUBSPOT_PHONE],
      );
      await client.query(`UPDATE contact_enrichment_candidates SET phone = NULL WHERE id = 'c-supp'`);
      assert.equal((await candidate('c-supp')).phone, null);
    });

    it('sin número previo, el reveal llena el campo como siempre', async () => {
      await client.query(`INSERT INTO contact_enrichment_candidates VALUES ('c-empty', NULL, NULL, '{}')`);
      await reveal('c-empty', APOLLO_PHONE);
      const row = await candidate('c-empty');
      assert.equal(row.phone, APOLLO_PHONE);
      assert.equal(((row.enrichment_metadata as Record<string, Record<string, unknown>>).phone).source, 'apollo_reveal');
    });

    it('un número de proveedor puede reemplazar a otro de proveedor', async () => {
      await client.query(
        `INSERT INTO contact_enrichment_candidates VALUES ('c-prov', '+18095550000', 'revealed',
           '{"phone": {"number": "+18095550000", "source": "apollo_search"}}')`,
      );
      await reveal('c-prov', APOLLO_PHONE);
      assert.equal((await candidate('c-prov')).phone, APOLLO_PHONE);
    });
  });

  describe('contactos oficiales', () => {
    it('la aprobación no pisa el número de HubSpot con el principal de Apollo', async () => {
      await client.query(`INSERT INTO contacts (id, phone, phone_source) VALUES ('k-hs', $1, NULL)`, [HUBSPOT_PHONE]);
      await client.query(
        `UPDATE contacts SET phone = $1, phone_type = 'mobile', phone_source = 'apollo_reveal',
                phone_revealed_at = now() WHERE id = 'k-hs'`,
        [APOLLO_PHONE],
      );
      const row = await contact('k-hs');
      assert.equal(row.phone, HUBSPOT_PHONE);
      assert.equal(row.phone_source, null);
      assert.equal(row.phone_type, null);
      assert.equal(row.phone_revealed_at, null);
      const provider = (row.metadata as Record<string, Record<string, unknown>>).provider_phone;
      assert.equal(provider.number, APOLLO_PHONE);
      assert.equal(provider.source, 'apollo_reveal');
      assert.equal(provider.type, 'mobile');
    });

    it('una edición manual sí cambia el número', async () => {
      await client.query(`INSERT INTO contacts (id, phone, phone_source) VALUES ('k-manual', $1, NULL)`, [HUBSPOT_PHONE]);
      await client.query(`UPDATE contacts SET phone = '+18095551234', phone_source = 'manual' WHERE id = 'k-manual'`);
      assert.equal((await contact('k-manual')).phone, '+18095551234');
    });

    it('si el número ya era de un proveedor, otro proveedor lo puede reemplazar', async () => {
      await client.query(
        `INSERT INTO contacts (id, phone, phone_source) VALUES ('k-prov', '+18095550000', 'apollo_search')`,
      );
      await client.query(`UPDATE contacts SET phone = $1, phone_source = 'lusha_reveal' WHERE id = 'k-prov'`, [APOLLO_PHONE]);
      assert.equal((await contact('k-prov')).phone, APOLLO_PHONE);
    });

    it('vaciar el número (supresión) sigue funcionando', async () => {
      await client.query(`INSERT INTO contacts (id, phone, phone_source) VALUES ('k-supp', $1, NULL)`, [HUBSPOT_PHONE]);
      await client.query(`UPDATE contacts SET phone = NULL, phone_source = NULL WHERE id = 'k-supp'`);
      assert.equal((await contact('k-supp')).phone, null);
    });
  });
});
