'use server';

/**
 * DENUE Batches — Server Actions — Hito 16AF.2
 *
 * REGLAS CRÍTICAS:
 *   Máximo 5 candidatos. Solo dataset inegi_denue_pilot.
 *   No HubSpot writes. No HubSpot calls (runHubSpotCheck=false).
 *   No IA, no Tavily, no Apollo, no Lusha, no Google CSE.
 *   No aprobación. No asignación. No conversión. No sync.
 *   No imprime secretos, tokens ni raw payload completo.
 *   Usa Vault via SourceConnectionResolver.
 *   No toca candidate-writer.ts ni prospecting-pipeline.ts.
 */

import { createClient } from '@/lib/supabase/server';
import { resolveSourceCredential } from '@/server/source-catalog/source-connection-resolver';
import {
  runDenueCandidateDryRun,
  mapDenueSampleToStructuredCandidate,
} from '@/server/source-catalog/connectors/denue-mexico';
import { writeStructuredSourceCandidatesPreview } from '@/server/source-catalog/connectors/socrata-colombia/structured-source-candidate-writer';

// ── Constantes ────────────────────────────────────────────────

const DENUE_PREVIEW_LIMIT = 5;
const RATE_LIMIT_MS = 5 * 60 * 1000;

// ── Auth ──────────────────────────────────────────────────────

async function requireAdminForDenueAction(): Promise<{
  internalUserId: string | null;
  errorMessage: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { internalUserId: null, errorMessage: 'No autenticado' };

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser)
    return { internalUserId: null, errorMessage: 'Usuario no autorizado' };

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();

  if (role?.key !== 'admin') {
    return {
      internalUserId: null,
      errorMessage: 'Acceso restringido: se requiere rol admin para crear lotes DENUE.',
    };
  }

  return { internalUserId: internalUser.id, errorMessage: null };
}

// ── Tipos de resultado ────────────────────────────────────────

export type DenuePreviewBatchResult = {
  ok: boolean;
  batchId: string | null;
  batchName: string | null;
  candidatesWritten: number;
  candidatesSkipped: number;
  message: string;
  warnings: string[];
  error?: string;
};

// ── Action pública ────────────────────────────────────────────

