/**
 * A1-LEGACY-PATH-FENCE-1 — Capa 5: server-side capability gate for the legacy
 * Agente 1 company-discovery action, plus the bypass defences from § 13.
 *
 * The gate is the authoritative defence: the UI layers now fail closed, but
 * `generateAIProspectBatch` is a server action and stays directly invocable. Every
 * refusal must happen before the first write, spend nothing, and leak nothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateLegacyApolloPathGate,
  buildLegacyPathBlockedResult,
  type LegacyApolloPathGateDeps,
  type LegacyPathBlockedReason,
} from '@/modules/prospect-batches/legacy-apollo-path-gate';

/** Deps with everything permissive; individual tests tighten one axis at a time. */
function allowAll(overrides: Partial<LegacyApolloPathGateDeps> = {}): LegacyApolloPathGateDeps {
  return {
    isAdmin: async () => true,
    isLegacyCapabilityEnabled: () => true,
    isApolloCompanySearchEnabled: () => true,
    ...overrides,
  };
}

// ── Decision matrix ───────────────────────────────────────────────────────────

describe('Capa 5 — gate decision matrix', () => {
  it('admin + legacy ON + apollo ON + impliesApollo → allowed', async () => {
    const d = await evaluateLegacyApolloPathGate({ impliesApollo: true }, allowAll());
    assert.equal(d.allowed, true);
  });

  it('non-admin is blocked even with BOTH flags ON', async () => {
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({ isAdmin: async () => false }),
    );
    assert.equal(d.allowed, false);
    assert.equal(d.allowed === false && d.reason, 'not_admin');
  });

  it('admin with the legacy capability OFF is blocked', async () => {
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({ isLegacyCapabilityEnabled: () => false }),
    );
    assert.equal(d.allowed, false);
    assert.equal(d.allowed === false && d.reason, 'legacy_capability_disabled');
  });

  it('admin + legacy ON but Apollo company search OFF → blocked before any Apollo call', async () => {
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({ isApolloCompanySearchEnabled: () => false }),
    );
    assert.equal(d.allowed, false);
    assert.equal(d.allowed === false && d.reason, 'apollo_company_search_disabled');
  });

  it('a non-Apollo path (writer pipeline / Tavily) is NOT blocked by the Apollo flag', async () => {
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: false },
      allowAll({ isApolloCompanySearchEnabled: () => false }),
    );
    assert.equal(d.allowed, true);
  });

  it('identity is checked before capability — a non-admin never reveals flag state', async () => {
    let capabilityRead = false;
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({
        isAdmin: async () => false,
        isLegacyCapabilityEnabled: () => {
          capabilityRead = true;
          return true;
        },
      }),
    );
    assert.equal(d.allowed === false && d.reason, 'not_admin');
    assert.equal(capabilityRead, false);
  });

  it('the Apollo flag is not even read when the legacy capability is OFF', async () => {
    let apolloRead = false;
    await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({
        isLegacyCapabilityEnabled: () => false,
        isApolloCompanySearchEnabled: () => {
          apolloRead = true;
          return true;
        },
      }),
    );
    assert.equal(apolloRead, false);
  });

  it('default-OFF posture: everything off → blocked', async () => {
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      {
        isAdmin: async () => false,
        isLegacyCapabilityEnabled: () => false,
        isApolloCompanySearchEnabled: () => false,
      },
    );
    assert.equal(d.allowed, false);
  });
});

// ── § 13 Bypass defence ───────────────────────────────────────────────────────

describe('§13 — client-supplied fields cannot unlock the legacy path', () => {
  it('the gate never reads caller input: only impliesApollo affects the decision', async () => {
    // Simulate an attacker-controlled payload smuggled alongside the input.
    const hostileInput = {
      impliesApollo: true,
      source: 'modern',
      origin: 'wizard',
      provider: 'tavily',
      legacyAllowed: true,
      isAdmin: true,
      role: 'admin',
    } as unknown as { impliesApollo: boolean };

    const d = await evaluateLegacyApolloPathGate(
      hostileInput,
      allowAll({ isLegacyCapabilityEnabled: () => false }),
    );
    assert.equal(d.allowed, false);
    assert.equal(d.allowed === false && d.reason, 'legacy_capability_disabled');
  });

  it('the deps interface exposes no input-derived authorization channel', () => {
    // The gate's authority comes from callbacks the server owns, never from data.
    const deps = allowAll();
    assert.deepEqual(
      Object.keys(deps).sort(),
      ['isAdmin', 'isApolloCompanySearchEnabled', 'isLegacyCapabilityEnabled'],
    );
  });
});

// ── Blocked result shape ──────────────────────────────────────────────────────

describe('Capa 5 — blocked result is fail-closed and leaks nothing', () => {
  const REASONS: LegacyPathBlockedReason[] = [
    'not_admin',
    'legacy_capability_disabled',
    'apollo_company_search_disabled',
  ];

  for (const reason of REASONS) {
    it(`${reason}: zero batch, zero candidates, zero cost`, () => {
      const r = buildLegacyPathBlockedResult(reason);
      assert.equal(r.ok, false);
      assert.equal(r.blocked, true);
      assert.equal(r.blockedReason, reason);
      assert.equal(r.batchId, null);
      assert.equal(r.candidatesCreated, 0);
      assert.equal(r.estimatedCostUsd, 0);
    });

    it(`${reason}: the user-facing message names no flag, role or provider`, () => {
      const r = buildLegacyPathBlockedResult(reason);
      assert.doesNotMatch(r.message, /ENABLE_/i);
      assert.doesNotMatch(r.message, /apollo/i);
      assert.doesNotMatch(r.message, /admin/i);
      assert.doesNotMatch(r.message, /flag/i);
      assert.equal(r.message, 'La búsqueda de empresas no está disponible.');
    });
  }

  it('the message is identical for every reason — blocked states are indistinguishable', () => {
    const messages = new Set(REASONS.map((r) => buildLegacyPathBlockedResult(r).message));
    assert.equal(messages.size, 1);
  });
});

// ── Observability: PII-free ───────────────────────────────────────────────────

describe('Capa 5 — blocked logging carries no PII', () => {
  it('logBlocked receives ONLY a static reason code', async () => {
    const seen: unknown[] = [];
    await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({
        isLegacyCapabilityEnabled: () => false,
        logBlocked: (reason) => seen.push(reason),
      }),
    );
    assert.deepEqual(seen, ['legacy_capability_disabled']);
    assert.equal(typeof seen[0], 'string');
  });

  it('nothing is logged when the gate allows the call', async () => {
    const seen: unknown[] = [];
    await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      allowAll({ logBlocked: (reason) => seen.push(reason) }),
    );
    assert.equal(seen.length, 0);
  });

  it('the gate works without a logger (logBlocked is optional)', async () => {
    const d = await evaluateLegacyApolloPathGate(
      { impliesApollo: true },
      {
        isAdmin: async () => true,
        isLegacyCapabilityEnabled: () => false,
        isApolloCompanySearchEnabled: () => true,
      },
    );
    assert.equal(d.allowed, false);
  });
});
