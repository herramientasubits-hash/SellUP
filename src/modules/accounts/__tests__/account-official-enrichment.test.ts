import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialEnrichmentPatch, needsOfficialEnrichment } from '../account-official-enrichment';

const EMPTY = { tax_identifier: null, tax_identifier_type: null, legal_name: null, company_size: null };
const STRONG = {
  strongIdentityAvailable: true,
  typedColumns: { tax_identifier: '900123456', tax_identifier_type: 'NIT', legal_name: 'EMPRESA S.A.S.' },
  metadata: { workforce: { workers: 320 } },
};

describe('completado con fuentes oficiales', () => {
  it('sin país no se consulta nada; con algo vacío sí', () => {
    assert.equal(needsOfficialEnrichment({ ...EMPTY, country_code: null }), false);
    assert.equal(needsOfficialEnrichment({ ...EMPTY, country_code: 'CO' }), true);
    assert.equal(
      needsOfficialEnrichment({ tax_identifier: '1', tax_identifier_type: 'NIT', legal_name: 'X', company_size: '10', country_code: 'CO' }),
      false,
    );
  });

  it('identidad fuerte: llena NIT, tipo, razón social y tamaño', () => {
    assert.deepEqual(buildOfficialEnrichmentPatch(EMPTY, STRONG), {
      tax_identifier: '900123456',
      tax_identifier_type: 'NIT',
      legal_name: 'EMPRESA S.A.S.',
      company_size: '320',
    });
  });

  it('identidad débil o ausente: no escribe nada', () => {
    assert.deepEqual(buildOfficialEnrichmentPatch(EMPTY, { ...STRONG, strongIdentityAvailable: false }), {});
    assert.deepEqual(buildOfficialEnrichmentPatch(EMPTY, null), {});
  });

  it('nunca pisa lo que la empresa ya tiene (ni el tipo de un NIT ajeno)', () => {
    assert.deepEqual(
      buildOfficialEnrichmentPatch({ tax_identifier: '800', tax_identifier_type: null, legal_name: null, company_size: '50' }, STRONG),
      { legal_name: 'EMPRESA S.A.S.' },
    );
  });
});
