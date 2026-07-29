import type { CatalogAvailability } from '@/modules/industry-catalog/catalog-availability';

// ── Experience contract ────────────────────────────────────────────────────────
// Single source of truth for which experience renders inside the drawer.
// Resolved server-side in prospects-module-panel and passed as serializable props.

/**
 * A1-LEGACY-PATH-FENCE-1 (P0): `legacy` is NO LONGER a member of this union.
 *
 * It used to be the fallback for three distinct conditions — wizard flag off,
 * catalog empty, catalog failed to load — and `legacy` rendered the legacy Apollo
 * form whose CTA could spend up to 25 Apollo credits per click with no
 * reservation, no spend confirmation and no idempotency. A read failure on a
 * config table was therefore one click away from unbudgeted provider spend.
 *
 * Every one of those conditions now resolves to `unavailable`, which renders an
 * explicit state with NO billable CTA. The legacy form body still exists in the
 * drawer (see GenerateAIBatchDrawerExperience) so it stays compilable and
 * testable, but nothing in the normal degradation path can select it.
 */
export type GenerateProspectsExperience =
  | 'chat_wizard'
  | 'exploratory_form_v2'
  | 'unavailable';

/**
 * Which explanatory state the drawer should render when the experience is
 * `unavailable`. Distinct from the experience itself because the three cases need
 * different copy and different affordances:
 *
 * - `wizard_disabled`      — no experience flag is on. Nothing to configure, no retry.
 * - `catalog_needs_admin`  — catalog empty or structurally inconsistent. A retry
 *                            cannot help; an administrator must republish it.
 * - `catalog_retryable`    — transient read failure. A reload may succeed.
 */
export type GenerateProspectsUnavailableKind =
  | 'wizard_disabled'
  | 'catalog_needs_admin'
  | 'catalog_retryable';

// ── Precedence ────────────────────────────────────────────────────────────────
// chat wizard flag on  + catalog ready → chat_wizard
// v2 flag on           + catalog ready → exploratory_form_v2
// anything else                        → unavailable   (never legacy)

export function resolveGenerateProspectsExperience(
  chatWizardEnabled: boolean,
  v2Enabled: boolean,
  availability: CatalogAvailability,
): GenerateProspectsExperience {
  if (availability.status !== 'ready') return 'unavailable';
  if (chatWizardEnabled) return 'chat_wizard';
  if (v2Enabled) return 'exploratory_form_v2';
  return 'unavailable';
}

/**
 * Resolves which unavailable state to render. Returns null when the experience is
 * usable, so a caller cannot accidentally render an error state over a working
 * wizard.
 *
 * Note the ordering: a catalog failure is reported even when no flag is on. That
 * combination cannot occur through `resolveCatalogAvailability` (it returns
 * `disabled` without querying when nothing requested the catalog), but resolving
 * it explicitly keeps the function total rather than relying on that invariant.
 */
export function resolveGenerateProspectsUnavailableKind(
  chatWizardEnabled: boolean,
  v2Enabled: boolean,
  availability: CatalogAvailability,
): GenerateProspectsUnavailableKind | null {
  if (availability.status === 'ready') {
    return chatWizardEnabled || v2Enabled ? null : 'wizard_disabled';
  }
  if (availability.status === 'disabled') return 'wizard_disabled';
  if (availability.status === 'empty') return 'catalog_needs_admin';
  return availability.retryable ? 'catalog_retryable' : 'catalog_needs_admin';
}
