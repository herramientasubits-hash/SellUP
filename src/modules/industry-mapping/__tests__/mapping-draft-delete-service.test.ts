// Tests — mapping-draft-delete-service.ts (Q3F-5AR.0)
// Offline: no Supabase, no network, no provider, no AI. Uses a hand-written
// fake RPC-only DB client — same DI convention as the other industry-mapping
// domain service test suites. Covers DD-1 through DD-14 (RPC contract +
// error mapping) and DD-28 through DD-30 (no provider/AI/usage-cost import).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  deleteMappingDraft,
  DELETE_DRAFT_MAPPING_SNAPSHOT_RPC,
} from '../mapping-draft-delete-service';
import { MappingDraftError } from '../mapping-draft-types';
import { makeFakeMappingDraftDeleteDb } from './fake-mapping-draft-delete-db';

const SNAPSHOT_ID = 'snapshot-0001';
const ACTOR_ID = 'actor-0001';

function okDb() {
  return makeFakeMappingDraftDeleteDb(() => ({ data: null, error: null }));
}

describe('deleteMappingDraft — input validation (DD-1, DD-2)', () => {
  it('DD-1: empty snapshotId is rejected before the RPC call', async () => {
    const { db, calls } = okDb();

    await assert.rejects(() => deleteMappingDraft(db, { snapshotId: '', actorId: ACTOR_ID }));
    assert.equal(calls.length, 0, 'RPC must not be invoked when snapshotId is empty');
  });

  it('DD-2: empty actorId is rejected before the RPC call', async () => {
    const { db, calls } = okDb();

    await assert.rejects(() => deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: '' }));
    assert.equal(calls.length, 0, 'RPC must not be invoked when actorId is empty');
  });
});

describe('deleteMappingDraft — exact RPC contract (DD-3, DD-4, DD-5, DD-6)', () => {
  it('DD-3/DD-4/DD-5/DD-6: invokes the exact RPC name with the exact migration 082 argument names, forwarding snapshotId/actorId exactly', async () => {
    const { db, calls } = okDb();

    await deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: ACTOR_ID });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.fn, DELETE_DRAFT_MAPPING_SNAPSHOT_RPC);
    assert.equal(calls[0]!.fn, 'delete_draft_provider_industry_mapping_snapshot');
    assert.deepEqual(Object.keys(calls[0]!.params).sort(), ['p_actor_id', 'p_snapshot_id']);
    assert.equal(calls[0]!.params.p_snapshot_id, SNAPSHOT_ID);
    assert.equal(calls[0]!.params.p_actor_id, ACTOR_ID);
  });
});

describe('deleteMappingDraft — no direct table DELETE, no archive/publish call (DD-7, DD-8, DD-9)', () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(moduleDir, '..', 'mapping-draft-delete-service.ts'), 'utf8');

  it('DD-7: the domain service module never calls .from( / DELETE FROM (no direct table DELETE)', () => {
    assert.doesNotMatch(source, /\.from\(/);
    assert.doesNotMatch(source, /DELETE\s+FROM/i);
  });

  it('DD-8: the domain service module never references the archive RPC', () => {
    assert.doesNotMatch(source, /archive_provider_industry_mapping_snapshot/);
  });

  it('DD-9: the domain service module never references the publish RPC', () => {
    assert.doesNotMatch(source, /publish_provider_industry_mapping_snapshot/);
  });

  it('the only RPC name literal present is the delete-draft RPC', () => {
    const rpcNameMatches = [...source.matchAll(/'([a-z_]+_provider_industry_mapping_snapshot)'/g)].map(
      (m) => m[1],
    );
    for (const name of rpcNameMatches) {
      assert.equal(name, 'delete_draft_provider_industry_mapping_snapshot');
    }
  });
});

describe('deleteMappingDraft — RPC error mapping onto existing typed codes (DD-10, DD-11, DD-12)', () => {
  it('DD-10: SNAPSHOT_NOT_FOUND maps to MAPPING_SNAPSHOT_NOT_FOUND', async () => {
    const { db } = makeFakeMappingDraftDeleteDb(() => ({
      data: null,
      error: { message: 'SNAPSHOT_NOT_FOUND' },
    }));

    await assert.rejects(
      () => deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: ACTOR_ID }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_FOUND');
        return true;
      },
    );
  });

  it('DD-11: SNAPSHOT_NOT_DRAFT maps to MAPPING_SNAPSHOT_NOT_DRAFT', async () => {
    const { db } = makeFakeMappingDraftDeleteDb(() => ({
      data: null,
      error: { message: 'SNAPSHOT_NOT_DRAFT' },
    }));

    await assert.rejects(
      () => deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: ACTOR_ID }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_SNAPSHOT_NOT_DRAFT');
        return true;
      },
    );
  });

  it('DD-12: DRAFT_AUTHOR_REQUIRED maps to MAPPING_DRAFT_AUTHOR_REQUIRED', async () => {
    const { db } = makeFakeMappingDraftDeleteDb(() => ({
      data: null,
      error: { message: 'DRAFT_AUTHOR_REQUIRED' },
    }));

    await assert.rejects(
      () => deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: ACTOR_ID }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_AUTHOR_REQUIRED');
        return true;
      },
    );
  });
});

describe('deleteMappingDraft — unknown RPC failure (DD-13, DD-14)', () => {
  it('DD-13: unknown RPC failure exposes a stable sanitized public message', async () => {
    const rawInfrastructureMessage = 'FATAL: relation "public.x" pg_temp connection reset by peer 08006';
    const { db } = makeFakeMappingDraftDeleteDb(() => ({
      data: null,
      error: { message: rawInfrastructureMessage, code: '08006' },
    }));

    await assert.rejects(
      () => deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: ACTOR_ID }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.code, 'MAPPING_DRAFT_WRITE_FAILED');
        assert.equal(error.message, 'Failed to delete mapping draft.');
        assert.doesNotMatch(error.message, /pg_temp|relation|08006/);
        return true;
      },
    );
  });

  it('DD-14: unknown RPC failure preserves the original error as cause', async () => {
    const originalError = { message: 'some other unexpected condition', code: 'XX000' };
    const { db } = makeFakeMappingDraftDeleteDb(() => ({ data: null, error: originalError }));

    await assert.rejects(
      () => deleteMappingDraft(db, { snapshotId: SNAPSHOT_ID, actorId: ACTOR_ID }),
      (error: unknown) => {
        assert.ok(error instanceof MappingDraftError);
        assert.equal(error.cause, originalError);
        return true;
      },
    );
  });
});

describe('deleteMappingDraft — no provider/AI/usage-cost import (DD-28, DD-29, DD-30)', () => {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(moduleDir, '..', 'mapping-draft-delete-service.ts'), 'utf8');
  const importLines = [...source.matchAll(/^import .*$/gm)].map((m) => m[0]);

  it('DD-28: no provider import', () => {
    for (const line of importLines) {
      assert.doesNotMatch(line, /apollo|lusha|@\/server\/integrations|@\/server\/agents/i);
    }
  });

  it('DD-29: no AI import', () => {
    for (const line of importLines) {
      assert.doesNotMatch(line, /openai|anthropic|\bai\b/i);
    }
  });

  it('DD-30: no usage/cost tracking import', () => {
    for (const line of importLines) {
      assert.doesNotMatch(line, /usage-tracking|usage_tracking|cost|billing/i);
    }
  });

  it('sanity: the module imports only from mapping-draft-types', () => {
    assert.equal(importLines.length, 1);
    assert.match(importLines[0]!, /from '\.\/mapping-draft-types';$/);
  });
});
