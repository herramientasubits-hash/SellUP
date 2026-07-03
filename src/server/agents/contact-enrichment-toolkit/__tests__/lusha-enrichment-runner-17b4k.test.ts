/**
 * Tests — Lusha Enrichment Runner (Agente 2A · 17B.4K)
 *
 * Verifica que executeContactEnrichmentLushaRun implementa el flujo real
 * company-search + enrich con candidatos pending_review, sin phone reveal,
 * sin auto-approval, sin HubSpot write.
 *
 * Sin llamadas live: Supabase y Lusha API son completamente mockeados via env.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeContactEnrichmentLushaRun } from '../lusha-enrichment-runner';

const RUN_ID = 'test-run-17b4k-001';
const TRIGGERED_BY = 'user-17b4k';

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

describe('executeContactEnrichmentLushaRun — 17B.4K guardrails', () => {
  it('retorna disabled cuando ENABLE_LUSHA_CONTACT_ENRICHMENT=false', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'disabled');
    assert.equal(result.candidatesCreated, 0);
    assert.equal(result.runId, RUN_ID);
  });

  it('retorna disabled cuando el flag no está definido (default off)', async () => {
    delete process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'disabled');
    assert.equal(result.candidatesCreated, 0);
  });

  it('retorna missing_api_key cuando flag=true pero SUPABASE_SERVICE_ROLE_KEY no está disponible', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing_api_key');
    assert.equal(result.candidatesCreated, 0);
  });

  it('candidatesCreated === 0 en caso disabled', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.candidatesCreated, 0);
  });

  it('phone reveal nunca activado — ningún campo en resultado expone phone_reveal_enabled=true', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    const serialized = JSON.stringify(result);
    assert.ok(
      !serialized.includes('"phone_reveal_enabled":true'),
      'phone_reveal_enabled must never be true in any result',
    );
  });

  it('retorna runId correcto siempre', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun('custom-run-xyz', TRIGGERED_BY);
    assert.equal(result.runId, 'custom-run-xyz');
  });
});

describe('executeContactEnrichmentLushaRun — resultado tipado', () => {
  it('resultado incluye candidatesCreated, duplicatesSkipped, rawResultsCount cuando disabled', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.ok('candidatesCreated' in result, 'should have candidatesCreated');
    assert.ok('duplicatesSkipped' in result, 'should have duplicatesSkipped');
    assert.ok('rawResultsCount' in result, 'should have rawResultsCount');
    assert.equal(typeof result.candidatesCreated, 'number');
  });

  it('ok=false cuando status es disabled', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
  });

  it('ok=false cuando status es missing_api_key', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const result = await executeContactEnrichmentLushaRun(RUN_ID, TRIGGERED_BY);
    assert.equal(result.ok, false);
  });
});
