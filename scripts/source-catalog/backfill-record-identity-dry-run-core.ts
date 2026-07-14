/**
 * Backfill dry-run core — pure logic for projecting record_identity_key
 * coverage, collisions, and invariants on source_company_snapshots.
 *
 * Read-only by design: every export here is a synchronous, side-effect-free
 * function returning strings or plain data. Nothing in this module opens a
 * database connection, reads environment variables, or executes SQL.
 * Production execution of the generated SQL is out of scope for this hito
 * (EC4D5.H) and is intentionally not implemented — see `parseCliArgs` in
 * this file, which rejects `--allow-db-read` rather than honoring it.
 *
 * Source-specific derivation rules live HERE, not in the shared
 * `src/server/source-catalog/record-identity` module. That module stays a
 * generic namespace/value builder with no source_key switch, per EC4D5.B.
 *
 * Hito: EC4D5.H — OPS-B backfill dry-run tooling
 */

export const SNAPSHOTS_TABLE = 'source_company_snapshots';

export type SourceFamily = 'TAX_GRAIN' | 'NATIVE_RECORD_GRAIN';

export type InvariantType = 'tax' | 'native';

export interface SourceConfig {
  readonly sourceKey: string;
  readonly family: SourceFamily;
  readonly countryCode: string;
  readonly requiresRawDataProjection: boolean;
  /** SQL expression (may reference raw_data / normalized_tax_id) projecting the future record_identity_key, or NULL when unresolved. */
  readonly derivationSqlExpression: string;
  /** SQL expression projecting a short unavailable-reason label, or NULL when the row resolves. */
  readonly unavailableReasonSqlExpression: string;
  /** Native identity namespaces this source can resolve to, in precedence order. Empty for pure TAX_GRAIN sources. */
  readonly nativeIdentityNamespaces: readonly string[];
  readonly invariantType: InvariantType;
}

function taxGrainDerivationExpression(): string {
  return `CASE WHEN normalized_tax_id IS NOT NULL AND btrim(normalized_tax_id) <> '' THEN 'tax:' || btrim(normalized_tax_id) ELSE NULL END`;
}

function taxGrainUnavailableReasonExpression(): string {
  return `CASE WHEN normalized_tax_id IS NULL OR btrim(normalized_tax_id) = '' THEN 'missing_tax_id' ELSE NULL END`;
}

function buildTaxGrainConfig(sourceKey: string, countryCode: string): SourceConfig {
  return {
    sourceKey,
    family: 'TAX_GRAIN',
    countryCode,
    requiresRawDataProjection: false,
    derivationSqlExpression: taxGrainDerivationExpression(),
    unavailableReasonSqlExpression: taxGrainUnavailableReasonExpression(),
    nativeIdentityNamespaces: [],
    invariantType: 'tax',
  };
}

const PANAMA_DERIVATION_SQL_EXPRESSION = [
  'CASE',
  `  WHEN raw_data->>'company_id' IS NOT NULL AND btrim(raw_data->>'company_id') <> '' THEN 'company:' || btrim(raw_data->>'company_id')`,
  `  WHEN raw_data->>'provider_id' IS NOT NULL AND btrim(raw_data->>'provider_id') <> '' THEN 'provider:' || btrim(raw_data->>'provider_id')`,
  `  WHEN normalized_tax_id IS NOT NULL AND btrim(normalized_tax_id) <> '' THEN 'tax:' || btrim(normalized_tax_id)`,
  '  ELSE NULL',
  'END',
].join('\n');

const PANAMA_UNAVAILABLE_REASON_SQL_EXPRESSION = [
  'CASE',
  `  WHEN raw_data->>'company_id' IS NOT NULL AND btrim(raw_data->>'company_id') <> '' THEN NULL`,
  `  WHEN raw_data->>'provider_id' IS NOT NULL AND btrim(raw_data->>'provider_id') <> '' THEN NULL`,
  `  WHEN normalized_tax_id IS NOT NULL AND btrim(normalized_tax_id) <> '' THEN NULL`,
  `  ELSE 'unavailable'`,
  'END',
].join('\n');