export async function createDenuePreviewBatchAction(): Promise<DenuePreviewBatchResult> {
  // 1. Auth admin
  const { internalUserId, errorMessage } = await requireAdminForDenueAction();
  if (!internalUserId) {
    return {
      ok: false,
      batchId: null,
      batchName: null,
      candidatesWritten: 0,
      candidatesSkipped: 0,
      message: errorMessage ?? 'No autorizado',
      warnings: [],
    };
  }

  const supabase = await createClient();

  // 2. Rate limit — máximo 1 lote denue_mexico por usuario en 5 minutos
  const windowStart = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data: recentBatches } = await supabase
    .from('prospect_batches')
    .select('id')
    .eq('source', 'denue_mexico')
    .eq('created_by', internalUserId)
    .gte('created_at', windowStart)
    .limit(1);

  if (recentBatches && recentBatches.length > 0) {
    return {
      ok: false,
      batchId: null,
      batchName: null,
      candidatesWritten: 0,
      candidatesSkipped: 0,
      message: 'Ya creaste un lote DENUE recientemente. Espera unos 5 minutos antes de crear otro.',
      warnings: [],
    };
  }

  try {
    // 3. Resolver credencial DENUE desde Vault
    const credential = await resolveSourceCredential('denue_mexico');

    if (!credential) {
      return {
        ok: false,
        batchId: null,
        batchName: null,
        candidatesWritten: 0,
        candidatesSkipped: 0,
        message: 'La fuente DENUE no requiere credencial o no está configurada. Verifica la configuración.',
        warnings: [],
      };
    }

    // 4. Dry-run DENUE usando token resuelto (no se persiste nada aquí)
    const dryRunReport = await runDenueCandidateDryRun({
      resolvedToken: credential.token,
    });

    const warnings: string[] = [...dryRunReport.warnings];

    // 5. Filtrar solo candidatos 'accepted'
    const acceptedItems = dryRunReport.items.filter(
      (item) => item.qualityDecision === 'accepted',
    );

    if (acceptedItems.length === 0) {
      return {
        ok: false,
        batchId: null,
        batchName: null,
        candidatesWritten: 0,
        candidatesSkipped: dryRunReport.summary.normalizedCount,
        message: `Dry-run completado pero sin candidatos aceptados. Revisados: ${dryRunReport.summary.normalizedCount}, filtrados: ${dryRunReport.summary.filteredOutCount}. Revisa los logs del servidor.`,
        warnings,
      };
    }

    // 6. Limitar a máximo 5 candidatos
    const limitedItems = acceptedItems.slice(0, DENUE_PREVIEW_LIMIT);
    const skippedCount = acceptedItems.length - limitedItems.length;
    if (skippedCount > 0) {
      warnings.push(`Se limitó a ${DENUE_PREVIEW_LIMIT} candidatos (${skippedCount} aceptados omitidos por límite de preview).`);
    }

    // 7. Mapear items del dry-run a StructuredSourceCandidateDraft
    //    Reconstruye NormalizedMexicoCompanySample desde los campos del dry-run item
    const candidateDrafts = limitedItems.map((item) => {
      return mapDenueSampleToStructuredCandidate({
        source: item.source,
        sourceKey: item.sourceKey,
        datasetId: item.datasetId ?? 'inegi_denue_pilot',
        companyName: item.name ?? '',
        legalName: item.name ?? '',
        taxId: item.taxId,
        website: null,
        city: item.city,
        department: item.department,
        address: null,
        sectorCode: item.sectorCode,
        sectorDescription: item.activity,
        legalStatus: item.legalStatus,
        perOcuRaw: item.perOcuRaw,
        email: null,
        phone: null,
        rawRecordId: item.sourceTrace.sourceRecordId,
        sourceMetadata: {},
      });
    });

    // 8. Escribir batch + candidatos con dryRun=false, sin HubSpot
    const report = await writeStructuredSourceCandidatesPreview(supabase, {
      dryRun: false,
      requestedByUserId: internalUserId,
      ownerId: null,
      country: 'México',
      countryCode: 'MX',
      sourceKey: 'mx_denue',
      sourceProvider: 'denue_mexico',
      dataset: 'inegi_denue_pilot',
      candidates: candidateDrafts,
      runHubSpotCheck: false,
      limit: DENUE_PREVIEW_LIMIT,
      uiSmokeTest: true,
    });

    if (!report.batch.id) {
      const batchStatus = report.batch.status;

      if (batchStatus === 'nothing_to_write') {
        return {
          ok: false,
          batchId: null,
          batchName: null,
          candidatesWritten: 0,
          candidatesSkipped: report.batch.totalCandidatesPrepared,
          message: 'Todos los candidatos DENUE ya existen en el sistema (verificador de novedad). Revisa los logs del servidor.',
          warnings,
        };
      }

      return {
        ok: false,
        batchId: null,
        batchName: null,
        candidatesWritten: 0,
        candidatesSkipped: report.batch.totalCandidatesPrepared,
        message: 'El lote DENUE no pudo crearse en base de datos. Revisa los logs del servidor.',
        warnings,
        error: batchStatus,
      };
    }

    const batchName = `denue_mexico · INEGI_DENUE_PILOT · ${new Date().toISOString().slice(0, 10)}`;

    return {
      ok: true,
      batchId: report.batch.id,
      batchName,
      candidatesWritten: report.batch.totalCandidatesWritten,
      candidatesSkipped: report.batch.totalCandidatesSkipped,
      message: `Lote preview DENUE creado con ${report.batch.totalCandidatesWritten} candidato(s) en modo preview. No aprobados, no convertidos, no sincronizados con HubSpot.`,
      warnings,
    };
  } catch (err: unknown) {
    const safe =
      err instanceof Error ? err.message.slice(0, 300) : 'Error interno del servidor';
    return {
      ok: false,
      batchId: null,
      batchName: null,
      candidatesWritten: 0,
      candidatesSkipped: 0,
      message: 'Error al crear el lote DENUE. Revisa los logs del servidor.',
      warnings: [],
      error: safe,
    };
  }
}
