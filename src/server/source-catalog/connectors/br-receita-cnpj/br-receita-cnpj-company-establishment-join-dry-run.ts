/**
 * BR Receita CNPJ — company↔establishment BOUNDED JOIN dry-run (BR-SOURCE-10G).
 *
 * A SEPARATE, EXPLICIT mode layered on top of the merged manifest validator,
 * headerless real-file support, and the BR-SOURCE-10E/10F privacy-safe classifier.
 * BR-SOURCE-10F proved that `estabelecimentos` rows must NOT be classified alone —
 * they carry no natureza jurídica, so their eligibility can only be affirmed with
 * the empresas (company) context (they land in `pending_company_join_context`).
 *
 * This module validates, with BOUNDED samples and AGGREGATE metrics only, that we
 * can associate an establishment's company context by the STRUCTURAL join
 * identifier Receita uses (`cnpj_basico` / raiz), WITHOUT ever printing or
 * persisting that identifier — or any row, value, full CNPJ, CNPJ básico, CPF,
 * legal name, trade name, email, phone, or address.
 *
 * ── The join dry-run NEVER (fail-closed by construction) ─────────────────────
 *   - imports, downloads, unzips, or processes the FULL dataset.
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - integrates runtime, Agent 1, providers, HubSpot, or Slack.
 *   - declares any establishment importable — it produces aggregate join metrics.
 *   - returns, prints, hashes, or persists the JOIN KEY (`cnpj_basico`). The key is
 *     held in an EPHEMERAL in-memory index that is discarded when the run returns.
 *   - returns a row, a cell value, a full CNPJ, a CPF, an email, a phone, or an
 *     address — output is aggregate counts only.
 *
 * The manifest validator remains the single authority on identity, layout, header
 * safety, and the SOCIOS/QSA/CPF family denylist. Per-row eligibility reuses the
 * privacy-safe classifier's `classifyRow` (the exact same contract), so the join
 * dry-run adds ONLY the association logic on top — no second classifier.
 */

import {
  getBrReceitaCnpjOfficialColumnCount,
  type BrReceitaCnpjLayoutFileType,
} from './br-receita-cnpj-file-reader';
import {
  BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
  BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
  type BrReceitaCnpjManifestFileReport,
} from './br-receita-cnpj-manifest';
import { validateBrReceitaCnpjLocalManifest } from './br-receita-cnpj-manifest-validator';
import {
  BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_LAYOUT_MODE,
  BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_HEADER_BYTES,
  BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  BR_RECEITA_CNPJ_PRIVACY_MAX_COVERAGE_SCAN_BYTES,
  BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT,
  BR_RECEITA_PRIVACY_ELIGIBILITY_STATUSES,
  classifyRow,
  eligibilityStatusForReason,
  readBoundedSampleLines,
  readValidatedManifestDescriptors,
  splitDelimitedCells,
  type BrReceitaCnpjPrivacyEligibilityPolicy,
  type BrReceitaPrivacyEligibilityStatus,
  type ClassifierFileDescriptor,
} from './br-receita-cnpj-privacy-safe-classifier';

// ─── Public constants ────────────────────────────────────────────────────────

export const BR_RECEITA_CNPJ_JOIN_DRY_RUN_MODE =
  'company_establishment_join_bounded_dry_run' as const;
export const BR_RECEITA_CNPJ_JOIN_DRY_RUN_LAYOUT_MODE =
  BR_RECEITA_CNPJ_PRIVACY_CLASSIFIER_LAYOUT_MODE;

/** EMPRESAS / ESTABELECIMENTOS both carry the structural join key at position 0. */
const CNPJ_BASICO_JOIN_KEY_INDEX = 0;

// ─── Sampling strategy (BR-SOURCE-10H) ─────────────────────────────────────────

/**
 * How the two bounded samples are chosen for the join.
 *
 *  - `first_rows` (the BR-SOURCE-10G behaviour, and the default): read the first N
 *    empresas rows into the index, then the first M estabelecimentos rows, and join
 *    within those two independent linear prefixes. BR-SOURCE-10G proved these two
 *    prefixes almost never overlap (a linear sample of each file is a poor coverage
 *    probe), which is exactly why 10H adds a coverage-oriented alternative.
 *
 *  - `establishment_keys_then_company_probe` (BR-SOURCE-10H): read a bounded set of
 *    estabelecimentos rows FIRST, collect their STRUCTURAL join keys into an
 *    ephemeral in-memory set (never printed / returned / hashed / persisted), then
 *    scan empresas rows in a BOUNDED window (`maxCompanyScanRows`, hard-capped) that
 *    is deeper than the 20-row sample, indexing ONLY companies whose key was in that
 *    set. This measures how much company context a *slightly deeper* bounded scan
 *    can recover — a technical coverage probe, never import readiness.
 */
export type BrReceitaCnpjJoinSamplingStrategy =
  | 'first_rows'
  | 'establishment_keys_then_company_probe';

export const BR_RECEITA_CNPJ_JOIN_SAMPLING_STRATEGIES: readonly BrReceitaCnpjJoinSamplingStrategy[] =
  ['first_rows', 'establishment_keys_then_company_probe'];

/** The default strategy is the BR-SOURCE-10G behaviour (backward-compatible). */
export const BR_RECEITA_CNPJ_JOIN_DEFAULT_SAMPLING_STRATEGY: BrReceitaCnpjJoinSamplingStrategy =
  'first_rows';

