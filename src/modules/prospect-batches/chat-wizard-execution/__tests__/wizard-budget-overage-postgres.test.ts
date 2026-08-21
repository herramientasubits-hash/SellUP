/**
 * Verificación de la migración 121 contra un PostgreSQL REAL y efímero
 * (Agente 1 · AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1)
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE (y por qué una suite estática no basta)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Todo lo que la 121 afirma es COMPORTAMIENTO de la base de datos:
 *
 *   * que un `credits_consumed > credits_reserved` sea RECHAZADO mientras la reserva
 *     está viva y ACEPTADO una vez confirmada. Eso es un 23514 que hay que provocar;
 *     leer la constraint no distingue «la escribí bien» de «PostgreSQL la evalúa
 *     cuando yo creo». En particular, la propiedad de la que depende el arreglo —que
 *     un solo UPDATE que mueve `status` y `credits_consumed` juntos se valide contra
 *     la fila FINAL, no contra un estado intermedio— es exactamente el tipo de cosa
 *     que un diff no puede demostrar;
 *   * que el período reciba el gasto real COMPLETO (7, no 6). Un clamp cabe en una
 *     línea y deja el mismo aspecto en la revisión;
 *   * que la corrida SIGUIENTE quede bloqueada cuando el período se sobregira. El
 *     bloqueo no lo produce ninguna constraint: lo produce la ARITMÉTICA del paso 10
 *     de `try_reserve_wizard_credits`. Hay que ejecutar la RPC contra el período ya
 *     sobregirado y ver el `insufficient_budget`;
 *   * que la reserva llegue a un estado TERMINAL. Ésa es la mitad que dolía: el
 *     índice único parcial `(user_id) WHERE status = 'reserved'` y el paso 9 de la
 *     reserva convierten una reserva atascada en `concurrent_execution_active` para
 *     SIEMPRE. Se comprueba reservando otra vez de verdad;
 *   * y que la idempotencia impida contar el sobrepaso DOS veces: el segundo
 *     `confirm` tiene que devolver `already_confirmed` y no mover un solo contador.
 *
 * Y una afirmación más, la que el hito de al lado demostró que hace falta: que la 121
 * APLIQUE. El lexer de comillas del repo mide PARIDAD, no sintaxis — en la 120 un
 * apóstrofo sin escapar dentro de un `COMMENT ON TABLE` dejaba la suite estática en
 * verde y PostgreSQL en 42601. Aquí la 121 lleva varios `COMMENT ON`, así que ese
 * riesgo es el mismo.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6; este arnés: `embedded-postgres@17.6.0-beta.15`);
 *   * los tres roles de Supabase, con `service_role` BYPASSRLS como en la plataforma;
 *   * la CADENA REAL, verbatim: 064 y 121, leídas de `supabase/migrations` sin
 *     recortes ni slices. Sólo se levanta a mano el borde AJENO a la cadena
 *     (`set_updated_at`, `internal_users`, `prospect_batches`), y no por comodidad:
 *     la 002 declara una FK contra `auth.users`, que pertenece a la plataforma
 *     Supabase y que ninguna migración del repo crea.
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción, ni un presupuesto real se leyó
 * para escribir estos fixtures. No se llama a Lusha, ni a Apollo, ni a Tavily; no se
 * lee un flag; no se toca Producción ni ninguna base remota; no se gasta un crédito.
 *
 * ARNÉS OBLIGATORIO EN CI. `embedded-postgres` no es dependencia del repo —
 * descargaría un binario de PostgreSQL en cada `npm ci` de cualquier check—, pero el
 * paso del check obligatorio lo instala PINCHADO y corre esta suite con
 * `SELLUP_REQUIRE_POSTGRES_HARNESS`, que convierte el skip en FALLO. En local, sin la
 * variable, el archivo se SALTA con un motivo explícito:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent1:budget-overage-reconciliation:postgres
 */

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
} from './support/wizard-budget-real-migration-chain';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → chat-wizard-execution → prospect-batches → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..');

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const PERIOD = '2026-08-01';
const USER_A = '00000000-0000-4000-8000-0000000000c1';
const USER_B = '00000000-0000-4000-8000-0000000000c2';
const BATCH_A = '00000000-0000-4000-8000-0000000000d1';

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } =
  resolveEmbeddedPostgres(import.meta.url);