const FEDESOFT_DERIVATION_SQL_EXPRESSION = [
  'CASE',
  `  WHEN raw_data->'company'->'metadata'->>'directoryId' IS NOT NULL AND btrim(raw_data->'company'->'metadata'->>'directoryId') <> '' THEN 'fedesoft-directory:' || btrim(raw_data->'company'->'metadata'->>'directoryId')`,
  `  WHEN normalized_tax_id IS NOT NULL AND normalized_tax_id NOT LIKE 'name:%' AND btrim(normalized_tax_id) <> '' THEN 'tax:' || btrim(normalized_tax_id)`,
  '  ELSE NULL',
  'END',
].join('\n');

const FEDESOFT_UNAVAILABLE_REASON_SQL_EXPRESSION = [
  'CASE',
  `  WHEN raw_data->'company'->'metadata'->>'directoryId' IS NOT NULL AND btrim(raw_data->'company'->'metadata'->>'directoryId') <> '' THEN NULL`,
  `  WHEN normalized_tax_id IS NOT NULL AND normalized_tax_id NOT LIKE 'name:%' AND btrim(normalized_tax_id) <> '' THEN NULL`,
  `  ELSE 'unavailable'`,
  'END',
].join('\n');

export const SOURCE_CONFIGS: readonly SourceConfig[] = [
  buildTaxGrainConfig('co_siis', 'CO'),
  buildTaxGrainConfig('rd_dgii_bulk', 'DO'),
  buildTaxGrainConfig('cl_chilecompra_ocds', 'CL'),
  buildTaxGrainConfig('hn_contrataciones_abiertas', 'HN'),
  buildTaxGrainConfig('gt_rgae_proveedores', 'GT'),
  buildTaxGrainConfig('do_dgcp', 'DO'),
  buildTaxGrainConfig('cr_sicop', 'CR'),
  {
    sourceKey: 'pa_panamacompra_convenio',
    family: 'NATIVE_RECORD_GRAIN',
    countryCode: 'PA',
    requiresRawDataProjection: true,
    derivationSqlExpression: PANAMA_DERIVATION_SQL_EXPRESSION,
    unavailableReasonSqlExpression: PANAMA_UNAVAILABLE_REASON_SQL_EXPRESSION,
    nativeIdentityNamespaces: ['company', 'provider'],
    invariantType: 'native',
  },
  {
    sourceKey: 'co_fedesoft',
    family: 'NATIVE_RECORD_GRAIN',
    countryCode: 'CO',
    requiresRawDataProjection: true,
    derivationSqlExpression: FEDESOFT_DERIVATION_SQL_EXPRESSION,
    unavailableReasonSqlExpression: FEDESOFT_UNAVAILABLE_REASON_SQL_EXPRESSION,
    nativeIdentityNamespaces: ['fedesoft-directory'],
    invariantType: 'native',
  },
];

export function findSourceConfig(sourceKey: string): SourceConfig | null {
  return SOURCE_CONFIGS.find((config) => config.sourceKey === sourceKey) ?? null;
}

export function isKnownSourceKey(sourceKey: string): boolean {
  return findSourceConfig(sourceKey) !== null;
}

// ─── Section A: coverage projection ────────────────────────────────────────

