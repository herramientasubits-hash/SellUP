'use server';

/**
 * Socrata Batches — Server Actions — Hito 16AB.11
 *
 * REGLAS CRÍTICAS:
 *   Máximo 3 candidatos. Solo dataset RUES.
 *   No HubSpot writes. No HubSpot calls (runHubSpotCheck=false).
 *   No IA, no Tavily, no Apollo, no Lusha, no Google CSE.
 *   No aprobación. No asignación. No sync.
 *   No imprime secretos, tokens ni raw payload completo.
 *   No toca candidate-writer.ts, prospecting-pipeline.ts ni query-builder.ts.
 */

import { createClient } from '@/lib/supabase/server';
import { runSocrataColombiaSample } from '@/server/source-catalog/connectors/socrata-colombia/run-socrata-colombia-sample';
import { mapSocrataSampleToStructuredCandidate } from '@/server/source-catalog/connectors/socrata-colombia/candidate-mapper';
import { writeStructuredSourceCandidatesPreview } from '@/server/source-catalog/connectors/socrata-colombia';

// ── Constantes ────────────────────────────────────────────────

const SOCRATA_RUES_LIMIT = 3;
const RATE_LIMIT_MS = 5 * 60 * 1000;

// ── Auth ──────────────────────────────────────────────────────

async function requireAdminForAction(): Promise<{
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

  // TODO: extender a 'manager' cuando el rol esté disponible en la tabla roles
  if (role?.key !== 'admin') {
    return {
      internalUserId: null,
      errorMessage:
        'Acceso restringido: se requiere rol admin para crear lotes Socrata.',
    };
  }

  return { internalUserId: internalUser.id, errorMessage: null };
}

// ── Action pública ────────────────────────────────────────────

export async function createSocrataRuesPreviewBatchAction(): Promise<{
  ok: boolean;
  batchId: string | null;
  message: string;
  error?: string;
}> {
  // 1. Auth — retorna respuesta estructurada, no usa redirect()
  const { internalUserId, errorMessage } = await requireAdminForAction();
  if (!internalUserId) {
    return { ok: false, batchId: null, message: errorMessage ?? 'No autorizado' };
  }
  // internalUserId es string a partir de aquí (narrowed por el guard anterior)

  const supabase = await createClient();

  // 2. Rate limit DB-based (Opción B)
  //    Verifica si el usuario ya creó un lote socrata_colombia en los últimos 5 minutos.
  const windowStart = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { data: recentBatches } = await supabase
    .from('prospect_batches')
    .select('id')
    .eq('source', 'socrata_colombia')
    .eq('created_by', internalUserId)
    .gte('created_at', windowStart)
    .limit(1);

  if (recentBatches && recentBatches.length > 0) {
    return {
      ok: false,
      batchId: null,
      message:
        'Ya creaste un lote Socrata recientemente. Espera unos 5 minutos antes de crear otro.',
    };
  }

  try {
    // 3. Muestra Socrata: solo RUES, máximo 3 registros
    const sampleReport = await runSocrataColombiaSample({
      datasets: ['rues'],
      limitPerDataset: SOCRATA_RUES_LIMIT,
    });

    const ruesResult = sampleReport.results['rues'];
    if (!ruesResult?.ok || !ruesResult.sample || ruesResult.sample.length === 0) {
      return {
        ok: false,
        batchId: null,
        message:
          'No se pudieron obtener muestras de Socrata RUES. Verifica la conexión.',
      };
    }

    // 4. Mapear a StructuredSourceCandidateDraft (máximo 3)
    const candidates = ruesResult.sample
      .slice(0, SOCRATA_RUES_LIMIT)
      .map(mapSocrataSampleToStructuredCandidate);

    if (candidates.length === 0) {
      return {
        ok: false,
        batchId: null,
        message: 'No se generaron candidatos válidos desde la muestra RUES.',
      };
    }

    // 5. Escribir con dryRun=false — sin HubSpot, sin IA, límite 3
    const report = await writeStructuredSourceCandidatesPreview(supabase, {
      dryRun: false,
      requestedByUserId: internalUserId,
      ownerId: null,
      country: 'Colombia',
      countryCode: 'CO',
      dataset: 'rues',
      candidates,
      runHubSpotCheck: false,
      limit: SOCRATA_RUES_LIMIT,
    });

    if (!report.batch.id) {
      return {
        ok: false,
        batchId: null,
        message:
          'El lote no pudo crearse en base de datos. Revisa los logs del servidor.',
      };
    }

    return {
      ok: true,
      batchId: report.batch.id,
      message: `Lote creado con ${report.batch.totalCandidatesWritten} candidato(s) en modo preview.`,
    };
  } catch (err: unknown) {
    // Sanitizar: no exponer stack trace ni payloads
    const safe =
      err instanceof Error ? err.message.slice(0, 200) : 'Error interno del servidor';
    return {
      ok: false,
      batchId: null,
      message: 'Error al crear el lote Socrata. Revisa los logs del servidor.',
      error: safe,
    };
  }
}
