/**
 * AGENT1-SEARCH-AUDIT-1 — el juez de «Competidores» juzga TODA la lista (en lotes
 * de 80, hasta 3) y una respuesta cortada por el tope de salida es un error, no
 * «ninguna compite».
 *
 * Puro: la conversación se inyecta. LIVE_ANTHROPIC_CALLS = 0.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPETITOR_JUDGE_MAX_CHUNKS,
  COMPETITOR_JUDGE_MAX_ITEMS,
  COMPETITOR_JUDGE_TRUNCATED_ERROR,
  judgeCompetitors,
  type CompetitorJudgeInput,
  type CompetitorJudgeItem,
} from '../competitor-judge';
import type { AnthropicConversationResult, AnthropicRequestBody } from '../anthropic-messages-client';

const USAGE = {
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0,
};

function items(count: number): CompetitorJudgeItem[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `e${i}`,
    name: `Empresa ${i}`,
    // Actividad distinta por fila: ninguna se marca GENÉRICA.
    activity: `Actividad ${i}`,
    activityCode: null,
  }));
}

function input(count: number): CompetitorJudgeInput {
  return {
    reference: { name: 'Alpina', domain: 'alpina.com', description: null },
    countryName: 'Colombia',
    industryName: 'Alimentos',
    items: items(count),
  };
}

/** Claves de la lista que vino en el mensaje (la columna antes del primer « | »). */
function keysInRequest(body: AnthropicRequestBody): string[] {
  const text = String((body.messages[0] as { content: string }).content);
  return text
    .split('\n')
    .filter((line) => /^e\d+ \| /.test(line))
    .map((line) => line.split(' | ')[0]!);
}

function reply(keys: string[], stopReason = 'tool_use'): AnthropicConversationResult {
  return {
    content: [
      {
        type: 'tool_use',
        id: 't1',
        name: 'submit_competitor_selection',
        input: { competitors: keys.map((key) => ({ key, shared_offering: 'lácteos', confidence: 'high' })) },
      },
    ],
    usage: USAGE,
    stopReason,
  } as unknown as AnthropicConversationResult;
}

describe('judgeCompetitors — lotes', () => {
  it('con 81 filas juzga también la 81 (antes nunca se miraba)', async () => {
    const requests: string[][] = [];
    const outcome = await judgeCompetitors(input(81), 'm', {
      runConversation: async (body) => {
        const keys = keysInRequest(body);
        requests.push(keys);
        return reply(keys.includes('e80') ? ['e80'] : ['e0']);
      },
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.length, COMPETITOR_JUDGE_MAX_ITEMS);
    assert.deepEqual(requests[1], ['e80']);
    assert.deepEqual(outcome.competitors.map((c) => c.key).sort(), ['e0', 'e80']);
    assert.equal(outcome.judged, 81);
    assert.equal(outcome.errorCode, null);
    // El uso suma las dos llamadas.
    assert.equal(outcome.usage?.inputTokens, 2000);
  });

  it('nunca más de COMPETITOR_JUDGE_MAX_CHUNKS llamadas', async () => {
    let calls = 0;
    const outcome = await judgeCompetitors(input(COMPETITOR_JUDGE_MAX_ITEMS * COMPETITOR_JUDGE_MAX_CHUNKS + 50), 'm', {
      runConversation: async () => {
        calls += 1;
        return reply([]);
      },
    });
    assert.equal(calls, COMPETITOR_JUDGE_MAX_CHUNKS);
    assert.equal(outcome.judged, COMPETITOR_JUDGE_MAX_ITEMS * COMPETITOR_JUDGE_MAX_CHUNKS);
  });

  it('un lote caído no aporta nada, el otro sí; judged cuenta sólo lo juzgado', async () => {
    const outcome = await judgeCompetitors(input(100), 'm', {
      runConversation: async (body) => {
        const keys = keysInRequest(body);
        if (keys.includes('e0')) throw new Error('boom');
        return reply(['e90']);
      },
    });
    assert.deepEqual(outcome.competitors.map((c) => c.key), ['e90']);
    assert.equal(outcome.judged, 20);
    assert.equal(outcome.errorCode, null);
  });
});

describe('judgeCompetitors — respuesta cortada', () => {
  it('stop_reason max_tokens ⇒ error output_truncated, sin veredictos (antes: «0 elegidas» con éxito)', async () => {
    const outcome = await judgeCompetitors(input(10), 'm', {
      runConversation: async () => reply(['e1'], 'max_tokens'),
    });
    assert.deepEqual(outcome.competitors, []);
    assert.equal(outcome.errorCode, COMPETITOR_JUDGE_TRUNCATED_ERROR);
    assert.equal(outcome.judged, 0);
    // El gasto de la llamada cortada se sigue registrando.
    assert.equal(outcome.usage?.outputTokens, 100);
  });

  it('un lote cortado y otro bueno ⇒ sólo cuenta el bueno', async () => {
    const outcome = await judgeCompetitors(input(90), 'm', {
      runConversation: async (body) => {
        const keys = keysInRequest(body);
        return keys.includes('e0') ? reply(['e0'], 'max_tokens') : reply(['e85']);
      },
    });
    assert.deepEqual(outcome.competitors.map((c) => c.key), ['e85']);
    assert.equal(outcome.judged, 10);
    assert.equal(outcome.errorCode, null);
  });
});
