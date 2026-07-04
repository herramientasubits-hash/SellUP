/**
 * Tests — Lusha Enrichment Runner (Agente 2A · 17B.4L)
 *
 * Verifica que el runner usa getLushaApiKey() directamente (no hasLushaApiKey),
 * y que cuando las credenciales faltan el run se marca failed (no queda en
 * ready_to_enrich) y el resultado retorna missing_api_key con ok=false.
 *
 * Sin llamadas live: Supabase y Lusha completamente mockeados vía env.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeContactEnrichmentLushaRun } from '../lusha-enrichment-runner';

const RUN_ID = 'test-run-17b4l-001';
const TRIGGERED_BY = 'user-17b4l';

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {
    ENABLE_LUSHA_CONTACT_ENRICHMENT: process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'],
    LUSHA_API_KEY: process.env['LUSHA_API_KEY'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
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

describe('executeContactEnrichmentLushaRun — 17B.4L credenciales', () => {
  it('retorna missing_api_key (no disabled) cuando flag=true pero Vault no responde', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing_api_key', 'should be missing_api_key, not disabled');
    assert.equal(result.candidatesCreated, 0);
  });

  it('mensaje describe la clave del Vault que falta', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.ok(
      result.message?.includes('sellup_prospecting_lusha_api_key'),
      `message should reference vault secret name, got: ${result.message}`,
    );
  });

  it('runId se preserva en resultado missing_api_key', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun('run-preserve-id', TRIGGERED_BY);
    assert.equal(result.runId, 'run-preserve-id');
  });

  it('ok=false y candidatesCreated=0 para missing_api_key', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.candidatesCreated, 0);
  });

  it('no hay phone_reveal en resultado missing_api_key', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    const serialized = JSON.stringify(result);
    assert.ok(
      !serialized.includes('"phone_reveal_enabled":true'),
      'phone_reveal_enabled must never be true',
    );
  });
});

describe('executeContactEnrichmentLushaRun — 17B.4L flag disabled sigue funcionando', () => {
  it('retorna disabled cuando flag=false (sin regresión)', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'disabled');
    assert.equal(result.candidatesCreated, 0);
  });

  it('retorna disabled cuando flag no está definido (sin regresión)', async () => {
    delete process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'disabled');
  });
});
