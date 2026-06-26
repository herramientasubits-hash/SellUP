/**
 * Agent 1 v1.16K-O — Idempotent approval for existing accounts.
 *
 * Covers:
 *   1. findExistingAccountForCandidate — match by tax_identifier + country_code.
 *   2. findExistingAccountForCandidate — fallback by normalized domain.
 *   3. findExistingAccountForCandidate — no existing account → null (action would create).
 *   4. sanitizeHubSpotErrorMessage — HubSpot errors never leak secrets (FIX 2 safety).
 *   5. UI approval gating predicates (replica of candidate-row-actions.tsx logic).
 *
 * Uses Node.js built-in test runner. No Supabase connection, no HubSpot call,
 * no Tavily/LLM/LinkedIn/Socrata/Migo/SUNAT. The Supabase client is a tiny
 * in-memory fake; helpers are pure and read-only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findExistingAccountForCandidate,
  sanitizeHubSpotErrorMessage,
} from '../approval-idempotency';
import { APPROVE_BLOCK_MESSAGES, isStructuredCandidate } from '../types';

// ── Fake Supabase (read-only, in-memory accounts) ─────────────────────────────

interface FakeAccount {
  id: string;
  name?: string | null;
  tax_identifier?: string | null;
  country_code?: string | null;
  domain?: string | null;
  archived_at?: string | null;
}

/**
 * Minimal chainable query builder mirroring the exact shape used by
 * findExistingAccountForCandidate: from(table).select().eq().eq().is().limit().
 * Awaiting the builder resolves to { data, error }.
 */
function makeFakeSupabase(accounts: FakeAccount[]): Pick<SupabaseClient, 'from'> {
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let requireArchivedNull = false;

      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        is(col: string, val: unknown) {
          if (col === 'archived_at' && val === null) requireArchivedNull = true;
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (value: { data: FakeAccount[]; error: null }) => void) {
          const source = table === 'accounts' ? accounts : [];
          const rows = source.filter((row) => {
            for (const [key, value] of Object.entries(filters)) {
              if ((row as unknown as Record<string, unknown>)[key] !== value) return false;
            }
            if (requireArchivedNull && row.archived_at != null) return false;
            return true;
          });
          resolve({ data: rows.slice(0, 1), error: null });
        },
      };

      return builder;
    },
  };

  return client as unknown as Pick<SupabaseClient, 'from'>;
}

// SITECO real-data fixture (account created in a previous approval)
const SITECO_ACCOUNT: FakeAccount = {
  id: '3b3d1f35-d12e-461a-9014-2fdaddffafb0',
  name: 'SITECO',
  tax_identifier: '800175388',
  country_code: 'CO',
  domain: 'sitecosoluciones.com',
  archived_at: null,
};

// ── Test 1 — Existing account by tax id ───────────────────────────────────────

describe('findExistingAccountForCandidate — tax_identifier + country_code', () => {
  it('SITECO: matches existing account by NIT + CO and does not signal a new insert', async () => {
    const supabase = makeFakeSupabase([SITECO_ACCOUNT]);

    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '800175388',
      country_code: 'CO',
      domain: null,
      website: null,
    });

    assert.ok(match, 'expected an existing-account match');
    assert.equal(match.accountId, '3b3d1f35-d12e-461a-9014-2fdaddffafb0');
    assert.equal(match.matchedBy, 'tax_identifier');
    assert.equal(match.accountName, 'SITECO');
  });

  it('trims tax identifier before matching', async () => {
    const supabase = makeFakeSupabase([SITECO_ACCOUNT]);
    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '  800175388  ',
      country_code: 'CO',
    });
    assert.ok(match);
    assert.equal(match.matchedBy, 'tax_identifier');
  });

  it('does not match when country_code differs (no cross-country tax collision)', async () => {
    const supabase = makeFakeSupabase([SITECO_ACCOUNT]);
    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '800175388',
      country_code: 'PE',
      domain: null,
      website: null,
    });
    assert.equal(match, null);
  });

  it('ignores archived accounts', async () => {
    const supabase = makeFakeSupabase([{ ...SITECO_ACCOUNT, archived_at: '2026-01-01T00:00:00Z' }]);
    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '800175388',
      country_code: 'CO',
    });
    assert.equal(match, null);
  });
});

// ── Test 2 — Existing account by domain fallback ──────────────────────────────

describe('findExistingAccountForCandidate — domain fallback', () => {
  it('links existing account by normalized domain when there is no tax match', async () => {
    const account: FakeAccount = {
      id: 'acc-domain-1',
      name: 'Example Corp',
      tax_identifier: '999999999',
      country_code: 'CO',
      domain: 'example.com',
      archived_at: null,
    };
    const supabase = makeFakeSupabase([account]);

    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: null,
      country_code: 'CO',
      domain: null,
      website: 'https://www.example.com/contacto',
    });

    assert.ok(match, 'expected a domain match');
    assert.equal(match.accountId, 'acc-domain-1');
    assert.equal(match.matchedBy, 'domain');
  });

  it('falls back to domain when tax id has no match', async () => {
    const account: FakeAccount = {
      id: 'acc-domain-2',
      name: 'Acme',
      tax_identifier: '111111111',
      country_code: 'MX',
      domain: 'acme.io',
      archived_at: null,
    };
    const supabase = makeFakeSupabase([account]);

    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '222222222', // no tax match
      country_code: 'MX',
      domain: 'acme.io',
    });

    assert.ok(match);
    assert.equal(match.matchedBy, 'domain');
    assert.equal(match.accountId, 'acc-domain-2');
  });
});

