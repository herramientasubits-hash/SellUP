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
  buildImportPreview,
  type ImportPreview,
  type ImportMethod,
  type ImportDefaults,
  type ImportRow,
} from '@/modules/prospect-batches/import-candidates-parser';
import { LATAM_COUNTRIES } from '@/modules/accounts/types';
import { detectColumnMappings } from '@/modules/prospect-batches/import-column-mapping';
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
  getImportStepDescription,
  getStepperIndex,
  summarizeClassificationRows,
  validateImportFile,
  type FileMethod,
  type ImportBatchStats,
  type ImportCatalogData,
  type ImportCatalogIndustry,
  type ImportDuplicateResult,
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
  const [selectedCountryCode, setSelectedCountryCode] = React.useState('');
  const [selectedIndustry, setSelectedIndustry] = React.useState('');
  const [selectedSubindustryId, setSelectedSubindustryId] = React.useState('');

  // Input-step catalog loading state
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);
  const [subindustryCountryWarning, setSubindustryCountryWarning] = React.useState(false);

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
    setSelectedCountryCode('');
    setSelectedIndustry('');
    setSelectedSubindustryId('');
    setCatalogLoading(false);
    setCatalogError(null);
    setSubindustryCountryWarning(false);
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

  function handleCountryChange(value: string | null) {
    const code = value ?? '';
    setSubindustryCountryWarning(false);
    if (selectedSubindustryId && selectedSubindustryId !== '__none__' && catalogData && code) {
      const industry = catalogData.industries.find((i) => i.id === selectedIndustry);
      const sub = industry?.subindustries.find((s) => s.id === selectedSubindustryId);
      if (sub && sub.countries && sub.countries.length > 0 && !sub.countries.includes(code)) {
        setSelectedSubindustryId('');
        setSubindustryCountryWarning(true);
      }
    }
    setSelectedCountryCode(code);
  }

  function handleIndustryChange(value: string) {
    setSelectedIndustry(value ?? '');
    setSelectedSubindustryId('');
    setSubindustryCountryWarning(false);
  }

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

    // CSV
    setFileXlsx(null);
    setDetectedMethod('csv');
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileText((ev.target?.result as string) ?? '');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleFileRemoved() {
    setSelectedFile(null);
    setFileError(null);
    setFileText('');
    setFileXlsx(null);
  }

  const selectedCountry = LATAM_COUNTRIES.find((c) => c.code === selectedCountryCode);
  const selectedIndustryName = catalogData?.industries.find((i) => i.id === selectedIndustry)?.name;
  // AGENT1-IMPORT-NO-SUBINDUSTRY-1 — SellUp ya no maneja subindustrias: el
  // catálogo v2 no publica ninguna. Sin subindustrias en el catálogo, la
  // importación no las pide, no las muestra y no las envía.
  const subindustriesEnabled = React.useMemo(
    () => !!catalogData?.industries.some((i) => i.subindustries.length > 0),
    [catalogData],
  );

  const selectedSubindustryName = (selectedSubindustryId && selectedSubindustryId !== '__none__')
    ? catalogData?.industries.find((i) => i.id === selectedIndustry)?.subindustries.find((s) => s.id === selectedSubindustryId)?.name
    : undefined;

  const industryOptions = React.useMemo(() => {
    if (!catalogData) return [];
    return catalogData.industries.map((i) => ({ value: i.id, label: i.name }));
  }, [catalogData]);

  const subindustryOptions = React.useMemo(() => {
    if (!catalogData || !selectedIndustry || !selectedCountryCode) return [];
    const industry = catalogData.industries.find((i) => i.id === selectedIndustry);
    if (!industry) return [];
    const filtered = industry.subindustries.filter(
      (sub) => !sub.countries || sub.countries.length === 0 || sub.countries.includes(selectedCountryCode),
    );
    return [
      { value: '__none__', label: 'Sin subindustria por defecto' },
      ...filtered.map((sub) => ({ value: sub.id, label: sub.name })),
    ];
  }, [catalogData, selectedIndustry, selectedCountryCode]);

  const defaults: ImportDefaults = {
    country: selectedCountry?.name,
    countryCode: selectedCountryCode || undefined,
    industry: selectedIndustryName || undefined,
    subindustry: selectedSubindustryName || undefined,
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
          defaults: {
            country_code: selectedCountryCode || undefined,
            industry: selectedIndustryName || undefined,
            subindustry: selectedSubindustryName || undefined,
          },
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
      toast.error(err instanceof Error ? err.message : 'Error al clasificar');
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
    if (!selectedCountryCode) {
      toast.error('Selecciona el país del lote antes de previsualizar.');
      return;
    }

    setLoadingPreview(true);
    try {
      let parseResult;
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
      toast.error(err instanceof Error ? err.message : 'Error al procesar los datos');
    } finally {
      setLoadingPreview(false);
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

    // Update the row in state
    setClassificationRows((prev) =>
      prev.map((r) => (r.rowNumber === correction.rowNumber ? result.row! : r)),
    );

    // Recompute summary
    const newRows = classificationRows.map((r) =>
      r.rowNumber === correction.rowNumber ? result.row! : r,
    );
    const newSummary = summarizeClassificationRows(newRows);
    setClassificationSummary(newSummary);
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
  async function submitImport(rowsToImport: ImportRow[], includeSubindustry: boolean) {
    if (!preview) return;
    setConfirming(true);
    try {
      const res = await fetch('/api/prospect-batches/create-import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildCreateImportBatchBody({
            importType: detectedMethod,
            candidates: buildImportCandidates(rowsToImport, includeSubindustry),
            preview,
            defaults: {
              country: selectedCountry?.name,
              country_code: selectedCountryCode || undefined,
              industry: selectedIndustryName || undefined,
              subindustry: selectedSubindustryName || undefined,
            },
          }),
        ),
      });

      const result = await res.json() as {
        batchId: string;
        candidatesCreated: number;
        stats: ImportBatchStats;
      };
      setResultBatchId(result.batchId);
      setResultCount(result.candidatesCreated);
      setImportStats(result.stats || null);
      handleClose();
      toast.success(`Se importaron ${result.candidatesCreated} candidato${result.candidatesCreated !== 1 ? 's' : ''} exitosamente.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al importar prospectos');
    } finally {
      setConfirming(false);
    }
  }

  // ── Handle final confirmation — only imports explicitly selected rows ────────
  async function handleConfirmWithClassification() {
    if (!preview || !catalogVersion) return;
    // Import only the rows the user has selected (blocking logic already prevents
    // this being called when selected rows have requires_review/invalid status)
    const rowsToImport = classificationRows
      .filter((r) => classificationSelectedIds.has(r.rowNumber))
      .map((r) => {
        const originalRow = preview.rows.find((pr) => pr.index === r.rowNumber - 1);
        return originalRow;
      })
      .filter((r): r is ImportRow => r !== undefined);

    if (rowsToImport.length === 0) {
      toast.error('Selecciona al menos una fila para importar.');
      return;
    }

    await submitImport(rowsToImport, subindustriesEnabled);
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

      {step === 'input' && !confirming && (
        <ImportCandidatesInputStep
          countryCode={selectedCountryCode}
          onCountryChange={handleCountryChange}
          industryId={selectedIndustry}
          onIndustryChange={handleIndustryChange}
          industryOptions={industryOptions}
          subindustriesEnabled={subindustriesEnabled}
          subindustryId={selectedSubindustryId}
          onSubindustryChange={(v) => {
            setSelectedSubindustryId(v ?? '');
            setSubindustryCountryWarning(false);
          }}
          subindustryOptions={subindustryOptions}
          subindustryCountryWarning={subindustryCountryWarning}
          catalogReady={!!catalogData}
          catalogEmpty={!!catalogData && catalogData.industries.length === 0}
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
          countryLabel={selectedCountryCode ? (selectedCountry?.name ?? selectedCountryCode) : undefined}
          industryLabel={selectedIndustry ? (selectedIndustryName ?? selectedIndustry) : undefined}
          subindustryLabel={
            selectedSubindustryId && selectedSubindustryId !== '__none__' ? selectedSubindustryName : undefined
          }
          onBack={backToInput}
          onSelectionChange={setSelectedRows}
        />
      )}
    </DrawerShell>
  );
}
