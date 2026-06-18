/**
 * Tests — Fintech query drift guard (16AB.43.23 Problem E)
 *
 * Verifies that fintech-specific queries are NOT included when the selected
 * subindustries are non-fintech (EdTech, Software Empresarial, SaaS, etc.).
 *
 * Root cause: Colombia/Tech R1 had fintech as a base query + Colombia Fintech
 * as a source-guided query that was always appended. When subindustry injection
 * replaced non-fintech base queries but not fintech, fintech queries drifted
 * into EdTech/SaaS searches.
 *
 * Fix: fintech base query moved to last slot (displaced first by injection) and
 * Colombia Fintech source-guided omitted unless fintech subindustry is present.
 *
 * Uses Node.js built-in test runner. No network calls, no external deps.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
} from '../query-builder';

// ── FG1: EdTech + Software Empresarial → no fintech in R1 ─────────────────────

describe('FG1 — EdTech + Software Empresarial subindustries: no fintech in R1 queries', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech', 'Software Empresarial']);
  const joined = queries.join(' ').toLowerCase();

  it('FG1-a: no query contains the word fintech', () => {
    assert.ok(
      !joined.includes('fintech'),
      `Expected no fintech queries, but got:\n${queries.join('\n')}`,
    );
  });

  it('FG1-b: no query contains "colombia fintech" source-guided pattern', () => {
    assert.ok(
      !joined.includes('colombia fintech'),
      `Expected no Colombia Fintech source-guided query, got:\n${queries.join('\n')}`,
    );
  });

  it('FG1-c: Fedesoft source-guided query IS still included', () => {
    assert.ok(
      joined.includes('fedesoft'),
      `Expected Fedesoft source-guided to be preserved, got:\n${queries.join('\n')}`,
    );
  });

  it('FG1-d: total query count is 4 (Colombia Fintech excluded → one fewer source-guided)', () => {
    // 2 subindustry queries + 1 remaining base + 1 Fedesoft = 4.
    // Colombia Fintech source-guided is omitted for non-fintech subindustries.
    assert.equal(queries.length, 4);
  });

  it('FG1-e: EdTech query is present', () => {
    assert.ok(
      joined.includes('edtech'),
      `Expected EdTech query to be injected, got:\n${queries.join('\n')}`,
    );
  });
});

// ── FG2: SaaS only → no fintech in R1 ────────────────────────────────────────

describe('FG2 — SaaS-only subindustry: no fintech in R1 queries', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['SaaS']);
  const joined = queries.join(' ').toLowerCase();

  it('FG2-a: no query contains fintech', () => {
    assert.ok(
      !joined.includes('fintech'),
      `Expected no fintech queries for SaaS, got:\n${queries.join('\n')}`,
    );
  });

  it('FG2-b: no Colombia Fintech source-guided', () => {
    assert.ok(
      !joined.includes('colombia fintech'),
      `Expected no Colombia Fintech source-guided for SaaS, got:\n${queries.join('\n')}`,
    );
  });

  it('FG2-c: SaaS query is present', () => {
    assert.ok(
      joined.includes('saas'),
      `Expected SaaS query to be injected, got:\n${queries.join('\n')}`,
    );
  });
});

// ── FG3: Fintech subindustry → Colombia Fintech source-guided IS included ─────

describe('FG3 — Fintech subindustry: Colombia Fintech source-guided IS included', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['Fintech']);
  const joined = queries.join(' ').toLowerCase();

  it('FG3-a: Colombia Fintech source-guided query is present', () => {
    assert.ok(
      joined.includes('colombia fintech'),
      `Expected Colombia Fintech source-guided for fintech subindustry, got:\n${queries.join('\n')}`,
    );
  });

  it('FG3-b: Fedesoft source-guided also present', () => {
    assert.ok(
      joined.includes('fedesoft'),
      `Expected Fedesoft source-guided to be preserved, got:\n${queries.join('\n')}`,
    );
  });

  it('FG3-c: total query count is still 5', () => {
    assert.equal(queries.length, 5);
  });
});

// ── FG4: No subindustries → Colombia Fintech source-guided IS included ─────────

describe('FG4 — No subindustries: Colombia Fintech source-guided preserved (general Tech search)', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', []);
  const joined = queries.join(' ').toLowerCase();

  it('FG4-a: Colombia Fintech source-guided present when no subindustries specified', () => {
    assert.ok(
      joined.includes('colombia fintech'),
      `Expected Colombia Fintech when no subindustries, got:\n${queries.join('\n')}`,
    );
  });

  it('FG4-b: Fedesoft source-guided also present', () => {
    assert.ok(
      joined.includes('fedesoft'),
      `Expected Fedesoft source-guided, got:\n${queries.join('\n')}`,
    );
  });

  it('FG4-c: total query count is 5', () => {
    assert.equal(queries.length, 5);
  });
});

// ── FG5: EdTech + Fintech mixed → Colombia Fintech IS included ────────────────

describe('FG5 — EdTech + Fintech mixed: Colombia Fintech source-guided present', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech', 'Fintech']);
  const joined = queries.join(' ').toLowerCase();

  it('FG5-a: Colombia Fintech source-guided is present (fintech in mix)', () => {
    assert.ok(
      joined.includes('colombia fintech'),
      `Expected Colombia Fintech for mixed EdTech+Fintech, got:\n${queries.join('\n')}`,
    );
  });

  it('FG5-b: total query count is still 5', () => {
    assert.equal(queries.length, 5);
  });
});

// ── FG6: R2 queries — no fintech drift when EdTech selected ──────────────────

describe('FG6 — R2 queries (expanded): no fintech drift when EdTech selected', () => {
  const r2 = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);
  const joined = r2.join(' ').toLowerCase();

  it('FG6-a: R2 does not contain fintech in any query', () => {
    // R2 uses ANDICOM + SECOP2, not Colombia Fintech — should always be fintech-free
    assert.ok(
      !joined.includes('colombia fintech'),
      `R2 must not contain Colombia Fintech source-guided, got:\n${r2.join('\n')}`,
    );
  });

  it('FG6-b: R2 contains ANDICOM or SECOP source-guided', () => {
    assert.ok(
      joined.includes('andicom') || joined.includes('secop'),
      `R2 must contain ANDICOM/SECOP source-guided, got:\n${r2.join('\n')}`,
    );
  });

  it('FG6-c: R2 total query count is 5', () => {
    assert.equal(r2.length, 5);
  });
});
