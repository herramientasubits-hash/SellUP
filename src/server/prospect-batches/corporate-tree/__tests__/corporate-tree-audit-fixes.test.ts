/**
 * Tests — Agente 1 · búsqueda en árbol: hallazgos de la auditoría (16-10).
 *
 *  9. Sin país de partida, varios homónimos exactos no se escriben como la propia empresa.
 *  10. Una escritura (o lectura) que no termina no impide sellar el lote.
 *  A. Una referencia con la web del grupo no se une a la empresa de partida por dominio.
 *  B. La misma empresa traída por dos ramas no vuelve «compartida» su web.
 *  C. Lo que sólo se parece al quitar «Grupo…» no entra sin confirmar.
 *  L. La ficha de Apollo tiene tope de espera y, sin respuesta, el cobro es desconocido.
 *
 * Sin red ni base: todo se inyecta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CorporateTreeNode, CorporateTreeSearchOutcome } from '../corporate-tree-search';
import {
  corporateTreeRowKey,
  mergeRootFindings,
  planCorporateTreeWrites,
  type CorporateTreePlannedRow,
  type CorporateTreeRoot,
} from '../corporate-tree-plan';
import {
  findCorporateTreeFreeHits,
  freeHitConfirmation,
  withoutAmbiguousRoots,
  type CorporateTreeFreeHit,
  type FreeSnapshotRow,
} from '../corporate-tree-free-lookup';
import {
  CORPORATE_TREE_SEAL_START_GRACE_MS,
  CORPORATE_TREE_WRITE_GRACE_MS,
  matchPlannedRows,
  runCorporateTreeSearch,
  settleBy,
  type CorporateTreeBatchCandidate,
  type CorporateTreeRelationshipRow,
  type CorporateTreeRequest,
  type CorporateTreeRunDeps,
} from '../corporate-tree-run';
import {
  callApolloWithinTimeout,
  corporateTreeApolloFamilyBilling,
} from '../corporate-tree-run.server';
import { groupBatchCandidatesByTreeRelation } from '@/modules/prospect-batches/corporate-tree/corporate-tree-batch-groups';
import { readCorporateTreeRelation } from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { readUsageBillingState } from '@/modules/usage-tracking/credits-display';

const CO = { code: 'CO', name: 'Colombia' };
const PE = { code: 'PE', name: 'Perú' };

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

const NO_BANK = { queryBankByNamePrefix: async () => [], readBankCandidate: () => null };

describe('9. Sin país de partida, varios homónimos exactos no son la empresa de partida', () => {
  it('lo gratis: «BIMBO SA» en AR y MX sin trabajadores quedan como «otro país» y por confirmar', async () => {
    const result = await findCorporateTreeFreeHits(
      { rootName: 'Bimbo', rootCountryCode: null, countryCodes: ['AR', 'MX'] },
      {
        querySnapshotsByPrefix: async (sourceKey) => {
          if (sourceKey === 'ar_rns_registry') return [SNAP('ar_rns_registry', 'AR', 'BIMBO SA')];
          if (sourceKey === 'mx_compranet_rfc_registry') return [SNAP('mx_compranet_rfc_registry', 'MX', 'BIMBO SA')];
          return [];
        },
        ...NO_BANK,
      },
    );
    assert.equal(result.rootCountryCode, null);
    assert.equal(result.hits.length, 2);
    assert.ok(result.hits.every((h) => h.relation === 'other_country'), 'ninguna es la empresa de partida');
    assert.ok(result.hits.every((h) => h.confirmation === 'needs_claude'));
  });

  it('una sola candidata sin país sigue siendo la empresa de partida (sin cambio)', () => {
    const hits = [FREE_HIT('Bimbo SA', 'MX', { relation: 'root' }), FREE_HIT('Bimbo Peru', 'PE')];
    assert.deepEqual(withoutAmbiguousRoots(hits, null), hits);
    assert.deepEqual(withoutAmbiguousRoots([...hits, FREE_HIT('Bimbo SA', 'AR', { relation: 'root' })], 'MX').length, 3);
  });

  it('el plan: sin país y sin Claude, ninguno de los homónimos se escribe; la web no se toma de ninguno', () => {
    const root: CorporateTreeRoot = { name: 'Bimbo', website: null, domain: null, countryCode: null, candidateId: null, accountId: null };
    const freeHits = [
      FREE_HIT('Bimbo SA', 'AR', { relation: 'root', domain: 'bimbo.com.ar' }),
      FREE_HIT('Bimbo SA', 'MX', { relation: 'root', domain: 'bimbo.com.mx' }),
    ];
    const plan = planCorporateTreeWrites({ root, freeHits, nodes: [] });
    assert.equal(plan.rows.length, 0, 'nada se escribe como la propia empresa sin confirmar');
    assert.equal(plan.unconfirmedDropped, 2);
    assert.equal(mergeRootFindings(root, [], freeHits).domain, null, 'con dos candidatas no se adivina la web');

    const confirmed = planCorporateTreeWrites({ root, freeHits, nodes: [NODE('Bimbo SA', 'MX', { branch: 'group' })] });
    assert.deepEqual(confirmed.rows.map((r) => r.countryCode), ['MX'], 'la que Claude confirma sí entra');
    assert.notEqual(confirmed.rows[0].relation, 'root');
  });

  it('una sola candidata sin país: su web y su fila de empresa de partida se conservan', () => {
    const root: CorporateTreeRoot = { name: 'Bimbo', website: null, domain: null, countryCode: null, candidateId: null, accountId: null };
    const freeHits = [FREE_HIT('Bimbo SA', 'MX', { relation: 'root', domain: 'bimbo.com.mx' })];
    assert.equal(mergeRootFindings(root, [], freeHits).domain, 'bimbo.com.mx');
    const plan = planCorporateTreeWrites({ root, freeHits, nodes: [] });
    assert.equal(plan.rows[0]?.relation, 'root');
  });
});

describe('C. Lo que sólo se parece al quitar «Grupo…» necesita confirmación', () => {
  it('«Grupo Familia»: «FAMILIA S.A.S.» exacto en su país no entra solo; «GRUPO FAMILIA S.A.» sí', async () => {
    const result = await findCorporateTreeFreeHits(
      { rootName: 'Grupo Familia', rootCountryCode: 'CO', countryCodes: ['CO'] },
      {
        querySnapshotsByPrefix: async (sourceKey, prefix) => {
          if (sourceKey !== 'co_siis') return [];
          return prefix === 'familia'
            ? [SNAP('co_siis', 'CO', 'FAMILIA S.A.S.', { workers: 900 })]
            : [SNAP('co_siis', 'CO', 'GRUPO FAMILIA S.A.', { workers: 5000 })];
        },
        ...NO_BANK,
      },
    );
    const byName = new Map(result.hits.map((h) => [h.name, h]));
    assert.equal(byName.get('FAMILIA S.A.S.')?.confirmation, 'needs_claude');
    assert.equal(byName.get('GRUPO FAMILIA S.A.')?.confirmation, 'confirmed');
    assert.equal(byName.get('GRUPO FAMILIA S.A.')?.relation, 'root');
  });

  it('la regla: sin la palabra genérica nunca se confirma sola', () => {
    const base = { countryCode: 'CO', rootCountryCode: 'CO', origin: 'catalog' as const, strongSource: true };
    assert.equal(freeHitConfirmation({ ...base, kinship: 'exact' }), 'confirmed');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'exact', strippedLeadingWord: true }), 'needs_claude');
    assert.equal(freeHitConfirmation({ ...base, kinship: 'family', strippedLeadingWord: true }), 'needs_claude');
  });

  it('en el plan: sin Claude no entra; con la MISMA web de la empresa de partida (otra evidencia) sí', () => {
    const root: CorporateTreeRoot = { name: 'Grupo Familia', website: 'https://grupofamilia.com.co', domain: 'grupofamilia.com.co', countryCode: 'CO', candidateId: null, accountId: null };
    const lone = planCorporateTreeWrites({ root, freeHits: [FREE_HIT('FAMILIA S.A.S.', 'CO', { relation: 'subsidiary', confirmation: 'needs_claude', domain: 'familia.com' })], nodes: [] });
    assert.equal(lone.rows.some((r) => r.name === 'FAMILIA S.A.S.'), false);
    assert.equal(lone.unconfirmedDropped, 1);
    const sameSite = planCorporateTreeWrites({
      root,
      freeHits: [FREE_HIT('FAMILIA S.A.S.', 'CO', { relation: 'subsidiary', confirmation: 'needs_claude', domain: 'grupofamilia.com.co' })],
      nodes: [],
    });
    assert.equal(sameSite.rows.find((r) => r.name === 'FAMILIA S.A.S.')?.relation, 'root');
  });
});

describe('B. Web compartida = dos EMPRESAS distintas, no dos respuestas', () => {
  const ROOT: CorporateTreeRoot = { name: 'Nestlé', website: 'https://nestle.com', domain: 'nestle.com', countryCode: 'CH', candidateId: '11111111-1111-4111-8111-111111111111', accountId: null };

  it('«Nestlé Chile» traída por dos ramas conserva su web y va al escritor', () => {
    const plan = planCorporateTreeWrites({
      root: ROOT,
      freeHits: [],
      nodes: [
        NODE('Nestlé Chile', 'CL', { website: 'https://nestle.cl', domain: 'nestle.cl' }),
        NODE('Nestlé Chile S.A.', 'CL', { branch: 'other_country', website: 'https://nestle.cl', domain: 'nestle.cl' }),
      ],
    });
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].route, 'agent1_writer');
    assert.equal(plan.rows[0].domain, 'nestle.cl');
    assert.equal(plan.sharedWebsites, 0);
  });

  it('dos empresas distintas con la misma web siguen siendo referencia del grupo', () => {
    const plan = planCorporateTreeWrites({
      root: ROOT,
      freeHits: [],
      nodes: [
        NODE('Nestlé Chile', 'CL', { website: 'https://nestle.cl', domain: 'nestle.cl' }),
        NODE('Savory Chile', 'CL', { website: 'https://nestle.cl', domain: 'nestle.cl' }),
      ],
    });
    assert.deepEqual(plan.rows.map((r) => r.route), ['group_reference', 'group_reference']);
  });
});

const row = (extra: Partial<CorporateTreePlannedRow> & Pick<CorporateTreePlannedRow, 'name' | 'route'>): CorporateTreePlannedRow => ({
  key: corporateTreeRowKey(extra.name, extra.countryCode ?? 'CO'),
  origin: 'claude',
  relation: 'subsidiary',
  countryCode: 'CO',
  domain: null,
  taxId: null,
  relationDetail: null,
  evidenceUrl: null,
  groupWebsite: null,
  ...extra,
});

const candidate = (id: string, name: string, domain: string | null, extra: Partial<CorporateTreeBatchCandidate> = {}): CorporateTreeBatchCandidate => ({
  id,
  name,
  country_code: 'CO',
  domain,
  status: 'needs_review',
  matched_hubspot_company_id: null,
  metadata: {},
  ...extra,
});

describe('A. La referencia con la web del grupo no se une a la empresa de partida', () => {
  it('por dominio sólo se unen filas con web propia; un candidato nunca a dos filas', () => {
    const rows = [
      row({ name: 'Grupo Nutresa', relation: 'root', route: 'agent1_writer', domain: 'gruponutresa.com' }),
      row({ name: 'Zenú', route: 'group_reference', domain: 'gruponutresa.com', groupWebsite: 'https://gruponutresa.com' }),
      row({ name: 'Colcafé', route: 'group_reference', domain: 'gruponutresa.com', groupWebsite: 'https://gruponutresa.com' }),
      row({ name: 'Noel', route: 'agent1_writer', domain: 'noel.com.co' }),
      row({ name: 'Noel Galletas', route: 'agent1_writer', domain: 'noel.com.co' }),
    ];
    const matched = matchPlannedRows(
      rows,
      [candidate('c-root', 'Inversiones Nutresa', 'gruponutresa.com'), candidate('c-noel', 'Compañía de Galletas Noel', 'noel.com.co')],
      corporateTreeRowKey,
    );
    assert.equal(matched.get(rows[0].key)?.id, 'c-root', 'la propia empresa sí, por su web');
    assert.equal(matched.has(rows[1].key), false, 'Zenú no se une a la empresa de partida');
    assert.equal(matched.has(rows[2].key), false);
    assert.equal(matched.get(rows[3].key)?.id, 'c-noel');
    assert.equal(matched.has(rows[4].key), false, 'el mismo candidato no se une a dos filas');
  });

  it('el nombre gana al dominio y no se repite el candidato', () => {
    const rows = [
      row({ name: 'Noel', route: 'agent1_writer', domain: 'noel.com.co' }),
      row({ name: 'Galletas Noel', route: 'agent1_writer', domain: 'noel.com.co' }),
    ];
    const matched = matchPlannedRows(rows, [candidate('c-1', 'Galletas Noel', 'noel.com.co')], corporateTreeRowKey);
    assert.equal(matched.get(rows[1].key)?.id, 'c-1', 'por nombre');
    assert.equal(matched.has(rows[0].key), false, 'no vuelve a tomar el mismo candidato por dominio');
  });
});

// ── Corrida completa con dobles ──────────────────────────────────────────────

const REQUEST: CorporateTreeRequest = {
  clientRequestId: '33333333-3333-4333-8333-333333333333',
  rootName: 'Grupo Nutresa',
  rootWebsite: 'https://gruponutresa.com',
  rootCountryCode: 'CO',
  rootCandidateId: null,
  rootAccountId: null,
  branches: ['subsidiary'],
  countries: [CO, PE],
};

function outcome(nodes: CorporateTreeNode[]): CorporateTreeSearchOutcome {
  return {
    branch: 'subsidiary',
    nodes,
    root: null,
    proposed: nodes.length,
    rejected: {},
    websitesDropped: 0,
    usage: null,
    errorCode: null,
  } as unknown as CorporateTreeSearchOutcome;
}

function fakeDeps(overrides: Partial<CorporateTreeRunDeps>, batchCandidates: CorporateTreeBatchCandidate[]) {
  const calls = {
    tagged: new Map<string, Record<string, unknown>>(),
    relationships: [] as CorporateTreeRelationshipRow[],
    sealed: [] as Array<{ persisted: number; failed: boolean; metadata: Record<string, unknown> }>,
  };
  const deps: CorporateTreeRunDeps = {
    loadExistingRoot: async () => null,
    reserveBatch: async () => ({ status: 'reserved', batchId: 'batch-1' }),
    findFreeHits: async () => ({ hits: [], rootCountryCode: 'CO', queries: 0, errors: 0 }),
    resolveActiveModel: async () => ({ model: 'm', apiKey: 'k' }),
    checkQuota: async () => ({ allowed: true }),
    searchBranch: async () =>
      outcome([
        NODE('Zenú', 'CO', { website: 'https://gruponutresa.com', domain: 'gruponutresa.com' }),
        NODE('Noel', 'CO', { website: 'https://noel.com.co', domain: 'noel.com.co' }),
      ]),
    logBranchUsage: async () => undefined,
    writeFreeCatalog: async (_b, _c, companies) => ({ written: companies.length, failed: false }),
    writeWeb: async (_b, _c, items) => ({ written: items.length, errors: [] }),
    recordWithoutWebsite: async (_b, _c, companies) => companies.length,
    loadBatchCandidates: async () => batchCandidates,
    tagCandidate: async (id, metadata) => {
      calls.tagged.set(id, metadata);
    },
    insertRelationships: async (rows) => {
      calls.relationships.push(...rows);
      return true;
    },
    sealBatch: async (_b, input) => {
      calls.sealed.push({ persisted: input.persisted, failed: input.failed, metadata: input.metadata });
    },
    scheduleRescue: () => undefined,
    clearBatchIndustryLabel: async () => undefined,
    nowMs: () => 1_000,
    report: () => undefined,
    newRunId: () => 'run-1',
    nowIso: () => '2026-10-16T12:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

const DEADLINE = 1_000_000;
const CONTEXT = { internalUserId: 'user-1', keyOf: corporateTreeRowKey, writeDeadlineAtMs: DEADLINE };

describe('A (corrida). Zenú con gruponutresa.com queda en el lote como referencia', () => {
  it('la empresa de partida queda como «root» y Zenú aparece en el lote', async () => {
    const batch = [
      candidate('c-root', 'Grupo Nutresa S.A. BIC Holding', 'gruponutresa.com'),
      candidate('c-noel', 'Noel', 'noel.com.co'),
    ];
    const { deps, calls } = fakeDeps({}, batch);
    const result = await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.ok(result.ok);
    assert.equal(readCorporateTreeRelation(calls.tagged.get('c-root')), 'root', 'nadie la re-etiqueta como filial');
    const zenu = calls.relationships.find((r) => r.related_name === 'Zenú');
    assert.equal(zenu?.related_candidate_id, null, 'Zenú no apunta al candidato de la empresa de partida');
    const groups = groupBatchCandidatesByTreeRelation(
      batch.map((c) => ({ ...c, metadata: calls.tagged.get(c.id) ?? c.metadata })),
      calls.relationships.map((r) => ({ ...r })),
    );
    const names = groups.flatMap((g) => g.items.map((i) => i.name));
    assert.ok(names.includes('Zenú'), 'Zenú no desaparece del lote');
  });
});

describe('10. El lote se sella aunque una escritura o una lectura no termine', () => {
  it('settleBy: lo que termina a tiempo vuelve; lo que no, se deja', async () => {
    assert.deepEqual(await settleBy(Promise.resolve(7), 1_000, () => 0), { settled: true, value: 7 });
    assert.deepEqual(await settleBy(new Promise<number>(() => undefined), 5, () => 0), { settled: false });
    assert.deepEqual(await settleBy(Promise.resolve(7), 0, () => 10), { settled: false }, 'pasada la hora, ni se espera');
  });

  it('una escritura empezada antes de la hora límite que no termina queda pendiente y el lote se sella', async () => {
    let now = 1_000;
    const { deps, calls } = fakeDeps(
      {
        nowMs: () => now,
        writeWeb: () => {
          // Empezó a tiempo; desde aquí el reloj está casi al final de la gracia.
          now = DEADLINE + CORPORATE_TREE_WRITE_GRACE_MS - 5;
          return new Promise(() => undefined);
        },
      },
      [candidate('c-noel', 'Noel', 'noel.com.co')],
    );
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.equal(calls.sealed.length, 1, 'el lote se sella');
    const tree = calls.sealed[0].metadata.corporate_tree as Record<string, unknown>;
    assert.ok((tree.write_errors as string[]).some((e) => e.startsWith('time_budget:writer:CO') && e.endsWith(':pending')));
  });

  it('si leer el lote o etiquetar no termina antes del sellado, se sella igual (sin lectura no como vacío)', async () => {
    let now = 1_000;
    const { deps, calls } = fakeDeps(
      {
        nowMs: () => now,
        loadBatchCandidates: () => {
          now = DEADLINE + CORPORATE_TREE_SEAL_START_GRACE_MS - 5;
          return new Promise(() => undefined);
        },
      },
      [],
    );
    await runCorporateTreeSearch(REQUEST, CONTEXT, deps);
    assert.equal(calls.sealed.length, 1);
    assert.ok(calls.sealed[0].persisted > 0, 'cuenta lo que escribieron los escritores');
    assert.equal(calls.sealed[0].failed, false);

    let later = 1_000;
    const tagging = fakeDeps(
      {
        nowMs: () => later,
        tagCandidate: () => {
          later = DEADLINE + CORPORATE_TREE_SEAL_START_GRACE_MS - 5;
          return new Promise(() => undefined);
        },
        insertRelationships: () => new Promise(() => undefined),
      },
      [candidate('c-noel', 'Noel', 'noel.com.co')],
    );
    await runCorporateTreeSearch(REQUEST, CONTEXT, tagging.deps);
    assert.equal(tagging.calls.sealed.length, 1, 'etiquetas y asociaciones colgadas no impiden sellar');
  });
});

describe('L. Ficha de Apollo con tope de espera; sin respuesta, cobro desconocido', () => {
  it('sin respuesta a tiempo o con error de red: indeterminado, sin reintento', async () => {
    let calls = 0;
    const slow = await callApolloWithinTimeout(() => {
      calls++;
      return new Promise<never>(() => undefined);
    }, 5);
    assert.equal(slow.kind, 'indeterminate');
    assert.equal(slow.kind === 'indeterminate' && slow.reason, 'timeout');
    assert.equal(calls, 1, 'una sola llamada');
    const broken = await callApolloWithinTimeout(() => Promise.reject(new Error('ECONNRESET')), 1_000);
    assert.equal(broken.kind === 'indeterminate' && broken.reason, 'request_failed');
  });

  it('indeterminado ⇒ créditos y costo NULL (nunca 0) y Uso de IA lo lee como desconocido', () => {
    const billing = corporateTreeApolloFamilyBilling({ kind: 'indeterminate', reason: 'timeout', message: 'x' }, 0.02);
    assert.equal(billing.billingIndeterminate, true);
    assert.equal(billing.organization, null);
    assert.equal(billing.usage.credits_used, undefined, 'el registro lo escribe como NULL');
    assert.equal(billing.usage.estimated_cost_usd, null);
    assert.equal(billing.usage.status, 'error');
    assert.equal(billing.usage.error_code, 'apollo_timeout');
    assert.equal(readUsageBillingState({ metadata: { run_correlation: { billing_state: 'unknown' } } }), 'unknown');
  });

  it('con respuesta: 1 crédito si encontró la empresa, 0 si no', () => {
    const found = corporateTreeApolloFamilyBilling({ kind: 'answered', result: { success: true, data: { id: 'o1' } as never } }, 0.02);
    assert.equal(found.usage.credits_used, 1);
    assert.equal(found.usage.estimated_cost_usd, 0.02);
    assert.equal(found.billingIndeterminate, false);
    const none = corporateTreeApolloFamilyBilling({ kind: 'answered', result: { success: true, data: undefined } }, 0.02);
    assert.equal(none.usage.credits_used, 0);
    assert.equal(none.organization, null);
  });
});
