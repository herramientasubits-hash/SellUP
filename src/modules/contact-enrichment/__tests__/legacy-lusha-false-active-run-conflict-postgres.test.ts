/**
 * legacy-lusha-false-active-run-conflict-postgres.test.ts
 * (Agente 2A · AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1)
 *
 * ═══════════════════════════════════════════════════════════════
 * POR QUÉ ESTA SUITE EXISTE
 * ═══════════════════════════════════════════════════════════════
 *
 * El defecto vivía en la FRONTERA entre el TypeScript y el SQL: el core construía dos
 * patas con operaciones distintas, y el serializador de `p_legs` no enviaba
 * `operation_key`. Ningún doble puede demostrar eso, porque un doble reproduce lo que
 * su autor ya entendió. Lo único que lo demuestra es EJECUTAR la función real de la
 * migración 124 —la misma que está viva en Producción— contra un PostgreSQL de verdad y
 * mirar qué devuelve.
 *
 * Lo que esta suite prueba, en las dos direcciones:
 *
 *   1. CON el payload de ANTES (sin `operation_key`), la 124 devuelve
 *      `already_reserved` y deja 0 corridas y 0 reservas — que es EXACTAMENTE lo que
 *      Producción mostró para el candidato del incidente. Es la reproducción del
 *      defecto, no una descripción suya;
 *   2. CON `operation_key`, la MISMA función, el MISMO candidato y el MISMO pozo
 *      devuelven `created`, con UNA corrida y DOS patas — una de búsqueda y una de
 *      teléfono.
 *
 * El caso (1) se conserva a propósito. Es la prueba en NEGATIVO: si alguien vuelve a
 * quitar el campo del serializador, el test de arriba dice que la colisión sigue siendo
 * real y el de la suite offline dice que las patas dejaron de ser distintas. Sin el
 * caso negativo, un `created` verde no distingue «lo arreglamos» de «la unicidad dejó de
 * existir».
 *
 * SIN PII, SIN RED y SIN PROVEEDORES: los datos son sintéticos, no se llama a Apollo ni
 * a Lusha, no se toca Supabase remoto y no se gasta un crédito.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  PLATFORM_BOOTSTRAP_SQL,
  SUPABASE_ROLES_SQL,
  readMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/phone-reveal-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, '../../../..');

/**
 * La cadena mínima que declara la tabla de corridas, la de reservas y la RPC, y que
 * después la RE-GRAÑA con la 124 — la versión VIVA en Producción.
 */
const CHAIN = [
  '102_phone_reveal_waterfall_runs.sql',
  '103_phone_reveal_waterfall_legacy_mode.sql',
  '104_phone_reveal_credit_reservations.sql',
  '109_contact_enrichment_candidate_phones.sql',
  '122_phone_reveal_search_more.sql',
  '124_cross_provider_phone_identity.sql',
] as const;

const harness = resolveEmbeddedPostgres(import.meta.url);
const PORT = 54421;

