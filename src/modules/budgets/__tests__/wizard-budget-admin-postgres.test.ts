// Agente 1 — LA MIGRACIÓN 137 CONTRA UN PostgreSQL REAL Y EFÍMERO
// (AGENT1-WIZARD-BUDGET-ADMIN-F1B)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ ESTE ARCHIVO EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// Las dos afirmaciones centrales del hito son de COMPORTAMIENTO de la base y no
// se pueden comprobar leyendo el diff:
//
//   1. que la 137 sea ADITIVA de verdad — que aplique sobre la cadena real
//      (064 → 121), que se pueda re-aplicar, y que después de aplicarla la
//      reserva atómica siga decidiendo EXACTAMENTE lo mismo:
//      `insufficient_budget`, `execution_limit_exceeded`, `period_closed`,
//      `concurrent_execution_active`, la idempotencia y el
//      `confirmed_with_overage` de la 121. Una migración que rompiera una de
//      esas seis seguiría pareciendo aditiva en la revisión;
//
//   2. que la superficie administrativa NO PUEDA mover `credits_consumed` ni
//      `credits_reserved`. Eso es una lista de columnas que hay que ver aplicada
//      sobre contadores distintos de cero, no una promesa en un comentario.
//
// Y una tercera que el repo ya aprendió a exigir: que la migración APLIQUE. El
// lexer de comillas mide PARIDAD, no sintaxis — un apóstrofo mal puesto dentro
// de un `COMMENT ON` deja una suite estática en verde y PostgreSQL en 42601. La
// 137 lleva varios `COMMENT ON`.
//
// QUÉ REPRODUCE: PostgreSQL 17, los tres roles de Supabase con `service_role`
// BYPASSRLS, y la cadena REAL leída verbatim de `supabase/migrations`.
//
// DATOS SINTÉTICOS. Ni una fila viene de Producción. No se llama a Apollo,
// Tavily, Lusha ni HubSpot; no se lee un flag; no se toca ninguna base remota;
// no se gasta un crédito.
//
// ARNÉS OPCIONAL EN LOCAL, OBLIGATORIO EN EL CHECK:
//   npm install --no-save embedded-postgres@17.6.0-beta.15
//   npm run test:a1-wizard-budget-admin:postgres

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyWizardBudgetRealChain,
  bootstrapPlatform,
  MIGRATION_064,
  MIGRATION_121,
  readMigration as readChainMigration,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from '../../prospect-batches/chat-wizard-execution/__tests__/support/wizard-budget-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → budgets → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');

const MIGRATION_137 = '137_wizard_budget_period_admin_audit.sql';

/**
 * La cadena de ESTE hito. No se modifica `WIZARD_BUDGET_REAL_CHAIN` del módulo
 * compartido: eso cambiaría lo que reproducen las suites de la 121, que miden
 * otra cosa.
 */
const CHAIN_WITH_137 = [MIGRATION_064, MIGRATION_121, MIGRATION_137] as const;

const PERIOD = '2026-09-01';
const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000a2';
const ADMIN = '00000000-0000-4000-8000-0000000000a9';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } =
  resolveEmbeddedPostgres(import.meta.url);

let client: PgLikeClient;
let postgres: EmbeddedPostgresLike;
let dataDir = '';

const apply137 = () => client.query(readChainMigration(repoRoot, MIGRATION_137));

const rowsOf = async (sql: string, values?: unknown[]) =>
  (await client.query(sql, values)).rows;

const scalar = async <T>(sql: string, values?: unknown[]): Promise<T> => {
  const { rows } = await client.query(sql, values);
  return Object.values(rows[0])[0] as T;
};

type PeriodRow = {
  budget_credits: number;
  credits_reserved: number;
  credits_consumed: number;
  is_closed: boolean;
  updated_by: string | null;
};

const readPeriod = async (): Promise<PeriodRow | undefined> => {
  const [row] = await rowsOf(
    `SELECT budget_credits, credits_reserved, credits_consumed, is_closed, updated_by
       FROM public.wizard_monthly_budget_periods WHERE period_start = $1`,
    [PERIOD],
  );
  return row as unknown as PeriodRow | undefined;
};

