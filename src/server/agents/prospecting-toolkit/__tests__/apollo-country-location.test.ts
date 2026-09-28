/**
 * AGENT1-APOLLO-COUNTRY-LOCATION-1 — cada país del mago se le nombra a Apollo
 * como Apollo lo documenta (inglés), por su código.
 *
 * Antes se enviaba el nombre en español: «México», «Perú», «Brasil», «Panamá»,
 * «Rep. Dominicana», «Estados Unidos» y «España» no son nombres documentados por
 * Apollo, y una búsqueda en esos países podía devolver 0 o ignorar el filtro.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_COUNTRY_LOCATION_BY_CODE,
  resolveApolloCountryLocation,
} from '../apollo-country-location';
import { LATAM_COUNTRIES } from '../../../../modules/prospect-batches/types';
import { buildApolloOrganizationsEffectiveRequest } from '../apollo-organizations-effective-request';
import type { WebSearchInput } from '../types';

function effectiveFor(country: { code: string; name: string }) {
  const input: WebSearchInput = {
    query: 'hipótesis',
    country: country.name,
    countryCode: country.code,
    industry: 'Retail y Consumo',
    intent: 'company_discovery',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: ['Supermercados e Hipermercados'],
    additionalCriteriaTokens: ['supermercado'],
  };
  return buildApolloOrganizationsEffectiveRequest({
    input,
    requestedMaxResults: 5,
    resultLimitMode: 'two_round',
    twoRoundMaxResultsPerRound: 5,
    startPage: 1,
    legacyMaxResultsPerQuery: 3,
  });
}

describe('§ 1 — la tabla', () => {
  it('🔴 todo país que ofrece el mago tiene su nombre para Apollo', () => {
    for (const country of LATAM_COUNTRIES) {
      assert.ok(
        APOLLO_COUNTRY_LOCATION_BY_CODE[country.code],
        `${country.code} sin nombre para Apollo`,
      );
    }
  });

  it('los siete que cambian se envían en inglés', () => {
    const expected: Record<string, string> = {
      MX: 'Mexico',
      PE: 'Peru',
      BR: 'Brazil',
      PA: 'Panama',
      DO: 'Dominican Republic',
      US: 'United States',
      ES: 'Spain',
    };
    for (const [code, name] of Object.entries(expected)) {
      assert.equal(resolveApolloCountryLocation(code, 'cualquier nombre'), name);
    }
  });

  it('ningún valor lleva tildes ni abreviaturas', () => {
    for (const value of Object.values(APOLLO_COUNTRY_LOCATION_BY_CODE)) {
      assert.match(value, /^[A-Za-z ]+$/, value);
    }
  });

  it('el código manda sobre el nombre, y no distingue mayúsculas', () => {
    assert.equal(resolveApolloCountryLocation('mx', 'México'), 'Mexico');
    assert.equal(resolveApolloCountryLocation(' ES ', 'España'), 'Spain');
  });

  it('código desconocido o ausente ⇒ el comportamiento anterior (el nombre recortado)', () => {
    assert.equal(resolveApolloCountryLocation('ZZ', ' Narnia '), 'Narnia');
    assert.equal(resolveApolloCountryLocation(null, 'Colombia'), 'Colombia');
    assert.equal(resolveApolloCountryLocation(undefined, '  '), null);
  });
});

describe('§ 2 — lo que sale hacia Apollo', () => {
  it('🔴 México viaja como «Mexico», no «México»', () => {
    const e = effectiveFor({ code: 'MX', name: 'México' });
    assert.deepEqual(e.body.organization_locations, ['Mexico']);
  });

  it('🔴 Colombia no cambia ni un byte: mismo body y misma huella que antes', () => {
    const e = effectiveFor({ code: 'CO', name: 'Colombia' });
    assert.deepEqual(e.body.organization_locations, ['Colombia']);
    assert.match(e.filtersFingerprint, /organization_locations=colombia(\||$)/);
  });

  it('cada país del mago produce una ubicación en inglés en el body', () => {
    for (const country of LATAM_COUNTRIES) {
      const e = effectiveFor(country);
      assert.deepEqual(
        e.body.organization_locations,
        [APOLLO_COUNTRY_LOCATION_BY_CODE[country.code]],
        country.code,
      );
    }
  });
});
