/**
 * BR Receita CNPJ — STREAMING FULL-JOIN ENGINE CONTRACT (BR-SOURCE-14B.0D § 4, § 6, § 8, § 9, § 10).
 *
 * The types, caps and closed vocabularies the engine is built from, kept in their own module so the
 * orchestration file stays readable and so every contract here is testable without running a join.
 *
 * ── The one type that matters most ──────────────────────────────────────────────
 * `BrazilReceitaFullJoinBoundedJoinedRecord` is the FIRST joined-record type in this connector, and
 * what it does NOT contain is the whole design:
 *
 *   no CNPJ, no CNPJ básico, no CNPJ completo, no razão social, no nome comercial, no raw row, no
 *   raw CSV, no join key, no hash derived from an identifier, no email, no phone, no address, no
 *   person name.
 *
 * It contains two opaque row references and a partition ordinal. A consumer that wants a company
 * name has to go and read the row itself, under its own authorization — which is the point: this
 * milestone joins, it does not import, and a joined record that already carried the values would be
 * an import in everything but name.
 *
 * ── Duplicates fail closed, explicitly ──────────────────────────────────────────
 * There is no default duplicate policy. A caller must declare one, and the declaration is part of
 * the request rather than a flag with a sensible-looking default, because "sensible-looking default"
 * is how a silent de-duplication ships. `reject` aborts the run; `pair_with_every_duplicate` emits
 * one record per (empresa reference, estabelecimento reference) pair and says so in the report.
 * Neither one drops a row quietly.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - performs I/O. It has no `node:fs` import and no filesystem parameter: it declares shapes.
 *   - defines a second copy of a 14B.0C resource cap. The engine's own caps are partitioning caps,
 *     which the envelope does not and should not know about.
 *   - touches Supabase, the runtime, Agent 1, Agent 2A, a provider, HubSpot or the UI.
 *   - spawns a process, reads an environment variable, or writes to stdout or stderr.
 */

import type {
  BrazilReceitaFullJoinPartitionedFamily,
  BrazilReceitaFullJoinRowReference,
} from './br-receita-cnpj-full-join-partition-workspace';

// ─── Version & model ──────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_VERSION = 1 as const;

/**
 * The architecture, named once so a report can carry it and a reviewer can check the name against
 * the code rather than against a claim.
 */
export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_ARCHITECTURE =
  'external_hash_partitioned_streaming_join_over_offset_references' as const;

/**
 * Why nested-loop and sort-merge were both rejected, recorded as data.
 *
 * Sort-merge would need the files to be globally ordered on the join column in a compatible way.
 * There is no official, verifiable statement that they are, so assuming it would make correctness
 * depend on an undocumented property of a third-party dataset — and the failure mode is a silently
 * incomplete join, which is the worst kind. Nested-loop would need one full pass over
 * Estabelecimentos per Empresas chunk: bounded in memory, catastrophic in runtime, and it turns a
 * one-pass job into a quadratic one.
 */
export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_REJECTED_ARCHITECTURES = [
  'sort_merge_requires_unverified_global_ordering',
  'nested_loop_requires_repeated_full_scans',
  'in_memory_hash_requires_materializing_a_family',
] as const;

// ─── Source descriptors ───────────────────────────────────────────────────────

/**
 * One input file, already resolved.
 *
 * The engine takes DESCRIPTORS, not a manifest path, and that is a boundary decision rather than a
 * convenience: § 1 forbids opening the real manifest at all in this milestone, and an engine that
 * parsed manifests would have to be trusted not to. It cannot open what it is never given.
 */
export interface BrazilReceitaFullJoinSourceFileDescriptor {
  readonly filePath: string;
  readonly family: BrazilReceitaFullJoinPartitionedFamily;
  /** A stable, technical index into the descriptor list. The reference records carry this, not a name. */
  readonly sourceFileOrdinal: number;
  readonly encoding: 'latin1' | 'utf8';
  /**
   * Which national part (0..9) this descriptor's manifest entry declared, when it came from the
   * manifest bridge (BR-SOURCE-14B.0M). Optional and purely informational — the engine never reads
   * it, sorts by it, or requires it; every existing fixture-built descriptor omits it and remains
   * valid. It exists only so a test can prove a descriptor's provenance survived bridging.
   */
  readonly manifestPartOrdinal?: number;
}

