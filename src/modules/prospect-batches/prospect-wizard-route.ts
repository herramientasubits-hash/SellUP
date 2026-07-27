/**
 * Prospect wizard dry-route resolver — Q3F-5BB.10C3-FIX-1 (P1-3)
 *
 * Pure, side-effect-free description of WHICH server action the "Generar con IA"
 * wizard WOULD invoke for a given set of collected criteria + flags, and whether
 * that path could reach Apollo — WITHOUT running any provider, wizard execution,
 * Lusha search, or database write.
 *
 * Purpose: a pre-QA safety gate. Before the wizard is ever opened in production,
 * an operator (or a test) can assert that a Lusha-eligible search with the
 * preview flag OFF resolves to `blocked_lusha_disabled` and `wouldUseApollo:
 * false` — i.e. the exact leak that caused the 10C3 incident is provably closed.
 *
 * Design rules:
 *   - Pure: no side effects, no I/O, no env reads, no network, no DB.
 *   - Client-safe: reuses only the pure `resolveWizardLushaCriteria` bridge.
 *   - NEVER runs Lusha or any generation action. It only classifies.
 *
 * Invariant (enforced by tests): whenever `intendedProvider === 'lusha'`,
 * `wouldUseApollo` is `false`. A Lusha intent can only be honored (`lusha`) or
 * blocked (`blocked_lusha_disabled`) — it can never be re-routed to the
 * Apollo-capable Agent 1 generation action.
 */

import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import {
  resolveWizardLushaCriteria,
  type WizardLushaCriteriaState,
} from '@/modules/prospect-batches/wizard-lusha-criteria';

/** What the wizard would route to if the flag were on (the user's intent). */
export type ProspectWizardIntendedProvider = 'lusha' | 'default_ai';

/** What the wizard actually routes to given the real flag state. */
export type ProspectWizardEffectiveProvider =
  | 'lusha'
  | 'blocked_lusha_disabled'
  | 'default_ai';

/**
 * The server action this route would invoke on the explicit final click, or
 * `null` when the route is blocked or has nothing runnable (execution off).
 */
export type ProspectWizardRouteAction =
  | 'generateLushaPendingReviewBatchAction'
  | 'executeProspectWizardGenerationAction'
  | null;

export interface ProspectWizardRouteInput {
  criteria: WizardLushaCriteriaState;
  catalog: ActiveIndustryCatalog;
  /** Mirrors ENABLE_LUSHA_PREVIEW (canonical parse). */
  lushaPreviewEnabled: boolean;
  /** Mirrors ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION (canonical parse). */
  executionEnabled: boolean;
}

export interface ProspectWizardRoute {
  intendedProvider: ProspectWizardIntendedProvider;
  effectiveProvider: ProspectWizardEffectiveProvider;
  /** Machine-readable reason when `effectiveProvider === 'blocked_lusha_disabled'`. */
  blockedReason: string | null;
  wouldCallAction: ProspectWizardRouteAction;
  /** True only when the default-AI generation action (Apollo-capable) would run. */
  wouldUseApollo: boolean;
}

/**
 * Resolve the dry-route for the wizard's collected criteria + flags. Pure.
 */
export function resolveProspectWizardRoute(
  input: ProspectWizardRouteInput,
): ProspectWizardRoute {
  const { criteria, catalog, lushaPreviewEnabled, executionEnabled } = input;

  // Intent = eligibility, decided independently of the flag. Forcing the flag on
  // reveals whether the criteria WOULD route to Lusha at all.
  const isLushaEligible =
    resolveWizardLushaCriteria(criteria, catalog, true).provider === 'lusha';
  const intendedProvider: ProspectWizardIntendedProvider = isLushaEligible
    ? 'lusha'
    : 'default_ai';

  // Effective = the real decision under the actual flag state.
  const effective = resolveWizardLushaCriteria(
    criteria,
    catalog,
    lushaPreviewEnabled,
  );
  const effectiveProvider = effective.provider as ProspectWizardEffectiveProvider;

  let wouldCallAction: ProspectWizardRouteAction = null;
  let wouldUseApollo = false;
  let blockedReason: string | null = null;

  if (effectiveProvider === 'lusha') {
    // Lusha pending-review persistence only — never Apollo.
    wouldCallAction = 'generateLushaPendingReviewBatchAction';
  } else if (effectiveProvider === 'blocked_lusha_disabled') {
    // STRICT-ALL fail closed: no action, no Apollo, no batch.
    blockedReason = effective.reason;
  } else if (executionEnabled) {
    // default_ai — reachable ONLY for non-Lusha-eligible criteria. This is the
    // Apollo-capable Agent 1 generation action.
    wouldCallAction = 'executeProspectWizardGenerationAction';
    wouldUseApollo = true;
  }

  return {
    intendedProvider,
    effectiveProvider,
    blockedReason,
    wouldCallAction,
    wouldUseApollo,
  };
}
