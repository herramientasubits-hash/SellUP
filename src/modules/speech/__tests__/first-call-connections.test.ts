/**
 * AGENT3-FIRST-CALL-2 — las reglas puras con las que el Agente 3 se conecta al resto de
 * SellUp: a dónde lleva cada entrada, quién se puede elegir como decisor, cuándo una
 * investigación sigue vigente y cómo se cuenta su historia (Actividad, Agentes, Pipeline).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildFirstCallEvents } from '../first-call-activity';
import { toFirstCallContactOptions } from '../first-call-contacts';
import { FIRST_CALL_TAB_ID, firstCallHref, normalizeAccountTab } from '../first-call-links';
import { isBriefFresh } from '../first-call-state';
import type { FirstCallPack, ResearchBrief, ResearchFact } from '../../../server/agents/first-call/types';

const NOW = Date.parse('2026-10-16T12:00:00Z');

function fact(id: string, sourceKind: ResearchFact['sourceKind'] = 'official_site'): ResearchFact {
  return { id, topic: 'business', statement: 's', quote: 'q', sourceKind, sourceUrl: 'https://a', sourceLabel: 'Sitio', publishedOn: null };
}

function brief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    id: 'b1',
    accountId: 'a1',
    status: 'sufficient',
    progressStage: 'done',
    summary: 'resumen',
    facts: [fact('F1', 'sellup'), fact('F2'), fact('F3', 'news')],
    hypotheses: [],
    gaps: [],
    sources: [
      { url: 'https://a', label: 'Sitio', kind: 'official_site' },
      { url: 'https://b', label: 'Diario', kind: 'news' },
    ],
    rejectedFacts: 0,
    costUsd: 0.07,
    model: 'm',
    createdAt: '2026-10-10T10:00:00Z',
    completedAt: '2026-10-10T10:01:00Z',
    expiresAt: '2026-11-09T10:01:00Z',
    errorCode: null,
    ...overrides,
  };
}

function pack(overrides: Partial<FirstCallPack> = {}): FirstCallPack {
  return {
    id: 'p1',
    accountId: 'a1',
    briefId: 'b1',
    contactId: 'c1',
    targetName: 'María Pérez',
    targetTitle: 'Gerente de Talento',
    channel: 'whatsapp',
    goal: 'book_meeting',
    goals: ['book_meeting'],
    productFocus: null,
    content: null,
    facts: [],
    status: 'draft',
    verifierIssues: [],
    editedScript: null,
    regenerationReason: null,
    costUsd: 0.04,
    model: 'm',
    createdAt: '2026-10-11T09:00:00Z',
    usedAt: null,
    discardedAt: null,
    ...overrides,
  };
}

describe('enlaces', () => {
  it('lleva a la pestaña «Primer contacto» de la empresa, con o sin decisor', () => {
    assert.equal(FIRST_CALL_TAB_ID, 'primer-contacto');
    assert.equal(firstCallHref('acc-1'), '/accounts/acc-1?tab=primer-contacto');
    assert.equal(firstCallHref('acc-1', 'c-9'), '/accounts/acc-1?tab=primer-contacto&contacto=c-9');
    assert.equal(firstCallHref('acc-1', null), '/accounts/acc-1?tab=primer-contacto');
  });

  it('los enlaces viejos («Inteligencia», «Primera llamada») abren «Primer contacto»', () => {
    assert.equal(normalizeAccountTab('inteligencia'), 'primer-contacto');
    assert.equal(normalizeAccountTab('primera-llamada'), 'primer-contacto');
    assert.equal(normalizeAccountTab('actividad'), 'actividad');
    assert.equal(normalizeAccountTab(undefined), undefined);
  });
});

describe('decisores que se pueden elegir', () => {
  const rows = [
    { id: 'c1', full_name: 'Ana', job_title: 'Analista', role_in_account: null, contact_status: 'active' },
    { id: 'c2', full_name: 'Beto', job_title: 'Gerente de Talento', role_in_account: 'hr_leader', contact_status: 'active' },
    { id: 'c3', full_name: 'Carla', job_title: 'CEO', role_in_account: 'decision_maker', contact_status: 'active' },
    { id: 'c4', full_name: 'Dani', job_title: 'Director', role_in_account: 'decision_maker', contact_status: 'left_company' },
    { id: 'c5', full_name: 'Eli', job_title: null, role_in_account: null, contact_status: 'do_not_contact' },
  ];

  it('sólo contactos activos, primero quien decide y luego quien lleva talento o formación', () => {
    assert.deepEqual(
      toFirstCallContactOptions(rows).map((c) => c.id),
      ['c3', 'c2', 'c1'],
    );
  });
});

describe('vigencia de la investigación', () => {
  it('vale si es suficiente o parcial y no ha vencido', () => {
    assert.equal(isBriefFresh(brief(), NOW), true);
    assert.equal(isBriefFresh(brief({ status: 'partial' }), NOW), true);
  });
  it('no vale vencida, fallida, en curso, sin fecha o inexistente', () => {
    assert.equal(isBriefFresh(brief({ expiresAt: '2026-10-01T00:00:00Z' }), NOW), false);
    assert.equal(isBriefFresh(brief({ status: 'failed' }), NOW), false);
    assert.equal(isBriefFresh(brief({ status: 'running' }), NOW), false);
    assert.equal(isBriefFresh(brief({ expiresAt: null }), NOW), false);
    assert.equal(isBriefFresh(null, NOW), false);
  });
});

describe('historia del agente', () => {
  it('cuenta la investigación y cada preparación, de lo más reciente a lo más antiguo', () => {
    const events = buildFirstCallEvents(brief(), [
      pack({ id: 'p-old', createdAt: '2026-10-11T09:00:00Z' }),
      pack({ id: 'p-new', createdAt: '2026-10-14T09:00:00Z', usedAt: '2026-10-15T08:00:00Z' }),
    ]);
    assert.deepEqual(
      events.map((e) => e.id),
      ['pack-used-p-new', 'pack-p-new', 'pack-p-old', 'brief-b1'],
    );
    const research = events.find((e) => e.id === 'brief-b1')!;
    assert.equal(research.title, 'Empresa investigada');
    assert.equal(research.description, '2 datos con fuente · 2 fuentes consultadas', 'los datos de SellUp no cuentan como investigados');
    assert.equal(research.kind, 'run');
    assert.equal(events.find((e) => e.id === 'pack-used-p-new')!.kind, 'action');
  });

  it('una investigación en curso no es un evento todavía', () => {
    assert.deepEqual(buildFirstCallEvents(brief({ status: 'running' }), []), []);
  });

  it('dice cuándo algo quedó parcial, a revisar, fallido o descartado', () => {
    const events = buildFirstCallEvents(brief({ status: 'partial' }), [
      pack({ id: 'p-review', verifierIssues: ['x'] }),
      pack({ id: 'p-failed', status: 'failed' }),
      pack({ id: 'p-gone', status: 'discarded', discardedAt: '2026-10-12T09:00:00Z' }),
    ]);
    const title = (id: string) => events.find((e) => e.id === id)!.title;
    assert.equal(title('brief-b1'), 'Empresa investigada (parcial)');
    assert.equal(title('pack-p-review'), 'Primer contacto preparado (a revisar)');
    assert.equal(title('pack-p-failed'), 'No se pudo preparar el primer contacto');
    assert.equal(title('pack-discarded-p-gone'), 'Preparación descartada');
  });

  it('sin decisor elegido lo dice', () => {
    const [event] = buildFirstCallEvents(null, [pack({ targetName: null, targetTitle: null })]);
    assert.match(event.description ?? '', /Sin decisor elegido/);
  });
});
