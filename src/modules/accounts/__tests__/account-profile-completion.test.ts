import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHubSpotFillProperties,
  cleanCountryLabel,
  consensusCountryFromContacts,
  countryCodeFromDescription,
  countryCodeFromDomain,
  countryCodeFromPhone,
  macroIndustryFromHubSpotIndustry,
  missingProfileFields,
  planCountryCompletion,
} from '../account-profile-completion';

const NAMES: Record<string, string> = { bolivia: 'BO', 'méxico': 'MX', chile: 'CL' };
const CODES: Record<string, string> = { BO: 'Bolivia', MX: 'México', CL: 'Chile', CO: 'Colombia', CR: 'Costa Rica' };
const maps = {
  nameToCode: (name: string | null) => (name ? (NAMES[name.toLowerCase()] ?? null) : null),
  codeToName: (code: string | null) => (code ? (CODES[code] ?? null) : null),
};
const ACCOUNT = { domain: null, country: null, country_code: null, industry: null };

describe('qué le falta a una empresa', () => {
  it('país incompleto (sin nombre o sin código) e industria vacía', () => {
    assert.deepEqual(missingProfileFields(ACCOUNT), ['country', 'industry']);
    assert.deepEqual(missingProfileFields({ ...ACCOUNT, country: 'Chile', country_code: null, industry: 'Retail' }), ['country']);
    assert.deepEqual(missingProfileFields({ ...ACCOUNT, country: null, country_code: 'CL', industry: 'Retail' }), ['country']);
    assert.deepEqual(missingProfileFields({ ...ACCOUNT, country: 'Chile', country_code: 'CL', industry: 'Retail' }), []);
    assert.deepEqual(missingProfileFields({ ...ACCOUNT, country: ' ', country_code: 'CL', industry: '  ' }), ['country', 'industry']);
  });
});

describe('país por dominio', () => {
  it('dominios de país sí; genéricos y «.co» solo no', () => {
    assert.equal(countryCodeFromDomain('bupasalud.com.mx'), 'MX');
    assert.equal(countryCodeFromDomain('zener-austral.cl'), 'CL');
    assert.equal(countryCodeFromDomain('freshmarket.co.cr'), 'CR');
    assert.equal(countryCodeFromDomain('cinemark.com.co'), 'CO');
    assert.equal(countryCodeFromDomain('https://www.rentacomputo.com.co/'), 'CO');
    assert.equal(countryCodeFromDomain('startup.co'), null);
    assert.equal(countryCodeFromDomain('teamcore.com'), null);
    assert.equal(countryCodeFromDomain(null), null);
  });

  it('el nombre largo de HubSpot se limpia', () => {
    assert.equal(cleanCountryLabel('Bolivia (Estado Plurinacional de)'), 'Bolivia');
    assert.equal(cleanCountryLabel('  '), null);
  });
});

describe('plan de país', () => {
  it('con nombre y sin código: deduce el código del nombre', () => {
    assert.deepEqual(
      planCountryCompletion({ ...ACCOUNT, country: 'Bolivia (Estado Plurinacional de)' }, maps),
      { country: 'Bolivia', country_code: 'BO', source: 'existing_country_name' },
    );
  });

  it('con código y sin nombre: deduce el nombre del código', () => {
    assert.deepEqual(
      planCountryCompletion({ ...ACCOUNT, country_code: 'CL' }, maps),
      { country: 'Chile', country_code: 'CL', source: 'existing_country_code' },
    );
  });

  it('sin nada: usa el dominio; si es genérico, no adivina', () => {
    assert.deepEqual(
      planCountryCompletion({ ...ACCOUNT, domain: 'cocobongo.com.mx' }, maps),
      { country: 'México', country_code: 'MX', source: 'domain_tld' },
    );
    assert.equal(planCountryCompletion({ ...ACCOUNT, domain: 'teamcore.com' }, maps), null);
  });

  it('con nombre y código ya completos no hace nada; el dominio nunca pisa un país existente', () => {
    assert.equal(planCountryCompletion({ ...ACCOUNT, country: 'Chile', country_code: 'CL', domain: 'x.com.mx' }, maps), null);
    // «lbc.bo.co» dice Colombia por el final del dominio, pero la empresa ya dice Bolivia.
    assert.equal(planCountryCompletion({ ...ACCOUNT, country: 'Bolivia', domain: 'lbc.bo.co' }, maps)?.country_code, 'BO');
  });
});

