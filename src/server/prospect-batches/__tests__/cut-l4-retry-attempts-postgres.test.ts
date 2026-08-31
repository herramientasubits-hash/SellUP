/**
 * AGENT1-LUSHA-CUT-L4 § 40 — el historial de intentos contra un PostgreSQL REAL.
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE (y por qué la suite en memoria no basta)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las tres afirmaciones centrales de CUT-L4 no viven en TypeScript:
 *
 *   1. «dos trabajadores que reclamen el intento 2 producen UNA fila» es una
 *      afirmación sobre una PRIMARY KEY compuesta y un `ON CONFLICT DO NOTHING`
 *      con `GET DIAGNOSTICS`. Hay que lanzar las dos transacciones y ver cuál
 *      pierde.
 *   2. «una operación no puede completarse por encima de un intento activo» es
 *      una afirmación sobre un `SELECT ... FOR UPDATE` compartido. Hay que
 *      cruzarlas de verdad, en dos conexiones, y comprobar que una espera.
 *   3. «no hay un tercer intento» es un CHECK, y un CHECK sólo se demuestra
 *      intentando violarlo.
 *
 * Y una cuarta mitad que ninguna suite estática alcanza: que la 136 APLIQUE
 * ENCIMA de la 135. Lleva cinco funciones `plpgsql` con dólar-quoting nombrado, un
 * bloque `DO $$` anónimo, dos `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` y un
 * `COMMENT ON COLUMN`; el precedente del repo es explícito sobre por qué un lexer
 * de comillas no basta (la 120 pasaba 20/20 en estático y fallaba con 42601 en
 * PostgreSQL).
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción. No hay teléfono, ni email,
 * ni nombre de empresa: las tablas no tienen dónde ponerlos, y eso es parte de lo
 * que se comprueba.
 *
 * En local se SALTA con motivo explícito si falta el arnés. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:a1-lusha-cut-l4-attempts:postgres
 *
 * No llama a Lusha, ni a Apollo, ni a HubSpot; no lee un flag; no toca Producción
 * ni ninguna base remota; no gasta un crédito.
 * MIGRACIONES 135 Y 136: APLICADAS EN PRODUCCIÓN = NO.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyLushaRequestFenceMigration,
  bootstrapPlatform,
  LUSHA_REQUEST_FENCE_MIGRATION,
  LUSHA_RETRY_MIGRATION_CHAIN,
  LUSHA_SAFE_RETRY_ATTEMPTS_MIGRATION,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/lusha-request-fence-real-migration';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

const FENCE = 'public.lusha_prospecting_request_fence';
const ATTEMPTS = 'public.lusha_prospecting_request_attempts';
const OPERATIONS = 'public.lusha_prospecting_operations';

const CLIENT_REQUEST = '11111111-2222-3333-4444-555555555555';
const USER = '00000000-1111-2222-3333-444444444444';
const RESERVATION = '99999999-8888-7777-6666-555555555555';
const ACTOR = `internal_user:${USER}`;
const SIGNATURE = 'a'.repeat(64);

/** La identidad DURABLE de la operación, acuñada por la BASE en cada `reset`. */
let RUN = '';

const key = (branch = 0, page = 0) => `lusha_prospecting|v2|${RUN}|b${branch}|p${page}`;

/** La evidencia canónica de un 429, tal y como CUT-L2 la emite. */
const EVIDENCE_429 = {
  outcome_class: 'http_429_rate_limited',
  billing_certainty: 'definitely_not_charged',
  retry_contract: 'retryable_by_contract',
  http_status: 429,
  provider_request_id: 'req-attempt-1',
  credits_charged: null,
  results_returned: 0,
};

const EVIDENCE_5XX = {
  ...EVIDENCE_429,
  outcome_class: 'http_5xx_provider_failure',
  http_status: 503,
};

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let client: PgLikeClient;

