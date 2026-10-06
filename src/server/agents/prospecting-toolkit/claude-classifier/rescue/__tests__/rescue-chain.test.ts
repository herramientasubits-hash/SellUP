/**
 * SOURCES-EC-CLOSE-2 — el rescate con Claude se relanza solo mientras quede trabajo
 * (dueña 06-10: «4 vueltas, tope US$3»). Puro: sin red, base ni Claude.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  decideRescueContinuation,
  parseRescueContinuationRequest,
  RESCUE_CHAIN_MAX_CONTINUATIONS,
  RESCUE_CHAIN_MAX_COST_USD,
} from '../rescue-chain';
import type { RescueBatchSummary } from '../rescue-batch';
import { rescueContinuationBaseUrl } from '../rescue-chain.server';

function summary(overrides: Partial<Extract<RescueBatchSummary, { ok: true }>> = {}): RescueBatchSummary {
  return {
    ok: true,
    candidatesCompleted: 0,
    candidatesDiscarded: 0,
    candidatesUnchanged: 0,
    dispositionsAdmitted: 3,
    dispositionsKept: 10,
    reassigned: 0,
    failed: 2,
    remaining: 20,
    estimatedCostUsd: 0.6,
    ...overrides,
  };
}

const BATCH = '0ef658fd-8842-4df7-bf8b-f2b4a7dc9c48';

describe('¿otra vuelta?', () => {
  it('los topes acordados con la dueña', () => {
    assert.equal(RESCUE_CHAIN_MAX_CONTINUATIONS, 4);
    assert.equal(RESCUE_CHAIN_MAX_COST_USD, 3);
  });

  it('quedan pendientes o para reintentar, hubo avance y hay presupuesto ⇒ sí', () => {
    assert.deepEqual(decideRescueContinuation({ summary: summary(), continuationsDone: 0, spentUsd: 0.6 }), {
      continue: true,
      nextContinuation: 1,
    });
    assert.deepEqual(
      decideRescueContinuation({ summary: summary({ remaining: 0, failed: 4 }), continuationsDone: 2, spentUsd: 1.9 }),
      { continue: true, nextContinuation: 3 },
    );
  });

  it('nada pendiente ⇒ fin', () => {
    assert.deepEqual(
      decideRescueContinuation({ summary: summary({ remaining: 0, failed: 0 }), continuationsDone: 0, spentUsd: 0.6 }),
      { continue: false, reason: 'done' },
    );
  });

  it('ya hizo 4 vueltas extra ⇒ fin (queda para el botón)', () => {
    assert.deepEqual(decideRescueContinuation({ summary: summary(), continuationsDone: 4, spentUsd: 1 }), {
      continue: false,
      reason: 'max_continuations',
    });
  });

  it('una vuelta sin ningún avance ⇒ fin (sitios que siempre fallan, cuenta caída)', () => {
    const stuck = summary({ dispositionsAdmitted: 0, dispositionsKept: 0, failed: 7, remaining: 0 });
    assert.deepEqual(decideRescueContinuation({ summary: stuck, continuationsDone: 1, spentUsd: 0.2 }), {
      continue: false,
      reason: 'no_progress',
    });
  });

  it('llegó a US$3 en el lote ⇒ fin', () => {
    assert.deepEqual(decideRescueContinuation({ summary: summary(), continuationsDone: 1, spentUsd: 3 }), {
      continue: false,
      reason: 'cost_cap',
    });
  });

  it('el rescate falló (sin modelo, sin cuota) ⇒ fin', () => {
    assert.deepEqual(
      decideRescueContinuation({ summary: { ok: false, error: 'quota_exhausted' }, continuationsDone: 0, spentUsd: 0 }),
      { continue: false, reason: 'failed' },
    );
  });
});

describe('cuerpo de la petición de la siguiente vuelta', () => {
  it('válido', () => {
    assert.deepEqual(parseRescueContinuationRequest({ batchId: BATCH, continuation: 2, spentUsd: 0.75, triggeredBy: 'u-123' }), {
      batchId: BATCH,
      continuation: 2,
      spentUsd: 0.75,
      triggeredBy: 'u-123',
    });
  });

  it('inválido ⇒ null (la ruta responde 400)', () => {
    for (const body of [
      null,
      'x',
      { batchId: 'no-uuid', continuation: 1, spentUsd: 0 },
      { batchId: BATCH, continuation: 0, spentUsd: 0 },
      { batchId: BATCH, continuation: 5, spentUsd: 0 },
      { batchId: BATCH, continuation: 1.5, spentUsd: 0 },
      { batchId: BATCH, continuation: 1, spentUsd: -1 },
      { batchId: BATCH, continuation: 1, spentUsd: 'x' },
    ]) {
      assert.equal(parseRescueContinuationRequest(body), null, JSON.stringify(body));
    }
  });

  it('un triggeredBy raro no bloquea la vuelta: se descarta', () => {
    assert.equal(parseRescueContinuationRequest({ batchId: BATCH, continuation: 1, spentUsd: 0, triggeredBy: 'a b;c' })?.triggeredBy, null);
  });
});

describe('URL de la app para pedir la vuelta', () => {
  it('la configurada; si no, el dominio de producción de Vercel; si no, ninguna', () => {
    assert.equal(rescueContinuationBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://app.sellup.test', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://app.sellup.test');
    assert.equal(rescueContinuationBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'sellup.vercel.app' }), 'https://sellup.vercel.app');
    assert.equal(rescueContinuationBaseUrl({}), null);
  });
});

describe('cableado', () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (rel: string) => strip(readFileSync(join(process.cwd(), rel), 'utf8'));
  const DIR = 'src/server/agents/prospecting-toolkit/claude-classifier/rescue';

  it('el rescate del final de la búsqueda usa la vuelta encadenable (y si no hay tiempo, pide la 1.ª vuelta)', () => {
    const code = read(`${DIR}/schedule-rescue.server.ts`);
    assert.match(code, /runRescueRound\(\{/);
    assert.match(code, /continuationsDone: 0/);
    assert.match(code, /triggerRescueContinuation\(\{ batchId, continuation: 1, spentUsd: 0, triggeredBy \}\)/);
  });

  it('la ruta exige CRON_SECRET, valida el cuerpo y trabaja en after()', () => {
    const code = read('src/app/api/cron/claude-rescue-continuation/route.ts');
    assert.match(code, /authorizeRecoveryCronRequest\(/);
    assert.match(code, /parseRescueContinuationRequest\(body\)/);
    assert.match(code, /after\(async/);
    assert.match(code, /isAgent1ClaudeRescueEnabled\(\)/);
  });

  it('la siguiente vuelta se pide con CRON_SECRET y sin él no se pide', () => {
    const code = read(`${DIR}/rescue-chain.server.ts`);
    assert.match(code, /Authorization: `Bearer \$\{secret\}`/);
    assert.match(code, /if \(!base \|\| !secret\)/);
    assert.match(code, /VERCEL_PROJECT_PRODUCTION_URL/);
  });
});
