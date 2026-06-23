import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichCandidateWithInapiSignal,
  enrichCandidateImpl,
  inapiChileEnrichmentAdapter,
} from '../adapters/cl-inapi';
import { ENRICHMENT_ADAPTER_REGISTRY } from '../enrichment-adapter-registry';
import { VALIDATED_SOURCE_CONFIGS } from '../validated-source-configs';
import type { InapiDryRunOutput, InapiNormalizedSignal } from '../../connectors/inapi-chile/types';

// ─── Factory helpers ───────────────────────────────────────────────────────────

function makeMockSignal(overrides: Partial<InapiNormalizedSignal> = {}): InapiNormalizedSignal {
  return {
    datasetKey: 'solicitudes_de_marcas',
    signalType: 'trademark_application',
    applicantRaw: '(CL) Test Company S.A.',
    applicantNormalized: 'Test Company',
    matchedName: 'test company',
    matchMethod: 'exact_normalized',
    confidenceScore: 0.95,
    brandName: 'TESTBRAND',
    patentTitle: null,
    applicationNumber: '202500001',
    registrationNumber: null,
    status: 'En tramite',
    filingDate: '2025-01-15',
    registrationDate: null,
    classesOrIpc: '9,42,45',
    country: 'Chile',
    rawRecordId: 'rec_001',
    ...overrides,
  };
}

function makeMockDryRunOutput(overrides: Partial<InapiDryRunOutput> = {}): InapiDryRunOutput {
  return {
    sourceKey: 'cl_inapi',
    mode: 'name_signal_dry_run',
    input: { companyName: 'Test Company', legalName: undefined },
    executedAt: '2025-01-15T00:00:00.000Z',
    summary: { datasetsChecked: 4, recordsRead: 5, possibleMatches: 0, strongMatches: 1, weakMatches: 0, noMatches: 4 },
    signals: [makeMockSignal()],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('enrichCandidateWithInapiSignal — country guard', () => {
  it('skips when countryCode is not CL', async () => {
    const result = await enrichCandidateWithInapiSignal({
      countryCode: 'CO',
      companyName: 'Some Company',
    });

    assert.equal(result.sourceKey, 'cl_inapi');
    assert.equal(result.status, 'skipped');
    assert.equal(result.matchMethod, 'name_signal');
    assert.equal(result.signals.length, 0);
  });
});

describe('enrichCandidateWithInapiSignal — name guard', () => {
  it('skips when no companyName and no legalName', async () => {
    const result = await enrichCandidateWithInapiSignal({
      countryCode: 'CL',
      companyName: '',
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.signals.length, 0);
  });

  it('skips when both names are empty strings', async () => {
    const result = await enrichCandidateWithInapiSignal({
      countryCode: 'CL',
      companyName: '',
      legalName: '',
    });

    assert.equal(result.status, 'skipped');
  });
});

describe('enrichCandidateWithInapiSignal — legalName priority', () => {
  it('uses legalName as search name when provided', async () => {
    const mockFn = mock.fn<typeof enrichCandidateWithInapiSignal>(async (_input, _fetchFn) => {
      throw new Error('should not be called');
    });

    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        input: { companyName: 'Test SA', legalName: 'Test Legal Name' },
        signals: [
          makeMockSignal({ applicantRaw: '(CL) Test Legal Name', confidenceScore: 0.95 }),
        ],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      {
        countryCode: 'CL',
        companyName: 'Test SA',
        legalName: 'Test Legal Name',
      },
      fetchFn,
    );

    assert.equal(result.status, 'matched');
    assert.ok(result.signals.length > 0);
    assert.equal(fetchFn.mock.callCount(), 1);
    const callArg = (fetchFn.mock.calls[0] as { arguments: unknown[] }).arguments[0] as { companyName: string; legalName?: string };
    assert.equal(callArg.legalName, 'Test Legal Name');
    assert.equal(callArg.companyName, 'Test SA');
  });

  it('falls back to companyName when legalName is not provided', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        input: { companyName: 'Fallback SA', legalName: undefined },
        signals: [
          makeMockSignal({ applicantRaw: '(CL) Fallback SA', confidenceScore: 0.95 }),
        ],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      {
        countryCode: 'CL',
        companyName: 'Fallback SA',
      },
      fetchFn,
    );

    assert.equal(result.status, 'matched');
    const callArg = (fetchFn.mock.calls[0] as { arguments: unknown[] }).arguments[0] as { companyName: string; legalName?: string };
    assert.equal(callArg.legalName, undefined);
    assert.equal(callArg.companyName, 'Fallback SA');
  });
});

