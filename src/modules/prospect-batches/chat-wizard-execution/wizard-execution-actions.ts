'use server';

import { createClient } from '@/lib/supabase/server';

import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  isProspectChatWizardExecutionEnabled,
  isApolloCompanySearchEnabled,
} from '@/lib/feature-flags.server';
import { resolveWizardCatalog } from './wizard-catalog-resolver';
import { wizardExecutionRequestSchema } from './wizard-execution-schema';
import { WIZARD_PIPELINE_DEFAULTS, WIZARD_SYSTEM_CONTROLS } from './wizard-pipeline-adapter';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from './wizard-apollo-executor';
// AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 25 — el MISMO runner previo al
// pago que ejecuta la ruta Lusha. Un solo cableado para las dos rutas.
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryOutcome,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type {
  WizardExecutionActionResult,
  ResolvedWizardExecution,
  WizardRunProviderOutcome,
} from './wizard-execution-types';
import {
  reserveWizardExecutionSlot,
  readPreviousAttemptDiscoveryProvider,
} from './wizard-idempotency';
import type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
  IdempotencyDbClient,
  PreviousAttemptProviderDbClient,
} from './wizard-idempotency';
// A1-APOLLO-QA-CONTROL-SURFACE-1 § 7 — un solo lector de sesión y rol, compartido
// con la capacidad que gobierna la superficie administrativa.
import { isWizardApolloDiscoveryRolePermitted } from './wizard-run-provider-capability.server';
import { isTavilyConfiguredForWizard } from './wizard-availability';
// A1-APOLLO-WIZARD-1 — preflight de Apollo. Antes, con Apollo seleccionado y
// sin credencial, la ejecución reservaba presupuesto y lote y sólo entonces el
// provider devolvía `skipped`; como la reconciliación es conservadora, eso
// consumía cupo del piloto sin haber llamado nunca a Apollo.
import {
  evaluateWizardApolloAvailability,
  buildWizardApolloSkippedResult,
  logWizardApolloSkipped,
  type WizardApolloAvailability,
} from './wizard-apollo-availability';
import { runWizardTavilySearch } from './wizard-tavily-executor';
import type { WizardTavilyRunner, WizardTavilyInput } from './wizard-tavily-executor';
import { runWizardApolloSearch } from './wizard-apollo-executor';
import { loadApolloSubindustryCatalogTerms } from '@/server/agents/prospecting-toolkit/apollo-subindustry-catalog-terms-loader.server';
import type { WizardApolloRunner } from './wizard-apollo-executor';
import { resolveWizardDiscoveryProvider } from './wizard-provider-resolver';
import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';
// A1-APOLLO-TWO-ROUND-QUALITY-1 § 1 — selección de proveedor POR CORRIDA. El
// núcleo es puro: no lee env ni consulta la base. Las lecturas de entorno y de
// rol se hacen aquí y se le pasan resueltas.
import {
  resolveWizardRunProvider,
  toExecutableDiscoveryProvider,
  toRunProviderSelectionMetadata,
  buildProviderSelectionSignature,
  isWizardDiscoveryProvider,
  RUN_PROVIDER_SELECTION_METADATA_KEY,
  type WizardRunProviderSelection,
  type ProviderSelectionAuthority,
} from './wizard-run-provider-selection';
import { isWizardRunProviderOverrideEnabled } from '@/lib/feature-flags.server';
// Q3F-5BB.11E — OBSERVATIONAL Apollo provider-routing wiring. The adapter is pure
// (no env, no provider client, no Supabase, no contact-enrichment / phone reveal).
// The barrel exposes the pure 11B resolver + 11C metadata builder. This produces
// routing metadata + a safety assert ONLY; it never decides the provider
// (resolveWizardDiscoveryProvider does) nor runs / enables Apollo.
import {
  buildApolloRoutingCriteria,
  buildApolloRoutingConfig,
  buildApolloObservationalRegistry,
  assertApolloRoutingPlanSafe,
} from '@/modules/prospect-batches/apollo-provider-routing-adapter';
import {
  resolveProviderRoutingPlan,
  buildProviderRoutingMetadata,
  getProviderDescriptor,
  DEFAULT_PROVIDER_REGISTRY,
  BATCH_PROVIDER_ROUTING_KEY,
  type ProviderRoutingEnvironment,
} from '@/modules/prospect-batches/provider-routing';
import { hasApolloApiKey } from '@/server/services/apollo-connection';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '@/server/agents/prospecting-toolkit/apollo-two-round';
import { buildNoNewCandidatesBreakdown } from './wizard-no-new-candidates-copy';
// A1-APOLLO-PERSISTENCE-READINESS-4 § 6/§ 7 — readiness de persistencia antes de
// gastar y proyección del resultado real de la escritura.
import {
  decidePersistenceReadiness,
  type PersistenceReadinessProbe,
} from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import { probeProspectCandidatePersistenceReadiness } from './wizard-persistence-readiness-deps';
import type { PersistenceReadinessDbClient } from './wizard-persistence-readiness-deps';
import type { WizardPersistenceOutcome } from './wizard-result-copy';
import { TWO_ROUND_INDETERMINATE_ANOMALY } from '@/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server';
import { markWizardBatchFailed } from './wizard-batch-failure';
import {
  DURABLE_PROSPECT_CANDIDATE_STATUSES,
  durableCandidatesFromCount,
  NO_PRE_EXISTING_DURABLE_CANDIDATES,
  resolveBatchDurableTotals,
  resolveBatchTerminalStatusDecision,
} from '@/server/prospect-batches/batch-durable-candidates';
import type { BatchTerminalStatus } from '@/server/prospect-batches/batch-durable-candidates';
import { createCanonicalWizardBatchResolver } from './wizard-canonical-batch';
import type { CatalogResolutionInput, CatalogResolutionOutput } from './wizard-catalog-resolver';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { PilotGuardrailCode, ConfirmWizardCreditsOutput, ReleaseWizardCreditsOutput } from './wizard-pilot-types';
import {
  reserveWizardPilotCredits,
  confirmWizardPilotCredits,
  releaseWizardPilotCredits,
  fetchWizardReservationRecord,
  readWizardBudgetPeriodSnapshot,
} from './wizard-budget-reservations';
import type {
  BudgetReservationsRpcClient,
  ReservationLookupClient,
  BudgetPeriodLookupClient,
  WizardBudgetPeriodSnapshot,
} from './wizard-budget-reservations';
import {
  estimateWizardTavilyMaxCredits,
  getPilotBudgetPeriodStart,
  readWizardConsumedCreditsFromDb,
} from './wizard-budget-reconciliation';
import { estimateCreditsForProvider } from './wizard-budget-estimate';
// AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 5 — la demanda residual, separada
// por construcción de la reserva financiera.
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
// AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 6, 7 — la ÚNICA autoridad sobre
// cuántos candidatos cuentan hacia el objetivo del usuario.
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  toAcceptedForTargetMetadata,
} from '@/modules/prospect-batches/accepted-for-target';
// AGENT1-LOCAL-CUT8B — la publicación terminal de la rama sólo-gratuita.
import { composeFreeOnlyTerminalBatchMetadata } from './free-only-terminal-publication';
import type { ResolveExtraBatchMetadata } from '@/server/agents/prospecting-toolkit/writer-metadata-resolution';
import type { ApolloPriorProviderSeen } from '@/server/agents/prospecting-toolkit/apollo-organizations-provider-seen';
// AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — huso y cliente service_role del
// presupuesto, compartidos con la lectura previa al primer clic.
import {
  WIZARD_BUDGET_TIMEZONE,
  createWizardBudgetServiceClient,
} from './wizard-budget-preflight.server';
// MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 8 — la taxonomía de la solicitud, declarada.
import {
  resolveDiscoveryTaxonomyCapability,
  toDiscoveryTaxonomyMetadata,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import {
  getMacroIndustryBySlug,
  resolveMacroIndustryByDisplayName,
} from '@/modules/macro-industry-catalog/macro-industries';
// A1-APOLLO-BUDGET-RECONCILIATION-1 — correlación del run y reconciliación por proveedor.
import {
  buildWizardRunCorrelation,
  toRunCorrelationMetadata,
  withResolvedIds,
  type WizardRunCorrelation,
} from './wizard-run-correlation';
import {
  readWizardRunUsageRows,
  reconcileWizardRunSpend,
  type WizardRunReconciliationResult,
  type WizardRunUsageRowsClient,
} from './wizard-run-reconciliation';
import type { ConsumedCreditsDbClient } from './wizard-budget-reconciliation';
// AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — la cuota PROPIA de Apollo
// (tool_catalog.monthly_credits_allowance + provider_usage_logs), la misma
// infraestructura de Providers & Consumption que ya gobierna el resto del
// catálogo. Nunca crea ni lee un `budget_rule`: eso es `checkBudget`, un
// concepto distinto (límite de gasto configurado por un admin) que esta
// puerta no toca.
import { checkProviderQuotaAvailable } from '@/modules/budgets';

// ── Dependency injection boundary ─────────────────────────────────────────────
// All I/O dependencies are injected here. The public server action provides real
// implementations; tests inject lightweight fakes without Supabase or Tavily.

// Typed result returned by the reserveBudget dep — encapsulates RPC + DB lookup.
export type ReserveBudgetDepResult =
  | { status: 'reserved'; reservationId: string; creditsReserved: number }
  | { status: 'already_reserved'; reservationId: string; creditsReserved: number }
  | {
      status: 'blocked';
      code: PilotGuardrailCode;
      message: string;
      /**
       * AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 — presente sólo cuando `code` es
       * `BUDGET_EXCEEDED` y la lectura de diagnóstico (best-effort, de sólo
       * lectura) pudo leer el período. `null`/ausente ⇒ el llamador cae al copy
       * genérico en vez de adivinar un número.
       */
      budgetSnapshot?: WizardBudgetPeriodSnapshot | null;
    };

/**
 * AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — resultado de la puerta de cuota
 * PROPIA de Apollo. A diferencia de `ReserveBudgetDepResult`, nunca lleva
 * `reservationId`: no hay ninguna fila de `wizard_budget_reservations` /
 * `wizard_monthly_budget_periods` que confirmar o liberar después, porque esta
 * puerta no reserva nada — sólo lee `tool_catalog.monthly_credits_allowance` y
 * `provider_usage_logs`, ya gastados por corridas anteriores.
 */
export type ApolloProviderQuotaGateResult =
  | { status: 'available'; providerCreditsAvailable: number | null }
  | { status: 'blocked'; providerCreditsAvailable: number };

export type WizardExecutionDeps = {
  getActiveUserId: () => Promise<string>;
  resolveCatalog: (input: CatalogResolutionInput) => Promise<CatalogResolutionOutput>;
  checkTavilyAvailability: () => Promise<boolean>;
  /**
   * A1-APOLLO-WIZARD-1: preflight de Apollo. Se ejecuta ANTES de cualquier
   * reserva. Opcional para no romper a los tests que sólo ejercitan Tavily; si
   * falta y Apollo es el proveedor seleccionado, se falla cerrado.
   */
  checkApolloAvailability?: () => Promise<WizardApolloAvailability>;
  /**
   * A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — ¿puede la base guardar lo que esta
   * corrida va a encontrar?
   *
   * OBLIGATORIA a propósito, a diferencia de `checkApolloAvailability`: aplica a
   * TODOS los proveedores y su ausencia no puede degradarse a «entonces no se
   * comprueba». Un dep opcional aquí es una corrida que gasta 12 créditos y
   * descubre después que el INSERT no cabe — exactamente LIVE-QA-2.
   */
  checkPersistenceReadiness: () => Promise<PersistenceReadinessProbe>;
  /**
   * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 12/25 — la capa GRATUITA.
   *
   * Descubre en la fuente de país, aplica precisión Macro-v2 canónica, deduplica
   * contra SellUp y HubSpot de sólo lectura, persiste lo aceptado por la ingesta
   * canónica de fuentes y devuelve el hueco que queda. Corre ANTES de estimar
   * créditos y ANTES de reservar.
   *
   * 🔴 Es LA MISMA capa que ejecuta la ruta Lusha. Que las dos rutas empiecen en
   * el mismo sitio es lo que hará comparable el benchmark Apollo-vs-Lusha: si una
   * descontara empresas gratuitas y la otra no, la diferencia medida sería la de
   * las dos capas previas y se le atribuiría a los proveedores.
   *
   * Opcional: sin ella el hueco es el objetivo entero y el comportamiento es
   * EXACTAMENTE el previo al hito. Los tests que sólo ejercitan Tavily/Apollo no
   * cambian.
   */
  runPrePaidNoveltyDiscovery?: (input: {
    countryCode: string;
    macroIndustryKey: string | null;
    requestedTarget: number;
    requestedByUserId: string;
    countryName: string;
    /**
     * AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING §§ 4, 5 — el lote canónico de ESTA
     * ejecución, resuelto perezosamente. Lo gratuito y lo de pago comparten lote.
     */
    resolveBatchId: () => Promise<string>;
  }) => Promise<PrePaidNoveltyDiscoveryOutcome>;
  /**
   * AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING § 11 — sella el lote canónico cuando
   * la capa GRATUITA cierra el objetivo entera y el proveedor no llega a correr.
   *
   * Existe por una consecuencia directa de compartir lote. Cuando la capa
   * gratuita creaba lote propio, el writer estructurado lo nacía en
   * `ready_for_review`. Al ADOPTAR el slot del wizard ya no crea nada, y el slot
   * nace en `draft`: sin sellar, esta rama devolvería
   * `batchStatus: 'ready_for_review'` sobre una fila que sigue en `draft`.
   *
   * 🔴 No es una máquina de estados nueva: el estado lo decide
   * `resolveBatchTerminalStatusDecision`, la MISMA de CUT-1 que ya usan los
   * escritores de proveedor, y el vocabulario es el que ya existe.
   *
   * Opcional: sin ella el estado del lote queda como estuviera, que es lo que
   * hacen el resto de las rutas cuando no pueden afirmar nada.
   */
  sealFreeOnlyBatchStatus?: (input: {
    batchId: string;
    status: BatchTerminalStatus;
    /**
     * AGENT1-LOCAL-CUT8B — el bloque canónico que esta corrida publica, ya
     * resuelto y ya serializado por las autoridades de CUT-7.
     *
     * 🔴 Viaja EN el sellado, no en una escritura aparte. La rama sólo-gratuita
     * no pasa por ningún writer de proveedor, así que ésta es su única
     * publicación durable post-outcome — la misma posición que ocupa la
     * escritura terminal de `candidate-writer` en la rama mixta.
     *
     * `null` ⇒ no hay nada que publicar y el sellado escribe estado y nada más,
     * byte por byte como antes del corte.
     */
    metadata?: Record<string, unknown> | null;
  }) => Promise<void>;
  // Budget guardrail operations — period calculation and settings load are encapsulated here.
  // Usado por Tavily y Lusha, SIN CAMBIOS. Apollo ya no pasa por aquí — ver
  // `checkApolloProviderQuota` abajo.
  reserveBudget: (input: {
    userId: string;
    clientRequestId: string;
    requestedCredits: number;
  }) => Promise<ReserveBudgetDepResult>;
  /**
   * AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — puerta previa al pago EXCLUSIVA
   * de Apollo. Reemplaza a `reserveBudget` para este proveedor: en vez de
   * reservar del pool `wizard_monthly_budget_periods` que comparten Tavily y
   * Lusha, comprueba la cuota PROPIA del proveedor
   * (`tool_catalog.monthly_credits_allowance` + `provider_usage_logs`, la
   * misma infraestructura de Providers & Consumption que ya gobierna el resto
   * del catálogo). Sin `budget_rule` para Apollo no se inventa ningún límite:
   * la cuota queda `null` (ilimitada), igual que en el panel de
   * administración.
   *
   * No reserva nada: no hay `reservationId` que confirmar o liberar después,
   * así que las llamadas a `confirmBudget`/`releaseBudget` se omiten
   * enteramente para Apollo.
   *
   * Opcional: sin ella Apollo falla cerrado, con la misma disciplina que
   * `checkApolloAvailability` ausente.
   */
  checkApolloProviderQuota?: (input: {
    estimatedCredits: number;
  }) => Promise<ApolloProviderQuotaGateResult>;
  confirmBudget: (input: {
    reservationId: string;
    actualCreditsConsumed: number;
    batchId?: string | null;
    /** Sólo descriptivo: permite nombrar la magnitud de un sobrepaso (§ 8). */
    creditsReserved?: number | null;
  }) => Promise<ConfirmWizardCreditsOutput>;
  releaseBudget: (input: {
    reservationId: string;
    batchId?: string | null;
    reason?: string | null;
  }) => Promise<ReleaseWizardCreditsOutput>;
  readConsumedCredits: (batchId: string) => Promise<number | null>;
  /**
   * A1-APOLLO-BUDGET-RECONCILIATION-1: reconciliación consciente del proveedor.
   *
   * `readConsumedCredits` sólo consultaba la operación de Tavily, así que una
   * corrida Apollo reconciliaba siempre como "sin filas" y confirmaba la reserva
   * entera — por eso los 4 créditos reales del lote de QA nunca aparecieron
   * contra su reserva de 3. Esta dep lee las filas de AMBAS operaciones
   * facturables de Apollo, las correlaciona por reserva/client request/batch
   * (nunca por timestamp) y devuelve cuánto confirmar más cualquier anomalía.
   *
   * Opcional: sin ella se usa el camino previo, de modo que los callers y tests
   * que sólo ejercitan Tavily conservan su comportamiento.
   */
  reconcileRunSpend?: (input: {
    batchId: string;
    correlation: WizardRunCorrelation;
    discoveryProvider: WizardDiscoveryProviderKey;
    estimatedCredits: number;
    reservedCredits: number;
  }) => Promise<WizardRunReconciliationResult | null>;
  // Existing
  reserveSlot: (input: WizardExecutionReservationInput) => Promise<WizardExecutionReservationResult>;
  runTavilyPipeline: WizardTavilyRunner;
  // Apollo routing — optional; only used when resolveProvider() returns 'apollo_organizations'
  runApolloPipeline?: WizardApolloRunner;
  // Provider resolver — injectable for tests; defaults to resolveWizardDiscoveryProvider()
  resolveProvider?: () => WizardDiscoveryProviderKey;
  /**
   * A1-APOLLO-TWO-ROUND-QUALITY-1 § 1 — selección de proveedor por corrida.
   *
   * Recibe la PETICIÓN del cliente ya validada por el schema. La autoridad no
   * viaja en el payload: la resuelve la implementación server-side contra la
   * sesión. Opcional: sin ella se usa el resolutor por defecto, que reproduce
   * exactamente el comportamiento previo (predeterminado global, sin override).
   */
  resolveRunProviderSelection?: (input: {
    requestedProvider?: string;
    /**
     * A1-APOLLO-QA-CONTROL-SURFACE-1 § 9 — proveedor ya resuelto por un intento
     * anterior de la MISMA corrida. Presente sólo en reintentos.
     */
    previousAttemptProvider?: string | null;
  }) => Promise<WizardRunProviderSelection> | WizardRunProviderSelection;
  /**
   * § 9 — relee el proveedor del intento anterior de esta corrida.
   *
   * Opcional: sin ella el comportamiento es EXACTAMENTE el previo al hito (cada
   * intento resuelve de cero). La implementación de producción sólo consulta la
   * base cuando la capacidad de override está encendida, así que con el flag
   * apagado no añade ni una lectura.
   */
  readPreviousAttemptProvider?: (input: {
    userId: string;
    clientRequestId: string;
  }) => Promise<string | null>;
  markBatchFailed: (batchId: string, reason: 'batchid_mismatch' | 'pipeline_error') => Promise<void>;
};


// ── Public server action ──────────────────────────────────────────────────────
// Thin entrypoint for Next.js. Builds real deps from server context, delegates
// to executeProspectWizardGeneration for the actual logic.

// AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — el huso y el cliente service_role
// del presupuesto viven ahora en `wizard-budget-preflight.server.ts`, para que la
// lectura que AVISA antes del primer clic y la reserva que BLOQUEA de verdad
// miren la misma fila del mismo período con las mismas credenciales. Dos husos o
// dos clientes es como se consigue una UI que avisa sobre un período que la
// reserva no mira.
const BOGOTA_TIMEZONE = WIZARD_BUDGET_TIMEZONE;

/**
 * A1-APOLLO-WIZARD-1 — rol admitido para discovery de empresas con Apollo.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 § 7: la lectura de sesión y rol vive ahora en
 * `wizard-run-provider-capability.server.ts`, para que la capacidad que decide si
 * la UI muestra el selector y la autoridad que decide si la ejecución lo honra
 * salgan de la MISMA función. Dos lectores del rol es como se consigue una UI que
 * ofrece lo que el servidor luego rechaza.
 *
 * Sigue fallando cerrado: un rol ilegible no es un rol admitido.
 */
const resolveIsApolloDiscoveryRolePermitted = isWizardApolloDiscoveryRolePermitted;

// Budget RPC functions (try_reserve_wizard_credits, confirm_wizard_credits, release_wizard_credits)
// and the wizard_budget_reservations table are REVOKE'd from the `authenticated` role — they require
// service_role. The user-session client (publishable key) cannot call them.
// AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — la fábrica se comparte con la lectura
// de diagnóstico de la superficie: un segundo constructor podría desviarse de
// éste y dejar el aviso leyendo con credenciales que no ven la tabla.
const createWizardBudgetClient = createWizardBudgetServiceClient;

export async function executeProspectWizardGenerationAction(
  request: unknown,
): Promise<WizardExecutionActionResult> {
  const supabase = await createClient();
  // Budget operations need service_role: the RPC functions grant EXECUTE only to postgres/service_role,
  // and wizard_budget_reservations has no authenticated RLS policy.
  const budgetClient = createWizardBudgetClient();

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => {
      const auth = await requireActiveUser();
      return auth.internalUserId;
    },
    resolveCatalog: (input) => resolveWizardCatalog(input, supabase),
    checkTavilyAvailability: isTavilyConfiguredForWizard,

    // A1-APOLLO-WIZARD-1 — preflight real. Ninguna comprobación llama a Apollo
    // ni gasta créditos: sólo verifica flag, capability, rol, presupuesto,
    // configuración y presencia de credencial.
    checkApolloAvailability: () =>
      evaluateWizardApolloAvailability({
        isFeatureEnabled: isApolloCompanySearchEnabled,
        // La capability del catálogo debe declarar company discovery viva para
        // Apollo; un descriptor ausente o inactivo omite el proveedor.
        isProviderCapabilityAvailable: async () => {
          const descriptor = getProviderDescriptor(DEFAULT_PROVIDER_REGISTRY, 'apollo');
          if (!descriptor?.supportsCompanySearch) return false;
          return resolveRoutingEnvironment() === 'production'
            ? descriptor.canRunInProduction
            : descriptor.canRunInPreview;
        },
        isRolePermitted: resolveIsApolloDiscoveryRolePermitted,
        // El tope real lo aplica la reserva atómica de presupuesto (paso 7);
        // aquí sólo se verifica que exista una estimación positiva que reservar.
        hasBudgetAvailable: async () =>
          estimateCreditsForProvider('apollo_organizations') > 0,
        // Misma señal para ambas: en este repo la conexión Apollo ES la
        // credencial en Vault. Comprueba presencia; nunca llama a Apollo ni
        // devuelve el valor de la clave.
        isProviderConfigured: hasApolloApiKey,
        hasCredential: hasApolloApiKey,
        logSkip: logWizardApolloSkipped,
      }),

    // A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — lectura REAL de la columna, con la
    // misma capa (PostgREST) y la misma caché de esquema que hará la escritura.
    // No mira el repo, ni la lista de migraciones, ni un flag: el fallo de
    // LIVE-QA-2 fue `PGRST204`, y la columna podía existir en el SQL del repo y
    // no existir para PostgREST.
    checkPersistenceReadiness: () =>
      probeProspectCandidatePersistenceReadiness(
        supabase as unknown as PersistenceReadinessDbClient,
      ),

    // AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 12/25 — la capa gratuita.
    //
    // 🔴 AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 REVIEW-1 § 2 — el valor VIVO sale de
    // `WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED`, que es `false`. La capacidad de
    // aceptar un objetivo reducido YA existe —`resultDemand` viaja por su propio
    // campo hasta el orquestador de dos rondas y hasta `targetPersistibleCandidates`
    // (legacy), y `boundByRemainingTarget` es su única cota— pero su ACTIVACIÓN en
    // producción queda DIFERIDA a `AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1`.
    //
    // 🔴 El motivo no es la invariante de § 14 —`aceptadasGratis + aceptadasPagadas
    // <= objetivo` se cumple— sino el RESULTADO que recibe el usuario: con `true`,
    // objetivo 10 y 7 empresas gratis, una sola búsqueda termina en DOS lotes (7 en
    // el de la fuente gratuita, 3 en el reservado) y la redirección apunta al
    // segundo. Esa semántica de producto no se ha diseñado todavía.
    //
    // Con `false` la ruta es TODO-O-NADA, byte por byte como antes de este corte:
    // o la fuente gratuita cierra el objetivo entero —y Apollo no corre ni se
    // reserva nada— o no aporta a ESTA corrida y Apollo corre con el objetivo
    // completo. Ver la cabecera de la constante y la del runner.
    runPrePaidNoveltyDiscovery: (input) =>
      runPrePaidNoveltyDiscovery(supabase, {
        countryCode: input.countryCode,
        countryName: input.countryName,
        macroIndustryKey: input.macroIndustryKey,
        requestedTarget: input.requestedTarget,
        requestedByUserId: input.requestedByUserId,
        // CUT-5 §§ 4, 5 — el lote canónico de la ejecución llega hasta el writer
        // gratuito. Sin esto la capa creaba lote propio.
        resolveBatchId: input.resolveBatchId,
        partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
        // ADDENDUM PROVIDER-SEEN §§ 5, 6 — esta ruta paga con Apollo, cuya
        // capacidad de exclusión es NINGUNA (su contrato no la prueba). Que el
        // proveedor se declare aquí evita que la ruta herede la capacidad de otro.
        provider: 'apollo',
      }),

    reserveBudget: async ({ userId, clientRequestId, requestedCredits }) => {
      const periodStart = getPilotBudgetPeriodStart(BOGOTA_TIMEZONE);
      const rpcResult = await reserveWizardPilotCredits(
        { userId, clientRequestId, requestedCredits, periodStart },
        budgetClient as unknown as BudgetReservationsRpcClient,
      );
      if (rpcResult.status === 'blocked') {
        // AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 — la RPC ya decidió el bloqueo; esto
        // sólo LEE el mismo período para poder explicarlo (agotado vs. no alcanza
        // para esta corrida). Best-effort y de sólo lectura: un fallo de esta
        // lectura no cambia el bloqueo ni lo convierte en otra cosa, sólo deja
        // `budgetSnapshot` en `null` y el llamador cae al copy genérico.
        const budgetSnapshot =
          rpcResult.code === 'BUDGET_EXCEEDED'
            ? await readWizardBudgetPeriodSnapshot(
                periodStart,
                budgetClient as unknown as BudgetPeriodLookupClient,
              )
            : null;
        return { ...rpcResult, budgetSnapshot };
      }

      // Both 'reserved' and 'already_reserved' need the reservation ID for later reconciliation.
      const record = await fetchWizardReservationRecord(
        userId,
        clientRequestId,
        budgetClient as unknown as ReservationLookupClient,
      );
      if (!record) {
        return { status: 'blocked', code: 'BUDGET_RESERVATION_FAILED', message: 'reservation_record_not_found' };
      }
      return {
        status: rpcResult.status,
        reservationId: record.id,
        creditsReserved: record.credits_reserved,
      };
    },

    // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — cuota PROPIA de Apollo, no el
    // pool del piloto. `estimatedCredits` no participa en la decisión: la regla
    // es la simple del hito («si hay créditos, sigue; si llega a 0, bloquea»),
    // no una proyección de sobregasto que esta puerta no fue pedida a hacer.
    checkApolloProviderQuota: async () => {
      const quota = await checkProviderQuotaAvailable('apollo');
      if (!quota.allowed) {
        return {
          status: 'blocked',
          providerCreditsAvailable: quota.providerCreditsAvailable ?? 0,
        };
      }
      return { status: 'available', providerCreditsAvailable: quota.providerCreditsAvailable };
    },

    confirmBudget: (input) =>
      confirmWizardPilotCredits(input, budgetClient as unknown as BudgetReservationsRpcClient),

    releaseBudget: (input) =>
      releaseWizardPilotCredits(input, budgetClient as unknown as BudgetReservationsRpcClient),

    readConsumedCredits: (batchId) =>
      readWizardConsumedCreditsFromDb(batchId, supabase as unknown as ConsumedCreditsDbClient),
    // A1-APOLLO-BUDGET-RECONCILIATION-1 — reconciliación por proveedor.
    reconcileRunSpend: async ({
      batchId,
      correlation,
      discoveryProvider,
      estimatedCredits,
      reservedCredits,
    }) => {
      const rows = await readWizardRunUsageRows(
        batchId,
        discoveryProvider,
        supabase as unknown as WizardRunUsageRowsClient,
      );
      // null = la consulta falló. "Sin filas" (array vacío) es otro hecho y sí
      // se reconcilia: puede haber gasto real sin log.
      if (rows === null) return null;
      return reconcileWizardRunSpend({
        correlation,
        discoveryProvider,
        estimatedCredits,
        reservedCredits,
        rows,
      });
    },

    reserveSlot: (input) =>
      reserveWizardExecutionSlot(input, supabase as unknown as IdempotencyDbClient),

    // CUT-5 § 11 — sella el lote que la capa gratuita cerró sola, con el valor
    // que decidió la máquina de CUT-1.
    //
    // 🔴 AGENT1-LOCAL-CUT8B — esta escritura es además la ÚNICA publicación
    // durable de metadata de la rama sólo-gratuita, porque en ella no corre
    // ningún writer de proveedor. `status` y `metadata` viajan en el MISMO
    // UPDATE —igual que en el sellado terminal de `candidate-writer`—, así que
    // el corte no añade ni una escritura: la que ya existía carga una columna
    // más.
    //
    // 🔴 La relectura previa NO es una publicación: es lo que impide pisar la
    // procedencia que la reserva dejó (proveedor resuelto, taxonomía, criterios).
    // Componer la metadata desde la petición en vez de desde la fila publicaría
    // una versión a medias en cuanto la reserva ganara una clave nueva.
    //
    // Va por el cliente de SESIÓN, no por service_role, igual que
    // `markBatchFailed`: la RLS de `prospect_batches` es la que acota la fila a
    // su dueño, así que un id ajeno no puede tocar nada aunque llegue hasta aquí.
    sealFreeOnlyBatchStatus: async ({ batchId, status, metadata }) => {
      if (metadata == null) {
        await supabase.from('prospect_batches').update({ status }).eq('id', batchId);
        return;
      }
      const { data: currentRow } = await supabase
        .from('prospect_batches')
        .select('metadata')
        .eq('id', batchId)
        .maybeSingle();
      await supabase
        .from('prospect_batches')
        .update({
          status,
          metadata: composeFreeOnlyTerminalBatchMetadata(currentRow?.metadata, metadata),
        })
        .eq('id', batchId);
    },

    runTavilyPipeline: (tavilyInput: WizardTavilyInput) => runWizardTavilySearch(tavilyInput),
    // CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 (CASO B) — los términos de búsqueda
    // del catálogo se leen con el MISMO cliente que resolvió la selección
    // (`resolveCatalog`, arriba). Una segunda identidad podría ver otra versión
    // publicada, y entonces «coherencia de versión» sería una comparación entre dos
    // lecturas que nadie ató a la misma sesión.
    runApolloPipeline: (apolloInput) =>
      runWizardApolloSearch({
        ...apolloInput,
        loadCatalogSearchTerms: () => loadApolloSubindustryCatalogTerms(supabase),
      }),
    resolveProvider: resolveWizardDiscoveryProvider,

    // A1-APOLLO-TWO-ROUND-QUALITY-1 § 1 — todas las lecturas de entorno y de rol
    // se hacen aquí; el núcleo que decide es puro.
    //
    // El wizard no expone hoy un selector de proveedor al usuario final, y este
    // hito no lo crea (§ 1). Por eso `requestedProvider` queda deliberadamente
    // sin origen: el contrato queda listo para un rollout o un benchmark
    // posterior, y hasta entonces cada corrida resuelve al predeterminado global
    // igual que antes.
    // A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 3 — fuente REAL de la petición y de la
    // autoridad. La petición llega del payload ya validado por el schema; la
    // autoridad NO: se deriva de la sesión y del rol en la base, server-side.
    // Un cliente que envíe `isAdmin=true` o `providerAuthorized=true` no obtiene
    // nada — esos campos ni siquiera existen en el schema, que es `.strict()`.
    resolveRunProviderSelection: async ({ requestedProvider, previousAttemptProvider }) => {
      // La autoridad sólo se consulta cuando hay algo que autorizar: sin
      // petición, una corrida normal no paga una consulta de rol.
      const authority: ProviderSelectionAuthority | null =
        requestedProvider !== undefined && (await resolveIsApolloDiscoveryRolePermitted())
          ? 'admin'
          : null;

      return resolveWizardRunProvider({
        requestedProvider,
        authority,
        runOverrideEnabled: isWizardRunProviderOverrideEnabled(),
        globalDefaultProvider: resolveWizardDiscoveryProvider(),
        // § 9 — la elección de un intento anterior gana sobre la petición nueva.
        // El núcleo valida el valor: un string desconocido no resucita nada.
        previousAttemptProvider: isWizardDiscoveryProvider(previousAttemptProvider)
          ? previousAttemptProvider
          : null,
        enabledProviders: {
          tavily: true,
          // Kill switch real. Con el flag apagado, ninguna corrida puede usar
          // Apollo — lo pida quien lo pida.
          apollo_organizations: isApolloCompanySearchEnabled(),
          // Sin ruta de ejecución en el wizard de empresas: fail-closed.
          lusha_companies: false,
        },
      });
    },

    // § 9 — sólo se consulta la base cuando la capacidad de elegir proveedor por
    // corrida está encendida. Con el flag apagado —el estado actual de
    // Producción— esta dep devuelve null sin una sola query, así que la ruta que
    // hoy funciona no gana ni latencia ni una lectura.
    readPreviousAttemptProvider: async ({ userId, clientRequestId }) => {
      if (!isWizardRunProviderOverrideEnabled()) return null;
      return readPreviousAttemptDiscoveryProvider(
        { userId, clientRequestId },
        supabase as unknown as PreviousAttemptProviderDbClient,
      );
    },

    // AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 — el cierre por fallo mira
    // primero lo que el lote CONTIENE. La sonda es un conteo ACOTADO
    // (`head: true`): no trae ni una fila, así que no viaja ningún dato personal.
    // El cliente de sesión ya lee `prospect_candidates` (política RLS
    // `active_users_can_read_prospect_candidates`), así que no hace falta
    // service_role ni migración alguna.
    markBatchFailed: async (batchId, reason) => {
      await markWizardBatchFailed(
        batchId,
        reason,
        async (id, status) => {
          const result = await supabase
            .from('prospect_batches')
            .update({ status })
            .eq('id', id);
          return { error: result.error };
        },
        async (id) => {
          try {
            const { count, error } = await supabase
              .from('prospect_candidates')
              .select('id', { count: 'exact', head: true })
              .eq('batch_id', id)
              .in('status', [...DURABLE_PROSPECT_CANDIDATE_STATUSES]);
            if (error) return { known: false, reason: 'read_failed' };
            return durableCandidatesFromCount(count);
          } catch {
            return { known: false, reason: 'read_failed' };
          }
        },
      );
    },
  };

  return executeProspectWizardGeneration(request, deps);
}

