/**
 * BR Receita CNPJ full join NO-WRITE / NO-RUNTIME guard — tests (BR-SOURCE-11A).
 *
 * Proves the guard is the fail-closed gate the milestone claims:
 *   - a correctly declared no-write contract passes;
 *   - an undeclared / falsified contract fails, field by field;
 *   - a dangerous indicator in the surrounding config fails on PRESENCE alone
 *     (service-role key, Supabase URL, import mode, runtime endpoint, Agent 1 switch,
 *     provider API key), including when nested;
 *   - an explicitly EMPTY indicator carries no capability and does not trip;
 *   - no violation ever echoes the detected secret, key, URL, or endpoint.
 *
 * 100% synthetic. No dataset, no Supabase, no network, no runtime, no file I/O.
 * Secret-looking values are assembled by CONCATENATION so no credential-shaped
 * literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
  assertBrazilReceitaFullJoinNoWrite,
} from '../br-receita-cnpj-full-join-no-write-guard';

/** A fake credential-shaped value, assembled so no literal token lives in source. */
const FAKE_SECRET = 'SYNTHETIC' + '_NOT_A_REAL' + '_CREDENTIAL';
const FAKE_ENDPOINT = 'https://' + 'synthetic.invalid' + '/endpoint';

describe('BR-SOURCE-11A no-write guard — declared contract', () => {
  it('passes the canonical no-write contract', () => {
    const result = assertBrazilReceitaFullJoinNoWrite(BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT);
    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  it('fails when noWriteMode is not declared', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      noWriteMode: undefined,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('no_write_mode_not_declared'));
  });

  it('fails when the config is not an object at all', () => {
    for (const value of [undefined, null, 'no-write', 42, [], true]) {
      const result = assertBrazilReceitaFullJoinNoWrite(value);
      assert.equal(result.ok, false, `expected refusal for ${typeof value}`);
    }
  });

  it('fails if supabaseWrite is true', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      supabaseWrite: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('supabase_write_requested'));
  });

  it('fails if importExecuted is true', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      importExecuted: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('import_execution_requested'));
  });

  it('fails if runtimeIntegration is true', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      runtimeIntegration: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('runtime_integration_requested'));
  });

  it('fails if agent1Integration is true', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      agent1Integration: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('agent1_integration_requested'));
  });

  it('fails if providerCalls is true', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      providerCalls: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('provider_calls_requested'));
  });

  it('reports EVERY violation, not just the first', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      supabaseWrite: true,
      runtimeIntegration: true,
      agent1Integration: true,
      providerCalls: true,
      importExecuted: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.length >= 6);
  });
});

describe('BR-SOURCE-11A no-write guard — dangerous indicators', () => {
  it('fails if a service role key is present', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      serviceRoleKey: FAKE_SECRET,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('service_role_key_present'));
  });

  it('fails if a Supabase URL is present', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      supabaseUrl: FAKE_ENDPOINT,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('supabase_url_present'));
  });

  it('fails if an import mode is present', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      importMode: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('import_mode_present'));
  });

  it('fails if a runtime endpoint is present', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      runtimeEndpoint: FAKE_ENDPOINT,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('runtime_endpoint_present'));
  });

  it('fails if an Agent 1 switch is present', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      agent1Enabled: true,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('agent1_enabled_present'));
  });

  it('fails if a provider API key is present', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      providerApiKey: FAKE_SECRET,
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('provider_api_key_present'));
  });

  it('detects a dangerous indicator NESTED inside the config', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      nested: { deeper: { serviceRoleKey: FAKE_SECRET } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('service_role_key_present'));
  });

  it('does NOT trip on an explicitly empty indicator (no capability carried)', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      serviceRoleKey: null,
      supabaseUrl: '',
      importMode: false,
      providerApiKey: undefined,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  it('survives a cyclic config without hanging', () => {
    const cyclic: Record<string, unknown> = { ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT };
    cyclic.self = cyclic;
    const result = assertBrazilReceitaFullJoinNoWrite(cyclic);
    assert.equal(result.ok, true);
  });
});

describe('BR-SOURCE-11A no-write guard — leak safety', () => {
  it('never echoes the detected secret, URL, or endpoint in any violation', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({
      ...BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT,
      serviceRoleKey: FAKE_SECRET,
      supabaseUrl: FAKE_ENDPOINT,
      providerApiKey: FAKE_SECRET,
    });
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(FAKE_SECRET));
    assert.ok(!serialized.includes(FAKE_ENDPOINT));
    assert.ok(!serialized.includes('synthetic.invalid'));
  });

  it('emits only fixed machine codes (snake_case, no values)', () => {
    const result = assertBrazilReceitaFullJoinNoWrite({ supabaseWrite: true });
    assert.equal(result.ok, false);
    for (const violation of result.violations) {
      assert.match(violation, /^[a-z0-9_]+$/);
    }
  });
});
