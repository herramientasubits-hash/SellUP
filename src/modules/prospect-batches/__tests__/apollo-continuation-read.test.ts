/**
 * apollo-continuation-read.test.ts — el LECTOR del estado de la continuación.
 *
 * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 1.
 *
 * El recorrido de la pantalla vive en
 * `wizard-apollo-continuation-journey-runtime.test.tsx`; aquí se cubre la mitad
 * de servidor que aquél sustituye: qué se lee de la cola y del checkpoint, y
 * —sobre todo— qué NO se afirma cuando faltan datos.
 *
 * Sin base de datos: el cliente es un doble que satisface la superficie mínima,
 * la misma disciplina que usa `checkpoint.server`.
 *
 * LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  listOpenContinuationBatchIds,
  readApolloContinuationSnapshot,
  readLatestContinuationJob,
  type ApolloContinuationReadClient,
} from '../apollo-continuation-read.server';
import { APOLLO_TWO_ROUND_CHECKPOINT_KEY } from '@/server/agents/prospecting-toolkit/apollo-two-round/checkpoint';

const BATCH_ID = 'batch-1';
const IDEMPOTENCY_KEY = 'idem-1';
const REQUEST_FINGERPRINT = 'fp-1';

type JobRow = {
  batch_id: string;
  status: string;
  idempotency_key: string;
  request_fingerprint: string;
  created_at: string;
};

function checkpointDocument(pendingOrganizations: number, identity = {
  idempotencyKey: IDEMPOTENCY_KEY,
  requestFingerprint: REQUEST_FINGERPRINT,
}) {
  return {
    version: 1,
    checkpoint_version: 3,
    idempotency_key: identity.idempotencyKey,
    request_fingerprint: identity.requestFingerprint,
    wizard_run_id: 'run-1',
    completed_operation_keys: [],
    candidate_snapshots: [],
    round_summaries: [],
    pending_organizations: Array.from({ length: pendingOrganizations }, (_, index) => ({
      organizationId: `org-${index}`,
    })),
    candidates_persisted: false,
  };
}

/**
 * Doble del cliente: cola + metadata del lote.
 *
 * Registra las consultas para poder afirmar que la lectura NO escribe y que no
 * toca más tablas de las que dice tocar.
 */
function fakeClient(options: {
  jobs?: JobRow[];
  batchMetadata?: Record<string, unknown> | null;
}): { client: ApolloContinuationReadClient; tables: string[] } {
  const tables: string[] = [];
  const jobs = options.jobs ?? [];

  const client = {
    from(table: string) {
      tables.push(table);
      if (table === 'prospect_batches') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { metadata: options.batchMetadata ?? null },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            order: () => ({
              limit: async (count: number) => ({
                data: jobs.filter((job) => job.batch_id === value).slice(0, count),
                error: null,
              }),
            }),
          }),
          in: (_column: string, values: readonly string[]) => ({
            order: () => ({
              limit: async (count: number) => ({
                data: jobs.filter((job) => values.includes(job.status)).slice(0, count),
                error: null,
              }),
            }),
          }),
        }),
      };
    },
  } as unknown as ApolloContinuationReadClient;

  return { client, tables };
}

const job = (status: string, overrides: Partial<JobRow> = {}): JobRow => ({
  batch_id: BATCH_ID,
  status,
  idempotency_key: IDEMPOTENCY_KEY,
  request_fingerprint: REQUEST_FINGERPRINT,
  created_at: '2026-09-21T00:00:00.000Z',
  ...overrides,
});

describe('§ 1 — el último trabajo del lote', () => {
  it('sin trabajos devuelve null, no un estado inventado', async () => {
    const { client } = fakeClient({ jobs: [] });
    assert.equal(await readLatestContinuationJob(BATCH_ID, client), null);
  });

  it('una fila con estado desconocido se descarta entera', async () => {
    const { client } = fakeClient({ jobs: [job('transmogrified')] });
    assert.equal(await readLatestContinuationJob(BATCH_ID, client), null);
  });

  it('devuelve estado e identidad, que es lo que el checkpoint necesita', async () => {
    const { client } = fakeClient({ jobs: [job('processing')] });
    assert.deepEqual(await readLatestContinuationJob(BATCH_ID, client), {
      status: 'processing',
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: REQUEST_FINGERPRINT,
    });
  });
});

