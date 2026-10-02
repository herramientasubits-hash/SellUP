/**
 * Datos de prueba del Pipeline, compuestos con el read model REAL (no a mano):
 * así las pruebas de runtime ven exactamente lo que vería la pantalla.
 */
import type { AccountAuditEntry, AccountListItem, AccountWithOwner } from '@/modules/accounts/types';
import type { Contact } from '@/modules/contacts/types';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import {
  buildAccountJourney,
  buildPipelineOverview,
  type OverviewAccountFacts,
} from '@/modules/pipeline/journey-read-model';
import type { AccountJourney, OriginCandidate, PipelineOverview } from '@/modules/pipeline/types';

export const NOW = new Date('2026-10-01T12:00:00Z');

function listItem(overrides: Partial<AccountListItem>): AccountListItem {
  return {
    id: 'x',
    name: 'X',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'Tecnología',
    website: null,
    domain: null,
    pipeline_status: 'new',
    source: 'agent_1',
    created_at: '2026-09-30T10:00:00Z',
    owner_id: 'u-1',
    owner_name: 'Ana Pérez',
    ...overrides,
  };
}

const HEALTHY: OverviewAccountFacts = {
  lastStatusChangeAt: null,
  contactsTotal: 2,
  decisionMakersTotal: 1,
  decisionMakersWithPhone: 1,
  hubspotSynced: true,
  lastRunStatus: 'completed',
};

/** Cuatro empresas: una por estado, con y sin señales. */
export function buildOverview(): PipelineOverview {
  return buildPipelineOverview({
    accounts: [
      listItem({ id: 'acme', name: 'Acme', domain: 'acme.co', pipeline_status: 'new', created_at: '2026-09-01T10:00:00Z' }),
      listItem({ id: 'globex', name: 'Globex', domain: 'globex.mx', country_code: 'MX', pipeline_status: 'ready_for_research' }),
      listItem({ id: 'initech', name: 'Initech', domain: 'initech.pe', country_code: 'PE', pipeline_status: 'research_in_progress', owner_id: null, owner_name: null }),
      listItem({ id: 'umbrella', name: 'Umbrella', domain: 'umbrella.cl', country_code: 'CL', pipeline_status: 'ready_for_outreach' }),
    ],
    facts: new Map([
      ['acme', { ...HEALTHY, contactsTotal: 0, decisionMakersTotal: 0, decisionMakersWithPhone: 0 }],
      ['globex', HEALTHY],
      ['initech', HEALTHY],
      ['umbrella', HEALTHY],
    ]),
    archivedTotal: 2,
    now: NOW,
  });
}

export function buildEmptyOverview(): PipelineOverview {
  return buildPipelineOverview({ accounts: [], facts: new Map(), archivedTotal: 0, now: NOW });
}

function account(overrides: Partial<AccountWithOwner> = {}): AccountWithOwner {
  return {
    id: 'globex',
    name: 'Globex',
    legal_name: null,
    normalized_name: 'globex',
    website: 'https://globex.mx',
    domain: 'globex.mx',
    country: 'México',
    country_code: 'MX',
    city: null,
    region: null,
    industry: 'Tecnología',
    company_size: '201-500 empleados',
    tax_identifier: 'GLO010101AAA',
    tax_identifier_type: 'RFC',
    source: 'agent_1',
    pipeline_status: 'ready_for_research',
    pipeline_substatus: null,
    owner_id: 'u-1',
    created_by: 'u-1',
    updated_by: null,
    hubspot_company_id: 'hs-9',
    linkedin_url: 'https://www.linkedin.com/company/globex',
    metadata: { hubspot_sync_status: 'synced' },
    notes: null,
    created_at: '2026-09-10T10:00:00Z',
    updated_at: '2026-09-10T10:00:00Z',
    archived_at: null,
    archived_by: null,
    owner: { id: 'u-1', full_name: 'Ana Pérez', email: 'ana@ubits.co' },
    created_by_user: { id: 'u-1', full_name: 'Ana Pérez' },
    ...overrides,
  };
}

