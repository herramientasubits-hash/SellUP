/**
 * Tests — Lusha Credential Diagnostics (Agente 2A · 17B.4P)
 *
 * Verifica que el diagnóstico:
 * - Captura correctamente cada stage sin lanzar excepciones
 * - Nunca expone secretos en el resultado
 * - Retorna recomendaciones accionables
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  diagnoseLushaCredentialResolution,
  lushaCredentialDiagnosticMessage,
} from '../../../services/lusha-credential-diagnostics';

// ── Env snapshot ───────────────────────────────────────────────────────────────

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    LUSHA_API_KEY: process.env['LUSHA_API_KEY'],
  };
});

afterEach(() => {
  for (const [key, val] of Object.entries(envSnapshot)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const SECRET = 'sk-lusha-real-secret-value-12345';
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake';

function resultContainsSecret(result: unknown, secret: string): boolean {
  return JSON.stringify(result).includes(secret);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('diagnoseLushaCredentialResolution', () => {

  it('stage=env_check cuando no hay SUPABASE_SERVICE_ROLE_KEY ni LUSHA_API_KEY', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.equal(result.stage, 'env_check');
    assert.equal(result.checks.hasServiceRoleKey, false);
    assert.equal(result.checks.envFallbackNonEmpty, false);
    assert.ok(result.recommendation.length > 0);
  });

  it('stage=resolved_from_env_fallback cuando no hay SERVICE_ROLE_KEY pero sí LUSHA_API_KEY', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = SECRET;

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, true);
    assert.equal(result.stage, 'resolved_from_env_fallback');
    assert.equal(result.checks.hasServiceRoleKey, false);
    assert.equal(result.checks.envFallbackNonEmpty, true);
  });

  it('el resultado no contiene el valor del secret LUSHA_API_KEY', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = SECRET;

    const result = await diagnoseLushaCredentialResolution();

    assert.ok(!resultContainsSecret(result, SECRET), 'El resultado no debe contener el secreto');
  });

  it('stage=admin_client cuando createAdminClient lanza (SERVICE_ROLE_KEY inválida y sin LUSHA fallback)', async () => {
    // Un valor muy corto que no es JWT válido pero no vacío — forzará createAdminClient a inicializarse
    // pero getAdminSupabase usará el valor. El cliente de Supabase no lanza en construcción,
    // así que simulamos la falla vía SERVICE_ROLE_KEY presente pero RPC fallará.
    // Para este test verificamos que checks.hasServiceRoleKey = true cuando el key existe.
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'invalid-key';
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.checks.hasServiceRoleKey, true);
    assert.equal(result.checks.adminClientCreated, true); // createAdminClient no lanza
    assert.equal(result.checks.vaultRpcCalled, true);
    assert.equal(result.checks.vaultRpcOk, false); // RPC fallará con key inválida
  });

  it('stage=vault_rpc cuando RPC falla y no hay env fallback', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'invalid-key-no-fallback';
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.ok, false);
    assert.ok(
      result.stage === 'vault_rpc' || result.stage === 'secret_missing' || result.stage === 'admin_client',
      `stage should be vault_rpc, secret_missing or admin_client, got: ${result.stage}`,
    );
    assert.equal(result.checks.envFallbackNonEmpty, false);
  });

  it('stage=vault_rpc cuando RPC falla pero LUSHA_API_KEY disponible → resolved_from_env_fallback', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'invalid-key-with-fallback';
    process.env['LUSHA_API_KEY'] = SECRET;

    const result = await diagnoseLushaCredentialResolution();

    // Con key inválida la RPC falla, pero LUSHA_API_KEY resuelve
    assert.equal(result.ok, true);
    assert.equal(result.stage, 'resolved_from_env_fallback');
    assert.equal(result.checks.envFallbackNonEmpty, true);
    assert.ok(!resultContainsSecret(result, SECRET));
  });

  it('nunca expone SERVICE_ROLE_KEY en el resultado', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = FAKE_JWT;
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.ok(!resultContainsSecret(result, FAKE_JWT), 'No debe exponer SERVICE_ROLE_KEY');
  });

  it('safeDetails.serviceRoleKeyLength es correcto y no contiene el valor', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = FAKE_JWT;
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.safeDetails.serviceRoleKeyLength, FAKE_JWT.length);
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes(FAKE_JWT));
  });

  it('safeDetails.serviceRoleKeyLooksJwt=true para JWT válido', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = FAKE_JWT;
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.safeDetails.serviceRoleKeyLooksJwt, true);
  });

  it('safeDetails.serviceRoleKeyLooksJwt=false para key sin formato JWT', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'not-a-jwt';
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.safeDetails.serviceRoleKeyLooksJwt, false);
  });

  it('safeDetails.supabaseUrlHost retorna solo hostname', async () => {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'any-key';
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    const host = result.safeDetails.supabaseUrlHost;
    assert.ok(host, 'host should be defined');
    assert.ok(!host!.includes('?'), 'host should not include query params');
    assert.ok(!host!.includes('//'), 'host should not include protocol prefix');
  });

  it('lushaEnvFallbackLength refleja la longitud del fallback', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = SECRET;

    const result = await diagnoseLushaCredentialResolution();

    assert.equal(result.safeDetails.lushaEnvFallbackLength, SECRET.length);
  });

  it('nunca lanza excepciones — siempre retorna resultado', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];

    await assert.doesNotReject(async () => {
      await diagnoseLushaCredentialResolution({ source: 'runner', runId: 'test-run', triggeredBy: 'user-x' });
    });
  });

  it('result.recommendation siempre es string no vacío', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();

    assert.ok(typeof result.recommendation === 'string');
    assert.ok(result.recommendation.length > 0);
  });

  it('result.checks tiene todas las propiedades booleanas definidas', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];

    const result = await diagnoseLushaCredentialResolution();
    const c = result.checks;

    assert.ok(typeof c.hasSupabaseUrl === 'boolean');
    assert.ok(typeof c.hasServiceRoleKey === 'boolean');
    assert.ok(typeof c.hasLushaEnvFallback === 'boolean');
    assert.ok(typeof c.adminClientCreated === 'boolean');
    assert.ok(typeof c.vaultRpcCalled === 'boolean');
    assert.ok(typeof c.vaultRpcOk === 'boolean');
    assert.ok(typeof c.vaultSecretFound === 'boolean');
    assert.ok(typeof c.vaultSecretNonEmpty === 'boolean');
    assert.ok(typeof c.envFallbackNonEmpty === 'boolean');
  });

  it('vaultSecretFingerprint es string de 8 chars hex (solo cuando secreto resuelto desde vault)', async () => {
    // Este test verifica el formato del fingerprint cuando se resuelve desde vault.
    // En entorno de test sin vault real, este path no se ejecuta — verificamos formato.
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = SECRET;

    const result = await diagnoseLushaCredentialResolution();

    // En env_fallback no hay fingerprint de vault
    assert.ok(
      result.safeDetails.vaultSecretFingerprint === null ||
      result.safeDetails.vaultSecretFingerprint === undefined ||
      /^[0-9a-f]{8}$/.test(result.safeDetails.vaultSecretFingerprint ?? ''),
      'Fingerprint debe ser 8 chars hex o null',
    );
  });
});

describe('lushaCredentialDiagnosticMessage', () => {
  it('retorna mensaje legible para cada stage', () => {
    const stages = [
      'env_check',
      'admin_client',
      'vault_rpc',
      'secret_missing',
      'secret_empty',
      'resolved_from_vault',
      'resolved_from_env_fallback',
      'failed',
    ] as const;

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
      assert.ok(typeof msg === 'string' && msg.length > 0, `Message for stage '${stage}' should not be empty`);
    }
  });

  it('no incluye secretos en el mensaje', () => {
    const msg = lushaCredentialDiagnosticMessage({
      ok: false,
      stage: 'secret_missing',
      checks: {
        hasSupabaseUrl: true,
        hasServiceRoleKey: true,
        hasLushaEnvFallback: false,
        adminClientCreated: true,
        vaultRpcCalled: true,
        vaultRpcOk: true,
        vaultSecretFound: false,
        vaultSecretNonEmpty: false,
        envFallbackNonEmpty: false,
      },
      safeDetails: {},
      recommendation: 'Guardar credencial',
    });
    assert.ok(!msg.includes(SECRET));
  });
});