// ─── Join key ─────────────────────────────────────────────────────────────────

/**
 * The join column, for BOTH families.
 *
 * Position 0 in Empresas and position 0 in Estabelecimentos, per the official headerless layout and
 * consistent with BR-SOURCE-11G's `..._JOIN_PROBE_KEY_COLUMN_INDEX`. Not re-derived and not guessed:
 * one authority, cited.
 */
export const BRAZIL_RECEITA_FULL_JOIN_KEY_COLUMN_INDEX = 0 as const;

/** A normalized key longer than this is refused rather than truncated. */
export const BRAZIL_RECEITA_FULL_JOIN_MAX_KEY_CHARACTERS = 32 as const;

/**
 * Normalizes the raw join field into the representation the engine compares.
 *
 * Deliberately minimal — trim, then strip one layer of wrapping quotes (the official files quote
 * every field), then reject empty and over-long. There is no fuzzy matching, no case folding beyond
 * what the layout guarantees, and above all NO fallback to a company name: a name-based fallback
 * would silently join two different companies, and a join that is wrong is worse than a join that
 * reports a row as unmatched.
 *
 * Returns `null` for an INVALID key, which the engine counts and skips. It never logs the value and
 * never returns it in a report.
 */
export function normalizeBrazilReceitaFullJoinKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }
  if (value.length === 0) return null;
  if (value.length > BRAZIL_RECEITA_FULL_JOIN_MAX_KEY_CHARACTERS) return null;
  return value;
}

/**
 * FNV-1a, 32-bit. The partition assignment function.
 *
 * The digest exists for the length of this call and is turned into a bucket index immediately. It is
 * never persisted, never reported and never compared: § 4.2 forbids persisting the value used to
 * compute a partition, and a 32-bit digest of an identifier is exactly the "hash derivado de
 * identificador" that rule names. What reaches disk is the ORDINAL — a small integer whose
 * cardinality is the partition count, which reveals nothing about the key beyond one bucket among a
 * handful.
 */
export function brazilReceitaFullJoinPartitionOrdinalFor(
  normalizedKey: string,
  partitionCount: number,
): number {
  if (!Number.isInteger(partitionCount) || partitionCount <= 0) return 0;
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < normalizedKey.length; index++) {
    hash ^= normalizedKey.charCodeAt(index) & 0xff;
    // The FNV prime, via shifts: Math.imul keeps the product in 32 bits without a bignum.
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0) % partitionCount;
}

// ─── Partitioning caps ────────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_PARTITIONING_CAP_KEYS = [
  'partitionCount',
  'maxPartitionCount',
  'maxPartitionDepth',
  'maxReferencesPerPartition',
  'maxReferenceBytesPerPartition',
] as const;

export type BrazilReceitaFullJoinPartitioningCapKey =
  (typeof BRAZIL_RECEITA_FULL_JOIN_PARTITIONING_CAP_KEYS)[number];

export type BrazilReceitaFullJoinPartitioningCaps = Readonly<
  Record<BrazilReceitaFullJoinPartitioningCapKey, number>
>;

export type BrazilReceitaFullJoinPartitioningCapRejectionReason =
  | 'cap_absent'
  | 'cap_not_a_number'
  | 'cap_not_finite'
  | 'cap_not_an_integer'
  | 'cap_not_positive'
  | 'partition_count_above_max'
  | 'max_partition_count_below_initial';

export interface BrazilReceitaFullJoinPartitioningCapRejection {
  readonly key: BrazilReceitaFullJoinPartitioningCapKey;
  readonly reason: BrazilReceitaFullJoinPartitioningCapRejectionReason;
}

export type BrazilReceitaFullJoinPartitioningCapResolution =
  | { readonly ok: true; readonly caps: BrazilReceitaFullJoinPartitioningCaps }
  | {
      readonly ok: false;
      readonly rejections: readonly BrazilReceitaFullJoinPartitioningCapRejection[];
    };

