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

  it('total query count is 4 (Colombia Fintech excluded for non-fintech subindustry)', () => {
    // 16AB.43.23: Colombia Fintech source-guided is omitted when EdTech (non-fintech) is
    // the only subindustry. 1 EdTech + 2 remaining base + 1 Fedesoft = 4.
    assert.equal(queries.length, 4);
  });

  it('first query contains EdTech term', () => {
    assert.ok(
      queries[0].toLowerCase().includes('edtech'),
      `Expected EdTech in first query, got: ${queries[0]}`,
    );
  });

  it('Fedesoft source-guided is preserved, Colombia Fintech is absent', () => {
    const joined = queries.join(' ').toLowerCase();
    assert.ok(
      joined.includes('fedesoft'),
      'Fedesoft source-guided must be present for Colombia/Tech',
    );
    assert.ok(
      !joined.includes('colombia fintech'),
      'Colombia Fintech must NOT appear when subindustry is EdTech (non-fintech)',
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

  it('R2 source-guided queries are preserved (empresa software empresarial or implementador)', () => {
    // v1.1: ANDICOM removido. R2 usa empresa software empresarial + implementador como source-guided.
    const joined = r2.join(' ');
    assert.ok(
      joined.toLowerCase().includes('software empresarial') || joined.toLowerCase().includes('implementador'),
      'R2 source-guided queries (software empresarial / implementador) must be present',
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

  it('R1 Colombia Tech without subindustries has 4 queries (Colombia Fintech excluida sin señal)', () => {
    // v1.1: Colombia Fintech requiere señal explícita (subindustria o criteria). Base = 4.
    const queries = buildCleanMultiQueryDiscoveryQueries('Tecnología', 'Colombia');
    assert.equal(queries.length, 4);
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

describe('QB9: Query count never exceeds original count (non-fintech subindustries)', () => {
  // v1.1: se usa ['EdTech', 'SaaS'] en lugar de ['EdTech', 'Fintech', 'SaaS'].
  // Fintech como subindustria activa Colombia Fintech source-guided y puede cambiar el count
  // en Colombia/Tecnología — ese comportamiento es correcto e intencional (ver CA4).
  // Este test verifica el invariante para subindustrias que NO activan el gating de fintech.
  const industries = ['Tecnología', 'Manufactura', 'Salud', 'Logística'];
  const countries = ['Colombia', 'México', 'Chile'];

  for (const industry of industries) {
    for (const country of countries) {
      it(`R1 count with non-fintech subindustries === R1 count without — ${industry}/${country}`, () => {
        const baseline = buildCleanMultiQueryDiscoveryQueries(industry, country);
        const withSubs = buildCleanMultiQueryDiscoveryQueries(industry, country, ['EdTech', 'SaaS']);
        assert.equal(withSubs.length, baseline.length);
      });

      it(`R2 count with non-fintech subindustries === R2 count without — ${industry}/${country}`, () => {
        const baseline = buildExpandedMultiQueryDiscoveryQueries(industry, country);
        const withSubs = buildExpandedMultiQueryDiscoveryQueries(industry, country, ['EdTech', 'SaaS']);
        assert.equal(withSubs.length, baseline.length);
      });
    }
  }
});
