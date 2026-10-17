/**
 * AGENT3-FIRST-CALL-2 — el Agente 3 en el recorrido del Pipeline.
 *
 * Apagado, el recorrido queda EXACTAMENTE como lo armó `buildAccountJourney`. Encendido, las
 * etapas «Inteligencia de cuenta» y «Preparación y contacto» dejan de ser «Próximamente»:
 * sin nada hecho son una invitación; con algo hecho, una tarjeta con su resumen.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineOverview } from '../journey-read-model';
import { withFirstContactEvidence } from '../stages';

import { buildFirstCallEvents } from '../../speech/first-call-activity';
import type { FirstCallPack, ResearchBrief } from '../../../server/agents/first-call/types';
import { FIRST_CALL_AGENT_LABEL, applyFirstCallToJourney, isFirstCallStage, toJourneyFirstCall } from '../journey-first-call';
import { PIPELINE_STAGES } from '../stages';
import type { AccountJourney } from '../types';

const NOW = Date.parse('2026-10-16T12:00:00Z');

function baseJourney(): AccountJourney {
  return {
    account: { id: 'acc-1', name: 'Globex' },
    currentStageId: 'inteligencia',
    substatusLabel: 'Lista para investigar',
    isArchived: false,
    stages: PIPELINE_STAGES.map((stage) => ({
      stage,
      state: 'upcoming' as const,
      signals: [],
      milestoneAt: stage.id === 'inteligencia' ? '2026-09-30T10:00:00Z' : null,
      notStarted: false,
    })),
    history: [{ id: 'audit-1', kind: 'audit', at: '2026-09-30T10:00:00Z', title: 'Estado', description: null, tone: 'primary' }],
  } as unknown as AccountJourney;
}

const BRIEF: ResearchBrief = {
  id: 'b1',
  accountId: 'acc-1',
  status: 'sufficient',
  progressStage: 'done',
  summary: 'Cadena de tiendas.',
  facts: [
    { id: 'F1', topic: 'business', statement: 's', quote: null, sourceKind: 'sellup', sourceUrl: null, sourceLabel: 'SellUp', publishedOn: null },
    { id: 'F2', topic: 'talent', statement: 's', quote: 'q', sourceKind: 'official_site', sourceUrl: 'https://a', sourceLabel: 'Sitio', publishedOn: null },
  ],
  hypotheses: [],
  gaps: [],
  sources: [{ url: 'https://a', label: 'Sitio', kind: 'official_site' }],
  rejectedFacts: 1,
  costUsd: 0.07,
  model: 'm',
  createdAt: '2026-10-10T10:00:00Z',
  completedAt: '2026-10-10T10:01:00Z',
  expiresAt: '2026-11-09T10:01:00Z',
  errorCode: null,
};

function pack(id: string, overrides: Partial<FirstCallPack> = {}): FirstCallPack {
  return {
    id,
    accountId: 'acc-1',
    briefId: 'b1',
    contactId: 'c1',
    targetName: 'María Pérez',
    targetTitle: 'Gerente de Talento',
    channel: 'call',
    goal: 'book_meeting',
    goals: ['book_meeting'],
    productFocus: null,
    content: { reasonToCall: { text: 'SECRETO', factRefs: [] } } as unknown as FirstCallPack['content'],
    facts: [],
    status: 'draft',
    verifierIssues: [],
    editedScript: 'GUION PRIVADO',
    regenerationReason: null,
    costUsd: 0.04,
    model: 'm',
    createdAt: '2026-10-11T09:00:00Z',
    usedAt: null,
    discardedAt: null,
    ...overrides,
  };
}

const CONTACTS = [{ id: 'c1', name: 'María Pérez', title: 'Gerente de Talento' }];

describe('toJourneyFirstCall', () => {
  it('apagado devuelve null: el recorrido no cambia', () => {
    assert.equal(toJourneyFirstCall({ enabled: false, brief: BRIEF, packs: [pack('p1')] }, CONTACTS, NOW), null);
  });

  it('resume sin llevar guiones ni costos al navegador', () => {
    const result = toJourneyFirstCall({ enabled: true, brief: BRIEF, packs: [pack('p1')] }, CONTACTS, NOW)!;
    assert.deepEqual(result.brief, {
      status: 'sufficient',
      summary: 'Cadena de tiendas.',
      completedAt: '2026-10-10T10:01:00Z',
      factsCount: 1,
      sourcesCount: 1,
      // Por pregunta, sin los datos de SellUp (F1) ni las preguntas vacías.
      topics: [{ label: 'Talento y formación', count: 1 }],
      hypotheses: [],
      gapsCount: 0,
      expiresAt: '2026-11-09T10:01:00Z',
    });
    assert.equal(result.freshBrief, true);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('SECRETO'), false, 'el guion no viaja');
    assert.equal(serialized.includes('GUION PRIVADO'), false);
    assert.equal(serialized.includes('costUsd'), false, 'el costo no viaja');
  });

  it('sólo deja las preparaciones vivas, la más reciente primero', () => {
    const result = toJourneyFirstCall(
      {
        enabled: true,
        brief: null,
        packs: [
          pack('old', { createdAt: '2026-10-01T09:00:00Z' }),
          pack('new', { createdAt: '2026-10-05T09:00:00Z', status: 'used', usedAt: '2026-10-06T09:00:00Z' }),
          pack('gone', { status: 'discarded' }),
          pack('bad', { status: 'failed' }),
        ],
      },
      CONTACTS,
      NOW,
    )!;
    assert.deepEqual(result.packs.map((p) => p.id), ['new', 'old']);
    assert.equal(result.brief, null);
    assert.equal(result.freshBrief, false);
  });

  it('una investigación en curso todavía no es una ficha', () => {
    const result = toJourneyFirstCall({ enabled: true, brief: { ...BRIEF, status: 'running' }, packs: [] }, CONTACTS, NOW)!;
    assert.equal(result.brief, null);
  });
});

describe('applyFirstCallToJourney', () => {
  it('sin agente devuelve el MISMO recorrido', () => {
    const journey = baseJourney();
    assert.equal(applyFirstCallToJourney(journey, null), journey);
  });

  it('antes de usarlo, las dos etapas eran «Próximamente»', () => {
    const planned = baseJourney().stages.filter((e) => isFirstCallStage(e.stage.id));
    assert.deepEqual(planned.map((e) => e.stage.phase), ['mvp', 'mvp']);
  });

  it('sin nada hecho, las dos etapas son una invitación con el agente propio', () => {
    const journey = applyFirstCallToJourney(baseJourney(), toJourneyFirstCall({ enabled: true, brief: null, packs: [] }, CONTACTS, NOW));
    for (const id of ['inteligencia', 'preparacion'] as const) {
      const entry = journey.stages.find((e) => e.stage.id === id)!;
      assert.equal(entry.stage.phase, 'hecho');
      assert.equal(entry.stage.agent, FIRST_CALL_AGENT_LABEL);
      assert.equal(entry.stage.plannedText, null);
      assert.equal(entry.notStarted, true, id);
    }
  });

  it('con investigación y preparación, las etapas dejan de ser invitación y toman su fecha', () => {
    const firstCall = toJourneyFirstCall({ enabled: true, brief: BRIEF, packs: [pack('p1')] }, CONTACTS, NOW);
    const journey = applyFirstCallToJourney(baseJourney(), firstCall);
    const research = journey.stages.find((e) => e.stage.id === 'inteligencia')!;
    const prep = journey.stages.find((e) => e.stage.id === 'preparacion')!;
    assert.equal(research.notStarted, false);
    assert.equal(research.milestoneAt, '2026-10-10T10:01:00Z');
    assert.equal(prep.notStarted, false);
    assert.equal(prep.milestoneAt, '2026-10-11T09:00:00Z');
  });

  it('las demás etapas quedan igual', () => {
    const original = baseJourney();
    const journey = applyFirstCallToJourney(original, toJourneyFirstCall({ enabled: true, brief: BRIEF, packs: [] }, CONTACTS, NOW));
    for (const entry of journey.stages.filter((e) => !isFirstCallStage(e.stage.id))) {
      const before = original.stages.find((e) => e.stage.id === entry.stage.id)!;
      assert.deepEqual(entry, before);
    }
  });

  it('suma los eventos del agente al historial, ordenado', () => {
    const state = { enabled: true, brief: BRIEF, packs: [pack('p1')] };
    const journey = applyFirstCallToJourney(
      baseJourney(),
      toJourneyFirstCall(state, CONTACTS, NOW),
      buildFirstCallEvents(state.brief, state.packs),
    );
    assert.deepEqual(journey.history.map((e) => e.id), ['agent3-pack-p1', 'agent3-brief-b1', 'audit-1']);
    assert.ok(journey.history.every((e, i, all) => i === 0 || all[i - 1].at >= e.at));
  });
});

describe('etapa actual con lo que hizo el Agente 3', () => {
  it('una preparación usable deja la empresa «Lista para contacto» sin retroceder ni tocar archivadas', () => {
    assert.equal(withFirstContactEvidence('new', true), 'ready_for_outreach');
    assert.equal(withFirstContactEvidence('research_in_progress', true), 'ready_for_outreach');
    assert.equal(withFirstContactEvidence('new', false), 'new');
    assert.equal(withFirstContactEvidence('archived', true), 'archived');
  });

  it('la lista y los filtros del Pipeline cuentan la empresa en «Preparación» (caso Davivienda)', () => {
    const base = {
      country: 'Colombia',
      country_code: 'CO',
      industry: 'Finanzas',
      website: null,
      domain: null,
      source: 'agent_1',
      created_at: '2026-10-10T10:00:00Z',
      owner_id: 'u-1',
      owner_name: 'Ana',
    };
    const facts = (prepared: boolean) => ({
      lastStatusChangeAt: null,
      contactsTotal: 1,
      decisionMakersTotal: 1,
      decisionMakersWithPhone: 0,
      hubspotSynced: true,
      lastRunStatus: 'completed',
      firstContactPrepared: prepared,
    });
    const overview = buildPipelineOverview({
      accounts: [
        { ...base, id: 'davivienda', name: 'Davivienda Colombia', pipeline_status: 'new' },
        { ...base, id: 'otra', name: 'Otra', pipeline_status: 'new' },
      ] as Parameters<typeof buildPipelineOverview>[0]['accounts'],
      facts: new Map([
        ['davivienda', facts(true)],
        ['otra', facts(false)],
      ]),
      archivedTotal: 0,
      now: new Date('2026-10-17T12:00:00Z'),
    });
    const davivienda = overview.accounts.find((a) => a.id === 'davivienda')!;
    assert.equal(davivienda.currentStageId, 'preparacion');
    assert.equal(davivienda.substatusLabel, 'Lista para contacto');
    assert.equal(overview.countsByStage.preparacion, 1);
    assert.equal(overview.countsByStage.enriquecimiento, 1);
  });
});
