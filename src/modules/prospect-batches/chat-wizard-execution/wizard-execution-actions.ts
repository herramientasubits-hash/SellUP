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

// ── Dependency injection boundary ─────────────────────────────────────────────
// All I/O dependencies are injected here. The public server action provides real
// implementations; tests inject lightweight fakes without Supabase or Tavily.

export type WizardExecutionDeps = {
  getActiveUserId: () => Promise<string>;
  resolveCatalog: (input: CatalogResolutionInput) => Promise<CatalogResolutionOutput>;
  checkTavilyAvailability: () => Promise<boolean>;
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
//   1. Feature flag
//   2. Auth (server session only — userId never accepted from client)
//   3. Schema validation
//   4. Catalog resolution
//   5. Tavily availability (before reserving — zero batches created if unavailable)
//   6. Durable reservation
//   7. Idempotency guard (already_reserved → already_started, no pipeline)
//   8. Tavily pipeline via reserved batchId
//   9. batchId consistency check
//  10. Success result

export async function executeProspectWizardGeneration(
  request: unknown,
  deps: WizardExecutionDeps,
): Promise<WizardExecutionActionResult> {
  // 1. Feature flag
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

  // 3. Validate request schema
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

  // 5. Tavily availability — checked before reservation so no batch is created if unavailable
  const tavilyAvailable = await deps.checkTavilyAvailability();
  if (!tavilyAvailable) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'El proveedor de búsqueda Tavily no está disponible en este momento.',
      retryable: true,
    };
  }

  // 6. Build resolved execution context (server-controlled — no client-supplied labels)
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

  // 7. Reserve durable execution slot (idempotency anchor).
  // Subindustries and additionalCriteria are stored in metadata here for traceability.
  // They are not yet consumed by Tavily query builders — planned for a future hito.
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
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'No se pudo reservar la ejecución. Por favor, intenta nuevamente.',
      retryable: true,
    };
  }

  // 8. Idempotency guard — already reserved means a prior request owns this execution
  if (reservation.status === 'already_reserved') {
    return {
      ok: true,
      status: 'already_started',
      batchId: reservation.batchId,
      batchStatus: 'draft',
      redirectPath: `/prospect-batches/${reservation.batchId}`,
    };
  }

  // 9. Execute Tavily pipeline using the reserved batchId as anchor
  const reservedBatchId = reservation.batchId;
  let pipelineResult: IncrementalSearchOutput;
  try {
    pipelineResult = await deps.runTavilyPipeline({ resolved, reservedBatchId });
  } catch {
    // Mark reserved batch as failed; catch secondary failure to preserve original error
    await deps.markBatchFailed(reservedBatchId, 'pipeline_error').catch(() => {
      // Residual risk: if this also fails, batch stays in 'draft'. Requires manual cleanup.
    });
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'El pipeline de búsqueda falló durante la ejecución.',
      retryable: false,
    };
  }

  // 10. Verify batchId consistency — pipeline must return the exact same batchId we reserved
  if (pipelineResult.batchId !== reservedBatchId) {
    await deps.markBatchFailed(reservedBatchId, 'batchid_mismatch').catch(() => {
      // Same residual risk as step 9
    });
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'Se detectó una inconsistencia interna en el ID del lote generado.',
      retryable: false,
    };
  }

  // 11. Success
  return {
    ok: true,
    status: 'created',
    batchId: reservedBatchId,
    batchStatus: 'ready_for_review',
    candidateCount: pipelineResult.candidatesCreated,
    redirectPath: `/prospect-batches/${reservedBatchId}`,
  };
}