/**
 * Resolves the partitioning caps, or refuses.
 *
 * `partitionCount` must be at or below `maxPartitionCount`, and the ceiling must not be below the
 * starting point — otherwise a "controlled repartition" would be authorized by arithmetic that never
 * held. An unlimited partition count is not expressible: there is no sentinel for it, and `Infinity`
 * is refused as non-finite exactly as in 14B.0C.
 */
export function resolveBrazilReceitaFullJoinPartitioningCaps(
  input:
    | Readonly<Partial<Record<BrazilReceitaFullJoinPartitioningCapKey, unknown>>>
    | null
    | undefined,
): BrazilReceitaFullJoinPartitioningCapResolution {
  const rejections: BrazilReceitaFullJoinPartitioningCapRejection[] = [];
  const resolved = {} as Record<BrazilReceitaFullJoinPartitioningCapKey, number>;

  for (const key of BRAZIL_RECEITA_FULL_JOIN_PARTITIONING_CAP_KEYS) {
    const raw = input?.[key];
    if (raw === undefined || raw === null) {
      rejections.push({ key, reason: 'cap_absent' });
      continue;
    }
    if (typeof raw !== 'number') {
      rejections.push({ key, reason: 'cap_not_a_number' });
      continue;
    }
    if (!Number.isFinite(raw)) {
      rejections.push({ key, reason: 'cap_not_finite' });
      continue;
    }
    if (!Number.isInteger(raw)) {
      rejections.push({ key, reason: 'cap_not_an_integer' });
      continue;
    }
    if (raw <= 0) {
      rejections.push({ key, reason: 'cap_not_positive' });
      continue;
    }
    resolved[key] = raw;
  }
  if (rejections.length > 0) return { ok: false, rejections };

  if (resolved.partitionCount > resolved.maxPartitionCount) {
    rejections.push({ key: 'partitionCount', reason: 'partition_count_above_max' });
  }
  if (resolved.maxPartitionCount < resolved.partitionCount) {
    rejections.push({ key: 'maxPartitionCount', reason: 'max_partition_count_below_initial' });
  }
  if (rejections.length > 0) return { ok: false, rejections };

  return { ok: true, caps: Object.freeze(resolved) };
}

// ─── Stage-3 partition ordinal range (BR-RECEITA-CHUNKED-JOIN-RANGE) ──────────

/**
 * The OPTIONAL Stage-3 window, so one national dataset can be joined by several sequential
 * executions instead of one execution that must survive from end to end.
 *
 * ── Why this is a range over ORDINALS and not over rows ─────────────────────────
 * A partition ordinal is the only unit of this join that is independently completable: every row
 * carrying a given key lands in exactly one ordinal in BOTH families, so ordinals 4..7 can be joined
 * by one process and 8..11 by another with no shared state, no coordination and no risk that a match
 * falls between two chunks. A row range would have neither property.
 *
 * ── What it deliberately does NOT do ───────────────────────────────────────────
 * It does not skip Stage 1 or Stage 2. Every execution still scans both families to end of file and
 * writes its own references, because the partition assignment for ordinal 4 is not knowable without
 * reading the rows that might land in it. The saving is Stage-3 work — the row re-reads, the key
 * window and the sink — and nothing else. A caller who expects a ranged execution to be 4/16 of a
 * full execution END TO END is expecting something this capability does not provide, and the counters
 * in the result say so.
 *
 * ── Absent means FULL, malformed means REFUSED ──────────────────────────────────
 * With neither field supplied the resolution is `null` and Stage 3 iterates `0 .. partitionCount`,
 * which is what it did before this capability existed. With one field supplied and not the other the
 * run is REFUSED rather than completed over a range the engine guessed: a chunked import whose
 * chunk boundaries were invented is worse than one that would not start.
 */
export interface BrazilReceitaFullJoinPartitionOrdinalRange {
  readonly start: number;
  /** How many ordinals to attempt from `start`. Clamped DOWN to the map at Stage 3, never up. */
  readonly count: number;
}

