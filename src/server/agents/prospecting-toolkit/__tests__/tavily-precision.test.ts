/**
 * AGENT1-TAVILY-V2-2 — precisión de Tavily, medida en la prueba controlada del
 * 30-09 (12 créditos, 3 unidades, 55 resultados crudos → 40 tras el filtro de
 * búsqueda → sólo ~30% organizaciones reales del sector).
 *
 * Causas medidas:
 *   · términos en INGLÉS del catálogo («grocery store», «health insurer»,
 *     «public administration») traían resultados extranjeros, noticias y papers;
 *   · dominios de otros países pasaban el control de país (`cheekyfoods.com.au`
 *     para Colombia);
 *   · noticias, documentos, traductores y bases de empresas no estaban en los
 *     filtros de ruido.
 *
 * Esta suite fija las cuatro correcciones, todas exclusivas de Tavily.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import {
  TAVILY_ENGLISH_ONLY_TERMS,
  buildTavilyMacroQueryPlan,
} from '../tavily-query-plan';
import { findForeignCctld } from '../tavily-foreign-cctld-guard';
import { buildTavilySearchRequestBody } from '../web-search-providers/tavily-web-search-provider';
import { classifySearchResult } from '../noise-filter';
import { runMultiQueryWebSearch } from '../web-search-tool';
import type { TavilyUsageDeps } from '../tavily-usage-logging';
import type { MultiQuerySearchInput, WebSearchInput, WebSearchOutput } from '../types';

describe('vocabulario: sin términos en inglés en países hispanos', () => {
  it('ningún término inglés llega a una consulta con countryCode hispano', () => {
    for (const macro of MACRO_INDUSTRIES) {
      const plan = buildTavilyMacroQueryPlan({
        industry: macro.displayName, country: 'Colombia', countryCode: 'CO', seedKey: 's', additionalCriteria: null,
      })!;
      for (const q of plan.rounds.flat()) {
        for (const term of TAVILY_ENGLISH_ONLY_TERMS) {
          assert.ok(!q.includes(term), `${macro.key}: «${q}» lleva el término inglés «${term}»`);
        }
      }
    }
  });

  it('cada macro conserva al menos 7 términos en español (2 rondas como mínimo)', () => {
    for (const macro of MACRO_INDUSTRIES) {
      const plan = buildTavilyMacroQueryPlan({
        industry: macro.displayName, country: 'Perú', countryCode: 'PE', seedKey: 's', additionalCriteria: null,
      })!;
      assert.ok(plan.termCount >= 7, `${macro.key}: sólo ${plan.termCount} términos`);
      assert.ok(plan.rounds.length >= 2, `${macro.key}: sólo ${plan.rounds.length} ronda(s)`);
    }
  });

  it('Retail en Colombia deja de buscar «grocery» y «retailer»', () => {
    const plan = buildTavilyMacroQueryPlan({
      industry: 'Retail', country: 'Colombia', countryCode: 'CO', seedKey: 'x', additionalCriteria: null,
    })!;
    const all = plan.rounds.flat().join(' | ');
    assert.doesNotMatch(all, /grocery|retailer|department store|retail chain/i);
    assert.match(all, /supermercado|comercio minorista|cadena de tiendas/);
  });

  it('sin countryCode (o país no hispano) el plan no cambia: conserva los 14 términos', () => {
    for (const countryCode of [undefined, 'BR', 'US']) {
      const plan = buildTavilyMacroQueryPlan({
        industry: 'Retail', country: 'X', ...(countryCode ? { countryCode } : {}), seedKey: 'x', additionalCriteria: null,
      })!;
      assert.equal(plan.termCount, 14, String(countryCode));
    }
  });

  it('el conjunto de excluidos no tiene entradas viejas: todas existen en el catálogo', () => {
    const catalog = new Set(MACRO_INDUSTRIES.flatMap((m) => [...m.discovery.specific]));
    for (const term of TAVILY_ENGLISH_ONLY_TERMS) {
      assert.ok(catalog.has(term), `«${term}» ya no está en el catálogo`);
    }
  });
});

describe('idioma estricto en la petición', () => {
  it('país hispano: language=spanish y filter_by_language=true', () => {
    const body = buildTavilySearchRequestBody({ query: 'q', countryCode: 'PE' }, 5);
    assert.equal(body.language, 'spanish');
    assert.equal(body.filter_by_language, true);
  });

  it('Brasil, EE. UU. o sin país: nunca filter_by_language (Tavily devuelve 400 sin language)', () => {
    for (const countryCode of ['BR', 'US', undefined, 'XX']) {
      const body = buildTavilySearchRequestBody({ query: 'q', ...(countryCode ? { countryCode } : {}) }, 5);
      assert.equal('filter_by_language' in body, false, String(countryCode));
      assert.equal('language' in body, false, String(countryCode));
    }
  });
});

describe('findForeignCctld', () => {
  const foreign: Array<[string, string, string]> = [
    ['https://www.cheekyfoods.com.au', 'CO', 'au'],
    ['https://www.inmedical.com.ec/tag/peru', 'PE', 'ec'],
    ['https://tienda.com.mx/x', 'CO', 'mx'],
    ['https://empresa.com.co/x', 'PE', 'co'],
    ['https://empresa.gov.co', 'PE', 'co'],
    ['https://site.co.uk', 'CO', 'uk'],
    ['https://site.de', 'MX', 'de'],
  ];
  for (const [url, target, tld] of foreign) {
    it(`${url} no encaja con ${target} (.${tld})`, () => assert.equal(findForeignCctld(url, target), tld));
  }

  const ok: Array<[string, string]> = [
    ['https://www.claro.com.co', 'CO'],
    ['https://empresa.co', 'CO'],
    ['https://empresa.co', 'PE'],          // .co se usa como genérico
    ['https://clinicainternacional.com.pe', 'PE'],
    ['https://www.mapfre.com', 'PE'],
    ['https://site.org', 'CO'],
    ['https://site.io', 'MX'],
    ['https://app.ai', 'CO'],
    ['https://empresa.us', 'US'],
    ['https://empresa.es', 'ES'],
    ['https://www.bancolombia.com/personas', 'CO'],
  ];
  for (const [url, target] of ok) {
    it(`${url} sí encaja con ${target}`, () => assert.equal(findForeignCctld(url, target), null));
  }

  it('URL ilegible o país ausente: no rechaza (nunca inventa un descarte)', () => {
    assert.equal(findForeignCctld('no es una url', 'CO'), null);
    assert.equal(findForeignCctld('https://x.com.au', ''), null);
    assert.equal(findForeignCctld(null, 'CO'), null);
  });
});

describe('ruido nuevo: noticias, documentos, traductores y bases de empresas', () => {
  const noise = [
    'https://news.ambest.com/newscontent.aspx?refnum=205395',
    'https://www.clarin.com/moda/tiendas-departamentales_0_x.html',
    'https://www.cronista.com/colombia/curiosidades/confirmado-d1-revela',
    'https://www.scribd.com/document/363095351/ent-prest-salud-pdf',
    'https://www.cliffsnotes.com/study-notes/17034515',
    'https://vlex.com.co/vid/superintendencia-bancaria-393945258',
    'https://www.tandfonline.com/doi/full/10.1080/14719037.2022.2054227',
    'https://policypress.universitypressscholarship.com/view/10.1332/policy',
    'https://translate.google.com/translate?u=https%3A%2F%2Fwww.sipa.columbia.edu',
    'https://www.cbinsights.com/company/koba-international-group',
  ];
  for (const url of noise) {
    it(`fuera: ${url.slice(0, 60)}`, () => {
      assert.equal(classifySearchResult({ title: 'Página', url, snippet: 'texto' }).shouldKeep, false);
    });
  }

  it('las organizaciones reales de la prueba siguen pasando', () => {
    for (const url of [
      'https://clinicainternacional.com.pe', 'https://www.pacifico.com.pe/eps', 'https://www.mapfre.com.pe/seguros-de-salud',
      'https://apoicc.org.pe/quienes-somos', 'https://www.superfinanciera.gov.co', 'https://www.sic.gov.co',
      'https://www.etitc.edu.co', 'https://www.falabella.com/falabella-cl/page/falabella-retail',
    ]) {
      assert.equal(classifySearchResult({ title: 'Empresa', url, snippet: 'texto' }).shouldKeep, true, url);
    }
  });
});

describe('web-search-tool: el control de país ajeno es sólo de Tavily', () => {
  function dispatcherWith(urls: string[]): TavilyUsageDeps['dispatchQuery'] {
    return (async (_p: string, input: WebSearchInput): Promise<WebSearchOutput> => ({
      provider: 'tavily',
      query: input.query,
      results: urls.map((url, i) => ({
        title: `Empresa ${i}`, url, snippet: null, source: 'tavily', rank: i + 1, provider: 'tavily' as const, confidence: null, metadata: {},
      })),
      resultsCount: urls.length,
      skipped: false,
      skipReason: null,
      estimatedCostUsd: null,
      metadata: {},
    })) as unknown as TavilyUsageDeps['dispatchQuery'];
  }
  const deps = (urls: string[]): TavilyUsageDeps => ({
    loadPricing: async () => ({ unitCostUsd: 0.008, unit: 'per_credit' }),
    logUsage: async () => ({ kind: 'logged' as const }),
    dispatchQuery: dispatcherWith(urls),
  });
  const base = (provider: 'tavily' | 'mock'): MultiQuerySearchInput => ({
    country: 'Colombia', countryCode: 'CO', industry: 'Retail', provider, queries: ['q'], maxResultsPerQuery: 5,
  });
  const URLS = ['https://www.claro.com.co', 'https://www.cheekyfoods.com.au', 'https://www.bancolombia.com'];

  it('Tavily: descarta el dominio de otro país y lo cuenta en la metadata', async () => {
    const out = await runMultiQueryWebSearch(base('tavily'), deps(URLS));
    assert.deepEqual(out.results.map((r) => r.url).sort(), ['https://www.bancolombia.com', 'https://www.claro.com.co']);
    assert.equal((out.metadata as Record<string, unknown>).foreign_cctld_filtered_count, 1);
  });

  it('otro proveedor: el control no se aplica y no hay clave en la metadata', async () => {
    const out = await runMultiQueryWebSearch(base('mock'), deps(URLS));
    assert.equal(out.results.length, 3);
    assert.equal('foreign_cctld_filtered_count' in (out.metadata as Record<string, unknown>), false);
  });

  it('sin countryCode no descarta nada', async () => {
    const out = await runMultiQueryWebSearch({ ...base('tavily'), countryCode: null }, deps(URLS));
    assert.equal(out.results.length, 3);
  });
});
