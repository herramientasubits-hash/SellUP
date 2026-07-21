// H5.9B — Lusha credential diagnostics admin-factory migration, behavioral
// offline test. Replaces the orphaned 17B.4P test that was coupled to the
// removed hardcoded production fallback and could hit a real Supabase RPC.
//
// This test NEVER calls the real Lusha API (api.lusha.com) — it never touches a
// real Lusha account or consumes credits — and it NEVER touches a real Supabase
// Vault, a real service-role key, or the database. The ONLY thing mocked is
// globalThis.fetch, and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted → FAKE Vault key
//   - https://api.lusha.com/*                                → hard failure
// Any other URL throws, so a real network call would fail the test loudly. The
// Lusha origin is asserted to be never called across every case.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory and
// its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The default env below is a
// safe, non-production Supabase target so the factory resolves; individual cases
// deliberately mutate the Supabase env to force each fail-closed reason
// (missing_supabase_url, missing_service_role_key,
// non_production_environment_targets_production_supabase) and assert the
// diagnostic maps it to the preserved stage/exceptionName contract.
//
// Deliberately fake credentials are used. Assertions confirm no key value ever
// appears in the returned result (only fingerprints/lengths are permitted).
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseLushaCredentialResolution,
  diagnoseLushaExecutionPreflight,
  lushaCredentialDiagnosticMessage,
  type LushaCredentialStage,
} from '../lusha-credential-diagnostics';
import { PRODUCTION_SUPABASE_HOST } from '@/lib/supabase/env-guard.server';

// Fake, non-real credentials. Never a real Lusha key, never a real Supabase key.
const FAKE_VAULT_KEY = 'lusha-diag-vault-key-abcd1234';
const FAKE_ENV_KEY = 'lusha-diag-env-fallback-key-zzzz9999';
const FAKE_SERVICE_ROLE = 'fake-service-role-key-not-real';
const FAKE_JWT_SERVICE_ROLE =
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake-diag';

