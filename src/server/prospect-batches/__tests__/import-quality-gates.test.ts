/**
 * Tests — AGENT1-IMPORT-PARITY-3: reglas de país, plataforma, dominio y tamaño
 * de Apollo/Lusha sobre filas importadas. Marcan, no descartan.
 *
 * Puro. Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateImportQualityGates, type ImportQualityGateInput } from '../import-quality-gates';
import {
  IMPORT_BELOW_ICP_SIZE_FLAG,
  IMPORT_COUNTRY_MISMATCH_FLAG,
  IMPORT_EXTERNAL_PLATFORM_FLAG,
  readImportReviewFlags,
} from '@/modules/prospect-batches/import-review-flags';
import { OWNERSHIP_UNVERIFIED_REVIEW_FLAG } from '@/modules/prospect-batches/ownership-review-flag';

function input(overrides: Partial<ImportQualityGateInput> = {}): ImportQualityGateInput {
  return {
    name: 'Bancolombia',
    website: 'https://www.bancolombia.com.co',
    domain: 'bancolombia.com.co',
    countryCode: 'CO',
    companySize: null,
    ...overrides,
  };
}

describe('evaluateImportQualityGates', () => {
  it('empresa colombiana con su dominio y tamaño grande → sin marcas', () => {
    const r = evaluateImportQualityGates(input({ companySize: '10001+' }));
    assert.deepEqual(r.reviewFlags, []);
  });

  it('sitio .com.mx con país Colombia → marca de país', () => {
    const r = evaluateImportQualityGates(
      input({ name: 'Bimbo', website: 'https://www.grupobimbo.com.mx', domain: 'grupobimbo.com.mx' }),
    );
    assert.ok(r.reviewFlags.includes(IMPORT_COUNTRY_MISMATCH_FLAG));
  });

  it('el mismo sitio .com.mx con país México → sin marca de país (multi-país)', () => {
    const r = evaluateImportQualityGates(
      input({ name: 'Grupo Bimbo', website: 'https://www.grupobimbo.com.mx', domain: 'grupobimbo.com.mx', countryCode: 'MX' }),
    );
    assert.equal(r.reviewFlags.includes(IMPORT_COUNTRY_MISMATCH_FLAG), false);
  });

  it('un perfil de LinkedIn como sitio web → marca de plataforma', () => {
    const r = evaluateImportQualityGates(
      input({ website: 'https://www.linkedin.com/company/bancolombia', domain: 'linkedin.com' }),
    );
    assert.ok(r.reviewFlags.includes(IMPORT_EXTERNAL_PLATFORM_FLAG));
  });

  it('un dominio que no corresponde al nombre → la MISMA marca de Lusha', () => {
    const r = evaluateImportQualityGates(
      input({ name: 'Constructora Andina', website: 'https://zeta-logistica.com', domain: 'zeta-logistica.com' }),
    );
    assert.ok(r.reviewFlags.includes(OWNERSHIP_UNVERIFIED_REVIEW_FLAG));
  });

  it('una universidad pública NO recibe marcas por ser universidad (son clientes UBITS)', () => {
    const r = evaluateImportQualityGates(
      input({ name: 'Universidad Nacional de Colombia', website: 'https://unal.edu.co', domain: 'unal.edu.co' }),
    );
    assert.equal(r.reviewFlags.includes(IMPORT_EXTERNAL_PLATFORM_FLAG), false);
    assert.equal(r.reviewFlags.includes(IMPORT_COUNTRY_MISMATCH_FLAG), false);
  });

  it('sin sitio web → no se evalúan país, plataforma ni dominio', () => {
    const r = evaluateImportQualityGates(input({ website: null, domain: null }));
    assert.deepEqual(r.reviewFlags, []);
    assert.equal('country_compatibility' in r.metadata, false);
    assert.equal('ownership' in r.metadata, false);
  });

  it('tamaño «50» → marca de tamaño; «200» no (umbral inclusivo)', () => {
    assert.ok(evaluateImportQualityGates(input({ companySize: '50' })).reviewFlags.includes(IMPORT_BELOW_ICP_SIZE_FLAG));
    assert.equal(evaluateImportQualityGates(input({ companySize: '200' })).reviewFlags.includes(IMPORT_BELOW_ICP_SIZE_FLAG), false);
  });

  it('rango «11-50» marca; «51-200» es ambiguo y NO marca; texto desconocido no marca', () => {
    assert.ok(evaluateImportQualityGates(input({ companySize: '11-50' })).reviewFlags.includes(IMPORT_BELOW_ICP_SIZE_FLAG));
    assert.equal(evaluateImportQualityGates(input({ companySize: '51-200' })).reviewFlags.includes(IMPORT_BELOW_ICP_SIZE_FLAG), false);
    assert.equal(evaluateImportQualityGates(input({ companySize: 'Grande' })).reviewFlags.includes(IMPORT_BELOW_ICP_SIZE_FLAG), false);
  });

  it('tamaño con separador de miles «1.500» se lee como 1500', () => {
    const r = evaluateImportQualityGates(input({ companySize: '1.500' }));
    assert.deepEqual(r.metadata.icp_size, { decision: 'pass', size_status: 'confirmed_above_threshold' });
  });
});

describe('readImportReviewFlags', () => {
  it('sólo devuelve marcas de importación, en orden estable', () => {
    assert.deepEqual(
      readImportReviewFlags([IMPORT_BELOW_ICP_SIZE_FLAG, 'ownership_unverified', IMPORT_COUNTRY_MISMATCH_FLAG]),
      [IMPORT_COUNTRY_MISMATCH_FLAG, IMPORT_BELOW_ICP_SIZE_FLAG],
    );
    assert.deepEqual(readImportReviewFlags(null), []);
  });
});
