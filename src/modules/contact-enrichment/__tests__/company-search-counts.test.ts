// AGENT2A-COMPANY-SEARCH-COUNTS (Bryan 29-10) — conteos separados de «Buscar contactos» y
// contactos de HubSpot completos que pasan directo a Contactos.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RunAutomaticContactEnrichmentForRequestResult } from '../automatic-routing-action-core';
import {
  contactSearchCountsLine,
  isCompleteHubSpotCandidate,
  summarizeContactSearch,
} from '../contact-search-summary';
import {
  runContactSearchFollowUp,
  type ContactSearchFollowUpDeps,
  type FollowUpPendingCandidate,
} from '../contact-search-follow-up-core';
import { contactsFound } from '../contact-search-runs-store';
import { selectHubSpotFirstCandidates } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-core';
import { runHubSpotFirstStage } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-stage.server';
import type { ExistingContactSnapshot, ExistingContactsSnapshotResult } from '@/modules/contact-enrichment/types';

function routed(over: Partial<RunAutomaticContactEnrichmentForRequestResult> = {}): RunAutomaticContactEnrichmentForRequestResult {
  return {
    success: true,
    status: 'fallback_executed',
    automaticRoutingEnabled: true,
    fallbackExecuted: true,
    attempt1AttemptId: 'run-now-1',
    attempt2AttemptId: 'run-now-2',
    blockedReason: null,
    reusedExistingCandidates: 0,
    providerCandidatesCreated: { apollo: 2, lusha: 1 },
    failedProviders: [],
    hubspotFirstCandidates: 3,
    ...over,
  };
}

const cand = (id: string, run: string, over: Partial<FollowUpPendingCandidate> = {}): FollowUpPendingCandidate => ({
  id,
  source: 'hubspot',
  email: `${id}@empresa.com`,
  phone: '+57 300 000 0000',
  linkedin_url: `https://linkedin.com/in/${id}`,
  enrichment_run_id: run,
  ...over,
});

function deps(
  pending: FollowUpPendingCandidate[],
  over: Partial<ContactSearchFollowUpDeps> = {},
): ContactSearchFollowUpDeps & { approvedIds: string[] } {
  const approvedIds: string[] = [];
  return {
    approvedIds,
    loadEarlierCompanyRunIds: async () => ['run-old'],
    loadPendingCandidates: async (runIds) => pending.filter((c) => runIds.includes(c.enrichment_run_id)),
    approveCandidate: async (id) => {
      approvedIds.push(id);
      return { ok: true };
    },
    ...over,
  };
}

describe('isCompleteHubSpotCandidate', () => {
  it('sólo un contacto de HubSpot con correo, teléfono y LinkedIn', () => {
    assert.equal(isCompleteHubSpotCandidate(cand('a', 'r')), true);
    assert.equal(isCompleteHubSpotCandidate(cand('a', 'r', { phone: null })), false);
    assert.equal(isCompleteHubSpotCandidate(cand('a', 'r', { email: '  ' })), false);
    assert.equal(isCompleteHubSpotCandidate(cand('a', 'r', { linkedin_url: null })), false);
    assert.equal(isCompleteHubSpotCandidate(cand('a', 'r', { source: 'apollo' })), false);
  });
});

describe('runContactSearchFollowUp', () => {
  it('aprueba los de HubSpot completos y cuenta los pendientes de búsquedas anteriores', async () => {
    const pending = [
      cand('h-now-complete', 'run-now-1'),
      cand('h-now-no-phone', 'run-now-1', { phone: null }),
      cand('apollo-now', 'run-now-1', { source: 'apollo' }),
      cand('h-old-complete', 'run-old'),
      cand('apollo-old', 'run-old', { source: 'apollo' }),
      cand('h-old-no-linkedin', 'run-old', { linkedin_url: null }),
    ];
    const d = deps(pending);
    const out = await runContactSearchFollowUp('req-1', routed(), d);
    assert.deepEqual(d.approvedIds, ['h-now-complete', 'h-old-complete']);
    assert.equal(out.hubspotAutoApprovedContacts, 1);
    assert.equal(out.hubspotAutoApprovedEarlierContacts, 1);
    assert.equal(out.previousPendingReviewCandidates, 2);
  });

  it('una aprobación que falla deja al candidato en «Por revisar» y en el conteo', async () => {
    const pending = [cand('h-now', 'run-now-1'), cand('h-old', 'run-old')];
    const out = await runContactSearchFollowUp(
      'req-1',
      routed(),
      deps(pending, { approveCandidate: async (id) => ({ ok: id === 'h-now' }) }),
    );
    assert.equal(out.hubspotAutoApprovedContacts, 1);
    assert.equal(out.hubspotAutoApprovedEarlierContacts, 0);
    assert.equal(out.previousPendingReviewCandidates, 1);
  });

  it('respeta el tope por búsqueda y prioriza los de esta búsqueda', async () => {
    const pending = [cand('old-1', 'run-old'), cand('now-1', 'run-now-1'), cand('now-2', 'run-now-2')];
    const d = deps(pending, { maxAutoApprovals: 2 });
    const out = await runContactSearchFollowUp('req-1', routed(), d);
    assert.deepEqual(d.approvedIds, ['now-1', 'now-2']);
    assert.equal(out.previousPendingReviewCandidates, 1);
  });

  it('falla abierto: si no puede leer candidatos devuelve el resultado tal cual', async () => {
    const original = routed();
    const out = await runContactSearchFollowUp(
      'req-1',
      original,
      deps([], { loadPendingCandidates: async () => { throw new Error('boom'); } }),
    );
    assert.equal(out, original);
  });

  it('sin poder leer búsquedas anteriores igual aprueba lo de esta búsqueda', async () => {
    const d = deps([cand('h-now', 'run-now-1')], { loadEarlierCompanyRunIds: async () => { throw new Error('boom'); } });
    const out = await runContactSearchFollowUp('req-1', routed(), d);
    assert.equal(out.hubspotAutoApprovedContacts, 1);
    assert.equal(out.previousPendingReviewCandidates, 0);
  });

  it('no hace nada si la búsqueda no corrió', async () => {
    const d = deps([cand('h', 'run-now-1')]);
    const blocked = routed({ attempt1AttemptId: null });
    assert.equal(await runContactSearchFollowUp('req-1', blocked, d), blocked);
    const disabled = routed({ automaticRoutingEnabled: false });
    assert.equal(await runContactSearchFollowUp('req-1', disabled, d), disabled);
    assert.deepEqual(d.approvedIds, []);
  });
});

