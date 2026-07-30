/**
 * A1-LEGACY-PATH-FENCE-1 — Typed catalog availability contract.
 *
 * Why this exists (P0): `prospects-module-panel` used to call `loadActiveCatalog()`
 * inside a bare `try { ... } catch { catalog = null }`. Every distinct failure —
 * a transient Supabase error, a half-published catalog, a structurally broken
 * payload — collapsed into the SAME value as "no catalog was requested":
 * `null`. The experience resolver then turned `null` into the `legacy`
 * experience, which rendered the legacy Apollo form, whose CTA could spend up to
 * 25 Apollo credits per click. A read failure on a config table therefore
 * silently became a billable, unbudgeted provider call.
 *
 * This module replaces `catalog | null` with an explicit, exhaustive status so a
 * failure can never be mistaken for a deliberate downgrade. It is a thin
 * envelope AROUND the shared loader: `loadActiveCatalog` itself is untouched, so
 * every other consumer keeps its current behaviour.
 *
 * Privacy: no variant ever carries a query, filter, country, sector, company
 * name, user id or raw payload — only a static reason code and a retryable flag.
 */

import { CatalogLoadError, loadActiveCatalog } from './loader';
import type { ActiveIndustryCatalog } from './types';

// ── Contract ──────────────────────────────────────────────────────────────────

/** Static reason codes for an unavailable catalog. No PII, no payload. */
export type CatalogUnavailableReason =
  | 'query_failed'
  | 'mixed_versions'
  | 'invalid_industry'
  | 'invalid_subindustry'
  | 'duplicate_ids'
  | 'inconsistent_payload'
  | 'unknown';

/**
 * Exhaustive availability state of the active industry catalog.
 *
 * `disabled` means the catalog was never requested (no experience flag asked for
 * it) — semantically different from every failure state, and never conflated
 * with one. There is deliberately no `null` in this union.
 */
export type CatalogAvailability =
  | { status: 'ready'; catalog: ActiveIndustryCatalog }
  | { status: 'empty' }
  | { status: 'disabled' }
  | {
      status: 'unavailable';
      retryable: boolean;
      reason: CatalogUnavailableReason;
    };

// ── Pure mapping ──────────────────────────────────────────────────────────────

/**
 * Reasons that describe a structurally inconsistent published catalog. These are
 * NOT retryable: retrying the same query returns the same broken payload, so the
 * only fix is an administrator republishing the catalog.
 */
const NON_RETRYABLE_REASONS: ReadonlySet<CatalogUnavailableReason> = new Set([
  'mixed_versions',
  'invalid_industry',
  'invalid_subindustry',
  'duplicate_ids',
  'inconsistent_payload',
]);

/**
 * Maps a thrown catalog-load failure to an availability state. Pure: no I/O, no
 * logging, no env reads — safe to unit test for every known reason.
 *
 * - `empty_catalog`   → `empty`   (nothing published yet; not an error)
 * - `query_failed`    → `unavailable`, retryable   (transient read failure)
 * - consistency error → `unavailable`, NOT retryable
 * - anything else     → `unavailable`, reason `unknown`, NOT retryable
 *
 * An unrecognised throwable is deliberately reported as non-retryable: we cannot
 * prove it is transient, and promising a retry that cannot succeed is worse than
 * pointing at an administrator. Fail-closed applies to the affordance too.
 */
export function mapCatalogLoadFailureToAvailability(
  error: unknown,
): CatalogAvailability {
  if (error instanceof CatalogLoadError) {
    if (error.reason === 'empty_catalog') {
      return { status: 'empty' };
    }
    return {
      status: 'unavailable',
      reason: error.reason,
      retryable: !NON_RETRYABLE_REASONS.has(error.reason),
    };
  }

  return { status: 'unavailable', reason: 'unknown', retryable: false };
}

// ── Loader envelope ───────────────────────────────────────────────────────────

export interface ResolveCatalogAvailabilityDeps {
  /** Injected for tests. Defaults to the shared `loadActiveCatalog`. */
  loadCatalog?: () => Promise<ActiveIndustryCatalog>;
  /** Injected for tests. Receives a PII-free structured event only. */
  logEvent?: (event: {
    event: 'catalog_load_failed';
    reason: CatalogUnavailableReason | 'empty_catalog';
    retryable: boolean;
  }) => void;
}

function defaultLogEvent(event: {
  event: 'catalog_load_failed';
  reason: CatalogUnavailableReason | 'empty_catalog';
  retryable: boolean;
}): void {
  // Static event name + static reason code + boolean. Nothing else may be added
  // here: this line runs on a path where the caller's search criteria are in
  // scope, and any interpolation of them would leak PII into server logs.
  console.warn(
    `[catalog] event=${event.event} reason=${event.reason} retryable=${event.retryable}`,
  );
}

/**
 * Resolves catalog availability without ever throwing and without ever returning
 * `null`.
 *
 * @param requested Whether any experience actually needs the catalog. When
 *   false, returns `disabled` and performs ZERO Supabase queries — preserving
 *   the previous "no flags on ⇒ no query" cost behaviour exactly.
 */
export async function resolveCatalogAvailability(
  requested: boolean,
  deps: ResolveCatalogAvailabilityDeps = {},
): Promise<CatalogAvailability> {
  if (!requested) return { status: 'disabled' };

  const loadCatalog = deps.loadCatalog ?? loadActiveCatalog;
  const logEvent = deps.logEvent ?? defaultLogEvent;

  try {
    const catalog = await loadCatalog();
    return { status: 'ready', catalog };
  } catch (error) {
    const availability = mapCatalogLoadFailureToAvailability(error);
    logEvent({
      event: 'catalog_load_failed',
      reason:
        availability.status === 'unavailable' ? availability.reason : 'empty_catalog',
      retryable: availability.status === 'unavailable' && availability.retryable,
    });
    return availability;
  }
}
