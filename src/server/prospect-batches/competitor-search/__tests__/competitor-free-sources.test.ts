/**
 * Agente 1 · «Competidores de una empresa» — lo gratuito filtrado por Claude.
 *
 *   K · el juez de Claude (sólo claves de la lista, error ⇒ sin veredicto);
 *   L · catálogo y banco: la referencia no se ofrece, lo elegido lleva su relación;
 *   M · la relación llega a la metadata de la fila (y sólo con forma válida);
 *   N · capa gratuita: sólo entra lo elegido; juez caído ⇒ no entra nada;
 *   O · banco: se saca más, lo no elegido vuelve al banco;
 *   P · Colombia: CIIU exacto de la referencia hasta el adaptador;
 *   Q · la corrida: primero lo gratuito, Claude en la web sólo si falta.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildCompetitorJudgeRequestBody,
  judgeCompetitors,
  readCompetitorJudgeVerdicts,
  type CompetitorJudgeInput,
  type CompetitorJudgeItem,
} from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge';
import { AnthropicApiError, type AnthropicConversationResult } from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import { sanitizeStructuredDiscoveryProvenance } from '@/server/agents/prospecting-toolkit/structured-discovery-provenance';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import { runCountrySourcePrePaidDiscovery } from '@/server/prospect-batches/country-source-discovery/run-country-source-prepaid-discovery';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import { createBankFirstDrawer, type BankFirstDeps } from '@/server/prospect-batches/company-bank/prepaid-bank-draw.server';
import { PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, projectCandidateForBank } from '@/server/prospect-batches/company-bank/pipeline-candidate-bank-payload';
import type { ApolloCompanyBankPort } from '@/server/prospect-batches/company-bank/apollo-company-bank-port.server';
import type { CompanyBankDrawnCompany, CompanyBankSettleItem } from '@/server/prospect-batches/company-bank/company-bank-types';
import type { CandidateWriterOutput, ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import {
  competitorReferenceSchema,
  readCompetitorReference,
  toCompetitorSearchMetadata,
} from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { MACRO_INDUSTRY_CATALOG_VERSION } from '@/modules/macro-industry-catalog/macro-industries';
import {
  executeCompetitorSearchRun,
  type CompetitorFreeSourcesRequest,
  type CompetitorRunDeps,
  type CompetitorRunInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-competitor-run';
import type { RunProgressStage } from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
import {
  buildReferenceNamePattern,
  isExactReferenceRow,
  isReferenceItself,
  normalizeReferenceName,
  shouldResolveReferenceActivityCodes,
  pickReferenceActivityCodes,
  selectCompetitorBankCandidates,
  selectCompetitorCompanies,
  type CompetitorJudgeContext,
  type CompetitorJudgeFn,
} from '../competitor-free-sources';

const REFERENCE = {
  accountId: null,
  name: 'Indalum',
  domain: 'indalum.com',
  countryCode: 'CO',
  industryName: 'Industria / Manufactura / Químicos / Automotor',
  description: 'Perfiles de aluminio para construcción',
  keywords: ['aluminum extrusion'],
};

const CONTEXT: CompetitorJudgeContext = {
  reference: REFERENCE,
  countryName: 'Colombia',
  industryName: 'Industria / Manufactura / Químicos / Automotor',
};

function conversation(input: unknown): AnthropicConversationResult {
  return {
    content: [{ type: 'tool_use', id: 't1', name: 'submit_competitor_selection', input }],
    usage: { input_tokens: 1000, output_tokens: 100 },
    stopReason: 'tool_use',
  } as unknown as AnthropicConversationResult;
}

function company(i: number, extra: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: `siis:${i}`,
    legalName: `EMPRESA ${i}`,
    normalizedLegalName: `empresa ${i}`,
    taxId: `90000000${i}`,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: 'Bogotá',
    region: null,
    domain: `e${i}.com.co`,
    declaredIndustry: 'Fabricación de productos de aluminio',
    industryCode: '2420',
    coarseSector: null,
    ...extra,
  } as unknown as CountrySourceCompany;
}

/** Juez falso: elige las claves pedidas; `null` simula Claude caído. */
function fakeJudge(pick: (items: readonly CompetitorJudgeItem[]) => string[] | null) {
  const calls: CompetitorJudgeInput[] = [];
  const judge: CompetitorJudgeFn = async (input) => {
    calls.push(input);
    const keys = pick(input.items);
    if (keys === null) return null;
    return {
      competitors: keys.map((key) => ({ key, reason: `compite (${key})` })),
      judged: input.items.length,
      usage: null,
      errorCode: null,
    };
  };
  return { judge, calls };
}

