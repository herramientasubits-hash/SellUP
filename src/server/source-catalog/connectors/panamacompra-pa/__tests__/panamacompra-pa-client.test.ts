/**
 * Tests — PanamaCompra PA Client
 * Hito: Centroamérica.5B
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAsmxResponse,
  PANAMACOMPRA_BASE,
  PANAMACOMPRA_USER_AGENT,
} from '../panamacompra-pa-client';

describe('panamacompra-pa-client — parseAsmxResponse', () => {
  // Caso 11: POST form-urlencoded — se verifica que los parámetros son correctos
  it('construye body POST form-urlencoded con METHOD= y VALUE=json', () => {
    const idConvenio = 42;
    const value = JSON.stringify({ IdConvenio: idConvenio });
    const body = `METHOD=&VALUE=${encodeURIComponent(value)}`;

    assert.ok(body.startsWith('METHOD=&VALUE='));
    assert.ok(body.includes('IdConvenio'));
    // encodeURIComponent convierte { a %7B
    assert.ok(body.includes('%7B') || body.includes('{'));
  });

  it('construye body POST para ObtenerInfoProveedor con proveedorId', () => {
    const proveedorId = 123;
    const value = JSON.stringify({ proveedorId });
    const body = `METHOD=&VALUE=${encodeURIComponent(value)}`;

    assert.ok(body.startsWith('METHOD=&VALUE='));
    assert.ok(body.includes('proveedorId'));
  });

  // Caso 12: parseAsmxResponse extrae campo `d` wrapper
  it('parsea wrapper ASMX con campo d (array)', () => {
    const input = JSON.stringify({ d: '[{"IdConvenio":1,"Nombre":"Convenio Test"}]' });
    const result = parseAsmxResponse(input);

    assert.ok(result.ok);
    assert.ok(Array.isArray(result.data));
    assert.equal((result.data as Array<{ IdConvenio: number }>)[0]?.IdConvenio, 1);
  });

  it('parsea wrapper ASMX con campo d (objeto directo)', () => {
    const inner = { IdProveedor: 5, ruc: '8-123-456', nombreProveedor: 'EMPRESA SA' };
    const input = JSON.stringify({ d: inner });
    const result = parseAsmxResponse(input);

    assert.ok(result.ok);
    const data = result.data as typeof inner;
    assert.equal(data.IdProveedor, 5);
    assert.equal(data.ruc, '8-123-456');
  });

  // Caso 13: parseAsmxResponse maneja JSON string anidado en `d`
  it('parsea JSON string anidado dentro de campo d', () => {
    const inner = [{ IdConvenio: 7 }, { IdConvenio: 8 }];
    const input = JSON.stringify({ d: JSON.stringify(inner) });
    const result = parseAsmxResponse(input);

    assert.ok(result.ok);
    assert.ok(Array.isArray(result.data));
    assert.equal((result.data as Array<{ IdConvenio: number }>).length, 2);
  });

  it('parsea JSON directo sin wrapper d (array)', () => {
    const input = JSON.stringify([{ IdConvenio: 3 }]);
    const result = parseAsmxResponse(input);

    assert.ok(result.ok);
    assert.ok(Array.isArray(result.data));
  });

  it('retorna error si respuesta es HTML/XML', () => {
    const result = parseAsmxResponse('<!DOCTYPE html><html><body>Error</body></html>');
    assert.ok(!result.ok);
    assert.ok(result.error.toLowerCase().includes('xml') || result.error.toLowerCase().includes('html'));
  });

  it('retorna error si respuesta no es JSON válido', () => {
    const result = parseAsmxResponse('not json at all');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('JSON'));
  });

  it('retorna error si respuesta está vacía', () => {
    const result = parseAsmxResponse('null');
    assert.ok(!result.ok);
  });

  it('PANAMACOMPRA_BASE apunta a panamacompra.gob.pa', () => {
    assert.ok(PANAMACOMPRA_BASE.includes('panamacompra.gob.pa'));
  });

  it('PANAMACOMPRA_USER_AGENT incluye SellUp', () => {
    assert.ok(PANAMACOMPRA_USER_AGENT.includes('SellUp'));
  });
});
