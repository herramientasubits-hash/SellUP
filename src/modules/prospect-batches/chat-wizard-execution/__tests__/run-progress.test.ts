/**
 * AGENT1-RUN-LIVE-PROGRESS-1 — el progreso en vivo de la corrida.
 *
 * Contrato: una etapa se anota cuando su dependencia EMPIEZA (nunca por tiempo),
 * en el orden real de llamada; un fallo al anotar no toca la corrida.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_PROGRESS_LABELS,
  createRunProgressReporter,
  readClientRequestId,
  withRunProgress,
  type RunProgressStage,
  type RunProgressStore,
} from '../run-progress';

function memoryStore(failWrites = false) {
  const writes: { stage: RunProgressStage; label: string }[] = [];
  let cleared = 0;
  const store: RunProgressStore = {
    write: async (row) => {
      if (failWrites) throw new Error('db down');
      writes.push(row);
    },
    clear: async () => {
      cleared += 1;
    },
  };
  return { store, writes, cleared: () => cleared };
}

describe('withRunProgress — la etapa se anota cuando la dependencia empieza', () => {
  it('anota cada etapa al llamar a su dependencia, en el orden real', async () => {
    const seen: RunProgressStage[] = [];
    const deps = withRunProgress(
      {
        runPrePaidNoveltyDiscovery: async () => 'free',
        runTavilyPipeline: async () => 'tavily',
        runApolloPipeline: async () => 'apollo',
        getActiveUserId: async () => 'u1',
      },
      (stage) => seen.push(stage),
    );

    await deps.runPrePaidNoveltyDiscovery();
    await deps.runApolloPipeline();

    assert.deepEqual(seen, ['free_sources', 'reviewing', 'apollo', 'reviewing']);
  });

  it('el paso de Claude al final anota «claude_search» con su rótulo', async () => {
    const seen: RunProgressStage[] = [];
    const deps = withRunProgress({ runClaudeCompanySearchLeg: async () => 'claude' }, (stage) => seen.push(stage));
    await deps.runClaudeCompanySearchLeg();
    assert.deepEqual(seen, ['claude_search', 'reviewing']);
    assert.equal(RUN_PROGRESS_LABELS.claude_search, 'Claude está buscando más empresas en la web');
  });

  it('🔴 lo que no se llama no se anota: sin Apollo no hay «Buscando con Apollo»', async () => {
    const seen: RunProgressStage[] = [];
    const deps = withRunProgress(
      { runTavilyPipeline: async () => 1, runApolloPipeline: async () => 2 },
      (stage) => seen.push(stage),
    );
    await deps.runTavilyPipeline();
    assert.equal(seen.includes('apollo'), false);
  });

  it('una dependencia ausente sigue ausente y las demás no se tocan', () => {
    const getActiveUserId = async () => 'u1';
    const deps = withRunProgress<{ runLushaWaterfallLeg?: () => Promise<void>; getActiveUserId: () => Promise<string> }>(
      { getActiveUserId },
      () => {},
    );
    assert.equal(deps.runLushaWaterfallLeg, undefined);
    assert.equal(deps.getActiveUserId, getActiveUserId);
  });

  it('el resultado y los errores de la dependencia pasan intactos', async () => {
    const deps = withRunProgress(
      { runApolloPipeline: async (n: number) => n * 2, runLushaWaterfallLeg: async () => { throw new Error('lusha'); } },
      () => {},
    );
    assert.equal(await deps.runApolloPipeline(21), 42);
    await assert.rejects(deps.runLushaWaterfallLeg(), /lusha/);
  });
});

describe('createRunProgressReporter — escribe en orden y nunca rompe la corrida', () => {
  it('escribe el rótulo de cada etapa y no repite la misma seguida', async () => {
    const mem = memoryStore();
    const { report, finish } = createRunProgressReporter(mem.store);
    report('starting');
    report('apollo');
    report('apollo');
    report('lusha');
    await finish();

    assert.deepEqual(
      mem.writes.map((w) => w.stage),
      ['starting', 'apollo', 'lusha'],
    );
    assert.equal(mem.writes[1].label, RUN_PROGRESS_LABELS.apollo);
    assert.equal(mem.cleared(), 1);
  });

  it('🔴 un fallo al escribir se registra y no se propaga', async () => {
    const mem = memoryStore(true);
    const errors: unknown[] = [];
    const { report, finish } = createRunProgressReporter(mem.store, (e) => errors.push(e));
    report('apollo');
    await finish();
    assert.equal(errors.length, 1);
    assert.equal(mem.cleared(), 1);
  });
});

describe('readClientRequestId', () => {
  it('solo acepta un uuid', () => {
    assert.equal(readClientRequestId({ clientRequestId: 'b2f1c6c0-6c1e-4d39-9a43-3e1c2f0a9b11' }), 'b2f1c6c0-6c1e-4d39-9a43-3e1c2f0a9b11');
    assert.equal(readClientRequestId({ clientRequestId: 'x' }), null);
    assert.equal(readClientRequestId(null), null);
  });
});

describe('nextRunProgressPercent — la barra avanza por etapas reales', () => {
  it('sube con cada etapa nueva, en el orden de la corrida', async () => {
    const { nextRunProgressPercent, RUN_PROGRESS_PERCENT } = await import('../run-progress');
    let p = RUN_PROGRESS_PERCENT.starting;
    for (const stage of ['free_sources', 'tavily', 'apollo', 'lusha'] as const) {
      const next = nextRunProgressPercent(p, stage);
      assert.ok(next > p, stage);
      p = next;
    }
  });

  it('🔴 nunca retrocede: «reviewing», una etapa anterior o nada no restan', async () => {
    const { nextRunProgressPercent, RUN_PROGRESS_PERCENT } = await import('../run-progress');
    const p = RUN_PROGRESS_PERCENT.apollo;
    assert.equal(nextRunProgressPercent(p, 'reviewing'), p);
    assert.equal(nextRunProgressPercent(p, 'tavily'), p);
    assert.equal(nextRunProgressPercent(p, null), p);
  });

  it('nunca llega a 100 mientras corre: el final lo dice el resultado', async () => {
    const { RUN_PROGRESS_PERCENT } = await import('../run-progress');
    assert.ok(Object.values(RUN_PROGRESS_PERCENT).every((v) => v > 0 && v < 100));
  });
});
