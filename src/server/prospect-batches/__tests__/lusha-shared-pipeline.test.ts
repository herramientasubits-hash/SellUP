/**
 * Q3F-5BB.10C2 — Lusha adopts the shared, provider-agnostic intake pipeline.
 *
 * Locks the new observable contract on top of the Q3F-5BB.7/7B duplicate parity:
 *   - Lusha routes through the shared mapper + normalizer (provider stays 'lusha',
 *     domain/website/LinkedIn preserved).
 *   - The shared MANDATORY GATE runs BEFORE the duplicate check: hard-excluded
 *     companies (missing domain, country mismatch, known employees < min) never
 *     reach the duplicate checker and surface in `excludedByMandatoryGate` + the
 *     result counts. Soft signals (unknown employees, missing LinkedIn) are
 *     persisted with warnings.
 *   - OFFICIAL-SOURCE ENRICHMENT runs via INJECTED read-only resolvers: a strong
 *     CO match fills typed columns (tax_identifier/type/legal_name) and threads the
 *     taxIdentifier into the duplicate check (→ exact tax duplicate is excluded);
 *     unsupported country / resolver error fail SOFT (no crash, no partial write).
 *   - No live provider calls (every dep is an in-test double), no writes beyond the
 *     two injected insert deps, no migrations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  persistLushaPendingReviewBatch,
  lushaPreviewCompanyToProviderDiscoveredCompany,
  buildLushaProspectSearchCriteria,
  buildLushaDuplicateCheckInput,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import { normalizeProviderDiscoveredCompany } from '@/server/agents/prospect-intake';
import type {
  OfficialSourceEnrichmentResult,
  OfficialSourceResolver,
} from '@/server/agents/prospect-intake';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateMatch,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

// ── Fixtures ────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
const ACTOR = {
  internalUserId: 'user-1',
  // AGENT1-LOCAL-CUT9A §§ 3, 8 — identidad de EJECUCIÓN + objetivo PEDIDO.
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: 5,
};
const ACCOUNT_UUID = '11111111-2222-4333-8444-555555555555';

/**
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 10 — la identidad por defecto se
 * DERIVA del dominio (o del nombre) de cada empresa.
 *
 * Antes la fábrica daba `providerCompanyId: 'pc-1'` y la misma URL de LinkedIn a TODAS. Mientras el
 * dedupe miraba sólo el dominio eso era inofensivo; con el registro de identidad
 * de la corrida deja de serlo, porque dos filas que declaran ser empresas
 * distintas —dominios distintos— afirmaban a la vez ser la MISMA empresa del
 * proveedor. La contradicción estaba en la fábrica, no en el dedupe: dos filas con
 * el mismo id de empresa del proveedor SON la misma empresa.
 *
 * Derivarla mantiene el determinismo y no depende del orden de ejecución. Una
 * prueba que quiera un duplicado lo dice explícitamente (mismo dominio, mismo
 * nombre, o un `providerCompanyId` repetido a mano).
 */
function identitySlug(domain: string | null, name: string | null): string {
  const base = domain ?? name ?? 'sin-identidad';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sin-identidad';
}

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  const merged = {
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
  const slug = identitySlug(merged.domain ?? null, merged.name ?? null);
  return {
    ...merged,
    providerCompanyId: overrides.providerCompanyId ?? `pc-${slug}`,
    linkedinUrl:
      overrides.linkedinUrl !== undefined
        ? overrides.linkedinUrl
        : `https://linkedin.com/company/${slug}`,
  };
}

function successResult(
  results: LushaPreviewCompany[],
  opts: { countryCode?: string; sizeBandMin?: number } = {},
): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: opts.countryCode ?? 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: opts.sizeBandMin ?? 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function emptySecondPage(): LushaPreviewResult {
  return { ...successResult([]), status: 'empty' };
}

