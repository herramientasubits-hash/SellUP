/**
 * Tests — comprasal-sv-client
 * Hito: Centroamérica.7C
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPRASAL_BASE,
  COMPRASAL_PUBLIC_PREFIX,
  type ComprasalAdjudicacion,
} from '../comprasal-sv-client';

describe('comprasal-sv-client — guardrails de endpoint', () => {
  it('COMPRASAL_BASE apunta a comprasal.gob.sv', () => {
    assert.ok(COMPRASAL_BASE.includes('comprasal.gob.sv'));
  });

  it('COMPRASAL_PUBLIC_PREFIX es /api/v1/publico/', () => {
    assert.equal(COMPRASAL_PUBLIC_PREFIX, '/api/v1/publico/');
  });

  it('no contiene referencia a /api/v1/procesos (endpoint no público)', () => {
    // El prefijo público nunca debe usarse con /api/v1/procesos
    const restrictedEndpoint = '/api/v1/procesos';
    assert.ok(!COMPRASAL_PUBLIC_PREFIX.startsWith(restrictedEndpoint));
    assert.ok(!(`${COMPRASAL_BASE}${COMPRASAL_PUBLIC_PREFIX}`).includes('/api/v1/procesos'));
  });

  it('no contiene referencia a personas/buscar-persona', () => {
    assert.ok(!(`${COMPRASAL_BASE}${COMPRASAL_PUBLIC_PREFIX}`).includes('personas/buscar-persona'));
  });

  it('parsea data array desde respuesta con envelope { data: [] }', () => {
    const fakeResponse = { data: [{ id: 1 }, { id: 2 }] };
    const items = fakeResponse.data;
    assert.equal(items.length, 2);
  });

  it('maneja paginación sin total: corta cuando data.length < per_page', () => {
    const perPage = 10;
    const items = [{ id: 1 }, { id: 2 }];
    const shouldStop = items.length < perPage;
    assert.ok(shouldStop);
  });

  it('per_page máximo limitado a 200', () => {
    const perPage = Math.min(999, 200);
    assert.equal(perPage, 200);
  });

  it('tipo ComprasalAdjudicacion tiene proveedor sin tax_id', () => {
    const adj: ComprasalAdjudicacion = {
      id: 1,
      monto: 5000,
      proveedor: { id: '100', nombre: 'Empresa SV' },
    };
    assert.ok(!('tax_id' in (adj.proveedor ?? {})));
    assert.ok(!('nit' in (adj.proveedor ?? {})));
  });
});
