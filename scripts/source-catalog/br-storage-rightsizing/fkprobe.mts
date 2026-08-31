/**
 * BR PROD STORAGE RIGHT-SIZING — does ATTACH PARTITION stay cheap when the PARENT carries a
 * foreign key?
 *
 * The retention design depends on ATTACH being a catalog operation rather than a scan. PostgreSQL
 * clones a partitioned parent's FK onto each new partition, so the question is whether that clone
 * validates row by row. Measured here rather than assumed.
 *
 * 🔴 Ephemeral local PostgreSQL only. NO Production, NO remote database, NO network.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEmbeddedPostgres } from '../../../src/server/source-catalog/__tests__/support/source-snapshot-identity-real-migration-chain';

const { ctor } = resolveEmbeddedPostgres(import.meta.url);
if (!ctor) throw new Error('no embedded pg');
const dir = mkdtempSync(join(tmpdir(), 'fkprobe-'));
const pg = new ctor({ databaseDir: dir, user: 'postgres', password: 'postgres', port: 54911, persistent: false });
await pg.initialise(); await pg.start();
const db = pg.getPgClient(); await db.connect();

const RUN = '11111111-1111-4111-8111-111111111111';
await db.query(`CREATE TABLE runs (id uuid PRIMARY KEY)`);
await db.query(`INSERT INTO runs VALUES ($1)`, [RUN]);
await db.query(`
  CREATE TABLE parent (
    snapshot_run_id uuid NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
    normalized_tax_id text NOT NULL,
    payload text,
    PRIMARY KEY (snapshot_run_id, normalized_tax_id)
  ) PARTITION BY LIST (snapshot_run_id)`);
await db.query(`CREATE INDEX parent_name_idx ON parent (snapshot_run_id, payload)`);
await db.query(`
  CREATE TABLE child (
    LIKE parent INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    CONSTRAINT child_run_chk CHECK (snapshot_run_id = '${RUN}'::uuid),
    PRIMARY KEY (snapshot_run_id, normalized_tax_id)
  )`);
await db.query(`INSERT INTO child SELECT '${RUN}'::uuid, lpad(g::text, 14, '0'), 'NAME ' || g FROM generate_series(1, 400000) g`);
await db.query(`CREATE INDEX child_name_idx ON child (snapshot_run_id, payload)`);
await db.query('ANALYZE child');
const t0 = process.hrtime.bigint();
await db.query(`ALTER TABLE parent ATTACH PARTITION child FOR VALUES IN ('${RUN}')`);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`ATTACH with parent FK, 400k rows: ${ms.toFixed(1)} ms`);
const { rows: c } = await db.query(`SELECT conname, contype, convalidated FROM pg_constraint WHERE conrelid = 'child'::regclass ORDER BY conname`);
console.log(JSON.stringify(c, null, 1));
const { rows: i } = await db.query(`SELECT indexrelid::regclass::text AS name, indisvalid FROM pg_index WHERE indrelid='child'::regclass`);
console.log(JSON.stringify(i));
// FK actually enforced through the partition?
try { await db.query(`INSERT INTO child VALUES ('22222222-2222-4222-8222-222222222222','X','Y')`); console.log('BAD: bogus run accepted'); }
catch (e) { console.log('good: child rejects foreign run ->', (e as {code?:string}).code); }
try { await db.query(`DELETE FROM runs WHERE id = '${RUN}'`); console.log('BAD: run delete allowed'); }
catch (e) { console.log('good: run delete restricted ->', (e as {code?:string}).code); }
await db.end(); await pg.stop(); rmSync(dir, { recursive: true, force: true });
