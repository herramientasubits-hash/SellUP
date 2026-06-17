import type { GenerateAIBatchInput } from '@/modules/prospect-batches/actions';
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';
import type { ResolvedWizardExecution, WizardGenerationCommand } from './wizard-execution-types';

// ── System controls ───────────────────────────────────────────────────────────
// targetCount = EXPLORATORY_SEARCH_LIMITS.requestedCount.default (25).
// This constant is the canonical source of truth — never accepted from the client.
// minimumEmployees = 200, matching the hard filter in validateExploratorySearch.

export const WIZARD_SYSTEM_CONTROLS = {
  targetCount: EXPLORATORY_SEARCH_LIMITS.requestedCount.default,
  minimumEmployees: 200,
  employeeThresholdMode: 'hard_filter' as const,
} as const;

// Confirmed equivalences:
//   requestedCount (wizard) ↔ targetCount (pipeline) — same value, different field name
//   minimumEmployees ↔ EMPLOYEE_SIZE_CRITERIA.minEmployeeCountExclusive in action.ts

// ── Adapter defaults ──────────────────────────────────────────────────────────
// searchDepth defaults to 'standard' for wizard-initiated exploratory searches.
// Structured source flags are omitted — the pipeline resolves them from countryCode.

const WIZARD_PIPELINE_DEFAULTS = {
  searchDepth: 'standard' as const,
} as const;

// ── Pure adapter function ─────────────────────────────────────────────────────
// Transforms a ResolvedWizardExecution into a WizardGenerationCommand.
//
// Guarantees:
//   - No I/O, no network calls, no writes, no DB queries
//   - No Date.now(), Math.random(), or UUID generation
//   - No calls to the pipeline or any external service
//   - Subindustries, criteria, catalog version, and clientRequestId are preserved
//     in wizardContext since GenerateAIBatchInput has no corresponding fields

export function adaptResolvedWizardToGenerationInput(
  resolved: ResolvedWizardExecution,
): WizardGenerationCommand {
  const {
    country,
    industry,
    systemControls,
    additionalCriteria,
    subindustries,
    catalog,
    clientRequestId,
  } = resolved;

  const generationInput: GenerateAIBatchInput = {
    country: country.name,
    countryCode: country.code,
    industry: industry.name,
    targetCount: systemControls.targetCount,
    searchDepth: WIZARD_PIPELINE_DEFAULTS.searchDepth,
  };

  return {
    generationInput,
    wizardContext: {
      catalogVersion: catalog.version,
      industryId: industry.id,
      subindustries,
      additionalCriteria,
      clientRequestId,
      employeeSizeCriteria: {
        minEmployeeCountExclusive: systemControls.minimumEmployees,
        enforcement: systemControls.employeeThresholdMode,
        scope: 'local_legal_entity',
      },
    },
  };
}