describe('enrichCandidateWithInapiSignal — warnings', () => {
  it('includes mandatory warnings in output', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({ signals: [] });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.ok(result.warnings.some((w) => w.includes('INAPI does not provide structured RUT')));
    assert.ok(result.warnings.some((w) => w.includes('Name matching is non-deterministic')));
    assert.ok(result.warnings.some((w) => w.includes('Do not use INAPI to create companies')));
  });

  it('includes extra warnings from the connector', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [makeMockSignal()],
        warnings: ['Extra connector warning: something unusual'],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.ok(result.warnings.some((w) => w.includes('Extra connector warning')));
  });
});

describe('enrichCandidateWithInapiSignal — no tax identifier', () => {
  it('does not include tax_identifier in signals', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [makeMockSignal({ confidenceScore: 0.95 })],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    for (const signal of result.signals) {
      assert.equal('taxIdentifier' in signal, false);
      assert.equal('tax_id' in signal, false);
    }
  });

  it('metadata confirms canResolveTaxIdentifier is false', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({ signals: [] });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.metadata.canResolveTaxIdentifier, false);
    assert.equal(result.metadata.canCreateCompany, false);
    assert.equal(result.metadata.deterministicIdentity, false);
  });
});

describe('enrichCandidateWithInapiSignal — signal limits', () => {
  it('limits strong signals to 10', async () => {
    const manyStrong: InapiNormalizedSignal[] = Array.from({ length: 15 }, (_, i) =>
      makeMockSignal({
        applicationNumber: `2025${String(i).padStart(5, '0')}`,
        confidenceScore: 0.85 + (i % 3) * 0.05,
      }),
    );

    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({ signals: manyStrong });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    const strongSignals = result.signals.filter((s) => s.confidenceScore >= 0.80);
    assert.ok(strongSignals.length <= 10);
    assert.equal(strongSignals.length, 10);
  });

  it('limits weak/possible signals to 10', async () => {
    const manyWeak: InapiNormalizedSignal[] = Array.from({ length: 15 }, (_, i) =>
      makeMockSignal({
        applicationNumber: `2025${String(i).padStart(5, '0')}`,
        confidenceScore: 0.50 + (i % 3) * 0.05,
        matchMethod: 'token_similarity',
      }),
    );

    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({ signals: manyWeak });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    const weakSignals = result.signals.filter((s) => s.confidenceScore < 0.80);
    assert.ok(weakSignals.length <= 10);
  });
});

describe('enrichCandidateWithInapiSignal — status classification', () => {
  it('returns matched when there are strong matches', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [
          makeMockSignal({ confidenceScore: 0.95 }),
          makeMockSignal({ confidenceScore: 0.55, matchMethod: 'token_similarity' }),
        ],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.status, 'matched');
    assert.ok(result.confidenceSummary.strongMatches >= 1);
  });

  it('returns no_match when there are no signals', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({ signals: [] });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'NonExistent Corp' },
      fetchFn,
    );

    assert.equal(result.status, 'no_match');
    assert.equal(result.signals.length, 0);
  });

  it('returns no_match when all signals have zero confidence', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [
          makeMockSignal({ confidenceScore: 0, matchMethod: 'no_match' }),
          makeMockSignal({ confidenceScore: 0, matchMethod: 'no_match' }),
        ],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'No Match' },
      fetchFn,
    );

    assert.equal(result.status, 'no_match');
  });
});