async function claimOperation(
  actor = ACTOR,
  signature = SIGNATURE,
  conn: PgLikeClient = client,
): Promise<Record<string, unknown>> {
  const { rows } = await conn.query(
    'SELECT public.claim_or_resume_lusha_prospecting_operation($1, $2, $3, $4) AS r',
    [actor, 'v1', signature, CLIENT_REQUEST],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function completeOperation(
  operationId = RUN,
  conn: PgLikeClient = client,
): Promise<Record<string, unknown>> {
  const { rows } = await conn.query(
    'SELECT public.complete_lusha_prospecting_operation($1::uuid) AS r',
    [operationId],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function claim(
  fenceKey = key(),
  branch = 0,
  page = 0,
  conn: PgLikeClient = client,
): Promise<Record<string, unknown>> {
  const { rows } = await conn.query(
    'SELECT public.claim_lusha_prospecting_request($1, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid) AS r',
    [fenceKey, RUN, branch, page, CLIENT_REQUEST, USER, RESERVATION],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function mark(fenceKey = key(), conn: PgLikeClient = client) {
  const { rows } = await conn.query(
    'SELECT public.mark_lusha_prospecting_request_dispatched($1) AS r',
    [fenceKey],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function settle(
  fenceKey: string,
  state: string,
  evidence: Record<string, unknown> = {},
  conn: PgLikeClient = client,
) {
  const { rows } = await conn.query(
    'SELECT public.settle_lusha_prospecting_request($1, $2, $3::jsonb) AS r',
    [fenceKey, state, JSON.stringify(evidence)],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function claimRetry(fenceKey = key(), conn: PgLikeClient = client) {
  const { rows } = await conn.query(
    'SELECT public.claim_lusha_prospecting_retry_attempt($1) AS r',
    [fenceKey],
  );
  return rows[0]!.r as Record<string, unknown>;
}

async function attemptsOf(fenceKey = key()): Promise<Record<string, unknown>[]> {
  const { rows } = await client.query(
    `SELECT * FROM ${ATTEMPTS} WHERE fence_key = $1 ORDER BY attempt_no`,
    [fenceKey],
  );
  return rows;
}

async function fenceRow(fenceKey = key()): Promise<Record<string, unknown> | undefined> {
  const { rows } = await client.query(`SELECT * FROM ${FENCE} WHERE fence_key = $1`, [fenceKey]);
  return rows[0];
}

/** Lleva una petición lógica hasta «intento 1 liquidado con la evidencia dada». */
async function settledFirstAttempt(evidence: Record<string, unknown> = EVIDENCE_429) {
  await claim();
  await mark();
  await settle(key(), 'definitely_not_charged', evidence);
}

async function reset(): Promise<void> {
  // Lo ejecuta el DUEÑO de las tablas (postgres), no `service_role`, a quien las
  // migraciones deliberadamente no le conceden ni DELETE ni TRUNCATE.
  //
  // 🔴 Las tres en UNA sentencia, y no es una comodidad de sintaxis: PostgreSQL
  // se NIEGA (0A000) a truncar `lusha_prospecting_request_fence` por separado
  // porque los intentos la referencian. Que haga falta escribirlo así es, en sí,
  // la prueba de que la clave foránea existe y de que no lleva cascada.
  await client.query(`TRUNCATE ${ATTEMPTS}, ${FENCE}, ${OPERATIONS} CASCADE`);
  RUN = (await claimOperation()).operation_id as string;
}

async function expectFailure(sql: string, values?: unknown[]): Promise<string> {
  try {
    await client.query(sql, values);
  } catch (err) {
    return (err as { code?: string }).code ?? 'sin SQLSTATE';
  }
  assert.fail(`se esperaba un fallo y la sentencia pasó: ${sql}`);
}

describe('136 — intentos y reintento seguro contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pg-lusha-retry-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54830 + Math.floor(process.pid % 100),
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await bootstrapPlatform(client);
    // La CADENA completa, en el orden en que Producción la aplicaría.
    for (const file of LUSHA_RETRY_MIGRATION_CHAIN) {
      await applyLushaRequestFenceMigration(client, repoRoot, file);
    }
    RUN = (await claimOperation()).operation_id as string;
  });

  after(async () => {
    try {
      await client?.end();
    } finally {
      await postgres?.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // ── § 1. Aplicabilidad, cadena e idempotencia ──────────────────────────────

  describe('§ 1 — la migración aplica y reaplica', () => {
    it('la cadena 135 → 136 aplica de verdad, no sólo pasa un lexer', async () => {
      const { rows } = await client.query(
        `SELECT to_regclass($1) AS t, to_regclass($2) AS f`,
        [ATTEMPTS, FENCE],
      );
      assert.ok(rows[0]!.t, 'la tabla de intentos existe');
      assert.ok(rows[0]!.f, 'la valla de CUT-L3 sigue existiendo');
    });

    it('la 136 vuelve a aplicar sobre su propio resultado sin tocar filas', async () => {
      await reset();
      await settledFirstAttempt();
      const before = await attemptsOf();

      await applyLushaRequestFenceMigration(
        client,
        repoRoot,
        LUSHA_SAFE_RETRY_ATTEMPTS_MIGRATION,
      );

      const after = await attemptsOf();
      assert.equal(after.length, before.length, 'no se inventan intentos al reaplicar');
      assert.equal(after[0]!.state, before[0]!.state);
      assert.equal(after[0]!.outcome_class, before[0]!.outcome_class);
    });

    it('las cinco funciones existen con la firma esperada', async () => {
      const { rows } = await client.query(
        `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN (
              'claim_lusha_prospecting_request',
              'mark_lusha_prospecting_request_dispatched',
              'settle_lusha_prospecting_request',
              'claim_lusha_prospecting_retry_attempt',
              'complete_lusha_prospecting_operation'
            )
          ORDER BY p.proname`,
      );
      assert.equal(rows.length, 5, 'ni una función duplicada por sobrecarga accidental');
      const retry = rows.find((r) => r.proname === 'claim_lusha_prospecting_retry_attempt');
      assert.equal(retry?.args, 'p_fence_key text');
      // 🔴 Las tres REEMPLAZADAS conservan su firma: un despliegue anterior a
      // CUT-L4 contra una base con la 136 las sigue llamando sin romperse (§ 38).
      const claimFn = rows.find((r) => r.proname === 'claim_lusha_prospecting_request');
      assert.equal(
        claimFn?.args,
        'p_fence_key text, p_operation_id uuid, p_branch_index integer, p_page_index integer, p_client_request_id text, p_triggered_by uuid, p_reservation_id uuid',
      );
    });

    it('§ 11 — el backfill escribe el intento 1 de una valla preexistente', async () => {
      await reset();
      // Una valla escrita SIN pasar por la RPC: es la topología de una base donde
      // la 135 corrió sola durante un tiempo. Que la tabla esté vacía en la
      // práctica no autoriza a escribir un backfill que lo dé por hecho.
      await client.query(
        `INSERT INTO ${FENCE} (fence_key, provider, state, operation_id, branch_index, page_index,
                               outcome_class, billing_certainty, retry_contract, http_status,
                               dispatched_at, settled_at)
         VALUES ($1, 'lusha', 'definitely_not_charged', $2::uuid, 0, 7,
                 'http_429_rate_limited', 'definitely_not_charged', 'retryable_by_contract', 429,
                 now(), now())`,
        [key(0, 7), RUN],
      );
      assert.equal((await attemptsOf(key(0, 7))).length, 0, 'aún sin intento');

      await applyLushaRequestFenceMigration(
        client,
        repoRoot,
        LUSHA_SAFE_RETRY_ATTEMPTS_MIGRATION,
      );

      const attempts = await attemptsOf(key(0, 7));
      assert.equal(attempts.length, 1, 'el backfill creó el intento 1');
      assert.equal(attempts[0]!.attempt_no, 1);
      assert.equal(attempts[0]!.state, 'definitely_not_charged');
      assert.equal(attempts[0]!.outcome_class, 'http_429_rate_limited');

      // IDEMPOTENTE: una segunda pasada no duplica ni reescribe.
      await applyLushaRequestFenceMigration(
        client,
        repoRoot,
        LUSHA_SAFE_RETRY_ATTEMPTS_MIGRATION,
      );
      assert.equal((await attemptsOf(key(0, 7))).length, 1);
    });
  });

  // ── § 2. El intento inicial es durable y atómico (§ 13) ────────────────────

  describe('§ 2 — el intento 1 nace con la valla', () => {
    it('un reclamo crea valla E intento en la MISMA operación', async () => {
      await reset();
      const claimed = await claim();
      assert.equal(claimed.status, 'claimed');
      assert.equal(claimed.attempt_no, 1);
      const attempts = await attemptsOf();
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]!.state, 'prepared');
      assert.equal(attempts[0]!.operation_id, RUN);
      assert.equal((await fenceRow())?.latest_attempt_no, 1);
    });

    it('un reclamo REPETIDO no crea un segundo intento', async () => {
      await reset();
      await claim();
      const second = await claim();
      assert.equal(second.status, 'already_claimed');
      assert.equal((await attemptsOf()).length, 1);
    });

    it('no se puede reclamar contra una operación ya COMPLETADA', async () => {
      await reset();
      assert.equal((await completeOperation()).status, 'completed');
      const refused = await claim();
      assert.equal(refused.status, 'operation_not_open');
      assert.equal((await attemptsOf()).length, 0, 'ni valla ni intento');
    });
  });

  // ── § 3. Elegibilidad del reintento (§ 14, § 15) ───────────────────────────

  describe('§ 3 — quién puede reintentar', () => {
    it('un 429 liquidado AUTORIZA el intento 2', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      const retry = await claimRetry();
      assert.equal(retry.status, 'claimed');
      assert.equal(retry.attempt_no, 2);
      const attempts = await attemptsOf();
      assert.equal(attempts.length, 2);
      // 🔴 El intento 1 SIGUE intacto. Ésta es la afirmación del § 7.
      assert.equal(attempts[0]!.state, 'definitely_not_charged');
      assert.equal(attempts[0]!.http_status, 429);
      assert.equal(attempts[0]!.provider_request_id, 'req-attempt-1');
      assert.equal(attempts[1]!.state, 'prepared');
      // La PROYECCIÓN de la valla se reinicia; el historial no.
      const row = await fenceRow();
      assert.equal(row?.state, 'prepared');
      assert.equal(row?.latest_attempt_no, 2);
      assert.equal(row?.settled_at, null);
      assert.equal(row?.http_status, null);
    });

    it('un 5xx liquidado también autoriza', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_5XX);
      assert.equal((await claimRetry()).status, 'claimed');
    });

    const refused: [string, string, Record<string, unknown>][] = [
      [
        '499',
        'indeterminate',
        {
          outcome_class: 'post_send_indeterminate',
          billing_certainty: 'potentially_charged',
          retry_contract: 'do_not_automatically_retry',
          http_status: 499,
        },
      ],
      [
        'timeout post-envío',
        'indeterminate',
        {
          outcome_class: 'post_send_indeterminate',
          billing_certainty: 'potentially_charged',
          retry_contract: 'do_not_automatically_retry',
        },
      ],
      [
        '4xx genérico',
        'unknown',
        {
          outcome_class: 'http_4xx_non_retryable',
          billing_certainty: 'unknown',
          retry_contract: 'do_not_automatically_retry',
          http_status: 400,
        },
      ],
      [
        '2xx ilegible',
        'indeterminate',
        {
          outcome_class: 'malformed_success_payload',
          billing_certainty: 'potentially_charged',
          retry_contract: 'do_not_automatically_retry',
          http_status: 200,
        },
      ],
      [
        'éxito',
        'succeeded',
        {
          outcome_class: 'success',
          billing_certainty: 'settled_from_provider',
          retry_contract: 'do_not_automatically_retry',
          http_status: 200,
          credits_charged: 1,
        },
      ],
      [
        'rechazo local previo al envío',
        'definitely_not_charged',
        {
          outcome_class: 'local_pre_dispatch_failure',
          billing_certainty: 'definitely_not_charged',
          retry_contract: 'safe_to_retry_not_dispatched',
        },
      ],
    ];

    for (const [label, state, evidence] of refused) {
      it(`§ 15 — ${label} NO autoriza reintento`, async () => {
        await reset();
        await claim();
        await mark();
        await settle(key(), state, evidence);
        const retry = await claimRetry();
        assert.equal(retry.status, 'not_retryable', label);
        assert.equal((await attemptsOf()).length, 1, 'no se creó ningún intento 2');
      });
    }

    it('🔴 un `definitely_not_charged` con clase de PRE-ENVÍO no se cuela', async () => {
      // Es el caso más delicado del § 15: el estado y la certeza coinciden con los
      // del 429, y aun así NO puede reintentarse. Lo que lo distingue es la CLASE.
      await reset();
      await claim();
      await mark();
      await settle(key(), 'definitely_not_charged', {
        outcome_class: 'local_pre_dispatch_failure',
        billing_certainty: 'definitely_not_charged',
        retry_contract: 'safe_to_retry_not_dispatched',
      });
      assert.equal((await claimRetry()).status, 'not_retryable');
    });

    it('una evidencia MUTILADA no autoriza: las cuatro condiciones son un AND', async () => {
      await reset();
      await claim();
      await mark();
      // Clase correcta, contrato correcto… y `billing_certainty` ausente.
      await settle(key(), 'definitely_not_charged', {
        outcome_class: 'http_429_rate_limited',
        retry_contract: 'retryable_by_contract',
        http_status: 429,
      });
      assert.equal((await claimRetry()).status, 'not_retryable');
    });

    it('un intento sin liquidar no autoriza nada', async () => {
      await reset();
      await claim();
      await mark();
      assert.equal((await claimRetry()).status, 'not_retryable');
    });

    it('una valla inexistente no autoriza nada', async () => {
      await reset();
      assert.equal((await claimRetry('lusha_prospecting|v2|nope|b0|p0')).status, 'fence_not_found');
    });
  });

  // ── § 4. El techo de intentos (§ 3, L4-C) ──────────────────────────────────

  describe('§ 4 — no hay un tercer intento', () => {
    it('tras un intento 2 liquidado a 429, el reclamo se AGOTA', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      assert.equal((await claimRetry()).status, 'claimed');
      await mark();
      await settle(key(), 'definitely_not_charged', {
        ...EVIDENCE_429,
        provider_request_id: 'req-attempt-2',
      });

      const third = await claimRetry();
      assert.equal(third.status, 'attempts_exhausted');
      assert.equal(third.max_attempts, 2);
      assert.equal((await attemptsOf()).length, 2);
    });

    it('el CHECK del esquema rechaza un intento 3 escrito a mano', async () => {
      await reset();
      await claim();
      // 23514 = check_violation. El techo no es sólo de la RPC.
      const code = await expectFailure(
        `INSERT INTO ${ATTEMPTS} (fence_key, operation_id, attempt_no, branch_index, page_index, state)
         VALUES ($1, $2::uuid, 3, 0, 0, 'prepared')`,
        [key(), RUN],
      );
      assert.equal(code, '23514');
    });

    it('la unicidad de (fence_key, attempt_no) la impone la PRIMARY KEY', async () => {
      await reset();
      await claim();
      const code = await expectFailure(
        `INSERT INTO ${ATTEMPTS} (fence_key, operation_id, attempt_no, branch_index, page_index, state)
         VALUES ($1, $2::uuid, 1, 0, 0, 'prepared')`,
        [key(), RUN],
      );
      assert.equal(code, '23505');
    });

    it('cada intento conserva SU `x-request-id`, y son distintos (§ 33)', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      await mark();
      await settle(key(), 'succeeded', {
        outcome_class: 'success',
        billing_certainty: 'settled_from_provider',
        retry_contract: 'do_not_automatically_retry',
        http_status: 200,
        provider_request_id: 'req-attempt-2',
        credits_charged: 1,
        rate_limit_minute_remaining: 59,
      });
      const attempts = await attemptsOf();
      assert.equal(attempts[0]!.provider_request_id, 'req-attempt-1');
      assert.equal(attempts[1]!.provider_request_id, 'req-attempt-2');
      // § 30 — el 429 NO reportó importe; el éxito sí. Total del intento: 1.
      assert.equal(attempts[0]!.credits_charged, null);
      assert.equal(String(attempts[1]!.credits_charged), '1');
      assert.equal(attempts[1]!.rate_limit_minute_remaining, 59);
    });
  });

  // ── § 5. Concurrencia (L4-Q) ───────────────────────────────────────────────

  describe('§ 5 — reclamo concurrente del intento 2', () => {
    it('L4-Q — dos CONEXIONES: exactamente una gana', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      const other = postgres.getPgClient();
      await other.connect();
      try {
        const [a, b] = await Promise.all([claimRetry(key(), client), claimRetry(key(), other)]);
        const granted = [a, b].filter((r) => r.status === 'claimed');
        assert.equal(granted.length, 1, 'sólo un trabajador reclama el intento 2');
        // 🔴 Y el perdedor NO recibe una autorización disfrazada: su respuesta no
        // puede leerse como «adelante».
        const loser = [a, b].find((r) => r.status !== 'claimed')!;
        assert.notEqual(loser.status, 'claimed');
        assert.equal((await attemptsOf()).length, 2, 'exactamente dos filas');
      } finally {
        await other.end();
      }
    });

    it('dos reclamos INICIALES concurrentes tampoco duplican el intento 1', async () => {
      await reset();
      const other = postgres.getPgClient();
      await other.connect();
      try {
        const [a, b] = await Promise.all([claim(key(), 0, 0, client), claim(key(), 0, 0, other)]);
        assert.equal([a, b].filter((r) => r.status === 'claimed').length, 1);
        assert.equal((await attemptsOf()).length, 1);
      } finally {
        await other.end();
      }
    });
  });

  // ── § 6. Cierre de operación vs reclamo (§ 17, L4-S) ───────────────────────

  describe('§ 6 — el cierre y el reclamo serializan', () => {
    it('L4-S — una operación COMPLETADA no acepta reintento', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      // El intento 1 quedó `definitely_not_charged`, que SÍ es verdad asentada, así
      // que la operación puede cerrarse. Es justo la ventana peligrosa: la corrida
      // cree haber terminado y el reintento llega tarde.
      assert.equal((await completeOperation()).status, 'completed');
      const late = await claimRetry();
      assert.equal(late.status, 'operation_not_open');
      assert.equal((await attemptsOf()).length, 1, 'ningún intento tras el cierre');
    });

    it('L4-S — un intento 2 ACTIVO impide completar la operación', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      assert.equal((await claimRetry()).status, 'claimed');
      await mark();

      const blocked = await completeOperation();
      assert.equal(blocked.status, 'blocked_unsettled_requests');
      assert.equal(blocked.state, 'reconciliation_required');
      // 🔴 El estado NUNCA alcanzable: operación completada + intento 2 despachado.
      const { rows } = await client.query(
        `SELECT state FROM ${OPERATIONS} WHERE operation_id = $1::uuid`,
        [RUN],
      );
      assert.notEqual(rows[0]!.state, 'completed');
    });

    it('L4-S — el cierre BLOQUEA mientras el reclamo tiene la operación tomada', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      const other = postgres.getPgClient();
      await other.connect();
      try {
        // Transacción A: toma la operación con el reclamo de reintento y NO commitea.
        await client.query('BEGIN');
        assert.equal((await claimRetry(key(), client)).status, 'claimed');

        // Transacción B: intenta cerrar. Tiene que ESPERAR, no colarse.
        const closing = other
          .query('SELECT public.complete_lusha_prospecting_operation($1::uuid) AS r', [RUN])
          .then((res) => res.rows[0]!.r as Record<string, unknown>);

        let settledEarly = false;
        await Promise.race([
          closing.then(() => {
            settledEarly = true;
          }),
          new Promise((r) => setImmediate(r)),
        ]);
        assert.equal(settledEarly, false, 'el cierre no puede colarse por encima del reclamo');

        await client.query('COMMIT');
        const result = await closing;
        // Al liberarse, el cierre ve el intento 2 sin liquidar y se NIEGA.
        assert.equal(result.status, 'blocked_unsettled_requests');
      } finally {
        await other.end();
      }
    });

    it('con los dos intentos liquidados a 0 créditos, la operación SÍ cierra', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      await mark();
      await settle(key(), 'definitely_not_charged', {
        ...EVIDENCE_429,
        provider_request_id: 'req-attempt-2',
      });
      assert.equal((await completeOperation()).status, 'completed');
    });

    it('§ 25 — un intento 2 INDETERMINADO deja la operación sin cerrar', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_5XX);
      await claimRetry();
      await mark();
      await settle(key(), 'indeterminate', {
        outcome_class: 'post_send_indeterminate',
        billing_certainty: 'potentially_charged',
        retry_contract: 'do_not_automatically_retry',
      });
      const blocked = await completeOperation();
      assert.equal(blocked.status, 'blocked_unsettled_requests');
    });
  });

  // ── § 7. La frontera de despacho del intento 2 (§ 18) ──────────────────────

  describe('§ 7 — durable ANTES del HTTP del reintento', () => {
    it('la marca cae sobre la valla Y sobre el intento, o sobre ninguno', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      const marked = await mark();
      assert.equal(marked.status, 'marked');
      assert.equal(marked.attempt_no, 2);
      const attempts = await attemptsOf();
      assert.equal(attempts[1]!.state, 'dispatch_unsafe');
      assert.ok(attempts[1]!.dispatched_at, 'el intento 2 tiene sello de despacho');
      assert.equal((await fenceRow())?.state, 'dispatch_unsafe');
      // 🔴 El intento 1 no se movió.
      assert.equal(attempts[0]!.state, 'definitely_not_charged');
    });

    it('una segunda marca del mismo intento se rechaza', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      await mark();
      assert.equal((await mark()).status, 'not_claimable');
    });

    it('un ÉXITO no puede liquidarse sin haber marcado la frontera', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      const invalid = await settle(key(), 'succeeded', { outcome_class: 'success' });
      assert.equal(invalid.status, 'invalid_transition');
    });

    it('la liquidación del intento 2 no pisa la del 1', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      await mark();
      await settle(key(), 'succeeded', {
        outcome_class: 'success',
        billing_certainty: 'settled_from_provider',
        retry_contract: 'do_not_automatically_retry',
        http_status: 200,
        credits_charged: 1,
      });
      const attempts = await attemptsOf();
      assert.equal(attempts[0]!.outcome_class, 'http_429_rate_limited');
      assert.equal(attempts[0]!.http_status, 429);
      assert.equal(attempts[1]!.outcome_class, 'success');
      assert.equal(attempts[1]!.http_status, 200);
      assert.equal((await fenceRow())?.state, 'succeeded');
    });

    it('una liquidación TARDÍA no reescribe un intento ya terminal', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      await mark();
      await settle(key(), 'succeeded', {
        outcome_class: 'success',
        billing_certainty: 'settled_from_provider',
        retry_contract: 'do_not_automatically_retry',
        http_status: 200,
      });
      const late = await settle(key(), 'indeterminate', { outcome_class: 'post_send_indeterminate' });
      assert.equal(late.status, 'already_terminal');
      assert.equal((await attemptsOf())[1]!.outcome_class, 'success');
    });
  });

  // ── § 8. Privilegios y retención (§ 35, § 36) ──────────────────────────────

  describe('§ 8 — privilegios de la superficie nueva', () => {
    it('`anon` y `authenticated` no tienen NI UN privilegio sobre los intentos', async () => {
      const { rows } = await client.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'lusha_prospecting_request_attempts'
            AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
      );
      assert.deepEqual(rows, [], 'ninguna concesión a roles de sesión');
    });

    it('`service_role` tiene SELECT/INSERT/UPDATE y NADA más', async () => {
      const { rows } = await client.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'lusha_prospecting_request_attempts'
            AND grantee = 'service_role' ORDER BY privilege_type`,
      );
      assert.deepEqual(
        rows.map((r) => r.privilege_type),
        ['INSERT', 'SELECT', 'UPDATE'],
      );
    });

    it('§ 36 — `service_role` NO puede borrar evidencia económica', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await client.query('SET ROLE service_role');
      try {
        // 42501 = insufficient_privilege.
        const code = await expectFailure(`DELETE FROM ${ATTEMPTS} WHERE fence_key = $1`, [key()]);
        assert.equal(code, '42501');
        const truncate = await expectFailure(`TRUNCATE ${ATTEMPTS}`);
        assert.equal(truncate, '42501');
      } finally {
        await client.query('RESET ROLE');
      }
    });

    it('la RLS está activa y sólo `service_role` tiene policy', async () => {
      const { rows } = await client.query(
        `SELECT c.relrowsecurity, (
            SELECT count(*)::int FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = 'lusha_prospecting_request_attempts'
          ) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'lusha_prospecting_request_attempts'`,
      );
      assert.equal(rows[0]!.relrowsecurity, true);
      assert.equal(rows[0]!.policies, 1);
    });

    it('la RPC de reintento es SECURITY DEFINER con `search_path` fijado', async () => {
      const { rows } = await client.query(
        `SELECT p.prosecdef, p.proconfig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'claim_lusha_prospecting_retry_attempt'`,
      );
      assert.equal(rows[0]!.prosecdef, true);
      assert.deepEqual(rows[0]!.proconfig, ['search_path=pg_catalog, public, pg_temp']);
    });

    it('`anon` y `authenticated` no pueden EJECUTAR el reclamo de reintento', async () => {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await client.query(
          `SELECT has_function_privilege($1, 'public.claim_lusha_prospecting_retry_attempt(text)', 'EXECUTE') AS can`,
          [role],
        );
        assert.equal(rows[0]!.can, false, `${role} no puede autorizarse una llamada pagada`);
      }
      const { rows } = await client.query(
        `SELECT has_function_privilege('service_role', 'public.claim_lusha_prospecting_retry_attempt(text)', 'EXECUTE') AS can`,
      );
      assert.equal(rows[0]!.can, true);
    });

    it('§ 36 — cerrar la operación NO borra el historial de intentos', async () => {
      await reset();
      await settledFirstAttempt(EVIDENCE_429);
      await claimRetry();
      await mark();
      await settle(key(), 'definitely_not_charged', {
        ...EVIDENCE_429,
        provider_request_id: 'req-attempt-2',
      });
      assert.equal((await completeOperation()).status, 'completed');
      assert.equal((await attemptsOf()).length, 2, 'la evidencia sobrevive al cierre');
    });

    it('ninguna FK lleva cascada sobre la evidencia', async () => {
      const { rows } = await client.query(
        `SELECT confdeltype FROM pg_constraint
          WHERE conrelid = 'public.lusha_prospecting_request_attempts'::regclass
            AND contype = 'f'`,
      );
      assert.ok(rows.length >= 2, 'las dos claves foráneas existen');
      // 'a' = NO ACTION. Nada de 'c' (CASCADE) ni 'n' (SET NULL).
      for (const r of rows) assert.equal(r.confdeltype, 'a');
    });
  });

  // ── § 9. La cadena, en el orden que importa (§ 38) ─────────────────────────

  describe('§ 9 — compatibilidad de despliegue', () => {
    it('la 136 DEPENDE de la 135: sus dos claves foráneas apuntan a tablas de la 135', async () => {
      // 🔴 La cadena es de DOS archivos, a diferencia de la de CUT-L3, y aquí se
      // comprueba contra el CATÁLOGO en vez de contra el texto: los objetos que la
      // 136 referencia los crea la 135, así que aplicarla sola no puede funcionar.
      //
      // No se intenta aplicarla «aislada» con un `search_path` distinto porque
      // sería una prueba FALSA: la 136 califica todo con `public.`, así que un
      // esquema alternativo no aísla nada y el test pasaría sin demostrar nada.
      const { rows } = await client.query(
        `SELECT confrelid::regclass::text AS target
           FROM pg_constraint
          WHERE conrelid = 'public.lusha_prospecting_request_attempts'::regclass
            AND contype = 'f'
          ORDER BY target`,
      );
      assert.deepEqual(
        rows.map((r) => r.target),
        ['lusha_prospecting_operations', 'lusha_prospecting_request_fence'],
      );
    });

    it('la 136 no puede crear su tabla si la valla de la 135 no existe', async () => {
      // La mitad ejecutable de la afirmación de arriba: la misma DDL contra un
      // esquema donde la tabla referenciada no está falla con 42P01.
      const bare = postgres.getPgClient();
      await bare.connect();
      try {
        await bare.query('CREATE SCHEMA IF NOT EXISTS l4_no_135');
        let code = 'sin SQLSTATE';
        try {
          await bare.query(
            `CREATE TABLE l4_no_135.probe (
               fence_key text NOT NULL REFERENCES l4_no_135.lusha_prospecting_request_fence(fence_key)
             )`,
          );
          assert.fail('se esperaba 42P01');
        } catch (err) {
          code = (err as { code?: string }).code ?? code;
        }
        assert.equal(code, '42P01', 'sin la 135 no hay tabla a la que colgarse');
      } finally {
        await bare.query('DROP SCHEMA IF EXISTS l4_no_135 CASCADE').catch(() => undefined);
        await bare.end();
      }
    });

    it('la 135 sola sigue siendo válida: no hay RPC de reintento que la contradiga', () => {
      // Una base con la 135 y SIN la 136 no tiene
      // `claim_lusha_prospecting_retry_attempt`, y el runtime lo lee como
      // `capability_absent` (42883 / PGRST202). Comprobado en la suite en memoria;
      // aquí sólo se ancla el nombre por el que se pregunta.
      assert.equal(LUSHA_REQUEST_FENCE_MIGRATION, '135_agent1_lusha_prospecting_request_fence.sql');
      assert.equal(
        LUSHA_SAFE_RETRY_ATTEMPTS_MIGRATION,
        '136_agent1_lusha_prospecting_safe_retry_attempts.sql',
      );
    });
  });
});
