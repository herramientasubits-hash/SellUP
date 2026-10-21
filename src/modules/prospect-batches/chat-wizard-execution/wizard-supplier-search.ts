/**
 * AGENT1-SUPPLIER-SEARCH-1 — «Proveedores de una empresa», Fase 1 (puro; dependencias inyectadas).
 *
 * La persona escribe una empresa de referencia (p. ej. «Ecopetrol»), un país y una
 * industria. Claude busca en la web empresas de esa industria con evidencia pública de
 * que le venden (casos de éxito, «nuestros clientes»…) y las escribe en el lote de la
 * corrida con el escritor de siempre: sitio, duplicados SellUp/HubSpot (sólo lectura),
 * número fiscal oficial, país, sector, tamaño y «una empresa, un vendedor».
 *
 * Camino propio y corto a propósito:
 *  - NO corre la capa gratuita, el banco, Tavily, Apollo ni Lusha: ninguno sabe buscar
 *    «quién le vende a X». Por eso tampoco reserva del presupuesto del piloto; Claude
 *    se rige por su cuota de Proveedores (`checkProviderQuotaAvailable('anthropic')`).
 *  - La industria es OBLIGATORIA: así todas las compuertas por industria funcionan como
 *    siempre y lo que no encaja lo reasigna o descarta el rescate de Claude.
 *  - Lo que no cabe en los 10 no va al banco de empresas (un proveedor de X no es un
 *    candidato general del país × industria).
 *  - Nada se aprueba solo. 0 escrituras en HubSpot.
 *
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-1 (Fase 2) — si la referencia es una ENTIDAD PÚBLICA de
 * un país con compras públicas conectadas (hoy Colombia, SECOP II), sus proveedores de
 * la industria salen primero de ahí, gratis y con el contrato como prueba. Claude corre
 * después sólo si faltan empresas para Por revisar.
 */

