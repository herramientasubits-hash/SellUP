/**
 * Tests — comprasal-sv-normalizer
 * Hito: Centroamérica.7C
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeAdjudicacion, normalizeSupplierName } from '../comprasal-sv-normalizer';
import type { ComprasalAdjudicacion } from '../comprasal-sv-client';

const makeAdj = (overrides: Partial<ComprasalAdjudicacion> = {}): ComprasalAdjudicacion => ({
  id: 455089,
  monto: 10960,
  proceso_compra: {
    id: 100,
    codigo_proceso: '2400-2026-P0327',
    nombre_proceso: 'Adquisición de materiales eléctricos',
    fecha_adjudicacion: '2026-07-02',
    id_forma_contratacion: 1,
  },
  institucion: { id: 10, codigo: '2400', nombre: 'Ministerio de Obras Públicas' },
  proveedor: {
    id: 50,
    id_proveedor: '186',
    nombre: 'Ingeniería Eléctrica y Civil, Sociedad Anónima de Capital Variable',
    nombre_comercial: 'INELCI S.A. DE C.V.',
  },
  ...overrides,
});

describe('comprasal-sv-normalizer', () => {
  it('no crea tax_id', () => {
    const result = normalizeAdjudicacion(makeAdj());
    assert.ok(result !== null);
    assert.equal(result.tax_id, null);
  });

  it('no crea normalized_tax_id', () => {
    const result = normalizeAdjudicacion(makeAdj());
    assert.ok(result !== null);
    assert.equal(result.normalized_tax_id, null);
  });

  it('conserva proveedor.id_proveedor como platform_id, no fiscal ID', () => {
    const result = normalizeAdjudicacion(makeAdj());
    assert.ok(result !== null);
    assert.equal(result.supplier_platform_id, '186');
    assert.equal(result.tax_id, null);
  });

  it('matching_mode = name_only_review_required', () => {
    const result = normalizeAdjudicacion(makeAdj());
    assert.ok(result !== null);
    assert.equal(result.matching_mode, 'name_only_review_required');
  });

  it('conserva nombre legal original', () => {
    const result = normalizeAdjudicacion(makeAdj());
    assert.ok(result !== null);
    assert.equal(
      result.supplier_name,
      'Ingeniería Eléctrica y Civil, Sociedad Anónima de Capital Variable',
    );
  });

  it('conserva nombre comercial original', () => {
    const result = normalizeAdjudicacion(makeAdj());
    assert.ok(result !== null);
    assert.equal(result.supplier_commercial_name, 'INELCI S.A. DE C.V.');
  });

  it('normaliza nombre para deduplicación (minúsculas, sin tildes, sin puntuación)', () => {
    const normalized = normalizeSupplierName(
      'Ingeniería Eléctrica y Civil, Sociedad Anónima de Capital Variable',
    );
    assert.ok(!normalized.includes('É'));
    assert.ok(!normalized.includes(','));
    assert.equal(normalized, normalized.toLowerCase());
  });

  it('retorna null si proveedor.nombre está vacío', () => {
    const result = normalizeAdjudicacion(makeAdj({ proveedor: { nombre: '' } }));
    assert.equal(result, null);
  });

  it('parsea monto numérico', () => {
    const result = normalizeAdjudicacion(makeAdj({ monto: 10960 }));
    assert.ok(result !== null);
    assert.equal(result.monto, 10960);
  });

  it('parsea monto string', () => {
    const result = normalizeAdjudicacion(makeAdj({ monto: '5000.50' as unknown as number }));
    assert.ok(result !== null);
    assert.ok(result.monto > 0);
  });
});
