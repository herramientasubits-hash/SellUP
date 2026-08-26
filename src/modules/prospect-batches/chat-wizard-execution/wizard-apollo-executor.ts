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
import { toApolloTwoRoundConfigDiagnostics } from '@/server/agents/prospecting-toolkit/apollo-two-round';
import type { ApolloTwoRoundRunCorrelation } from '@/server/agents/prospecting-toolkit/apollo-two-round';
import { runApolloTwoRoundWizardDiscovery } from '@/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server';
// CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 (CASO B) — la única lectura de
// `subindustry_search_terms` de la ruta de descubrimiento.
import {
  loadApolloSubindustryCatalogTermsForRequest,
  type ApolloSubindustryCatalogTermsLoadResult,
} from '@/server/agents/prospecting-toolkit/apollo-subindustry-catalog-terms-loader.server';
// AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 6 — la demanda residual y su cota.
import {
  boundByRemainingTarget,
  type ProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import type { ApolloPriorProviderSeen } from '@/server/agents/prospecting-toolkit/apollo-organizations-provider-seen';

export const WIZARD_APOLLO_TARGET_INTERNAL = 25;
export const WIZARD_APOLLO_MAX_ROUNDS = 4;
export const WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES = 10;

/**
 * AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION §§ 3, 15 — ¿la ruta Apollo de PRODUCCIÓN
 * aprovecha un hueco PARCIAL de la capa gratuita?
 *
 * `true` desde CUT-6. La CAPACIDAD ya existía desde
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 —`resultDemand` viaja hasta el `per_page`
 * real, las dos rondas comparten UN hueco, `boundByRemainingTarget` es la única
 * cota—; lo que faltaba era la ACTIVACIÓN, y lo que la bloqueaba era un motivo de
 * PRODUCTO, no de capacidad:
 *
 *   apollo_partial_gap_capability = implemented   ← CUT-2
 *   apollo_partial_gap_activation = ON            ← CUT-6 (antes: deferred_single_batch)
 *
 * ── 🔴 Qué desbloqueó la activación ─────────────────────────────────────────
 *
 * El motivo del diferimiento era literal: con `true`, objetivo 10 y 7 empresas
 * gratis, UNA búsqueda del usuario terminaba en DOS lotes —la capa gratuita
 * persistía en el suyo porque corre ANTES de la reserva, y Apollo en el
 * reservado—, con la redirección apuntando al segundo. La invariante de sistema
 * se cumplía (7 + 3 <= 10); el resultado único del producto no.
 *
 * AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING eliminó esa causa: el lote de la
 * ejecución se resuelve UNA vez y perezosamente
 * (`createCanonicalWizardBatchResolver`), y la capa gratuita lo recibe ya, así que
 * lo gratuito y lo de pago aterrizan en el MISMO `batch_id`. El motivo textual del
 * diferimiento dejó de describir el código.
 *
 * ── 🔴 Qué NO significa `true` ───────────────────────────────────────────────
 *
 * · No cambia la economía. La reserva la sigue fijando
 *   `estimateCreditsForProvider(provider)`, que no ve el hueco: el hueco decide
 *   cuántos RESULTADOS pedir, nunca cuántos créditos reservar (§ 8).
 * · No cambia la amplitud de búsqueda. `WIZARD_APOLLO_TARGET_INTERNAL` (25) sigue
 *   intacto; lo que se recorta es el objetivo de ACEPTACIÓN (10).
 * · No activa ningún proveedor. Los flags de disponibilidad, el enrutado y el
 *   orden de fallback están exactamente como estaban (§ 9).
 * · No introduce `accepted_for_target` ni ninguna semántica de aceptación nueva:
 *   eso es CUT-7 y no existe todavía (§ 4).
 *
 * ── 🔴 Por qué la constante SOBREVIVE a su propia activación ─────────────────
 *
 * Podría haberse borrado junto con el todo-o-nada. No se borra porque el
 * parámetro `partialGapSupported` que consume sigue siendo un contrato REAL de
 * dos rutas, y la otra —`LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED`— sigue en
 * `false` a propósito: la superficie de pending-review de Lusha NO tiene el ancla
 * de lote canónico que CUT-5 le dio a esta, así que allí el aporte parcial todavía
 * produciría dos lotes. Borrar la constante obligaría a cablear un `true` literal
 * en el sitio de la llamada y dejaría a las dos rutas sin un punto único donde
 * comparar su postura.
 *
 * 🔴 Sigue sin ser un flag de entorno y sigue sin leerse de Producción: es una
 * constante de código, y éste es el ÚNICO sitio donde el valor vivo se decide.
 */
export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = true;

/**
 * A1-APOLLO-TWO-ROUND-QUALITY-1 — qué ruta ejecuta esta corrida.
 *
 * Sólo la modalidad. Antes esta función devolvía además `targetInternal`,
 * `maxRounds` y `targetPersistibleCandidates` derivados de la configuración de dos
 * rondas, pero la ruta de dos rondas NO consume esos tres números: los gobierna el
 * orquestador desde su propia configuración. Eran tres campos que parecían
 * gobernar la corrida y no gobernaban nada. Los controles legacy siguen siendo las
 * constantes de arriba, que es donde la ruta legacy los lee.
 */
export type WizardApolloModality = 'legacy_four_round' | 'two_round_adaptive';

export function resolveWizardApolloModality(twoRoundEnabled: boolean): WizardApolloModality {
  return twoRoundEnabled ? 'two_round_adaptive' : 'legacy_four_round';
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
  /**
   * CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 (CASO B) — lectura de los términos de
   * `subindustry_search_terms` de la versión publicada.
   *
   * Se inyecta desde la acción del wizard con el MISMO cliente Supabase que resolvió
   * la selección (`resolveWizardCatalog`), para que selección y términos vengan de la
   * misma identidad, las mismas políticas y la misma versión. Ausente, esta frontera
   * la resuelve por su cuenta con un cliente de petición.
   */
  loadCatalogSearchTerms?: () => Promise<ApolloSubindustryCatalogTermsLoadResult>;
  /**
   * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 6 — lo que la capa previa al
   * pago dejó abierto.
   *
   * Ésta es LA costura que faltaba. `run-prepaid-novelty-discovery.server.ts`
   * declaraba la ruta Apollo `partialGapSupported: false` —todo-o-nada, un hueco
   * parcial se descartaba entero— con este motivo textual: «su objetivo de
   * candidatos persistibles vive dentro del orquestador de dos rondas y no viaja
   * por `ResolvedWizardExecution`». Ahora viaja, por su propio campo y no dentro
   * del contexto resuelto, que describe la SELECCIÓN del usuario y no el estado de
   * una capa previa.
   *
   * Ausente ⇒ el objetivo entero, exactamente como antes de este corte.
   *
   * 🔴 CUT-6 § 3 — en PRODUCCIÓN ya llega RECORTADO cuando la capa gratuita aportó
   * de verdad: `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED` es `true`, así que con
   * objetivo 10 y 4 empresas gratuitas persistidas el `remainingTarget` es 6. Con
   * la capa ausente, degradada o sin aporte durable sigue llegando el objetivo
   * entero, byte por byte como antes.
   */
  resultDemand?: ProviderResultDemand | null;
  /**
   * CUT-2 §§ 8, 10, 11 — memoria provider-seen previa, ya cargada por la capa
   * gratuita. Sólo medición: no se envía a Apollo y no recorta el objetivo.
   */
  priorProviderSeen?: ApolloPriorProviderSeen | null;
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

  // ── CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 (CASO B) y § 3 ────────────────
  //
  // Los términos de búsqueda de las subindustrias se leen AQUÍ, una vez por corrida,
  // y desde la misma versión publicada que resolvió la selección. Ésta es la única
  // frontera donde las dos cosas existen a la vez: `input.resolved.catalog.version`
  // (lo que el usuario seleccionó, ya verificado contra `active_industry_catalog` por
  // `resolveWizardCatalog`) y la lectura de `subindustry_search_terms`.
  //
  // No hay caché entre corridas a propósito: un TTL sería una tercera ventana en la
  // que la versión puede cambiar sin que nadie lo note, y es exactamente la clase de
  // deriva que este addendum elimina. La lectura son dos `select` sobre dos vistas,
  // en la misma petición que ya consultó el catálogo.
  //
  // Un fallo NO se traduce en una búsqueda con términos viejos ni con el sector padre:
  // la resolución llega vacía, el gate del § 3 la reconoce como incoherente y la
  // búsqueda se bloquea antes de gastar, con cero llamadas y cero créditos.
  const catalogTermsLoad = await (input.loadCatalogSearchTerms
    ? input.loadCatalogSearchTerms()
    : loadApolloSubindustryCatalogTermsForRequest());
  const subindustryCatalogTerms = catalogTermsLoad.resolution;
  const selectionCatalogVersion = input.resolved.catalog?.version ?? null;

  // A1-APOLLO-TWO-ROUND-QUALITY-1 — la modalidad decide qué RUTA corre. Apagada
  // (el estado por defecto), es exactamente la de siempre.
  const modality = resolveWizardApolloModality(isApolloTwoRoundDiscoveryEnabled());

  // A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 1 — RUTA REAL. Con la modalidad activa,
  // el wizard NO ejecuta el runner incremental legacy con otros números: ejecuta
  // el orquestador de dos rondas, que es quien gobierna rondas, dedup previo al
  // gasto, cap global de enrichment y recuperación de reintentos.
  //
  // Con la modalidad apagada —el estado por defecto— nada de esto se toca y la
  // corrida sigue exactamente por la ruta Apollo de siempre, con su metadata
  // intacta: el diagnóstico de dos rondas sólo existe dentro de esta rama.
  if (modality === 'two_round_adaptive') {
    if (!input.correlation) {
      // Sin correlación no hay clave de idempotencia con la que evitar repetir
      // una operación pagada. Fail-closed: no se ejecuta la modalidad.
      throw new Error('apollo_two_round_requires_run_correlation');
    }
    const twoRoundResolution = resolveApolloTwoRoundConfigFromEnv();
    const twoRoundRunner = twoRoundRunnerOverride ?? runApolloTwoRoundWizardDiscovery;
    return twoRoundRunner({
      country: input.resolved.country.name,
      countryCode: input.resolved.country.code,
      industry: input.resolved.industry.name,
      subindustries: input.resolved.subindustries.map((s) => s.name),
      // §§ 2 y 3 — los nombres de arriba y estos términos salen de la MISMA versión
      // publicada; el invariante lo comprueba el request efectivo antes de gastar.
      subindustryCatalogTerms,
      selectionCatalogVersion,
      additionalCriteria: input.resolved.additionalCriteria,
      reservedBatchId: input.reservedBatchId,
      triggeredByUserId: input.resolved.userId,
      ownerId: input.resolved.userId,
      correlation: input.correlation,
      runCorrelationMetadata: input.runCorrelation ?? null,
      extraBatchMetadata: {
        ...(input.extraBatchMetadata ?? {}),
        apollo_discovery_modality: modality,
        ...toApolloTwoRoundConfigDiagnostics(twoRoundResolution),
      },
      reservedCredits: input.reservedCredits ?? 0,
      // CUT-2 §§ 3, 5 — la demanda y la reserva viajan por campos DISTINTOS y
      // adyacentes, para que se vea que no se derivan la una de la otra.
      resultDemand: input.resultDemand ?? null,
      priorProviderSeen: input.priorProviderSeen ?? null,
    });
  }

  return runner({
    country: input.resolved.country.name,
    countryCode: input.resolved.country.code,
    industry: input.resolved.industry.name,
    subindustries: input.resolved.subindustries.map((s) => s.name),
    // §§ 2 y 3 — la ruta legacy pasa por el MISMO provider y por tanto por el mismo
    // límite del dinero: también redacta con la versión publicada, o no redacta.
    subindustryCatalogTerms,
    selectionCatalogVersion,
    additionalCriteria: input.resolved.additionalCriteria,
    webSearchProvider: 'apollo_organizations',
    targetInternal: WIZARD_APOLLO_TARGET_INTERNAL,
    maxRounds: WIZARD_APOLLO_MAX_ROUNDS,
    // CUT-2 §§ 4, 6 — la ruta legacy también respeta el hueco. Es el objetivo de
    // ACEPTACIÓN (candidatos persistibles), que es exactamente el que la capa
    // gratuita ya cerró en parte. `targetInternal` NO se toca: es la AMPLITUD de
    // búsqueda del pipeline, no una promesa al usuario, y recortarla mezclaría dos
    // conceptos que el gate previo separa a propósito.
    //
    // 🔴 Sin demanda residual el valor es la constante de siempre, byte por byte.
    targetPersistibleCandidates:
      input.resultDemand === null || input.resultDemand === undefined
        ? WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES
        : boundByRemainingTarget(
            WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
            input.resultDemand.remainingTarget,
          ),
    existingBatchId: input.reservedBatchId,
    triggeredByUserId: input.resolved.userId,
    ownerId: input.resolved.userId,
    dryRun: false,
    // Q3F-5BB.11E — reenvía la metadata observacional (provider_routing) al writer.
    extraBatchMetadata: input.extraBatchMetadata ?? null,
    usageInputContext: {
      batchId: input.reservedBatchId,
      triggeredByUserId: input.resolved.userId,
    },
    // A1-APOLLO-BUDGET-RECONCILIATION-1 — campo propio, no dentro de
    // usageInputContext, que Tavily comparte y debe seguir siendo agnóstico.
    apolloRunCorrelation: input.runCorrelation ?? null,
  });
}
