import { NextRequest, NextResponse } from 'next/server';
import { requireOwnerForCreate } from '@/lib/ownership/resolve-owner-for-create';
import { createClient } from '@/lib/supabase/server';
import { validateImportedCandidatesBatch } from '@/modules/prospect-batches/actions';
import { loadImportCatalog } from '@/modules/prospect-batches/import-catalog-loader';
import { classifyImportRows } from '@/modules/prospect-batches/import-classification-service';
import { buildImportPersistencePayload } from '@/modules/prospect-batches/import-classification-payload-builder';
import type { ImportRow, ParsedImportRow } from '@/modules/prospect-batches/import-candidates-parser';
// AGENT1-CUT4-B1 § 8 — la MISMA autoridad de procedencia que usan los writers
// canónicos. Esta ruta no decide la procedencia: la delega y la proyecta.
import {
  CANDIDATE_RECORD_ORIGIN_METADATA_KEY,
  resolveCandidateRecordOriginForWriter,
  toCandidateRecordOriginColumns,
  toCandidateRecordOriginMetadata,
} from '@/server/agents/prospecting-toolkit/candidate-record-origin';
// AGENT1-IMPORT-PARITY-1 — la MISMA identidad y el MISMO reclamo global que
// Apollo/Lusha. La ruta no decide identidad: la delega.
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { fetchActiveCandidatesForGuard } from '@/server/agents/prospecting-toolkit/candidate-writer';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import { claimGlobalIdentitiesForPersistedCandidates } from '@/server/prospect-batches/global-identity-claims-store';
import {
  IMPORT_ADMISSION_METADATA_KEY,
  collectImportDomains,
  planImportIdentityAdmission,
  toImportAdmissionMetadata,
  type ImportIdentityRowInput,
} from '@/server/prospect-batches/import-identity-admission';
import {
  resolveImportTaxIdentifier,
  type ImportTaxIdentifierResolution,
} from '@/modules/prospect-batches/import-tax-identifier';
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import { resolveImportIcpSize } from '@/server/prospect-batches/import-icp-size';
import { scheduleClaudeRescueAfterImport } from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/schedule-rescue.server';
import {
  IMPORT_SOURCE_ENRICHMENT_METADATA_KEY,
  enrichImportRowsWithOfficialSources,
} from '@/server/prospect-batches/import-official-source-enrichment';
import { drainEnrichmentJobs } from '@/server/prospect-batches/enrichment-drain';
import { AUTO_ENRICH_CONFIG } from '@/modules/prospect-batches/auto-enrich-config';
import {
  IMPORT_QUALITY_GATES_METADATA_KEY,
  evaluateImportQualityGates,
} from '@/server/prospect-batches/import-quality-gates';
import {
  validateImportBatchInput,
  type ImportBatchInput,
  type ImportCandidateInput,
} from '@/modules/prospect-batches/import-batch-schema';
import {
  applyManualClassificationOverrides,
  type ManualIndustryOverride,
} from '@/modules/prospect-batches/import-classification-overrides';
import {
  insertImportCandidateRows,
  type ImportCandidateInsertRow,
} from '@/server/prospect-batches/import-candidate-bulk-insert';

// AGENT1-AUDIT-WS5-IMPORT-DEADLINE-1 — 500 filas (inserción + validación con
// búsqueda de NIT y HubSpot + rescate en `after()`) no caben en el límite por
// defecto. Mismo techo que las demás rutas largas del Agente 1.
export const maxDuration = 300;

/**
 * Hasta cuándo la validación post-import puede EMPEZAR filas, contado desde
 * que llegó la petición. Deja margen para que terminen las filas en curso,
 * para el resumen del lote y para la ventana mínima del rescate en `after()`
 * (que comparte los mismos 300 s: ver `rescue-time-budget.ts`).
 */
const IMPORT_VALIDATION_WINDOW_MS = 170_000;