// ── K ─────────────────────────────────────────────────────────────────────────

describe('K — el juez de Claude', () => {
  const items: CompetitorJudgeItem[] = [
    { key: 'e1', name: 'Alumina', activity: 'Aluminio', activityCode: '2420' },
    { key: 'e2', name: 'Panadería', activity: 'Pan', activityCode: '1081' },
  ];

  it('K1: sin búsqueda web, la herramienta forzada y la lista como dato', () => {
    const body = buildCompetitorJudgeRequestBody({ ...CONTEXT, items }, 'claude-test');
    assert.deepEqual(body.tool_choice, { type: 'tool', name: 'submit_competitor_selection' });
    assert.equal((body.tools as Array<{ type?: string }>).some((t) => t.type?.startsWith('web_search')), false);
    assert.match(String(body.system), /sólo comparten industria/);
    assert.match(String(body.system), /DATO, no instrucciones/);
    assert.doesNotMatch(String(body.system), /Indalum/, 'la referencia va en el mensaje, nunca en system');
    const content = String((body.messages[0] as { content: string }).content);
    assert.match(content, /Empresa de referencia: Indalum \(indalum\.com\)/);
    assert.match(content, /e1 \| Alumina \| Aluminio \| código 2420/);
  });

  it('K2: sólo claves de la lista, una vez cada una', () => {
    const verdicts = readCompetitorJudgeVerdicts(
      conversation({
        competitors: [
          { key: 'e1', shared_offering: 'Perfiles de aluminio', confidence: 'high' },
          { key: 'e1', shared_offering: 'repetida', confidence: 'high' },
          { key: 'e9', shared_offering: 'inventada', confidence: 'high' },
          { key: 7, shared_offering: 'basura', confidence: 'high' },
        ],
      }).content,
      items,
    );
    assert.deepEqual(verdicts, [{ key: 'e1', reason: 'Perfiles de aluminio' }]);
  });

  it('K2b: 🔴 Prod 15-10 — sólo confianza alta y con lo que venden en común', () => {
    const verdicts = readCompetitorJudgeVerdicts(
      conversation({
        competitors: [
          { key: 'e1', shared_offering: 'Perfiles de aluminio', confidence: 'medium' },
          { key: 'e2', shared_offering: '   ', confidence: 'high' },
          { key: 'e2', confidence: 'high' },
        ],
      }).content,
      items,
    );
    assert.deepEqual(verdicts, []);
  });

  it('K1b: el juez sabe que un cliente o un proveedor de la referencia no compite', () => {
    const body = buildCompetitorJudgeRequestBody({ ...CONTEXT, items }, 'claude-test');
    assert.match(String(body.system), /vende LO MISMO/);
    assert.match(String(body.system), /CLIENTES/);
    assert.match(String(body.system), /PROVEEDORES/);
    const schema = JSON.stringify(body.tools);
    assert.match(schema, /shared_offering/);
    assert.match(schema, /"enum":\["high","medium","low"\]/);
  });

  it('K3: lista vacía ⇒ no llama; error de la API ⇒ sin veredictos y con su código', async () => {
    let calls = 0;
    const empty = await judgeCompetitors({ ...CONTEXT, items: [] }, 'm', {
      runConversation: async () => {
        calls++;
        return conversation({ competitors: [] });
      },
    });
    assert.equal(calls, 0);
    assert.equal(empty.judged, 0);
    const failed = await judgeCompetitors({ ...CONTEXT, items }, 'm', {
      runConversation: async () => {
        throw new AnthropicApiError(429, 'rate_limited', 'slow down', { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 } as never);
      },
    });
    assert.deepEqual(failed.competitors, []);
    assert.equal(failed.errorCode, 'rate_limited');
  });
});

// ── L ─────────────────────────────────────────────────────────────────────────