export const BRAZIL_RECEITA_FULL_JOIN_PARTITION_ORDINAL_RANGE_REJECTION_REASONS = [
  /** One of the two fields was supplied and the other was not. No range is inferred from a half. */
  'range_partially_declared',
  'range_start_not_a_number',
  'range_start_not_finite',
  'range_start_not_an_integer',
  'range_start_negative',
  'range_count_not_a_number',
  'range_count_not_finite',
  'range_count_not_an_integer',
  'range_count_not_positive',
  /**
   * `start` is outside the DECLARED map. Refused rather than clamped, and refused against the
   * declared `partitionCount` rather than against whatever a controlled repartition might widen it
   * to: an ordinal that only becomes addressable after an escalation is exactly the unstable
   * checkpoint a chunked import must not silently accept.
   */
  'range_start_above_declared_partition_count',
  /** `start + count` is not representable as a safe integer, so the Stage-3 clamp is not arithmetic. */
  'range_count_not_safely_clampable',
] as const;

export type BrazilReceitaFullJoinPartitionOrdinalRangeRejectionReason =
  (typeof BRAZIL_RECEITA_FULL_JOIN_PARTITION_ORDINAL_RANGE_REJECTION_REASONS)[number];

export interface BrazilReceitaFullJoinPartitionOrdinalRangeRejection {
  readonly field: 'partitionOrdinalStart' | 'partitionOrdinalCount';
  readonly reason: BrazilReceitaFullJoinPartitionOrdinalRangeRejectionReason;
}

export type BrazilReceitaFullJoinPartitionOrdinalRangeResolution =
  | { readonly ok: true; readonly range: BrazilReceitaFullJoinPartitionOrdinalRange | null }
  | {
      readonly ok: false;
      readonly rejections: readonly BrazilReceitaFullJoinPartitionOrdinalRangeRejection[];
    };

/** The Stage-3 iteration bounds, half-open: `start` inclusive, `endExclusive` exclusive. */
export interface BrazilReceitaFullJoinPartitionOrdinalBounds {
  readonly start: number;
  readonly endExclusive: number;
}

function ordinalFieldRejections(
  field: 'partitionOrdinalStart' | 'partitionOrdinalCount',
  raw: unknown,
): readonly BrazilReceitaFullJoinPartitionOrdinalRangeRejection[] {
  const isStart = field === 'partitionOrdinalStart';
  if (typeof raw !== 'number') {
    return [{ field, reason: isStart ? 'range_start_not_a_number' : 'range_count_not_a_number' }];
  }
  if (!Number.isFinite(raw)) {
    return [{ field, reason: isStart ? 'range_start_not_finite' : 'range_count_not_finite' }];
  }
  if (!Number.isInteger(raw)) {
    return [
      { field, reason: isStart ? 'range_start_not_an_integer' : 'range_count_not_an_integer' },
    ];
  }
  if (isStart ? raw < 0 : raw <= 0) {
    return [{ field, reason: isStart ? 'range_start_negative' : 'range_count_not_positive' }];
  }
  return [];
}

/**
 * Resolves the optional Stage-3 range, or refuses.
 *
 * Validation only. It does not clamp, does not repair, and returns no range it was not given — the
 * clamp against the EFFECTIVE partition count is a separate, explicit step
 * (`brazilReceitaFullJoinPartitionOrdinalBounds`), because the effective count is not known until
 * the reference passes have settled on a partition depth.
 */
export function resolveBrazilReceitaFullJoinPartitionOrdinalRange(input: {
  readonly start: unknown;
  readonly count: unknown;
  readonly declaredPartitionCount: number;
}): BrazilReceitaFullJoinPartitionOrdinalRangeResolution {
  const startAbsent = input.start === undefined || input.start === null;
  const countAbsent = input.count === undefined || input.count === null;
  if (startAbsent && countAbsent) return { ok: true, range: null };
  if (startAbsent) {
    return {
      ok: false,
      rejections: [{ field: 'partitionOrdinalStart', reason: 'range_partially_declared' }],
    };
  }
  if (countAbsent) {
    return {
      ok: false,
      rejections: [{ field: 'partitionOrdinalCount', reason: 'range_partially_declared' }],
    };
  }

  const rejections = [
    ...ordinalFieldRejections('partitionOrdinalStart', input.start),
    ...ordinalFieldRejections('partitionOrdinalCount', input.count),
  ];
  if (rejections.length > 0) return { ok: false, rejections };

  const start = input.start as number;
  const count = input.count as number;

  if (start >= input.declaredPartitionCount) {
    return {
      ok: false,
      rejections: [
        { field: 'partitionOrdinalStart', reason: 'range_start_above_declared_partition_count' },
      ],
    };
  }
  if (start + count > Number.MAX_SAFE_INTEGER) {
    return {
      ok: false,
      rejections: [{ field: 'partitionOrdinalCount', reason: 'range_count_not_safely_clampable' }],
    };
  }

  return { ok: true, range: Object.freeze({ start, count }) };
}