// ── Internal execution function (testable) ────────────────────────────────────
// Contains the full orchestration logic. No direct I/O — all side effects go
// through the injected deps.
//
// Execution order:
//   1.  Feature flag (env) — first hard gate; zero deps called if disabled
//   2.  Auth — userId from server session only, never from client payload
//   3.  Schema validation — strict; rejects any unknown or economic fields
//   4.  Catalog resolution — validates all IDs canonically
//   5.  Tavily availability — no batch, no budget if provider unavailable
//   5c. Persistence readiness — A1-APOLLO-PERSISTENCE-READINESS-4 § 6: la base
//       tiene que poder GUARDAR antes de que se autorice gastar. Cero reserva,
//       cero llamadas al proveedor, cero créditos cuando no puede.
//   6.  Estimate max credits server-side (currently 10; never from client)
//   7.  Atomic budget reservation — pilot kill-switch, allowlist, period, concurrency
//   8.  Durable batch reservation — idempotency anchor
//   9.  Tavily pipeline
//   10. Credit reconciliation
//   11. Success result

/**
 * Q3F-5BB.11E — Resolve the runtime environment server-side (the pure routing
 * adapter never reads env). Mirrors the repo's Vercel/NODE_ENV convention; used
 * only to gate provider capability in the OBSERVATIONAL plan.
 */
