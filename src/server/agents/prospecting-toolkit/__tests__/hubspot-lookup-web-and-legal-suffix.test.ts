/**
 * FEEDBACK 24-11 (FIGARANTIAS SAS) — HubSpot tenía la empresa (figarantias.com, 12
 * empleados) y SellUp la dio por nueva: el buscador gratuito pasaba la WEB
 * («https://figarantias.com») como dominio y el nombre con sufijo («FIGARANTIAS SAS»).
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeCompanyName, normalizeDomain } from '../normalization';

const CHECKER = readFileSync('src/server/agents/prospecting-toolkit/hubspot-commercial-checker.ts', 'utf8');

describe('búsqueda en HubSpot del buscador gratuito', () => {
  it('la web se reduce al dominio que guarda HubSpot', () => {
    assert.equal(normalizeDomain('https://figarantias.com'), 'figarantias.com');
    assert.equal(normalizeDomain('https://www.figarantias.com/contacto'), 'figarantias.com');
    assert.equal(normalizeDomain('figarantias.com'), 'figarantias.com');
  });

  it('el nombre se busca sin sufijo legal', () => {
    assert.equal(normalizeCompanyName('FIGARANTIAS SAS'), 'figarantias');
  });

  it('el verificador usa las dos normalizaciones (no el texto crudo)', () => {
    assert.match(CHECKER, /const domain = normalizeDomain\(input\.domain\)/);
    assert.match(CHECKER, /const nameQuery = normalizeCompanyName\(input\.name\)/);
    assert.doesNotMatch(CHECKER, /input\.domain\.toLowerCase\(\)\.replace\(\/\^www/);
  });
});
