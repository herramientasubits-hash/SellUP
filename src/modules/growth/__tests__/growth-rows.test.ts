/**
 * La vista de Growth nombra cada búsqueda por lo que es, sin piezas internas.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GROWTH_ORIGIN_LABELS, toGrowthSearchRow, toGrowthSummary } from '../growth-rows';
import type { ProspectBatchWithMeta } from '../../prospect-batches/types';

const batch = (over: Partial<ProspectBatchWithMeta> = {}): ProspectBatchWithMeta =>
  ({
    id: 'b1',
    name: 'Retail Colombia',
    source: 'agent_1',
    status: 'ready_for_review',
    country: 'Colombia',
    total_candidates: 25,
    needs_review_count: 7,
    approved_count: 3,
    converted_count: 2,
    created_at: '2026-10-20T15:00:00.000Z',
    created_by_user: { id: 'u', full_name: 'Ana Growth' },
    owner: null,
    ...over,
  }) as ProspectBatchWithMeta;

describe('filas de búsquedas de Growth', () => {
  it('ningún origen dice el nombre de un agente o de un proveedor', () => {
    for (const label of Object.values(GROWTH_ORIGIN_LABELS)) {
      assert.doesNotMatch(label, /Agente|Apollo|Lusha|Socrata|DENUE|Tavily|Claude/);
    }
  });

  it('traduce estado, origen y cifras', () => {
    const row = toGrowthSearchRow(batch());
    assert.equal(row.originLabel, 'Búsqueda con IA');
    assert.equal(row.statusLabel, 'Listo para revisión');
    assert.equal(row.statusTone, 'warning');
    assert.equal(row.needsReview, 7);
    assert.equal(row.approved, 5, 'aprobadas + convertidas');
    assert.equal(row.createdBy, 'Ana Growth');
  });

  it('el resumen cuenta las mismas búsquedas que la tabla', () => {
    const rows = [toGrowthSearchRow(batch()), toGrowthSearchRow(batch({ id: 'b2', needs_review_count: 4 }))];
    const summary = toGrowthSummary(
      { total: 2, ready_for_review: 1, in_review: 1, completed: 0, total_approved_candidates: 10 },
      rows,
    );
    assert.equal(summary.needsReview, 11);
    assert.equal(summary.inReview, 2);
  });
});