describe(
  'AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1 — la 124 REAL',
  { skip: harness.skip },
  () => {
    let postgres: EmbeddedPostgresLike | undefined;
    let client: PgLikeClient | undefined;
    let dataDir: string | undefined;

    const ACCOUNT_ID = randomUUID();
    const RUN_ID = randomUUID();
    const ADMIN_ID = randomUUID();
    const CANDIDATE_ID = randomUUID();

    /** El pozo de Lusha, holgado a propósito: lo que se prueba NO es el presupuesto. */
    const POOL = {
      limit_credits: 500,
      consumed_credits: 0,
      scope_type: 'global',
      scope_id: null,
      period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-09-01T00:00:00.000Z',
    };

    const sql = async (text: string, values?: unknown[]) => {
      const { rows } = await client!.query(text, values);
      return rows;
    };

    before(async () => {
      const Ctor = harness.ctor!;
      dataDir = mkdtempSync(join(tmpdir(), 'a2a-false-active-run-'));
      postgres = new Ctor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: PORT,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();

      await client.query(SUPABASE_ROLES_SQL);
      await client.query(PLATFORM_BOOTSTRAP_SQL);
      // Los STUBS de una columna del bootstrap se descartan: 102 y 104 usan
      // `CREATE TABLE IF NOT EXISTS`, así que con el stub presente declararían sus
      // columnas sobre nada y la RPC operaría contra una tabla vacía de significado.
      await client.query(
        'DROP TABLE IF EXISTS public.phone_reveal_credit_reservations CASCADE;',
      );
      await client.query(
        'DROP TABLE IF EXISTS public.phone_reveal_waterfall_runs CASCADE;',
      );

      for (const file of CHAIN) {
        try {
          await client.query(readMigration(REPO_ROOT, file));
        } catch (err) {
          const code = (err as { code?: string }).code ?? 'sin SQLSTATE';
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`la migración ${file} NO aplica [${code}]: ${message}`);
        }
      }

      await sql('INSERT INTO public.accounts (id) VALUES ($1)', [ACCOUNT_ID]);
      await sql('INSERT INTO public.internal_users (id) VALUES ($1)', [ADMIN_ID]);
      await sql(
        'INSERT INTO public.contact_enrichment_runs (id, account_id) VALUES ($1, $2)',
        [RUN_ID, ACCOUNT_ID],
      );
      await sql(
        'INSERT INTO public.contact_enrichment_candidates (id, enrichment_run_id) VALUES ($1, $2)',
        [CANDIDATE_ID, RUN_ID],
      );
    });

    after(async () => {
      if (client) await client.end().catch(() => {});
      if (postgres) await postgres.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    /** Llama a la RPC REAL y devuelve el envoltorio + el estado durable resultante. */
    async function reserveAndCreate(legs: unknown[]) {
      const groupId = randomUUID();
      const rows = await sql(
        `SELECT public.reserve_and_create_phone_reveal_run($1,$2,$3,$4,$5::jsonb,$6::jsonb) AS envelope`,
        [
          CANDIDATE_ID,
          ADMIN_ID,
          randomUUID(),
          groupId,
          JSON.stringify(legs),
          JSON.stringify({
            candidate_id: CANDIDATE_ID,
            status: 'lusha_pending',
            run_mode: 'legacy_lusha_only',
            authorized_at: '2026-08-24T12:00:00.000Z',
            authorized_by: ADMIN_ID,
            authorized_by_role: 'admin',
            max_credits_authorized: 6,
            apollo_attempted_at: null,
            apollo_outcome: 'no_phone_found',
            apollo_cost_credits: null,
            apollo_cost_source: 'unknown',
            lusha_eligible: true,
            lusha_skipped_reason: null,
            credit_reservation_group_id: groupId,
          }),
        ],
      );
      const envelope = (rows[0] as { envelope: { status: string } }).envelope;
      const [runs] = (await sql(
        'SELECT count(*)::int AS n FROM public.phone_reveal_waterfall_runs WHERE candidate_id = $1',
        [CANDIDATE_ID],
      )) as { n: number }[];
      const [reservations] = (await sql(
        'SELECT count(*)::int AS n FROM public.phone_reveal_credit_reservations WHERE candidate_id = $1',
        [CANDIDATE_ID],
      )) as { n: number }[];
      return { envelope, runs: runs.n, reservations: reservations.n };
    }

    /** Las DOS patas Lusha de la modalidad de Luis, SIN la operación. El defecto. */
    const LEGS_WITHOUT_OPERATION = [
      { provider_key: 'lusha', credits: 1, ...POOL },
      { provider_key: 'lusha', credits: 5, ...POOL },
    ];

    /** Las MISMAS dos patas, con su operación. Lo que el core siempre quiso decir. */
    const LEGS_WITH_OPERATION = [
      { provider_key: 'lusha', operation_key: 'contact_search', credits: 1, ...POOL },
      { provider_key: 'lusha', operation_key: 'phone_reveal', credits: 5, ...POOL },
    ];

    it('la unicidad viva es (candidate, provider, operation): la 124 ya la re-grañó', async () => {
      const rows = (await sql(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'phone_reveal_credit_reservations'
            AND indexname LIKE 'uq_%'
          ORDER BY indexname`,
      )) as { indexname: string }[];

      assert.deepEqual(
        rows.map((row) => row.indexname),
        [
          'uq_phone_reveal_credit_reservations_active_op',
          'uq_phone_reveal_credit_reservations_group_op',
        ],
        'los índices por (proveedor) a secas ya no existen: la operación forma parte de la identidad',
      );
    });

    // ── EL DEFECTO, REPRODUCIDO ────────────────────────────────
    it('SIN operation_key las dos patas Lusha colisionan: already_reserved y 0 filas', async () => {
      const { envelope, runs, reservations } = await reserveAndCreate(
        LEGS_WITHOUT_OPERATION,
      );

      // Las dos patas aterrizan como la MISMA operación (`COALESCE(...,'phone_reveal')`),
      // la segunda choca con la primera dentro de su propia transacción y el bloque
      // interno lo deshace todo.
      assert.equal(
        envelope.status,
        'already_reserved',
        'la colisión de la segunda pata se reporta como reserva ya existente',
      );

      // Y ESTA es la parte que hacía indiagnosticable el incidente: no queda ni rastro.
      // El operador leía «ya hay una revelación en proceso» y la base decía 0 y 0.
      assert.equal(runs, 0, 'el rollback no dejó corrida');
      assert.equal(reservations, 0, 'el rollback no dejó reserva');
    });

    // ── EL ARREGLO, SOBRE LA MISMA FUNCIÓN ─────────────────────
    it('CON operation_key la MISMA función crea la corrida y sus DOS patas', async () => {
      const { envelope, runs, reservations } = await reserveAndCreate(
        LEGS_WITH_OPERATION,
      );

      assert.equal(envelope.status, 'created');
      assert.equal(runs, 1, 'UNA corrida');
      assert.equal(reservations, 2, 'búsqueda + teléfono, dos filas distinguibles');

      const legs = (await sql(
        // `credits_reserved` es `numeric`, y el driver devuelve `numeric` como STRING
        // para no perder precisión. Se castea en SQL en vez de convertir en JS: lo que
        // se compara así es la cifra que la base guardó, sin un paso intermedio que
        // pudiera enmascarar un valor inesperado.
        `SELECT provider_key, operation_key, credits_reserved::int AS credits_reserved, status
           FROM public.phone_reveal_credit_reservations
          WHERE candidate_id = $1
          ORDER BY operation_key`,
        [CANDIDATE_ID],
      )) as {
        provider_key: string;
        operation_key: string;
        credits_reserved: number;
        status: string;
      }[];

      assert.deepEqual(
        legs.map((leg) => [leg.provider_key, leg.operation_key, leg.credits_reserved]),
        [
          ['lusha', 'contact_search', 1],
          ['lusha', 'phone_reveal', 5],
        ],
        'el ledger conserva el desglose: 1 de búsqueda y 5 de teléfono, no un 6 opaco',
      );
      for (const leg of legs) assert.equal(leg.status, 'reserved');
    });

    it('la corrida creada es legacy con tope 6 y sin Apollo atribuido', async () => {
      const [run] = (await sql(
        `SELECT run_mode, max_credits_authorized, apollo_attempted_at, status
           FROM public.phone_reveal_waterfall_runs
          WHERE candidate_id = $1`,
        [CANDIDATE_ID],
      )) as {
        run_mode: string;
        max_credits_authorized: number;
        apollo_attempted_at: string | null;
        status: string;
      }[];

      assert.equal(run.run_mode, 'legacy_lusha_only');
      assert.equal(run.max_credits_authorized, 6, 'nunca 8, 13 ni 14');
      assert.equal(run.apollo_attempted_at, null, 'Apollo no corre bajo esta autorización');
      assert.equal(run.status, 'lusha_pending');
    });
  },
);
