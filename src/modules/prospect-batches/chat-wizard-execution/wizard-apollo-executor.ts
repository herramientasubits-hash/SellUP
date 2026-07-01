/**
 * wizard-apollo-executor.ts — Boundary entre el wizard y el pipeline Apollo Organizations.
 *
 * Provider fijo: 'apollo_organizations'.
 * Análogo a wizard-tavily-executor.ts pero ruteado a Apollo.
 * Tavily y cualquier otro provider son inaccesibles desde este módulo.
 *
 * Guardrails heredados de v1.16K-X:
 *   - ENABLE_APOLLO_COMPANY_SEARCH controla si Apollo hace llamadas reales.
 *   - Si el flag está off, Apollo retorna skipped controlado (sin créditos).
 *   - MAX_APOLLO_ORGANIZATIONS_PER_RUN = 10 (aplicado en el provider).
 *
 * usageInputContext se pasa con batchId y triggeredByUserId para trazabilidad.
 *
 * Hito v1.16K-Y.
 */

import { runIncrementalProspectingSearch } from '@/server/agents/prospecting-toolkit/incremental-search';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { ResolvedWizardExecution } from './wizard-execution-types';

export const WIZARD_APOLLO_TARGET_INTERNAL = 25;
export const WIZARD_APOLLO_MAX_ROUNDS = 4;
export const WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES = 10;

export type WizardApolloInput = {
  resolved: ResolvedWizardExecution;
  reservedBatchId: string;
};

export type WizardApolloRunner = (input: WizardApolloInput) => Promise<IncrementalSearchOutput>;

/**
 * Ejecuta el pipeline incremental de Apollo Organizations usando el contexto resuelto del wizard.
 * Todos los parámetros son fijos server-side — el caller no puede sobreescribir provider,
 * targetCount, batchId ni dryRun.
 *
 * El flag ENABLE_APOLLO_COMPANY_SEARCH es respetado por el provider apollo_organizations:
 * si está off, Apollo retorna skipped sin créditos.
 *
 * @param input          Contexto resuelto del wizard y el batchId pre-reservado.
 * @param runnerOverride Solo para tests. Production siempre omite este parámetro.
 */
export async function runWizardApolloSearch(
  input: WizardApolloInput,
  runnerOverride?: typeof runIncrementalProspectingSearch,
): Promise<IncrementalSearchOutput> {
  const runner = runnerOverride ?? runIncrementalProspectingSearch;
  return runner({
    country: input.resolved.country.name,
    countryCode: input.resolved.country.code,
    industry: input.resolved.industry.name,
    subindustries: input.resolved.subindustries.map((s) => s.name),
    additionalCriteria: input.resolved.additionalCriteria,
    webSearchProvider: 'apollo_organizations',
    targetInternal: WIZARD_APOLLO_TARGET_INTERNAL,
    maxRounds: WIZARD_APOLLO_MAX_ROUNDS,
    targetPersistibleCandidates: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
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
