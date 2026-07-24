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
 * Execution intent for a write. Selects WHICH confirmation phrase authorizes the
 * write and whether the limited-expansion seed-batch metadata guard applies.
 *
 *   - `controlled_pilot`   — the original single controlled live pilot.
 *   - `limited_expansion`  — a limited expansion batch run (EC-SCVS-15FIX).
 *
 * The default is always `controlled_pilot` (the safest, narrowest intent). A
 * phrase minted for one intent must NEVER authorize the other.
 */
export type EcScvsExecutionIntent = 'controlled_pilot' | 'limited_expansion';

/** Safe default intent when `--execution-intent` is omitted. */
export const EC_SCVS_DEFAULT_EXECUTION_INTENT: EcScvsExecutionIntent = 'controlled_pilot';

/**
 * Exact confirmation phrase required to enable a LIMITED EXPANSION write.
 * Deliberately distinct from the controlled-pilot phrase — the two are never
 * interchangeable.
 */
export const EC_SCVS_LIMITED_EXPANSION_CONFIRM_PHRASE =
  'EC-SCVS LIMITED EXPANSION EXECUTE APROBADO' as const;

/**
 * The confirmation phrase required per execution intent. A write is refused
 * unless `--confirm` matches EXACTLY the phrase mapped to the chosen intent.
 */
export const EC_SCVS_CONFIRM_PHRASE_BY_INTENT: Record<EcScvsExecutionIntent, string> = {
  controlled_pilot: EC_SCVS_CONTROLLED_PILOT_CONFIRM_PHRASE,
  limited_expansion: EC_SCVS_LIMITED_EXPANSION_CONFIRM_PHRASE,
};

/** Every valid execution intent, for argv validation. */
export const EC_SCVS_EXECUTION_INTENTS: readonly EcScvsExecutionIntent[] = [
  'controlled_pilot',
  'limited_expansion',
];

/**
 * Absolute ceiling on a limited-expansion seed batch's declared `max_candidates`.
 * Mirrors the controlled-pilot ceiling — limited expansion never widens the
 * blast radius beyond a single small allowlist.
 */
