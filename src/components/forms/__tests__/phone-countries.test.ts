/**
 * Los países de `PhoneInput` son los que SellUp ya maneja: salen del catálogo
 * de países de la aplicación (las opciones de país de los formularios de
 * empresa), no de una lista propia. Aquí solo vive la tabla ISO → prefijo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LATAM_COUNTRIES } from '../../../modules/accounts/types';
import { LATAM_COUNTRIES as PROSPECT_COUNTRIES } from '../../../modules/prospect-batches/types';
import { DEFAULT_PHONE_COUNTRY, DIALING, PHONE_COUNTRIES, findCountry, parseE164 } from '../phone-countries';

describe('PHONE_COUNTRIES — derivada del catálogo de países de SellUp', () => {
  it('son exactamente los países del catálogo, con su nombre y en su orden', () => {
    assert.deepEqual(
      PHONE_COUNTRIES.map((country) => [country.code, country.name]),
      LATAM_COUNTRIES.map((country) => [country.code, country.name]),
    );
  });

  it('🔴 ningún país del catálogo se queda sin prefijo (ni el de empresas ni el de prospectos)', () => {
    for (const country of [...LATAM_COUNTRIES, ...PROSPECT_COUNTRIES]) {
      assert.ok(DIALING[country.code], `falta el prefijo de ${country.code} (${country.name}) en DIALING`);
    }
  });

  it('la tabla de prefijos no trae países que SellUp no maneja', () => {
    const catalog = new Set(LATAM_COUNTRIES.map((country) => country.code));
    assert.deepEqual(Object.keys(DIALING).filter((code) => !catalog.has(code)), []);
  });

  it('cada país lleva prefijo con «+», bandera y un formato que cuadra con su longitud', () => {
    for (const country of PHONE_COUNTRIES) {
      assert.match(country.dialCode, /^\+\d{1,3}$/, country.code);
      assert.equal([...country.flag].length, 2, `${country.code}: bandera de dos indicadores regionales`);
      assert.equal(
        country.groups.reduce((sum, group) => sum + group, 0),
        country.length,
        `${country.code}: los grupos suman la longitud`,
      );
    }
    assert.equal(findCountry('CO').flag, '🇨🇴');
    assert.equal(findCountry('ES').flag, '🇪🇸');
  });

  it('el país por defecto es del catálogo', () => {
    assert.ok(PHONE_COUNTRIES.some((country) => country.code === DEFAULT_PHONE_COUNTRY));
  });

  it('los prefijos se siguen resolviendo: el más largo gana y «+1» respeta el país elegido', () => {
    assert.equal(parseE164('+573001234567').country?.code, 'CO');
    assert.equal(parseE164('+50622223333').country?.code, 'CR');
    assert.equal(parseE164('+18095551234', PHONE_COUNTRIES, 'US').country?.code, 'US');
    assert.equal(parseE164('+18095551234', PHONE_COUNTRIES, 'DO').country?.code, 'DO');
  });
});