describe('L — catálogo y banco, elegidos por el juez', () => {
  it('L1: nombre de la referencia sin forma societaria ni siglas entre paréntesis', () => {
    assert.equal(normalizeReferenceName('Almacenera del Agro S.A. (ALMAGRO)'), 'almacenera agro');
    assert.equal(buildReferenceNamePattern('Almacenera del Agro S.A. (ALMAGRO)'), '%almacenera%agro%');
    assert.equal(buildReferenceNamePattern('S.A.'), null);
  });

  it('L2: los CIIU de la referencia, sólo los de la industria elegida', () => {
    const codes = pickReferenceActivityCodes(
      [{ ciiu: '6499' }, { ciiu: '1040' }, { ciiu: '1040' }, { ciiu: null }],
      ['1040', '1011'],
      (code) => code.padStart(4, '0'),
    );
    assert.deepEqual(codes, ['1040'], 'la holding (6499) no es de la industria: se ignora');
  });

  it('L2b: 🔴 Prod 15-10 — el CIIU sólo se busca para una referencia colombiana', () => {
    assert.equal(shouldResolveReferenceActivityCodes('CO', { homeCountryCode: 'CO' }), true);
    assert.equal(shouldResolveReferenceActivityCodes('CO', { homeCountryCode: 'MX' }), false, 'Grupo Caballero es mexicana');
    assert.equal(shouldResolveReferenceActivityCodes('CO', { homeCountryCode: null }), false);
    assert.equal(shouldResolveReferenceActivityCodes('MX', { homeCountryCode: 'CO' }), false);
  });

  it('L2c: 🔴 la fila del registro tiene que SER la referencia (web o nombre completo)', () => {
    const caballero = { name: 'Grupo Caballero', domain: 'grupocaballero.mx' };
    assert.equal(isExactReferenceRow(caballero, { legalName: 'Confecciones Caballero S.A.S', websiteDomain: null }), false);
    assert.equal(isExactReferenceRow(caballero, { legalName: 'Caballero S.A.S', websiteDomain: null }), false, 'una sola palabra no basta');
    assert.equal(isExactReferenceRow(caballero, { legalName: 'Otra', websiteDomain: 'www.grupocaballero.mx' }), true);
    const almagro = { name: 'Almacenera del Agro S.A. (ALMAGRO)', domain: null };
    assert.equal(isExactReferenceRow(almagro, { legalName: 'ALMACENERA DEL AGRO S.A.', websiteDomain: null }), true);
    assert.equal(isExactReferenceRow(almagro, { legalName: 'Almacenera del Agro del Norte', websiteDomain: null }), false);
  });

  it('L2d: el país de la sede viaja validado y vuelve a leerse del lote', () => {
    const base = { name: 'Indalum', domain: 'indalum.com', description: null, accountId: null };
    assert.equal(competitorReferenceSchema.safeParse({ ...base, homeCountryCode: 'CO' }).success, true);
    assert.equal(competitorReferenceSchema.safeParse({ ...base, homeCountryCode: 'col' }).success, false);
    assert.equal(competitorReferenceSchema.safeParse(base).success, true, 'fichas anteriores sin país');
    const metadata = { competitor_search: toCompetitorSearchMetadata({ ...base, homeCountryCode: 'CO' }) };
    assert.equal(readCompetitorReference(metadata)?.homeCountryCode, 'CO');
  });

  it('L3: la referencia misma se reconoce por web o por nombre', () => {
    assert.equal(isReferenceItself(REFERENCE, { name: 'Otra', domain: 'www.indalum.com' }), true);
    assert.equal(isReferenceItself(REFERENCE, { name: 'INDALUM S.A.', domain: null }), true);
    assert.equal(isReferenceItself(REFERENCE, { name: 'Alumina', domain: 'alumina.com' }), false);
  });

  it('L4: catálogo — sólo las elegidas, con su relación; la referencia no se ofrece', async () => {
    const { judge, calls } = fakeJudge(() => ['e2']);
    const picked = await selectCompetitorCompanies(
      [company(1, { legalName: 'INDALUM S.A.' }), company(2), company(3)],
      CONTEXT,
      judge,
    );
    assert.deepEqual(calls[0].items.map((item) => item.key), ['e2', 'e3']);
    assert.deepEqual(picked?.map((c) => c.recordIdentityKey), ['siis:2']);
    assert.deepEqual(picked?.[0].competitorRelationship, { referenceCompanyName: 'Indalum', reason: 'compite (e2)' });
  });

  it('L5: juez caído ⇒ null (nada entra); nada que juzgar ⇒ [] sin llamar', async () => {
    assert.equal(await selectCompetitorCompanies([company(1)], CONTEXT, fakeJudge(() => null).judge), null);
    const { judge, calls } = fakeJudge(() => []);
    assert.deepEqual(await selectCompetitorCompanies([], CONTEXT, judge), []);
    assert.equal(calls.length, 0);
  });

  it('L6: banco — índices elegidos con la relación del escritor web', async () => {
    const { judge } = fakeJudge(() => ['b2']);
    const picked = await selectCompetitorBankCandidates(
      [bankCandidate('Indalum', 'indalum.com'), bankCandidate('Alumina', 'alumina.com')],
      CONTEXT,
      judge,
    );
    assert.deepEqual(picked, [
      {
        index: 1,
        relationshipEvidence: {
          kind: 'competitor_of',
          referenceCompanyName: 'Indalum',
          evidenceUrl: null,
          evidence: 'compite (b2)',
        },
      },
    ]);
  });
});

