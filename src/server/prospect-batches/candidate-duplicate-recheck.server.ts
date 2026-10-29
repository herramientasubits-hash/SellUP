// FEEDBACK 29-10 — vuelve a correr la revisión de duplicados (SellUp + HubSpot, de sólo
// lectura) sobre UNA candidata que ya existe y guarda lo que encuentre. La usan:
//   - el rescate desde Descartadas, que devolvía la fila a revisión sin revisarla
//     (Casa Brugal quedó «sin verificar» y no se podía aprobar);
//   - el botón «Verificar ahora» de la ficha, para las que quedaron sin verificar
//     porque HubSpot falló en su momento o porque su búsqueda no lo consultó.
// Si SellUp o HubSpot no responden, NO escribe nada: no se afirma lo que no se sabe.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  detectCandidateDuplicates,
  type CandidateDuplicateResult,
} from '@/server/prospect-batches/duplicate-detection';
import {
  decideDuplicateRecheck,
  DUPLICATE_RECHECK_MESSAGES,
  type DuplicateRecheckOutcome,
} from '@/modules/prospect-batches/duplicate-recheck';

export type CandidateDuplicateRecheckResult =
  | { ok: true; outcome: Extract<DuplicateRecheckOutcome, { kind: 'write' }>; message: string }
  | { ok: false; reason: 'not_found' | 'unknown' | 'write_failed'; message: string };

interface CandidateRow {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  country_code: string | null;
  tax_identifier: string | null;
  normalized_name: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * `metadata.duplicate_check` con lo que la revisión encontró, en el formato que ya lee
 * la ficha (fuentes consultadas + coincidencias por fuente).
 */
export function buildRecheckDuplicateMetadata(
  result: CandidateDuplicateResult,
  summary: string,
): Record<string, unknown> {
  const su = result.sellup_duplicate_check;
  const hs = result.hubspot_duplicate_check;
  const hubspotRead = hs.status !== 'not_configured' && hs.status !== 'error';
  const matches: Array<Record<string, unknown>> = [];
  if (su.status === 'duplicate' || su.status === 'possible_duplicate') {
    matches.push({
      source: 'sellup',
      status: su.status,
      confidence: su.confidence,
      matched_name: su.matched_name,
      matched_domain: su.matched_domain,
      matched_website: su.matched_website,
      matched_id: su.matched_account_id ?? su.matched_candidate_id,
      reason: su.matched_by,
    });
  }
  if (hs.status === 'match' || hs.status === 'possible_match') {
    matches.push({
      source: 'hubspot',
      status: hs.status,
      confidence: hs.confidence,
      matched_name: hs.matched_company_name,
      matched_domain: hs.matched_domain,
      matched_website: hs.matched_website,
      matched_id: hs.matched_company_id,
      reason: hs.matched_by,
    });
  }
  return {
    summary,
    sources_checked: hubspotRead ? ['sellup', 'hubspot'] : ['sellup'],
    matches,
    rechecked_at: new Date().toISOString(),
  };
}

export async function recheckCandidateDuplicates(
  supabase: SupabaseClient,
  candidateId: string,
  detect: typeof detectCandidateDuplicates = detectCandidateDuplicates,
): Promise<CandidateDuplicateRecheckResult> {
  const { data, error } = await supabase
    .from('prospect_candidates')
    .select('id, name, website, domain, country_code, tax_identifier, normalized_name, metadata')
    .eq('id', candidateId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, reason: 'not_found', message: 'El prospecto ya no está disponible. Actualiza la lista.' };
  }
  const candidate = data as CandidateRow;
  const meta = (candidate.metadata ?? {}) as Record<string, unknown>;
  const importMeta = (meta.import ?? {}) as Record<string, unknown>;
  const linkedinUrl =
    (typeof meta.linkedin_url === 'string' ? meta.linkedin_url : null) ??
    (typeof importMeta.linkedin_url === 'string' ? importMeta.linkedin_url : null);

  const result = await detect({
    supabase,
    candidate: {
      id: candidate.id,
      name: candidate.name,
      website: candidate.website,
      domain: candidate.domain,
      country_code: candidate.country_code,
      tax_identifier: candidate.tax_identifier,
      normalized_name: candidate.normalized_name,
      linkedin_url: linkedinUrl,
    },
    includeHubSpot: true,
  });

  const outcome = decideDuplicateRecheck(result);
  if (outcome.kind === 'unknown') {
    return { ok: false, reason: 'unknown', message: DUPLICATE_RECHECK_MESSAGES.unknown };
  }

  const message = DUPLICATE_RECHECK_MESSAGES[outcome.duplicateStatus];
  const { error: updateError } = await supabase
    .from('prospect_candidates')
    .update({
      duplicate_status: outcome.duplicateStatus,
      matched_account_id: outcome.matchedAccountId,
      matched_hubspot_company_id: outcome.matchedHubSpotCompanyId,
      confidence_score: outcome.confidenceScore,
      metadata: { ...meta, duplicate_check: buildRecheckDuplicateMetadata(result, message) },
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId);
  if (updateError) {
    console.error('[recheckCandidateDuplicates] update falló:', updateError.message);
    return { ok: false, reason: 'write_failed', message: 'No se pudo guardar la verificación. Intenta de nuevo.' };
  }
  return { ok: true, outcome, message };
}
