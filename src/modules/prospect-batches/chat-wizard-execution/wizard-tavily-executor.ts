/**
 * wizard-tavily-executor.ts — Boundary between wizard execution and the Tavily pipeline.
 *
 * Provider is always 'tavily'. Target is always WIZARD_TAVILY_TARGET_INTERNAL (25).
 * existingBatchId is always the reserved batch — the writer reuses it, never creates a new one.
 * Apollo and any other provider are inaccessible from this module.
 *
 * Subindustry names (canonical, resolved from catalog) are forwarded to the incremental
 * search pipeline so query builders can inject subindustry-specific discovery queries.
 * Hito 16AB.43.14.
 */

import { runIncrementalProspectingSearch } from '@/server/agents/prospecting-toolkit/incremental-search';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { ResolvedWizardExecution } from './wizard-execution-types';

export const WIZARD_TAVILY_TARGET_INTERNAL = 25;

export type WizardTavilyInput = {
  resolved: ResolvedWizardExecution;
  reservedBatchId: string;
};

export type WizardTavilyRunner = (input: WizardTavilyInput) => Promise<IncrementalSearchOutput>;

/**
 * Executes the Tavily incremental search using the wizard's resolved context.
 * All parameters are fixed server-side — the caller cannot override provider,
 * target count, batchId, or dryRun.
 *
 * @param input - Resolved wizard context and the pre-reserved batchId.
 * @param runnerOverride - For testing only. Production callers always omit this.
 */
export async function runWizardTavilySearch(
  input: WizardTavilyInput,
  runnerOverride?: typeof runIncrementalProspectingSearch,
): Promise<IncrementalSearchOutput> {
  const runner = runnerOverride ?? runIncrementalProspectingSearch;
  return runner({
    country: input.resolved.country.name,
    countryCode: input.resolved.country.code,
    industry: input.resolved.industry.name,
    subindustries: input.resolved.subindustries.map((s) => s.name),
    webSearchProvider: 'tavily',
    targetInternal: WIZARD_TAVILY_TARGET_INTERNAL,
    existingBatchId: input.reservedBatchId,
    triggeredByUserId: input.resolved.userId,
    ownerId: input.resolved.userId,
    dryRun: false,
    usageInputContext: {
      batchId: input.reservedBatchId,
      triggeredByUserId: input.resolved.userId,
    },
  });
}
