import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runHubSpotFirstStage, type HubSpotFirstStageDeps } from '../hubspot-first-stage.server';
import type { ExistingContactSnapshot, ExistingContactsSnapshotResult } from '@/modules/contact-enrichment/types';

const hr = (id: string, email: string | null = `${id}@e.com`): ExistingContactSnapshot => ({
  id,
  source: 'hubspot',
  fullName: `Persona ${id}`,
  email,
  title: 'Director de Talento Humano',
  completeness: { hasEmail: !!email, hasPhone: false, hasLinkedin: false },
});

function snapshot(hubspot: ExistingContactSnapshot[], status: 'success' | 'skipped' | 'error' = 'success'): ExistingContactsSnapshotResult {
  return {
    sellup: { status: 'success', contacts: [], count: 0 },
    hubspot: { status, contacts: hubspot, count: hubspot.length, reason: status === 'success' ? undefined : 'sin permiso' },
    combined: {} as ExistingContactsSnapshotResult['combined'],
  };
}

function deps(over: Partial<HubSpotFirstStageDeps> & { inserted?: unknown[] } = {}): HubSpotFirstStageDeps {
  const inserted = over.inserted ?? [];
  return {
    loadRunRef: async () => ({ accountId: 'acc-1', hubspotCompanyId: 'hs-1' }),
    readSnapshot: async () => snapshot([hr('a'), hr('b'), hr('c')]),
    loadRunHubspotCandidates: async () => [],
    insertRows: async (_id, rows) => {
      inserted.push(...rows);
      return {};
    },
    ...over,
  };
}

describe('Primero HubSpot — etapa', () => {
  it('3 relevantes con correo: inserta y queda satisfecha', async () => {
    const inserted: unknown[] = [];
    const result = await runHubSpotFirstStage({ attemptId: 'run-1' }, deps({ inserted }));
    assert.deepEqual(result, {
      status: 'done', satisfied: true, inserted: 3, relevantWithEmail: 3,
      breakdown: { hubspotContacts: 3, otherSeller: 0, knownInSellUp: 0, notRelevant: 0, noName: 0, alreadyInRun: 0 },
    });
    assert.equal(inserted.length, 3);
  });

  it('menos de 3: inserta pero no basta (se seguirá con Apollo)', async () => {
    const result = await runHubSpotFirstStage(
      { attemptId: 'run-1' },
      deps({ readSnapshot: async () => snapshot([hr('a'), hr('b')]) }),
    );
    assert.equal(result.status, 'done');
    assert.equal(result.satisfied, false);
    assert.equal(result.inserted, 2);
  });

  it('un reintento cuenta lo que ya estaba en la corrida y no lo duplica', async () => {
    const inserted: unknown[] = [];
    const result = await runHubSpotFirstStage(
      { attemptId: 'run-1' },
      deps({
        inserted,
        loadRunHubspotCandidates: async () => [
          { hubspotId: 'a', hasEmail: true },
          { hubspotId: 'b', hasEmail: true },
        ],
      }),
    );
    assert.equal(inserted.length, 1);
    assert.deepEqual(result, {
      status: 'done', satisfied: true, inserted: 1, relevantWithEmail: 3,
      breakdown: { hubspotContacts: 3, otherSeller: 0, knownInSellUp: 0, notRelevant: 0, noName: 0, alreadyInRun: 2 },
    });
  });

  it('sin ID de HubSpot, con HubSpot caído o con error: no satisface y no rompe', async () => {
    assert.equal((await runHubSpotFirstStage({ attemptId: 'r' }, deps({ loadRunRef: async () => ({ accountId: 'a', hubspotCompanyId: null }) }))).status, 'no_hubspot_company');
    assert.equal((await runHubSpotFirstStage({ attemptId: 'r' }, deps({ readSnapshot: async () => snapshot([], 'skipped') }))).status, 'hubspot_unavailable');
    const failing = await runHubSpotFirstStage({ attemptId: 'r' }, deps({ readSnapshot: async () => { throw new Error('boom'); } }));
    assert.equal(failing.status, 'error');
    assert.equal(failing.satisfied, false);
    const insertFails = await runHubSpotFirstStage({ attemptId: 'r' }, deps({ insertRows: async () => ({ error: 'db' }) }));
    assert.equal(insertFails.status, 'error');
    assert.equal(insertFails.satisfied, false);
  });
});
