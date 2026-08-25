/**
 * AGENT1-CUT4-A1 — SAFE REVIEW NAVIGATION.
 *
 * El conteo ya es honesto. Falta que la ficha del lote deje de AFIRMAR el cero
 * y que, cuando la tabla accionable heredada no muestre todo lo que existe,
 * lleve al operador a la cola oficial —`/accounts?tab=prospectos&sourceId=…`—
 * en vez de ampliar una superficie de acciones que todavía conserva el
 * comportamiento heredado fuera de Prospectos (eso es CUT4-C).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveBatchCandidatesPanelState,
  buildProspectosBatchReviewHref,
} from '../batch-candidates-panel-state';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';

const BATCH_ID = '11111111-2222-3333-4444-555555555555';
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('CUT4-A1 § 9 — un lote con candidatos NUNCA se declara vacío', () => {
  it('todos los durables están omitidos por el clasificador: no dice «Sin empresas candidatas»', () => {
    const state = resolveBatchCandidatesPanelState({
      batchId: BATCH_ID,
      durableTotal: 7,
      listedCount: 0,
    });
    assert.notEqual(state.headline, 'Sin empresas candidatas');
    assert.equal(state.headline, '7 empresas candidatas');
    assert.equal(state.hasDurableCandidates, true);
  });

  it('el caso de Gate 0 (100 en 24 lotes): 4 durables, 0 listados', () => {
    const state = resolveBatchCandidatesPanelState({
      batchId: BATCH_ID,
      durableTotal: 4,
      listedCount: 0,
    });
    assert.equal(state.unlistedCount, 4);
    assert.equal(state.showReviewCallout, true);
    assert.match(state.calloutMessage ?? '', /4 candidatos/);
  });

  it('un lote REALMENTE vacío sí lo dice, y no ofrece navegación', () => {
    const state = resolveBatchCandidatesPanelState({
      batchId: BATCH_ID,
      durableTotal: 0,
      listedCount: 0,
    });
    assert.equal(state.headline, 'Sin empresas candidatas');
    assert.equal(state.hasDurableCandidates, false);
    assert.equal(state.showReviewCallout, false);
    assert.equal(state.calloutMessage, null);
  });

  it('si todo lo durable ya está en la tabla, no hay aviso que dar', () => {
    const state = resolveBatchCandidatesPanelState({
      batchId: BATCH_ID,
      durableTotal: 3,
      listedCount: 3,
    });
    assert.equal(state.headline, '3 empresas candidatas');
    assert.equal(state.unlistedCount, 0);
    assert.equal(state.showReviewCallout, false);
  });

  it('singular/plural del encabezado', () => {
    assert.equal(
      resolveBatchCandidatesPanelState({ batchId: BATCH_ID, durableTotal: 1, listedCount: 0 })
        .headline,
      '1 empresa candidata',
    );
  });

  it('una tabla con filas nunca convive con un total de cero', () => {
    // Si el conteo durable llegara corto (lectura fallida), manda lo renderizado:
    // el panel puede quedarse corto, pero no puede negar lo que se está viendo.
    const state = resolveBatchCandidatesPanelState({
      batchId: BATCH_ID,
      durableTotal: 0,
      listedCount: 5,
    });
    assert.equal(state.headline, '5 empresas candidatas');
    assert.equal(state.unlistedCount, 0);
  });

  it('entradas basura no fabrican ni borran filas', () => {
    for (const bad of [NaN, -3, Infinity, undefined as unknown as number]) {
      const state = resolveBatchCandidatesPanelState({
        batchId: BATCH_ID,
        durableTotal: bad,
        listedCount: bad,
      });
      assert.equal(state.headline, 'Sin empresas candidatas');
      assert.equal(state.unlistedCount, 0);
    }
  });
});

describe('CUT4-A1 § 9/§ 10 — el enlace seguro a la cola oficial', () => {
  it('la forma exacta es /accounts?tab=prospectos&sourceId=<batchId>', () => {
    assert.equal(
      buildProspectosBatchReviewHref(BATCH_ID),
      `/accounts?tab=prospectos&sourceId=${BATCH_ID}`,
    );
  });

  it('sale de la constante canónica de navegación, no de una cadena suelta', () => {
    assert.equal(PROSPECTOS_TAB_ROUTE, '/accounts?tab=prospectos');
    assert.ok(buildProspectosBatchReviewHref(BATCH_ID).startsWith(PROSPECTOS_TAB_ROUTE));
    const src = read('src/components/prospect-batches/batch-candidates-panel-state.ts');
    assert.ok(src.includes("from '@/config/navigation'"));
  });

  it('el batchId va escapado: no se puede inyectar otro parámetro', () => {
    const href = buildProspectosBatchReviewHref('abc&status=approved');
    assert.equal(href, '/accounts?tab=prospectos&sourceId=abc%26status%3Dapproved');
  });

  it('el estado del panel expone ese mismo enlace', () => {
    const state = resolveBatchCandidatesPanelState({
      batchId: BATCH_ID,
      durableTotal: 9,
      listedCount: 2,
    });
    assert.equal(state.prospectosHref, `/accounts?tab=prospectos&sourceId=${BATCH_ID}`);
  });

  it('no se crea pestaña, página ni cola nuevas', () => {
    const src = read('src/components/prospect-batches/batch-candidates-panel-state.ts');
    for (const forbidden of ['tab=revision', 'tab=omitidos', '/prospect-batches/review', 'router']) {
      assert.ok(!src.includes(forbidden), forbidden);
    }
  });

  it('el helper es PURO: sin I/O, sin React, sin reloj', () => {
    const src = read('src/components/prospect-batches/batch-candidates-panel-state.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['createClient', 'process.env', 'Date.now', 'new Date(', 'fetch(']) {
      assert.ok(!src.includes(forbidden), forbidden);
    }
  });
});

describe('CUT4-A1 § 12 — la ficha del lote usa el conteo del servidor', () => {
  const page = read('src/app/(sellup)/prospect-batches/[batchId]/page.tsx');

  it('los totales de las tarjetas salen de batch.*, no de usefulCandidates', () => {
    // Falla sobre `main`: allí `counts.total` era `usefulCandidates.length`.
    assert.ok(page.includes('total: batch.total_candidates ?? 0,'));
    assert.ok(page.includes('needs_review: batch.needs_review_count ?? 0,'));
    assert.ok(page.includes('approved: batch.approved_count ?? 0,'));
    assert.ok(page.includes('discarded: batch.discarded_count ?? 0,'));
    assert.ok(page.includes('converted: batch.converted_count ?? 0,'));
    assert.ok(page.includes('duplicates: batch.duplicate_count ?? 0,'));
    assert.ok(
      !/total:\s*usefulCandidates\.length/.test(page),
      'el conteo volvió a depender del clasificador',
    );
  });

  it('el encabezado del panel sale del helper, no de usefulCandidates.length', () => {
    assert.ok(page.includes('{candidatesPanel.headline}'));
    assert.ok(
      !/usefulCandidates\.length === 0[\s\S]{0,80}Sin empresas candidatas/.test(page),
      'el cero falso volvió al encabezado',
    );
  });

  it('el aviso y el enlace seguro están montados', () => {
    assert.ok(page.includes('candidatesPanel.showReviewCallout'));
    assert.ok(page.includes('href={candidatesPanel.prospectosHref}'));
    assert.ok(page.includes('Revisar en Prospectos'));
  });
});
