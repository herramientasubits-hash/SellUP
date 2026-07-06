/**
 * Tests — Lusha 17B.4R
 *
 * Verifica:
 * 1–8: resolveLushaCredential() — unified resolver
 * 9–13: feature flag helpers
 * 14–20: diagnoseLushaExecutionPreflight()
 * 21–25: status propagation en la action layer
 *
 * Sin llamadas live a Lusha ni Apollo.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers ─────────────────────────────────────────────────────────────────────

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

// ── 1–8: resolveLushaCredential ───────────────────────────────────────────────

describe('resolveLushaCredential — 17B.4R', () => {
  it('1. env_fallback: when Vault unreachable and LUSHA_API_KEY set → ok=true source=env_fallback', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = 'test-key-abcdef123456789012345678901234'; // 36 chars
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.equal(result.source, 'env_fallback');
    assert.ok(result.apiKey.length > 0);
  });

  it('2. env_fallback: apiKey equals LUSHA_API_KEY trimmed', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = '  trimmed-key-123456789012345678901  ';
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.equal(result.apiKey, 'trimmed-key-123456789012345678901');
  });

  it('3. env_check: no SUPABASE_SERVICE_ROLE_KEY and no LUSHA_API_KEY → ok=false stage=env_check', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('unreachable');
    assert.equal(result.stage, 'env_check');
  });

  it('4. safe: fingerprint is 8 hex chars when resolved', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = 'some-api-key-for-fingerprint-test-12345';
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.match(result.safe.fingerprint, /^[0-9a-f]{8}$/);
  });

  it('5. safe: length matches apiKey length', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const key = 'key-for-length-check-123456789012345';
    process.env['LUSHA_API_KEY'] = key;
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    assert.equal(result.safe.length, key.length);
  });

  it('6. empty LUSHA_API_KEY after trim → ok=false (not treated as valid key)', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = '   ';
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, false);
  });

  it('7. apiKey never appears in safe object', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = 'secret-api-key-should-not-appear-123456';
    const { resolveLushaCredential } = await import('@/server/services/lusha-connection');
    const result = await resolveLushaCredential();
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('unreachable');
    const safeStr = JSON.stringify(result.safe);
    assert.ok(!safeStr.includes('secret-api-key-should-not-appear'), 'apiKey must not appear in safe');
  });

  it('8. getLushaApiKey returns apiKey when env_fallback resolves', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    const key = 'getLusha-test-key-123456789012345678';
    process.env['LUSHA_API_KEY'] = key;
    const { getLushaApiKey } = await import('@/server/services/lusha-connection');
    const result = await getLushaApiKey();
    assert.equal(result, key);
  });
});

// ── 9–13: feature flag helpers ───────────────────────────────────────────────

describe('isLushaContactEnrichmentEnabled — 17B.4R', () => {
  it('9. raw "true" → enabled true', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    const { isLushaContactEnrichmentEnabled } = await import('@/lib/feature-flags.server');
    assert.equal(isLushaContactEnrichmentEnabled(), true);
  });

  it('10. raw " true " (spaces) → enabled true', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = ' true ';
    const { isLushaContactEnrichmentEnabled } = await import('@/lib/feature-flags.server');
    assert.equal(isLushaContactEnrichmentEnabled(), true);
  });

  it('11. raw "TRUE" (uppercase) → enabled true (case-insensitive)', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'TRUE';
    const { isLushaContactEnrichmentEnabled } = await import('@/lib/feature-flags.server');
    assert.equal(isLushaContactEnrichmentEnabled(), true);
  });

  it('12. missing env var → enabled false', async () => {
    delete process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'];
    const { isLushaContactEnrichmentEnabled } = await import('@/lib/feature-flags.server');
    assert.equal(isLushaContactEnrichmentEnabled(), false);
  });

  it('13. raw "false" → enabled false', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const { isLushaContactEnrichmentEnabled } = await import('@/lib/feature-flags.server');
    assert.equal(isLushaContactEnrichmentEnabled(), false);
  });
});

// ── 14–20: diagnoseLushaExecutionPreflight ───────────────────────────────────

describe('diagnoseLushaExecutionPreflight — 17B.4R', () => {
  it('14. flag false + no credential → blockedBy=feature_flag', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    assert.equal(result.blockedBy, 'feature_flag');
    assert.equal(result.wouldExecuteProvider, false);
  });

  it('15. flag true + no credential → blockedBy=credential', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    assert.equal(result.blockedBy, 'credential');
    assert.equal(result.wouldExecuteProvider, false);
  });

  it('16. flag true + credential present → wouldExecuteProvider=true', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = 'valid-test-key-for-preflight-16-12345';
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    assert.equal(result.wouldExecuteProvider, true);
    assert.equal(result.blockedBy, null);
  });

  it('17. providerCall.attempted always false', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    process.env['LUSHA_API_KEY'] = 'valid-key-for-test-17-123456789012345';
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    assert.equal(result.stages.providerCall.attempted, false);
  });

  it('18. preflight does not create a run (no DB write expected)', async () => {
    // Verifies that the preflight function resolves without throwing and
    // the result type has no run-related fields
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    assert.ok(!('runId' in result), 'no runId in preflight result');
    assert.ok(!('candidateId' in result), 'no candidateId in preflight result');
  });

  it('19. preflight result contains no usage log data', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    const str = JSON.stringify(result);
    assert.ok(!str.includes('provider_usage_log'), 'no usage log data in preflight');
    assert.ok(!str.includes('creditsUsed'), 'no credits data in preflight');
  });

  it('20. featureFlag.checked always true', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const { diagnoseLushaExecutionPreflight } = await import('@/server/services/lusha-credential-diagnostics');
    const result = await diagnoseLushaExecutionPreflight();
    assert.equal(result.stages.featureFlag.checked, true);
  });
});

// ── 21–25: runner status propagation ─────────────────────────────────────────

describe('executeContactEnrichmentLushaRun status propagation — 17B.4R', () => {
  it('21. runner disabled → status=disabled (not missing_api_key)', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const { executeContactEnrichmentLushaRun } = await import('../lusha-enrichment-runner');
    const result = await executeContactEnrichmentLushaRun('run-status-21', 'user-21');
    assert.equal(result.status, 'disabled');
    assert.equal(result.ok, false);
  });

  it('22. runner missing_api_key when flag=true but no credential', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const { executeContactEnrichmentLushaRun } = await import('../lusha-enrichment-runner');
    const result = await executeContactEnrichmentLushaRun('run-status-22', 'user-22');
    assert.equal(result.status, 'missing_api_key');
    assert.equal(result.ok, false);
  });

  it('23. disabled status has candidatesCreated=0', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const { executeContactEnrichmentLushaRun } = await import('../lusha-enrichment-runner');
    const result = await executeContactEnrichmentLushaRun('run-status-23', 'user-23');
    assert.equal(result.candidatesCreated, 0);
  });

  it('24. missing_api_key status has candidatesCreated=0', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const { executeContactEnrichmentLushaRun } = await import('../lusha-enrichment-runner');
    const result = await executeContactEnrichmentLushaRun('run-status-24', 'user-24');
    assert.equal(result.candidatesCreated, 0);
  });

  it('25. no phone_reveal in disabled or missing_api_key result', async () => {
    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'false';
    const { executeContactEnrichmentLushaRun } = await import('../lusha-enrichment-runner');
    const r1 = await executeContactEnrichmentLushaRun('run-status-25a', 'user-25');
    assert.ok(!JSON.stringify(r1).includes('"phone_reveal_enabled":true'));

    process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['LUSHA_API_KEY'];
    const r2 = await executeContactEnrichmentLushaRun('run-status-25b', 'user-25');
    assert.ok(!JSON.stringify(r2).includes('"phone_reveal_enabled":true'));
  });
});