const readChanges = async () =>
  (await rowsOf(
    `SELECT period_start, changed_by,
            previous_budget_credits, new_budget_credits,
            previous_is_closed, new_is_closed,
            previous_max_credits_per_execution, new_max_credits_per_execution
       FROM public.wizard_budget_period_changes
      ORDER BY changed_at ASC, ctid ASC`,
  )) as unknown as Record<string, unknown>[];

const setBudgetVia = (credits: number, closed: boolean, by: string | null = ADMIN) =>
  scalar<string>(`SELECT public.admin_set_wizard_budget_period($1, $2, $3, $4)`, [
    PERIOD,
    credits,
    closed,
    by,
  ]);

const setMaxCreditsVia = (max: number, by: string | null = ADMIN) =>
  scalar<string>(`SELECT public.admin_set_wizard_max_credits_per_execution($1, $2, $3)`, [
    PERIOD,
    max,
    by,
  ]);

const reserveVia = async (
  userId: string,
  credits: number,
  clientRequestId: string,
): Promise<{ code: string; id: string | null }> => {
  const code = await scalar<string>(
    `SELECT public.try_reserve_wizard_credits($1, $2, $3, $4)`,
    [userId, clientRequestId, credits, PERIOD],
  );
  if (code !== 'reserved') return { code, id: null };
  const id = await scalar<string>(
    `SELECT id FROM public.wizard_budget_reservations
       WHERE user_id = $1 AND client_request_id = $2`,
    [userId, clientRequestId],
  );
  return { code, id };
};

const confirmVia = (reservationId: string, actual: number) =>
  scalar<string>(`SELECT public.confirm_wizard_credits($1, $2, $3)`, [
    reservationId,
    actual,
    null,
  ]);

const releaseVia = (reservationId: string) =>
  scalar<string>(`SELECT public.release_wizard_credits($1, NULL, NULL)`, [reservationId]);

/**
 * Estado limpio por prueba. Se hace con SQL directo y no por las RPC porque
 * varias pruebas necesitan empezar en estados que las RPC no producirían.
 */
