// ── Importar candidatos — tipos y funciones puras del drawer ──────────────────
// Lo que el drawer calcula sin tocar estado ni red: normalización de valores,
// validación del archivo elegido y armado de los cuerpos que se envían. Vive
// aparte para que `import-candidates-drawer.tsx` se quede con el estado y las
// llamadas, y cada paso con su pantalla.

import { ClipboardPaste, FileText } from '@/icons';
import {
  getValidRows,
  type ImportMethod,
  type ImportPreview,
  type ImportRow,
} from '@/modules/prospect-batches/import-candidates-parser';
import type {
  ImportColumnMapping,
  ImportClassificationPreviewRow,
  ClassificationSummaryStats,
  ManualClassificationCorrection,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

export type Step = 'input' | 'classification' | 'preview' | 'success';
export type FileMethod = 'paste' | 'file';

export interface ImportDuplicateResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

export interface ImportCatalogSubindustry {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  countries?: string[];
}

export interface ImportCatalogIndustry {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  subindustries: ImportCatalogSubindustry[];
}

export interface ImportCatalogData {
  industries: ImportCatalogIndustry[];
}

export interface ImportBatchStats {
  totalProcessed: number;
  importedCount: number;
  errorsCount: number;
  alreadyCompleteCount: number;
  autoEnrichPendingCount: number;
  duplicateCount: number;
  possibleDuplicateCount: number;
}

/** Los pasos del flujo, en el orden en que el drawer los recorre. */
export const IMPORT_STEPS = [
  { id: 'file', label: 'Archivo' },
  { id: 'columns', label: 'Columnas' },
  { id: 'classification', label: 'Clasificación' },
  { id: 'review', label: 'Revisión' },
] as const;

export const FILE_METHOD_OPTIONS = [
  { value: 'paste', label: 'Pegar tabla', icon: ClipboardPaste },
  { value: 'file', label: 'Subir archivo', icon: FileText },
];

/** Tamaño máximo del archivo que se puede subir. */
export const IMPORT_FILE_MAX_BYTES = 2 * 1024 * 1024;

// ── Classification value normalization (client-side pre-processing) ────────────
// Handles known aliases not yet in the catalog: Tech→Tecnología, etc.

export function normalizeIndustryRaw(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (v === 'tech') return 'Tecnología';
  if (v === 'cyber security' || v === 'cybersecurity') return 'Ciberseguridad';
  return val;
}

export function normalizeSubindustryRaw(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (['vacío', 'vacio', 'n/a', 'na', '-', 'null', 'none', ''].includes(v)) return undefined;
  return val;
}

export function computeHasMappingConflict(mappings: ImportColumnMapping[]): boolean {
  const counts = new Map<string, number>();
  for (const m of mappings) {
    if (m.targetField === 'ignore') continue;
    counts.set(m.targetField, (counts.get(m.targetField) ?? 0) + 1);
  }
  return (counts.get('industry') ?? 0) > 1 || (counts.get('subindustry') ?? 0) > 1;
}

/**
 * Valida el archivo elegido (clic o arrastre) con las mismas tres reglas de
 * siempre. Devuelve la extensión si el archivo sirve, o el mensaje de error.
 */
export function validateImportFile(file: File): { ext: 'csv' | 'xlsx' } | { error: string } {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'xlsm') {
    return { error: 'Por seguridad, sube el archivo como .xlsx o CSV. Los archivos .xlsm no son soportados.' };
  }
  if (ext !== 'csv' && ext !== 'xlsx') {
    return { error: 'Formato no soportado. Usa CSV o XLSX.' };
  }
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    return { error: 'El archivo supera 2 MB. Usa un archivo más pequeño o pega el contenido.' };
  }
  return { ext };
}

