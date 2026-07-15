// Tests for src/modules/automations/actions.ts —
// 17B.4X.7C.5D.3A (Batch 1 Supabase fallback migration).
//
// getAllAutomations / getAutomationsSummary / getAutomationConfig use only
// the admin client (no auth/cookies() path), so they are exercised
// behaviorally with a fake admin client injected via mock.module directly on
// '@/lib/supabase/admin' (the module actions.ts imports one hop away).
// Mocking the deeper '@supabase/supabase-js' package instead was tried first
// and did not reliably intercept admin.ts's own import of it under this
// project's tsx/CJS module resolution — mocking the one-hop-closer
// '@/lib/supabase/admin' module is the technique that actually works here
// and also sidesteps needing to satisfy the real env-guard at all.
// Requires --experimental-test-module-mocks.
//
// mock.module is registered exactly once, before the first dynamic import of
// '../actions' — the binding is fixed at that first load, so
// createSupabaseAdminClient's behavior here is driven by mutable holders
// (currentAdminResponse / shouldThrow) rather than by re-registering the
// mock mid-suite.
//
// updateAutomationMode additionally requires the '@/lib/supabase/server'
// (cookies()) auth path before touching the admin client, so it is covered
// by static source-inspection only, consistent with the documented
// limitation for cookies()-gated code under `node --test` (see
// src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts).

import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(moduleDir, '..', 'actions.ts'), 'utf8');

// ── Static wiring checks ──────────────────────────────────────────────────

describe('automations/actions.ts — admin client wiring (post 17B.4X.7C.5D.3A)', () => {
  it('imports createSupabaseAdminClient from @/lib/supabase/admin', () => {
    assert.match(
      source,
      /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
    );
  });

  it('getAdminSupabaseClient() delegates to createSupabaseAdminClient() with no fallback', () => {
    const start = source.indexOf('function getAdminSupabaseClient()');
    assert.ok(start !== -1, 'expected to find function getAdminSupabaseClient()');
    const body = source.slice(start, start + 200);
    assert.match(body, /createSupabaseAdminClient\(\)/);
  });

  it('does not contain a hardcoded Supabase project URL', () => {
    assert.equal(source.includes('lrdruowtadwbdulndlph.supabase.co'), false);
  });

  it('does not read SUPABASE_SERVICE_ROLE_KEY directly (guard owns that read)', () => {
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('updateAutomationMode still resolves admin authorization before touching the admin client (unchanged)', () => {
    const start = source.indexOf('export async function updateAutomationMode');
    assert.ok(start !== -1);
    const body = source.slice(start, start + 600);
    assert.match(body, /getAdminInternalUserId\(\)/);
    assert.match(body, /getAdminSupabaseClient\(\)/);
  });
});

// ── Behavioral: chainable fake Supabase admin client ───────────────────────
// Mirrors the ChainResult helper already used in
// src/server/agents/prospecting-toolkit/__tests__/candidate-writer-existing-batch.test.ts

class ChainResult {
  constructor(private readonly _val: unknown) {}
  eq(_col: string, _val: unknown): ChainResult { return this; }
  order(_col: string, _opts?: unknown): ChainResult { return this; }
  select(_cols: string): ChainResult { return this; }
  then<T>(
    onFulfilled: (v: unknown) => T | PromiseLike<T>,
    onRejected?: (r: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this._val).then(onFulfilled, onRejected);
  }
  single(): Promise<unknown> {
    return Promise.resolve(this._val);
  }
}

type CapturedCall = { table: string };

const captured: CapturedCall[] = [];
let currentAdminResponse: unknown = { data: [], error: null };
let shouldThrowUnsafeEnv = false;

before(() => {
  mock.module('@/lib/supabase/admin', {
    namedExports: {
      createSupabaseAdminClient: () => {
        if (shouldThrowUnsafeEnv) {
          throw new Error('UnsafeSupabaseEnvironmentError: missing_supabase_url (mocked)');
        }
        return {
          from(table: string) {
            captured.push({ table });
            return new ChainResult(currentAdminResponse);
          },
        };
      },
    },
  });
});

const FAKE_ROWS = [
  { id: '1', automation_key: 'a', name: 'Beta automation', description: null, trigger_key: 'trigger_b', category: 'accounts', execution_mode: 'automatic', is_available: true, requires_ai_provider: false, requires_prospecting_provider: false, requires_hubspot: false, created_at: '', updated_at: '', updated_by: null },
  { id: '2', automation_key: 'b', name: 'Alpha automation', description: null, trigger_key: 'trigger_a', category: 'pipeline', execution_mode: 'manual', is_available: true, requires_ai_provider: false, requires_prospecting_provider: false, requires_hubspot: false, created_at: '', updated_at: '', updated_by: null },
];

describe('automations/actions.ts — read-path behavior with a mocked admin client', () => {
  it('getAllAutomations queries system_automations and returns the mocked rows', async () => {
    shouldThrowUnsafeEnv = false;
    currentAdminResponse = { data: FAKE_ROWS, error: null };
    captured.length = 0;
    const { getAllAutomations } = await import('../actions');
    const rows = await getAllAutomations();
    assert.equal(rows.length, 2);
    assert.equal(captured[0]?.table, 'system_automations');
  });

  it('getAutomationsSummary counts execution modes from the mocked rows', async () => {
    shouldThrowUnsafeEnv = false;
    currentAdminResponse = { data: FAKE_ROWS, error: null };
    const { getAutomationsSummary } = await import('../actions');
    const summary = await getAutomationsSummary();
    assert.equal(summary.total, 2);
    assert.equal(summary.automatic, 1);
    assert.equal(summary.manual, 1);
    assert.equal(summary.suggested, 0);
  });

  it('getAutomationConfig returns null when the mocked query resolves with no data', async () => {
    shouldThrowUnsafeEnv = false;
    currentAdminResponse = { data: null, error: null };
    const { getAutomationConfig } = await import('../actions');
    const config = await getAutomationConfig('unknown_trigger');
    assert.equal(config, null);
  });
});

describe('automations/actions.ts — fails closed when Supabase env is unsafe', () => {
  it('getAllAutomations rejects (never falls back to a hardcoded project) when createSupabaseAdminClient() throws', async () => {
    shouldThrowUnsafeEnv = true;
    const { getAllAutomations } = await import('../actions');
    await assert.rejects(() => getAllAutomations(), /UnsafeSupabaseEnvironmentError/);
    shouldThrowUnsafeEnv = false;
  });
});