describe('§ 1 — el estado visible de un lote', () => {
  it('sin trabajo en la cola el lote está terminado', async () => {
    const { client } = fakeClient({ jobs: [] });
    assert.deepEqual(await readApolloContinuationSnapshot(BATCH_ID, client), {
      status: 'finished',
      pendingOrganizationCount: 0,
    });
  });

  it('trabajo encolado con organizaciones pendientes ⇒ pendiente de continuación', async () => {
    const { client } = fakeClient({
      jobs: [job('pending')],
      batchMetadata: { [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: checkpointDocument(4) },
    });
    assert.deepEqual(await readApolloContinuationSnapshot(BATCH_ID, client), {
      status: 'pending_continuation',
      pendingOrganizationCount: 4,
    });
  });

  it('trabajo tomado ⇒ procesando', async () => {
    const { client } = fakeClient({
      jobs: [job('processing')],
      batchMetadata: { [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: checkpointDocument(2) },
    });
    const snapshot = await readApolloContinuationSnapshot(BATCH_ID, client);
    assert.equal(snapshot.status, 'processing');
  });

  it('trabajo agotado ⇒ fallo, aunque el checkpoint ya no tenga pendientes', async () => {
    const { client } = fakeClient({
      jobs: [job('failed')],
      batchMetadata: { [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: checkpointDocument(0) },
    });
    const snapshot = await readApolloContinuationSnapshot(BATCH_ID, client);
    assert.equal(snapshot.status, 'failed');
  });

  it('🔴 un trabajo HUÉRFANO no convierte en pendiente un lote ya terminado', async () => {
    const { client } = fakeClient({
      jobs: [job('pending')],
      batchMetadata: { [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: checkpointDocument(0) },
    });
    assert.deepEqual(await readApolloContinuationSnapshot(BATCH_ID, client), {
      status: 'finished',
      pendingOrganizationCount: 0,
    });
  });

  it('🔴 el checkpoint de OTRA corrida no se lee: identidad distinta ⇒ cero pendientes', async () => {
    const { client } = fakeClient({
      jobs: [job('pending')],
      batchMetadata: {
        [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: checkpointDocument(9, {
          idempotencyKey: 'otra-corrida',
          requestFingerprint: 'otra-huella',
        }),
      },
    });
    assert.deepEqual(await readApolloContinuationSnapshot(BATCH_ID, client), {
      status: 'finished',
      pendingOrganizationCount: 0,
    });
  });

  it('la lectura toca la cola y el lote, y nada más', async () => {
    const { client, tables } = fakeClient({
      jobs: [job('pending')],
      batchMetadata: { [APOLLO_TWO_ROUND_CHECKPOINT_KEY]: checkpointDocument(1) },
    });
    await readApolloContinuationSnapshot(BATCH_ID, client);
    assert.deepEqual(new Set(tables), new Set(['apollo_round_continuation_jobs', 'prospect_batches']));
  });
});

describe('§ 3 — candidatos a recuperar', () => {
  it('sólo los estados abiertos, sin repetir lotes', async () => {
    const { client } = fakeClient({
      jobs: [
        job('pending'),
        job('processing', { batch_id: 'batch-2' }),
        job('completed', { batch_id: 'batch-3' }),
        job('failed', { batch_id: 'batch-4' }),
        job('skipped', { batch_id: 'batch-5' }),
        job('pending', { batch_id: BATCH_ID }),
      ],
    });
    assert.deepEqual(await listOpenContinuationBatchIds(10, client), [BATCH_ID, 'batch-2']);
  });

  it('un error de la cola no se convierte en «no hay nada»… se convierte en lista vacía, y punto', async () => {
    // La distinción importa: devolver [] es lo único honesto que puede hacer un
    // LECTOR ante un fallo — lo que NO puede es inventar un lote que continuar.
    const failing = {
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => ({
              limit: async () => ({ data: null, error: { message: 'boom' } }),
            }),
          }),
        }),
      }),
    } as unknown as ApolloContinuationReadClient;
    assert.deepEqual(await listOpenContinuationBatchIds(10, failing), []);
  });
});
