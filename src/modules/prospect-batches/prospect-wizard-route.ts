/**
 * Prospect wizard dry-route resolver — Q3F-5BB.10C3-FIX-1 (P1-3)
 *
 * Pure, side-effect-free description of WHICH server action the "Generar con IA"
 * wizard WOULD invoke for a given set of collected criteria + flags, and whether
 * that path could reach Apollo — WITHOUT running any provider, wizard execution,
 * Lusha search, or database write.
 *
 * Purpose: a pre-QA safety gate. Before the wizard is ever opened in production,
 * an operator (or a test) can assert WHICH action a given set of criteria would
 * reach, without opening the wizard.
 *
 * Design rules:
 *   - Pure: no side effects, no I/O, no env reads, no network, no DB.
 *   - Client-safe: reuses only the pure `resolveWizardLushaCriteria` bridge.
 *   - NEVER runs Lusha or any generation action. It only classifies.
 *
 * ── Invariant (enforced by tests) ────────────────────────────────────────────
 * Whenever `effectiveProvider === 'lusha'`, `wouldUseApollo` is `false`: a run
 * that actually goes to Lusha never touches Apollo or Tavily. That is the safety
 * property the 10C3 incident violated and it is unchanged.
 *
 * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 restates the OTHER half. Previously a
 * Lusha-eligible intent with the flag OFF resolved to `wouldCallAction: null` —
 * i.e. nothing was runnable at all — which is what left «Empresas por criterios»
 * with no executable path for every industry that maps to a Lusha sector, in all
 * 20 supported countries. Lusha is a HIDDEN provider the user never selects, so
 * there is no user Lusha intent to protect: with the flag OFF the search takes the
 * ordinary Agent 1 discovery route, exactly as it does for any industry that maps
 * to no Lusha sector. `intendedProvider` still reports the eligibility so the
 * distinction stays observable in telemetry.
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
  /**
   * Machine-readable reason why the HIDDEN Lusha route was not honored, when
   * `effectiveProvider === 'blocked_lusha_disabled'`. Telemetry only: it explains
   * why Lusha is out, never why the search would be unavailable — the search still
   * has the Agent 1 discovery route.
   */
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
    // Lusha pending-review persistence only — never Apollo, never Tavily.
    wouldCallAction = 'generateLushaPendingReviewBatchAction';
  } else {
    // `blocked_lusha_disabled` conserva su motivo para telemetría, y a partir de
    // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 comparte camino con `default_ai`:
    // el discovery de Agente 1, que es el que corresponde a «empresas por
    // criterios» cuando el proveedor oculto no participa.
    if (effectiveProvider === 'blocked_lusha_disabled') {
      blockedReason = effective.reason;
    }
    if (executionEnabled) {
      wouldCallAction = 'executeProspectWizardGenerationAction';
      wouldUseApollo = true;
    }
  }

  return {
    intendedProvider,
    effectiveProvider,
    blockedReason,
    wouldCallAction,
    wouldUseApollo,
  };
}
