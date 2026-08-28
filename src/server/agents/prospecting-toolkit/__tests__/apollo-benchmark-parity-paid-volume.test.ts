/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P0-4 — el agregado sale del ledger POR
 * PÁGINA, no de la lista ya deduplicada y truncada.
 *
 * Offline y determinista. 0 créditos, 0 proveedores, 0 base de datos.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveApolloPaidResultsVolume,
  toApolloPaidVolumeMetadata,
  APOLLO_PAID_VOLUME_SOURCE,
  APOLLO_PAID_VOLUME_ESTIMATE_BASIS,
} from '../apollo-organizations-paid-volume';
import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';

let realFetchCalls = 0;
globalThis.fetch = (async (...args: unknown[]) => {
  realFetchCalls++;
  throw new Error(`LLAMADA REAL PROHIBIDA EN TESTS: ${String(args[0])}`);
}) as typeof globalThis.fetch;

beforeEach(() => {
  realFetchCalls = 0;
});

function okPage(organizations: Array<Record<string, unknown>>): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: { organizations },
    headers: null,
  };
}

const orgs = (count: number, offset = 0): Array<Record<string, unknown>> =>
  Array.from({ length: count }, (_, i) => ({
    id: `org_${offset + i}`,
    name: `Empresa ${offset + i}`,
    primary_domain: `empresa-${offset + i}.com`,
  }));

function harness(pages: ApolloPageFetchResult[]) {
  let clock = 0;
  let call = 0;
  return {
    fetchPage: async (): Promise<ApolloPageFetchResult> => {
      clock += 10;
      return pages[Math.min(call++, pages.length - 1)]!;
    },
    now: () => clock,
    random: () => 0.5,
    sleep: async () => {},
    providerSeenNow: () => '2026-08-20T00:00:00.000Z',
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_paid_volume',
  agentRunId: null,
};

// ─── A — dos páginas de 10 con tope 10 valen 20, no 10 ────────────────────────

describe('P0-4 · A — el agregado suma el volumen DEVUELTO, no el recogido', () => {
  it('page1=10 + page2=10 con maxCandidates=10 ⇒ 20', () => {
    const volume = resolveApolloPaidResultsVolume([
      { status: 'success', resultsReturned: 10, estimatedCredits: 1 },
      { status: 'success', resultsReturned: 10, estimatedCredits: 1 },
    ]);

    assert.equal(volume.resultsVolume, 20);
    assert.notEqual(volume.resultsVolume, 10, 'el defecto era declarar el volumen truncado');
    assert.equal(volume.pagesCounted, 2);
    assert.equal(volume.source, APOLLO_PAID_VOLUME_SOURCE);
  });

  it('extremo a extremo: el truncado local recorta lo recogido y NO el agregado', async () => {
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ perPage: 10, maxPages: 2, maxCandidates: 15 }),
      },
      harness([okPage(orgs(10)), okPage(orgs(10, 10))]),
    );

    const volume = resolveApolloPaidResultsVolume(result.pageOutcomes);
    assert.equal(result.organizations.length, 15, 'el tope local recortó lo recogido');
    assert.equal(volume.resultsVolume, 20, 'el proveedor devolvió 20 y eso es lo pagado');
    assert.equal(realFetchCalls, 0);
  });
});

// ─── B — una página 100% duplicada sigue contando su volumen ──────────────────

describe('P0-4 · B — el dedupe entre páginas no borra el cargo de la página 2', () => {
  it('page2 idéntica a page1 ⇒ recogido 3, agregado 6', async () => {
    const page = okPage(orgs(3));
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ perPage: 3, maxPages: 2, maxCandidates: 6 }),
      },
      harness([page, page]),
    );

    const volume = resolveApolloPaidResultsVolume(result.pageOutcomes);
    assert.equal(result.organizations.length, 3, 'el dedupe local hizo su trabajo');
    assert.equal(volume.resultsVolume, 6, 'pero las DOS páginas se pagaron');
    assert.equal(volume.pagesCounted, 2);
  });
});

// ─── C — una página vacía no inventa un cargo ─────────────────────────────────

describe('P0-4 · C — cero resultados es cero resultados, no un cargo fabricado', () => {
  it('una página exitosa y vacía aporta 0 y se cuenta como página', () => {
    const volume = resolveApolloPaidResultsVolume([
      { status: 'success', resultsReturned: 0, estimatedCredits: 0 },
    ]);
    assert.equal(volume.resultsVolume, 0);
    assert.equal(volume.pagesCounted, 1);
  });

  it('una página con error, con cuota agotada o indeterminada NO aporta volumen', () => {
    const volume = resolveApolloPaidResultsVolume([
      { status: 'error', resultsReturned: 0, estimatedCredits: 0 },
      { status: 'rate_limited', resultsReturned: 0, estimatedCredits: 0 },
      { status: 'indeterminate', resultsReturned: 0, estimatedCredits: 0 },
      { status: 'success', resultsReturned: 4, estimatedCredits: 1 },
    ]);
    assert.equal(volume.resultsVolume, 4);
    assert.equal(volume.pagesCounted, 1, 'sólo la exitosa entra en la suma');
  });

  it('sin páginas el agregado es 0 y no hay páginas contadas', () => {
    const volume = resolveApolloPaidResultsVolume([]);
    assert.equal(volume.resultsVolume, 0);
    assert.equal(volume.pagesCounted, 0);
  });
});

// ─── D — la forma histórica de UNA página no cambia ───────────────────────────

describe('P0-4 · D — una sola página sin truncado se comporta igual que antes', () => {
  it('el agregado coincide exactamente con lo recogido', async () => {
    const result = await runApolloOrganizationsPaginatedSearch(
      {
        ...baseInput,
        budget: createApolloPaginationBudget({ perPage: 5, maxPages: 1, maxCandidates: 5 }),
      },
      harness([okPage(orgs(5))]),
    );

    const volume = resolveApolloPaidResultsVolume(result.pageOutcomes);
    assert.equal(result.organizations.length, 5);
    assert.equal(volume.resultsVolume, 5, 'sin recorte, las dos cifras coinciden');
  });
});

// ─── La estimación se declara como tal ────────────────────────────────────────

describe('P0-4 · el modelo de facturación NO se afirma', () => {
  it('el bloque de metadata declara que el proveedor no lo reportó', () => {
    const volume = resolveApolloPaidResultsVolume([
      { status: 'success', resultsReturned: 7, estimatedCredits: 1 },
    ]);
    const metadata = toApolloPaidVolumeMetadata(volume, 3);

    assert.equal(metadata['paid_results_volume'], 7);
    assert.equal(metadata['collected_after_local_filters'], 3);
    assert.equal(metadata['discarded_by_local_dedupe_or_truncation'], 4);
    assert.equal(metadata['provider_reported'], false);
    assert.equal(metadata['estimate_basis'], APOLLO_PAID_VOLUME_ESTIMATE_BASIS);
    assert.ok(
      String(metadata['estimate_basis']).includes('unconfirmed'),
      'la etiqueta tiene que decir que el proveedor no lo ha confirmado',
    );
  });

  it('un recorte negativo nunca se publica', () => {
    const volume = resolveApolloPaidResultsVolume([
      { status: 'success', resultsReturned: 2, estimatedCredits: 1 },
    ]);
    assert.equal(toApolloPaidVolumeMetadata(volume, 5)['discarded_by_local_dedupe_or_truncation'], 0);
  });
});
