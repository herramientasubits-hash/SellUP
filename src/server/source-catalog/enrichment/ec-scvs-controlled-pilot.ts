/**
 * EC SCVS — Controlled live-pilot runner core (EC-SCVS-11-PRETOOL)
 *
 * Pure, testable orchestration for a FUTURE controlled live pilot that enriches a
 * tiny, explicitly-named allowlist of Ecuador prospect candidates. This module
 * NEVER executes the pilot by itself — it only validates arguments, decides
 * whether a write is permitted, and (when invoked) delegates to the single
 * approved enrichment entrypoint `enrichEcBatchWithValidatedSources`.
 *
 * Hard safety contract:
 *   - Requires an explicit, non-empty, duplicate-free allowlist of candidate ids.
 *   - Absolute ceiling of EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES (5). No flag
 *     raises it.
 *   - Default posture is DRY-RUN (no write). A real write requires ALL of:
 *       * `execute === true`,
 *       * the EXACT confirmation phrase,
 *       * the expected Supabase project ref,
 *     otherwise the run is refused (never silently downgraded to a write).
 *   - Delegates ONLY to `enrichEcBatchWithValidatedSources`, always passing the
 *     allowlist + requireEcCountry. It never touches prospect-generation, never
 *     calls providers/HubSpot/Slack, never runs DDL/migrations.
 *   - The helper enforces the batch/EC/allowlist-membership guards fail-closed;
 *     an aborted helper result is surfaced here as a refusal.
 *
 * Server-side only. No Client Component may import this.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  enrichEcBatchWithValidatedSources,
  summarizeEcScvsControlledRun,
  type EcBatchValidatedSourceEnrichmentResult,
  type EcScvsControlledRunSummary,
} from './enrich-ec-batch-with-validated-sources';

/** Absolute hard ceiling for a controlled pilot. No flag or input may raise it. */
export const EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES = 5;

/** Exact confirmation phrase required to enable write (execute) mode. */
export const EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE =
  'EC-SCVS CONTROLLED LIVE PILOT APROBADO' as const;

/** The only Supabase project ref allowed to receive a controlled pilot write. */
export const EC_SCVS_EXPECTED_PROJECT_REF = 'lrdruowtadwbdulndlph' as const;

/**
 * Generic bypass flags are explicitly rejected: only the exact confirmation
 * phrase can authorize a write, and nothing enables full prospect generation.
 */
export const EC_SCVS_CONTROLLED_PILOT_FORBIDDEN_FLAGS = [
  '--force',
  '--yes',
  '--unsafe',
  '--full-generation',
  '--run-prospect-generation',
] as const;

// ── Parsed args ─────────────────────────────────────────────────────────────

export interface EcScvsControlledPilotArgs {
  batchId: string;
  candidateIds: string[];
  /** false (default) = dry-run / no-write. true = attempt a write (still gated). */
  execute: boolean;
  /** The `--confirm` value, verbatim. Null when omitted. */
  confirm: string | null;
}

/** Minimal duck-typed client so tests can inject a fake without the SDK. */
export type EcScvsControlledPilotClient = Parameters<
  typeof enrichEcBatchWithValidatedSources
>[0];

// ── Pure argv parser ──────────────────────────────────────────────────────────

/**
 * Parses CLI argv into structured args. Throws on any forbidden bypass flag or
 * malformed input. Does NOT validate business rules (that is `decide...`).
 */
export function parseEcScvsControlledPilotArgs(
  argv: readonly string[],
): EcScvsControlledPilotArgs {
  for (const forbidden of EC_SCVS_CONTROLLED_PILOT_FORBIDDEN_FLAGS) {
    if (argv.includes(forbidden)) {
      throw new Error(
        `forbidden flag ${forbidden}: only --confirm "${EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE}" can authorize a write`,
      );
    }
  }

  let batchId = '';
  let candidateIdsRaw: string | null = null;
  let execute = false;
  let confirm: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--batch-id':
        batchId = argv[++i] ?? '';
        break;
      case '--candidate-ids':
        candidateIdsRaw = argv[++i] ?? '';
        break;
      case '--execute':
        execute = true;
        break;
      case '--dry-run':
        execute = false;
        break;
      case '--confirm':
        confirm = argv[++i] ?? '';
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  const candidateIds =
    candidateIdsRaw === null
      ? []
      : candidateIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

  return { batchId, candidateIds, execute, confirm };
}

// ── Pure decision (no I/O) ─────────────────────────────────────────────────────

export interface EcScvsControlledPilotDecision {
  /** Safe to proceed to the enrichment helper (in dry-run or write mode). */
  ok: boolean;
  /** True only when a real write is fully authorized. */
  willWrite: boolean;
  /** Machine code for the refusal, or null when ok. */
  code: string | null;
  /** Human-readable, sanitized refusal message, or null when ok. */
  message: string | null;
}

