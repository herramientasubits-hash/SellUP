/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P1-1 — un costo DESCONOCIDO se escribe
 * como SQL NULL, jamás como 0.
 *
 * Offline y determinista: el cliente de inserción es un doble en memoria. Sin
 * base de datos, sin proveedor, sin créditos, sin migración.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderUsageLogRow,
  realLogApolloOrgsUsage,
  type ProviderUsageInsertClient,
} from '../apollo-organizations-usage-logging';
import { buildApolloEnrichmentUsageLogInput } from '../apollo-organization-enrichment-usage-log';
import { resolveApolloEnrichmentUsageAccounting } from '../apollo-organization-enrichment-usage-log';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

function baseInput(overrides: Partial<LogProviderUsageInput>): LogProviderUsageInput {
  return {
    provider_key: 'apollo',
    operation_key: 'organization_enrichment',
    usage_key: 'apollo_test_key',
    credits_used: 1,
    results_returned: 1,
    status: 'success',
    metadata: {},
    ...overrides,
  } as LogProviderUsageInput;
}

function captureClient(): { rows: Array<Record<string, unknown>>; client: ProviderUsageInsertClient } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    client: {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            rows.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
}

describe('P1-1 · el contrato de costo desconocido', () => {
  it('null EXPLÍCITO se preserva como null', () => {
    const row = buildProviderUsageLogRow(baseInput({ estimated_cost_usd: null }));
    assert.equal(row['estimated_cost_usd'], null);
    assert.notEqual(row['estimated_cost_usd'], 0, 'el defecto era colapsar a 0');
  });

  it('un cero CONOCIDO sigue siendo 0', () => {
    const row = buildProviderUsageLogRow(baseInput({ estimated_cost_usd: 0 }));
    assert.equal(row['estimated_cost_usd'], 0);
  });

  it('un valor positivo pasa tal cual', () => {
    const row = buildProviderUsageLogRow(baseInput({ estimated_cost_usd: 0.0125 }));
    assert.equal(row['estimated_cost_usd'], 0.0125);
  });

  it('omitido (undefined) conserva la semántica histórica de 0', () => {
    const input = baseInput({});
    delete (input as unknown as Record<string, unknown>)['estimated_cost_usd'];
    const row = buildProviderUsageLogRow(input);
    assert.equal(row['estimated_cost_usd'], 0, 'undefined NO cambia de significado en este corte');
  });
});

describe('P1-1 · la ruta real de Apollo company discovery', () => {
  it('un enrichment SIN tarifa viva deja la fila con estimated_cost_usd NULL', async () => {
    const { rows, client } = captureClient();

    const input = buildApolloEnrichmentUsageLogInput({
      usageKey: 'organization_enrichment:batch_1:demo.com',
      batchId: null,
      domain: 'demo.com',
      // 🔴 Éste es el null explícito que la ruta produce cuando
      // `provider_pricing_config` no tiene tarifa activa.
      unitCostUsd: null,
      accounting: resolveApolloEnrichmentUsageAccounting('charged'),
    });

    assert.equal(input.estimated_cost_usd, null, 'el constructor ya declara el costo desconocido');

    const result = await realLogApolloOrgsUsage(input, { client });
    assert.equal(result.kind, 'logged');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!['estimated_cost_usd'], null);
    // La fila ya llevaba el aviso; ahora las dos representaciones concuerdan.
    assert.equal(
      (rows[0]!['metadata'] as Record<string, unknown>)['pricing_missing_warning'],
      true,
    );
  });

  it('un enrichment CON tarifa viva escribe el número', async () => {
    const { rows, client } = captureClient();

    await realLogApolloOrgsUsage(
      buildApolloEnrichmentUsageLogInput({
        usageKey: 'organization_enrichment:batch_1:otra.com',
        batchId: null,
        domain: 'otra.com',
        unitCostUsd: 0.02,
        accounting: resolveApolloEnrichmentUsageAccounting('charged'),
      }),
      { client },
    );

    assert.equal(rows[0]!['estimated_cost_usd'], 0.02);
  });

  it('`organizations_search` no cambia: siempre calculó un número', () => {
    const row = buildProviderUsageLogRow(
      baseInput({ operation_key: 'organizations_search', estimated_cost_usd: 0.0875 }),
    );
    assert.equal(row['estimated_cost_usd'], 0.0875);
  });
});
