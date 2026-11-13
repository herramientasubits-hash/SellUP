'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle2, FileText, Search } from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Stepper } from '@/components/navigation/stepper';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ImportLoadingOverlay } from '@/components/prospect-batches/import-loading-overlay';
import {
  parsePastedCandidates,
  parseCsvCandidates,
  parseXlsxCandidates,
  decodeImportTextFile,
  buildImportPreview,
  buildParseResultFromParsedRows,
  type ImportPreview,
  type ParseResult,
  importTruncationNotice,
  type ParsedImportRow,
  type ImportMethod,
  type ImportDefaults,
  type ImportRow,
  applyCountryDetections,
  rowsNeedingCountry,
  COUNTRY_NOT_DETECTED_ERROR,
} from '@/modules/prospect-batches/import-candidates-parser';
import { detectColumnMappings } from '@/modules/prospect-batches/import-column-mapping';
import { validateImportBatchInput } from '@/modules/prospect-batches/import-batch-schema';
import type {
  ImportColumnMapping,
  ImportColumnTarget,
  ImportClassificationPreviewRow,
  ClassificationFilterStatus,
  ClassificationSummaryStats,
  ManualClassificationCorrection,
  CatalogVersionState,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import {
  IMPORT_STEPS,
  IMPORT_STEP_TITLES,
  buildClassifiableRows,
  buildCreateImportBatchBody,
  buildDuplicateCheckItems,
  buildImportCandidates,
  computeHasMappingConflict,
  enrichMappingsWithSamples,
  buildRevalidationBody,
  describeImportDetection,
  getImportStepDescription,
  getStepperIndex,
  readCreateImportBatchResponse,
  selectClassifiedRowsForImport,
  summarizeClassificationRows,
  validateImportFile,
  type FileMethod,
  type ImportBatchStats,
  type ImportCatalogData,
  type ImportCatalogIndustry,
  type ImportDuplicateResult,
  type ImportIndustryOverride,
  type Step,
} from './import-candidates-helpers';
import { ImportCandidatesInputStep } from './import-candidates-input-step';
import {
  ImportClassificationLoading,
  ImportClassificationReview,
  ImportMappingResolution,
} from './import-candidates-classification-step';
import { ImportCandidatesPreviewStep } from './import-candidates-preview-step';
import {
  ImportClassificationFooter,
  ImportInputFooter,
  ImportMappingFooter,
  ImportPreviewFooter,
} from './import-candidates-footer';
import { mensajeDeError } from '@/lib/friendly-error';

// El drawer se queda con el estado y las llamadas; cada paso pinta su pantalla
// (`import-candidates-*-step.tsx`), el pie va en `import-candidates-footer.tsx`
// y lo que se calcula sin estado, en `import-candidates-helpers.ts`.

export type { ImportDuplicateResult } from './import-candidates-helpers';
export type { ImportRow } from '@/modules/prospect-batches/import-candidates-parser';

interface ImportCandidatesDrawerProps {
  /** El botón que abre el drawer. Se omite en modo controlado. */
  children?: React.ReactNode;
  /**
   * Modo controlado: quien lo monta decide cuándo está abierto (la barra de
   * acciones de la pantalla) y el drawer no pinta su propio botón.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// ── Componente principal ──────────────────────────────────────

export function ImportCandidatesDrawer({
  children,
  open: controlledOpen,
  onOpenChange,
}: ImportCandidatesDrawerProps) {
  const router = useRouter();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [step, setStep] = React.useState<Step>('input');
  const [fileMethod, setFileMethod] = React.useState<FileMethod>('paste');
  const [showGuide, setShowGuide] = React.useState(false);

  // Batch defaults

  // Input-step catalog loading state
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);

  // Input state
  const [pasteText, setPasteText] = React.useState('');
  const [fileText, setFileText] = React.useState('');
  const [fileXlsx, setFileXlsx] = React.useState<File | null>(null);
  const [detectedMethod, setDetectedMethod] = React.useState<ImportMethod>('csv');
  // El archivo elegido, para mostrarlo; lo que se procesa sigue siendo `fileText` / `fileXlsx`.
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [duplicates, setDuplicates] = React.useState<ImportDuplicateResult[]>([]);
  const [selectedRows, setSelectedRows] = React.useState<ImportRow[]>([]);
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [resultBatchId, setResultBatchId] = React.useState<string | null>(null);
  const [resultCount, setResultCount] = React.useState(0);
  const [importStats, setImportStats] = React.useState<ImportBatchStats | null>(null);

  // ── Mapping step state ─────────────────────────────────────────────────────
  const [columnMappings, setColumnMappings] = React.useState<ImportColumnMapping[]>([]);
  const [loadingClassification, setLoadingClassification] = React.useState(false);
  const [classificationError, setClassificationError] = React.useState<string | null>(null);

  // ── Classification step state ──────────────────────────────────────────────
  const [classificationRows, setClassificationRows] = React.useState<ImportClassificationPreviewRow[]>([]);
  const [classificationSummary, setClassificationSummary] = React.useState<ClassificationSummaryStats | null>(null);
  const [catalogVersion, setCatalogVersion] = React.useState<CatalogVersionState | null>(null);
  const [filterStatus, setFilterStatus] = React.useState<ClassificationFilterStatus>('all');
  const [needsMappingResolution, setNeedsMappingResolution] = React.useState(false);
  const [catalogData, setCatalogData] = React.useState<ImportCatalogData | null>(null);
  const [catalogVersionChanged, setCatalogVersionChanged] = React.useState(false);

  // ── Row selection state (classification step) ──────────────────────────────
  const [classificationSelectedIds, setClassificationSelectedIds] = React.useState<Set<number>>(new Set());

  function resetState() {
    setStep('input');
    setFileMethod('paste');
    setShowGuide(false);
    setCatalogLoading(false);
    setCatalogError(null);
    setPasteText('');
    setFileText('');
    setFileXlsx(null);
    setSelectedFile(null);
    setFileError(null);
    setDetectedMethod('csv');
    setPreview(null);
    setDuplicates([]);
    setLoadingPreview(false);
    setConfirming(false);
    setResultBatchId(null);
    setResultCount(0);
    setImportStats(null);
    setColumnMappings([]);
    setLoadingClassification(false);
    setClassificationError(null);
    setClassificationRows([]);
    setClassificationSummary(null);
    setCatalogVersion(null);
    setFilterStatus('all');
    setNeedsMappingResolution(false);
    setCatalogData(null);
    setCatalogVersionChanged(false);
    setClassificationSelectedIds(new Set());
  }

  function handleClose() {
    setOpen(false);
    setTimeout(resetState, 300);
  }

  function loadCatalog() {
    setCatalogLoading(true);
    setCatalogError(null);
    fetch('/api/prospect-batches/import-catalog')
      .then((res) => res.json() as Promise<{
        success: boolean;
        catalog?: { version: string; industries: ImportCatalogIndustry[] };
        message?: string;
      }>)
      .then((json) => {
        if (json.success && json.catalog) {
          setCatalogData({ industries: json.catalog.industries });
        } else {
          setCatalogError(json.message ?? 'No pudimos cargar el catálogo de industrias.');
        }
      })
      .catch(() => setCatalogError('No pudimos cargar el catálogo de industrias.'))
      .finally(() => setCatalogLoading(false));
  }

  // Load catalog when drawer opens; resets on close via resetState → setCatalogData(null)
  React.useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCatalog();
  }, [open]);


  // Mismas reglas de siempre (tipo y tamaño), ahora también al arrastrar el archivo.
  function handleFileSelected(file: File) {
    const validation = validateImportFile(file);
    if ('error' in validation) {
      toast.error(validation.error);
      setFileError(validation.error);
      return;
    }
    setFileError(null);
    setSelectedFile(file);

    if (validation.ext === 'xlsx') {
      setFileXlsx(file);
      setFileText('');
      setDetectedMethod('xlsx');
      return;
    }

    // CSV / TXT — se leen los bytes y se detecta la codificación: un CSV
    // guardado por Excel en Windows viene en Windows-1252 y leído como UTF-8
    // rompía tildes y eñes (AGENT1-AUDIT-WS5-IMPORT-CSV-1).
    setFileXlsx(null);
    setDetectedMethod('csv');
    file
      .arrayBuffer()
      .then((buffer) => setFileText(decodeImportTextFile(buffer)))
      .catch(() => {
        const message = 'No pudimos leer el archivo. Intenta de nuevo o pega el contenido.';
        toast.error(message);
        setFileError(message);
      });
  }

  function handleFileRemoved() {
    setSelectedFile(null);
    setFileError(null);
    setFileText('');
    setFileXlsx(null);
  }

  // AGENT1-IMPORT-NO-SUBINDUSTRY-1 — SellUp ya no maneja subindustrias: el
  // catálogo v2 no publica ninguna. Sin subindustrias en el catálogo, la
  // importación no las pide, no las muestra y no las envía.
  const subindustriesEnabled = React.useMemo(
    () => !!catalogData?.industries.some((i) => i.subindustries.length > 0),
    [catalogData],
  );

  // Dueña 13-11 — sin «País de referencia» ni «Industria por defecto»: cada fila
  // conserva lo suyo. El país que falte se detecta antes de la vista previa
  // (dominio, texto, IA); la industria que falte la asigna el rescate de Claude.
  const defaults: ImportDefaults = {
  };

  // ── Core classification runner — accepts params directly to avoid stale-closure issues ──
  async function runClassification(
    previewData: ImportPreview,
    mappings: ImportColumnMapping[],
  ) {
    setStep('classification');
    setLoadingClassification(true);
    setClassificationError(null);
    setNeedsMappingResolution(false);

    try {
      const classifiableRows = buildClassifiableRows(previewData, mappings, subindustriesEnabled);

      const res = await fetch('/api/prospect-batches/classify-import-rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: classifiableRows,
          defaults: {},
        }),
      });

      const result = await res.json() as {
        success: boolean;
        catalogVersion?: string;
        catalogVersionId?: string;
        rows?: ImportClassificationPreviewRow[];
        summary?: ClassificationSummaryStats;
        code?: string;
        message?: string;
      };

      if (!result.success || !result.rows) {
        throw new Error(result.message ?? 'Error al clasificar filas');
      }

      setClassificationRows(result.rows);
      setClassificationSummary(result.summary ?? {
        total: result.rows.length,
        valid: 0,
        normalized: 0,
        warning: 0,
        requiresReview: 0,
        invalid: 0,
      });
      setCatalogVersion({
        version: result.catalogVersion ?? 'unknown',
        isCurrent: true,
        lastChecked: new Date(),
      });
      setClassificationSelectedIds(new Set(result.rows.map((r) => r.rowNumber)));

      if (!catalogData) {
        const catalogRes = await fetch('/api/prospect-batches/import-catalog');
        if (catalogRes.ok) {
          const catalogJson = await catalogRes.json() as {
            success: boolean;
            catalog?: { version: string; industries: ImportCatalogIndustry[] };
          };
          if (catalogJson.success && catalogJson.catalog) {
            setCatalogData({ industries: catalogJson.catalog.industries });
          }
        }
      }
    } catch (err) {
      setClassificationError(err instanceof Error ? err.message : 'Error al clasificar');
      toast.error(mensajeDeError(err, 'No se pudieron clasificar los datos'));
      setStep('input');
    } finally {
      setLoadingClassification(false);
    }
  }

  // TAREA 3: handleBuildPreview usa fetch (no Server Action) → sin router.refresh automático
  async function handleBuildPreview() {
    if (fileMethod === 'paste' && !pasteText.trim()) {
      toast.error('Ingresa datos primero.');
      return;
    }
    if (fileMethod === 'file' && !fileText && !fileXlsx) {
      toast.error('Selecciona un archivo primero.');
      return;
    }

    setLoadingPreview(true);
    try {
      let parseResult: ParseResult;
      let effectiveMethod: ImportMethod;

      if (fileMethod === 'paste') {
        parseResult = parsePastedCandidates(pasteText, defaults);
        effectiveMethod = 'paste';
      } else if (fileXlsx) {
        parseResult = await parseXlsxCandidates(fileXlsx, defaults);
        effectiveMethod = 'xlsx';
      } else {
        parseResult = parseCsvCandidates(fileText, defaults);
        effectiveMethod = 'csv';
      }

      // IMPORT-FREE-FORMAT-1 — texto corrido: lo lee Claude en el servidor.
      if (parseResult.detection === 'needs_ai' && parseResult.source_text) {
        parseResult = await readImportTextWithAi(parseResult.source_text, defaults);
      }
      if (parseResult.rows.length === 0) {
        toast.error('No encontramos empresas', { description: 'Pega una tabla, una lista o un texto con nombres.' });
        return;
      }

      // Dueña 13-11 — sin «País de referencia»: el país de cada fila que no lo
      // trae se detecta (dominio, texto de la fila y, si falta, IA).
      parseResult = { ...parseResult, rows: await detectMissingCountries(parseResult.rows) };

      // Dueña 11-11: un archivo de más de 500 filas se cortaba sin avisar.
      const truncation = importTruncationNotice(parseResult);
      if (truncation) toast.warning(truncation.title, { description: truncation.description, duration: 12000 });

      setDetectedMethod(effectiveMethod);
      const built = buildImportPreview(parseResult);
      setPreview(built);

      // Detect column mappings from parsed headers for the mapping step
      const allHeaders = [...built.recognized_columns, ...built.unrecognized_columns];
      const initialMappings = detectColumnMappings(allHeaders, []);
      const enrichedMappings = enrichMappingsWithSamples(initialMappings, built);
      setColumnMappings(enrichedMappings);

      const validForCheck = buildDuplicateCheckItems(built);

      if (validForCheck.length > 0) {
        // Fetch en lugar de Server Action → Next.js no hace router.refresh automático
        const res = await fetch('/api/prospect-batches/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: validForCheck }),
        });
        if (!res.ok) throw new Error('Error al verificar duplicados');
        const dupResults: ImportDuplicateResult[] = await res.json() as ImportDuplicateResult[];
        setDuplicates(dupResults);
      } else {
        setDuplicates([]);
      }

      // Auto-proceed: skip mapping when detection is unambiguous
      const hasConflict = computeHasMappingConflict(enrichedMappings);
      if (!hasConflict) {
        await runClassification(built, enrichedMappings);
      } else {
        setNeedsMappingResolution(true);
        setStep('classification');
      }
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron leer los datos'));
    } finally {
      setLoadingPreview(false);
    }
  }

  /** Claude separa las empresas de un texto corrido; las filas pasan por la misma validación. */
  async function detectMissingCountries(rows: ImportRow[]): Promise<ImportRow[]> {
    const pending = rowsNeedingCountry(rows);
    if (pending.length === 0) return rows;
    const toastId = toast.loading(`Detectando el país de ${pending.length} ${pending.length === 1 ? 'empresa' : 'empresas'}…`);
    try {
      const res = await fetch('/api/prospect-batches/detect-import-countries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: pending.map((row) => ({
            index: row.index,
            company_name: row.raw.company_name,
            website: row.raw.website,
            city: row.raw.city,
            region: row.raw.region,
            description: row.raw.description,
            notes: row.raw.notes,
            tax_identifier: row.raw.tax_identifier,
          })),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; detections?: Parameters<typeof applyCountryDetections>[1]; aiUnavailable?: boolean }
        | null;
      const detections = res.ok && body?.success ? body.detections ?? [] : [];
      const patched = applyCountryDetections(rows, detections);
      const missing = patched.filter((row) => row.errors.includes(COUNTRY_NOT_DETECTED_ERROR)).length;
      if (missing > 0) {
        toast.warning(`A ${missing} ${missing === 1 ? 'empresa' : 'empresas'} no les pudimos detectar el país`, {
          id: toastId,
          description: body?.aiUnavailable
            ? 'La IA no está disponible ahora. Escribe el país de esas filas en el archivo.'
            : 'Escribe el país de esas filas en el archivo; el resto sigue.',
          duration: 10000,
        });
      } else {
        toast.success('País detectado en todas las empresas', { id: toastId });
      }
      return patched;
    } catch {
      toast.error('No pudimos detectar el país de algunas filas', { id: toastId });
      return applyCountryDetections(rows, []);
    }
  }

  async function readImportTextWithAi(text: string, rowDefaults: ImportDefaults): Promise<ParseResult> {
    const toastId = toast.loading('Leyendo las empresas del texto con IA…');
    try {
      const res = await fetch('/api/prospect-batches/extract-import-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; rows?: ParsedImportRow[]; inputTruncated?: boolean; message?: string }
        | null;
      if (!res.ok || !body?.success) {
        throw new Error(body?.message ?? 'No se pudo leer el texto con IA.');
      }
      if (body.inputTruncated) {
        toast.warning('El texto era muy largo: se leyó sólo la primera parte.');
      }
      return buildParseResultFromParsedRows(body.rows ?? [], rowDefaults, 'ai_extracted');
    } finally {
      toast.dismiss(toastId);
    }
  }

  // ── Handle column mapping changes (used when ambiguous block is shown) ──────
  function handleMappingChange(sourceColumn: string, newTarget: ImportColumnTarget) {
    setColumnMappings((prev) =>
      prev.map((m) =>
        m.sourceColumn === sourceColumn
          ? { ...m, targetField: newTarget, detectedAutomatically: false }
          : m,
      ),
    );
  }

  // ── Reclassify after user fixes ambiguous mappings ─────────────────────────
  async function handleBuildClassification() {
    if (!preview) return;
    await runClassification(preview, columnMappings);
  }

  // ── Handle correction save ─────────────────────────────────────────────────
  async function handleSaveCorrection(
    correction: ManualClassificationCorrection,
    contextRow: ImportClassificationPreviewRow,
  ) {
    const res = await fetch('/api/prospect-batches/revalidate-classification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRevalidationBody(correction, contextRow)),
    });

    const result = await res.json() as {
      success: boolean;
      row?: ImportClassificationPreviewRow;
      code?: string;
      message?: string;
    };

    if (!result.success || !result.row) {
      if (result.code === 'catalog_version_changed') {
        setCatalogVersionChanged(true);
        throw new Error('La versión del catálogo ha cambiado. Revalida el archivo antes de importar.');
      }
      throw new Error(result.message ?? 'Error al revalidar');
    }

    // Update the row in state and recompute the summary from the SAME rows
    // (antes se recalculaba con un `classificationRows` viejo: en la corrección
    // masiva el resumen quedaba desfasado).
    const savedRow = result.row;
    setClassificationRows((prev) => {
      const next = prev.map((r) => (r.rowNumber === correction.rowNumber ? savedRow : r));
      setClassificationSummary(summarizeClassificationRows(next));
      return next;
    });
  }

  // ── Handle bulk correction ─────────────────────────────────────────────────
  async function handleBulkCorrection(
    group: ImportClassificationPreviewRow[],
    industryId: string,
    subindustryId: string | null,
  ) {
    if (!catalogVersion) return;
    for (const row of group) {
      await handleSaveCorrection(
        {
          rowNumber: row.rowNumber,
          industryId,
          subindustryId,
          catalogVersion: catalogVersion.version,
        },
        row, // Pass each row as its own context
      );
    }
  }

  // Crea el lote con las filas elegidas. Usa fetch (no Server Action) → sin
  // router.refresh automático: se cierra el drawer, se avisa y se refresca.
  // Si el servidor rechaza la importación, se muestra su mensaje y el drawer
  // sigue abierto con la revisión intacta (AGENT1-AUDIT-WS5-IMPORT-OVERRIDES-1).
  async function submitImport(
    rowsToImport: ImportRow[],
    includeSubindustry: boolean,
    overrides?: ReadonlyMap<number, ImportIndustryOverride>,
  ) {
    if (!preview) return;
    const body = buildCreateImportBatchBody({
      importType: detectedMethod,
      candidates: buildImportCandidates(rowsToImport, includeSubindustry, overrides),
      preview,
      defaults: {
        country: undefined,
        country_code: undefined,
        industry: undefined,
        subindustry: undefined,
      },
    });
    // El mismo contrato que aplica el servidor, antes de enviar.
    const inputCheck = validateImportBatchInput(body);
    if (!inputCheck.ok) {
      toast.error(inputCheck.message);
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch('/api/prospect-batches/create-import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const outcome = readCreateImportBatchResponse(res.ok, await res.json().catch(() => null));
      if (!outcome.ok) {
        toast.error(outcome.message);
        return;
      }
      setResultBatchId(outcome.batchId);
      setResultCount(outcome.candidatesCreated);
      setImportStats(outcome.stats);
      handleClose();
      toast.success(`${outcome.candidatesCreated} candidato${outcome.candidatesCreated !== 1 ? 's' : ''} importado${outcome.candidatesCreated !== 1 ? 's' : ''}`);
      if (outcome.pendingRevalidationCount > 0) {
        toast.warning(
          `${outcome.pendingRevalidationCount} fila${outcome.pendingRevalidationCount !== 1 ? 's' : ''} sin validar: revalida el lote`,
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudieron importar las empresas'));
    } finally {
      setConfirming(false);
    }
  }

  // ── Handle final confirmation — only imports explicitly selected rows ────────
  async function handleConfirmWithClassification() {
    if (!preview || !catalogVersion) return;
    // Import only the rows the user has selected (blocking logic already prevents
    // this being called when selected rows have requires_review/invalid status),
    // with the manual industry corrections made in the review.
    const { rows: rowsToImport, overrides } = selectClassifiedRowsForImport(
      preview,
      classificationRows,
      classificationSelectedIds,
    );

    if (rowsToImport.length === 0) {
      toast.error('Selecciona al menos una fila para importar.');
      return;
    }

    await submitImport(rowsToImport, subindustriesEnabled, overrides);
  }

  // handleConfirm usa fetch (no Server Action) → sin router.refresh automático
  async function handleConfirm() {
    if (!preview) return;
    // Import only selected rows that are valid (no errors)
    const rowsToImport = selectedRows.filter((r) => r.status !== 'error');
    if (rowsToImport.length === 0) {
      toast.error('No hay filas seleccionadas para importar.');
      return;
    }
    await submitImport(rowsToImport, false);
  }

  const hasInput = fileMethod === 'paste'
    ? pasteText.trim().length > 2
    : (fileText.length > 0 || fileXlsx !== null);

  const duplicateMap = React.useMemo(() => {
    const map = new Map<number, ImportDuplicateResult>();
    for (const d of duplicates) map.set(d.index, d);
    return map;
  }, [duplicates]);

  const exactDuplicateCount = duplicates.filter((d) => d.duplicate_status === 'exact_duplicate').length;
  const possibleDuplicateCount = duplicates.filter((d) => d.duplicate_status === 'possible_duplicate').length;

  // ── Selection-aware classification logic ───────────────────────────────────
  const selectedBlockingCount = React.useMemo(() => {
    return classificationRows.filter(
      (r) =>
        classificationSelectedIds.has(r.rowNumber) &&
        (r.validationStatus === 'requires_review' || r.validationStatus === 'invalid'),
    ).length;
  }, [classificationRows, classificationSelectedIds]);

  const canImportSelected =
    classificationSelectedIds.size > 0 && selectedBlockingCount === 0 && !catalogVersionChanged;

  const stepperCurrent = getStepperIndex(step, needsMappingResolution);

  const importablePreviewCount = selectedRows.filter((r) => r.status !== 'error').length;
  const backToInput = () => setStep('input');

  const footer =
    step === 'input' ? (
      <ImportInputFooter
        onCancel={handleClose}
        onBuildPreview={handleBuildPreview}
        disabled={!hasInput || loadingPreview}
        loading={loadingPreview}
      />
    ) : step === 'classification' && needsMappingResolution ? (
      <ImportMappingFooter
        onBack={backToInput}
        onReclassify={handleBuildClassification}
        disabled={loadingClassification || computeHasMappingConflict(columnMappings)}
        loading={loadingClassification}
      />
    ) : step === 'classification' && !loadingClassification && classificationSummary ? (
      <ImportClassificationFooter
        onBack={backToInput}
        onConfirm={handleConfirmWithClassification}
        selectedCount={classificationSelectedIds.size}
        totalCount={classificationRows.length}
        blockingCount={selectedBlockingCount}
        canImport={canImportSelected}
        confirming={confirming}
      />
    ) : step === 'preview' && preview ? (
      <ImportPreviewFooter
        onBack={backToInput}
        onConfirm={handleConfirm}
        selectedCount={selectedRows.length}
        importableCount={importablePreviewCount}
        errorCount={preview.errors}
        confirming={confirming}
      />
    ) : null;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => {
        if (v) setOpen(true);
        else handleClose();
      }}
      trigger={isControlled ? undefined : children}
      title={IMPORT_STEP_TITLES[step]}
      description={getImportStepDescription({
        step,
        needsMappingResolution,
        loadingClassification,
        resultCount,
      })}
      icon={
        step === 'success'
          ? <CheckCircle2 className="h-4 w-4 text-success" />
          : step === 'classification'
          ? <Search className="h-4 w-4" />
          : step === 'preview'
          ? <FileText className="h-4 w-4" />
          : <Upload className="h-4 w-4" />
      }
      className={cn(
        "transition-all duration-300",
        step === 'preview' || step === 'classification'
          ? "!w-full sm:!w-[90vw] sm:!max-w-[90vw]"
          : "sm:!max-w-[500px] sm:w-[500px] w-full"
      )}
      // Cada paso trae su barra (`FooterBar`), igual a la de DrawerShell.
      footerBare
      footer={footer}
    >
      {/* Import loading overlay — positioned over the scrollable content area */}
      {confirming && (
        <ImportLoadingOverlay
          open={confirming}
          total={preview ? preview.valid + preview.warnings_only : 0}
        />
      )}

      {/* Progreso del flujo: archivo → columnas → clasificación → revisión */}
      {step !== 'success' && !confirming && (
        <Stepper
          steps={IMPORT_STEPS}
          current={stepperCurrent}
          size="sm"
          className="mb-5 shrink-0"
        />
      )}

      {/* Cada paso entra con un fade corto (key = paso): antes se cambiaba de golpe. */}
      <div key={step} className="flex min-h-0 flex-1 flex-col animate-su-tab-in">
        {step === 'input' && !confirming && (
          <ImportCandidatesInputStep
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            onRetryCatalog={loadCatalog}
            fileMethod={fileMethod}
            onFileMethodChange={setFileMethod}
            pasteText={pasteText}
            onPasteTextChange={setPasteText}
            selectedFile={selectedFile}
            fileError={fileError}
            onFileSelected={handleFileSelected}
            onFileRemoved={handleFileRemoved}
            showGuide={showGuide}
            onShowGuideChange={setShowGuide}
          />
        )}

        {step === 'classification' && loadingClassification && <ImportClassificationLoading />}

        {step === 'classification' && needsMappingResolution && (
          <ImportMappingResolution columnMappings={columnMappings} onMappingChange={handleMappingChange} />
        )}

        {step === 'classification' && !loadingClassification && !needsMappingResolution && classificationSummary && (
          <ImportClassificationReview
            rows={classificationRows}
            summary={classificationSummary}
            catalog={catalogData}
            catalogVersion={catalogVersion}
            catalogVersionChanged={catalogVersionChanged}
            onRevalidate={() => {
              setCatalogVersionChanged(false);
              void handleBuildClassification();
            }}
            classificationError={classificationError}
            detectionNotice={
              preview ? describeImportDetection(preview.detection, preview.column_guesses, preview.total) : null
            }
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
            selectedIds={classificationSelectedIds}
            onSelectionChange={setClassificationSelectedIds}
            showSubindustry={subindustriesEnabled}
            onSaveCorrection={handleSaveCorrection}
            onBulkCorrection={handleBulkCorrection}
          />
        )}

        {step === 'preview' && preview && (
          <ImportCandidatesPreviewStep
            preview={preview}
            duplicateMap={duplicateMap}
            exactDuplicateCount={exactDuplicateCount}
            possibleDuplicateCount={possibleDuplicateCount}
            onBack={backToInput}
            onSelectionChange={setSelectedRows}
          />
        )}
      </div>
    </DrawerShell>
  );
}