describe('enrichCandidateWithInapiSignal — error handling', () => {
  it('returns error status when connector throws', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      throw new Error('Network timeout');
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.status, 'error');
    assert.equal(result.signals.length, 0);
    assert.ok(result.warnings.some((w) => w.includes('Network timeout')));
  });

  it('does not throw unexpected exceptions', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      throw new Error('Unexpected error');
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.status, 'error');
  });
});

describe('enrichCandidateWithInapiSignal — confidence summary', () => {
  it('reports correct counts for mixed signals', async () => {
    const signals: InapiNormalizedSignal[] = [
      makeMockSignal({ applicationNumber: 'S001', confidenceScore: 0.95 }),
      makeMockSignal({ applicationNumber: 'S002', confidenceScore: 0.85 }),
      makeMockSignal({ applicationNumber: 'W001', confidenceScore: 0.75, matchMethod: 'contains_normalized' }),
      makeMockSignal({ applicationNumber: 'W002', confidenceScore: 0.70, matchMethod: 'token_similarity' }),
      makeMockSignal({ applicationNumber: 'P001', confidenceScore: 0.55, matchMethod: 'token_similarity' }),
    ];

    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({ signals });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.confidenceSummary.strongMatches, 2);
    assert.equal(result.confidenceSummary.weakMatches, 2);
    assert.equal(result.confidenceSummary.possibleMatches, 1);
    assert.equal(result.confidenceSummary.highestConfidence, 0.95);
  });
});

describe('enrichCandidateWithInapiSignal — signal entry structure', () => {
  it('maps trademark signals correctly', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [
          makeMockSignal({
            signalType: 'trademark_application',
            brandName: 'TESTBRAND',
            classesOrIpc: '9,42',
          }),
        ],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.signals.length, 1);
    const entry = result.signals[0];
    assert.equal(entry.signalType, 'trademark_application');
    assert.equal(entry.brandName, 'TESTBRAND');
    assert.deepEqual(entry.classesOrIpc, ['9', '42']);
  });

  it('maps patent signals correctly', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [
          makeMockSignal({
            signalType: 'patent_application',
            patentTitle: 'Innovative process',
            brandName: null,
            classesOrIpc: 'A61K 31/00',
          }),
        ],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.signals.length, 1);
    const entry = result.signals[0];
    assert.equal(entry.signalType, 'patent_application');
    assert.equal(entry.patentTitle, 'Innovative process');
  });
});

describe('enrichCandidateImpl — standard adapter wrapper', () => {
  it('wraps standalone function into SourceEnrichmentOutput', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [makeMockSignal({ confidenceScore: 0.95 })],
      });
    });

    const result = await enrichCandidateImpl(
      {
        candidateName: 'Test Company',
        candidateTaxId: null,
        countryCode: 'CL',
        capability: 'manual_signal',
      },
      fetchFn,
    );

    assert.equal(result.sourceKey, 'cl_inapi');
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'normalized_name');
    assert.equal(result.confidence, 0.95);
    assert.ok(result.signals);
    assert.ok(result.metadata);

    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['status'], 'matched');
    assert.equal(meta['enrichmentType'], 'intellectual_property_signal');
    const nestedMeta = meta['metadata'] as Record<string, unknown>;
    assert.equal(nestedMeta['canResolveTaxIdentifier'], false);
  });

  it('passes legalName from existingMetadata', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [makeMockSignal({ confidenceScore: 0.95 })],
      });
    });

    await enrichCandidateImpl(
      {
        candidateName: 'Test SA',
        candidateTaxId: null,
        countryCode: 'CL',
        capability: 'manual_signal',
        existingMetadata: { legalName: 'Test Legal Name' },
      },
      fetchFn,
    );

    const callArg = (fetchFn.mock.calls[0] as { arguments: unknown[] }).arguments[0] as { companyName: string; legalName?: string };
    assert.equal(callArg.legalName, 'Test Legal Name');
  });

  it('includes reason when skipped', async () => {
    const result = await enrichCandidateImpl(
      {
        candidateName: '',
        candidateTaxId: null,
        countryCode: 'CO',
        capability: 'manual_signal',
      },
      mock.fn<() => Promise<InapiDryRunOutput>>(),
    );

    assert.equal(result.status, 'skipped');
    assert.ok(result.reason);
  });
});

