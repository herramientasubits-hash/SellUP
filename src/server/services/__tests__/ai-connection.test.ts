// H5.10B — AI connection admin-factory migration, behavioral offline test.
//
// This test NEVER calls a real AI provider (OpenAI, Anthropic/Claude, Gemini)
// and therefore never consumes provider quota, and it NEVER touches a real
// Supabase Vault, a real service-role key, or the database: the ONLY thing
// mocked is globalThis.fetch, and every request is routed by URL:
//   - {SUPABASE_URL}/rest/v1/rpc/upsert_vault_secret        → FAKE store result
//   - {SUPABASE_URL}/rest/v1/rpc/delete_vault_secret        → FAKE delete result
//   - {SUPABASE_URL}/rest/v1/rpc/has_vault_secret           → FAKE existence flag
//   - {SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted → FAKE Vault key
//   - {SUPABASE_URL}/rest/v1/ai_providers                   → FAKE PATCH result
//   - https://api.openai.com/...                            → FAKE OpenAI response
//   - https://api.anthropic.com/...                         → FAKE Anthropic response
//   - https://generativelanguage.googleapis.com/...         → FAKE Gemini response
// Any other URL throws, so a real network call would fail the test loudly.
//
// Because only fetch is mocked, the REAL createSupabaseAdminClient() factory and
// its env-guard (getSupabaseServiceRoleEnv) run unchanged — the migration's
// fail-closed behavior is exercised, not stubbed. The default env below is a
// safe, non-production Supabase target so the factory resolves; some cases
// deliberately clear the Supabase env to force the fail-closed throw and assert
// that the Vault/admin functions surface UnsafeSupabaseEnvironmentError instead
// of the legacy 'enrichment_configuration_unavailable' / silent prod fallback.
// The H2 static guard (migrated-fallback-guard.test.ts) independently asserts
// the source no longer carries a hardcoded production fallback.
//
// Deliberately fake keys are used throughout. Assertions confirm the store /
// remove / connection-test results never leak a key back to the caller.
//
// All cases live under a SINGLE describe so node:test runs them sequentially —
// the fetch mock and its counters are shared module state.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { UnsafeSupabaseEnvironmentError } from '../../../lib/supabase/env-guard.server';

// Fake, non-real credentials. Never a real provider key, never a Supabase key.
const FAKE_VAULT_KEY = 'ai-vault-test-key-abcd1234';
const FAKE_GEMINI_ENV_KEY = 'gemini-env-fake-key-zzzz9999';
const FAKE_GOOGLE_ENV_KEY = 'google-env-fake-key-wwww8888';
const FAKE_OPENAI_KEY = 'openai-fake-key-oooo0000';
const FAKE_ANTHROPIC_KEY = 'anthropic-fake-key-aaaa1111';

const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_UPSERT = '/rest/v1/rpc/upsert_vault_secret';
const RPC_DELETE = '/rest/v1/rpc/delete_vault_secret';
const RPC_HAS = '/rest/v1/rpc/has_vault_secret';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const REST_AI_PROVIDERS = '/rest/v1/ai_providers';
const OPENAI_ORIGIN = 'https://api.openai.com';
const ANTHROPIC_ORIGIN = 'https://api.anthropic.com';
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

type AiConnModule = typeof import('../ai-connection');
let storeAiProviderCredential: AiConnModule['storeAiProviderCredential'];
let removeAiProviderCredential: AiConnModule['removeAiProviderCredential'];
let hasAiProviderCredential: AiConnModule['hasAiProviderCredential'];
let hasVaultSecretByRawName: AiConnModule['hasVaultSecretByRawName'];
let getVaultSecretByRawName: AiConnModule['getVaultSecretByRawName'];
let getAiProviderCredential: AiConnModule['getAiProviderCredential'];
let testGeminiWithKey: AiConnModule['testGeminiWithKey'];
let testGeminiConnection: AiConnModule['testGeminiConnection'];
let testOpenAIConnection: AiConnModule['testOpenAIConnection'];
let listAnthropicModels: AiConnModule['listAnthropicModels'];
let testAnthropicModelExecution: AiConnModule['testAnthropicModelExecution'];
let testClaudeConnection: AiConnModule['testClaudeConnection'];

