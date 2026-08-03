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
import type { RunCorrelationMetadata } from './wizard-run-correlation';
import { isApolloTwoRoundDiscoveryEnabled } from '@/lib/feature-flags.server';
import { resolveApolloTwoRoundConfigFromEnv } from '@/server/agents/prospecting-toolkit/apollo-two-round/env.server';
import {
  toApolloTwoRoundConfigDiagnostics,
  type ApolloTwoRoundDiscoveryConfig,
  type ApolloTwoRoundRunCorrelation,
} from '@/server/agents/prospecting-toolkit/apollo-two-round';
import { runApolloTwoRoundWizardDiscovery } from '@/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server';

export const WIZARD_APOLLO_TARGET_INTERNAL = 25;
export const WIZARD_APOLLO_MAX_ROUNDS = 4;
export const WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES = 10;

/**
 * A1-APOLLO-TWO-ROUND-QUALITY-1 — controles de la modalidad de dos rondas.
 *
 * Con `ENABLE_APOLLO_TWO_ROUND_DISCOVERY` encendido, los tres controles de
 * arriba se sustituyen por los de la configuración central: NO se redeclaran
 * números aquí. El objetivo interno pasa a ser el mismo que el objetivo de
 * empresas elegibles (5) porque en esta modalidad no hay sobre-búsqueda: la
 * corrida se detiene en cuanto reúne cinco.
 */
export type WizardApolloRunControls = {
  targetInternal: number;
  maxRounds: number;
  targetPersistibleCandidates: number;
  modality: 'legacy_four_round' | 'two_round_adaptive';
};

export function resolveWizardApolloRunControls(
  twoRound: { enabled: boolean; config: ApolloTwoRoundDiscoveryConfig },
): WizardApolloRunControls {
  if (!twoRound.enabled) {
    return {
      targetInternal: WIZARD_APOLLO_TARGET_INTERNAL,
      maxRounds: WIZARD_APOLLO_MAX_ROUNDS,
      targetPersistibleCandidates: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
      modality: 'legacy_four_round',
    };
  }
  return {
    targetInternal: twoRound.config.targetEligibleCompanies,
    maxRounds: twoRound.config.maxRounds,
    targetPersistibleCandidates: twoRound.config.targetEligibleCompanies,
    modality: 'two_round_adaptive',
  };
}