export function buildCoverageSql(config: SourceConfig): string {
  return `-- Coverage projection — ${config.sourceKey} (dry-run, read-only, not executed in EC4D5.H)
WITH projected AS (
  SELECT
    source_key,
    country_code,
    source_year,
    record_identity_key,
    (${config.derivationSqlExpression}) AS projected_record_identity_key,
    (${config.unavailableReasonSqlExpression}) AS projected_unavailable_reason
  FROM ${SNAPSHOTS_TABLE}
  WHERE source_key = '${config.sourceKey}'
)
SELECT
  source_key,
  country_code,
  source_year,
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE record_identity_key IS NOT NULL) AS already_has_record_identity_key,
  COUNT(*) FILTER (WHERE projected_record_identity_key IS NOT NULL) AS projected_resolved_rows,
  COUNT(*) FILTER (WHERE projected_record_identity_key IS NULL) AS projected_unavailable_rows,
  COUNT(*) FILTER (WHERE projected_record_identity_key LIKE 'name:%') AS projected_name_namespace_rows,
  COUNT(*) FILTER (WHERE projected_record_identity_key = '') AS projected_empty_identity_rows,
  (
    SELECT jsonb_object_agg(reason_counts.projected_unavailable_reason, reason_counts.row_count)
    FROM (
      SELECT p2.projected_unavailable_reason, COUNT(*) AS row_count
      FROM projected p2
      WHERE p2.source_key = projected.source_key
        AND p2.country_code IS NOT DISTINCT FROM projected.country_code
        AND p2.source_year IS NOT DISTINCT FROM projected.source_year
        AND p2.projected_unavailable_reason IS NOT NULL
      GROUP BY p2.projected_unavailable_reason
    ) reason_counts
  ) AS projected_unavailable_reasons
FROM projected
GROUP BY source_key, country_code, source_year
ORDER BY country_code, source_year;`;
}

// ─── Section B: canonical grain collision projection ───────────────────────

export function buildCanonicalCollisionSql(config: SourceConfig): string {
  return `-- Canonical grain collision projection — ${config.sourceKey} (dry-run, read-only, not executed in EC4D5.H)
WITH projected AS (
  SELECT
    source_key,
    country_code,
    source_year,
    (${config.derivationSqlExpression}) AS projected_record_identity_key
  FROM ${SNAPSHOTS_TABLE}
  WHERE source_key = '${config.sourceKey}'
),
grouped AS (
  SELECT
    source_key,
    country_code,
    source_year,
    projected_record_identity_key,
    COUNT(*) AS row_count,
    md5(projected_record_identity_key) AS key_hash
  FROM projected
  WHERE projected_record_identity_key IS NOT NULL
  GROUP BY source_key, country_code, source_year, projected_record_identity_key
  HAVING COUNT(*) > 1
)
SELECT
  source_key,
  country_code,
  source_year,
  COUNT(*) AS duplicate_group_count,
  COALESCE(SUM(row_count - 1), 0) AS duplicate_excess_rows,
  (ARRAY_AGG(key_hash ORDER BY key_hash))[1:5] AS sample_key_hashes
FROM grouped
GROUP BY source_key, country_code, source_year
ORDER BY country_code, source_year;`;
}

// ─── Section C: tax-grain invariant projection (TAX_GRAIN only) ───────────

export function buildTaxInvariantSql(config: SourceConfig): string {
  if (config.family !== 'TAX_GRAIN') {
    throw new Error(
      `tax_invariant_not_applicable: '${config.sourceKey}' is family '${config.family}', not TAX_GRAIN.`,
    );
  }

  return `-- Tax-grain invariant projection — ${config.sourceKey} (dry-run, read-only, not executed in EC4D5.H)
WITH projected AS (
  SELECT source_key, country_code, source_year, normalized_tax_id
  FROM ${SNAPSHOTS_TABLE}
  WHERE source_key = '${config.sourceKey}'
),
tax_groups AS (
  SELECT source_key, country_code, source_year, normalized_tax_id, COUNT(*) AS row_count
  FROM projected
  WHERE normalized_tax_id IS NOT NULL
    AND btrim(normalized_tax_id) <> ''
    AND normalized_tax_id NOT LIKE 'name:%'
  GROUP BY source_key, country_code, source_year, normalized_tax_id
)
SELECT
  source_key,
  country_code,
  source_year,
  COUNT(*) FILTER (WHERE row_count > 1) AS tax_duplicate_group_count,
  COALESCE(SUM(row_count - 1) FILTER (WHERE row_count > 1), 0) AS tax_duplicate_excess_rows,
  (SELECT COUNT(*) FROM projected p WHERE p.normalized_tax_id IS NULL OR btrim(p.normalized_tax_id) = '') AS null_tax_rows,
  (SELECT COUNT(*) FROM projected p WHERE p.normalized_tax_id LIKE 'name:%') AS name_tax_rows
FROM tax_groups
GROUP BY source_key, country_code, source_year
ORDER BY country_code, source_year;`;
}