/** Las filas que se envían a clasificar: solo las válidas o con advertencia. */
export function buildClassifiableRows(
  previewData: ImportPreview,
  mappings: ImportColumnMapping[],
  subindustriesEnabled: boolean,
) {
  const origIndustryCol = mappings.find((m) => m.targetField === 'industry')?.sourceColumn ?? null;
  const origSubindustryCol = mappings.find((m) => m.targetField === 'subindustry')?.sourceColumn ?? null;

  return previewData.rows
    .filter((r) => r.status === 'valid' || r.status === 'warning')
    .map((r) => {
      function rawValueForColumn(sourceColumn: string | null): string | undefined {
        if (!sourceColumn) return undefined;
        if (sourceColumn === origIndustryCol) return r.raw.industry ?? undefined;
        if (sourceColumn === origSubindustryCol) return r.raw.subindustry ?? undefined;
        return undefined;
      }
      const industryRaw = rawValueForColumn(origIndustryCol);
      const subindustryRaw = rawValueForColumn(origSubindustryCol);
      return {
        company_name: r.raw.company_name,
        country_code: r.resolved_country_code,
        industry: normalizeIndustryRaw(industryRaw),
        subindustry: subindustriesEnabled ? normalizeSubindustryRaw(subindustryRaw) : undefined,
        website: r.raw.website,
        linkedin_url: r.raw.linkedin_url,
        city: r.raw.city,
        company_size: r.raw.company_size,
        description: r.raw.description,
        source_url: r.raw.source_url,
        source_evidence: r.raw.source_evidence,
        confidence: r.raw.confidence,
        notes: r.raw.notes,
      };
    });
}

/** Añade a las columnas de industria y subindustria sus valores de muestra. */
export function enrichMappingsWithSamples(
  mappings: ImportColumnMapping[],
  built: ImportPreview,
): ImportColumnMapping[] {
  return mappings.map((m) => {
    if (m.targetField === 'industry') {
      return {
        ...m,
        sampleValues: built.rows.slice(0, 5).map((r) => r.raw.industry ?? '').filter(Boolean),
      };
    }
    if (m.targetField === 'subindustry') {
      return {
        ...m,
        sampleValues: built.rows.slice(0, 5).map((r) => r.raw.subindustry ?? '').filter(Boolean),
      };
    }
    return m;
  });
}

/** Lo que se envía a la verificación de duplicados: una entrada por fila válida. */
export function buildDuplicateCheckItems(built: ImportPreview) {
  return getValidRows(built).map((r) => ({
    index: r.index,
    company_name: r.raw.company_name,
    country_code: r.resolved_country_code,
    domain: r.raw.website
      ? (() => {
          try {
            const url = r.raw.website!.startsWith('http') ? r.raw.website! : `https://${r.raw.website}`;
            return new URL(url).hostname.replace(/^www\./, '');
          } catch {
            return null;
          }
        })()
      : null,
    tax_identifier: r.raw.tax_identifier || null,
  }));
}

/**
 * Los candidatos que se envían a crear el lote. `subindustriesEnabled` decide
 * si viaja la subindustria; sin él, el campo no se envía.
 */
export function buildImportCandidates(rows: ImportRow[], subindustriesEnabled: boolean) {
  return rows.map((r) => ({
    company_name: r.raw.company_name,
    country: r.raw.country,
    country_code: r.resolved_country_code ?? r.raw.country_code,
    industry: r.raw.industry,
    subindustry: subindustriesEnabled ? r.raw.subindustry : undefined,
    website: r.raw.website,
    city: r.raw.city,
    region: r.raw.region,
    tax_identifier: r.raw.tax_identifier,
    tax_identifier_type: r.raw.tax_identifier_type,
    linkedin_url: r.raw.linkedin_url,
    company_size: r.raw.company_size,
    description: r.raw.description,
    notes: r.raw.notes,
    source_url: r.raw.source_url,
    contact_name: r.raw.contact_name,
    contact_role: r.raw.contact_role,
    contact_email: r.raw.contact_email,
    owner_email: r.raw.owner_email,
    source_evidence: r.raw.source_evidence,
    confidence: r.raw.confidence,
  }));
}

