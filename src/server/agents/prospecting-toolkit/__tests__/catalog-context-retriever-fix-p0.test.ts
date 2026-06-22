/**
 * Tests — Catalog Context Retriever source gating (Hito FIX-P0)
 *
 * Verifica que buildRecommendedSources() filtra correctamente fuentes
 * según aiFlowStatus y connectionMode.
 *
 * Puramente determinístico — sin I/O.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalogContext } from '../catalog-context-retriever';
import { CATALOG_SOURCES } from '../source-catalog';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getContext(industry: string, countryCode = 'CO') {
  return getCatalogContext({
    country: countryCode === 'CO' ? 'Colombia' : 'México',
    countryCode,
    industry,
    searchDepth: 'standard',
  });
}

function findSource(context: ReturnType<typeof getCatalogContext>, key: string) {
  return context.recommendedSources.find((s) => s.key === key);
}

// ─── Tests de filtrado por aiFlowStatus ──────────────────────────────────────

describe('CCR1 — Sources with paused aiFlowStatus are excluded', () => {
  const ctx = getContext('Tecnología');

  it('co_fedesoft (paused) is NOT in recommendedSources', () => {
    const src = findSource(ctx, 'co_fedesoft');
    assert.equal(src, undefined, 'co_fedesoft must be excluded from recommendedSources');
  });

  it('co_innpulsa (manual_only) is NOT in recommendedSources', () => {
    const src = findSource(ctx, 'co_innpulsa');
    assert.equal(src, undefined, 'co_innpulsa must be excluded from recommendedSources');
  });

  it('co_colombia_fintech (manual_only) is NOT in recommendedSources', () => {
    const src = findSource(ctx, 'co_colombia_fintech');
    assert.equal(src, undefined, 'co_colombia_fintech must be excluded from recommendedSources');
  });

  it('co_ruta_n (manual_only) is NOT in recommendedSources', () => {
    const src = findSource(ctx, 'co_ruta_n');
    assert.equal(src, undefined, 'co_ruta_n must be excluded from recommendedSources');
  });
});

describe('CCR2 — Sources with connectionMode not_connected are excluded', () => {
  const ctx = getContext('Tecnología');

  it('co_fedesoft (not_connected) is excluded', () => {
    const src = findSource(ctx, 'co_fedesoft');
    assert.equal(src, undefined);
  });

  it('co_secop2 (not_connected) is excluded', () => {
    const src = findSource(ctx, 'co_secop2');
    assert.equal(src, undefined, 'co_secop2 must be excluded');
  });

  it('co_colombia_digital (not_connected) is excluded', () => {
    const src = findSource(ctx, 'co_colombia_digital');
    assert.equal(src, undefined);
  });
});

describe('CCR3 — Connected sources are included', () => {
  const ctx = getContext('Tecnología');

  it('co_rues (connected, wizard_discovery) is included', () => {
    const src = findSource(ctx, 'co_rues');
    assert.notEqual(src, undefined, 'co_rues must be included');
    assert.equal(src!.aiFlowStatus, 'connected');
  });

  it('co_siis (connected, automatic_enrichment) is included', () => {
    const src = findSource(ctx, 'co_siis');
    assert.notEqual(src, undefined, 'co_siis must be included');
  });

  it('co_personas_juridicas_cc (connected) is included', () => {
    const src = findSource(ctx, 'co_personas_juridicas_cc');
    assert.notEqual(src, undefined, 'co_personas_juridicas_cc must be included');
  });

  it('co_secop2_proveedores (connected) is included', () => {
    const src = findSource(ctx, 'co_secop2_proveedores');
    assert.notEqual(src, undefined, 'co_secop2_proveedores must be included');
  });
});

describe('CCR4 — Colombia Tecnología: co_fedesoft and co_secop2 excluded', () => {
  const ctx = getContext('Tecnología');
  const keys = ctx.recommendedSources.map((s) => s.key);

  it('recommendedSources does not contain co_fedesoft', () => {
    assert.ok(!keys.includes('co_fedesoft'), `co_fedesoft found in ${keys.join(', ')}`);
  });

  it('recommendedSources does not contain co_secop2', () => {
    assert.ok(!keys.includes('co_secop2'), `co_secop2 found in ${keys.join(', ')}`);
  });

  it('recommendedSources may include co_rues, co_siis, co_personas_juridicas_cc, co_secop2_proveedores', () => {
    // These are connected sources that should be eligible
    const connected = keys.filter((k) =>
      ['co_rues', 'co_siis', 'co_personas_juridicas_cc', 'co_secop2_proveedores'].includes(k),
    );
    assert.ok(connected.length >= 2, `Expected at least 2 connected CO sources, got: ${keys.join(', ')}`);
  });
});

describe('CCR5 — Source catalog entries have expected operational status', () => {
  it('co_fedesoft has aiFlowStatus=paused and connectionMode=not_connected', () => {
    const src = CATALOG_SOURCES.find((s) => s.key === 'co_fedesoft');
    assert.ok(src);
    assert.equal(src!.aiFlowStatus, 'paused');
    assert.equal(src!.connectionMode, 'not_connected');
  });

  it('co_secop2 has aiFlowStatus=manual_only and connectionMode=not_connected', () => {
    const src = CATALOG_SOURCES.find((s) => s.key === 'co_secop2');
    assert.ok(src);
    assert.equal(src!.aiFlowStatus, 'manual_only');
    assert.equal(src!.connectionMode, 'not_connected');
  });

  it('co_rues has aiFlowStatus=connected', () => {
    const src = CATALOG_SOURCES.find((s) => s.key === 'co_rues');
    assert.ok(src);
    assert.equal(src!.aiFlowStatus, 'connected');
  });

  it('co_secop2_proveedores has aiFlowStatus=connected', () => {
    const src = CATALOG_SOURCES.find((s) => s.key === 'co_secop2_proveedores');
    assert.ok(src);
    assert.equal(src!.aiFlowStatus, 'connected');
  });
});
