/**
 * FEEDBACK 24-11 (FIGARANTIAS SAS, lote d546272c) — las empresas del buscador gratuito
 * de Colombia llegaban a revisión sin tamaño y el rescate con Claude no las miraba
 * (no traen `target_completeness`). Puro: cero E/S.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isFreeSourceUnknownSize, needsCandidateRescue } from '../rescue-batch';
import type { ClassifiableCandidateRow } from '../../classification-metadata';

const NOW = Date.parse('2026-11-24T15:00:00.000Z');

function row(overrides: Partial<ClassifiableCandidateRow> = {}): ClassifiableCandidateRow {
  return {
    id: 'c-figarantias',
    industry_id: 'c1000003-0000-4000-8000-000000000003',
    source_primary: 'public_source',
    name: 'FIGARANTIAS SAS',
    website: 'https://figarantias.com',
    domain: 'figarantias.com',
    country_code: 'CO',
    country: 'Colombia',
    status: 'needs_review',
    metadata: { dataset: 'co_siis_discovery', notes: 'Tamaño no confirmado — validar manualmente' },
    tax_identifier: '901255519',
    employee_count: null,
    ...overrides,
  };
}

describe('isFreeSourceUnknownSize', () => {
  it('la fila real de FIGARANTIAS (Colombia, sin tamaño) entra al rescate', () => {
    assert.equal(isFreeSourceUnknownSize(row()), true);
    assert.equal(needsCandidateRescue(row(), NOW), true);
  });

  it('no entra si ya tiene empleados conocidos', () => {
    assert.equal(isFreeSourceUnknownSize(row({ employee_count: 1200 })), false);
  });

  it('no entra si la fuente oficial del país ya midió el tamaño (Chile, Perú…)', () => {
    assert.equal(isFreeSourceUnknownSize(row({ country_code: 'CL' })), false);
    assert.equal(isFreeSourceUnknownSize(row({ country_code: 'PE' })), false);
  });

  it('no cambia nada para filas que no vienen del buscador gratuito', () => {
    assert.equal(isFreeSourceUnknownSize(row({ source_primary: 'web_ai' })), false);
    assert.equal(isFreeSourceUnknownSize(row({ metadata: { target_completeness: { failed_conditions: [] } } })), false);
  });

  it('sin web ni dominio no hay nada que revisar', () => {
    assert.equal(needsCandidateRescue(row({ website: null, domain: null }), NOW), false);
  });

  it('una ya rescatada no se vuelve a pagar', () => {
    const done = row({ metadata: { claude_rescue: { status: 'completed', decided_at: '2026-11-24T14:50:00.000Z' } } });
    assert.equal(needsCandidateRescue(done, NOW), false);
  });
});

describe('Prod 24-11 (EC, 732bc372) — tamaño pedido mayor que lo que mide la fuente oficial', () => {
  const ec = row({ name: 'ACERIAS NACIONALES DEL ECUADOR', country_code: 'EC', country: 'Ecuador', website: 'https://andecsa.com', domain: 'andecsa.com' });

  it('sin pedido explícito, Ecuador (100+ medido) no se revisa como antes', () => {
    assert.equal(isFreeSourceUnknownSize(ec), false);
    assert.equal(needsCandidateRescue(ec, NOW), false);
  });

  it('con «350 empleados o más», 100+ no alcanza: Claude la revisa', () => {
    assert.equal(isFreeSourceUnknownSize(ec, 350), true);
    assert.equal(needsCandidateRescue(ec, NOW, { requestedMinEmployees: 350 }), true);
  });

  it('un pedido de 200 o menos no cambia nada', () => {
    assert.equal(isFreeSourceUnknownSize(ec, 200), false);
  });
});
