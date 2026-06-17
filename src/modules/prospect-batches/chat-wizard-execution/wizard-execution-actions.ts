'use server';

import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { resolveWizardCatalog } from './wizard-catalog-resolver';
import { wizardExecutionRequestSchema } from './wizard-execution-schema';
import { adaptResolvedWizardToGenerationInput, WIZARD_SYSTEM_CONTROLS } from './wizard-pipeline-adapter';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { WizardExecutionActionResult, ResolvedWizardExecution } from './wizard-execution-types';

function isExecutionEnabled(): boolean {
  return process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION === 'true';
}

export async function executeProspectWizardGenerationAction(
  request: unknown,
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

  // 2. Auth
  let userId: string;
  try {
    const auth = await requireActiveUser();
    userId = auth.internalUserId;
  } catch {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Debes iniciar sesión para generar prospectos.',
      retryable: false,
    };
  }

  // 3. Validate request
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

  // 4. Resolve catalog server-side (re-validates all IDs and names canonically)
  let catalogResolution: Awaited<ReturnType<typeof resolveWizardCatalog>>;
  try {
    const supabase = await createClient();
    catalogResolution = await resolveWizardCatalog(
      {
        countryCode: req.countryCode,
        industryId: req.industryId,
        subindustryIds: req.subindustryIds,
        catalogVersion: req.catalogVersion,
      },
      supabase,
    );
  } catch {
    return {
      ok: false,
      code: 'CATALOG_CHANGED',
      message: 'El catálogo ha cambiado. Por favor, vuelve a configurar la búsqueda.',
      retryable: false,
    };
  }

  // 5. Resolve country name from LATAM_COUNTRIES
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === req.countryCode);
  const countryName = countryEntry?.name ?? req.countryCode;

  // 6. Build ResolvedWizardExecution (server-controlled — nothing from client except
  //    countryCode, industryId, subindustryIds, criteria, catalogVersion, clientRequestId)
  const resolved: ResolvedWizardExecution = {
    userId,
    clientRequestId: req.clientRequestId,
    mode: 'exploratory',
    country: {
      code: req.countryCode,
      name: countryName,
    },
    catalog: {
      version: catalogResolution.catalog.version,
    },
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

  // 7. Adapt to pipeline input
  const { generationInput, wizardContext } = adaptResolvedWizardToGenerationInput(resolved);

  // 8. Idempotency check (sequential protection only — no concurrent guarantee)
  // A unique constraint on (created_by, metadata->>'client_request_id') is required
  // for atomic concurrent protection. That migration is pending (next hito: 16AB.44).
  // Without it, we CANNOT safely call the real pipeline.
  // This hito is BLOCKED for real pipeline execution.
  //
  // When the migration is available, replace this block with:
  //   const idempotencyResult = await checkAndReserveIdempotencySlot(userId, req.clientRequestId);
  //   if (idempotencyResult.existing) return { ok: true, status: 'already_started', ... };
  //   const result = await generateAIProspectBatch(generationInput);
  //   return { ok: true, status: 'created', ... };

  void generationInput;
  void wizardContext;

  return {
    ok: false,
    code: 'EXECUTION_DISABLED',
    message: 'La ejecución real está pendiente de una migración de idempotencia. Próximo hito: 16AB.44.',
    retryable: false,
  };
}
