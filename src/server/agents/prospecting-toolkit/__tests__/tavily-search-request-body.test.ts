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
      country: 'peru',
      language: 'spanish',
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
    });
    const unknown = buildTavilySearchRequestBody({ query: 'q', countryCode: 'XX' }, 5);
    assert.equal('country' in unknown, false);
  });

  it('nunca pide filtrado estricto por idioma ni parámetros que cobren más', () => {
    const body = buildTavilySearchRequestBody({ query: 'q', countryCode: 'CO' }, 5);
    assert.equal('filter_by_language' in body, false);
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