export const EC_SCVS_LIMITED_EXPANSION_MAX_CANDIDATES = EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES;

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
  /**
   * Which write intent is being authorized. Optional for backward compatibility;
   * absent is treated as `controlled_pilot` (the safe default). The parser always
   * populates it explicitly.
   */
  executionIntent?: EcScvsExecutionIntent;
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
  let executionIntent: EcScvsExecutionIntent = EC_SCVS_DEFAULT_EXECUTION_INTENT;

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
      case '--execution-intent': {
        const raw = argv[++i] ?? '';
        if (!EC_SCVS_EXECUTION_INTENTS.includes(raw as EcScvsExecutionIntent)) {
          throw new Error(
            `invalid --execution-intent "${raw}": expected one of ${EC_SCVS_EXECUTION_INTENTS.join(', ')}`,
          );
        }
        executionIntent = raw as EcScvsExecutionIntent;
        break;
      }
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

  return { batchId, candidateIds, execute, confirm, executionIntent };
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

  // Write mode is gated by the exact phrase for the chosen intent AND the
  // expected project ref. The phrase is intent-specific: the controlled-pilot
  // phrase never authorizes a limited-expansion write, and vice versa. The
  // limited-expansion seed-batch metadata guard is enforced separately, in the
  // orchestrator, strictly before any write.
  const intent = args.executionIntent ?? EC_SCVS_DEFAULT_EXECUTION_INTENT;
  const requiredPhrase = EC_SCVS_CONFIRM_PHRASE_BY_INTENT[intent];
  if (args.confirm !== requiredPhrase) {
    return refuse(
      'confirmation_required',
      `--execute --execution-intent ${intent} requires --confirm "${requiredPhrase}"`,
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

// ── Limited-expansion seed-batch metadata guard (pure) ──────────────────────────

export interface EcScvsBatchMetadataDecision {
  ok: boolean;
  code: string | null;
  message: string | null;
}

/**
 * Validates that a batch is a legitimate LIMITED EXPANSION seed batch before any
 * write. Pure: depends only on the supplied batch metadata. Fails closed on any
 * missing or unexpected flag. A limited-expansion seed batch MUST declare exactly:
 *   - `limited_expansion_seed === true`
 *   - `runner_required        === true`
 *   - `provider_calls_allowed === false`
 *   - `do_not_sync_hubspot    === true`
 *   - `do_not_notify_slack    === true`
 *   - `max_candidates`: an integer in [1, EC_SCVS_LIMITED_EXPANSION_MAX_CANDIDATES]
 *
 * Anything else (missing metadata, wrong flag value, out-of-range ceiling) is a
 * refusal — the runner must never write a limited-expansion batch that was not
 * minted, explicitly, as a runner-only, provider/HubSpot/Slack-disabled seed.
 */
export function decideLimitedExpansionBatchMetadata(
  metadata: Record<string, unknown> | null | undefined,
): EcScvsBatchMetadataDecision {
  const refuseBatch = (code: string, message: string): EcScvsBatchMetadataDecision => ({
    ok: false,
    code,
    message,
  });

  if (!metadata || typeof metadata !== 'object') {
    return refuseBatch('batch_metadata_missing', 'limited expansion requires seed-batch metadata');
  }

  if (metadata['limited_expansion_seed'] !== true) {
    return refuseBatch(
      'batch_not_limited_expansion_seed',
      'batch must declare limited_expansion_seed=true',
    );
  }
  if (metadata['runner_required'] !== true) {
    return refuseBatch('batch_runner_not_required', 'batch must declare runner_required=true');
  }
  if (metadata['provider_calls_allowed'] !== false) {
    return refuseBatch(
      'batch_provider_calls_allowed',
      'batch must declare provider_calls_allowed=false',
    );
  }
  if (metadata['do_not_sync_hubspot'] !== true) {
    return refuseBatch('batch_hubspot_sync_not_blocked', 'batch must declare do_not_sync_hubspot=true');
  }
  if (metadata['do_not_notify_slack'] !== true) {
    return refuseBatch('batch_slack_notify_not_blocked', 'batch must declare do_not_notify_slack=true');
  }

  const max = metadata['max_candidates'];
  if (
    typeof max !== 'number' ||
    !Number.isInteger(max) ||
    max < 1 ||
    max > EC_SCVS_LIMITED_EXPANSION_MAX_CANDIDATES
  ) {
    return refuseBatch(
      'batch_max_candidates_out_of_range',
      `batch max_candidates must be an integer in [1, ${EC_SCVS_LIMITED_EXPANSION_MAX_CANDIDATES}]`,
    );
  }

  return { ok: true, code: null, message: null };
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
  /**
   * Read-only accessor for a batch's metadata, used by the LIMITED EXPANSION
   * seed-batch guard. Invoked ONLY when a limited-expansion write is authorized
   * (after the phrase/ref gate passes) and strictly before any write. Returns
   * null when the batch/metadata is absent. It MUST never write. Not required for
   * controlled-pilot runs or for dry-runs.
   */
  loadBatchMetadata?: (batchId: string) => Promise<Record<string, unknown> | null>;
  log?: (message: string) => void;
}

/** Builds a refusal outcome (no client created, no write attempted). */
function refusedOutcome(
  code: string | null,
  message: string | null,
  summary: EcScvsControlledRunSummary | null = null,
  willWrite = false,
  dryRun = true,
): EcScvsControlledPilotOutcome {
  return { ok: false, refused: true, code, message, willWrite, dryRun, summary };
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
    return refusedOutcome(decision.code, decision.message);
  }

  const intent = args.executionIntent ?? EC_SCVS_DEFAULT_EXECUTION_INTENT;

  // ── Limited-expansion seed-batch sub-gate ───────────────────────────────────
  // A limited-expansion WRITE must target a batch that was explicitly minted as a
  // limited-expansion seed (runner-only; providers/HubSpot/Slack disabled; tiny).
  // Validate the batch metadata BEFORE creating the write client or issuing any
  // write. Fail closed on a missing loader, a load failure, or incompatible
  // metadata. Controlled-pilot runs and dry-runs skip this (no write to gate).
  if (decision.willWrite && intent === 'limited_expansion') {
    if (!deps.loadBatchMetadata) {
      return refusedOutcome(
        'batch_metadata_unavailable',
        'limited expansion write requires batch metadata validation, but no loader was provided',
      );
    }
    let batchMetadata: Record<string, unknown> | null;
    try {
      batchMetadata = await deps.loadBatchMetadata(args.batchId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return refusedOutcome('batch_metadata_load_failed', msg.slice(0, 200));
    }
    const batchDecision = decideLimitedExpansionBatchMetadata(batchMetadata);
    if (!batchDecision.ok) {
      // No write client created, no write attempted.
      return refusedOutcome(
        batchDecision.code ?? 'batch_metadata_incompatible',
        batchDecision.message ?? 'incompatible limited-expansion seed batch',
      );
    }
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
