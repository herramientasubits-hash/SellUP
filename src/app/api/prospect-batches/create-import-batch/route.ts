import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateImportedCandidatesBatch } from '@/modules/prospect-batches/actions';

interface ImportCandidate {
  company_name: string;
  country?: string;
  country_code?: string;
  website?: string;
  industry?: string;
  city?: string;
  region?: string;
  tax_identifier?: string;
  tax_identifier_type?: string;
  linkedin_url?: string;
  company_size?: string;
  description?: string;
  notes?: string;
  source_url?: string;
  contact_name?: string;
  contact_role?: string;
  contact_email?: string;
  owner_email?: string;
  source_evidence?: string;
  confidence?: string;
}

interface ImportBatchInput {
  import_type: 'paste' | 'csv' | 'xlsx';
  candidates: ImportCandidate[];
  recognized_columns: string[];
  unrecognized_columns: string[];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  warning_rows: number;
  defaults?: {
    country?: string;
    country_code?: string;
    industry?: string;
  };
}

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(website: string): string | null {
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { data: internalUser } = await supabase
      .from('internal_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('access_status', 'active')
      .single();

    if (!internalUser) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 });
    }

    const internalUserId = internalUser.id;
    const input = await request.json() as ImportBatchInput;

    const now = new Date();
    const dateLabel = now.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

    const countryCodes = [...new Set(input.candidates.map((c) => c.country_code).filter(Boolean))];
    const industries = [...new Set(input.candidates.map((c) => c.industry).filter(Boolean))];

    const batchCountryCode = countryCodes.length === 1
      ? (countryCodes[0] as string)
      : (countryCodes.length === 0 ? (input.defaults?.country_code ?? null) : null);
    const batchCountry = batchCountryCode
      ? (input.candidates.find((c) => c.country_code === batchCountryCode)?.country ?? input.defaults?.country ?? null)
      : null;
    const batchIndustry = industries.length === 1
      ? (industries[0] as string)
      : (industries.length === 0 ? (input.defaults?.industry ?? 'Importación externa') : 'Importación externa');

    const rowsUsingDefaultCountry = input.candidates.filter(
      (c) => !c.country_code && !c.country && !!input.defaults?.country_code
    ).length;
    const rowsUsingDefaultIndustry = input.candidates.filter(
      (c) => !c.industry && !!input.defaults?.industry
    ).length;

    const { data: batch, error: batchError } = await supabase
      .from('prospect_batches')
      .insert({
        name: `Importación externa · ${dateLabel}`,
        description: 'Candidatos cargados manualmente o desde archivo externo.',
        country: batchCountry,
        country_code: batchCountryCode,
        industry: batchIndustry,
        status: 'ready_for_review',
        source: 'external_import',
        owner_id: internalUserId,
        created_by: internalUserId,
        metadata: {
          import_type: input.import_type,
          imported_rows_count: input.total_rows,
          valid_rows_count: input.valid_rows,
          invalid_rows_count: input.invalid_rows,
          warning_rows_count: input.warning_rows,
          recognized_columns: input.recognized_columns,
          unrecognized_columns: input.unrecognized_columns,
          source_label: 'Importación externa',
          created_from_external_research: true,
          enrichment_auto_run: false,
          hubspot_sync_on_import: false,
          default_country: input.defaults?.country ?? null,
          default_country_code: input.defaults?.country_code ?? null,
          default_industry: input.defaults?.industry ?? null,
          defaults_applied: !!(input.defaults?.country_code || input.defaults?.industry),
          rows_using_default_country_count: rowsUsingDefaultCountry,
          rows_using_default_industry_count: rowsUsingDefaultIndustry,
        },
      })
      .select()
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: `Error al crear lote: ${batchError?.message}` }, { status: 500 });
    }

    await supabase.from('prospect_candidate_audit').insert({
      batch_id: batch.id,
      actor_user_id: internalUserId,
      action_type: 'batch_created',
      details: { name: batch.name, source: 'external_import', import_type: input.import_type },
    });

    let candidatesCreated = 0;

    for (const candidate of input.candidates) {
      const website = candidate.website?.trim() || null;
      const domain = website ? extractDomain(website) : null;
      const normalizedName = normalizeName(candidate.company_name);

      const notesArr: string[] = [];
      if (candidate.description) notesArr.push(`Descripción: ${candidate.description}`);
      if (candidate.notes) notesArr.push(candidate.notes);

      const { error: candidateError } = await supabase.from('prospect_candidates').insert({
        batch_id: batch.id,
        name: candidate.company_name.trim(),
        normalized_name: normalizedName,
        website,
        domain,
        country: candidate.country?.trim() || null,
        country_code: candidate.country_code?.trim().toUpperCase() || null,
        city: candidate.city?.trim() || null,
        region: candidate.region?.trim() || null,
        industry: candidate.industry?.trim() || null,
        company_size: candidate.company_size?.trim() || null,
        tax_identifier: candidate.tax_identifier?.trim() || null,
        tax_identifier_type: candidate.tax_identifier_type?.trim() || null,
        source_primary: 'external_import',
        status: 'needs_review',
        review_notes: notesArr.length > 0 ? notesArr.join('\n') : null,
        metadata: {
          ...(candidate.linkedin_url ? { linkedin_url: candidate.linkedin_url.trim() } : {}),
          ...(candidate.source_url ? { source_url: candidate.source_url.trim(), evidence_url: candidate.source_url.trim() } : {}),
          ...(candidate.contact_name ? { contact_name: candidate.contact_name.trim() } : {}),
          ...(candidate.contact_role ? { contact_role: candidate.contact_role.trim() } : {}),
          ...(candidate.contact_email ? { contact_email: candidate.contact_email.trim() } : {}),
          ...(candidate.owner_email ? { owner_email: candidate.owner_email.trim() } : {}),
          imported_from: input.import_type,
          import: {
            ...(candidate.source_url ? { source_url: candidate.source_url.trim() } : {}),
            ...(candidate.source_evidence ? { source_evidence: candidate.source_evidence.trim() } : {}),
            ...(candidate.confidence ? { confidence: candidate.confidence.trim() } : {}),
          }
        },
      });

      if (!candidateError) candidatesCreated++;
    }

    // Ejecutar validación post-importación automáticamente
    await validateImportedCandidatesBatch(batch.id, internalUserId);

    return NextResponse.json({ batchId: batch.id, candidatesCreated });
  } catch (err) {
    console.error('[create-import-batch] Error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
