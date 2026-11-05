// AGENT2A-COMPANY-SEARCH-COUNTS (Bryan 29-10) — conteos separados de «Buscar contactos» y
// contactos de HubSpot completos que pasan directo a Contactos.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RunAutomaticContactEnrichmentForRequestResult } from '../automatic-routing-action-core';
import {
  contactCountLines,
  contactCountsFromSummary,
  isCompleteHubSpotCandidate,
  summarizeContactSearch,
  sumContactCounts,
} from '../contact-search-summary';
import {
  runContactSearchFollowUp,
  type ContactSearchFollowUpDeps,
  type FollowUpPendingCandidate,
} from '../contact-search-follow-up-core';
import { buildContactSearchNotice, contactsFound, type ContactSearchRun } from '../contact-search-runs-store';
import { selectHubSpotFirstCandidates } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-core';
import { runHubSpotFirstStage } from '@/server/agents/contact-enrichment-toolkit/hubspot-first-stage.server';
import type { ExistingContactSnapshot, ExistingContactsSnapshotResult } from '@/modules/contact-enrichment/types';
import {
  NEXT_COMPANY_HINT,
  contactEnrichmentChatReducer,
  createInitialContactEnrichmentChatState,
  isComposerUnlocked,
} from '@/components/contact-enrichment/contact-enrichment-chat-reducer';
import {
  createHubSpotIdBatchConversation,
  isHubSpotIdBatchComposerUnlocked,
} from '@/components/contact-enrichment/hubspot-id-batch-conversation';
import type { HubSpotIdBatchItemResult } from '../hubspot-id-batch-core';

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
    assert.deepEqual(contactCountLines(contactCountsFromSummary(s)), [
      '2 contactos aprobados | 2 contactos nuevos',
      '13 contactos por aprobar | 7 encontrados, 6 de ejecuciones anteriores',
    ]);
  });
});

// ── Bryan 04-11 · aprobados de la empresa y el aviso de dos líneas ─────────────

describe('aprobados de la empresa (anteriores + los de ahora)', () => {
  it('cuenta los aprobados de esta búsqueda y de las anteriores, después de aprobar', async () => {
    const asked: string[][] = [];
    const out = await runContactSearchFollowUp(
      'req-1',
      routed(),
      deps([cand('h-now', 'run-now-1')], {
        countApprovedCandidates: async (runIds) => {
          asked.push([...runIds]);
          return 9;
        },
      }),
    );
    assert.deepEqual(asked, [['run-now-1', 'run-now-2', 'run-old']]);
    assert.equal(out.approvedContactsTotal, 9);
  });

  it('nunca menos que lo aprobado ahora', async () => {
    const out = await runContactSearchFollowUp(
      'req-1',
      routed(),
      deps([cand('h-now', 'run-now-1'), cand('h-old', 'run-old')], { countApprovedCandidates: async () => 0 }),
    );
    assert.equal(out.approvedContactsTotal, 2);
  });

  it('falla abierto: si el conteo falla (o no hay búsquedas anteriores legibles) no se informa', async () => {
    const failing = await runContactSearchFollowUp(
      'req-1',
      routed(),
      deps([], { countApprovedCandidates: async () => { throw new Error('boom'); } }),
    );
    assert.equal(failing.approvedContactsTotal, undefined);
    const noEarlier = await runContactSearchFollowUp(
      'req-1',
      routed(),
      deps([], {
        loadEarlierCompanyRunIds: async () => { throw new Error('boom'); },
        countApprovedCandidates: async () => 5,
      }),
    );
    assert.equal(noEarlier.approvedContactsTotal, undefined);
  });

  it('el resumen usa el total y, sin él, al menos lo aprobado ahora', () => {
    assert.equal(summarizeContactSearch(routed({ approvedContactsTotal: 7, hubspotAutoApprovedContacts: 2 })).approvedTotal, 7);
    const without = summarizeContactSearch(routed({ hubspotAutoApprovedContacts: 2, hubspotAutoApprovedEarlierContacts: 1 }));
    assert.equal(without.approvedNow, 3);
    assert.equal(without.approvedTotal, 3);
  });
});