function noDup(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

/** Strong CO official-source match (>= 0.85 → strong identity). */
function coStrongMatch(overrides: Partial<OfficialSourceEnrichmentResult> = {}): OfficialSourceEnrichmentResult {
  return {
    status: 'matched',
    countryCode: 'CO',
    sourceKey: 'co_siis',
    confidence: 0.9,
    matchMethod: 'normalized_name',
    taxIdentifier: '900123456',
    taxIdentifierType: 'NIT',
    legalName: 'CLINICA ANDES SAS',
    warnings: [],
    issues: [],
    ...overrides,
  };
}

/** A CO resolver whose `resolve` returns a fixed result (or throws). */
function coResolver(
  make: () => OfficialSourceEnrichmentResult | Promise<OfficialSourceEnrichmentResult>,
): OfficialSourceResolver {
  return {
    countryCode: 'CO',
    sourceKey: 'co_siis',
    canResolve: () => true,
    resolve: async () => make(),
  };
}

interface FlowOpts {
  results: LushaPreviewCompany[];
  resolvers?: OfficialSourceResolver[];
  checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
  active?: ActiveCandidateRecord[];
  countryCode?: string;
  sizeBandMin?: number;
}

function makeDeps(opts: FlowOpts) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateRows: [] as LushaPendingReviewCandidateRow[],
    duplicateInputs: [] as DuplicateCheckInput[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) =>
      (input.page ?? 0) > 0
        ? emptySecondPage()
        : successResult(opts.results, { countryCode: opts.countryCode, sizeBandMin: opts.sizeBandMin }),
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      calls.batches.push(row);
      return { id: 'batch-1', adopted: false, identityEpoch: 0 };
    },
    // CUT-3B4-CORRECCIÓN — la valla es OBLIGATORIA; esta prueba modela la 126
    // SIN aplicar por la ÚNICA puerta legítima: la respuesta de la BASE.
    insertCandidatesFenced: preM126FencedInsert,
    insertCandidates: async (rows) => {
      calls.candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => {
      calls.duplicateInputs.push(input);
      return (opts.checker ?? noDup)(input);
    },
    fetchActiveCandidates: async () => opts.active ?? [],
    officialSourceResolvers: opts.resolvers ?? [],
  };
  return { deps, calls };
}

const run = async (opts: FlowOpts) => {
  const { deps, calls } = makeDeps(opts);
  const input: LushaPreviewInput = { ...INPUT, countryCode: opts.countryCode ?? 'CO' };
  const res = await persistLushaPendingReviewBatch(deps, input, ACTOR);
  return { res, calls };
};

const batchMeta = (calls: { batches: LushaPendingReviewBatchRow[] }) =>
  calls.batches[0].metadata as Record<string, unknown>;

// ── B. Lusha adopts the shared mapper / normalizer ────────────────────────────

describe('B. shared mapper + normalizer', () => {
  it('maps a Lusha company through the shared adapter (provider lusha, fields kept)', () => {
    const criteria = buildLushaProspectSearchCriteria(INPUT, successResult([company()]));
    const discovered = lushaPreviewCompanyToProviderDiscoveredCompany(
      company({ domain: 'x.com', linkedinUrl: 'https://www.linkedin.com/company/x' }),
      criteria,
    );
    assert.equal(discovered.provider, 'lusha');
    assert.equal(discovered.domain, 'x.com');
    assert.equal(discovered.linkedinUrl, 'https://www.linkedin.com/company/x');

    const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
    assert.equal(normalized.sourceProvider, 'lusha');
    assert.equal(normalized.domain, 'x.com');
    assert.equal(normalized.corporateLinkedinUrl, 'https://www.linkedin.com/company/x');
  });

  it('criteria carries the requested country + size-band minimum', () => {
    const criteria = buildLushaProspectSearchCriteria(INPUT, successResult([company()], { sizeBandMin: 201 }));
    assert.equal(criteria.countryCode, 'CO');
    assert.equal(criteria.minEmployees, 201);
    assert.equal(criteria.sourceProvider, 'lusha');
  });
});

// ── C. Mandatory gate hard-excludes ───────────────────────────────────────────

