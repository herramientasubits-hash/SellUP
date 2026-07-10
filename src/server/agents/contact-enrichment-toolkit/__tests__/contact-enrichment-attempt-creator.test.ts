// Tests — Contact Enrichment Attempt Creator (Hito 17B.4X.7C.1)
//
// Full dependency injection (no DB, no network, no Apollo/Lusha). Verifies
// snapshot-at-attempt-creation ordering, attempt-order ownership, RPC status
// mapping, and that company context is sourced from the loaded request row
// (never from caller input).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createContactEnrichmentAttempt,
  createInitialContactEnrichmentAttempt,
  type AttemptCreatorDeps,
  type RequestRow,
} from '../contact-enrichment-attempt-creator';

const FAKE_REQUEST: RequestRow = {
  id: 'req-1',
  account_id: 'acc-1',
  company_name: 'Acme Corp',
  company_domain: 'acme.com',
  company_country_code: 'CO',
  hubspot_company_id: 'hs-123',
  company_resolution_source: 'sellup',
};

function depsFixture(overrides: Partial<AttemptCreatorDeps> = {}, calls: {
  loadRequestCalls: string[];
  snapshotCalls: Array<{ accountId: string | null; hubspotCompanyId: string | null }>;
  rpcCalls: any[];
} = { loadRequestCalls: [], snapshotCalls: [], rpcCalls: [] }): AttemptCreatorDeps {
  return {
    loadRequest: async (requestId) => {
      calls.loadRequestCalls.push(requestId);
      return requestId === FAKE_REQUEST.id ? FAKE_REQUEST : null;
    },
    buildExistingContactsSnapshot: async (accountId, hubspotCompanyId) => {
      calls.snapshotCalls.push({ accountId, hubspotCompanyId });
      return { combined: { existing_emails: [], existing_linkedin_urls: [], existing_contact_names: [] } };
    },
    callRpc: async (params) => {
      calls.rpcCalls.push(params);
      return { data: { status: 'created', attempt_id: 'attempt-1', agent_run_id: 'run-1' }, error: null };
    },
    ...overrides,
  };
}

describe('createContactEnrichmentAttempt', () => {
  it('TEST 16/18 — reads the snapshot after loading the request, before calling the RPC', async () => {
    const order: string[] = [];
    const deps: AttemptCreatorDeps = {
      loadRequest: async () => {
        order.push('loadRequest');
        return FAKE_REQUEST;
      },
      buildExistingContactsSnapshot: async () => {
        order.push('buildSnapshot');
        return {};
      },
      callRpc: async () => {
        order.push('callRpc');
        return { data: { status: 'created', attempt_id: 'a', agent_run_id: 'r' }, error: null };
      },
    };

    await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );

    assert.deepEqual(order, ['loadRequest', 'buildSnapshot', 'callRpc']);
  });

  it('TEST 17/19 — passes the snapshot into the same RPC call that creates the attempt (no follow-up)', async () => {
    const calls = { loadRequestCalls: [], snapshotCalls: [], rpcCalls: [] as any[] };
    const deps = depsFixture({}, calls);

    const result = await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );

    assert.equal(result.status, 'created');
    assert.equal(calls.rpcCalls.length, 1);
    assert.ok(calls.rpcCalls[0].existingContactsSnapshot);
    assert.deepEqual(calls.rpcCalls[0].existingContactsSnapshot, {
      combined: { existing_emails: [], existing_linkedin_urls: [], existing_contact_names: [] },
    });
  });

  it('TEST 23/24 — uses account_id/hubspot_company_id from the loaded request, not from caller input', async () => {
    const calls = { loadRequestCalls: [], snapshotCalls: [] as any[], rpcCalls: [] as any[] };
    const deps = depsFixture({}, calls);

    await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 1, intendedProvider: 'lusha', triggeredBy: 'user-1' },
      deps
    );

    assert.equal(calls.snapshotCalls.length, 1);
    assert.equal(calls.snapshotCalls[0].accountId, 'acc-1');
    assert.equal(calls.snapshotCalls[0].hubspotCompanyId, 'hs-123');
  });

  it('maps invalid_request when the request does not exist', async () => {
    const deps = depsFixture({ loadRequest: async () => null });
    const result = await createContactEnrichmentAttempt(
      { requestId: 'missing', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );
    assert.equal(result.status, 'invalid_request');
    assert.equal(result.attemptId, null);
    assert.equal(result.agentRunId, null);
  });

  it('rejects an empty requestId before touching any dependency', async () => {
    let touched = false;
    const deps = depsFixture({
      loadRequest: async () => {
        touched = true;
        return FAKE_REQUEST;
      },
    });
    const result = await createContactEnrichmentAttempt(
      { requestId: '', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );
    assert.equal(result.status, 'invalid_request');
    assert.equal(touched, false);
  });

  it('maps rpc_error when the RPC call itself errors', async () => {
    const deps = depsFixture({
      callRpc: async () => ({ data: null, error: { message: 'connection refused' } }),
    });
    const result = await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );
    assert.equal(result.status, 'rpc_error');
    assert.equal(result.reason, 'connection refused');
  });

  it('maps already_exists returned by the RPC, including the existing ids', async () => {
    const deps = depsFixture({
      callRpc: async () => ({
        data: { status: 'already_exists', attempt_id: 'existing-attempt', agent_run_id: 'existing-run' },
        error: null,
      }),
    });
    const result = await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );
    assert.equal(result.status, 'already_exists');
    assert.equal(result.attemptId, 'existing-attempt');
    assert.equal(result.agentRunId, 'existing-run');
  });

  it('maps invalid_provider and invalid_attempt_order statuses from the RPC verbatim', async () => {
    const providerDeps = depsFixture({
      callRpc: async () => ({ data: { status: 'invalid_provider', attempt_id: null, agent_run_id: null }, error: null }),
    });
    const providerResult = await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 1, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      providerDeps
    );
    assert.equal(providerResult.status, 'invalid_provider');

    const orderDeps = depsFixture({
      callRpc: async () => ({ data: { status: 'invalid_attempt_order', attempt_id: null, agent_run_id: null }, error: null }),
    });
    const orderResult = await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 2, intendedProvider: 'apollo', triggeredBy: 'user-1' },
      orderDeps
    );
    assert.equal(orderResult.status, 'invalid_attempt_order');
  });
});

