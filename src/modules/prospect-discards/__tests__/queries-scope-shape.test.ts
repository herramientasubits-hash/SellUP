// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — static-scan proof that the list/detail
// queries apply commercial scope server-side and never let a client-supplied
// param widen visibility. Mirrors the style of
// `prospect-review/__tests__/queries-shape.test.ts`.
//
// Test D/E: scope enforced server-side; ?userId=/?groupId=/?roleKey= cannot
// widen visibility because they are never read as a raw filter — they only
// ever reach `resolveScopeOwnerFilter`, which itself intersects with scope.
//
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const QUERIES_PATH = path.join(__dirname, '..', 'queries.ts');
const ACTIONS_PATH = path.join(__dirname, '..', 'send-to-review-actions.ts');

describe('queries.ts — scope shape', () => {
  const content = readFileSync(QUERIES_PATH, 'utf8');

  it('imports and calls resolveAllowedBatchIds (the canonical scope resolver)', () => {
    assert.ok(content.includes('resolveAllowedBatchIds'));
    assert.match(content, /await\s+resolveAllowedBatchIds\(\)/);
  });

  it('gates every export on requireActiveUser', () => {
    const exportedFns = [...content.matchAll(/export async function (\w+)\s*\(/g)].map((m) => m[1]);
    assert.ok(exportedFns.length >= 2, 'expected at least getDiscardedProspectsList and getDiscardedProspectDetail');
    for (const fnName of exportedFns) {
      const fnStart = content.indexOf(`export async function ${fnName}`);
      const fnBodyPreview = content.slice(fnStart, fnStart + 400);
      assert.ok(
        fnBodyPreview.includes('requireActiveUser'),
        `${fnName} must call requireActiveUser before touching data`,
      );
    }
  });

  it('does NOT accept a raw userId/groupId/roleKey filter that bypasses resolveScopeOwnerFilter', () => {
    // The only scope-shaped param this module's public filters type may carry
    // is `ownerUserIds` (already resolved/intersected upstream) — never a raw
    // userId/groupId/roleKey that a caller could use to request someone else's
    // data directly.
    assert.ok(!/filters\.userId\b/.test(content));
    assert.ok(!/filters\.groupId\b/.test(content));
    assert.ok(!/filters\.roleKey\b/.test(content));
  });
});

describe('send-to-review-actions.ts — scope shape', () => {
  const content = readFileSync(ACTIONS_PATH, 'utf8');

  it('gates on isCurrentUserAdmin before any read/write', () => {
    assert.ok(content.includes('isCurrentUserAdmin'));
  });

  it('applies a server-side batch-ownership scope check (isBatchInScope) before delegating to core', () => {
    assert.ok(content.includes('isBatchInScope'));
    assert.ok(content.includes('resolveCommercialScope'));
    assert.ok(content.includes('sendCandidateToReviewCore') || content.includes('sendDispositionToReviewCore'));
  });

  it('never takes a client-supplied scope override parameter', () => {
    assert.ok(!/userId\s*:\s*string/.test(content.split('async function isBatchInScope')[0] ?? ''));
  });
});

describe('send-to-review-core.ts — never resolves auth/scope itself (injected only)', () => {
  const CORE_PATH = path.join(__dirname, '..', 'send-to-review-core.ts');
  const content = readFileSync(CORE_PATH, 'utf8');

  it('does not import createClient, isCurrentUserAdmin, or resolveCommercialScope', () => {
    const importLines = content
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line));
    const importBlock = importLines.join('\n');
    assert.ok(!importBlock.includes('createClient'));
    assert.ok(!importBlock.includes('isCurrentUserAdmin'));
    assert.ok(!importBlock.includes('resolveCommercialScope'));
  });

  it('takes the Supabase client and the scope predicate as injected dependencies', () => {
    assert.ok(content.includes('SendToReviewCoreDeps'));
    assert.ok(content.includes('isBatchInScope: (batchId: string) => Promise<boolean>'));
  });
});