function contact(overrides: Partial<Contact>): Contact {
  return {
    id: 'c-1',
    account_id: 'globex',
    first_name: null,
    last_name: null,
    full_name: 'Luisa Gómez',
    email: 'luisa@globex.mx',
    phone: null,
    mobile_phone: null,
    linkedin_url: null,
    job_title: 'Directora de Talento',
    department: null,
    seniority: 'director',
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
    created_at: '2026-09-12T10:00:00Z',
    updated_at: '2026-09-12T10:00:00Z',
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

function run(overrides: Partial<AccountContactEnrichmentRun>): AccountContactEnrichmentRun {
  return {
    id: 'run-1',
    accountId: 'globex',
    status: 'completed',
    companyName: 'Globex',
    companyDomain: 'globex.mx',
    companyCountryCode: 'MX',
    intendedProvider: 'apollo',
    providersUsed: ['apollo'],
    attemptOrder: 1,
    estimatedCostUsd: 0.5,
    realCostUsd: null,
    agentRunId: 'agent-1',
    createdAt: '2026-09-12T09:00:00Z',
    updatedAt: '2026-09-12T09:00:00Z',
    candidateCount: 4,
    pendingReviewCount: 0,
    approvedCount: 2,
    totalCreditsUsed: 4,
    providerUsageStatuses: ['success'],
    summaryError: null,
    ...overrides,
  };
}

const ORIGIN: OriginCandidate = {
  id: 'cand-1',
  batchId: 'batch-1',
  batchName: 'Lote MX · Tecnología',
  batchSource: 'agent_1',
  sourcePrimary: 'apollo',
  fitScore: 82,
  confidenceScore: 70,
  dataCompletenessScore: 90,
  estimatedCostUsd: 0.12,
  taxIdentifier: 'GLO010101AAA',
  taxIdentifierType: 'RFC',
  recordOrigin: 'ai_discovery',
  commercialFitStatus: 'fit',
  reviewedAt: '2026-09-10T09:00:00Z',
  reviewerName: 'Ana Pérez',
  approvedAt: '2026-09-10T09:00:00Z',
  hubspotAction: 'created',
  hubspotCompanyId: 'hs-9',
  claudeClassification: null,
};

const STATUS_CHANGE: AccountAuditEntry = {
  id: 'a-1',
  account_id: 'globex',
  actor_user_id: 'u-1',
  action_type: 'account_status_changed',
  details: { from: 'new', to: 'ready_for_research' },
  created_at: '2026-09-30T10:00:00Z',
  actor: { full_name: 'Ana Pérez', email: 'ana@ubits.co' },
};

/** Globex: aprobada desde un lote, con contactos y una corrida, lista para investigar. */
export function buildJourney(overrides: Partial<AccountWithOwner> = {}): AccountJourney {
  return buildAccountJourney({
    account: account(overrides),
    origin: ORIGIN,
    contacts: [
      contact({ phone_revealed_at: '2026-09-13T10:00:00Z', hubspot_contact_id: 'hc-1' }),
      contact({ id: 'c-2', full_name: 'Mario Ruiz', job_title: 'Analista', role_in_account: 'champion', is_primary: false }),
    ],
    runs: [run({})],
    audit: [STATUS_CHANGE],
    now: NOW,
  });
}

/** Una empresa creada a mano, sin prospecto, sin contactos y parada 30 días. */
export function buildManualJourney(): AccountJourney {
  return buildAccountJourney({
    account: account({
      id: 'acme',
      name: 'Acme',
      source: 'manual',
      pipeline_status: 'new',
      hubspot_company_id: null,
      metadata: {},
      created_at: '2026-09-01T10:00:00Z',
    }),
    origin: null,
    contacts: [],
    runs: [],
    audit: [],
    now: NOW,
  });
}
