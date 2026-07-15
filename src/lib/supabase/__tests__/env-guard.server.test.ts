// Tests for src/lib/supabase/env-guard.server.ts
// Uses Node.js built-in test runner. No DOM, no external services, no
// network calls — everything here is pure function evaluation over an
// explicit env-like record (see resolveSupabaseServiceRoleEnv's doc comment
// for why process.env is not mutated for the pure-resolver tests).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSupabaseServiceRoleEnv,
  getSupabaseServiceRoleEnv,
  isSafeEnvironmentForAutomaticRouting,
  assertAutomaticRoutingEnvironmentIsSafe,
  UnsafeSupabaseEnvironmentError,
  PRODUCTION_SUPABASE_HOST,
  ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV,
} from '../env-guard.server';

const PRODUCTION_URL = `https://${PRODUCTION_SUPABASE_HOST}`;
const STAGING_URL = 'https://staging-project-ref.supabase.co';

const PRODUCTION_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-value',
  VERCEL_ENV: 'production',
};

// ── A. Production env, fully configured ─────────────────────────────────────

describe('resolveSupabaseServiceRoleEnv — production env valid', () => {
  test('VERCEL_ENV=production + production URL + service role key → resolves, no throw', () => {
    const result = resolveSupabaseServiceRoleEnv(PRODUCTION_ENV);
    assert.equal(result.url, PRODUCTION_URL);
    assert.equal(result.serviceRoleKey, 'service-role-key-value');
  });
});

// ── B. Missing NEXT_PUBLIC_SUPABASE_URL ──────────────────────────────────────

describe('resolveSupabaseServiceRoleEnv — missing Supabase URL', () => {
  test('undefined URL → throws missing_supabase_url, never falls back to a hardcoded URL', () => {
    const env = { ...PRODUCTION_ENV, NEXT_PUBLIC_SUPABASE_URL: undefined };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError && err.reason === 'missing_supabase_url'
    );
  });

  test('blank URL → throws missing_supabase_url', () => {
    const env = { ...PRODUCTION_ENV, NEXT_PUBLIC_SUPABASE_URL: '   ' };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError && err.reason === 'missing_supabase_url'
    );
  });

  test('thrown error message never contains the production host as a suggested fallback value', () => {
    const env = { ...PRODUCTION_ENV, NEXT_PUBLIC_SUPABASE_URL: undefined };
    try {
      resolveSupabaseServiceRoleEnv(env);
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof UnsafeSupabaseEnvironmentError);
      assert.equal(err.message.includes(PRODUCTION_SUPABASE_HOST), false);
    }
  });
});

// ── C. Missing SUPABASE_SERVICE_ROLE_KEY ─────────────────────────────────────

describe('resolveSupabaseServiceRoleEnv — missing service role key', () => {
  test('undefined key → throws missing_service_role_key', () => {
    const env = { ...PRODUCTION_ENV, SUPABASE_SERVICE_ROLE_KEY: undefined };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError && err.reason === 'missing_service_role_key'
    );
  });

  test('blank key → throws missing_service_role_key', () => {
    const env = { ...PRODUCTION_ENV, SUPABASE_SERVICE_ROLE_KEY: '  ' };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError && err.reason === 'missing_service_role_key'
    );
  });
});

// ── D. Vercel Preview (or Vercel dev) resolving to production ────────────────

describe('resolveSupabaseServiceRoleEnv — non-production Vercel env targeting production', () => {
  test('VERCEL_ENV=preview + production URL, no override → throws', () => {
    const env = { ...PRODUCTION_ENV, VERCEL_ENV: 'preview' };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase'
    );
  });

  test('VERCEL_ENV=development (Vercel dev) + production URL, no override → throws', () => {
    const env = { ...PRODUCTION_ENV, VERCEL_ENV: 'development' };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase'
    );
  });

  test('VERCEL_ENV=preview + production URL + override requested → still throws (override never honored on Vercel)', () => {
    const env = { ...PRODUCTION_ENV, VERCEL_ENV: 'preview' };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env, { allowProductionOverride: true }),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase'
    );
  });

  test('VERCEL_ENV=preview + non-production (staging) URL → resolves fine', () => {
    const env = { ...PRODUCTION_ENV, VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: STAGING_URL };
    const result = resolveSupabaseServiceRoleEnv(env);
    assert.equal(result.url, STAGING_URL);
  });
});

