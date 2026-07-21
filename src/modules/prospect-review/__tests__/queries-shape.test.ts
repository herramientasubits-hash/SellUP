// Q3F-5AZ.2A — queries shape/safety tests (non-live, no real DB).
//
// The query layer needs Supabase service credentials, so we do NOT hit a real
// DB. Instead we prove, for a READ-ONLY queue:
//   1. The exported read entry points exist and are callable.
//   2. The source performs NO write/RPC operations (static scan).
//   3. It targets the correct tables and the canonical queue criteria.
//   4. Without credentials the loader fails closed (throws), never silently
//      touching a default project.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  fetchPendingReviewEvidence,
  PENDING_REVIEW_RECORD_ORIGIN,
  PENDING_REVIEW_STATUS,
} from '../queries';
import { getPendingReviewQueue } from '../actions';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUERIES_SRC = readFileSync(join(HERE, '..', 'queries.ts'), 'utf8');
const ACTIONS_SRC = readFileSync(join(HERE, '..', 'actions.ts'), 'utf8');

describe('queries — exported shape', () => {
  it('exposes callable read entry points', () => {
    assert.equal(typeof fetchPendingReviewEvidence, 'function');
    assert.equal(typeof getPendingReviewQueue, 'function');
  });

  it('pins the canonical clean-pending criteria', () => {
    assert.equal(PENDING_REVIEW_RECORD_ORIGIN, 'production');
    assert.equal(PENDING_REVIEW_STATUS, 'needs_review');
  });
});

describe('queries — no write/RPC operations (static scan)', () => {
  const forbidden = ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc('];
  for (const token of forbidden) {
    it(`queries.ts does not call ${token}`, () => {
      assert.equal(QUERIES_SRC.includes(token), false, `queries.ts must not call ${token}`);
    });
    it(`actions.ts does not call ${token}`, () => {
      assert.equal(ACTIONS_SRC.includes(token), false, `actions.ts must not call ${token}`);
    });
  }

  it('only uses read verbs (.from/.select/.eq/.in/.order/.limit)', () => {
    assert.ok(QUERIES_SRC.includes('.select('));
    assert.ok(QUERIES_SRC.includes('.from('));
    assert.ok(QUERIES_SRC.includes('.limit('));
    assert.ok(QUERIES_SRC.includes(".eq('record_origin'"));
    assert.ok(QUERIES_SRC.includes(".eq('status'"));
  });

  it('targets prospect_candidates and prospect_batches only', () => {
    assert.ok(QUERIES_SRC.includes("from('prospect_candidates')"));
    assert.ok(QUERIES_SRC.includes("from('prospect_batches')"));
  });

  it('does not select candidate PII beyond company identity (no email/phone)', () => {
    assert.equal(QUERIES_SRC.includes('email'), false);
    assert.equal(QUERIES_SRC.includes('phone'), false);
  });
});

describe('actions — admin gate before data', () => {
  it('hard-gates on isCurrentUserAdmin before reading', () => {
    assert.ok(ACTIONS_SRC.includes('isCurrentUserAdmin'));
    assert.ok(ACTIONS_SRC.includes("status: 'restricted'"));
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
        () => fetchPendingReviewEvidence(),
        /Supabase service credentials not configured/,
      );
    } finally {
      if (prevUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });
});
