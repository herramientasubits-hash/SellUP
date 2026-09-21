/**
 * apollo-continuation-postgres-139.test.ts
 *
 * AGENT1-APOLLO-CONTINUATION-POSTGRES-139 — la mitad que una prueba en memoria
 * NO puede cubrir.
 *
 * ── Qué cierra ───────────────────────────────────────────────────────────────
 *
 * La suite del conductor demuestra su LÓGICA sobre dobles. La semántica de
 * recuperación y concurrencia, en cambio, vive en PostgreSQL: en un `WHERE` con
 * dos ramas, en `FOR UPDATE SKIP LOCKED`, en un índice único PARCIAL y en los
 * GRANT. Afirmarla sin una base real es hablar de un archivo de texto.
 *
 * Aquí se levanta un PostgreSQL DESECHABLE, se aplica la 139 VERBATIM con sus
 * dependencias mínimas y se ejercita el CUERPO REAL del worker: el reclamo es
 * una llamada al RPC de verdad y el cierre es el `settleJob` de producción. Lo
 * único simulado es el transporte.
 *
 * G1 · un `processing` con lease vencido se vuelve a reclamar.
 * G2 · el reclamo cambia el token y el dueño antiguo ya no puede cerrar.
 * G3 · el índice único parcial impide dos continuaciones vivas del mismo lote.
 * G4 · con conexiones simultáneas nadie reclama el mismo trabajo, y SKIP LOCKED
 *      deja tomar OTRO disponible.
 * G5 · anon/authenticated no leen, no modifican y no reclaman; service_role sí.
 *
 * 0 proveedores · 0 créditos · 0 red externa · 0 Producción · 0 infraestructura
 * de pago.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  resolveEmbeddedPostgres,
  applyContinuationMigration,
  postgrestShim,
  MINIMAL_DEPENDENCIES_SQL,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/continuation-postgres-harness';
import { runApolloRoundContinuationWorkerFromEnv } from '../continuation-worker.server';
import {
  authorizeRunBudgetSpend,
  settleRunBudgetSpend,
  markRunBudgetSpendIndeterminate,
  readRunBudgetLedger,
} from '../run-budget.server';
import { remainingCredits } from '../run-budget-ledger';
import { enqueueApolloRoundContinuation } from '../continuation-worker.server';
import type { SupabaseClient } from '@supabase/supabase-js';

const REPO_ROOT = join(import.meta.dirname, '../../../../..', '..');
const { ctor, skip } = resolveEmbeddedPostgres(import.meta.url);

const BATCH_A = '11111111-1111-4111-8111-111111111111';
const BATCH_B = '22222222-2222-4222-8222-222222222222';

let pg: EmbeddedPostgresLike | null = null;
let client: PgLikeClient | null = null;
let dataDir = '';

const run = async (sql: string, values?: unknown[]) => {
  if (!client) throw new Error('sin cliente');
  return client.query(sql, values);
};

/** Inserta un trabajo con estado y lease controlados. Datos sintéticos. */
async function seedJob(input: {
  batchId: string;
  status?: string;
  leaseExpiresSql?: string;
  leaseToken?: string | null;
  /** Un trabajo en `processing` llegó ahí por un reclamo, que ya gastó un intento. */
  attempts?: number;
}): Promise<{ id: string; leaseToken: string | null }> {
  const { rows } = await run(
    `INSERT INTO apollo_round_continuation_jobs
       (batch_id, wizard_run_id, idempotency_key, request_fingerprint, status, lease_token, attempts, lease_expires_at)
     VALUES ($1::uuid, 'run', $2::text, $3::text, $4::text, $5::uuid, $6::int, ${input.leaseExpiresSql ?? 'NULL'})
     RETURNING id::text, lease_token::text`,
    [
      input.batchId,
      `idem-${input.batchId}`,
      `fp-${input.batchId}`,
      input.status ?? 'pending',
      input.leaseToken ?? null,
      input.attempts ?? (input.status === 'processing' ? 1 : 0),
    ],
  );
  return {
    id: String(rows[0]!['id']),
    leaseToken: (rows[0]!['lease_token'] as string | null) ?? null,
  };
}

