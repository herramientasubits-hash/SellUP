import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  normalizeTaxIdentifierByCountry,
  type TaxIdentifierLookupMetadata,
  type TaxIdentifierSelectedCandidate,
} from '@/server/prospect-batches/tax-identifier-lookup';
import { claimGlobalIdentitiesForPersistedCandidates } from '@/server/prospect-batches/global-identity-claims-store';
import {
  APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS,
  markDuplicateChecksStale,
  resolveCandidateCountryCode,
  summarizeTaxIdentifierClaim,
  type TaxIdentifierClaimReport,
} from './approve-tax-identifier-core';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // AGENT1-AUDIT-WS1 — `approved_by` guarda el usuario INTERNO (antes el id de
    // auth) y sólo un usuario activo puede aprobar.
    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .maybeSingle();
    if (!internalUser?.id) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
    }

    const body = await request.json();
    const { candidateId, taxIdentifier, sourceUrl } = body;

    if (!candidateId || typeof candidateId !== 'string') {
      return NextResponse.json({ error: 'Falta candidateId válido' }, { status: 400 });
    }
    if (!taxIdentifier || typeof taxIdentifier !== 'string') {
      return NextResponse.json({ error: 'Falta taxIdentifier válido' }, { status: 400 });
    }

    // 1. Cargar candidato
    const { data: candidate, error: fetchError } = await supabase
      .from('prospect_candidates')
      .select('*')
      .eq('id', candidateId)
      .single();

    if (fetchError || !candidate) {
      return NextResponse.json({ error: 'Candidato no encontrado' }, { status: 404 });
    }

    // AGENT1-AUDIT-WS1 — sólo en revisión: un candidato aprobado, convertido o
    // descartado no cambia de identidad fiscal por esta puerta.
    if (candidate.status !== APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS) {
      return NextResponse.json(
        { error: 'Sólo se puede elegir el identificador fiscal de una empresa en revisión' },
        { status: 409 },
      );
    }

    // AGENT1-AUDIT-WS1 — el país es el del candidato. Antes caía a 'CO' sin país,
    // y un identificador de otro país se normalizaba y tipaba como NIT colombiano.
    const countryCode = resolveCandidateCountryCode(candidate.country_code);
    if (!countryCode) {
      return NextResponse.json(
        { error: 'La empresa no tiene país: no se puede validar su identificador fiscal' },
        { status: 422 },
      );
    }

    const metadata = (candidate.metadata ?? {}) as Record<string, unknown>;
    const lookupMetadata = metadata.tax_identifier_lookup as TaxIdentifierLookupMetadata | undefined;

    if (!lookupMetadata || !Array.isArray(lookupMetadata.candidates)) {
      return NextResponse.json(
        { error: 'No se encontraron búsquedas de identificador fiscal para este candidato' },
        { status: 400 }
      );
    }

    // Normalizar el NIT del input para comparar
    const normalizedInput = normalizeTaxIdentifierByCountry(taxIdentifier, countryCode);

    // Buscar coincidencia en los candidatos de la metadata
    const matchedCandidate = lookupMetadata.candidates.find(
      (c) =>
        c.normalized_tax_identifier === normalizedInput ||
        c.tax_identifier === taxIdentifier ||
        normalizeTaxIdentifierByCountry(c.tax_identifier, countryCode) === normalizedInput
    );

    if (!matchedCandidate) {
      return NextResponse.json(
        { error: 'El NIT solicitado no se encuentra entre los candidatos de la búsqueda oficial' },
        { status: 400 }
      );
    }

    const approvedAt = new Date().toISOString();
    const previousTaxIdentifier = (candidate.tax_identifier as string | null) ?? null;
    const newTaxIdentifier = matchedCandidate.normalized_tax_identifier;
    const taxIdentifierChanged = previousTaxIdentifier !== newTaxIdentifier;

    // 2. Construir selected_candidate
    const selectedCandidate: TaxIdentifierSelectedCandidate = {
      tax_identifier: matchedCandidate.tax_identifier,
      normalized_tax_identifier: matchedCandidate.normalized_tax_identifier,
      legal_name: matchedCandidate.legal_name,
      source_name: matchedCandidate.source_name,
      source_type: matchedCandidate.source_type,
      source_url: matchedCandidate.source_url ?? sourceUrl ?? null,
      evidence_text: matchedCandidate.evidence_text,
      confidence: matchedCandidate.confidence,
      approved_at: approvedAt,
      approved_by: internalUser.id,
      approval_method: 'human_review',
      previous_tax_identifier: previousTaxIdentifier,
    };

    // Actualizar metadata.tax_identifier_lookup
    const updatedLookup: TaxIdentifierLookupMetadata = {
      ...lookupMetadata,
      status: 'completed',
      selected_candidate: selectedCandidate,
    };

    // AGENT1-AUDIT-WS1 — la comprobación de duplicados guardada se hizo con el
    // identificador VIEJO: si cambia, queda marcada como desactualizada.
    const baseMetadata = taxIdentifierChanged
      ? markDuplicateChecksStale(metadata, { markedAt: approvedAt, previousTaxIdentifier, newTaxIdentifier })
      : metadata;
    const updatedMetadata = {
      ...baseMetadata,
      tax_identifier_lookup: updatedLookup,
    };

    const updatePayload: Record<string, unknown> = {
      tax_identifier: newTaxIdentifier,
      metadata: updatedMetadata,
      updated_at: approvedAt,
    };

    // Si es Colombia y no tiene tipo, asignar NIT
    if (countryCode === 'CO' && !candidate.tax_identifier_type) {
      updatePayload.tax_identifier_type = 'NIT';
    }

    // Vallado por el estado leído: si entre medias el candidato salió de revisión,
    // no se escribe nada.
    const { data: updatedCandidate, error: updateError } = await supabase
      .from('prospect_candidates')
      .update(updatePayload)
      .eq('id', candidateId)
      .eq('status', APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS)
      .select('*')
      .maybeSingle();

    if (updateError) {
      console.error('[approve-tax-identifier] Error al actualizar base de datos:', updateError);
      return NextResponse.json({ error: 'Error al actualizar el candidato' }, { status: 500 });
    }
    if (!updatedCandidate) {
      return NextResponse.json(
        { error: 'La empresa dejó de estar en revisión; no se cambió su identificador fiscal' },
        { status: 409 },
      );
    }

    // AGENT1-AUDIT-WS1 — la identidad fiscal NUEVA se reclama como cualquier otra
    // («una empresa, un vendedor», migración 140). Si ya la tiene otro candidato
    // vivo, la función SQL deja éste como `duplicate`. Degrada cerrado: un fallo
    // de infraestructura no marca a nadie.
    const claim = await claimNewTaxIdentity(candidateId, updatedCandidate.batch_id as string | null, taxIdentifierChanged);
    let finalCandidate = updatedCandidate;
    if (claim.status === 'claimed_elsewhere') {
      const { data: reread } = await supabase.from('prospect_candidates').select('*').eq('id', candidateId).maybeSingle();
      if (reread) finalCandidate = reread;
    }

    return NextResponse.json({
      success: true,
      candidate: finalCandidate,
      globalIdentityClaim: claim,
      message:
        claim.status === 'claimed_elsewhere'
          ? 'Identificador fiscal guardado: esa empresa ya la tiene otro vendedor, así que quedó como duplicada'
          : 'Identificador fiscal aprobado con éxito',
    });
  } catch (err) {
    console.error('[approve-tax-identifier] Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

async function claimNewTaxIdentity(
  candidateId: string,
  batchId: string | null,
  taxIdentifierChanged: boolean,
): Promise<TaxIdentifierClaimReport> {
  // Sin cambio de identificador no hay señal nueva que reclamar.
  if (!taxIdentifierChanged) return { status: 'skipped', reason: 'unchanged' };
  if (!batchId) return { status: 'skipped', reason: 'no_batch' };
  let admin;
  try {
    // La tabla de reclamos sólo tiene política para service_role.
    admin = createSupabaseAdminClient();
  } catch (error) {
    console.error('[approve-tax-identifier] Cliente de servicio no disponible para el reclamo:', error);
    return { status: 'skipped', reason: 'service_unavailable' };
  }
  // AUDIT-HARDENING-1 — la fila ya tiene reclamos propios (dominio, entidad de
  // proveedor…): reenviarlos con la 140 chocaría contra sí misma y la dejaría
  // `duplicate`. Sólo se reclama lo que aún no tiene (el NIT nuevo).
  const outcome = await claimGlobalIdentitiesForPersistedCandidates(admin, batchId, [candidateId], {
    excludeClaimsAlreadyHeld: true,
  });
  return summarizeTaxIdentifierClaim(candidateId, outcome);
}
