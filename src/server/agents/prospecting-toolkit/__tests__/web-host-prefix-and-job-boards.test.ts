/**
 * AGENT1-WEB-HOST-PREFIX-1 — Prod 06-10 (CL×Salud, e4fec102): la misma empresa
 * (Mutual de Seguridad) quedó dos veces en revisión desde la búsqueda web:
 *   - «Ww2.mutual» con dominio `ww2.mutual.cl` (sólo se quitaba `www.`);
 *   - «Empleos Mutual de Seguridad» con `mutual.trabajando.cl`, la página de
 *     empleos de un portal (sólo estaba `trabajando.com`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDomain, stripWebHostPrefix } from '../normalization';
import { classifySearchResult, isJobBoardBrandDomain } from '../noise-filter';
import { normalizeProspectCompanyName } from '../company-name-normalizer';
import { extractDomainFromUrl } from '../web-evidence-scorer';
import { extractDomain } from '../candidate-writer-pure-gates';
import type { WebSearchResult } from '../types';

function result(url: string, title = 'Sitio oficial'): WebSearchResult {
  return { title, url, snippet: 'Somos una organización.', source: 'tavily', rank: 1, provider: 'tavily', confidence: 0.8, metadata: {} };
}

describe('el prefijo web del host no forma parte del dominio', () => {
  for (const [input, expected] of [
    ['ww2.mutual.cl', 'mutual.cl'],
    ['www2.empresa.com.co', 'empresa.com.co'],
    ['www.siigo.com', 'siigo.com'],
    ['WW3.Ejemplo.cl', 'Ejemplo.cl'],
  ] as const) {
    it(`${input} → ${expected}`, () => assert.equal(stripWebHostPrefix(input), expected));
  }

  it('no toca subdominios que no son prefijo web', () => {
    assert.equal(stripWebHostPrefix('ssan.redsalud.gob.cl'), 'ssan.redsalud.gob.cl');
    assert.equal(stripWebHostPrefix('wwf.org'), 'wwf.org');
    assert.equal(stripWebHostPrefix('www2bank.com'), 'www2bank.com');
  });

  it('si lo que queda no tiene punto, deja el host como venía', () => {
    assert.equal(stripWebHostPrefix('www2.cl'), 'www2.cl');
  });

  it('los extractores de dominio del camino web dan el mismo resultado', () => {
    assert.equal(normalizeDomain('https://ww2.mutual.cl/'), 'mutual.cl');
    assert.equal(extractDomainFromUrl('https://ww2.mutual.cl/'), 'mutual.cl');
    assert.equal(extractDomain('https://ww2.mutual.cl/'), 'mutual.cl');
  });

  it('el nombre inferido del dominio no lleva el prefijo', () => {
    const out = normalizeProspectCompanyName('Software de recursos humanos', 'https://ww2.mutual.cl/');
    assert.equal(out.name, 'Mutual');
  });
});

describe('trabajando.cl es un portal de empleo en cualquier subdominio', () => {
  it('mutual.trabajando.cl se reconoce como portal', () => {
    assert.equal(isJobBoardBrandDomain('mutual.trabajando.cl'), true);
    assert.equal(classifySearchResult(result('https://mutual.trabajando.cl/', 'Empleos Mutual de Seguridad')).shouldKeep, false);
  });

  it('trabajando.cl y trabajando.com.pe también', () => {
    assert.equal(classifySearchResult(result('https://www.trabajando.cl/')).shouldKeep, false);
    assert.equal(isJobBoardBrandDomain('trabajando.com.pe'), true);
  });

  it('una empresa con «trabajando» en otra parte del dominio no se toca', () => {
    assert.equal(isJobBoardBrandDomain('trabajandojuntos.cl'), false);
  });
});
