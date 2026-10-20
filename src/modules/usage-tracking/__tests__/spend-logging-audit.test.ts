// AI-USAGE-AUDIT-2 (16-10) — el gasto llega entero y bien medido a provider_usage_logs.
//
// Cada prueba fija un hueco que la auditoría encontró:
//   - créditos conocidos sin dólares se escribían como US$0 (revelado de teléfonos);
//   - el Agente 2A gastaba créditos de Apollo al buscar la empresa sin dejar fila;
//   - un turno forzado de Claude que fallaba borraba el gasto del primer turno;
//   - el enriquecimiento tras importar valía US$0 (tarifa sembrada en 0) y los
//     precios por modelo estaban desactualizados;
//   - Migo (Perú) gastaba cupo sin registro;
//   - un mismo revelado de Apollo se contaba dos veces (aviso + recuperación);
//   - el agente y el paso que declara el escritor tienen que llegar a la fila.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { creditCostUsd, estimateProviderCreditCostUsd } from '../provider-credit-cost';
import { buildProviderUsageLogInsertPayload } from '../logging';
import { apolloOrgResolutionCredits } from '@/server/agents/contact-enrichment-toolkit/apollo-people-adapter';
import { forceSubmission } from '@/server/agents/prospecting-toolkit/claude-classifier/classify-company';
import {
  AnthropicApiError,
  type AnthropicConversationResult,
  type AnthropicRequestBody,
  type AnthropicUsageTotals,
} from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { resolveModelPrice } from '@/server/agents/prospecting-toolkit/claude-classifier/cost';
import { estimateLLMCost } from '@/server/agents/prospecting-toolkit/llm-evaluator';
import { buildMigoUsageLogInput } from '@/server/prospect-batches/post-approval-nit-enrichment-worker';
import { resolveRecoveryCharge } from '@/modules/contact-enrichment/phone-reveal-recovery-deps';

describe('creditCostUsd — créditos × tarifa, nunca un US$0 inventado', () => {
  it('créditos y tarifa conocidos → dólares', () => {
    assert.equal(creditCostUsd(8, 0.01), 0.08);
  });
  it('0 créditos → US$0 aunque no haya tarifa (no se cobró)', () => {
    assert.equal(creditCostUsd(0, null), 0);
  });
  it('créditos desconocidos o tarifa desconocida → NULL', () => {
    assert.equal(creditCostUsd(null, 0.01), null);
    assert.equal(creditCostUsd(undefined, 0.01), null);
    assert.equal(creditCostUsd(3, null), null);
  });
  it('sólo lee la tarifa cuando hay créditos que cobrar', async () => {
    let reads = 0;
    const load = async () => {
      reads++;
      return 0.5;
    };
    assert.equal(await estimateProviderCreditCostUsd('apollo', 0, 'credit', load), 0);
    assert.equal(await estimateProviderCreditCostUsd('apollo', null, 'credit', load), null);
    assert.equal(reads, 0);
    assert.equal(await estimateProviderCreditCostUsd('apollo', 2, 'credit', load), 1);
    assert.equal(reads, 1);
  });
});

describe('buildProviderUsageLogInsertPayload — agente y paso declarados', () => {
  const snapshot = { roleKey: null, groupId: null };
  it('agent_key / agent_step llegan a la fila cuando el escritor los declara', () => {
    const row = buildProviderUsageLogInsertPayload(
      { provider_key: 'apollo', operation_key: 'mixed_companies_search', agent_key: 'agent2a', agent_step: 'identificar_empresa' },
      snapshot,
    );
    assert.equal(row.agent_key, 'agent2a');
    assert.equal(row.agent_step, 'identificar_empresa');
  });
  it('sin declararlos la fila no trae las columnas (las rellena el disparador)', () => {
    const row = buildProviderUsageLogInsertPayload({ provider_key: 'tavily', operation_key: 'web_search' }, snapshot);
    assert.equal('agent_key' in row, false);
    assert.equal('agent_step' in row, false);
  });
});

describe('apolloOrgResolutionCredits — 1 crédito por página con resultados', () => {
  const meta = (domain: number, name: number) => ({
    status: 'found_by_domain' as const,
    organization_id: null,
    organization_name: null,
    organization_domain: null,
    resolution_method: null,
    domain_query_results: domain,
    name_query_results: name,
  });
  it('encontrada por dominio → 1', () => assert.equal(apolloOrgResolutionCredits(meta(3, 0)), 1));
  it('dominio vacío (gratis) y nombre con resultados → 1', () => assert.equal(apolloOrgResolutionCredits(meta(0, 2)), 1));
  it('nada en ninguna → 0', () => assert.equal(apolloOrgResolutionCredits(meta(0, 0)), 0));
  it('sin resolución → 0', () => assert.equal(apolloOrgResolutionCredits(undefined), 0));
});

describe('forceSubmission — el turno forzado que falla no borra el primero', () => {
  const usage = (input: number, searches: number): AnthropicUsageTotals => ({
    inputTokens: input,
    outputTokens: 10,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: searches,
    webFetchRequests: 0,
  });
  const first: AnthropicConversationResult = { content: [], stopReason: 'end_turn', usage: usage(1000, 3), requests: 1 };
  const body = { model: 'claude-sonnet-4-5', max_tokens: 100, system: '', tools: [], messages: [] } as AnthropicRequestBody;

  it('error de la API: el error lleva la suma de los dos turnos', async () => {
    await assert.rejects(
      forceSubmission(body, first, {
        runConversation: async () => {
          throw new AnthropicApiError(529, 'overloaded', 'overloaded', usage(5, 0));
        },
      }),
      (err: unknown) => {
        assert.ok(err instanceof AnthropicApiError);
        assert.equal(err.code, 'overloaded');
        assert.equal(err.partialUsage.inputTokens, 1005);
        assert.equal(err.partialUsage.webSearchRequests, 3);
        return true;
      },
    );
  });

  it('error que no es de la API (p. ej. sin tiempo): conserva el primer turno', async () => {
    await assert.rejects(
      forceSubmission(body, first, {
        runConversation: () => Promise.reject(new Error('corporate_tree_time_budget')),
      }),
      (err: unknown) => {
        assert.ok(err instanceof AnthropicApiError);
        assert.equal(err.partialUsage.inputTokens, 1000);
        assert.equal(err.partialUsage.webSearchRequests, 3);
        return true;
      },
    );
  });
});