/**
 * Default number of empresas rows the coverage probe scans (deeper than the 20-row
 * sample, but still a tiny bounded prefix). Conservative on purpose.
 */
export const BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS = 1000 as const;
/**
 * Absolute hard ceiling on the coverage-scan window. A request above this is a
 * fail-closed error — the scan can NEVER approach the full multi-million-row dataset.
 */
export const BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT = 5000 as const;

// ─── Join statuses & reasons ──────────────────────────────────────────────────

/**
 * The join verdict assigned to each sampled establishment. Exactly one is assigned
 * per establishment. NONE is importable in this hito: `joined_with_sampled_company_context`
 * only means a company context was found WITHIN the bounded sample — a full-dataset
 * join and a separate legal GO are still required before any import.
 */
export type BrReceitaJoinDryRunEstablishmentJoinStatus =
  | 'joined_with_sampled_company_context'
  | 'missing_sampled_company_context'
  | 'excluded_due_to_company_context'
  | 'excluded_due_to_establishment_privacy_signal'
  | 'pending_full_join_context';

export const BR_RECEITA_JOIN_DRY_RUN_ESTABLISHMENT_JOIN_STATUSES: readonly BrReceitaJoinDryRunEstablishmentJoinStatus[] =
  [
    'joined_with_sampled_company_context',
    'missing_sampled_company_context',
    'excluded_due_to_company_context',
    'excluded_due_to_establishment_privacy_signal',
    'pending_full_join_context',
  ];

/**
 * Machine reason codes for a join verdict (no personal value is ever embedded).
 * `bounded_sample_only_not_importable` is the standing caveat that this whole mode
 * proves nothing importable; it is declared for completeness and stays 0 in the
 * per-row path (every establishment resolves to a more specific reason).
 */
export type BrReceitaJoinDryRunReason =
  | 'sampled_company_context_found'
  | 'sampled_company_context_missing'
  | 'company_context_person_or_pii_risk'
  | 'company_context_needs_legal_review'
  | 'establishment_privacy_signal_detected'
  | 'establishment_requires_full_join_context'
  | 'coverage_scan_limit_reached'
  | 'bounded_sample_only_not_importable';

export const BR_RECEITA_JOIN_DRY_RUN_REASONS: readonly BrReceitaJoinDryRunReason[] = [
  'sampled_company_context_found',
  'sampled_company_context_missing',
  'company_context_person_or_pii_risk',
  'company_context_needs_legal_review',
  'establishment_privacy_signal_detected',
  'establishment_requires_full_join_context',
  'coverage_scan_limit_reached',
  'bounded_sample_only_not_importable',
];

type JoinStatusCounts = Record<BrReceitaJoinDryRunEstablishmentJoinStatus, number>;
type JoinReasonCounts = Record<BrReceitaJoinDryRunReason, number>;
type EligibilityStatusCounts = Record<BrReceitaPrivacyEligibilityStatus, number>;

function emptyJoinStatusCounts(): JoinStatusCounts {
  const counts = {} as JoinStatusCounts;
  for (const status of BR_RECEITA_JOIN_DRY_RUN_ESTABLISHMENT_JOIN_STATUSES) counts[status] = 0;
  return counts;
}

function emptyJoinReasonCounts(): JoinReasonCounts {
  const counts = {} as JoinReasonCounts;
  for (const reason of BR_RECEITA_JOIN_DRY_RUN_REASONS) counts[reason] = 0;
  return counts;
}

function emptyEligibilityStatusCounts(): EligibilityStatusCounts {
  const counts = {} as EligibilityStatusCounts;
  for (const status of BR_RECEITA_PRIVACY_ELIGIBILITY_STATUSES) counts[status] = 0;
  return counts;
}

// ─── Ephemeral in-memory company index (join key NEVER surfaced) ──────────────

/**
 * How a sampled company's context resolves for the join. `usable_context` means a
 * clean, join-usable company (eligible OR held-for-legal-review); the two blocked
 * kinds mean the company itself is excluded, so an establishment joining it is
 * excluded by association.
 */
type CompanyContextKind =
  | 'usable_context'
  | 'blocked_company_privacy_signal'
  | 'blocked_company_legal_nature';

/**
 * The value stored in the ephemeral index. It carries ONLY a machine context kind
 * — never the join key (the key is the Map KEY, used in memory and discarded), and
 * never a row, value, or CNPJ.
 */
interface CompanyIndexEntry {
  readonly contextKind: CompanyContextKind;
}

/** Company statuses that make a company's context BLOCKED for a positive join. */
const BLOCKED_PRIVACY_COMPANY_STATUSES: ReadonlySet<BrReceitaPrivacyEligibilityStatus> = new Set([
  'excluded_person_or_pii_risk',
  'excluded_forbidden_token',
  'excluded_forbidden_file_family',
]);

/** Establishment statuses that flag an establishment's OWN privacy/structural signal. */
const ESTABLISHMENT_OWN_PRIVACY_STATUSES: ReadonlySet<BrReceitaPrivacyEligibilityStatus> = new Set([
  'excluded_person_or_pii_risk',
  'excluded_forbidden_token',
  'excluded_forbidden_file_family',
  'excluded_guard_triggered',
]);

