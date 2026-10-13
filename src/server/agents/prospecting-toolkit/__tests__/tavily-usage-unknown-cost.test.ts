// Tavily — un costo DESCONOCIDO se escribe como NULL, nunca como 0.
//
// La fila de provider_usage_logs hacía `estimated_cost_usd ?? 0`: sin tarifa
// viva, la consulta quedaba registrada como gratis y /ai-usage sumaba $0 por
// consultas que sí se cobraron. Contrato canónico (el mismo de logging.ts y de
// la ruta Lusha): omitido ⇒ 0 · null explícito ⇒ NULL · número ⇒ tal cual.
// Sin red ni base de datos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTavilyUsageLogRow,
  createLinkedInUsageLoggerFn,
  type UsageLogResult,
} from '../tavily-usage-logging';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { LinkedInUsageLogPayload } from '../linkedin-company-search';

const SNAPSHOT = { roleKey: 'seller', groupId: 'g1' };

function input(overrides: Partial<LogProviderUsageInput> = {}): LogProviderUsageInput {
  return {
    provider_key: 'tavily',
    operation_key: 'multi_query_web_search',
    batch_id: 'b1',
    triggered_by: 'u1',
    ...overrides,
  };
}

describe('buildTavilyUsageLogRow — estimated_cost_usd', () => {
  it('null explícito (sin tarifa) se escribe NULL', () => {
    assert.equal(buildTavilyUsageLogRow(input({ estimated_cost_usd: null }), SNAPSHOT).estimated_cost_usd, null);
  });

  it('omitido conserva el 0 histórico', () => {
    assert.equal(buildTavilyUsageLogRow(input(), SNAPSHOT).estimated_cost_usd, 0);
  });

  it('un número se escribe tal cual (0 es un costo conocido válido)', () => {
    assert.equal(buildTavilyUsageLogRow(input({ estimated_cost_usd: 0.04 }), SNAPSHOT).estimated_cost_usd, 0.04);
    assert.equal(buildTavilyUsageLogRow(input({ estimated_cost_usd: 0 }), SNAPSHOT).estimated_cost_usd, 0);
  });

  it('el resto de la fila no cambia: snapshot de rol/grupo y real_cost_usd NULL', () => {
    const row = buildTavilyUsageLogRow(input({ estimated_cost_usd: null }), SNAPSHOT);
    assert.equal(row.triggered_by_role_key, 'seller');
    assert.equal(row.triggered_by_group_id, 'g1');
    assert.equal(row.real_cost_usd, null);
    assert.equal(row.status, 'success');
  });
});

describe('createLinkedInUsageLoggerFn — sin tarifa no se registra como $0', () => {
  function payload(estimated: number | null): LinkedInUsageLogPayload {
    return {
      usage_key: 'tavily:linkedin_search:b1:x:q0',
      provider: 'tavily',
      feature: 'linkedin_company_search',
      agent: 'agent_1',
      batch_id: 'b1',
      user_id: 'u1',
      candidate_name: 'X',
      candidate_domain: 'x.com',
      query: '"X" site:linkedin.com/company',
      search_depth: 'basic',
      max_results: 3,
      estimated_cost_usd: estimated,
      status: 'success',
      result_count: 1,
      selected_status: 'found',
      selected_url: 'https://www.linkedin.com/company/x',
      created_at: '2026-10-13T10:00:00.000Z',
    };
  }

  it('estimated_cost_usd null en el payload llega como null al logger', async () => {
    let captured: LogProviderUsageInput | null = null;
    const fn = createLinkedInUsageLoggerFn('u1', async (i): Promise<UsageLogResult> => {
      captured = i;
      return { kind: 'logged' };
    });
    await fn(payload(null));
    assert.ok(captured);
    assert.equal((captured as LogProviderUsageInput).estimated_cost_usd, null);
  });

  it('un costo conocido se conserva', async () => {
    let captured: LogProviderUsageInput | null = null;
    const fn = createLinkedInUsageLoggerFn('u1', async (i): Promise<UsageLogResult> => {
      captured = i;
      return { kind: 'logged' };
    });
    await fn(payload(0.008));
    assert.equal((captured as unknown as LogProviderUsageInput).estimated_cost_usd, 0.008);
  });
});
