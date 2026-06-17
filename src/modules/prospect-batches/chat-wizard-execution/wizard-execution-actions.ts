'use server';

import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { resolveWizardCatalog } from './wizard-catalog-resolver';
import { wizardExecutionRequestSchema } from './wizard-execution-schema';
import { WIZARD_SYSTEM_CONTROLS } from './wizard-pipeline-adapter';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { WizardExecutionActionResult, ResolvedWizardExecution } from './wizard-execution-types';
import { reserveWizardExecutionSlot } from './wizard-idempotency';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult, IdempotencyDbClient } from './wizard-idempotency';
import { isTavilyConfiguredForWizard } from './wizard-availability';
import { runWizardTavilySearch } from './wizard-tavily-executor';
import type { WizardTavilyRunner, WizardTavilyInput } from './wizard-tavily-executor';
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
  // Existing
  reserveSlot: (input: WizardExecutionReservationInput) => Promise<WizardExecutionReservationResult>;
  runTavilyPipeline: WizardTavilyRunner;
  markBatchFailed: (batchId: string, reason: 'batchid_mismatch' | 'pipeline_error') => Promise<void>;
};

function isExecutionEnabled(): boolean {
  return process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION === 'true';
}

// ── Public server action ──────────────────────────────────────────────────────
// Thin entrypoint for Next.js. Builds real deps from server context, delegates
// to executeProspectWizardGeneration for the actual logic.

const BOGOTA_TIMEZONE = 'America/Bogota';

export async function executeProspectWizardGenerationAction(
  request: unknown,
): Promise<WizardExecutionActionResult> {
  const supabase = await createClient();

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => {
      const auth = await requireActiveUser();
      return auth.internalUserId;
    },
    resolveCatalog: (input) => resolveWizardCatalog(input, supabase),
    checkTavilyAvailability: isTavilyConfiguredForWizard,

    reserveBudget: async ({ userId, clientRequestId, requestedCredits }) => {
      const periodStart = getPilotBudgetPeriodStart(BOGOTA_TIMEZONE);
      const rpcResult = await reserveWizardPilotCredits(
        { userId, clientRequestId, requestedCredits, periodStart },
        supabase as unknown as BudgetReservationsRpcClient,
      );
      if (rpcResult.status === 'blocked') return rpcResult;

      // Both 'reserved' and 'already_reserved' need the reservation ID for later reconciliation.
      const record = await fetchWizardReservationRecord(
        userId,
        clientRequestId,
        supabase as unknown as ReservationLookupClient,
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
      confirmWizardPilotCredits(input, supabase as unknown as BudgetReservationsRpcClient),

    releaseBudget: (input) =>
      releaseWizardPilotCredits(input, supabase as unknown as BudgetReservationsRpcClient),

    readConsumedCredits: (batchId) =>
      readWizardConsumedCreditsFromDb(batchId, supabase as unknown as ConsumedCreditsDbClient),

    reserveSlot: (input) =>
      reserveWizardExecutionSlot(input, supabase as unknown as IdempotencyDbClient),

    runTavilyPipeline: (tavilyInput: WizardTavilyInput) => runWizardTavilySearch(tavilyInput),

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

export async function executeProspectWizardGeneration(
  request: unknown,
  deps: WizardExecutionDeps,
): Promise<WizardExecutionActionResult> {
  // 1. Feature flag — hard env gate; if off, zero guardrail or DB calls
  if (!isExecutionEnabled()) {
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

  // 5. Tavily availability — checked before reservation so no budget or batch is created if unavailable
  const tavilyAvailable = await deps.checkTavilyAvailability();
  if (!tavilyAvailable) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'El proveedor de búsqueda Tavily no está disponible en este momento.',
      retryable: true,
    };
  }

  // 6. Calculate max credits server-side — client cannot control this value
  const requestedCredits = estimateWizardTavilyMaxCredits(); // = 10

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

  // 11. Execute Tavily pipeline using the reserved batchId as anchor
  const reservedBatchId = reservation.batchId;
  let pipelineResult: IncrementalSearchOutput;
  try {
    pipelineResult = await deps.runTavilyPipeline({ resolved, reservedBatchId });
  } catch {
    // Reconcile conservatively — Tavily may have partially executed
    const consumed = await deps.readConsumedCredits(reservedBatchId).catch(() => null);
    const toConfirm = (consumed !== null && consumed > 0) ? consumed : creditsReserved;
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
    const consumed = await deps.readConsumedCredits(reservedBatchId).catch(() => null);
    const toConfirm = (consumed !== null && consumed > 0) ? consumed : creditsReserved;
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
  const consumedCredits = await deps.readConsumedCredits(reservedBatchId).catch(() => null);
  // Conservative: if 0 or null, confirm full reserved amount (logging may have failed)
  const actualToConfirm = (consumedCredits !== null && consumedCredits > 0) ? consumedCredits : creditsReserved;

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
  return {
    ok: true,
    status: 'created',
    batchId: reservedBatchId,
    batchStatus: 'ready_for_review',
    candidateCount: pipelineResult.candidatesCreated,
    redirectPath: `/prospect-batches/${reservedBatchId}`,
    ...(reconciliationFailed ? { reconciliationWarning: 'BUDGET_RECONCILIATION_FAILED' as const } : {}),
  };
}

// ── Public message map ────────────────────────────────────────────────────────
// Maps pilot guardrail codes to user-facing Spanish messages.
// Internal: not exported from index.ts — only used within the action.

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