let client: PgLikeClient;
let postgres: EmbeddedPostgresLike;
let dataDir = '';

const readMigration = (file: string) => readChainMigration(repoRoot, file);
/** Re-aplica el hito VERBATIM (la prueba de repetición lo hace más de una vez). */
const apply121 = () => client.query(readMigration(MIGRATION_121));

const rowsOf = async (sql: string, values?: unknown[]) =>
  (await client.query(sql, values)).rows;

const scalar = async <T>(sql: string, values?: unknown[]): Promise<T> => {
  const { rows } = await client.query(sql, values);
  return Object.values(rows[0])[0] as T;
};

/** Ejecuta y devuelve el SQLSTATE si falla, o null si tuvo éxito. */
const errorCodeOf = async (sql: string, values?: unknown[]): Promise<string | null> => {
  try {
    await client.query(sql, values);
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown';
  }
};

type PeriodCounters = {
  budget_credits: number;
  credits_reserved: number;
  credits_consumed: number;
};

const readPeriod = async (): Promise<PeriodCounters> => {
  const [row] = await rowsOf(
    `SELECT budget_credits, credits_reserved, credits_consumed
       FROM public.wizard_monthly_budget_periods WHERE period_start = $1`,
    [PERIOD],
  );
  return row as unknown as PeriodCounters;
};

type ReservationRow = {
  id: string;
  status: string;
  credits_reserved: number;
  credits_consumed: number;
  batch_id: string | null;
  confirmed_at: string | null;
};

const readReservation = async (id: string): Promise<ReservationRow> => {
  const [row] = await rowsOf(
    `SELECT id, status, credits_reserved, credits_consumed, batch_id, confirmed_at
       FROM public.wizard_budget_reservations WHERE id = $1`,
    [id],
  );
  return row as unknown as ReservationRow;
};

/**
 * Estado limpio por prueba: se re-crea el período y se borran las reservas. Se hace
 * con SQL directo y no con las RPC, porque estas pruebas necesitan poder empezar en
 * estados que las RPC no producirían (por ejemplo un período ya sobregirado).
 */
const resetBudgetState = async (budgetCredits = 289) => {
  await client.query(`DELETE FROM public.wizard_budget_reservations`);
  await client.query(`DELETE FROM public.wizard_monthly_budget_periods`);
  await client.query(
    `INSERT INTO public.wizard_monthly_budget_periods
       (period_start, budget_credits, credits_reserved, credits_consumed)
     VALUES ($1, $2, 0, 0)`,
    [PERIOD, budgetCredits],
  );
};

/** Crea una reserva por la RPC REAL y devuelve su id. */
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

const confirmVia = async (
  reservationId: string,
  actual: number,
  batchId: string | null = null,
): Promise<string> =>
  scalar<string>(`SELECT public.confirm_wizard_credits($1, $2, $3)`, [
    reservationId,
    actual,
    batchId,
  ]);

const releaseVia = async (reservationId: string): Promise<string> =>
  scalar<string>(`SELECT public.release_wizard_credits($1, NULL, NULL)`, [reservationId]);