const SAFE_SUPABASE_URL = 'https://fake-local-project.supabase.co';
const PROD_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_HOST}`;
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const LUSHA_ORIGIN = 'https://api.lusha.com';

const LUSHA_FLAG = 'ENABLE_LUSHA_CONTACT_ENRICHMENT';
const OVERRIDE_ENV = 'ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD';

// Env keys this suite mutates — snapshotted once and fully restored after.
const MANAGED_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LUSHA_API_KEY',
  'VERCEL_ENV',
  LUSHA_FLAG,
  OVERRIDE_ENV,
] as const;

const envSnapshot: Record<string, string | undefined> = {};
let origFetch: typeof globalThis.fetch | null = null;
let lushaCalls = 0;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchRoutes {
  // PostgREST returns a scalar function result as the JSON body. null simulates
  // "no secret stored"; a status>=400 body simulates a Vault RPC error.
  vault?: () => Response;
}

function installFetch(routes: FetchRoutes): void {
  if (!origFetch) origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes(RPC_DECRYPTED)) {
      return (routes.vault ?? (() => jsonResponse(null)))();
    }
    if (u.startsWith(LUSHA_ORIGIN)) {
      lushaCalls += 1;
      throw new Error(`Lusha endpoint must never be hit by diagnostics: ${u}`);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

const vaultReturnsKey = () => jsonResponse(FAKE_VAULT_KEY);
const vaultReturnsNull = () => jsonResponse(null);
const vaultReturnsEmpty = () => jsonResponse('   ');
const vaultRpcError = () =>
  jsonResponse(
    { code: 'PGRST202', message: 'rpc get_vault_secret_decrypted failed', details: null, hint: null },
    400,
  );

before(() => {
  for (const key of MANAGED_ENV_KEYS) envSnapshot[key] = process.env[key];
});

after(() => {
  for (const key of MANAGED_ENV_KEYS) {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key];
  }
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
});

beforeEach(() => {
  // Safe, fully-configured, non-production baseline: factory resolves, no
  // VERCEL_ENV, no production override. Individual cases mutate from here.
  process.env.NEXT_PUBLIC_SUPABASE_URL = SAFE_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE;
  delete process.env.LUSHA_API_KEY;
  delete process.env.VERCEL_ENV;
  delete process.env[LUSHA_FLAG];
  delete process.env[OVERRIDE_ENV];
});

afterEach(() => {
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
  lushaCalls = 0;
});

describe('lusha-credential-diagnostics (offline — real factory + env-guard, mocked fetch, no real Lusha/Supabase/Vault)', () => {
  // ── 1. Env válido + Vault secret existente ─────────────────────────────────
  it('resolves from Vault: adminClientCreated + vaultRpcOk + secret found, no secret leaked', async () => {
    installFetch({ vault: vaultReturnsKey });

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'resolved_from_vault');
    assert.equal(result.checks.adminClientCreated, true);
    assert.equal(result.checks.vaultRpcCalled, true);
    assert.equal(result.checks.vaultRpcOk, true);
    assert.equal(result.checks.vaultSecretFound, true);
    assert.equal(result.checks.vaultSecretNonEmpty, true);
    assert.equal(result.safeDetails.vaultSecretLength, FAKE_VAULT_KEY.length);
    assert.match(result.safeDetails.vaultSecretFingerprint ?? '', /^[0-9a-f]{8}$/);
    assert.ok(result.recommendation.length > 0);
    assert.ok(
      !JSON.stringify(result).includes(FAKE_VAULT_KEY),
      'the raw Vault key must never appear in the result',
    );
    assert.equal(lushaCalls, 0);
  });

  // ── 2. Env válido + Vault vacío/null ───────────────────────────────────────
  it('Vault returns null → stage secret_missing (vaultRpcOk true, found false)', async () => {
    installFetch({ vault: vaultReturnsNull });

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'secret_missing');
    assert.equal(result.checks.vaultRpcOk, true);
    assert.equal(result.checks.vaultSecretFound, false);
    assert.ok(result.recommendation.length > 0);
    assert.equal(lushaCalls, 0);
  });

  it('Vault returns an empty/whitespace string → stage secret_empty', async () => {
    installFetch({ vault: vaultReturnsEmpty });

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'secret_empty');
    assert.equal(result.checks.vaultRpcOk, true);
    assert.equal(result.checks.vaultSecretFound, true);
    assert.equal(result.checks.vaultSecretNonEmpty, false);
    assert.ok(result.recommendation.length > 0);
  });

  // ── 3. Env válido + Vault RPC error ────────────────────────────────────────
  it('Vault RPC error, no env fallback → stage vault_rpc with sanitized rpc error', async () => {
    installFetch({ vault: vaultRpcError });

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'vault_rpc');
    assert.equal(result.checks.vaultRpcCalled, true);
    assert.equal(result.checks.vaultRpcOk, false);
    assert.equal(result.safeDetails.rpcErrorCode, 'PGRST202');
    assert.ok((result.safeDetails.rpcErrorMessage ?? '').length > 0);
    assert.ok((result.safeDetails.rpcErrorMessage ?? '').length <= 200);
    assert.ok(result.recommendation.length > 0);
    assert.equal(lushaCalls, 0);
  });

  it('Vault RPC error but LUSHA_API_KEY present → resolved_from_env_fallback', async () => {
    process.env.LUSHA_API_KEY = FAKE_ENV_KEY;
    installFetch({ vault: vaultRpcError });

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'resolved_from_env_fallback');
    assert.equal(result.checks.vaultRpcOk, false);
    assert.equal(result.checks.envFallbackNonEmpty, true);
    assert.ok(
      !JSON.stringify(result).includes(FAKE_ENV_KEY),
      'the env fallback key must never appear in the result',
    );
  });

  // ── 4. Missing NEXT_PUBLIC_SUPABASE_URL ────────────────────────────────────
  it('missing NEXT_PUBLIC_SUPABASE_URL, no fallback → admin_client stage, fail-closed', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    // No fetch route needed — the factory throws before any RPC. A mock with no
    // vault route would throw loudly if a network call were attempted.
    installFetch({});

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'admin_client');
    assert.equal(result.checks.hasSupabaseUrl, false);
    assert.equal(result.safeDetails.supabaseUrlHost, null);
    assert.equal(result.checks.adminClientCreated, false);
    assert.equal(result.safeDetails.exceptionName, 'UnsafeSupabaseEnvironmentError');
    assert.ok(result.recommendation.length > 0);
    assert.equal(lushaCalls, 0);
  });

  it('missing NEXT_PUBLIC_SUPABASE_URL but LUSHA_API_KEY present → env fallback preserved', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.LUSHA_API_KEY = FAKE_ENV_KEY;
    installFetch({});

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'resolved_from_env_fallback');
    assert.equal(result.checks.adminClientCreated, false);
    assert.equal(result.checks.envFallbackNonEmpty, true);
    assert.equal(result.safeDetails.exceptionName, 'UnsafeSupabaseEnvironmentError');
    assert.ok(!JSON.stringify(result).includes(FAKE_ENV_KEY));
  });

  // ── 5. Missing SUPABASE_SERVICE_ROLE_KEY ───────────────────────────────────
  it('missing SUPABASE_SERVICE_ROLE_KEY, no fallback → stage env_check (raw inspection short-circuit)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    installFetch({});

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'env_check');
    assert.equal(result.checks.hasServiceRoleKey, false);
    assert.equal(result.safeDetails.serviceRoleKeyLength, null);
    assert.equal(result.checks.adminClientCreated, false);
    assert.ok(result.recommendation.length > 0);
    assert.equal(lushaCalls, 0);
  });

  it('missing SUPABASE_SERVICE_ROLE_KEY but LUSHA_API_KEY present → resolved_from_env_fallback', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.LUSHA_API_KEY = FAKE_ENV_KEY;
    installFetch({});

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'resolved_from_env_fallback');
    assert.equal(result.checks.envFallbackNonEmpty, true);
    assert.ok(!JSON.stringify(result).includes(FAKE_ENV_KEY));
  });

  // ── 6. Non-prod env targeting production Supabase ──────────────────────────
  it('non-prod env resolving to production Supabase → UnsafeSupabaseEnvironmentError, admin_client stage', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_SUPABASE_URL;
    // No VERCEL_ENV (local shell), no override → env-guard must refuse.
    installFetch({});

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'admin_client');
    assert.equal(result.checks.adminClientCreated, false);
    assert.equal(result.safeDetails.exceptionName, 'UnsafeSupabaseEnvironmentError');
    assert.match(result.recommendation, /fail-closed|producci/i);
    assert.equal(lushaCalls, 0);
  });

  // ── 7. diagnoseLushaExecutionPreflight — provider never called ─────────────
  it('preflight: flag off → blockedBy feature_flag, provider not attempted', async () => {
    delete process.env[LUSHA_FLAG];
    installFetch({ vault: vaultReturnsKey });

    const result = await diagnoseLushaExecutionPreflight();

    assert.equal(result.ok, false);
    assert.equal(result.blockedBy, 'feature_flag');
    assert.equal(result.wouldExecuteProvider, false);
    assert.equal(result.stages.providerCall.attempted, false);
    assert.equal(lushaCalls, 0);
  });

  it('preflight: flag on + Vault credential → ok, would execute, provider not attempted', async () => {
    process.env[LUSHA_FLAG] = 'true';
    installFetch({ vault: vaultReturnsKey });

    const result = await diagnoseLushaExecutionPreflight();

    assert.equal(result.ok, true);
    assert.equal(result.blockedBy, null);
    assert.equal(result.wouldExecuteProvider, true);
    assert.equal(result.stages.credential.ok, true);
    assert.equal(result.stages.credential.source, 'vault');
    assert.equal(result.stages.providerCall.attempted, false);
    assert.equal(lushaCalls, 0);
    assert.ok(!JSON.stringify(result).includes(FAKE_VAULT_KEY));
  });

  it('preflight: flag on + no credential → blockedBy credential, provider not attempted', async () => {
    process.env[LUSHA_FLAG] = 'true';
    installFetch({ vault: vaultReturnsNull });

    const result = await diagnoseLushaExecutionPreflight();

    assert.equal(result.ok, false);
    assert.equal(result.blockedBy, 'credential');
    assert.equal(result.wouldExecuteProvider, false);
    assert.equal(result.stages.providerCall.attempted, false);
    assert.equal(lushaCalls, 0);
  });

  // ── 8. Sanitization ────────────────────────────────────────────────────────
  it('never leaks the service-role key even when it is a JWT-shaped value', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_JWT_SERVICE_ROLE;
    installFetch({ vault: vaultReturnsKey });

    const result = await diagnoseLushaCredentialResolution();

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(FAKE_JWT_SERVICE_ROLE), 'service-role key must not leak');
    assert.ok(!serialized.includes(FAKE_VAULT_KEY), 'vault key must not leak');
    assert.equal(result.safeDetails.serviceRoleKeyLength, FAKE_JWT_SERVICE_ROLE.length);
    assert.equal(result.safeDetails.serviceRoleKeyLooksJwt, true);
  });

  it('sanitized exceptionMessage never carries a long token-like value', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    installFetch({});

    const result = await diagnoseLushaCredentialResolution();

    const msg = result.safeDetails.exceptionMessage ?? '';
    assert.doesNotMatch(msg, /[A-Za-z0-9_\-.]{21,}/, 'no long token-like substrings allowed');
    assert.ok(msg.length <= 200);
  });

  // ── 9. Recommendation non-empty across every probed stage ──────────────────
  it('recommendation is a non-empty string for every stage exercised', async () => {
    const probes: Array<{ setup: () => void; routes: FetchRoutes }> = [
      { setup: () => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; }, routes: {} },
      { setup: () => { delete process.env.NEXT_PUBLIC_SUPABASE_URL; }, routes: {} },
      { setup: () => { process.env.NEXT_PUBLIC_SUPABASE_URL = PROD_SUPABASE_URL; }, routes: {} },
      { setup: () => {}, routes: { vault: vaultReturnsNull } },
      { setup: () => {}, routes: { vault: vaultReturnsEmpty } },
      { setup: () => {}, routes: { vault: vaultRpcError } },
      { setup: () => {}, routes: { vault: vaultReturnsKey } },
    ];

    const seenStages = new Set<LushaCredentialStage>();
    for (const probe of probes) {
      // Reset to baseline, then apply this probe's mutation.
      process.env.NEXT_PUBLIC_SUPABASE_URL = SAFE_SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_ROLE;
      delete process.env.LUSHA_API_KEY;
      probe.setup();
      installFetch(probe.routes);

      const result = await diagnoseLushaCredentialResolution();
      seenStages.add(result.stage);
      assert.ok(
        typeof result.recommendation === 'string' && result.recommendation.length > 0,
        `recommendation empty for stage ${result.stage}`,
      );

      if (origFetch) {
        globalThis.fetch = origFetch;
        origFetch = null;
      }
    }

    // The probes should have covered the distinct failure/success stages.
    for (const expected of ['env_check', 'admin_client', 'secret_missing', 'secret_empty', 'vault_rpc', 'resolved_from_vault'] as const) {
      assert.ok(seenStages.has(expected), `expected to exercise stage ${expected}`);
    }
    assert.equal(lushaCalls, 0);
  });

  it('lushaCredentialDiagnosticMessage returns a non-empty message for every stage', () => {
    const stages: LushaCredentialStage[] = [
      'env_check',
      'admin_client',
      'vault_rpc',
      'secret_missing',
      'secret_empty',
      'resolved_from_vault',
      'resolved_from_env_fallback',
      'failed',
    ];
    for (const stage of stages) {
      const msg = lushaCredentialDiagnosticMessage({
        ok: false,
        stage,
        checks: {
          hasSupabaseUrl: false,
          hasServiceRoleKey: false,
          hasLushaEnvFallback: false,
          adminClientCreated: false,
          vaultRpcCalled: false,
          vaultRpcOk: false,
          vaultSecretFound: false,
          vaultSecretNonEmpty: false,
          envFallbackNonEmpty: false,
        },
        safeDetails: {},
        recommendation: 'test',
      });
      assert.ok(typeof msg === 'string' && msg.length > 0, `empty message for stage ${stage}`);
    }
  });
});