// ─── Section D: native-record projection (NATIVE_RECORD_GRAIN only) ──────

export function buildNativeProjectionSql(config: SourceConfig): string {
  if (config.family !== 'NATIVE_RECORD_GRAIN') {
    throw new Error(
      `native_projection_not_applicable: '${config.sourceKey}' is family '${config.family}', not NATIVE_RECORD_GRAIN.`,
    );
  }

  const nativeNamespacePrefixes = config.nativeIdentityNamespaces.map((ns) => `'${ns}:'`).join(', ');

  return `-- Native-record projection — ${config.sourceKey} (dry-run, read-only, not executed in EC4D5.H)
-- Native identity namespaces (precedence order): ${config.nativeIdentityNamespaces.join(' -> ') || 'none'}
WITH projected AS (
  SELECT
    source_key,
    country_code,
    source_year,
    normalized_tax_id,
    (${config.derivationSqlExpression}) AS projected_record_identity_key
  FROM ${SNAPSHOTS_TABLE}
  WHERE source_key = '${config.sourceKey}'
),
classified AS (
  SELECT
    source_key,
    country_code,
    source_year,
    normalized_tax_id,
    projected_record_identity_key,
    (projected_record_identity_key IS NOT NULL AND NOT (projected_record_identity_key LIKE 'tax:%')) AS is_native_identity
  FROM projected
),
tax_native_groups AS (
  SELECT normalized_tax_id, COUNT(DISTINCT projected_record_identity_key) AS distinct_native_count, COUNT(*) AS row_count
  FROM classified
  WHERE is_native_identity AND normalized_tax_id IS NOT NULL AND btrim(normalized_tax_id) <> ''
  GROUP BY normalized_tax_id
  HAVING COUNT(DISTINCT projected_record_identity_key) > 1
)
SELECT
  c.source_key,
  c.country_code,
  c.source_year,
  COUNT(*) FILTER (WHERE c.is_native_identity) AS native_identity_rows,
  COUNT(*) FILTER (WHERE NOT c.is_native_identity AND c.projected_record_identity_key LIKE 'tax:%') AS tax_fallback_rows,
  COUNT(*) FILTER (WHERE c.projected_record_identity_key IS NULL) AS unavailable_rows,
  (SELECT COUNT(*) FROM tax_native_groups) AS same_tax_multi_record_groups,
  (SELECT COALESCE(SUM(row_count - distinct_native_count), 0) FROM tax_native_groups) AS same_tax_multi_record_excess_rows
FROM classified c
GROUP BY c.source_key, c.country_code, c.source_year
ORDER BY c.country_code, c.source_year;
-- native namespace prefixes considered: ${nativeNamespacePrefixes || 'none'}`;
}

// ─── Section E: safety gate evaluation (operates on parsed/simulated rows, not SQL) ──

export interface CoverageProjectionRow {
  readonly sourceKey: string;
  readonly countryCode: string | null;
  readonly sourceYear: number | null;
  readonly totalRows: number;
  readonly alreadyHasRecordIdentityKey: number;
  readonly projectedResolvedRows: number;
  readonly projectedUnavailableRows: number;
  readonly projectedNameNamespaceRows: number;
  readonly projectedEmptyIdentityRows: number;
}

export interface CanonicalCollisionRow {
  readonly sourceKey: string;
  readonly countryCode: string | null;
  readonly sourceYear: number | null;
  readonly duplicateGroupCount: number;
  readonly duplicateExcessRows: number;
}

export interface SafetyGateInput {
  readonly coverageRows: readonly CoverageProjectionRow[];
  readonly collisionRows: readonly CanonicalCollisionRow[];
  readonly knownSourceKeys?: readonly string[];
}

export type BlockingReason =
  | 'unknown_source'
  | 'canonical_collision'
  | 'unavailable_rows'
  | 'empty_identity'
  | 'name_namespace';