describe('las dos líneas (aviso, Centro de procesos, chat y lote)', () => {
  it('singular y plural, y siempre las dos líneas aunque sean cero', () => {
    assert.deepEqual(contactCountLines({ approvedTotal: 1, approvedNow: 1, foundForReview: 1, previousPending: 1 }), [
      '1 contacto aprobado | 1 contacto nuevo',
      '2 contactos por aprobar | 1 encontrado, 1 de ejecuciones anteriores',
    ]);
    assert.deepEqual(contactCountLines({ approvedTotal: 0, approvedNow: 0, foundForReview: 0, previousPending: 0 }), [
      '0 contactos aprobados | 0 contactos nuevos',
      '0 contactos por aprobar | 0 encontrados, 0 de ejecuciones anteriores',
    ]);
  });

  it('suma las cifras de varias empresas', () => {
    const one = { approvedTotal: 3, approvedNow: 1, foundForReview: 2, previousPending: 4 };
    assert.deepEqual(sumContactCounts([one, one]), { approvedTotal: 6, approvedNow: 2, foundForReview: 4, previousPending: 8 });
  });
});

describe('buildContactSearchNotice — el aviso al terminar', () => {
  const run = (over: Partial<ContactSearchRun>): ContactSearchRun => ({
    id: 'r1', requestId: 'req-1', accountId: 'acc-1', companyName: 'Productos Innovador (Pigroup)',
    status: 'succeeded', startedAtMs: 0, finishedAtMs: 1, found: null, message: null, detached: false, ...over,
  });

  it('la empresa como título y las dos líneas; «Ver en Por revisar» si hay qué aprobar', () => {
    const notice = buildContactSearchNotice(
      run({ result: routed({ hubspotFirstCandidates: 1, providerCandidatesCreated: { apollo: 2, lusha: null }, approvedContactsTotal: 7, previousPendingReviewCandidates: 6 }) }),
    );
    assert.equal(notice.kind, 'success');
    assert.equal(notice.title, 'Productos Innovador (Pigroup)');
    assert.equal(
      notice.description,
      '7 contactos aprobados | 0 contactos nuevos\n9 contactos por aprobar | 3 encontrados, 6 de ejecuciones anteriores',
    );
    assert.equal(notice.review, true);
  });

  it('sin nada por aprobar no ofrece revisar, pero muestra lo ya aprobado', () => {
    const notice = buildContactSearchNotice(
      run({ result: routed({ hubspotFirstCandidates: 0, providerCandidatesCreated: { apollo: 0, lusha: 0 }, approvedContactsTotal: 4 }) }),
    );
    assert.equal(notice.review, false);
    assert.match(notice.description, /^4 contactos aprobados \| 0 contactos nuevos/);
  });

  it('si falla: la empresa y el motivo', () => {
    const notice = buildContactSearchNotice(run({ status: 'failed', message: 'Sin créditos de Apollo.' }));
    assert.equal(notice.kind, 'error');
    assert.equal(notice.description, 'No pudimos buscar contactos: Sin créditos de Apollo.');
    assert.equal(notice.review, false);
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

// ── Bryan 04-11 · la conversación sigue después de buscar ──────────────────────

describe('chat de una empresa: la conversación sigue después de buscar', () => {
  const settled = () => {
    let state = createInitialContactEnrichmentChatState();
    state = contactEnrichmentChatReducer(state, { type: 'SUBMIT_QUERY', query: 'Acme' });
    return contactEnrichmentChatReducer(
      { ...state, step: 'searching_contacts' },
      { type: 'AUTOMATIC_ROUTING_SETTLED', result: routed({ providerCandidatesCreated: { apollo: 0, lusha: 0 }, hubspotFirstCandidates: 0 }) },
    );
  };

  it('la caja se activa al terminar (con o sin contactos) y tras un error; antes de buscar no', () => {
    assert.equal(isComposerUnlocked({ step: 'await_company', automaticResult: null }), true);
    assert.equal(isComposerUnlocked({ step: 'done', automaticResult: null }), false);
    assert.equal(isComposerUnlocked(settled()), true);
    assert.equal(isComposerUnlocked({ step: 'error', automaticResult: null }), true);
    assert.equal(isComposerUnlocked({ step: 'searching_contacts', automaticResult: null }), false);
  });

  it('el mensaje de Rumbo termina invitando a escribir otra empresa', () => {
    assert.match(settled().messages.at(-1)?.content ?? '', new RegExp(`${NEXT_COMPANY_HINT.replace('.', '\\.')}$`));
  });

  it('otra empresa sigue en la MISMA conversación: conserva los mensajes y limpia la empresa', () => {
    const before = settled();
    const next = contactEnrichmentChatReducer(
      contactEnrichmentChatReducer(before, { type: 'NEXT_COMPANY' }),
      { type: 'SUBMIT_QUERY', query: 'Globex' },
    );
    assert.equal(next.step, 'resolving');
    assert.equal(next.query, 'Globex');
    assert.equal(next.automaticResult, null);
    assert.equal(next.requestId, null);
    assert.deepEqual(next.messages.slice(0, before.messages.length), before.messages);
    assert.equal(next.messages.at(-1)?.content, 'Globex');
    // Sin ids repetidos en el hilo.
    assert.equal(new Set(next.messages.map((m) => m.id)).size, next.messages.length);
  });
});

// ── Bryan 04-11 · el lote por IDs: conversación fuera del panel ────────────────

describe('lote por IDs: la conversación sigue y el aviso es uno solo', () => {
  const row = (id: string): HubSpotIdBatchItemResult => ({
    hubspotCompanyId: id, status: 'processed', name: `Empresa ${id}`, country: null, accountId: `acc-${id}`,
    approvedContacts: 2, approvedNow: 1, contactsFound: 3, previousPendingContacts: 1,
    routingDisabled: false, errorMessage: null,
  });

  it('termina, avisa UNA vez con las cifras sumadas y deja escribir otra lista en la misma conversación', async () => {
    const settledCalls: Array<{ n: number; cancelled: boolean }> = [];
    const conversation = createHubSpotIdBatchConversation({
      runItem: async (id) => row(id),
      onBatchSettled: (results, cancelled) => settledCalls.push({ n: results.length, cancelled }),
    });
    await conversation.send('1, 2');
    let state = conversation.getSnapshot();
    assert.equal(state.step, 'done');
    assert.equal(isHubSpotIdBatchComposerUnlocked(state.step), true);
    assert.deepEqual(settledCalls, [{ n: 2, cancelled: false }]);
    assert.match(state.messages.at(-1)?.content ?? '', /• 4 contactos aprobados \| 2 contactos nuevos/);
    assert.match(state.messages.at(-1)?.content ?? '', /• 8 contactos por aprobar \| 6 encontrados, 2 de ejecuciones anteriores/);
    const before = state.messages.length;

    await conversation.send('3');
    state = conversation.getSnapshot();
    assert.equal(state.step, 'done');
    assert.ok(state.messages.length > before);
    assert.deepEqual(state.results.map((r) => r.hubspotCompanyId), ['3']);
    assert.equal(settledCalls.length, 2);
  });

  it('cancelar no inicia las que faltan; reset vuelve al saludo', async () => {
    const holder: { conversation?: ReturnType<typeof createHubSpotIdBatchConversation> } = {};
    const conversation = createHubSpotIdBatchConversation({
      runItem: async (id) => {
        // «Nueva conversación» mientras la PRIMERA empresa está buscando.
        holder.conversation?.cancel();
        return row(id);
      },
    });
    holder.conversation = conversation;
    await conversation.send('1,2,3');
    const state = conversation.getSnapshot();
    assert.equal(state.step, 'cancelled');
    assert.deepEqual(state.notStartedIds, ['2', '3']);
    assert.equal(isHubSpotIdBatchComposerUnlocked(state.step), true);
    conversation.reset();
    assert.equal(conversation.getSnapshot().messages.length, 1);
    assert.equal(conversation.getSnapshot().step, 'await_ids');
  });

  it('mientras corre no acepta otra lista', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const conversation = createHubSpotIdBatchConversation({
      runItem: async (id) => {
        calls.push(id);
        await gate;
        return row(id);
      },
    });
    const first = conversation.send('1');
    await conversation.send('2');
    release();
    await first;
    assert.deepEqual(calls, ['1']);
  });
});