function resolveRoutingEnvironment(): ProviderRoutingEnvironment {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

export async function executeProspectWizardGeneration(
  request: unknown,
  deps: WizardExecutionDeps,
): Promise<WizardExecutionActionResult> {
  // 1. Feature flag — hard env gate; if off, zero guardrail or DB calls
  if (!isProspectChatWizardExecutionEnabled()) {
    return {
      ok: false,
      code: 'EXECUTION_DISABLED',
      message: 'La generación real del wizard todavía no está habilitada.',
      retryable: false,
    };
  }

  // 2. Auth — userId always from server session; never trusted from client payload
  let userId: string;
  try {
    userId = await deps.getActiveUserId();
  } catch {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Debes iniciar sesión para generar prospectos.',
      retryable: false,
    };
  }

  // 3. Validate request schema — .strict() blocks any client-injected economic fields
  const parsed = wizardExecutionRequestSchema.safeParse(request);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Solicitud inválida.';
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message: firstError,
      retryable: false,
    };
  }
  const req = parsed.data;

  // 4. Resolve catalog server-side (validates all IDs and names canonically)
  let catalogResolution: CatalogResolutionOutput;
  try {
    catalogResolution = await deps.resolveCatalog({
      countryCode: req.countryCode,
      industryId: req.industryId,
      subindustryIds: req.subindustryIds,
      catalogVersion: req.catalogVersion,
    });
  } catch {
    return {
      ok: false,
      code: 'CATALOG_CHANGED',
      message: 'El catálogo ha cambiado. Por favor, vuelve a configurar la búsqueda.',
      retryable: false,
    };
  }

  // 5a. Resolve discovery provider (server-side, double gate)
  //
  // A1-APOLLO-TWO-ROUND-QUALITY-1 § 1 — la elección es POR CORRIDA. El
  // predeterminado global sigue siendo Tavily y no cambia; lo que cambia es que
  // una corrida autorizada puede fijar otro proveedor sin mover la variable
  // global de Producción. Se resuelve AQUÍ, antes de estimar créditos y antes de
  // reservar presupuesto, porque la estimación depende del proveedor: reservar
  // para Tavily y ejecutar Apollo es exactamente el descuadre que este orden
  // evita.
  //
  // El kill switch manda por encima de todo: con ENABLE_APOLLO_COMPANY_SEARCH
  // apagado, ninguna corrida puede usar Apollo aunque lo pida un admin.
  // Sin dep inyectada se conserva EXACTAMENTE el comportamiento previo: el
  // predeterminado global decide y no hay petición por corrida. Los tests que ya
  // inyectan `resolveProvider` siguen gobernando la decisión.
  //
  // § 9 — antes de resolver se relee la elección del intento anterior de ESTA
  // corrida (misma pareja userId + clientRequestId). Un reintento conserva su
  // proveedor incluso si el navegador perdió la selección: la reserva ya está
  // atada a ese proveedor, y dejar que un reintento cambie de proveedor es
  // exactamente el descuadre que la firma de petición intenta hacer visible.
  const previousAttemptProvider = deps.readPreviousAttemptProvider
    ? await deps
        .readPreviousAttemptProvider({ userId, clientRequestId: req.clientRequestId })
        .catch(() => null)
    : null;

  const runProviderSelection: WizardRunProviderSelection =
    (await deps.resolveRunProviderSelection?.({
      requestedProvider: req.requestedDiscoveryProvider,
      previousAttemptProvider,
    })) ??
    resolveWizardRunProvider({
      authority: null,
      globalDefaultProvider: (deps.resolveProvider ?? resolveWizardDiscoveryProvider)(),
      // El resolutor global ya aplicó su doble gate: lo que devuelve es, por
      // construcción, un proveedor habilitado.
      enabledProviders: {
        tavily: true,
        apollo_organizations: true,
      },
    });

  // Proyección de la decisión hacia el cliente (§ 10). Se construye una sola vez
  // y viaja tanto en el éxito como en el rechazo: un admin que pidió Apollo tiene
  // que poder ver con qué proveedor terminó, incluso cuando terminó en un error.
  const runProviderOutcome: WizardRunProviderOutcome = {
    requested: runProviderSelection.requestedDiscoveryProvider,
    resolved: runProviderSelection.resolvedDiscoveryProvider,
    reason: runProviderSelection.providerResolutionReason,
    isRunLevelOverride: runProviderSelection.isRunLevelOverride,
  };

  // § 9 — el proveedor del intento anterior quedó apagado entre intentos. NO se
  // sustituye por otro: cambiar de proveedor no es un mecanismo de recuperación.
  // Se detiene sin llamar a Apollo, sin llamar a Tavily y sin reservar nada, de
  // modo que la evidencia y el estado indeterminado del intento previo quedan
  // intactos para la reconciliación.
  if (
    runProviderSelection.providerResolutionReason ===
    'previous_attempt_provider_disabled_fail_closed'
  ) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'El proveedor de búsqueda seleccionado no está disponible en este momento.',
      retryable: false,
      runProvider: runProviderOutcome,
    };
  }

  const executableProvider = toExecutableDiscoveryProvider(runProviderSelection);
  if (executableProvider === null) {
    // Un proveedor del contrato de routing sin ruta de ejecución en el wizard de
    // empresas (hoy `lusha_companies`) NO se degrada en silencio a otro: se
    // detiene sin lote, sin reserva y sin candidatos.
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'El proveedor de búsqueda seleccionado no está disponible en este momento.',
      retryable: false,
      runProvider: runProviderOutcome,
    };
  }
  const discoveryProvider: WizardDiscoveryProviderKey = executableProvider;

  // § 1 — los tres campos que cada ejecución debe conservar. Aterrizan de forma
  // aditiva en el metadata del lote por la costura `extraBatchMetadata` que ya
  // existe, sin una segunda escritura.
  const runProviderSelectionMetadata: Record<string, unknown> = {
    [RUN_PROVIDER_SELECTION_METADATA_KEY]:
      toRunProviderSelectionMetadata(runProviderSelection),
  };

  // 5a-bis. Q3F-5BB.11E — OBSERVATIONAL provider-routing metadata for Apollo.
  // Runs ONLY when the server-side double gate (resolveWizardDiscoveryProvider)
  // already selected Apollo COMPANY discovery. It emits the standard routing
  // observation (11B plan → 11C metadata) so the batch is comparable with the
  // Lusha path (11D). Strictly OBSERVATIONAL:
  //   - does NOT decide the provider (already decided above),
  //   - does NOT run or enable Apollo, adds NO fallback, never diverts to Lusha,
  //   - is scoped to COMPANY discovery — never phone/contact enrichment.
  // Apollo lives in the default_ai world: intended='default_ai', selected='apollo'.
  // Computed BEFORE any budget/slot reservation so a routing inconsistency fails
  // closed with zero side effects. The metadata is stashed and injected into the
  // batch additively via the existing extraBatchMetadata seam (never a 2nd write).
  let apolloRoutingExtraMetadata: Record<string, unknown> | undefined;
  if (discoveryProvider === 'apollo_organizations') {
    try {
      const environment = resolveRoutingEnvironment();
      // We are inside the apollo_organizations branch, which the resolver only
      // returns when BOTH gates are ON (AGENT1_WIZARD_DISCOVERY_PROVIDER +
      // ENABLE_APOLLO_COMPANY_SEARCH) — so Apollo is enabled here.
      const routingPlan = resolveProviderRoutingPlan(
        buildApolloRoutingCriteria({
          countryCode: req.countryCode,
          sectorKey: catalogResolution.industry.slug,
        }),
        buildApolloRoutingConfig({ environment, apolloEnabled: true }),
        buildApolloObservationalRegistry(),
      );
      assertApolloRoutingPlanSafe(routingPlan, { apolloEnabled: true });
      const routingMetadata = buildProviderRoutingMetadata(routingPlan, {
        environment,
        fallbackAllowed: false,
        fallbackReason: 'apollo_company_discovery_no_fallback',
      });
      apolloRoutingExtraMetadata = {
        [BATCH_PROVIDER_ROUTING_KEY]: routingMetadata,
        ...runProviderSelectionMetadata,
      };
    } catch {
      // Fail-closed: a routing inconsistency (assert throw) must not run a
      // mis-routed provider. Never falls through to another provider.
      return {
        ok: false,
        code: 'GENERATION_FAILED',
        message: 'No se pudo validar el enrutamiento del proveedor de búsqueda.',
        retryable: false,
        runProvider: runProviderOutcome,
      };
    }
  }

  // 5a-ter. A1-APOLLO-WIZARD-1 — disponibilidad de Apollo ANTES de reservar
  // presupuesto o lote. Un proveedor no disponible devuelve un resultado
  // estructurado de omisión: sin lote, sin candidatos y sin haber tocado el
  // presupuesto del piloto.
  if (discoveryProvider === 'apollo_organizations') {
    const availabilityCheck = deps.checkApolloAvailability;
    if (!availabilityCheck) {
      // Fail-closed: sin forma de verificar disponibilidad no se ejecuta Apollo.
      logWizardApolloSkipped('availability_check_failed');
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'No se pudo verificar la disponibilidad del proveedor de búsqueda.',
        retryable: true,
        runProvider: runProviderOutcome,
        providerSkipped: {
          provider: 'apollo_organizations',
          skipReason: 'availability_check_failed',
        },
      };
    }

    const availability = await availabilityCheck();
    if (!availability.available) {
      logWizardApolloSkipped(availability.skipReason);
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        message: buildWizardApolloSkippedResult(availability.skipReason).message,
        // Sólo tiene sentido reintentar lo que puede cambiar solo; un flag
        // apagado o un rol no permitido no se arreglan reintentando.
        retryable:
          availability.skipReason === 'availability_check_failed' ||
          availability.skipReason === 'capability_unavailable',
        runProvider: runProviderOutcome,
        providerSkipped: {
          provider: 'apollo_organizations',
          skipReason: availability.skipReason,
        },
      };
    }
  }

  // 5b. Tavily availability — only checked when Tavily is the selected provider
  if (discoveryProvider === 'tavily') {
    const tavilyAvailable = await deps.checkTavilyAvailability();
    if (!tavilyAvailable) {
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'El proveedor de búsqueda Tavily no está disponible en este momento.',
        retryable: true,
        runProvider: runProviderOutcome,
      };
    }
  }

  // 5c. A1-APOLLO-PERSISTENCE-READINESS-4 § 6 — readiness de PERSISTENCIA.
  //
  // Va aquí y no en otro sitio: después de la autorización y de resolver el
  // proveedor (para que el rechazo pueda decir con qué proveedor se rechazó), y
  // ANTES de estimar créditos, ANTES de reservar presupuesto y ANTES de cualquier
  // llamada al proveedor. El orden es el punto entero del control: LIVE-QA-2
  // reservó 12 créditos, los gastó, Apollo devolvió una empresa elegible y el
  // INSERT murió porque `prospect_candidates.identity_key` no existía en
  // Producción. Comprobarlo aquí cuesta un `select ... limit 1`.
  //
  // Fail-closed: sólo una lectura que funcionó autoriza continuar. Ausencia y
  // fallo de sonda bloquean igual, porque para el gasto tienen la misma
  // consecuencia.
  const persistenceReadiness = decidePersistenceReadiness(
    await deps.checkPersistenceReadiness().catch((): PersistenceReadinessProbe => ({
      status: 'probe_failed',
    })),
  );
  if (!persistenceReadiness.ready) {
    return {
      ok: false,
      code: 'PERSISTENCE_NOT_READY',
      // El mensaje crudo de Postgres/PostgREST NO se expone (§ 6).
      message: persistenceReadiness.adminMessage,
      // Un esquema sin la columna no se arregla reintentando: hay que aplicar la
      // migración. Una sonda que falló sí puede recuperarse sola.
      retryable: persistenceReadiness.reason === 'probe_failed',
      runProvider: runProviderOutcome,
      persistenceNotReady: {
        errorCode: persistenceReadiness.errorCode,
        reason: persistenceReadiness.reason,
        stage: persistenceReadiness.stage,
      },
    };
  }

  // ── 5d. AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 12/15/25 ────────────
  //
  // TODO lo gratuito ocurre AQUÍ: antes de estimar créditos (paso 6) y antes de
  // reservar (paso 7). El orden es el hito entero — la corrida Lusha del
  // 2026-08-19 reservó, gastó 6 créditos y sólo después descubrió que las 40
  // empresas únicas ya se conocían o estaban fuera de la macro.
  //
  // 🔴 Es la MISMA capa que corre la ruta Lusha (§ 25). Sin ella —dep ausente— el
  // hueco es el objetivo entero y todo lo de abajo se comporta como antes.
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === req.countryCode);
  const countryName = countryEntry?.name ?? req.countryCode;

  // ── AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING §§ 4, 5, 12, 13 ────────────────
  //
  // LA AUTORIDAD DEL LOTE DE ESTA EJECUCIÓN, declarada ANTES de la primera rama
  // que pueda escribir.
  //
  // El defecto que cierra: la capa gratuita de abajo persistía por su cuenta y
  // creaba lote propio, porque la reserva del slot ocurría después (paso 9). Una
  // sola búsqueda podía terminar en DOS lotes —lo gratuito en uno, lo de pago en
  // otro— y la redirección apuntaba sólo al segundo.
  //
  // 🔴 PEREZOSO a propósito: la fila nace en el primer momento en que alguien de
  // verdad la necesita. Materializarla aquí habría dejado un lote vacío en `draft`
  // en cada corrida que el presupuesto bloquea en el paso 7, que hoy no crean
  // ninguno. El orden 5d → 6 → 7 se conserva intacto: que todo lo gratuito ocurra
  // antes de estimar y de reservar es el hito de la puerta previa al pago.
  //
  // 🔴 Ni "último lote" ni "primer lote en curso" (§ 13): la identidad de la
  // ejecución sigue siendo la que YA existía, `(created_by, client_request_id)`,
  // y su índice único es lo que hace que dos ejecuciones simultáneas del mismo
  // usuario, país y proveedor no puedan adoptarse la una a la otra (§ 14).
  const canonicalBatch = createCanonicalWizardBatchResolver(deps.reserveSlot, {
    userId,
    clientRequestId: req.clientRequestId,
    initialBatchPayload: {
      requestSource: 'chat_wizard',
      catalogVersionId: catalogResolution.catalog.version,
      industryId: catalogResolution.industry.id,
      subindustryIds: catalogResolution.subindustries.map((s) => s.id),
      countryCode: req.countryCode,
      additionalCriteria: req.additionalCriteriaRaw,
      // CUT-2 REVIEW-1 § 3 — LA AUTORIDAD DEL OBJETIVO GLOBAL VIVE AQUÍ.
      //
      // 🔴 `WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES` (10) y NO
      // `WIZARD_SYSTEM_CONTROLS.targetCount` (25): el 25 es la AMPLITUD de
      // búsqueda del pipeline, no lo que el producto promete persistir. Las dos
      // rutas del wizard prometen 10 —Apollo por esta constante y Tavily por
      // `WIZARD_TARGET_PERSISTIBLE_CANDIDATES`—, así que el slot puede
      // declararlo antes de saber qué proveedor correrá.
      //
      // Se establece ANTES de que exista ningún contribuyente. Sin esto, un
      // residual de pago de 3 sería quien fijara el objetivo del lote entero.
      targetCount: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
      // § 4 — el resto de la verdad request-global, también en origen. Son los
      // mismos valores canónicos que el adaptador entrega al pipeline: no se
      // inventa ninguno.
      country: countryName,
      industry: catalogResolution.industry.name,
      searchDepth: WIZARD_PIPELINE_DEFAULTS.searchDepth,
      // § 8/§ 26 — requested/resolved/reason quedan en el INSERT inicial, para
      // TODOS los proveedores. La costura `extraBatchMetadata` sólo existe en la
      // ruta de Apollo, así que sin esto una corrida Tavily con petición
      // explícita no dejaba rastro de que se pidió otra cosa. También es la fila
      // que un reintento relee para conservar su proveedor (§ 9).
      runProviderSelection: toRunProviderSelectionMetadata(runProviderSelection),
      // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 8 — taxonomía declarada, no
      // deducida: `subindustry_ids: []` no distingue «no había paso» de
      // «la persona no quiso acotar».
      discoveryTaxonomy: {
        ...toDiscoveryTaxonomyMetadata(
          resolveDiscoveryTaxonomyCapability(catalogResolution.catalog.version),
        ),
        macro_industry_key:
          getMacroIndustryBySlug(catalogResolution.industry.slug)?.key ??
          resolveMacroIndustryByDisplayName(catalogResolution.industry.name)?.key ??
          null,
        macro_industry_display_name: catalogResolution.industry.name,
        requested_subindustries: catalogResolution.subindustries.map((s) => s.name),
      },
    },
  });

  /** § 5 — lo único que baja a las ramas: el id, nunca la capacidad de crear otro. */
  const resolveCanonicalBatchId = async (): Promise<string> =>
    (await canonicalBatch.resolve()).batchId;

  const prePaidNovelty = deps.runPrePaidNoveltyDiscovery
    ? await deps
        .runPrePaidNoveltyDiscovery({
          countryCode: req.countryCode,
          // CUT-5 §§ 4, 5 — la capa gratuita ya no crea lote: recibe EL de esta
          // ejecución. Es el hilo entero del corte.
          resolveBatchId: resolveCanonicalBatchId,
          macroIndustryKey:
            getMacroIndustryBySlug(catalogResolution.industry.slug)?.key ?? null,
          // 🔴 El objetivo del USUARIO son los candidatos persistibles (10), no
          // `systemControls.targetCount` (25), que es la AMPLITUD de búsqueda del
          // pipeline. Confundirlos habría pedido a la fuente gratuita cerrar un
          // hueco que el producto nunca prometió.
          requestedTarget: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
          requestedByUserId: userId,
          countryName,
        })
        // Fail-open (§ 12): una capa gratuita rota nunca deja el wizard
        // inservible. Se degrada a «no aportó» y la ruta de pago sigue.
        .catch((): PrePaidNoveltyDiscoveryOutcome | null => null)
    : null;

  // ── 5e. CUT-2 §§ 3, 4, 5, 12 — la demanda de resultados de la ruta de pago ──
  //
  // Se resuelve AQUÍ, entre la capa gratuita y la estimación de créditos, porque
  // éste es el único punto donde existen a la vez el resultado del gate y el
  // ejecutor que lo va a consumir.
  //
  // 🔴 Sólo lo PERSISTIDO cierra hueco. Un `providerRequired: false` sin lote y sin
  // filas escritas describiría un objetivo cerrado que el usuario no tiene en
  // ninguna parte, así que se degrada a «la capa gratuita no aportó»: el hueco
  // vuelve a ser entero y la ruta de pago hace lo de siempre. Es la misma regla que
  // `withFreeSourcePersistenceOutcome` aplica un nivel más abajo, aplicada aquí a
  // la ÚNICA combinación que ese nivel no puede observar. De paso garantiza § 4:
  // Apollo nunca recibe una demanda de cero.
  //
  // 🔴 CUT-7 § 6 — se resuelve ANTES del retorno temprano de § 15, y no después
  // como hasta este corte. El motivo es que la decisión «el objetivo ya está
  // cerrado gratis» y la decisión «cuánto pedirle al proveedor» son la MISMA
  // pregunta contestada con el mismo hueco; tenerlas en dos sitios permitía que
  // la primera se resolviera con `providerRequired` y la segunda con la demanda,
  // que es exactamente cómo dos vistas del mismo hecho empiezan a discrepar.
  const prePaidContributed =
    prePaidNovelty !== null &&
    prePaidNovelty.batchId !== null &&
    prePaidNovelty.persistedCount > 0;
  const apolloResultDemand = prePaidContributed
    ? resolveProviderResultDemand(prePaidNovelty, WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES)
    : fullTargetResultDemand(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES);

  // ── CUT-6 §§ 3, 5, 13, 14 — el aporte GRATUITO que YA es durable ────────────
  //
  // 🔴 Ésta es la mitad que CUT-6 añade sobre CUT-2. Antes de este corte
  // `apolloResultDemand` era el ÚNICO uso del resultado de la capa gratuita, y
  // eso bastaba mientras el aporte parcial se descartaba: no había filas que
  // nombrar. Con la activación, esas filas EXISTEN, están en el lote canónico y
  // sobreviven a lo que le pase después a la ruta de pago —fallo, presupuesto
  // denegado, proveedor caído o cero resultados—. Todo camino de salida que las
  // ignore le estaría diciendo al usuario que no tiene nada cuando sí tiene.
  //
  // 🔴 Se deriva de `prePaidContributed`, la MISMA condición que gobierna la
  // demanda, y no de una segunda lectura: si el hueco se recortó, hay filas; si no
  // se recortó, no las hay. Dos condiciones separadas podrían discrepar.
  //
  // 🔴 AGENT1-LOCAL-CUT8B — se resuelve AQUÍ, por encima del retorno temprano de
  // § 15, y no más abajo como hasta este corte. La rama sólo-gratuita necesita
  // exactamente el mismo aporte libre que la mixta para publicar su metadata
  // durable, y tenerlo declarado después de su propia salida obligaba a que esa
  // rama se lo reconstruyera — una segunda vista del mismo hecho.
  const freeContribution: { batchId: string; persistedCandidates: number } | null =
    prePaidContributed && prePaidNovelty !== null && prePaidNovelty.batchId !== null
      ? {
          batchId: prePaidNovelty.batchId,
          persistedCandidates: prePaidNovelty.persistedCount,
        }
      : null;

  /**
   * AGENT1-LOCAL-CUT8 §§ 1, 2 — LA ÚNICA ARITMÉTICA DE ACEPTACIÓN DE LA CORRIDA.
   *
   * La aceptación hacia el objetivo hace falta en TRES momentos que no coinciden:
   *
   *   · antes de la ruta de pago, para decidir si el objetivo ya se cerró gratis
   *     y para publicar la metadata durable de la rama sólo-gratuita (CUT-8B);
   *   · dentro del writer de pago, para que el bloque `accepted_for_target` se
   *     publique en la MISMA escritura de metadata que ese writer ya hacía;
   *   · después del pipeline, para el resultado de la acción y para el mago.
   *
   * Tenerlas como llamadas sueltas a `resolveAcceptedForTarget` habría sido el
   * mismo defecto de CUT-7 un piso más arriba: expresiones que hoy coinciden y
   * que mañana pueden separarse. Aquí hay UNA, y las tres la llaman.
   *
   * 🔴 Lo que varía entre las llamadas es SÓLO el aporte de pago, porque es lo
   * único que cambia entre «el proveedor todavía no existe», «el writer acaba de
   * contar» y «el pipeline ya devolvió». El objetivo, la demanda y el aporte
   * gratuito son los mismos objetos capturados aquí — no se releen ni se
   * recalculan.
   */
  const resolveRunAcceptance = (paidWriterTruth: {
    completeValidCandidates: number | null | undefined;
    persistedCandidates: number;
  }) =>
    resolveAcceptedForTarget({
      demand: apolloResultDemand,
      freePersistedCandidates: freeContribution?.persistedCandidates ?? 0,
      paid: paidAcceptedContributionFromWriterTruth(paidWriterTruth),
    });

  /**
   * DECISIÓN B — la costura durable. En la ruta de pago se invoca DENTRO del
   * writer, con lo que el writer acaba de escribir, y lo devuelto se esparce en
   * su única publicación de metadata. En la rama sólo-gratuita la invoca el
   * sellado terminal, que es la única escritura post-outcome que esa rama tiene.
   *
   * 🔴 NO es una segunda escritura sobre `prospect_batches`: en las dos ramas
   * viaja DENTRO de una escritura que ya existía. Y NO es una segunda autoridad:
   * la cifra sale de `resolveRunAcceptance` y se serializa con
   * `toAcceptedForTargetMetadata`, las dos de CUT-7.
   *
   * 🔴 `completeValidCandidates` se pasa TAL CUAL, `null` incluido. Sustituirlo
   * por `persistedCandidates` publicaría en la base la mentira exacta que CUT-7
   * cerró en la UI.
   */
  const resolveAcceptedForTargetBatchMetadata: ResolveExtraBatchMetadata = (writerOutcome) => ({
    [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(
      resolveRunAcceptance({
        completeValidCandidates: writerOutcome.completeValidCandidates,
        persistedCandidates: writerOutcome.persistedCandidates,
      }),
    ),
  });

  /**
   * AGENT1-LOCAL-CUT8B § 4 — el bloque canónico de una corrida cuya ruta de pago
   * NO corrió, por el MISMO proyector y con la MISMA forma que el de la mixta.
   *
   * 🔴 No hay una clave libre y otra de pago, ni un shape reducido: es la misma
   * llamada con el aporte de pago declarado ausente. Cualquier variante
   * —`free_accepted_for_target` y compañía— sería una segunda forma del mismo
   * hecho, que es lo que este corte existe para impedir.
   */
  const freeOnlyAcceptedForTargetMetadata = (): Record<string, unknown> | null =>
    resolveAcceptedForTargetBatchMetadata(PAID_ROUTE_NOT_RUN_WRITER_TRUTH);

  /**
   * AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 6, 9 — cuántos candidatos
   * CUENTAN hacia el objetivo antes de que la ruta de pago exista.
   *
   * 🔴 La mitad de pago entra declarada como «no corrió» —cero CONOCIDO— y no
   * como una ausencia de medición: en este punto el proveedor todavía no ha
   * corrido, y «no corrió» es una respuesta, no un dato que falte.
   *
   * 🔴 CUT-8B — sale del helper único de corrida, no de una llamada propia a
   * `resolveAcceptedForTarget`. Es el mismo número que la metadata durable de
   * esta rama publica, resuelto una sola vez.
   */
  const acceptedBeforePaidRoute = resolveRunAcceptance(PAID_ROUTE_NOT_RUN_WRITER_TRUTH);

  // § 15 — hueco cerrado gratis ⇒ NI estimación, NI reserva, NI cliente de
  // proveedor, NI llamada. Se exige además un lote real: sin él no habría a dónde
  // mandar al usuario, y anunciar éxito sin candidatos sería falso.
  //
  // 🔴 CUT-7 §§ 1, 9 CASO A — la condición de cierre es `targetReached` de la
  // autoridad de ACEPTACIÓN, no `!providerRequired`. Las dos coinciden hoy —el
  // hueco de la demanda y el de la autoridad son el mismo número— y esa
  // coincidencia es justamente lo que hace seguro el cambio: lo que se gana es
  // que el veredicto de «objetivo alcanzado» de esta rama y el de la rama mixta
  // salgan de UNA función y no de dos expresiones que puedan separarse. Un lote
  // con filas gratuitas que NO cierran el objetivo deja de poder salir por aquí
  // aunque su `providerRequired` se degradara.
  if (
    prePaidNovelty &&
    acceptedBeforePaidRoute.targetReached &&
    prePaidNovelty.batchId !== null &&
    prePaidNovelty.persistedCount > 0
  ) {
    // ── CUT-5 § 11 — sellar el lote que la capa gratuita cerró sola ──────────
    //
    // Consecuencia directa de compartir lote. Cuando esta capa creaba lote
    // propio, el writer estructurado lo nacía en `ready_for_review`; ahora ADOPTA
    // el slot del wizard, que nace en `draft` y que ningún escritor de proveedor
    // va a sellar porque en esta rama el proveedor NO corre. Sin esto, la
    // respuesta anunciaría `ready_for_review` sobre una fila en `draft`.
    //
    // 🔴 El estado NO se decide aquí: lo decide `resolveBatchTerminalStatusDecision`,
    // la misma máquina de CUT-1 que usan los escritores de proveedor, con el
    // vocabulario que ya existe. `preExisting` se declara conocido y en 0 porque
    // esta rama exige `persistedCount > 0`, y lo que ESTE contribuyente escribió
    // es verdad propia que no depende de ninguna lectura.
    const sealDecision = resolveBatchTerminalStatusDecision({
      preExisting: durableCandidatesFromCount(0),
      persistedCandidates: prePaidNovelty.persistedCount,
      persistenceFailureCount: 0,
    });
    if (sealDecision.action === 'write' && deps.sealFreeOnlyBatchStatus) {
      // Best-effort: un sellado fallido no puede convertir en error una corrida
      // que ya persistió candidatos reales y verificables en el lote.
      await deps
        .sealFreeOnlyBatchStatus({
          batchId: prePaidNovelty.batchId,
          status: sealDecision.status,
          // 🔴 CUT-8B — la ÚNICA publicación durable de esta rama. Viaja EN el
          // sellado que ya existía, no en una escritura nueva: es la misma forma
          // que `candidate-writer` usa en la rama mixta (una escritura terminal
          // que carga `status` y `metadata` a la vez).
          metadata: freeOnlyAcceptedForTargetMetadata(),
        })
        .catch(() => undefined);
    }

    return {
      ok: true,
      status: 'success_target_reached',
      batchId: prePaidNovelty.batchId,
      batchStatus: 'ready_for_review',
      // 🔴 CUT-7 § 10 — el UNIVERSO DURABLE, que puede ser mayor que el
      // subconjunto aceptado: con 12 empresas gratuitas y objetivo 10 aquí hay
      // 12 filas reales que revisar y 10 aceptadas. Ninguna se oculta para que
      // los números cuadren.
      candidateCount: prePaidNovelty.persistedCount,
      redirectPath: `/prospect-batches/${prePaidNovelty.batchId}`,
      targetPersistibleCandidates: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
      targetReached: true,
      // CUT-7 § 7 — el MISMO tipo canónico que consume la rama mixta.
      acceptedForTarget: acceptedBeforePaidRoute,
      runProvider: runProviderOutcome,
    };
  }

  /**
   * CUT-6 § 14 — el bloque que un resultado de FALLO usa para no mentir por
   * omisión.
   *
   * Puro y sin efectos: sólo proyecta lo que ya se sabe. No es un éxito
   * disfrazado —el `code` y el `retryable` del fallo no se tocan— y no promete
   * que el objetivo se haya alcanzado: dice cuántas empresas quedaron guardadas y
   * dónde verlas.
   */
  const describeFreeContribution = ():
    | {
        freeContribution: {
          batchId: string;
          persistedCandidates: number;
          redirectPath: string;
        };
      }
    | Record<string, never> =>
    freeContribution === null
      ? {}
      : {
          freeContribution: {
            batchId: freeContribution.batchId,
            persistedCandidates: freeContribution.persistedCandidates,
            redirectPath: `/prospect-batches/${freeContribution.batchId}`,
          },
        };

  /**
   * CUT-6 § 13 — sella el lote canónico en las salidas donde NINGÚN escritor de
   * proveedor va a hacerlo.
   *
   * El slot del wizard nace en `draft` y sólo un writer de proveedor —o el cierre
   * por fallo— lo mueve. Una corrida que persiste 4 empresas gratuitas y muere en
   * el presupuesto no pasa por ninguno de los dos, así que sin esto el lote se
   * quedaría en `draft` con contenido real dentro: filas durables anunciadas como
   * un borrador que nadie revisa. Eso es descartar el aporte parcial por la puerta
   * de atrás, que es justo lo que este corte prohíbe.
   *
   * 🔴 No es una máquina de estados nueva: decide `resolveBatchTerminalStatusDecision`,
   * la MISMA de CUT-1 que usan los escritores de proveedor y el sellado de CUT-5.
   * `preExisting` se declara conocido y en 0 porque el lote canónico lo creó ESTA
   * ejecución y la capa gratuita es su primer escritor.
   *
   * 🔴 NO se llama en las salidas que pasan por `markBatchFailed`: ése ya resuelve
   * el estado con `resolveBatchFailureStatusDecision` y su propia sonda durable.
   * Sellar además aquí sería una segunda autoridad sobre la misma fila.
   */
  const sealFreeContributionBatch = async (): Promise<void> => {
    if (freeContribution === null) return;
    const decision = resolveBatchTerminalStatusDecision({
      preExisting: NO_PRE_EXISTING_DURABLE_CANDIDATES,
      persistedCandidates: freeContribution.persistedCandidates,
      persistenceFailureCount: 0,
    });
    if (decision.action !== 'write' || !deps.sealFreeOnlyBatchStatus) return;
    // Best-effort, igual que el sellado de CUT-5: un sellado fallido no puede
    // borrar filas que ya existen.
    await deps
      .sealFreeOnlyBatchStatus({
        batchId: freeContribution.batchId,
        status: decision.status,
        // 🔴 CUT-8B § 4 CASO 2 — estas salidas terminan la corrida con SÓLO la
        // contribución gratuita: el presupuesto bloqueó la parte de pago o la
        // reserva no llegó a existir, así que ningún writer de proveedor va a
        // publicar nada. La aceptación durable tiene que decir la verdad
        // —`accepted = 7`, `remaining = 3`, `target_reached = false`— y no
        // quedarse ausente porque el proveedor no corriera.
        metadata: freeOnlyAcceptedForTargetMetadata(),
      })
      .catch(() => undefined);
  };

  // CUT-2 §§ 8, 11, 12 — el snapshot de memoria PREVIA, con su ausencia nombrada.
  //
  // 🔴 `readOutcome` y no `loaded`: la memoria vacía leída con éxito debe producir
  // `provider_seen_hit: 0` —un hecho medido— mientras que una lectura fallida debe
  // producir `null`. `loaded` fusiona los dos casos a propósito para el plan de
  // exclusión y no sirve para decidir esto.
  const apolloPriorProviderSeen: ApolloPriorProviderSeen =
    prePaidNovelty !== null && prePaidNovelty.providerSeenLoad.readOutcome === 'succeeded'
      ? { available: true, memory: prePaidNovelty.providerSeenMemory }
      : {
          available: false,
          unavailableReason:
            prePaidNovelty === null
              ? 'prepaid_novelty_layer_absent'
              : (prePaidNovelty.providerSeenLoad.unavailableReason ??
                'provider_seen_read_outcome_not_succeeded'),
        };

  // 6. Calculate max credits server-side — provider-aware; client cannot control this value.
  // Apollo: resolvedMaxQueries × resolvedMaxResults × 1 credit/result (default 1×3=3).
  // Tavily: adaptive pipeline ceiling (4 rounds × 5 queries = 20).
  //
  // 🔴 § 16 — la responsabilidad económica NO es el hueco. Apollo y Tavily la
  // derivan de su propio techo de peor caso, y ese techo no depende de cuántas
  // empresas falten: con hueco 1 el pipeline puede necesitar las mismas consultas
  // que con hueco 5. Un `requestedCredits = residualGap` sería sencillamente falso.
  const requestedCredits = estimateCreditsForProvider(discoveryProvider);

  // 7. Budget gate — provider-aware.
  //
  // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — Apollo YA NO pasa por la
  // reserva atómica del pool del piloto (`wizard_monthly_budget_periods`),
  // que Tavily y Lusha siguen usando SIN CAMBIOS (rama `else`, intacta byte
  // por byte). Apollo usa su PROPIA cuota de Providers & Consumption
  // (`tool_catalog.monthly_credits_allowance` + `provider_usage_logs`), así
  // que no hay `reservationId`: nada que confirmar ni liberar más abajo.
  //
  // `isApolloBudgetGate` (en vez de comparar `discoveryProvider` directamente
  // en el `if`) evita que TypeScript estreche el tipo de `discoveryProvider`
  // dentro de la rama `else` — el chequeo legacy de dos rondas de esa rama
  // sigue comparando contra `'apollo_organizations'`, y una comparación
  // TS2367 rompería la build sin que el comportamiento de #380-#384 cambiara
  // en absoluto.
  const isApolloBudgetGate = discoveryProvider === 'apollo_organizations';
  let reservationId: string | null;
  let creditsReserved: number;
  let budgetWasNew = false;

  if (isApolloBudgetGate) {
    const checkApolloQuota = deps.checkApolloProviderQuota;
    if (!checkApolloQuota) {
      // Fail-closed: sin forma de comprobar la cuota propia de Apollo no se
      // gasta nada. Misma disciplina que `checkApolloAvailability` ausente.
      await sealFreeContributionBatch();
      return {
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'No se pudo verificar la cuota disponible del proveedor de búsqueda.',
        retryable: true,
        runProvider: runProviderOutcome,
        ...describeFreeContribution(),
      };
    }

    const quotaResult = await checkApolloQuota({ estimatedCredits: requestedCredits });
    if (quotaResult.status === 'blocked') {
      // 🔴 CUT-6 §§ 5, 7, 13 — el presupuesto bloquea la parte PAGADA. Lo que la
      // capa gratuita ya guardó no se toca, no se revierte y no se calla: se
      // sella el lote a su estado verdadero y el fallo lo declara.
      await sealFreeContributionBatch();
      return {
        ok: false,
        code: 'BUDGET_EXCEEDED',
        message: 'La cuota disponible del proveedor de búsqueda (Apollo) se agotó.',
        retryable: false,
        runProvider: runProviderOutcome,
        budgetExceeded: {
          reason: quotaResult.providerCreditsAvailable <= 0 ? 'exhausted' : 'insufficient_for_run',
          availableCredits: quotaResult.providerCreditsAvailable,
          requiredCredits: requestedCredits,
        },
        ...describeFreeContribution(),
      };
    }

    // Nada que reservar: la cuota es del proveedor, no del pool del piloto.
    reservationId = null;
    creditsReserved = requestedCredits;
  } else {
    // Atomic budget reservation — pilot kill-switch, allowlist, period, concurrency all checked by RPC
    const budgetResult = await deps.reserveBudget({
      userId,
      clientRequestId: req.clientRequestId,
      requestedCredits,
    });

    if (budgetResult.status === 'blocked') {
      // § 10 — la reserva atómica es la autoridad y sigue decidiendo sola.
      //
      // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — esta rama (`else` de
      // `isApolloBudgetGate`) sólo corre para Tavily y Lusha:
      // `discoveryProvider` está ESTRECHADO por TypeScript a `'tavily'` aquí
      // (Apollo se resuelve arriba, en su propia rama). El `blockDetail` de la
      // modalidad de dos rondas —que sólo existe para Apollo— es por tanto
      // vocabulario MUERTO en esta rama: Apollo ya no puede bloquear vía la
      // reserva del piloto, así que ya no hay bloqueo real que explicar con
      // ese detalle. Se elimina en vez de dejar una comparación que TypeScript
      // marca sin solape (TS2367) por construcción.
      // AGENT1-MACRO-V2-SUMMARY-BUDGET-UX-1 — «se agotó» sólo es cierto cuando no
      // queda NADA. Con presupuesto disponible > 0 pero por debajo de lo que esta
      // corrida necesita, decir «se agotó» es falso y confunde con un estado
      // recuperable distinto (esperar al siguiente período) del real (esta corrida
      // en concreto no cabe). `requiredCredits` es el MISMO número ya reservado
      // arriba (`requestedCredits`), nunca una estimación distinta.
      const budgetExceeded =
        budgetResult.code === 'BUDGET_EXCEEDED' && budgetResult.budgetSnapshot
          ? {
              reason: (budgetResult.budgetSnapshot.availableCredits <= 0
                ? 'exhausted'
                : 'insufficient_for_run') as 'exhausted' | 'insufficient_for_run',
              availableCredits: budgetResult.budgetSnapshot.availableCredits,
              requiredCredits: requestedCredits,
            }
          : null;
      // 🔴 CUT-6 §§ 5, 7, 13 — el presupuesto bloquea la parte PAGADA. Lo que la
      // capa gratuita ya guardó no se toca, no se revierte y no se calla: se sella
      // el lote a su estado verdadero y el fallo lo declara. Un bloqueo que
      // devolviera el resultado de siempre dejaría 4 empresas reales en un `draft`
      // que nadie mira.
      await sealFreeContributionBatch();
      return {
        ok: false,
        code: budgetResult.code,
        message: GUARDRAIL_MESSAGES[budgetResult.code] ?? budgetResult.message,
        retryable: false,
        runProvider: runProviderOutcome,
        ...(budgetExceeded !== null ? { budgetExceeded } : {}),
        ...describeFreeContribution(),
      };
    }

    reservationId = budgetResult.reservationId;
    creditsReserved = budgetResult.creditsReserved;
    budgetWasNew = budgetResult.status === 'reserved';
  }

  // 7b. A1-APOLLO-BUDGET-RECONCILIATION-1 — correlación del run.
  // Se construye en cuanto existe la reserva: sin ella, dos corridas
  // concurrentes del mismo lote sólo se distinguirían por timestamp, que no es
  // una clave de correlación. El batchId se resuelve más abajo (paso 9).
  let runCorrelation = buildWizardRunCorrelation({
    userId,
    clientRequestId: req.clientRequestId,
    reservationId,
    providerKey: discoveryProvider,
    requestSignature: [
      req.countryCode,
      catalogResolution.catalog.version,
      catalogResolution.industry.id,
      catalogResolution.subindustries.map((s) => s.id).join(','),
      String(requestedCredits),
      // A1-APOLLO-TWO-ROUND-QUALITY-1 § 1 — el proveedor de la corrida entra en
      // la huella. Dos intentos del mismo clientRequestId con proveedores
      // distintos producen huellas distintas, así que un cambio de proveedor
      // entre reintentos deja de ser indistinguible del mismo trabajo repetido.
      buildProviderSelectionSignature(runProviderSelection),
    ].join('|'),
  });

  /**
   * Decide cuántos créditos confirmar.
   *
   * Prefiere la reconciliación por proveedor; si no está cableada o la consulta
   * falla, cae al camino previo (lectura Tavily + reserva completa). En todos
   * los caminos el sesgo es conservador: ante gasto no verificable se confirma
   * la reserva entera, nunca menos.
   */
  let lastReconciliation: WizardRunReconciliationResult | null = null;
  const resolveCreditsToConfirm = async (batchId: string): Promise<number> => {
    if (deps.reconcileRunSpend) {
      const reconciliation = await deps
        .reconcileRunSpend({
          batchId,
          correlation: withResolvedIds(runCorrelation, { batchId }),
          discoveryProvider,
          estimatedCredits: requestedCredits,
          reservedCredits: creditsReserved,
        })
        .catch(() => null);
      if (reconciliation) {
        lastReconciliation = reconciliation;
        return reconciliation.creditsToConfirm;
      }
    }
    const consumed = await deps.readConsumedCredits(batchId).catch(() => null);
    return consumed !== null && consumed > 0 ? consumed : creditsReserved;
  };

  // 8. Build resolved execution context (server-controlled — no client-supplied labels)
  // CUT-5 — `countryEntry`/`countryName` se resuelven ahora ANTES del paso 5d,
  // porque la petición del lote canónico los necesita. Se reutilizan aquí: dos
  // cálculos del mismo nombre de país podrían divergir en silencio.
  const resolved: ResolvedWizardExecution = {
    userId,
    clientRequestId: req.clientRequestId,
    mode: 'exploratory',
    country: { code: req.countryCode, name: countryName },
    catalog: { version: catalogResolution.catalog.version },
    industry: {
      id: catalogResolution.industry.id,
      slug: catalogResolution.industry.slug,
      name: catalogResolution.industry.name,
    },
    subindustries: catalogResolution.subindustries,
    additionalCriteria: req.additionalCriteriaRaw,
    systemControls: {
      targetCount: WIZARD_SYSTEM_CONTROLS.targetCount,
      minimumEmployees: WIZARD_SYSTEM_CONTROLS.minimumEmployees,
      employeeThresholdMode: WIZARD_SYSTEM_CONTROLS.employeeThresholdMode,
    },
  };

  // 9. Reserve durable execution slot (idempotency anchor).
  //
  // CUT-5 §§ 4, 12 — la reserva ya no se construye aquí: se RESUELVE contra la
  // autoridad única declarada antes del paso 5d. Si la capa gratuita ya la
  // materializó, esta llamada devuelve exactamente el mismo lote sin tocar la
  // base; si no, la crea ahora. En las dos ramas el id es el mismo, que es la
  // invariante entera del corte.
  //
  // 🔴 El payload NO viaja desde aquí a propósito: la petición del lote es verdad
  // de la PETICIÓN, y si cada rama pudiera pasar el suyo el contenido del lote
  // dependería de quién llegase primero a resolverlo.
  let reservation: WizardExecutionReservationResult;
  try {
    reservation = await canonicalBatch.resolve();
  } catch {
    // Slot reservation failed — release budget if it was newly created.
    // `reservationId !== null` is always true here when `budgetWasNew` is true
    // (Apollo never sets `budgetWasNew`, since it never reserves anything) —
    // spelled out explicitly so TypeScript narrows `reservationId` too.
    if (budgetWasNew && reservationId !== null) {
      await deps.releaseBudget({ reservationId, reason: 'slot_reservation_failed' }).catch(() => undefined);
    }
    // CUT-6 § 5 — inalcanzable cuando la capa gratuita ya aportó (el resolutor
    // memoriza su reserva exitosa), pero el aporte se declara igual: la
    // supervivencia de las filas no puede depender de un razonamiento sobre qué
    // rama llegó primero.
    await sealFreeContributionBatch();
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'No se pudo reservar la ejecución. Por favor, intenta nuevamente.',
      retryable: true,
      runProvider: runProviderOutcome,
      ...describeFreeContribution(),
    };
  }

  // 10. Batch idempotency: already_reserved means a prior request owns this execution
  if (reservation.status === 'already_reserved') {
    // Budget newly reserved but batch already exists → release budget; another execution owns it
    if (budgetWasNew && reservationId !== null) {
      await deps.releaseBudget({
        reservationId,
        batchId: reservation.batchId,
        reason: 'batch_already_reserved',
      }).catch(() => undefined);
    }
    // If budget was also already_reserved, do NOT touch it — belongs to the first execution
    return {
      ok: true,
      status: 'already_started',
      batchId: reservation.batchId,
      batchStatus: 'draft',
      redirectPath: `/prospect-batches/${reservation.batchId}`,
      // § 9/§ 10 — un reintento reporta el proveedor de la corrida, que es el
      // preservado, no el que el navegador tenga seleccionado ahora.
      runProvider: runProviderOutcome,
    };
  }

  // 11. Execute discovery pipeline (Tavily or Apollo) using the reserved batchId as anchor
  const reservedBatchId = reservation.batchId;
  runCorrelation = withResolvedIds(runCorrelation, { batchId: reservedBatchId });
  let pipelineResult: IncrementalSearchOutput;
  try {
    if (discoveryProvider === 'apollo_organizations') {
      const apolloRunner = deps.runApolloPipeline;
      if (!apolloRunner) {
        throw new Error('apollo_pipeline_not_configured');
      }
      pipelineResult = await apolloRunner({
        resolved,
        reservedBatchId,
        // Q3F-5BB.11E — additive OBSERVATIONAL routing metadata (never gates).
        extraBatchMetadata: apolloRoutingExtraMetadata,
        // 🔴 CUT-8 · DECISIÓN B — la aceptación NO puede viajar por
        // `extraBatchMetadata`: esa costura se arma antes de que el writer corra
        // y en ese momento la mitad de pago todavía no existe. Va como FUNCIÓN,
        // que el writer invoca cuando ya contó y antes de publicar.
        resolveExtraBatchMetadata: resolveAcceptedForTargetBatchMetadata,
        // A1-APOLLO-BUDGET-RECONCILIATION-1 — viaja hasta provider_usage_logs.
        runCorrelation: toRunCorrelationMetadata(runCorrelation),
        // A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 1/§ 7 — correlación completa: es
        // la que ancla las claves de operación y el estado de recuperación de la
        // modalidad de dos rondas. Con la modalidad apagada no se usa.
        correlation: runCorrelation,
        // § 2 — lo que la reserva sostiene, para la aserción defensiva de gasto.
        reservedCredits: creditsReserved,
        // 🔴 CUT-2 § 5 — la demanda va JUNTO a la reserva y no DENTRO de ella. Son
        // dos números con dos autoridades: `creditsReserved` sale de
        // `estimateCreditsForProvider(provider)`, que no ve el hueco; `resultDemand`
        // sale del gate gratuito, que no ve créditos. Mientras P0-1 siga sin
        // confirmación escrita de Apollo, derivar uno del otro afirmaría un modelo
        // de facturación que nadie ha verificado.
        resultDemand: apolloResultDemand,
        priorProviderSeen: apolloPriorProviderSeen,
      });
    } else {
      pipelineResult = await deps.runTavilyPipeline({ resolved, reservedBatchId });
    }
  } catch {
    // Reconcile conservatively — the provider may have partially executed
    const toConfirm = await resolveCreditsToConfirm(reservedBatchId);
    // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — Apollo nunca reservó nada
    // aquí (`reservationId === null`): no hay reserva del piloto que
    // confirmar. Su gasto ya quedó en `provider_usage_logs`, que es lo que
    // `resolveCreditsToConfirm` acaba de leer arriba para el reporte.
    if (reservationId !== null) {
      await deps.confirmBudget({ reservationId, actualCreditsConsumed: toConfirm, batchId: reservedBatchId }).catch(() => undefined);
    }
    await deps.markBatchFailed(reservedBatchId, 'pipeline_error').catch(() => undefined);
    // CUT-6 §§ 5, 13 — sin sellado propio: `markBatchFailed` acaba de resolver el
    // estado con su sonda durable (CUT-1), así que el lote que contiene el aporte
    // gratuito queda en `ready_for_review` y no en `failed`. Aquí sólo se declara.
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'El pipeline de búsqueda falló durante la ejecución.',
      retryable: false,
      runProvider: runProviderOutcome,
      ...describeFreeContribution(),
    };
  }

  // 12. Verify batchId consistency — pipeline must return the exact same batchId we reserved
  if (pipelineResult.batchId !== reservedBatchId) {
    const toConfirm = await resolveCreditsToConfirm(reservedBatchId);
    if (reservationId !== null) {
      await deps.confirmBudget({ reservationId, actualCreditsConsumed: toConfirm, batchId: reservedBatchId }).catch(() => undefined);
    }
    await deps.markBatchFailed(reservedBatchId, 'batchid_mismatch').catch(() => undefined);
    // CUT-6 § 5 — misma regla que arriba: `markBatchFailed` ya decidió el estado.
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'Se detectó una inconsistencia interna en el ID del lote generado.',
      retryable: false,
      runProvider: runProviderOutcome,
      ...describeFreeContribution(),
    };
  }

  // 13. Reconcile credits — confirm actual consumed (partial or full)
  // Conservative by construction: unverifiable spend confirms the full
  // reservation, and a recorded overrun confirms the recorded amount rather
  // than being clamped back down to what was reserved.
  const actualToConfirm = await resolveCreditsToConfirm(reservedBatchId);

  let reconciliationFailed = false;
  // AGENT1-APOLLO-PROVIDER-CONSUMPTION-GATE-1 — Apollo no reservó nada del
  // pool del piloto (`reservationId === null`): no hay liquidación de una
  // reserva del piloto que hacer. Su gasto real ya vive en
  // `provider_usage_logs`, escrito por el propio pipeline de Apollo, no por
  // esta liquidación.
  if (reservationId !== null) {
    try {
      // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 § 13 — el resultado de la liquidación se
      // MIRA. Antes se descartaba, y el wrapper no lanza: devuelve
      // `{ status: 'error' }`. Así que una liquidación RECHAZADA por la RPC —el caso
      // exacto que la migración 121 cierra, `actual > reserved` →
      // `invalid_actual_credits`— era indistinguible de una exitosa, y la reserva se
      // quedaba en `reserved` bloqueando la corrida siguiente sin que nada lo dijera.
      //
      // `confirmed_with_overage` es un ÉXITO y NO enciende el aviso: el gasto real
      // entero quedó en el período y la reserva quedó cerrada. Tratarlo como fallo
      // sería el mismo error de lectura, sólo en el otro sentido.
      const settlement = await deps.confirmBudget({
        reservationId,
        actualCreditsConsumed: actualToConfirm,
        batchId: reservedBatchId,
        // Sólo para describir la magnitud de un sobrepaso; no decide nada.
        creditsReserved,
      });
      if (settlement.status === 'error') {
        reconciliationFailed = true;
      }
    } catch {
      // Generation succeeded — do NOT convert to failure. Log warning internally.
      reconciliationFailed = true;
    }
  }

  // 14. Success
  const noveltyExhausted = pipelineResult.metadata?.novelty_exhausted === true;

  // ── CUT-6 §§ 11, 14, 19 — la verdad COMBINADA de la ejecución ───────────────
  //
  // El pipeline sólo puede contar lo SUYO. Con el hueco parcial activo eso deja
  // de ser el resultado: una corrida con 4 empresas gratuitas y 6 de Apollo
  // reportaría 6, y una con 4 gratuitas y 0 de Apollo reportaría
  // `no_new_candidates` sobre un lote que tiene 4 empresas dentro. Las dos son
  // falsas, y la segunda invita al usuario a repetir —y pagar— una búsqueda que
  // ya le dejó resultados.
  //
  // 🔴 La suma la hace `resolveBatchDurableTotals`, la MISMA de CUT-1 que usan
  // los escritores, y no una aritmética nueva de este archivo. El aporte gratuito
  // entra como `preExisting` porque se persistió ANTES —el campo lleva el momento
  // de la lectura en el nombre justo para que nadie lo cuente dos veces—.
  //
  // 🔴 Y NO hay doble conteo con lo de pago: una identidad que la capa gratuita ya
  // dejó en el lote la rechaza el dedupe de CUT-3 dentro del writer, así que
  // `candidatesCreated` cuenta sólo lo REALMENTE admitido. 6 crudos con 2
  // duplicados son 4 aquí, y el total queda en 8. No se finge 10.
  const combinedDurableTotals = resolveBatchDurableTotals({
    preExisting: durableCandidatesFromCount(freeContribution?.persistedCandidates ?? 0),
    insertedNow: pipelineResult.candidatesCreated ?? 0,
  });

  const hasNewCandidates = combinedDurableTotals.totalDurableCandidates > 0;

  // ── AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 5, 6, 9 ────────────────────
  //
  // CUÁNTOS CANDIDATOS CUENTAN DE VERDAD HACIA EL OBJETIVO DE LA PERSONA.
  //
  // El defecto que cierra: hasta este corte el veredicto salía de
  // `combinedDurableTotals`, es decir de FILAS. Y una fila persistida no es una
  // empresa útil — `candidate-completeness-contract.ts` § D persiste a propósito
  // el candidato incompleto o ambiguo como `needs_review` para que alguien lo
  // revise—. Con 10 filas de las que 4 existen sólo para revisión, el wizard
  // anunciaba «objetivo alcanzado» sobre 6 empresas.
  //
  // 🔴 Ninguna política de calidad nueva (§ 3). Las dos mitades entran con la
  // cifra que su PROPIA autoridad ya resolvía:
  //
  //   · gratuita — `apolloResultDemand`, el mismo hueco con el que se le pidió
  //     al proveedor. Que sea el mismo OBJETO y no dos números recalculados es
  //     lo que impide que el hueco con el que se pide y el hueco con el que se
  //     juzga puedan separarse (§ 6).
  //   · pagada — `completeValidCandidates`, que el writer publica como
  //     `target_count` desde AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § E
  //     con el comentario literal «lo único que puede compararse con el target».
  //     Existía; este archivo la ignoraba.
  //
  // 🔴 Fail-closed: un pipeline que escribió filas y NO midió su completitud
  // aporta cero, nunca sus filas. Es la misma postura que
  // `apollo-persisted-candidate-truth.ts` ya sostenía para `null`.
  //
  // 🔴 CUT-8 § 2 — la MISMA función que resolvió la metadata durable. Antes de
  // este corte esta expresión vivía suelta aquí; que exista una sola impide que
  // lo que la base guarda y lo que el mago enseña puedan discrepar.
  const acceptedForTarget = resolveRunAcceptance({
    completeValidCandidates: pipelineResult.persistenceOutcome?.completeValidCandidates ?? null,
    persistedCandidates: pipelineResult.candidatesCreated ?? 0,
  });

  // 🔴 § 4/§ 12 — el objetivo PERSISTIBLE que se reporta es el del USUARIO, no el
  // hueco recortado con el que corrió el proveedor. Decir «6» sobre una petición
  // de 10 convertiría un detalle de ejecución en una promesa distinta a la que la
  // persona hizo. `requestedTarget` sale de la demanda ya resuelta, que es la
  // autoridad existente; no se acuña ninguna segunda.
  //
  // Sin aporte gratuito el valor es EXACTAMENTE el de antes, byte por byte.
  const targetPersistibleCandidates =
    freeContribution !== null
      ? apolloResultDemand.requestedTarget
      : (pipelineResult.targetPersistibleCandidates ?? 10);

  // 🔴 CUT-7 §§ 1, 9 — el objetivo se decide con la autoridad de ACEPTACIÓN, y
  // con ninguna otra.
  //
  // Antes de este corte había dos veredictos y los dos contaban filas: con aporte
  // gratuito, `totalDurableCandidates >= target`; sin él, el `targetReached` del
  // pipeline, que es `writerCandidatesCreated >= targetPersistibleCandidates`.
  // El primero sumaba las filas de revisión de las dos mitades; el segundo, las
  // de una. Ahora los dos caminos preguntan lo mismo a la misma función, y la
  // respuesta es `acceptedFree + acceptedPaid >= requestedTarget`.
  //
  // 🔴 Esto CAMBIA el veredicto de corridas que antes se declaraban completas: 10
  // filas de las que 4 son sólo de revisión pasan de `success_target_reached` a
  // `success_partial`. Ése es el corte, no un efecto colateral: § 11 prohíbe que
  // una capa anuncie 10 cuando la corrida consiguió 6.
  const targetReached = acceptedForTarget.targetReached;

  // A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — cifras reales de la escritura, tal
  // como las devolvió el writer. `null` cuando el pipeline no las produjo.
  const persistenceOutcome: WizardPersistenceOutcome | null = pipelineResult.persistenceOutcome
    ? {
        eligibleBeforePersistence:
          pipelineResult.persistenceOutcome.eligibleBeforePersistence,
        persistedCandidates: pipelineResult.persistenceOutcome.persistedCandidates,
        persistenceFailureCount: pipelineResult.persistenceOutcome.persistenceFailureCount,
        persistenceFailed: pipelineResult.persistenceOutcome.persistenceFailed,
        persistenceErrorCode: pipelineResult.persistenceOutcome.persistenceErrorCode,
        // AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 § 7 — éxito PARCIAL con
        // nombre propio y con las cifras que lo sostienen. Sin ellas la UI sólo
        // podía elegir entre «todo bien» y «todo mal», y la corrida `9a9acf99`
        // (3 guardados de 4 intentos) no es ninguna de las dos.
        //
        // `null` cuando el camino no las midió: un cero afirmaría que no hubo
        // ninguno, que es una afirmación distinta y más fuerte.
        persistenceStatus: pipelineResult.persistenceOutcome.persistenceStatus,
        persistenceAttemptedCount: pipelineResult.persistenceOutcome.persistenceAttemptedCount,
        persistenceSucceededCount: pipelineResult.persistenceOutcome.persistenceSucceededCount,
        persistenceFailedCount: pipelineResult.persistenceOutcome.persistenceFailedCount,
        persistenceGap: pipelineResult.persistenceOutcome.persistenceGap,
        lateDuplicateCount: pipelineResult.persistenceOutcome.lateDuplicateCount ?? null,
        completeValidCandidates:
          pipelineResult.persistenceOutcome.completeValidCandidates ?? null,
        reviewOnlyCandidates: pipelineResult.persistenceOutcome.reviewOnlyCandidates ?? null,
      }
    : null;

  // § 7 — había empresas elegibles y NINGUNA se guardó. No es un vacío: es un
  // error técnico posterior al gasto, y el estado tiene que decirlo.
  const persistenceBlocked =
    persistenceOutcome !== null &&
    persistenceOutcome.persistenceFailed &&
    persistenceOutcome.eligibleBeforePersistence > 0 &&
    persistenceOutcome.persistedCandidates === 0;

  const executionStatus = persistenceBlocked
    ? 'completed_with_errors'
    : hasNewCandidates
      ? (targetReached ? 'success_target_reached' : 'success_partial')
      : 'no_new_candidates';
  return {
    ok: true,
    status: executionStatus,
    batchId: reservedBatchId,
    // El lote quedó `failed` por el writer (§ 9): el estado que se reporta es el
    // que la base tiene, no una etiqueta optimista.
    //
    // 🔴 CUT-6 § 13 — salvo que el lote CONTENGA el aporte gratuito. Ahí el writer
    // NO lo dejó en `failed`: su propia decisión de CUT-1 ve filas durables
    // preexistentes y escribe `ready_for_review`. Reportar `failed` sobre esa fila
    // sería la misma etiqueta optimista, en el otro sentido — un estado inventado
    // que la base no tiene. `completed_with_errors` sigue siendo el estado de la
    // EJECUCIÓN, porque la escritura de pago sí falló de verdad.
    batchStatus:
      persistenceBlocked && freeContribution === null
        ? 'failed'
        : hasNewCandidates
          ? 'ready_for_review'
          : 'nothing_to_write',
    // 🔴 CUT-6 § 14 — el conteo COMBINADO. Sin aporte gratuito es idéntico a
    // `pipelineResult.candidatesCreated`.
    candidateCount: combinedDurableTotals.totalDurableCandidates,
    redirectPath: `/prospect-batches/${reservedBatchId}`,
    targetPersistibleCandidates,
    targetReached,
    // 🔴 CUT-7 §§ 5, 7, 11 — el subconjunto ACEPTADO viaja junto al universo
    // durable y con nombres distintos, para que ningún consumidor tenga que
    // deducir uno del otro. `candidateCount` sigue siendo las filas; esto es lo
    // que cuenta hacia el objetivo.
    acceptedForTarget,
    ...(reconciliationFailed ? { reconciliationWarning: 'BUDGET_RECONCILIATION_FAILED' as const } : {}),
    // A1-APOLLO-BUDGET-RECONCILIATION-1: an overrun must be visible, not just
    // absorbed. The generation still succeeded — the candidates exist and the
    // credits were really spent — so this reports; it never fails the run.
    // A1-APOLLO-TWO-ROUND-QUALITY-1-FIX § 2: la aserción defensiva de la
    // modalidad de dos rondas viaja por la misma vía, con el mismo código.
    ...buildReconciliationOutcome(lastReconciliation, pipelineResult),
    ...(noveltyExhausted ? { noveltyExhausted: true as const } : {}),
    // A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 8 — la distribución real de
    // descartes viaja sólo cuando hace falta explicarla: sin empresas nuevas.
    ...(hasNewCandidates
      ? {}
      : {
          noNewCandidatesBreakdown: buildNoNewCandidatesBreakdown(
            { ...(pipelineResult.metadata ?? {}), novelty_exhausted: noveltyExhausted },
            APOLLO_TWO_ROUND_OBSERVABILITY_KEY,
          ),
        }),
    // A1-APOLLO-QA-CONTROL-SURFACE-1 § 10 — el proveedor REAL de esta corrida.
    runProvider: runProviderOutcome,
    // § 11 — cifras reales de dos rondas, sólo si la modalidad corrió.
    ...buildTwoRoundOutcome(pipelineResult),
    // A1-APOLLO-PERSISTENCE-READINESS-4 § 7/§ 8 — se envía siempre que exista,
    // también cuando todo fue bien: la UI resuelve la causa de mayor prioridad a
    // partir de estas cifras en vez de inferirla de un conteo.
    ...(persistenceOutcome !== null ? { persistenceOutcome } : {}),
  };
}

