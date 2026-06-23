/**
 * Hito INAPI.4 — Safety smoke tests for INAPI Chile enrichment pipeline.
 *
 * Validates that enrichBatchCandidatesWithTaxResolution handles CL
 * correctly: metadata merge, error isolation, country guard, status guards.
 *
 * Uses mock.module to intercept the dynamic import of the INAPI adapter
 * inside the pipeline function. No real HTTP calls.
 *
 * Run: node --experimental-test-module-mocks --import tsx --test \
 *   src/server/source-catalog/enrichment/__tests__/inapi-safety.test.ts
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Module-level mocks (must be before any dynamic import in the pipeline) ──

const mockEnrichCandidate = mock.fn<(...args: unknown[]) => Promise<unknown>>();

const mockAdapter = {
  sourceKey: 'cl_inapi',
  supportedCapabilities: ['manual_signal'],
  enrichCandidate: mockEnrichCandidate,
};

mock.module(resolve('src/server/source-catalog/enrichment/adapters/cl-inapi'), {
  namedExports: {
    inapiChileEnrichmentAdapter: mockAdapter,
  },
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const CL_RES_METADATA = {
  sourceKey: 'cl_res',
  status: 'matched',
  rut: '76.123.456-7',
  legalName: 'Empresa Chilena SPA',
  matchMethod: 'exact_rut',
  confidence: 0.98,
};

const INAPI_MATCHED_METADATA = {
  status: 'matched',
  enrichmentType: 'intellectual_property_signal',
  matchMethod: 'name_signal',
  confidenceSummary: { strongMatches: 2, weakMatches: 1, possibleMatches: 0, highestConfidence: 0.95 },
  signals: [
    {
      signalType: 'trademark_application',
      applicantRaw: '(CL) Empresa Chilena SPA',
      confidenceScore: 0.95,
      brandName: 'EMPRESA',
      applicationNumber: '202500001',
    },
    {
      signalType: 'trademark_registration',
      applicantRaw: '(CL) Empresa Chilena SPA',
      confidenceScore: 0.90,
      brandName: 'EMPRESA',
      registrationNumber: '202400100',
    },
  ],
  warnings: [
    'INAPI does not provide structured RUT',
    'Name matching is non-deterministic',
    'Do not use INAPI to create companies or resolve tax identifiers',
  ],
  metadata: {
    provider: 'datos.gob.cl / INAPI',
    accessMethod: 'ckan_datastore_search',
    deterministicIdentity: false,
    canResolveTaxIdentifier: false,
    canCreateCompany: false,
  },
};

const INAPI_NO_MATCH_METADATA = {
  status: 'no_match',
  enrichmentType: 'intellectual_property_signal',
  matchMethod: 'name_signal',
  confidenceSummary: { strongMatches: 0, weakMatches: 0, possibleMatches: 0, highestConfidence: 0 },
  signals: [],
  warnings: [
    'INAPI does not provide structured RUT',
    'Name matching is non-deterministic',
    'Do not use INAPI to create companies or resolve tax identifiers',
  ],
  metadata: {
    provider: 'datos.gob.cl / INAPI',
    accessMethod: 'ckan_datastore_search',
    deterministicIdentity: false,
    canResolveTaxIdentifier: false,
    canCreateCompany: false,
  },
};

const INAPI_ERROR_METADATA = {
  status: 'error',
  enrichmentType: 'intellectual_property_signal',
  matchMethod: 'name_signal',
  confidenceSummary: { strongMatches: 0, weakMatches: 0, possibleMatches: 0, highestConfidence: 0 },
  signals: [],
  warnings: [
    'INAPI does not provide structured RUT',
    'Name matching is non-deterministic',
    'Do not use INAPI to create companies or resolve tax identifiers',
    'INAPI connector error: Simulated CKAN failure',
  ],
  metadata: {
    provider: 'datos.gob.cl / INAPI',
    accessMethod: 'ckan_datastore_search',
    deterministicIdentity: false,
    canResolveTaxIdentifier: false,
    canCreateCompany: false,
  },
};

// ─── Supabase mock helpers ────────────────────────────────────────────────────

interface UpdateCallArg {
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

function collectUpdateArgs(supabase: Record<string, unknown>): UpdateCallArg[] {
  const args: UpdateCallArg[] = [];
  const fromMock = supabase['from'] as ReturnType<typeof mock.fn>;
  if (!fromMock?.mock?.calls) return args;

  for (const call of fromMock.mock.calls as Array<{ arguments: unknown[]; result: unknown }>) {
    const table = call.arguments[0] as string;
    if (table !== 'prospect_candidates') continue;
    const result = call.result as Record<string, unknown>;
    const updateFn = result?.update as ReturnType<typeof mock.fn> | undefined;
    if (!updateFn?.mock?.calls) continue;
    for (const uc of updateFn.mock.calls as Array<{ arguments: unknown[] }>) {
      args.push(uc.arguments[0] as UpdateCallArg);
    }
  }
  return args;
}

function buildSupabaseChain(returnValue: unknown): Record<string, unknown> {
  const eqMock = mock.fn(() => Promise.resolve(returnValue));
  const selectMock = mock.fn(() => ({ eq: eqMock }));
  const updateMock = mock.fn(() => ({ eq: mock.fn(() => Promise.resolve({ data: null, error: null })) }));
  const fromMock = mock.fn(() => ({ select: selectMock, update: updateMock }));
  return { from: fromMock };
}

function makeCandidateWithClRes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cl-candidate-001',
    name: 'Empresa Chilena SPA',
    legal_name: null,
    metadata: {
      source_enrichment: {
        cl_res: CL_RES_METADATA,
      },
      other_context: 'some value',
    },
    sector_description: 'Tecnología',
    ...overrides,
  };
}

function resetMocks(): void {
  mockEnrichCandidate.mock.resetCalls();
  mockEnrichCandidate.mock.mockImplementation(async () => ({}));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('INAPI.4 — metadata merge', () => {
  it('preserves existing source_enrichment.cl_res when adding cl_inapi', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'matched',
      matchedBy: 'normalized_name',
      confidence: 0.95,
      metadata: INAPI_MATCHED_METADATA,
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    const result = await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-001', 'CL',
    );

    assert.ok(result.candidatesProcessed >= 1);

    const updates = collectUpdateArgs(supabase);
    assert.ok(updates.length >= 1, 'Should have at least one update');

    const meta = updates[0].metadata;
    assert.ok(meta, 'metadata should be present in update');
    const se = meta.source_enrichment as Record<string, unknown>;

    assert.ok(se.cl_res, 'cl_res preserved');
    assert.deepEqual(se.cl_res, CL_RES_METADATA);
    assert.ok(se.cl_inapi, 'cl_inapi added');
    assert.equal((se.cl_inapi as Record<string, unknown>).status, 'matched');
    assert.equal(meta.other_context, 'some value');
  });

  it('adds cl_inapi even with no_match status from INAPI', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      metadata: INAPI_NO_MATCH_METADATA,
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    const result = await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-002', 'CL',
    );

    assert.ok(result.candidatesProcessed >= 1);

    const updates = collectUpdateArgs(supabase);
    const meta = updates[0]?.metadata as Record<string, unknown> | undefined;
    assert.ok(meta);
    const se = meta.source_enrichment as Record<string, unknown>;
    assert.ok(se.cl_res, 'cl_res preserved with no_match');
    assert.ok(se.cl_inapi, 'cl_inapi added with no_match');
    assert.equal((se.cl_inapi as Record<string, unknown>).status, 'no_match');
  });
});

describe('INAPI.4 — update scope', () => {
  it('updates only metadata field, never tax_identifier or status', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'matched',
      matchedBy: 'normalized_name',
      confidence: 0.95,
      metadata: INAPI_MATCHED_METADATA,
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-003', 'CL',
    );

    const updates = collectUpdateArgs(supabase);
    for (const u of updates) {
      const keys = Object.keys(u);
      assert.equal(keys.length, 1, 'update should have exactly one key');
      assert.equal(keys[0], 'metadata');

      const meta = u.metadata as Record<string, unknown>;
      assert.equal('review_status' in meta, false, 'review_status must not be in metadata');
      assert.equal('candidate_status' in meta, false, 'candidate_status must not be in metadata');
      assert.equal('duplicate_status' in meta, false, 'duplicate_status must not be in metadata');
      assert.equal('tax_identifier' in meta, false, 'tax_identifier must not be in metadata');
      assert.equal('_tax_identifier' in meta, false, 'no tax_identifier variant');
    }
  });

  it('never writes tax_identifier in update payload', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'matched',
      matchedBy: 'normalized_name',
      confidence: 0.95,
      metadata: INAPI_MATCHED_METADATA,
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-004', 'CL',
    );

    const updates = collectUpdateArgs(supabase);
    for (const u of updates) {
      assert.equal('tax_identifier' in u, false, 'tax_identifier not in update payload');
    }

    assert.ok(mockEnrichCandidate.mock.callCount() > 0);
    const input = (mockEnrichCandidate.mock.calls[0] as { arguments: unknown[] }).arguments[0] as Record<string, unknown>;
    assert.ok(
      input['candidateTaxId'] === null || input['candidateTaxId'] === undefined,
      'candidateTaxId should be null',
    );
  });
});

describe('INAPI.4 — error isolation', () => {
  it('does not throw when INAPI adapter throws', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => {
      throw new Error('Simulated INAPI failure');
    });

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    let pipelineResult: Record<string, unknown> | null = null;
    let threw = false;
    try {
      pipelineResult = await enrichBatchCandidatesWithTaxResolution(
        supabase as never, 'batch-cl-error', 'CL',
      );
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'Pipeline must never throw when INAPI fails');
    assert.ok(pipelineResult, 'Pipeline must return result');
  });

  it('does not break pipeline when INAPI returns error status', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'error',
      matchedBy: null,
      confidence: 0,
      metadata: INAPI_ERROR_METADATA,
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    const result = await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-err-status', 'CL',
    );

    assert.ok(result.candidatesProcessed >= 1, 'Should have processed the candidate');
    assert.equal(result.errors?.length ?? 0, 0, 'No pipeline errors when INAPI returns error status');
  });
});

describe('INAPI.4 — country guard', () => {
  const NON_CL_COUNTRIES = ['MX', 'CO', 'PE'];

  for (const cc of NON_CL_COUNTRIES) {
    it(`does not execute INAPI for ${cc}`, async () => {
      resetMocks();

      const supabase = buildSupabaseChain({ data: null, error: null });
      const { enrichBatchCandidatesWithTaxResolution } = await import(
        '../tax-identifier-resolution/enrich-with-tax-resolution'
      );

      const result = await enrichBatchCandidatesWithTaxResolution(
        supabase as never, `batch-${cc.toLowerCase()}-001`, cc,
      );

      assert.equal(result.candidatesProcessed, 0);
      assert.deepEqual(result.sourcesApplied, []);
      assert.equal(mockEnrichCandidate.mock.callCount(), 0, `INAPI must not be called for ${cc}`);
    });
  }
});

describe('INAPI.4 — candidate name guard', () => {
  it('processes candidate with empty name but INAPI returns skipped', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      metadata: {
        status: 'skipped',
        enrichmentType: 'intellectual_property_signal',
        matchMethod: 'name_signal',
        confidenceSummary: { strongMatches: 0, weakMatches: 0, possibleMatches: 0, highestConfidence: 0 },
        signals: [],
        warnings: [
          'INAPI does not provide structured RUT',
          'Name matching is non-deterministic',
          'Do not use INAPI to create companies or resolve tax identifiers',
          'missing_candidate_name',
        ],
        metadata: {
          provider: 'datos.gob.cl / INAPI',
          accessMethod: 'ckan_datastore_search',
          deterministicIdentity: false,
          canResolveTaxIdentifier: false,
          canCreateCompany: false,
        },
      },
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes({ name: '', legal_name: null })], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    const result = await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-noname', 'CL',
    );

    assert.equal(result.candidatesProcessed, 1);
    const updates = collectUpdateArgs(supabase);
    assert.ok(updates.length >= 1, 'Update should still happen');
  });
});

describe('INAPI.4 — COUNTRY_SOURCE_MAP exclusion', () => {
  it('COUNTRY_SOURCE_MAP does not contain cl_inapi (source check)', () => {
    const sourcePath = resolve(
      'src/server/agents/prospecting-toolkit/source-discovery-preflight.ts',
    );
    const source = readFileSync(sourcePath, 'utf-8');
    const match = source.match(
      /COUNTRY_SOURCE_MAP\s*:\s*Record<string,\s*string>\s*=\s*\{([^}]+)\}/,
    );
    assert.ok(match, 'COUNTRY_SOURCE_MAP definition found');
    const body = match[1];
    assert.equal(body.includes('cl_inapi'), false, 'cl_inapi must not appear in COUNTRY_SOURCE_MAP');
    assert.ok(body.includes("'cl_res'"), 'Must contain cl_res for CL');
  });
});

describe('INAPI.4 — pipeline return shape', () => {
  it('returns expected shape with warnings, errors, sourcesApplied', async () => {
    resetMocks();
    mockEnrichCandidate.mock.mockImplementation(async () => ({
      sourceKey: 'cl_inapi',
      status: 'matched',
      matchedBy: 'normalized_name',
      confidence: 0.95,
      metadata: INAPI_MATCHED_METADATA,
    }));

    const supabase = buildSupabaseChain({ data: [makeCandidateWithClRes()], error: null });
    const { enrichBatchCandidatesWithTaxResolution } = await import(
      '../tax-identifier-resolution/enrich-with-tax-resolution'
    );

    const result = await enrichBatchCandidatesWithTaxResolution(
      supabase as never, 'batch-cl-shape', 'CL',
    );

    assert.ok(Array.isArray(result.warnings));
    assert.ok(Array.isArray(result.errors));
    assert.ok(typeof result.candidatesProcessed === 'number');
    assert.ok(Array.isArray(result.sourcesApplied));
    assert.ok(typeof result.taxResolutionStatus === 'object');
  });
});
