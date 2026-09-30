/**
 * AGENT1-TAVILY-V2-1 § 1 — cuerpo de `POST /search` de Tavily. Sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildTavilySearchRequestBody } from '../web-search-providers/tavily-web-search-provider';

describe('buildTavilySearchRequestBody', () => {
  it('envía país e idioma para un país de habla hispana', () => {
    assert.deepEqual(buildTavilySearchRequestBody({ query: 'q', countryCode: 'PE' }, 5), {
      query: 'q',
      max_results: 5,
      search_depth: 'basic',
      include_raw_content: false,
      include_usage: true,
      country: 'peru',
      language: 'spanish',
      filter_by_language: true,
    });
  });

  it('Brasil y EE. UU. llevan país pero no idioma', () => {
    const br = buildTavilySearchRequestBody({ query: 'q', countryCode: 'BR' }, 5);
    assert.equal(br.country, 'brazil');
    assert.equal('language' in br, false);
    const us = buildTavilySearchRequestBody({ query: 'q', countryCode: 'US' }, 5);
    assert.equal(us.country, 'united states');
    assert.equal('language' in us, false);
  });

  it('sin país conocido el cuerpo es el de siempre (nunca un valor que Tavily rechace)', () => {
    assert.deepEqual(buildTavilySearchRequestBody({ query: 'q' }, 5), {
      query: 'q',
      max_results: 5,
      search_depth: 'basic',
      include_raw_content: false,
      include_usage: true,
    });
    const unknown = buildTavilySearchRequestBody({ query: 'q', countryCode: 'XX' }, 5);
    assert.equal('country' in unknown, false);
  });

  it('nunca pide parámetros que cobren más (el filtro de idioma no cuesta)', () => {
    // AGENT1-TAVILY-V2-2 — el filtro estricto de idioma sí viaja en países
    // hispanos: descarta páginas en inglés al mismo costo (1 crédito).
    const body = buildTavilySearchRequestBody({ query: 'q', countryCode: 'CO' }, 5);
    assert.equal(body.filter_by_language, true);
    assert.equal('auto_parameters' in body, false);
    assert.equal(body.search_depth, 'basic');
  });

  it('deep sigue siendo advanced', () => {
    assert.equal(
      buildTavilySearchRequestBody({ query: 'q', countryCode: 'CO', searchDepth: 'deep' }, 5).search_depth,
      'advanced',
    );
  });
});

describe('buildTavilySearchRequestBody — exclude_domains', () => {
  it('envía exclude_domains cuando hay dominios', () => {
    const body = buildTavilySearchRequestBody({ query: 'q', countryCode: 'CO', excludeDomains: ['a.com', 'b.com'] }, 5);
    assert.deepEqual(body.exclude_domains, ['a.com', 'b.com']);
  });

  it('no envía la clave si la lista está vacía', () => {
    const body = buildTavilySearchRequestBody({ query: 'q', countryCode: 'CO', excludeDomains: [] }, 5);
    assert.equal('exclude_domains' in body, false);
  });

  it('recorta a 150 aunque el llamador mande más', () => {
    const many = Array.from({ length: 200 }, (_, i) => `d${i}.com`);
    const body = buildTavilySearchRequestBody({ query: 'q', excludeDomains: many }, 5);
    assert.equal((body.exclude_domains as string[]).length, 150);
  });
});
