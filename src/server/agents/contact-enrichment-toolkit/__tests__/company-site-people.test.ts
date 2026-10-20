import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_SITE_PEOPLE_TOOL,
  pickPeoplePages,
  sitePeopleSubmission,
  toCompanySiteRows,
  verifySitePeople,
  type CompanySiteDocument,
} from '../company-site-people-core';
import { runCompanySiteStage, type CompanySiteStageDeps, type CompanySiteUsage } from '../company-site-stage.server';
import type { CompanySiteCandidateRow } from '../company-site-people-core';
import type { SafePageFetchResult } from '../../prospecting-toolkit/website-verifier';
import { AnthropicApiError } from '../../prospecting-toolkit/claude-classifier/anthropic-messages-client';

const HOME = `
  <a href="/nosotros">Nosotros</a>
  <a href="https://www.acme.co/equipo-directivo">Nuestro equipo</a>
  <a href="/sala-de-prensa">Prensa</a>
  <a href="/informe-sostenibilidad">Informe de sostenibilidad</a>
  <a href="/catalogo.pdf">Catálogo</a>
  <a href="https://otro.com/equipo">Otra empresa</a>
  <a href="mailto:hola@acme.co">Escríbenos</a>
  <a href="/tienda">Tienda</a>`;

describe('Sitio de la empresa — qué páginas leer', () => {
  it('prioriza equipo/dirección, luego «nosotros», sostenibilidad y prensa; nunca otros dominios ni archivos', () => {
    const pages = pickPeoplePages(HOME, 'https://www.acme.co/');
    assert.deepEqual(pages, [
      'https://www.acme.co/equipo-directivo',
      'https://www.acme.co/nosotros',
      'https://www.acme.co/informe-sostenibilidad',
      'https://www.acme.co/sala-de-prensa',
    ]);
  });
  it('respeta el tope y no rompe con HTML o URL inválidos', () => {
    assert.equal(pickPeoplePages(HOME, 'https://www.acme.co/', 2).length, 2);
    assert.deepEqual(pickPeoplePages(HOME, 'no-es-url'), []);
    assert.deepEqual(pickPeoplePages('', 'https://acme.co'), []);
  });
});

const DOCS: CompanySiteDocument[] = [
  {
    docId: 'D1',
    url: 'https://www.acme.co/equipo-directivo',
    text: 'Equipo directivo. Laura Gómez Pérez, Gerente de Gestión Humana, lidera la cultura. Carlos Ruiz es nuestro Gerente General. Ana Torres, Directora Financiera.',
  },
];

describe('Sitio de la empresa — verificación de cada persona', () => {
  it('sólo pasa quien está en la página, con la cita que lo nombra y un cargo del perfil de UBITS', () => {
    const result = verifySitePeople(
      [
        { full_name: 'Laura Gómez Pérez', title: 'Gerente de Gestión Humana', doc_id: 'D1', quote: 'Laura Gómez Pérez, Gerente de Gestión Humana, lidera la cultura.' },
        { full_name: 'Carlos Ruiz', title: 'Gerente General', doc_id: 'D1', quote: 'Carlos Ruiz es nuestro Gerente General.' },
        { full_name: 'Ana Torres', title: 'Directora Financiera', doc_id: 'D1', quote: 'Ana Torres, Directora Financiera.' },
        { full_name: 'Pedro Inventado', title: 'Director de Talento', doc_id: 'D1', quote: 'Pedro Inventado dirige Talento.' },
        { full_name: 'Laura Gómez Pérez', title: 'Gerente de Gestión Humana', doc_id: 'D1', quote: 'Laura Gómez Pérez, Gerente de Gestión Humana' },
        { full_name: 'Marta Díaz', title: 'Directora de Personas', doc_id: 'D1', quote: 'Equipo directivo.' },
        { full_name: 'Solo', title: 'CEO', doc_id: 'D1', quote: 'Carlos Ruiz es nuestro Gerente General.' },
        { full_name: 'Carlos Ruiz', title: 'Gerente General', doc_id: 'D9', quote: 'Carlos Ruiz es nuestro Gerente General.' },
      ],
      DOCS,
    );
    assert.deepEqual(result.people.map((p) => p.fullName), ['Laura Gómez Pérez', 'Carlos Ruiz']);
    assert.equal(result.rejected.notRelevant, 1);
    assert.equal(result.rejected.notInDocument, 2);
    assert.equal(result.rejected.duplicate, 1);
    assert.equal(result.rejected.nameNotInQuote, 1);
    assert.equal(result.rejected.incompleteName, 1);
    assert.equal(result.people[0].url, DOCS[0].url);
  });

  it('la cita se compara sin tildes, mayúsculas ni comillas', () => {
    const result = verifySitePeople(
      [{ full_name: 'Laura Gomez Perez', title: 'Gerente de Gestion Humana', doc_id: 'D1', quote: '«LAURA GOMEZ PEREZ, Gerente de Gestion Humana»' }],
      DOCS,
    );
    assert.equal(result.people.length, 1);
  });

  it('lee la entrega de la herramienta y nada más', () => {
    assert.deepEqual(sitePeopleSubmission([{ type: 'text' }]), []);
    assert.deepEqual(sitePeopleSubmission([{ type: 'tool_use', name: COMPANY_SITE_PEOPLE_TOOL, input: { people: [1] } }]), [1]);
  });

  it('las filas no traen correo ni teléfono, guardan la página y la cita, y no repiten a quien ya está', () => {
    const verified = verifySitePeople(
      [
        { full_name: 'Laura Gómez Pérez', title: 'Gerente de Gestión Humana', doc_id: 'D1', quote: 'Laura Gómez Pérez, Gerente de Gestión Humana' },
        { full_name: 'Carlos Ruiz', title: 'Gerente General', doc_id: 'D1', quote: 'Carlos Ruiz es nuestro Gerente General.' },
      ],
      DOCS,
    ).people;
    const rows = toCompanySiteRows(verified, ['carlos ruiz']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].full_name, 'Laura Gómez Pérez');
    assert.equal(rows[0].email, null);
    assert.equal(rows[0].phone, null);
    assert.equal(rows[0].source, 'manual');
    assert.deepEqual((rows[0].enrichment_metadata as { company_site: unknown }).company_site, {
      url: DOCS[0].url,
      quote: 'Laura Gómez Pérez, Gerente de Gestión Humana',
    });
  });
});

