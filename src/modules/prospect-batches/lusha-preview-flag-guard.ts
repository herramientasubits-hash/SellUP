/**
 * Q3F-5BB.10C2 — Server-side ENABLE_LUSHA_PREVIEW guard (PURE).
 *
 * Small, dependency-free seam the Lusha server actions use so that a flag-off
 * environment can NEVER reach Lusha, even if the action is invoked directly
 * (bypassing the UI gate). It is intentionally pure + injectable so it can be
 * unit-tested without the Next.js server-action runtime:
 *
 *   - `guardLushaPreviewEnabled(flag, disabled, run)` returns `disabled()` when the
 *     flag is off and NEVER calls `run()`. Because `run()` is the only thing that
 *     builds the Lusha client / calls the search / writes the DB, a flag-off call
 *     is structurally incapable of any Lusha side effect.
 *   - It does NOT read `process.env` itself — the caller passes the resolved flag
 *     from `isLushaPreviewEnabled()`. Keeping the env read out of here keeps this
 *     layer pure and testable, and keeps a single source of truth for the flag.
 *
 * NO env, NO I/O, NO provider client, NO DB. Nothing here can perform a side
 * effect on its own.
 */

import {
  buildLushaPendingReviewFailure,
  type PersistLushaPendingReviewResult,
} from '@/server/prospect-batches/lusha-pending-review';

/** Stable error code surfaced when the flag blocks a Lusha action. */
export const LUSHA_PREVIEW_DISABLED_ERROR = 'lusha_preview_disabled' as const;

/** User-facing message for a blocked Lusha action. */
export const LUSHA_PREVIEW_DISABLED_MESSAGE =
  'La generación de prospectos con Lusha está deshabilitada.';

/** Safe blocked result shape for the read-only preview action. */
export interface LushaPreviewDisabledResult {
  ok: false;
  status: 'error';
  error: string;
}

/** Blocked result for `previewLushaCompaniesAction` (no client, no search, no DB). */
export function buildLushaPreviewDisabledResult(): LushaPreviewDisabledResult {
  return { ok: false, status: 'error', error: LUSHA_PREVIEW_DISABLED_ERROR };
}

/** Blocked result for `generateLushaPendingReviewBatchAction` (no client, no search, no DB). */
export function buildLushaPendingReviewDisabledResult(): PersistLushaPendingReviewResult {
  return buildLushaPendingReviewFailure(
    LUSHA_PREVIEW_DISABLED_MESSAGE,
    LUSHA_PREVIEW_DISABLED_ERROR,
  );
}

/**
 * Run the guarded Lusha work only when the flag is enabled. When disabled,
 * returns `disabled()` and NEVER invokes `run()` — so no Lusha client is built,
 * no search runs, and no DB write happens. Pure control-flow; both branches are
 * supplied by the caller.
 */
export async function guardLushaPreviewEnabled<T>(
  flagEnabled: boolean,
  disabled: () => T,
  run: () => Promise<T>,
): Promise<T> {
  if (!flagEnabled) return disabled();
  return run();
}