/**
 * A1-APOLLO-QA-CONTROL-SURFACE-1 § 11 — proyecta las cifras de dos rondas que la
 * observabilidad del pipeline dejó en el metadata.
 *
 * Devuelve `{}` cuando la modalidad no corrió, y `null` por campo cuando el dato
 * está ausente o tiene una forma inesperada. Nunca lanza y nunca inventa un cero:
 * «no se sabe cuántas rondas corrieron» no es «corrió una».
 */
function buildTwoRoundOutcome(
  pipelineResult: IncrementalSearchOutput | null | undefined,
): { twoRoundOutcome?: { roundsExecuted: number | null; eligibleCompaniesFound: number | null } } {
  const metadata = pipelineResult?.metadata as Record<string, unknown> | undefined;
  const observability = metadata?.[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] as
    | Record<string, unknown>
    | undefined;
  if (!observability || typeof observability !== 'object') return {};

  const readCount = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  return {
    twoRoundOutcome: {
      roundsExecuted: readCount(observability['rounds_executed']),
      eligibleCompaniesFound: readCount(observability['eligible_companies_found']),
    },
  };
}

// ── Public message map ────────────────────────────────────────────────────────
// Maps pilot guardrail codes to user-facing Spanish messages.
// Internal: not exported from index.ts — only used within the action.