function page(url: string, html: string | null, status = 200): SafePageFetchResult {
  return { requestedUrl: url, finalUrl: url, httpStatus: status, redirected: false, html, error: null };
}

const LONG = ' Somos una empresa con más de 30 años acompañando a nuestros clientes en toda la región.'.repeat(4);

function stageHarness(over: Partial<CompanySiteStageDeps> = {}) {
  const calls = { inserted: [] as CompanySiteCandidateRow[], usage: [] as CompanySiteUsage[], recorded: [] as Array<Record<string, unknown>>, claude: 0 };
  const deps: CompanySiteStageDeps = {
    loadRun: async () => ({ accountId: 'acc-1', companyName: 'Acme', companyDomain: 'acme.co', countryCode: 'CO', status: 'completed' }),
    isBudgetAvailable: async () => true,
    resolveModel: async () => ({ apiKey: 'k', model: 'claude-sonnet-4-5' }),
    fetchPage: async (url) =>
      url === 'https://acme.co'
        ? page(url, `<p>${LONG}</p><a href="/equipo">Equipo</a>`)
        : page(url, `<p>${LONG} Laura Gómez Pérez, Gerente de Gestión Humana.</p>`),
    runConversation: async () => {
      calls.claude += 1;
      return {
        content: [
          {
            type: 'tool_use',
            name: COMPANY_SITE_PEOPLE_TOOL,
            input: { people: [{ full_name: 'Laura Gómez Pérez', title: 'Gerente de Gestión Humana', doc_id: 'D2', quote: 'Laura Gómez Pérez, Gerente de Gestión Humana.' }] },
          },
        ],
        stopReason: 'tool_use',
        usage: { inputTokens: 4000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 },
        requests: 1,
      } as never;
    },
    loadKnownNames: async () => [],
    insertRows: async (_id, rows) => {
      calls.inserted.push(...rows);
      return {};
    },
    recordOnRun: async (_id, block) => {
      calls.recorded.push(block);
    },
    logUsage: async (usage) => {
      calls.usage.push(usage);
    },
    now: () => 1000,
    ...over,
  };
  return { deps, calls };
}

describe('Sitio de la empresa — etapa', () => {
  it('lee portada y equipo, inserta a la persona verificada y registra el costo de Claude', async () => {
    const { deps, calls } = stageHarness();
    const result = await runCompanySiteStage({ attemptId: 'a1', triggeredBy: 'u1' }, deps);
    assert.deepEqual(result, { status: 'done', inserted: 1, pagesRead: 2, peopleFound: 1 });
    assert.equal(calls.inserted[0].full_name, 'Laura Gómez Pérez');
    assert.equal(calls.usage.length, 1);
    assert.equal(calls.usage[0].status, 'success');
    assert.ok(calls.usage[0].costUsd > 0);
    assert.equal(calls.recorded[0].candidates_inserted, 1);
  });

  it('sin presupuesto de IA no lee nada ni llama a Claude', async () => {
    const { deps, calls } = stageHarness({ isBudgetAvailable: async () => false });
    const result = await runCompanySiteStage({ attemptId: 'a1', triggeredBy: 'u1' }, deps);
    assert.equal(result.status, 'budget_blocked');
    assert.equal(calls.claude, 0);
  });

  it('sin dominio o con el sitio caído no llama a Claude', async () => {
    const noDomain = stageHarness({ loadRun: async () => ({ accountId: null, companyName: 'X', companyDomain: null, countryCode: null, status: 'completed' }) });
    assert.equal((await runCompanySiteStage({ attemptId: 'a1', triggeredBy: 'u1' }, noDomain.deps)).status, 'no_domain');
    const down = stageHarness({ fetchPage: async (url) => page(url, null, 503) });
    assert.equal((await runCompanySiteStage({ attemptId: 'a1', triggeredBy: 'u1' }, down.deps)).status, 'site_unreachable');
    assert.equal(down.calls.claude, 0);
  });

  it('si Claude falla a mitad de camino, registra lo que ya se gastó (nunca US$0 inventado)', async () => {
    const { deps, calls } = stageHarness({
      runConversation: async () => {
        throw new AnthropicApiError(529, 'overloaded', 'overloaded', {
          inputTokens: 3000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0,
        });
      },
    });
    const result = await runCompanySiteStage({ attemptId: 'a1', triggeredBy: 'u1' }, deps);
    assert.equal(result.status, 'error');
    assert.equal(calls.usage[0].status, 'error');
    assert.equal(calls.usage[0].inputTokens, 3000);
    assert.ok(calls.usage[0].costUsd > 0);
    assert.equal(calls.inserted.length, 0);
  });

  it('no repite a quien ya está en la empresa', async () => {
    const { deps, calls } = stageHarness({ loadKnownNames: async () => ['Laura Gómez Pérez'] });
    const result = await runCompanySiteStage({ attemptId: 'a1', triggeredBy: 'u1' }, deps);
    assert.equal(result.status === 'done' && result.inserted, 0);
    assert.equal(calls.inserted.length, 0);
  });
});
