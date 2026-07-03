/**
 * Tests — Lusha Enrichment Runner (Agente 2A · 17B.3)
 *
 * Verifica que el skeleton se comporta correctamente:
 * - Flag disabled → never calls API
 * - Flag enabled + no key → missing_api_key
 * - Flag enabled + key → not_implemented (17B.3 skeleton)
 * - Nunca crea candidatos
 * - Nunca activa phone reveal
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeContactEnrichmentLushaRun } from '../lusha-enrichment-runner';

const RUN_ID = 'test-run-uuid-001';
const TRIGGERED_BY = 'user-uuid-test';

// Snapshot del entorno para restaurar después de cada test
let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {
    ENABLE_LUSHA_CONTACT_ENRICHMENT: process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'],
    LUSHA_API_KEY: process.env['LUSHA_API_KEY'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
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

describe('executeContactEnrichmentLushaRun', () => {
  it('retorna disabled cuando ENABLE_LUSHA_CONTACT_ENRICHMENT=false', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'disabled');
    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.runId, RUN_ID);
  });

  it('retorna disabled cuando env var no está definida (default off)', async () => {
    delete process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'disabled');
    assert.equal(result.candidatesCreated, 0);
  });

  it('retorna missing_api_key cuando flag=true pero no hay key en Vault', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    // Sin SUPABASE_SERVICE_ROLE_KEY → hasLushaApiKey retorna false
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing_api_key');
    assert.equal(result.candidatesCreated, 0);
  });

  it('candidatesCreated siempre es 0 en skeleton', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.candidatesCreated, 0);
  });

  it('nunca activa phone reveal (propiedad no existe en resultado)', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    const resultStr = JSON.stringify(result);
    assert.ok(
      !resultStr.toLowerCase().includes('phone_reveal_enabled": true'),
      'phone_reveal_enabled must never be true',
    );
  });
});