// ── E. Local dev ──────────────────────────────────────────────────────────────

describe('resolveSupabaseServiceRoleEnv — local dev (no VERCEL_ENV)', () => {
  test('no VERCEL_ENV + non-production URL → resolves fine (typical local dev against a dev project)', () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    };
    const result = resolveSupabaseServiceRoleEnv(env);
    assert.equal(result.url, STAGING_URL);
  });

  test('no VERCEL_ENV + production URL, no override → throws (safe default: local shells cannot silently hit prod)', () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    };
    assert.throws(
      () => resolveSupabaseServiceRoleEnv(env),
      (err: unknown) =>
        err instanceof UnsafeSupabaseEnvironmentError &&
        err.reason === 'non_production_environment_targets_production_supabase'
    );
  });

  test('no VERCEL_ENV + production URL + explicit local override → resolves (documented, deliberate opt-in)', () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-role-key',
    };
    const result = resolveSupabaseServiceRoleEnv(env, { allowProductionOverride: true });
    assert.equal(result.url, PRODUCTION_URL);
  });
});

// ── getSupabaseServiceRoleEnv (process.env-backed wrapper) ───────────────────

function withProcessEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('getSupabaseServiceRoleEnv — process.env-backed wrapper', () => {
  test('reads ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD from real process.env to unlock local override', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'k',
        VERCEL_ENV: undefined,
        [ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV]: 'true',
      },
      () => {
        const result = getSupabaseServiceRoleEnv();
        assert.equal(result.url, PRODUCTION_URL);
      }
    );
  });

  test('override set but VERCEL_ENV=preview present → still throws', () => {
    withProcessEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'k',
        VERCEL_ENV: 'preview',
        [ALLOW_PRODUCTION_SUPABASE_OVERRIDE_ENV]: 'true',
      },
      () => {
        assert.throws(
          () => getSupabaseServiceRoleEnv(),
          (err: unknown) =>
            err instanceof UnsafeSupabaseEnvironmentError &&
            err.reason === 'non_production_environment_targets_production_supabase'
        );
      }
    );
  });
});

// ── F. Automatic routing flag true in an unsafe environment ─────────────────

describe('automatic routing environment safety', () => {
  const UNSAFE_ENV = { NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined };
  const SAFE_ENV = {
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    SUPABASE_SERVICE_ROLE_KEY: 'k',
  };

  test('isSafeEnvironmentForAutomaticRouting(unsafe env) → false', () => {
    assert.equal(isSafeEnvironmentForAutomaticRouting(UNSAFE_ENV), false);
  });

  test('isSafeEnvironmentForAutomaticRouting(safe env) → true', () => {
    assert.equal(isSafeEnvironmentForAutomaticRouting(SAFE_ENV), true);
  });

  test('assertAutomaticRoutingEnvironmentIsSafe(true, unsafe env) → throws', () => {
    assert.throws(() => assertAutomaticRoutingEnvironmentIsSafe(true, UNSAFE_ENV));
  });

  test('assertAutomaticRoutingEnvironmentIsSafe(true, safe env) → does not throw', () => {
    assert.doesNotThrow(() => assertAutomaticRoutingEnvironmentIsSafe(true, SAFE_ENV));
  });

  test('assertAutomaticRoutingEnvironmentIsSafe(false, unsafe env) → no-op, does not throw', () => {
    assert.doesNotThrow(() => assertAutomaticRoutingEnvironmentIsSafe(false, UNSAFE_ENV));
  });
});
