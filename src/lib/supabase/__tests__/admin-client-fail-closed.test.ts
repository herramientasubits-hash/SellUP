// H2 — Supabase admin env-guard anti-regression (factory unit test)
//
// Directly exercises createSupabaseAdminClient() from src/lib/supabase/admin.ts.
// Unlike env-guard.server.test.ts (which tests the pure resolver over an
// explicit env-like record), this drives the real process.env-backed factory
// end to end, proving it FAILS CLOSED — it throws UnsafeSupabaseEnvironmentError
// instead of ever falling back to the hardcoded production project.
//
// admin.ts's only imports are '@supabase/supabase-js' (createClient) and the
// pure './env-guard.server' module, so it is safe to import under `node --test`
// with tsx: no next/headers cookies() boundary, no network, no provider calls.
// createClient() is only reached on the safe path, and Supabase client
// construction is lazy (no network I/O at construction time).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdminClient } from '../admin';
import {
  UnsafeSupabaseEnvironmentError,
  PRODUCTION_SUPABASE_HOST,
  ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV,
} from '../env-guard.server';

const PRODUCTION_URL = `https://${PRODUCTION_SUPABASE_HOST}`;
// Obviously-fake non-production project — construction only, never contacted.
const STAGING_URL = 'https://staging-project-ref.supabase.co';

// Save/restore the exact keys we touch so tests never leak env into each other
// (mirrors withProcessEnv in env-guard.server.test.ts).
const TOUCHED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_ENV',
  ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV,
] as const;

function withProcessEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
) {
  const saved: Record<string, string | undefined> = {};
  for (const key of TOUCHED_KEYS) {
    saved[key] = process.env[key];
  }
  try {
    // Start from a clean slate for the keys the guard reads, then apply overrides.
    for (const key of TOUCHED_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of TOUCHED_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('createSupabaseAdminClient — fails closed on missing NEXT_PUBLIC_SUPABASE_URL', () => {
  test('URL unset → throws missing_supabase_url, never falls back to the production project', () => {
    withProcessEnv(
      { SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key' },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason === 'missing_supabase_url',
        );
      },
    );
  });

  test('URL blank → throws missing_supabase_url', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: '   ',
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason === 'missing_supabase_url',
        );
      },
    );
  });
});

describe('createSupabaseAdminClient — fails closed on missing SUPABASE_SERVICE_ROLE_KEY', () => {
  test('key unset → throws missing_service_role_key', () => {
    withProcessEnv(
      { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason === 'missing_service_role_key',
        );
      },
    );
  });

  test('key blank → throws missing_service_role_key', () => {
    withProcessEnv(
      { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: '  ' },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason === 'missing_service_role_key',
        );
      },
    );
  });
});

describe('createSupabaseAdminClient — fails closed when a non-production env targets production', () => {
  test('VERCEL_ENV=preview + production URL → throws non_production_environment_targets_production_supabase', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
        VERCEL_ENV: 'preview',
      },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason ===
              'non_production_environment_targets_production_supabase',
        );
      },
    );
  });

  test('VERCEL_ENV=preview + production URL + local override set → still throws (override never honored on Vercel)', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
        VERCEL_ENV: 'preview',
        [ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV]: 'true',
      },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason ===
              'non_production_environment_targets_production_supabase',
        );
      },
    );
  });

  test('no VERCEL_ENV + production URL, no override → throws (local shells cannot silently hit prod)', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      },
      () => {
        assert.throws(
          () => createSupabaseAdminClient(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason ===
              'non_production_environment_targets_production_supabase',
        );
      },
    );
  });
});

describe('createSupabaseAdminClient — safe path constructs a client (no network at construction time)', () => {
  test('non-production URL + service role key + no VERCEL_ENV → returns a usable client object', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
      },
      () => {
        const client = createSupabaseAdminClient();
        assert.ok(client, 'expected a client instance');
        assert.equal(typeof client.from, 'function');
      },
    );
  });
});
