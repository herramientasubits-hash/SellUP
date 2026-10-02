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
import type { ResolveExtraBatchMetadata } from '@/server/agents/prospecting-toolkit/writer-metadata-resolution';
import {
  buildTavilyOfficialIdentityEnricher,
  type TavilyCandidatesEnricher,
} from '@/server/agents/prospecting-toolkit/tavily-official-identity.server';
import type { ResolvedWizardExecution } from './wizard-execution-types';
// AGENT1-APOLLO-LUSHA-WATERFALL § CORTE 1 — autoridad única del objetivo.
import { WIZARD_TARGET_USEFUL_COMPANIES } from '@/modules/prospect-batches/wizard-target-authority';

export const WIZARD_TAVILY_TARGET_INTERNAL = 25;
export const WIZARD_ADAPTIVE_MAX_ROUNDS = 4;
/**
 * AGENT1-TAVILY-V2-1 § 2 — tope de resultados evaluados por corrida.
 *
 * AGENT1-TAVILY-FREE-CREDITS-1 — cada ronda deja pasar hasta 25 resultados (2
 * búsquedas de 20, recortadas por el objetivo interno del pipeline): 4 × 25 =
 * 100 deja correr el plan completo. El gasto lo acota el plan (8 búsquedas).
 */
export const WIZARD_TAVILY_MAX_TOTAL_RAW_TO_EVALUATE = 100;
/**
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 1 — DERIVADO, antes el literal `10`.
 *
 * Este era el TERCER literal del mismo objetivo (junto al de Apollo y al de
 * `apollo-two-round/config.ts`), y no es un detalle de Tavily: el slot del lote
 * se reserva ANTES de saber qué proveedor ejecuta, y `targetCount` se escribe
 * siempre desde la constante de Apollo. Dejar este en 10 mientras el objetivo
 * baja a 5 publicaría un lote que promete 10 y una corrida que busca 5 — la
 * metadata "5/10" que este corte existe para eliminar.
 *
 * `mixed-global-target-authority.test.ts` ya exigía que ambos coincidieran; lo
 * que faltaba era que coincidieran por CONSTRUCCIÓN y no por acuerdo.
 */
export const WIZARD_TARGET_PERSISTIBLE_CANDIDATES = WIZARD_TARGET_USEFUL_COMPANIES;

export type WizardTavilyInput = {
  resolved: ResolvedWizardExecution;
  reservedBatchId: string;
  /**
   * AGENT1-TAVILY-V2-1 § 3 — metadata aditiva del lote (hoy sólo
   * `run_provider_selection`), por la misma costura que usa Apollo.
   */
  extraBatchMetadata?: Record<string, unknown>;
  /**
   * AGENT1-TAVILY-V2-3 — la costura de `accepted_for_target` (CUT-8 · DECISIÓN B),
   * la MISMA que recibe Apollo. Sin ella los lotes de Tavily no publicaban sus
   * aceptadas (Prod 30-09: ff1ba9f2, 1e9fd646, 26f57743).
   */
  resolveExtraBatchMetadata?: ResolveExtraBatchMetadata | null;
  /**
   * AGENT1-TAVILY-FIRST-1 — rondas del tramo de Tavily cuando corre ANTES de
   * Apollo (deja tiempo a Apollo). Ausente ⇒ `WIZARD_ADAPTIVE_MAX_ROUNDS`.
   */
  maxRounds?: number;
  /**
   * AGENT1-TAVILY-OFFICIAL-IDENTITY-1 — identificador fiscal oficial antes del
   * writer. Ausente ⇒ el de producción (fuentes oficiales del país, una vez por
   * corrida). `null` ⇒ sin paso (pruebas).
   */
  enrichCandidatesBeforeWrite?: TavilyCandidatesEnricher | null;
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
  const enrichCandidatesBeforeWrite =
    input.enrichCandidatesBeforeWrite === undefined
      ? buildTavilyOfficialIdentityEnricher({
          country: input.resolved.country.name,
          countryCode: input.resolved.country.code,
          sector: input.resolved.industry.name,
        })
      : input.enrichCandidatesBeforeWrite;
  return runner({
    country: input.resolved.country.name,
    countryCode: input.resolved.country.code,
    industry: input.resolved.industry.name,
    subindustries: input.resolved.subindustries.map((s) => s.name),
    additionalCriteria: input.resolved.additionalCriteria,
    webSearchProvider: 'tavily',
    targetInternal: WIZARD_TAVILY_TARGET_INTERNAL,
    maxRounds: input.maxRounds ?? WIZARD_ADAPTIVE_MAX_ROUNDS,
    maxTotalRawToEvaluate: WIZARD_TAVILY_MAX_TOTAL_RAW_TO_EVALUATE,
    targetPersistibleCandidates: WIZARD_TARGET_PERSISTIBLE_CANDIDATES,
    existingBatchId: input.reservedBatchId,
    triggeredByUserId: input.resolved.userId,
    ownerId: input.resolved.userId,
    dryRun: false,
    usageInputContext: {
      batchId: input.reservedBatchId,
      triggeredByUserId: input.resolved.userId,
    },
    ...(input.extraBatchMetadata ? { extraBatchMetadata: input.extraBatchMetadata } : {}),
    ...(input.resolveExtraBatchMetadata
      ? { resolveExtraBatchMetadata: input.resolveExtraBatchMetadata }
      : {}),
    ...(enrichCandidatesBeforeWrite ? { enrichCandidatesBeforeWrite } : {}),
  });
}