const resetState = async (opts?: {
  budgetCredits?: number;
  consumed?: number;
  reserved?: number;
  isClosed?: boolean;
  withPeriod?: boolean;
}) => {
  await client.query(`DELETE FROM public.wizard_budget_reservations`);
  await client.query(`DELETE FROM public.wizard_budget_period_changes`);
  await client.query(`DELETE FROM public.wizard_monthly_budget_periods`);
  if (opts?.withPeriod !== false) {
    await client.query(
      `INSERT INTO public.wizard_monthly_budget_periods
         (period_start, budget_credits, credits_reserved, credits_consumed, is_closed)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        PERIOD,
        opts?.budgetCredits ?? 100,
        opts?.reserved ?? 0,
        opts?.consumed ?? 0,
        opts?.isClosed ?? false,
      ],
    );
  }
  await client.query(
    `UPDATE public.wizard_pilot_settings
        SET pilot_enabled = true, max_credits_per_execution = 25, updated_by = NULL`,
  );
};

describe(
  '137 — superficie administrativa del presupuesto del Wizard contra PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    before(async () => {
      dataDir = mkdtempSync(join(tmpdir(), 'pg-wizard-budget-admin-'));
      postgres = new EmbeddedPostgresCtor!({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54731 + Math.floor(process.pid % 100),
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();
      await bootstrapPlatform(client);
      // La cadena REAL, verbatim: 064 → 121 → 137.
      await applyWizardBudgetRealChain(client, repoRoot, CHAIN_WITH_137);
      await client.query(
        `INSERT INTO public.internal_users (id) VALUES ($1), ($2), ($3) ON CONFLICT DO NOTHING`,
        [USER_A, USER_B, ADMIN],
      );
      await client.query(
        `INSERT INTO public.wizard_pilot_participants (user_id, is_enabled)
           VALUES ($1, true), ($2, true) ON CONFLICT DO NOTHING`,
        [USER_A, USER_B],
      );
    });

    after(async () => {
      if (client) await client.end().catch(() => undefined);
      if (postgres) await postgres.stop().catch(() => undefined);
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await resetState();
    });

    // ═══════════════════════════════════════════════════════════
    // § 1 — Aplicabilidad y forma
    // ═══════════════════════════════════════════════════════════

    describe('§ 1 — la 137 aplica y es repetible', () => {
      it('aplicó sobre 064 → 121 (llegar aquí ya lo demuestra)', async () => {
        const exists = await scalar<boolean>(
          `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'admin_set_wizard_budget_period')`,
        );
        assert.equal(exists, true);
      });

      it('re-aplicarla no duplica nada', async () => {
        await apply137();
        await apply137();
        const tables = await scalar<string>(
          `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = 'wizard_budget_period_changes'`,
        );
        assert.equal(Number(tables), 1);
        const columns = await scalar<string>(
          `SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'wizard_monthly_budget_periods'
              AND column_name = 'updated_by'`,
        );
        assert.equal(Number(columns), 1);
      });

      it('agrega updated_by al período sin tocar created_by', async () => {
        const cols = (await rowsOf(
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'wizard_monthly_budget_periods'
              AND column_name IN ('created_by', 'updated_by')
            ORDER BY column_name`,
        )) as unknown as { column_name: string; is_nullable: string }[];
        assert.deepEqual(
          cols.map((c) => c.column_name),
          ['created_by', 'updated_by'],
        );
        assert.ok(cols.every((c) => c.is_nullable === 'YES'));
      });

      it('la bitácora registra old → new de los tres campos administrables', async () => {
        const cols = (await rowsOf(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'wizard_budget_period_changes'`,
        )) as unknown as { column_name: string }[];
        const names = cols.map((c) => c.column_name);
        for (const required of [
          'id',
          'period_start',
          'changed_by',
          'changed_at',
          'previous_budget_credits',
          'new_budget_credits',
          'previous_is_closed',
          'new_is_closed',
          'previous_max_credits_per_execution',
          'new_max_credits_per_execution',
        ]) {
          assert.ok(names.includes(required), `falta ${required}`);
        }
        // Los contadores de gasto NO son administrables y no tienen columna.
        assert.ok(!names.some((n) => n.includes('consumed') && n.includes('credits_consumed')));
      });

      it('las tres RPC de reserva siguen existiendo, una sola vez cada una', async () => {
        for (const fn of [
          'try_reserve_wizard_credits',
          'confirm_wizard_credits',
          'release_wizard_credits',
        ]) {
          const count = await scalar<string>(
            `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = $1`,
            [fn],
          );
          assert.equal(Number(count), 1, fn);
        }
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 2 — Administrar el presupuesto
    // ═══════════════════════════════════════════════════════════

    describe('§ 2 — el admin administra el pozo', () => {
      it('cambia budget_credits y deja rastro de quién y de qué valor había', async () => {
        assert.equal(await setBudgetVia(53, false), 'updated');

        const period = await readPeriod();
        assert.equal(period!.budget_credits, 53);
        assert.equal(period!.updated_by, ADMIN);

        const changes = await readChanges();
        assert.equal(changes.length, 1);
        assert.equal(changes[0]!.previous_budget_credits, 100);
        assert.equal(changes[0]!.new_budget_credits, 53);
        assert.equal(changes[0]!.changed_by, ADMIN);
      });

      it('crea el período cuando el mes no tiene fila, con contadores en cero', async () => {
        await resetState({ withPeriod: false });

        assert.equal(await setBudgetVia(60, false), 'created');

        const period = await readPeriod();
        assert.equal(period!.budget_credits, 60);
        assert.equal(period!.credits_consumed, 0);
        assert.equal(period!.credits_reserved, 0);

        const changes = await readChanges();
        assert.equal(changes[0]!.previous_budget_credits, null);
        assert.equal(changes[0]!.new_budget_credits, 60);
      });

      it('cierra el período con is_closed y lo registra', async () => {
        assert.equal(await setBudgetVia(100, true), 'updated');

        const period = await readPeriod();
        assert.equal(period!.is_closed, true);

        const changes = await readChanges();
        assert.equal(changes[0]!.previous_is_closed, false);
        assert.equal(changes[0]!.new_is_closed, true);
      });

      it('un presupuesto de 0 se rechaza: cerrar es is_closed, no 0', async () => {
        assert.equal(await setBudgetVia(0, false), 'invalid_budget_credits');

        const period = await readPeriod();
        assert.equal(period!.budget_credits, 100, 'nada debe haber cambiado');
        assert.deepEqual(await readChanges(), []);
      });

      it('un valor negativo se rechaza igual', async () => {
        assert.equal(await setBudgetVia(-5, false), 'invalid_budget_credits');
        assert.equal((await readPeriod())!.budget_credits, 100);
      });

      it('guardar lo mismo no escribe una fila de bitácora falsa', async () => {
        assert.equal(await setBudgetVia(100, false), 'no_change');
        assert.deepEqual(await readChanges(), []);
      });

      it('cambia max_credits_per_execution con UPDATE, sin crear una segunda fila', async () => {
        assert.equal(await setMaxCreditsVia(20), 'updated');

        const rows = (await rowsOf(
          `SELECT max_credits_per_execution, updated_by FROM public.wizard_pilot_settings`,
        )) as unknown as { max_credits_per_execution: number; updated_by: string | null }[];
        assert.equal(rows.length, 1, 'el singleton sigue siendo uno');
        assert.equal(rows[0]!.max_credits_per_execution, 20);
        assert.equal(rows[0]!.updated_by, ADMIN);

        const changes = await readChanges();
        assert.equal(changes[0]!.previous_max_credits_per_execution, 25);
        assert.equal(changes[0]!.new_max_credits_per_execution, 20);
        assert.equal(changes[0]!.previous_budget_credits, null);
      });

      it('el techo por ejecución en 0 se rechaza', async () => {
        assert.equal(await setMaxCreditsVia(0), 'invalid_max_credits');
        const current = await scalar<number>(
          `SELECT max_credits_per_execution FROM public.wizard_pilot_settings`,
        );
        assert.equal(Number(current), 25);
      });

      it('guardar el mismo techo no escribe bitácora', async () => {
        assert.equal(await setMaxCreditsVia(25), 'no_change');
        assert.deepEqual(await readChanges(), []);
      });

      it('el techo se puede cambiar aunque el mes no tenga período', async () => {
        await resetState({ withPeriod: false });
        assert.equal(await setMaxCreditsVia(18), 'updated');
        const changes = await readChanges();
        assert.equal(changes[0]!.new_max_credits_per_execution, 18);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 3 — Los contadores de gasto son intocables desde aquí
    // ═══════════════════════════════════════════════════════════

    describe('§ 3 — credits_consumed / credits_reserved no son configurables', () => {
      it('subir el presupuesto no mueve los contadores', async () => {
        await resetState({ budgetCredits: 53, consumed: 49, reserved: 3 });

        assert.equal(await setBudgetVia(200, false), 'updated');

        const period = await readPeriod();
        assert.equal(period!.budget_credits, 200);
        assert.equal(period!.credits_consumed, 49, 'el gasto ya ocurrido no se edita');
        assert.equal(period!.credits_reserved, 3, 'la exposición viva no se edita');
      });

      it('bajar el presupuesto tampoco los mueve', async () => {
        await resetState({ budgetCredits: 200, consumed: 49, reserved: 3 });

        assert.equal(await setBudgetVia(53, false), 'updated');

        const period = await readPeriod();
        assert.equal(period!.credits_consumed, 49);
        assert.equal(period!.credits_reserved, 3);
      });

      it('cerrar el período no los mueve', async () => {
        await resetState({ budgetCredits: 53, consumed: 49, reserved: 3 });

        await setBudgetVia(53, true);

        const period = await readPeriod();
        assert.equal(period!.credits_consumed, 49);
        assert.equal(period!.credits_reserved, 3);
      });

      it('sólo las RPC de reserva los mueven', async () => {
        await resetState({ budgetCredits: 100 });

        const { code, id } = await reserveVia(USER_A, 10, '00000000-0000-4000-8000-00000000e001');
        assert.equal(code, 'reserved');
        assert.equal((await readPeriod())!.credits_reserved, 10);

        assert.equal(await confirmVia(id!, 7), 'confirmed');
        const after = await readPeriod();
        assert.equal(after!.credits_reserved, 0);
        assert.equal(after!.credits_consumed, 7);
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 4 — La bitácora es append-only
    // ═══════════════════════════════════════════════════════════

    describe('§ 4 — append-only de verdad', () => {
      it('service_role puede insertar y leer', async () => {
        for (const priv of ['INSERT', 'SELECT']) {
          const allowed = await scalar<boolean>(
            `SELECT has_table_privilege('service_role', 'public.wizard_budget_period_changes', $1)`,
            [priv],
          );
          assert.equal(allowed, true, priv);
        }
      });

      it('ni siquiera service_role puede reescribir o borrar la bitácora', async () => {
        for (const priv of ['UPDATE', 'DELETE', 'TRUNCATE']) {
          const allowed = await scalar<boolean>(
            `SELECT has_table_privilege('service_role', 'public.wizard_budget_period_changes', $1)`,
            [priv],
          );
          assert.equal(allowed, false, `service_role no puede ${priv}: una bitácora reescribible no es bitácora`);
        }
      });

      it('anon y authenticated no la ven en absoluto', async () => {
        for (const role of ['anon', 'authenticated']) {
          for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
            const allowed = await scalar<boolean>(
              `SELECT has_table_privilege($1, 'public.wizard_budget_period_changes', $2)`,
              [role, priv],
            );
            assert.equal(allowed, false, `${role} / ${priv}`);
          }
        }
      });

      it('una fila de bitácora vacía está prohibida por constraint', async () => {
        await assert.rejects(
          () =>
            client.query(
              `INSERT INTO public.wizard_budget_period_changes (period_start, changed_by)
                 VALUES ($1, $2)`,
              [PERIOD, ADMIN],
            ),
          (err: { code?: string }) => err.code === '23514',
        );
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 5 — Las funciones nuevas no son alcanzables por el navegador
    // ═══════════════════════════════════════════════════════════

    describe('§ 5 — alcance de las funciones administrativas', () => {
      const SIGNATURES = [
        'public.admin_set_wizard_budget_period(date, integer, boolean, uuid)',
        'public.admin_set_wizard_max_credits_per_execution(date, integer, uuid)',
      ];

      it('anon y authenticated no pueden ejecutarlas', async () => {
        for (const sig of SIGNATURES) {
          for (const role of ['anon', 'authenticated']) {
            const allowed = await scalar<boolean>(
              `SELECT has_function_privilege($1, $2, 'EXECUTE')`,
              [role, sig],
            );
            assert.equal(allowed, false, `${role} → ${sig}`);
          }
        }
      });

      it('service_role sí puede', async () => {
        for (const sig of SIGNATURES) {
          const allowed = await scalar<boolean>(
            `SELECT has_function_privilege('service_role', $1, 'EXECUTE')`,
            [sig],
          );
          assert.equal(allowed, true, sig);
        }
      });

      it('las tablas del presupuesto siguen sin policy para authenticated', async () => {
        const rows = (await rowsOf(
          `SELECT tablename, roles::text AS roles FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename IN ('wizard_monthly_budget_periods', 'wizard_pilot_settings',
                                'wizard_budget_reservations', 'wizard_budget_period_changes')`,
        )) as unknown as { tablename: string; roles: string }[];
        assert.ok(rows.length > 0);
        for (const row of rows) {
          assert.ok(!row.roles.includes('authenticated'), `${row.tablename}: ${row.roles}`);
          assert.ok(!row.roles.includes('anon'), `${row.tablename}: ${row.roles}`);
        }
      });
    });

    // ═══════════════════════════════════════════════════════════
    // § 6 — La reserva atómica decide EXACTAMENTE lo mismo que antes
    // ═══════════════════════════════════════════════════════════

    describe('§ 6 — semántica del gate intacta después de la 137', () => {
      it('una corrida que cabe se reserva', async () => {
        const { code } = await reserveVia(USER_A, 10, '00000000-0000-4000-8000-00000000f001');
        assert.equal(code, 'reserved');
      });

      it('insufficient_budget sigue bloqueando', async () => {
        await resetState({ budgetCredits: 12, consumed: 9, reserved: 0 });
        const { code } = await reserveVia(USER_A, 10, '00000000-0000-4000-8000-00000000f002');
        assert.equal(code, 'insufficient_budget');
      });

      it('la exposición ya reservada cuenta para el bloqueo', async () => {
        await resetState({ budgetCredits: 20, consumed: 0, reserved: 15 });
        const { code } = await reserveVia(USER_A, 10, '00000000-0000-4000-8000-00000000f003');
        assert.equal(code, 'insufficient_budget');
      });

      it('execution_limit_exceeded sigue funcionando', async () => {
        const { code } = await reserveVia(USER_A, 26, '00000000-0000-4000-8000-00000000f004');
        assert.equal(code, 'execution_limit_exceeded');
      });

      it('el techo que el admin acaba de guardar es el que aplica la reserva', async () => {
        await setMaxCreditsVia(12);
        const blocked = await reserveVia(USER_A, 13, '00000000-0000-4000-8000-00000000f005');
        assert.equal(blocked.code, 'execution_limit_exceeded');
        const allowed = await reserveVia(USER_A, 12, '00000000-0000-4000-8000-00000000f006');
        assert.equal(allowed.code, 'reserved');
      });

      it('period_closed sigue funcionando, y el cierre administrativo lo produce', async () => {
        await setBudgetVia(100, true);
        const { code } = await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f007');
        assert.equal(code, 'period_closed');
      });

      it('reabrir el período desde la superficie vuelve a permitir reservar', async () => {
        await setBudgetVia(100, true);
        assert.equal(
          (await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f008')).code,
          'period_closed',
        );
        await setBudgetVia(100, false);
        assert.equal(
          (await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f009')).code,
          'reserved',
        );
      });

      it('el presupuesto que el admin acaba de guardar es el que compara la reserva', async () => {
        await resetState({ budgetCredits: 5 });
        assert.equal(
          (await reserveVia(USER_A, 20, '00000000-0000-4000-8000-00000000f010')).code,
          'insufficient_budget',
        );
        await setBudgetVia(60, false);
        assert.equal(
          (await reserveVia(USER_A, 20, '00000000-0000-4000-8000-00000000f011')).code,
          'reserved',
        );
      });

      it('concurrent_execution_active sigue protegiendo al mismo usuario', async () => {
        await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f012');
        const second = await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f013');
        assert.equal(second.code, 'concurrent_execution_active');
      });

      it('otro usuario no queda bloqueado por la reserva del primero', async () => {
        await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f014');
        const other = await reserveVia(USER_B, 5, '00000000-0000-4000-8000-00000000f015');
        assert.equal(other.code, 'reserved');
      });

      it('la idempotencia de la reserva sigue intacta', async () => {
        const req = '00000000-0000-4000-8000-00000000f016';
        assert.equal((await reserveVia(USER_A, 5, req)).code, 'reserved');
        assert.equal((await reserveVia(USER_A, 5, req)).code, 'already_reserved');
        const reservations = await scalar<string>(
          `SELECT count(*) FROM public.wizard_budget_reservations WHERE client_request_id = $1`,
          [req],
        );
        assert.equal(Number(reservations), 1);
      });

      it('la idempotencia de la confirmación sigue intacta y no cuenta dos veces', async () => {
        const { id } = await reserveVia(USER_A, 10, '00000000-0000-4000-8000-00000000f017');
        assert.equal(await confirmVia(id!, 7), 'confirmed');
        assert.equal(await confirmVia(id!, 7), 'already_confirmed');
        assert.equal((await readPeriod())!.credits_consumed, 7);
      });

      it('confirmed_with_overage (migración 121) sigue liquidando el gasto REAL', async () => {
        const { id } = await reserveVia(USER_A, 5, '00000000-0000-4000-8000-00000000f018');
        assert.equal(await confirmVia(id!, 7), 'confirmed_with_overage');
        const period = await readPeriod();
        assert.equal(period!.credits_consumed, 7, 'el gasto real completo, no recortado a 5');
        assert.equal(period!.credits_reserved, 0);
      });

      it('release sigue devolviendo los créditos al pozo', async () => {
        const { id } = await reserveVia(USER_A, 10, '00000000-0000-4000-8000-00000000f019');
        assert.equal(await releaseVia(id!), 'released');
        const period = await readPeriod();
        assert.equal(period!.credits_reserved, 0);
        assert.equal(period!.credits_consumed, 0);
      });

      it('la superficie administrativa no escribe ni una fila de reserva', async () => {
        await setBudgetVia(77, false);
        await setMaxCreditsVia(15);
        const reservations = await scalar<string>(
          `SELECT count(*) FROM public.wizard_budget_reservations`,
        );
        assert.equal(Number(reservations), 0);
      });
    });
  },
);