export interface SafetyGateResult {
  readonly pass: boolean;
  readonly blockedSources: readonly string[];
  readonly blockingReasons: readonly BlockingReason[];
  readonly manualReviewRequired: boolean;
  readonly unknownSourceDetected: boolean;
  readonly canonicalCollisionDetected: boolean;
  readonly unavailableRowsDetected: boolean;
  readonly emptyIdentityDetected: boolean;
  readonly nameNamespaceDetected: boolean;
}

export function evaluateSafetyGate(input: SafetyGateInput): SafetyGateResult {
  const knownSourceKeys = input.knownSourceKeys ?? SOURCE_CONFIGS.map((c) => c.sourceKey);
  const blockedSources = new Set<string>();
  const blockingReasons = new Set<BlockingReason>();

  let unknownSourceDetected = false;
  let canonicalCollisionDetected = false;
  let unavailableRowsDetected = false;
  let emptyIdentityDetected = false;
  let nameNamespaceDetected = false;

  for (const row of input.coverageRows) {
    if (!knownSourceKeys.includes(row.sourceKey)) {
      unknownSourceDetected = true;
      blockedSources.add(row.sourceKey);
      blockingReasons.add('unknown_source');
      continue;
    }
    if (row.projectedUnavailableRows > 0) {
      unavailableRowsDetected = true;
      blockedSources.add(row.sourceKey);
      blockingReasons.add('unavailable_rows');
    }
    if (row.projectedEmptyIdentityRows > 0) {
      emptyIdentityDetected = true;
      blockedSources.add(row.sourceKey);
      blockingReasons.add('empty_identity');
    }
    if (row.projectedNameNamespaceRows > 0) {
      nameNamespaceDetected = true;
      blockedSources.add(row.sourceKey);
      blockingReasons.add('name_namespace');
    }
  }

  for (const row of input.collisionRows) {
    if (!knownSourceKeys.includes(row.sourceKey)) {
      unknownSourceDetected = true;
      blockedSources.add(row.sourceKey);
      blockingReasons.add('unknown_source');
      continue;
    }
    if (row.duplicateGroupCount > 0) {
      canonicalCollisionDetected = true;
      blockedSources.add(row.sourceKey);
      blockingReasons.add('canonical_collision');
    }
  }

  const pass =
    !unknownSourceDetected &&
    !canonicalCollisionDetected &&
    !unavailableRowsDetected &&
    !emptyIdentityDetected &&
    !nameNamespaceDetected;

  // Config/discovery errors (unknown source_key) are a hard block, not a
  // "resolve by hand and re-run" situation — those still need manual review
  // too, but the distinct flag lets callers separate "fix the tool" from
  // "review the data".
  const manualReviewRequired =
    !pass &&
    (canonicalCollisionDetected || unavailableRowsDetected || emptyIdentityDetected || nameNamespaceDetected);

  return {
    pass,
    blockedSources: Array.from(blockedSources).sort(),
    blockingReasons: Array.from(blockingReasons).sort(),
    manualReviewRequired,
    unknownSourceDetected,
    canonicalCollisionDetected,
    unavailableRowsDetected,
    emptyIdentityDetected,
    nameNamespaceDetected,
  };
}

// ─── CLI argument parsing (fail-closed) ────────────────────────────────────

const FORBIDDEN_WRITE_FLAGS = ['--apply', '--write', '--backfill', '--execute-update'] as const;

export class ForbiddenFlagError extends Error {}
export class UnknownSourceKeyError extends Error {}
export class UnknownFlagError extends Error {}

export type OutputFormat = 'text' | 'json';

export interface CliOptions {
  readonly sourceKey: string | null;
  readonly format: OutputFormat;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let sourceKey: string | null = null;
  let format: OutputFormat = 'text';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if ((FORBIDDEN_WRITE_FLAGS as readonly string[]).includes(arg)) {
      throw new ForbiddenFlagError(
        `forbidden_flag: '${arg}' is not supported. This tool is dry-run only and never writes to the database.`,
      );
    }

