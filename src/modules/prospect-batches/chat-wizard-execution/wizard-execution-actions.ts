'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  isProspectChatWizardExecutionEnabled,
  isApolloCompanySearchEnabled,
} from '@/lib/feature-flags.server';
import { resolveWizardCatalog } from './wizard-catalog-resolver';
import { wizardExecutionRequestSchema } from './wizard-execution-schema';
import { WIZARD_SYSTEM_CONTROLS } from './wizard-pipeline-adapter';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { WizardExecutionActionResult, ResolvedWizardExecution } from './wizard-execution-types';
import { reserveWizardExecutionSlot } from './wizard-idempotency';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult, IdempotencyDbClient } from './wizard-idempotency';
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
import type { WizardApolloRunner } from './wizard-apollo-executor';
import { resolveWizardDiscoveryProvider } from './wizard-provider-resolver';
import type { WizardDiscoveryProviderKey } from './wizard-provider-resolver';
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
import { markWizardBatchFailed } from './wizard-batch-failure';
import type { CatalogResolutionInput, CatalogResolutionOutput } from './wizard-catalog-resolver';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import type { PilotGuardrailCode, ConfirmWizardCreditsOutput, ReleaseWizardCreditsOutput } from './wizard-pilot-types';
import {
  reserveWizardPilotCredits,
  confirmWizardPilotCredits,
  releaseWizardPilotCredits,
  fetchWizardReservationRecord,
} from './wizard-budget-reservations';
import type { BudgetReservationsRpcClient, ReservationLookupClient } from './wizard-budget-reservations';
import {
  estimateWizardTavilyMaxCredits,
  getPilotBudgetPeriodStart,
  readWizardConsumedCreditsFromDb,
} from './wizard-budget-reconciliation';
import { estimateCreditsForProvider } from './wizard-budget-estimate';
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
  | { status: 'blocked'; code: PilotGuardrailCode; message: string };

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
  markBatchFailed: (batchId: string, reason: 'batchid_mismatch' | 'pipeline_error') => Promise<void>;
};


// ── Public server action ──────────────────────────────────────────────────────
// Thin entrypoint for Next.js. Builds real deps from server context, delegates
// to executeProspectWizardGeneration for the actual logic.

const BOGOTA_TIMEZONE = 'America/Bogota';

/**
 * A1-APOLLO-WIZARD-1 — rol admitido para discovery de empresas con Apollo.
 *
 * Refleja la misma regla que ya gobierna la ruta legacy (`admin`), resuelta
 * aquí en vez de importarse desde el módulo de acciones de 4k líneas. Falla
 * cerrado: un rol ilegible no es un rol admitido.
 */
async function resolveIsApolloDiscoveryRolePermitted(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id, role_id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();
    if (!internalUser) return false;

    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();

    return role?.key === 'admin';
  } catch {
    return false;
  }
}

