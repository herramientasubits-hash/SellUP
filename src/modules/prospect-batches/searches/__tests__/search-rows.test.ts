import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  markBulkRounds,
  searchDisplayName,
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

describe('Búsquedas — las rondas de una búsqueda masiva (dueña 28-10)', () => {
  const bulk = {
    id: 'bulk-1',
    label: 'Búsqueda masiva · México · Seguros',
    status: 'running' as const,
    deliveredCount: 12,
    targetCount: 25,
    batchIds: ['r1', 'r2'],
  } as never;

  it('cada ronda sigue siendo su propia fila, con la forma y de qué masiva salió', () => {
    const rows = markBulkRounds([toSearchRow(batch({ id: 'r2' })), toSearchRow(batch({ id: 'otra' })), toSearchRow(batch({ id: 'r1' }))], [bulk]);
    assert.equal(rows.length, 3);
    const r2 = rows.find((row) => row.id === 'r2')!;
    assert.equal(r2.formLabel, 'Muchas empresas por criterios');
    assert.deepEqual(r2.bulkSearch, { id: 'bulk-1', label: 'Búsqueda masiva · México · Seguros', round: 2, status: 'running', deliveredCount: 12, targetCount: 25 });
    assert.equal(rows.find((row) => row.id === 'r1')!.bulkSearch!.round, 1);
  });

  it('una búsqueda normal no cambia', () => {
    const [other] = markBulkRounds([toSearchRow(batch({ id: 'otra' }))], [bulk]);
    assert.equal(other.bulkSearch, null);
    assert.notEqual(other.formLabel, 'Muchas empresas por criterios');
  });
});

describe('Búsquedas — el nombre, como lo nombramos en Rumbo (dueña 28-10)', () => {
  it('forma · país · industria, sin el nombre interno del lote', () => {
    assert.equal(
      searchDisplayName({
        formLabel: 'Empresas por criterios',
        country: 'México',
        industry: 'Seguros y Servicios Financieros',
        name: 'Agente 1 · Pipeline · México · Seguros y Servicios Financieros · 28 de oct de 2026',
      }),
      'Empresas por criterios · México · Seguros y Servicios Financieros',
    );
  });

  it('sin país ni industria, el nombre guardado sin la jerga ni la fecha', () => {
    assert.equal(
      searchDisplayName({ formLabel: 'Archivo importado', country: null, industry: null, name: 'Agente 1 · Pipeline · Lista de ferias · 28 de oct de 2026' }),
      'Lista de ferias',
    );
    assert.equal(searchDisplayName({ formLabel: 'Archivo importado', country: null, industry: null, name: 'Clientes 2025' }), 'Clientes 2025');
  });

  it('las rondas de una masiva se nombran con su forma y su ronda', () => {
    const bulk = { id: 'b', label: 'x', status: 'completed', deliveredCount: 30, targetCount: 25, batchIds: ['r1', 'r2'] } as never;
    const [row] = markBulkRounds([toSearchRow(batch({ id: 'r2', country: 'México', industry: 'Seguros' }))], [bulk]);
    assert.equal(row.name, 'Muchas empresas por criterios · México · Seguros · Ronda 2');
  });
});