describe('summarizeContactSearch / contactsFound / aviso', () => {
  it('separa HubSpot (a Contactos y a «Por revisar»), otras fuentes y lo anterior', () => {
    const result = routed({
      hubspotFirstCandidates: 5,
      hubspotAutoApprovedContacts: 2,
      contactBankCandidates: 1,
      previousPendingReviewCandidates: 6,
      diagnosis: {
        apolloSkipped: false, apolloOrganization: null, apolloPeopleFound: 3, apolloRejected: 0, apolloAlreadyKnown: 0,
        freeStages: { hubspotFirst: 'done', contactBank: 'done', companySite: 'not_reached' },
        lushaRecentZeroAt: null, lushaRan: true,
        hubspotFirst: { hubspotContacts: 12, otherSeller: 0, knownInSellUp: 0, notRelevant: 0, noName: 0 },
      },
    });
    const s = summarizeContactSearch(result);
    assert.equal(s.hubspotTotal, 12);
    assert.equal(s.hubspotBrought, 5);
    assert.equal(s.hubspotToContacts, 2);
    assert.equal(s.hubspotToReview, 3);
    assert.equal(s.otherSources, 4);
    assert.equal(s.previousPending, 6);
    assert.equal(s.newForReview, 7);
    // «Por revisar» = lo nuevo que quedó para revisar + lo de antes; lo que pasó a Contactos no.
    assert.equal(contactsFound(result), 13);
    assert.equal(
      contactSearchCountsLine(s),
      'HubSpot: 5 (2 a Contactos) · Otras fuentes: 4 · Ya tenías 6 en «Por revisar»',
    );
  });
});

describe('Primero HubSpot no duplica lo que ya está en «Por revisar»', () => {
  const contact = (id: string): ExistingContactSnapshot => ({
    id,
    source: 'hubspot',
    fullName: `Persona ${id}`,
    email: `${id}@e.com`,
    title: 'Directora de Talento Humano',
    completeness: { hasEmail: true, hasPhone: false, hasLinkedin: false },
  });

  it('núcleo: omite los IDs pendientes en otra corrida y los cuenta', () => {
    const selection = selectHubSpotFirstCandidates({
      hubspotContacts: [contact('a'), contact('b')],
      sellupContacts: [],
      alreadyInRunHubspotIds: new Set(),
      alreadyPendingHubspotIds: new Set(['a']),
    });
    assert.deepEqual(selection.rows.map((r) => r.source_contact_id), ['b']);
    assert.equal(selection.skippedAlreadyPending, 1);
  });

  it('etapa: pasa los IDs de HubSpot a la lectura y lo refleja en el desglose', async () => {
    const snapshot: ExistingContactsSnapshotResult = {
      sellup: { status: 'success', contacts: [], count: 0 },
      hubspot: { status: 'success', contacts: [contact('a'), contact('b')], count: 2 },
      combined: {} as ExistingContactsSnapshotResult['combined'],
    };
    let askedFor: readonly string[] = [];
    const inserted: unknown[] = [];
    const result = await runHubSpotFirstStage(
      { attemptId: 'run-1' },
      {
        loadRunRef: async () => ({ accountId: 'acc', hubspotCompanyId: 'hs' }),
        readSnapshot: async () => snapshot,
        loadRunHubspotCandidates: async () => [],
        loadPendingHubspotIdsElsewhere: async (_attempt, ids) => {
          askedFor = ids;
          return new Set(['a']);
        },
        insertRows: async (_id, rows) => {
          inserted.push(...rows);
          return {};
        },
        resolveOwnership: async () => ({ sellerOwnerId: null, directory: null }),
      },
    );
    assert.deepEqual([...askedFor], ['a', 'b']);
    assert.equal(inserted.length, 1);
    assert.equal(result.status === 'done' && result.breakdown?.alreadyPending, 1);
  });

  it('etapa: si la lectura falla no omite a nadie (como antes)', async () => {
    const snapshot: ExistingContactsSnapshotResult = {
      sellup: { status: 'success', contacts: [], count: 0 },
      hubspot: { status: 'success', contacts: [contact('a')], count: 1 },
      combined: {} as ExistingContactsSnapshotResult['combined'],
    };
    const result = await runHubSpotFirstStage(
      { attemptId: 'run-1' },
      {
        loadRunRef: async () => ({ accountId: 'acc', hubspotCompanyId: 'hs' }),
        readSnapshot: async () => snapshot,
        loadRunHubspotCandidates: async () => [],
        loadPendingHubspotIdsElsewhere: async () => {
          throw new Error('boom');
        },
        insertRows: async () => ({}),
        resolveOwnership: async () => ({ sellerOwnerId: null, directory: null }),
      },
    );
    assert.equal(result.status === 'done' && result.inserted, 1);
  });
});