export type WizardApolloInput = {
  resolved: ResolvedWizardExecution;
  reservedBatchId: string;
  /**
   * Q3F-5BB.11E — ADITIVO / OBSERVACIONAL. Metadata extra (p.ej.
   * `{ provider_routing }`) que se reenvía tal cual al pipeline para aterrizar
   * de forma aditiva en el metadata del batch. No cambia queries ni proveedor.
   */
  extraBatchMetadata?: Record<string, unknown> | null;
  /**
   * A1-APOLLO-BUDGET-RECONCILIATION-1: correlación del run del wizard, para que
   * cada provider_usage_logs de Apollo quede atado a la reserva que lo pagó por
   * identificadores y no por `created_at`. Opcional para no romper a los tests
   * que sólo ejercitan el pipeline.
   */
  runCorrelation?: RunCorrelationMetadata | null;
  /**
   * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 1/§ 7 — correlación económica completa
   * de la corrida. La modalidad de dos rondas la necesita para derivar claves de
   * operación estables y para reconocer el estado de un intento anterior.
   * Ausente ⇒ la modalidad no se ejecuta (fail-closed).
   */
  correlation?: ApolloTwoRoundRunCorrelation | null;
  /**
   * § 2 — créditos que la reserva sostiene. La aserción defensiva de gasto los
   * compara contra lo que el ledger interno registró.
   */
  reservedCredits?: number;
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
  twoRoundRunnerOverride?: typeof runApolloTwoRoundWizardDiscovery,
): Promise<IncrementalSearchOutput> {
  const runner = runnerOverride ?? runIncrementalProspectingSearch;

  // A1-APOLLO-TWO-ROUND-QUALITY-1 — la modalidad decide los controles de la
  // corrida. Apagada (el estado por defecto), son exactamente los de siempre.
  const twoRoundResolution = resolveApolloTwoRoundConfigFromEnv();
  const controls = resolveWizardApolloRunControls({
    enabled: isApolloTwoRoundDiscoveryEnabled(),
    config: twoRoundResolution.config,
  });

  const twoRoundMetadata =
    controls.modality === 'two_round_adaptive'
      ? {
          apollo_discovery_modality: controls.modality,
          ...toApolloTwoRoundConfigDiagnostics(twoRoundResolution),
        }
      : null;

  // A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 1 — RUTA REAL. Con la modalidad activa,
  // el wizard NO ejecuta el runner incremental legacy con otros números: ejecuta
  // el orquestador de dos rondas, que es quien gobierna rondas, dedup previo al
  // gasto, cap global de enrichment y recuperación de reintentos.
  //
  // Con la modalidad apagada —el estado por defecto— nada de esto se toca y la
  // corrida sigue exactamente por la ruta Apollo de siempre.
  if (controls.modality === 'two_round_adaptive') {
    if (!input.correlation) {
      // Sin correlación no hay clave de idempotencia con la que evitar repetir
      // una operación pagada. Fail-closed: no se ejecuta la modalidad.
      throw new Error('apollo_two_round_requires_run_correlation');
    }
    const twoRoundRunner = twoRoundRunnerOverride ?? runApolloTwoRoundWizardDiscovery;
    return twoRoundRunner({
      country: input.resolved.country.name,
      countryCode: input.resolved.country.code,
      industry: input.resolved.industry.name,
      subindustries: input.resolved.subindustries.map((s) => s.name),
      additionalCriteria: input.resolved.additionalCriteria,
      reservedBatchId: input.reservedBatchId,
      triggeredByUserId: input.resolved.userId,
      ownerId: input.resolved.userId,
      correlation: input.correlation,
      runCorrelationMetadata: input.runCorrelation ?? null,
      extraBatchMetadata: {
        ...(input.extraBatchMetadata ?? {}),
        ...twoRoundMetadata,
      },
      reservedCredits: input.reservedCredits ?? 0,
    });
  }

  return runner({
    country: input.resolved.country.name,
    countryCode: input.resolved.country.code,
    industry: input.resolved.industry.name,
    subindustries: input.resolved.subindustries.map((s) => s.name),
    additionalCriteria: input.resolved.additionalCriteria,
    webSearchProvider: 'apollo_organizations',
    targetInternal: controls.targetInternal,
    maxRounds: controls.maxRounds,
    targetPersistibleCandidates: controls.targetPersistibleCandidates,
    existingBatchId: input.reservedBatchId,
    triggeredByUserId: input.resolved.userId,
    ownerId: input.resolved.userId,
    dryRun: false,
    // Q3F-5BB.11E — reenvía la metadata observacional (provider_routing) al writer.
    // A1-APOLLO-TWO-ROUND-QUALITY-1 añade de forma ADITIVA el diagnóstico
    // sanitizado de la configuración efectiva (§ 2), sólo cuando la modalidad
    // está activa: un lote legacy conserva su metadata sin cambios.
    extraBatchMetadata:
      twoRoundMetadata === null
        ? (input.extraBatchMetadata ?? null)
        : { ...(input.extraBatchMetadata ?? {}), ...twoRoundMetadata },
    usageInputContext: {
      batchId: input.reservedBatchId,
      triggeredByUserId: input.resolved.userId,
    },
    // A1-APOLLO-BUDGET-RECONCILIATION-1 — campo propio, no dentro de
    // usageInputContext, que Tavily comparte y debe seguir siendo agnóstico.
    apolloRunCorrelation: input.runCorrelation ?? null,
  });
}
