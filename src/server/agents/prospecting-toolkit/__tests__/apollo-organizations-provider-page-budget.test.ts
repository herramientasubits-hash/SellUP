/**
 * A1-APOLLO-WIZARD-1R — El provider pide UNA página por invocación.
 *
 * Por qué existe:
 *   `AGENT1_APOLLO_MAX_QUERIES_PER_RUN` es el cap GLOBAL de queries por
 *   ejecución del wizard (v1.16K-AC, acumulado en incremental-search.ts), y el
 *   wizard reserva créditos como maxQueries × maxResults ANTES de ejecutar.
 *   Si el provider derivara `maxPages` de esa misma variable, una ejecución con
 *   la variable en 3 podría gastar 3 queries × 3 páginas × maxResults — el
 *   triple de lo reservado. Estas pruebas fijan la invariante: una invocación
 *   del provider = una query = una página, sin importar el valor de la env.
 *
 * Sin llamadas reales: el transporte se inyecta.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { WebSearchInput } from '../types';
import type { ApolloPageFetchResult } from '../apollo-organizations-paginated-search';

const BASE_INPUT: WebSearchInput = {
  query: 'empresa educacion colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Educación',
  maxResults: 5,
  provider: 'apollo_organizations',
};

/** Respuesta llena y con más páginas disponibles: nada la detendría salvo el tope. */
function fullPagePayload(page: number, perPage: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: perPage }, (_unused, index) => ({
        id: `org-p${page}-${index}`,
        name: `Colegio ${page}-${index}`,
        primary_domain: `colegio-${page}-${index}.edu.co`,
        industry: 'education',
        keywords: ['educación', 'colegio'],
        short_description: 'Institución educativa',
        estimated_num_employees: 300,
        country: 'Colombia',
      })),
      pagination: { page, per_page: perPage, total_entries: 5_000, total_pages: 100 },
    },
    headers: null,
  };
}

function trackingDeps(): { deps: ApolloOrgsSearchDeps; pages: number[] } {
  const pages: number[] = [];
  const deps: ApolloOrgsSearchDeps = {
    fetchPage: async (body) => {
      const page = Number(body.page ?? 0);
      const perPage = Number(body.per_page ?? 0);
      pages.push(page);
      return fullPagePayload(page, perPage);
    },
    logUsage: async () => ({ kind: 'ok' }) as never,
    now: () => 0,
    random: () => 0,
    sleep: async () => undefined,
  };
  return { deps, pages };
}

const TOUCHED_ENV = [
  'ENABLE_APOLLO_COMPANY_SEARCH',
  'AGENT1_APOLLO_MAX_QUERIES_PER_RUN',
  'AGENT1_APOLLO_MAX_RESULTS_PER_QUERY',
] as const;

afterEach(() => {
  for (const key of TOUCHED_ENV) delete process.env[key];
});

async function runWith(
  env: Partial<Record<(typeof TOUCHED_ENV)[number], string>>,
  maxResults: number,
): Promise<{ pages: number[]; metadata: Record<string, unknown> }> {
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  const { deps, pages } = trackingDeps();
  const out = await runApolloOrganizationsSearch(BASE_INPUT, maxResults, undefined, deps);
  return { pages, metadata: out.metadata as Record<string, unknown> };
}

describe('A1-APOLLO-WIZARD-1R · una invocación del provider = una página', () => {
  it('con la env por defecto pide exactamente la página 1', async () => {
    const { pages } = await runWith({}, 3);
    assert.deepEqual(pages, [1]);
  });

  it('con AGENT1_APOLLO_MAX_QUERIES_PER_RUN=3 sigue pidiendo una sola página', async () => {
    const { pages } = await runWith({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '3' }, 5);
    assert.deepEqual(
      pages,
      [1],
      'el cap global de queries no debe convertirse en páginas por query',
    );
  });

  it('el presupuesto de la invocación nunca excede maxResults créditos', async () => {
    const { metadata } = await runWith(
      { AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '3', AGENT1_APOLLO_MAX_RESULTS_PER_QUERY: '5' },
      5,
    );
    const pagination = metadata.apollo_pagination as Record<string, unknown>;

    assert.equal(pagination.max_pages, 1);
    assert.equal(pagination.pages_processed, 1);
    // AGENT1-APOLLO-NET-NEW-PAGINATION § 4 — Apollo cobra 1 crédito por página
    // no vacía, no por resultado: con maxPages=1 el techo de créditos de esta
    // invocación es 1, no `per_page × cap de queries`.
    assert.equal(
      pagination.max_credits,
      1,
      'el techo de créditos de una query es 1 por página, no per_page',
    );
    assert.ok(
      (pagination.estimated_credits as number) <= 1,
      `estimated_credits=${String(pagination.estimated_credits)} superó el techo de la query`,
    );
  });

  it('una página llena con total_pages=100 no encadena páginas adicionales', async () => {
    const { pages, metadata } = await runWith({ AGENT1_APOLLO_MAX_QUERIES_PER_RUN: '3' }, 5);
    const pagination = metadata.apollo_pagination as Record<string, unknown>;

    assert.equal(pages.length, 1);
    // Detenerse por páginas o por candidatos es equivalente aquí: ambos topes
    // salen del mismo presupuesto de una sola página. Lo que no debe ocurrir es
    // continuar porque `total_pages` diga que hay 100.
    assert.ok(
      ['max_pages_reached', 'candidate_target_reached', 'max_credits_reached'].includes(
        pagination.stop_reason as string,
      ),
      `stop_reason inesperado: ${String(pagination.stop_reason)}`,
    );
  });
});
