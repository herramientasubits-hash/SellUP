/**
 * AUDIT-A1-WS7 (16-10) — el clasificador termina dentro del tiempo de la función:
 *
 *   · la conversación con Claude respeta un instante límite (continuaciones
 *     `pause_turn` incluidas) y no empieza otra petición sin tiempo;
 *   · el temporizador sigue activo mientras se lee el cuerpo de la respuesta;
 *   · la corrida pasa a cada empresa un tope DURO derivado de su inicio.
 *
 * Sin red: `fetchImpl` y dependencias inyectadas.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AnthropicApiError, runAnthropicConversation } from '../anthropic-messages-client';
import {
  CLASSIFIER_RUN_HARD_DEADLINE_MS,
  classifyBatchCandidates,
  type ClassifyBatchDeps,
} from '../classify-batch-candidates';

const BODY = { model: 'm', max_tokens: 10, system: [], tools: [], messages: [{ role: 'user' as const, content: 'x' }] };

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('runAnthropicConversation — instante límite', () => {
  it('no empieza una continuación sin tiempo', async () => {
    let clock = 0;
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      clock += 5_000;
      return jsonResponse({ content: [{ type: 'text', text: 'parcial' }], stop_reason: 'pause_turn', usage: { input_tokens: 1 } });
    };
    await assert.rejects(
      runAnthropicConversation({ apiKey: 'k', body: BODY, fetchImpl, deadlineAtMs: 7_000, now: () => clock }),
      (err: unknown) => err instanceof AnthropicApiError && err.code === 'deadline_exceeded' && err.partialUsage.inputTokens === 2,
    );
    assert.equal(calls, 2);
  });

  it('el tope de la petición también cubre la lectura del cuerpo', async () => {
    const fetchImpl = async (_url: string, init: RequestInit) => {
      const signal = init.signal!;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // El cuerpo nunca termina; sólo el aborto lo corta.
          signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        },
      });
      return new Response(stream, { status: 200 });
    };
    const started = Date.now();
    await assert.rejects(
      runAnthropicConversation({ apiKey: 'k', body: BODY, fetchImpl, timeoutMs: 50 }),
      (err: unknown) => err instanceof AnthropicApiError && err.code === 'timeout',
    );
    assert.ok(Date.now() - started < 2_000);
  });

  it('sin límite se comporta como antes', async () => {
    const out = await runAnthropicConversation({
      apiKey: 'k',
      body: BODY,
      fetchImpl: async () => jsonResponse({ content: [], stop_reason: 'end_turn', usage: {} }),
    });
    assert.equal(out.requests, 1);
    assert.equal(out.stopReason, 'end_turn');
  });
});

describe('classifyBatchCandidates — tope duro por empresa', () => {
  it('cada empresa recibe deadlineAtMs = inicio + CLASSIFIER_RUN_HARD_DEADLINE_MS', async () => {
    const seen: Array<number | undefined> = [];
    const deps: ClassifyBatchDeps = {
      resolveActiveModel: async () => ({ model: 'm', apiKey: 'k' }),
      checkQuota: async () => ({ allowed: true }),
      loadCatalog: async () => [{ industryId: 'tec', industryName: 'Tecnología', industryDescription: null, subindustries: [] }],
      loadCandidates: async () =>
        [{ id: 'c1', industry_id: 'tec', name: 'Acme', website: 'acme.com', domain: 'acme.com', country_code: 'CO', country: 'Colombia', status: 'needs_review', metadata: { target_completeness: { failed_conditions: ['employee_count_status'] } } }],
      classify: async (company, _catalog, _active, options) => {
        seen.push(options?.deadlineAtMs);
        return {
          candidateId: company.candidateId, outcome: 'no_website', sector: null, employeeRange: null, rejected: [],
          isOperatingCompany: null, pageFinalUrl: null, usage: null, errorCode: null, durationMs: 1,
        };
      },
      logUsage: async () => true,
      saveClassification: async () => true,
      nowIso: () => '2026-10-16T00:00:00.000Z',
      nowMs: () => 1_000,
    };
    await classifyBatchCandidates({ batchId: 'b1', triggeredBy: null, force: true }, deps);
    assert.deepEqual(seen, [1_000 + CLASSIFIER_RUN_HARD_DEADLINE_MS]);
    assert.ok(CLASSIFIER_RUN_HARD_DEADLINE_MS < 300_000);
  });
});
