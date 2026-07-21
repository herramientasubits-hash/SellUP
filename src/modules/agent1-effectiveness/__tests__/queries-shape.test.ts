// Q3F-5AX.2 — queries shape/safety tests (non-live, no real DB).
//
// The query layer needs Supabase service credentials, so we do NOT hit a real
// DB. Instead we prove two things that matter for a READ-ONLY model:
//   1. The exported entry points exist and are callable.
//   2. The source performs NO write/RPC operations (static scan) — the strongest
//      non-live guarantee that this layer cannot mutate data.
//   3. Without credentials the loader fails closed (throws), never silently
//      touching a default project.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchAgent1EffectivenessEvidence } from '../queries';
import { getAgent1EffectivenessSummary } from '../actions';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUERIES_SRC = readFileSync(join(HERE, '..', 'queries.ts'), 'utf8');

describe('queries — exported shape', () => {
  it('exposes callable read entry points', () => {
    assert.equal(typeof fetchAgent1EffectivenessEvidence, 'function');
    assert.equal(typeof getAgent1EffectivenessSummary, 'function');
  });
});

describe('queries — no write/RPC operations (static scan)', () => {
  const forbidden = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc('];
  for (const token of forbidden) {
    it(`source does not call ${token}`, () => {
      assert.equal(QUERIES_SRC.includes(token), false, `queries.ts must not call ${token}`);
    });
  }

  it('only uses read verbs (.from/.select/.eq/.in/.gte/.lt/.limit)', () => {
    assert.ok(QUERIES_SRC.includes('.select('));
    assert.ok(QUERIES_SRC.includes('.from('));
    assert.ok(QUERIES_SRC.includes('.limit('));
  });

  it('references the three canonical tables and not agent_runs as source', () => {
    assert.ok(QUERIES_SRC.includes('prospect_batches'));
    assert.ok(QUERIES_SRC.includes('prospect_candidates'));
    assert.ok(QUERIES_SRC.includes('provider_usage_logs'));
    assert.equal(QUERIES_SRC.includes("from('agent_runs')"), false);
    assert.equal(QUERIES_SRC.includes('from("agent_runs")'), false);
  });
});

describe('queries — Q3F-5AY.4 classification columns selected (static scan)', () => {
  it('selects the persisted migration-093 classification columns', () => {
    for (const col of [
      'record_origin',
      'rejection_reason',
      'classification_source',
      'classification_confidence',
    ]) {
      assert.ok(QUERIES_SRC.includes(col), `queries.ts must select ${col}`);
    }
  });

  it('selects the raw signals the runtime fallback classifier needs', () => {
    for (const col of ['source_primary', 'review_notes', 'metadata']) {
      assert.ok(QUERIES_SRC.includes(col), `queries.ts must select ${col}`);
    }
  });

  it('still performs no write/RPC after adding the new columns', () => {
    for (const token of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      assert.equal(QUERIES_SRC.includes(token), false, `queries.ts must not call ${token}`);
    }
  });
});

describe('queries — fail closed without credentials', () => {
  it('throws when Supabase service credentials are absent', async () => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      await assert.rejects(
        () => fetchAgent1EffectivenessEvidence({ batchId: 'b1' }),
        /Supabase service credentials not configured/,
      );
    } finally {
      if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });
});