// ── Test 3 — No existing account ──────────────────────────────────────────────

describe('findExistingAccountForCandidate — no existing account', () => {
  it('returns null when neither tax nor domain match (action creates a new account)', async () => {
    const supabase = makeFakeSupabase([SITECO_ACCOUNT]);

    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '900000000',
      country_code: 'CO',
      domain: 'totallynew.com',
      website: null,
    });

    assert.equal(match, null);
  });

  it('returns null when candidate has no usable keys', async () => {
    const supabase = makeFakeSupabase([SITECO_ACCOUNT]);
    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: null,
      country_code: null,
      domain: null,
      website: null,
    });
    assert.equal(match, null);
  });

  it('does not match by tax when country_code is missing (both required)', async () => {
    const supabase = makeFakeSupabase([SITECO_ACCOUNT]);
    const match = await findExistingAccountForCandidate(supabase, {
      tax_identifier: '800175388',
      country_code: null,
    });
    assert.equal(match, null);
  });
});

// ── Test 4 — HubSpot error sanitization (FIX 2 safety) ────────────────────────

describe('sanitizeHubSpotErrorMessage', () => {
  it('redacts Bearer tokens', () => {
    const out = sanitizeHubSpotErrorMessage(
      new Error('Request failed: Authorization: Bearer pat-na1-abc123DEF456-secret token'),
    );
    assert.ok(!out.includes('abc123DEF456'), 'bearer token must not leak');
    assert.ok(out.includes('[REDACTED]'));
  });

  it('redacts HubSpot private app tokens (pat-...)', () => {
    const out = sanitizeHubSpotErrorMessage(new Error('invalid token pat-na1-0000-1111-2222'));
    assert.ok(!out.includes('pat-na1-0000-1111-2222'));
    assert.ok(out.includes('[REDACTED_TOKEN]'));
  });

  it('redacts api_key style secrets', () => {
    const out = sanitizeHubSpotErrorMessage('hubspot error api_key=SUPERSECRETVALUE123');
    assert.ok(!out.includes('SUPERSECRETVALUE123'));
  });

  it('handles non-Error inputs without throwing', () => {
    assert.equal(typeof sanitizeHubSpotErrorMessage(undefined), 'string');
    assert.equal(typeof sanitizeHubSpotErrorMessage({ weird: true }), 'string');
    assert.equal(sanitizeHubSpotErrorMessage('plain message'), 'plain message');
  });

  it('caps length at 200 characters', () => {
    const out = sanitizeHubSpotErrorMessage(new Error('x'.repeat(500)));
    assert.ok(out.length <= 200);
  });
});

// ── Test 5 — UI approval gating predicates ────────────────────────────────────
// Replica of the boolean logic in candidate-row-actions.tsx, exercised against
// the real isStructuredCandidate + APPROVE_BLOCK_MESSAGES so a regression in
// either is caught here.

interface GatingCandidate {
  status: string;
  duplicate_status: string;
  review_status: string | null;
  source_primary?: string | null;
}

function computeGating(candidate: GatingCandidate) {
  const isStructured = isStructuredCandidate({
    review_status: candidate.review_status as never,
    source_primary: (candidate.source_primary ?? null) as never,
  });
  const reviewStatus = candidate.review_status ?? null;
  const statusAllowsApprove = ['generated', 'normalized', 'needs_review'].includes(candidate.status);
  const approveBlockMessage = APPROVE_BLOCK_MESSAGES[candidate.duplicate_status as never];
  const isDuplicateBlocked = !!approveBlockMessage;
  const approveBlockedNotReady =
    isStructured && statusAllowsApprove && reviewStatus !== 'ready_for_approval';
  const canApprove = statusAllowsApprove && !isDuplicateBlocked && !approveBlockedNotReady;
  return { canApprove, isDuplicateBlocked, approveBlockedNotReady, statusAllowsApprove };
}

describe('UI approval gating', () => {
  it('SITECO-like (needs_review, review_status null, no_match) → Aprobar enabled', () => {
    const g = computeGating({
      status: 'needs_review',
      duplicate_status: 'no_match',
      review_status: null,
    });
    assert.equal(g.canApprove, true);
    assert.equal(g.isDuplicateBlocked, false);
    assert.equal(g.approveBlockedNotReady, false);
  });

  it('duplicate_status=unchecked → Aprobar blocked', () => {
    const g = computeGating({
      status: 'needs_review',
      duplicate_status: 'unchecked',
      review_status: null,
    });
    assert.equal(g.isDuplicateBlocked, true);
    assert.equal(g.canApprove, false);
  });

  it('exact_duplicate → Aprobar blocked', () => {
    const g = computeGating({
      status: 'needs_review',
      duplicate_status: 'exact_duplicate',
      review_status: null,
    });
    assert.equal(g.isDuplicateBlocked, true);
    assert.equal(g.canApprove, false);
  });

  it('structured candidate with review_status != ready_for_approval → blocked', () => {
    const g = computeGating({
      status: 'needs_review',
      duplicate_status: 'no_match',
      review_status: 'needs_manual_review',
      source_primary: 'socrata_colombia',
    });
    assert.equal(g.approveBlockedNotReady, true);
    assert.equal(g.canApprove, false);
  });

  it('structured candidate ready_for_approval with no_match → enabled', () => {
    const g = computeGating({
      status: 'needs_review',
      duplicate_status: 'no_match',
      review_status: 'ready_for_approval',
      source_primary: 'socrata_colombia',
    });
    assert.equal(g.approveBlockedNotReady, false);
    assert.equal(g.canApprove, true);
  });
});