// ── M ─────────────────────────────────────────────────────────────────────────

describe('M — la relación en la metadata de la fila', () => {
  it('M1: competidor con nombre y motivo ⇒ se copia tal cual (sin página)', () => {
    const out = sanitizeStructuredDiscoveryProvenance({
      relationship: { kind: 'competitor_of', reference_company_name: 'Indalum', evidence: 'Aluminio', evidence_url: 'https://x' },
    });
    assert.deepEqual(out.relationship, {
      kind: 'competitor_of',
      reference_company_name: 'Indalum',
      evidence_url: null,
      evidence: 'Aluminio',
    });
  });

  it('M2: otra forma, otro tipo o texto desmedido ⇒ se omite', () => {
    for (const relationship of [
      { kind: 'supplier_of', reference_company_name: 'X', evidence: 'y' },
      { kind: 'competitor_of', reference_company_name: { email: 'a@b' }, evidence: 'y' },
      { kind: 'competitor_of', reference_company_name: 'X', evidence: 'z'.repeat(500) },
      ['competitor_of'],
    ]) {
      assert.equal('relationship' in sanitizeStructuredDiscoveryProvenance({ relationship }), false);
    }
  });
});

// ── N ─────────────────────────────────────────────────────────────────────────

function gateHarness(companies: CountrySourceCompany[]) {
  const gateInputs: Array<{ activityCodes?: readonly string[] }> = [];
  const persisted: CountrySourceCompany[][] = [];
  const deps: PrePaidNoveltyDiscoveryDeps = {
    runGate: async (gateInput) => {
      gateInputs.push(gateInput);
      return {
        context: buildPrePaidNoveltyContext({
          requestedTarget: gateInput.requestedTarget,
          countryCode: 'CO',
          macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
          freeSource: {
            sourceKey: 'co_siis',
            attempted: true,
            rawReturned: companies.length,
            macroConfirmed: companies.length,
            ambiguous: 0,
            rejected: 0,
            sellupKnown: 0,
            hubspotKnown: 0,
            acceptedNovel: companies.length,
            failed: false,
            failureCode: null,
          },
        }),
        exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
        providerExclusionPlan: planProviderExclusions('apollo', {}),
        providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
        providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
        acceptedCompanies: companies,
        telemetry: {},
      } as unknown as PrePaidNoveltyGateResult;
    },
    persist: async (_client, input) => {
      persisted.push([...input.companies]);
      return { batchId: input.batchId ?? 'b-free', writtenCount: input.companies.length, skippedCount: 0, failed: false };
    },
    recordUnverified: async (rows) => ({ attempted: rows.length, persisted: rows.length, failed: 0, errors: [] }),
  };
  return { deps, gateInputs, persisted };
}

async function runFree(
  deps: PrePaidNoveltyDiscoveryDeps,
  extra: Partial<Parameters<typeof runPrePaidNoveltyDiscovery>[1]>,
) {
  return runPrePaidNoveltyDiscovery(
    {} as unknown as SupabaseClient,
    {
      provider: 'apollo',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      requestedTarget: 5,
      requestedByUserId: 'u-1',
      partialGapSupported: true,
      resolveBatchId: async () => 'b-canon',
      ...extra,
    },
    deps,
  );
}