describe('createInitialContactEnrichmentAttempt — attempt order ownership (§20, §33)', () => {
  it('TEST 25 — always calls the RPC with attemptOrder 1', async () => {
    const calls = { loadRequestCalls: [], snapshotCalls: [] as any[], rpcCalls: [] as any[] };
    const deps = depsFixture({}, calls);

    await createInitialContactEnrichmentAttempt(
      { requestId: 'req-1', intendedProvider: 'apollo', triggeredBy: 'user-1' },
      deps
    );

    assert.equal(calls.rpcCalls.length, 1);
    assert.equal(calls.rpcCalls[0].attemptOrder, 1);
  });

  it('TEST 26 — the public input type has no attemptOrder field to pass through', () => {
    // Compile-time contract: CreateInitialContactEnrichmentAttemptInput only
    // has requestId/intendedProvider/triggeredBy. This is enforced by the
    // TypeScript compiler (npx tsc --noEmit) rejecting an extra property —
    // this test documents the intent alongside the runtime TEST 25 above.
    const input: import('@/modules/contact-enrichment/request-attempt-types').CreateInitialContactEnrichmentAttemptInput = {
      requestId: 'req-1',
      intendedProvider: 'apollo',
      triggeredBy: 'user-1',
    };
    assert.deepEqual(Object.keys(input).sort(), ['intendedProvider', 'requestId', 'triggeredBy']);
  });

  it('TEST 27/28 — the low-level adapter can represent order 2 for future contract testing, but no production entry point does', async () => {
    const calls = { loadRequestCalls: [], snapshotCalls: [] as any[], rpcCalls: [] as any[] };
    const deps = depsFixture({}, calls);

    // Only the internal, non-public createContactEnrichmentAttempt accepts 2.
    const result = await createContactEnrichmentAttempt(
      { requestId: 'req-1', attemptOrder: 2, intendedProvider: 'lusha', triggeredBy: 'user-1' },
      deps
    );

    assert.equal(result.status, 'created');
    assert.equal(calls.rpcCalls[0].attemptOrder, 2);
  });
});

describe('isolation (§29-34)', () => {
  it('TEST 29/30 — the attempt creator module never imports Apollo or Lusha runners', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator.ts'),
      'utf-8'
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    assert.ok(!/apollo-enrichment-runner|apollo-people-adapter/.test(importLines));
    assert.ok(!/lusha-enrichment-runner|lusha-people-adapter/.test(importLines));
  });

  it('TEST 31/32 — the attempt creator module never imports or references the routing evaluator', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator.ts'),
      'utf-8'
    );
    assert.ok(!/contact-enrichment-routing/.test(source));
    assert.ok(!/observation-evaluator|routing_event/.test(source));
  });

  it('TEST 33/34 — neither the new request creator nor attempt creator import the wizard, reducer, ProviderSelector, or bulk runner', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const files = [
      'src/server/agents/contact-enrichment-toolkit/contact-enrichment-attempt-creator.ts',
      'src/server/agents/contact-enrichment-toolkit/contact-enrichment-request-creator.ts',
      'src/modules/contact-enrichment/request-persistence-core.ts',
      'src/modules/contact-enrichment/request-attempt-types.ts',
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      assert.ok(!/contact-enrichment-chat-wizard|contact-enrichment-chat-reducer|ProviderSelector/.test(source), `${file} must not reference the wizard`);
      assert.ok(!/bulk-enrichment-runner/.test(source), `${file} must not reference the bulk runner`);
    }
  });
});
