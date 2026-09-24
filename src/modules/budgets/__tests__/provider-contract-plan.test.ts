/**
 * SETTINGS-PROVIDER-CONTRACT-PLAN-1 — «Plan contratado» en Configuración.
 *
 * Configuración mostraba la cuota que usa el producto, pero nunca el contrato, y
 * rotulaba el total ANUAL de Lusha como «Créditos mensuales». Estas pruebas
 * fijan la vista del plan y su lectura.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildProviderContractPlanView } from '../provider-contract-plan';
import { getProviderContractPlan } from '../provider-contract-plan-queries';

const NOW = new Date('2026-09-24T17:00:00Z');
const base = {
  activeUnitCostUsd: null,
  activeUnitCostEffectiveFrom: null,
  creditsRemaining: null,
  creditsRemainingSyncedAt: null,
  renewalDate: null,
  now: NOW,
};

describe('§ 1 — la vista del plan', () => {
  it('Apollo con el precio corregido: coincide con el contrato', () => {
    const plan = buildProviderContractPlanView({
      ...base,
      providerKey: 'apollo',
      activeUnitCostUsd: 0.00867168,
      activeUnitCostEffectiveFrom: '2026-09-24',
      creditsRemaining: 4355,
      creditsRemainingSyncedAt: '2026-09-24T17:18:22Z',
      renewalDate: '2026-10-13',
    });
    assert.ok(plan);
    assert.equal(plan.billing, 'annual');
    assert.equal(plan.annualCredits, 484_335);
    assert.equal(plan.annualUsd, 4_200);
    assert.equal(plan.pricingMatchesContract, true);
    assert.equal(plan.daysToRenewal, 19);
    assert.equal(plan.remainingPercentOfPlan, 0.9);
  });

  it('🔴 Lusha con el precio viejo: la vista lo marca como distinto del contrato', () => {
    const plan = buildProviderContractPlanView({
      ...base,
      providerKey: 'lusha',
      activeUnitCostUsd: 0.08823529,
    });
    assert.equal(plan?.pricingMatchesContract, false);
    assert.equal(plan?.contractUsdPerCredit, 0.06821193);
  });

  it('sin fila de precio activa tampoco coincide', () => {
    const plan = buildProviderContractPlanView({ ...base, providerKey: 'lusha' });
    assert.equal(plan?.activeUsdPerCredit, null);
    assert.equal(plan?.pricingMatchesContract, false);
  });

  it('Lusha: 4.988 de 61.200 = 8,2 % del plan; sin renovación conocida', () => {
    const plan = buildProviderContractPlanView({
      ...base,
      providerKey: 'lusha',
      creditsRemaining: 4988,
    });
    assert.equal(plan?.remainingPercentOfPlan, 8.2);
    assert.equal(plan?.renewalDate, null);
    assert.equal(plan?.daysToRenewal, null);
  });

  it('una renovación ya pasada da días negativos', () => {
    const plan = buildProviderContractPlanView({
      ...base,
      providerKey: 'apollo',
      renewalDate: '2026-09-20',
    });
    assert.equal(plan?.daysToRenewal, -4);
  });

  it('fechas y números inválidos no se inventan', () => {
    const plan = buildProviderContractPlanView({
      ...base,
      providerKey: 'apollo',
      renewalDate: '13/10/2026',
      creditsRemaining: Number.NaN,
      activeUnitCostUsd: Number.POSITIVE_INFINITY,
    });
    assert.equal(plan?.renewalDate, null);
    assert.equal(plan?.creditsRemaining, null);
    assert.equal(plan?.activeUsdPerCredit, null);
  });

  it('proveedores sin contrato de créditos no tienen plan', () => {
    for (const key of ['tavily', 'anthropic', 'hubspot', '']) {
      assert.equal(buildProviderContractPlanView({ ...base, providerKey: key }), null, key);
    }
  });
});

describe('§ 2 — la lectura', () => {
  type Call = { table: string; op: string; args: unknown[] };
  function fakeClient(results: Record<string, { data: unknown; error: unknown }>) {
    const calls: Call[] = [];
    const builder = (table: string) => {
      const self: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'order', 'limit']) {
        self[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return self;
        };
      }
      self.maybeSingle = () => Promise.resolve(results[table]);
      return self;
    };
    return { client: { from: builder } as unknown as SupabaseClient, calls };
  }

  it('lee la fila ACTIVA `credit · per_credit` más reciente y lo sincronizado', async () => {
    const { client, calls } = fakeClient({
      provider_pricing_config: {
        data: { unit_cost_usd: '0.06821193', effective_from: '2026-09-24' },
        error: null,
      },
      tool_catalog: {
        data: {
          credits_remaining_external: '4988',
          quota_synced_at: '2026-09-24T17:18:41Z',
          billing_period_end: null,
        },
        error: null,
      },
    });
    const plan = await getProviderContractPlan('Lusha', client, NOW);
    assert.equal(plan?.pricingMatchesContract, true);
    assert.equal(plan?.creditsRemaining, 4988);
    const pricingEq = calls
      .filter((c) => c.table === 'provider_pricing_config' && c.op === 'eq')
      .map((c) => c.args);
    assert.deepEqual(pricingEq, [
      ['provider_key', 'lusha'],
      ['operation_key', 'credit'],
      ['unit', 'per_credit'],
      ['is_active', true],
    ]);
    assert.ok(calls.some((c) => c.op === 'order' && c.args[0] === 'effective_from'));
  });

  it('sin contrato no consulta nada', async () => {
    const { client, calls } = fakeClient({});
    assert.equal(await getProviderContractPlan('tavily', client, NOW), null);
    assert.equal(calls.length, 0);
  });

  it('un error de lectura deja el contrato visible, sin los datos que faltan', async () => {
    const { client } = fakeClient({
      provider_pricing_config: { data: null, error: { message: 'boom' } },
      tool_catalog: { data: null, error: { message: 'boom' } },
    });
    const plan = await getProviderContractPlan('apollo', client, NOW);
    assert.equal(plan?.annualCredits, 484_335);
    assert.equal(plan?.activeUsdPerCredit, null);
    assert.equal(plan?.creditsRemaining, null);
  });

  it('la lectura no escribe nada', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../provider-contract-plan-queries.ts'),
      'utf8',
    );
    for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});

describe('§ 3 — sólo administradores', () => {
  it('🔴 la acción exige administrador ANTES de usar el cliente de servicio', () => {
    const root = path.resolve(__dirname, '../../../..');
    const source = readFileSync(
      path.join(root, 'src/app/(sellup)/settings/providers/provider-detail-actions.ts'),
      'utf8',
    );
    const fn = source.slice(source.indexOf('async function loadContractPlanForPanel'));
    const guard = fn.indexOf('if (!(await isCurrentUserAdmin())) return null;');
    const read = fn.indexOf('getProviderContractPlan(providerKey, getAdminClient())');
    assert.ok(guard > 0 && read > guard, 'orden: admin → lectura');
  });
});
