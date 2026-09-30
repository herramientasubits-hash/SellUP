/**
 * AGENT1-CONTINUATION-LUSHA-CASCADE-1 — tras una continuación, Lusha decide con
 * lo ACEPTADO, no con lo escrito.
 *
 * Medido en Producción el 2026-09-30 (México × Tecnología, lote `6d39ed4b`): la
 * continuación escribió 154 filas `needs_review` y 0 aceptadas para el objetivo
 * (5). La cascada le pasaba a Lusha `candidatesCreated` (154), así que el hueco
 * salía 0 y Lusha se saltaba con «objetivo cumplido» — al revés de lo que hace la
 * corrida en sesión, que usa `acceptedForTargetTotal` (CUT-7).
 *
 *   § 1 · la autoridad: durable del lote, después la del writer, si no ⇒ null;
 *   § 2 · el cableado de producción usa esa cifra y corre también cuando la
 *         vuelta escribió aunque el reloj de evaluación se agotara.
 *
 *   LIVE_APOLLO_CALLS = 0 · LUSHA_CALLS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveCascadeAcceptedForTarget } from '../continuation-worker';
import { decideLushaWaterfallLeg } from '@/modules/prospect-batches/chat-wizard-execution/wizard-lusha-waterfall';

describe('§ 1 — cuántas cuentan para el objetivo', () => {
  it('🔴 lote 6d39ed4b: 154 escritas, 0 aceptadas ⇒ 0, y Lusha SÍ corre con hueco 5', () => {
    const accepted = resolveCascadeAcceptedForTarget({ durableAcceptedTotal: 0, completeValidCandidates: 0 });
    assert.equal(accepted, 0);
    const decision = decideLushaWaterfallLeg({
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      apolloPendingContinuation: false,
      target: 5,
      usefulAccumulated: accepted!,
      macroIndustryKey: 'technology',
      canonicalBatchId: '6d39ed4b-0000-0000-0000-000000000000',
    });
    assert.equal(decision.run, true);
    assert.equal((decision as { gap: number }).gap, 5);

    // Y así se saltaba antes, con las filas escritas:
    const before = decideLushaWaterfallLeg({
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      apolloPendingContinuation: false,
      target: 5,
      usefulAccumulated: 154,
      macroIndustryKey: 'technology',
      canonicalBatchId: '6d39ed4b-0000-0000-0000-000000000000',
    });
    assert.deepEqual(before, { run: false, reason: 'target_reached' });
  });

  it('la cifra durable del lote manda sobre la del intento', () => {
    assert.equal(resolveCascadeAcceptedForTarget({ durableAcceptedTotal: 3, completeValidCandidates: 1 }), 3);
  });

  it('sin durable, la del writer de este intento', () => {
    assert.equal(resolveCascadeAcceptedForTarget({ durableAcceptedTotal: null, completeValidCandidates: 2 }), 2);
  });

  it('sin ninguna ⇒ null (no se autoriza gasto sin saber qué falta)', () => {
    assert.equal(resolveCascadeAcceptedForTarget({ durableAcceptedTotal: null, completeValidCandidates: undefined }), null);
    assert.equal(resolveCascadeAcceptedForTarget({ durableAcceptedTotal: -1, completeValidCandidates: Number.NaN }), null);
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('§ 2 — el cableado de producción', () => {
  const server = stripComments(
    readFileSync(path.join(__dirname, '..', 'continuation-worker.server.ts'), 'utf8'),
  );

  it('🔴 la pierna recibe lo aceptado, nunca `candidatesCreated`', () => {
    assert.match(server, /usefulAccumulated:\s*acceptedForTarget,/);
    assert.doesNotMatch(server, /usefulAccumulated:\s*outcome\.candidatesCreated/);
    assert.match(server, /resolveCascadeAcceptedForTarget\(/);
  });

  it('sin cifra medible, la cascada no corre', () => {
    assert.match(server, /if \(acceptedForTarget === null\)\s*\{[\s\S]*?return;/);
  });

  it('corre también cuando ESTA vuelta escribió el lote', () => {
    assert.match(server, /pending === 0 && \(!paused \|\| wroteThisAttempt\)/);
  });
});
