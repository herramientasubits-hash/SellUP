import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountFillPatch,
  decideAccountOwner,
  mapHubSpotCompanyProfile,
} from '../hubspot-company-profile-mapping';

const toCode = (country: string | null): string | null =>
  country === 'Colombia' ? 'CO' : country === 'México' ? 'MX' : null;

describe('mapHubSpotCompanyProfile', () => {
  it('traduce la ficha completa de HubSpot a columnas de SellUp', () => {
    const mapped = mapHubSpotCompanyProfile(
      {
        name: 'Galderma',
        domain: 'www.Galderma.com',
        website: 'https://www.galderma.com',
        pais: 'Colombia',
        country: 'Colombia',
        city: 'Bogotá',
        state: 'Cundinamarca',
        industriaespecifica: 'Salud & Farmacéuticos',
        numberofemployees: '825',
        identificaci_n_fiscal: '900123456',
        hubspot_owner_id: '777',
        owneremail: 'Vendedora@UBITS.co',
        linkedin_company_page: 'https://linkedin.com/company/galderma',
      },
      toCode,
    );

    assert.deepEqual(mapped.fields, {
      name: 'Galderma',
      domain: 'galderma.com',
      website: 'https://www.galderma.com',
      country: 'Colombia',
      country_code: 'CO',
      city: 'Bogotá',
      region: 'Cundinamarca',
      industry: 'Salud & Farmacéuticos',
      company_size: '825',
      tax_identifier: '900123456',
      linkedin_url: 'https://linkedin.com/company/galderma',
    });
    assert.equal(mapped.hubspotOwnerId, '777');
    assert.equal(mapped.hubspotOwnerEmail, 'vendedora@ubits.co');
  });

  it('sólo acepta la macro industria del catálogo de 12, nunca un valor libre', () => {
    const mapped = mapHubSpotCompanyProfile({ industriaespecifica: 'Cosas varias' }, toCode);
    assert.equal(mapped.fields.industry, null);
  });

  it('usa el código de HubSpot si el nombre no está en el mapa, y RFC cuando no hay identificación fiscal', () => {
    const mapped = mapHubSpotCompanyProfile(
      { hs_country_code: 'mx', country: 'Mexico', rfc_mx_: 'ABC010101AAA', numberofemployees: '1.300' },
      toCode,
    );
    assert.equal(mapped.fields.country_code, 'MX');
    assert.equal(mapped.fields.tax_identifier, 'ABC010101AAA');
    assert.equal(mapped.fields.company_size, '1300');
  });

  it('el código sale del mismo país que se guarda, aunque HubSpot diga otro (Sencia: Colombia + IN)', () => {
    const mapped = mapHubSpotCompanyProfile({ pais: 'Colombia', country: 'India', hs_country_code: 'IN' }, toCode);
    assert.equal(mapped.fields.country, 'Colombia');
    assert.equal(mapped.fields.country_code, 'CO');
  });

  it('sin nombre de país, el código de HubSpot sigue sirviendo', () => {
    assert.equal(mapHubSpotCompanyProfile({ hs_country_code: 'co' }, toCode).fields.country_code, 'CO');
  });

  it('una ficha vacía no inventa datos', () => {
    const mapped = mapHubSpotCompanyProfile({ numberofemployees: '0', domain: '  ' }, toCode);
    assert.equal(mapped.fields.company_size, null);
    assert.equal(mapped.fields.domain, null);
    assert.equal(mapped.fields.website, null);
    assert.equal(mapped.hubspotOwnerId, null);
  });
});

describe('buildAccountFillPatch', () => {
  const fields = mapHubSpotCompanyProfile(
    { industriaespecifica: 'Tecnología', numberofemployees: '50', pais: 'Colombia', domain: 'nuevo.com' },
    toCode,
  ).fields;

  it('completa sólo lo vacío y nunca pisa lo que SellUp ya tiene', () => {
    const patch = buildAccountFillPatch(
      { industry: null, company_size: '', country: 'Colombia', country_code: null, domain: 'viejo.com' },
      fields,
    );
    assert.deepEqual(patch, { industry: 'Tecnología', company_size: '50', country_code: 'CO', website: 'https://nuevo.com' });
  });

  it('no completa el código si SellUp ya tiene otro país', () => {
    const patch = buildAccountFillPatch({ country: 'Perú', country_code: null }, fields);
    assert.equal(patch.country_code, undefined);
  });

  it('no completa el país si SellUp ya tiene otro código', () => {
    const patch = buildAccountFillPatch({ country: null, country_code: 'MX' }, fields);
    assert.equal(patch.country, undefined);
  });

  it('completa el código cuando el país es el mismo, con o sin tildes', () => {
    const mx = mapHubSpotCompanyProfile({ pais: 'México' }, toCode).fields;
    assert.equal(buildAccountFillPatch({ country: 'mexico', country_code: null }, mx).country_code, 'MX');
    assert.equal(buildAccountFillPatch({ country: null, country_code: 'mx' }, mx).country, 'México');
  });

  it('sin nada que completar devuelve un parche vacío', () => {
    assert.deepEqual(buildAccountFillPatch({ industry: 'Retail' }, { ...fields, industry: 'Tecnología', company_size: null, country: null, country_code: null, domain: null, website: null }), {});
  });
});

describe('decideAccountOwner', () => {
  it('manda el dueño de HubSpot cuando es usuario de SellUp', () => {
    assert.deepEqual(decideAccountOwner({ hubspotOwnerUserId: 'u-hs', searcherUserId: 'u-busca' }), {
      ownerId: 'u-hs',
      source: 'hubspot_owner',
    });
  });

  it('sin dueño en HubSpot, el responsable es quien buscó', () => {
    assert.deepEqual(decideAccountOwner({ hubspotOwnerUserId: null, searcherUserId: 'u-busca' }), {
      ownerId: 'u-busca',
      source: 'searcher',
    });
  });

  it('sin ninguno, queda sin responsable', () => {
    assert.deepEqual(decideAccountOwner({ hubspotOwnerUserId: null, searcherUserId: null }), {
      ownerId: null,
      source: null,
    });
  });
});