type ImportCandidate = ImportCandidateInput;

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
  // AGENT1-IMPORT-SAME-PIPELINE-1 — el rescate en `after()` comparte los 300 s de esta función.
  const requestStartedAtMs = Date.now();
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

    // AGENT1-AUDIT-WS5-IMPORT-SCHEMA-1 — el cuerpo se valida ANTES de crear
    // nada: tope de filas, largos, nombre obligatorio y país soportado.
    const rawBody: unknown = await request.json().catch(() => null);
    const inputValidation = validateImportBatchInput(rawBody);
    if (!inputValidation.ok) {
      return NextResponse.json({
        success: false,
        code: 'invalid_import_input',
        message: inputValidation.message,
        issues: inputValidation.issues,
      }, { status: 400 });
    }
    const input: ImportBatchInput = inputValidation.data;

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

    const automaticClassification = classifyImportRows({
      rows: classifiableRows,
      catalog,
      catalogVersionId,
    });

    // ── AGENT1-AUDIT-WS5-IMPORT-OVERRIDES-1 — correcciones manuales ─────────
    // El drawer envía el id de catálogo que el vendedor eligió en la revisión;
    // se valida contra el catálogo vivo y reemplaza la clasificación automática.
    const manualOverrides = new Map<number, ManualIndustryOverride>();
    input.candidates.forEach((c, i) => {
      if (c.industry_id) {
        manualOverrides.set(i + 1, { industryId: c.industry_id, subindustryId: c.subindustry_id ?? null });
      }
    });
    const overrideOutcome = applyManualClassificationOverrides(automaticClassification, catalog, manualOverrides);
    if (!overrideOutcome.ok) {
      const [first] = overrideOutcome.errors;
      return NextResponse.json({
        success: false,
        code: 'invalid_classification_override',
        message: `Fila ${first.rowNumber}: ${first.message} Vuelve a clasificar el archivo.`,
        errors: overrideOutcome.errors,
      }, { status: 422 });
    }
    const classificationResult = overrideOutcome.result;

    // ── Block if any row requires review ───────────────────────────────────
    if (!classificationResult.valid) {
      const reviewRowCount = new Set(classificationResult.blockingIssues.map((b) => b.rowNumber)).size;
      return NextResponse.json({
        success: false,
        code: 'classification_review_required',
        message: `${reviewRowCount} fila${reviewRowCount !== 1 ? 's' : ''} todavía requiere${reviewRowCount !== 1 ? 'n' : ''} revisión de industria. Corrígela${reviewRowCount !== 1 ? 's' : ''} o quíta${reviewRowCount !== 1 ? 'las' : 'la'} de la selección.`,
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

    // La industria en texto que se persiste: con corrección manual, el nombre
    // del catálogo elegido (no el texto crudo del archivo que se corrigió).
    const effectiveIndustries: Array<string | undefined> = input.candidates.map((c, i) =>
      manualOverrides.has(i + 1)
        ? (classificationResult.rows[i]?.classification.industryName ?? undefined)
        : (c.industry?.trim() || undefined),
    );

    // ── Existing batch metadata logic ──────────────────────────────────────
    const now = new Date();
    const dateLabel = now.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

    const countryCodes = [...new Set(input.candidates.map((c) => c.country_code).filter(Boolean))];
    const industries = [...new Set(effectiveIndustries.filter(Boolean))];

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
      (c, i) => !effectiveIndustries[i] && !!input.defaults?.industry
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

    // ── AGENT1-IMPORT-PARITY-1 — admisión por identidad ────────────────────
    //
    // Se decide ANTES de escribir, con el cliente administrativo: la sesión de
    // un vendedor no ve los lotes de los demás, y la guarda tiene que verlos.
    // Si la lectura falla, la guarda degrada ABIERTA (igual que el writer): la
    // fila entra y el reclamo global de abajo sigue protegiendo.
    // AGENT1-IMPORT-PARITY-2 — el identificador fiscal se normaliza UNA vez, con
    // las reglas por país del alta manual, y ese mismo valor alimenta identidad,
    // reclamo global y columna persistida.
    const fileTaxResolutions = input.candidates.map((c) =>
      resolveImportTaxIdentifier(c.tax_identifier, c.country_code),
    );

    // AGENT1-IMPORT-PARITY-8 — primero los catálogos GRATUITOS (los mismos de
    // Apollo/Lusha). Sólo filas sin identificador fiscal y de un país con
    // catálogo conectado; sólo una identidad fuerte llena columnas.
    const officialSourceOutcomes = await enrichImportRowsWithOfficialSources(
      input.candidates.map((c, i) => {
        const website = c.website?.trim() || null;
        return {
          rowNumber: i + 1,
          name: c.company_name,
          website,
          domain: website ? extractDomain(website) : null,
          countryCode: c.country_code?.trim().toUpperCase() || null,
          taxIdentifier: fileTaxResolutions[i].value,
        };
      }),
      buildColombiaOfficialSourceResolvers(),
    );

    const taxResolutions: ImportTaxIdentifierResolution[] = fileTaxResolutions.map((r, i) => {
      const official = officialSourceOutcomes.get(i + 1);
      const officialTax = official?.strongIdentityAvailable ? official.typedColumns.tax_identifier : null;
      if (r.value || !officialTax) return r;
      return {
        status: 'official_source',
        value: officialTax,
        type: official?.typedColumns.tax_identifier_type ?? null,
        warning: null,
      };
    });

    const identityRows: ImportIdentityRowInput[] = input.candidates.map((c, i) => {
      const website = c.website?.trim() || null;
      return {
        rowNumber: i + 1,
        name: c.company_name,
        website,
        domain: website ? extractDomain(website) : null,
        countryCode: c.country_code?.trim().toUpperCase() || null,
        taxIdentifier: taxResolutions[i].value,
        linkedinUrl: c.linkedin_url?.trim() || null,
      };
    });

    let adminClient: ReturnType<typeof createSupabaseAdminClient> | null = null;
    try {
      adminClient = createSupabaseAdminClient();
    } catch (adminErr) {
      console.error('[create-import-batch] admin client unavailable:', adminErr);
    }

    let activeCandidates: ActiveCandidateRecord[] = [];
    let activeGuardStatus: string = 'unavailable';
    if (adminClient) {
      const prefetch = await fetchActiveCandidatesForGuard(
        adminClient,
        collectImportDomains(identityRows),
        null,
      );
      activeCandidates = prefetch.records;
      activeGuardStatus = prefetch.status;
    }

    const admissionPlan = planImportIdentityAdmission(identityRows, activeCandidates);

    // ── Create batch with catalog_version ──────────────────────────────────
    //
    // AGENT1-CUT4-B1 § 8 — la metadata y el nombre del lote se nombran para poder
    // ALIMENTAR al clasificador canónico con la forma real del lote. Su contenido
    // no cambia: son exactamente las mismas claves y los mismos valores.
    const batchName = `Importación externa · ${dateLabel}`;
    const batchMetadata = {
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
    };

    const { data: batch, error: batchError } = await supabase
      .from('prospect_batches')
      .insert({
        name: batchName,
        description: 'Candidatos cargados manualmente o desde archivo externo.',
        country: batchCountry,
        country_code: batchCountryCode,
        industry: batchIndustry,
        status: 'ready_for_review',
        source: 'external_import',
        // ALWAYS-OWNER-ON-CREATE-1 — el lote importado es de quien lo importa.
        owner_id: requireOwnerForCreate({ actorUserId: internalUserId }, 'el lote'),
        created_by: internalUserId,
        catalog_version: persistencePayload.batch.catalog_version,
        metadata: batchMetadata,
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
    // AGENT1-AUDIT-WS5-IMPORT-DEADLINE-1 — se arman todas las filas y se
    // insertan en bloque (antes: un viaje a la base por fila).
    const insertRows: ImportCandidateInsertRow[] = [];
    const statusByRowNumber = new Map<number, string>();

    for (let i = 0; i < input.candidates.length; i++) {
      const candidate = input.candidates[i];
      const rowNumber = i + 1;
      const classifiedRow = classificationResult.rows[i];
      const candidatePayload = persistencePayload.candidates.get(rowNumber);

      const website = candidate.website?.trim() || null;
      const domain = website ? extractDomain(website) : null;
      const normalizedName = normalizeName(candidate.company_name);
      const admission = admissionPlan[i];
      const isDuplicateOnImport = admission.kind === 'duplicate';
      // AGENT1-IMPORT-SAME-PIPELINE-1 — tamaño ICP como el Agente 1: registro
      // oficial o archivo; por debajo de 200 ⇒ Descartadas con el motivo.
      const icpSize = resolveImportIcpSize({
        companySize: candidate.company_size?.trim() || null,
        official: officialSourceOutcomes.get(rowNumber) ?? null,
      });
      const candidateStatus = isDuplicateOnImport ? 'duplicate' : icpSize.discard ? 'discarded' : 'needs_review';
      // AGENT1-IMPORT-PARITY-3 — reglas de país/plataforma/dominio/tamaño de
      // Apollo/Lusha en modo revisión: marcan, no descartan.
      const qualityGates = evaluateImportQualityGates({
        name: candidate.company_name,
        website,
        domain,
        countryCode: candidate.country_code?.trim().toUpperCase() || null,
        companySize: candidate.company_size?.trim() || null,
      });

      const notesArr: string[] = [];
      if (candidate.description) notesArr.push(`Descripción: ${candidate.description}`);
      if (candidate.notes) notesArr.push(candidate.notes);

      if (icpSize.discard && !isDuplicateOnImport && icpSize.discardNote) notesArr.unshift(icpSize.discardNote);
      const reviewNotes = notesArr.length > 0 ? notesArr.join('\n') : null;

      // AGENT1-CUT4-B1 § 8 — la metadata del candidato se nombra ANTES de la fila
      // para que el clasificador canónico pueda leerla. Su contenido es idéntico.
      const candidateBaseMetadata: Record<string, unknown> = {
        ...(candidate.linkedin_url ? { linkedin_url: candidate.linkedin_url.trim() } : {}),
        ...(candidate.source_url ? { source_url: candidate.source_url.trim(), evidence_url: candidate.source_url.trim() } : {}),
        ...(candidate.source_evidence ? { source_evidence: candidate.source_evidence.trim() } : {}),
        ...(candidate.confidence ? { confidence: candidate.confidence.trim() } : {}),
        ...(candidate.contact_name ? { contact_name: candidate.contact_name.trim() } : {}),
        ...(candidate.contact_role ? { contact_role: candidate.contact_role.trim() } : {}),
        ...(candidate.contact_email ? { contact_email: candidate.contact_email.trim() } : {}),
        ...(candidate.owner_email ? { owner_email: candidate.owner_email.trim() } : {}),
        ...(candidate.notes ? { notes: candidate.notes.trim() } : {}),
        [IMPORT_ADMISSION_METADATA_KEY]: toImportAdmissionMetadata(admission),
        [IMPORT_QUALITY_GATES_METADATA_KEY]: qualityGates.metadata,
        icp_size_gate: { ...icpSize.gate, source: icpSize.source },
        ...(officialSourceOutcomes.has(rowNumber)
          ? { [IMPORT_SOURCE_ENRICHMENT_METADATA_KEY]: officialSourceOutcomes.get(rowNumber)!.metadata }
          : {}),
        ...(taxResolutions[i].status !== 'absent'
          ? { tax_identifier_validation: taxResolutions[i].status }
          : {}),
        imported_from: input.import_type,
        origen: 'external_import',
        import: {
          ...(candidate.source_url ? { source_url: candidate.source_url.trim() } : {}),
          ...(candidate.source_evidence ? { source_evidence: candidate.source_evidence.trim() } : {}),
          ...(candidate.confidence ? { confidence: candidate.confidence.trim() } : {}),
          ...(candidate.notes ? { notes: candidate.notes.trim() } : {}),
          origen: 'external_import',
        }
      };

      // ── AGENT1-CUT4-B1 § 8 — la procedencia de la FILA importada ────────────
      //
      // El defecto que cierra: esta ruta insertaba `status='needs_review'` sin
      // tocar `record_origin`, así que la columna quedaba en NULL por OMISIÓN del
      // writer, no por una decisión.
      //
      // Lo que se persiste NO es un literal: lo decide el clasificador canónico
      // sobre la fila real. Con `source_primary='external_import'` y
      // `prospect_batches.source='external_import'` su regla de import (R4) gana
      // antes que cualquier inferencia de producción, así que una importación
      // externa jamás se etiqueta `production` desde aquí. Que siga siendo no
      // accionable en la cola limpia es el comportamiento esperado: este corte es
      // paridad de procedencia, no ensanchamiento de permisos.
      const recordOriginResolution = resolveCandidateRecordOriginForWriter({
        // Esta ruta no tiene modo seco: si llega hasta aquí, escribe.
        dryRun: false,
        candidate: {
          status: candidateStatus,
          source_primary: 'external_import',
          review_notes: reviewNotes,
          metadata: candidateBaseMetadata,
        },
        batch: {
          source: 'external_import',
          name: batchName,
          metadata: batchMetadata,
        },
      });

      const insertData: Record<string, unknown> = {
        batch_id: batch.id,
        name: candidate.company_name.trim(),
        normalized_name: normalizedName,
        identity_key: admission.identityKey,
        website,
        domain,
        country: candidate.country?.trim() || null,
        country_code: candidate.country_code?.trim().toUpperCase() || null,
        city: candidate.city?.trim() || null,
        region: candidate.region?.trim() || null,
        industry: effectiveIndustries[i] ?? null,
        company_size: candidate.company_size?.trim() || null,
        tax_identifier: taxResolutions[i].value,
        tax_identifier_type: taxResolutions[i].type ?? (candidate.tax_identifier_type?.trim() || null),
        ...(officialSourceOutcomes.get(rowNumber)?.strongIdentityAvailable
          ? {
              legal_name: officialSourceOutcomes.get(rowNumber)!.typedColumns.legal_name,
              legal_status: officialSourceOutcomes.get(rowNumber)!.typedColumns.legal_status,
            }
          : {}),
        source_primary: 'external_import',
        status: candidateStatus,
        ...(isDuplicateOnImport ? { duplicate_status: 'exact_duplicate' } : {}),
        review_notes: reviewNotes,
        review_flags: qualityGates.reviewFlags,
        // § 8 — la fila declara de qué clase de corrida salió, en vez de dejar la
        // columna en NULL por descuido del writer.
        ...toCandidateRecordOriginColumns(recordOriginResolution),
        metadata: {
          ...candidateBaseMetadata,
          // § 8 — derivación auditable. ADITIVO: no pisa ninguna clave anterior.
          [CANDIDATE_RECORD_ORIGIN_METADATA_KEY]:
            toCandidateRecordOriginMetadata(recordOriginResolution),
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

      insertRows.push({ rowNumber, insertData });
      statusByRowNumber.set(rowNumber, candidateStatus);
    }

    const insertOutcome = await insertImportCandidateRows(supabase, insertRows);
    const candidatesCreated = insertOutcome.inserted.length;
    const createdCandidateIds = insertOutcome.inserted
      .filter((r) => statusByRowNumber.get(r.rowNumber) === 'needs_review')
      .map((r) => r.id);

    // ── AGENT1-IMPORT-PARITY-1 — reclamo global (migración 140) ────────────
    //
    // AGENT1-AUDIT-WS5-IMPORT-DEADLINE-1 — JUSTO después de insertar (antes:
    // al final, después de validar fila por fila). Si Vercel cortaba la
    // función durante la validación, las filas quedaban vivas SIN reclamo y
    // otro vendedor podía tomar la misma empresa. Lo que la validación deje
    // luego `duplicate` (ya existe en SellUp o HubSpot) libera su reclamo por
    // el disparador de la 140. Se reclama UNA sola vez: reclamar dos veces el
    // mismo candidato chocaría consigo mismo. La relectura de estados vive en
    // el store (sólo filas vivas) y, si falla, degrada CERRADO (`degraded`):
    // un fallo de infraestructura nunca marca duplicado a nadie ni se reporta
    // como «sin reclamos».
    // Cliente ADMINISTRATIVO por la misma razón que Lusha: la tabla de reclamos
    // sólo tiene política para `service_role`.
    let claimsDegraded = !adminClient;
    let claimedElsewhereCount = 0;
    if (adminClient && createdCandidateIds.length > 0) {
      const claimOutcome = await claimGlobalIdentitiesForPersistedCandidates(
        adminClient,
        batch.id,
        createdCandidateIds,
      );
      claimsDegraded = claimOutcome.degraded;
      claimedElsewhereCount = claimOutcome.claimedElsewhere.length;
    }

    // Ejecutar validación post-importación automáticamente, con concurrencia
    // acotada y plazo: lo que no alcance queda `pending_revalidation`.
    const validationOutcome = await validateImportedCandidatesBatch(batch.id, internalUserId, undefined, {
      deadlineAtMs: requestStartedAtMs + IMPORT_VALIDATION_WINDOW_MS,
      candidateOrder: insertOutcome.inserted.map((r) => r.id),
    });
    if (!validationOutcome.success) {
      console.error('[create-import-batch] post-import validation failed:', validationOutcome.error);
    }

    const duplicatesOnImport = admissionPlan.filter((a) => a.kind === 'duplicate');
    const { data: batchAfterValidation } = await supabase
      .from('prospect_batches')
      .select('metadata')
      .eq('id', batch.id)
      .single();
    await supabase
      .from('prospect_batches')
      .update({
        metadata: {
          ...((batchAfterValidation?.metadata as Record<string, unknown> | null) ?? batchMetadata),
          [IMPORT_ADMISSION_METADATA_KEY]: {
            active_candidate_guard: activeGuardStatus,
            intra_file_duplicates: duplicatesOnImport.filter((a) => a.reason === 'intra_file_duplicate').length,
            active_candidate_duplicates: duplicatesOnImport.filter((a) => a.reason === 'active_candidate_domain').length,
            global_claims_degraded: claimsDegraded,
            claimed_elsewhere: claimedElsewhereCount,
          },
        },
      })
      .eq('id', batch.id);

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

    // AGENT1-IMPORT-PARITY-10 — la IA corre DESPUÉS de responder, sólo si quedó
    // algo que valga la pena (la elegibilidad ya filtró duplicados, avisos y el
    // tope). Sin cron programado, esto es lo que hace que el enriquecimiento
    // exista. Si `after` no está disponible, los trabajos quedan `pending`.
    //
    // AGENT1-IMPORT-SAME-PIPELINE-1 — y DESPUÉS, el mismo rescate con Claude del
    // Agente 1 (tamaño y sector de lo que quedó en revisión sin tamaño). En
    // secuencia: los dos escriben la metadata del candidato.
    const drainBeforeRescue =
      AUTO_ENRICH_CONFIG.enabled && autoEnrichPendingCount > 0
        ? async () => {
            const drain = await drainEnrichmentJobs();
            console.info('[create-import-batch] post-import enrichment drain:', drain);
          }
        : null;
    scheduleClaudeRescueAfterImport({
      batchId: batch.id as string,
      triggeredBy: internalUserId,
      actionStartedAtMs: requestStartedAtMs,
      hasReviewRows: createdCandidateIds.length > 0,
      before: drainBeforeRescue,
    });

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
      success: true,
      batchId: batch.id,
      candidatesCreated,
      failedRowNumbers: insertOutcome.failedRowNumbers,
      pendingRevalidationCount: validationOutcome.pendingRevalidationCount ?? 0,
      stats,
      classification: {
        catalogVersion: classificationResult.catalogVersion,
        summary: classificationResult.summary,
      },
    });
  } catch (err) {
    console.error('[create-import-batch] Error:', err);
    return NextResponse.json({ success: false, error: 'Error interno', message: 'Error interno al importar.' }, { status: 500 });
  }
}