/** Derives the join context kind from a company's per-row eligibility status. */
function companyContextKind(status: BrReceitaPrivacyEligibilityStatus): CompanyContextKind {
  if (BLOCKED_PRIVACY_COMPANY_STATUSES.has(status)) return 'blocked_company_privacy_signal';
  if (status === 'excluded_unsupported_legal_nature') return 'blocked_company_legal_nature';
  // eligible_for_future_import / needs_legal_review → a real, join-usable company.
  return 'usable_context';
}

// ─── Options / result shapes ───────────────────────────────────────────────────

export interface BrReceitaCnpjJoinDryRunOptions {
  /** Local path to the manifest JSON (never a URL, never a CSV/ZIP). */
  manifestPath: string;
  /** MUST be true to read the described local files (fail-closed otherwise). */
  allowLocalManifest: boolean;
  /** Treat unknown, non-sensitive headers as errors (default false). */
  strict?: boolean;
  /**
   * Which bounded sampling strategy to use (default `first_rows`, the 10G
   * behaviour). An unrecognized value is a fail-closed error.
   */
  samplingStrategy?: BrReceitaCnpjJoinSamplingStrategy;
  /** Company rows sampled (default 5, hard max 20). */
  maxCompanyRows?: number;
  /** Establishment rows sampled (default 5, hard max 20). */
  maxEstablishmentRows?: number;
  /**
   * Coverage-scan window for `establishment_keys_then_company_probe`: how many
   * empresas rows the probe may scan looking for the sampled establishments'
   * company context (default 1000, hard max 5000). Ignored by `first_rows`.
   */
  maxCompanyScanRows?: number;
  /** Ceiling on bytes read to collect each file's bounded sample. */
  maxHeaderBytes?: number;
  /** Optional legal-nature policy (unset = nothing eligible; see classifier). */
  eligibilityPolicy?: BrReceitaCnpjPrivacyEligibilityPolicy;
  /** When true, `ok` is false if ANY privacy exclusion was counted (default false). */
  failOnAnyPrivacyExclusion?: boolean;
}

/** All-false safety block asserted on every join dry-run result. */
export interface BrReceitaCnpjJoinDryRunSafety {
  datasetDownload: false;
  supabaseWrite: false;
  productionImport: false;
  runtimeIntegration: false;
  agent1Integration: false;
  hubspot: false;
  slack: false;
  liveProspectGeneration: false;
  rawRowsPrinted: false;
  personalValuesPrinted: false;
  joinKeysPrinted: false;
  establishmentKeysPrinted: false;
}

const JOIN_SAFETY_ALL_FALSE: BrReceitaCnpjJoinDryRunSafety = {
  datasetDownload: false,
  supabaseWrite: false,
  productionImport: false,
  runtimeIntegration: false,
  agent1Integration: false,
  hubspot: false,
  slack: false,
  liveProspectGeneration: false,
  rawRowsPrinted: false,
  personalValuesPrinted: false,
  joinKeysPrinted: false,
  establishmentKeysPrinted: false,
};

/**
 * Bounded-scan coverage interpretation (BR-SOURCE-10H). `coverageIsRepresentative`
 * is HARD-WIRED false in this hito: no full dataset is processed, no approved
 * statistical sample is drawn, and no index is persisted, so the result is a
 * bounded technical coverage probe — NEVER import / runtime / Agent 1 / market
 * coverage readiness.
 */
export interface BrReceitaCnpjJoinCoverageSummary {
  establishmentsWithCompanyContextInBoundedScan: number;
  establishmentsWithoutCompanyContextInBoundedScan: number;
  coverageScanLimitReached: boolean;
  coverageIsRepresentative: false;
}

