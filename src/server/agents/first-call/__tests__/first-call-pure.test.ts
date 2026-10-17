/**
 * AGENT3-FIRST-CALL-1 — piezas puras del Agente 3: cifras con fuente, páginas del
 * sitio, hechos internos, verificación de la investigación y del paquete.
 *
 * Sin red y sin base de datos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractNumbers, unsupportedNumbers } from '../numbers';
import { classifySitePage, pickSitePages } from '../site-pages';
import { buildInternalFacts, buildRequestFacts, hubspotWarning, type InternalContext } from '../internal-facts';
import { isResearchSufficient, unverifiedSearchUrls, verifyResearch } from '../research-verifier';
import type { ResearchDocument } from '../research-prompt';
import { containsPhone, countWords, parsePackSubmission, verifyPack } from '../pack-verifier';
import { newsToDocuments } from '../research-documents';
import { buildNewsSearchBody, parseNewsResponse } from '../news-search';
import { addressFormFor, roleFocusFor, DEFAULT_ROLE_FOCUS } from '../ubits-messaging-library';
import { curatedListLabels, mapBriefRow, mapPackRow, readPriorClassification } from '../row-mappers';
import { parseFirstCallRequest } from '../../../../modules/speech/first-call-request';
import type { ResearchFact } from '../types';

const TODAY = '2026-10-16';

function internalContext(overrides: Partial<InternalContext> = {}): InternalContext {
  return {
    account: {
      id: 'acc-1',
      name: 'Distribuidora Andina',
      legalName: null,
      website: 'https://andina.example',
      domain: 'andina.example',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Retail',
      companySize: '1001-5000',
      taxIdentifier: null,
      taxIdentifierType: null,
      hubspotCompanyId: null,
    },
    classification: null,
    curatedLists: [],
    relations: [],
    hubspot: null,
    decisionMaker: null,
    ...overrides,
  };
}

const SITE_DOC: ResearchDocument = {
  docId: 'D1',
  url: 'https://andina.example/nosotros',
  label: 'Sitio oficial · Nosotros',
  kind: 'official_site',
  text: 'Somos una cadena de tiendas con presencia en 12 ciudades de Colombia. Este año abrimos 3 nuevas tiendas en Cali.',
  publishedOn: null,
};
const NEWS_DOC: ResearchDocument = {
  docId: 'D2',
  url: 'https://noticias.example/andina-expansion',
  label: 'Noticia · noticias.example',
  kind: 'news',
  text: 'Distribuidora Andina anunció la contratación de 400 personas para sus nuevas sedes.',
  publishedOn: '2026-08-01',
};

describe('cifras con fuente', () => {
  it('reconoce la misma cifra con y sin separador de miles', () => {
    assert.deepEqual(unsupportedNumbers('Tienen 1.200 empleados', ['1200 empleados']), []);
  });
  it('marca una cifra que no está en ninguna fuente', () => {
    assert.deepEqual(unsupportedNumbers('Crecieron 37 tiendas', ['abrimos tiendas']), ['37']);
  });
  it('deja pasar cifras de agenda pero nunca un porcentaje sin fuente', () => {
    assert.deepEqual(unsupportedNumbers('Lo vemos en 20 minutos', []), []);
    assert.deepEqual(unsupportedNumbers('Ahorran 5% de tiempo', []), ['5%']);
  });
  it('detecta porcentajes', () => {
    assert.equal(extractNumbers('subió 30 %')[0]?.isPercent, true);
  });
});

describe('páginas del sitio', () => {
  it('elige una página por tema, sólo del mismo sitio y sin archivos', () => {
    const html = `
      <a href="/quienes-somos">Quiénes somos</a>
      <a href="/trabaja-con-nosotros">Trabaja con nosotros</a>
      <a href="/sala-de-prensa">Prensa</a>
      <a href="https://otro.example/noticias">Otro</a>
      <a href="/informe-2025.pdf">Informe</a>
      <a href="/sostenibilidad">Sostenibilidad</a>
      <a href="/nosotros">Nosotros duplicado</a>`;
    const pages = pickSitePages(html, 'https://andina.example/');
    assert.deepEqual(
      pages.map((p) => p.kind),
      ['about', 'careers', 'news', 'sustainability'],
    );
    assert.ok(pages.every((p) => p.url.startsWith('https://andina.example/')));
  });
  it('no acepta un dominio padre como si fuera el mismo sitio', () => {
    const pages = pickSitePages('<a href="https://com.co/nosotros">x</a><a href="https://blog.empresa.com.co/prensa">Prensa</a>', 'https://empresa.com.co/');
    assert.deepEqual(pages.map((p) => p.url), ['https://blog.empresa.com.co/prensa']);
  });
  it('clasifica por el texto del enlace si la ruta no dice nada', () => {
    assert.equal(classifySitePage('/p/123', 'Únete a nuestro equipo'), 'careers');
    assert.equal(classifySitePage('/p/123', 'Contacto'), null);
  });
});

describe('hechos internos', () => {
  it('usa la clasificación verificada, las listas, el árbol, HubSpot y el decisor', () => {
    const facts = buildInternalFacts(
      internalContext({
        classification: {
          sector: { label: 'Retail', quote: 'cadena de tiendas', sourceUrl: 'https://andina.example' },
          employeeRange: null,
        },
        curatedLists: ['Merco Talento 2025', 'Exportadores CO'],
        relations: [{ relationType: 'subsidiary', name: 'Andina Perú', countryCode: 'PE' }],
        hubspot: { status: 'no_match', lifecycleStage: null, lastActivityDate: null, numberOfDeals: null },
        decisionMaker: { id: 'c1', name: 'María Pérez', title: 'Gerente de Talento', department: 'RR. HH.' },
      }),
    );
    const topics = facts.map((f) => f.topic);
    assert.ok(topics.includes('business'));
    assert.ok(topics.includes('talent'), 'Merco Talento cuenta como dato de talento');
    assert.ok(facts.some((f) => f.statement.includes('Andina Perú')));
    // El decisor y HubSpot son de la solicitud: nunca se guardan en la ficha de 30 días.
    assert.equal(topics.includes('ubits_relation'), false);
    assert.equal(topics.includes('decision_maker'), false);
    assert.equal(facts.some((f) => f.statement.includes('María Pérez')), false);
  });

  it('el decisor y HubSpot salen como hechos de la solicitud', () => {
    const facts = buildRequestFacts({
      hubspot: { status: 'no_match', lifecycleStage: null, lastActivityDate: null, numberOfDeals: null },
      decisionMaker: { id: 'c1', name: 'María Pérez', title: 'Gerente de Talento', department: null },
    });
    assert.deepEqual(facts.map((f) => f.topic), ['ubits_relation', 'decision_maker']);
  });
  it('avisa si la empresa ya es cliente o tiene un proceso abierto', () => {
    assert.match(hubspotWarning({ status: 'customer', lifecycleStage: null, lastActivityDate: null, numberOfDeals: null })!, /cliente/);
    assert.equal(hubspotWarning({ status: 'no_match', lifecycleStage: null, lastActivityDate: null, numberOfDeals: null }), null);
  });
});

describe('verificación de la investigación', () => {
  const internalFacts: ResearchFact[] = buildInternalFacts(internalContext()).map((f, i) => ({ id: `F${i + 1}`, ...f }));
  const sources = { documents: [SITE_DOC, NEWS_DOC], citedTextsByUrl: new Map<string, string[]>(), fetchedTexts: new Map<string, string>() };

  it('acepta la cita literal, rechaza la inventada y renumera los hechos', () => {
    const verified = verifyResearch({
      submission: {
        summary: 'Cadena de tiendas en expansión.',
        facts: [
          { ref: 'W1', topic: 'size_presence', statement: 'Está en 12 ciudades.', quote: 'presencia en 12 ciudades de Colombia', doc_id: 'D1', source_url: null, published_on: null },
          { ref: 'W2', topic: 'recent_signal', statement: 'Contratará 400 personas.', quote: 'la contratación de 400 personas', doc_id: 'D2', source_url: null, published_on: null },
          { ref: 'W3', topic: 'talent', statement: 'Tiene academia propia.', quote: 'nuestra academia corporativa forma a todos', doc_id: 'D1', source_url: null, published_on: null },
        ],
        hypotheses: [
          { text: 'Podría necesitar onboarding para las nuevas sedes.', product_key: 'onboarding', fact_refs: ['W2'] },
          { text: 'Hipótesis sin respaldo.', product_key: 'learning', fact_refs: ['W3'] },
        ],
        gaps: ['No se sabe si tienen plataforma de formación.'],
      },
      internalFacts,
      sources,
      today: TODAY,
    });
    const webFacts = verified.facts.slice(internalFacts.length);
    assert.equal(webFacts.length, 2);
    assert.equal(webFacts[0].id, `F${internalFacts.length + 1}`);
    assert.equal(webFacts[1].publishedOn, '2026-08-01', 'la fecha de la noticia viene del documento');
    assert.deepEqual(verified.rejected.map((r) => r.reason), ['quote_not_found']);
    assert.equal(verified.hypotheses.length, 1, 'la hipótesis que sólo se apoyaba en el hecho inventado se cae');
    assert.equal(verified.hypotheses[0].factRefs[0], webFacts[1].id);
    assert.equal(verified.summary, 'Cadena de tiendas en expansión.');
  });

  it('rechaza cifras del dato que no están en la cita y señales viejas', () => {
    const verified = verifyResearch({
      submission: {
        facts: [
          { ref: 'W1', topic: 'size_presence', statement: 'Está en 15 ciudades.', quote: 'presencia en 12 ciudades de Colombia', doc_id: 'D1' },
          { ref: 'W2', topic: 'recent_signal', statement: 'Contrató personas.', quote: 'la contratación de 400 personas', doc_id: null, source_url: 'https://viejo.example/n', published_on: '2023-01-01' },
        ],
      },
      internalFacts,
      sources: {
        ...sources,
        citedTextsByUrl: new Map([['viejo.example/n', ['Distribuidora Andina anunció la contratación de 400 personas']]]),
      },
      today: TODAY,
    });
    assert.deepEqual(verified.rejected.map((r) => r.reason), ['statement_numbers_unsupported', 'signal_too_old']);
  });

  it('pide descargar una fuente de búsqueda cuya cita no se pudo ver', () => {
    const urls = unverifiedSearchUrls(
      { facts: [{ ref: 'W1', topic: 'talent', statement: 'x', quote: 'ganó el premio Great Place to Work 2026', doc_id: null, source_url: 'https://gptw.example/lista' }] },
      sources,
    );
    assert.deepEqual(urls, ['https://gptw.example/lista']);
  });

  it('una ficha es suficiente con qué hace, tamaño y una señal o dato de talento', () => {
    const base = (topic: ResearchFact['topic']): ResearchFact => ({
      id: 'F', topic, statement: 's', quote: null, sourceKind: 'sellup', sourceUrl: null, sourceLabel: 'x', publishedOn: null,
    });
    assert.equal(isResearchSufficient([base('business'), base('size_presence')]), false);
    assert.equal(isResearchSufficient([base('business'), base('size_presence'), base('talent')]), true);
  });
});

describe('verificación del paquete', () => {
  const facts: ResearchFact[] = [
    { id: 'F1', topic: 'recent_signal', statement: 'Contratará 400 personas.', quote: 'la contratación de 400 personas', sourceKind: 'news', sourceUrl: 'https://n.example', sourceLabel: 'Noticia', publishedOn: '2026-08-01' },
  ];
  const script = Array.from({ length: 110 }, (_, i) => (i === 10 ? '400' : 'palabra')).join(' ');
  const goodRaw = {
    reason_to_call: { text: 'Vi que contratarán 400 personas para sus nuevas sedes.', fact_refs: ['F1'] },
    angle: 'Onboarding para crecer rápido.',
    call_script: { text: script, fact_refs: ['F1'] },
    short_message: { text: 'Hola María, vi la noticia de sus nuevas sedes. ¿Conversamos 20 minutos?', fact_refs: ['F1'] },
    questions: ['¿Cómo forman hoy al personal nuevo?', '¿Quién define la inducción?', '¿Cómo miden el avance?'],
    objections: [{ library_key: 'send_info', objection: 'Mándame información.', response: 'Con gusto, ¿cuál es el reto principal?' }],
    next_step: 'Agendar 20 minutos la próxima semana.',
    cautions: ['Que la formación sea un problema es una hipótesis.'],
  };

  it('un paquete correcto no tiene problemas', () => {
    assert.deepEqual(verifyPack(parsePackSubmission(goodRaw), facts, 'whatsapp'), []);
  });

  it('marca cifras inventadas, hechos inexistentes, frases prohibidas y teléfonos', () => {
    const pack = parsePackSubmission({
      ...goodRaw,
      reason_to_call: { text: 'Crecieron 35% este año, ¿tiene un minuto?', fact_refs: ['F9'] },
      next_step: 'Llámame al +57 300 123 4567.',
    });
    const issues = verifyPack(pack, facts, 'call');
    assert.ok(issues.some((i) => i.includes('F9')));
    assert.ok(issues.some((i) => i.includes('35%')));
    assert.ok(issues.some((i) => i.includes('tiene un minuto')));
    assert.ok(issues.some((i) => i.includes('teléfono')));
  });

  it('marca un guion demasiado corto y un mensaje de LinkedIn demasiado largo', () => {
    const pack = parsePackSubmission({
      ...goodRaw,
      call_script: { text: 'Hola, soy de UBITS.', fact_refs: ['F1'] },
      short_message: { text: 'x'.repeat(400), fact_refs: [] },
    });
    assert.ok(verifyPack(pack, facts, 'call').some((i) => i.includes('muy corto')));
    const linkedin = verifyPack(pack, facts, 'linkedin');
    assert.ok(linkedin.some((i) => i.includes('300 caracteres')));
    // En LinkedIn no hay guion: su largo no se revisa.
    assert.ok(!linkedin.some((i) => i.includes('muy corto')));
  });

  it('un año no es un teléfono', () => {
    assert.equal(containsPhone('Entre 2024-2025 abrieron sedes'), false);
    assert.equal(containsPhone('Escríbeme al 300 123 4567'), true);
    assert.equal(countWords('Hola, ¿cómo están?'), 3);
  });
});

describe('noticias', () => {
  it('pide el último año y sólo manda el país en modo general', () => {
    const news = buildNewsSearchBody({ query: 'x', countryCode: 'CO', topic: 'news' });
    assert.equal(news.time_range, 'year');
    assert.equal(news.country, undefined);
    const general = buildNewsSearchBody({ query: 'x', countryCode: 'CO', topic: 'general' });
    assert.equal(general.country, 'colombia');
  });
  it('lee fecha y créditos, y descarta redes, portales de empleo y competidores', () => {
    const parsed = parseNewsResponse({
      results: [
        { url: 'https://diario.example/a', title: 'Andina abre sedes', content: 'Distribuidora Andina abrirá cinco sedes nuevas durante el próximo semestre en el país.', published_date: 'Mon, 01 Sep 2026 10:00:00 GMT' },
        { url: 'https://www.computrabajo.com/x', title: 'Vacante', content: 'Vacante de asesor comercial en Distribuidora Andina con experiencia en ventas.' },
        { url: 'https://crehana.com/x', title: 'Caso', content: 'Caso de éxito de Distribuidora Andina con formación en línea para sus equipos.' },
      ],
      usage: { credits: 1 },
    });
    assert.equal(parsed.credits, 1);
    assert.equal(parsed.results[0].publishedOn, '2026-09-01');
    const docs = newsToDocuments(parsed.results, 'andina.example');
    assert.deepEqual(docs.map((d) => d.url), ['https://diario.example/a']);
  });
});

describe('biblioteca y filas', () => {
  it('ajusta el tratamiento y el enfoque', () => {
    assert.equal(addressFormFor('MX'), 'tú');
    assert.equal(addressFormFor('CO'), 'usted');
    assert.match(roleFocusFor('Gerente de Formación y Desarrollo'), /operativo/);
    assert.equal(roleFocusFor(null), DEFAULT_ROLE_FOCUS);
  });
  it('sólo usa la clasificación con la cita comprobada', () => {
    assert.equal(
      readPriorClassification({ claude_classification: { sector: { quote: 'x', source_url: 'u', verification: 'source_listed' } } }),
      null,
    );
    const ok = readPriorClassification({
      claude_classification: { sector: { industry_name: 'Retail', quote: 'cadena de tiendas', source_url: 'https://a', verification: 'quote_verified' } },
    });
    assert.equal(ok?.sector?.label, 'Retail');
  });
  it('lee los nombres de las listas curadas con su año', () => {
    assert.deepEqual(curatedListLabels({ origins: [{ label: 'Merco Talento', year: 2025 }, { label: 'SNIES 2024', year: 2024 }] }), [
      'Merco Talento 2025',
      'SNIES 2024',
    ]);
  });
  it('lee fichas y paquetes guardados sin romperse con datos raros', () => {
    const brief = mapBriefRow({ id: 'b', account_id: 'a', status: 'raro', facts: [{ id: 'F1', topic: 'talent', statement: 's' }, { foo: 1 }], created_at: TODAY });
    assert.equal(brief.status, 'failed');
    assert.equal(brief.facts.length, 1);
    const pack = mapPackRow({ id: 'p', account_id: 'a', status: 'draft', channel: 'fax', goal: 'x', pack: {}, created_at: TODAY });
    assert.equal(pack.channel, 'call');
    assert.equal(pack.content, null);
  });
});

describe('solicitud del navegador', () => {
  it('valida y completa con valores por defecto', () => {
    const parsed = parseFirstCallRequest({ accountId: '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f', channel: 'whatsapp' });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.request.goal, 'book_meeting');
      assert.deepEqual(parsed.request.contactIds, []);
      assert.deepEqual(parsed.request.channels, ['whatsapp']);
      assert.deepEqual(parsed.request.productKeys, []);
      assert.equal(parsed.request.refreshResearch, false);
    }
  });
  it('rechaza un canal o producto desconocido', () => {
    assert.equal(parseFirstCallRequest({ accountId: '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f', channel: 'fax' }).ok, false);
    assert.equal(
      parseFirstCallRequest({ accountId: '7d2b8c5e-1f3a-4b6c-9d8e-0a1b2c3d4e5f', channel: 'call', productFocus: 'magia' }).ok,
      false,
    );
  });
});