describe('precios de Claude — tabla por familia también para el enriquecimiento', () => {
  it('Haiku 4.5 a $1/$5 y Opus 4.5 a $5/$25 (precio público vigente)', () => {
    assert.equal(estimateLLMCost(1_000_000, 0, 'claude-haiku-4-5-20251001'), 1);
    assert.equal(estimateLLMCost(0, 1_000_000, 'claude-opus-4-5'), 25);
  });
  it('un ID con fecha de Sonnet 4 ya no cae al precio por defecto', () => {
    assert.equal(estimateLLMCost(1_000_000, 0, 'claude-sonnet-4-20250514'), 3);
  });
  it('modelos viejos sembrados tienen su precio, no el de Sonnet', () => {
    assert.deepEqual(resolveModelPrice('claude-3-opus-20240229'), {
      price: { inputPerMillion: 15, outputPerMillion: 75 },
      source: 'table',
    });
    assert.equal(resolveModelPrice('claude-3-haiku-20240307').price.inputPerMillion, 0.25);
    assert.equal(resolveModelPrice('claude-opus-4-20250514').price.inputPerMillion, 15);
  });
});

describe('buildMigoUsageLogInput — cada consulta a Migo queda registrada', () => {
  const candidate = { id: 'c1', batch_id: 'b1' };
  it('respuesta (encontrado o no) → 1 unidad de cupo, US$0 marginal, agente 1', () => {
    const row = buildMigoUsageLogInput(candidate, { status: 'not_found' }, 120);
    assert.ok(row);
    assert.equal(row.provider_key, 'migo');
    assert.equal(row.credits_used, 1);
    assert.equal(row.estimated_cost_usd, 0);
    assert.equal(row.status, 'success');
    assert.equal(row.batch_id, 'b1');
    assert.equal(row.agent_key, 'agent1');
    assert.equal(row.agent_step, 'numero_fiscal_migo');
  });
  it('error del servidor → cobro desconocido (NULL), no 0', () => {
    const row = buildMigoUsageLogInput(candidate, { status: 'api_unavailable', error: 'migo_server_error_502' }, 10);
    assert.ok(row);
    assert.equal(row.credits_used, undefined);
    assert.equal(row.estimated_cost_usd, null);
    assert.equal(row.status, 'error');
  });
  it('límite del plan → rate_limited con 0 créditos', () => {
    const row = buildMigoUsageLogInput(candidate, { status: 'api_unavailable', error: 'migo_rate_limited' }, 10);
    assert.equal(row?.status, 'rate_limited');
    assert.equal(row?.credits_used, 0);
  });
  it('sin llamada (RUC inválido o sin credencial) → sin fila', () => {
    assert.equal(buildMigoUsageLogInput(candidate, { status: 'api_unavailable', error: 'invalid_ruc_format' }, 0), null);
    assert.equal(
      buildMigoUsageLogInput(candidate, { status: 'api_unavailable', error: 'migo_credential_not_configured' }, 0),
      null,
    );
  });
});

describe('resolveRecoveryCharge — un revelado de Apollo no se cuenta dos veces', () => {
  /** Cliente falso: devuelve el candidato y, para provider_usage_logs, las filas dadas. */
  function fakeAdmin(webhookRows: unknown[]) {
    const calls: Array<[string, string, unknown]> = [];
    const chain = (table: string) => {
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          calls.push([table, col, val]);
          return builder;
        },
        gt: () => builder,
        gte: () => builder,
        limit: async () => ({ data: webhookRows, error: null }),
        maybeSingle: async () => ({
          data: { phone_revealed_by: 'seller-1', phone_reveal_requested_at: '2026-10-16T10:00:00Z' },
          error: null,
        }),
      };
      return builder;
    };
    return { admin: { from: chain } as never, calls };
  }

  it('el aviso ya registró créditos → la recuperación suma 0 y lo atribuye a quien pidió', async () => {
    const { admin } = fakeAdmin([{ id: 'log-webhook' }]);
    const charge = await resolveRecoveryCharge(admin, 'cand-1', 8);
    assert.deepEqual(charge, { creditsUsed: 0, alreadyLoggedByWebhook: true, requestedBy: 'seller-1' });
  });

  it('sin fila del aviso → la recuperación registra los créditos reportados', async () => {
    const { admin } = fakeAdmin([]);
    const charge = await resolveRecoveryCharge(admin, 'cand-1', 8);
    assert.deepEqual(charge, { creditsUsed: 8, alreadyLoggedByWebhook: false, requestedBy: 'seller-1' });
  });

  it('sin créditos reportados no busca nada y conserva el NULL', async () => {
    const { admin, calls } = fakeAdmin([{ id: 'x' }]);
    const charge = await resolveRecoveryCharge(admin, 'cand-1', null);
    assert.equal(charge.creditsUsed, null);
    assert.equal(calls.some(([table]) => table === 'provider_usage_logs'), false);
  });
});
