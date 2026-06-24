/**
 * Tests — Agent 1 v1.16H-F — Dry Run vs Write Smoke Config Consistency Diagnosis
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — Globant dry-run config: maxResults=5, searchDepth=basic, domain=globant.com
 * F2  — Globant write-smoke config: maxResults=5, searchDepth=basic, domain=globant.com
 * F3  — query builder consistency: dry-run query === write-smoke query
 * F4  — provider factory args consistency: maxResults y searchDepth iguales
 * F5  — usage payload incluye search_depth=basic y query con length>0
 * F6  — write-smoke report: payload tiene selected_status y selected_url
 * F7  — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false no alterado
 * F8  — sin llamadas Tavily reales (mock provider only)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCalibrationConfig,
  resolveWriteSmokeConfig,
  buildProviderFactoryArgs,
} from '../rich-profile-calibration-config';
import {
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  buildRichProfileEnrichmentQuery,
  buildRichProfileEnrichmentUsagePayload,
  createMockRichProfileEnrichmentProvider,
  type RichProfileEnrichmentConfig,
} from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';

// ─── Shared fixture ───────────────────────────────────────────────────────────

const GLOBANT_ENV = {
  RICH_PROFILE_CANDIDATE_NAME: 'Globant',
  RICH_PROFILE_DOMAIN: 'globant.com',
  RICH_PROFILE_WEBSITE: 'https://www.globant.com',
  RICH_PROFILE_COUNTRY: 'Argentina',
  RICH_PROFILE_COUNTRY_CODE: 'AR',
  RICH_PROFILE_INDUSTRY: 'Tecnología',
  RICH_PROFILE_MAX_RESULTS: '5',
  RICH_PROFILE_SEARCH_DEPTH: 'basic',
  RICH_PROFILE_SMOKE_TYPE: 'rich_profile_flow_globant_v1_16h_e',
  RICH_PROFILE_SCRIPT_NAME: 'v1_16h_e_globant_rich_profile_write_smoke',
};

const SMOKE_CONFIG_OVERRIDE: RichProfileEnrichmentConfig = {
  enabled: true,
  provider: 'tavily',
  maxPerBatch: 1,
  maxQueriesPerCandidate: 1,
  minConfidenceScore: 60,
  enrichCity: true,
  enrichSize: true,
  enrichDescription: true,
};

// ─── F1 — Globant dry-run config ──────────────────────────────────────────────

describe('F1 — Globant dry-run config: maxResults=5, searchDepth=basic, domain=globant.com', () => {
  it('resolveCalibrationConfig con Globant env → maxResults=5', () => {
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    assert.equal(config.maxResults, 5);
  });

  it('resolveCalibrationConfig con Globant env → searchDepth=basic', () => {
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    assert.equal(config.searchDepth, 'basic');
  });

  it('resolveCalibrationConfig con Globant env → domain=globant.com', () => {
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    assert.equal(config.domain, 'globant.com');
  });

  it('resolveCalibrationConfig con Globant env → country=Argentina, countryCode=AR', () => {
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    assert.equal(config.country, 'Argentina');
    assert.equal(config.countryCode, 'AR');
  });
});

// ─── F2 — Globant write-smoke config ─────────────────────────────────────────

describe('F2 — Globant write-smoke config: maxResults=5, searchDepth=basic, domain=globant.com', () => {
  it('resolveWriteSmokeConfig con Globant env → maxResults=5', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.maxResults, 5);
  });

  it('resolveWriteSmokeConfig con Globant env → searchDepth=basic', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.searchDepth, 'basic');
  });

  it('resolveWriteSmokeConfig con Globant env → domain=globant.com', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.domain, 'globant.com');
  });

  it('resolveWriteSmokeConfig con Globant env → smokeType=rich_profile_flow_globant_v1_16h_e', () => {
    const config = resolveWriteSmokeConfig(GLOBANT_ENV);
    assert.equal(config.smokeType, 'rich_profile_flow_globant_v1_16h_e');
  });
});

// ─── F3 — query builder consistency ──────────────────────────────────────────

describe('F3 — query builder consistency: dry-run query === write-smoke query para Globant', () => {
  it('buildRichProfileEnrichmentQuery produce el mismo resultado para ambos configs', () => {
    const dryRunConfig = resolveCalibrationConfig(GLOBANT_ENV);
    const writeSmokeConfig = resolveWriteSmokeConfig(GLOBANT_ENV);

    const dryRunCandidate = {
      name: dryRunConfig.candidateName,
      domain: dryRunConfig.domain,
      website: dryRunConfig.website,
    };
    const writeSmokeCandidate = {
      name: writeSmokeConfig.candidateName,
      domain: writeSmokeConfig.domain,
      website: writeSmokeConfig.website,
    };

    const dryRunQuery = buildRichProfileEnrichmentQuery(dryRunCandidate);
    const writeSmokeQuery = buildRichProfileEnrichmentQuery(writeSmokeCandidate);

    assert.equal(
      dryRunQuery,
      writeSmokeQuery,
      `dry-run query !== write-smoke query:\n  dry-run:    ${dryRunQuery}\n  write-smoke: ${writeSmokeQuery}`,
    );
  });

  it('query de Globant contiene "Globant" y "globant.com" entre comillas', () => {
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    const query = buildRichProfileEnrichmentQuery({ name: config.candidateName, domain: config.domain });
    assert.ok(query.includes('"Globant"'), `query debe incluir "Globant": ${query}`);
    assert.ok(query.includes('"globant.com"'), `query debe incluir "globant.com": ${query}`);
  });

  it('query es determinístico — múltiples llamadas producen el mismo resultado', () => {
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    const candidate = { name: config.candidateName, domain: config.domain };
    assert.equal(buildRichProfileEnrichmentQuery(candidate), buildRichProfileEnrichmentQuery(candidate));
  });
});

// ─── F4 — provider factory args consistency ───────────────────────────────────

describe('F4 — provider factory args: maxResults y searchDepth iguales en dry-run y write-smoke', () => {
  it('buildProviderFactoryArgs produce mismos args para ambos configs', () => {
    const dryRunArgs = buildProviderFactoryArgs(resolveCalibrationConfig(GLOBANT_ENV));
    const writeSmokeArgs = buildProviderFactoryArgs(resolveWriteSmokeConfig(GLOBANT_ENV));

    assert.equal(
      dryRunArgs.maxResultsPerQuery,
      writeSmokeArgs.maxResultsPerQuery,
      `maxResultsPerQuery difiere: dry-run=${dryRunArgs.maxResultsPerQuery} write-smoke=${writeSmokeArgs.maxResultsPerQuery}`,
    );
    assert.equal(
      dryRunArgs.searchDepth,
      writeSmokeArgs.searchDepth,
      `searchDepth difiere: dry-run=${dryRunArgs.searchDepth} write-smoke=${writeSmokeArgs.searchDepth}`,
    );
  });

  it('Globant: maxResultsPerQuery=5', () => {
    const args = buildProviderFactoryArgs(resolveCalibrationConfig(GLOBANT_ENV));
    assert.equal(args.maxResultsPerQuery, 5);
  });

  it('Globant: searchDepth=basic', () => {
    const args = buildProviderFactoryArgs(resolveCalibrationConfig(GLOBANT_ENV));
    assert.equal(args.searchDepth, 'basic');
  });

  it('include_domains derivado de domain → [globant.com]', () => {
    // include_domains se deriva de candidate.domain en el provider factory.
    // Verificamos que el domain del config es el esperado.
    const config = resolveCalibrationConfig(GLOBANT_ENV);
    assert.equal(config.domain, 'globant.com',
      'include_domains para Globant debe ser ["globant.com"] (derivado de domain)');
  });
});

// ─── F5 — usage payload incluye search_depth y query_length ──────────────────

describe('F5 — usage payload incluye search_depth=basic y query con length>0', () => {
  it('buildRichProfileEnrichmentUsagePayload → search_depth=basic', () => {
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: { name: 'Globant', domain: 'globant.com' },
      query: buildRichProfileEnrichmentQuery({ name: 'Globant', domain: 'globant.com' }),
      config: SMOKE_CONFIG_OVERRIDE,
      providerResult: {
        status: 'not_found',
        city: null,
        size_range: null,
        evidence_url: null,
        confidence: null,
      },
      estimatedCostUsd: 0.008,
      batchId: 'dry-run-globant-test',
      userId: null,
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    assert.equal(payload.search_depth, 'basic', 'search_depth debe ser basic');
    assert.ok(payload.query.length > 0, `query debe tener length>0, got: "${payload.query}"`);
  });

  it('query_length = payload.query.length está disponible como computed field', () => {
    const query = buildRichProfileEnrichmentQuery({ name: 'Globant', domain: 'globant.com' });
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: { name: 'Globant', domain: 'globant.com' },
      query,
      config: SMOKE_CONFIG_OVERRIDE,
      providerResult: { status: 'not_found', city: null, size_range: null, evidence_url: null, confidence: null },
      estimatedCostUsd: 0.008,
      batchId: 'test-batch',
      userId: null,
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    const queryLength = payload.query.length;
    assert.ok(queryLength > 10, `query_length debe ser > 10, got: ${queryLength}`);
  });
});

// ─── F6 — write-smoke report exposes selected_status y selected_url ───────────

describe('F6 — RichProfileEnrichmentUsagePayload expone selected_status y selected_url', () => {
  it('payload con status=not_found → selected_status=not_found, selected_url=null', () => {
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: { name: 'Globant', domain: 'globant.com' },
      query: '"Globant" "globant.com" about company headquarters employees official',
      config: SMOKE_CONFIG_OVERRIDE,
      providerResult: {
        status: 'not_found',
        city: null,
        size_range: null,
        evidence_url: null,
        confidence: 30,
      },
      estimatedCostUsd: 0.008,
      batchId: 'smoke-batch',
      userId: null,
      createdAt: '2026-06-24T21:39:50.000Z',
    });

    assert.ok('selected_status' in payload, 'payload debe tener campo selected_status');
    assert.ok('selected_url' in payload, 'payload debe tener campo selected_url');
    assert.equal(payload.selected_status, 'not_found');
    assert.equal(payload.selected_url, null);
  });

  it('payload con status=partial y evidence_url → selected_status=partial, selected_url set', () => {
    const EVIDENCE_URL = 'https://www.globant.com/about';
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: { name: 'Globant', domain: 'globant.com' },
      query: '"Globant" "globant.com" about company headquarters employees official',
      config: SMOKE_CONFIG_OVERRIDE,
      providerResult: {
        status: 'partial',
        city: null,
        size_range: '10001+',
        evidence_url: EVIDENCE_URL,
        confidence: 60,
        warnings: ['size_without_city'],
      },
      estimatedCostUsd: 0.008,
      batchId: 'smoke-batch-dry',
      userId: null,
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    assert.equal(payload.selected_status, 'partial');
    assert.equal(payload.selected_url, EVIDENCE_URL);
  });

  it('payload con providerResult=null → selected_status=skipped', () => {
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: { name: 'Globant', domain: 'globant.com' },
      query: '"Globant"',
      config: SMOKE_CONFIG_OVERRIDE,
      providerResult: null,
      estimatedCostUsd: 0,
      batchId: null,
      userId: null,
      createdAt: '2026-06-24T00:00:00.000Z',
    });

    assert.equal(payload.selected_status, 'skipped');
    assert.equal(payload.selected_url, null);
  });
});

// ─── F7 — DEFAULT configs no alterados ───────────────────────────────────────

describe('F7 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false no alterado por helpers', () => {
  it('enabled sigue false después de resolveCalibrationConfig y resolveWriteSmokeConfig', () => {
    resolveCalibrationConfig(GLOBANT_ENV);
    resolveWriteSmokeConfig(GLOBANT_ENV);
    buildProviderFactoryArgs(resolveCalibrationConfig(GLOBANT_ENV));

    assert.equal(
      DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled,
      false,
      'DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled no debe ser activado por helpers',
    );
    assert.equal(
      DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled,
      false,
      'DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled no debe ser activado por helpers',
    );
  });

  it('DEFAULT config provider=disabled no fue cambiado', () => {
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.provider, 'disabled');
  });
});

// ─── F8 — sin llamadas Tavily reales ─────────────────────────────────────────

describe('F8 — sin llamadas Tavily reales (mock provider only)', () => {
  it('createMockRichProfileEnrichmentProvider not_found → status=not_found sin fetch', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('not_found');
    const result = await providerFn(
      { name: 'Globant', domain: 'globant.com' },
      '"Globant" "globant.com" about company headquarters employees official',
    );
    assert.equal(result.status, 'not_found');
    assert.equal(callCount(), 1);
  });

  it('mock partial_size_only → size_range presente, city null, sin TAVILY_API_KEY', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('partial_size_only');
    const result = await providerFn(
      { name: 'Globant', domain: 'globant.com' },
      '"Globant"',
    );
    assert.equal(result.status, 'partial');
    assert.equal(result.size_range, '51-200');
    assert.equal(result.city, null);
  });

  it('dry-run y write-smoke usan la misma query con el mock provider', async () => {
    const dryRunConfig = resolveCalibrationConfig(GLOBANT_ENV);
    const writeSmokeConfig = resolveWriteSmokeConfig(GLOBANT_ENV);

    const dryRunQuery = buildRichProfileEnrichmentQuery({ name: dryRunConfig.candidateName, domain: dryRunConfig.domain });
    const writeSmokeQuery = buildRichProfileEnrichmentQuery({ name: writeSmokeConfig.candidateName, domain: writeSmokeConfig.domain });

    const capturedQueries: string[] = [];
    const { providerFn } = createMockRichProfileEnrichmentProvider('not_found');

    // Simulate both runs with mock
    await providerFn({ name: dryRunConfig.candidateName, domain: dryRunConfig.domain }, dryRunQuery);
    capturedQueries.push(dryRunQuery);

    await providerFn({ name: writeSmokeConfig.candidateName, domain: writeSmokeConfig.domain }, writeSmokeQuery);
    capturedQueries.push(writeSmokeQuery);

    assert.equal(capturedQueries[0], capturedQueries[1], 'Las queries deben ser idénticas en ambos contextos');
  });
});
