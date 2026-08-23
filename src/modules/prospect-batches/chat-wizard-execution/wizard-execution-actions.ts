'use server';

import { createClient } from '@/lib/supabase/server';

import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  isProspectChatWizardExecutionEnabled,
  isApolloCompanySearchEnabled,
} from '@/lib/feature-flags.server';
import { resolveWizardCatalog } from './wizard-catalog-resolver';
import { wizardExecutionRequestSchema } from './wizard-execution-schema';
import { WIZARD_SYSTEM_CONTROLS } from './wizard-pipeline-adapter';
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
import {
  isWizardRunProviderOverrideEnabled,
  isApolloTwoRoundDiscoveryEnabled,
} from '@/lib/feature-flags.server';
// § 10 — código explicativo del techo de la modalidad de dos rondas.
import { BUDGET_EXCEEDED_TWO_ROUND_APOLLO } from '@/server/agents/prospecting-toolkit/apollo-two-round';
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
} from '@/server/prospect-batches/batch-durable-candidates';
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
  }) => Promise<PrePaidNoveltyDiscoveryOutcome>;
  // Budget guardrail operations — period calculation and settings load are encapsulated here.
  reserveBudget: (input: {
    userId: string;
    clientRequestId: string;
    requestedCredits: number;
  }) => Promise<ReserveBudgetDepResult>;
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
  const countryEntryForSource = LATAM_COUNTRIES.find((c) => c.code === req.countryCode);
  const prePaidNovelty = deps.runPrePaidNoveltyDiscovery
    ? await deps
        .runPrePaidNoveltyDiscovery({
          countryCode: req.countryCode,
          macroIndustryKey:
            getMacroIndustryBySlug(catalogResolution.industry.slug)?.key ?? null,
          // 🔴 El objetivo del USUARIO son los candidatos persistibles (10), no
          // `systemControls.targetCount` (25), que es la AMPLITUD de búsqueda del
          // pipeline. Confundirlos habría pedido a la fuente gratuita cerrar un
          // hueco que el producto nunca prometió.
          requestedTarget: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
          requestedByUserId: userId,
          countryName: countryEntryForSource?.name ?? req.countryCode,
        })
        // Fail-open (§ 12): una capa gratuita rota nunca deja el wizard
        // inservible. Se degrada a «no aportó» y la ruta de pago sigue.
        .catch((): PrePaidNoveltyDiscoveryOutcome | null => null)
    : null;

  // § 15 — hueco cerrado gratis ⇒ NI estimación, NI reserva, NI cliente de
  // proveedor, NI llamada. Se exige además un lote real: sin él no habría a dónde
  // mandar al usuario, y anunciar éxito sin candidatos sería falso.
  if (
    prePaidNovelty &&
    !prePaidNovelty.providerRequired &&
    prePaidNovelty.batchId !== null &&
    prePaidNovelty.persistedCount > 0
  ) {
    return {
      ok: true,
      status: 'success_target_reached',
      batchId: prePaidNovelty.batchId,
      batchStatus: 'ready_for_review',
      candidateCount: prePaidNovelty.persistedCount,
      redirectPath: `/prospect-batches/${prePaidNovelty.batchId}`,
      targetPersistibleCandidates: WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
      targetReached: true,
      runProvider: runProviderOutcome,
    };
  }

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
  const prePaidContributed =
    prePaidNovelty !== null &&
    prePaidNovelty.batchId !== null &&
    prePaidNovelty.persistedCount > 0;
  const apolloResultDemand = prePaidContributed
    ? resolveProviderResultDemand(prePaidNovelty, WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES)
    : fullTargetResultDemand(WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES);

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

  // 7. Atomic budget reservation — pilot kill-switch, allowlist, period, concurrency all checked by RPC
  const budgetResult = await deps.reserveBudget({
    userId,
    clientRequestId: req.clientRequestId,
    requestedCredits,
  });

  if (budgetResult.status === 'blocked') {
    // § 10 — la reserva atómica es la autoridad y sigue decidiendo sola. Lo que se
    // añade es el estado EXPLICATIVO: con la modalidad de dos rondas activa, el
    // número que no cupo es su techo de peor caso, y decirlo evita que un
    // operador lo lea como el guardrail legacy.
    const twoRoundBlockDetail =
      discoveryProvider === 'apollo_organizations' && isApolloTwoRoundDiscoveryEnabled()
        ? BUDGET_EXCEEDED_TWO_ROUND_APOLLO
        : null;
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
    return {
      ok: false,
      code: budgetResult.code,
      message: GUARDRAIL_MESSAGES[budgetResult.code] ?? budgetResult.message,
      retryable: false,
      runProvider: runProviderOutcome,
      ...(twoRoundBlockDetail !== null ? { blockDetail: twoRoundBlockDetail } : {}),
      ...(budgetExceeded !== null ? { budgetExceeded } : {}),
    };
  }

  const { reservationId, creditsReserved } = budgetResult;
  const budgetWasNew = budgetResult.status === 'reserved';

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
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === req.countryCode);
  const countryName = countryEntry?.name ?? req.countryCode;

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
  let reservation: WizardExecutionReservationResult;
  try {
    reservation = await deps.reserveSlot({
      userId,
      clientRequestId: req.clientRequestId,
      initialBatchPayload: {
        requestSource: 'chat_wizard',
        catalogVersionId: catalogResolution.catalog.version,
        industryId: catalogResolution.industry.id,
        subindustryIds: catalogResolution.subindustries.map((s) => s.id),
        countryCode: req.countryCode,
        additionalCriteria: req.additionalCriteriaRaw,
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
  } catch {
    // Slot reservation failed — release budget if it was newly created
    if (budgetWasNew) {
      await deps.releaseBudget({ reservationId, reason: 'slot_reservation_failed' }).catch(() => undefined);
    }
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'No se pudo reservar la ejecución. Por favor, intenta nuevamente.',
      retryable: true,
      runProvider: runProviderOutcome,
    };
  }

  // 10. Batch idempotency: already_reserved means a prior request owns this execution
  if (reservation.status === 'already_reserved') {
    // Budget newly reserved but batch already exists → release budget; another execution owns it
    if (budgetWasNew) {
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
    await deps.confirmBudget({ reservationId, actualCreditsConsumed: toConfirm, batchId: reservedBatchId }).catch(() => undefined);
    await deps.markBatchFailed(reservedBatchId, 'pipeline_error').catch(() => undefined);
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'El pipeline de búsqueda falló durante la ejecución.',
      retryable: false,
      runProvider: runProviderOutcome,
    };
  }

  // 12. Verify batchId consistency — pipeline must return the exact same batchId we reserved
  if (pipelineResult.batchId !== reservedBatchId) {
    const toConfirm = await resolveCreditsToConfirm(reservedBatchId);
    await deps.confirmBudget({ reservationId, actualCreditsConsumed: toConfirm, batchId: reservedBatchId }).catch(() => undefined);
    await deps.markBatchFailed(reservedBatchId, 'batchid_mismatch').catch(() => undefined);
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'Se detectó una inconsistencia interna en el ID del lote generado.',
      retryable: false,
      runProvider: runProviderOutcome,
    };
  }

  // 13. Reconcile credits — confirm actual consumed (partial or full)
  // Conservative by construction: unverifiable spend confirms the full
  // reservation, and a recorded overrun confirms the recorded amount rather
  // than being clamped back down to what was reserved.
  const actualToConfirm = await resolveCreditsToConfirm(reservedBatchId);

  let reconciliationFailed = false;
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

  // 14. Success
  const hasNewCandidates = (pipelineResult.candidatesCreated ?? 0) > 0;
  const noveltyExhausted = pipelineResult.metadata?.novelty_exhausted === true;
  const targetPersistibleCandidates = pipelineResult.targetPersistibleCandidates ?? 10;
  const targetReached = pipelineResult.targetReached === true;

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
    batchStatus: persistenceBlocked
      ? 'failed'
      : hasNewCandidates
        ? 'ready_for_review'
        : 'nothing_to_write',
    candidateCount: pipelineResult.candidatesCreated,
    redirectPath: `/prospect-batches/${reservedBatchId}`,
    targetPersistibleCandidates,
    targetReached,
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
