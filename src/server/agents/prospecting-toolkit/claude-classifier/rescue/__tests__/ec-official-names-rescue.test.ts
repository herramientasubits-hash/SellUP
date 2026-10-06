/**
 * SOURCES-EC-CLOSE-2 — rescate de descartadas SIN web con los nombres OFICIALES del
 * mismo número fiscal (Prod 06-10, Ecuador × Tecnología, lote 0ef658fd).
 *
 * Sin red ni base de datos: Claude, SellUp/HubSpot y Supabase son dobles. Nombres,
 * webs y marcas como en Prod.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { DomainFinderInput, DomainFinderOutcome } from '../../domain-finder';
import type { CompanyClassificationResult } from '../../types';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import {
  buildDomainFinderInput,
  buildUnverifiedHintWebsiteVerification,
  CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
  dispositionTaxId,
  OFFICIAL_TRADE_NAME_VERIFICATION,
  officialTradeNameWebsite,
  previousClaimedUrl,
  REGISTRY_FIRST_WORD_VERIFICATION,
  registryFirstWordWebsite,
  websiteNotFoundBeforeOfficialNames,
} from '../domain-search';
import {
  keptBeforeOfficialSizeRule,
  needsDispositionRescue,
  OFFICIAL_SIZE_RULE_MARKER,
  type RescuableDispositionRow,
} from '../rescue-dispositions';
import { decideRescue } from '../rescue-decision';
import { rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';

const NOW = Date.parse('2026-10-06T22:00:00.000Z');
const AT = '2026-10-06T22:00:00.000Z';
const MODEL = 'claude-haiku-4-5-20251001';
const TEC = 'Tecnología';
const USAGE = {
  model: MODEL,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 1,
  webFetchRequests: 0,
  estimatedCostUsd: 0.013,
  pricingSource: 'table' as const,
};

function megadatos(overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'MEGADATOS S.A.',
    domain: null,
    country_code: 'EC',
    industry: TEC,
    reason_code: 'missing_domain_final',
    round_origin: 'free_source',
    provider_identifier: 'tax:1791287541001',
    evidence: { provider_raw_name: 'MEGADATOS S.A.', tax_identifier_present: true, tax_identifier_type: 'RUC' },
    ...overrides,
  };
}

const notConfirmed = (url: string | null): DomainFinderOutcome =>
  ({ found: false, reason: 'identity_not_confirmed', claimedUrl: url, usage: USAGE }) as DomainFinderOutcome;

describe('la web propuesta es la marca oficial del mismo RUC', () => {
  it('casos reales de Prod: la etiqueta del dominio es exactamente el nombre comercial o la sigla', () => {
    const cases: Array<[string, string[], string]> = [
      ['https://www.netlife.ec', ['NETLIFE'], 'netlife.ec'],
      ['https://www.claro.com.ec', ['CLARO', 'CONECEL'], 'claro.com.ec'],
      ['https://www.movistar.com.ec', ['MOVISTAR'], 'movistar.com.ec'],
      ['https://www.pedidosya.com.ec', ['PEDIDOSYA', 'DH E COMMERCE'], 'pedidosya.com.ec'],
      ['https://www.teuno.com', ['TE UNO'], 'teuno.com'],
      ['http://www.cns-ec.com', ['CNS'], 'cns-ec.com'],
      ['https://www.heyecuador.com', ['HEY'], 'heyecuador.com'],
      ['http://telydata.net/', ['TELYDATA'], 'telydata.net'],
      ['https://www.siglo21.net', ['SIGLO 21'], 'siglo21.net'],
    ];
    for (const [url, names, domain] of cases) {
      assert.deepEqual(
        officialTradeNameWebsite(url, names, 'X'),
        { website: `https://${domain}`, domain, verification: OFFICIAL_TRADE_NAME_VERIFICATION },
        url,
      );
    }
  });

  it('nada de parecidos, ni gobierno, ni redes, ni sin nombre oficial', () => {
    assert.equal(officialTradeNameWebsite('http://www.point.com.ec', ['POINT TECHNOLOGY'], 'X'), null);
    assert.equal(officialTradeNameWebsite('https://asiste.com.ec', ['ASISTECOM'], 'X'), null);
    assert.equal(officialTradeNameWebsite('https://www.claro.gob.ec', ['CLARO'], 'X'), null);
    assert.equal(officialTradeNameWebsite('https://www.facebook.com/claro', ['CLARO'], 'X'), null);
    assert.equal(officialTradeNameWebsite('https://www.huawei.com', [], 'HUAWEI'), null);
    assert.equal(officialTradeNameWebsite(null, ['CLARO'], 'X'), null);
    assert.equal(officialTradeNameWebsite('https://ab.com', ['AB'], 'X'), null);
  });

  it('el vendedor la ve como «Verificado» por el registro oficial', () => {
    const wv = buildUnverifiedHintWebsiteVerification({
      website: 'https://netlife.ec',
      domain: 'netlife.ec',
      verification: OFFICIAL_TRADE_NAME_VERIFICATION,
    });
    assert.equal(wv?.status, 'verified');
    assert.match(String(wv?.reason), /registro oficial/);
  });

  it('Claude busca también por la marca oficial', () => {
    const input = buildDomainFinderInput(megadatos(), null, ['NETLIFE']);
    assert.equal(input.searchHint, 'NETLIFE');
    assert.ok(input.alternateNames?.includes('NETLIFE'));
    assert.notEqual(buildDomainFinderInput(megadatos(), null).searchHint, 'NETLIFE');
  });

  it('RUC desde provider_identifier y web propuesta antes desde la evidencia', () => {
    assert.equal(dispositionTaxId(megadatos()), '1791287541001');
    assert.equal(dispositionTaxId(megadatos({ provider_identifier: 'apollo:123' })), null);
    assert.equal(
      previousClaimedUrl({ [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { found: false, claimed_url: 'https://www.netlife.ec' } }),
      'https://www.netlife.ec',
    );
    assert.equal(previousClaimedUrl({ [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { found: true, claimed_url: 'x' } }), null);
  });
});

const NOT_FOUND_BEFORE = {
  provider_raw_name: 'MEGADATOS S.A.',
  tax_identifier_present: true,
  claude_rescue: { decision: 'website_not_found', contract_version: 'a1.v4' },
  [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: {
    found: false,
    reason: 'identity_not_confirmed',
    claimed_url: 'https://www.netlife.ec',
    search_version: 'd9',
  },
};

describe('qué filas vuelven a entrar', () => {
  it('«no encontrada» de Ecuador con RUC, buscada antes de los nombres oficiales: una vuelta más', () => {
    const row = megadatos({ evidence: NOT_FOUND_BEFORE });
    assert.equal(websiteNotFoundBeforeOfficialNames(row), true);
    assert.equal(needsDispositionRescue(row, NOW, true), true);
    const checked = megadatos({
      evidence: {
        ...NOT_FOUND_BEFORE,
        [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: { ...NOT_FOUND_BEFORE[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY], official_names_checked: true },
      },
    });
    assert.equal(websiteNotFoundBeforeOfficialNames(checked), false);
    assert.equal(websiteNotFoundBeforeOfficialNames(megadatos({ country_code: 'CL', evidence: NOT_FOUND_BEFORE })), false);
    assert.equal(websiteNotFoundBeforeOfficialNames(megadatos({ provider_identifier: null, evidence: NOT_FOUND_BEFORE })), false);
  });

  it('«sin cambio» con web encontrada y tamaño oficial, antes de la regla: una vuelta más (sólo una)', () => {
    const kept = {
      tax_identifier_present: true,
      claude_rescue: { decision: 'unchanged', contract_version: 'a1.v4', sector_warning: 'claude_sector_mismatch_unconfirmed' },
      [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: {
        found: true,
        website: 'https://cartimex.com',
        domain: 'cartimex.com',
        verification: 'name_match',
      },
    };
    const row = megadatos({ name: 'CARTIMEX S.A.', evidence: kept });
    assert.equal(keptBeforeOfficialSizeRule(row), true);
    assert.equal(needsDispositionRescue(row, NOW, true), true);
    const marked = megadatos({ evidence: { ...kept, claude_rescue: { ...kept.claude_rescue, [OFFICIAL_SIZE_RULE_MARKER]: true } } });
    assert.equal(keptBeforeOfficialSizeRule(marked), false);
    assert.equal(
      keptBeforeOfficialSizeRule(megadatos({ round_origin: null, evidence: { ...kept, tax_identifier_present: false } })),
      false,
    );
    assert.equal(keptBeforeOfficialSizeRule(megadatos({ country_code: 'AR', evidence: kept })), false);
  });
});

function withoutSector(candidateId: string): CompanyClassificationResult {
  return {
    candidateId,
    outcome: 'partially_classified',
    sector: null,
    employeeRange: null,
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: null,
    usage: USAGE,
    errorCode: null,
    durationMs: 900,
  } as CompanyClassificationResult;
}

describe('decisión: el tamaño oficial cuenta como dato confirmado', () => {
  it('sin sector ni tamaño de Claude: con tamaño oficial ⇒ admitir; sin él, como antes ⇒ sin cambio', () => {
    const r = withoutSector('d1');
    assert.equal(decideRescue(r, { icpMinEmployees: 100, sizeAlreadyConfirmed: true, officialSizeMeasured: true }).kind, 'admit');
    // Tamaño confirmado por Lusha (no oficial): igual que antes.
    assert.equal(decideRescue(r, { icpMinEmployees: 200, sizeAlreadyConfirmed: true }).kind, 'unchanged');
    assert.equal(decideRescue(r, { icpMinEmployees: 200 }).kind, 'unchanged');
  });
});

function fakeDeps(row: RescuableDispositionRow, overrides: Partial<NonNullable<RescueBatchDeps['domainSearch']>> = {}) {
  const evidence = new Map<string, Record<string, unknown>>();
  const origins: SendToReviewOrigin[] = [];
  const searches: DomainFinderInput[] = [];
  const asked: Array<{ countryCode: string; taxId: string }> = [];
  const classified: Array<{ websiteOrDomain: string | null }> = [];
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: MODEL, apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'tec', industryName: TEC, industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [row],
    loadBatchIndustryId: async () => 'tec',
    classify: async (company) => (classified.push(company), withoutSector(company.candidateId)),
    logUsage: async () => true,
    patchCandidate: async () => false,
    patchDispositionEvidence: async (id, build) => {
      const next = build(evidence.get(id) ?? row.evidence);
      if (!next) return false;
      evidence.set(id, next);
      return true;
    },
    admitDisposition: async (id, origin) => (origins.push(origin), `new-${id}`),
    claimIdentities: async () => undefined,
    domainSearch: {
      findWebsite: async (input) => (searches.push(input), notConfirmed('https://www.netlife.ec')),
      checkDuplicate: async () => ({ status: 'new_candidate', summary: 'Nueva' }),
      officialNames: async (input) => (asked.push(input), ['NETLIFE']),
      ...overrides,
    },
    nowIso: () => AT,
    nowMs: () => NOW,
  };
  return { deps, evidence, origins, searches, asked, classified };
}

describe('rescate completo (Megadatos → netlife.ec)', () => {
  it('Claude propone netlife.ec, la página no confirma, pero es la marca oficial ⇒ vuelve a revisión «Verificado»', async () => {
    const f = fakeDeps(megadatos());
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.deepEqual(f.asked, [{ countryCode: 'EC', taxId: '1791287541001' }]);
    assert.equal(f.searches[0].searchHint, 'NETLIFE');
    const origin = f.origins[0];
    assert.equal(origin.columns?.domain, 'netlife.ec');
    assert.equal(
      (origin.metadata[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { verification: string }).verification,
      OFFICIAL_TRADE_NAME_VERIFICATION,
    );
    assert.equal((origin.metadata.website_verification as { status: string }).status, 'verified');
  });

  it('con la web que Claude ya había propuesto antes: no se vuelve a pagar la búsqueda', async () => {
    const f = fakeDeps(megadatos({ evidence: NOT_FOUND_BEFORE }));
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.equal(f.searches.length, 0);
    assert.equal(f.classified[0].websiteOrDomain, 'https://netlife.ec');
  });

  it('si la web no es la marca oficial, se queda y queda marcada como ya buscada con ella', async () => {
    const f = fakeDeps(megadatos(), { findWebsite: async () => notConfirmed('https://www.otra-cosa.com') });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.equal(f.origins.length, 0);
    const ev = f.evidence.get('d1')!;
    assert.equal((ev[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { official_names_checked?: boolean }).official_names_checked, true);
    assert.equal(needsDispositionRescue({ ...megadatos(), evidence: ev }, NOW + 3_600_000, true), false);
  });

  it('fuera de Ecuador no se piden nombres oficiales y nada cambia', async () => {
    const f = fakeDeps(megadatos({ country_code: 'CO', provider_identifier: 'tax:900123456' }));
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.asked.length, 0);
    assert.equal(f.origins.length, 0);
  });
});

describe('la web propuesta es la primera palabra propia de la razón social', () => {
  it('Huawei, Thoughtworks y Devsu (Prod 0ef658fd) ⇒ «Inferido», nunca «Verificado»', () => {
    for (const [name, url, domain] of [
      ['HUAWEI TECHNOLOGIES ECUADOR CIA. LTDA.', 'https://www.huawei.com', 'huawei.com'],
      ['THOUGHTWORKS SOFTWARE ECUADOR S.A.', 'https://www.thoughtworks.com', 'thoughtworks.com'],
      ['DEVSUSOFTWARE CIA. LTDA.', 'http://www.devsu.com', 'devsu.com'],
    ] as const) {
      const found = registryFirstWordWebsite(url, name);
      assert.deepEqual(found, { website: `https://${domain}`, domain, verification: REGISTRY_FIRST_WORD_VERIFICATION }, name);
      assert.equal(buildUnverifiedHintWebsiteVerification(found!)?.status, 'inferred');
    }
  });

  it('nunca un descriptor del giro, una palabra corta, otra web, gobierno ni plataformas', () => {
    assert.equal(registryFirstWordWebsite('https://distribuidora.com', 'DISTRIBUIDORA FARMACEUTICA ECUATORIANA S.A.'), null);
    assert.equal(registryFirstWordWebsite('https://www.netlife.ec', 'MEGADATOS S.A.'), null);
    assert.equal(registryFirstWordWebsite('https://www.teuno.com', 'GRUPO BRAVCO S.A.'), null);
    assert.equal(registryFirstWordWebsite('https://kfc.com', 'KFC S.A.'), null);
    assert.equal(registryFirstWordWebsite('https://huawei.gob.ec', 'HUAWEI TECHNOLOGIES ECUADOR'), null);
    assert.equal(registryFirstWordWebsite('https://www.facebook.com/huawei', 'HUAWEI TECHNOLOGIES ECUADOR'), null);
  });

  it('en el rescate sólo se usa con los nombres oficiales de Ecuador, y llega a revisión «Inferido»', async () => {
    const huawei = megadatos({
      name: 'HUAWEI TECHNOLOGIES ECUADOR CIA. LTDA.',
      provider_identifier: 'tax:1792457157001',
      evidence: { provider_raw_name: 'HUAWEI TECHNOLOGIES ECUADOR CIA. LTDA.', tax_identifier_present: true },
    });
    const f = fakeDeps(huawei, {
      findWebsite: async () => notConfirmed('https://www.huawei.com'),
      officialNames: async () => [],
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
    assert.equal(f.origins[0].columns?.domain, 'huawei.com');
    assert.equal((f.origins[0].metadata.website_verification as { status: string }).status, 'inferred');
  });
});
