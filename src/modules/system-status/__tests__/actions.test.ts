// Tests for src/modules/system-status/actions.ts —
// 17B.4X.7C.5D.3A (Batch 1 Supabase fallback migration).
//
// getSystemHealthSummary / getConfigurationHealthDetails / getRecentAdminActivity
// all gate on assertAdmin(), which transitively calls createClient() from
// '@/lib/supabase/server' (next/headers cookies()) — invoking them requires a
// live Next.js request context unavailable under `node --test` (same
// limitation documented in
// src/modules/industry-mapping/__tests__/mapping-runtime-boundary-wiring.test.ts).
// Those three are covered by static source-inspection below.
//
// deriveAdministrativeRisks does not touch Supabase at all (pure function
// over already-fetched health data), so it is exercised behaviorally via a
// normal import to prove behavior is unchanged by the admin-client swap.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deriveAdministrativeRisks } from '../actions';
import type { ConfigurationHealthDetails } from '../types';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(moduleDir, '..', 'actions.ts'), 'utf8');

describe('system-status/actions.ts — admin client wiring (post 17B.4X.7C.5D.3A)', () => {
  it('imports createSupabaseAdminClient from @/lib/supabase/admin', () => {
    assert.match(
      source,
      /import\s*\{\s*createSupabaseAdminClient\s*\}\s*from\s*['"]@\/lib\/supabase\/admin['"]/,
    );
  });

  it('getAdminSupabase() delegates to createSupabaseAdminClient() with no fallback', () => {
    const start = source.indexOf('function getAdminSupabase()');
    assert.ok(start !== -1, 'expected to find function getAdminSupabase()');
    const body = source.slice(start, start + 200);
    assert.match(body, /createSupabaseAdminClient\(\)/);
  });

  it('does not contain a hardcoded Supabase project URL', () => {
    assert.equal(source.includes('lrdruowtadwbdulndlph.supabase.co'), false);
  });

  it('does not read SUPABASE_SERVICE_ROLE_KEY directly (guard owns that read)', () => {
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('getSystemHealthSummary, getConfigurationHealthDetails and getRecentAdminActivity still call getAdminSupabase()', () => {
    assert.match(source, /export async function getSystemHealthSummary[\s\S]*?getAdminSupabase\(\)/);
    assert.match(
      source,
      /export async function getConfigurationHealthDetails[\s\S]*?getAdminSupabase\(\)/,
    );
    assert.match(source, /export async function getRecentAdminActivity[\s\S]*?getAdminSupabase\(\)/);
  });
});

function baseHealth(): ConfigurationHealthDetails {
  return {
    ai_providers: [{ key: 'anthropic', name: 'Anthropic', has_credential: true, connection_status: 'connected', last_tested_at: null, is_active_provider: true }],
    active_ai: { provider_name: 'Anthropic', model_name: 'Claude', updated_at: null },
    hubspot: { credentials_status: 'stored', connection_status: 'connected', last_tested_at: null, hub_id: 1, last_connection_error: null },
    slack: { credentials_status: 'stored', connection_status: 'connected', last_tested_at: null, team_name: 'SellUp', channel_name: 'general', last_connection_error: null },
    apollo: { credentials_status: 'stored', connection_status: 'connected', last_tested_at: null, last_connection_error: null },
    lusha: { credentials_status: 'stored', connection_status: 'connected', last_tested_at: null, last_connection_error: null },
    samu: { credentials_status: 'stored', connection_status: 'connected', last_tested_at: null, user_count: 3, last_connection_error: null },
    prospecting: { total: 2, prepared: 2, active_provider: 'apollo' },
    automations: { total: 5, manual: 2, suggested: 1, automatic: 2 },
  };
}

describe('deriveAdministrativeRisks — behavior unchanged by admin-client swap', () => {
  it('a fully healthy configuration produces no risks', async () => {
    const risks = await deriveAdministrativeRisks(baseHealth(), 0);
    assert.deepEqual(risks, []);
  });

  it('no connected AI provider produces an ai_no_connected attention risk', async () => {
    const health = baseHealth();
    health.ai_providers = [{ ...health.ai_providers[0], connection_status: 'not_configured' }];
    const risks = await deriveAdministrativeRisks(health, 0);
    assert.ok(risks.some((r) => r.id === 'ai_no_connected' && r.severity === 'attention'));
  });

  it('pending access requests produce a pending_users attention risk with the count in the message', async () => {
    const risks = await deriveAdministrativeRisks(baseHealth(), 3);
    const risk = risks.find((r) => r.id === 'pending_users');
    assert.ok(risk);
    assert.match(risk.message, /3 solicitudes/);
  });

  it('no automatic automations (but some exist) produces a pending risk', async () => {
    const health = baseHealth();
    health.automations = { total: 3, manual: 3, suggested: 0, automatic: 0 };
    const risks = await deriveAdministrativeRisks(health, 0);
    assert.ok(risks.some((r) => r.id === 'no_automatic_automations' && r.severity === 'pending'));
  });
});