/**
 * The half-open Stage-3 bounds for a resolved range under an EFFECTIVE partition count.
 *
 * `null` is the pre-existing behaviour, stated as arithmetic rather than as a branch nobody can see:
 * `0 .. partitionCount`. A range's end is clamped DOWN to the map and never up, so a caller asking
 * for four ordinals starting at twelve on a map of sixteen gets twelve..fifteen rather than a run
 * that walks off the end.
 */
export function brazilReceitaFullJoinPartitionOrdinalBounds(
  range: BrazilReceitaFullJoinPartitionOrdinalRange | null,
  partitionCount: number,
): BrazilReceitaFullJoinPartitionOrdinalBounds {
  if (range === null) return { start: 0, endExclusive: partitionCount };
  return {
    start: range.start,
    endExclusive: Math.min(range.start + range.count, partitionCount),
  };
}

// ─── Joined record & sink ─────────────────────────────────────────────────────

/**
 * A match: two opaque references and the partition that produced them.
 *
 * See the module header for the list of fields this type deliberately does not have.
 */
export interface BrazilReceitaFullJoinBoundedJoinedRecord {
  readonly empresaReference: BrazilReceitaFullJoinRowReference;
  readonly estabelecimentoReference: BrazilReceitaFullJoinRowReference;
  readonly partitionOrdinal: number;
}

/** One partition's aggregate result. Counts and one ordinal; no key, no reference, no value. */
export interface BrazilReceitaFullJoinPartitionSummary {
  readonly partitionOrdinal: number;
  readonly empresaKeysLoaded: number;
  readonly estabelecimentoReferencesStreamed: number;
  readonly matchesEmitted: number;
  readonly empresaKeysWithoutEstabelecimento: number;
  readonly orphanEstabelecimentoCount: number;
  readonly invalidKeyCount: number;
  readonly malformedRowCount: number;
}

/**
 * Where matches go.
 *
 * An interface rather than a Supabase call, because the engine must be usable for a resource
 * benchmark that emits nothing, and because coupling a join to a destination is how a benchmark
 * quietly becomes an import. The engine knows how to find matches; it does not know what a match is
 * for.
 */
export interface BrazilReceitaFullJoinSink {
  onMatch(match: BrazilReceitaFullJoinBoundedJoinedRecord): Promise<void> | void;
  onPartitionComplete?(summary: BrazilReceitaFullJoinPartitionSummary): Promise<void> | void;
  finalize(): Promise<void> | void;
}

/** What a benchmark sink is allowed to know at the end: how many, in buckets. Never which. */
export interface BrazilReceitaFullJoinNullSinkTally {
  readonly matchBuckets: Readonly<Record<string, number>>;
  readonly partitionsCompleted: number;
  readonly rowsEmitted: 0;
  readonly recordsRetained: 0;
  readonly finalized: boolean;
}

/**
 * The benchmark sink: counts into buckets, retains nothing, emits nothing.
 *
 * It does not keep the last match "just for debugging", does not build a sample, and has no field
 * that could hold a record — the tally is a map from a bucket LABEL to a count. `rowsEmitted` and
 * `recordsRetained` are `0` literals, so a future edit that starts keeping records cannot leave this
 * type unchanged.
 */
export interface BrazilReceitaFullJoinNullBenchmarkSink extends BrazilReceitaFullJoinSink {
  tally(): BrazilReceitaFullJoinNullSinkTally;
}

/** Bucket labels for the match count. Coarse by design: a public report carries no exact total. */
export function brazilReceitaFullJoinMatchBucketLabel(partitionOrdinal: number): string {
  return `partition_${String(partitionOrdinal).padStart(5, '0')}`;
}

