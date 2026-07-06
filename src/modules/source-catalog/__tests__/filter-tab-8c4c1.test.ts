/**
 * Tests: filterTab — regresión 8C.4C.1
 *
 * Verifica que snapshot_persisted aparece en Operativas IA.
 *
 * Historia del bug:
 *   - 8C.4C introdujo aiFlowStatus=snapshot_persisted en hn_contrataciones_abiertas
 *   - filterTab('operativas') no incluía snapshot_persisted en su whitelist
 *   - Patrón idéntico a: signal_connected_read_only (fix previo), dry_run_validated (fix previo)
 *
 * Hito: Centroamérica.8C.4C.1
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterTab } from '@/modules/source-catalog/filter-tab';
import type { FilterableSource } from '@/modules/source-catalog/filter-tab';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';

// ── Helpers ───────────────────────────────────────────────────────────────────

function source(overrides: Partial<FilterableSource> & Pick<FilterableSource, 'aiFlowStatus'>): FilterableSource {
  return {
    sellupUse: 'commercial_signal',
    connectionMode: 'read_only_snapshot',
    ...overrides,
  };
}

// ── 1. snapshot_persisted aparece en Operativas IA ────────────────────────────

describe('filterTab — snapshot_persisted en Operativas IA (8C.4C.1)', () => {
  it('snapshot_persisted con commercial_signal aparece en operativas', () => {
    const s = source({ aiFlowStatus: 'snapshot_persisted' });
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 1);
  });

  it('snapshot_persisted NO aparece en manuales (pertenece a operativas)', () => {
    const s = source({ aiFlowStatus: 'snapshot_persisted' });
    const result = filterTab([s], 'manuales');
    assert.strictEqual(result.length, 0);
  });

  it('snapshot_persisted aparece en todas', () => {
    const s = source({ aiFlowStatus: 'snapshot_persisted' });
    const result = filterTab([s], 'todas');
    assert.strictEqual(result.length, 1);
  });
});

// ── 2. hn_contrataciones_abiertas aparece en Operativas IA ───────────────────

describe('filterTab — hn_contrataciones_abiertas visibilidad real (8C.4C.1)', () => {
  const { sources } = getSourceCatalogViewModel();

  it('hn_contrataciones_abiertas aparece en tab operativas', () => {
    const operativas = filterTab(sources, 'operativas');
    assert.ok(
      operativas.some((s) => s.key === 'hn_contrataciones_abiertas'),
      'hn_contrataciones_abiertas debe aparecer en Operativas IA',
    );
  });

  it('hn_contrataciones_abiertas aparece en tab todas', () => {
    const todas = filterTab(sources, 'todas');
    assert.ok(todas.some((s) => s.key === 'hn_contrataciones_abiertas'));
  });

  it('hn_contrataciones_abiertas NO aparece en tab manuales', () => {
    const manuales = filterTab(sources, 'manuales');
    assert.ok(!manuales.some((s) => s.key === 'hn_contrataciones_abiertas'));
  });
});

// ── 3. snapshot_persisted filtrado por país Honduras ─────────────────────────

describe('filterTab — snapshot_persisted con filtro país Honduras (8C.4C.1)', () => {
  const { sources } = getSourceCatalogViewModel();

  it('fuentes HN con snapshot_persisted no desaparecen al filtrar operativas', () => {
    const hnSources = sources.filter((s) => s.countryCodes?.includes('HN'));
    const hnOperativas = filterTab(hnSources, 'operativas');
    assert.ok(
      hnOperativas.some((s) => s.aiFlowStatus === 'snapshot_persisted'),
      'Al menos una fuente HN con snapshot_persisted debe aparecer en operativas',
    );
  });
});

// ── 4. Regresión: estados previos siguen funcionando ─────────────────────────

describe('filterTab — regresión estados previos (8C.4C.1)', () => {
  it('dry_run_validated sigue apareciendo en operativas', () => {
    const s = source({ aiFlowStatus: 'dry_run_validated', connectionMode: 'not_persisted' });
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 1);
  });

  it('signal_connected_read_only sigue apareciendo en operativas', () => {
    const s = source({ aiFlowStatus: 'signal_connected_read_only', connectionMode: 'read_only_signal' });
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 1);
  });

  it('connected sigue apareciendo en operativas', () => {
    const s = source({ aiFlowStatus: 'connected', connectionMode: 'automatic_enrichment' });
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 1);
  });

  it('manual_only NO aparece en operativas', () => {
    const s = source({ aiFlowStatus: 'manual_only', connectionMode: 'not_connected' });
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 0);
  });

  it('technical_container excluido de operativas aunque tenga snapshot_persisted', () => {
    const s: FilterableSource = {
      sellupUse: 'technical_container',
      aiFlowStatus: 'snapshot_persisted',
      connectionMode: 'read_only_snapshot',
    };
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 0);
  });

  it('paused (no en whitelist) NO aparece en operativas', () => {
    const s = source({ aiFlowStatus: 'paused', connectionMode: 'not_connected' });
    const result = filterTab([s], 'operativas');
    assert.strictEqual(result.length, 0);
  });
});

// ── 5. hn_ccic y hn_ccit conservan su tratamiento ───────────────────────────

describe('filterTab — hn_ccic y hn_ccit no regresionaron (8C.4C.1)', () => {
  const { sources } = getSourceCatalogViewModel();

  it('hn_ccic existe en el catálogo', () => {
    assert.ok(sources.some((s) => s.key === 'hn_ccic'));
  });

  it('hn_ccit existe en el catálogo', () => {
    assert.ok(sources.some((s) => s.key === 'hn_ccit'));
  });

  it('hn_ccic aparece en tab todas', () => {
    const todas = filterTab(sources, 'todas');
    assert.ok(todas.some((s) => s.key === 'hn_ccic'));
  });

  it('hn_ccit aparece en tab todas', () => {
    const todas = filterTab(sources, 'todas');
    assert.ok(todas.some((s) => s.key === 'hn_ccit'));
  });
});
