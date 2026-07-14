/**
 * Tests — Lusha Enrichment Runner × Atomic Execution Claim
 * (Agente 2A · 17B.4X.7C.2)
 *
 * Verifies the claim wiring in executeContactEnrichmentLushaRun WITHOUT any
 * live Lusha API call and WITHOUT a real database: getLushaApiKey resolves
 * via LUSHA_API_KEY env fallback (see resolveLushaCredential's env_fallback
 * path in lusha-connection.ts), and NEXT_PUBLIC_SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY are set to inert placeholder values so
 * getAdminClient() can construct a client object without making any network
 * call. The injected claimRunForExecution intercepts before any Supabase
 * query or Lusha API call would otherwise happen — every case here returns
 * from the claim step itself, so no provider is ever reached.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeContactEnrichmentLushaRun } from '../lusha-enrichment-runner';

const TRIGGERED_BY = 'user-17b4x7c2';

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {
    ENABLE_LUSHA_CONTACT_ENRICHMENT: process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'],
    LUSHA_API_KEY: process.env['LUSHA_API_KEY'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
  };
  process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
  process.env['LUSHA_API_KEY'] = 'test-lusha-key-17b4x7c2';
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://example.supabase.co';
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key-placeholder';
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

describe('executeContactEnrichmentLushaRun — atomic claim wiring (17B.4X.7C.2)', () => {
  it('claim not_ready: retorna invalid_run_status y NUNCA llama a Lusha', async () => {
    let claimCalls = 0;
    const result = await executeContactEnrichmentLushaRun('run-not-ready', TRIGGERED_BY, {
      claimRunForExecution: async () => {
        claimCalls += 1;
        return { status: 'not_ready', currentStatus: 'completed' };
      },
    });

    assert.equal(claimCalls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'invalid_run_status');
    assert.equal(result.candidatesCreated, 0);
    assert.match(result.message, /completed/);
    assert.match(result.message, /ready_to_enrich/);
  });

  it('claim not_ready con currentStatus=enriching (claim perdido por carrera): invalid_run_status', async () => {
    const result = await executeContactEnrichmentLushaRun('run-racing', TRIGGERED_BY, {
      claimRunForExecution: async () => ({ status: 'not_ready', currentStatus: 'enriching' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'invalid_run_status');
    assert.match(result.message, /enriching/);
  });

  it('claim not_found: retorna not_found y NUNCA llama a Lusha', async () => {
    let claimCalls = 0;
    const result = await executeContactEnrichmentLushaRun('run-missing', TRIGGERED_BY, {
      claimRunForExecution: async () => {
        claimCalls += 1;
        return { status: 'not_found' };
      },
    });

    assert.equal(claimCalls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'not_found');
    assert.equal(result.candidatesCreated, 0);
  });

  it('claim error (fallo de transporte/DB): retorna not_found con el motivo, NUNCA llama a Lusha', async () => {
    const result = await executeContactEnrichmentLushaRun('run-claim-error', TRIGGERED_BY, {
      claimRunForExecution: async () => ({ status: 'error', reason: 'connection reset' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'not_found');
    assert.match(result.message, /connection reset/);
  });

  it('en ningún caso de claim fallido se reportan créditos consumidos', async () => {
    const notReady = await executeContactEnrichmentLushaRun('run-a', TRIGGERED_BY, {
      claimRunForExecution: async () => ({ status: 'not_ready', currentStatus: 'failed' }),
    });
    const notFound = await executeContactEnrichmentLushaRun('run-b', TRIGGERED_BY, {
      claimRunForExecution: async () => ({ status: 'not_found' }),
    });

    assert.equal(notReady.creditsUsed, null);
    assert.equal(notFound.creditsUsed, null);
  });
});