export function createBrazilReceitaFullJoinNullBenchmarkSink(): BrazilReceitaFullJoinNullBenchmarkSink {
  const matchBuckets = new Map<string, number>();
  let partitionsCompleted = 0;
  let finalized = false;

  return {
    onMatch(match) {
      const label = brazilReceitaFullJoinMatchBucketLabel(match.partitionOrdinal);
      matchBuckets.set(label, (matchBuckets.get(label) ?? 0) + 1);
      // `match` goes out of scope here. Nothing derived from it is retained.
    },
    onPartitionComplete() {
      partitionsCompleted += 1;
    },
    finalize() {
      finalized = true;
    },
    tally() {
      return {
        matchBuckets: Object.fromEntries([...matchBuckets.entries()].sort()),
        partitionsCompleted,
        rowsEmitted: 0,
        recordsRetained: 0,
        finalized,
      };
    },
  };
}

// ─── Duplicate policy ─────────────────────────────────────────────────────────

/**
 * `reject`                  — a repeated Empresa key inside one partition aborts the run.
 * `pair_with_every_duplicate` — every duplicate is paired, and the report says how many there were.
 *
 * Both are explicit. There is no third option that drops one silently.
 */
export const BRAZIL_RECEITA_FULL_JOIN_DUPLICATE_KEY_POLICIES = [
  'reject',
  'pair_with_every_duplicate',
] as const;

export type BrazilReceitaFullJoinDuplicateKeyPolicy =
  (typeof BRAZIL_RECEITA_FULL_JOIN_DUPLICATE_KEY_POLICIES)[number];

export function isBrazilReceitaFullJoinDuplicateKeyPolicy(
  value: unknown,
): value is BrazilReceitaFullJoinDuplicateKeyPolicy {
  return (
    typeof value === 'string' &&
    (BRAZIL_RECEITA_FULL_JOIN_DUPLICATE_KEY_POLICIES as readonly string[]).includes(value)
  );
}

// ─── Engine abort codes ───────────────────────────────────────────────────────

export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_ABORT_CODES = [
  'reader_caps_incomplete',
  'partitioning_caps_incomplete',
  'resource_caps_incomplete',
  'duplicate_policy_not_declared',
  'partition_ordinal_range_invalid',
  'source_descriptors_invalid',
  'temporary_storage_policy_not_approved',
  'temporary_workspace_unavailable',
  'temporary_storage_cap_exceeded',
  'partition_capacity_exceeded',
  'partition_io_failed',
  // ── BR-SOURCE-14B.0F § 3 and § 4 ──
  'handle_caps_incomplete',
  'files_opened_cap_exceeded',
  'free_disk_thresholds_invalid',
  'insufficient_free_disk_before_start',
  'free_disk_reserve_breached',
  'free_disk_measurement_unavailable',
  'non_progressing_reader',
  'row_bytes_cap_exceeded',
  'carry_bytes_cap_exceeded',
  'columns_cap_exceeded',
  'reader_failed',
  'resource_cap_breached',
  'duplicate_empresa_key_rejected',
  'sink_failed',
  'cleanup_failed',
  'cleanup_unverified',
  'attempt_already_consumed',
] as const;

export type BrazilReceitaFullJoinEngineAbortCode =
  (typeof BRAZIL_RECEITA_FULL_JOIN_ENGINE_ABORT_CODES)[number];

/** Where an abort happened. `before_first_read` is the only one that guarantees zero data access. */
export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_ABORT_STAGES = [
  'before_first_read',
  'empresas_reference_pass',
  'estabelecimentos_reference_pass',
  'partitioned_join',
  'cleanup',
] as const;

export type BrazilReceitaFullJoinEngineAbortStage =
  (typeof BRAZIL_RECEITA_FULL_JOIN_ENGINE_ABORT_STAGES)[number];

export const BRAZIL_RECEITA_FULL_JOIN_ENGINE_EXIT_STATUSES = ['completed', 'aborted'] as const;

export type BrazilReceitaFullJoinEngineExitStatus =
  (typeof BRAZIL_RECEITA_FULL_JOIN_ENGINE_EXIT_STATUSES)[number];