describe(
  '121 — liquidación con sobrepaso contra PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    before(async () => {
      dataDir = mkdtempSync(join(tmpdir(), 'pg-wizard-budget-overage-'));
      postgres = new EmbeddedPostgresCtor!({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54529 + Math.floor(process.pid % 100),
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();
      client = postgres.getPgClient();
      await client.connect();
      await bootstrapPlatform(client);
      // La cadena REAL, verbatim: 064 y 121.
      await applyWizardBudgetRealChain(client, repoRoot);
      await client.query(
        `INSERT INTO public.internal_users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`,
        [USER_A, USER_B],
      );
      await client.query(
        `INSERT INTO public.prospect_batches (id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [BATCH_A],
      );
      // El piloto tiene que estar ENCENDIDO y los dos usuarios admitidos, o
      // `try_reserve_wizard_credits` devolvería `pilot_paused` / `user_not_allowed` y
      // ninguna de estas pruebas mediría lo que cree. Es la fila sintética de un
      // PostgreSQL efímero: no toca ningún ajuste de Producción.
      await client.query(
        `UPDATE public.wizard_pilot_settings
           SET pilot_enabled = true, max_credits_per_execution = 25`,
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
      await resetBudgetState();
    });

    // ═══════════════════════════════════════════════════════════════
    // § 1 — La migración APLICA sobre la cadena real y es repetible
    // ═══════════════════════════════════════════════════════════════

    describe('§ 1 — aplicabilidad', () => {
      it('la 121 aplica sobre 064 (ya ocurrió en `before`: llegar aquí lo demuestra)', async () => {
        const exists = await scalar<boolean>(
          `SELECT EXISTS (SELECT 1 FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'confirm_wizard_credits')`,
        );
        assert.equal(exists, true);
      });

      it('re-aplicarla es idempotente: la constraint sigue existiendo UNA vez', async () => {
        await apply121();
        await apply121();
        const count = await scalar<string>(
          `SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.wizard_budget_reservations'::regclass
              AND conname = 'wizard_budget_reservations_consumed_bounded_unless_confirmed'`,
        );
        assert.equal(Number(count), 1);
      });

      it('la constraint de la 064 ya NO existe y la de la 121 sí, con el disyunto de confirmed', async () => {
        const old = await scalar<string>(
          `SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.wizard_budget_reservations'::regclass
              AND conname = 'wizard_budget_reservations_consumed_le_reserved'`,
        );
        assert.equal(Number(old), 0, 'la constraint incondicional de la 064 debe desaparecer');

        const def = await scalar<string>(
          `SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'public.wizard_budget_reservations'::regclass
              AND conname = 'wizard_budget_reservations_consumed_bounded_unless_confirmed'`,
        );
        assert.match(def, /credits_consumed <= credits_reserved/);
        assert.match(def, /status = 'confirmed'/);
      });

      it('064 SOLA rechaza el sobrepaso — o sea que la 121 tiene algo real que arreglar', async () => {
        // Prueba de que el defecto existía. Se levanta una base paralela con SÓLO la
        // 064 para no desmontar el esquema con la 121 ya aplicada.
        const baselineDir = mkdtempSync(join(tmpdir(), 'pg-wizard-budget-064-'));
        const baseline = new EmbeddedPostgresCtor!({
          databaseDir: baselineDir,
          user: 'postgres',
          password: 'postgres',
          port: 54729 + Math.floor(process.pid % 100),
          persistent: false,
        });
        try {
          await baseline.initialise();
          await baseline.start();
          const bc = baseline.getPgClient();
          await bc.connect();
          await bootstrapPlatform(bc);
          await bc.query(readMigration(MIGRATION_064));
          await bc.query(
            `INSERT INTO public.internal_users (id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [USER_A],
          );
          await bc.query(
            `UPDATE public.wizard_pilot_settings SET pilot_enabled = true`,
          );
          await bc.query(
            `INSERT INTO public.wizard_pilot_participants (user_id, is_enabled)
               VALUES ($1, true) ON CONFLICT DO NOTHING`,
            [USER_A],
          );
          await bc.query(
            `INSERT INTO public.wizard_monthly_budget_periods
               (period_start, budget_credits) VALUES ($1, 289)`,
            [PERIOD],
          );
          const reqId = '00000000-0000-4000-8000-00000000e001';
          await bc.query(`SELECT public.try_reserve_wizard_credits($1, $2, 6, $3)`, [
            USER_A,
            reqId,
            PERIOD,
          ]);
          const { rows: idRows } = await bc.query(
            `SELECT id FROM public.wizard_budget_reservations WHERE client_request_id = $1`,
            [reqId],
          );
          const resId = idRows[0].id as string;

          const { rows: codeRows } = await bc.query(
            `SELECT public.confirm_wizard_credits($1, 7, NULL) AS code`,
            [resId],
          );
          assert.equal(
            codeRows[0].code,
            'invalid_actual_credits',
            'la 064 rechaza el sobrepaso: ése es el defecto',
          );

          const { rows: stuckRows } = await bc.query(
            `SELECT status FROM public.wizard_budget_reservations WHERE id = $1`,
            [resId],
          );
          assert.equal(
            stuckRows[0].status,
            'reserved',
            'y la deja atascada en `reserved`, bloqueando la corrida siguiente',
          );

          const { rows: blockedRows } = await bc.query(
            `SELECT public.try_reserve_wizard_credits($1, $2, 2, $3) AS code`,
            [USER_A, '00000000-0000-4000-8000-00000000e002', PERIOD],
          );
          assert.equal(blockedRows[0].code, 'concurrent_execution_active');

          await bc.end();
        } finally {
          await baseline.stop().catch(() => undefined);
          rmSync(baselineDir, { recursive: true, force: true });
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 2 — Los tres casos económicos
    // ═══════════════════════════════════════════════════════════════

    describe('§ 2 — contrato económico', () => {
      it('CASO A — infraconsumo (reservado 6, real 4): confirmed, y 2 créditos vuelven', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000a001');
        assert.ok(id);
        assert.deepEqual(await readPeriod(), {
          budget_credits: 289,
          credits_reserved: 6,
          credits_consumed: 0,
        });

        assert.equal(await confirmVia(id!, 4), 'confirmed');

        const res = await readReservation(id!);
        assert.equal(res.status, 'confirmed');
        assert.equal(res.credits_reserved, 6);
        assert.equal(res.credits_consumed, 4);

        assert.deepEqual(await readPeriod(), {
          budget_credits: 289,
          credits_reserved: 0,
          credits_consumed: 4,
        });
      });

      it('CASO B — consumo exacto (reservado 6, real 6): confirmed', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000a002');
        assert.equal(await confirmVia(id!, 6), 'confirmed');

        const res = await readReservation(id!);
        assert.equal(res.status, 'confirmed');
        assert.equal(res.credits_reserved, 6);
        assert.equal(res.credits_consumed, 6);

        assert.deepEqual(await readPeriod(), {
          budget_credits: 289,
          credits_reserved: 0,
          credits_consumed: 6,
        });
      });

      it('CASO C — sobrepaso (reservado 6, real 7): confirmed_with_overage', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000a003');
        assert.equal(await confirmVia(id!, 7, BATCH_A), 'confirmed_with_overage');
      });

      it('la RESERVA guarda el sobrepaso COMPLETO (7), no la reserva (6)', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000a004');
        await confirmVia(id!, 7);

        const res = await readReservation(id!);
        assert.equal(res.status, 'confirmed', 'la reserva llega a estado TERMINAL');
        assert.equal(
          res.credits_consumed,
          7,
          'NO 6: un clamp a la reserva sería un subconteo del gasto real',
        );
        assert.equal(
          res.credits_reserved,
          6,
          'la reserva NO se reescribe: el par (6, 7) ES la evidencia del sobrepaso',
        );
        assert.ok(res.confirmed_at, 'confirmed_at se sella');
      });

      it('el PERÍODO recibe el sobrepaso COMPLETO (+7) y suelta la reserva entera (−6)', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000a005');
        await confirmVia(id!, 7);

        assert.deepEqual(await readPeriod(), {
          budget_credits: 289,
          credits_reserved: 0,
          credits_consumed: 7,
        });
      });

      it('batch_id se preserva y COALESCE no lo borra en una liquidación sin batch', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000a006');
        await client.query(
          `UPDATE public.wizard_budget_reservations SET batch_id = $1 WHERE id = $2`,
          [BATCH_A, id],
        );
        await confirmVia(id!, 7, null);
        assert.equal((await readReservation(id!)).batch_id, BATCH_A);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 3 — El invariante de la reserva por estado
    // ═══════════════════════════════════════════════════════════════

    describe('§ 3 — la constraint permite el sobrepaso SÓLO en confirmed', () => {
      const insertRaw = (status: string, reserved: number, consumed: number, id: string) =>
        errorCodeOf(
          `INSERT INTO public.wizard_budget_reservations
             (id, period_start, user_id, client_request_id, credits_reserved,
              credits_consumed, status)
           VALUES ($1, $2, $3, gen_random_uuid(), $4, $5, $6)`,
          [id, PERIOD, USER_B, reserved, consumed, status],
        );

      it('reserved + consumed > reserved → RECHAZADO (23514)', async () => {
        assert.equal(
          await insertRaw('reserved', 6, 7, '00000000-0000-4000-8000-00000000b001'),
          CHECK_VIOLATION,
        );
      });

      it('confirmed + consumed > reserved → ACEPTADO', async () => {
        assert.equal(
          await insertRaw('confirmed', 6, 7, '00000000-0000-4000-8000-00000000b002'),
          null,
        );
      });

      it('released + consumed > reserved → RECHAZADO (23514)', async () => {
        assert.equal(
          await insertRaw('released', 6, 7, '00000000-0000-4000-8000-00000000b003'),
          CHECK_VIOLATION,
        );
      });

      it('failed + consumed > reserved → RECHAZADO (23514)', async () => {
        assert.equal(
          await insertRaw('failed', 6, 7, '00000000-0000-4000-8000-00000000b004'),
          CHECK_VIOLATION,
        );
      });

      it('un UPDATE que confirma y sobrepasa a la vez PASA; sobrepasar sin confirmar NO', async () => {
        // La propiedad de PostgreSQL de la que depende el arreglo: el CHECK se evalúa
        // contra la fila FINAL del statement, así que mover `status` y
        // `credits_consumed` juntos es válido aunque el estado de partida no lo
        // permitiera.
        const { id } = await reserveVia(USER_B, 6, '00000000-0000-4000-8000-00000000b005');
        assert.equal(
          await errorCodeOf(
            `UPDATE public.wizard_budget_reservations
                SET credits_consumed = 7 WHERE id = $1`,
            [id],
          ),
          CHECK_VIOLATION,
          'sobrepasar dejando status = reserved está prohibido',
        );
        assert.equal(
          await errorCodeOf(
            `UPDATE public.wizard_budget_reservations
                SET status = 'confirmed', credits_consumed = 7 WHERE id = $1`,
            [id],
          ),
          null,
          'el mismo sobrepaso, confirmando en el MISMO statement, es válido',
        );
      });

      it('credits_consumed >= 0 sigue vigente incluso en confirmed', async () => {
        assert.equal(
          await insertRaw('confirmed', 6, -1, '00000000-0000-4000-8000-00000000b006'),
          CHECK_VIOLATION,
        );
      });

      it('credits_reserved > 0 sigue vigente', async () => {
        assert.equal(
          await insertRaw('confirmed', 0, 0, '00000000-0000-4000-8000-00000000b007'),
          CHECK_VIOLATION,
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 4 — El período PUEDE sobregirarse, y eso bloquea la corrida siguiente
    // ═══════════════════════════════════════════════════════════════

    describe('§ 4 — verdad del período', () => {
      it('budget 289, consumido 288, reservado 1, real 2 → consumido 290 (available −1)', async () => {
        await client.query(
          `UPDATE public.wizard_monthly_budget_periods
              SET credits_consumed = 288 WHERE period_start = $1`,
          [PERIOD],
        );
        const { id } = await reserveVia(USER_A, 1, '00000000-0000-4000-8000-00000000c001');
        assert.ok(id, 'con 288 consumidos todavía cabe reservar 1');

        assert.equal(await confirmVia(id!, 2), 'confirmed_with_overage');

        const period = await readPeriod();
        assert.deepEqual(period, {
          budget_credits: 289,
          credits_reserved: 0,
          credits_consumed: 290,
        });
        assert.equal(
          period.budget_credits - period.credits_consumed - period.credits_reserved,
          -1,
          'available NEGATIVO: el sobregiro ya ocurrió fuera de esta base y es representable',
        );
      });

      it('con el período sobregirado, la corrida SIGUIENTE recibe insufficient_budget', async () => {
        await client.query(
          `UPDATE public.wizard_monthly_budget_periods
              SET credits_consumed = 290 WHERE period_start = $1`,
          [PERIOD],
        );
        const { code } = await reserveVia(
          USER_A,
          1,
          '00000000-0000-4000-8000-00000000c002',
        );
        assert.equal(code, 'insufficient_budget');
      });

      it('tras un sobrepaso, el MISMO usuario puede volver a reservar (ya no hay fila atascada)', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000c003');
        await confirmVia(id!, 7);
        const next = await reserveVia(USER_A, 2, '00000000-0000-4000-8000-00000000c004');
        assert.equal(
          next.code,
          'reserved',
          'sin la 121 esto sería `concurrent_execution_active` para siempre',
        );
      });

      it('no se añadió ninguna constraint que impida consumed > budget en el período', async () => {
        const defs = (
          await rowsOf(
            `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = 'public.wizard_monthly_budget_periods'::regclass
                AND contype = 'c'`,
          )
        ).map((r) => String(r.def));
        for (const def of defs) {
          assert.doesNotMatch(
            def,
            /credits_consumed\s*<=\s*budget_credits/,
            'un tope en el período volvería a hacer el sobregiro real inguardable',
          );
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 5 — Idempotencia: el sobrepaso se cuenta UNA vez
    // ═══════════════════════════════════════════════════════════════

    describe('§ 5 — idempotencia del sobrepaso', () => {
      it('primer confirm confirmed_with_overage, segundo already_confirmed, período INTACTO', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000d001');

        assert.equal(await confirmVia(id!, 7), 'confirmed_with_overage');
        const afterFirst = await readPeriod();
        assert.deepEqual(afterFirst, {
          budget_credits: 289,
          credits_reserved: 0,
          credits_consumed: 7,
        });

        assert.equal(await confirmVia(id!, 7), 'already_confirmed');
        assert.deepEqual(
          await readPeriod(),
          afterFirst,
          'ni +7 dos veces ni −6 dos veces',
        );

        const res = await readReservation(id!);
        assert.equal(res.credits_consumed, 7);
        assert.equal(res.status, 'confirmed');
      });

      it('un segundo confirm con OTRO número tampoco mueve nada', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000d002');
        await confirmVia(id!, 7);
        const before = await readPeriod();
        assert.equal(await confirmVia(id!, 99), 'already_confirmed');
        assert.deepEqual(await readPeriod(), before);
        assert.equal((await readReservation(id!)).credits_consumed, 7);
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 6 — Lo que la 064 ya garantizaba y sigue garantizando
    // ═══════════════════════════════════════════════════════════════

    describe('§ 6 — semántica preservada', () => {
      it('actual negativo sigue siendo invalid_actual_credits y no mueve contadores', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000f001');
        const before = await readPeriod();
        assert.equal(await confirmVia(id!, -1), 'invalid_actual_credits');
        assert.deepEqual(await readPeriod(), before);
        assert.equal((await readReservation(id!)).status, 'reserved');
      });

      it('actual 0 se respeta: confirmed con 0 consumidos', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000f002');
        assert.equal(await confirmVia(id!, 0), 'confirmed');
        assert.equal((await readReservation(id!)).credits_consumed, 0);
        assert.deepEqual(await readPeriod(), {
          budget_credits: 289,
          credits_reserved: 0,
          credits_consumed: 0,
        });
      });

      it('reservation_not_found para un id inexistente', async () => {
        assert.equal(
          await confirmVia('00000000-0000-4000-8000-0000000000ff', 1),
          'reservation_not_found',
        );
      });

      it('una reserva LIBERADA no se puede confirmar (ni con sobrepaso)', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000f003');
        assert.equal(await releaseVia(id!), 'released');
        assert.equal(await confirmVia(id!, 7), 'reservation_not_found');
        assert.equal((await readReservation(id!)).status, 'released');
      });

      it('una reserva FALLIDA no se puede confirmar (ni con sobrepaso)', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000f004');
        await client.query(
          `UPDATE public.wizard_budget_reservations SET status = 'failed' WHERE id = $1`,
          [id],
        );
        assert.equal(await confirmVia(id!, 7), 'reservation_not_found');
      });

      it('el índice único parcial de una sola reserva activa sigue vivo', async () => {
        await reserveVia(USER_A, 2, '00000000-0000-4000-8000-00000000f005');
        assert.equal(
          await errorCodeOf(
            `INSERT INTO public.wizard_budget_reservations
               (period_start, user_id, client_request_id, credits_reserved, status)
             VALUES ($1, $2, gen_random_uuid(), 2, 'reserved')`,
            [PERIOD, USER_A],
          ),
          UNIQUE_VIOLATION,
        );
      });

      it('confirm_wizard_credits sigue SECURITY DEFINER con search_path = pg_temp', async () => {
        const [row] = await rowsOf(
          `SELECT p.prosecdef, p.proconfig
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'confirm_wizard_credits'`,
        );
        assert.equal(row.prosecdef, true);
        assert.deepEqual(row.proconfig, ['search_path=pg_temp']);
      });

      it('los grants de EXECUTE quedan exactamente como los dejó la 064', async () => {
        const [row] = await rowsOf(
          `SELECT
             has_function_privilege('anon',
               'public.confirm_wizard_credits(uuid,integer,uuid)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated',
               'public.confirm_wizard_credits(uuid,integer,uuid)', 'EXECUTE') AS authenticated,
             has_function_privilege('service_role',
               'public.confirm_wizard_credits(uuid,integer,uuid)', 'EXECUTE') AS service_role`,
        );
        assert.equal(row.anon, false, 'anon NUNCA puede liquidar presupuesto');
        assert.equal(row.authenticated, false, 'authenticated tampoco');
        assert.equal(row.service_role, true);
      });

      it('las cuatro tablas del presupuesto siguen con RLS habilitada', async () => {
        const rows = await rowsOf(
          `SELECT relname, relrowsecurity FROM pg_class
            WHERE relname IN ('wizard_pilot_settings','wizard_pilot_participants',
                              'wizard_monthly_budget_periods','wizard_budget_reservations')`,
        );
        assert.equal(rows.length, 4);
        for (const row of rows) {
          assert.equal(row.relrowsecurity, true, `${row.relname} debe tener RLS`);
        }
      });

      it('no existe ninguna sobrecarga huérfana de confirm_wizard_credits', async () => {
        const count = await scalar<string>(
          `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'confirm_wizard_credits'`,
        );
        assert.equal(
          Number(count),
          1,
          'una firma distinta dejaría los REVOKE/GRANT apuntando a otra función',
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════
    // § 7 — Ratchet ANTI-CLAMP
    // ═══════════════════════════════════════════════════════════════

    describe('§ 7 — ratchet anti-clamp', () => {
      it('el gasto autoritativo es 7 en la reserva Y en el período, nunca 6', async () => {
        const { id } = await reserveVia(USER_A, 6, '00000000-0000-4000-8000-00000000e101');
        const before = await readPeriod();
        await confirmVia(id!, 7);
        const after = await readPeriod();

        const consumedDelta = after.credits_consumed - before.credits_consumed;
        assert.equal(
          consumedDelta,
          7,
          'un `LEAST(actual, reserved)` daría 6 y esta aserción es la que lo mata',
        );
        assert.equal((await readReservation(id!)).credits_consumed, 7);
        assert.notEqual(consumedDelta, 6);
      });

      it('el cuerpo de la función desplegada no contiene ningún recorte a la reserva', async () => {
        // Se lee de `pg_get_functiondef`, no del archivo: lo que importa es lo que la
        // base EJECUTA. Un clamp introducido por otra migración posterior también
        // caería aquí.
        const body = await scalar<string>(
          `SELECT pg_get_functiondef(p.oid)
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'confirm_wizard_credits'`,
        );
        assert.doesNotMatch(body, /LEAST\s*\(\s*p_actual_credits_consumed/i);
        assert.doesNotMatch(body, /LEAST\s*\(\s*v_res\.credits_reserved/i);
        assert.match(
          body,
          /credits_consumed\s*=\s*credits_consumed\s*\+\s*p_actual_credits_consumed/i,
          'el período debe sumar el actual CRUDO',
        );
        assert.match(body, /confirmed_with_overage/);
      });
    });
  },
);
