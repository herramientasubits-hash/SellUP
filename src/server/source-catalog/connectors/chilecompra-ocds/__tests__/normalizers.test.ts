/**
 * Tests — ChileCompra OCDS Normalizers
 *
 * Fixtures locales únicamente — sin red, sin Supabase, sin writes.
 * Usa Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOcdsRelease,
  normalizeRut,
  resolveBuyer,
  resolveAward,
  collectUnspsc,
} from '../normalizers';
import type { OcdsRelease } from '../types';

function makeRelease(overrides: Partial<OcdsRelease> = {}): OcdsRelease {
  return {
    ocid: 'ocds-70d2nz-3955-1-LE25',
    tender: {
      id: '3955-1-LE25',
      title: 'Servicio de aseo municipal',
      description: 'Contratación de servicio de aseo y mantención.',
      status: 'active',
      value: { amount: 12_000_000, currency: 'CLP' },
      procurementMethod: 'open',
      tenderPeriod: { startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-20T00:00:00Z' },
      items: [
        { classification: { scheme: 'UNSPSC', id: '76111500', description: 'Servicios de limpieza' } },
      ],
    },
    parties: [
      {
        id: 'CL-MP-123',
        name: 'Municipalidad de Santiago',
        roles: ['buyer', 'procuringEntity'],
        identifier: { scheme: 'CL-RUT', id: '69.070.100-6' },
        address: { region: 'Región Metropolitana', countryName: 'Chile' },
        contactPoint: { name: 'Oficina de Partes', email: 'partes@muni.cl' },
      },
    ],
    buyer: { id: 'CL-MP-123', name: 'Municipalidad de Santiago' },
    awards: [],
    ...overrides,
  };
}

describe('normalizeRut', () => {
  it('conserva el formato original como string y crea normalized sin puntos', () => {
    const { rut, normalizedTaxId } = normalizeRut('69.070.100-6');
    assert.equal(rut, '69.070.100-6');
    assert.equal(normalizedTaxId, '69070100-6');
  });

  it('coacciona number a string (nunca number)', () => {
    const { rut } = normalizeRut(76123456);
    assert.equal(typeof rut, 'string');
    assert.equal(rut, '76123456');
  });

  it('devuelve null cuando falta', () => {
    assert.deepEqual(normalizeRut(undefined), { rut: null, normalizedTaxId: null });
  });
});

describe('normalizeOcdsRelease — release con buyer', () => {
  it('normaliza campos básicos y resuelve el comprador por rol', () => {
    const result = normalizeOcdsRelease(makeRelease(), 'https://mp.cl/tender/3955');
    assert.ok(result);
    assert.equal(result!.ocid, 'ocds-70d2nz-3955-1-LE25');
    assert.equal(result!.tender_title, 'Servicio de aseo municipal');
    assert.equal(result!.buyer_name, 'Municipalidad de Santiago');
    assert.equal(result!.buyer_rut, '69.070.100-6');
    assert.equal(result!.buyer_region, 'Región Metropolitana');
    assert.equal(result!.buyer_country, 'Chile');
    assert.equal(result!.tender_value_amount, 12_000_000);
    assert.equal(result!.tender_value_currency, 'CLP');
    assert.equal(result!.source_url, 'https://mp.cl/tender/3955');
  });

  it('buyer_country cae a CL cuando no hay countryName', () => {
    const release = makeRelease();
    release.parties![0].address = { region: 'Valparaíso' };
    const result = normalizeOcdsRelease(release);
    assert.equal(result!.buyer_country, 'CL');
  });

  it('descarta el item (null) cuando falta ocid', () => {
    const result = normalizeOcdsRelease(makeRelease({ ocid: null }));
    assert.equal(result, null);
  });

  it('RUT del comprador es string, nunca number', () => {
    const release = makeRelease();
    release.parties![0].identifier = { scheme: 'CL-RUT', id: 76543210 };
    const result = normalizeOcdsRelease(release);
    assert.equal(typeof result!.buyer_rut, 'string');
  });
});

describe('resolveAward', () => {
  it('resuelve supplier desde awards[].suppliers cuando existe', () => {
    const release = makeRelease({
      awards: [{ id: 'a1', status: 'active', suppliers: [{ id: 'SUP-1', name: 'Aseo Spa' }] }],
      parties: [
        ...makeRelease().parties!,
        { id: 'SUP-1', name: 'Aseo Spa', roles: ['supplier'], identifier: { scheme: 'CL-RUT', id: '77.888.999-0' } },
      ],
    });
    const award = resolveAward(release);
    assert.equal(award.status, 'active');
    assert.equal(award.supplierName, 'Aseo Spa');
    assert.equal(award.supplierRut, '77.888.999-0');
  });

  it('soporta ausencia de award (todo null)', () => {
    const award = resolveAward(makeRelease({ awards: [] }));
    assert.deepEqual(award, { status: null, supplierName: null, supplierRut: null });
  });
});

describe('normalizeOcdsRelease — resiliencia', () => {
  it('soporta ausencia de value', () => {
    const release = makeRelease();
    release.tender!.value = null;
    const result = normalizeOcdsRelease(release);
    assert.equal(result!.tender_value_amount, null);
    assert.equal(result!.tender_value_currency, null);
  });

  it('soporta items vacíos → UNSPSC vacío', () => {
    const release = makeRelease();
    release.tender!.items = [];
    const result = normalizeOcdsRelease(release);
    assert.deepEqual(result!.unspsc_codes, []);
    assert.deepEqual(result!.unspsc_descriptions, []);
  });
});

describe('collectUnspsc', () => {
  it('deduplica UNSPSC por código dentro del mismo proceso', () => {
    const release = makeRelease();
    release.tender!.items = [
      { classification: { scheme: 'UNSPSC', id: '76111500', description: 'Limpieza' } },
      { classification: { scheme: 'UNSPSC', id: '76111500', description: 'Limpieza (dup)' } },
      {
        classification: { scheme: 'UNSPSC', id: '72101500', description: 'Mantención' },
        additionalClassifications: [{ scheme: 'UNSPSC', id: '76111500', description: 'dup again' }],
      },
    ];
    const { codes, descriptions } = collectUnspsc(release);
    assert.deepEqual(codes, ['76111500', '72101500']);
    assert.equal(descriptions.length, 2);
  });
});

describe('resolveBuyer — contactPoint', () => {
  it('NO expone contactPoint como campo del proceso normalizado', () => {
    const result = normalizeOcdsRelease(makeRelease());
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'contactPoint'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'buyer_contact'), false);
  });

  it('resuelve por release.buyer.id cuando no hay rol buyer en parties', () => {
    const release = makeRelease();
    release.parties![0].roles = ['supplier'];
    const buyer = resolveBuyer(release);
    assert.equal(buyer.name, 'Municipalidad de Santiago');
  });
});