describe('C. mandatory gate hard-excludes (never persisted, never dup-checked)', () => {
  it('missing domain → hard-excluded; a clean company still persists', async () => {
    const { res, calls } = await run({
      results: [
        company({ providerCompanyId: 'bad', name: 'Sin Dominio', domain: null }),
        company({ providerCompanyId: 'ok', name: 'Con Dominio', domain: 'condominio.com' }),
      ],
    });
    assert.equal(res.status, 'success');
    assert.equal(res.hardExcludedByGateCount, 1);
    assert.equal(res.usefulCandidatesCount, 1);
    const domains = calls.candidateRows.map((r) => r.domain);
    assert.deepEqual(domains, ['condominio.com']);
    // Hard-excluded company never reached the duplicate checker.
    assert.ok(calls.duplicateInputs.every((i) => i.domain !== null && i.name !== 'Sin Dominio'));
  });

  it('country mismatch → hard-excluded', async () => {
    const { res, calls } = await run({
      results: [company({ name: 'Foreign', countryIso2: 'MX' }), company({ name: 'Local' })],
    });
    assert.equal(res.hardExcludedByGateCount, 1);
    assert.ok(calls.candidateRows.every((r) => r.name !== 'Foreign'));
  });

  it('known employees below the size-band min → hard-excluded', async () => {
    const { res, calls } = await run({
      results: [company({ name: 'Tiny', employeesExact: 10 }), company({ name: 'Big', employeesExact: 500 })],
      sizeBandMin: 201,
    });
    assert.equal(res.hardExcludedByGateCount, 1);
    assert.ok(calls.candidateRows.every((r) => r.name !== 'Tiny'));
  });

  it('excludedByMandatoryGate + gate_summary land in batch metadata', async () => {
    const { calls, res } = await run({
      results: [company({ name: 'Sin Dominio', domain: null }), company({ name: 'Clean' })],
    });
    assert.equal(res.status, 'success');
    const meta = batchMeta(calls);
    const excluded = meta.excludedByMandatoryGate as Array<Record<string, unknown>>;
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].decision, 'hard_excluded');
    assert.ok((excluded[0].reasons as string[]).includes('missing_domain'));
    const gateSummary = meta.gate_summary as Record<string, unknown>;
    assert.equal(gateSummary.hard_excluded_count, 1);
    assert.ok((gateSummary.reason_counts as Record<string, number>).missing_domain >= 1);
  });

  it('all hard-excluded → empty result, no batch, still reports the count', async () => {
    const { res, calls } = await run({ results: [company({ name: 'Sin Dominio', domain: null })] });
    assert.equal(res.status, 'empty');
    assert.equal(calls.batches.length, 0);
    assert.equal(res.hardExcludedByGateCount, 1);
  });
});

// ── D. Soft warnings (still persisted) ────────────────────────────────────────

describe('D. soft warnings persist with metadata.gate_warnings', () => {
  it('unknown employee count → persisted with employee_count_unknown warning', async () => {
    const { res, calls } = await run({
      results: [company({ employeesExact: null, employeesMin: null, employeesMax: null })],
    });
    assert.equal(res.status, 'success');
    assert.equal(calls.candidateRows.length, 1);
    const warnings = (calls.candidateRows[0].metadata as Record<string, unknown>).gate_warnings as string[];
    assert.ok(warnings.includes('employee_count_unknown'));
  });

  it('missing corporate LinkedIn → persisted with missing_corporate_linkedin warning', async () => {
    const { calls } = await run({ results: [company({ linkedinUrl: null })] });
    const warnings = (calls.candidateRows[0].metadata as Record<string, unknown>).gate_warnings as string[];
    assert.ok(warnings.includes('missing_corporate_linkedin'));
  });
});

// ── E. Official-source enrichment (injected resolvers) ─────────────────────────