// Budget RPC functions (try_reserve_wizard_credits, confirm_wizard_credits, release_wizard_credits)
// and the wizard_budget_reservations table are REVOKE'd from the `authenticated` role — they require
// service_role. The user-session client (publishable key) cannot call them.
function createWizardBudgetClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role credentials required for wizard budget operations');
  return createAdminClient(url, key);
}

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

    reserveBudget: async ({ userId, clientRequestId, requestedCredits }) => {
      const periodStart = getPilotBudgetPeriodStart(BOGOTA_TIMEZONE);
      const rpcResult = await reserveWizardPilotCredits(
        { userId, clientRequestId, requestedCredits, periodStart },
        budgetClient as unknown as BudgetReservationsRpcClient,
      );
      if (rpcResult.status === 'blocked') return rpcResult;

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
    runApolloPipeline: (apolloInput) => runWizardApolloSearch(apolloInput),
    resolveProvider: resolveWizardDiscoveryProvider,

    markBatchFailed: (batchId, reason) =>
      markWizardBatchFailed(batchId, reason, async (id) => {
        const result = await supabase
          .from('prospect_batches')
          .update({ status: 'failed' })
          .eq('id', id);
        return { error: result.error };
      }),
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
  const discoveryProvider: WizardDiscoveryProviderKey = (deps.resolveProvider ?? resolveWizardDiscoveryProvider)();

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
      apolloRoutingExtraMetadata = { [BATCH_PROVIDER_ROUTING_KEY]: routingMetadata };
    } catch {
      // Fail-closed: a routing inconsistency (assert throw) must not run a
      // mis-routed provider. Never falls through to another provider.
      return {
        ok: false,
        code: 'GENERATION_FAILED',
        message: 'No se pudo validar el enrutamiento del proveedor de búsqueda.',
        retryable: false,
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
      };
    }
  }

  // 6. Calculate max credits server-side — provider-aware; client cannot control this value.
  // Apollo: resolvedMaxQueries × resolvedMaxResults × 1 credit/result (default 1×3=3).
  // Tavily: adaptive pipeline ceiling (4 rounds × 5 queries = 20).
  const requestedCredits = estimateCreditsForProvider(discoveryProvider);

  // 7. Atomic budget reservation — pilot kill-switch, allowlist, period, concurrency all checked by RPC
  const budgetResult = await deps.reserveBudget({
    userId,
    clientRequestId: req.clientRequestId,
    requestedCredits,
  });

  if (budgetResult.status === 'blocked') {
    return {
      ok: false,
      code: budgetResult.code,
      message: GUARDRAIL_MESSAGES[budgetResult.code] ?? budgetResult.message,
      retryable: false,
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
    };
  }

  // 13. Reconcile credits — confirm actual consumed (partial or full)
  // Conservative by construction: unverifiable spend confirms the full
  // reservation, and a recorded overrun confirms the recorded amount rather
  // than being clamped back down to what was reserved.
  const actualToConfirm = await resolveCreditsToConfirm(reservedBatchId);

  let reconciliationFailed = false;
  try {
    await deps.confirmBudget({
      reservationId,
      actualCreditsConsumed: actualToConfirm,
      batchId: reservedBatchId,
    });
  } catch {
    // Generation succeeded — do NOT convert to failure. Log warning internally.
    reconciliationFailed = true;
  }

  // 14. Success
  const hasNewCandidates = (pipelineResult.candidatesCreated ?? 0) > 0;
  const noveltyExhausted = pipelineResult.metadata?.novelty_exhausted === true;
  const targetPersistibleCandidates = pipelineResult.targetPersistibleCandidates ?? 10;
  const targetReached = pipelineResult.targetReached === true;
  const executionStatus = hasNewCandidates
    ? (targetReached ? 'success_target_reached' : 'success_partial')
    : 'no_new_candidates';
  return {
    ok: true,
    status: executionStatus,
    batchId: reservedBatchId,
    batchStatus: hasNewCandidates ? 'ready_for_review' : 'nothing_to_write',
    candidateCount: pipelineResult.candidatesCreated,
    redirectPath: `/prospect-batches/${reservedBatchId}`,
    targetPersistibleCandidates,
    targetReached,
    ...(reconciliationFailed ? { reconciliationWarning: 'BUDGET_RECONCILIATION_FAILED' as const } : {}),
    // A1-APOLLO-BUDGET-RECONCILIATION-1: an overrun must be visible, not just
    // absorbed. The generation still succeeded — the candidates exist and the
    // credits were really spent — so this reports; it never fails the run.
    ...buildReconciliationOutcome(lastReconciliation),
    ...(noveltyExhausted ? { noveltyExhausted: true as const } : {}),
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
): {
  reconciliationState?: 'confirmed' | 'pending_reconciliation' | 'billing_unknown';
  budgetAnomalies?: readonly string[];
} {
  if (!reconciliation) return {};

  const state = reconciliation.anomalies.includes('recorded_usage_exceeds_reservation')
    ? 'pending_reconciliation'
    : reconciliation.billingState === 'unknown'
      ? 'billing_unknown'
      : 'confirmed';

  return {
    reconciliationState: state,
    ...(reconciliation.anomalies.length > 0 ? { budgetAnomalies: reconciliation.anomalies } : {}),
  };
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