function refuse(code: string, message: string): EcScvsControlledPilotDecision {
  return { ok: false, willWrite: false, code, message };
}

/**
 * Decides whether a controlled pilot may proceed and, if so, whether it may
 * write. Pure: depends only on the args and the resolved project ref. Fails
 * closed on every ambiguity.
 */
export function decideEcScvsControlledPilot(
  args: EcScvsControlledPilotArgs,
  ctx: { projectRef: string | null },
): EcScvsControlledPilotDecision {
  if (!args.batchId || args.batchId.trim().length === 0) {
    return refuse('missing_batch_id', 'a non-empty --batch-id is required');
  }

  const ids = args.candidateIds;
  if (ids.length === 0) {
    return refuse('empty_candidate_ids', 'an explicit, non-empty --candidate-ids allowlist is required');
  }
  if (ids.some((id) => id.trim().length === 0)) {
    return refuse('invalid_candidate_id', 'candidate ids must be non-empty');
  }
  if (new Set(ids).size !== ids.length) {
    return refuse('duplicate_candidate_ids', 'candidate ids must be unique');
  }
  if (ids.length > EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES) {
    return refuse(
      'too_many_candidate_ids',
      `at most ${EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES} candidate ids are allowed (got ${ids.length})`,
    );
  }

  // Dry-run is always permitted once the allowlist is well-formed.
  if (!args.execute) {
    return { ok: true, willWrite: false, code: null, message: null };
  }

  // Write mode is gated by the exact phrase AND the expected project ref.
  if (args.confirm !== EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE) {
    return refuse(
      'confirmation_required',
      `--execute requires --confirm "${EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE}"`,
    );
  }
  if (ctx.projectRef !== EC_SCVS_EXPECTED_PROJECT_REF) {
    return refuse(
      'ambiguous_project_ref',
      'refusing to write: resolved Supabase project ref is not the expected controlled-pilot project',
    );
  }

  return { ok: true, willWrite: true, code: null, message: null };
}

/**
 * Extracts the Supabase project ref from a `https://<ref>.supabase.co` URL.
 * Returns null on anything unrecognized (fail-closed for the ref guard). Never
 * logs the URL.
 */
export function resolveSupabaseProjectRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(url.trim());
  return match ? match[1] : null;
}

// ── Orchestration (delegates ONLY to enrichEcBatchWithValidatedSources) ─────────

export interface EcScvsControlledPilotOutcome {
  ok: boolean;
  refused: boolean;
  code: string | null;
  message: string | null;
  willWrite: boolean;
  dryRun: boolean;
  summary: EcScvsControlledRunSummary | null;
}

export interface EcScvsControlledPilotDeps {
  /** Lazily creates the Supabase client. Invoked ONLY after the decision gate. */
  createSupabaseClient: () => EcScvsControlledPilotClient;
  /** Resolved project ref for the write-mode guard. */
  projectRef: string | null;
  log?: (message: string) => void;
}

/**
 * Runs the controlled pilot. Refuses (without creating a client or writing) on
 * any failed guard. On success delegates to `enrichEcBatchWithValidatedSources`
 * with the explicit allowlist, the strict ceiling, requireEcCountry, and the
 * dry-run flag derived from the decision. Returns a sanitized summary only.
 */
export async function runEcScvsControlledPilot(
  args: EcScvsControlledPilotArgs,
  deps: EcScvsControlledPilotDeps,
): Promise<EcScvsControlledPilotOutcome> {
  const decision = decideEcScvsControlledPilot(args, { projectRef: deps.projectRef });

  if (!decision.ok) {
    // No client created, no write attempted.
    return {
      ok: false,
      refused: true,
      code: decision.code,
      message: decision.message,
      willWrite: false,
      dryRun: true,
      summary: null,
    };
  }

  const dryRun = !decision.willWrite;
  const supabase = deps.createSupabaseClient();

  const result: EcBatchValidatedSourceEnrichmentResult =
    await enrichEcBatchWithValidatedSources(supabase as SupabaseClient, args.batchId, {
      candidateIds: args.candidateIds,
      maxCandidates: EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES,
      dryRun,
      requireEcCountry: true,
    });

  const summary = summarizeEcScvsControlledRun(args.batchId, args.candidateIds.length, result);

  // The helper aborts fail-closed on batch/EC/allowlist-membership violations.
  if (result.aborted) {
    return {
      ok: false,
      refused: true,
      code: 'enrichment_guard_aborted',
      message: summary.errors[0] ?? 'controlled enrichment aborted by a safety guard',
      willWrite: decision.willWrite,
      dryRun,
      summary,
    };
  }

  return {
    ok: true,
    refused: false,
    code: null,
    message: null,
    willWrite: decision.willWrite,
    dryRun,
    summary,
  };
}