    if (arg === '--allow-db-read' || arg.startsWith('--allow-db-read=')) {
      throw new ForbiddenFlagError(
        `db_read_not_implemented: '--allow-db-read' is not implemented in this hito (EC4D5.H). This tool never connects to a database.`,
      );
    }

    if (arg === '--print-sql') {
      continue;
    }

    if (arg === '--source-key') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('source_key_value_required: --source-key requires a value');
      }
      sourceKey = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--source-key=')) {
      sourceKey = arg.slice('--source-key='.length);
      continue;
    }

    if (arg === '--format') {
      const value = argv[i + 1];
      if (value !== 'json' && value !== 'text') {
        throw new Error(`invalid_format: --format must be 'json' or 'text', got '${String(value)}'`);
      }
      format = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'json' && value !== 'text') {
        throw new Error(`invalid_format: --format must be 'json' or 'text', got '${value}'`);
      }
      format = value;
      continue;
    }

    throw new UnknownFlagError(`unknown_flag: '${arg}' is not a recognized flag.`);
  }

  if (sourceKey !== null && !isKnownSourceKey(sourceKey)) {
    throw new UnknownSourceKeyError(
      `unknown_source_key: '${sourceKey}' is not one of the ${SOURCE_CONFIGS.length} effective source keys.`,
    );
  }

  return { sourceKey, format };
}

// ─── Report formatting ──────────────────────────────────────────────────────

export interface SourceSqlSections {
  readonly coverage: string;
  readonly canonicalCollision: string;
  readonly taxInvariant: string | null;
  readonly nativeProjection: string | null;
}

export function buildSourceSqlSections(config: SourceConfig): SourceSqlSections {
  return {
    coverage: buildCoverageSql(config),
    canonicalCollision: buildCanonicalCollisionSql(config),
    taxInvariant: config.family === 'TAX_GRAIN' ? buildTaxInvariantSql(config) : null,
    nativeProjection: config.family === 'NATIVE_RECORD_GRAIN' ? buildNativeProjectionSql(config) : null,
  };
}

export function resolveTargetConfigs(options: CliOptions): readonly SourceConfig[] {
  if (options.sourceKey === null) {
    return SOURCE_CONFIGS;
  }
  const config = findSourceConfig(options.sourceKey);
  return config ? [config] : [];
}

export function formatSourceReportText(config: SourceConfig): string {
  const sections = buildSourceSqlSections(config);
  const parts = [
    `═══ ${config.sourceKey} (${config.family}, country_code=${config.countryCode}) ═══`,
    sections.coverage,
    sections.canonicalCollision,
  ];
  if (sections.taxInvariant) {
    parts.push(sections.taxInvariant);
  }
  if (sections.nativeProjection) {
    parts.push(sections.nativeProjection);
  }
  return parts.join('\n\n');
}

export interface DryRunJsonContract {
  readonly mode: 'dry-run-sql-only';
  readonly dbConnectionUsed: false;
  readonly sources: ReadonlyArray<{
    readonly sourceKey: string;
    readonly family: SourceFamily;
    readonly countryCode: string;
    readonly invariantType: InvariantType;
    readonly sql: SourceSqlSections;
  }>;
}

export function buildDryRunJsonContract(configs: readonly SourceConfig[]): DryRunJsonContract {
  return {
    mode: 'dry-run-sql-only',
    dbConnectionUsed: false,
    sources: configs.map((config) => ({
      sourceKey: config.sourceKey,
      family: config.family,
      countryCode: config.countryCode,
      invariantType: config.invariantType,
      sql: buildSourceSqlSections(config),
    })),
  };
}

export function formatDryRunReport(options: CliOptions): string {
  const targets = resolveTargetConfigs(options);

  if (targets.length === 0) {
    throw new UnknownSourceKeyError(
      `unknown_source_key: '${options.sourceKey}' is not one of the ${SOURCE_CONFIGS.length} effective source keys.`,
    );
  }

  if (options.format === 'json') {
    return JSON.stringify(buildDryRunJsonContract(targets), null, 2);
  }

  return targets.map(formatSourceReportText).join('\n\n');
}
