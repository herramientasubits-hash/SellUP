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

  it('FG1-c: Fedesoft source-guided query IS NOT included (fix-p0: paused/not_connected)', () => {
    assert.ok(
      !joined.includes('fedesoft'),
      `Expected Fedesoft source-guided to be removed, got:\n${queries.join('\n')}`,
    );
  });

  it('FG1-d: total query count is 3 (Colombia Fintech + Fedesoft excluded → no source-guided R1)', () => {
    // 2 subindustry queries + 1 remaining base = 3. No source-guided for non-fintech.
    assert.equal(queries.length, 3);
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

  it('FG3-b: Fedesoft source-guided NOT present (fix-p0: paused/not_connected)', () => {
    assert.ok(
      !joined.includes('fedesoft'),
      `Expected Fedesoft removed, got:\n${queries.join('\n')}`,
    );
  });

  it('FG3-c: total query count is 4 (Colombia Fintech present, Fedesoft gone)', () => {
    assert.equal(queries.length, 4);
  });
});

// ── FG4: No subindustries → Colombia Fintech NO se incluye (v1.1) ──────────────

describe('FG4 — No subindustries: Colombia Fintech NOT included without fintech signal (v1.1 rule)', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', []);
  const joined = queries.join(' ').toLowerCase();

  it('FG4-a: Colombia Fintech NOT included when no subindustries and no criteria', () => {
    assert.ok(
      !joined.includes('colombia fintech'),
      `Expected NO Colombia Fintech without subindustry signal, got:\n${queries.join('\n')}`,
    );
  });

  it('FG4-b: Fedesoft source-guided NOT present (fix-p0)', () => {
    assert.ok(
      !joined.includes('fedesoft'),
      `Expected Fedesoft removed, got:\n${queries.join('\n')}`,
    );
  });

  it('FG4-c: total query count is 3 (no source-guided R1 without fintech signal)', () => {
    // baseQueries(3) + no source-guided = 3. Fedesoft and Colombia Fintech both excluded.
    assert.equal(queries.length, 3);
  });

  it('FG4-d: Colombia Fintech IS present when additionalCriteria mentions fintech', () => {
    const withCriteria = buildCleanMultiQueryDiscoveryQueries(
      'Tecnología', 'Colombia', [],
      { additionalCriteria: 'empresas de fintech y pagos Colombia' },
    );
    assert.ok(
      withCriteria.join(' ').toLowerCase().includes('colombia fintech'),
      `Expected Colombia Fintech when criteria mentions fintech:\n${withCriteria.join('\n')}`,
    );
  });

  it('FG4-e: Colombia Fintech IS present when additionalCriteria mentions pagos', () => {
    const withPagos = buildCleanMultiQueryDiscoveryQueries(
      'Tecnología', 'Colombia', [],
      { additionalCriteria: 'plataformas de medios de pago empresariales' },
    );
    assert.ok(
      withPagos.join(' ').toLowerCase().includes('colombia fintech'),
      `Expected Colombia Fintech when criteria mentions pagos:\n${withPagos.join('\n')}`,
    );
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

  it('FG5-b: total query count is 4 (Fedesoft removed fix-p0)', () => {
    assert.equal(queries.length, 4);
  });
});

// ── FG7: v1.2 — no fintech BASE query when no fintech signal ─────────────────
// Verifies the new guard: the third base query slot is replaced by a B2B ERP/CRM query
// when subindustries and additionalCriteria carry no fintech signal.

describe('FG7 — v1.2: no fintech base query when no fintech signal (Colombia + Tecnología general)', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', []);
  const joined = queries.join(' ').toLowerCase();

  it('FG7-a: no query contains the word "fintech"', () => {
    assert.ok(
      !joined.includes('fintech'),
      `Expected no "fintech" in any query (base or source-guided), got:\n${queries.join('\n')}`,
    );
  });

  it('FG7-b: no query contains the word "pagos" (fintech payment family)', () => {
    assert.ok(
      !joined.includes('pagos'),
      `Expected no "pagos" in any query without fintech signal, got:\n${queries.join('\n')}`,
    );
  });

  it('FG7-c: R1 count is 3 (3 base, no Fedesoft fix-p0)', () => {
    assert.equal(queries.length, 3);
  });

  it('FG7-d: replacement query contains ERP/CRM/SaaS signal', () => {
    const hasErpCrmSaas = joined.includes('erp') || joined.includes('crm') || joined.includes('saas');
    assert.ok(
      hasErpCrmSaas,
      `Replacement query must carry ERP/CRM/SaaS signal, got:\n${queries.join('\n')}`,
    );
  });

  it('FG7-e: Fedesoft source-guided NOT present (fix-p0)', () => {
    assert.ok(
      !joined.includes('fedesoft'),
      `Fedesoft must not appear, got:\n${queries.join('\n')}`,
    );
  });

  it('FG7-f: software gestión talento query still present', () => {
    assert.ok(
      joined.includes('gestión talento') || joined.includes('gestion talento'),
      `HR/talent query must still be present, got:\n${queries.join('\n')}`,
    );
  });

  it('FG7-g: fintech base query IS present when additionalCriteria has fintech signal', () => {
    const withFintech = buildCleanMultiQueryDiscoveryQueries(
      'Tecnología', 'Colombia', [],
      { additionalCriteria: 'empresas de fintech y pagos B2B Colombia' },
    );
    assert.ok(
      withFintech.join(' ').toLowerCase().includes('fintech'),
      `With fintech criteria, fintech base query must be present:\n${withFintech.join('\n')}`,
    );
  });

  it('FG7-h: fintech base query IS present when additionalCriteria mentions open banking', () => {
    const withOpenBanking = buildCleanMultiQueryDiscoveryQueries(
      'Tecnología', 'Colombia', [],
      { additionalCriteria: 'open banking APIs para empresas corporativas' },
    );
    assert.ok(
      withOpenBanking.join(' ').toLowerCase().includes('fintech'),
      `With open banking criteria, fintech base query must be present:\n${withOpenBanking.join('\n')}`,
    );
  });
});

// ── FG6: R2 queries — no fintech drift when EdTech selected ──────────────────

describe('FG6 — R2 queries (expanded): no fintech drift when EdTech selected', () => {
  const r2 = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);
  const joined = r2.join(' ').toLowerCase();

  it('FG6-a: R2 does not contain Colombia Fintech source-guided', () => {
    // R2 never uses Colombia Fintech — should always be fintech-free
    assert.ok(
      !joined.includes('colombia fintech'),
      `R2 must not contain Colombia Fintech source-guided, got:\n${r2.join('\n')}`,
    );
  });

  it('FG6-a2: R2 does not contain ANDICOM (removed in v1.1)', () => {
    assert.ok(
      !joined.includes('andicom'),
      `R2 must not contain ANDICOM after v1.1 removal, got:\n${r2.join('\n')}`,
    );
  });

  it('FG6-b: R2 contains empresa software empresarial or implementador (replaced ANDICOM)', () => {
    assert.ok(
      joined.includes('software empresarial') || joined.includes('implementador'),
      `R2 must contain software empresarial or implementador source-guided, got:\n${r2.join('\n')}`,
    );
  });

  it('FG6-c: R2 total query count is 4 (SECOP query removed fix-p0)', () => {
    assert.equal(r2.length, 4);
  });
});