async function readJob(id: string) {
  const { rows } = await run(
    `SELECT id::text, status, attempts, lease_token::text, locked_by,
            lease_expires_at IS NOT NULL AS tiene_lease
       FROM apollo_round_continuation_jobs WHERE id = $1::uuid`,
    [id],
  );
  return rows[0] ?? null;
}

before(async () => {
  if (!ctor) return;
  dataDir = join(
    process.env['TMPDIR'] ?? '/tmp',
    `pg139-${process.pid}-${Date.now()}`,
  );
  pg = new ctor({ databaseDir: dataDir, port: 54329 + (process.pid % 200), persistent: false });
  await pg.initialise();
  await pg.start();
  client = pg.getPgClient();
  await client.connect();
  await client.query(MINIMAL_DEPENDENCIES_SQL);
  await applyContinuationMigration(client, REPO_ROOT);
  await client.query(
    `INSERT INTO prospect_batches (id) VALUES ($1::uuid), ($2::uuid) ON CONFLICT DO NOTHING`,
    [BATCH_A, BATCH_B],
  );
});

after(async () => {
  if (client) await client.end().catch(() => {});
  if (pg) await pg.stop().catch(() => {});
});

const suite = skip ? describe.skip : describe;
if (skip) console.warn(`[pg139] suite saltada: ${skip}`);

// ── G1 · recuperación de un trabajo interrumpido ─────────────────────────────

suite('§ G1 — un `processing` con lease vencido se vuelve a reclamar', () => {
  test('el reclamo real lo recupera; con lease vigente NO lo toca', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');

    // Un worker lo tomó y murió: quedó `processing` con el lease ya vencido.
    const abandonado = await seedJob({
      batchId: BATCH_A,
      status: 'processing',
      leaseToken: '33333333-3333-4333-8333-333333333333',
      leaseExpiresSql: "now() - interval '1 minute'",
    });

    const { data, error } = await postgrestShim(run).rpc(
      'claim_apollo_round_continuation_jobs',
      { p_worker_id: 'worker-nuevo', p_limit: 5, p_lease_seconds: 300, p_batch_id: null },
    );
    assert.equal(error, null);
    assert.equal(
      (data ?? []).length,
      1,
      '🔴 un `processing` abandonado TIENE que volver a ser reclamable',
    );

    const despues = await readJob(abandonado.id);
    assert.equal(despues?.['status'], 'processing');
    assert.equal(despues?.['locked_by'], 'worker-nuevo');
    assert.equal(
      despues?.['attempts'],
      2,
      'el reclamo gasta un intento sobre el que ya había gastado el dueño anterior',
    );

    // Y ahora, con el lease VIGENTE, un tercer reclamo no se lo lleva.
    const segundo = await postgrestShim(run).rpc('claim_apollo_round_continuation_jobs', {
      p_worker_id: 'worker-tardio',
      p_limit: 5,
      p_lease_seconds: 300,
      p_batch_id: null,
    });
    assert.equal((segundo.data ?? []).length, 0, 'un lease vigente protege al dueño');
  });

  test('un `pending` con `next_retry_at` futuro tampoco se reclama', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    const job = await seedJob({ batchId: BATCH_A });
    await run(
      `UPDATE apollo_round_continuation_jobs SET next_retry_at = now() + interval '1 hour' WHERE id = $1::uuid`,
      [job.id],
    );
    const { data } = await postgrestShim(run).rpc('claim_apollo_round_continuation_jobs', {
      p_worker_id: 'w',
      p_limit: 5,
      p_lease_seconds: 300,
      p_batch_id: null,
    });
    assert.equal((data ?? []).length, 0, 'la espera de reintento se respeta');
  });
});

// ── G2 · token de propiedad, con el cierre REAL ──────────────────────────────

