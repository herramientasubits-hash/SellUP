/**
 * EC SCVS — Controlled live-pilot runner CLI (EC-SCVS-11-PRETOOL)
 *
 * Production-capable ONLY in the future, and impossible to run accidentally.
 * By default this CLI is DRY-RUN (no write). A real write requires ALL of:
 *   - `--execute`,
 *   - `--confirm "EC-SCVS CONTROLLED LIVE PILOT APROBADO"` (exact),
 *   - the expected Supabase project ref (lrdruowtadwbdulndlph),
 *   - an EC batch whose named candidates are all EC and inside the batch,
 *   - at most 5 explicit candidate ids.
 * Without the exact confirmation, writes are refused. Without `--execute`, a
 * write is never attempted.
 *
 * This CLI delegates ONLY to `enrichEcBatchWithValidatedSources` (via the pure
 * runner core). It NEVER runs full prospect generation, never calls providers /
 * HubSpot / Slack / Apollo / Lusha, never runs DDL / migrations / db push.
 *
 * The Supabase admin client is created via the canonical fail-closed factory
 * (`src/lib/supabase/admin.ts`) and ONLY after the decision gate passes. This
 * script does not read env values directly beyond resolving the project ref,
 * and never prints the URL, keys, full RUC, or raw_data.
 *
 * Usage (dry-run — safe, still reads production when actually run):
 *   node --env-file=.env.local --import tsx \
 *     scripts/source-catalog/run-ec-scvs-controlled-pilot.ts \
 *     --batch-id <uuid> --candidate-ids id1,id2,id3
 *
 * Usage (write — requires operational authorization and the exact phrase):
 *   node --env-file=.env.local --import tsx \
 *     scripts/source-catalog/run-ec-scvs-controlled-pilot.ts \
 *     --batch-id <uuid> --candidate-ids id1,id2,id3 \
 *     --execute --confirm "EC-SCVS CONTROLLED LIVE PILOT APROBADO"
 *
 * Hito EC-SCVS-11-PRETOOL: NOT executed against production in this change.
 */

import {
  parseEcScvsControlledPilotArgs,
  runEcScvsControlledPilot,
  resolveSupabaseProjectRef,
  EC_SCVS_CONFIRM_PHRASE_BY_INTENT,
  EC_SCVS_DEFAULT_EXECUTION_INTENT,
  EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES,
  type EcScvsControlledPilotArgs,
} from '../../src/server/source-catalog/enrichment/ec-scvs-controlled-pilot';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';

function printHeader(args: EcScvsControlledPilotArgs, willAttemptWrite: boolean): void {
  const intent = args.executionIntent ?? EC_SCVS_DEFAULT_EXECUTION_INTENT;
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(' EC SCVS — Controlled live-pilot runner — EC-SCVS-11-PRETOOL');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  batch_id:            ${args.batchId}`);
  console.log(`  execution_intent:    ${intent}`);
  console.log(`  requested_candidates: ${args.candidateIds.length} (max ${EC_SCVS_CONTROLLED_PILOT_MAX_CANDIDATES})`);
  console.log(`  mode:                ${willAttemptWrite ? '⚠️  EXECUTE (writes)' : 'DRY-RUN (no write)'}`);
  console.log(`  delegates to:        enrichEcBatchWithValidatedSources (allowlist, EC-only)`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  let args: EcScvsControlledPilotArgs;
  try {
    args = parseEcScvsControlledPilotArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\n[error] ${err instanceof Error ? err.message : String(err)}`);
    console.error(
      `\n  Recordatorio: writes exigen --execute y --confirm con la frase del intent:` +
        `\n    - controlled_pilot:  "${EC_SCVS_CONFIRM_PHRASE_BY_INTENT.controlled_pilot}"` +
        `\n    - limited_expansion: "${EC_SCVS_CONFIRM_PHRASE_BY_INTENT.limited_expansion}"`,
    );
    process.exit(1);
    return;
  }

  printHeader(args, args.execute);

  // Project ref is resolved from the environment but never printed verbatim.
  const projectRef = resolveSupabaseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL ?? null);

  const outcome = await runEcScvsControlledPilot(args, {
    // The admin client is created ONLY when the decision gate passes.
    createSupabaseClient: createSupabaseAdminClient,
    projectRef,
    // Read-only batch-metadata accessor for the limited-expansion seed guard.
    // Invoked only after the phrase/ref gate passes, strictly before any write.
    loadBatchMetadata: async (batchId) => {
      const client = createSupabaseAdminClient();
      const { data, error } = await client
        .from('prospect_batches')
        .select('metadata')
        .eq('id', batchId)
        .maybeSingle();
      if (error || !data) return null;
      const meta = (data as { metadata?: unknown }).metadata;
      return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null;
    },
    log: (message) => console.log(message),
  });

  if (outcome.refused) {
    console.error(`\n[refused] code=${outcome.code ?? 'unknown'}`);
    console.error(`          ${outcome.message ?? 'controlled pilot refused'}`);
    console.error('\n  No se escribió en producción.');
    // Print the sanitized summary when the helper produced one.
    if (outcome.summary) {
      console.error('\n─── summary (safe) ─────────────────────────────────────────────────');
      console.error(JSON.stringify(outcome.summary, null, 2));
    }
    process.exit(1);
    return;
  }

  console.log('\n─── EC-SCVS-11-PRETOOL — controlled run summary (safe) ─────────────');
  console.log(`  mode: ${outcome.dryRun ? 'DRY-RUN (no write)' : 'EXECUTE (writes applied)'}`);
  console.log(JSON.stringify(outcome.summary, null, 2));
  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

// Guard: run main only when this file is the direct entry point.
const callerFile = process.argv[1] ?? '';
if (callerFile.includes('run-ec-scvs-controlled-pilot')) {
  main().catch((err) => {
    console.error('[error fatal]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