/** Recuenta los estados de las filas clasificadas. */
export function summarizeClassificationRows(
  rows: ImportClassificationPreviewRow[],
): ClassificationSummaryStats {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.validationStatus === 'valid').length,
    normalized: rows.filter((r) => r.validationStatus === 'normalized').length,
    warning: rows.filter((r) => r.validationStatus === 'warning').length,
    requiresReview: rows.filter((r) => r.validationStatus === 'requires_review').length,
    invalid: rows.filter((r) => r.validationStatus === 'invalid').length,
  };
}

/** El cuerpo de la petición que crea el lote importado. */
export function buildCreateImportBatchBody(args: {
  importType: ImportMethod;
  candidates: ReturnType<typeof buildImportCandidates>;
  preview: ImportPreview;
  defaults: {
    country: string | undefined;
    country_code: string | undefined;
    industry: string | undefined;
    subindustry: string | undefined;
  };
}) {
  return {
    import_type: args.importType,
    candidates: args.candidates,
    recognized_columns: args.preview.recognized_columns,
    unrecognized_columns: args.preview.unrecognized_columns,
    total_rows: args.preview.total,
    valid_rows: args.preview.valid,
    invalid_rows: args.preview.errors,
    warning_rows: args.preview.warnings_only,
    defaults: args.defaults,
  };
}

/** El cuerpo de la petición que revalida una corrección manual de clasificación. */
export function buildRevalidationBody(
  correction: ManualClassificationCorrection,
  contextRow: ImportClassificationPreviewRow,
) {
  return {
    ...correction,
    companyName: contextRow.companyName,
    countryCode: contextRow.countryCode,
    industryOriginalValue: contextRow.industryOriginalValue,
    subindustryOriginalValue: contextRow.subindustryOriginalValue,
    // Round-trip preview fields so the row keeps showing them after correction
    website: contextRow.website ?? null,
    linkedinUrl: contextRow.linkedinUrl ?? null,
    city: contextRow.city ?? null,
    companySize: contextRow.companySize ?? null,
    description: contextRow.description ?? null,
    sourceUrl: contextRow.sourceUrl ?? null,
    sourceEvidence: contextRow.sourceEvidence ?? null,
    confidence: contextRow.confidence ?? null,
    notes: contextRow.notes ?? null,
  };
}

/** El título del drawer en cada paso. */
export const IMPORT_STEP_TITLES: Record<Step, string> = {
  input: 'Importar candidatos externos',
  classification: 'Previsualización y clasificación',
  preview: 'Vista previa de importación',
  success: 'Candidatos importados para revisión',
};

/** La línea que explica el paso, bajo el título del drawer. */
export function getImportStepDescription(args: {
  step: Step;
  needsMappingResolution: boolean;
  loadingClassification: boolean;
  resultCount: number;
}): string {
  const { step, needsMappingResolution, loadingClassification, resultCount } = args;
  if (step === 'input') {
    return 'Carga empresas encontradas en Gemini, hojas de cálculo, eventos o investigación externa. SellUp validará duplicidad y las dejará listas para revisión antes de crear cuentas.';
  }
  if (step === 'classification') {
    if (needsMappingResolution) return 'Detectamos columnas con mapeo ambiguo. Corrígelas antes de clasificar.';
    if (loadingClassification) return 'Clasificando industrias y subindustrias contra el catálogo oficial…';
    return 'Revisa los datos detectados, corrige la clasificación cuando sea necesario y selecciona las empresas que quieres importar.';
  }
  if (step === 'preview') {
    return 'Revisa los datos antes de importar. Solo se importarán filas válidas y con advertencias.';
  }
  return `SellUp importó ${resultCount} prospecto${resultCount !== 1 ? 's' : ''} externo${resultCount !== 1 ? 's' : ''}. Revísalos antes de aprobarlos como cuentas.`;
}

/**
 * Paso del `Stepper`: se DERIVA del estado que ya existe (`step` +
 * `needsMappingResolution`), no añade estado propio.
 */
export function getStepperIndex(step: Step, needsMappingResolution: boolean): number {
  if (step === 'input') return 0;
  if (step === 'classification') return needsMappingResolution ? 1 : 2;
  if (step === 'preview') return 3;
  return IMPORT_STEPS.length;
}
