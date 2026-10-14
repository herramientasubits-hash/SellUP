/**
 * Tests — Agente 1 · búsqueda en árbol de una empresa (AGENT1-CORPORATE-TREE-1).
 *
 * Sin red ni base: Claude, la importación y Supabase son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { AnthropicConversationResult } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import {
  buildCorporateTreeRequestBody,
  searchCorporateTreeBranch,
  SUBMIT_CORPORATE_TREE_TOOL_NAME,
  type CorporateTreeNode,
  type CorporateTreeSearchInput,
  type CorporateTreeSearchOutcome,
} from '../corporate-tree-search';
import { corporateTreeRowKey, planCorporateTreeImport, type CorporateTreeRoot } from '../corporate-tree-plan';
import {
  branchDoneStage,
  parseCorporateTreeRequest,
  runCorporateTreeSearch,
  type CorporateTreeBatchCandidate,
  type CorporateTreeRelationshipRow,
  type CorporateTreeRequest,
  type CorporateTreeRunDeps,
} from '../corporate-tree-run';
import { buildCorporateTreeUsageLog } from '../corporate-tree-run.server';
import { groupBatchCandidatesByTreeRelation, readCorporateTreeBatchSummary } from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import {
  buildCorporateTreeViews,
  describeCorporateTreeItemStatus,
  type CorporateTreeRelationshipRecord,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-associations';
import { readCorporateTreeRelation } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
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

describe('B. planCorporateTreeImport — la web del grupo nunca aparta a las hermanas', () => {
  it('incluye la empresa de partida si no existe en SellUp y guarda la web compartida sólo como referencia', () => {
    const plan = planCorporateTreeImport({
      root: ROOT,
      nodes: [
        NODE('Zenú', 'CO', { website: 'https://gruponutresa.com', domain: 'gruponutresa.com' }),
        NODE('Noel', 'CO', { website: 'https://noel.com.co', domain: 'noel.com.co' }),
        NODE('Tresmontes', 'CL', { branch: 'other_country', website: 'https://tmluc.cl', domain: 'tmluc.cl' }),
        NODE('Pozuelo', 'CR', { website: 'https://tmluc.cl', domain: 'tmluc.cl' }),
        NODE('Noel', 'CO', { branch: 'group' }),
      ],
      countries: [CO, { code: 'CL', name: 'Chile' }, { code: 'CR', name: 'Costa Rica' }],
    });
    assert.deepEqual(plan.rows.map((r) => r.relation), ['root', 'subsidiary', 'subsidiary', 'other_country', 'subsidiary']);
    const byName = new Map(plan.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('Zenú')?.candidate.website, undefined, 'misma web que la empresa de partida');
    assert.equal(byName.get('Zenú')?.groupWebsite, 'https://gruponutresa.com');
    assert.equal(byName.get('Noel')?.candidate.website, 'https://noel.com.co');
    assert.equal(byName.get('Tresmontes')?.candidate.website, undefined, 'web usada por dos ramas');
    assert.equal(byName.get('Pozuelo')?.groupWebsite, 'https://tmluc.cl');
    assert.equal(plan.sharedWebsites, 3);
    assert.equal(byName.get('Tresmontes')?.candidate.country, 'Chile');
    assert.match(byName.get('Zenú')?.candidate.notes ?? '', /Árbol de Grupo Nutresa: filiales y subsidiarias/);
  });

  it('una empresa de partida que ya existe no se vuelve a importar; respeta el tope de filas', () => {
    const plan = planCorporateTreeImport({
      root: { ...ROOT, candidateId: '11111111-1111-4111-8111-111111111111' },
      nodes: [NODE('A', 'CO'), NODE('B', 'CO'), NODE('C', 'CO')],
      countries: [CO],
      maxRows: 2,
    });
    assert.deepEqual(plan.rows.map((r) => r.name), ['A', 'B']);
    assert.equal(plan.droppedByCap, 1);
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
    imported: [] as unknown[],
    tagged: new Map<string, Record<string, unknown>>(),
    relationships: [] as CorporateTreeRelationshipRow[],
    marked: [] as Array<{ name: string; metadata: Record<string, unknown> }>,
    stages: [] as string[],
    usageLogs: 0,
  };
  const batchCandidates: CorporateTreeBatchCandidate[] = [
    { id: 'c-root', name: 'Grupo Nutresa', country_code: 'CO', status: 'duplicate', matched_hubspot_company_id: 'hs-1', metadata: {} },
    { id: 'c-noel', name: 'Noel', country_code: 'CO', status: 'needs_review', matched_hubspot_company_id: null, metadata: { notes: 'x' } },
    { id: 'c-pe', name: 'Nutresa Perú', country_code: 'PE', status: 'needs_review', matched_hubspot_company_id: null, metadata: {} },
  ];
  const deps: CorporateTreeRunDeps = {
    loadExistingRoot: async () => null,
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    searchBranch: async (input) =>
      input.branch === 'subsidiary'
        ? { ...outcomeFor('subsidiary', [NODE('Noel', 'CO')]), root: { website: 'https://gruponutresa.com', domain: 'gruponutresa.com', countryCode: 'CO' } }
        : outcomeFor('other_country', [NODE('Nutresa Perú', 'PE', { branch: 'other_country' })]),
    logBranchUsage: async () => {
      calls.usageLogs++;
    },
    importRows: async (rows) => {
      calls.imported.push(...rows);
      return { ok: true, batchId: 'batch-1', candidatesCreated: rows.length };
    },
    markBatch: async (_id, params) => {
      calls.marked.push({ name: params.name, metadata: params.metadata });
    },
    loadBatchCandidates: async () => batchCandidates,
    tagCandidate: async (id, metadata) => {
      calls.tagged.set(id, metadata);
    },
    insertRelationships: async (rows) => {
      calls.relationships.push(...rows);
      return true;
    },
    report: (stage) => calls.stages.push(stage),
    newRunId: () => 'run-1',
    nowIso: () => '2026-10-14T12:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

const CONTEXT = { internalUserId: 'user-1', keyOf: corporateTreeRowKey };

describe('D. runCorporateTreeSearch — la corrida completa', () => {
  it('importa raíz + ramas, marca el lote, etiqueta cada fila y guarda las asociaciones (también la que ya estaba en HubSpot)', async () => {
    const { deps, calls } = fakeDeps();
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(result.batchId, 'batch-1');
    assert.equal(result.inReview, 2);
    assert.equal(result.redirectPath, '/prospect-batches/batch-1');
    assert.equal(result.estimatedCostUsd, 0.2);
    assert.deepEqual(calls.stages, ['tree_searching', 'tree_branch_1', 'tree_checking', 'tree_saving']);
    assert.equal(calls.usageLogs, 2, 'una entrada de Uso de IA por rama');
    assert.equal(calls.imported.length, 3);
    assert.equal(calls.marked[0].name, 'Árbol · Grupo Nutresa');
    assert.equal((calls.marked[0].metadata.corporate_tree as Record<string, unknown>).root_domain, 'gruponutresa.com');

    assert.equal(readCorporateTreeRelation(calls.tagged.get('c-noel')), 'subsidiary');
    assert.equal(calls.tagged.get('c-noel')?.notes, 'x', 'la metadata anterior se conserva');
    assert.equal(readCorporateTreeRelation(calls.tagged.get('c-pe')), 'other_country');

    const rootRow = calls.relationships.find((r) => r.relation_type === 'root');
    assert.equal(rootRow?.matched_hubspot_company_id, 'hs-1');
    assert.ok(calls.relationships.every((r) => r.root_candidate_id === 'c-root'));
    assert.equal(calls.relationships.find((r) => r.related_name === 'Nutresa Perú')?.related_candidate_id, 'c-pe');
  });

  it('desde una empresa que ya existe: usa sus datos y no la reimporta', async () => {
    const { deps, calls } = fakeDeps({
      loadExistingRoot: async () => ({ name: 'Grupo Nutresa S.A.', website: 'https://gruponutresa.com', countryCode: 'CO' }),
    });
    const result = await runCorporateTreeSearch({ ...REQUEST, rootAccountId: '44444444-4444-4444-8444-444444444444' }, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(calls.imported.length, 2);
    assert.ok(calls.relationships.every((r) => r.root_account_id === '44444444-4444-4444-8444-444444444444'));
    assert.ok(!calls.relationships.some((r) => r.relation_type === 'root'));
  });

  it('sin asociaciones guardadas (migración 148 sin aplicar) la corrida sigue bien', async () => {
    const { deps } = fakeDeps({ insertRelationships: async () => false });
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok);
  });

  it('sin ramas encontradas no crea lote; sin modelo no busca; todas con error ⇒ search_failed', async () => {
    const empty = fakeDeps({ searchBranch: async (input) => outcomeFor(input.branch, []) });
    const r1 = await runCorporateTreeSearch(REQUEST, CONTEXT, empty.deps);
    assert.equal(r1.ok ? 'ok' : r1.code, 'nothing_found');
    assert.equal(empty.calls.imported.length, 0);

    const noModel = fakeDeps({ resolveActiveModel: async () => ({ error: 'x' }) });
    const r2 = await runCorporateTreeSearch(REQUEST, CONTEXT, noModel.deps);
    assert.equal(r2.ok ? 'ok' : r2.code, 'model_not_configured');
    assert.deepEqual(noModel.calls.stages, []);

    const failing = fakeDeps({ searchBranch: async (input) => outcomeFor(input.branch, [], { errorCode: 'rate_limited' }) });
    const r3 = await runCorporateTreeSearch(REQUEST, CONTEXT, failing.deps);
    assert.equal(r3.ok ? 'ok' : r3.code, 'search_failed');
  });

  it('el uso de IA queda con su flujo, rama y costo', () => {
    const log = buildCorporateTreeUsageLog(outcomeFor('group', [NODE('X', 'CO')]), { runId: 'run-9', triggeredBy: 'u', rootName: 'R' });
    assert.equal(log?.operation_key, 'corporate_tree_search');
    assert.equal(log?.usage_key, 'corporate_tree_search:run-9:group');
    assert.equal(log?.estimated_cost_usd, 0.1);
    assert.equal((log?.metadata as Record<string, unknown>).flow, 'corporate_tree_search');
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
    assert.deepEqual(calls.stages, ['tree_searching', 'tree_branch_1', 'tree_checking', 'tree_saving']);
    const percents = ['tree_searching', 'tree_branch_1', 'tree_branch_2', 'tree_checking', 'tree_saving'].map(
      (s) => RUN_PROGRESS_PERCENT[s as keyof typeof RUN_PROGRESS_PERCENT],
    );
    assert.deepEqual([...percents].sort((a, b) => a - b), percents, 'nunca retrocede');
    for (const s of ['tree_branch_1', 'tree_branch_2', 'tree_saving']) assert.ok(RUN_PROGRESS_STAGES.includes(s as never));
  });

  it('sin respuesta, espera a que el lote tenga el id de la corrida y ya no tenga etapa en curso', async () => {
    let t = 0;
    const answers = [
      [],
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
