/**
 * AGENT1-COUNTRY-IDENTITY-1 — piezas comunes que seguían afinadas a Colombia
 * (auditoría de los 20 países del 16-10-2026).
 *
 *   § 1 · LinkedIn lleva el país como señal blanda en los 20 países del mago;
 *   § 2 · los segundos niveles de Costa Rica se quitan al inferir el nombre;
 *   § 3 · el nombre de país de HubSpot o de SellUp se traduce a su código.
 *
 * Puro: sin red, sin env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LATAM_COUNTRIES } from '../../../../modules/prospect-batches/types';
import { mapCountryToCode } from '../../contact-enrichment-toolkit/company-resolver-core';
import { stripDomainSuffix } from '../company-name-normalizer';
import { buildLinkedInSearchQuery } from '../linkedin-company-search';

describe('§ 1 — LinkedIn: señal de país en los 20 países', () => {
  for (const country of LATAM_COUNTRIES) {
    it(`${country.code} añade un término de país a la consulta`, () => {
      const query = buildLinkedInSearchQuery('Acme', null, { countryCode: country.code });
      assert.notEqual(query, 'site:linkedin.com/company "Acme"');
    });
  }

  it('Brasil y República Dominicana usan el nombre en inglés de LinkedIn', () => {
    assert.equal(buildLinkedInSearchQuery('Acme', null, { countryCode: 'BR' }), 'site:linkedin.com/company "Acme" Brazil');
    assert.equal(
      buildLinkedInSearchQuery('Acme', null, { countryCode: 'DO' }),
      'site:linkedin.com/company "Acme" Dominican Republic',
    );
  });
});

describe('§ 2 — segundos niveles de Costa Rica', () => {
  for (const [host, expected] of [
    ['mep.go.cr', 'mep'],
    ['www.tse.go.cr', 'tse'],
    ['bncr.fi.cr', 'bncr'],
    ['crhoy.or.cr', 'crhoy'],
    ['colegio.ed.cr', 'colegio'],
    ['ucr.ac.cr', 'ucr'],
    ['acme.co.cr', 'acme'],
  ] as const) {
    it(`${host} ⇒ ${expected}`, () => {
      assert.equal(stripDomainSuffix(host), expected);
    });
  }

  it('fuera de un ccTLD el segundo nivel no se toca (`a.go.com` ⇒ `a.go`)', () => {
    assert.equal(stripDomainSuffix('a.go.com'), 'a.go');
  });
});

describe('§ 3 — nombre de país ⇒ código', () => {
  for (const [label, code] of [
    ['Rep. Dominicana', 'DO'],
    ['República Dominicana', 'DO'],
    ['Bolivia (Estado Plurinacional de)', 'BO'],
    ['Bolivia', 'BO'],
    ['USA', 'US'],
    ['EE. UU.', 'US'],
    ['EEUU', 'US'],
    ['United States of America', 'US'],
    ['Espana', 'ES'],
    ['España', 'ES'],
    ['Perú', 'PE'],
    ['  México ', 'MX'],
    ['Panamá', 'PA'],
  ] as const) {
    it(`«${label}» ⇒ ${code}`, () => {
      assert.equal(mapCountryToCode(label), code);
    });
  }

  it('todas las etiquetas del asistente se traducen a su propio código', () => {
    for (const country of LATAM_COUNTRIES) {
      assert.equal(mapCountryToCode(country.name), country.code, country.name);
    }
  });

  it('un país desconocido sigue devolviendo null', () => {
    assert.equal(mapCountryToCode('Narnia'), null);
    assert.equal(mapCountryToCode(''), null);
  });
});
