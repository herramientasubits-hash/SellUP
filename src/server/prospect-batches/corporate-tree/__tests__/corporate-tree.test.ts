/**
 * Tests — Agente 1 · búsqueda en árbol de una empresa (AGENT1-CORPORATE-TREE-1).
 *
 * Sin red ni base: Claude, la importación y Supabase son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { AnthropicConversationResult } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import {
  blockedSiteDomainCarriesName,
  buildCorporateTreeRequestBody,
  searchCorporateTreeBranch,
  SUBMIT_CORPORATE_TREE_TOOL_NAME,
  type CorporateTreeNode,
  type CorporateTreeSearchInput,
  type CorporateTreeSearchOutcome,
} from '../corporate-tree-search';
import {
  corporateTreeRowKey,
  markKnownCompanies,
  pickKnownCompany,
  planCorporateTreeWrites,
  applyApolloFamily,
  countryFromDomain,
  promoteGroupCompaniesWithTaxIds,
  type CorporateTreeRoot,
} from '../corporate-tree-plan';
import {
  corporateTreeNameCores,
  escapeLikePrefix,
  findCorporateTreeFreeHits,
  freeHitConfirmation,
  isStrongFreeSource,
  nameKinship,
  prefixUpperBound,
  type CorporateTreeFreeHit,
  type FreeSnapshotRow,
} from '../corporate-tree-free-lookup';
import { resolveAgentDimensions } from '@/modules/usage-tracking/usage-dimensions';
import {
  branchDoneStage,
  displayCompanyName,
  parseCorporateTreeRequest,
  runCorporateTreeSearch,
  type CorporateTreeBatchCandidate,
  type CorporateTreeRelationshipRow,
  type CorporateTreeRequest,
  type CorporateTreeRunDeps,
} from '../corporate-tree-run';
import { buildCorporateTreeUsageLog, readApolloSubsidiaries } from '../corporate-tree-run.server';
import {
  corporateTreePendingSummary,
  groupBatchCandidatesByTreeRelation,
  ownDomainsWithoutCandidate,
  readCorporateTreeBatchSummary,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import {
  buildCorporateTreeViews,
  describeCorporateTreeItemStatus,
  linkTreeRecordsToCandidates,
  type CorporateTreeRelationshipRecord,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-associations';
import { CORPORATE_TREE_BATCH_INDUSTRY, normalizeTreeName, readCorporateTreeRelation } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { reserveWizardExecutionSlot, type IdempotencyDbClient } from '@/modules/prospect-batches/chat-wizard-execution/wizard-idempotency';
import { RUN_PROGRESS_PERCENT, RUN_PROGRESS_STAGES } from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
import { TREE_RUN_RECOVERY_TIMEOUT_MS, waitForTreeRunResult } from '@/modules/prospect-batches/corporate-tree/corporate-tree-run-recovery';
import { createAgentRunsStore } from '@/modules/prospect-batches/agent-runs/agent-runs-store';
import { prospectWizardReducer } from '@/modules/prospect-batches/chat-wizard/wizard-reducer';
import { SEARCH_MODE_DEFINITIONS } from '@/modules/prospect-batches/chat-wizard/wizard-config';
import type { ProspectWizardState } from '@/modules/prospect-batches/chat-wizard/wizard-types';

const MODEL = 'claude-haiku-4-5-20251001';
const USAGE = {
  inputTokens: 30_000,
  outputTokens: 800,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 4,
  webFetchRequests: 0,
};
const CO = { code: 'CO', name: 'Colombia' };
const PE = { code: 'PE', name: 'Perú' };
const MX = { code: 'MX', name: 'México' };

function conversation(
  submission: { root?: Record<string, unknown>; companies: Array<Record<string, unknown>> },
  searchUrls: string[],
): AnthropicConversationResult {
  return {
    content: [
      { type: 'web_search_tool_result', content: searchUrls.map((url) => ({ type: 'web_search_result', url, title: 't' })) },
      {
        type: 'tool_use',
        name: SUBMIT_CORPORATE_TREE_TOOL_NAME,
        input: { root: submission.root ?? { website_url: null, country_code: null }, companies: submission.companies },
      },
    ],
    stopReason: 'tool_use',
    usage: USAGE,
    requests: 1,
  };
}

const INPUT: CorporateTreeSearchInput = {
  branch: 'other_country',
  rootName: 'Alpina',
  rootWebsite: 'https://alpina.com',
  rootCountry: CO,
  countries: [CO, PE, MX],
  maxCompanies: 8,
};

describe('A. searchCorporateTreeBranch — sólo entra lo que tiene fuente en la búsqueda', () => {
  it('filtra fuente inventada, país no pedido, el país de partida en «otros países», la propia empresa y repetidas', async () => {
    const outcome = await searchCorporateTreeBranch(INPUT, MODEL, {
      runConversation: async () =>
        conversation(
          {
            root: { website_url: 'https://www.alpina.com', country_code: 'co' },
            companies: [
              { name: 'Alpina Perú S.A.C.', country_code: 'PE', website_url: 'https://alpina.com.pe', relation_detail: 'Filial en Perú', source_url: 'https://www.bnamericas.com/alpina-peru' },
              { name: 'Alpina Ecuador', country_code: 'EC', website_url: null, relation_detail: 'Sede', source_url: 'https://www.bnamericas.com/x' },
              { name: 'Alpina México', country_code: 'MX', website_url: null, relation_detail: 'Sede', source_url: 'https://inventado.example/mx' },
              { name: 'Alpina Colombia', country_code: 'CO', website_url: null, relation_detail: 'Sede', source_url: 'https://www.bnamericas.com/co' },
              { name: 'Alpina Perú SAC', country_code: 'PE', website_url: null, relation_detail: 'Repetida', source_url: 'https://www.bnamericas.com/alpina-peru' },
            ],
          },
          ['https://www.bnamericas.com/alpina-peru', 'https://alpina.com.pe/', 'https://www.alpina.com/'],
        ),
    });
    assert.equal(outcome.errorCode, null);
    assert.equal(outcome.proposed, 5);
    assert.deepEqual(outcome.nodes.map((n) => n.name), ['Alpina Perú S.A.C.']);
    assert.equal(outcome.nodes[0].website, 'https://alpina.com.pe');
    assert.equal(outcome.rejected.country_not_requested, 2, 'EC no pedido y CO es el país de partida');
    assert.equal(outcome.rejected.source_not_in_search, 1);
    assert.equal(outcome.rejected.duplicate_in_response, 1);
    assert.deepEqual(outcome.root, { website: 'https://alpina.com', domain: 'alpina.com', countryCode: 'CO' });
  });

  it('una web que no salió de la búsqueda y no se puede comprobar se omite: la empresa entra sin web', async () => {
    const outcome = await searchCorporateTreeBranch({ ...INPUT, branch: 'subsidiary' }, MODEL, {
      runConversation: async () =>
        conversation(
          { companies: [{ name: 'Alquería', country_code: 'CO', website_url: 'https://alqueria.com.co', relation_detail: 'Filial', source_url: 'https://www.larepublica.co/nota' }] },
          ['https://www.larepublica.co/nota'],
        ),
    });
    assert.equal(outcome.nodes.length, 1);
    assert.equal(outcome.nodes[0].website, null);
    assert.equal(outcome.websitesDropped, 1);
    assert.deepEqual(outcome.droppedWebsites, [
      { name: 'Alquería', countryCode: 'CO', url: 'https://alqueria.com.co', reason: 'not_in_search_results' },
    ]);
  });

  it('un error de Claude no lanza: devuelve el código y ningún nodo', async () => {
    const outcome = await searchCorporateTreeBranch(INPUT, MODEL, {
      runConversation: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(outcome.errorCode, 'unexpected_error');
    assert.equal(outcome.nodes.length, 0);
  });

  it('el pedido nombra la rama, los países y prohíbe clientes y proveedores', () => {
    const body = buildCorporateTreeRequestBody(INPUT, MODEL);
    const system = String(body.system);
    assert.match(system, /Clientes, proveedores y socios comerciales NO cuentan/);
    assert.match(system, /Perú \(PE\)/);
    assert.match(JSON.stringify(body.messages), /LA MISMA EMPRESA EN OTROS PAÍSES/);
  });
});

const NODE = (name: string, countryCode: string, extra: Partial<CorporateTreeNode> = {}): CorporateTreeNode => ({
  branch: 'subsidiary',
  name,
  legalName: null,
  countryCode,
  website: null,
  domain: null,
  linkedinUrl: null,
  relationDetail: 'Filial',
  evidenceUrl: 'https://fuente.example/x',
  ...extra,
});

const ROOT: CorporateTreeRoot = {
  name: 'Grupo Nutresa',
  website: 'https://gruponutresa.com',
  domain: 'gruponutresa.com',
  countryCode: 'CO',
  candidateId: null,
  accountId: null,
};

const FREE_HIT = (name: string, countryCode: string, extra: Partial<CorporateTreeFreeHit> = {}): CorporateTreeFreeHit => ({
  origin: 'catalog',
  relation: 'other_country',
  countryCode,
  name,
  core: name.toLowerCase(),
  confirmation: 'confirmed',
  taxId: `${countryCode}-1`,
  domain: null,
  workers: null,
  sourceKey: 'pe_sunat_registry',
  company: {
    recordIdentityKey: `${countryCode}:${name}`,
    legalName: name,
    normalizedLegalName: name.toLowerCase(),
    taxId: `${countryCode}-1`,
    taxIdentifierType: 'RUC',
    countryCode,
    city: null,
    region: null,
    domain: extra.domain ?? null,
    declaredIndustry: null,
    industryCode: null,
    coarseSector: null,
  },
  bankCandidate: null,
  ...extra,
});

describe('B. planCorporateTreeWrites — cada empresa por la vía del Agente 1', () => {
  it('registro con web ⇒ capa gratuita; Claude con web ⇒ escritor; sin web ⇒ «Descartadas»; la web del grupo nunca aparta a las hermanas', () => {
    const plan = planCorporateTreeWrites({
      root: ROOT,
      freeHits: [
        FREE_HIT('Nutresa Peru S.A.', 'PE', { domain: 'nutresa.com.pe' }),
        FREE_HIT('Nutresa Chile', 'CL'),
      ],
      nodes: [
        NODE('Zenú', 'CO', { website: 'https://gruponutresa.com', domain: 'gruponutresa.com' }),
        NODE('Noel', 'CO', { website: 'https://noel.com.co', domain: 'noel.com.co' }),
        NODE('Nutresa Perú SA', 'PE', { branch: 'other_country', website: 'https://x.pe', domain: 'x.pe' }),
      ],
    });
    const byName = new Map(plan.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('Nutresa Peru S.A.')?.route, 'free_catalog');
    assert.equal(byName.get('Nutresa Chile')?.route, 'without_website');
    assert.equal(byName.get('Noel')?.route, 'agent1_writer');
    assert.equal(byName.get('Zenú')?.route, 'group_reference', 'misma web que la empresa de partida: referencia, sin rescate');
    assert.equal(byName.get('Zenú')?.groupWebsite, 'https://gruponutresa.com');
    assert.equal(byName.has('Nutresa Perú SA'), false, 'lo gratis ya la tenía: Claude no la repite');
    assert.equal(byName.get('Grupo Nutresa')?.relation, 'root', 'la empresa de partida entra si no estaba');
    assert.deepEqual([...plan.freeCatalog.keys()], ['PE']);
    assert.deepEqual([...plan.web.keys()].sort(), ['CO']);
    assert.deepEqual([...plan.withoutWebsite.keys()].sort(), ['CL']);
  });

  it('General Electric (Prod 14-10): la misma razón en otro país no es la raíz, y las filiales con la web del grupo no van al rescate', () => {
    const plan = planCorporateTreeWrites({
      root: { name: 'General Electric', website: 'https://www.ge.com', domain: 'ge.com', countryCode: 'US', candidateId: null, accountId: null },
      freeHits: [FREE_HIT('GENERAL ELECTRIC S R L', 'AR', { relation: 'root' })],
      nodes: [
        NODE('General Electric México, S.A. de C.V.', 'MX', { website: 'https://www.ge.com/mx', domain: 'ge.com' }),
        NODE('ProlecGE', 'MX', { website: 'https://prolecge.com', domain: 'prolecge.com' }),
      ],
    });
    const byName = new Map(plan.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('General Electric')?.relation, 'root', 'la raíz es la de EE. UU.');
    assert.equal(byName.get('General Electric')?.route, 'agent1_writer');
    assert.equal(byName.get('GENERAL ELECTRIC S R L')?.relation, 'other_country');
    assert.equal(byName.get('General Electric México, S.A. de C.V.')?.route, 'group_reference');
    assert.equal(byName.get('General Electric México, S.A. de C.V.')?.domain, 'ge.com');
    assert.equal(byName.get('ProlecGE')?.route, 'agent1_writer');
    assert.deepEqual([...plan.withoutWebsite.keys()], ['AR'], 'sólo la que no tiene ninguna web va a «Descartadas»');
  });

  it('una empresa de partida que ya existe no se vuelve a escribir; respeta el tope de filas', () => {
    const plan = planCorporateTreeWrites({
      root: { ...ROOT, candidateId: '11111111-1111-4111-8111-111111111111' },
      freeHits: [FREE_HIT('Grupo Nutresa', 'CO', { relation: 'root' })],
      nodes: [NODE('A', 'CO'), NODE('B', 'CO'), NODE('C', 'CO')],
      maxRows: 2,
    });
    assert.deepEqual(plan.rows.map((r) => r.name), ['A', 'B']);
    assert.equal(plan.droppedByCap, 1);
  });
});

describe('B2. Lo gratis primero — registros oficiales y banco por nombre', () => {
  const SNAP = (sourceKey: string, countryCode: string, legalName: string, raw: Record<string, unknown> = {}): FreeSnapshotRow => ({
    source_key: sourceKey,
    country_code: countryCode,
    legal_name: legalName,
    normalized_legal_name: legalName.toLowerCase(),
    tax_id: `${countryCode}${legalName.length}`,
    normalized_tax_id: `${countryCode}${legalName.length}`,
    city: null,
    region: null,
    record_identity_key: `${sourceKey}:${legalName}`,
    raw_data: raw,
  });

  it('busca por prefijo en cada fuente del país, deduplica, clasifica la rama e infiere el país de partida', async () => {
    const asked: string[] = [];
    const result = await findCorporateTreeFreeHits(
      { rootName: 'Cencosud S.A.', rootCountryCode: null, countryCodes: ['CL', 'PE'] },
      {
        querySnapshotsByPrefix: async (sourceKey, prefix) => {
          asked.push(`${sourceKey}:${prefix}`);
          if (sourceKey === 'cl_sii_directory') return [SNAP('cl_sii_directory', 'CL', 'CENCOSUD S.A.', { workers: 120000, website_domain: 'cencosud.com' }), SNAP('cl_sii_directory', 'CL', 'CENCOSUD RETAIL S.A.')];
          if (sourceKey === 'cl_sii_registry') return [SNAP('cl_sii_registry', 'CL', 'CENCOSUD S.A.'), SNAP('cl_sii_registry', 'CL', 'CENCOSURE LTDA')];
          if (sourceKey === 'pe_sunat_registry') return [SNAP('pe_sunat_registry', 'PE', 'CENCOSUD PERU S.A.')];
          return [];
        },
        queryBankByNamePrefix: async () => [],
        readBankCandidate: () => null,
      },
    );
    assert.ok(asked.includes('cl_sii_directory:cencosud'));
    assert.ok(asked.includes('pe_sunat_name_alias:cencosud'));
    assert.equal(result.rootCountryCode, 'CL', 'el nombre exacto con más trabajadores');
    const byName = new Map(result.hits.map((h) => [h.name, h]));
    assert.equal(byName.get('CENCOSUD S.A.')?.relation, 'root');
    assert.equal(byName.get('CENCOSUD S.A.')?.domain, 'cencosud.com');
    assert.equal(byName.get('CENCOSUD S.A.')?.company?.officialWorkforce?.workers, 120000);
    assert.equal(byName.get('CENCOSUD RETAIL S.A.')?.relation, 'subsidiary');
    assert.equal(byName.get('CENCOSUD PERU S.A.')?.relation, 'other_country');
    assert.equal(byName.has('CENCOSURE LTDA'), false, 'vecino del rango que no empieza por el nombre');
    assert.equal(result.hits.filter((h) => h.name === 'CENCOSUD S.A.').length, 1, 'una sola vez aunque salga en dos fuentes');
  });

  it('«Grupo X» también busca «X»; nombres muy cortos no buscan nada', () => {
    assert.deepEqual(corporateTreeNameCores('Grupo Nutresa S.A.'), ['grupo nutresa', 'nutresa']);
    assert.deepEqual(corporateTreeNameCores('Bi'), []);
    assert.ok(prefixUpperBound('grupo diaz') > 'grupo diaz s a', 'un prefijo que termina en «z» no vacía el rango');
    assert.ok(prefixUpperBound('3m') > '3m colombia');
    assert.equal(escapeLikePrefix('a_b%c'), 'a\\_b\\%c');
  });
});

describe('C. parseCorporateTreeRequest — lo del navegador se valida campo por campo', () => {
  const base = {
    clientRequestId: '22222222-2222-4222-8222-222222222222',
    rootName: '  Grupo Éxito\u0000 ',
    branches: ['group', 'nope', 'other_country'],
    countryCodes: ['CO', 'XX', 'PE'],
    rootCountryCode: 'co',
    rootCandidateId: 'no-uuid',
  };

  it('limpia el nombre, se queda sólo con ramas y países conocidos e ignora ids inválidos', () => {
    const parsed = parseCorporateTreeRequest(base);
    assert.ok(parsed.ok);
    assert.equal(parsed.request.rootName, 'Grupo Éxito');
    assert.deepEqual(parsed.request.branches, ['group', 'other_country']);
    assert.deepEqual(parsed.request.countries.map((c) => c.code), ['CO', 'PE']);
    assert.equal(parsed.request.rootCountryCode, 'CO');
    assert.equal(parsed.request.rootCandidateId, null);
  });

  it('rechaza sin nombre, sin ramas, sin países o sin id de petición', () => {
    assert.deepEqual(parseCorporateTreeRequest({ ...base, rootName: ' ' }), { ok: false, error: 'root_name_required' });
    assert.deepEqual(parseCorporateTreeRequest({ ...base, branches: [] }), { ok: false, error: 'branches_required' });
    assert.deepEqual(parseCorporateTreeRequest({ ...base, countryCodes: ['XX'] }), { ok: false, error: 'countries_required' });
    assert.deepEqual(parseCorporateTreeRequest({ ...base, clientRequestId: 'x' }), { ok: false, error: 'invalid_request' });
  });
});

function outcomeFor(branch: CorporateTreeSearchOutcome['branch'], nodes: CorporateTreeNode[], extra: Partial<CorporateTreeSearchOutcome> = {}): CorporateTreeSearchOutcome {
  return {
    branch,
    nodes,
    root: null,
    proposed: nodes.length,
    rejected: {},
    websitesDropped: 0,
    usage: { model: MODEL, inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1, webFetchRequests: 0, estimatedCostUsd: 0.1, pricingSource: 'table' } as CorporateTreeSearchOutcome['usage'],
    errorCode: null,
    ...extra,
  };
}

const REQUEST: CorporateTreeRequest = {
  clientRequestId: '33333333-3333-4333-8333-333333333333',
  rootName: 'Grupo Nutresa',
  rootWebsite: null,
  rootCountryCode: 'CO',
  rootCandidateId: null,
  rootAccountId: null,
  branches: ['subsidiary', 'other_country'],
  countries: [CO, PE],
};

function fakeDeps(overrides: Partial<CorporateTreeRunDeps> = {}) {
  const calls = {
    reserved: [] as unknown[],
    freeCatalog: [] as Array<{ country: string; names: string[] }>,
    web: [] as Array<{ country: string; names: string[] }>,
    withoutWebsite: [] as Array<{ country: string; names: string[] }>,
    tagged: new Map<string, Record<string, unknown>>(),
    relationships: [] as CorporateTreeRelationshipRow[],
    sealed: [] as Array<{ persisted: number; metadata: Record<string, unknown> }>,
    rescued: [] as string[],
    knownToClaude: [] as string[],
    clearedIndustry: [] as string[],
    stages: [] as string[],
    usageLogs: [] as Array<{ batchId: string }>,
  };
  const batchCandidates: CorporateTreeBatchCandidate[] = [
    { id: 'c-root', name: 'Grupo Nutresa', country_code: 'CO', domain: null, status: 'duplicate', matched_hubspot_company_id: 'hs-1', metadata: {} },
    { id: 'c-noel', name: 'Noel', country_code: 'CO', domain: 'noel.com.co', status: 'needs_review', matched_hubspot_company_id: null, metadata: { notes: 'x' } },
    { id: 'c-pe', name: 'Nutresa Peru S.A.', country_code: 'PE', domain: 'nutresa.com.pe', status: 'needs_review', matched_hubspot_company_id: null, metadata: {} },
  ];
  const deps: CorporateTreeRunDeps = {
    loadExistingRoot: async () => null,
    reserveBatch: async (input) => {
      calls.reserved.push(input);
      return { status: 'reserved', batchId: 'batch-1' };
    },
    findFreeHits: async () => ({
      hits: [
        FREE_HIT('Grupo Nutresa', 'CO', { relation: 'root', domain: 'gruponutresa.com' }),
        FREE_HIT('Nutresa Peru S.A.', 'PE', { domain: 'nutresa.com.pe' }),
      ],
      rootCountryCode: 'CO',
      queries: 7,
      errors: 0,
    }),
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    searchBranch: async (input) => {
      calls.knownToClaude = (input.knownCompanies ?? []).map((c) => c.name);
      return input.branch === 'subsidiary'
        ? outcomeFor('subsidiary', [NODE('Noel', 'CO', { website: 'https://noel.com.co', domain: 'noel.com.co' })])
        : outcomeFor('other_country', [NODE('Nutresa Chile', 'CL', { branch: 'other_country' })]);
    },
    logBranchUsage: async (_outcome, ctx) => {
      calls.usageLogs.push({ batchId: ctx.batchId });
    },
    writeFreeCatalog: async (_batch, country, companies) => {
      calls.freeCatalog.push({ country: country.code, names: companies.map((c) => c.legalName ?? '') });
      return { written: companies.length, failed: false };
    },
    writeWeb: async (_batch, country, items) => {
      calls.web.push({ country: country.code, names: items.map((i) => i.node?.name ?? i.bankCandidate?.name ?? '') });
      return { written: items.length, errors: [] };
    },
    recordWithoutWebsite: async (_batch, countryCode, companies) => {
      calls.withoutWebsite.push({ country: countryCode, names: companies.map((c) => c.legalName ?? '') });
      return companies.length;
    },
    loadBatchCandidates: async () => batchCandidates,
    tagCandidate: async (id, metadata) => {
      calls.tagged.set(id, metadata);
    },
    insertRelationships: async (rows) => {
      calls.relationships.push(...rows);
      return true;
    },
    sealBatch: async (_batch, input) => {
      calls.sealed.push({ persisted: input.persisted, metadata: input.metadata });
    },
    scheduleRescue: (batchId) => {
      calls.rescued.push(batchId);
    },
    clearBatchIndustryLabel: async (batchId) => {
      calls.clearedIndustry.push(batchId);
    },
    nowMs: () => 1_000,
    report: (stage) => calls.stages.push(stage),
    newRunId: () => 'run-1',
    nowIso: () => '2026-10-14T12:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

const CONTEXT = { internalUserId: 'user-1', keyOf: corporateTreeRowKey, writeDeadlineAtMs: 1_000_000 };
const REQUEST_ALL: CorporateTreeRequest = { ...REQUEST, countries: [CO, PE, { code: 'CL', name: 'Chile' }] };

describe('D. runCorporateTreeSearch — por el camino del Agente 1, gratis primero', () => {
  it('reserva el lote al empezar, escribe lo gratis, Claude sólo lo que falta, etiqueta, asocia, sella y rescata', async () => {
    const { deps, calls } = fakeDeps();
    const result = await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(result.batchId, 'batch-1');
    assert.equal(result.inReview, 2);
    assert.equal(calls.reserved.length, 1);
    assert.deepEqual(calls.stages, ['tree_free', 'tree_searching', 'tree_branch_1', 'tree_checking', 'tree_saving']);
    assert.deepEqual(calls.knownToClaude, ['Grupo Nutresa', 'Nutresa Peru S.A.'], 'Claude no repite lo gratis');
    assert.deepEqual(calls.usageLogs, [{ batchId: 'batch-1' }, { batchId: 'batch-1' }], 'el costo queda con el lote');
    assert.deepEqual(calls.freeCatalog.map((c) => c.country).sort(), ['CO', 'PE']);
    assert.deepEqual(calls.web, [{ country: 'CO', names: ['Noel'] }]);
    assert.deepEqual(calls.withoutWebsite, [{ country: 'CL', names: ['Nutresa Chile'] }]);

    assert.equal(readCorporateTreeRelation(calls.tagged.get('c-noel')), 'subsidiary');
    assert.equal(calls.tagged.get('c-noel')?.notes, 'x', 'la metadata anterior se conserva');
    assert.equal(readCorporateTreeRelation(calls.tagged.get('c-pe')), 'other_country');
    assert.equal(readCorporateTreeRelation(calls.tagged.get('c-root')), 'root');

    const rootRow = calls.relationships.find((r) => r.relation_type === 'root');
    assert.equal(rootRow?.matched_hubspot_company_id, 'hs-1');
    assert.ok(calls.relationships.every((r) => r.root_candidate_id === 'c-root'));
    assert.equal(calls.relationships.find((r) => r.related_name === 'Nutresa Chile')?.related_candidate_id, null, 'sin web: asociación sin candidato');

    assert.equal(calls.sealed.length, 1);
    const tree = calls.sealed[0].metadata.corporate_tree as Record<string, Record<string, unknown>>;
    assert.equal(tree.free_first.hits, 2);
    assert.equal(tree.claude.accepted, 2);
    assert.deepEqual(calls.rescued, ['batch-1']);
    assert.deepEqual(calls.clearedIndustry, ['batch-1'], 'todo el lote queda sin industria pedida antes del rescate');
  });

  it('si algo falla después de reservar, el lote se cierra como fallado y se puede abrir', async () => {
    const { deps, calls } = fakeDeps({
      resolveActiveModel: async () => {
        throw new Error('boom');
      },
    });
    const result = await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.equal(result.ok ? 'ok' : result.code, 'run_failed');
    assert.equal(result.ok ? null : result.batchId, 'batch-1');
    assert.equal(calls.sealed.length, 1);
    assert.equal(calls.sealed[0].persisted, 0);
  });

  it('sin tiempo para escribir, no empieza más escrituras pero cierra el lote', async () => {
    const { deps, calls } = fakeDeps({ nowMs: () => 2_000_000 });
    await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.equal(calls.freeCatalog.length + calls.web.length + calls.withoutWebsite.length, 0);
    const tree = calls.sealed[0].metadata.corporate_tree as Record<string, unknown>;
    assert.ok((tree.write_errors as string[]).every((e) => e.startsWith('time_budget:')));
  });

  it('si la lectura del lote falla no se sella como vacío', async () => {
    const { deps, calls } = fakeDeps({ loadBatchCandidates: async () => null });
    await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.ok(calls.sealed[0].persisted > 0, 'cuenta lo que escribieron los escritores');
  });

  it('el mismo id dos veces no vuelve a pagar: devuelve el lote de la primera', async () => {
    const { deps, calls } = fakeDeps({ reserveBatch: async () => ({ status: 'already_reserved', batchId: 'batch-0' }) });
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok && result.alreadyStarted);
    assert.equal(result.batchId, 'batch-0');
    assert.deepEqual(calls.stages, ['tree_free'], 'lo gratis puede repetirse; Claude no');
    assert.equal(calls.usageLogs.length, 0);
    assert.equal(calls.sealed.length, 0);
  });

  it('desde una empresa que ya existe: usa sus datos y no la vuelve a escribir', async () => {
    const { deps, calls } = fakeDeps({
      loadExistingRoot: async () => ({ name: 'Grupo Nutresa', website: 'https://gruponutresa.com', countryCode: 'CO' }),
    });
    const result = await runCorporateTreeSearch({ ...REQUEST_ALL, rootAccountId: '44444444-4444-4444-8444-444444444444' }, CONTEXT, deps);
    assert.ok(result.ok);
    assert.deepEqual(calls.freeCatalog.map((c) => c.country), ['PE']);
    assert.ok(calls.relationships.every((r) => r.root_account_id === '44444444-4444-4444-8444-444444444444'));
    assert.ok(!calls.relationships.some((r) => r.relation_type === 'root'));
  });

  it('sin Claude (cuota o modelo) lo gratis igual se guarda', async () => {
    const { deps, calls } = fakeDeps({ checkQuota: async () => ({ allowed: false }) });
    const result = await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(calls.usageLogs.length, 0);
    assert.deepEqual(calls.freeCatalog.map((c) => c.country).sort(), ['CO', 'PE']);
    const tree = calls.sealed[0].metadata.corporate_tree as Record<string, Record<string, unknown>>;
    assert.equal(tree.claude.skipped, 'quota_exhausted');
  });

  it('sin nada que escribir: falla con el lote para poder abrirlo', async () => {
    const { deps, calls } = fakeDeps({
      findFreeHits: async () => ({ hits: [], rootCountryCode: null, queries: 1, errors: 0 }),
      searchBranch: async (input) => outcomeFor(input.branch, []),
    });
    const result = await runCorporateTreeSearch({ ...REQUEST, rootCountryCode: null }, CONTEXT, deps);
    assert.equal(result.ok ? 'ok' : result.code, 'nothing_found');
    assert.equal(result.ok ? null : result.batchId, 'batch-1');
    assert.deepEqual(calls.rescued, []);
    assert.equal(calls.sealed.length, 1, 'el lote se cierra igual');
  });

  it('el uso de IA va como «Claude busca empresas», con el lote, el flujo y la forma «árbol»', () => {
    const log = buildCorporateTreeUsageLog(outcomeFor('group', [NODE('X', 'CO')]), { runId: 'run-9', batchId: 'b-9', triggeredBy: 'u', rootName: 'R' });
    assert.equal(log?.operation_key, 'company_search');
    assert.equal(log?.batch_id, 'b-9');
    assert.equal(log?.usage_key, 'company_search:run-9:group');
    assert.equal(log?.estimated_cost_usd, 0.1);
    const metadata = log?.metadata as Record<string, unknown>;
    assert.equal(metadata.flow, 'corporate_tree_search');
    assert.equal(metadata.search_mode, 'corporate_tree');
    assert.deepEqual(resolveAgentDimensions('anthropic', 'company_search', 'corporate_tree_search'), {
      agentKey: 'agent1',
      agentStep: 'claude_busca_empresas',
    });
  });
});

describe('E. Lote y ficha agrupados por rama', () => {
  it('el lote agrupa por rama en orden y dice en qué quedó cada empresa', () => {
    const groups = groupBatchCandidatesByTreeRelation([
      { id: '1', name: 'Zeta', country_code: 'PE', status: 'needs_review', matched_hubspot_company_id: null, metadata: { corporate_tree: { relation: 'other_country' } } },
      { id: '2', name: 'Matriz', country_code: 'CO', status: 'duplicate', matched_hubspot_company_id: 'hs', metadata: { corporate_tree: { relation: 'group' } } },
      { id: '3', name: 'Sin árbol', country_code: 'CO', status: 'needs_review', matched_hubspot_company_id: null, metadata: {} },
    ]);
    assert.deepEqual(groups.map((g) => g.relation), ['group', 'other_country']);
    assert.equal(groups[0].items[0].statusLabel, 'Ya en HubSpot');
    assert.equal(groups[1].items[0].statusLabel, 'Por revisar');
    assert.equal(readCorporateTreeBatchSummary({ corporate_tree: { root_name: 'R', branches: ['group'], country_codes: ['CO'] } })?.rootName, 'R');
    assert.equal(readCorporateTreeBatchSummary({ source_label: 'x' }), null);
  });

  it('la ficha arma el árbol desde cualquiera de sus puntas', () => {
    const records: CorporateTreeRelationshipRecord[] = [
      { batch_id: 'b', root_name: 'R', root_candidate_id: 'root', related_candidate_id: 'a', related_name: 'A', related_country_code: 'CO', relation_type: 'subsidiary', relation_detail: null, evidence_url: null, matched_hubspot_company_id: null, created_at: '2026-10-14' },
      { batch_id: 'b', root_name: 'R', root_candidate_id: 'root', related_candidate_id: null, related_name: 'B', related_country_code: 'PE', relation_type: 'other_country', relation_detail: null, evidence_url: null, matched_hubspot_company_id: 'hs', created_at: '2026-10-14' },
    ];
    const [fromChild] = buildCorporateTreeViews(records, 'a', new Map([['a', 'needs_review']]));
    assert.equal(fromChild.selfRelation, 'subsidiary');
    assert.ok(fromChild.groups[0].items[0].isSelf);
    assert.equal(describeCorporateTreeItemStatus(fromChild.groups[1].items[0]), 'Ya en HubSpot');
    const [fromRoot] = buildCorporateTreeViews(records, 'root', new Map());
    assert.equal(fromRoot.selfRelation, 'root');
  });
});

describe('F. El asistente ofrece el árbol', () => {
  it('elegir «Árbol de una empresa» lleva a su conversación y «volver» regresa a la primera pregunta', () => {
    assert.ok(SEARCH_MODE_DEFINITIONS.some((d) => d.mode === 'corporate_tree' && d.availability === 'enabled'));
    const state = { currentStep: 'search_type', searchMode: null, warnings: [], blockingIssues: [] } as unknown as ProspectWizardState;
    const next = prospectWizardReducer(state, { type: 'SELECT_SEARCH_MODE', mode: 'corporate_tree' });
    assert.equal(next.currentStep, 'corporate_tree');
    const back = prospectWizardReducer(next, { type: 'GO_BACK' });
    assert.equal(back.currentStep, 'search_type');
  });
});

describe('G. El loader avanza como en «por criterios» y la respuesta perdida se recupera', () => {
  it('la barra avanza cuando TERMINA cada rama y antes de guardar', async () => {
    assert.equal(branchDoneStage(1, 3), 'tree_branch_1');
    assert.equal(branchDoneStage(2, 3), 'tree_branch_2');
    assert.equal(branchDoneStage(3, 3), null, 'la última rama la cubre «revisando»');
    assert.equal(branchDoneStage(1, 1), null);
    const { deps, calls } = fakeDeps();
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.deepEqual(calls.stages, ['tree_free', 'tree_searching', 'tree_branch_1', 'tree_checking', 'tree_saving']);
    const percents = ['tree_free', 'tree_searching', 'tree_branch_1', 'tree_branch_2', 'tree_checking', 'tree_saving'].map(
      (s) => RUN_PROGRESS_PERCENT[s as keyof typeof RUN_PROGRESS_PERCENT],
    );
    assert.deepEqual([...percents].sort((a, b) => a - b), percents, 'nunca retrocede');
    for (const s of ['tree_free', 'tree_branch_1', 'tree_branch_2', 'tree_saving']) assert.ok(RUN_PROGRESS_STAGES.includes(s as never));
  });

  it('sin respuesta, espera a que el lote tenga el id de la corrida y ya no tenga etapa en curso', async () => {
    let t = 0;
    const answers = [
      [],
      [{ clientRequestId: 'r', progress: null, batch: { id: 'b1', status: 'draft', candidateCount: 0 } }],
      [{ clientRequestId: 'r', progress: { stage: 'tree_saving' as const, label: 'x' }, batch: { id: 'b1', status: 'ready_for_review', candidateCount: 17 } }],
      [{ clientRequestId: 'r', progress: null, batch: { id: 'b1', status: 'ready_for_review', candidateCount: 17 } }],
    ];
    const recovered = await waitForTreeRunResult('r', {
      fetchStatus: async () => answers.shift() ?? [],
      sleep: async (ms) => {
        t += ms;
      },
      nowMs: () => t,
      startedAtMs: 0,
    });
    assert.deepEqual(recovered, { batchId: 'b1', candidateCount: 17 });
  });

  it('si el lote nunca aparece, se rinde al tope y no inventa un resultado', async () => {
    let t = 0;
    const recovered = await waitForTreeRunResult('r', {
      fetchStatus: async () => {
        throw new Error('sin red');
      },
      sleep: async (ms) => {
        t += ms;
      },
      nowMs: () => t,
      startedAtMs: 0,
    });
    assert.equal(recovered, null);
    assert.ok(t >= TREE_RUN_RECOVERY_TIMEOUT_MS);
  });

  it('la bandeja no marca fallada una corrida del árbol sin respuesta, y luego se reconcilia', async () => {
    const store = createAgentRunsStore({
      execute: async () => {
        throw new Error('http_504');
      },
      storage: null,
      nowMs: () => 1,
    });
    await store
      .startRun({ title: 'Árbol · Cencosud', payload: { clientRequestId: 'tree-1', searchMode: 'corporate_tree' } })
      .catch(() => undefined);
    let run = store.getSnapshot().find((r) => r.clientRequestId === 'tree-1');
    assert.equal(run?.status, 'running');
    assert.equal(run?.detached, true);
    store.reconcile('tree-1', { status: 'succeeded', batchId: 'b1', candidateCount: 17 });
    run = store.getSnapshot().find((r) => r.clientRequestId === 'tree-1');
    assert.equal(run?.status, 'succeeded');
    assert.equal(run?.redirectPath, '/prospect-batches/b1');

    await store.startRun({ title: 'CO · Tec', payload: { clientRequestId: 'crit-1' } }).catch(() => undefined);
    assert.equal(store.getSnapshot().find((r) => r.clientRequestId === 'crit-1')?.status, 'failed', 'por criterios no cambia');
  });
});

describe('H. El lote del árbol es del Agente 1 desde el primer instante', () => {
  it('la reserva crea un lote agent_1 «Árbol · X» con su forma de búsqueda y sin industria pedida', async () => {
    let inserted: Record<string, unknown> | null = null;
    const db = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return { select: () => ({ single: async () => ({ data: { id: 'b-1' }, error: null }) }) };
        },
      }),
    } as unknown as IdempotencyDbClient;
    const result = await reserveWizardExecutionSlot(
      {
        userId: 'u-1',
        clientRequestId: 'r-1',
        initialBatchPayload: {
          requestSource: 'chat_wizard',
          catalogVersionId: null,
          industryId: null,
          subindustryIds: [],
          countryCode: 'CL',
          additionalCriteria: null,
          targetCount: 30,
          country: 'Chile',
          industry: CORPORATE_TREE_BATCH_INDUSTRY,
          searchDepth: 'standard',
          corporateTree: {
            rootName: 'Cencosud',
            rootCountryCode: 'CL',
            branches: ['group', 'other_country'],
            countryCodes: ['CL', 'PE'],
            rootCandidateId: null,
            rootAccountId: null,
          },
        },
      },
      db,
    );
    assert.deepEqual(result, { status: 'reserved', batchId: 'b-1' });
    const row = inserted as unknown as Record<string, unknown>;
    assert.equal(row.source, 'agent_1');
    assert.equal(row.name, 'Árbol · Cencosud');
    assert.equal(row.client_request_id, 'r-1');
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.search_mode, 'corporate_tree');
    assert.equal(metadata.industry_id, null);
    assert.deepEqual((metadata.corporate_tree as Record<string, unknown>).country_codes, ['CL', 'PE']);
  });
});

describe('I. La sección del lote se pinta en el servidor (Prod 14-10: «This page couldn’t load»)', () => {
  it('no importa nada de un módulo «use client» para LLAMARLO (sólo componentes)', () => {
    const file = 'src/components/prospect-batches/corporate-tree/corporate-tree-batch-sections.tsx';
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /^'use client'/m, 'la sección es un componente de servidor');
    assert.doesNotMatch(source, /account-form-helpers/, 'getFlagEmoji de cuentas es de cliente: llamarlo en el servidor rompe la página');
    const helperPath = 'src/components/prospect-batches/candidate-detail-helpers.ts';
    assert.doesNotMatch(readFileSync(helperPath, 'utf8'), /^'use client'/m);
  });

  it('agrupa también lo que entró después por el rescate y lo que sigue sin web en «Descartadas»', () => {
    const groups = groupBatchCandidatesByTreeRelation(
      [{ id: 'x', name: 'CENCOSUD PERU S.A.C.', country_code: 'PE', status: 'needs_review', matched_hubspot_company_id: null, metadata: {} }],
      [
        { related_candidate_id: null, related_name: 'Cencosud Perú SAC', related_country_code: 'PE', relation_type: 'other_country', relation_detail: null, evidence_url: null },
        { related_candidate_id: null, related_name: 'Banco París', related_country_code: 'CL', relation_type: 'group', relation_detail: null, evidence_url: null },
      ],
    );
    const byRelation = new Map(groups.map((g) => [g.relation, g.items]));
    assert.equal(byRelation.get('other_country')?.[0].candidateId, 'x', 'mismo nombre sin forma societaria');
    assert.equal(byRelation.get('group')?.[0].statusLabel, 'En Descartadas: sin web');
    assert.equal(byRelation.get('group')?.[0].candidateId, null);
  });
});

describe('J. Lo gratis es preciso: familia sí, homónimos sólo si Claude los confirma', () => {
  it('quita la forma societaria aunque venga con espacios o «BIC»', () => {
    assert.equal(normalizeTreeName('CENCOSUD S A'), 'cencosud');
    assert.equal(normalizeTreeName('BIMBO DE COSTA RICA SOCIEDAD ANONIMA'), 'bimbo de costa rica');
    assert.equal(normalizeTreeName('Alpina Productos Alimenticios S.A.S BIC'), 'alpina productos alimenticios');
    assert.equal(normalizeTreeName('Cencosud Perú S.A.C.'), 'cencosud peru');
  });

  it('parentesco por palabra completa: familia, prefijo o nada', () => {
    assert.equal(nameKinship('cencosud', 'cencosud'), 'exact');
    assert.equal(nameKinship('bimbo de colombia', 'bimbo'), 'family');
    assert.equal(nameKinship('alpina termoplasticos', 'alpina'), 'prefix');
    assert.equal(nameKinship('nutresan', 'nutresa'), 'none');
  });

  it('entra sola la empresa en su país y la familia de una fuente fuerte; lo demás pasa por Claude', () => {
    const base = { countryCode: 'CL', rootCountryCode: 'CL', origin: 'catalog' as const, strongSource: false };
    assert.equal(freeHitConfirmation({ ...base, kinship: 'exact' }), 'confirmed');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'exact', countryCode: 'AR' }), 'needs_claude', 'mismo nombre en otro país = posible homónimo');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'family', countryCode: 'PE', strongSource: true }), 'confirmed');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'family', countryCode: 'PE' }), 'needs_claude');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'prefix', strongSource: true }), 'needs_claude');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'exact', origin: 'bank' }), 'needs_claude');
    assert.equal(isStrongFreeSource({ sourceKey: 'pe_sunat_registry', workers: 10 }), false);
    assert.equal(isStrongFreeSource({ sourceKey: 'pe_sunat_registry', workers: 50 }), true);
  });

  it('el plan: sin confirmar y sin Claude no entra; con Claude entra con su web; misma web de partida = la empresa de partida', () => {
    const plan = planCorporateTreeWrites({
      root: ROOT,
      freeHits: [
        FREE_HIT('Nutresa SA', 'AR', { confirmation: 'needs_claude' }),
        FREE_HIT('Nutresa Chile', 'CL', { confirmation: 'needs_claude' }),
        FREE_HIT('Grupo Nutresa SA', 'CO', { relation: 'root', domain: 'gruponutresa.com' }),
      ],
      nodes: [NODE('Nutresa Chile', 'CL', { branch: 'other_country', website: 'https://nutresa.cl', domain: 'nutresa.cl' })],
    });
    const byKey = new Map(plan.rows.map((r) => [corporateTreeRowKey(r.name, r.countryCode), r]));
    assert.equal(byKey.has(corporateTreeRowKey('Nutresa SA', 'AR')), false);
    assert.equal(plan.unconfirmedDropped, 1);
    const chile = byKey.get(corporateTreeRowKey('Nutresa Chile', 'CL'));
    assert.equal(chile?.domain, 'nutresa.cl', 'la web que aportó Claude se une a la fila del registro');
    assert.equal(chile?.taxId, 'CL-1', 'y conserva el número fiscal oficial');
    assert.equal(plan.rows.filter((r) => r.relation === 'root').length, 1, 'la empresa de partida no se duplica');
  });

  it('el nombre escrito en minúsculas se muestra con mayúscula inicial; lo demás no se toca', () => {
    assert.equal(displayCompanyName('cencosud'), 'Cencosud');
    assert.equal(displayCompanyName('grupo bimbo'), 'Grupo Bimbo');
    assert.equal(displayCompanyName('BIMBO'), 'BIMBO');
  });

  it('la ficha de una empresa rescatada encuentra su asociación por lote, nombre y país', () => {
    const record = (name: string, country: string, extra: Partial<CorporateTreeRelationshipRecord> = {}): CorporateTreeRelationshipRecord => ({
      batch_id: 'b1',
      root_name: 'Cencosud',
      root_candidate_id: null,
      related_candidate_id: null,
      related_name: name,
      related_country_code: country,
      relation_type: 'other_country',
      relation_detail: null,
      evidence_url: null,
      matched_hubspot_company_id: null,
      created_at: '2026-10-14T00:00:00Z',
      ...extra,
    });
    const linked = linkTreeRecordsToCandidates(
      [record('Cencosud Perú SAC', 'PE'), record('Cencosud Colombia', 'CO'), record('Otra', 'AR', { related_candidate_id: 'z' })],
      [
        { id: 'p', batch_id: 'b1', name: 'CENCOSUD PERU S.A.C.', country_code: 'pe' },
        { id: 'q', batch_id: 'b2', name: 'Cencosud Colombia', country_code: 'CO' },
      ],
    );
    assert.equal(linked[0].related_candidate_id, 'p');
    assert.equal(linked[1].related_candidate_id, null, 'otro lote no cuenta');
    assert.equal(linked[2].related_candidate_id, 'z');
    const [view] = buildCorporateTreeViews(linked, 'p', new Map([['p', 'needs_review']]));
    assert.equal(view.selfRelation, 'other_country');
  });
});

describe('K. Lo que no entró a revisión se dice como es', () => {
  it('el aviso cuenta las que esperan web y las que usan la del grupo, sin culpar a HubSpot', () => {
    assert.equal(
      corporateTreePendingSummary({ waitingWebsite: 2, groupReferences: 7 }),
      '2 esperan su web en «Descartadas» y 7 quedan como referencia (web del grupo).',
    );
    assert.match(corporateTreePendingSummary({ waitingWebsite: 0, groupReferences: 0 }), /HubSpot/);
    assert.doesNotMatch(corporateTreePendingSummary({ waitingWebsite: 1, groupReferences: 0 }), /HubSpot/);
  });

  it('el lote distingue «sin web» de «usa la web del grupo»', () => {
    const groups = groupBatchCandidatesByTreeRelation(
      [],
      [
        { related_candidate_id: null, related_name: 'GE México', related_country_code: 'MX', related_domain: 'ge.com', relation_type: 'subsidiary', relation_detail: null, evidence_url: null },
        { related_candidate_id: null, related_name: 'GE SRL', related_country_code: 'AR', related_domain: null, relation_type: 'other_country', relation_detail: null, evidence_url: null },
      ],
    );
    const byRelation = new Map(groups.map((g) => [g.relation, g.items[0]]));
    assert.equal(byRelation.get('subsidiary')?.statusLabel, 'Referencia: usa la web del grupo');
    assert.equal(byRelation.get('subsidiary')?.groupWebsite, 'https://ge.com');
    assert.equal(byRelation.get('other_country')?.statusLabel, 'En Descartadas: sin web');
  });
});

describe('L. Citigroup (Prod 15-10): menos rescate pagado y webs de bancos', () => {
  const CITI: CorporateTreeRoot = { name: 'Citigroup', website: 'https://www.citigroup.com', domain: 'citigroup.com', countryCode: 'US', candidateId: null, accountId: null };

  it('la empresa de partida del registro sin web usa la web que ya conocemos', () => {
    const plan = planCorporateTreeWrites({ root: CITI, freeHits: [FREE_HIT('CITIGROUP INC', 'US', { relation: 'root' })], nodes: [] });
    const row = plan.rows.find((r) => r.relation === 'root');
    assert.equal(row?.domain, 'citigroup.com');
    assert.equal(row?.route, 'free_catalog');
    assert.equal(plan.withoutWebsite.size, 0, 'no va a «Descartadas»');
  });

  it('las que ya están en HubSpot por su nombre no van al rescate y quedan con su ficha', () => {
    const plan = planCorporateTreeWrites({
      root: CITI,
      freeHits: [],
      nodes: [NODE('Citibank-Colombia S.A.', 'CO'), NODE('Citibank N.A. Ecuador', 'EC')],
    });
    const marked = markKnownCompanies(plan, new Map([[corporateTreeRowKey('Citibank-Colombia S.A.', 'CO'), { hubspotCompanyId: '123', accountId: null }]]));
    const byName = new Map(marked.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('Citibank-Colombia S.A.')?.route, 'already_known');
    assert.equal(byName.get('Citibank-Colombia S.A.')?.knownHubspotCompanyId, '123');
    assert.deepEqual([...marked.withoutWebsite.keys()], ['EC']);
    assert.equal(plan.rows.find((r) => r.name === 'Citibank-Colombia S.A.')?.route, 'without_website', 'el plan original no cambia');
  });

  it('sólo coincidencias exactas y del mismo país cuentan como «ya conocida»', () => {
    const exact = { source: 'hubspot' as const, status: 'existing_in_hubspot', confidence: 82, matchedId: 'hs-1', raw: { country: 'Colombia' } };
    assert.deepEqual(pickKnownCompany({ hubspot: [exact], sellup: [], countryCode: 'CO', countryName: 'Colombia' }), {
      hubspotCompanyId: 'hs-1',
      accountId: null,
      kind: 'exact',
      matchedName: null,
    });
    assert.equal(pickKnownCompany({ hubspot: [{ ...exact, raw: { country: 'United States' } }], sellup: [], countryCode: 'UY', countryName: 'Uruguay' }), null, 'otro país');
    assert.equal(
      pickKnownCompany({ hubspot: [{ ...exact, status: 'possible_duplicate', confidence: 65 }], sellup: [], countryCode: 'CO', countryName: 'Colombia' })?.kind,
      'possible',
      'parecido en el mismo país = posible duplicado, no «ya conocida»',
    );
    assert.equal(
      pickKnownCompany({ hubspot: [{ ...exact, status: 'possible_duplicate', confidence: 50 }], sellup: [], countryCode: 'CO', countryName: 'Colombia' }),
      null,
      'similitud baja no cuenta',
    );
    assert.deepEqual(
      pickKnownCompany({
        hubspot: [],
        sellup: [{ source: 'sellup', status: 'existing_in_sellup', confidence: 88, matchedId: 'acc-1' }],
        countryCode: 'CO',
        countryName: 'Colombia',
        accountHubspotId: () => 'hs-9',
      }),
      { hubspotCompanyId: 'hs-9', accountId: 'acc-1', kind: 'exact', matchedName: null },
    );
  });

  it('la corrida pregunta antes de mandar al rescate y no lo agenda si no queda ninguna sin web', async () => {
    const { deps, calls } = fakeDeps({
      searchBranch: async (input) =>
        input.branch === 'subsidiary' ? outcomeFor('subsidiary', []) : outcomeFor('other_country', [NODE('Nutresa Chile', 'CL', { branch: 'other_country' })]),
      findKnownCompany: async ({ name }) => (name === 'Nutresa Chile' ? { hubspotCompanyId: 'hs-cl', accountId: null } : null),
    });
    const result = await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(result.alreadyKnown, 1);
    assert.deepEqual(calls.withoutWebsite, []);
    assert.deepEqual(calls.rescued, [], 'sin filas sin web, no hay rescate que pagar');
    assert.equal(calls.relationships.find((r) => r.related_name === 'Nutresa Chile')?.matched_hubspot_company_id, 'hs-cl');
  });

  it('una web que el sitio no deja comprobar sólo vale con su nombre propio y la terminación de su país', () => {
    assert.equal(blockedSiteDomainCarriesName('Citibank del Perú S.A.', 'citibank.com.pe', 'PE'), true);
    assert.equal(blockedSiteDomainCarriesName('Grupo Financiero Citibanamex', 'banamex.com', 'MX'), true);
    assert.equal(blockedSiteDomainCarriesName('Citibank N.A. Ecuador', 'citi.com.ec', 'EC'), false, 'el dominio no lleva el nombre');
    assert.equal(blockedSiteDomainCarriesName('Citibank del Perú S.A.', 'citibank.com.ar', 'PE'), false, 'otro país');
    assert.equal(blockedSiteDomainCarriesName('Banco de Chile', 'chile.cl', 'CL'), false, 'palabras genéricas no cuentan');
  });

  it('el aviso nombra también las que ya estaban en HubSpot', () => {
    assert.equal(
      corporateTreePendingSummary({ waitingWebsite: 3, groupReferences: 1, alreadyKnown: 7 }),
      '3 esperan su web en «Descartadas», 1 queda como referencia (web del grupo) y 7 ya estaban en HubSpot.',
    );
  });

  it('el lote dice «Ya en HubSpot» y marca la web no comprobada', () => {
    const groups = groupBatchCandidatesByTreeRelation(
      [{ id: 'p', name: 'Citibank del Perú', country_code: 'PE', status: 'needs_review', matched_hubspot_company_id: null, metadata: { corporate_tree: { relation: 'subsidiary', website_unverified: true } } }],
      [{ related_candidate_id: null, related_name: 'Citibank Colombia', related_country_code: 'CO', related_domain: null, matched_hubspot_company_id: '123', relation_type: 'group', relation_detail: null, evidence_url: null }],
    );
    const byRelation = new Map(groups.map((g) => [g.relation, g.items[0]]));
    assert.equal(byRelation.get('group')?.statusLabel, 'Ya en HubSpot');
    assert.equal(byRelation.get('subsidiary')?.websiteUnverified, true);
  });

  it('la cuenta ve los árboles en que aparece: por su HubSpot o porque se buscó desde ella', () => {
    const rec = (extra: Partial<CorporateTreeRelationshipRecord>): CorporateTreeRelationshipRecord => ({
      batch_id: 'b1', root_name: 'Citigroup', root_candidate_id: null, root_account_id: null, related_candidate_id: null,
      related_name: 'Citibank Colombia', related_country_code: 'CO', relation_type: 'group', relation_detail: null,
      evidence_url: null, matched_hubspot_company_id: null, created_at: '2026-10-15T00:00:00Z', ...extra,
    });
    const [byHubspot] = buildCorporateTreeViews([rec({ matched_hubspot_company_id: '123' })], { candidateIds: new Set(), hubspotCompanyId: '123', accountId: 'acc' }, new Map());
    assert.equal(byHubspot.selfRelation, 'group');
    const [asRoot] = buildCorporateTreeViews([rec({ batch_id: 'b2', root_account_id: 'acc' })], { candidateIds: new Set(), accountId: 'acc' }, new Map());
    assert.equal(asRoot.selfRelation, 'root');
  });
});

describe('M. Filiales con la web del grupo y Apollo por nombre', () => {
  const GE: CorporateTreeRoot = { name: 'General Electric', website: 'https://www.ge.com', domain: 'ge.com', countryCode: 'US', candidateId: null, accountId: null };
  const MX = 'General Electric México, S.A. de C.V.';

  it('la filial con la web del grupo entra a revisión SIN web propia si tiene número fiscal oficial', () => {
    const plan = planCorporateTreeWrites({
      root: GE,
      freeHits: [],
      nodes: [NODE(MX, 'MX', { website: 'https://www.ge.com/mx', domain: 'ge.com' }), NODE('GE Energy Colombia S.A.', 'CO', { website: 'https://www.ge.com/co', domain: 'ge.com' })],
    });
    const key = corporateTreeRowKey(MX, 'MX');
    assert.ok(plan.groupCompanies.has(key));
    const promoted = promoteGroupCompaniesWithTaxIds(plan, new Map([[key, { ...(plan.groupCompanies.get(key) as CountrySourceCompany), taxId: 'GEM123456AB1', taxIdentifierType: 'RFC' as const }]]));
    const byName = new Map(promoted.rows.map((r) => [r.name, r]));
    assert.equal(byName.get(MX)?.route, 'free_catalog');
    assert.equal(byName.get(MX)?.domain, null, 'nunca reclama ge.com');
    assert.equal(byName.get(MX)?.groupWebsite, 'https://www.ge.com/mx');
    assert.equal(promoted.freeCatalog.get('MX')?.[0].taxId, 'GEM123456AB1');
    assert.equal(promoted.freeCatalog.get('MX')?.[0].domain, null);
    assert.equal(byName.get('GE Energy Colombia S.A.')?.route, 'group_reference', 'sin número sigue como referencia');
  });

});

describe('N. Citigroup 2.ª corrida (Prod 15-10): Apollo y HubSpot', () => {

  it('un nombre parecido exige que HubSpot diga el MISMO país (también en inglés)', () => {
    const possible = { source: 'hubspot' as const, status: 'possible_duplicate', confidence: 65, matchedId: 'hs-7', matchedName: 'Citibank', raw: { country: 'United States' } };
    assert.deepEqual(
      pickKnownCompany({ hubspot: [possible], sellup: [], countryCode: 'US', countryName: 'Estados Unidos', countryAliases: ['United States'] }),
      { hubspotCompanyId: 'hs-7', accountId: null, kind: 'possible', matchedName: 'Citibank' },
    );
    assert.equal(pickKnownCompany({ hubspot: [{ ...possible, raw: {} }], sellup: [], countryCode: 'US', countryName: 'Estados Unidos' }), null, 'sin país no se adivina');
  });

  it('el posible duplicado va a «Descartadas» como duplicado (sin rescate) y el lote lo dice', async () => {
    const recorded: string[] = [];
    const { deps, calls } = fakeDeps({
      searchBranch: async (input) =>
        input.branch === 'subsidiary' ? outcomeFor('subsidiary', []) : outcomeFor('other_country', [NODE('Nutresa Chile', 'CL', { branch: 'other_country' })]),
      findKnownCompany: async () => ({ hubspotCompanyId: 'hs-x', accountId: null, kind: 'possible', matchedName: 'Nutresa' }),
      recordPossibleDuplicates: async (_batch, _cc, items) => {
        recorded.push(...items.map((i) => `${i.company.legalName}→${i.matchedName}`));
        return items.length;
      },
    });
    const result = await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.ok(result.ok);
    assert.deepEqual(recorded, ['Nutresa Chile→Nutresa']);
    assert.deepEqual(calls.withoutWebsite, [], 'no va al rescate');
    assert.deepEqual(calls.rescued, []);
    assert.equal(result.possibleKnown, 1);
    assert.equal(result.alreadyKnown, 0);
    assert.equal(calls.relationships.find((r) => r.related_name === 'Nutresa Chile')?.matched_hubspot_company_id, null, 'no se afirma «Ya en HubSpot»');

    const groups = groupBatchCandidatesByTreeRelation(
      [],
      [{ related_candidate_id: null, related_name: 'Nutresa Chile', related_country_code: 'CL', relation_type: 'other_country', relation_detail: null, evidence_url: null, discard_reason_code: 'corporate_tree_possible_hubspot_duplicate' }],
    );
    assert.equal(groups[0].items[0].statusLabel, 'En Descartadas: posible duplicado en HubSpot');
    assert.match(corporateTreePendingSummary({ waitingWebsite: 0, groupReferences: 0, possibleKnown: 2 }), /2 parecen ya estar en HubSpot/);
  });
});

describe('P. Citigroup 4.ª corrida (Prod 15-10): el lote no confunde «ya en SellUp» con «web del grupo»', () => {
  it('el lote: web propia ya en SellUp ≠ web del grupo ≠ no entró', () => {
    const base = { related_candidate_id: null, relation_detail: null, evidence_url: null, root_domain: 'citigroup.com' };
    const rels = [
      { ...base, related_name: 'CITIGROUP INC', related_country_code: 'US', relation_type: 'root', related_domain: 'citigroup.com', own_website: true, known_in_sellup: true },
      { ...base, related_name: 'Citibank Colombia S.A.', related_country_code: 'CO', relation_type: 'group', related_domain: 'citibank.com.co', own_website: true, known_in_sellup: false },
      { ...base, related_name: 'Citi Europe Plc', related_country_code: 'ES', relation_type: 'other_country', related_domain: 'citigroup.com' },
    ];
    const items = groupBatchCandidatesByTreeRelation([], rels).flatMap((g) => g.items);
    const byName = new Map(items.map((i) => [i.name, i]));
    assert.equal(byName.get('CITIGROUP INC')?.statusLabel, 'Ya en SellUp (otra búsqueda o cuenta)');
    assert.equal(byName.get('CITIGROUP INC')?.groupWebsite, null);
    assert.equal(byName.get('Citibank Colombia S.A.')?.statusLabel, 'No entró: ya existía o no pasó las revisiones');
    assert.equal(byName.get('Citi Europe Plc')?.statusLabel, 'Referencia: usa la web del grupo');
  });

  it('qué filas tienen web propia: la partida siempre; las demás si su web no es la del grupo ni compartida', () => {
    const base = { related_candidate_id: null, relation_detail: null, evidence_url: null, root_domain: 'citigroup.com' };
    const rels = [
      { ...base, related_name: 'CITIGROUP INC', related_country_code: 'US', relation_type: 'root', related_domain: 'citigroup.com' },
      { ...base, related_name: 'Citibank Colombia', related_country_code: 'CO', relation_type: 'group', related_domain: 'citibank.com.co' },
      { ...base, related_name: 'Citibank N.A.', related_country_code: 'US', relation_type: 'subsidiary', related_domain: 'citibank.com' },
      { ...base, related_name: 'Citibank Argentina', related_country_code: 'AR', relation_type: 'other_country', related_domain: 'citibank.com' },
      { ...base, related_name: 'Citi Europe', related_country_code: 'ES', relation_type: 'other_country', related_domain: 'citigroup.com' },
    ];
    assert.deepEqual(ownDomainsWithoutCandidate(rels).sort(), ['citibank.com.co', 'citigroup.com']);
  });
});

describe('Q. La sucursal de una empresa en un país es esa empresa en ese país', () => {
  it('«X, Sucursal en España» y «X» en España son la misma fila; una palabra suelta no corta el nombre', () => {
    assert.equal(
      corporateTreeRowKey('Citigroup Global Markets Europe AG, Sucursal en España', 'ES'),
      corporateTreeRowKey('Citigroup Global Markets Europe AG', 'ES'),
    );
    assert.equal(corporateTreeRowKey('Citibank N.A. - Sucursal Argentina', 'AR'), 'citibank|AR');
    assert.equal(corporateTreeRowKey('Banco Agencia de Viajes SA', 'CO'), 'banco agencia de viajes|CO');
    assert.notEqual(corporateTreeRowKey('Citigroup Global Markets Europe AG', 'ES'), corporateTreeRowKey('Citigroup Global Markets Europe AG', 'DE'));
  });

  it('el plan no la repite', () => {
    const plan = planCorporateTreeWrites({
      root: { name: 'Citigroup', website: 'https://www.citigroup.com', domain: 'citigroup.com', countryCode: 'US', candidateId: null, accountId: null },
      freeHits: [],
      nodes: [NODE('Citigroup Global Markets Europe AG', 'ES'), NODE('Citigroup Global Markets Europe AG, Sucursal en España', 'ES')],
    });
    assert.equal(plan.rows.filter((r) => r.countryCode === 'ES').length, 1);
  });
});

describe('T. La filial que admitió el rescate con la web del grupo se ve así en el lote', () => {
  it('«Sin web propia: usa la del grupo», también si la marca la puso el rescate', () => {
    const groups = groupBatchCandidatesByTreeRelation(
      [{ id: 'ec', name: 'BIMBO ECUADOR S.A.', country_code: 'EC', status: 'needs_review', matched_hubspot_company_id: null, metadata: { parent_group_website: { website: 'https://grupobimbo.com', domain: 'grupobimbo.com' } } }],
      [{ related_candidate_id: null, related_name: 'BIMBO ECUADOR S.A.', related_country_code: 'EC', relation_type: 'group', relation_detail: null, evidence_url: null }],
    );
    const item = groups[0].items[0];
    assert.equal(item.candidateId, 'ec');
    assert.equal(item.groupWebsite, 'https://grupobimbo.com');
  });
});

describe('U. Lo que el rescate encontró ya existente se dice así', () => {
  it('«Ya existía (el rescate encontró su web)» en vez de «sin web»', () => {
    const groups = groupBatchCandidatesByTreeRelation(
      [],
      [{ related_candidate_id: null, related_name: 'BIMBO DE COLOMBIA S A', related_country_code: 'CO', relation_type: 'group', relation_detail: null, evidence_url: null, discard_reason_code: 'missing_domain_final', rescue_decision: 'duplicate' }],
    );
    assert.equal(groups[0].items[0].statusLabel, 'Ya existía (el rescate encontró su web)');
  });
});

describe('V. Apollo da la FAMILIA de la empresa de partida (1 crédito), no busca por nombre', () => {
  const BIMBO: CorporateTreeRoot = { name: 'Bimbo', website: 'https://grupobimbo.com', domain: 'grupobimbo.com', countryCode: 'MX', candidateId: null, accountId: null };
  const sub = (name: string, domain: string | null, countryCode: string | null = null) => ({ name, domain, website: domain ? `https://${domain}` : null, linkedinUrl: null, countryCode });

  it('lee las filiales de la ficha de Apollo, tolerante a lo que traiga', () => {
    const subs = readApolloSubsidiaries({
      name: 'Grupo Bimbo',
      suborganizations: [
        { id: '1', name: 'Bimbo de Colombia', website_url: 'https://www.bimbo.com.co' },
        { id: '2', name: 'Bimbo Canada', primary_domain: 'bimbo.ca', country: 'Canada' },
        { id: '3', name: 'Bimbo Chile', primary_domain: 'ideal.cl', country: 'Chile' },
        { id: '4' },
        'basura',
      ],
    });
    assert.deepEqual(subs.map((s) => [s.name, s.domain, s.countryCode]), [
      ['Bimbo de Colombia', 'bimbo.com.co', null],
      ['Bimbo Canada', 'bimbo.ca', null],
      ['Bimbo Chile', 'ideal.cl', 'CL'],
    ]);
    assert.deepEqual(readApolloSubsidiaries(null), []);
    assert.deepEqual(readApolloSubsidiaries({ name: 'X' }), []);
  });

  it('el país sale del dominio de país; un .com no dice el país', () => {
    assert.equal(countryFromDomain('bimbo.com.co'), 'CO');
    assert.equal(countryFromDomain('ideal.cl'), 'CL');
    assert.equal(countryFromDomain('grupobimbo.com'), null);
  });

  it('completa la web de la fila sin web que coincide, y agrega filiales nuevas sólo de países pedidos', () => {
    const plan = planCorporateTreeWrites({
      root: BIMBO,
      freeHits: [],
      nodes: [NODE('BIMBO DE COLOMBIA S A', 'CO'), NODE('Bimbo Perú', 'PE')],
    });
    const applied = applyApolloFamily({
      plan,
      root: BIMBO,
      countryCodes: ['MX', 'CO', 'PE', 'CL'],
      subsidiaries: [
        sub('Bimbo Colombia', 'bimbo.com.co'),
        sub('Bimbo Chile', 'ideal.cl', 'CL'),
        sub('Bimbo Canada', 'bimbo.ca'),
        sub('Grupo Bimbo Global', 'grupobimbo.com'),
        sub('Bimbo Perú Retail', 'bimbo.com.ar'),
      ],
    });
    const byName = new Map(applied.plan.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('BIMBO DE COLOMBIA S A')?.route, 'agent1_writer');
    assert.equal(byName.get('BIMBO DE COLOMBIA S A')?.domain, 'bimbo.com.co');
    assert.equal(byName.get('Bimbo Chile')?.route, 'agent1_writer', 'filial nueva de un país pedido');
    assert.equal(byName.get('Bimbo Chile')?.foundInApollo, true);
    assert.equal(byName.has('Bimbo Canada'), false, 'país no pedido / no se sabe');
    assert.equal(byName.has('Grupo Bimbo Global'), false, 'la web del grupo nunca');
    assert.equal(byName.get('Bimbo Perú')?.route, 'without_website', 'un dominio .ar no es de Perú');
    assert.equal(applied.matched, 1);
    assert.equal(applied.added, 1);
  });

  it('la corrida pregunta UNA vez, por la web de la empresa de partida, y lo cuenta en el lote', async () => {
    const asked: string[] = [];
    const { deps, calls } = fakeDeps({
      searchBranch: async (input) =>
        input.branch === 'subsidiary' ? outcomeFor('subsidiary', []) : outcomeFor('other_country', [NODE('Nutresa Chile', 'CL', { branch: 'other_country' })]),
      findApolloFamily: async ({ rootDomain }) => {
        asked.push(rootDomain);
        return [sub('Nutresa Chile', 'nutresa.cl', 'CL')];
      },
    });
    const result = await runCorporateTreeSearch({ ...REQUEST_ALL, rootWebsite: 'https://gruponutresa.com' }, CONTEXT, deps);
    assert.ok(result.ok);
    assert.deepEqual(asked, ['gruponutresa.com']);
    assert.ok(calls.web.some((c) => c.country === 'CL' && c.names.includes('Nutresa Chile')));
    const tree = calls.sealed[0].metadata.corporate_tree as Record<string, unknown>;
    assert.deepEqual(tree.apollo, { asked: true, subsidiaries: 1, matched: 1, added: 0 });
  });

  it('sin web de la empresa de partida no se pregunta (no hay con qué)', async () => {
    let asked = 0;
    const { deps } = fakeDeps({
      findFreeHits: async () => ({ hits: [], rootCountryCode: 'CO', queries: 0, errors: 0 }),
      findApolloFamily: async () => (asked++, []),
    });
    await runCorporateTreeSearch(REQUEST_ALL, CONTEXT, deps);
    assert.equal(asked, 0);
  });

  it('ya no existe la búsqueda por nombre; el paso sigue tras la bandera y la cuota de Apollo', () => {
    const source = readFileSync('src/server/prospect-batches/corporate-tree/corporate-tree-run.server.ts', 'utf8');
    assert.doesNotMatch(source, /searchApolloOrganizations|q_organization_name/);
    assert.match(source, /findApolloFamily: isAgent1CorporateTreeApolloEnabled\(\)/);
    assert.match(source, /checkProviderQuotaAvailable\('apollo'\)/);
    assert.match(source, /enrichApolloOrganization\(\{ domain: rootDomain/);
  });
});

describe('W. Bimbo 1.ª corrida con Apollo (Prod 15-10): sin repetir empresas ni pagar por las conocidas', () => {
  it('«BIMBO SA (AR)», «BIMBO DE ARGENTINA S.A.» y «Bimbo Argentina» son la misma fila en Argentina', () => {
    const key = corporateTreeRowKey('BIMBO DE ARGENTINA S.A.', 'AR');
    assert.equal(key, 'bimbo|AR');
    assert.equal(corporateTreeRowKey('BIMBO SA (AR)', 'AR'), key);
    assert.equal(corporateTreeRowKey('Bimbo Argentina', 'AR'), key);
    assert.equal(corporateTreeRowKey('PANIFICADORA BIMBO DEL PERU S.A.', 'PE'), 'panificadora bimbo|PE');
    assert.equal(corporateTreeRowKey('BIMBO (MX)', 'MX'), corporateTreeRowKey('BIMBO', 'MX'));
  });

  it('sólo quita el país PROPIO y nunca deja el nombre vacío', () => {
    assert.equal(corporateTreeRowKey('BIMBO DE ARGENTINA S.A.', 'CL'), 'bimbo de argentina|CL');
    assert.equal(corporateTreeRowKey('Banco de Chile', 'CL'), 'banco|CL');
    assert.equal(corporateTreeRowKey('De Chile', 'CL'), 'de chile|CL');
    assert.equal(corporateTreeRowKey('Hospital del Salvador (CL)', 'CL'), 'hospital del salvador|CL');
  });

  it('el plan no repite la filial de Argentina', () => {
    const plan = planCorporateTreeWrites({
      root: { name: 'Bimbo', website: 'https://grupobimbo.com', domain: 'grupobimbo.com', countryCode: 'MX', candidateId: null, accountId: null },
      freeHits: [],
      nodes: [NODE('BIMBO DE ARGENTINA S.A.', 'AR'), NODE('BIMBO SA (AR)', 'AR')],
    });
    assert.equal(plan.rows.filter((r) => r.countryCode === 'AR').length, 1);
  });

  it('el lote dice «Ya en SellUp (mismo número fiscal)» cuando el rescate no buscó su web', () => {
    const groups = groupBatchCandidatesByTreeRelation(
      [],
      [{ related_candidate_id: null, related_name: 'BIMBO ECUADOR S.A.', related_country_code: 'EC', relation_type: 'group', relation_detail: null, evidence_url: null, discard_reason_code: 'missing_domain_final', rescue_decision: 'duplicate', rescue_skipped: 'known_tax_id' }],
    );
    assert.equal(groups[0].items[0].statusLabel, 'Ya en SellUp (mismo número fiscal)');
  });
});