suite('§ G2 — el dueño antiguo no puede cerrar con su token', () => {
  test('el reclamo acuña token nuevo y el `settleJob` real del antiguo no aplica', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    const job = await seedJob({
      batchId: BATCH_A,
      status: 'processing',
      leaseToken: '44444444-4444-4444-8444-444444444444',
      leaseExpiresSql: "now() - interval '1 minute'",
    });
    const tokenAntiguo = '44444444-4444-4444-8444-444444444444';

    const { data } = await postgrestShim(run).rpc('claim_apollo_round_continuation_jobs', {
      p_worker_id: 'nuevo',
      p_limit: 1,
      p_lease_seconds: 300,
      p_batch_id: null,
    });
    const tokenNuevo = String((data ?? [])[0]?.['lease_token']);
    assert.notEqual(tokenNuevo, tokenAntiguo, 'cada reclamo acuña un token distinto');

    // El worker ANTIGUO intenta cerrar con su token, por el camino REAL: se
    // invoca `runApolloRoundContinuationWorkerFromEnv`, que construye el
    // `settleJob` de producción. El reclamo que hace no encuentra nada (el
    // lease del nuevo está vigente), así que lo que se comprueba es que el
    // estado del NUEVO dueño sigue intacto.
    const shim = postgrestShim(run) as unknown as SupabaseClient;
    await runApolloRoundContinuationWorkerFromEnv({ client: shim, limit: 1 });

    const despues = await readJob(job.id);
    assert.equal(despues?.['lease_token'], tokenNuevo, 'el token del nuevo no se tocó');
    assert.equal(despues?.['status'], 'processing', 'el trabajo sigue siendo del nuevo');
  });

  test('un UPDATE con el token equivocado afecta CERO filas', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    const job = await seedJob({
      batchId: BATCH_A,
      status: 'processing',
      leaseToken: '55555555-5555-4555-8555-555555555555',
      leaseExpiresSql: "now() + interval '5 minutes'",
    });

    // El MISMO par de filtros que usa `settleJob`: id + lease_token.
    const { rows } = await run(
      `UPDATE apollo_round_continuation_jobs
          SET status = 'failed'
        WHERE id = $1::uuid AND lease_token = $2::uuid
        RETURNING id`,
      [job.id, '66666666-6666-4666-8666-666666666666'],
    );
    assert.equal(rows.length, 0, '🔴 el vallado por token es lo que impide la sobrescritura');
    assert.equal((await readJob(job.id))?.['status'], 'processing');
  });
});

// ── G3 · índice único parcial ────────────────────────────────────────────────

suite('§ G3 — un lote no puede tener dos continuaciones vivas', () => {
  test('el segundo encolado REAL choca con 23505 y el primero sobrevive', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    const shim = postgrestShim(run) as unknown as SupabaseClient;
    const payload = {
      batchId: BATCH_A,
      wizardRunId: 'run-1',
      idempotencyKey: 'idem-1',
      requestFingerprint: 'fp-1',
      runInput: { reservedBatchId: BATCH_A } as never,
      client: shim,
    };

    const primero = await enqueueApolloRoundContinuation(payload);
    assert.equal(primero.enqueued, true);

    const segundo = await enqueueApolloRoundContinuation(payload);
    assert.equal(segundo.enqueued, false);
    assert.equal(
      segundo.reason,
      'already_queued',
      '🔴 el 23505 del índice parcial es lo que el código traduce a «ya encolado»',
    );

    const { rows } = await run(
      `SELECT count(*)::int AS n FROM apollo_round_continuation_jobs WHERE batch_id = $1::uuid`,
      [BATCH_A],
    );
    assert.equal(rows[0]!['n'], 1, 'sigue habiendo UNA continuación viva');
  });

  test('cerrado el primero, el lote admite una continuación nueva', async () => {
    await run(
      `UPDATE apollo_round_continuation_jobs SET status = 'completed' WHERE batch_id = $1::uuid`,
      [BATCH_A],
    );
    const shim = postgrestShim(run) as unknown as SupabaseClient;
    const tercero = await enqueueApolloRoundContinuation({
      batchId: BATCH_A,
      wizardRunId: 'run-2',
      idempotencyKey: 'idem-2',
      requestFingerprint: 'fp-2',
      runInput: { reservedBatchId: BATCH_A } as never,
      client: shim,
    });
    assert.equal(
      tercero.enqueued,
      true,
      'el índice es PARCIAL: sólo excluye pending/processing',
    );
  });
});

// ── G4 · concurrencia real con dos conexiones ────────────────────────────────

