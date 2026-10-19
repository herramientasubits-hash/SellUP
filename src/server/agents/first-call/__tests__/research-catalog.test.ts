/**
 * Dónde busca Rumbo a una empresa (dueña 19-10): fuentes por país e industria, sitio
 * propio, vacantes y LinkedIn por el fragmento del buscador. Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { buildNewsSearchBody } from '../news-search';
import {
  MAX_INCLUDE_DOMAINS,
  RESEARCH_NOISE_DOMAINS,
  accountMacroIndustry,
  bareDomain,
  buildResearchSearchPlan,
  sourcesForAccount,
} from '../research-catalog';
import { COUNTRY_SOURCE_CATALOG } from '../research-catalog-data';
import { firstOfEachUrl, newsToDocuments } from '../research-documents';
import { isAgent3ExtendedResearchEnabled } from '../run-first-call.server';

const DAVIVIENDA = {
  name: 'Davivienda Colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Seguros y Servicios Financieros',
  domain: 'davivienda.com',
};

describe('catálogo de fuentes por país', () => {
  it('los dominios son hosts limpios, sin redes, LinkedIn ni portales de empleo', () => {
    const bad: string[] = [];
    for (const [country, catalog] of Object.entries(COUNTRY_SOURCE_CATALOG)) {
      const all = [
        ...catalog.businessPress,
        ...catalog.hrMedia,
        ...catalog.decisionMakerSources,
        ...Object.values(catalog.industryMedia).flat(),
      ];
      for (const domain of all) {
        const clean = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) && !domain.startsWith('www.');
        const banned = domain === 'linkedin.com' || RESEARCH_NOISE_DOMAINS.includes(domain);
        if (!clean || banned) bad.push(`${country}:${domain}`);
      }
      assert.ok(catalog.businessPress.length >= 3, `${country} tiene al menos 3 medios de negocios`);
      for (const key of Object.keys(catalog.industryMedia)) {
        assert.ok((MACRO_INDUSTRY_KEYS as readonly string[]).includes(key), `${country}: ${key} es una macro industria`);
      }
    }
    assert.deepEqual(bad, []);
  });

  it('dominios secuestrados o caídos (vistos al verificar) no entran', () => {
    const all = JSON.stringify(COUNTRY_SOURCE_CATALOG);
    for (const dead of ['revistadelogistica.com', 'informepastran.com', 'cadexco.net', 'agexport.org.gt', 'republica.gt']) {
      assert.equal(all.includes(`'${dead}'`) || all.includes(`"${dead}"`), false, dead);
    }
  });

  it('Colombia financiera: primero los medios del sector, después la prensa del país y la regional', () => {
    const sources = sourcesForAccount('CO', 'Seguros y Servicios Financieros');
    assert.equal(sources.countryCovered, true);
    assert.ok(sources.press.indexOf('fasecolda.com') < sources.press.indexOf('larepublica.co'));
    assert.ok(sources.press.includes('bloomberglinea.com'));
    assert.ok(sources.press.length <= MAX_INCLUDE_DOMAINS);
    assert.ok(sources.hrMedia.includes('merco.info'));
    assert.equal(new Set(sources.press).size, sources.press.length, 'sin repetidos');
  });

  it('un país sin catálogo propio usa lo regional', () => {
    const sources = sourcesForAccount('JP', null);
    assert.equal(sources.countryCovered, false);
    assert.ok(sources.press.includes('bloomberglinea.com'));
  });

  it('la industria se reconoce por clave o por nombre visible', () => {
    assert.equal(accountMacroIndustry('retail'), 'retail');
    assert.equal(accountMacroIndustry('Retail'), 'retail');
    assert.equal(accountMacroIndustry('Tecnología'), 'technology');
    assert.equal(accountMacroIndustry('Algo raro'), null);
    assert.equal(accountMacroIndustry(null), null);
  });
});

describe('plan de búsquedas de la empresa', () => {
  it('sin la búsqueda ampliada quedan las dos de siempre (nada cambia)', () => {
    const plan = buildResearchSearchPlan({ ...DAVIVIENDA, extended: false });
    assert.deepEqual(
      plan.map((q) => [q.step, q.query, q.topic, q.includeDomains, q.excludeDomains]),
      [
        ['noticias', '"Davivienda Colombia" Colombia', 'news', undefined, undefined],
        ['talento', '"Davivienda Colombia" empleo formación talento cultura', 'general', undefined, undefined],
      ],
    );
  });

  it('con la ampliada: prensa, talento, sitio propio y LinkedIn, como mucho 6 créditos', () => {
    const plan = buildResearchSearchPlan({ ...DAVIVIENDA, extended: true });
    assert.deepEqual(plan.map((q) => q.step), ['noticias', 'talento', 'prensa', 'medios_talento', 'sitio_propio', 'linkedin']);
    assert.ok(plan.length <= 6);
    const byStep = Object.fromEntries(plan.map((q) => [q.step, q]));
    // Sólo el modo «news» de Tavily trae la fecha: la prensa y los medios de talento van así.
    assert.equal(byStep.prensa.topic, 'news');
    assert.equal(byStep.medios_talento.topic, 'news');
    assert.deepEqual(byStep.sitio_propio.includeDomains, ['davivienda.com']);
    assert.deepEqual(byStep.linkedin.includeDomains, ['linkedin.com']);
    assert.ok(byStep.prensa.includeDomains!.includes('larepublica.co'));
    // Las abiertas excluyen ruido; las de fuentes elegidas no lo necesitan.
    assert.ok(byStep.noticias.excludeDomains!.includes('computrabajo.com'));
    assert.equal(byStep.prensa.excludeDomains, undefined);
    assert.equal(new Set(plan.map((q) => q.operationKey)).size, plan.length, 'cada búsqueda se registra aparte');
  });

  it('sin dominio (o si su «sitio» es una red social) no busca en el sitio propio', () => {
    assert.equal(buildResearchSearchPlan({ ...DAVIVIENDA, domain: null, extended: true }).some((q) => q.step === 'sitio_propio'), false);
    const social = buildResearchSearchPlan({ ...DAVIVIENDA, domain: 'https://www.linkedin.com/company/davivienda', extended: true });
    assert.equal(social.some((q) => q.step === 'sitio_propio'), false);
  });

  it('el dominio se limpia de protocolo, www y ruta', () => {
    assert.equal(bareDomain('https://www.Davivienda.com/personas/'), 'davivienda.com');
    assert.equal(bareDomain('auteco.com.co'), 'auteco.com.co');
    assert.equal(bareDomain('sin-punto'), null);
    assert.equal(bareDomain(null), null);
  });

  it('la búsqueda ampliada sólo se apaga a propósito', () => {
    assert.equal(isAgent3ExtendedResearchEnabled(undefined), true);
    assert.equal(isAgent3ExtendedResearchEnabled(''), true);
    assert.equal(isAgent3ExtendedResearchEnabled('on'), true);
    assert.equal(isAgent3ExtendedResearchEnabled('off'), false);
    assert.equal(isAgent3ExtendedResearchEnabled(' FALSE '), false);
    assert.equal(isAgent3ExtendedResearchEnabled('0'), false);
  });
});

describe('lo que se le pide a Tavily', () => {
  it('include_domains, exclude_domains y resultados van como Tavily los espera', () => {
    const body = buildNewsSearchBody({
      query: '"Davivienda"',
      countryCode: 'CO',
      topic: 'general',
      includeDomains: ['larepublica.co'],
      excludeDomains: ['computrabajo.com'],
      maxResults: 8,
    });
    assert.deepEqual(body.include_domains, ['larepublica.co']);
    assert.deepEqual(body.exclude_domains, ['computrabajo.com']);
    assert.equal(body.max_results, 8);
    assert.equal(body.search_depth, 'basic', '1 crédito');
  });

  it('sin listas no se mandan los campos, y los resultados se acotan a 1–20', () => {
    const body = buildNewsSearchBody({ query: 'x', countryCode: null, topic: 'news', maxResults: 50 });
    assert.equal('include_domains' in body, false);
    assert.equal('exclude_domains' in body, false);
    assert.equal(body.max_results, 20);
  });
});

describe('resultados como documentos según la búsqueda', () => {
  const text = 'Davivienda anunció un programa de formación para 3.000 asesores en todo el país este año.';

  it('LinkedIn: sólo la página de la empresa; publicaciones de personas, perfiles y empleos no', () => {
    const docs = newsToDocuments(
      [
        { url: 'https://www.linkedin.com/company/davivienda/', title: 'Davivienda | LinkedIn', content: text, publishedOn: null },
        { url: 'https://co.linkedin.com/posts/davivienda_formacion-123', title: 'Post', content: text, publishedOn: null },
        { url: 'https://www.linkedin.com/in/alguien', title: 'Perfil', content: text, publishedOn: null },
        { url: 'https://www.linkedin.com/jobs/view/1', title: 'Empleo', content: text, publishedOn: null },
        { url: 'https://larepublica.co/x', title: 'Nota', content: text, publishedOn: null },
      ],
      'davivienda.com',
      'linkedin',
    );
    assert.deepEqual(docs.map((d) => d.url), ['https://www.linkedin.com/company/davivienda/']);
    assert.ok(docs.every((d) => d.label === 'LinkedIn · fragmento del buscador'));
  });

  it('en las demás búsquedas LinkedIn y los portales de empleo siguen fuera', () => {
    const docs = newsToDocuments(
      [
        { url: 'https://www.linkedin.com/company/davivienda/', title: 'x', content: text, publishedOn: null },
        { url: 'https://co.computrabajo.com/empresa', title: 'x', content: text, publishedOn: null },
        { url: 'https://www.larepublica.co/talento', title: 'x', content: text, publishedOn: '2026-09-01' },
      ],
      'davivienda.com',
      'medios_talento',
    );
    assert.deepEqual(docs.map((d) => d.label), ['Talento · larepublica.co']);
  });

  it('la etiqueta dice de qué búsqueda vino y lo de la empresa sigue siendo «Sitio oficial»', () => {
    const [press] = newsToDocuments([{ url: 'https://www.larepublica.co/a', title: 'x', content: text, publishedOn: null }], null, 'prensa');
    assert.equal(press.label, 'Prensa · larepublica.co');
    const [own] = newsToDocuments([{ url: 'https://blog.davivienda.com/a', title: 'x', content: text, publishedOn: null }], 'davivienda.com', 'sitio_propio');
    assert.equal(own.label, 'Sitio oficial · Publicación');
    assert.equal(own.kind, 'official_site');
  });

  it('la misma URL que traen dos búsquedas entra una vez', () => {
    const doc = { docId: '', url: 'https://a.co/x', label: 'x', kind: 'news' as const, text: 't', publishedOn: null };
    assert.equal([doc, { ...doc }, { ...doc, url: 'https://a.co/y' }].filter(firstOfEachUrl()).length, 2);
  });
});