describe('E. official-source enrichment via injected resolvers', () => {
  it('CO strong match → typed columns + metadata.source_enrichment matched/co_siis', async () => {
    const { res, calls } = await run({
      results: [company()],
      resolvers: [coResolver(() => coStrongMatch())],
    });
    assert.equal(res.status, 'success');
    assert.equal(res.enrichedWithOfficialSourceCount, 1);
    const row = calls.candidateRows[0];
    assert.equal(row.tax_identifier, '900123456');
    assert.equal(row.tax_identifier_type, 'NIT');
    assert.equal(row.legal_name, 'CLINICA ANDES SAS');
    const se = (row.metadata as Record<string, unknown>).source_enrichment as Record<string, unknown>;
    assert.equal(se.status, 'matched');
    assert.equal(se.sourceKey, 'co_siis');
    assert.equal(se.strongIdentityAvailable, true);
    // The taxId VALUE is never placed in metadata — only a boolean flag.
    assert.equal(se.taxIdentifierPresent, true);
    assert.doesNotMatch(JSON.stringify(se), /900123456/);
  });

  it('unsupported country (no resolver) → warning, no typed tax identifier', async () => {
    const { res, calls } = await run({
      results: [company({ name: 'Lima Co', countryIso2: 'PE' })],
      countryCode: 'PE',
      resolvers: [coResolver(() => coStrongMatch())], // only serves CO
    });
    assert.equal(res.status, 'success');
    assert.equal(res.enrichedWithOfficialSourceCount, 0);
    const row = calls.candidateRows[0];
    assert.equal(row.tax_identifier, null);
    const se = (row.metadata as Record<string, unknown>).source_enrichment as Record<string, unknown>;
    assert.equal(se.status, 'unsupported_country');
    assert.equal(row.duplicate_status, 'no_match'); // still persisted
  });

  it('resolver throws → fail_soft: candidate persists, no partial write, no crash', async () => {
    const { res, calls } = await run({
      results: [company()],
      resolvers: [coResolver(() => { throw new Error('boom raw-should-not-leak'); })],
    });
    assert.equal(res.status, 'success');
    assert.equal(calls.candidateRows.length, 1);
    assert.equal(calls.candidateRows[0].tax_identifier, null);
    const se = (calls.candidateRows[0].metadata as Record<string, unknown>).source_enrichment as Record<string, unknown>;
    assert.equal(se.status, 'error');
    assert.doesNotMatch(JSON.stringify(se), /boom/);
    const summary = batchMeta(calls).source_enrichment_summary as Record<string, number>;
    assert.equal(summary.error_count, 1);
  });
});

// ── F. Strong duplicate via enriched taxIdentifier ─────────────────────────────

describe('F. duplicate check uses the enriched taxIdentifier', () => {
  it('threads a strong taxIdentifier into the duplicate check input', () => {
    const enriched = {
      candidate: undefined as never,
      officialSource: coStrongMatch(),
      taxIdentifier: '900123456',
      taxIdentifierType: 'NIT',
      legalName: 'CLINICA ANDES SAS',
      legalStatus: null,
      strongIdentityAvailable: true,
      identityWarnings: [],
      identityIssues: [],
    };
    const input = buildLushaDuplicateCheckInput(company(), INPUT, enriched);
    assert.equal(input.taxIdentifier, '900123456');
    assert.equal(input.legalName, 'CLINICA ANDES SAS');
  });

  it('exact tax match (via enrichment) → exact_duplicate excluded, no candidate inserted', async () => {
    const sellupTaxExact = (input: DuplicateCheckInput): DuplicateCheckResult => {
      if (input.taxIdentifier === '900123456') {
        const m: DuplicateMatch = {
          source: 'sellup',
          status: 'existing_in_sellup',
          confidence: 92,
          matchedId: ACCOUNT_UUID,
          matchedName: 'Clinica Andes SAS',
          reason: 'Identificador fiscal exacto coincide',
        };
        return { status: 'existing_in_sellup', confidence: 92, input, matches: [m], summary: 'dup', checkedSources: ['sellup', 'hubspot'] };
      }
      return noDup(input);
    };
    const { res, calls } = await run({
      results: [company()],
      resolvers: [coResolver(() => coStrongMatch())],
      checker: sellupTaxExact,
    });
    assert.equal(res.excludedExactDuplicatesCount, 1);
    assert.equal(res.usefulCandidatesCount, 0);
    assert.equal(calls.candidateRows.length, 0);
  });

  it('no enrichment → domain/name dedup + duplicate check behave as before (taxId null)', async () => {
    const { res, calls } = await run({ results: [company()] }); // no resolvers
    assert.equal(res.status, 'success');
    assert.equal(calls.candidateRows.length, 1);
    assert.equal(calls.candidateRows[0].tax_identifier, null);
    assert.equal(calls.duplicateInputs[0].taxIdentifier, null);
  });
});
