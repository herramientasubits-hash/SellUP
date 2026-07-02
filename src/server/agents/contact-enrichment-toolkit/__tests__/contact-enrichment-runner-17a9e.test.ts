/**
 * Tests — Hito 17A.9E: Normalizar ciclo de vida de runs ready_to_enrich
 *
 * Prueba supersedePreviousReadyRuns directamente via DI pura.
 * Sin DB, sin red, sin Apollo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  supersedePreviousReadyRuns,
  type SupersededRunRow,
  type SupersedeRunsDeps,
} from '../contact-enrichment-runner';

// ── Harness ───────────────────────────────────────────────────────────────────

interface SupersedeHarness {
  deps: SupersedeRunsDeps;
  getMarkedSuperseded: () => Array<{ id: string; summary: Record<string, unknown> }>;
  getBackfillCalls: () => Array<{ accountId: string; newRunId: string }>;
}

function makeHarness(
  readyToEnrichRuns: SupersededRunRow[],
  supersededRuns: SupersededRunRow[] = [],
): SupersedeHarness {
  const markedSuperseded: Array<{ id: string; summary: Record<string, unknown> }> = [];
  const backfillCalls: Array<{ accountId: string; newRunId: string }> = [];

  const deps: SupersedeRunsDeps = {
    loadReadyToEnrichRuns: async (_accountId) => readyToEnrichRuns,
    markSuperseded: async (id, patchSummary) => {
      markedSuperseded.push({ id, summary: patchSummary });
    },
    backfillSupersededByRunId: async (accountId, newRunId) => {
      backfillCalls.push({ accountId, newRunId });
    },
  };

  return {
    deps,
    getMarkedSuperseded: () => markedSuperseded,
    getBackfillCalls: () => backfillCalls,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('supersedePreviousReadyRuns — Hito 17A.9E', () => {

  it('supersede un run ready_to_enrich anterior de la misma cuenta', async () => {
    const prev: SupersededRunRow = { id: 'prev-001', summary: { totalCandidates: 0 } };
    const h = makeHarness([prev]);

    await supersedePreviousReadyRuns('account-siteco', 'new-run-001', h.deps);

    const marked = h.getMarkedSuperseded();
    assert.equal(marked.length, 1);
    assert.equal(marked[0].id, 'prev-001');
    assert.equal(marked[0].summary.superseded_reason, 'new_ready_to_enrich_run_created');
    assert.equal(marked[0].summary.original_status, 'ready_to_enrich');
    assert.ok(typeof marked[0].summary.superseded_at === 'string');
  });

  it('supersede múltiples runs ready_to_enrich anteriores de la misma cuenta', async () => {
    const prevRuns: SupersededRunRow[] = [
      { id: 'prev-001', summary: {} },
      { id: 'prev-002', summary: { foo: 'bar' } },
    ];
    const h = makeHarness(prevRuns);

    await supersedePreviousReadyRuns('account-siteco', 'new-run-001', h.deps);

    const ids = h.getMarkedSuperseded().map((m) => m.id);
    assert.deepEqual(ids.sort(), ['prev-001', 'prev-002']);
  });

  it('no llama markSuperseded cuando no hay runs ready_to_enrich anteriores', async () => {
    const h = makeHarness([]);

    await supersedePreviousReadyRuns('account-siteco', 'new-run-001', h.deps);

    assert.equal(h.getMarkedSuperseded().length, 0);
  });

  it('no hace nada cuando account_id es null (empresa manual sin cuenta)', async () => {
    const prev: SupersededRunRow = { id: 'prev-001', summary: {} };
    const h = makeHarness([prev]);

    await supersedePreviousReadyRuns(null, 'new-run-001', h.deps);

    assert.equal(h.getMarkedSuperseded().length, 0);
    assert.equal(h.getBackfillCalls().length, 0);
  });

  it('llama backfillSupersededByRunId con el nuevo run id', async () => {
    const prev: SupersededRunRow = { id: 'prev-001', summary: {} };
    const h = makeHarness([prev]);

    await supersedePreviousReadyRuns('account-bancolombia', 'new-run-999', h.deps);

    const backfills = h.getBackfillCalls();
    assert.equal(backfills.length, 1);
    assert.equal(backfills[0].accountId, 'account-bancolombia');
    assert.equal(backfills[0].newRunId, 'new-run-999');
  });

  it('preserva metadata existente del summary al marcar superseded', async () => {
    const prev: SupersededRunRow = {
      id: 'prev-001',
      summary: {
        totalCandidates: 3,
        existing_contacts_snapshot: { combined: { total_existing_contacts: 5 } },
      },
    };
    const h = makeHarness([prev]);

    await supersedePreviousReadyRuns('account-siesa', 'new-run-001', h.deps);

    const patch = h.getMarkedSuperseded()[0].summary;
    assert.equal(patch.totalCandidates, 3);
    assert.ok(patch.existing_contacts_snapshot !== undefined);
    assert.equal(patch.superseded_reason, 'new_ready_to_enrich_run_created');
  });

  it('no llama backfillSupersededByRunId si no había runs previos', async () => {
    const h = makeHarness([]);

    await supersedePreviousReadyRuns('account-siteco', 'new-run-001', h.deps);

    assert.equal(h.getBackfillCalls().length, 0);
  });

  it('supersede no afecta runs de otras cuentas (loadReadyToEnrichRuns filtra por cuenta)', async () => {
    // El dep loadReadyToEnrichRuns recibe el account_id correcto
    let receivedAccountId: string | null = null;
    const deps: SupersedeRunsDeps = {
      loadReadyToEnrichRuns: async (accId) => {
        receivedAccountId = accId;
        return [];
      },
      markSuperseded: async () => {},
      backfillSupersededByRunId: async () => {},
    };

    await supersedePreviousReadyRuns('account-siteco', 'new-run-001', deps);

    assert.equal(receivedAccountId, 'account-siteco');
  });

  it('superseded_at es un string ISO válido', async () => {
    const prev: SupersededRunRow = { id: 'prev-001', summary: {} };
    const h = makeHarness([prev]);

    await supersedePreviousReadyRuns('account-siteco', 'new-run-001', h.deps);

    const supersededAt = h.getMarkedSuperseded()[0].summary.superseded_at as string;
    assert.ok(typeof supersededAt === 'string');
    assert.ok(!isNaN(Date.parse(supersededAt)));
  });
});