suite('§ G4 — dos trabajadores simultáneos y SKIP LOCKED', () => {
  test('con una fila bloqueada por otra conexión, el reclamo toma OTRA', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    const a = await seedJob({ batchId: BATCH_A });
    await run(
      `UPDATE apollo_round_continuation_jobs SET created_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      [a.id],
    );
    const b = await seedJob({ batchId: BATCH_B });

    // Segunda CONEXIÓN real: mantiene la fila `a` bloqueada dentro de una
    // transacción abierta mientras la primera intenta reclamar.
    const otra = pg!.getPgClient();
    await otra.connect();
    try {
      await otra.query('BEGIN');
      await otra.query(
        `SELECT id FROM apollo_round_continuation_jobs WHERE id = $1::uuid FOR UPDATE`,
        [a.id],
      );

      const { data } = await postgrestShim(run).rpc('claim_apollo_round_continuation_jobs', {
        p_worker_id: 'worker-2',
        p_limit: 1,
        p_lease_seconds: 300,
        p_batch_id: null,
      });

      assert.equal((data ?? []).length, 1, 'SKIP LOCKED evita quedarse esperando');
      assert.equal(
        String((data ?? [])[0]?.['id']),
        b.id,
        '🔴 se salta la bloqueada y toma la siguiente disponible',
      );
      await otra.query('ROLLBACK');
    } finally {
      await otra.end().catch(() => {});
    }
  });

  test('dos reclamos seguidos NO se llevan el mismo trabajo', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    const a = await seedJob({ batchId: BATCH_A });
    const b = await seedJob({ batchId: BATCH_B });

    const shim = postgrestShim(run);
    const uno = await shim.rpc('claim_apollo_round_continuation_jobs', {
      p_worker_id: 'cron',
      p_limit: 1,
      p_lease_seconds: 300,
      p_batch_id: null,
    });
    const dos = await shim.rpc('claim_apollo_round_continuation_jobs', {
      p_worker_id: 'wizard',
      p_limit: 1,
      p_lease_seconds: 300,
      p_batch_id: null,
    });

    const ids = [String((uno.data ?? [])[0]?.['id']), String((dos.data ?? [])[0]?.['id'])];
    assert.equal(new Set(ids).size, 2, 'cada uno se lleva un trabajo distinto');
    assert.deepEqual([...ids].sort(), [a.id, b.id].sort());
  });

  test('el reclamo acotado por lote sólo ve SU lote', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    await seedJob({ batchId: BATCH_A });
    const b = await seedJob({ batchId: BATCH_B });

    const { data } = await postgrestShim(run).rpc('claim_apollo_round_continuation_jobs', {
      p_worker_id: 'wizard',
      p_limit: 5,
      p_lease_seconds: 300,
      p_batch_id: BATCH_B,
    });
    assert.equal((data ?? []).length, 1);
    assert.equal(String((data ?? [])[0]?.['id']), b.id);
  });
});

// ── G5 · permisos efectivos por rol ──────────────────────────────────────────

suite('§ G5 — los roles de cliente no tocan la cola; service_role sí', () => {
  test('anon y authenticated no leen, no escriben y no reclaman', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    await seedJob({ batchId: BATCH_A });

    for (const rol of ['anon', 'authenticated']) {
      await run(`SET LOCAL ROLE ${rol}`).catch(() => undefined);
      await run('BEGIN');
      await run(`SET LOCAL ROLE ${rol}`);

      await assert.rejects(
        () => run('SELECT * FROM apollo_round_continuation_jobs'),
        /permission denied/i,
        `${rol} no puede LEER`,
      );
      await run('ROLLBACK');

      await run('BEGIN');
      await run(`SET LOCAL ROLE ${rol}`);
      await assert.rejects(
        () => run(`UPDATE apollo_round_continuation_jobs SET status = 'failed'`),
        /permission denied/i,
        `${rol} no puede MODIFICAR`,
      );
      await run('ROLLBACK');

      await run('BEGIN');
      await run(`SET LOCAL ROLE ${rol}`);
      await assert.rejects(
        () =>
          run(
            `SELECT * FROM claim_apollo_round_continuation_jobs('w', 1, 300, NULL)`,
          ),
        /permission denied/i,
        `${rol} no puede RECLAMAR`,
      );
      await run('ROLLBACK');
    }
  });

  test('service_role lee, escribe y reclama', async () => {
    await run('TRUNCATE apollo_round_continuation_jobs');
    await seedJob({ batchId: BATCH_A });

    await run('BEGIN');
    await run('SET LOCAL ROLE service_role');
    const leido = await run('SELECT count(*)::int AS n FROM apollo_round_continuation_jobs');
    assert.equal(leido.rows[0]!['n'], 1, 'service_role LEE');

    const reclamado = await run(
      `SELECT * FROM claim_apollo_round_continuation_jobs('worker', 1, 300, NULL)`,
    );
    assert.equal(reclamado.rows.length, 1, 'service_role RECLAMA');
    await run('ROLLBACK');
  });
});

// ── G6 · la diferencia REAL de service_role, registrada ──────────────────────

suite('§ G6 — service_role recibe MÁS privilegios de los que la 139 concede', () => {
  /**
   * 🔴 REGISTRO DE UNA DIFERENCIA CONOCIDA, no una aspiración.
   *
   * La 139 escribe `GRANT SELECT, INSERT, UPDATE ... TO service_role`, y su
   * comentario dice que ésos son los privilegios. No lo son: los *default
   * privileges* de la plataforma conceden ALL a `service_role` sobre toda tabla
   * nueva del esquema `public`, así que el GRANT de la migración no añade nada
   * y la tabla nace además con DELETE, TRUNCATE, REFERENCES y TRIGGER.
   *
   * No es exposición a clientes —`anon` y `authenticated` quedan en cero, y eso
   * lo comprueba § G5—, pero el comentario de la migración afirma algo más
   * estrecho que la realidad. Queda registrado AQUÍ, en una prueba que falla si
   * la situación cambia, en vez de editar retroactivamente una migración ya
   * aplicada en Producción.
   *
   * Cerrarlo, si se decide, exige una migración nueva con
   * `REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ... FROM service_role`.
   */
  test('la tabla nace con ALL para service_role pese al GRANT acotado', async () => {
    const { rows } = await run(
      `SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) AS privilegios
         FROM information_schema.role_table_grants
        WHERE table_name = 'apollo_round_continuation_jobs' AND grantee = 'service_role'`,
    );
    assert.equal(
      rows[0]!['privilegios'],
      'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
      'si esto cambia, el comentario de la 139 o los default privileges se movieron',
    );
  });

  test('y aun así ningún rol de cliente tiene un solo privilegio', async () => {
    const { rows } = await run(
      `SELECT count(*)::int AS n
         FROM information_schema.role_table_grants
        WHERE table_name = 'apollo_round_continuation_jobs'
          AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
    );
    assert.equal(rows[0]!['n'], 0);
  });
});


