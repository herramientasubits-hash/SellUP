import assert from 'node:assert/strict';
import test from 'node:test';

import { preflightBrReceitaExistingRunForChunkLoad } from '../br-receita-cnpj-existing-run-chunk-writer';
import type { BrReceitaSqlExecutor } from '../br-receita-cnpj-monthly-snapshot-write-gateway';

const RUN_ID = '77777777-7777-4777-8777-777777777777';

test('existing-run preflight requires the run partition to remain detached', async () => {
  let statement = '';
  const sql: BrReceitaSqlExecutor = {
    async query(value) {
      statement = value;
      return { rows: [{ ready: true }] };
    },
  };

  const result = await preflightBrReceitaExistingRunForChunkLoad({
    sql,
    snapshotRunId: RUN_ID,
    sourcePeriod: '2026-07',
  });

  assert.equal(result.ready, true);
  assert.match(statement, /pg_catalog\.pg_inherits/);
  assert.match(statement, /NOT EXISTS/);
  assert.match(statement, /br_receita_run_partition_name/);
});
