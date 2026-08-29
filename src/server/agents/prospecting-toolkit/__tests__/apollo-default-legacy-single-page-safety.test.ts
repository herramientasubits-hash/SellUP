/**
 * AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE C — verifica el camino
 * DEFAULT/LEGACY (`ENABLE_APOLLO_TWO_ROUND_DISCOVERY=false`) contra la ruta REAL
 * de producción (no una reimplementación).
 *
 * `web-search-tool.ts` → `dispatchToProvider` (caso `apollo_organizations`)
 * llama a `runApolloOrganizationsSearch(input, maxResults, usageContext)` — SIN
 * un quinto argumento `options`. Ese es el llamador REAL del modo legacy; este
 * test lo replica exactamente (mismo número y orden de argumentos, mismo
 * `deps` como cuarto argumento, CERO `options`).
 *
 * `apollo-organizations-search-provider.ts` documenta la consecuencia: sin
 * `options.netNewTarget` + `options.evaluateCandidateAcceptance` (los DOS),
 * `netNewPaginationEnabled` es `false` y el presupuesto de paginación se
 * construye con `maxPages: 1` — fijo, sin importar cuántas páginas más declare
 * Apollo (`total_pages`). Esta prueba lo comprueba CONTRA EL COMPORTAMIENTO
 * REAL, no contra el comentario: inyecta un transporte que SIEMPRE tiene más
 * páginas disponibles (`total_pages: 500`) y confirma que el transporte se
 * invoca EXACTAMENTE una vez.
 *
 * Conclusión que esta prueba sostiene: el camino default es de una sola
 * página POR CONSTRUCCIÓN — no por falta de evidencia de lo contrario. La
 * valla durable de página (PARTE B del corte anterior) existe para proteger
 * una secuencia de VARIAS páginas dentro de una misma invocación; sin una
 * segunda página que replicar, no hay nada que la valla necesite cerrar aquí
 * (§ C1 del corte: "si el default es de una sola página, repórtalo, no hace
 * falta forzar la abstracción de valla").
 *
 * Offline por construcción: transporte inyectado. LIVE_APOLLO_CALLS = 0,
 * APOLLO_CREDITS_USED = 0.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloPageFetchResult } from '../apollo-organizations-paginated-search';

function multiPageAvailablePayload(page: number): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: 100 }, (_unused, i) => ({
        id: `org_p${page}_${i}`,
        name: `Empresa ${page}-${i}`,
        primary_domain: `empresa-${page}-${i}.com`,
      })),
      // 🔴 Apollo declara 500 páginas más disponibles. Si el default pudiera
      // paginar, tendría motivo de sobra para pedir una segunda.
      pagination: { page, per_page: 100, total_entries: 50_000, total_pages: 500 },
    },
    headers: null,
  };
}

describe('AGENT1-APOLLO-FINAL-SAFETY-CLOSURE § C · el camino default es de una sola página', () => {
  before(() => { process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true'; });
  after(() => { delete process.env.ENABLE_APOLLO_COMPANY_SEARCH; });

  it('D6 — llamador REAL de dispatchToProvider (sin `options`): 1 sola llamada al transporte pese a total_pages=500', async () => {
    let transportCalls = 0;
    const deps: ApolloOrgsSearchDeps = {
      fetchPage: async () => {
        transportCalls += 1;
        return multiPageAvailablePayload(transportCalls);
      },
      logUsage: async () => ({ kind: 'logged' as const }),
    };

    // Firma EXACTA de `dispatchToProvider`:
    // `runApolloOrganizationsSearch(input, maxResults, usageContext ?? undefined)`
    // — este test añade `deps` (4º argumento) SÓLO para inyectar el
    // transporte; el legacy real usa el transporte HTTP real en ese lugar.
    // El punto de la prueba — CERO `options` (5º argumento) — es idéntico.
    const output = await runApolloOrganizationsSearch(
      { query: 'supermercados Colombia' },
      100,
      undefined,
      deps,
    );

    assert.equal(
      transportCalls,
      1,
      `el camino default pidió ${transportCalls} páginas; el contrato (sin netNewTarget/evaluateCandidateAcceptance) es EXACTAMENTE 1`,
    );
    assert.equal(output.skipped, false);
    assert.equal(output.results.length, 100, 'la única página sí se procesa por completo');
  });

  it('control — CON netNewTarget + evaluateCandidateAcceptance el mismo transporte SÍ pagina (confirma que el límite es una decisión, no un techo físico)', async () => {
    let transportCalls = 0;
    const deps: ApolloOrgsSearchDeps = {
      fetchPage: async () => {
        transportCalls += 1;
        return multiPageAvailablePayload(transportCalls);
      },
      logUsage: async () => ({ kind: 'logged' as const }),
    };

    await runApolloOrganizationsSearch(
      { query: 'supermercados Colombia' },
      100,
      undefined,
      deps,
      {
        netNewTarget: 250,
        evaluateCandidateAcceptance: () => true,
      },
    );

    assert.ok(
      transportCalls > 1,
      'con la autoridad de negocio inyectada, el MISMO transporte sí pagina — la ruta default se queda en 1 por construcción, no por incapacidad del motor',
    );
  });
});