let origFetch: typeof globalThis.fetch | null = null;

// Counters to prove separation of concerns:
//  - adminCalls: any Supabase admin/RPC/ai_providers request (fail closed on 0-expectations)
//  - provider counters: each real provider origin
let adminCalls = 0;
let openaiCalls = 0;
let anthropicCalls = 0;
let geminiCalls = 0;

let prevUrl: string | undefined;
let prevKey: string | undefined;
let prevGeminiEnv: string | undefined;
let prevGoogleEnv: string | undefined;

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

interface Captured {
  url: string;
  body: unknown;
  init: RequestInit | undefined;
}

interface FetchRoutes {
  // Vault RPCs. PostgREST returns a scalar function result as the JSON body;
  // null simulates "no secret", a status>=400 simulates an RPC error.
  vault?: (c: Captured) => Response;
  hasSecret?: (c: Captured) => Response;
  upsert?: (c: Captured) => Response;
  delete?: (c: Captured) => Response;
  aiProviders?: (c: Captured) => Response;
  // Provider responders. Absence means that provider endpoint must never be hit.
  openai?: (c: Captured) => Response;
  anthropic?: (c: Captured) => Response;
  gemini?: (c: Captured) => Response;
}

function parseBody(init: RequestInit | undefined): unknown {
  if (!init || typeof init.body !== 'string') return undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

function installFetch(routes: FetchRoutes): void {
  if (!origFetch) origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const captured: Captured = { url: u, body: parseBody(init), init };

    if (u.includes(RPC_UPSERT)) {
      adminCalls += 1;
      return (routes.upsert ?? (() => jsonResponse('fake-vault-secret-id')))(captured);
    }
    if (u.includes(RPC_DELETE)) {
      adminCalls += 1;
      return (routes.delete ?? (() => jsonResponse(null)))(captured);
    }
    if (u.includes(RPC_HAS)) {
      adminCalls += 1;
      return (routes.hasSecret ?? (() => jsonResponse(false)))(captured);
    }
    if (u.includes(RPC_DECRYPTED)) {
      adminCalls += 1;
      return (routes.vault ?? (() => jsonResponse(null)))(captured);
    }
    if (u.includes(REST_AI_PROVIDERS)) {
      adminCalls += 1;
      // Default: PostgREST minimal PATCH response (empty representation).
      return (routes.aiProviders ?? (() => jsonResponse([])))(captured);
    }
    if (u.startsWith(OPENAI_ORIGIN)) {
      openaiCalls += 1;
      if (!routes.openai) throw new Error(`OpenAI endpoint hit unexpectedly: ${u}`);
      return routes.openai(captured);
    }
    if (u.startsWith(ANTHROPIC_ORIGIN)) {
      anthropicCalls += 1;
      if (!routes.anthropic) throw new Error(`Anthropic endpoint hit unexpectedly: ${u}`);
      return routes.anthropic(captured);
    }
    if (u.startsWith(GEMINI_ORIGIN)) {
      geminiCalls += 1;
      if (!routes.gemini) throw new Error(`Gemini endpoint hit unexpectedly: ${u}`);
      return routes.gemini(captured);
    }
    throw new Error(`Unexpected fetch to a non-mocked URL: ${u}`);
  }) as typeof globalThis.fetch;
}

const vaultReturnsNull = () => jsonResponse(null);

