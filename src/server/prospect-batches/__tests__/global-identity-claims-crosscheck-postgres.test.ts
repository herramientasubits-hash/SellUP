/**
 * AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 — la migración 152 contra
 * PostgreSQL REAL, con los roles de Supabase.
 *
 * Qué fija:
 *
 *   § 1 · 🔴 el vendedor A reclama el dominio (sin NIT) y el vendedor B la misma
 *         empresa con NIT: B pierde (antes los dos se la quedaban), y al revés;
 *   § 2 · filiales del mismo grupo con NIT DISTINTO comparten dominio y LinkedIn
 *         sin chocar (TIER 0); con el MISMO NIT sí chocan;
 *   § 3 · LinkedIn: misma regla de cruce;
 *   § 4 · un candidato que vuelve a reclamar no choca consigo mismo, y una
 *         promoción de NIT agrega el reclamo fiscal a lo que ya tenía;
 *   § 5 · un llamador anterior a la 152 (sin identityDomain) sigue cruzando por su
 *         reclamo `domain`;
 *   § 6 · archivar un lote con la sesión del vendedor libera sus reclamos, salvo
 *         los de candidatos ya convertidos en cuenta;
 *   § 7 · el relleno de `identity_domain` de los reclamos fiscales que ya existían
 *         (y que NO toma un host compartido);
 *   § 8 · el banco no acepta una empresa que otro ya tiene por el cruce;
 *   § 9 · la carrera real: dos conexiones a la vez, el cerrojo serializa;
 *   § 10 · permisos y reaplicación.
 *
 * No aplica NADA en Producción. 0 proveedores, 0 créditos. Datos sintéticos.
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   node --import tsx --test src/server/prospect-batches/__tests__/global-identity-claims-crosscheck-postgres.test.ts
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  applyCut3b4RealChain,
  bootstrapPlatform,
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/cut3b4-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

const MIGRATION_140 = '140_agent1_global_company_identity_claims.sql';
const MIGRATION_142 = '142_agent1_company_bank.sql';
const MIGRATION_152 = '152_agent1_identity_claims_crosscheck.sql';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let admin: PgLikeClient;
const repAuthId = randomUUID();
let seq = 0;

type Claim = { type: string; key: string };
type ClaimOut = {
  status: string;
  claimed_candidate_ids: string[];
  claimed_elsewhere_candidate_ids: string[];
};

async function newBatch(client: PgLikeClient = admin): Promise<string> {
  seq += 1;
  const { rows } = await client.query(
    `INSERT INTO public.prospect_batches (name) VALUES ($1) RETURNING id`,
    [`lote-152-${seq}`],
  );
  return String(rows[0].id);
}

async function newCandidate(
  batchId: string,
  opts: { status?: string; domain?: string | null } = {},
): Promise<string> {
  seq += 1;
  const { rows } = await admin.query(
    `INSERT INTO public.prospect_candidates (batch_id, name, status, domain)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [batchId, `Empresa ${seq}`, opts.status ?? 'needs_review', opts.domain ?? null],
  );
  return String(rows[0].id);
}

async function claimWith(
  client: PgLikeClient,
  batchId: string,
  candidateId: string,
  claims: Claim[],
  identity: { identityDomain?: string | null; identityLinkedIn?: string | null } = {},
): Promise<ClaimOut> {
  const { rows } = await client.query(
    `SELECT public.claim_company_identities($1::jsonb) AS out`,
    [JSON.stringify([{ candidateId, batchId, claims, ...identity }])],
  );
  return rows[0].out as ClaimOut;
}

const claim = (
  batchId: string,
  candidateId: string,
  claims: Claim[],
  identity: { identityDomain?: string | null; identityLinkedIn?: string | null } = {},
) => claimWith(admin, batchId, candidateId, claims, identity);

async function activeClaims(candidateId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT count(*)::int AS n FROM public.agent1_company_identity_claims
      WHERE candidate_id = $1 AND released_at IS NULL`,
    [candidateId],
  );
  return Number(rows[0].n);
}

async function candidateRow(
  candidateId: string,
): Promise<{ status: string; duplicate_status: string; signal: string | null; holder: string | null }> {
  const { rows } = await admin.query(
    `SELECT status, duplicate_status,
            metadata->'global_identity_claim_conflict'->>'signal' AS signal,
            metadata->'global_identity_claim_conflict'->>'held_by_candidate_id' AS holder
       FROM public.prospect_candidates WHERE id = $1`,
    [candidateId],
  );
  return rows[0] as { status: string; duplicate_status: string; signal: string | null; holder: string | null };
}

async function asRep<T extends Record<string, unknown>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  await admin.query('BEGIN');
  try {
    await admin.query('SET LOCAL ROLE authenticated');
    await admin.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [repAuthId]);
    const { rows } = await admin.query(sql, values);
    await admin.query('COMMIT');
    return rows as T[];
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

// Filas de ANTES de la 152 (§ 7): se siembran entre la 140 y la 152.
const legacy = {
  plainCandidate: '',
  sharedCandidate: '',
  domainOnlyCandidate: '',
};

describe('Migración 152 contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    if (!EmbeddedPostgresCtor) return;
    dataDir = mkdtempSync(join(tmpdir(), 'sellup-m152-'));
    postgres = new EmbeddedPostgresCtor({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54452,
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

    // Reclamos fiscales de ANTES de la 152, como los dejó la 140 (sin dominio).
    const legacyBatch = await newBatch();
    legacy.plainCandidate = await newCandidate(legacyBatch, { domain: 'WWW.Legado-Acme.com.co' });
    legacy.sharedCandidate = await newCandidate(legacyBatch, { domain: 'sites.google.com' });
    legacy.domainOnlyCandidate = await newCandidate(legacyBatch, { domain: 'solo-dominio.com' });
    await claim(legacyBatch, legacy.plainCandidate, [{ type: 'fiscal', key: 'CO:800000001' }]);
    await claim(legacyBatch, legacy.sharedCandidate, [{ type: 'fiscal', key: 'CO:800000002' }]);
    await claim(legacyBatch, legacy.domainOnlyCandidate, [{ type: 'domain', key: 'solo-dominio.com' }]);

    await admin.query(readMigration(repoRoot, MIGRATION_152));
    await admin.query(
      `INSERT INTO public.internal_users (auth_user_id, access_status) VALUES ($1, 'active')`,
      [repAuthId],
    );
  });

  after(async () => {
    if (!EmbeddedPostgresCtor) return;
    await admin.end();
    await postgres.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('§ 1 — NIT de un lado, dominio del otro', () => {
    it('🔴 A reclama el dominio sin NIT; B con NIT y el mismo dominio pierde', async () => {
      const domain = `cruce-${seq}.com.co`;
      const a = await newCandidate(await newBatch());
      const batchB = await newBatch();
      const b = await newCandidate(batchB);
      const batchA = (await admin.query(`SELECT batch_id FROM public.prospect_candidates WHERE id = $1`, [a])).rows[0]
        .batch_id as string;

      const outA = await claim(batchA, a, [{ type: 'domain', key: domain }], { identityDomain: domain });
      const outB = await claim(batchB, b, [{ type: 'fiscal', key: `CO:9${seq}0000001` }], {
        identityDomain: domain,
      });

      assert.deepEqual(outA.claimed_candidate_ids, [a]);
      assert.deepEqual(outB.claimed_elsewhere_candidate_ids, [b], 'antes de la 152 los dos se la quedaban');
      assert.equal(await activeClaims(b), 0);
      const row = await candidateRow(b);
      assert.equal(row.status, 'duplicate');
      assert.equal(row.duplicate_status, 'exact_duplicate');
      assert.equal(row.signal, 'identity_domain');
      assert.equal(row.holder, a);
    });

    it('al revés: B con NIT primero; A sin NIT y el mismo dominio pierde', async () => {
      const domain = `reves-${seq}.com`;
      const batchB = await newBatch();
      const b = await newCandidate(batchB);
      const batchA = await newBatch();
      const a = await newCandidate(batchA);

      await claim(batchB, b, [{ type: 'fiscal', key: `CO:9${seq}0000002` }], { identityDomain: domain });
      const outA = await claim(batchA, a, [{ type: 'domain', key: domain }], { identityDomain: domain });

      assert.deepEqual(outA.claimed_elsewhere_candidate_ids, [a]);
      assert.equal((await candidateRow(a)).signal, 'identity_domain');
      assert.equal(await activeClaims(b), 1, 'la ganadora conserva su reclamo');
    });
  });

  describe('§ 2 — filiales del mismo grupo (TIER 0)', () => {
    it('NIT distinto + mismo dominio + mismo LinkedIn ⇒ las dos se reclaman', async () => {
      const domain = `grupo-${seq}.com`;
      const linkedin = `linkedin.com/company/grupo-${seq}`;
      const b1 = await newBatch();
      const b2 = await newBatch();
      const x = await newCandidate(b1);
      const y = await newCandidate(b2);

      const outX = await claim(b1, x, [{ type: 'fiscal', key: `CO:8${seq}111111` }], {
        identityDomain: domain,
        identityLinkedIn: linkedin,
      });
      const outY = await claim(b2, y, [{ type: 'fiscal', key: `CO:8${seq}222222` }], {
        identityDomain: domain,
        identityLinkedIn: linkedin,
      });

      assert.deepEqual(outX.claimed_candidate_ids, [x]);
      assert.deepEqual(outY.claimed_candidate_ids, [y]);
    });

    it('el MISMO NIT con el mismo dominio sí choca', async () => {
      const domain = `mismo-nit-${seq}.com`;
      const fiscal = `CO:8${seq}333333`;
      const b1 = await newBatch();
      const b2 = await newBatch();
      const x = await newCandidate(b1);
      const y = await newCandidate(b2);
      await claim(b1, x, [{ type: 'fiscal', key: fiscal }], { identityDomain: domain });
      const outY = await claim(b2, y, [{ type: 'fiscal', key: fiscal }], { identityDomain: domain });
      assert.deepEqual(outY.claimed_elsewhere_candidate_ids, [y]);
    });
  });

  describe('§ 3 — LinkedIn', () => {
    it('con NIT viaja como cruce; otro sin NIT con ese LinkedIn pierde', async () => {
      const linkedin = `linkedin.com/company/li-${seq}`;
      const b1 = await newBatch();
      const b2 = await newBatch();
      const withFiscal = await newCandidate(b1);
      const withoutFiscal = await newCandidate(b2);

      await claim(b1, withFiscal, [{ type: 'fiscal', key: `CO:8${seq}444444` }], {
        identityLinkedIn: linkedin,
      });
      const out = await claim(b2, withoutFiscal, [{ type: 'linkedin', key: linkedin }], {
        identityLinkedIn: linkedin,
      });
      assert.deepEqual(out.claimed_elsewhere_candidate_ids, [withoutFiscal]);
      assert.equal((await candidateRow(withoutFiscal)).signal, 'identity_linkedin');
    });

    it('un reclamo exclusivo de LinkedIn previo a la 152 (filial con NIT) no aparta a otra filial con NIT distinto', async () => {
      const linkedin = `linkedin.com/company/matriz-${seq}`;
      const b1 = await newBatch();
      const b2 = await newBatch();
      const parent = await newCandidate(b1);
      const sub = await newCandidate(b2);
      // Como la 140: fiscal + LinkedIn exclusivo, sin columnas de cruce.
      await claim(b1, parent, [
        { type: 'fiscal', key: `CO:8${seq}555555` },
        { type: 'linkedin', key: linkedin },
      ]);
      const out = await claim(b2, sub, [{ type: 'fiscal', key: `CO:8${seq}666666` }], {
        identityLinkedIn: linkedin,
      });
      assert.deepEqual(out.claimed_candidate_ids, [sub]);
    });
  });

  describe('§ 4 — volver a reclamar', () => {
    it('🔴 el mismo candidato reclamando dos veces no choca consigo mismo', async () => {
      const domain = `idempotente-${seq}.com`;
      const batchId = await newBatch();
      const c = await newCandidate(batchId);
      const claims = [
        { type: 'domain', key: domain },
        { type: 'linkedin', key: `linkedin.com/company/idem-${seq}` },
      ];
      await claim(batchId, c, claims, { identityDomain: domain });
      const again = await claim(batchId, c, claims, { identityDomain: domain });
      assert.deepEqual(again.claimed_candidate_ids, [c]);
      assert.deepEqual(again.claimed_elsewhere_candidate_ids, []);
      assert.equal((await candidateRow(c)).status, 'needs_review', 'antes quedaba duplicate contra sí misma');
      assert.equal(await activeClaims(c), 2);
    });

    it('una promoción de NIT agrega el reclamo fiscal y conserva el de dominio', async () => {
      const domain = `promocion-${seq}.com`;
      const batchId = await newBatch();
      const c = await newCandidate(batchId);
      await claim(batchId, c, [{ type: 'domain', key: domain }], { identityDomain: domain });
      const promoted = await claim(batchId, c, [{ type: 'fiscal', key: `CO:9${seq}777777` }], {
        identityDomain: domain,
      });
      assert.deepEqual(promoted.claimed_candidate_ids, [c]);
      assert.equal(await activeClaims(c), 2);
    });
  });

  describe('§ 5 — llamador anterior a la 152', () => {
    it('sin identityDomain, su reclamo `domain` cruza contra un dueño fiscal', async () => {
      const domain = `antiguo-${seq}.com`;
      const b1 = await newBatch();
      const b2 = await newBatch();
      const fiscalHolder = await newCandidate(b1);
      const oldCaller = await newCandidate(b2);
      await claim(b1, fiscalHolder, [{ type: 'fiscal', key: `CO:9${seq}888888` }], { identityDomain: domain });
      const out = await claim(b2, oldCaller, [{ type: 'domain', key: domain }]);
      assert.deepEqual(out.claimed_elsewhere_candidate_ids, [oldCaller]);
    });
  });

  describe('§ 6 — archivar el lote', () => {
    it('🔴 la sesión del vendedor archiva ⇒ libera, salvo lo convertido en cuenta', async () => {
      const batchId = await newBatch();
      const live = await newCandidate(batchId);
      const converted = await newCandidate(batchId);
      await claim(batchId, live, [{ type: 'domain', key: `archivo-vivo-${seq}.com` }]);
      await claim(batchId, converted, [{ type: 'domain', key: `archivo-cuenta-${seq}.com` }]);
      await admin.query(`UPDATE public.prospect_candidates SET status = 'converted_to_account' WHERE id = $1`, [
        converted,
      ]);

      const updated = await asRep(
        `UPDATE public.prospect_batches SET archived_at = now() WHERE id = $1 RETURNING id`,
        [batchId],
      );
      assert.equal(updated.length, 1, 'la sesión del vendedor sí puede archivar');
      assert.equal(await activeClaims(live), 0, 'el lote archivado no aparta empresas para siempre');
      assert.equal(await activeClaims(converted), 1, 'lo convertido en cuenta conserva su reclamo');
    });

    it('otro cambio del lote no libera nada', async () => {
      const batchId = await newBatch();
      const c = await newCandidate(batchId);
      await claim(batchId, c, [{ type: 'domain', key: `lote-vivo-${seq}.com` }]);
      await admin.query(`UPDATE public.prospect_batches SET name = name || ' (editado)' WHERE id = $1`, [batchId]);
      assert.equal(await activeClaims(c), 1);
    });
  });

  describe('§ 7 — relleno de los reclamos fiscales que ya existían', () => {
    it('toma el dominio guardado del candidato, en minúsculas y sin www', async () => {
      const { rows } = await admin.query(
        `SELECT identity_domain FROM public.agent1_company_identity_claims
          WHERE candidate_id = $1 AND claim_type = 'fiscal'`,
        [legacy.plainCandidate],
      );
      assert.equal(rows[0].identity_domain, 'legado-acme.com.co');
    });

    it('NO toma un host compartido', async () => {
      const { rows } = await admin.query(
        `SELECT identity_domain FROM public.agent1_company_identity_claims
          WHERE candidate_id = $1 AND claim_type = 'fiscal'`,
        [legacy.sharedCandidate],
      );
      assert.equal(rows[0].identity_domain, null);
    });

    it('el reclamo fiscal rellenado ya cruza contra un vendedor nuevo sin NIT', async () => {
      const batchId = await newBatch();
      const c = await newCandidate(batchId);
      const out = await claim(batchId, c, [{ type: 'domain', key: 'legado-acme.com.co' }], {
        identityDomain: 'legado-acme.com.co',
      });
      assert.deepEqual(out.claimed_elsewhere_candidate_ids, [c]);
    });

    it('un reclamo de dominio previo a la 152 también cruza contra uno nuevo con NIT', async () => {
      const batchId = await newBatch();
      const c = await newCandidate(batchId);
      const out = await claim(batchId, c, [{ type: 'fiscal', key: 'CO:900999111' }], {
        identityDomain: 'solo-dominio.com',
      });
      assert.deepEqual(out.claimed_elsewhere_candidate_ids, [c]);
    });
  });

  describe('§ 8 — banco', () => {
    function bankItem(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        countryCode: 'CO',
        macroIndustryKey: 'technology',
        tier: 'ready',
        sourceProvider: 'apollo',
        payload: { name: 'x' },
        missingFields: [],
        ...overrides,
      };
    }

    async function deposit(items: unknown[]): Promise<Record<string, number | string>> {
      const { rows } = await admin.query(`SELECT public.agent1_bank_deposit($1::jsonb) AS out`, [
        JSON.stringify(items),
      ]);
      return rows[0].out as Record<string, number | string>;
    }

    it('🔴 una empresa que otro tiene por NIT no entra al banco por su dominio', async () => {
      const domain = `banco-cruce-${seq}.com`;
      const batchId = await newBatch();
      const holder = await newCandidate(batchId);
      await claim(batchId, holder, [{ type: 'fiscal', key: `CO:9${seq}121212` }], { identityDomain: domain });
      const out = await deposit([bankItem({ claims: [{ type: 'domain', key: domain }] })]);
      assert.equal(out.skipped_claimed, 1);
      assert.equal(out.deposited, 0);
    });

    it('una filial con NIT distinto sí entra', async () => {
      const domain = `banco-filial-${seq}.com`;
      const batchId = await newBatch();
      const holder = await newCandidate(batchId);
      await claim(batchId, holder, [{ type: 'fiscal', key: `CO:9${seq}131313` }], { identityDomain: domain });
      const out = await deposit([
        bankItem({ claims: [{ type: 'fiscal', key: `CO:9${seq}141414` }], identityDomain: domain }),
      ]);
      assert.equal(out.deposited, 1);
    });
  });

  describe('§ 9 — la carrera real', () => {
    it('🔴 dos conexiones a la vez: la segunda espera el cerrojo y pierde', async () => {
      const domain = `carrera-152-${seq}.com`;
      const b1 = await newBatch();
      const b2 = await newBatch();
      const first = await newCandidate(b1);
      const second = await newCandidate(b2);

      const other = postgres.getPgClient();
      await other.connect();
      try {
        await admin.query('BEGIN');
        await claim(b1, first, [{ type: 'fiscal', key: `CO:9${seq}151515` }], { identityDomain: domain });

        let secondDone = false;
        const secondCall = claimWith(other, b2, second, [{ type: 'domain', key: domain }], {
          identityDomain: domain,
        }).then((out) => {
          secondDone = true;
          return out;
        });

        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(secondDone, false, 'la segunda tiene que esperar al cerrojo del dominio');

        await admin.query('COMMIT');
        const out = await secondCall;
        assert.deepEqual(out.claimed_elsewhere_candidate_ids, [second]);
      } finally {
        await other.end();
      }
    });
  });

  describe('§ 10 — permisos y reaplicación', () => {
    it('el disparador de archivo es SECURITY DEFINER con search_path fijado y nadie lo invoca', async () => {
      const { rows } = await admin.query(
        `SELECT prosecdef, proconfig FROM pg_proc
          WHERE oid = 'public.agent1_release_claims_of_archived_batch()'::regprocedure`,
      );
      assert.equal(rows[0].prosecdef, true);
      assert.ok((rows[0].proconfig as string[]).some((c) => c.startsWith('search_path=')));
      for (const role of ['anon', 'authenticated']) {
        const can = await admin.query(
          `SELECT has_function_privilege($1, 'public.agent1_release_claims_of_archived_batch()', 'EXECUTE') AS can`,
          [role],
        );
        assert.equal(can.rows[0].can, false);
      }
    });

    it('anon no ejecuta los ayudantes del cruce ni el reclamo', async () => {
      for (const fn of [
        'public.agent1_identity_crosscheck_holder(uuid, text, text, text)',
        'public.agent1_identity_crosscheck_lock(text[])',
        'public.claim_company_identities(jsonb)',
      ]) {
        const { rows } = await admin.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS can`, [fn]);
        assert.equal(rows[0].can, false, fn);
      }
    });

    it('el banco sigue siendo sólo de service_role', async () => {
      const { rows } = await admin.query(
        `SELECT has_function_privilege('authenticated', 'public.agent1_bank_deposit(jsonb)', 'EXECUTE') AS can`,
      );
      assert.equal(rows[0].can, false);
    });

    it('la sesión de un vendedor sigue sin leer reclamos', async () => {
      const rows = await asRep(`SELECT id FROM public.agent1_company_identity_claims`);
      assert.equal(rows.length, 0);
    });

    it('reaplicar la 152 no cambia ninguna fila', async () => {
      const snapshot = `SELECT count(*)::int AS total,
                               count(*) FILTER (WHERE released_at IS NULL)::int AS active,
                               count(identity_domain)::int AS with_domain
                          FROM public.agent1_company_identity_claims`;
      const beforeRows = await admin.query(snapshot);
      await admin.query(readMigration(repoRoot, MIGRATION_152));
      const afterRows = await admin.query(snapshot);
      assert.deepEqual(afterRows.rows[0], beforeRows.rows[0]);
    });
  });
});
