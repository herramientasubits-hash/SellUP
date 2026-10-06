/**
 * SOURCES-FREE-DISCARDS-KEEP-CUIT-1 — identidad fiscal de una fila de
 * Descartadas del buscador gratuito. Puro, sin E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fiscalIdentityFromDisposition } from '../fiscal-identity-from-disposition';

const FREE_AR = {
  sourcePrimary: 'public_source',
  providerIdentifier: 'tax:30685856715',
  evidence: {
    provider_raw_name: 'CAPGEMINI ARGENTINA S. A.',
    tax_identifier_present: true,
    tax_identifier_type: 'CUIT',
  },
};

describe('fiscalIdentityFromDisposition', () => {
  it('fila del buscador gratuito con CUIT → número, tipo y razón social', () => {
    assert.deepEqual(fiscalIdentityFromDisposition(FREE_AR), {
      tax_id: '30685856715',
      tax_identifier: '30685856715',
      tax_identifier_type: 'CUIT',
      legal_name: 'CAPGEMINI ARGENTINA S. A.',
    });
  });

  it('acepta los formatos de otros países (RUC de Paraguay con guion, EIN)', () => {
    assert.equal(
      fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'tax:80002201-7', evidence: { ...FREE_AR.evidence, tax_identifier_type: 'RUC' } }).tax_identifier,
      '80002201-7',
    );
    assert.equal(
      fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'tax:36-0698440', evidence: { ...FREE_AR.evidence, tax_identifier_type: 'EIN' } }).tax_identifier_type,
      'EIN',
    );
  });

  it('sin razón social igual copia el número', () => {
    const out = fiscalIdentityFromDisposition({ ...FREE_AR, evidence: { tax_identifier_present: true, tax_identifier_type: 'CUIT' } });
    assert.equal(out.tax_identifier, '30685856715');
    assert.equal('legal_name' in out, false);
  });

  it('nada para filas de proveedores de pago, aunque traigan los mismos campos', () => {
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, sourcePrimary: 'apollo' }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, sourcePrimary: null }), {});
  });

  it('nada si el identificador no es de grano fiscal (DENUE, dominio)', () => {
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'denue:12345' }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'domain:acme.com' }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: null }), {});
  });

  it('nada si la evidencia no declara presencia o el tipo no lo acepta la columna', () => {
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, evidence: { ...FREE_AR.evidence, tax_identifier_present: false } }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, evidence: { ...FREE_AR.evidence, tax_identifier_type: 'other' } }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, evidence: { ...FREE_AR.evidence, tax_identifier_type: 'DNI' } }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, evidence: null }), {});
  });

  it('nada si el número tiene forma imposible', () => {
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'tax:12' }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'tax:30685856715; drop' }), {});
    assert.deepEqual(fiscalIdentityFromDisposition({ ...FREE_AR, providerIdentifier: 'tax:' }), {});
  });
});