// ── G7 · el presupuesto durable, con CAS REAL ────────────────────────────────

suite('§ G7 — el tope acumulado resiste concurrencia contra Postgres', () => {
  const IDENTITY = { idempotencyKey: 'idem-budget', requestFingerprint: 'fp-budget' };
  const shim = () => postgrestShim(run) as never;

  async function resetBudget() {
    await run(
      `UPDATE prospect_batches SET metadata = '{}'::jsonb WHERE id = $1::uuid`,
      [BATCH_A],
    );
  }

  test('la reserva queda DURABLE y el remanente baja entre invocaciones', async () => {
    await resetBudget();
    const first = await authorizeRunBudgetSpend(
      BATCH_A, IDENTITY,
      { operationId: 'page-1', operationKey: 'organizations_search', estimatedCredits: 1, maxCredits: 3 },
      shim(),
    );
    assert.equal(first.authorized, true);

    // Otra «invocación»: relee el documento, no el `runInput`.
    const ledger = await readRunBudgetLedger(BATCH_A, IDENTITY, 3, shim());
    assert.ok(ledger);
    assert.equal(remainingCredits(ledger!), 2, 'la reserva sobrevivió a la invocación');
  });

  test('continuación con presupuesto YA consumido: no autoriza', async () => {
    await resetBudget();
    for (const id of ['p1', 'p2', 'p3']) {
      const ok = await authorizeRunBudgetSpend(
        BATCH_A, IDENTITY,
        { operationId: id, operationKey: 'organizations_search', estimatedCredits: 1, maxCredits: 3 },
        shim(),
      );
      assert.equal(ok.authorized, true);
    }
    // La continuación llega con el MISMO máximo en su `runInput`.
    const cuarta = await authorizeRunBudgetSpend(
      BATCH_A, IDENTITY,
      { operationId: 'p4', operationKey: 'organizations_search', estimatedCredits: 1, maxCredits: 3 },
      shim(),
    );
    assert.equal(cuarta.authorized, false, '🔴 el tope NO se reinicia en la continuación');
    if (!cuarta.authorized) assert.equal(cuarta.reason, 'insufficient_budget');
  });

  test('dos ejecutores compiten por el ÚLTIMO crédito y sólo uno lo obtiene', async () => {
    await resetBudget();
    const otra = pg!.getPgClient();
    await otra.connect();
    try {
      const runB = (sql: string, values?: unknown[]) => otra.query(sql, values);
      const [a, b] = await Promise.all([
        authorizeRunBudgetSpend(
          BATCH_A, IDENTITY,
          { operationId: 'cron', operationKey: 'organization_enrichment', estimatedCredits: 1, maxCredits: 1 },
          shim(),
        ),
        authorizeRunBudgetSpend(
          BATCH_A, IDENTITY,
          { operationId: 'wizard', operationKey: 'organization_enrichment', estimatedCredits: 1, maxCredits: 1 },
          postgrestShim(runB) as never,
        ),
      ]);

      const autorizados = [a, b].filter((r) => r.authorized).length;
      assert.equal(autorizados, 1, '🔴 el último crédito NO puede reservarse dos veces');

      const ledger = await readRunBudgetLedger(BATCH_A, IDENTITY, 1, shim());
      assert.equal(remainingCredits(ledger!), 0);
      assert.equal(ledger!.entries.length, 1, 'una sola reserva quedó escrita');
    } finally {
      await otra.end().catch(() => {});
    }
  });

  test('una liquidación indeterminada NO devuelve el crédito', async () => {
    await resetBudget();
    await authorizeRunBudgetSpend(
      BATCH_A, IDENTITY,
      { operationId: 'perdida', operationKey: 'organizations_search', estimatedCredits: 1, maxCredits: 2 },
      shim(),
    );
    await markRunBudgetSpendIndeterminate(
      BATCH_A, IDENTITY, { operationId: 'perdida', observedCredits: null, maxCredits: 2 }, shim(),
    );
    const ledger = await readRunBudgetLedger(BATCH_A, IDENTITY, 2, shim());
    assert.equal(remainingCredits(ledger!), 1, 'sigue comprometido');
  });

  test('liquidar por debajo devuelve remanente', async () => {
    await resetBudget();
    await authorizeRunBudgetSpend(
      BATCH_A, IDENTITY,
      { operationId: 'e1', operationKey: 'organization_enrichment', estimatedCredits: 1, maxCredits: 2 },
      shim(),
    );
    await settleRunBudgetSpend(BATCH_A, IDENTITY, { operationId: 'e1', credits: 0, maxCredits: 2 }, shim());
    const ledger = await readRunBudgetLedger(BATCH_A, IDENTITY, 2, shim());
    assert.equal(remainingCredits(ledger!), 2, 'el no_match devuelve lo reservado');
  });

  test('otra corrida sobre el MISMO lote no hereda el presupuesto', async () => {
    await resetBudget();
    await authorizeRunBudgetSpend(
      BATCH_A, IDENTITY,
      { operationId: 'p1', operationKey: 'organizations_search', estimatedCredits: 2, maxCredits: 2 },
      shim(),
    );
    const otraCorrida = await readRunBudgetLedger(
      BATCH_A, { idempotencyKey: 'otra', requestFingerprint: 'otra' }, 2, shim(),
    );
    assert.equal(remainingCredits(otraCorrida!), 2, 'la identidad separa presupuestos');
  });
});
