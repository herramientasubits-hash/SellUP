import { runInapiChileDryRun } from '../../connectors/inapi-chile';
import type {
  InapiDryRunOutput,
  InapiNormalizedSignal,
} from '../../connectors/inapi-chile/types';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../types';

// ─── INAPI-specific enrichment input/output ────────────────────────────────────

export interface InapiEnrichmentInput {
  countryCode: string;
  companyName: string;
  legalName?: string;
  existingTaxIdentifier?: string;
}

export interface InapiSignalEntry {
  signalType: 'trademark_application' | 'trademark_registration' | 'patent_application' | 'patent_registration';
  applicantRaw: string;
  applicantNormalized: string;
  matchedName: string;
  confidenceScore: number;
  matchMethod: string;
  brandName?: string;
  patentTitle?: string;
  applicationNumber?: string;
  registrationNumber?: string;
  status?: string;
  filingDate?: string;
  registrationDate?: string;
  classesOrIpc?: string[];
  country?: string;
  datasetKey: string;
  rawRecordId?: string;
}

export interface InapiConfidenceSummary {
  strongMatches: number;
  weakMatches: number;
  possibleMatches: number;
  highestConfidence: number;
}

export interface InapiEnrichmentOutput {
  sourceKey: 'cl_inapi';
  enrichmentType: 'intellectual_property_signal';
  status: 'matched' | 'no_match' | 'skipped' | 'error';
  matchMethod: 'name_signal';
  confidenceSummary: InapiConfidenceSummary;
  signals: InapiSignalEntry[];
  warnings: string[];
  metadata: {
    provider: string;
    accessMethod: string;
    deterministicIdentity: boolean;
    canResolveTaxIdentifier: boolean;
    canCreateCompany: boolean;
  };
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MANDATORY_WARNINGS = [
  'INAPI does not provide structured RUT',
  'Name matching is non-deterministic',
  'Do not use INAPI to create companies or resolve tax identifiers',
];

const STRONG_THRESHOLD = 0.80;
const MAX_STRONG_SIGNALS = 10;
const MAX_WEAK_POSSIBLE_SIGNALS = 10;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildConfidenceSummary(signals: InapiNormalizedSignal[]): InapiConfidenceSummary {
  const strong = signals.filter((s) => s.confidenceScore >= STRONG_THRESHOLD);
  const weak = signals.filter((s) => s.confidenceScore >= 0.60 && s.confidenceScore < STRONG_THRESHOLD);
  const possible = signals.filter((s) => s.confidenceScore > 0 && s.confidenceScore < 0.60);

  return {
    strongMatches: strong.length,
    weakMatches: weak.length,
    possibleMatches: possible.length,
    highestConfidence: strong.length > 0
      ? strong[0].confidenceScore
      : weak.length > 0
        ? weak[0].confidenceScore
        : possible.length > 0
          ? possible[0].confidenceScore
          : 0,
  };
}

function parseClassesOrIpc(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(/[,;/\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeSignalToEntry(signal: InapiNormalizedSignal): InapiSignalEntry {
  return {
    signalType: signal.signalType,
    applicantRaw: signal.applicantRaw,
    applicantNormalized: signal.applicantNormalized,
    matchedName: signal.matchedName,
    confidenceScore: signal.confidenceScore,
    matchMethod: signal.matchMethod,
    brandName: signal.brandName ?? undefined,
    patentTitle: signal.patentTitle ?? undefined,
    applicationNumber: signal.applicationNumber ?? undefined,
    registrationNumber: signal.registrationNumber ?? undefined,
    status: signal.status ?? undefined,
    filingDate: signal.filingDate ?? undefined,
    registrationDate: signal.registrationDate ?? undefined,
    classesOrIpc: parseClassesOrIpc(signal.classesOrIpc),
    country: signal.country,
    datasetKey: signal.datasetKey,
    rawRecordId: signal.rawRecordId ?? undefined,
  };
}

function buildSkippedOutput(
  reason: string,
  extraWarnings: string[] = [],
): InapiEnrichmentOutput {
  return {
    sourceKey: 'cl_inapi',
    enrichmentType: 'intellectual_property_signal',
    status: 'skipped',
    matchMethod: 'name_signal',
    confidenceSummary: { strongMatches: 0, weakMatches: 0, possibleMatches: 0, highestConfidence: 0 },
    signals: [],
    warnings: [...MANDATORY_WARNINGS, reason, ...extraWarnings],
    metadata: {
      provider: 'datos.gob.cl / INAPI',
      accessMethod: 'ckan_datastore_search',
      deterministicIdentity: false,
      canResolveTaxIdentifier: false,
      canCreateCompany: false,
    },
  };
}

function limitSignals(signals: InapiNormalizedSignal[]): InapiNormalizedSignal[] {
  const strong = signals.filter((s) => s.confidenceScore >= STRONG_THRESHOLD);
  const weakPossible = signals.filter((s) => s.confidenceScore > 0 && s.confidenceScore < STRONG_THRESHOLD);

  strong.sort((a, b) => b.confidenceScore - a.confidenceScore);
  weakPossible.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return [
    ...strong.slice(0, MAX_STRONG_SIGNALS),
    ...weakPossible.slice(0, MAX_WEAK_POSSIBLE_SIGNALS),
  ];
}

function buildEmptyOutput(): InapiEnrichmentOutput {
  return {
    sourceKey: 'cl_inapi',
    enrichmentType: 'intellectual_property_signal',
    status: 'no_match',
    matchMethod: 'name_signal',
    confidenceSummary: { strongMatches: 0, weakMatches: 0, possibleMatches: 0, highestConfidence: 0 },
    signals: [],
    warnings: MANDATORY_WARNINGS,
    metadata: {
      provider: 'datos.gob.cl / INAPI',
      accessMethod: 'ckan_datastore_search',
      deterministicIdentity: false,
      canResolveTaxIdentifier: false,
      canCreateCompany: false,
    },
  };
}

// ─── Core enrichment ───────────────────────────────────────────────────────────

export type InapiFetchFn = typeof runInapiChileDryRun;

export async function enrichCandidateWithInapiSignal(
  input: InapiEnrichmentInput,
  fetchFn?: InapiFetchFn,
): Promise<InapiEnrichmentOutput> {
  const actualFetchFn = fetchFn ?? runInapiChileDryRun;

  if (input.countryCode !== 'CL') {
    return buildSkippedOutput('country_not_supported');
  }

  if (!input.companyName && !input.legalName) {
    return buildSkippedOutput('missing_candidate_name');
  }

  try {
    const dryRunResult = await actualFetchFn({
      companyName: input.companyName,
      legalName: input.legalName,
      limitPerDataset: 10,
    });

    const validSignals = dryRunResult.signals.filter((s) => s.confidenceScore > 0);
    if (validSignals.length === 0) {
      return buildEmptyOutput();
    }

    const limitedSignals = limitSignals(validSignals);
    const confidenceSummary = buildConfidenceSummary(limitedSignals);
    const hasMatches = confidenceSummary.strongMatches > 0;

    const signalEntries = limitedSignals.map(normalizeSignalToEntry);

    const extraWarnings = dryRunResult.warnings.filter(
      (w) => !MANDATORY_WARNINGS.some((m) => w.includes(m)),
    );

    return {
      sourceKey: 'cl_inapi',
      enrichmentType: 'intellectual_property_signal',
      status: hasMatches ? 'matched' : 'no_match',
      matchMethod: 'name_signal',
      confidenceSummary,
      signals: signalEntries,
      warnings: [...MANDATORY_WARNINGS, ...extraWarnings],
      metadata: {
        provider: 'datos.gob.cl / INAPI',
        accessMethod: 'ckan_datastore_search',
        deterministicIdentity: false,
        canResolveTaxIdentifier: false,
        canCreateCompany: false,
      },
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      sourceKey: 'cl_inapi',
      enrichmentType: 'intellectual_property_signal',
      status: 'error',
      matchMethod: 'name_signal',
      confidenceSummary: { strongMatches: 0, weakMatches: 0, possibleMatches: 0, highestConfidence: 0 },
      signals: [],
      warnings: [...MANDATORY_WARNINGS, `INAPI connector error: ${errorMessage}`],
      metadata: {
        provider: 'datos.gob.cl / INAPI',
        accessMethod: 'ckan_datastore_search',
        deterministicIdentity: false,
        canResolveTaxIdentifier: false,
        canCreateCompany: false,
      },
    };
  }
}

// ─── Standard adapter wrapper (injectable for tests) ───────────────────────────

export async function enrichCandidateImpl(
  input: SourceEnrichmentInput,
  fetchFn: InapiFetchFn,
): Promise<SourceEnrichmentOutput> {
  const legalName = (input.existingMetadata as Record<string, unknown> | undefined)?.['legalName'] as string | undefined;

  const inapiInput: InapiEnrichmentInput = {
    countryCode: input.countryCode,
    companyName: input.candidateName,
    legalName,
    existingTaxIdentifier: input.candidateTaxId ?? undefined,
  };

  const result = await enrichCandidateWithInapiSignal(inapiInput, fetchFn);

  return {
    sourceKey: 'cl_inapi',
    status: result.status,
    matchedBy: result.status === 'matched' ? 'normalized_name' : null,
    confidence: result.confidenceSummary.highestConfidence,
    signals: {
      enrichmentType: result.enrichmentType,
      matchMethod: result.matchMethod,
      confidenceSummary: result.confidenceSummary,
      entries: result.signals,
    },
    reason: result.status === 'skipped' || result.status === 'error'
      ? result.warnings.join('; ')
      : undefined,
    metadata: {
      status: result.status,
      enrichmentType: result.enrichmentType,
      matchMethod: result.matchMethod,
      confidenceSummary: result.confidenceSummary,
      signals: result.signals,
      warnings: result.warnings,
      metadata: result.metadata,
    },
  };
}

// ─── Adapter (not auto-registered until integration decision) ───────────────────

export const inapiChileEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: 'cl_inapi',
  supportedCapabilities: ['manual_signal'] as SourceCapability[],

  async enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> {
    return enrichCandidateImpl(input, runInapiChileDryRun);
  },
};
