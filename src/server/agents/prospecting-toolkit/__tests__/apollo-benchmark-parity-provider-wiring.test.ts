/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 — el cableado real del provider:
 * volumen pagado, memoria provider-seen y embudo, en la MISMA fila de uso.
 *
 * Offline y determinista: transporte, reloj, logger y escritor de memoria se
 * inyectan. 0 llamadas a Apollo, 0 créditos, 0 base de datos, 0 flags nuevos.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchDeps,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloPageFetchResult } from '../apollo-organizations-paginated-search';
import type { WebSearchInput } from '../types';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { ProviderSeenWriteInput } from '@/server/prospect-batches/provider-seen/provider-seen-store';

const TOUCHED_ENV = [
  'ENABLE_APOLLO_COMPANY_SEARCH',
  'ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE',
] as const;
const SAVED = new Map(TOUCHED_ENV.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of TOUCHED_ENV) {
    const saved = SAVED.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

const INPUT: WebSearchInput = {
  query: 'supermercados colombia',
  country: 'Colombia',
  countryCode: 'CO',
  industry: 'Retail y Consumo',
  maxResults: 3,
  provider: 'apollo_organizations',
};

/**
 * Cinco supermercados reales. AGENT1-APOLLO-NET-NEW-PAGINATION § 9 — con
 * per_page=100 por defecto, `maxCandidates` (100) ya no trunca 5 resultados:
 * los cinco se recogen y se devuelven. El tope local sigue existiendo como
 * mecanismo, pero ya no se dispara con 5 resultados en una sola página.
 */
function fivePage(): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: Array.from({ length: 5 }, (_, i) => ({
        id: `org-super-${i}`,
        name: `Supermercados Del Valle ${i} S.A.`,
        primary_domain: `supermercado-${i}.com.co`,
        industry: 'supermarket',
        keywords: ['supermercado', 'grocery retail'],
        short_description: 'Cadena de supermercados en Colombia',
        estimated_num_employees: 1200,
        country: 'Colombia',
      })),
      pagination: { page: 1, per_page: 3, total_entries: 5, total_pages: 2 },
    },
    headers: null,
  };
}

type Captured = {
  logs: LogProviderUsageInput[];
  seenWrites: ProviderSeenWriteInput[];
  deps: ApolloOrgsSearchDeps;
};

function makeDeps(page: () => ApolloPageFetchResult = fivePage): Captured {
  const captured: Captured = { logs: [], seenWrites: [], deps: {} };
  captured.deps = {
    fetchPage: async () => page(),
    logUsage: async (input: LogProviderUsageInput) => {
      captured.logs.push(input);
      return { kind: 'logged' as const };
    },
    recordProviderSeen: async (input) => {
      captured.seenWrites.push(input);
      return {
        written: true,
        skippedReason: null,
        newIdsRecorded: input.observations.length,
        newDomainsRecorded: input.observations.length,
        refreshedCount: 0,
      };
    },
    now: () => 0,
    random: () => 0,
    sleep: async () => undefined,
  };
  return captured;
}

async function run(captured: Captured) {
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  delete process.env.ENABLE_APOLLO_ORGANIZATION_ENRICHMENT_CASCADE;
  return runApolloOrganizationsSearch(
    INPUT,
    3,
    { batchId: null, agentRunId: null },
    captured.deps,
  );
}

