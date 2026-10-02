/**
 * Pipeline · read model — contrato PURO: compone el recorrido de una empresa
 * con y sin prospecto de origen, creada a mano, archivada, con corrida
 * fallida y con decisores sin teléfono; y el resumen con su orden y conteos.
 * Las etapas previstas NUNCA llevan datos inventados.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AccountAuditEntry, AccountListItem, AccountWithOwner } from '@/modules/accounts/types';
import type { Contact } from '@/modules/contacts/types';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import {
  buildAccountJourney,
  buildPipelineOverview,
  isStageNotStarted,
  readApprovalMetadata,
  resolveLastMovementAt,
  type OverviewAccountFacts,
} from '../journey-read-model';
import type { OriginCandidate } from '../types';

const NOW = new Date('2026-10-01T12:00:00Z');

function account(overrides: Partial<AccountWithOwner> = {}): AccountWithOwner {
  return {
    id: 'acc-1',
    name: 'Acme',
    legal_name: null,
    normalized_name: 'acme',
    website: 'https://acme.co',
    domain: 'acme.co',
    country: 'Colombia',
    country_code: 'CO',
    city: null,
    region: null,
    industry: 'Tecnología',
    company_size: '51-200 empleados',
    tax_identifier: '900123456',
    tax_identifier_type: 'NIT',
    source: 'agent_1',
    pipeline_status: 'new',
    pipeline_substatus: null,
    owner_id: 'u-1',
    created_by: 'u-1',
    updated_by: null,
    hubspot_company_id: 'hs-1',
    linkedin_url: 'https://linkedin.com/company/acme',
    metadata: { hubspot_sync_status: 'synced' },
    notes: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    archived_at: null,
    archived_by: null,
    owner: { id: 'u-1', full_name: 'Ana Pérez', email: 'ana@ubits.co' },
    created_by_user: { id: 'u-1', full_name: 'Ana Pérez' },
    ...overrides,
  };
}

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'c-1',
    account_id: 'acc-1',
    first_name: 'Luis',
    last_name: 'Gómez',
    full_name: 'Luis Gómez',
    email: 'luis@acme.co',
    phone: null,
    mobile_phone: null,
    linkedin_url: null,
    job_title: 'Gerente de RRHH',
    department: null,
    seniority: 'manager',
    role_in_account: 'decision_maker',
    contact_status: 'active',
    source: 'apollo',
    hubspot_contact_id: null,
    email_confidence: null,
    phone_confidence: null,
    phone_type: null,
    phone_source: null,
    phone_raw_type: null,
    phone_revealed_at: null,
    phone_processing_basis: null,
    is_primary: true,
    notes: null,
    metadata: {},
    created_by: null,
    updated_by: null,
    created_at: '2026-09-02T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

function run(overrides: Partial<AccountContactEnrichmentRun> = {}): AccountContactEnrichmentRun {
  return {
    id: 'run-1',
    accountId: 'acc-1',
    status: 'completed',
    companyName: 'Acme',
    companyDomain: 'acme.co',
    companyCountryCode: 'CO',
    intendedProvider: 'apollo',
    providersUsed: ['apollo'],
    attemptOrder: 1,
    estimatedCostUsd: 0.5,
    realCostUsd: null,
    agentRunId: 'agent-1',
    createdAt: '2026-09-03T10:00:00Z',
    updatedAt: '2026-09-03T10:00:00Z',
    candidateCount: 4,
    pendingReviewCount: 1,
    approvedCount: 1,
    totalCreditsUsed: 4,
    providerUsageStatuses: ['success'],
    summaryError: null,
    ...overrides,
  };
}

function audit(overrides: Partial<AccountAuditEntry> = {}): AccountAuditEntry {
  return {
    id: 'a-1',
    account_id: 'acc-1',
    actor_user_id: 'u-1',
    action_type: 'account_status_changed',
    details: { from: 'new', to: 'ready_for_research' },
    created_at: '2026-09-20T10:00:00Z',
    actor: { full_name: 'Ana Pérez', email: 'ana@ubits.co' },
    ...overrides,
  };
}

const ORIGIN: OriginCandidate = {
  id: 'cand-1',
  batchId: 'batch-1',
  batchName: 'Lote CO · Tecnología',
  batchSource: 'agent_1',
  sourcePrimary: 'apollo',
  fitScore: 0.82,
  confidenceScore: 0.7,
  dataCompletenessScore: 0.9,
  estimatedCostUsd: 0.12,
  taxIdentifier: '900123456',
  taxIdentifierType: 'NIT',
  recordOrigin: 'ai_discovery',
  commercialFitStatus: 'fit',
  reviewedAt: '2026-09-01T09:00:00Z',
  reviewerName: 'Ana Pérez',
  approvedAt: '2026-09-01T09:00:00Z',
  hubspotAction: 'created',
  hubspotCompanyId: 'hs-1',
  claudeClassification: null,
};

describe('Read model — recorrido con prospecto de origen', () => {
  const journey = buildAccountJourney({
    account: account(),
    origin: ORIGIN,
    contacts: [contact({ phone_revealed_at: '2026-09-04T10:00:00Z' })],
    runs: [run()],
    audit: [],
    now: NOW,
  });

  it('tiene las 8 etapas, con enriquecimiento como actual para una empresa nueva', () => {
    assert.equal(journey.stages.length, 8);
    assert.equal(journey.currentStageId, 'enriquecimiento');
    assert.equal(journey.substatusLabel, 'Nueva');
    assert.deepEqual(
      journey.stages.map((s) => s.state),
      ['complete', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'],
    );
  });

  it('cuenta los contactos reales y no inventa nada en las etapas previstas', () => {
    assert.deepEqual(
      { ...journey.contacts, decisionMakerList: journey.contacts.decisionMakerList.length },
      { total: 1, decisionMakers: 1, champions: 0, withPhone: 1, inHubSpot: 0, decisionMakerList: 1 },
    );
    for (const stage of journey.stages.filter((s) => s.stage.phase !== 'hecho')) {
      assert.equal(stage.milestoneAt, null, stage.stage.id);
      assert.ok(stage.stage.plannedText);
    }
  });

  it('el hito de prospección es la aprobación y el de enriquecimiento la última corrida', () => {
    assert.equal(journey.stages[0].milestoneAt, '2026-09-01T09:00:00Z');
    assert.equal(journey.stages[1].milestoneAt, '2026-09-03T10:00:00Z');
  });

  it('el historial unificado incluye la aprobación y la corrida, de lo más reciente a lo más antiguo', () => {
    assert.deepEqual(
      journey.history.map((e) => [e.kind, e.at]),
      [
        ['run', '2026-09-03T10:00:00Z'],
        ['approval', '2026-09-01T09:00:00Z'],
      ],
    );
    assert.equal(journey.history[1].title, 'Prospecto aprobado');
    assert.match(journey.history[0].description ?? '', /Apollo · 4 candidatos · 1 aprobados/);
  });

  it('una empresa sana sincronizada y con responsable: solo cuenta los días desde la creación', () => {
    assert.equal(journey.daysSinceMovement, 30);
    assert.deepEqual(journey.signals.map((s) => s.id), ['sin_movimiento']);
    assert.equal(journey.signals[0].severity, 'critical');
    assert.equal(journey.account.hubspotSynced, true);
    assert.equal(journey.account.hubspotLabel, 'Sincronizada');
  });
});

describe('Read model — sin prospecto y creada a mano', () => {
  const journey = buildAccountJourney({
    account: account({ source: 'manual', hubspot_company_id: null, metadata: {}, owner_id: null, owner: null }),
    origin: null,
    contacts: [],
    runs: [],
    audit: [audit({ action_type: 'account_created', details: { source: 'manual' }, created_at: '2026-09-28T10:00:00Z' })],
    now: NOW,
  });

  it('no tiene origen y conserva quién la creó', () => {
    assert.equal(journey.origin, null);
    assert.equal(journey.account.source, 'manual');
    assert.equal(journey.account.createdByName, 'Ana Pérez');
  });

  it('señala sin contactos, sin responsable y sin HubSpot', () => {
    assert.deepEqual(journey.signals.map((s) => s.id), ['sin_movimiento', 'sin_contactos', 'sin_responsable', 'sin_hubspot']);
    assert.equal(journey.account.hubspotLabel, 'Aún no está en HubSpot');
  });

  it('las señales caen sobre su etapa', () => {
    const byStage = Object.fromEntries(journey.stages.map((s) => [s.stage.id, s.signals.map((x) => x.id)]));
    assert.deepEqual(byStage.prospeccion, ['sin_responsable', 'sin_hubspot']);
    assert.deepEqual(byStage.enriquecimiento, ['sin_movimiento', 'sin_contactos']);
    assert.deepEqual(byStage.cierre, []);
  });
});

describe('Read model — movimiento, investigación, corrida fallida y decisores sin teléfono', () => {
  it('el último movimiento es el último cambio de estado del audit; sin audit, la creación', () => {
    assert.equal(resolveLastMovementAt([], '2026-09-01T10:00:00Z'), '2026-09-01T10:00:00Z');
    assert.equal(
      resolveLastMovementAt(
        [
          audit({ created_at: '2026-09-10T10:00:00Z' }),
          audit({ id: 'a-2', created_at: '2026-09-25T10:00:00Z' }),
          audit({ id: 'a-3', action_type: 'account_updated', created_at: '2026-09-30T10:00:00Z' }),
        ],
        '2026-09-01T10:00:00Z',
      ),
      '2026-09-25T10:00:00Z',
    );
  });

  it('investigación en curso: etapa inteligencia, marcada por quien cambió el estado', () => {
    const journey = buildAccountJourney({
      account: account({ pipeline_status: 'research_in_progress' }),
      origin: ORIGIN,
      contacts: [contact()],
      runs: [],
      audit: [
        audit({
          details: { from: 'ready_for_research', to: 'research_in_progress' },
          created_at: '2026-09-29T10:00:00Z',
          actor: { full_name: 'Carlos Ruiz', email: 'carlos@ubits.co' },
        }),
      ],
      now: NOW,
    });
    assert.equal(journey.currentStageId, 'inteligencia');
    assert.equal(journey.substatusLabel, 'Investigación en curso');
    assert.equal(journey.researchMarkedBy, 'Carlos Ruiz');
    assert.equal(journey.daysSinceMovement, 2);
    assert.equal(journey.stages[2].milestoneAt, '2026-09-29T10:00:00Z');
    // Traducido en el historial.
    assert.match(journey.history[0].description ?? '', /De «Lista para investigar» a «Investigación en curso» · Por Carlos Ruiz/);
  });

  it('corrida fallida reciente y decisores sin teléfono', () => {
    const journey = buildAccountJourney({
      account: account(),
      origin: ORIGIN,
      contacts: [contact(), contact({ id: 'c-2', full_name: 'Marta Díaz', role_in_account: 'champion' })],
      runs: [
        run({ id: 'run-old', createdAt: '2026-09-03T10:00:00Z' }),
        run({ id: 'run-new', status: 'failed', createdAt: '2026-09-29T10:00:00Z', summaryError: 'missing_api_key', candidateCount: 0 }),
      ],
      audit: [audit({ created_at: '2026-09-30T10:00:00Z' })],
      now: NOW,
    });
    assert.deepEqual(journey.signals.map((s) => s.id), ['corrida_fallida', 'decisor_sin_telefono']);
    assert.equal(journey.runs[0].id, 'run-new');
    assert.equal(journey.history[1].title, 'Búsqueda de contactos fallida');
    assert.match(journey.history[1].description ?? '', /missing_api_key/);
    assert.equal(journey.contacts.decisionMakerList.length, 1);
  });

  it('archivada: ninguna etapa actual, sin señales y marcada como archivada', () => {
    const journey = buildAccountJourney({
      account: account({ pipeline_status: 'archived', archived_at: '2026-09-15T10:00:00Z' }),
      origin: ORIGIN,
      contacts: [],
      runs: [],
      audit: [],
      now: NOW,
    });
    assert.equal(journey.isArchived, true);
    assert.equal(journey.currentStageId, null);
    assert.equal(journey.substatusLabel, 'Archivada');
    assert.deepEqual(journey.signals, []);
    assert.equal(journey.stages[1].state, 'archived');
  });
});

describe('Read model — aprobación del prospecto', () => {
  it('lee metadata.approval sin confiar en su forma', () => {
    assert.deepEqual(readApprovalMetadata(null), { approvedAt: null, hubspotAction: null, hubspotCompanyId: null });
    assert.deepEqual(readApprovalMetadata({ approval: 'x' }), { approvedAt: null, hubspotAction: null, hubspotCompanyId: null });
    assert.deepEqual(
      readApprovalMetadata({ approval: { approved_at: '2026-09-01T09:00:00Z', hubspot: { action: 'created', company_id: 'hs-1' } } }),
      { approvedAt: '2026-09-01T09:00:00Z', hubspotAction: 'created', hubspotCompanyId: 'hs-1' },
    );
  });
});

describe('Read model — resumen del pipeline', () => {
  function listItem(overrides: Partial<AccountListItem>): AccountListItem {
    return {
      id: 'x',
      name: 'X',
      country: 'Colombia',
      country_code: 'CO',
      industry: null,
      website: null,
      domain: null,
      pipeline_status: 'new',
      source: 'agent_1',
      created_at: '2026-09-30T10:00:00Z',
      owner_id: 'u-1',
      owner_name: 'Ana',
      ...overrides,
    };
  }
  const healthy: OverviewAccountFacts = {
    lastStatusChangeAt: null,
    contactsTotal: 2,
    decisionMakersTotal: 1,
    decisionMakersWithPhone: 1,
    hubspotSynced: true,
    lastRunStatus: 'completed',
  };

  const overview = buildPipelineOverview({
    accounts: [
      listItem({ id: 'a', name: 'Alfa', pipeline_status: 'ready_for_outreach' }),
      listItem({ id: 'b', name: 'Beta', pipeline_status: 'ready_for_research', created_at: '2026-09-01T10:00:00Z' }),
      listItem({ id: 'c', name: 'Gamma', pipeline_status: 'new', created_at: '2026-09-20T10:00:00Z' }),
      listItem({ id: 'd', name: 'Delta', pipeline_status: 'research_in_progress' }),
    ],
    facts: new Map([
      ['a', healthy],
      ['b', { ...healthy, lastStatusChangeAt: '2026-09-05T10:00:00Z' }],
      ['c', { ...healthy, contactsTotal: 0, decisionMakersTotal: 0 }],
      ['d', { ...healthy, hubspotSynced: false }],
    ]),
    archivedTotal: 3,
    now: NOW,
  });

  it('cuenta las 8 etapas del proceso (0 para las que ninguna empresa ha alcanzado) y las archivadas', () => {
    assert.deepEqual(overview.countsByStage, {
      prospeccion: 0,
      enriquecimiento: 1,
      inteligencia: 2,
      preparacion: 1,
      reunion: 0,
      cotizacion: 0,
      venta_interna: 0,
      cierre: 0,
    });
    assert.equal(overview.archivedTotal, 3);
  });

  it('ordena: señal crítica primero, luego más días sin movimiento', () => {
    assert.deepEqual(
      overview.accounts.map((a) => [a.name, a.daysSinceMovement]),
      [
        ['Beta', 26],
        ['Gamma', 11],
        ['Delta', 1],
        ['Alfa', 1],
      ],
    );
  });

  it('usa el último cambio de estado cuando existe y la creación cuando no', () => {
    const beta = overview.accounts.find((a) => a.name === 'Beta');
    assert.equal(beta?.daysSinceMovement, 26);
  });

  it('cuenta cuántas empresas tiene cada señal y cuántas requieren atención', () => {
    assert.equal(overview.withSignalsTotal, 3);
    assert.equal(overview.countsBySignal.sin_movimiento, 2);
    assert.equal(overview.countsBySignal.sin_contactos, 1);
    assert.equal(overview.countsBySignal.sin_hubspot, 1);
    assert.equal(overview.countsBySignal.sin_responsable, 0);
  });
});

describe('Read model — etapa disponible pero sin empezar', () => {
  const notStartedIds = (journey: ReturnType<typeof buildAccountJourney>) =>
    journey.stages.filter((entry) => entry.notStarted).map((entry) => entry.stage.id);

  it('enriquecimiento sin contactos ni búsquedas está sin empezar; prospección nunca', () => {
    const journey = buildAccountJourney({ account: account(), origin: ORIGIN, contacts: [], runs: [], audit: [], now: NOW });
    assert.deepEqual(notStartedIds(journey), ['enriquecimiento']);
    assert.equal(journey.stages[0].notStarted, false);
  });

  it('con algún contacto ya empezó', () => {
    const journey = buildAccountJourney({ account: account(), origin: ORIGIN, contacts: [contact()], runs: [], audit: [], now: NOW });
    assert.deepEqual(notStartedIds(journey), []);
  });

  it('con una búsqueda, aunque haya fallado y no haya contactos, ya empezó', () => {
    const journey = buildAccountJourney({
      account: account(),
      origin: ORIGIN,
      contacts: [],
      runs: [run({ status: 'failed', candidateCount: 0, summaryError: 'missing_api_key' })],
      audit: [],
      now: NOW,
    });
    assert.deepEqual(notStartedIds(journey), []);
  });

  it('una empresa archivada sin datos sigue marcada sin empezar (la pantalla decide que no se puede activar)', () => {
    const journey = buildAccountJourney({
      account: account({ pipeline_status: 'archived', archived_at: '2026-09-15T10:00:00Z' }),
      origin: ORIGIN,
      contacts: [],
      runs: [],
      audit: [],
      now: NOW,
    });
    assert.equal(journey.isArchived, true);
    assert.deepEqual(notStartedIds(journey), ['enriquecimiento']);
  });

  it('las etapas previstas no se pueden activar: nunca están «sin empezar»', () => {
    const facts = { contactsTotal: 0, runsTotal: 0 };
    assert.equal(isStageNotStarted({ id: 'inteligencia', phase: 'mvp' }, facts), false);
    assert.equal(isStageNotStarted({ id: 'cierre', phase: 'fase_2' }, facts), false);
    assert.equal(isStageNotStarted({ id: 'prospeccion', phase: 'hecho' }, facts), false);
    assert.equal(isStageNotStarted({ id: 'enriquecimiento', phase: 'hecho' }, facts), true);
    assert.equal(isStageNotStarted({ id: 'enriquecimiento', phase: 'hecho' }, { contactsTotal: 0, runsTotal: 1 }), false);
  });
});

describe('Read model — última nota de etapa', () => {
  it('lee la última nota que dejó alguien al mover de etapa; sin notas de etapa, ninguna', () => {
    const withNote = buildAccountJourney({
      account: account({
        notes:
          'Cliente de 2024.\n\n[Inteligencia de cuenta · Lista para investigar · 2 de oct de 2026, 9:05 a. m. · Ana Pérez]\nReunión con Luisa: quieren liderazgo.',
      }),
      origin: ORIGIN,
      contacts: [],
      runs: [],
      audit: [],
      now: NOW,
    });
    assert.deepEqual(withNote.account.lastStageNote, {
      header: 'Inteligencia de cuenta · Lista para investigar · 2 de oct de 2026, 9:05 a. m. · Ana Pérez',
      body: 'Reunión con Luisa: quieren liderazgo.',
    });

    const plain = buildAccountJourney({ account: account({ notes: 'Solo una nota libre.' }), origin: ORIGIN, contacts: [], runs: [], audit: [], now: NOW });
    assert.equal(plain.account.lastStageNote, null);
  });
});
