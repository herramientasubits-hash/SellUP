/**
 * Tests — Agente 1 · búsqueda en árbol, FASE A + B (auditoría 21-10).
 *
 *  A. Las ramas pedidas valen también para lo gratis y para Apollo; banco por país; registros
 *     completos con más filas; Apollo dice la verdad sobre si se consultó; las asociaciones que
 *     no se guardan quedan dichas; «Claude no entregó» no es un árbol vacío; el árbol de un
 *     grupo se guarda 30 días y se reutiliza sin pagar.
 *  B. Las del grupo sin web propia pero con número fiscal y 200+ trabajadores entran a «Por
 *     revisar» con la web del grupo como referencia (Prod 14/15-10: 241 de 475 «sin web»).
 *
 * Sin red ni base: todo se inyecta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { AnthropicConversationResult } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import {
  CORPORATE_TREE_NO_SUBMISSION_ERROR,
  searchCorporateTreeBranch,
  type CorporateTreeNode,
  type CorporateTreeSearchOutcome,
} from '../corporate-tree-search';
import {
  applyApolloFamily,
  corporateTreeRowKey,
  planCorporateTreeWrites,
  promoteSizedCompaniesWithoutWebsite,
  type CorporateTreeApolloSubsidiary,
  type CorporateTreeRoot,
} from '../corporate-tree-plan';
import {
  CORPORATE_TREE_FREE_BANK_ROWS_PER_COUNTRY,
  CORPORATE_TREE_FREE_ROWS_PER_BROAD_REGISTRY,
  CORPORATE_TREE_FREE_ROWS_PER_SOURCE,
  bankRowsFor,
  findCorporateTreeFreeHits,
  findExactOfficialRecord,
  rowsPerSource,
  type CorporateTreeFreeHit,
  type FreeSnapshotRow,
} from '../corporate-tree-free-lookup';
import {
  APOLLO_QUOTA_EXHAUSTED,
  parseCorporateTreeRequest,
  runCorporateTreeSearch,
  type CorporateTreeBatchCandidate,
  type CorporateTreeRequest,
  type CorporateTreeRunDeps,
} from '../corporate-tree-run';
import {
  CORPORATE_TREE_SAVED_DAYS,
  corporateTreeRootKey,
  pickSavedTree,
  readSavedTree,
  serializeSavedTree,
} from '../corporate-tree-saved';
import { corporateTreePendingSummary } from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';

const MODEL = 'claude-haiku-4-5-20251001';
const CO = { code: 'CO', name: 'Colombia' };
const EC = { code: 'EC', name: 'Ecuador' };
const MX = { code: 'MX', name: 'México' };
const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const DAY = 86_400_000;

const ROOT: CorporateTreeRoot = {
  name: 'Bimbo',
  website: 'https://grupobimbo.com',
  domain: 'grupobimbo.com',
  countryCode: 'MX',
  candidateId: null,
  accountId: null,
};

function company(name: string, countryCode: string, extra: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: `${countryCode}:${name}`,
    legalName: name,
    normalizedLegalName: name.toLowerCase(),
    taxId: null,
    taxIdentifierType: 'RUC',
    countryCode,
    city: null,
    region: null,
    domain: null,
    declaredIndustry: null,
    industryCode: null,
    coarseSector: null,
    ...extra,
  };
}

function hit(
  name: string,
  countryCode: string,
  options: Partial<Omit<CorporateTreeFreeHit, 'company'>> & { company?: Partial<CountrySourceCompany> } = {},
): CorporateTreeFreeHit {
  const { company: companyExtra, ...extra } = options;
  const taxId = extra.taxId === undefined ? `${countryCode}-${name.length}` : extra.taxId;
  return {
    origin: 'catalog',
    relation: 'other_country',
    countryCode,
    name,
    core: name.toLowerCase(),
    confirmation: 'confirmed',
    taxId,
    domain: null,
    workers: null,
    sourceKey: 'ec_scvs_directory',
    company: company(name, countryCode, { taxId, domain: extra.domain ?? null, ...(companyExtra ?? {}) }),
    bankCandidate: null,
    ...extra,
  };
}

const node = (name: string, countryCode: string, extra: Partial<CorporateTreeNode> = {}): CorporateTreeNode => ({
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

const workforce = (workers: number) => ({ officialWorkforce: { workers, year: 2025, sourceLabel: 'ec_scvs_directory' } });

describe('A1. Las ramas pedidas valen también para lo gratis', () => {
  const freeHits = [
    hit('BIMBO SA DE CV', 'MX', { relation: 'root', domain: 'grupobimbo.com' }),
    hit('BIMBO ECUADOR', 'EC', { relation: 'other_country' }),
    hit('BIMBO FRONTERA', 'MX', { relation: 'subsidiary' }),
  ];

  it('sólo «grupo y matriz»: las filiales y los otros países de los registros no entran', () => {
    const plan = planCorporateTreeWrites({ root: ROOT, freeHits, nodes: [], branches: ['group'] });
    assert.deepEqual(plan.rows.map((r) => r.relation), ['root']);
    assert.equal(plan.droppedByBranch, 2);
  });

  it('si Claude la confirma en una rama pedida, entra con esa rama', () => {
    const plan = planCorporateTreeWrites({
      root: ROOT,
      freeHits,
      nodes: [node('BIMBO FRONTERA', 'MX', { branch: 'group' })],
      branches: ['group'],
    });
    const byName = new Map(plan.rows.map((r) => [r.name, r]));
    assert.equal(byName.get('BIMBO FRONTERA')?.relation, 'group');
    assert.equal(byName.has('BIMBO ECUADOR'), false);
  });

  it('sin `branches` (llamadores viejos) entra todo como antes', () => {
    const plan = planCorporateTreeWrites({ root: ROOT, freeHits, nodes: [] });
    assert.equal(plan.rows.length, 3);
    assert.equal(plan.droppedByBranch, 0);
  });

  it('Apollo sin la rama «filiales» sólo completa webs: no agrega empresas', () => {
    const plan = planCorporateTreeWrites({ root: ROOT, freeHits: [], nodes: [node('Bimbo Ecuador', 'EC', { branch: 'other_country' })] });
    const subs: CorporateTreeApolloSubsidiary[] = [
      { name: 'Bimbo Ecuador', domain: 'bimbo.com.ec', website: null, linkedinUrl: null, countryCode: 'EC', employeeCount: 1000 },
      { name: 'Barcel Ecuador', domain: 'barcel.com.ec', website: null, linkedinUrl: null, countryCode: 'EC', employeeCount: 900 },
    ];
    const without = applyApolloFamily({ plan, root: ROOT, subsidiaries: subs, countryCodes: ['EC'], addNew: false });
    assert.equal(without.matched, 1);
    assert.equal(without.added, 0);
    const withNew = applyApolloFamily({ plan, root: ROOT, subsidiaries: subs, countryCodes: ['EC'] });
    assert.equal(withNew.added, 1);
  });
});

describe('A2. Lo gratis lee más: banco por país y registros completos con más filas', () => {
  it('los registros completos piden 40 filas; los directorios 12; el banco 6 por país (tope 120)', () => {
    assert.equal(rowsPerSource('cl_sii_registry'), CORPORATE_TREE_FREE_ROWS_PER_BROAD_REGISTRY);
    assert.equal(rowsPerSource('cl_sii_directory'), CORPORATE_TREE_FREE_ROWS_PER_SOURCE);
    assert.equal(bankRowsFor(20), 120);
    assert.equal(bankRowsFor(3), 3 * CORPORATE_TREE_FREE_BANK_ROWS_PER_COUNTRY);
  });

  it('la corrida pide esos límites (antes 12 en total para el banco de los 20 países)', async () => {
    const limits = new Map<string, number>();
    await findCorporateTreeFreeHits(
      { rootName: 'Bimbo', rootCountryCode: 'MX', countryCodes: ['CL', 'PE', 'EC'] },
      {
        querySnapshotsByPrefix: async (sourceKey, _prefix, max) => {
          limits.set(sourceKey, max);
          return [];
        },
        queryBankByNamePrefix: async (_countries, _prefix, max) => {
          limits.set('bank', max);
          return [];
        },
        readBankCandidate: () => null,
      },
    );
    assert.equal(limits.get('cl_sii_registry'), 40);
    assert.equal(limits.get('cl_sii_directory'), 12);
    assert.equal(limits.get('bank'), 18);
  });
});

describe('B1. El registro oficial de una empresa por su nombre exacto (gratis)', () => {
  const SNAP = (sourceKey: string, legalName: string, taxId: string, raw: Record<string, unknown> = {}): FreeSnapshotRow => ({
    source_key: sourceKey,
    country_code: 'EC',
    legal_name: legalName,
    normalized_legal_name: legalName.toLowerCase(),
    tax_id: taxId,
    normalized_tax_id: taxId,
    city: null,
    region: null,
    record_identity_key: `${sourceKey}:${taxId}`,
    raw_data: raw,
  });

  it('«Bimbo Ecuador» encuentra «BIMBO ECUADOR S.A.» con su RUC y sus trabajadores', async () => {
    const asked: string[] = [];
    const record = await findExactOfficialRecord(
      { name: 'Bimbo Ecuador', countryCode: 'EC' },
      {
        querySnapshotsByPrefix: async (sourceKey, prefix) => {
          asked.push(`${sourceKey}:${prefix}`);
          if (sourceKey === 'ec_scvs_directory') return [SNAP(sourceKey, 'BIMBO ECUADOR S.A.', '1790012345001', { workers: 1154 })];
          if (sourceKey === 'ec_sri_registry') return [SNAP(sourceKey, 'BIMBO ECUADOR S.A.', '1790012345001'), SNAP(sourceKey, 'BIMBOLANDIA CIA LTDA', '99')];
          return [];
        },
      },
    );
    assert.equal(record?.taxId, '1790012345001');
    assert.equal(record?.officialWorkforce?.workers, 1154, 'gana la fila con tamaño');
    assert.ok(asked.includes('ec_scvs_directory:bimbo ecuador'));
    assert.ok(asked.includes('ec_scvs_directory:bimbo'), 'también el núcleo sin el país');
  });

  it('dos razones sociales con el mismo nombre y distinto RUC: no elige ninguna', async () => {
    const record = await findExactOfficialRecord(
      { name: 'Bimbo', countryCode: 'EC' },
      {
        querySnapshotsByPrefix: async (sourceKey) =>
          sourceKey === 'ec_sri_registry' ? [SNAP(sourceKey, 'BIMBO S.A.', '1'), SNAP(sourceKey, 'BIMBO CIA LTDA', '2')] : [],
      },
    );
    assert.equal(record, null);
  });

  it('un nombre corto o genérico no recibe número fiscal por nombre', async () => {
    const ask = async () => [SNAP('ec_sri_registry', 'ALFA S.A.', '5', { workers: 900 })];
    assert.equal(await findExactOfficialRecord({ name: 'Alfa Ecuador', countryCode: 'EC' }, { querySnapshotsByPrefix: ask }), null);
  });

  it('un nombre que sólo empieza igual no es la empresa', async () => {
    const record = await findExactOfficialRecord(
      { name: 'Bimbo Ecuador', countryCode: 'EC' },
      { querySnapshotsByPrefix: async (sourceKey) => [SNAP(sourceKey, 'BIMBO ECUADOR DISTRIBUCIONES S.A.', '7')] },
    );
    assert.equal(record, null);
  });
});

describe('B2. Sin web propia, con número fiscal y 200+ trabajadores ⇒ «Por revisar»', () => {
  it('Bimbo Ecuador (1.154) entra por la capa gratuita sin web y con la web del grupo como referencia', () => {
    const plan = planCorporateTreeWrites({
      root: ROOT,
      freeHits: [
        hit('BIMBO ECUADOR S.A.', 'EC', { company: workforce(1154) }),
        hit('BIMBO PEQUEÑA S.A.', 'EC', { company: workforce(40) }),
        hit('BIMBO SIN RUC', 'EC', { taxId: null, company: workforce(5000) }),
      ],
      nodes: [],
    });
    const { plan: next, promoted } = promoteSizedCompaniesWithoutWebsite(plan, { groupWebsite: ROOT.website });
    assert.equal(promoted, 1);
    const ecuador = next.rows.find((r) => r.name === 'BIMBO ECUADOR S.A.');
    assert.equal(ecuador?.route, 'free_catalog');
    assert.equal(ecuador?.domain, null);
    assert.equal(ecuador?.groupWebsite, 'https://grupobimbo.com');
    assert.deepEqual(next.freeCatalog.get('EC')?.map((c) => [c.legalName, c.domain]), [['BIMBO ECUADOR S.A.', null]]);
    assert.deepEqual(next.withoutWebsite.get('EC')?.map((c) => c.legalName).sort(), ['BIMBO PEQUEÑA S.A.', 'BIMBO SIN RUC']);
  });

  it('la que trajo Claude sin número toma el del registro oficial (y su tamaño)', () => {
    const plan = planCorporateTreeWrites({ root: ROOT, freeHits: [], nodes: [node('Bimbo Ecuador', 'EC', { branch: 'other_country' })] });
    const key = corporateTreeRowKey('Bimbo Ecuador', 'EC');
    const records = new Map([[key, company('BIMBO ECUADOR S.A.', 'EC', { taxId: '1790012345001', ...workforce(1154) })]]);
    const { plan: next, promoted } = promoteSizedCompaniesWithoutWebsite(plan, { groupWebsite: ROOT.website, officialRecords: records });
    assert.equal(promoted, 1);
    const row = next.rows.find((r) => r.key === key);
    assert.equal(row?.taxId, '1790012345001');
    assert.equal(next.freeCatalog.get('EC')?.[0].legalName, 'Bimbo Ecuador', 'conserva el nombre de la fila (así se reencuentra en el lote)');
    assert.match(row?.relationDetail ?? '', /número fiscal del registro oficial por nombre exacto/);
    assert.equal(next.withoutWebsite.has('EC'), false);
  });

  it('la empresa de partida sin web no se refiere a sí misma', () => {
    const root = { ...ROOT, website: null, domain: null };
    const plan = planCorporateTreeWrites({
      root,
      freeHits: [hit('BIMBO', 'MX', { relation: 'root', company: workforce(9000) })],
      nodes: [],
    });
    const { plan: next } = promoteSizedCompaniesWithoutWebsite(plan, { groupWebsite: null });
    const rootRow = next.rows.find((r) => r.relation === 'root');
    assert.equal(rootRow?.route, 'free_catalog');
    assert.equal(rootRow?.groupWebsite, null);
  });
});

describe('A3. El árbol guardado: lo que se lee de la base se valida', () => {
  const tree = (extra: Record<string, unknown> = {}, savedExtra: Record<string, unknown> = {}) => ({
    corporate_tree: {
      branches: ['group', 'subsidiary', 'other_country'],
      country_codes: ['MX', 'EC', 'CO'],
      searched_at: new Date(NOW - 3 * DAY).toISOString(),
      claude: { errors: [] },
      saved: {
        ...serializeSavedTree({
          root: { website: 'https://grupobimbo.com', domain: 'grupobimbo.com', countryCode: 'MX' },
          nodes: [
            node('Bimbo Ecuador', 'EC', { branch: 'other_country' }),
            node('Barcel', 'MX', { website: 'https://barcel.com.mx', domain: 'barcel.com.mx' }),
          ],
          apolloSubsidiaries: [{ name: 'Bimbo Bakeries USA', domain: 'bimbobakeriesusa.com', website: null, linkedinUrl: null, countryCode: 'US', employeeCount: 20000 }],
        }),
        ...savedExtra,
      },
      ...extra,
    },
  });
  const rowOf = (metadata: unknown, batchId = 'b-old') => ({ batchId, createdAt: new Date(NOW - 3 * DAY).toISOString(), metadata });
  const wanted = { branches: ['other_country', 'subsidiary'] as const, countryCodes: ['EC', 'MX'], rootCountryCode: 'MX', nowMs: NOW };

  it('ida y vuelta: las empresas, la web de partida y las filiales de Apollo', () => {
    const saved = readSavedTree(rowOf(tree()));
    assert.equal(saved?.nodes.length, 2);
    assert.equal(saved?.nodes[1].domain, 'barcel.com.mx');
    assert.equal(saved?.root.domain, 'grupobimbo.com');
    assert.equal(saved?.apolloSubsidiaries?.[0].employeeCount, 20000);
  });

  it('elige el que cubre lo pedido y recorta sus empresas a lo pedido', () => {
    const picked = pickSavedTree([rowOf(tree())], { ...wanted, branches: ['other_country'], countryCodes: ['EC'] });
    assert.deepEqual(picked?.nodes.map((n) => n.name), ['Bimbo Ecuador']);
  });

  it('no sirve: viejo, sin una rama o país pedido, de otro país de partida, con errores o reutilizado', () => {
    const old = tree({ searched_at: new Date(NOW - (CORPORATE_TREE_SAVED_DAYS + 1) * DAY).toISOString() });
    assert.equal(pickSavedTree([rowOf(old)], { ...wanted, branches: [...wanted.branches] }), null);
    assert.equal(pickSavedTree([rowOf(tree({ branches: ['group'] }))], { ...wanted, branches: [...wanted.branches] }), null);
    assert.equal(pickSavedTree([rowOf(tree())], { ...wanted, branches: [...wanted.branches], countryCodes: ['EC', 'PE'] }), null);
    assert.equal(pickSavedTree([rowOf(tree())], { ...wanted, branches: [...wanted.branches], rootCountryCode: 'AR' }), null);
    assert.equal(readSavedTree(rowOf(tree({ claude: { errors: [{ branch: 'group', code: 'rate_limited' }] } }))), null);
    assert.equal(readSavedTree(rowOf(tree({ claude: { errors: [], reused_from: 'b-x' } }))), null);
  });

  it('datos rotos o hostiles no pasan: web sin http, país inválido, rama desconocida', () => {
    const saved = readSavedTree(
      rowOf(
        tree({}, {
          nodes: [
            { branch: 'subsidiary', name: 'Buena', country_code: 'EC', website: 'https://buena.ec', domain: 'buena.ec', evidence_url: 'x' },
            { branch: 'subsidiary', name: 'Script', country_code: 'EC', website: 'javascript:alert(1)' },
            { branch: 'hack', name: 'Rama', country_code: 'EC' },
            { branch: 'group', name: 'País', country_code: 'ECU' },
          ],
        }),
      ),
    );
    assert.deepEqual(saved?.nodes.map((n) => [n.name, n.website]), [['Buena', 'https://buena.ec'], ['Script', null]]);
  });

  it('un homónimo no hereda el árbol: otra web, o sin país con qué comparar, no se reutiliza', () => {
    const base = { ...wanted, branches: [...wanted.branches] };
    assert.ok(pickSavedTree([rowOf(tree())], { ...base, rootDomain: 'grupobimbo.com' }), 'misma web: sí');
    assert.equal(pickSavedTree([rowOf(tree())], { ...base, rootDomain: 'bimbo-otro.com' }), null, 'otra web: no');
    assert.equal(pickSavedTree([rowOf(tree())], { ...base, rootCountryCode: null }), null, 'sin país ni web: no');
    const noCountry = tree({}, { root: { website: null, domain: null, country_code: null } });
    assert.equal(pickSavedTree([rowOf(noCountry)], base), null, 'el guardado sin país ni web: no');
  });

  it('enlaces guardados: sólo http(s); el dominio sale siempre de la web', () => {
    const saved = readSavedTree(
      rowOf(
        tree({}, {
          nodes: [
            {
              branch: 'subsidiary',
              name: 'Engaño',
              country_code: 'EC',
              website: 'https://engano.ec',
              domain: 'otra-empresa.com',
              evidence_url: 'javascript:alert(1)',
              linkedin_url: 'data:text/html,x',
            },
          ],
        }),
      ),
    );
    assert.equal(saved?.nodes[0].domain, 'engano.ec');
    assert.equal(saved?.nodes[0].evidenceUrl, '');
    assert.equal(saved?.nodes[0].linkedinUrl, null);
  });

  it('la clave del grupo no depende de la forma societaria ni de mayúsculas', () => {
    assert.equal(corporateTreeRootKey('Bimbo S.A.'), corporateTreeRootKey('BIMBO'));
  });
});

// ─── La corrida completa ────────────────────────────────────────────────────────────────

function outcomeFor(branch: CorporateTreeSearchOutcome['branch'], nodes: CorporateTreeNode[], extra: Partial<CorporateTreeSearchOutcome> = {}): CorporateTreeSearchOutcome {
  return {
    branch,
    nodes,
    root: { website: 'https://grupobimbo.com', domain: 'grupobimbo.com', countryCode: 'MX' },
    proposed: nodes.length,
    rejected: {},
    websitesDropped: 0,
    usage: { model: MODEL, inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1, webFetchRequests: 0, estimatedCostUsd: 0.2, pricingSource: 'table' } as CorporateTreeSearchOutcome['usage'],
    errorCode: null,
    ...extra,
  };
}

const REQUEST: CorporateTreeRequest = {
  clientRequestId: '55555555-5555-4555-8555-555555555555',
  rootName: 'Bimbo',
  rootWebsite: 'https://grupobimbo.com',
  rootCountryCode: 'MX',
  rootCandidateId: null,
  rootAccountId: null,
  branches: ['subsidiary', 'other_country'],
  countries: [MX, EC, CO],
};
const CONTEXT = { internalUserId: 'user-1', keyOf: corporateTreeRowKey, writeDeadlineAtMs: NOW + 1_000_000 };

function fakeDeps(overrides: Partial<CorporateTreeRunDeps> = {}) {
  const calls = {
    searched: [] as string[],
    apollo: 0,
    freeCatalog: [] as Array<{ country: string; names: string[]; domains: Array<string | null> }>,
    withoutWebsite: [] as Array<{ country: string; names: string[] }>,
    tagged: new Map<string, Record<string, unknown>>(),
    sealed: [] as Array<Record<string, unknown>>,
    official: [] as string[],
  };
  const batchCandidates: CorporateTreeBatchCandidate[] = [
    { id: 'c-ec', name: 'Bimbo Ecuador', country_code: 'EC', domain: null, status: 'needs_review', matched_hubspot_company_id: null, metadata: {} },
  ];
  const deps: CorporateTreeRunDeps = {
    loadExistingRoot: async () => null,
    reserveBatch: async () => ({ status: 'reserved', batchId: 'batch-new' }),
    findFreeHits: async () => ({ hits: [], rootCountryCode: 'MX', queries: 1, errors: 0 }),
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    searchBranch: async (input) => {
      calls.searched.push(input.branch);
      return input.branch === 'other_country'
        ? outcomeFor('other_country', [node('Bimbo Ecuador', 'EC', { branch: 'other_country' })])
        : outcomeFor('subsidiary', [node('Barcel', 'MX', { website: 'https://barcel.com.mx', domain: 'barcel.com.mx' })]);
    },
    logBranchUsage: async () => undefined,
    writeFreeCatalog: async (_batch, country, companies) => {
      calls.freeCatalog.push({ country: country.code, names: companies.map((c) => c.legalName ?? ''), domains: companies.map((c) => c.domain) });
      return { written: companies.length, failed: false };
    },
    writeWeb: async (_batch, _country, items) => ({ written: items.length, errors: [] }),
    recordWithoutWebsite: async (_batch, countryCode, companies) => {
      calls.withoutWebsite.push({ country: countryCode, names: companies.map((c) => c.legalName ?? '') });
      return companies.length;
    },
    findOfficialRecord: async ({ name, countryCode }) => {
      calls.official.push(`${name}|${countryCode}`);
      return name === 'Bimbo Ecuador' ? company('BIMBO ECUADOR S.A.', 'EC', { taxId: '1790012345001', ...workforce(1154) }) : null;
    },
    findApolloFamily: async () => {
      calls.apollo++;
      return [];
    },
    loadBatchCandidates: async () => batchCandidates,
    tagCandidate: async (id, metadata) => {
      calls.tagged.set(id, metadata);
    },
    insertRelationships: async () => true,
    sealBatch: async (_batch, input) => {
      calls.sealed.push(input.metadata);
    },
    scheduleRescue: () => undefined,
    clearBatchIndustryLabel: async () => undefined,
    nowMs: () => NOW,
    report: () => undefined,
    newRunId: () => 'run-ab',
    nowIso: () => new Date(NOW).toISOString(),
    ...overrides,
  };
  return { deps, calls };
}

const treeOf = (calls: ReturnType<typeof fakeDeps>['calls']) => calls.sealed[0].corporate_tree as Record<string, unknown>;

describe('B3. La corrida: Bimbo Ecuador sin web entra a «Por revisar» por su RUC', () => {
  it('busca su registro oficial, entra por la capa gratuita sin web y queda con la web del grupo', async () => {
    const { deps, calls } = fakeDeps();
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok);
    assert.ok(calls.official.includes('Bimbo Ecuador|EC'));
    assert.deepEqual(calls.freeCatalog, [{ country: 'EC', names: ['Bimbo Ecuador'], domains: [null] }]);
    assert.deepEqual(calls.withoutWebsite, [], 'ya no va a «Descartadas» ni al rescate pagado');
    const tag = calls.tagged.get('c-ec')?.corporate_tree as Record<string, unknown>;
    assert.equal(tag.group_website, 'https://grupobimbo.com');
    const tree = treeOf(calls);
    assert.equal(tree.sized_without_website, 1);
    assert.deepEqual(tree.official_records, { looked: 1, found: 1 });
  });
});

describe('A4. La corrida: el árbol guardado se reutiliza sin pagar', () => {
  it('una búsqueda nueva guarda lo que encontró (con la web de partida y las filiales de Apollo)', async () => {
    const { deps, calls } = fakeDeps({
      findApolloFamily: async () => [{ name: 'Barcel USA', domain: 'barcelusa.com', website: null, linkedinUrl: null, countryCode: 'US', employeeCount: 500 }],
    });
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    const tree = treeOf(calls);
    assert.equal(tree.root_key, 'bimbo');
    const saved = readSavedTree({ batchId: 'batch-new', createdAt: new Date(NOW).toISOString(), metadata: { corporate_tree: tree } });
    assert.deepEqual(saved?.nodes.map((n) => n.name).sort(), ['Barcel', 'Bimbo Ecuador']);
    assert.equal(saved?.apolloSubsidiaries?.[0].name, 'Barcel USA');
    assert.equal(saved?.root.domain, 'grupobimbo.com');
  });

  it('con un árbol guardado que cubre lo pedido: ni Claude ni Apollo, y lo dice', async () => {
    const first = fakeDeps({
      findApolloFamily: async () => [{ name: 'Barcel USA', domain: 'barcelusa.com', website: null, linkedinUrl: null, countryCode: 'US', employeeCount: 500 }],
    });
    await runCorporateTreeSearch({ ...REQUEST, branches: ['group', 'subsidiary', 'other_country'] }, CONTEXT, first.deps);
    const stored = { batchId: 'batch-old', createdAt: new Date(NOW - DAY).toISOString(), metadata: { corporate_tree: treeOf(first.calls) } };

    const asked: string[] = [];
    const { deps, calls } = fakeDeps({
      findSavedTrees: async (rootKey) => {
        asked.push(rootKey);
        return [stored];
      },
    });
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(result.reusedSavedTree, true);
    assert.equal(result.estimatedCostUsd, 0);
    assert.deepEqual(asked, ['bimbo']);
    assert.deepEqual(calls.searched, [], 'Claude no se paga');
    assert.equal(calls.apollo, 0, 'Apollo tampoco: sus filiales venían guardadas');
    const tree = treeOf(calls);
    const claude = tree.claude as Record<string, unknown>;
    assert.equal(claude.skipped, 'saved_tree');
    assert.equal(claude.reused_from, 'batch-old');
    assert.equal((tree.apollo as Record<string, unknown>).skipped, 'saved_tree');
    assert.equal(tree.saved, undefined, 'lo reutilizado no se vuelve a guardar');
    assert.deepEqual(calls.freeCatalog.map((c) => c.country), ['EC'], 'y todo pasa igual por las compuertas');
  });

  it('`refresh` busca de nuevo aunque haya árbol guardado', async () => {
    const { deps, calls } = fakeDeps({
      findSavedTrees: async () => {
        throw new Error('no debería leerse');
      },
    });
    await runCorporateTreeSearch({ ...REQUEST, refresh: true }, CONTEXT, deps);
    assert.deepEqual(calls.searched.sort(), ['other_country', 'subsidiary']);
  });

  it('si la lectura del guardado falla, se busca como siempre', async () => {
    const { deps, calls } = fakeDeps({
      findSavedTrees: async () => {
        throw new Error('db down');
      },
    });
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(calls.searched.length, 2);
  });

  it('el navegador puede pedir `refresh`; cualquier otra cosa es `false`', () => {
    const base = { clientRequestId: REQUEST.clientRequestId, rootName: 'Bimbo', branches: ['group'], countryCodes: ['MX'] };
    const on = parseCorporateTreeRequest({ ...base, refresh: true });
    const off = parseCorporateTreeRequest({ ...base, refresh: 'true' });
    assert.ok(on.ok && on.request.refresh === true);
    assert.ok(off.ok && off.request.refresh === false);
  });

  it('el aviso al vendedor dice que la búsqueda no tuvo costo', () => {
    assert.match(
      corporateTreePendingSummary({ waitingWebsite: 0, groupReferences: 0, reusedSavedTree: true }),
      /árbol guardado de este grupo: la búsqueda no tuvo costo/,
    );
  });
});

describe('A5. Lo que no salió bien queda dicho en el lote', () => {
  it('Apollo sin cuota: no se consultó (antes decía «consultado»)', async () => {
    const { deps, calls } = fakeDeps({ findApolloFamily: async () => APOLLO_QUOTA_EXHAUSTED });
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    const apollo = treeOf(calls).apollo as Record<string, unknown>;
    assert.equal(apollo.asked, false);
    assert.equal(apollo.skipped, 'quota_exhausted');
  });

  it('Apollo revienta: consultado y fallido', async () => {
    const { deps, calls } = fakeDeps({
      findApolloFamily: async () => {
        throw new Error('apollo down');
      },
    });
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    const apollo = treeOf(calls).apollo as Record<string, unknown>;
    assert.equal(apollo.asked, true);
    assert.equal(apollo.failed, true);
  });

  it('las asociaciones que no se guardaron quedan dichas', async () => {
    const { deps, calls } = fakeDeps({ insertRelationships: async () => false });
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.equal(treeOf(calls).relationships_saved, false);
  });

  it('una corrida con error de Claude no se guarda para reutilizarla', async () => {
    const { deps, calls } = fakeDeps({
      searchBranch: async (input) => outcomeFor(input.branch, [], { errorCode: 'rate_limited' }),
    });
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.equal(treeOf(calls).saved, undefined);
  });

  it('Claude no entregó ni después de pedírselo: error, no «el grupo no tiene empresas»', async () => {
    const silent: AnthropicConversationResult = {
      content: [{ type: 'text', text: 'Busqué y…' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 1, webFetchRequests: 0 },
      requests: 1,
    };
    const outcome = await searchCorporateTreeBranch(
      { branch: 'group', rootName: 'Bimbo', rootWebsite: null, rootCountry: MX, countries: [MX], maxCompanies: 8 },
      MODEL,
      { runConversation: async () => silent },
    );
    assert.equal(outcome.errorCode, CORPORATE_TREE_NO_SUBMISSION_ERROR);
    assert.ok(outcome.usage, 'lo pagado igual queda en Uso de IA');
    assert.equal(outcome.nodes.length, 0);
  });
});