describe('P0-4 · la fila de uso declara el volumen PAGADO y los créditos por página, no lo recogido', () => {
  it('Apollo devolvió 5 en 1 página, sin tope local, y la fila dice 5 filas / 1 crédito', async () => {
    const captured = makeDeps();
    const out = await run(captured);

    const searchLog = captured.logs.find((log) => log.operation_key === 'organizations_search');
    assert.ok(searchLog, 'hay fila de organizations_search');
    assert.equal(searchLog.results_returned, 5, 'el volumen devuelto por el proveedor');

    // AGENT1-APOLLO-NET-NEW-PAGINATION § 9 — con per_page=100 por defecto, 5
    // resultados en una página no disparan el tope local (100): se recogen
    // los 5, sin truncar.
    const diagnostics = (out.metadata as Record<string, unknown>)
      .apollo_result_diagnostics as Record<string, unknown>;
    assert.equal(diagnostics['collected_after_local_filters'], 5);
    assert.equal(diagnostics['paid_results_volume'], 5);
  });

  it('los créditos y el costo se derivan de la página, no del volumen de filas', async () => {
    const captured = makeDeps();
    await run(captured);

    const searchLog = captured.logs.find((log) => log.operation_key === 'organizations_search')!;
    // AGENT1-APOLLO-NET-NEW-PAGINATION § 4/§ 5 — 1 crédito por página NO VACÍA,
    // sin importar cuántas filas traiga: 5 filas en 1 página siguen costando 1.
    assert.equal(searchLog.credits_used, 1, '1 crédito por página, no por resultado devuelto');
    assert.ok(
      typeof searchLog.estimated_cost_usd === 'number' && searchLog.estimated_cost_usd > 0,
    );
    assert.equal(searchLog.estimated_cost_usd, 1 * 0.00875);
  });

  it('el bloque de volumen declara que el proveedor NO reportó la factura', async () => {
    const captured = makeDeps();
    const out = await run(captured);

    for (const container of [
      captured.logs.find((log) => log.operation_key === 'organizations_search')!
        .metadata as Record<string, unknown>,
      out.metadata as Record<string, unknown>,
    ]) {
      const block = container['apollo_paid_volume'] as Record<string, unknown>;
      assert.equal(block['paid_results_volume'], 5);
      assert.equal(block['credits_charged'], 1);
      assert.equal(block['collected_after_local_filters'], 5);
      assert.equal(block['discarded_by_local_dedupe_or_truncation'], 0);
      assert.equal(block['provider_reported'], false);
    }
  });
});

describe('P0-2 · la memoria ve las cinco', () => {
  it('el escritor recibe las 5 identidades pagadas', async () => {
    const captured = makeDeps();
    const out = await run(captured);

    assert.equal(captured.seenWrites.length, 1);
    assert.equal(captured.seenWrites[0]!.observations.length, 5);
    assert.equal(out.results.length, 5, 'y el provider ya no trunca localmente a 3');

    const block = (out.metadata as Record<string, unknown>)['apollo_provider_seen'] as Record<
      string,
      unknown
    >;
    assert.equal(block['identities_presented'], 5);
    assert.equal(block['unique_identities'], 5);
    assert.equal(block['write_failures'], 0);
  });

  it('la corrida sobrevive a un escritor que lanza y lo deja contado', async () => {
    const captured = makeDeps();
    captured.deps.recordProviderSeen = async () => {
      throw new Error('memoria caída');
    };

    const out = await run(captured);

    assert.equal(out.skipped, false, 'la búsqueda pagada no se pierde');
    assert.equal(out.results.length, 5);
    const block = (out.metadata as Record<string, unknown>)['apollo_provider_seen'] as Record<
      string,
      unknown
    >;
    assert.equal(block['write_failures'], 1);
    assert.equal(block['write_skipped_reason'], 'record_threw');
  });
});

describe('P1-3 · el embudo viaja en la misma fila que la correlación', () => {
  it('publica lo observable y deja en null lo que no puede medir', async () => {
    const captured = makeDeps();
    await run(captured);

    const searchLog = captured.logs.find((log) => log.operation_key === 'organizations_search')!;
    const funnel = (searchLog.metadata as Record<string, unknown>)[
      'apollo_benchmark_funnel'
    ] as Record<string, unknown>;

    assert.equal(funnel['paid_raw'], 5);
    assert.equal(funnel['unique'], 5);
    assert.equal(funnel['duplicate'], 0);
    assert.equal(typeof funnel['precision_rejected'], 'number');

    assert.equal(funnel['provider_seen_hit'], null);
    assert.equal(funnel['historical_known'], null);
    assert.equal(funnel['accepted_for_target'], null);
    assert.deepEqual(funnel['fields_missing'], [
      'provider_seen_hit',
      'historical_known',
      'accepted_for_target',
    ]);
  });

  it('la correlación de la fila sigue siendo la canónica: `usage_key` y `batch_id`', async () => {
    const captured = makeDeps();
    await run(captured);

    const searchLog = captured.logs.find((log) => log.operation_key === 'organizations_search')!;
    assert.ok(typeof searchLog.usage_key === 'string' && searchLog.usage_key.length > 0);
    assert.equal(searchLog.provider_key, 'apollo');
    // 🔴 El embudo NO trae su propia identidad de corrida: reutiliza la de la fila.
    const funnel = (searchLog.metadata as Record<string, unknown>)[
      'apollo_benchmark_funnel'
    ] as Record<string, unknown>;
    for (const forbidden of ['wizard_run_id', 'batch_id', 'reservation_id', 'usage_key']) {
      assert.equal(funnel[forbidden], undefined, `el embudo no duplica ${forbidden}`);
    }
  });
});
