/**
 * Tests — agregación de créditos en /ai-usage
 * (A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 4).
 *
 * Cubre los dos agregadores PUROS que exporta `queries.ts`. El tercer agregador
 * (`getProviderStats`) hace su fold dentro de la función que consulta Supabase y
 * se cubre en la simulación offline del hito.
 *
 * Puro: sin Supabase, sin red. 0 créditos consumidos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateOperationStats,
  aggregateProviderUserConsumption,
} from '../queries';

describe('§ 4 · aggregateOperationStats — créditos desconocidos', () => {
  it('no suma un credits_used NULL como cero confirmado', () => {
    const [stat] = aggregateOperationStats([
      { operation_key: 'organizations_search', status: 'success', credits_used: 5, estimated_cost_usd: 1 },
      { operation_key: 'organizations_search', status: 'success', credits_used: 5, estimated_cost_usd: 1 },
      { operation_key: 'organizations_search', status: 'success', credits_used: null, estimated_cost_usd: null },
    ]);

    assert.strictEqual(stat.total_calls, 3);
    assert.strictEqual(stat.total_credits_used, 10, 'el subtotal conocido es 10');
    assert.strictEqual(stat.unknown_credit_operations, 1, 'la operación NULL queda pendiente');
    assert.strictEqual(stat.has_unknown_credits, true);
  });

  it('una operación sin pendientes declara su total como completo', () => {
    const [stat] = aggregateOperationStats([
      { operation_key: 'organization_enrichment', status: 'success', credits_used: 2, estimated_cost_usd: 0.4 },
    ]);
    assert.strictEqual(stat.total_credits_used, 2);
    assert.strictEqual(stat.unknown_credit_operations, 0);
    assert.strictEqual(stat.has_unknown_credits, false);
  });

  it('un cero conocido cuenta como cero y NO como pendiente', () => {
    const [stat] = aggregateOperationStats([
      { operation_key: 'organizations_search', status: 'success', credits_used: 0, estimated_cost_usd: 0 },
    ]);
    assert.strictEqual(stat.total_credits_used, 0);
    assert.strictEqual(stat.unknown_credit_operations, 0);
    assert.strictEqual(stat.has_unknown_credits, false);
  });

  it('las pendientes no alteran el orden por consumo conocido', () => {
    const stats = aggregateOperationStats([
      { operation_key: 'barata', status: 'success', credits_used: 1, estimated_cost_usd: 0.1 },
      { operation_key: 'cara', status: 'success', credits_used: 9, estimated_cost_usd: 2 },
      { operation_key: 'pendiente', status: 'success', credits_used: null, estimated_cost_usd: null },
    ]);
    assert.deepStrictEqual(stats.map((s) => s.operation_key), ['cara', 'barata', 'pendiente']);
  });
});

describe('§ 4 · aggregateProviderUserConsumption — créditos desconocidos', () => {
  it('separa el subtotal conocido de las operaciones pendientes por usuario', () => {
    const [row] = aggregateProviderUserConsumption([
      { triggered_by: 'u1', credits_used: 6, estimated_cost_usd: 1, created_at: '2026-08-01T00:00:00Z' },
      { triggered_by: 'u1', credits_used: 4, estimated_cost_usd: 1, created_at: '2026-08-02T00:00:00Z' },
      { triggered_by: 'u1', credits_used: null, estimated_cost_usd: null, created_at: '2026-08-03T00:00:00Z' },
    ]);

    assert.strictEqual(row.provider_calls, 3);
    assert.strictEqual(row.total_credits_used, 10);
    assert.strictEqual(row.unknown_credit_operations, 1);
    assert.strictEqual(row.has_unknown_credits, true);
  });

  it('el bucket sin atribuir también distingue conocido de pendiente', () => {
    const rows = aggregateProviderUserConsumption([
      { triggered_by: null, credits_used: null, estimated_cost_usd: null, created_at: '2026-08-01T00:00:00Z' },
      { triggered_by: null, credits_used: 3, estimated_cost_usd: 0.5, created_at: '2026-08-01T00:00:00Z' },
    ]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].triggered_by, null);
    assert.strictEqual(rows[0].total_credits_used, 3);
    assert.strictEqual(rows[0].unknown_credit_operations, 1);
  });

  it('un usuario sin pendientes no queda marcado', () => {
    const [row] = aggregateProviderUserConsumption([
      { triggered_by: 'u2', credits_used: 0, estimated_cost_usd: 0, created_at: '2026-08-01T00:00:00Z' },
    ]);
    assert.strictEqual(row.has_unknown_credits, false);
    assert.strictEqual(row.unknown_credit_operations, 0);
  });
});