// ─── Integration: Registry & Pipeline Configuration ──────────────────────────

describe('ENRICHMENT_ADAPTER_REGISTRY — cl_inapi registration', () => {
  it('includes cl_inapi in the registry', () => {
    assert.ok(ENRICHMENT_ADAPTER_REGISTRY['cl_inapi']);
    assert.equal(ENRICHMENT_ADAPTER_REGISTRY['cl_inapi'].sourceKey, 'cl_inapi');
  });

  it('registered adapter is the INAPI adapter instance', () => {
    assert.equal(ENRICHMENT_ADAPTER_REGISTRY['cl_inapi'], inapiChileEnrichmentAdapter);
  });

  it('adapter supports manual_signal capability', () => {
    const adapter = ENRICHMENT_ADAPTER_REGISTRY['cl_inapi'];
    assert.ok(adapter.supportedCapabilities.includes('manual_signal'));
    assert.equal(adapter.supportedCapabilities.includes('enrichment_after_discovery'), false);
    assert.equal(adapter.supportedCapabilities.includes('discovery_primary'), false);
    assert.equal(adapter.supportedCapabilities.includes('discovery_secondary'), false);
  });
});

describe('VALIDATED_SOURCE_CONFIGS — cl_inapi config', () => {
  const config = VALIDATED_SOURCE_CONFIGS.find((c) => c.sourceKey === 'cl_inapi');

  it('cl_inapi is present in validated-source-configs', () => {
    assert.ok(config, 'cl_inapi config should exist in VALIDATED_SOURCE_CONFIGS');
  });

  it('is configured only for Chile (CL)', () => {
    assert.deepEqual(config!.countryCodes, ['CL']);
  });

  it('has manual_signal capability only (not enrichment_after_discovery)', () => {
    assert.ok(config!.capabilities.includes('manual_signal'));
    assert.equal(config!.capabilities.includes('enrichment_after_discovery'), false);
  });

  it('uses manual_signal_only wizard usage (not post_discovery_enrichment)', () => {
    assert.equal(config!.wizardUsage, 'manual_signal_only');
  });

  it('has skip_without_blocking fallback behavior', () => {
    assert.equal(config!.fallbackBehavior, 'skip_without_blocking');
  });

  it('adapterKey resolves to existing adapter in registry', () => {
    assert.ok(ENRICHMENT_ADAPTER_REGISTRY[config!.adapterKey]);
    assert.equal(config!.adapterKey, 'cl_inapi');
  });
});

describe('Guardrails — INAPI is NOT in CATALOG_SOURCES or discovery preflight', () => {
  it('CATALOG_SOURCES does not contain cl_inapi', async () => {
    const { CATALOG_SOURCES } = await import('@/server/agents/prospecting-toolkit/source-catalog');
    const found = CATALOG_SOURCES.find((s) => s.key === 'cl_inapi');
    assert.equal(found, undefined, 'INAPI must not appear in CATALOG_SOURCES');
  });

  it('INAPI never returns tax_identifier', async () => {
    const fetchFn = mock.fn<() => Promise<InapiDryRunOutput>>(async () => {
      return makeMockDryRunOutput({
        signals: [makeMockSignal({ confidenceScore: 0.95 })],
      });
    });

    const result = await enrichCandidateWithInapiSignal(
      { countryCode: 'CL', companyName: 'Test' },
      fetchFn,
    );

    assert.equal(result.metadata.canResolveTaxIdentifier, false);
    assert.equal(result.metadata.canCreateCompany, false);
    assert.equal(result.metadata.deterministicIdentity, false);

    for (const signal of result.signals) {
      assert.equal('taxIdentifier' in signal, false);
      assert.equal('tax_id' in signal, false);
      assert.equal('tax_identifier' in signal, false);
      assert.equal('rut' in signal, false);
    }
  });
});