export interface BrReceitaCnpjJoinDryRunResult {
  ok: boolean;
  mode: typeof BR_RECEITA_CNPJ_JOIN_DRY_RUN_MODE;
  sourceKey: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  countryCode: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  sourceYear: number;
  sourcePeriod: string;
  manifestValidation: 'passed' | 'failed';
  layoutMode: typeof BR_RECEITA_CNPJ_JOIN_DRY_RUN_LAYOUT_MODE;
  samplingStrategy: BrReceitaCnpjJoinSamplingStrategy;
  maxCompanyRows: number;
  maxEstablishmentRows: number;
  maxCompanyScanRows: number;
  companiesSampled: number;
  companiesScannedForCoverage: number;
  companiesIndexedForJoin: number;
  companiesExcludedFromJoin: number;
  establishmentsSampled: number;
  establishmentKeysCollectedInMemory: number;
  establishmentKeysPrinted: false;
  joinCounts: JoinStatusCounts;
  joinReasonCounts: JoinReasonCounts;
  companyClassificationCounts: EligibilityStatusCounts;
  establishmentClassificationCounts: EligibilityStatusCounts;
  coverageSummary: BrReceitaCnpjJoinCoverageSummary;
  fullDatasetProcessed: false;
  importExecuted: false;
  supabaseWrite: false;
  runtimeIntegration: false;
  agent1Integration: false;
  rejectionReasons: string[];
  safety: BrReceitaCnpjJoinDryRunSafety;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type BrReceitaCnpjJoinDryRunErrorCode =
  | 'allow_local_manifest_required'
  | 'sample_row_limit_exceeded'
  | 'company_scan_row_limit_exceeded'
  | 'invalid_sampling_strategy'
  | 'full_dataset_processing_not_allowed';

/** Raised when the join dry-run's safety contract is violated (bad gate / limit). */
export class BrReceitaCnpjJoinDryRunError extends Error {
  readonly reasonCode: BrReceitaCnpjJoinDryRunErrorCode;
  constructor(reasonCode: BrReceitaCnpjJoinDryRunErrorCode, detail: string) {
    super(`BRSOURCE10G_FORBIDDEN_JOIN_DRY_RUN_MODE: ${reasonCode} — ${detail}`);
    this.name = 'BrReceitaCnpjJoinDryRunError';
    this.reasonCode = reasonCode;
  }
}

// ─── Option validation (fail-closed gates) ────────────────────────────────────

function assertBoundedRowLimit(label: string, requested: number): number {
  if (!Number.isFinite(requested)) {
    throw new BrReceitaCnpjJoinDryRunError(
      'full_dataset_processing_not_allowed',
      `${label} must be a finite, bounded integer`,
    );
  }
  if (!Number.isInteger(requested) || requested < 0) {
    throw new BrReceitaCnpjJoinDryRunError(
      'sample_row_limit_exceeded',
      `${label} must be a non-negative integer, got "${requested}"`,
    );
  }
  if (requested > BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT) {
    throw new BrReceitaCnpjJoinDryRunError(
      'sample_row_limit_exceeded',
      `${label} (${requested}) exceeds the hard limit of ${BR_RECEITA_CNPJ_PRIVACY_MAX_SAMPLE_ROWS_LIMIT}`,
    );
  }
  return requested;
}

/**
 * Validates the coverage-scan window: a non-negative integer, hard-capped at
 * `BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT`. This is the extra bound that
 * guarantees the probe can never process the full dataset.
 */
function assertCompanyScanRowLimit(requested: number): number {
  if (!Number.isFinite(requested)) {
    throw new BrReceitaCnpjJoinDryRunError(
      'full_dataset_processing_not_allowed',
      'maxCompanyScanRows must be a finite, bounded integer',
    );
  }
  if (!Number.isInteger(requested) || requested < 0) {
    throw new BrReceitaCnpjJoinDryRunError(
      'company_scan_row_limit_exceeded',
      `maxCompanyScanRows must be a non-negative integer, got "${requested}"`,
    );
  }
  if (requested > BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT) {
    throw new BrReceitaCnpjJoinDryRunError(
      'company_scan_row_limit_exceeded',
      `maxCompanyScanRows (${requested}) exceeds the hard limit of ${BR_RECEITA_CNPJ_JOIN_MAX_COMPANY_SCAN_ROWS_LIMIT}`,
    );
  }
  return requested;
}

function assertSamplingStrategy(
  strategy: BrReceitaCnpjJoinSamplingStrategy | undefined,
): BrReceitaCnpjJoinSamplingStrategy {
  const resolved = strategy ?? BR_RECEITA_CNPJ_JOIN_DEFAULT_SAMPLING_STRATEGY;
  if (!BR_RECEITA_CNPJ_JOIN_SAMPLING_STRATEGIES.includes(resolved)) {
    throw new BrReceitaCnpjJoinDryRunError(
      'invalid_sampling_strategy',
      `unrecognized samplingStrategy "${String(resolved)}" (expected one of: ${BR_RECEITA_CNPJ_JOIN_SAMPLING_STRATEGIES.join(', ')})`,
    );
  }
  return resolved;
}

interface JoinGateResult {
  readonly samplingStrategy: BrReceitaCnpjJoinSamplingStrategy;
  readonly maxCompanyRows: number;
  readonly maxEstablishmentRows: number;
  readonly maxCompanyScanRows: number;
}

function assertJoinGatesOrThrow(options: BrReceitaCnpjJoinDryRunOptions): JoinGateResult {
  if (!options.allowLocalManifest) {
    throw new BrReceitaCnpjJoinDryRunError(
      'allow_local_manifest_required',
      'reading local files requires allowLocalManifest: true',
    );
  }
  const samplingStrategy = assertSamplingStrategy(options.samplingStrategy);
  const maxCompanyRows = assertBoundedRowLimit(
    'maxCompanyRows',
    options.maxCompanyRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  );
  const maxEstablishmentRows = assertBoundedRowLimit(
    'maxEstablishmentRows',
    options.maxEstablishmentRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  );
  const maxCompanyScanRows = assertCompanyScanRowLimit(
    options.maxCompanyScanRows ?? BR_RECEITA_CNPJ_JOIN_DEFAULT_MAX_COMPANY_SCAN_ROWS,
  );
  return { samplingStrategy, maxCompanyRows, maxEstablishmentRows, maxCompanyScanRows };
}

// ─── Bounded sampling helpers (reuse the classifier's bounded reader) ──────────

/**
 * Reads at most `maxRows` non-empty delimited rows from one accepted file. Returns
 * split cell arrays that are scanned in memory and discarded; the caller must never
 * surface their content. `null` on a bounded-read failure (recorded as a rejection).
 */
async function readSampleRows(
  descriptor: ClassifierFileDescriptor,
  maxRows: number,
  maxHeaderBytes: number,
): Promise<string[][] | null> {
  try {
    const outcome = await readBoundedSampleLines(
      descriptor.resolvedPath,
      descriptor.encoding,
      maxRows,
      maxHeaderBytes,
    );
    if (outcome.limitExceeded) return null;
    const rows: string[][] = [];
    for (const line of outcome.lines) {
      if (line.trim() === '') continue;
      rows.push(splitDelimitedCells(line, descriptor.delimiter));
    }
    return rows;
  } catch {
    return null;
  }
}

interface CoverageScanRead {
  readonly rows: string[][];
  /** True when the read stopped at the row cap (i.e. more rows exist beyond it). */
  readonly capReached: boolean;
}

/**
 * Reads a BOUNDED coverage-scan window of at most `maxScanRows` company rows, using
 * the larger (but still hard-capped) coverage-scan byte budget. Returns split cell
 * arrays scanned in memory and discarded, plus whether the row cap was hit. `null`
 * on a bounded-read failure (recorded as a rejection). Still a tiny prefix of a
 * multi-GB file — never the full dataset.
 */
async function readCompanyScanRows(
  descriptor: ClassifierFileDescriptor,
  maxScanRows: number,
  maxHeaderBytes: number,
): Promise<CoverageScanRead | null> {
  try {
    const outcome = await readBoundedSampleLines(
      descriptor.resolvedPath,
      descriptor.encoding,
      maxScanRows,
      maxHeaderBytes,
      BR_RECEITA_CNPJ_PRIVACY_MAX_COVERAGE_SCAN_BYTES,
    );
    if (outcome.limitExceeded) return null;
    const rows: string[][] = [];
    for (const line of outcome.lines) {
      if (line.trim() === '') continue;
      rows.push(splitDelimitedCells(line, descriptor.delimiter));
    }
    // The reader returns at most `maxScanRows` lines; hitting that count means the
    // window closed on the row cap, so the company may well appear further down.
    return { rows, capReached: outcome.lines.length >= maxScanRows };
  } catch {
    return null;
  }
}

// ─── Per-establishment join verdict (pure) ────────────────────────────────────

interface JoinVerdict {
  readonly status: BrReceitaJoinDryRunEstablishmentJoinStatus;
  readonly reason: BrReceitaJoinDryRunReason;
}

/**
 * Resolves the join verdict for ONE establishment, given its own per-row status,
 * the ephemeral company index, and whether the company sample indexed anything.
 * Pure and value-free: `companyContext` is a machine context kind (never a value),
 * and the join key is consumed by the CALLER (a Map lookup) — never passed here.
 */
function resolveEstablishmentJoinVerdict(
  establishmentStatus: BrReceitaPrivacyEligibilityStatus,
  companyIndexIsEmpty: boolean,
  hasJoinKey: boolean,
  companyContext: CompanyIndexEntry | undefined,
): JoinVerdict {
  // 1) The establishment's OWN privacy/structural signal pre-empts any join.
  if (ESTABLISHMENT_OWN_PRIVACY_STATUSES.has(establishmentStatus)) {
    return {
      status: 'excluded_due_to_establishment_privacy_signal',
      reason: 'establishment_privacy_signal_detected',
    };
  }
  // 2) No company context could be sampled at all (or no usable join key) — the
  //    establishment genuinely needs the FULL company join, unavailable here.
  if (companyIndexIsEmpty || !hasJoinKey) {
    return {
      status: 'pending_full_join_context',
      reason: 'establishment_requires_full_join_context',
    };
  }
  // 3) The company was not among the bounded company sample.
  if (companyContext === undefined) {
    return {
      status: 'missing_sampled_company_context',
      reason: 'sampled_company_context_missing',
    };
  }
  // 4) A company context was found — its kind decides the verdict.
  switch (companyContext.contextKind) {
    case 'usable_context':
      return {
        status: 'joined_with_sampled_company_context',
        reason: 'sampled_company_context_found',
      };
    case 'blocked_company_privacy_signal':
      return {
        status: 'excluded_due_to_company_context',
        reason: 'company_context_person_or_pii_risk',
      };
    case 'blocked_company_legal_nature':
      return {
        status: 'excluded_due_to_company_context',
        reason: 'company_context_needs_legal_review',
      };
  }
}

// ─── Accepted-file descriptor resolution ──────────────────────────────────────

interface AcceptedJoinFile {
  readonly fileType: BrReceitaCnpjLayoutFileType;
  readonly descriptor: ClassifierFileDescriptor;
}

/**
 * Picks the accepted descriptor for a single layout family (empresas |
 * estabelecimentos) from the validated file reports, or `null` if that family was
 * not present / not accepted. Only these two families participate in the join;
 * reference/regime lookups are never sampled here (they are not company rows).
 */
function pickAcceptedFile(
  fileType: 'empresas' | 'estabelecimentos',
  fileReports: readonly BrReceitaCnpjManifestFileReport[],
  descriptorByType: ReadonlyMap<string, ClassifierFileDescriptor>,
): AcceptedJoinFile | null {
  const report = fileReports.find((r) => r.fileType === fileType && r.status === 'accepted');
  if (report === undefined) return null;
  const descriptor = descriptorByType.get(fileType);
  if (descriptor === undefined) return null;
  return { fileType, descriptor };
}

function joinKeyOf(cells: readonly string[]): string {
  return (cells[CNPJ_BASICO_JOIN_KEY_INDEX] ?? '').trim();
}

// ─── Sampling strategies (shared inputs / outcome) ─────────────────────────────

/** Everything a sampling strategy needs to read and score its bounded windows. */
interface SamplingContext {
  readonly fileReports: readonly BrReceitaCnpjManifestFileReport[];
  readonly descriptorByType: ReadonlyMap<string, ClassifierFileDescriptor>;
  readonly maxCompanyRows: number;
  readonly maxEstablishmentRows: number;
  readonly maxCompanyScanRows: number;
  readonly maxHeaderBytes: number;
  readonly eligibilityPolicy?: BrReceitaCnpjPrivacyEligibilityPolicy;
}

/** The sanitized aggregate outcome of a sampling strategy (no value ever carried). */
interface JoinSamplingOutcome {
  companiesSampled: number;
  companiesScannedForCoverage: number;
  companiesIndexedForJoin: number;
  companiesExcludedFromJoin: number;
  establishmentsSampled: number;
  establishmentKeysCollectedInMemory: number;
  joinCounts: JoinStatusCounts;
  joinReasonCounts: JoinReasonCounts;
  companyClassificationCounts: EligibilityStatusCounts;
  establishmentClassificationCounts: EligibilityStatusCounts;
  coverageScanLimitReached: boolean;
  rejectionReasons: string[];
}

function emptyOutcome(): JoinSamplingOutcome {
  return {
    companiesSampled: 0,
    companiesScannedForCoverage: 0,
    companiesIndexedForJoin: 0,
    companiesExcludedFromJoin: 0,
    establishmentsSampled: 0,
    establishmentKeysCollectedInMemory: 0,
    joinCounts: emptyJoinStatusCounts(),
    joinReasonCounts: emptyJoinReasonCounts(),
    companyClassificationCounts: emptyEligibilityStatusCounts(),
    establishmentClassificationCounts: emptyEligibilityStatusCounts(),
    coverageScanLimitReached: false,
    rejectionReasons: [],
  };
}

/**
 * BR-SOURCE-10G `first_rows` strategy: index the first N empresas rows, then join
 * the first M estabelecimentos rows within that index. Coverage-scan fields stay 0 /
 * false (this strategy performs NO deeper coverage scan). Byte-for-byte equivalent
 * to the pre-10H behaviour.
 */
async function runFirstRowsSampling(ctx: SamplingContext): Promise<JoinSamplingOutcome> {
  const out = emptyOutcome();

  // ── Pass 1: build the ephemeral company index (join key held in memory only) ──
  const companyIndex = new Map<string, CompanyIndexEntry>();
  const empresasFile = pickAcceptedFile('empresas', ctx.fileReports, ctx.descriptorByType);
  if (empresasFile !== null) {
    const rows = await readSampleRows(empresasFile.descriptor, ctx.maxCompanyRows, ctx.maxHeaderBytes);
    if (rows === null) {
      out.rejectionReasons.push('empresas:sample_read_failed');
    } else {
      const expectedColumns = getBrReceitaCnpjOfficialColumnCount('empresas');
      for (const cells of rows) {
        out.companiesSampled += 1;
        const rc = classifyRow('empresas', 'company', cells, expectedColumns, ctx.eligibilityPolicy);
        const status = eligibilityStatusForReason(rc.reason);
        out.companyClassificationCounts[status] += 1;

        const key = joinKeyOf(cells);
        if (status === 'excluded_guard_triggered' || key === '') {
          out.companiesExcludedFromJoin += 1;
          continue;
        }
        const contextKind = companyContextKind(status);
        companyIndex.set(key, { contextKind });
        if (contextKind === 'usable_context') out.companiesIndexedForJoin += 1;
        else out.companiesExcludedFromJoin += 1;
      }
    }
  }

  // ── Pass 2: associate each sampled establishment to its company context ──
  const companyIndexIsEmpty = companyIndex.size === 0;
  const estabFile = pickAcceptedFile('estabelecimentos', ctx.fileReports, ctx.descriptorByType);
  if (estabFile !== null) {
    const rows = await readSampleRows(estabFile.descriptor, ctx.maxEstablishmentRows, ctx.maxHeaderBytes);
    if (rows === null) {
      out.rejectionReasons.push('estabelecimentos:sample_read_failed');
    } else {
      const expectedColumns = getBrReceitaCnpjOfficialColumnCount('estabelecimentos');
      for (const cells of rows) {
        out.establishmentsSampled += 1;
        const rc = classifyRow('estabelecimentos', 'company', cells, expectedColumns, ctx.eligibilityPolicy);
        const status = eligibilityStatusForReason(rc.reason);
        out.establishmentClassificationCounts[status] += 1;

        const key = joinKeyOf(cells);
        const hasJoinKey = key !== '';
        const companyContext = hasJoinKey ? companyIndex.get(key) : undefined;
        const verdict = resolveEstablishmentJoinVerdict(status, companyIndexIsEmpty, hasJoinKey, companyContext);
        out.joinCounts[verdict.status] += 1;
        out.joinReasonCounts[verdict.reason] += 1;
      }
    }
  }
  return out;
}

/** A sampled establishment's machine-only footprint (no value ever surfaced). */
interface ProbeEstablishment {
  readonly status: BrReceitaPrivacyEligibilityStatus;
  readonly key: string;
  readonly hasJoinKey: boolean;
}

/**
 * BR-SOURCE-10H `establishment_keys_then_company_probe` strategy: sample
 * estabelecimentos FIRST, collect their structural join keys into an ephemeral set,
 * then scan a BOUNDED (hard-capped) window of empresas rows indexing ONLY companies
 * whose key was requested. Measures how much company context a slightly deeper
 * bounded scan recovers — a technical coverage probe, never import readiness. The
 * join keys live only in memory (a Set + a Map) and are discarded on return.
 */
async function runEstablishmentProbeSampling(ctx: SamplingContext): Promise<JoinSamplingOutcome> {
  const out = emptyOutcome();

  // ── Pass 1: sample establishments, classify, collect their structural keys ──
  const sampled: ProbeEstablishment[] = [];
  const establishmentKeySet = new Set<string>();
  const estabFile = pickAcceptedFile('estabelecimentos', ctx.fileReports, ctx.descriptorByType);
  if (estabFile !== null) {
    const rows = await readSampleRows(estabFile.descriptor, ctx.maxEstablishmentRows, ctx.maxHeaderBytes);
    if (rows === null) {
      out.rejectionReasons.push('estabelecimentos:sample_read_failed');
    } else {
      const expectedColumns = getBrReceitaCnpjOfficialColumnCount('estabelecimentos');
      for (const cells of rows) {
        out.establishmentsSampled += 1;
        const rc = classifyRow('estabelecimentos', 'company', cells, expectedColumns, ctx.eligibilityPolicy);
        const status = eligibilityStatusForReason(rc.reason);
        out.establishmentClassificationCounts[status] += 1;

        const key = joinKeyOf(cells);
        const hasJoinKey = key !== '';
        // Only probe for establishments that could actually join — an establishment
        // pre-empted by its OWN privacy signal never needs company context.
        if (hasJoinKey && !ESTABLISHMENT_OWN_PRIVACY_STATUSES.has(status)) {
          establishmentKeySet.add(key);
        }
        sampled.push({ status, key, hasJoinKey });
      }
    }
  }
  out.establishmentKeysCollectedInMemory = establishmentKeySet.size;

  // ── Pass 2: bounded coverage scan of empresas, indexing ONLY requested keys ──
  const companyIndex = new Map<string, CompanyIndexEntry>();
  const empresasFile = pickAcceptedFile('empresas', ctx.fileReports, ctx.descriptorByType);
  if (empresasFile !== null && establishmentKeySet.size > 0) {
    const scan = await readCompanyScanRows(empresasFile.descriptor, ctx.maxCompanyScanRows, ctx.maxHeaderBytes);
    if (scan === null) {
      out.rejectionReasons.push('empresas:coverage_scan_read_failed');
    } else {
      const expectedColumns = getBrReceitaCnpjOfficialColumnCount('empresas');
      const foundKeys = new Set<string>();
      for (const cells of scan.rows) {
        out.companiesScannedForCoverage += 1;
        out.companiesSampled += 1;
        const rc = classifyRow('empresas', 'company', cells, expectedColumns, ctx.eligibilityPolicy);
        const status = eligibilityStatusForReason(rc.reason);
        out.companyClassificationCounts[status] += 1;

        const key = joinKeyOf(cells);
        if (
          status !== 'excluded_guard_triggered' &&
          key !== '' &&
          establishmentKeySet.has(key) &&
          !companyIndex.has(key)
        ) {
          const contextKind = companyContextKind(status);
          companyIndex.set(key, { contextKind });
          if (contextKind === 'usable_context') out.companiesIndexedForJoin += 1;
          else out.companiesExcludedFromJoin += 1;
          foundKeys.add(key);
          if (foundKeys.size >= establishmentKeySet.size) break; // every key covered
        }
      }
      // Limit reached only if the window closed on its row cap without covering all.
      out.coverageScanLimitReached = scan.capReached && foundKeys.size < establishmentKeySet.size;
    }
  }

  // ── Pass 3: associate each sampled establishment to its probed company context ──
  const companyIndexIsEmpty = companyIndex.size === 0;
  for (const est of sampled) {
    const companyContext = est.hasJoinKey ? companyIndex.get(est.key) : undefined;
    const verdict = resolveEstablishmentJoinVerdict(
      est.status,
      companyIndexIsEmpty,
      est.hasJoinKey,
      companyContext,
    );
    // Coverage caveat: when the bounded scan closed on its cap and a KEYED
    // establishment's company context was not found, attribute the miss to the scan
    // limit (honest: the company may appear deeper in the file) rather than to an
    // absolute absence. Status stays honest; only the reason reflects the caveat.
    const reason =
      out.coverageScanLimitReached &&
      est.hasJoinKey &&
      (verdict.status === 'missing_sampled_company_context' ||
        verdict.status === 'pending_full_join_context')
        ? 'coverage_scan_limit_reached'
        : verdict.reason;
    out.joinCounts[verdict.status] += 1;
    out.joinReasonCounts[reason] += 1;
  }
  return out;
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Runs a bounded, sanitized, privacy-safe company↔establishment JOIN dry-run over a
 * Receita CNPJ manifest. Validates the manifest (authoritative), requires every
 * accepted file to be `official_headerless`, samples a bounded set of empresas rows
 * into an EPHEMERAL in-memory index keyed by the structural join id, then samples a
 * bounded set of estabelecimentos rows and associates each to its company context.
 * Emits ONLY aggregate counts — never a row, a value, a full CNPJ, a CNPJ básico, a
 * CPF, an email, a phone, an address, or the JOIN KEY itself.
 */
export async function runBrReceitaCnpjCompanyEstablishmentJoinDryRun(
  options: BrReceitaCnpjJoinDryRunOptions,
): Promise<BrReceitaCnpjJoinDryRunResult> {
  const { samplingStrategy, maxCompanyRows, maxEstablishmentRows, maxCompanyScanRows } =
    assertJoinGatesOrThrow(options);
  const strict = options.strict ?? false;
  const maxHeaderBytes =
    options.maxHeaderBytes && options.maxHeaderBytes > 0
      ? options.maxHeaderBytes
      : BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_HEADER_BYTES;

  const validation = await validateBrReceitaCnpjLocalManifest({
    manifestPath: options.manifestPath,
    strict,
    allowRealLocalFiles: true,
    maxHeaderBytes,
  });

  const emptyCoverage: BrReceitaCnpjJoinCoverageSummary = {
    establishmentsWithCompanyContextInBoundedScan: 0,
    establishmentsWithoutCompanyContextInBoundedScan: 0,
    coverageScanLimitReached: false,
    coverageIsRepresentative: false,
  };

  const base = {
    mode: BR_RECEITA_CNPJ_JOIN_DRY_RUN_MODE,
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear: validation.sourceYear,
    sourcePeriod: validation.sourcePeriod,
    layoutMode: BR_RECEITA_CNPJ_JOIN_DRY_RUN_LAYOUT_MODE,
    samplingStrategy,
    maxCompanyRows,
    maxEstablishmentRows,
    maxCompanyScanRows,
    companiesSampled: 0,
    companiesScannedForCoverage: 0,
    companiesIndexedForJoin: 0,
    companiesExcludedFromJoin: 0,
    establishmentsSampled: 0,
    establishmentKeysCollectedInMemory: 0,
    establishmentKeysPrinted: false as const,
    joinCounts: emptyJoinStatusCounts(),
    joinReasonCounts: emptyJoinReasonCounts(),
    companyClassificationCounts: emptyEligibilityStatusCounts(),
    establishmentClassificationCounts: emptyEligibilityStatusCounts(),
    coverageSummary: emptyCoverage,
    fullDatasetProcessed: false as const,
    importExecuted: false as const,
    supabaseWrite: false as const,
    runtimeIntegration: false as const,
    agent1Integration: false as const,
    safety: JOIN_SAFETY_ALL_FALSE,
  };

  // Manifest validation failed → join dry-run fails safely, no sampling.
  if (!validation.ok) {
    const rejectionReasons: string[] = [];
    if (validation.reasonCode) rejectionReasons.push(validation.reasonCode);
    for (const r of validation.fileReports) {
      if (r.status === 'rejected' && r.reasonCode) {
        rejectionReasons.push(`${r.fileType}:${r.reasonCode}`);
      }
    }
    return { ...base, ok: false, manifestValidation: 'failed', rejectionReasons };
  }

  // Real-file join dry-run: every ACCEPTED file MUST be official_headerless.
  const nonHeaderless = validation.fileReports.filter(
    (r) => r.status === 'accepted' && r.layoutMode !== BR_RECEITA_CNPJ_JOIN_DRY_RUN_LAYOUT_MODE,
  );
  if (nonHeaderless.length > 0) {
    return {
      ...base,
      ok: false,
      manifestValidation: 'passed',
      rejectionReasons: nonHeaderless.map((r) => `${r.fileType}:layout_mode_not_official_headerless`),
    };
  }

  const descriptors = await readValidatedManifestDescriptors(options.manifestPath);
  const descriptorByType = new Map<string, ClassifierFileDescriptor>();
  for (const d of descriptors) descriptorByType.set(d.fileType, d);

  const ctx: SamplingContext = {
    fileReports: validation.fileReports,
    descriptorByType,
    maxCompanyRows,
    maxEstablishmentRows,
    maxCompanyScanRows,
    maxHeaderBytes,
    ...(options.eligibilityPolicy !== undefined
      ? { eligibilityPolicy: options.eligibilityPolicy }
      : {}),
  };

  const outcome =
    samplingStrategy === 'establishment_keys_then_company_probe'
      ? await runEstablishmentProbeSampling(ctx)
      : await runFirstRowsSampling(ctx);

  const withCompanyContext =
    outcome.joinCounts.joined_with_sampled_company_context +
    outcome.joinCounts.excluded_due_to_company_context;
  const coverageSummary: BrReceitaCnpjJoinCoverageSummary = {
    establishmentsWithCompanyContextInBoundedScan: withCompanyContext,
    establishmentsWithoutCompanyContextInBoundedScan:
      outcome.establishmentsSampled - withCompanyContext,
    coverageScanLimitReached: outcome.coverageScanLimitReached,
    coverageIsRepresentative: false,
  };

  const anyPrivacyExclusion =
    outcome.joinCounts.excluded_due_to_establishment_privacy_signal +
      outcome.joinCounts.excluded_due_to_company_context >
    0;
  const ok =
    outcome.rejectionReasons.length === 0 &&
    !(options.failOnAnyPrivacyExclusion === true && anyPrivacyExclusion);

  return {
    ...base,
    ok,
    manifestValidation: 'passed',
    companiesSampled: outcome.companiesSampled,
    companiesScannedForCoverage: outcome.companiesScannedForCoverage,
    companiesIndexedForJoin: outcome.companiesIndexedForJoin,
    companiesExcludedFromJoin: outcome.companiesExcludedFromJoin,
    establishmentsSampled: outcome.establishmentsSampled,
    establishmentKeysCollectedInMemory: outcome.establishmentKeysCollectedInMemory,
    joinCounts: outcome.joinCounts,
    joinReasonCounts: outcome.joinReasonCounts,
    companyClassificationCounts: outcome.companyClassificationCounts,
    establishmentClassificationCounts: outcome.establishmentClassificationCounts,
    coverageSummary,
    rejectionReasons: outcome.rejectionReasons,
  };
}