import type { ClaudeSearchLegOutcome } from './wizard-claude-search-leg';
import { claudeLegWriterTruth, CLAUDE_SEARCH_LEG_TAIL_MS, WIZARD_FUNCTION_LIMIT_MS } from './wizard-claude-search-leg';
import type { WizardExecutionActionResult } from './wizard-execution-types';
import {
  buildCompetitorNoNewBreakdown,
  combineCompetitorRounds,
  type CompetitorBatchOutcome,
} from './wizard-competitor-run';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult } from './wizard-idempotency';
import type { CatalogResolutionOutput } from './wizard-catalog-resolver';
import {
  decidePersistenceReadiness,
  type PersistenceReadinessProbe,
} from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import {
  durableCandidatesFromCount,
  resolveBatchTerminalStatusDecision,
  type BatchTerminalStatus,
} from '@/server/prospect-batches/batch-durable-candidates';
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  resolveAcceptanceFromRunFacts,
  toAcceptedForTargetMetadata,
} from '@/modules/prospect-batches/accepted-for-target';
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
  type ProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import {
  resolveDiscoveryTaxonomyCapability,
  toDiscoveryTaxonomyMetadata,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';
import { FREQUENT_PUBLIC_SUPPLIER_COUNTRY_CODES } from '@/server/prospect-batches/supplier-search/countries/codes';
import {
  PUBLIC_BUYER_SUPPLIER_COUNTRIES,
  SUPPLIER_PUBLIC_BUYER_METADATA_KEY,
  type PublicBuyerRelationship,
  type PublicBuyerStepOutcome,
} from '@/server/prospect-batches/supplier-search/public-buyer-suppliers';

/** Lo que el producto promete entregar, igual que «Empresas por criterios». */
export const SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES = 10;
/** Tope para EMPEZAR consultas a Claude cuando es el único paso de la corrida. */
export const SUPPLIER_SEARCH_MAX_PHASE_MS = 170_000;
/** Clave del bloque del lote con lo que hizo el paso (qué aportó o por qué no corrió). */
export const SUPPLIER_SEARCH_LEG_METADATA_KEY = 'supplier_search_leg';
/**
 * AGENT1-SUPPLIER-SEARCH-4 — rondas de Claude por corrida. Prod 14-10: los proveedores
 * famosos de una gran empresa ya están en HubSpot/SellUp (Bancolombia: 4 de 5
 * duplicados); la 2.ª ronda pide medianos y menos conocidos, con lo visto excluido.
 * Tope ≈ US$0,50 por corrida.
 */
export const SUPPLIER_SEARCH_MAX_ROUNDS = 2;
/** Tope por ronda para EMPEZAR consultas: con dos rondas y el rescate, cabe en los 300 s. */
export const SUPPLIER_SEARCH_ROUND_MAX_PHASE_MS = 110_000;
/** Con menos que esto por delante no se empieza una ronda. */
export const SUPPLIER_SEARCH_ROUND_MIN_PHASE_MS = 50_000;
/** Lo que una ronda deja al final: escribir (90 s) y el rescate en línea (60 s). */
export const SUPPLIER_SEARCH_ROUND_TAIL_MS = 150_000;
/** Ventana máxima para que el rescate de Claude EMPIECE empresas dentro de la corrida. */
export const SUPPLIER_SEARCH_RESCUE_WINDOW_MS = 60_000;
/** Por debajo de esto no vale la pena empezar a revisar. */
export const SUPPLIER_SEARCH_MIN_RESCUE_WINDOW_MS = 15_000;
/** Lo que se deja al final para terminar la empresa en curso y sellar el lote. */
export const SUPPLIER_SEARCH_RESCUE_TAIL_MS = 90_000;

export type SupplierSearchRunDeps = {
  /** `ENABLE_AGENT1_SUPPLIER_SEARCH`; ausente = apagada. */
  resolveSupplierSearchEnabled?: () => boolean;
  /** «Claude busca proveedores» escribiendo en el lote de la corrida. */
  runClaudeSupplierSearch?: (input: { batchId: string; phaseMs: number; round?: number }) => Promise<ClaudeSearchLegOutcome>;
  /**
   * AGENT1-SUPPLIER-SEARCH-4 — lo que quedó en el lote (para Por revisar, duplicadas de
   * HubSpot / SellUp). Decide la 2.ª ronda y el «sin empresas nuevas» honesto. `null` =
   * no se pudo leer (se decide con lo que dijo el escritor).
   */
  countCompetitorBatchOutcome?: (batchId: string) => Promise<CompetitorBatchOutcome | null>;
  /**
   * AGENT1-SUPPLIER-SEARCH-3 — el MISMO rescate de Claude que corre en segundo plano
   * (sector y tamaño), aquí dentro de la corrida y con ventana corta. `true` = revisó.
   */
  rescueBatchInline?: (input: { batchId: string; windowMs: number }) => Promise<boolean>;
  /**
   * AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — «Proveedores frecuentes del Estado» (sin
   * referencia): empresas que le venden a varias entidades públicas del país.
   */
  runFrequentPublicSuppliers?: (input: {
    batchId: string;
    countryCode: string;
    macroIndustryKey: string;
  }) => Promise<PublicBuyerStepOutcome>;
  /** Ids de las filas web del lote que cuentan para la meta, leídos tras el rescate. */
  listAcceptedCandidateIds?: (batchId: string) => Promise<string[] | null>;
  /**
   * AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — proveedores de una entidad pública según las
   * compras públicas del país (gratis). Ausente = Fase 1 tal cual.
   */
  runPublicBuyerSuppliers?: (input: {
    batchId: string;
    referenceCompanyName: string;
    countryCode: string;
    macroIndustryKey: string;
  }) => Promise<PublicBuyerStepOutcome>;
  /**
   * Ids de las filas de compras públicas que cuentan para la meta, leídos al final:
   * fuente oficial con web, ni duplicadas ni descartadas (incluye las que el rescate
   * admitió desde Descartadas). Misma regla que la capa gratuita del asistente.
   */
  listAcceptedPublicCandidateIds?: (batchId: string) => Promise<string[] | null>;
  /** «Proveedor de X» con la prueba del contrato en los candidatos con ese NIT. */
  tagPublicBuyerSuppliers?: (input: {
    batchId: string;
    referenceCompanyName: string;
    relationships: readonly PublicBuyerRelationship[];
  }) => Promise<number>;
  checkPersistenceReadiness: () => Promise<PersistenceReadinessProbe>;
  reserveSlot: (input: WizardExecutionReservationInput) => Promise<WizardExecutionReservationResult>;
  /** Sella el estado del lote y publica su metadata terminal en la MISMA escritura. */
  sealFreeOnlyBatchStatus?: (input: {
    batchId: string;
    status: BatchTerminalStatus;
    metadata?: Record<string, unknown> | null;
  }) => Promise<void>;
  actionStartedAtMs?: number;
  nowMs?: () => number;
};

export type SupplierSearchRunInput = {
  userId: string;
  clientRequestId: string;
  countryCode: string;
  countryName: string;
  catalogVersion: string;
  additionalCriteria: string | null;
  referenceCompanyName: string;
  /**
   * AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — sin empresa de referencia: proveedores frecuentes
   * del Estado (sólo compras públicas, Claude no corre). `referenceCompanyName` llega con
   * `FREQUENT_PUBLIC_REFERENCE_LABEL`.
   */
  scope?: 'frequent_public';
  catalogResolution: CatalogResolutionOutput;
  searchDepth: string;
};

/** Tiempo para empezar consultas: lo que quede de los 300 s menos la cola de escritura. */
export function resolveSupplierSearchPhaseMs(elapsedMs: number | null): number {
  const remaining = WIZARD_FUNCTION_LIMIT_MS - (elapsedMs ?? 0);
  return Math.max(0, Math.min(SUPPLIER_SEARCH_MAX_PHASE_MS, remaining - CLAUDE_SEARCH_LEG_TAIL_MS));
}

/** Tiempo para EMPEZAR una ronda, o `null` si ya no cabe con la escritura y el rescate. */
export function resolveSupplierRoundPhaseMs(elapsedMs: number | null): number | null {
  const phase = Math.min(
    SUPPLIER_SEARCH_ROUND_MAX_PHASE_MS,
    WIZARD_FUNCTION_LIMIT_MS - (elapsedMs ?? 0) - SUPPLIER_SEARCH_ROUND_TAIL_MS,
  );
  return phase >= SUPPLIER_SEARCH_ROUND_MIN_PHASE_MS ? phase : null;
}

/** ¿Otra ronda? Sólo si faltan empresas NUEVAS para Por revisar y quedan rondas. */
export function shouldRunAnotherSupplierRound(
  leg: Extract<ClaudeSearchLegOutcome, { executed: true }>,
  round: number,
  reviewable: number | null,
  maxRounds: number = SUPPLIER_SEARCH_MAX_ROUNDS,
): boolean {
  if (round + 1 >= maxRounds) return false;
  return (reviewable ?? leg.completeValidCandidates ?? 0) < SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES;
}

/** Ventana del rescate en línea, o `null` si ya no hay tiempo para empezar. */
export function resolveSupplierRescueWindowMs(elapsedMs: number | null): number | null {
  if (elapsedMs === null) return null;
  const window = Math.min(
    SUPPLIER_SEARCH_RESCUE_WINDOW_MS,
    WIZARD_FUNCTION_LIMIT_MS - elapsedMs - SUPPLIER_SEARCH_RESCUE_TAIL_MS,
  );
  return window >= SUPPLIER_SEARCH_MIN_RESCUE_WINDOW_MS ? window : null;
}

/** Texto para la persona cuando el paso de Claude no pudo correr. */
export function describeSupplierSearchFailure(reason: string): { message: string; retryable: boolean } {
  // AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — «frecuentes» sin resultado o en un país sin compras cargadas.
  if (reason === 'no_frequent_suppliers') {
    return {
      message:
        'No hay empresas que le vendan a 3 o más entidades públicas en esa industria y país. Prueba con otra industria o con una entidad de referencia.',
      retryable: false,
    };
  }
  if (reason === 'industry_without_unspsc') {
    return {
      message: 'Las compras públicas de ese país no permiten separar esa industria. Prueba con otra industria.',
      retryable: false,
    };
  }
  if (reason === 'frequent_country_not_supported') {
    return {
      message: 'Proveedores frecuentes del Estado todavía no está disponible para ese país.',
      retryable: false,
    };
  }
  if (reason === 'quota_exhausted') {
    return {
      message: 'Se agotó la cuota mensual de Claude en Proveedores. Pide que la amplíen para seguir buscando proveedores.',
      retryable: false,
    };
  }
  if (reason.startsWith('model_not_configured')) {
    return {
      message: 'Falta configurar el modelo de Claude en Configuración → IA para buscar proveedores.',
      retryable: false,
    };
  }
  return {
    message: 'No se pudo completar la búsqueda de proveedores. Inténtalo de nuevo en unos minutos.',
    retryable: true,
  };
}

type ExecutedLeg = Extract<ClaudeSearchLegOutcome, { executed: true }>;

/**
 * Lo que dejaron las compras públicas, con la forma de una ronda (costo 0) para sumar
 * con Claude las filas del lote. Su aceptación NO va aquí sino como aporte gratuito
 * (`publicBuyerDemand`). `null` si no corrió o no dejó nada en el lote.
 */
export function publicLegOf(step: PublicBuyerStepOutcome | null): ExecutedLeg | null {
  if (!step?.executed || (step.written === 0 && step.recordedWithoutWebsite === 0)) return null;
  return {
    executed: true,
    persistedCandidates: step.written,
    completeValidCandidates: 0,
    acceptedIdentities: [],
    estimatedCostUsd: 0,
    proposed: step.offered,
    passedPreFilter: step.written,
  };
}

/**
 * AGENT1-AUDIT-WS2 § A — compras públicas SÍ encontró proveedores (`offered > 0`) pero
 * no escribió ninguno: todos ya eran de alguien (Por revisar, cuenta o de otro
 * vendedor). Antes `publicLegOf` devolvía `null`, Claude tampoco corría (hay
 * proveedores ⇒ 0 rondas) y la corrida terminaba en «No se pudo completar… Inténtalo de
 * nuevo» con el lote `failed`, invitando a repetir algo que daría lo mismo. Es una
 * ronda que corrió sin novedades: `no_new_candidates` con su desglose.
 */
export function publicNothingNewLegOf(step: PublicBuyerStepOutcome | null): ExecutedLeg | null {
  if (!step?.executed || step.offered <= 0 || publicLegOf(step) !== null) return null;
  // AGENT1-SUPPLIER-AUDIT-NOW-1 — una escritura que falló no es «ya eran de alguien».
  if (step.writeFailed || step.recordWithoutWebsiteFailed) return null;
  return {
    executed: true,
    persistedCandidates: 0,
    completeValidCandidates: 0,
    acceptedIdentities: [],
    estimatedCostUsd: 0,
    proposed: step.offered,
    passedPreFilter: 0,
  };
}

/** AGENT1-AUDIT-WS2 § A — el desglose de «sin novedades» de compras públicas. */
export function buildPublicStepNoNewBreakdown(step: Extract<PublicBuyerStepOutcome, { executed: true }>) {
  return buildCompetitorNoNewBreakdown({
    reviewable: 0,
    hubspotDuplicates: 0,
    // Lo ofrecido que no se escribió ni quedó sin web: ya estaba reclamado en SellUp.
    sellupDuplicates: Math.max(0, step.offered - step.written - step.recordedWithoutWebsite),
  });
}

/** El bloque del lote: qué hizo el paso, sin las frases de prueba (van en cada candidato). */
export function publicStepMetadata(step: PublicBuyerStepOutcome, tagged: number | null): Record<string, unknown> {
  if (!step.executed) return { executed: false, reason: step.reason };
  const { relationships, ...rest } = step;
  return { ...rest, suppliers: relationships.length, tagged };
}

/** Rondas de Claude cuando compras públicas trajo proveedores pero no dejó NADA en el lote. */
export const SUPPLIER_PUBLIC_FALLBACK_ROUNDS = 1;

/**
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-3 — ¿cuántas rondas de Claude? NINGUNA si compras públicas
 * dejó algo (decisión de la dueña, 15-10): Claude no encuentra nada útil para entidades
 * públicas (Prod 15-10: Alcaldía de Medellín 2 rondas, US$0,50 → 2 descartadas; Ministerio
 * de Educación 1 ronda, US$0,23 → 0 propuestas). Si compras públicas no corrió o no trajo
 * a nadie de la industria, Claude hace sus dos rondas de siempre (Fase 1).
 *
 * AGENT1-SUPPLIER-AUDIT-NOW-1 (auditoría 21-10, dueña: «sólo si no dejó nada») — antes se
 * miraba lo OFRECIDO: si compras públicas trajo proveedores pero no dejó ni uno para
 * revisar ni para rescatar (todas duplicadas, o la escritura falló), la corrida terminaba
 * en cero sin intentar nada. Ahí corre UNA ronda. `reviewable` = lo que quedó en Por
 * revisar tras el paso público (`null` = no se leyó; se usa lo escrito).
 */
export function resolveClaudeRoundsAfterPublic(step: PublicBuyerStepOutcome | null, reviewable: number | null): number {
  if (!step?.executed || step.offered <= 0) return SUPPLIER_SEARCH_MAX_ROUNDS;
  const leftSomething = (reviewable ?? step.written) > 0 || step.recordedWithoutWebsite > 0;
  return leftSomething ? 0 : SUPPLIER_PUBLIC_FALLBACK_ROUNDS;
}

/** Errores que no cambian la corrida, pero que deben quedar en los registros. */
function logSupplierRunError(step: string, batchId: string, err: unknown): void {
  console.error(`[supplier-search] ${step} (lote ${batchId}):`, err instanceof Error ? err.message : String(err));
}

/**
 * AGENT1-SUPPLIER-SEARCH-PUBLIC-2 — las de compras públicas cuentan para la meta como la
 * capa gratuita del asistente (fuente oficial con web = aceptada): entran como lo que la
 * mitad gratuita «ya cerró» antes de Claude. Prod 15-10: 7 buenas y aceptadas = 0,
 * porque sólo se sumaba lo de Claude y estas filas no llevan `target_completeness`.
 */
export function publicBuyerDemand(publicAccepted: number): ProviderResultDemand {
  if (publicAccepted <= 0) return fullTargetResultDemand(SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES);
  return resolveProviderResultDemand(
    {
      requestedTarget: SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
      acceptedBeforeProvider: publicAccepted,
      residualGap: Math.max(0, SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES - publicAccepted),
      providerRequired: publicAccepted < SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
    },
    SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
  );
}

export async function executeSupplierSearchRun(
  input: SupplierSearchRunInput,
  deps: SupplierSearchRunDeps,
): Promise<WizardExecutionActionResult> {
  // 1. Bandera — el servidor manda, aunque el navegador ofrezca la opción.
  if (deps.resolveSupplierSearchEnabled?.() !== true) {
    return {
      ok: false,
      code: 'EXECUTION_DISABLED',
      message: 'La búsqueda de proveedores todavía no está habilitada.',
      retryable: false,
    };
  }
  if (!deps.runClaudeSupplierSearch) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'La búsqueda de proveedores no está disponible en este momento.',
      retryable: false,
    };
  }

  // 2. ¿Se pueden guardar candidatos? Antes de crear el lote y de pagar a Claude.
  const persistenceReadiness = decidePersistenceReadiness(
    await deps.checkPersistenceReadiness().catch((): PersistenceReadinessProbe => ({ status: 'probe_failed' })),
  );
  if (!persistenceReadiness.ready) {
    return {
      ok: false,
      code: 'PERSISTENCE_NOT_READY',
      message: persistenceReadiness.adminMessage,
      retryable: persistenceReadiness.reason === 'probe_failed',
      persistenceNotReady: {
        errorCode: persistenceReadiness.errorCode,
        reason: persistenceReadiness.reason,
        stage: persistenceReadiness.stage,
      },
    };
  }

  // 3. El lote de la corrida (idempotente por usuario + clientRequestId).
  const { catalogResolution } = input;
  const macroIndustryKey = resolveMacroIndustryKey({
    slug: catalogResolution.industry.slug,
    displayName: catalogResolution.industry.name,
  });
  let reservation: WizardExecutionReservationResult;
  try {
    reservation = await deps.reserveSlot({
      userId: input.userId,
      clientRequestId: input.clientRequestId,
      initialBatchPayload: {
        requestSource: 'chat_wizard',
        catalogVersionId: catalogResolution.catalog.version,
        industryId: catalogResolution.industry.id,
        subindustryIds: catalogResolution.subindustries.map((s) => s.id),
        countryCode: input.countryCode,
        additionalCriteria: input.additionalCriteria,
        targetCount: SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
        country: input.countryName,
        industry: catalogResolution.industry.name,
        searchDepth: input.searchDepth,
        discoveryTaxonomy: {
          ...toDiscoveryTaxonomyMetadata(resolveDiscoveryTaxonomyCapability(catalogResolution.catalog.version)),
          macro_industry_key: macroIndustryKey,
          macro_industry_display_name: catalogResolution.industry.name,
          requested_subindustries: catalogResolution.subindustries.map((s) => s.name),
        },
        supplierSearch: {
          referenceCompanyName: input.referenceCompanyName,
          ...(input.scope ? { scope: input.scope } : {}),
        },
      },
    });
  } catch {
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'No se pudo reservar la ejecución. Por favor, intenta nuevamente.',
      retryable: true,
    };
  }

  // Un reintento de la MISMA corrida no vuelve a pagar a Claude.
  if (reservation.status === 'already_reserved') {
    return {
      ok: true,
      status: 'already_started',
      batchId: reservation.batchId,
      batchStatus: 'draft',
      redirectPath: `/prospect-batches/${reservation.batchId}`,
    };
  }
  const batchId = reservation.batchId;

  // 4. Claude busca proveedores y escribe en el lote (el escritor decide el estado).
  const elapsed = (): number | null =>
    deps.actionStartedAtMs === undefined ? null : (deps.nowMs ? deps.nowMs() : Date.now()) - deps.actionStartedAtMs;
  const runSupplierSearch = deps.runClaudeSupplierSearch;
  const runRound = async (round: number, phaseMs: number): Promise<ClaudeSearchLegOutcome> => {
    try {
      return await runSupplierSearch({ batchId, phaseMs, round });
    } catch (err) {
      return { executed: false, reason: `failed:${(err instanceof Error ? err.message : String(err)).slice(0, 160)}` };
    }
  };
  const readOutcome = async (): Promise<CompetitorBatchOutcome | null> =>
    deps.countCompetitorBatchOutcome ? await deps.countCompetitorBatchOutcome(batchId).catch(() => null) : null;

  // 4-pre. AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — compras públicas primero (gratis). Un
  //        tropiezo no tumba la corrida: Claude sigue como en la Fase 1.
  const stepFailed = (err: unknown): PublicBuyerStepOutcome => ({
    executed: false,
    reason: `failed:${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`,
  });
  const isFrequent = input.scope === 'frequent_public';
  const publicStep: PublicBuyerStepOutcome | null = isFrequent
    ? // AGENT1-SUPPLIER-FREQUENT-PUBLIC-1 — sin referencia: sólo compras públicas cargadas.
      !FREQUENT_PUBLIC_SUPPLIER_COUNTRY_CODES.includes(input.countryCode) || !deps.runFrequentPublicSuppliers
      ? { executed: false, reason: 'frequent_country_not_supported' }
      : !macroIndustryKey
        ? { executed: false, reason: 'industry_without_unspsc' }
        : await deps
            .runFrequentPublicSuppliers({ batchId, countryCode: input.countryCode, macroIndustryKey })
            .catch(stepFailed)
    : deps.runPublicBuyerSuppliers && macroIndustryKey && PUBLIC_BUYER_SUPPLIER_COUNTRIES.includes(input.countryCode)
      ? await deps
          .runPublicBuyerSuppliers({
            batchId,
            referenceCompanyName: input.referenceCompanyName,
            countryCode: input.countryCode,
            macroIndustryKey,
          })
          .catch(stepFailed)
      : null;
  const publicLeg = publicLegOf(publicStep);
  let batchOutcome = publicLeg && publicLeg.persistedCandidates > 0 ? await readOutcome() : null;
  // AGENT1-SUPPLIER-SEARCH-PUBLIC-3 — según lo que compras públicas dejó para revisar.
  // «Frecuentes» no tiene a quién preguntarle a Claude: nunca corre.
  const claudeRounds = isFrequent
    ? 0
    : resolveClaudeRoundsAfterPublic(publicStep, batchOutcome?.reviewable ?? publicLeg?.persistedCandidates ?? null);

  const firstRound: ClaudeSearchLegOutcome =
    claudeRounds === 0
    ? { executed: false, reason: isFrequent ? 'frequent_public_only' : 'public_buyer_suppliers_found' }
    : await runRound(0, resolveSupplierRoundPhaseMs(elapsed()) ?? resolveSupplierSearchPhaseMs(elapsed()));
  const rounds: Array<{ round: number; outcome: ClaudeSearchLegOutcome }> = [{ round: 0, outcome: firstRound }];
  // AGENT1-AUDIT-WS2 § A — compras públicas corrió sin novedades: ronda ejecutada en 0.
  const publicNothingNewLeg = publicNothingNewLegOf(publicStep);
  let leg: ClaudeSearchLegOutcome = firstRound.executed
    ? publicLeg
      ? combineCompetitorRounds(publicLeg, firstRound)
      : firstRound
    : (publicLeg ?? publicNothingNewLeg ?? firstRound);
  if (firstRound.executed) batchOutcome = await readOutcome();

  // 4a. AGENT1-SUPPLIER-SEARCH-4 — 2.ª ronda: sólo si faltan nuevas y queda tiempo. Una
  //     ronda que falla no tumba lo que la anterior ya dejó en el lote.
  for (
    let round = 0;
    firstRound.executed &&
    leg.executed &&
    shouldRunAnotherSupplierRound(leg, round, batchOutcome?.reviewable ?? null, claudeRounds);
    round += 1
  ) {
    const phaseMs = resolveSupplierRoundPhaseMs(elapsed());
    if (phaseMs === null) {
      rounds.push({ round: round + 1, outcome: { executed: false, reason: 'not_enough_time' } });
      break;
    }
    const next = await runRound(round + 1, phaseMs);
    rounds.push({ round: round + 1, outcome: next });
    if (!next.executed) break;
    leg = combineCompetitorRounds(leg, next);
    batchOutcome = await readOutcome();
  }

  // 4b. AGENT1-SUPPLIER-SEARCH-3 — el escritor mide la aceptación ANTES de saber el
  //     tamaño (Claude no lo trae): Prod 14-10, 6 corridas con 0 aceptadas aunque
  //     Minsait tiene 10.001 empleados. El rescate de Claude (sector y tamaño) corre
  //     aquí, con ventana corta, y la aceptación se relee después. Cualquier tropiezo ⇒
  //     se queda la del escritor; el rescate en segundo plano sigue como siempre.
  let rescue: { reviewed: boolean; acceptedIds: string[] | null; windowMs: number | null } = {
    reviewed: false,
    acceptedIds: null,
    windowMs: null,
  };
  const publicWithoutWebsite = publicStep?.executed ? publicStep.recordedWithoutWebsite : 0;
  if (
    leg.executed &&
    (leg.persistedCandidates > 0 || publicWithoutWebsite > 0) &&
    deps.rescueBatchInline &&
    deps.listAcceptedCandidateIds
  ) {
    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
    const windowMs = resolveSupplierRescueWindowMs(
      deps.actionStartedAtMs === undefined ? null : nowMs - deps.actionStartedAtMs,
    );
    if (windowMs !== null) {
      const reviewed = await deps.rescueBatchInline({ batchId, windowMs }).catch(() => false);
      const acceptedIds = reviewed ? await deps.listAcceptedCandidateIds(batchId).catch(() => null) : null;
      rescue = { reviewed, acceptedIds, windowMs };
      // Las sin web de compras públicas que el rescate admitió entran a Por revisar.
      if (reviewed && publicWithoutWebsite > 0) batchOutcome = (await readOutcome()) ?? batchOutcome;
    }
  }

  // 4c. AGENT1-SUPPLIER-SEARCH-PUBLIC-1 — «Proveedor de X» con el contrato como prueba,
  //     también en las que el rescate acaba de admitir.
  const publicTagged =
    publicStep?.executed && publicStep.relationships.length > 0 && deps.tagPublicBuyerSuppliers
      ? await deps
          .tagPublicBuyerSuppliers({
            batchId,
            referenceCompanyName: input.referenceCompanyName,
            relationships: publicStep.relationships,
          })
          .catch((err) => {
            logSupplierRunError('etiquetar «Proveedor de»', batchId, err);
            return 0;
          })
      : null;

  // 4d. AGENT1-SUPPLIER-SEARCH-PUBLIC-2 — las de compras públicas que cuentan, leídas al
  //     final (el rescate pudo admitir sin web o descartar por tamaño). Sin lectura, las
  //     escritas con web, que es lo que la capa gratuita cuenta al escribir.
  const publicWritten = publicLeg?.persistedCandidates ?? 0;
  const publicAcceptedIds =
    publicLeg && deps.listAcceptedPublicCandidateIds
      ? await deps.listAcceptedPublicCandidateIds(batchId).catch(() => null)
      : null;
  const publicAccepted = publicLeg ? (publicAcceptedIds?.length ?? publicWritten) : 0;

  // 5. La aceptación: la MISMA autoridad que el resto del asistente — compras públicas
  //    como mitad gratuita y Claude en la posición de las piernas tardías.
  const writerTruth = claudeLegWriterTruth(leg);
  const legTruth =
    writerTruth && rescue.acceptedIds !== null
      ? {
          ...writerTruth,
          completeValidCandidates: rescue.acceptedIds.length,
          ...(rescue.acceptedIds.length > 0
            ? { acceptedIdentities: rescue.acceptedIds.map((id) => `candidate:${id}`) }
            : {}),
        }
      : writerTruth;
  // Las sin web de compras públicas que el rescate admitió desde Descartadas también son
  // filas del lote: se cuentan con la lectura de Por revisar tras el rescate.
  const rescuedPublic = rescue.reviewed && publicWithoutWebsite > 0;
  const persisted = Math.max(legTruth?.persistedCandidates ?? 0, rescuedPublic ? (batchOutcome?.reviewable ?? 0) : 0);
  // Las filas de compras públicas son de la mitad gratuita: no se cuentan otra vez como
  // filas de Claude (cada aporte se acota por SUS filas).
  const freeRows = Math.max(publicWritten, publicAccepted);
  const acceptedForTarget = resolveAcceptanceFromRunFacts(
    { demand: publicBuyerDemand(publicAccepted), freePersistedCandidates: freeRows },
    PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
    legTruth
      ? { ...legTruth, persistedCandidates: Math.max(0, legTruth.persistedCandidates - publicWritten) }
      : PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
    persisted,
  );

  // 6. Sellado terminal: estado + metadata en UNA escritura. Si Claude no corrió, el
  //    lote queda `failed` (no hay filas); si corrió, el escritor ya lo cerró y aquí
  //    sólo se republica el estado que decide la máquina de siempre.
  const sealDecision = resolveBatchTerminalStatusDecision({
    preExisting: durableCandidatesFromCount(0),
    persistedCandidates: persisted,
    persistenceFailureCount: leg.executed ? 0 : 1,
  });
  if (sealDecision.action === 'write' && deps.sealFreeOnlyBatchStatus) {
    await deps
      .sealFreeOnlyBatchStatus({
        batchId,
        status: sealDecision.status,
        metadata: {
          [SUPPLIER_SEARCH_LEG_METADATA_KEY]: {
            ...leg,
            rounds,
            inline_rescue: {
              reviewed: rescue.reviewed,
              window_ms: rescue.windowMs,
              accepted_after_rescue: rescue.acceptedIds?.length ?? null,
            },
            ...(publicStep?.executed ? { claude_rounds_allowed: claudeRounds } : {}),
            ...(publicLeg ? { public_accepted: publicAccepted } : {}),
          },
          ...(publicStep ? { [SUPPLIER_PUBLIC_BUYER_METADATA_KEY]: publicStepMetadata(publicStep, publicTagged) } : {}),
          ...(leg.executed ? { [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(acceptedForTarget) } : {}),
        },
      })
      .catch((err) => logSupplierRunError('sellar el lote', batchId, err));
  }

  if (!leg.executed) {
    // En «frecuentes» Claude no corre: el motivo es el de compras públicas.
    const reason = isFrequent && publicStep && !publicStep.executed ? publicStep.reason : leg.reason;
    const failure = describeSupplierSearchFailure(String(reason));
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: failure.message,
      retryable: failure.retryable,
    };
  }

  // AGENT1-SUPPLIER-SEARCH-4 — si todo lo escrito eran duplicadas (Prod 14-10, Bancolombia:
  // 4 de 5), el resultado lo dice con su causa en vez de «se generaron N».
  const reviewable = batchOutcome?.reviewable ?? null;
  const nothingNew = persisted === 0 || reviewable === 0;
  return {
    ok: true,
    status: nothingNew ? 'no_new_candidates' : acceptedForTarget.targetReached ? 'success_target_reached' : 'success_partial',
    ...(batchOutcome && reviewable === 0
      ? { noNewCandidatesBreakdown: buildCompetitorNoNewBreakdown(batchOutcome) }
      : nothingNew && publicNothingNewLeg !== null && publicStep?.executed
        ? { noNewCandidatesBreakdown: buildPublicStepNoNewBreakdown(publicStep) }
        : {}),
    batchId,
    batchStatus: persisted > 0 ? 'ready_for_review' : 'nothing_to_write',
    // AGENT1-SUPPLIER-SEARCH-5 — las que llegan a Por revisar, como «Competidores»: con
    // las duplicadas dentro, el desglose decía «Candidatos creados 7» + «Ya existían en
    // HubSpot 7» y las contaba dos veces (Prod 14-10, Avianca). Sin lectura, las filas.
    candidateCount: reviewable ?? persisted,
    redirectPath: `/prospect-batches/${batchId}`,
    targetPersistibleCandidates: SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
    targetReached: acceptedForTarget.targetReached,
    acceptedForTarget,
    claudeSearchLeg: leg,
  };
}
