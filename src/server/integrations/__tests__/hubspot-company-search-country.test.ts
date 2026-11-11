import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { preferredHubSpotCompanyCountry } from '../hubspot-company-search';

describe('preferredHubSpotCompanyCountry — «País» de UBITS manda sobre `country` (11-11)', () => {
  it('Banco Unión: pais = República Dominicana, country = United States ⇒ República Dominicana', () => {
    assert.equal(
      preferredHubSpotCompanyCountry({ pais: 'República Dominicana', country: 'United States' }),
      'República Dominicana',
    );
  });
  it('sin pais (o vacío) usa country', () => {
    assert.equal(preferredHubSpotCompanyCountry({ pais: '  ', country: 'Colombia' }), 'Colombia');
    assert.equal(preferredHubSpotCompanyCountry({ country: 'Perú' }), 'Perú');
  });
  it('sin ninguno ⇒ null', () => {
    assert.equal(preferredHubSpotCompanyCountry({}), null);
    assert.equal(preferredHubSpotCompanyCountry(null), null);
  });
});
