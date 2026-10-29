'use server';

// FEEDBACK 29-10 — «Verificar ahora» en la ficha del prospecto. Una candidata que quedó
// «sin verificar» (HubSpot falló, su búsqueda no lo consultó o volvió de Descartadas sin
// revisar) se quedaba bloqueada para siempre: no había cómo volver a mirar. Esta acción
// corre la misma revisión de duplicados (SellUp + HubSpot, de sólo lectura) y guarda lo
// que encuentre. No decide nada: sólo deja el veredicto real para que alguien decida.

import { revalidatePath } from 'next/cache';
import { canReviewCandidateId } from '@/modules/access/capabilities.server';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logProspectCandidateAudit, requireActiveUser } from '@/modules/prospect-batches/actions';
import { recheckCandidateDuplicates } from '@/server/prospect-batches/candidate-duplicate-recheck.server';
import { canRecheckDuplicates } from './recheck-duplicates-eligibility';

export type RecheckDuplicatesActionResult =
  | {
      ok: true;
      duplicateStatus: string;
      matchedAccountId: string | null;
      matchedHubSpotCompanyId: string | null;
      message: string;
    }
  | { ok: false; message: string };

export async function recheckProspectDuplicatesAction(
  candidateId: string,
): Promise<RecheckDuplicatesActionResult> {
  try {
    if (typeof candidateId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidateId)) {
      return { ok: false, message: 'El prospecto ya no está disponible. Actualiza la lista.' };
    }
    // Admin, Growth o el dueño de la candidata: los mismos que pueden revisarla.
    if (!(await canReviewCandidateId(candidateId))) {
      return { ok: false, message: 'No tienes permisos para verificar este prospecto.' };
    }
    const { internalUserId } = await requireActiveUser();

    // Cliente de la sesión: si la persona no la ve (alcance comercial), no la verifica.
    const supabase = await createClient();
    const { data: current } = await supabase
      .from('prospect_candidates')
      .select('id, batch_id, status, duplicate_status')
      .eq('id', candidateId)
      .maybeSingle();
    if (!current) return { ok: false, message: 'El prospecto ya no está disponible. Actualiza la lista.' };
    if (!canRecheckDuplicates({ status: current.status, duplicateStatus: current.duplicate_status })) {
      return { ok: false, message: 'Este prospecto ya tiene su duplicidad verificada.' };
    }

    // Cliente administrativo para la revisión: con el de la sesión, la RLS esconde las
    // empresas de otros vendedores y un duplicado real saldría «sin coincidencia».
    const result = await recheckCandidateDuplicates(createSupabaseAdminClient(), candidateId);
    if (!result.ok) return { ok: false, message: result.message };

    await logProspectCandidateAudit({
      batchId: current.batch_id as string,
      candidateId,
      actorUserId: internalUserId,
      actionType: 'candidate_updated',
      details: {
        action: 'duplicate_rechecked',
        previous_duplicate_status: current.duplicate_status,
        new_duplicate_status: result.outcome.duplicateStatus,
        matched_account_id: result.outcome.matchedAccountId,
        matched_hubspot_company_id: result.outcome.matchedHubSpotCompanyId,
      },
    });

    revalidatePath('/accounts');
    revalidatePath(`/prospect-batches/${current.batch_id as string}`);
    return {
      ok: true,
      duplicateStatus: result.outcome.duplicateStatus,
      matchedAccountId: result.outcome.matchedAccountId,
      matchedHubSpotCompanyId: result.outcome.matchedHubSpotCompanyId,
      message: result.message,
    };
  } catch (err) {
    console.error('[recheckProspectDuplicatesAction] Unexpected error:', err);
    return { ok: false, message: 'No se pudo verificar. Intenta de nuevo en unos minutos.' };
  }
}