/**
 * Projects a reconciliation into the operator-facing outcome fields.
 *
 * Returns `{}` when no reconciliation ran (Tavily-only callers, or the legacy
 * path), so their result shape is unchanged.
 */
function buildReconciliationOutcome(
  reconciliation: WizardRunReconciliationResult | null,
  pipelineResult?: IncrementalSearchOutput | null,
): {
  reconciliationState?: 'confirmed' | 'pending_reconciliation' | 'billing_unknown';
  budgetAnomalies?: readonly string[];
} {
  const twoRoundAnomalies = readTwoRoundBudgetAnomalies(pipelineResult);
  // A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 9 — una operación cuyo cobro no se
  // confirmó impide declarar la conciliación cerrada, gane lo que gane el resto.
  const indeterminate = twoRoundAnomalies.includes(TWO_ROUND_INDETERMINATE_ANOMALY);

  if (!reconciliation) {
    // Sin reconciliación por proveedor (Tavily, o la ruta previa) el resultado
    // conserva su forma; una anomalía de dos rondas sigue siendo visible.
    if (twoRoundAnomalies.length === 0) return {};
    return {
      reconciliationState: indeterminate ? 'billing_unknown' : 'pending_reconciliation',
      budgetAnomalies: twoRoundAnomalies,
    };
  }

  const anomalies = [...new Set([...reconciliation.anomalies, ...twoRoundAnomalies])];
  // Precedencia: cobro desconocido > sobregasto registrado > confirmado. Un total
  // conocido menor o igual a la reserva NO alcanza para declarar conciliación si
  // no hubo filas de uso o si alguna operación quedó indeterminada: ausencia de
  // evidencia no es evidencia de cero gasto.
  const state = indeterminate || reconciliation.billingState === 'unknown'
    ? 'billing_unknown'
    : anomalies.includes('recorded_usage_exceeds_reservation') ||
        anomalies.includes('no_usage_rows_found')
      ? 'pending_reconciliation'
      : 'confirmed';

  return {
    reconciliationState: state,
    ...(anomalies.length > 0 ? { budgetAnomalies: anomalies } : {}),
  };
}

