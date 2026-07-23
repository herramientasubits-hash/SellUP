/**
 * Wizard final review summary — Q3F-5BB.3F
 *
 * Pure, client-safe helpers that turn the conversational wizard's collected
 * state into HUMAN labels for the final "Revisa tu búsqueda" review step.
 *
 * Why this exists:
 *   The final review previously reused the Lusha panel's own recap, which only
 *   knew the mapped Lusha sector/country and DROPPED the subindustry the user
 *   actually selected (there is no reliable catalog→Lusha sub-industry mapping,
 *   so the Lusha input carries `subIndustryId: null`). The UI must still show
 *   the label the user chose. These helpers resolve the wizard's own catalog
 *   labels for display only — they never touch the Lusha request.
 *
 * Design rules:
 *   - Pure: no side effects, no I/O, no env reads, no network, no DB.
 *   - Node-testable: imports types only (no React / DOM / client components).
 *   - Display only: never used to build or alter the Lusha provider request.
 */

import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

// ── Static UI copy for the final review (exported for tests + reuse) ──────────

/** Fixed employee-size criterion enforced server-side (>200 employees). */
export const WIZARD_FINAL_SIZE_LABEL = 'Más de 200 empleados';
/** Discreet provider traceability, never a selector. */
export const WIZARD_FINAL_PROVIDER_LABEL = 'Lusha';
/** Estimated cost ceiling per search (server-authoritative guardrail). */
export const WIZARD_FINAL_COST_LABEL = 'Hasta 1 crédito';
export const WIZARD_FINAL_REVIEW_TITLE = 'Revisa tu búsqueda';
export const WIZARD_FINAL_REVIEW_DESCRIPTION =
  'SellUp buscará empresas candidatas con estos criterios. Nada se guardará todavía.';
export const WIZARD_FINAL_REVIEW_READONLY_NOTE =
  'Estos resultados todavía no se guardan en SellUp. En un siguiente paso podrás enviarlos a revisión.';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal slice of wizard state needed to build the display labels. */
export interface WizardFinalSummaryState {
  industryId: string | null;
  subindustryIds: string[];
  additionalCriteriaRaw: string | null;
}

/** Human labels resolved from the wizard's own catalog (display only). */
export interface WizardFinalSummaryLabels {
  /** Selected industry name, e.g. "Tecnología". */
  sectorLabel: string;
  /** Joined selected subindustry names, or null when none was chosen. */
  subIndustryLabel: string | null;
  /** Trimmed additional criterion, or null when none was provided. */
  criteriaLabel: string | null;
}

/**
 * Full recap payload for the final review card. Combines the resolved wizard
 * labels with the fixed final-review copy so the presentational recap can be a
 * dumb, effect-free renderer.
 */
export interface WizardFinalRecap {
  title: string;
  description: string;
  sectorLabel: string;
  subIndustryLabel: string | null;
  sizeLabel: string;
  criteriaLabel: string | null;
  /** Provider name, shown as "Proveedor configurado: {providerLabel}". */
  providerLabel: string;
  costLabel: string;
  readOnlyNote: string;
}

// ── Builders ────────────────────────────────────────────────────────────────

/** Resolve the human labels for the wizard's selected criteria (display only). */
export function buildWizardFinalSummaryLabels(
  state: WizardFinalSummaryState,
  catalog: ActiveIndustryCatalog,
): WizardFinalSummaryLabels {
  const industry = catalog.industries.find((i) => i.id === state.industryId);
  const subs = catalog.subindustries.filter((s) =>
    state.subindustryIds.includes(s.id),
  );
  const criteria = state.additionalCriteriaRaw?.trim();

  return {
    sectorLabel: industry?.name ?? '—',
    subIndustryLabel:
      subs.length > 0 ? subs.map((s) => s.name).join(', ') : null,
    criteriaLabel: criteria && criteria.length > 0 ? criteria : null,
  };
}

/** Assemble the full final-review recap payload from wizard state + catalog. */
export function buildWizardFinalRecap(
  state: WizardFinalSummaryState,
  catalog: ActiveIndustryCatalog,
): WizardFinalRecap {
  const labels = buildWizardFinalSummaryLabels(state, catalog);
  return {
    title: WIZARD_FINAL_REVIEW_TITLE,
    description: WIZARD_FINAL_REVIEW_DESCRIPTION,
    sectorLabel: labels.sectorLabel,
    subIndustryLabel: labels.subIndustryLabel,
    sizeLabel: WIZARD_FINAL_SIZE_LABEL,
    criteriaLabel: labels.criteriaLabel,
    providerLabel: WIZARD_FINAL_PROVIDER_LABEL,
    costLabel: WIZARD_FINAL_COST_LABEL,
    readOnlyNote: WIZARD_FINAL_REVIEW_READONLY_NOTE,
  };
}
