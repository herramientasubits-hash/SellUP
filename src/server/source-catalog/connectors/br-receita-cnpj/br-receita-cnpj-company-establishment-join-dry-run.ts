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
  | 'bounded_sample_only_not_importable';

export const BR_RECEITA_JOIN_DRY_RUN_REASONS: readonly BrReceitaJoinDryRunReason[] = [
  'sampled_company_context_found',
  'sampled_company_context_missing',
  'company_context_person_or_pii_risk',
  'company_context_needs_legal_review',
  'establishment_privacy_signal_detected',
  'establishment_requires_full_join_context',
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
  /** Company rows sampled (default 5, hard max 20). */
  maxCompanyRows?: number;
  /** Establishment rows sampled (default 5, hard max 20). */
  maxEstablishmentRows?: number;
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
};

export interface BrReceitaCnpjJoinDryRunResult {
  ok: boolean;
  mode: typeof BR_RECEITA_CNPJ_JOIN_DRY_RUN_MODE;
  sourceKey: typeof BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY;
  countryCode: typeof BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE;
  sourceYear: number;
  sourcePeriod: string;
  manifestValidation: 'passed' | 'failed';
  layoutMode: typeof BR_RECEITA_CNPJ_JOIN_DRY_RUN_LAYOUT_MODE;
  maxCompanyRows: number;
  maxEstablishmentRows: number;
  companiesSampled: number;
  companiesIndexedForJoin: number;
  companiesExcludedFromJoin: number;
  establishmentsSampled: number;
  joinCounts: JoinStatusCounts;
  joinReasonCounts: JoinReasonCounts;
  companyClassificationCounts: EligibilityStatusCounts;
  establishmentClassificationCounts: EligibilityStatusCounts;
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

interface JoinGateResult {
  readonly maxCompanyRows: number;
  readonly maxEstablishmentRows: number;
}

function assertJoinGatesOrThrow(options: BrReceitaCnpjJoinDryRunOptions): JoinGateResult {
  if (!options.allowLocalManifest) {
    throw new BrReceitaCnpjJoinDryRunError(
      'allow_local_manifest_required',
      'reading local files requires allowLocalManifest: true',
    );
  }
  const maxCompanyRows = assertBoundedRowLimit(
    'maxCompanyRows',
    options.maxCompanyRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  );
  const maxEstablishmentRows = assertBoundedRowLimit(
    'maxEstablishmentRows',
    options.maxEstablishmentRows ?? BR_RECEITA_CNPJ_PRIVACY_DEFAULT_MAX_SAMPLE_ROWS,
  );
  return { maxCompanyRows, maxEstablishmentRows };
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
  const { maxCompanyRows, maxEstablishmentRows } = assertJoinGatesOrThrow(options);
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

  const base = {
    mode: BR_RECEITA_CNPJ_JOIN_DRY_RUN_MODE,
    sourceKey: BR_RECEITA_CNPJ_MANIFEST_SOURCE_KEY,
    countryCode: BR_RECEITA_CNPJ_MANIFEST_COUNTRY_CODE,
    sourceYear: validation.sourceYear,
    sourcePeriod: validation.sourcePeriod,
    layoutMode: BR_RECEITA_CNPJ_JOIN_DRY_RUN_LAYOUT_MODE,
    maxCompanyRows,
    maxEstablishmentRows,
    companiesSampled: 0,
    companiesIndexedForJoin: 0,
    companiesExcludedFromJoin: 0,
    establishmentsSampled: 0,
    joinCounts: emptyJoinStatusCounts(),
    joinReasonCounts: emptyJoinReasonCounts(),
    companyClassificationCounts: emptyEligibilityStatusCounts(),
    establishmentClassificationCounts: emptyEligibilityStatusCounts(),
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

  const rejectionReasons: string[] = [];
  const companyClassificationCounts = emptyEligibilityStatusCounts();
  const establishmentClassificationCounts = emptyEligibilityStatusCounts();
  const joinCounts = emptyJoinStatusCounts();
  const joinReasonCounts = emptyJoinReasonCounts();

  // ── Pass 1: build the ephemeral company index (join key held in memory only) ──
  const companyIndex = new Map<string, CompanyIndexEntry>();
  let companiesSampled = 0;
  let companiesIndexedForJoin = 0;
  let companiesExcludedFromJoin = 0;

  const empresasFile = pickAcceptedFile('empresas', validation.fileReports, descriptorByType);
  if (empresasFile !== null) {
    const rows = await readSampleRows(empresasFile.descriptor, maxCompanyRows, maxHeaderBytes);
    if (rows === null) {
      rejectionReasons.push('empresas:sample_read_failed');
    } else {
      const expectedColumns = getBrReceitaCnpjOfficialColumnCount('empresas');
      for (const cells of rows) {
        companiesSampled += 1;
        const rc = classifyRow('empresas', 'company', cells, expectedColumns, options.eligibilityPolicy);
        const status = eligibilityStatusForReason(rc.reason);
        companyClassificationCounts[status] += 1;

        const key = joinKeyOf(cells);
        // Structurally-unindexable companies (bad layout / no join key) never enter
        // the index — they cannot provide a trustworthy join key.
        if (status === 'excluded_guard_triggered' || key === '') {
          companiesExcludedFromJoin += 1;
          continue;
        }
        const contextKind = companyContextKind(status);
        companyIndex.set(key, { contextKind });
        if (contextKind === 'usable_context') companiesIndexedForJoin += 1;
        else companiesExcludedFromJoin += 1;
      }
    }
  }

  // ── Pass 2: associate each sampled establishment to its company context ──
  let establishmentsSampled = 0;
  const companyIndexIsEmpty = companyIndex.size === 0;

  const estabFile = pickAcceptedFile('estabelecimentos', validation.fileReports, descriptorByType);
  if (estabFile !== null) {
    const rows = await readSampleRows(estabFile.descriptor, maxEstablishmentRows, maxHeaderBytes);
    if (rows === null) {
      rejectionReasons.push('estabelecimentos:sample_read_failed');
    } else {
      const expectedColumns = getBrReceitaCnpjOfficialColumnCount('estabelecimentos');
      for (const cells of rows) {
        establishmentsSampled += 1;
        const rc = classifyRow(
          'estabelecimentos',
          'company',
          cells,
          expectedColumns,
          options.eligibilityPolicy,
        );
        const status = eligibilityStatusForReason(rc.reason);
        establishmentClassificationCounts[status] += 1;

        const key = joinKeyOf(cells);
        const hasJoinKey = key !== '';
        const companyContext = hasJoinKey ? companyIndex.get(key) : undefined;
        const verdict = resolveEstablishmentJoinVerdict(
          status,
          companyIndexIsEmpty,
          hasJoinKey,
          companyContext,
        );
        joinCounts[verdict.status] += 1;
        joinReasonCounts[verdict.reason] += 1;
      }
    }
  }

  const anyPrivacyExclusion =
    joinCounts.excluded_due_to_establishment_privacy_signal +
      joinCounts.excluded_due_to_company_context >
    0;
  const ok =
    rejectionReasons.length === 0 &&
    !(options.failOnAnyPrivacyExclusion === true && anyPrivacyExclusion);

  return {
    ...base,
    ok,
    manifestValidation: 'passed',
    companiesSampled,
    companiesIndexedForJoin,
    companiesExcludedFromJoin,
    establishmentsSampled,
    joinCounts,
    joinReasonCounts,
    companyClassificationCounts,
    establishmentClassificationCounts,
    rejectionReasons,
  };
}