describe('N — capa gratuita en Competidores', () => {
  it('N1: sólo se escribe lo que el juez eligió, con su relación; los CIIU viajan a la puerta', async () => {
    const h = gateHarness([company(1), company(2), company(3)]);
    const out = await runFree(h.deps, {
      activityCodes: ['2420'],
      selectFreeCompanies: async (companies) => [{ ...companies[1], competitorRelationship: { referenceCompanyName: 'Indalum', reason: 'r' } }],
    });
    assert.deepEqual(h.gateInputs[0].activityCodes, ['2420']);
    assert.deepEqual(h.persisted[0].map((c) => c.recordIdentityKey), ['siis:2']);
    assert.equal(out.persistedCount, 1);
    assert.equal(out.residualGap, 4, 'sólo lo GUARDADO cierra hueco');
    assert.deepEqual(out.telemetry['competitor_selection'], { judged: 3, selected: 1 });
  });

  it('N2: 🔴 juez caído ⇒ no se escribe NADA (nunca una empresa sin filtrar)', async () => {
    const h = gateHarness([company(1), company(2)]);
    const out = await runFree(h.deps, { selectFreeCompanies: async () => null });
    assert.equal(h.persisted.length, 0);
    assert.equal(out.persistedCount, 0);
    assert.equal(out.residualGap, 5);
  });

  it('N3: sin ganchos ⇒ como siempre (todo lo aceptado, sin códigos)', async () => {
    const h = gateHarness([company(1), company(2)]);
    await runFree(h.deps, {});
    assert.equal('activityCodes' in h.gateInputs[0], false);
    assert.equal(h.persisted[0].length, 2);
  });
});

// ── O ─────────────────────────────────────────────────────────────────────────

function bankCandidate(name: string, domain: string): ProspectingPipelineCandidate {
  return {
    name,
    website: `https://${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Industria',
    sourceUrl: `https://${domain}`,
    sourceTitle: name,
    sourceSnippet: 'perfiles de aluminio',
    websiteVerification: null,
    duplicateCheck: null,
    scoring: { qualityLabel: 'needs_review' },
  } as unknown as ProspectingPipelineCandidate;
}

function bankRow(id: string, name: string, domain: string): CompanyBankDrawnCompany {
  return {
    id,
    tier: 'ready',
    sourceProvider: 'tavily',
    claims: [],
    payload: { kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, candidate: projectCandidateForBank(bankCandidate(name, domain)) },
    missingFields: [],
    sourceBatchId: null,
    bankedAt: '2026-10-14T00:00:00.000Z',
  } as unknown as CompanyBankDrawnCompany;
}

function bankHarness(rows: CompanyBankDrawnCompany[]) {
  const draws: Array<{ limit: number }> = [];
  const settles: CompanyBankSettleItem[][] = [];
  const writes: ProspectingPipelineCandidate[][] = [];
  const port = {
    store: {
      async deposit() {
        return { status: 'ok', deposited: 0, skippedClaimed: 0, skippedInBank: 0, skippedInvalid: 0 };
      },
      async draw(input: { limit: number; drawId?: string }) {
        draws.push({ limit: input.limit });
        return { status: 'ok', drawId: input.drawId ?? 'd', companies: rows };
      },
      async settle(_drawId: string, outcomes: readonly CompanyBankSettleItem[]) {
        settles.push([...outcomes]);
        return { status: 'ok', assigned: 0, invalidated: 0, released: 0, ignored: 0 };
      },
    },
    async readPersistedCandidateIdsByDomain() {
      return new Map<string, string>();
    },
    async countAcceptedByDomain() {
      return null;
    },
  } as unknown as ApolloCompanyBankPort;
  const deps: BankFirstDeps = {
    port,
    industryName: 'Industria',
    checkDuplicate: async (input) =>
      ({ status: 'new_candidate', confidence: 0, input, matches: [], summary: 'fresco', checkedSources: [] }) as never,
    write: async (input) => {
      writes.push(input.candidates);
      return { candidatesCreated: input.candidates.length, persistence: { completeValidCandidates: 0 } } as unknown as CandidateWriterOutput;
    },
    resolveCap: () => 10,
    newDrawId: () => 'draw-1',
  };
  return { drawer: createBankFirstDrawer(deps), draws, settles, writes };
}

const BANK_INPUT = {
  countryCode: 'CO',
  countryName: 'Colombia',
  macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
  requestedTarget: 5,
  requestedByUserId: 'u-1',
  resolveBatchId: async () => 'b-canon',
};

