import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { validateImportedCandidatesBatch } from '@/modules/prospect-batches/actions';
import { loadImportCatalog } from '@/modules/prospect-batches/import-catalog-loader';
import { classifyImportRows } from '@/modules/prospect-batches/import-classification-service';
import { buildImportPersistencePayload } from '@/modules/prospect-batches/import-classification-payload-builder';
import type { ImportRow, ParsedImportRow } from '@/modules/prospect-batches/import-candidates-parser';

interface ImportCandidate {
  company_name: string;
  country?: string;
  country_code?: string;
  website?: string;
  industry?: string;
  subindustry?: string;
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
  industryOriginalValue?: string | null;
  subindustryOriginalValue?: string | null;
}

interface ImportBatchInput {
  import_type: 'paste' | 'csv' | 'xlsx';
  candidates: ImportCandidate[];
  recognized_columns: string[];
  unrecognized_columns: string[];
  duplicate_columns?: string[];
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

// ── Build lightweight ImportRow from ImportCandidate ──────────────────────────
// Reconstructs the shape needed by the classification service from the
// already-parsed candidate data received from the client.

function candidateToClassifiableRow(
  candidate: ImportCandidate,
  index: number,
): ImportRow {
  const raw: ParsedImportRow = {
    company_name: candidate.company_name,
    country: candidate.country,
    country_code: candidate.country_code,
    website: candidate.website,
    industry: candidate.industry,
    subindustry: candidate.subindustry,
    city: candidate.city,
    region: candidate.region,
    tax_identifier: candidate.tax_identifier,
    tax_identifier_type: candidate.tax_identifier_type,
    linkedin_url: candidate.linkedin_url,
    company_size: candidate.company_size,
    description: candidate.description,
    notes: candidate.notes,
    source_url: candidate.source_url,
    contact_name: candidate.contact_name,
    contact_role: candidate.contact_role,
    contact_email: candidate.contact_email,
    owner_email: candidate.owner_email,
    source_evidence: candidate.source_evidence,
    confidence: candidate.confidence,
  };

  // Determine original values: prefer client-sent originals, fallback to effective values
  const industryOriginalValue = candidate.industryOriginalValue ?? candidate.industry?.trim() ?? null;
  const subindustryOriginalValue = candidate.subindustryOriginalValue ?? candidate.subindustry?.trim() ?? null;

  return {
    index,
    raw,
    status: 'valid',
    errors: [],
    warnings: [],
    resolved_country_code: candidate.country_code?.trim().toUpperCase() ?? null,
    country_from_default: false,
    industry_from_default: false,
    industryOriginalValue,
    subindustryOriginalValue,
  };
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

    // ── Duplicate columns check ────────────────────────────────────────────
    if (input.duplicate_columns && input.duplicate_columns.length > 0) {
      return NextResponse.json({
        success: false,
        code: 'duplicate_import_columns',
        duplicateColumns: input.duplicate_columns,
      }, { status: 422 });
    }

    // ── Load classification catalog ────────────────────────────────────────
    const catalogResult = await loadImportCatalog();

    if (!catalogResult.success) {
      return NextResponse.json({
        success: false,
        code: 'industry_catalog_unavailable',
        message: catalogResult.message,
      }, { status: 503 });
    }

    const { catalog, catalogVersionId } = catalogResult;

    // ── Classify all rows ──────────────────────────────────────────────────
    const classifiableRows = input.candidates.map((c, i) => candidateToClassifiableRow(c, i));

    const classificationResult = classifyImportRows({
      rows: classifiableRows,
      catalog,
      catalogVersionId,
    });

    // ── Block if any row requires review ───────────────────────────────────
    if (!classificationResult.valid) {
      return NextResponse.json({
        success: false,
        code: 'classification_review_required',
        catalogVersion: classificationResult.catalogVersion,
        classificationSummary: classificationResult.summary,
        rows: classificationResult.rows.map((r) => ({
          rowNumber: r.rowNumber,
          companyName: r.parsedRow.raw.company_name,
          industry: r.parsedRow.raw.industry,
          subindustry: r.parsedRow.raw.subindustry,
          validationStatus: r.validationStatus,
          classification: {
            industryMatchStatus: r.classification.industryMatchStatus,
            industryName: r.classification.industryName,
            subindustryMatchStatus: r.classification.subindustryMatchStatus,
            subindustryName: r.classification.subindustryName,
            requiresHumanReview: r.classification.requiresHumanReview,
            warnings: r.classification.classificationWarnings,
          },
        })),
        blockingIssues: classificationResult.blockingIssues,
      }, { status: 422 });
    }

    // ── Build persistence payload ──────────────────────────────────────────
    const persistencePayload = buildImportPersistencePayload(classificationResult);

    // ── Existing batch metadata logic ──────────────────────────────────────
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

    // ── Verify catalog version hasn't changed (pre-persist check) ──────────
    const recheckResult = await loadImportCatalog();
    if (!recheckResult.success || recheckResult.catalogVersionId !== catalogVersionId) {
      return NextResponse.json({
        success: false,
        code: 'catalog_version_changed',
        message: 'Catalog version changed during classification. Please retry.',
      }, { status: 409 });
    }

    // ── Create batch with catalog_version ──────────────────────────────────
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
        catalog_version: persistencePayload.batch.catalog_version,
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
          classification_summary: classificationResult.summary,
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

    // ── Insert candidates with classification fields ───────────────────────
    let candidatesCreated = 0;

    for (let i = 0; i < input.candidates.length; i++) {
      const candidate = input.candidates[i];
      const rowNumber = i + 1;
      const classifiedRow = classificationResult.rows[i];
      const candidatePayload = persistencePayload.candidates.get(rowNumber);

      const website = candidate.website?.trim() || null;
      const domain = website ? extractDomain(website) : null;
      const normalizedName = normalizeName(candidate.company_name);

      const notesArr: string[] = [];
      if (candidate.description) notesArr.push(`Descripción: ${candidate.description}`);
      if (candidate.notes) notesArr.push(candidate.notes);

      const insertData: Record<string, unknown> = {
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
          ...(candidate.source_evidence ? { source_evidence: candidate.source_evidence.trim() } : {}),
          ...(candidate.confidence ? { confidence: candidate.confidence.trim() } : {}),
          ...(candidate.contact_name ? { contact_name: candidate.contact_name.trim() } : {}),
          ...(candidate.contact_role ? { contact_role: candidate.contact_role.trim() } : {}),
          ...(candidate.contact_email ? { contact_email: candidate.contact_email.trim() } : {}),
          ...(candidate.owner_email ? { owner_email: candidate.owner_email.trim() } : {}),
          ...(candidate.notes ? { notes: candidate.notes.trim() } : {}),
          imported_from: input.import_type,
          origen: 'external_import',
          import: {
            ...(candidate.source_url ? { source_url: candidate.source_url.trim() } : {}),
            ...(candidate.source_evidence ? { source_evidence: candidate.source_evidence.trim() } : {}),
            ...(candidate.confidence ? { confidence: candidate.confidence.trim() } : {}),
            ...(candidate.notes ? { notes: candidate.notes.trim() } : {}),
            origen: 'external_import',
          }
        },
      };

      // Attach classification fields if persistable
      if (candidatePayload) {
        insertData.catalog_version_id = candidatePayload.catalog_version_id;
        insertData.industry_id = candidatePayload.industry_id;
        insertData.subindustry_id = candidatePayload.subindustry_id;
        insertData.subindustry = candidatePayload.subindustry;
        insertData.import_classification = candidatePayload.import_classification;
      } else if (classifiedRow) {
        // Row exists but not persistable (shouldn't happen since we blocked above)
        // Still attach catalog_version_id for traceability
        insertData.catalog_version_id = catalogVersionId;
      }

      const { error: candidateError } = await supabase
        .from('prospect_candidates')
        .insert(insertData);

      if (!candidateError) candidatesCreated++;
    }

