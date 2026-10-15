/**
 * AGENT1-LUSHA-DOMAIN-EXCLUSION-1 + AGENT1-LUSHA-SUBINDUSTRY-ALONE-1.
 *
 * Soporte de Lusha (Kamal, 2026-10-15, probado contra la API):
 *   · `filters.companies.exclude.domains` SÍ existe;
 *   · `subIndustriesIds` NO se aplica si va con `mainIndustriesIds`; sola, sí.
 *
 * Todo puro e inyectado: 0 llamadas a Lusha, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  persistLushaPendingReviewBatch,
  type LushaMultiBranchExecution,
  type PersistLushaPendingReviewDeps,
} from '@/server/prospect-batches/lusha-pending-review';
import {
  buildLushaPreviewRequest,
  executeLushaPreview,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  LUSHA_DOMAIN_EXCLUSION_CAP,
  resolveLushaDomainExclusion,
  toLushaDomainExclusionMetadata,
} from '@/server/prospect-batches/lusha-domain-exclusion';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES } from '@/server/prospect-batches/lusha-pending-review-limits';
import type { LushaCompanyProspectingV3Request } from '@/server/integrations/lusha-client';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
import { isAgent1LushaDomainExclusionEnabled } from '@/lib/feature-flags.server';

type Companies = NonNullable<NonNullable<LushaCompanyProspectingV3Request['filters']>['companies']>;
const companiesOf = (req: LushaCompanyProspectingV3Request): Companies =>
  req.filters?.companies as Companies;

// ── A · La subindustria va sola ──────────────────────────────────────────────

describe('A · subindustria sin industria principal', () => {
  it('A1: con subindustria, la industria principal NO viaja', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Peru', mainIndustriesIds: [11], subIndustryId: 59 });
    assert.deepEqual(companiesOf(req).include?.subIndustriesIds, [59]);
    assert.equal(companiesOf(req).include?.mainIndustriesIds, undefined);
  });

  it('A2: sin subindustria, la industria principal sigue igual', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Peru', mainIndustriesIds: [11], subIndustryId: null });
    assert.deepEqual(companiesOf(req).include?.mainIndustriesIds, [11]);
    assert.equal(companiesOf(req).include?.subIndustriesIds, undefined);
  });

  it('A3: el resumen dice la rama Y que la principal no viajó', async () => {
    let sent: LushaCompanyProspectingV3Request | null = null;
    const result = await executeLushaPreview(
      {
        resolveApiKey: async () => 'test-key',
        searchCompanies: async (_key, request) => {
          sent = request;
          return { ok: true, status: 'success', resultsReturned: 0, results: [] } as never;
        },
      },
      {
        countryCode: 'PE',
        macroIndustryKey: 'health_pharma',
        sizeBandKey: '201-5000',
        industryBranch: { mainIndustryId: 11, subIndustryId: 59 },
      } as LushaPreviewInput,
    );
    assert.ok(sent);
    const include = companiesOf(sent as LushaCompanyProspectingV3Request).include;
    assert.deepEqual(include?.subIndustriesIds, [59]);
    assert.equal(include?.mainIndustriesIds, undefined);
    assert.equal(result.requestSummary?.mainIndustryOmittedForSubIndustry, true);
    // La rama sigue registrada para auditoría.
    assert.deepEqual(result.requestSummary?.mainIndustriesIds, [11]);
  });
});

// ── B · La exclusión en la petición ──────────────────────────────────────────

describe('B · exclude.domains en la petición', () => {
  it('B1: sin dominios, la petición es de inclusión pura (igual que antes)', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.deepEqual(Object.keys(companiesOf(req)), ['include']);
    const empty = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11], excludeDomains: [] });
    assert.deepEqual(Object.keys(companiesOf(empty)), ['include']);
  });

  it('B2: con dominios, sale `exclude.domains` normalizado y sin repetidos', () => {
    const req = buildLushaPreviewRequest({
      countryName: 'Colombia',
      mainIndustriesIds: [11],
      excludeDomains: ['Nuestra.com ', 'nuestra.com', 'otra.co', ''],
    });
    assert.deepEqual(companiesOf(req).exclude, { domains: ['nuestra.com', 'otra.co'] });
    assert.ok(companiesOf(req).include?.locations?.length, 'la inclusión sigue ahí');
  });
});

// ── C · Qué se excluye ───────────────────────────────────────────────────────

describe('C · resolveLushaDomainExclusion', () => {
  const plan = planProviderExclusions('lusha', {
    providerSeenDomains: ['solo-vista.example'],
    sellupKnownDomains: ['cuenta.example'],
    hubspotLocalDomains: ['crm.example'],
    freeSourceAcceptedDomains: ['gratis.example'],
  });

  it('C1: apagada ⇒ no se envía nada (pero se cuenta lo conocido)', () => {
    const ex = resolveLushaDomainExclusion({ enabled: false, plan });
    assert.equal(ex.enabled, false);
    assert.deepEqual(ex.domains, []);
    assert.equal(ex.available, 3);
  });

  it('C2: encendida ⇒ SÓLO lo nuestro, nunca lo sólo visto', () => {
    const ex = resolveLushaDomainExclusion({ enabled: true, plan });
    assert.deepEqual([...ex.domains].sort(), ['crm.example', 'cuenta.example', 'gratis.example']);
    assert.ok(!ex.domains.includes('solo-vista.example'));
  });

  it('C3: respeta el tope y lo cuenta', () => {
    const many = planProviderExclusions('lusha', {
      sellupKnownDomains: Array.from({ length: 20 }, (_, i) => `d${i}.example`),
    });
    const ex = resolveLushaDomainExclusion({ enabled: true, plan: many, cap: 5 });
    assert.equal(ex.domains.length, 5);
    assert.equal(ex.omittedDueToCap, many.domains.dedupeAuthorityValues.length - 5);
    assert.equal(LUSHA_DOMAIN_EXCLUSION_CAP, 500);
  });

  it('C4: sin plan ⇒ nada', () => {
    assert.deepEqual(resolveLushaDomainExclusion({ enabled: true, plan: null }).domains, []);
  });

  it('C5: la metadata sólo lleva conteos, nunca dominios', () => {
    const meta = toLushaDomainExclusionMetadata(resolveLushaDomainExclusion({ enabled: true, plan }));
    assert.deepEqual(meta, { enabled: true, sent: 3, available: 3, omitted_cap: 0 });
  });

  it('C6: la bandera está apagada por defecto', () => {
    const prev = process.env.ENABLE_AGENT1_LUSHA_DOMAIN_EXCLUSION;
    delete process.env.ENABLE_AGENT1_LUSHA_DOMAIN_EXCLUSION;
    assert.equal(isAgent1LushaDomainExclusionEnabled(), false);
    process.env.ENABLE_AGENT1_LUSHA_DOMAIN_EXCLUSION = 'true';
    assert.equal(isAgent1LushaDomainExclusionEnabled(), true);
    if (prev === undefined) delete process.env.ENABLE_AGENT1_LUSHA_DOMAIN_EXCLUSION;
    else process.env.ENABLE_AGENT1_LUSHA_DOMAIN_EXCLUSION = prev;
  });
});

// ── D · El ejecutor pagado ───────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
};

function company(name: string, domain: string): LushaPreviewCompany {
  return {
    providerCompanyId: `p-${domain}`,
    name,
    domain,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
  };
}

function success(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

async function runPaid(execution: LushaMultiBranchExecution | undefined) {
  const searchInputs: LushaPreviewInput[] = [];
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      searchInputs.push(input);
      return searchInputs.length === 1 ? success([company('Nueva', 'nueva.com')]) : success([]);
    },
    reserveBatch: async () => ({ id: 'batch-1', adopted: false, identityEpoch: 0 }),
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => ({ insertedCount: rows.length }),
    checkCompanyDuplicate: async (input) => ({
      status: 'new_candidate',
      confidence: 85,
      input,
      matches: [],
      summary: 'nuevo',
      checkedSources: ['sellup', 'hubspot'],
    }),
    fetchActiveCandidates: async () => [],
  };
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, undefined, execution);
  return { res, searchInputs };
}

describe('D · la ejecución pagada', () => {
  const plan = planProviderExclusions('lusha', { sellupKnownDomains: ['cuenta.example', 'crm.example'] });

  it('D1: con la exclusión, TODAS las peticiones de la corrida llevan la MISMA lista', async () => {
    const domainExclusion = resolveLushaDomainExclusion({ enabled: true, plan });
    const { res, searchInputs } = await runPaid({ providerExclusionPlan: plan, domainExclusion });
    assert.ok(searchInputs.length >= 1);
    for (const input of searchInputs) {
      assert.deepEqual([...(input.excludeDomains ?? [])], [...domainExclusion.domains]);
    }
    assert.equal(res.multiBranch?.domainExclusion?.domains.length, 2);
  });

  it('D2: sin la exclusión, la entrada no lleva `excludeDomains` (como antes)', async () => {
    const { searchInputs } = await runPaid({ providerExclusionPlan: plan });
    for (const input of searchInputs) assert.equal('excludeDomains' in input, false);
  });

  it('D3: la siembra cliente sigue igual con o sin exclusión', async () => {
    const on = await runPaid({ providerExclusionPlan: plan, domainExclusion: resolveLushaDomainExclusion({ enabled: true, plan }) });
    const off = await runPaid({ providerExclusionPlan: plan });
    assert.equal(on.res.multiBranch?.localKnownSeedCount, 2);
    assert.equal(off.res.multiBranch?.localKnownSeedCount, 2);
  });
});

// ── E · Guardas estáticas (sin comentarios) ──────────────────────────────────

describe('E · cableado', () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const action = strip(
    readFileSync(new URL('../../../modules/prospect-batches/lusha-pending-review-actions.ts', import.meta.url), 'utf8'),
  );

  it('E1: la acción real arma la exclusión detrás de su bandera', () => {
    assert.match(action, /domainExclusion: resolveLushaDomainExclusion\(\{\s*enabled: isAgent1LushaDomainExclusionEnabled\(\),/);
  });
});