describe('O — banco en Competidores', () => {
  it('O1: saca más para elegir, escribe sólo lo elegido (con relación) y devuelve el resto', async () => {
    const h = bankHarness([bankRow('r1', 'Alumina', 'alumina.com'), bankRow('r2', 'Panadería', 'pan.com')]);
    const out = await h.drawer({
      ...BANK_INPUT,
      drawLimit: 40,
      selectCandidates: async () => [
        { index: 0, relationshipEvidence: { kind: 'competitor_of', referenceCompanyName: 'Indalum', evidenceUrl: null, evidence: 'r' } },
      ],
    });
    assert.equal(h.draws[0].limit, 40);
    assert.deepEqual(h.writes.flat().map((c) => c.name), ['Alumina']);
    assert.equal(h.writes.flat()[0].relationshipEvidence?.kind, 'competitor_of');
    assert.ok(h.settles[0].some((item) => item.id === 'r2' && item.outcome === 'released'));
    assert.equal(out.persistedCount, 1);
    assert.equal(out.telemetry['not_selected'], 1);
  });

  it('O2: 🔴 juez caído ⇒ nada se escribe y todo vuelve al banco', async () => {
    const h = bankHarness([bankRow('r1', 'Alumina', 'alumina.com')]);
    const out = await h.drawer({ ...BANK_INPUT, selectCandidates: async () => null });
    assert.equal(h.writes.length, 0);
    assert.deepEqual(h.settles[0], [{ id: 'r1', outcome: 'released' }]);
    assert.equal(out.persistedCount, 0);
    assert.equal(out.telemetry['selection_failed'], true);
  });

  it('O3: sin gancho ⇒ como siempre (tope de entrega, entra todo)', async () => {
    const h = bankHarness([bankRow('r1', 'Alumina', 'alumina.com'), bankRow('r2', 'Panadería', 'pan.com')]);
    await h.drawer(BANK_INPUT);
    assert.equal(h.draws[0].limit, 10);
    assert.equal(h.writes.flat().length, 2);
  });
});

// ── P ─────────────────────────────────────────────────────────────────────────

describe('P — Colombia: los CIIU de la referencia llegan al adaptador', () => {
  it('P1: con códigos se le pasan; sin códigos la lectura es la de siempre', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const deps = {
      adapter: async (criteria: Record<string, unknown>) => {
        seen.push(criteria);
        return { sourceKey: 'co_siis', companies: [] };
      },
      checkCompanyDuplicate: async () => ({ status: 'new_candidate' }),
    } as unknown as Parameters<typeof runCountrySourcePrePaidDiscovery>[1];
    const base = { countryCode: 'CO', macroIndustryKey: 'industry_manufacturing_chemicals_automotive', requestedTarget: 5 };
    await runCountrySourcePrePaidDiscovery({ ...base, activityCodes: ['2420'] }, deps);
    await runCountrySourcePrePaidDiscovery(base, deps);
    assert.deepEqual(seen[0].activityCodes, ['2420']);
    assert.equal('activityCodes' in seen[1], false);
  });
});

// ── Q ─────────────────────────────────────────────────────────────────────────

const RUN_INPUT: CompetitorRunInput = {
  userId: 'user-1',
  clientRequestId: '00000000-0000-4000-8000-000000000001',
  countryCode: 'CO',
  countryName: 'Colombia',
  additionalCriteria: null,
  reference: REFERENCE,
  catalogResolution: {
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: MACRO_INDUSTRY_CATALOG_VERSION },
    industry: { id: 'ind-1', slug: 'industria-manufactura-quimicos-automotor', name: 'Industria / Manufactura / Químicos / Automotor' },
    subindustries: [],
  } as unknown as CompetitorRunInput['catalogResolution'],
  target: 5,
};

