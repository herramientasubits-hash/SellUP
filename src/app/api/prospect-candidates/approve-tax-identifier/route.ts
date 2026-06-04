import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  normalizeTaxIdentifierByCountry,
  type TaxIdentifierLookupMetadata,
  type TaxIdentifierSelectedCandidate,
} from '@/server/prospect-batches/tax-identifier-lookup';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await request.json();
    const { candidateId, taxIdentifier, sourceName, sourceUrl } = body;

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

    const countryCode = candidate.country_code ?? 'CO';
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
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      approval_method: 'human_review',
      previous_tax_identifier: candidate.tax_identifier ?? null,
    };

    // Actualizar metadata.tax_identifier_lookup
    const updatedLookup: TaxIdentifierLookupMetadata = {
      ...lookupMetadata,
      status: 'completed',
      selected_candidate: selectedCandidate,
    };

    const updatedMetadata = {
      ...metadata,
      tax_identifier_lookup: updatedLookup,
    };

    const updatePayload: Record<string, unknown> = {
      tax_identifier: matchedCandidate.normalized_tax_identifier,
      metadata: updatedMetadata,
      updated_at: new Date().toISOString(),
    };

    // Si es Colombia y no tiene tipo, asignar NIT
    if (countryCode === 'CO' && !candidate.tax_identifier_type) {
      updatePayload.tax_identifier_type = 'NIT';
    }

    const { data: updatedCandidate, error: updateError } = await supabase
      .from('prospect_candidates')
      .update(updatePayload)
      .eq('id', candidateId)
      .select('*')
      .single();

    if (updateError || !updatedCandidate) {
      console.error('[approve-tax-identifier] Error al actualizar base de datos:', updateError);
      return NextResponse.json({ error: 'Error al actualizar el candidato' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      candidate: updatedCandidate,
      message: 'Identificador fiscal aprobado con éxito',
    });
  } catch (err) {
    console.error('[approve-tax-identifier] Error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