describe('qué se escribe en HubSpot', () => {
  it('sólo propiedades vacías allá', () => {
    assert.deepEqual(
      buildHubSpotFillProperties({ current: {}, country: 'México', industry: 'Retail' }),
      { pais: 'México', country: 'México', industriaespecifica: 'Retail' },
    );
    assert.deepEqual(
      buildHubSpotFillProperties({
        current: { pais: 'Chile', country: null, industriaespecifica: 'Agroindustria' },
        country: 'México',
        industry: 'Retail',
      }),
      { country: 'México' },
    );
  });

  // AGENT1-COUNTRY-IDENTITY-1 — `pais` es una propiedad de HubSpot con valores
  // propios («Bolivia (Estado Plurinacional de)», «República Dominicana»); la
  // etiqueta de SellUp («Bolivia», «Rep. Dominicana») no es uno de ellos.
  it('`pais` recibe el valor interno de HubSpot cuando se conoce', () => {
    assert.deepEqual(
      buildHubSpotFillProperties({
        current: {},
        country: 'Rep. Dominicana',
        pais: 'República Dominicana',
        industry: null,
      }),
      { pais: 'República Dominicana', country: 'Rep. Dominicana' },
    );
    assert.deepEqual(
      buildHubSpotFillProperties({ current: {}, country: 'Bolivia', pais: null, industry: null }),
      { pais: 'Bolivia', country: 'Bolivia' },
    );
  });

  it('sin nada que escribir devuelve vacío', () => {
    assert.deepEqual(buildHubSpotFillProperties({ current: {}, country: null, industry: null }), {});
    assert.deepEqual(
      buildHubSpotFillProperties({ current: { pais: 'X', country: 'X', industriaespecifica: 'Y' }, country: 'México', industry: 'Retail' }),
      {},
    );
  });
});

describe('pistas de HubSpot', () => {
  it('prefijo telefónico: sólo con «+» o «00»; +1 no dice país; el más largo gana', () => {
    assert.equal(countryCodeFromPhone('+52 998 883 2373'), 'MX');
    assert.equal(countryCodeFromPhone('0057 1 555 5555'), 'CO');
    assert.equal(countryCodeFromPhone('+591 2 123456'), 'BO');
    assert.equal(countryCodeFromPhone('+1 212 555 0100'), null);
    assert.equal(countryCodeFromPhone('998 883 2373'), null);
    assert.equal(countryCodeFromPhone(null), null);
  });

  it('descripción: un solo país mencionado; varios o ninguno, no', () => {
    assert.equal(countryCodeFromDescription('Elifarma is a Peruvian pharmaceutical company committed to health.'), 'PE');
    assert.equal(countryCodeFromDescription('Empresa chilena de tecnología.'), 'CL');
    assert.equal(countryCodeFromDescription('Presente en México y Chile con clientes en toda la región.'), null);
    assert.equal(countryCodeFromDescription('A leading entertainment company.'), null);
    assert.equal(countryCodeFromDescription(null), null);
  });

  it('contactos: al menos dos y todos del mismo país', () => {
    const toCode = (name: string | null) => (name === 'Chile' ? 'CL' : name === 'México' ? 'MX' : null);
    assert.equal(consensusCountryFromContacts([{ country: 'Chile', phone: null }, { country: null, phone: '+56 2 1234' }], toCode), 'CL');
    assert.equal(consensusCountryFromContacts([{ country: 'Chile', phone: null }], toCode), null);
    assert.equal(consensusCountryFromContacts([{ country: 'Chile', phone: null }, { country: 'México', phone: null }], toCode), null);
  });

  it('industria estándar de HubSpot: sólo correspondencias claras', () => {
    assert.equal(macroIndustryFromHubSpotIndustry('PHARMACEUTICALS'), 'Salud & Farmacéuticos');
    assert.equal(macroIndustryFromHubSpotIndustry('retail'), 'Retail');
    assert.equal(macroIndustryFromHubSpotIndustry('ENTERTAINMENT'), null);
    assert.equal(macroIndustryFromHubSpotIndustry(null), null);
  });

  it('país con pistas: coinciden → se usa; se contradicen → no se adivina', () => {
    assert.deepEqual(
      planCountryCompletion({ ...ACCOUNT, domain: 'x.com' }, maps, { phone: 'MX', description: 'MX' }),
      { country: 'México', country_code: 'MX', source: 'hubspot_phone' },
    );
    assert.equal(planCountryCompletion({ ...ACCOUNT, domain: 'x.com.mx' }, maps, { phone: 'CL' }), null);
    assert.equal(planCountryCompletion({ ...ACCOUNT, country: 'Chile', country_code: 'CL' }, maps, { phone: 'MX' }), null);
  });
});