/**
 * Lee la anomalía de presupuesto que la modalidad de dos rondas dejó en la
 * observabilidad del pipeline.
 *
 * Devuelve una lista vacía —nunca lanza— para cualquier forma inesperada: una
 * metadata ilegible no puede convertir una generación exitosa en un fallo.
 */
function readTwoRoundBudgetAnomalies(
  pipelineResult: IncrementalSearchOutput | null | undefined,
): string[] {
  const metadata = pipelineResult?.metadata as Record<string, unknown> | undefined;
  const observability = metadata?.[APOLLO_TWO_ROUND_OBSERVABILITY_KEY] as
    | Record<string, unknown>
    | undefined;
  const anomalies = observability?.['budget_anomalies'];
  if (!Array.isArray(anomalies)) return [];
  return anomalies.filter((entry): entry is string => typeof entry === 'string');
}

const GUARDRAIL_MESSAGES: Partial<Record<PilotGuardrailCode, string>> = {
  PILOT_PAUSED:
    'La generación de prospectos está pausada temporalmente.',
  NOT_IN_PILOT:
    'Esta función todavía está disponible solo para el grupo piloto.',
  BUDGET_PERIOD_NOT_CONFIGURED:
    'El presupuesto del piloto para este mes todavía no está configurado.',
  BUDGET_PERIOD_CLOSED:
    'El período presupuestal del piloto está cerrado.',
  EXECUTION_CREDIT_LIMIT_EXCEEDED:
    'Esta búsqueda supera el máximo permitido por corrida.',
  BUDGET_EXCEEDED:
    'El presupuesto disponible para generación de prospectos se agotó.',
  CONCURRENT_EXECUTION_ACTIVE:
    'Ya tienes una generación en curso. Espera a que termine antes de iniciar otra.',
  BUDGET_RESERVATION_FAILED:
    'No se pudo reservar el presupuesto para la ejecución. Por favor, intenta nuevamente.',
};