    // Ejecutar validación post-importación automáticamente
    await validateImportedCandidatesBatch(batch.id, internalUserId);

    // Cargar los candidatos insertados para calcular estadísticas detalladas
    const { data: candidates } = await supabase
      .from('prospect_candidates')
      .select('id, duplicate_status, metadata, status')
      .eq('batch_id', batch.id);

    const totalProcessed = input.candidates.length;
    const importedCount = candidatesCreated;
    const errorsCount = Math.max(0, input.candidates.length - candidatesCreated);

    let alreadyCompleteCount = 0;
    let autoEnrichPendingCount = 0;
    let duplicateCount = 0;
    let possibleDuplicateCount = 0;

    if (candidates) {
      for (const cand of candidates) {
        const enrichment = (cand.metadata as Record<string, unknown>)?.enrichment as Record<string, unknown> || {};
        const enrichmentStatus = (enrichment.status as string) ?? null;
        if (enrichmentStatus === 'skipped_already_complete') {
          alreadyCompleteCount++;
        } else if (enrichmentStatus === 'pending') {
          autoEnrichPendingCount++;
        }

        if (cand.duplicate_status === 'exact_duplicate' || cand.status === 'duplicate') {
          duplicateCount++;
        } else if (cand.duplicate_status === 'possible_duplicate') {
          possibleDuplicateCount++;
        }
      }
    }

    const stats = {
      totalProcessed,
      importedCount,
      errorsCount,
      alreadyCompleteCount,
      autoEnrichPendingCount,
      duplicateCount,
      possibleDuplicateCount,
    };

    return NextResponse.json({ 
      batchId: batch.id, 
      candidatesCreated,
      stats,
      classification: {
        catalogVersion: classificationResult.catalogVersion,
        summary: classificationResult.summary,
      },
    });
  } catch (err) {
    console.error('[create-import-batch] Error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
