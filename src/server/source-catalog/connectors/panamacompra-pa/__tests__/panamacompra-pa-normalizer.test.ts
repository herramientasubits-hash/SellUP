/**
 * Tests — PanamaCompra PA Normalizer
 * Hito: Centroamérica.5B
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizePanamaRuc,
  normalizeProveedorInfo,
  normalizeProveedorListing,
} from '../panamacompra-pa-normalizer';

describe('normalizePanamaRuc', () => {
  // Caso 14: preserva RUC original
  it('preserva RUC original con guiones', () => {
    const result = normalizePanamaRuc('8-123-456789');
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.original, '8-123-456789');
    }
  });

  // Caso 15: genera normalized_tax_id sin espacios
  it('genera normalized_tax_id removiendo espacios', () => {
    const result = normalizePanamaRuc(' 8-123-456789 ');
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.normalized, '8-123-456789');
    }
  });

  it('normalized_tax_id no tiene espacios internos', () => {
    const result = normalizePanamaRuc('8 - 123 - 456789');
    assert.ok(result.valid);
    if (result.valid) {
      // Sin espacios en el normalized
      assert.ok(!result.normalized.includes(' '));
    }
  });

  // Caso 16: no valida legalmente el RUC
  it('acepta RUC de formato atípico sin rechazarlo', () => {
    const result = normalizePanamaRuc('NT-1-2345');
    assert.ok(result.valid, 'RUC no estándar no debe ser rechazado — no es fuente de validación fiscal');
  });

  it('acepta RUC solo dígitos', () => {
    const result = normalizePanamaRuc('11524211565');
    assert.ok(result.valid);
    if (result.valid) {
      assert.equal(result.original, '11524211565');
    }
  });

  it('retorna valid=false con razón no_ruc cuando es null', () => {
    const result = normalizePanamaRuc(null);
    assert.ok(!result.valid);
    if (!result.valid) assert.equal(result.reason, 'no_ruc');
  });

  it('retorna valid=false con razón no_ruc cuando es undefined', () => {
    const result = normalizePanamaRuc(undefined);
    assert.ok(!result.valid);
  });

  it('retorna valid=false cuando es string vacío', () => {
    const result = normalizePanamaRuc('');
    assert.ok(!result.valid);
  });
});

describe('normalizeProveedorInfo', () => {
  it('normaliza proveedor con datos completos', () => {
    const info = {
      IdProveedor: 99,
      IdEmpresa: 50,
      nombreProveedor: 'PETROLEOS DELTA, S.A.',
      ruc: '11524-2-115657',
      direccion: 'Vía España, Ciudad de Panamá',
      nombreRepresentante: 'Juan Pérez',
      telefono: '507-123-4567',
      correo: 'info@delta.com.pa',
      sucursales: [{ provincia: 'Panamá', distrito: 'Panama' }],
    };

    const result = normalizeProveedorInfo(info);
    assert.ok(result.ok);
    if (!result.ok) return;

    assert.equal(result.provider.legalName, 'PETROLEOS DELTA, S.A.');
    assert.equal(result.provider.rucOriginal, '11524-2-115657');
    assert.equal(result.provider.normalizedTaxId, '11524-2-115657');
    assert.equal(result.provider.rucStatus, 'present');
    assert.equal(result.provider.representativeName, 'Juan Pérez');
    assert.equal(result.provider.phone, '507-123-4567');
    assert.equal(result.provider.email, 'info@delta.com.pa');
    assert.equal(result.provider.branches.length, 1);
    assert.equal(result.provider.branches[0]?.provincia, 'Panamá');
  });

  it('rucStatus=missing cuando no hay RUC', () => {
    const info = { nombreProveedor: 'EMPRESA SIN RUC' };
    const result = normalizeProveedorInfo(info);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.provider.rucStatus, 'missing');
    assert.equal(result.provider.rucOriginal, null);
    assert.equal(result.provider.normalizedTaxId, null);
  });

  it('retorna ok=false si no hay nombre', () => {
    const result = normalizeProveedorInfo({ ruc: '8-100-200' });
    assert.ok(!result.ok);
    if (!result.ok) assert.equal(result.reason, 'no_name');
  });

  it('extrae providerId y companyId', () => {
    const info = { IdProveedor: 42, IdEmpresa: 77, nombreProveedor: 'TEST SA', ruc: '1-2-3' };
    const result = normalizeProveedorInfo(info);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.provider.providerId, '42');
    assert.equal(result.provider.companyId, '77');
  });
});

describe('normalizeProveedorListing', () => {
  it('normaliza proveedor desde listado ligero', () => {
    const raw = {
      IdProveedor: 10,
      nombreProveedor: 'EMPRESA LISTING SA',
      ruc: '2-100-300',
    };
    const result = normalizeProveedorListing(raw);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.provider.legalName, 'EMPRESA LISTING SA');
    assert.equal(result.provider.rucOriginal, '2-100-300');
    assert.equal(result.provider.branches.length, 0);
  });

  it('branches=[] en listado ligero (sin detalle)', () => {
    const raw = { nombreProveedor: 'PROVEEDOR SA', ruc: '3-200-400' };
    const result = normalizeProveedorListing(raw);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(result.provider.branches, []);
  });
});
