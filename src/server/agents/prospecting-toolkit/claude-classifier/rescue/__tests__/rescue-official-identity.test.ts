/**
 * SOURCES-CL-RESCUE-OFFICIAL-IDENTITY-1 — lo que el rescate con Claude admite
 * busca su número fiscal oficial (Prod 06-10: Grifols Chile y Clínica Andes Salud
 * Concepción llegaron a revisión sin RUT). Cero E/S: la búsqueda es un doble.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  lookUpRescueOfficialIdentity,
  withRescueOfficialIdentity,
  type RescueOfficialIdentity,
  type RescueOfficialIdentityInput,
} from '../rescue-official-identity';

const GRIFOLS: RescueOfficialIdentity = {
  columns: { tax_identifier: '96582310-7', tax_identifier_type: 'RUT', legal_name: 'GRIFOLS CHILE S A', legal_status: null },
  metadata: { status: 'matched', sourceKey: 'cl_sii_registry' },
};

const INPUT = { name: 'Grifols Chile S.A.', website: 'https://grifols.com', domain: 'grifols.com', countryCode: 'CL', country: 'Chile' };

describe('lookUpRescueOfficialIdentity', () => {
  it('busca y devuelve la identidad fuerte', async () => {
    const asked: RescueOfficialIdentityInput[] = [];
    const out = await lookUpRescueOfficialIdentity(async (input) => (asked.push(input), GRIFOLS), INPUT);
    assert.deepEqual(out, GRIFOLS);
    assert.equal(asked[0].name, 'Grifols Chile S.A.');
    assert.equal(asked[0].countryCode, 'CL');
  });

  it('no busca sin resolvedor, sin nombre o si ya tiene número fiscal', async () => {
    let calls = 0;
    const resolve = async () => (calls++, GRIFOLS);
    assert.equal(await lookUpRescueOfficialIdentity(undefined, INPUT), null);
    assert.equal(await lookUpRescueOfficialIdentity(resolve, { ...INPUT, name: '  ' }), null);
    assert.equal(await lookUpRescueOfficialIdentity(resolve, { ...INPUT, existingTaxIdentifier: '96582310-7' }), null);
    assert.equal(calls, 0);
  });

  it('un error o una identidad sin número no rompen nada: null', async () => {
    assert.equal(
      await lookUpRescueOfficialIdentity(async () => {
        throw new Error('fuente caída');
      }, INPUT),
      null,
    );
    assert.equal(await lookUpRescueOfficialIdentity(async () => null, INPUT), null);
    assert.equal(
      await lookUpRescueOfficialIdentity(async () => ({ ...GRIFOLS, columns: { ...GRIFOLS.columns, tax_identifier: '' } }), INPUT),
      null,
    );
  });
});

describe('withRescueOfficialIdentity', () => {
  it('suma las columnas fiscales y la metadata de la fuente sin perder el resto', () => {
    const patch: { status: 'needs_review'; metadata: Record<string, unknown> } = {
      status: 'needs_review',
      metadata: { claude_rescue: { decision: 'admit' } },
    };
    const out = withRescueOfficialIdentity(patch, GRIFOLS) as typeof patch & Record<string, unknown>;
    assert.equal(out.tax_identifier, '96582310-7');
    assert.equal(out.tax_identifier_type, 'RUT');
    assert.equal(out.legal_name, 'GRIFOLS CHILE S A');
    assert.deepEqual(out.metadata.claude_rescue, { decision: 'admit' });
    assert.deepEqual(out.metadata.official_source_enrichment, GRIFOLS.metadata);
  });

  it('sin identidad, el cambio queda igual', () => {
    const patch = { metadata: { a: 1 } };
    assert.equal(withRescueOfficialIdentity(patch, null), patch);
  });
});
