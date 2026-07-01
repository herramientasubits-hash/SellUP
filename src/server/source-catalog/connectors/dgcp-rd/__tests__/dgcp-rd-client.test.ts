/**
 * Tests unitarios — DGCP RD Client
 *
 * Sin red real. Prueba URL builders y extractors con fixtures locales.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildContratosUrl,
  buildProveedorByRpeUrl,
  extractContratos,
  extractProveedor,
  extractTotal,
  DGCP_BASE,
} from '../dgcp-rd-client';

describe('buildContratosUrl', () => {
  it('arma URL correcta con page y limit', () => {
    const url = buildContratosUrl({ page: 1, limit: 20 });
    assert.ok(url.startsWith(DGCP_BASE + '/contratos'));
    assert.ok(url.includes('page=1'));
    assert.ok(url.includes('limit=20'));
  });

  it('incluye year cuando se pasa', () => {
    const url = buildContratosUrl({ page: 1, limit: 5, year: 2026 });
    assert.ok(url.includes('year=2026'));
  });

  it('no incluye year cuando no se pasa', () => {
    const url = buildContratosUrl({ page: 1, limit: 5 });
    assert.ok(!url.includes('year='));
  });

  it('clampea limit al máximo', () => {
    const url = buildContratosUrl({ page: 1, limit: 99999 });
    assert.ok(url.includes('limit=1000'));
  });

  it('clampea page a mínimo 1', () => {
    const url = buildContratosUrl({ page: 0, limit: 5 });
    assert.ok(url.includes('page=1'));
  });
});

describe('buildProveedorByRpeUrl', () => {
  it('arma URL correcta para /proveedores?rpe=X', () => {
    const url = buildProveedorByRpeUrl('131399');
    assert.ok(url.startsWith(DGCP_BASE + '/proveedores'));
    assert.ok(url.includes('rpe=131399'));
  });

  it('acepta número como rpe', () => {
    const url = buildProveedorByRpeUrl(131399);
    assert.ok(url.includes('rpe=131399'));
  });
});

describe('extractContratos', () => {
  it('extrae desde data[]', () => {
    const body = {
      data: [
        {
          codigo_contrato: 'DFENS-2026-00084',
          codigo_proceso: 'DFENS-DAF-CM-2026-0019',
          rpe: '131399',
          razon_social: 'Debell Store, EIRL',
          fecha_adjudicacion: '2026-06-26',
          valor_contratado: 73000,
          divisa: 'DOP',
        },
      ],
    };
    const contratos = extractContratos(body);
    assert.equal(contratos.length, 1);
    assert.equal(contratos[0].rpe, '131399');
    assert.equal(contratos[0].valor_contratado, 73000);
  });

  it('retorna [] si no hay array reconocible', () => {
    const contratos = extractContratos({ message: 'not found' });
    assert.equal(contratos.length, 0);
  });

  it('descarta entradas null/no-objeto', () => {
    const body = { data: [null, { rpe: '123456789' }, 42] };
    const contratos = extractContratos(body as Record<string, unknown>);
    assert.equal(contratos.length, 1);
  });
});

describe('extractProveedor', () => {
  it('extrae proveedor desde array', () => {
    const fixture = [
      {
        rpe: '131399',
        razon_social: 'Debell Store, EIRL',
        tipo_documento: 'RNC',
        numero_documento: '132164148',
        estado: 'Activo',
        es_mipyme: true,
        clasificacion: 'Micro empresa',
        pais: 'REPÚBLICA DOMINICANA',
        region: 'OZAMA O METROPOLITANA',
        provincia: 'SANTO DOMINGO',
        municipio: 'SANTO DOMINGO ESTE',
      },
    ];
    const p = extractProveedor(fixture);
    assert.ok(p !== null);
    assert.equal(p?.rpe, '131399');
    assert.equal(p?.numero_documento, '132164148');
    assert.equal(p?.es_mipyme, true);
  });

  it('retorna null si body es vacío', () => {
    const p = extractProveedor([]);
    assert.equal(p, null);
  });

  it('extrae desde objeto directo', () => {
    const fixture = {
      rpe: '999888',
      razon_social: 'Empresa Test',
      tipo_documento: 'RNC',
      numero_documento: '123456789',
      estado: 'Activo',
    };
    const p = extractProveedor(fixture);
    assert.ok(p !== null);
    assert.equal(p?.numero_documento, '123456789');
  });
});

describe('extractTotal', () => {
  it('lee total top-level', () => {
    assert.equal(extractTotal({ total: 1234 }), 1234);
  });

  it('lee total desde pagination', () => {
    assert.equal(extractTotal({ pagination: { total: 999 } }), 999);
  });

  it('retorna null si no hay total', () => {
    assert.equal(extractTotal({}), null);
  });
});
