import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchFormLabel,
  searchListHref,
  searchReviewHref,
  summarizeSearches,
  toSearchRow,
} from '../search-rows';
import type { ProspectBatchWithMeta } from '../../types';

function batch(overrides: Partial<ProspectBatchWithMeta> & { visibility?: 'full' | 'assigned' } = {}) {
  return {
    id: 'b1',
    name: 'Colombia · Tecnología',
    status: 'ready_for_review',
    source: 'agent_1',
    country: 'CO',
    metadata: {},
    created_at: '2026-10-28T15:00:00.000Z',
    owner: null,
    created_by_user: { id: 'u1', full_name: 'Ana Ruiz' },
    total_candidates: 12,
    approved_count: 2,
    discarded_count: 1,
    converted_count: 3,
    needs_review_count: 6,
    duplicate_count: 0,
    ...overrides,
  } as ProspectBatchWithMeta & { visibility?: 'full' | 'assigned' };
}

describe('Búsquedas — la fila', () => {
  it('nombra la forma de Rumbo que se guardó en la búsqueda', () => {
    assert.equal(searchFormLabel('agent_1', { search_mode: 'corporate_tree' }), 'Árbol de una empresa');
    assert.equal(searchFormLabel('agent_1', { search_mode: 'competitors' }), 'Competidores de una empresa');
    assert.equal(searchFormLabel('agent_1', { search_mode: 'suppliers' }), 'Proveedores de una empresa');
    assert.equal(searchFormLabel('agent_1', {}), 'Empresas por criterios');
  });

  it('sin forma de Rumbo, dice de dónde vino', () => {
    assert.equal(searchFormLabel('imported', {}), 'Archivo importado');
    assert.equal(searchFormLabel('socrata_colombia', {}), 'Fuente oficial');
    assert.equal(searchFormLabel('manual', { search_mode: 'competitors' }), 'Creada a mano');
  });

  it('aprobadas cuenta las aprobadas y las ya creadas; contactos, sólo las creadas', () => {
    const row = toSearchRow(batch());
    assert.equal(row.approved, 5);
    assert.equal(row.converted, 3);
    assert.equal(row.needsReview, 6);
    assert.equal(row.createdBy, 'Ana Ruiz');
    assert.equal(row.statusLabel.length > 0, true);
  });

  it('una búsqueda ajena con empresas asignadas se marca como parcial', () => {
    assert.equal(toSearchRow(batch({ visibility: 'assigned' })).visibility, 'assigned');
    assert.equal(toSearchRow(batch()).visibility, 'full');
  });
});

describe('Búsquedas — el resumen y los enlaces', () => {
  it('las cifras de arriba salen de las mismas filas', () => {
    const rows = [toSearchRow(batch()), toSearchRow(batch({ id: 'b2', needs_review_count: 0, approved_count: 1, converted_count: 0 }))];
    assert.deepEqual(summarizeSearches(rows), { searches: 2, needsReview: 6, approved: 6, open: 1 });
  });

  it('«Ver búsqueda» lleva a Búsquedas y «Por revisar» filtra por la búsqueda', () => {
    assert.equal(searchListHref('b 1'), '/accounts?tab=busquedas&focus=b%201');
    assert.equal(searchReviewHref('b1'), '/accounts?tab=prospectos&sourceId=b1');
  });
});