before(async () => {
  // Safe, non-production Supabase env so the fail-closed factory resolves and
  // builds a client. Host is deliberately NOT the production project, and no
  // VERCEL_ENV is set, so resolveSupabaseServiceRoleEnv() succeeds.
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  prevGeminiEnv = process.env.GEMINI_API_KEY;
  prevGoogleEnv = process.env.GOOGLE_API_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-not-real';
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  const mod = await import('../ai-connection');
  storeAiProviderCredential = mod.storeAiProviderCredential;
  removeAiProviderCredential = mod.removeAiProviderCredential;
  hasAiProviderCredential = mod.hasAiProviderCredential;
  hasVaultSecretByRawName = mod.hasVaultSecretByRawName;
  getVaultSecretByRawName = mod.getVaultSecretByRawName;
  getAiProviderCredential = mod.getAiProviderCredential;
  testGeminiWithKey = mod.testGeminiWithKey;
  testGeminiConnection = mod.testGeminiConnection;
  testOpenAIConnection = mod.testOpenAIConnection;
  listAnthropicModels = mod.listAnthropicModels;
  testAnthropicModelExecution = mod.testAnthropicModelExecution;
  testClaudeConnection = mod.testClaudeConnection;
});

after(() => {
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  if (prevGeminiEnv === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevGeminiEnv;
  if (prevGoogleEnv === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = prevGoogleEnv;
});

afterEach(() => {
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
  adminCalls = 0;
  openaiCalls = 0;
  anthropicCalls = 0;
  geminiCalls = 0;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

describe('ai-connection (offline — fake Vault via fetch, mocked fetch, no real providers, no DB writes)', () => {
  // ── hasAiProviderCredential ────────────────────────────────────────────────

  it('hasAiProviderCredential returns true when the RPC reports the secret exists', async () => {
    let captured: Captured | undefined;
    installFetch({ hasSecret: (c) => { captured = c; return jsonResponse(true); } });
    assert.equal(await hasAiProviderCredential('openai'), true);
    // Canonical secret name convention: sellup_ai_{providerKey}
    assert.equal((captured!.body as Record<string, unknown>).p_name, 'sellup_ai_openai');
  });

  it('hasAiProviderCredential returns false when the RPC reports absence', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasAiProviderCredential('openai'), false);
  });

  it('hasAiProviderCredential returns false when the has_vault_secret RPC errors', async () => {
    installFetch({ hasSecret: () => jsonResponse({ message: 'boom' }, 400) });
    assert.equal(await hasAiProviderCredential('openai'), false);
  });

  // ── getAiProviderCredential ────────────────────────────────────────────────

  it('getAiProviderCredential returns the decrypted key from Vault', async () => {
    let captured: Captured | undefined;
    installFetch({ vault: (c) => { captured = c; return jsonResponse(FAKE_VAULT_KEY); } });
    const res = await getAiProviderCredential('anthropic');
    assert.equal(res.success, true);
    assert.equal(res.apiKey, FAKE_VAULT_KEY);
    assert.equal((captured!.body as Record<string, unknown>).p_name, 'sellup_ai_anthropic');
  });

  it('getAiProviderCredential returns CREDENTIAL_NOT_FOUND when Vault has no key', async () => {
    installFetch({ vault: vaultReturnsNull });
    const res = await getAiProviderCredential('anthropic');
    assert.equal(res.success, false);
    assert.equal(res.error, 'CREDENTIAL_NOT_FOUND');
    assert.equal(res.apiKey, undefined);
  });

  it('getAiProviderCredential returns VAULT_READ_ERROR when the RPC errors (no key leak)', async () => {
    installFetch({ vault: () => jsonResponse({ message: 'boom' }, 500) });
    const res = await getAiProviderCredential('anthropic');
    assert.equal(res.success, false);
    assert.equal(res.error, 'VAULT_READ_ERROR');
    assert.equal(res.apiKey, undefined);
    assert.equal(JSON.stringify(res).includes(FAKE_VAULT_KEY), false);
  });

  // ── hasVaultSecretByRawName ────────────────────────────────────────────────

  it('hasVaultSecretByRawName passes the raw name through unchanged and returns true', async () => {
    let captured: Captured | undefined;
    installFetch({ hasSecret: (c) => { captured = c; return jsonResponse(true); } });
    assert.equal(await hasVaultSecretByRawName('legacy_openai_key'), true);
    // Raw name must NOT be wrapped with the sellup_ai_ prefix.
    assert.equal((captured!.body as Record<string, unknown>).p_name, 'legacy_openai_key');
  });

  it('hasVaultSecretByRawName returns false when absent', async () => {
    installFetch({ hasSecret: () => jsonResponse(false) });
    assert.equal(await hasVaultSecretByRawName('legacy_openai_key'), false);
  });

  // ── getVaultSecretByRawName ────────────────────────────────────────────────

  it('getVaultSecretByRawName returns the decrypted key for the raw name', async () => {
    let captured: Captured | undefined;
    installFetch({ vault: (c) => { captured = c; return jsonResponse(FAKE_VAULT_KEY); } });
    const res = await getVaultSecretByRawName('legacy_openai_key');
    assert.equal(res.success, true);
    assert.equal(res.apiKey, FAKE_VAULT_KEY);
    assert.equal((captured!.body as Record<string, unknown>).p_name, 'legacy_openai_key');
  });

  it('getVaultSecretByRawName returns CREDENTIAL_NOT_FOUND when absent', async () => {
    installFetch({ vault: vaultReturnsNull });
    const res = await getVaultSecretByRawName('legacy_openai_key');
    assert.equal(res.success, false);
    assert.equal(res.error, 'CREDENTIAL_NOT_FOUND');
  });

  it('getVaultSecretByRawName returns VAULT_READ_ERROR on RPC error', async () => {
    installFetch({ vault: () => jsonResponse({ message: 'boom' }, 500) });
    const res = await getVaultSecretByRawName('legacy_openai_key');
    assert.equal(res.success, false);
    assert.equal(res.error, 'VAULT_READ_ERROR');
  });

  // ── storeAiProviderCredential ──────────────────────────────────────────────

  it('storeAiProviderCredential upserts the Vault secret, PATCHes ai_providers, and returns the id (no key leak)', async () => {
    let upsertCaptured: Captured | undefined;
    let providersCaptured: Captured | undefined;
    installFetch({
      upsert: (c) => { upsertCaptured = c; return jsonResponse('vault-secret-id-123'); },
      aiProviders: (c) => { providersCaptured = c; return jsonResponse([]); },
    });

    const result = await storeAiProviderCredential('openai', FAKE_VAULT_KEY);

    assert.equal(result.success, true);
    assert.equal(result.vaultSecretId, 'vault-secret-id-123');
    // Fake key travels ONLY in the upsert RPC payload — never back to the caller.
    const upsertBody = upsertCaptured!.body as Record<string, unknown>;
    assert.equal(upsertBody.p_name, 'sellup_ai_openai');
    assert.equal(upsertBody.p_secret, FAKE_VAULT_KEY);
    assert.equal(JSON.stringify(result).includes(FAKE_VAULT_KEY), false);
    // ai_providers PATCH stored only the vault_secret_id UUID, never the secret.
    assert.ok(providersCaptured);
    assert.ok(providersCaptured!.url.includes(REST_AI_PROVIDERS));
    assert.equal(providersCaptured!.init?.method, 'PATCH');
    const providersBody = providersCaptured!.body as Record<string, unknown>;
    assert.equal(providersBody.vault_secret_id, 'vault-secret-id-123');
    assert.equal(providersBody.credentials_status, 'configured');
    assert.equal(JSON.stringify(providersBody).includes(FAKE_VAULT_KEY), false);
  });

  it('storeAiProviderCredential returns VAULT_STORAGE_ERROR when the upsert RPC errors', async () => {
    installFetch({ upsert: () => jsonResponse({ message: 'nope' }, 400) });
    const result = await storeAiProviderCredential('openai', FAKE_VAULT_KEY);
    assert.equal(result.success, false);
    assert.equal(result.error, 'VAULT_STORAGE_ERROR');
    assert.equal(JSON.stringify(result).includes(FAKE_VAULT_KEY), false);
  });

  // ── removeAiProviderCredential ─────────────────────────────────────────────

  it('removeAiProviderCredential deletes the Vault secret, clears ai_providers, and succeeds', async () => {
    let deleteCaptured: Captured | undefined;
    let providersCaptured: Captured | undefined;
    installFetch({
      delete: (c) => { deleteCaptured = c; return jsonResponse(null); },
      aiProviders: (c) => { providersCaptured = c; return jsonResponse([]); },
    });

    const result = await removeAiProviderCredential('openai');

    assert.equal(result.success, true);
    const deleteBody = deleteCaptured!.body as Record<string, unknown>;
    assert.equal(deleteBody.p_name, 'sellup_ai_openai');
    assert.ok(providersCaptured);
    assert.equal(providersCaptured!.init?.method, 'PATCH');
    const providersBody = providersCaptured!.body as Record<string, unknown>;
    assert.equal(providersBody.vault_secret_id, null);
    assert.equal(providersBody.credentials_status, 'missing');
  });

  // ── testGeminiConnection (env fallback GEMINI_API_KEY || GOOGLE_API_KEY) ─────

  it('testGeminiConnection uses GEMINI_API_KEY and never touches admin/RPC', async () => {
    process.env.GEMINI_API_KEY = FAKE_GEMINI_ENV_KEY;
    let sentHeader: string | undefined;
    installFetch({
      gemini: (c) => {
        const headers = c.init?.headers as Record<string, string>;
        sentHeader = headers['x-goog-api-key'];
        return jsonResponse({ models: [{ name: 'm1' }, { name: 'm2' }] });
      },
    });
    const result = await testGeminiConnection();
    assert.equal(result.success, true);
    assert.equal(sentHeader, FAKE_GEMINI_ENV_KEY);
    assert.equal(geminiCalls, 1);
    assert.equal(adminCalls, 0); // never touches Supabase admin/Vault
    assert.equal(JSON.stringify(result).includes(FAKE_GEMINI_ENV_KEY), false);
  });

  it('testGeminiConnection falls back to GOOGLE_API_KEY when GEMINI_API_KEY is unset', async () => {
    process.env.GOOGLE_API_KEY = FAKE_GOOGLE_ENV_KEY;
    let sentHeader: string | undefined;
    installFetch({
      gemini: (c) => {
        const headers = c.init?.headers as Record<string, string>;
        sentHeader = headers['x-goog-api-key'];
        return jsonResponse({ models: [] });
      },
    });
    const result = await testGeminiConnection();
    assert.equal(result.success, true);
    assert.equal(sentHeader, FAKE_GOOGLE_ENV_KEY);
    assert.equal(adminCalls, 0);
  });

  it('testGeminiConnection returns MISSING_API_KEY and never calls Gemini when no env key is set', async () => {
    installFetch({}); // any network call would throw
    const result = await testGeminiConnection();
    assert.equal(result.success, false);
    assert.equal(result.error, 'MISSING_API_KEY');
    assert.equal(geminiCalls, 0);
    assert.equal(adminCalls, 0);
  });

  it('testGeminiWithKey returns INVALID_API_KEY on 401 (no key leak)', async () => {
    installFetch({ gemini: () => jsonResponse({}, 401) });
    const result = await testGeminiWithKey(FAKE_GEMINI_ENV_KEY);
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
    assert.equal(JSON.stringify(result).includes(FAKE_GEMINI_ENV_KEY), false);
  });

  // ── Provider-test functions never touch admin/RPC ──────────────────────────

  it('testOpenAIConnection succeeds on 200 and never touches admin/RPC (no key leak)', async () => {
    let sentAuth: string | undefined;
    installFetch({
      openai: (c) => {
        const headers = c.init?.headers as Record<string, string>;
        sentAuth = headers['Authorization'];
        return jsonResponse({ data: [{ id: 'gpt-x' }] });
      },
    });
    const result = await testOpenAIConnection(FAKE_OPENAI_KEY);
    assert.equal(result.success, true);
    assert.equal(openaiCalls, 1);
    assert.equal(adminCalls, 0);
    assert.equal(sentAuth, `Bearer ${FAKE_OPENAI_KEY}`);
    assert.equal(JSON.stringify(result).includes(FAKE_OPENAI_KEY), false);
  });

  it('testOpenAIConnection returns INVALID_API_KEY on 401', async () => {
    installFetch({ openai: () => jsonResponse({}, 401) });
    const result = await testOpenAIConnection(FAKE_OPENAI_KEY);
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
  });

  it('listAnthropicModels returns models on 200 and never touches admin/RPC', async () => {
    installFetch({
      anthropic: () => jsonResponse({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }),
    });
    const result = await listAnthropicModels(FAKE_ANTHROPIC_KEY);
    assert.equal(result.ok, true);
    assert.equal(result.models?.[0].id, 'claude-x');
    assert.equal(anthropicCalls, 1);
    assert.equal(adminCalls, 0);
  });

  it('testAnthropicModelExecution returns ok on 200 and never touches admin/RPC', async () => {
    installFetch({ anthropic: () => jsonResponse({ id: 'msg_1' }, 200, { 'request-id': 'req_1' }) });
    const result = await testAnthropicModelExecution({ apiKey: FAKE_ANTHROPIC_KEY, modelId: 'claude-x' });
    assert.equal(result.ok, true);
    assert.equal(result.model_id, 'claude-x');
    assert.equal(anthropicCalls, 1);
    assert.equal(adminCalls, 0);
  });

  it('testClaudeConnection validates key then a model, staying off admin/RPC (no key leak)', async () => {
    let sentKey: string | undefined;
    installFetch({
      anthropic: (c) => {
        const headers = c.init?.headers as Record<string, string>;
        sentKey = headers['x-api-key'];
        // GET /v1/models list, then POST /v1/messages execution — both 200.
        if (c.init?.method === 'POST') return jsonResponse({ id: 'msg_1' });
        return jsonResponse({ data: [{ id: 'claude-x', display_name: 'Claude X' }] });
      },
    });
    const result = await testClaudeConnection(FAKE_ANTHROPIC_KEY, 'claude-x');
    assert.equal(result.success, true);
    assert.equal(adminCalls, 0);
    assert.equal(sentKey, FAKE_ANTHROPIC_KEY);
    assert.equal(JSON.stringify(result).includes(FAKE_ANTHROPIC_KEY), false);
  });

  it('testClaudeConnection surfaces INVALID_API_KEY on a 401 list response', async () => {
    installFetch({ anthropic: () => jsonResponse({}, 401) });
    const result = await testClaudeConnection(FAKE_ANTHROPIC_KEY);
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_API_KEY');
  });

  // ── Fail-closed: unsafe env throws UnsafeSupabaseEnvironmentError ───────────

  it('Vault/admin functions fail closed (throw UnsafeSupabaseEnvironmentError) when the Supabase URL is missing', async () => {
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    installFetch({}); // any network call would throw — none should be reached
    try {
      await assert.rejects(() => hasAiProviderCredential('openai'), UnsafeSupabaseEnvironmentError);
      await assert.rejects(() => getAiProviderCredential('openai'), UnsafeSupabaseEnvironmentError);
      await assert.rejects(() => hasVaultSecretByRawName('x'), UnsafeSupabaseEnvironmentError);
      await assert.rejects(() => getVaultSecretByRawName('x'), UnsafeSupabaseEnvironmentError);
      await assert.rejects(() => storeAiProviderCredential('openai', FAKE_VAULT_KEY), UnsafeSupabaseEnvironmentError);
      await assert.rejects(() => removeAiProviderCredential('openai'), UnsafeSupabaseEnvironmentError);
      assert.equal(adminCalls, 0); // no network reached — failed before any RPC
    } finally {
      if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    }
  });

  it('Vault/admin functions fail closed when the service-role key is missing', async () => {
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    installFetch({});
    try {
      await assert.rejects(() => getAiProviderCredential('openai'), UnsafeSupabaseEnvironmentError);
      assert.equal(adminCalls, 0);
    } finally {
      if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    }
  });
});
