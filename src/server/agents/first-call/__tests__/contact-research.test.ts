/**
 * AGENT3-CONTACT-RESEARCH-1 — investigación del decisor (dueña 18-10): sólo lo
 * profesional y público, con cita que lo nombra; Tavily y, si no está, Claude.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY_USAGE, type AnthropicContentBlock, type AnthropicRequestBody } from '../../prospecting-toolkit/claude-classifier/anthropic-messages-client';
import {
  CONTACT_RESEARCH_TOOL,
  cachedContactResearch,
  buildContactResearchSystemPrompt,
  contactDocuments,
  contactSearchPlan,
  contactSearchQueries,
  mentionsCompany,
  mentionsPerson,
  normalizeLinkedinUrl,
  researchContact,
  type ContactResearchDeps,
} from '../contact-research';
import type { NewsSearchOutput } from '../research-documents';

const TARGET = { id: 'c1', name: 'Liliana Reyes', title: 'Human Resources Director', department: null };
const USAGE = { ...EMPTY_USAGE, inputTokens: 1000, outputTokens: 200 };

const NOMBRAMIENTO =
  'Asdeporte nombró a Liliana Reyes como directora de Recursos Humanos en septiembre de 2026, a cargo de talento y formación.';

function submit(facts: Array<Record<string, unknown>>, leads = 'yes', extra: Record<string, unknown> = {}): AnthropicContentBlock[] {
  return [
    {
      type: 'tool_use',
      id: 't1',
      name: CONTACT_RESEARCH_TOOL,
      input: {
        facts,
        leads_training: leads,
        best_hook: 'Llegó en septiembre a dirigir RR. HH.: buen momento para revisar cómo se forma a la gente nueva.',
        likely_priorities: ['Probablemente ordenar la inducción en varias sedes.'],
        unknowns: ['Si maneja el presupuesto de formación.'],
        ...extra,
      },
    } as unknown as AnthropicContentBlock,
  ];
}

function deps(overrides: Partial<ContactResearchDeps> & { content?: AnthropicContentBlock[] } = {}) {
  const bodies: AnthropicRequestBody[] = [];
  const searches: string[] = [];
  const d: ContactResearchDeps = {
    checkBudget: async () => ({ allowed: true }),
    searchNews: async (input) => {
      searches.push(input.query);
      const out: NewsSearchOutput = {
        results: [
          { url: 'https://noticias.example/rh', title: 'Nuevo liderazgo en Asdeporte', content: NOMBRAMIENTO, publishedOn: '2026-09-20' },
          { url: 'https://otra.example/x', title: 'Liliana Torres gana premio', content: 'Liliana Torres, de otra empresa, ganó un premio de atletismo en Lima este año.', publishedOn: null },
          { url: 'https://facebook.com/liliana.reyes', title: 'Liliana Reyes', content: 'Fotos de Liliana Reyes con su familia en vacaciones, muy contenta.', publishedOn: null },
        ],
        credits: 1,
        skipped: false,
        error: null,
      };
      return out;
    },
    runConversation: async (body) => {
      bodies.push(body);
      return {
        content:
          overrides.content ??
          submit([
            {
              category: 'new_in_role',
              doc_id: 'D1',
              quote: 'Asdeporte nombró a Liliana Reyes como directora de Recursos Humanos',
              statement: 'Llegó en septiembre de 2026 como directora de RR. HH.',
              published_on: '2026-09-20',
            },
          ]),
        usage: USAGE,
      };
    },
    ...overrides,
  };
  return { d, bodies, searches };
}

const base = { target: TARGET, companyName: 'Asdeporte', countryName: 'México', countryCode: 'MX', apiKey: 'k', model: 'claude-haiku', today: '2026-10-18' };

describe('investigación del decisor', () => {
  it('sólo documentos que lo nombran: fuera homónimos y redes personales', () => {
    assert.equal(mentionsPerson('Liliana Torres, otra persona', 'Liliana Reyes'), false);
    assert.equal(mentionsPerson('la directora Reyes dijo', 'Liliana Reyes'), true);
    const docs = contactDocuments(
      [
        { url: 'https://noticias.example/rh', title: null, content: NOMBRAMIENTO, publishedOn: null },
        { url: 'https://facebook.com/x', title: null, content: `${NOMBRAMIENTO} (copia en red personal)`, publishedOn: null },
        { url: 'https://www.linkedin.com/in/lreyes', title: 'Liliana Reyes - Asdeporte', content: 'Liliana Reyes. Directora de Recursos Humanos en Asdeporte. Ciudad de México.', publishedOn: null },
      ],
      'Liliana Reyes',
    );
    assert.deepEqual(docs.map((d) => d.label), ['Web · noticias.example', 'LinkedIn · perfil público']);
  });

  it('con Tavily: busca nombre + empresa, verifica la cita y no ofrece búsqueda web', async () => {
    const { d, bodies, searches } = deps();
    const found = await researchContact({ ...base, deps: d });
    assert.equal(searches[0], '"Liliana Reyes" "Asdeporte"');
    assert.match(searches[1], /"Liliana Reyes" entrevista OR podcast/);
    assert.equal(found.source, 'tavily');
    assert.equal(found.facts.length, 1);
    assert.equal(found.facts[0].topic, 'decision_maker');
    assert.equal(found.facts[0].publishedOn, '2026-09-20');
    assert.equal(found.insight.leadsTraining, 'yes');
    assert.equal(found.facts[0].category, 'new_in_role');
    assert.match(found.insight.hook ?? '', /Llegó en septiembre/);
    assert.equal(found.insight.priorities.length, 1);
    assert.equal(found.insight.unknowns.length, 1);
    assert.equal((bodies[0].tools as Array<{ type?: string }>).some((t) => t.type === 'web_search_20250305'), false);
  });

  it('una cita que no está en la fuente, o que no nombra a la persona, no pasa', async () => {
    const { d } = deps({
      content: submit([
        { doc_id: 'D1', quote: 'Liliana Reyes fue premiada como mejor directora del país', statement: 'Premiada.' },
        { doc_id: 'D1', quote: 'a cargo de talento y formación', statement: 'Lleva talento y formación.' },
      ]),
    });
    const found = await researchContact({ ...base, deps: d });
    assert.equal(found.facts.length, 0);
    assert.equal(found.insight.hook, null, 'un gancho sin datos que lo respalden no se ofrece');
  });

  it('sin Tavily (presupuesto o créditos del mes): Claude busca una vez en la web', async () => {
    const { d, bodies, searches } = deps({ checkBudget: async (p) => ({ allowed: p !== 'tavily' }) });
    await researchContact({ ...base, deps: d });
    assert.deepEqual(searches, [], 'no se llama a Tavily');
    const web = (bodies[0].tools as Array<{ type?: string; max_uses?: number }>).find((t) => t.type === 'web_search_20250305');
    assert.equal(web?.max_uses, 2);
    assert.equal(bodies[0].tool_choice, undefined, 'con búsqueda web el modelo decide cuándo entregar');
  });

  it('Tavily con error (sin créditos): también usa el respaldo', async () => {
    const { d, bodies } = deps({ searchNews: async () => ({ results: [], credits: null, skipped: false, error: 'tavily_http_432' }) });
    const found = await researchContact({ ...base, deps: d });
    assert.equal(found.tavily.error, 'tavily_http_432');
    assert.ok((bodies[0].tools as Array<{ type?: string }>).some((t) => t.type === 'web_search_20250305'));
  });

  it('si Claude falla, la preparación sigue sin datos del decisor', async () => {
    const { d } = deps({
      runConversation: async () => {
        throw Object.assign(new Error('overloaded'), { code: 'http_529', partialUsage: null });
      },
    });
    const found = await researchContact({ ...base, deps: d });
    assert.deepEqual(found.facts, []);
    assert.equal(found.errorCode, 'http_529');
  });

  it('Asdeporte (19-10): con su LinkedIn de SellUp busca también su perfil y lo reconoce como suyo', async () => {
    assert.equal(normalizeLinkedinUrl('https://www.linkedin.com/in/Liliana-Reyes-123/?trk=x'), 'linkedin.com/in/liliana-reyes-123');
    assert.equal(contactSearchQueries('Liliana Reyes', 'Asdeporte').length, 2);
    // Tavily no admite `site:`: la búsqueda en LinkedIn va con include_domains.
    const withLinkedin = contactSearchPlan('Liliana Reyes', 'Asdeporte', 'https://linkedin.com/in/x');
    assert.deepEqual(withLinkedin[2], { query: '"Liliana Reyes" "Asdeporte"', includeDomains: ['linkedin.com'] });
    assert.equal(withLinkedin.some((q) => q.query.includes('site:')), false);
    const docs = contactDocuments(
      [{ url: 'https://mx.linkedin.com/in/liliana-reyes-123', title: 'Liliana Reyes - Asdeporte', content: 'Liliana Reyes. Directora de Recursos Humanos en Asdeporte desde 2024.', publishedOn: null }],
      'Liliana Reyes',
      'https://www.linkedin.com/in/liliana-reyes-123/',
    );
    assert.equal(docs[0].label, 'LinkedIn · su perfil (el de SellUp)');

    const { d, bodies, searches } = deps();
    await researchContact({ ...base, target: { ...TARGET, linkedinUrl: 'https://www.linkedin.com/in/liliana-reyes-123/' }, deps: d });
    assert.equal(searches.length, 3);
    assert.match(bodies[0].messages[0].content as string, /Su perfil de LinkedIn \(en SellUp\)/);
  });

  it('con sólo homónimos, no los menciona: lo dice el sistema', () => {
    assert.match(buildContactResearchSystemPrompt(), /homónimos, NO los menciones/);
  });
});

describe('lo del decisor guardado en una preparación', () => {
  const fact = (id: string, topic: string, sourceKind: string) =>
    ({ id, topic, statement: 's', quote: 'q', sourceKind, sourceUrl: null, sourceLabel: '', publishedOn: null }) as never;

  it('reutiliza sólo lo que guardó SU investigación, con su fecha y sin ids', () => {
    const content = { contactResearch: { facts: [fact('C1', 'decision_maker', 'news')], researchedAt: '2026-10-10T00:00:00Z' }, contactInsight: undefined };
    const cached = cachedContactResearch(content, '2026-10-05T00:00:00Z');
    assert.equal(cached?.facts.length, 1);
    assert.equal('id' in (cached!.facts[0] as object), false);
    assert.equal(cached?.researchedAt, '2026-10-10T00:00:00Z');
    assert.equal(cached?.insight.leadsTraining, 'unknown');
  });

  it('vencida (investigada antes del corte) no sirve, aunque la preparación sea nueva', () => {
    const content = { contactResearch: { facts: [fact('C1', 'decision_maker', 'news')], researchedAt: '2026-09-01T00:00:00Z' } };
    assert.equal(cachedContactResearch(content, '2026-10-05T00:00:00Z'), null);
  });

  it('sin investigación propia de la persona no hay caché (los datos de la ficha de la empresa no cuentan)', () => {
    assert.equal(cachedContactResearch({ contactInsight: { hook: null, priorities: [], unknowns: [], leadsTraining: 'unknown' } }, '2026-10-05T00:00:00Z'), null);
    assert.equal(cachedContactResearch({ contactResearch: { facts: [], researchedAt: '2026-10-10T00:00:00Z' } }, '2026-10-05T00:00:00Z'), null);
    assert.equal(cachedContactResearch(null, '2026-10-05T00:00:00Z'), null);
  });
});

describe('el decisor en la prensa y los medios de RR. HH. de su país (dueña 19-10)', () => {
  it('con fuentes del país suma una búsqueda ahí, que tiene que nombrar a la persona y a la empresa', async () => {
    const plan = contactSearchPlan('Liliana Reyes', 'Asdeporte', null, ['expansion.mx', 'amedirh.com.mx']);
    assert.deepEqual(plan[2], { query: '"Liliana Reyes"', includeDomains: ['expansion.mx', 'amedirh.com.mx'], requireCompany: true });

    const inputs: Array<{ query: string; includeDomains?: readonly string[] }> = [];
    const { d, bodies } = deps();
    const base2 = d.searchNews;
    d.searchNews = async (input) => {
      inputs.push(input);
      if (!input.includeDomains) return base2(input);
      return {
        results: [
          // Nombra a la persona y a la empresa: sirve.
          { url: 'https://expansion.mx/carrera/rh', title: 'Nombramientos', content: NOMBRAMIENTO.replace('https', ''), publishedOn: '2026-09-21' },
          // Una homónima en otra empresa: fuera, aunque sea un medio del país.
          { url: 'https://amedirh.com.mx/ponentes', title: 'Ponentes', content: 'Liliana Reyes, directora de talento de Grupo Bimbo, habló en el congreso de este año.', publishedOn: null },
        ],
        credits: 1,
        skipped: false,
        error: null,
      };
    };
    const found = await researchContact({ ...base, sourceDomains: ['expansion.mx', 'amedirh.com.mx'], deps: d });
    assert.equal(inputs.length, 3);
    assert.deepEqual(inputs[2].includeDomains, ['expansion.mx', 'amedirh.com.mx']);
    const message = bodies[0].messages[0].content as string;
    assert.match(message, /expansion\.mx\/carrera\/rh/);
    assert.doesNotMatch(message, /Grupo Bimbo/);
    assert.equal(found.tavily.credits, 3);
  });

  it('la empresa se reconoce por el núcleo del nombre, no por una palabra suelta', () => {
    assert.ok(mentionsCompany('El Banco Davivienda nombró a su nueva vicepresidenta de talento', 'Davivienda Colombia'));
    assert.ok(mentionsCompany('Grupo LALA anunció', 'Grupo LALA'));
    assert.equal(mentionsCompany('Daviplata lanzó una app', 'Davivienda Colombia'), false);
    assert.equal(mentionsCompany('El grupo anunció', 'Grupo LALA'), false);
  });
});
