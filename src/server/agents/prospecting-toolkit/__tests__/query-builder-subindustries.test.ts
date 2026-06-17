/**
 * Tests — Subindustry query injection (Hito 16AB.43.14)
 *
 * Verifica que las subindustrias resueltas desde el catálogo se incorporen
 * en las queries de discovery de buildCleanMultiQueryDiscoveryQueries y
 * buildExpandedMultiQueryDiscoveryQueries sin aumentar el total de queries
 * ni romper la compatibilidad con call sites sin subindustrias.
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCleanMultiQueryDiscoveryQueries,
  buildExpandedMultiQueryDiscoveryQueries,
} from '../query-builder';

// ── QB1: EdTech R1 Colombia ───────────────────────────────────────────────────

describe('QB1: EdTech subindustry in R1 Colombia/Tecnología', () => {
  const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);

  it('total query count is 5', () => {
    assert.equal(queries.length, 5);
  });

  it('first query contains EdTech term', () => {
    assert.ok(
      queries[0].toLowerCase().includes('edtech'),
      `Expected EdTech in first query, got: ${queries[0]}`,
    );
  });

  it('source-guided queries are preserved', () => {
    const joined = queries.join(' ');
    assert.ok(
      joined.toLowerCase().includes('fedesoft') || joined.toLowerCase().includes('colombia fintech'),
      'Source-guided queries (Fedesoft/ColombiaFintech) must be present',
    );
  });
});

// ── QB2: EdTech R2 Colombia — diferente de R1 ─────────────────────────────────

describe('QB2: EdTech subindustry in R2 Colombia/Tecnología — different from R1', () => {
  const r1 = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);
  const r2 = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);

  it('R2 total query count is 5', () => {
    assert.equal(r2.length, 5);
  });

  it('R2 first query contains EdTech term', () => {
    assert.ok(
      r2[0].toLowerCase().includes('edtech'),
      `Expected EdTech in first R2 query, got: ${r2[0]}`,
    );
  });

  it('R1 and R2 EdTech queries are different', () => {
    assert.notEqual(
      r1[0],
      r2[0],
      'R1 and R2 EdTech queries must use different vocabulary',
    );
  });

  it('R2 source-guided queries are preserved (ANDICOM/SECOP II)', () => {
    const joined = r2.join(' ');
    assert.ok(
      joined.toLowerCase().includes('andicom') || joined.toLowerCase().includes('secop'),
      'R2 source-guided queries (ANDICOM/SECOP) must be present',
    );
  });
});

// ── QB3: EdTech non-Colombia ──────────────────────────────────────────────────

describe('QB3: EdTech subindustry in non-Colombia Tech country', () => {
  const r1 = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'México', ['EdTech']);
  const r2 = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'México', ['EdTech']);

  it('R1 total count is 5', () => {
    assert.equal(r1.length, 5);
  });

  it('R2 total count is 5', () => {
    assert.equal(r2.length, 5);
  });

  it('R1 first query contains EdTech', () => {
    assert.ok(r1[0].toLowerCase().includes('edtech'));
  });

  it('R2 first query contains EdTech', () => {
    assert.ok(r2[0].toLowerCase().includes('edtech'));
  });
});

// ── QB4: Múltiples subindustrias — máximo 2 inyectadas ───────────────────────

describe('QB4: Multiple subindustries — max 2 injected', () => {
  const fiveSubindustries = ['EdTech', 'Fintech', 'SaaS', 'Ciberseguridad', 'Datos'];
  const r1 = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', fiveSubindustries);
  const r2 = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', fiveSubindustries);

  it('R1 total count stays at 5', () => {
    assert.equal(r1.length, 5);
  });

  it('R2 total count stays at 5', () => {
    assert.equal(r2.length, 5);
  });

  it('R1 first two queries contain subindustry terms', () => {
    assert.ok(
      r1[0].toLowerCase().includes('edtech'),
      `Query 0 must be EdTech, got: ${r1[0]}`,
    );
    assert.ok(
      r1[1].toLowerCase().includes('fintech') || r1[1].toLowerCase().includes('Fintech'),
      `Query 1 must be Fintech, got: ${r1[1]}`,
    );
  });
});

// ── QB5: Sin subindustrias — compatibilidad hacia atrás ──────────────────────

describe('QB5: No subindustries — backward compatibility', () => {
  it('R1 with no subindustries matches R1 without subindustries parameter', () => {
    const withUndefined = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', undefined);
    const withoutParam = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.deepEqual(withUndefined, withoutParam);
  });

  it('R2 with no subindustries matches R2 without subindustries parameter', () => {
    const withUndefined = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', undefined);
    const withoutParam = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.deepEqual(withUndefined, withoutParam);
  });

  it('R1 Colombia Tech without subindustries has 5 queries', () => {
    const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.equal(queries.length, 5);
  });
});

// ── QB6: Array vacío — mismo resultado que sin subindustrias ─────────────────

describe('QB6: Empty array treated as no subindustries', () => {
  it('R1 with empty array equals R1 without subindustries', () => {
    const withEmpty = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', []);
    const withoutParam = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.deepEqual(withEmpty, withoutParam);
  });

  it('R2 with empty array equals R2 without subindustries', () => {
    const withEmpty = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia', []);
    const withoutParam = buildExpandedMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.deepEqual(withEmpty, withoutParam);
  });
});

// ── QB7: Normalización — duplicados y cadenas vacías ignoradas ────────────────

describe('QB7: Duplicates and empty strings normalized', () => {
  it('duplicates produce same result as single entry', () => {
    const withDupes = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech', 'EdTech', 'EdTech']);
    const single = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);
    assert.deepEqual(withDupes, single);
  });

  it('empty strings are ignored', () => {
    const withEmpty = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['', 'EdTech', '']);
    const clean = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['EdTech']);
    assert.deepEqual(withEmpty, clean);
  });

  it('all-empty array treated as no subindustries', () => {
    const withAllEmpty = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['', '  ']);
    const withoutParam = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.deepEqual(withAllEmpty, withoutParam);
  });
});

// ── QB8: Nombres server-side canónicos usados tal cual ───────────────────────

describe('QB8: Server-side canonical subindustry names used verbatim', () => {
  it('canonical name "Fintech" appears in query', () => {
    const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia', ['Fintech']);
    assert.ok(
      queries[0].includes('Fintech'),
      `Expected "Fintech" in query, got: ${queries[0]}`,
    );
  });

  it('canonical name "Ciberseguridad" appears in query', () => {
    const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'México', ['Ciberseguridad']);
    assert.ok(
      queries[0].includes('Ciberseguridad'),
      `Expected "Ciberseguridad" in query, got: ${queries[0]}`,
    );
  });
});

// ── QB9: Total de queries nunca supera el original ────────────────────────────

describe('QB9: Query count never exceeds original count', () => {
  const industries = ['Tecnología', 'Manufactura', 'Salud', 'Logística'];
  const countries = ['Colombia', 'México', 'Chile'];

  for (const industry of industries) {
    for (const country of countries) {
      it(`R1 count with subindustries ≤ R1 count without — ${industry}/${country}`, () => {
        const baseline = buildCleanMultiQueryDiscoveryQueries(industry, country);
        const withSubs = buildCleanMultiQueryDiscoveryQueries(industry, country, ['EdTech', 'Fintech', 'SaaS']);
        assert.equal(withSubs.length, baseline.length);
      });

      it(`R2 count with subindustries ≤ R2 count without — ${industry}/${country}`, () => {
        const baseline = buildExpandedMultiQueryDiscoveryQueries(industry, country);
        const withSubs = buildExpandedMultiQueryDiscoveryQueries(industry, country, ['EdTech', 'Fintech', 'SaaS']);
        assert.equal(withSubs.length, baseline.length);
      });
    }
  }
});
