/**
 * Tests — Agent 1 v1.16C — Tavily Provider + Usage Logger
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 * Transport y provider 100% mock inyectable.
 *
 * F1  — Tavily provider construye request correcto con mock transport
 * F2  — provider found city + size desde snippet explícito
 * F3  — provider partial city only
 * F4  — provider vague result → no inventa city ni size
 * F5  — provider failed → warnings sanitizados, no secretos
 * F6  — usage logger mapping correcto (operation_key, provider_key, etc.)
 * F7  — usage logger no guarda query completa, solo query_length
 * F8  — usage logger already_logged → resuelve sin lanzar
 * F9  — usage logger error → lanza error sanitizado
 * F10 — batch_id null → lanza missing_batch_id_for_rich_profile_enrichment_usage_log
 * F11 — enabled tavily dryRun=false sin usageLoggerFn → 0 provider calls
 * F12 — enabled tavily dryRun=false sin batchId → 0 provider calls
 * F13 — enabled tavily dryRun=false sin unitCostUsd → 0 provider calls
 * F14 — maxPerBatch cap 2 con 5 candidatos → calls ≤2
 * F15 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG → 0 calls, 0 payloads
 * F16 — vendors/technology_providers/content_providers → bloqueados
 * F17 — merge mantiene external_calls_used=true y cost_usd>0
 * F18 — No Tavily real en ningún test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTavilyRichProfileEnrichmentProvider,
} from '../rich-profile-enrichment-tavily';
import type {
  TavilySearchOpts,
  TavilySearchResponse,
  TavilySearchTransport,
} from '../rich-profile-enrichment-tavily';

import {
  createRichProfileEnrichmentUsageLoggerFn,
} from '../rich-profile-enrichment-usage-logging';

import {
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  createMockRichProfileEnrichmentProvider,
  runRichProfileEnrichmentBatch,
  buildRichProfileEnrichmentUsagePayload,
  mergeRichProfileEnrichmentResult,
} from '../rich-profile-enrichment';
import type {
  RichProfileEnrichmentCandidate,
  RichProfileEnrichmentConfig,
  RichProfileEnrichmentUsagePayload,
} from '../rich-profile-enrichment';

import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';
import type { CandidateRichProfileV1 } from '../candidate-rich-profile';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { UsageLogResult } from '../tavily-usage-logging';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXED_TS = '2026-06-23T12:00:00.000Z';
const fixedClock = () => FIXED_TS;

function buildProfile(overrides?: Partial<Parameters<typeof buildCandidateRichProfileV1>[0]>): CandidateRichProfileV1 {
  return buildCandidateRichProfileV1({
    name: 'Acme Corp',
    website: 'https://acmecorp.com',
    domain: 'acmecorp.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    clockFn: fixedClock,
    ...overrides,
  });
}

function baseCandidate(overrides?: Partial<RichProfileEnrichmentCandidate>): RichProfileEnrichmentCandidate {
  return {
    name: 'Acme Corp',
    domain: 'acmecorp.com',
    website: 'https://acmecorp.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    confidenceScore: 75,
    richProfile: buildProfile(),
    ...overrides,
  };
}

function tavilyConfig(overrides?: Partial<RichProfileEnrichmentConfig>): RichProfileEnrichmentConfig {
  return {
    ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
    enabled: true,
    provider: 'tavily',
    ...overrides,
  };
}

function makeMockTransport(response: TavilySearchResponse): {
  transport: TavilySearchTransport;
  capturedOpts: TavilySearchOpts[];
} {
  const capturedOpts: TavilySearchOpts[] = [];
  const transport: TavilySearchTransport = async (opts) => {
    capturedOpts.push(opts);
    return response;
  };
  return { transport, capturedOpts };
}

function makeLoggerOverride(): {
  override: (input: LogProviderUsageInput) => Promise<UsageLogResult>;
  calls: LogProviderUsageInput[];
  result: UsageLogResult;
} {
  const calls: LogProviderUsageInput[] = [];
  const resultRef = { result: { kind: 'logged' } as UsageLogResult };
  const override = async (input: LogProviderUsageInput): Promise<UsageLogResult> => {
    calls.push(input);
    return resultRef.result;
  };
  return { override, calls, result: resultRef.result };
}

function buildTestPayload(overrides?: Partial<RichProfileEnrichmentUsagePayload>): RichProfileEnrichmentUsagePayload {
  return {
    usage_key: 'tavily:rich_profile_enrichment:batch-123:acme_corp:q',
    provider: 'tavily',
    feature: 'rich_profile_enrichment',
    agent: 'agent_1',
    batch_id: 'batch-123',
    user_id: null,
    candidate_name: 'Acme Corp',
    candidate_domain: 'acmecorp.com',
    query_type: 'company_profile',
    query: '"Acme Corp" "acmecorp.com" company headquarters employees official',
    search_depth: 'basic',
    max_results: 3,
    estimated_cost_usd: 0.01,
    status: 'success',
    result_count: 1,
    selected_status: 'found',
    selected_url: 'https://acmecorp.com/about',
    created_at: FIXED_TS,
    ...overrides,
  };
}

// ─── F1 — Provider construye request correcto ─────────────────────────────────

describe('F1 — Tavily provider construye request correcto con mock transport', () => {
  it('usa search_depth basic, max_results 3 y query no vacía', async () => {
    const { transport, capturedOpts } = makeMockTransport({ query: 'test', results: [] });

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const candidate = baseCandidate();
    const query = '"Acme Corp" "acmecorp.com" company headquarters employees official';

    await provider(candidate, query);

    assert.equal(capturedOpts.length, 1, 'transport llamado 1 vez');
    const opts = capturedOpts[0];
    assert.equal(opts.search_depth, 'basic', 'search_depth debe ser basic');
    assert.equal(opts.max_results, 3, 'max_results debe ser 3');
    assert.ok(opts.query.length > 0, 'query no debe estar vacía');
    assert.equal(opts.query, query, 'query debe coincidir con la pasada al provider');
    assert.ok(!opts.api_key.includes('REDACTED'), 'api_key presente (mock)');

    delete process.env.TAVILY_API_KEY;
  });
});

// ─── F2 — Provider found city + size desde snippet explícito ──────────────────

describe('F2 — provider found city + size desde snippet explícito', () => {
  it('extrae city y size_range de snippet con HQ y employee range', async () => {
    const snippet = 'Globant is headquartered in Buenos Aires. Company size: 10001+ employees worldwide.';
    const { transport } = makeMockTransport({
      query: 'test',
      results: [
        { title: 'Globant - IT Company', url: 'https://globant.com/about', content: snippet, score: 0.9 },
      ],
    });

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(baseCandidate({ name: 'Globant', domain: 'globant.com' }), 'Globant query');
    delete process.env.TAVILY_API_KEY;

    assert.equal(result.status, 'found', 'status debe ser found cuando hay city y size');
    assert.ok(result.city !== null && result.city !== undefined, 'city debe estar presente');
    assert.ok(result.size_range !== null && result.size_range !== undefined, 'size_range debe estar presente');
    assert.ok(result.evidence_url, 'evidence_url debe estar presente');
  });
});

// ─── F3 — Provider partial city only ─────────────────────────────────────────

describe('F3 — provider partial city only', () => {
  it('extrae city pero no size → status partial', async () => {
    const snippet = 'Acme Corp, headquartered in Medellín, is a Colombian company.';
    const { transport } = makeMockTransport({
      query: 'test',
      results: [
        { title: 'Acme Corp', url: 'https://acmecorp.com', content: snippet, score: 0.8 },
      ],
    });

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(baseCandidate(), 'Acme query');
    delete process.env.TAVILY_API_KEY;

    assert.equal(result.status, 'partial', 'status debe ser partial');
    assert.ok(result.city, 'city debe estar presente');
    assert.ok(result.size_range === null || result.size_range === undefined, 'size_range debe ser null');
  });
});

// ─── F4 — Provider vague result ───────────────────────────────────────────────

describe('F4 — provider vague result → no inventa city ni size', () => {
  it('no extrae datos de texto vago sin evidencia explícita', async () => {
    const snippet = 'A technology company with innovative solutions for the global market.';
    const { transport } = makeMockTransport({
      query: 'test',
      results: [
        { title: 'Tech Company', url: 'https://tech.com', content: snippet, score: 0.5 },
      ],
    });

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(baseCandidate(), 'Tech query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(result.city === null || result.city === undefined, 'NO debe inventar city');
    assert.ok(result.size_range === null || result.size_range === undefined, 'NO debe inventar size_range');
    assert.ok(
      result.status === 'not_found' || result.status === 'partial',
      `status debe ser not_found o partial, fue: ${result.status}`,
    );
  });
});

// ─── F5 — Provider failed ────────────────────────────────────────────────────

describe('F5 — provider failed → warnings sanitizados, no secretos', () => {
  it('transport que lanza → status failed, warning sanitizado', async () => {
    const failTransport: TavilySearchTransport = async () => {
      throw new Error('connection_timeout_after_30s');
    };

    process.env.TAVILY_API_KEY = 'tvly-supersecretkey123';
    const provider = createTavilyRichProfileEnrichmentProvider(3, failTransport);
    const result = await provider(baseCandidate(), 'query');
    delete process.env.TAVILY_API_KEY;

    assert.equal(result.status, 'failed', 'status debe ser failed');
    assert.ok(result.warnings && result.warnings.length > 0, 'debe haber warnings');
    const warningText = result.warnings!.join(' ');
    assert.ok(!warningText.includes('supersecretkey'), 'NO debe incluir la API key en warnings');
    assert.ok(!warningText.includes('tvly-'), 'NO debe incluir prefijo tvly- en warnings');
  });

  it('transport que devuelve error en response → status failed', async () => {
    const errorTransport: TavilySearchTransport = async () => ({
      query: 'test',
      results: [],
      error: 'rate_limit_exceeded',
    });

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const provider = createTavilyRichProfileEnrichmentProvider(3, errorTransport);
    const result = await provider(baseCandidate(), 'query');
    delete process.env.TAVILY_API_KEY;

    assert.equal(result.status, 'failed');
    assert.ok(result.warnings && result.warnings.length > 0);

    delete process.env.TAVILY_API_KEY;
  });
});

// ─── F6 — Usage logger mapping correcto ──────────────────────────────────────

describe('F6 — usage logger mapping correcto', () => {
  it('mapea payload hacia LogProviderUsageInput con campos correctos', async () => {
    const { override, calls } = makeLoggerOverride();
    const logger = createRichProfileEnrichmentUsageLoggerFn(null, override);
    const payload = buildTestPayload();

    await logger(payload);

    assert.equal(calls.length, 1, 'logUsage debe ser llamado 1 vez');
    const input = calls[0];
    assert.equal(input.operation_key, 'rich_profile_enrichment', 'operation_key debe ser rich_profile_enrichment');
    assert.equal(input.provider_key, 'tavily', 'provider_key debe ser tavily');
    assert.equal(input.batch_id, 'batch-123', 'batch_id debe preservarse');
    assert.equal(input.estimated_cost_usd, 0.01, 'estimated_cost_usd debe preservarse');
    assert.equal(input.status, 'success', 'status debe ser success para payload.status=success');
    assert.equal(input.results_returned, 1, 'results_returned debe ser result_count del payload');
  });
});

// ─── F7 — Usage logger no guarda query completa ───────────────────────────────

describe('F7 — usage logger no guarda query completa, solo query_length', () => {
  it('metadata.query es undefined, metadata.query_length es number', async () => {
    const { override, calls } = makeLoggerOverride();
    const logger = createRichProfileEnrichmentUsageLoggerFn(null, override);
    const payload = buildTestPayload();

    await logger(payload);

    const meta = calls[0].metadata as Record<string, unknown>;
    assert.equal(meta.query, undefined, 'metadata.query NO debe estar presente');
    assert.equal(typeof meta.query_length, 'number', 'metadata.query_length debe ser number');
    assert.equal(meta.query_length, payload.query.length, 'query_length debe coincidir con longitud de query');
  });
});

// ─── F8 — Usage logger already_logged ────────────────────────────────────────

describe('F8 — usage logger already_logged → resuelve sin lanzar', () => {
  it('already_logged no lanza excepción', async () => {
    const alreadyLoggedOverride = async (_input: LogProviderUsageInput): Promise<UsageLogResult> => ({
      kind: 'already_logged',
    });
    const logger = createRichProfileEnrichmentUsageLoggerFn(null, alreadyLoggedOverride);
    const payload = buildTestPayload();

    await assert.doesNotReject(
      () => logger(payload),
      'already_logged debe resolver sin lanzar',
    );
  });
});

// ─── F9 — Usage logger error ─────────────────────────────────────────────────

describe('F9 — usage logger error → lanza error sanitizado', () => {
  it('failed result lanza error con prefijo rich_profile_enrichment_usage_log_failed', async () => {
    const failedOverride = async (_input: LogProviderUsageInput): Promise<UsageLogResult> => ({
      kind: 'failed',
      error: 'db connection error',
    });
    const logger = createRichProfileEnrichmentUsageLoggerFn(null, failedOverride);
    const payload = buildTestPayload();

    await assert.rejects(
      () => logger(payload),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'debe ser Error');
        assert.ok(
          err.message.includes('rich_profile_enrichment_usage_log_failed'),
          `mensaje debe incluir prefijo, fue: ${err.message}`,
        );
        return true;
      },
    );
  });
});

// ─── F10 — batch_id null → lanza error ───────────────────────────────────────

describe('F10 — batch_id null en logger productivo → lanza', () => {
  it('lanza missing_batch_id_for_rich_profile_enrichment_usage_log', async () => {
    const { override } = makeLoggerOverride();
    const logger = createRichProfileEnrichmentUsageLoggerFn(null, override);
    const payload = buildTestPayload({ batch_id: null });

    await assert.rejects(
      () => logger(payload),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('missing_batch_id_for_rich_profile_enrichment_usage_log'),
          `mensaje inesperado: ${(err as Error).message}`,
        );
        return true;
      },
    );
  });
});

// ─── F11 — Guard: sin usageLoggerFn ──────────────────────────────────────────

describe('F11 — enabled tavily dryRun=false sin usageLoggerFn → 0 provider calls', () => {
  it('guard_missing_usage_logger bloquea todas las llamadas', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: tavilyConfig(),
      providerFn,
      batchId: 'batch-prod-1',
      unitCostUsd: 0.01,
      dryRun: false,
      // usageLoggerFn: omitida intencionalmente
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, '0 provider calls cuando falta usageLoggerFn');
    assert.equal(result.batchMetadata.attempted_query_count, 0);
    assert.ok(
      result.batchMetadata.skipped_reasons['guard_missing_usage_logger'] > 0,
      'skipped_reasons debe contener guard_missing_usage_logger',
    );
  });
});

// ─── F12 — Guard: sin batchId ────────────────────────────────────────────────

describe('F12 — enabled tavily dryRun=false sin batchId → 0 provider calls', () => {
  it('guard_missing_batch_id bloquea todas las llamadas', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const { override } = makeLoggerOverride();
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: tavilyConfig(),
      providerFn,
      batchId: null,
      unitCostUsd: 0.01,
      dryRun: false,
      usageLoggerFn: createRichProfileEnrichmentUsageLoggerFn(null, override),
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, '0 provider calls cuando falta batchId');
    assert.equal(result.batchMetadata.attempted_query_count, 0);
    assert.ok(
      result.batchMetadata.skipped_reasons['guard_missing_batch_id'] > 0,
      'skipped_reasons debe contener guard_missing_batch_id',
    );
  });
});

// ─── F13 — Guard: sin unitCostUsd ────────────────────────────────────────────

describe('F13 — enabled tavily dryRun=false sin unitCostUsd → 0 provider calls', () => {
  it('guard_missing_unit_cost bloquea todas las llamadas', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const { override } = makeLoggerOverride();
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: tavilyConfig(),
      providerFn,
      batchId: 'batch-prod-1',
      // unitCostUsd: omitida intencionalmente
      dryRun: false,
      usageLoggerFn: createRichProfileEnrichmentUsageLoggerFn(null, override),
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, '0 provider calls cuando falta unitCostUsd');
    assert.equal(result.batchMetadata.attempted_query_count, 0);
    assert.ok(
      result.batchMetadata.skipped_reasons['guard_missing_unit_cost'] > 0,
      'skipped_reasons debe contener guard_missing_unit_cost',
    );
  });
});

// ─── F14 — maxPerBatch cap ────────────────────────────────────────────────────

describe('F14 — maxPerBatch cap', () => {
  it('con 5 candidatos y maxPerBatch=2, provider calls ≤2', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = Array.from({ length: 5 }, (_, i) =>
      baseCandidate({ name: `Company ${i}`, domain: `company${i}.com` }),
    );

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: tavilyConfig({ maxPerBatch: 2, provider: 'mock' }),
      providerFn,
      unitCostUsd: 0.01,
      clockFn: fixedClock,
    });

    assert.ok(callCount() <= 2, `provider calls debe ser ≤2, fue: ${callCount()}`);
    assert.ok(result.usagePayloads.length <= 2, `usagePayloads debe ser ≤2, fue: ${result.usagePayloads.length}`);
    assert.ok(result.skipped.some((s) => s.reason === 'batch_cap_reached'), 'debe haber skipped por batch_cap_reached');
  });
});

// ─── F15 — Default disabled ───────────────────────────────────────────────────

describe('F15 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG → 0 calls, 0 payloads', () => {
  it('config default produce 0 ejecución', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, '0 provider calls con DEFAULT config');
    assert.equal(result.usagePayloads.length, 0, '0 usage payloads');
    assert.equal(result.enrichedProfiles.length, 0, '0 enriched profiles');
  });
});

// ─── F16 — vendors/content/technology providers bloqueados ───────────────────

describe('F16 — vendors/content/technology providers siguen bloqueados', () => {
  it('relationship_type vendor → skipped non_sales_relationship', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const vendorProfile = buildProfile();
    const vendorCandidate = baseCandidate({
      richProfile: {
        ...vendorProfile,
        classification: {
          ...vendorProfile.classification,
          relationship_type: 'vendor',
        },
      },
    });

    const result = await runRichProfileEnrichmentBatch([vendorCandidate], {
      config: { ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG, enabled: true, provider: 'mock' },
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, 'vendor → 0 calls');
    assert.equal(result.skipped[0].reason, 'non_sales_relationship');
  });

  it('relationship_type technology_provider → skipped non_sales_relationship', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const profile = buildProfile();
    const candidate = baseCandidate({
      richProfile: {
        ...profile,
        classification: {
          ...profile.classification,
          relationship_type: 'technology_provider',
        },
      },
    });

    const result = await runRichProfileEnrichmentBatch([candidate], {
      config: { ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG, enabled: true, provider: 'mock' },
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, 'technology_provider → 0 calls');
    assert.equal(result.skipped[0].reason, 'non_sales_relationship');
  });

  it('relationship_type content_provider → skipped non_sales_relationship', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const profile = buildProfile();
    const candidate = baseCandidate({
      richProfile: {
        ...profile,
        classification: {
          ...profile.classification,
          relationship_type: 'content_provider',
        },
      },
    });

    const result = await runRichProfileEnrichmentBatch([candidate], {
      config: { ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG, enabled: true, provider: 'mock' },
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, 'content_provider → 0 calls');
    assert.equal(result.skipped[0].reason, 'non_sales_relationship');
  });
});

// ─── F17 — Merge mantiene external_calls_used=true y cost_usd>0 ──────────────

describe('F17 — merge mantiene external_calls_used=true y cost_usd>0', () => {
  it('provenance actualizado correctamente tras merge', () => {
    const profile = buildProfile();
    const result = mergeRichProfileEnrichmentResult(
      profile,
      {
        status: 'found',
        city: 'Bogotá',
        size_range: '201-500',
        evidence_url: 'https://example.com',
        confidence: 80,
      },
      { externalCallUsed: true, estimatedCostUsd: 0.01 },
    );

    assert.equal(result.provenance.external_calls_used, true, 'external_calls_used debe ser true');
    assert.ok(result.provenance.cost_usd > 0, `cost_usd debe ser >0, fue: ${result.provenance.cost_usd}`);
    assert.equal(result.provenance.enrichment_level, 'controlled', 'enrichment_level debe ser controlled');
  });
});

// ─── F18 — No Tavily real ─────────────────────────────────────────────────────

describe('F18 — No Tavily real en ningún test', () => {
  it('todos los tests del provider usan mock transport', async () => {
    // Este test verifica que el provider funciona SIN TAVILY_API_KEY
    // cuando se inyecta un transport override
    delete process.env.TAVILY_API_KEY;

    const { transport } = makeMockTransport({ query: 'test', results: [] });

    // Sin API key pero con transport override → debería fallar en status=failed
    // porque el provider verifica la API key antes de llamar al transport
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(baseCandidate(), 'query');

    // Con transport override pero sin API key → provider retorna failed con warning
    assert.equal(result.status, 'failed', 'sin API key → status failed');
    assert.ok(
      result.warnings?.some((w) => w.includes('api_key')),
      'warning debe mencionar api_key faltante',
    );
  });

  it('payload builder no expone query en usage key', () => {
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: baseCandidate(),
      query: '"Acme Corp" "acmecorp.com" company headquarters employees official',
      config: { ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG, provider: 'tavily' },
      providerResult: { status: 'found', city: 'Bogotá', confidence: 80 },
      estimatedCostUsd: 0.01,
      batchId: 'batch-test-123',
      userId: null,
      createdAt: FIXED_TS,
    });

    assert.ok(!payload.usage_key.includes('headquarters'), 'usage_key no debe contener query text');
    assert.ok(payload.usage_key.includes('tavily:rich_profile_enrichment:batch-test-123'), 'usage_key formato correcto');
  });
});
