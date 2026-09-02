import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT,
  BrReceitaExistingRunWriterError,
  createBrReceitaExistingRunChunkWriter,
  preflightBrReceitaExistingRunForChunkLoad,
} from '../br-receita-cnpj-existing-run-chunk-writer';
import type {
  BrReceitaSnapshotWriteGateway,
  BrReceitaSqlExecutor,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import type {
  PublishPeriodOperation,
  UpsertBatchOperation,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
import type { BrReceitaPersistedSnapshot } from '../br-receita-cnpj-monthly-snapshot-identity';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD = '2026-07';

function snapshot(sequence: number, legalName = `Company ${sequence}`): BrReceitaPersistedSnapshot {
  const normalizedTaxId = String(sequence).padStart(14, '0');
  return {
    identity: {
      source_key: 'br_receita_cnpj_dados_abertos',
      country_code: 'BR',
      source_period: PERIOD,
      source_year: 2026,
      normalized_tax_id: normalizedTaxId,
    },
    payload: {
      legal_name: legalName,
      signals: {
        source_type: 'official_registry',
        human_review_required: true,
        matrix_branch_flag: null,
        company_size_code: null,
        capital_social_value: null,
        registration_status_code: null,
        registration_status_label: null,
        cnae_main_code: null,
        cnae_main_label: null,
        cnae_secondary_codes: [],
        municipality_code: null,
        municipality_name: null,
        uf: null,
        start_date: null,
      },
    },
  };
}

function gatewayRecorder(): {
  readonly gateway: BrReceitaSnapshotWriteGateway;
  readonly upserts: UpsertBatchOperation[];
  readonly publishes: Array<{
    readonly finalBatch: UpsertBatchOperation | null;
    readonly publish: PublishPeriodOperation;
  }>;
  readonly beginCalls: () => number;
} {
  const upserts: UpsertBatchOperation[] = [];
  const publishes: Array<{
    finalBatch: UpsertBatchOperation | null;
    publish: PublishPeriodOperation;
  }> = [];
  let beginCalls = 0;

  return {
    upserts,
    publishes,
    beginCalls: () => beginCalls,
    gateway: {
      async beginPeriodRun() {
        beginCalls += 1;
        throw new Error('begin must never be reachable');
      },
      async discardRunRows() {
        return { deletedRows: 0 };
      },
      async upsertBatch(operation) {
        upserts.push(operation);
        return { writtenRows: operation.rows.length };
      },
      async commitFinalBatchAndPublish(finalBatch, publish) {
        publishes.push({ finalBatch, publish });
        return {
          promotedRunId: publish.snapshot_run_id,
          supersededRunId: publish.supersedes?.snapshot_run_id ?? null,
          finalBatchRows: finalBatch?.rows.length ?? 0,
        };
      },
      async failPeriod() {
        return { deletedRows: 0 };
      },
    },
  };
}

test('national import pins the operator checkpoint map to 1024 ordinals', () => {
  assert.equal(BR_RECEITA_NATIONAL_EXPECTED_PARTITION_COUNT, 1024);
});

test('existing-run preflight is read-only and fails closed to one boolean fact', async () => {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const sql: BrReceitaSqlExecutor = {
    async query(statement, params = []) {
      calls.push({ sql: statement, params });
      return { rows: [{ ready: true }] };
    },
  };

  const result = await preflightBrReceitaExistingRunForChunkLoad({
    sql,
    snapshotRunId: RUN_ID,
    sourcePeriod: PERIOD,
  });

  assert.deepEqual(result, { ready: true, reason: 'ready' });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /publish_state = 'preparing'/);
  assert.match(calls[0]!.sql, /status = 'running'/);
  assert.match(calls[0]!.sql, /br_receita_run_partition_name/);
  assert.deepEqual(calls[0]!.params, [RUN_ID, 'br_receita_cnpj_dados_abertos', 'BR', PERIOD]);
});

test('writer reuses the supplied run and never calls beginPeriodRun', async () => {
  const recorder = gatewayRecorder();
  const writer = createBrReceitaExistingRunChunkWriter({
    gateway: recorder.gateway,
    snapshotRunId: RUN_ID,
    sourcePeriod: PERIOD,
  });

  for (let index = 1; index <= 501; index += 1) {
    await writer.push(snapshot(index));
  }

  assert.equal(recorder.beginCalls(), 0);
  assert.equal(recorder.upserts.length, 1);
  assert.equal(recorder.upserts[0]!.rows.length, 500);
  assert.equal(writer.stats().pendingRows, 1);

  const stats = await writer.commitChunk();
  assert.equal(recorder.beginCalls(), 0);
  assert.equal(recorder.upserts.length, 2);
  assert.equal(recorder.upserts[1]!.rows.length, 1);
  assert.deepEqual(
    recorder.upserts.map((operation) => operation.snapshot_run_id),
    [RUN_ID, RUN_ID],
  );
  assert.equal(stats.acceptedRows, 501);
  assert.equal(stats.writtenRows, 501);
  assert.equal(stats.pendingRows, 0);
  assert.equal(stats.finalized, true);
});

test('duplicate identity collapses inside the held batch with last value winning', async () => {
  const recorder = gatewayRecorder();
  const writer = createBrReceitaExistingRunChunkWriter({
    gateway: recorder.gateway,
    snapshotRunId: RUN_ID,
    sourcePeriod: PERIOD,
  });

  await writer.push(snapshot(1, 'First'));
  await writer.push(snapshot(1, 'Last'));
  const stats = await writer.commitChunk();

  assert.equal(recorder.upserts.length, 1);
  assert.equal(recorder.upserts[0]!.rows.length, 1);
  assert.equal(recorder.upserts[0]!.rows[0]!.payload.legal_name, 'Last');
  assert.equal(recorder.upserts[0]!.collapsedInBatchCount, 1);
  assert.equal(stats.acceptedRows, 2);
  assert.equal(stats.writtenRows, 1);
  assert.equal(stats.collapsedInBatchCount, 1);
});

test('final chunk preserves its held batch for the atomic publish call', async () => {
  const recorder = gatewayRecorder();
  const writer = createBrReceitaExistingRunChunkWriter({
    gateway: recorder.gateway,
    snapshotRunId: RUN_ID,
    sourcePeriod: PERIOD,
  });

  await writer.push(snapshot(1));
  await writer.push(snapshot(2));
  const stats = await writer.publishFinalChunk();

  assert.equal(recorder.beginCalls(), 0);
  assert.equal(recorder.upserts.length, 0);
  assert.equal(recorder.publishes.length, 1);
  assert.equal(recorder.publishes[0]!.finalBatch?.rows.length, 2);
  assert.equal(recorder.publishes[0]!.publish.snapshot_run_id, RUN_ID);
  assert.equal(recorder.publishes[0]!.publish.source_period, PERIOD);
  assert.equal(recorder.publishes[0]!.publish.supersedes, null);
  assert.equal(recorder.publishes[0]!.publish.mustCommitWithFinalBatch, true);
  assert.equal(stats.writtenRows, 2);
  assert.equal(stats.finalized, true);
});

test('an empty final chunk cannot publish a month', async () => {
  const recorder = gatewayRecorder();
  const writer = createBrReceitaExistingRunChunkWriter({
    gateway: recorder.gateway,
    snapshotRunId: RUN_ID,
    sourcePeriod: PERIOD,
  });

  await assert.rejects(
    () => writer.publishFinalChunk(),
    (error: unknown) =>
      error instanceof BrReceitaExistingRunWriterError && error.reason === 'final_chunk_empty',
  );
  assert.equal(recorder.publishes.length, 0);
});

test('malformed run ids are refused before any gateway method can be reached', () => {
  const recorder = gatewayRecorder();
  assert.throws(
    () =>
      createBrReceitaExistingRunChunkWriter({
        gateway: recorder.gateway,
        snapshotRunId: 'not-a-run',
        sourcePeriod: PERIOD,
      }),
    (error: unknown) =>
      error instanceof BrReceitaExistingRunWriterError && error.reason === 'run_id_malformed',
  );
  assert.equal(recorder.beginCalls(), 0);
});
