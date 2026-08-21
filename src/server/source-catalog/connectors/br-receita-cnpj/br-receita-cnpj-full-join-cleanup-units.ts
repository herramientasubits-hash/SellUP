/**
 * BR Receita CNPJ — GATE-6 cleanup UNIT ADAPTERS (BR-SOURCE-GATE-ROUND-2).
 *
 * The coordinator reduces unit outcomes; it must never learn how to delete anything. These adapters
 * are the join between the two: each wraps a deletion that its OWNING module already confined to
 * itself, and translates that module's own vocabulary into the coordinator's single outcome shape.
 *
 * Why the translation is worth a module of its own: the two owners report different things, and the
 * differences are exactly where a cleanup contract goes wrong.
 *
 *   · the partition workspace distinguishes `failed` from `unverified` — "the deletion broke" versus
 *     "nobody can say whether it finished". Both are non-success, and both must stay non-success.
 *   · the private artifact reports `deleted` and `verifiedAbsent` SEPARATELY, because an unlink that
 *     returned successfully and a file that is provably gone are different claims.
 *
 * A single adapter that flattened either distinction into a boolean would be the "success with
 * residue" path GATE-6 forbids, arriving as a type conversion.
 *
 * ── These adapters NEVER ────────────────────────────────────────────────────
 *   - import `node:fs`. The private-artifact adapter takes the injected filesystem port; the
 *     workspace adapter takes an already-constructed workspace whose port was injected at creation.
 *   - construct, join, normalize or validate a path. The one path they see is the one the owning
 *     module already validated and created.
 *   - delete anything themselves. Every deletion is the owner's own confined operation.
 *   - throw. A failure is a returned outcome, because the coordinator treats a throw as an
 *     unattempted deletion and that would lose the detail the owner did report.
 */

import {
  deleteBrazilReceitaFullJoinPrivateArtifact,
  isBrazilReceitaFullJoinPrivateArtifactExpired,
  type BrazilReceitaFullJoinPrivateChannelFileSystem,
} from './br-receita-cnpj-full-join-operator-metric-channel';
import type { BrazilReceitaCleanupUnit, BrazilReceitaCleanupUnitOutcome } from './br-receita-cnpj-full-join-cleanup-coordinator';
import type { BrazilReceitaFullJoinWorkspace } from './br-receita-cnpj-full-join-partition-workspace';

/**
 * Wraps a partition workspace as a cleanup unit.
 *
 * The mapping, stated per outcome so no reader has to infer it:
 *
 *   `completed`   → attempted, verified absent. The success case.
 *   `not_needed`  → attempted, verified absent. Nothing was created, or it was already gone — which
 *                   after the GATE-ROUND-2 idempotence fix is what a second dispose reports.
 *   `failed`      → attempted, NOT verified. Residual entries carried through so the coordinator can
 *                   distinguish "we broke" from "someone else's file is in our directory".
 *   `unverified`  → attempted, NOT verified, no residue claim. Cannot reach success, and is not
 *                   flattened into `failed` — the coordinator emits a distinct failure code for it.
 */
export function brazilReceitaWorkspaceCleanupUnit(
  workspace: BrazilReceitaFullJoinWorkspace,
): BrazilReceitaCleanupUnit {
  return {
    unitClass: 'partition_workspace',
    destroy(): BrazilReceitaCleanupUnitOutcome {
      const result = workspace.dispose();
      const verifiedAbsent =
        (result.outcome === 'completed' || result.outcome === 'not_needed') && result.verifiedAbsent;
      return {
        verifiedAbsent,
        residualEntries: result.foreignEntriesLeftInPlace,
        deletionAttempted: true,
      };
    },
  };
}

/**
 * Wraps the private operator metric artifact as a cleanup unit.
 *
 * 🔴 § 16 — this is registered SEPARATELY from partition data, and the separation is the point. The
 * artifact has a contractual TTL (default 1 h, hard ceiling 24 h) and may legitimately outlive the
 * process; what it may never do is outlive a cleanup path that reports `completed`. So:
 *
 *   · at cleanup time the artifact is deleted UNCONDITIONALLY, TTL or no TTL. A live TTL is a licence
 *     to survive a process, not a licence to survive a declared-completed cleanup.
 *   · `brazilReceitaPrivateArtifactTtlPurgeUnit` is the other half, for a purge SWEEP rather than a
 *     run cleanup: it deletes only once the TTL has elapsed, and a still-live artifact is reported
 *     verified-absent-not-applicable rather than as a deletion that happened.
 *
 * The two are separate functions because using the purge semantics inside a run cleanup is precisely
 * how a stale private artifact would survive a completed cleanup.
 */
export function brazilReceitaPrivateArtifactCleanupUnit(
  destinationFile: string,
  fileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem,
): BrazilReceitaCleanupUnit {
  return {
    unitClass: 'private_metric_artifact',
    destroy(): BrazilReceitaCleanupUnitOutcome {
      const outcome = deleteBrazilReceitaFullJoinPrivateArtifact(destinationFile, fileSystem);
      return {
        // `deleted` alone is not enough: only the post-deletion check licenses the claim.
        verifiedAbsent: outcome.deleted && outcome.verifiedAbsent,
        residualEntries: 0,
        deletionAttempted: outcome.requested,
      };
    },
  };
}

/**
 * The TTL purge variant, for a sweep that is not a run's own cleanup.
 *
 * A still-live artifact yields `verifiedAbsent: false` with `deletionAttempted: false` — "not my
 * business yet", which the coordinator reads as non-success. That is deliberate: a purge sweep that
 * reported `completed` while a live artifact sat on disk would be a completed cleanup with residue,
 * so this unit is for a purge coordinator, never for a run's terminal cleanup.
 */
export function brazilReceitaPrivateArtifactTtlPurgeUnit(
  destinationFile: string,
  expiresAtMs: number,
  nowMs: number,
  fileSystem: BrazilReceitaFullJoinPrivateChannelFileSystem,
): BrazilReceitaCleanupUnit {
  return {
    unitClass: 'private_metric_artifact',
    destroy(): BrazilReceitaCleanupUnitOutcome {
      if (!isBrazilReceitaFullJoinPrivateArtifactExpired(expiresAtMs, nowMs)) {
        return { verifiedAbsent: false, residualEntries: 0, deletionAttempted: false };
      }
      const outcome = deleteBrazilReceitaFullJoinPrivateArtifact(destinationFile, fileSystem);
      return {
        verifiedAbsent: outcome.deleted && outcome.verifiedAbsent,
        residualEntries: 0,
        deletionAttempted: outcome.requested,
      };
    },
  };
}
