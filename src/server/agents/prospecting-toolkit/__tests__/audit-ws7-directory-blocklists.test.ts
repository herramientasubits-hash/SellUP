/**
 * AUDIT-A1-WS7 (16-10) — directorios que se colaban como empresas: doctoralia,
 * tripadvisor, mercadolibre/mercadolivre, bnamericas, cybo, informacolombia,
 * rues.org.co, guialocal, infoempresa (con sus terminaciones por país).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifySearchResult, isDirectoryBrandDomain, isProspectableCompanyResult } from '../noise-filter';
import { buildTavilyExcludeDomains, countryDirectoryDomains, TAVILY_STATIC_EXCLUDE_DOMAINS } from '../tavily-exclude-domains';

const DIRECTORY_URLS = [
  'https://www.doctoralia.com.co/clinica-x',
  'https://www.doctoralia.es/clinica-x',
  'https://www.tripadvisor.com.mx/Hotel_Review-x',
  'https://www.tripadvisor.co/Restaurant-x',
  'https://listado.mercadolibre.com.ar/empresa-x',
  'https://www.mercadolivre.com.br/loja-x',
  'https://www.bnamericas.com/es/perfil-empresa/x',
  'https://co.cybo.com/CO-biz/x',
  'https://www.informacolombia.com/directorio-empresas/x',
  'https://www.rues.org.co/RM/x',
  'https://www.guialocal.com.co/empresa-x',
  'https://www.infoempresa.com.pe/x',
];

describe('AUDIT-A1-WS7 — directorios en el filtro de ruido', () => {
  for (const url of DIRECTORY_URLS) {
    it(`descarta ${url}`, () => {
      const result = { url, title: 'Empresa X - Directorio', snippet: 'Teléfono, dirección y opiniones' };
      assert.equal(classifySearchResult(result).shouldKeep, false);
      assert.equal(isProspectableCompanyResult(result).isProspectable, false);
    });
  }

  it('la marca sólo cuenta como etiqueta del dominio, no como parte de otra palabra', () => {
    assert.equal(isDirectoryBrandDomain('doctoralia.com.co'), true);
    assert.equal(isDirectoryBrandDomain('clinicadoctoralia.com'), false);
    assert.equal(isDirectoryBrandDomain('cybord.com'), false);
    assert.equal(isDirectoryBrandDomain('mercadolibre-logistica.com.co'), false);
  });
});

describe('AUDIT-A1-WS7 — exclusión en Tavily', () => {
  it('fijos dentro del tope y directorios del país de la corrida', () => {
    assert.ok(TAVILY_STATIC_EXCLUDE_DOMAINS.length <= 50);
    for (const d of ['bnamericas.com', 'cybo.com', 'rues.org.co']) assert.ok(TAVILY_STATIC_EXCLUDE_DOMAINS.includes(d), d);
    assert.deepEqual(countryDirectoryDomains('CO'), [
      'doctoralia.com.co', 'doctoralia.co', 'tripadvisor.com.co', 'tripadvisor.co', 'mercadolibre.com.co', 'mercadolibre.co',
    ]);
    const out = buildTavilyExcludeDomains({ seenThisRun: [], negativeMemory: [], countryCode: 'MX' });
    assert.ok(out.domains.includes('doctoralia.com.mx'));
    assert.deepEqual(countryDirectoryDomains(null), []);
  });
});
