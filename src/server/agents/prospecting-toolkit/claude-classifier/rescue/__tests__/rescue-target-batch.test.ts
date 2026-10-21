/**
 * AGENT1-CRITERIA-QUICK-WINS-1 § 3 — el rescate en segundo plano también corre
 * cuando la búsqueda falló pero dejó filas gratuitas en el lote.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRescueTargetBatchId } from '../rescue-target-batch';

describe('resolveRescueTargetBatchId', () => {
  it('corrida con éxito ⇒ su lote', () => {
    assert.equal(resolveRescueTargetBatchId({ ok: true, batchId: 'b1' }), 'b1');
  });

  it('éxito sin lote ⇒ nada', () => {
    assert.equal(resolveRescueTargetBatchId({ ok: true }), null);
  });

  it('fallo con aporte gratuito persistido ⇒ el lote del aporte', () => {
    assert.equal(
      resolveRescueTargetBatchId({ ok: false, freeContribution: { batchId: 'free-1', persistedCandidates: 3 } }),
      'free-1',
    );
  });

  it('fallo sin filas gratuitas ⇒ nada que rescatar', () => {
    assert.equal(resolveRescueTargetBatchId({ ok: false, freeContribution: { batchId: 'free-1', persistedCandidates: 0 } }), null);
    assert.equal(resolveRescueTargetBatchId({ ok: false }), null);
    assert.equal(resolveRescueTargetBatchId({ ok: false, batchId: 'b1' }), null);
  });
});