function runHarness(opts: {
  free: { persistedCount: number; acceptedCount: number; telemetry: Record<string, unknown> } | null | 'absent';
  reviewable: number[];
  claudeFails?: boolean;
}) {
  const freeRequests: CompetitorFreeSourcesRequest[] = [];
  const legs: number[] = [];
  const stages: RunProgressStage[] = [];
  const seals: Array<Record<string, unknown> | null | undefined> = [];
  const failed: string[] = [];
  const reviewable = [...opts.reviewable];
  const deps: CompetitorRunDeps = {
    reserveSlot: async () => ({ status: 'reserved', batchId: 'batch-1' }),
    checkPersistenceReadiness: async () => ({ status: 'available' }),
    resolveClaudeSearchLeg: () => true,
    runClaudeCompanySearchLeg: async (input) => {
      legs.push(input.round ?? 0);
      if (opts.claudeFails) return { executed: false, reason: 'failed' };
      return {
        executed: true,
        persistedCandidates: 3,
        completeValidCandidates: 3,
        acceptedIdentities: ['candidate:x'],
        estimatedCostUsd: 0.2,
        proposed: 5,
        passedPreFilter: 3,
      };
    },
    ...(opts.free === 'absent'
      ? {}
      : {
          runCompetitorFreeSources: async (input) => {
            freeRequests.push(input);
            return opts.free as { persistedCount: number; acceptedCount: number; telemetry: Record<string, unknown> } | null;
          },
        }),
    countCompetitorBatchOutcome: async () => ({
      reviewable: reviewable.length > 1 ? (reviewable.shift() as number) : (reviewable[0] ?? 0),
      hubspotDuplicates: 0,
      sellupDuplicates: 0,
    }),
    reportProgress: (stage) => stages.push(stage),
    sealFreeOnlyBatchStatus: async (input) => {
      seals.push(input.metadata);
    },
    markBatchFailed: async (batchId) => {
      failed.push(batchId);
    },
    actionStartedAtMs: 1_000,
    nowMs: () => 6_000,
  };
  return { deps, freeRequests, legs, stages, seals, failed };
}

describe('Q — la corrida: primero lo gratuito, Claude en la web sólo si falta', () => {
  it('Q1: lo gratuito llena la meta ⇒ Claude en la web no corre', async () => {
    const h = runHarness({ free: { persistedCount: 5, acceptedCount: 5, telemetry: { competitor_selection: { selected: 5 } } }, reviewable: [5] });
    const result = await executeCompetitorSearchRun(RUN_INPUT, h.deps);
    assert.deepEqual(h.legs, []);
    assert.deepEqual(h.stages, ['competitor_free', 'reviewing']);
    assert.equal(h.freeRequests[0].macroIndustryKey, 'industry_manufacturing_chemicals_automotive');
    assert.equal(h.freeRequests[0].batchId, 'batch-1');
    assert.equal(h.freeRequests[0].reference.name, 'Indalum');
    assert.deepEqual(h.seals[0]?.competitor_free_sources, { competitor_selection: { selected: 5 } });
    assert.equal((h.seals[0]?.claude_search_leg as { reason?: string }).reason, 'free_sources_covered_target');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 'success_target_reached');
    assert.equal(result.candidateCount, 5);
  });

  it('Q2: aporte parcial ⇒ Claude busca el resto y todo suma', async () => {
    const h = runHarness({ free: { persistedCount: 2, acceptedCount: 2, telemetry: {} }, reviewable: [2, 5] });
    const result = await executeCompetitorSearchRun(RUN_INPUT, h.deps);
    assert.deepEqual(h.legs, [0]);
    assert.deepEqual(h.stages, ['competitor_free', 'competitor_round_1', 'reviewing']);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.candidateCount, 5);
    assert.equal(result.batchStatus, 'ready_for_review');
  });

  it('Q3: Claude falla pero lo gratuito dejó filas ⇒ el lote NO se marca fallido', async () => {
    const h = runHarness({ free: { persistedCount: 2, acceptedCount: 2, telemetry: {} }, reviewable: [2], claudeFails: true });
    const result = await executeCompetitorSearchRun(RUN_INPUT, h.deps);
    assert.deepEqual(h.failed, []);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.status, 'success_partial');
    assert.equal(result.candidateCount, 2);
  });

  it('Q4: sin aporte gratuito y Claude falla ⇒ falla como antes', async () => {
    const h = runHarness({ free: null, reviewable: [0], claudeFails: true });
    const result = await executeCompetitorSearchRun(RUN_INPUT, h.deps);
    assert.deepEqual(h.failed, ['batch-1']);
    assert.equal(result.ok, false);
  });

  it('Q5: sin la dependencia gratuita ⇒ la corrida de la fase 1 (sólo Claude)', async () => {
    const h = runHarness({ free: 'absent', reviewable: [3, 6] });
    await executeCompetitorSearchRun(RUN_INPUT, h.deps);
    assert.deepEqual(h.stages, ['competitor_round_1', 'competitor_round_2', 'reviewing']);
  });
});
