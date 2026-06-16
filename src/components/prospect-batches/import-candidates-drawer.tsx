'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload,
  ClipboardPaste,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  ArrowLeft,
  GitMerge,
  Info,
  Copy,
  Search,
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  Filter,
} from 'lucide-react';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ImportLoadingOverlay } from '@/components/prospect-batches/import-loading-overlay';
import { ImportPreviewDataTable } from '@/components/prospect-batches/import-preview-data-table';
import { ImportClassificationTable } from '@/components/prospect-batches/import-classification-table';
import { ImportClassificationSummary } from '@/components/prospect-batches/import-classification-summary';
import { ImportColumnMappingTable } from '@/components/prospect-batches/import-column-mapping-table';
import {
  parsePastedCandidates,
  parseCsvCandidates,
  parseXlsxCandidates,
  buildImportPreview,
  getValidRows,
  EXTERNAL_IMPORT_CONTRACT,
  type ImportPreview,
  type ImportMethod,
  type ImportDefaults,
  type ImportRow,
} from '@/modules/prospect-batches/import-candidates-parser';
import {
  LATAM_COUNTRIES,
} from '@/modules/accounts/types';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';
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

// ── Tipos locales ─────────────────────────────────────────────

type Step = 'input' | 'classification' | 'preview' | 'success';
type FileMethod = 'paste' | 'file';

export interface ImportDuplicateResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

export type { ImportRow } from '@/modules/prospect-batches/import-candidates-parser';

// ── Classification value normalization (client-side pre-processing) ────────────
// Handles known aliases not yet in the catalog: Tech→Tecnología, etc.

function normalizeIndustryRaw(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (v === 'tech') return 'Tecnología';
  if (v === 'cyber security' || v === 'cybersecurity') return 'Ciberseguridad';
  return val;
}

function normalizeSubindustryRaw(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (['vacío', 'vacio', 'n/a', 'na', '-', 'null', 'none', ''].includes(v)) return undefined;
  return val;
}

function computeHasMappingConflict(mappings: ImportColumnMapping[]): boolean {
  const counts = new Map<string, number>();
  for (const m of mappings) {
    if (m.targetField === 'ignore') continue;
    counts.set(m.targetField, (counts.get(m.targetField) ?? 0) + 1);
  }
  return (counts.get('industry') ?? 0) > 1 || (counts.get('subindustry') ?? 0) > 1;
}

interface ImportCandidatesDrawerProps {
  children: React.ReactNode;
}

// ── Componente principal ──────────────────────────────────────

export function ImportCandidatesDrawer({ children }: ImportCandidatesDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
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
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [fileText, setFileText] = React.useState('');
  const [fileXlsx, setFileXlsx] = React.useState<File | null>(null);
  const [detectedMethod, setDetectedMethod] = React.useState<ImportMethod>('csv');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Preview state
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [duplicates, setDuplicates] = React.useState<ImportDuplicateResult[]>([]);
  const [selectedRows, setSelectedRows] = React.useState<ImportRow[]>([]);
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [resultBatchId, setResultBatchId] = React.useState<string | null>(null);
  const [resultCount, setResultCount] = React.useState(0);
  const [importStats, setImportStats] = React.useState<{
    totalProcessed: number;
    importedCount: number;
    errorsCount: number;
    alreadyCompleteCount: number;
    autoEnrichPendingCount: number;
    duplicateCount: number;
    possibleDuplicateCount: number;
  } | null>(null);

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
  const [catalogData, setCatalogData] = React.useState<{ industries: Array<{ id: string; name: string; slug: string; aliases?: string[]; subindustries: Array<{ id: string; name: string; slug: string; aliases?: string[]; countries?: string[] }> }> } | null>(null);
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
    setFileName(null);
    setFileText('');
    setFileXlsx(null);
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
        catalog?: {
          version: string;
          industries: Array<{
            id: string; name: string; slug: string; aliases?: string[];
            subindustries: Array<{ id: string; name: string; slug: string; aliases?: string[]; countries?: string[] }>;
          }>;
        };
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsm') {
      toast.error('Por seguridad, sube el archivo como .xlsx o CSV. Los archivos .xlsm no son soportados.');
      e.target.value = '';
      return;
    }

    if (ext !== 'csv' && ext !== 'xlsx') {
      toast.error('Formato no soportado. Usa CSV o XLSX.');
      e.target.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('El archivo supera 2 MB. Usa un archivo más pequeño o pega el contenido.');
      e.target.value = '';
      return;
    }

    if (ext === 'xlsx') {
      setFileXlsx(file);
      setFileText('');
      setFileName(file.name);
      setDetectedMethod('xlsx');
      return;
    }

    // CSV
    setFileXlsx(null);
    setDetectedMethod('csv');
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFileText((ev.target?.result as string) ?? '');
      setFileName(file.name);
    };
    reader.readAsText(file, 'UTF-8');
  }

  const selectedCountry = LATAM_COUNTRIES.find((c) => c.code === selectedCountryCode);
  const selectedIndustryName = catalogData?.industries.find((i) => i.id === selectedIndustry)?.name;
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
    const origIndustryCol = mappings.find((m) => m.targetField === 'industry')?.sourceColumn ?? null;
    const origSubindustryCol = mappings.find((m) => m.targetField === 'subindustry')?.sourceColumn ?? null;

    setStep('classification');
    setLoadingClassification(true);
    setClassificationError(null);
    setNeedsMappingResolution(false);

    try {
      const classifiableRows = previewData.rows
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
            subindustry: normalizeSubindustryRaw(subindustryRaw),
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
            catalog?: { version: string; industries: Array<{ id: string; name: string; slug: string; aliases?: string[]; subindustries: Array<{ id: string; name: string; slug: string; aliases?: string[]; countries?: string[] }> }> };
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
      const enrichedMappings = initialMappings.map((m) => {
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
      setColumnMappings(enrichedMappings);

      const validForCheck = getValidRows(built).map((r) => ({
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
      body: JSON.stringify({
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
      }),
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
    const newSummary: ClassificationSummaryStats = {
      total: newRows.length,
      valid: newRows.filter((r) => r.validationStatus === 'valid').length,
      normalized: newRows.filter((r) => r.validationStatus === 'normalized').length,
      warning: newRows.filter((r) => r.validationStatus === 'warning').length,
      requiresReview: newRows.filter((r) => r.validationStatus === 'requires_review').length,
      invalid: newRows.filter((r) => r.validationStatus === 'invalid').length,
    };
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

    setConfirming(true);
    try {
      const candidates = rowsToImport.map((r) => ({
        company_name: r.raw.company_name,
        country: r.raw.country,
        country_code: r.resolved_country_code ?? r.raw.country_code,
        industry: r.raw.industry,
        subindustry: r.raw.subindustry,
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

      const res = await fetch('/api/prospect-batches/create-import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          import_type: detectedMethod,
          candidates,
          recognized_columns: preview.recognized_columns,
          unrecognized_columns: preview.unrecognized_columns,
          total_rows: preview.total,
          valid_rows: preview.valid,
          invalid_rows: preview.errors,
          warning_rows: preview.warnings_only,
          defaults: {
            country: selectedCountry?.name,
            country_code: selectedCountryCode || undefined,
            industry: selectedIndustryName || undefined,
            subindustry: selectedSubindustryName || undefined,
          },
        }),
      });

      const result = await res.json() as {
        batchId: string;
        candidatesCreated: number;
        stats: {
          totalProcessed: number;
          importedCount: number;
          errorsCount: number;
          alreadyCompleteCount: number;
          autoEnrichPendingCount: number;
          duplicateCount: number;
          possibleDuplicateCount: number;
        };
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

  // handleConfirm usa fetch (no Server Action) → sin router.refresh automático
  async function handleConfirm() {
    if (!preview) return;
    // Import only selected rows that are valid (no errors)
    const rowsToImport = selectedRows.filter((r) => r.status !== 'error');
    if (rowsToImport.length === 0) {
      toast.error('No hay filas seleccionadas para importar.');
      return;
    }
    setConfirming(true);
    try {
      const candidates = rowsToImport.map((r) => ({
        company_name: r.raw.company_name,
        country: r.raw.country,
        country_code: r.resolved_country_code ?? r.raw.country_code,
        website: r.raw.website,
        industry: r.raw.industry,
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

      const res = await fetch('/api/prospect-batches/create-import-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          import_type: detectedMethod,
          candidates,
          recognized_columns: preview.recognized_columns,
          unrecognized_columns: preview.unrecognized_columns,
          total_rows: preview.total,
          valid_rows: preview.valid,
          invalid_rows: preview.errors,
          warning_rows: preview.warnings_only,
          defaults: {
            country: selectedCountry?.name,
            country_code: selectedCountryCode || undefined,
            industry: selectedIndustryName || undefined,
            subindustry: selectedSubindustryName || undefined,
          },
        }),
      });

      const result = await res.json() as {
        batchId: string;
        candidatesCreated: number;
        stats: {
          totalProcessed: number;
          importedCount: number;
          errorsCount: number;
          alreadyCompleteCount: number;
          autoEnrichPendingCount: number;
          duplicateCount: number;
          possibleDuplicateCount: number;
        };
      };
      setResultBatchId(result.batchId);
      setResultCount(result.candidatesCreated);
      setImportStats(result.stats || null);
      // Close drawer and show success toast
      handleClose();
      toast.success(`Se importaron ${result.candidatesCreated} candidato${result.candidatesCreated !== 1 ? 's' : ''} exitosamente.`);
      // Refresh data in background
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al importar prospectos');
    } finally {
      setConfirming(false);
    }
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

  // Filter options for classification step tabs (rendered in parent, not in table)
  const classificationFilterOptions: Array<{
    value: ClassificationFilterStatus;
    label: string;
    count: number;
  }> = [
    { value: 'all', label: 'Todas', count: classificationSummary?.total ?? 0 },
    { value: 'valid', label: 'Listas', count: classificationSummary?.valid ?? 0 },
    { value: 'normalized', label: 'Normalizadas', count: classificationSummary?.normalized ?? 0 },
    { value: 'warning', label: 'Con advertencias', count: classificationSummary?.warning ?? 0 },
    { value: 'requires_review', label: 'Requieren revisión', count: classificationSummary?.requiresReview ?? 0 },
  ];

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) handleClose();
      }}
      trigger={children}
      title={
        step === 'input'
          ? "Importar candidatos externos"
          : step === 'classification'
          ? "Previsualización y clasificación"
          : step === 'preview'
          ? "Vista previa de importación"
          : "Candidatos importados para revisión"
      }
      description={
        step === 'input'
          ? "Carga empresas encontradas en Gemini, hojas de cálculo, eventos o investigación externa. SellUp validará duplicidad y las dejará listas para revisión antes de crear cuentas."
          : step === 'classification'
          ? needsMappingResolution
            ? "Detectamos columnas con mapeo ambiguo. Corrígelas antes de clasificar."
            : loadingClassification
              ? "Clasificando industrias y subindustrias contra el catálogo oficial…"
              : "Revisa los datos detectados, corrige la clasificación cuando sea necesario y selecciona las empresas que quieres importar."
          : step === 'preview'
          ? "Revisa los datos antes de importar. Solo se importarán filas válidas y con advertencias."
          : `SellUp importó ${resultCount} prospecto${resultCount !== 1 ? 's' : ''} externo${resultCount !== 1 ? 's' : ''}. Revísalos antes de aprobarlos como cuentas.`
      }
      icon={
        step === 'success'
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : step === 'classification'
          ? <Search className="h-4 w-4 text-su-brand" />
          : step === 'preview'
          ? <FileText className="h-4 w-4 text-su-brand" />
          : <Upload className="h-4 w-4 text-su-brand" />
      }
      className={cn(
        "transition-all duration-300",
        step === 'preview' || step === 'classification'
          ? "sm:!max-w-[90vw] sm:w-[90vw] w-full"
          : "sm:!max-w-[500px] sm:w-[500px] w-full"
      )}
      footer={
        step === 'success' ? null : (
          <div className="shrink-0 border-t border-border/50 px-7 py-4">
            {step === 'input' && (
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={handleClose} className="text-xs">
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleBuildPreview}
                  disabled={!hasInput || loadingPreview}
                  size="sm"
                  className="gap-2 text-xs"
                >
                  {loadingPreview ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Procesando…
                    </>
                  ) : (
                    'Previsualizar y clasificar'
                  )}
                </Button>
              </div>
            )}

            {step === 'classification' && needsMappingResolution && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-[11px] text-muted-foreground flex-1">
                  Corrige el mapeo de columnas y luego reclasifica.
                </p>
                <div className="flex items-center gap-2 justify-end shrink-0">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep('input')} className="text-xs">
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    Volver
                  </Button>
                  <Button
                    type="button"
                    onClick={handleBuildClassification}
                    disabled={loadingClassification || computeHasMappingConflict(columnMappings)}
                    size="sm"
                    className="gap-2 text-xs font-semibold bg-su-brand text-white hover:bg-su-brand/90"
                  >
                    {loadingClassification ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Clasificando…
                      </>
                    ) : (
                      <>
                        Reclasificar
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {step === 'classification' && !needsMappingResolution && !loadingClassification && classificationSummary && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-left flex-1 space-y-1">
                  {classificationSelectedIds.size === 0 && (
                    <p className="text-[11px] text-muted-foreground font-medium">
                      Selecciona al menos una fila para importar.
                    </p>
                  )}
                  {classificationSelectedIds.size > 0 && selectedBlockingCount > 0 && (
                    <p className="text-[11px] text-destructive font-medium">
                      Corrige o deselecciona {selectedBlockingCount} fila{selectedBlockingCount !== 1 ? 's' : ''} para continuar.
                    </p>
                  )}
                  {classificationSelectedIds.size > 0 && selectedBlockingCount === 0 && (
                    <p className="text-[11px] text-emerald-500 font-medium">
                      {classificationSelectedIds.size} fila{classificationSelectedIds.size !== 1 ? 's' : ''} seleccionada{classificationSelectedIds.size !== 1 ? 's' : ''} listas para importar.
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Seleccionadas: {classificationSelectedIds.size} de {classificationRows.length}
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-end shrink-0">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep('input')} className="text-xs">
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    Volver
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirmWithClassification}
                    disabled={confirming || !canImportSelected}
                    size="sm"
                    className="gap-2 text-xs font-semibold"
                  >
                    {confirming ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Importando y validando…
                      </>
                    ) : (
                      `Importar ${classificationSelectedIds.size} candidato${classificationSelectedIds.size !== 1 ? 's' : ''}`
                    )}
                  </Button>
                </div>
              </div>
            )}

            {step === 'preview' && preview && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-left flex-1 space-y-1">
                  {selectedRows.length > 0 && (
                    <p className="text-[11px] text-su-brand font-medium">
                      {selectedRows.length} fila{selectedRows.length !== 1 ? 's' : ''} seleccionada{selectedRows.length !== 1 ? 's' : ''} para importar.
                    </p>
                  )}
                  {preview.errors > 0 && (
                    <p className="text-[11px] text-destructive font-medium">
                      {preview.errors} {preview.errors === 1 ? 'fila' : 'filas'} con errores no {preview.errors === 1 ? 'será importada' : 'serán importadas'}.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    SellUp validará duplicidad y calidad básica. No creará cuentas ni sincronizará con HubSpot hasta que apruebes candidatos.
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-end shrink-0">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStep('input')} className="text-xs">
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    Volver
                  </Button>
                  <Button
                    type="button"
                    onClick={handleConfirm}
                    disabled={
                      confirming ||
                      selectedRows.filter((r) => r.status !== 'error').length === 0
                    }
                    size="sm"
                    className="gap-2 text-xs font-semibold"
                  >
                    {confirming ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Importando y validando…
                      </>
                    ) : (
                      `Importar y validar ${selectedRows.filter((r) => r.status !== 'error').length} candidatos`
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      }
    >
      {/* Import loading overlay — positioned over the scrollable content area */}
      {confirming && (
        <ImportLoadingOverlay
          open={confirming}
          total={preview ? preview.valid + preview.warnings_only : 0}
        />
      )}

      {/* ── Step: input ───────────────────────────────────── */}
      {step === 'input' && !confirming && (
        <div className="space-y-5">
          <SurfaceCard>
            <SurfaceCardHeader title="Configuración de importación" />
            <div className="grid grid-cols-2 gap-3">
              {/* País de referencia */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  País de referencia <span className="text-destructive">*</span>
                </label>
                <Select value={selectedCountryCode} onValueChange={handleCountryChange}>
                  <SelectTrigger className="!w-full !h-11 !rounded-xl">
                    <SelectValue placeholder="País" />
                  </SelectTrigger>
                  <SelectContent className="!w-auto !min-w-[200px]">
                    {LATAM_COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {getFlagEmoji(c.code)} {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Se usará en filas que no incluyan país.
                </p>
              </div>

              {/* Industria por defecto */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Industria por defecto
                </label>
                {catalogLoading ? (
                  <div className="flex items-center gap-2 h-11 rounded-xl border border-input bg-muted/30 px-4">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Cargando catálogo…</span>
                  </div>
                ) : catalogError ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 h-11 rounded-xl border border-destructive/50 bg-destructive/5 px-4">
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      <span className="text-xs text-destructive truncate">No pudimos cargar el catálogo.</span>
                    </div>
                    <button
                      type="button"
                      onClick={loadCatalog}
                      className="flex items-center gap-1 text-[10px] text-su-brand hover:underline"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Reintentar
                    </button>
                  </div>
                ) : catalogData && catalogData.industries.length === 0 ? (
                  <div className="flex items-center gap-2 h-11 rounded-xl border border-input bg-muted/30 px-4">
                    <span className="text-xs text-muted-foreground">No hay un catálogo publicado disponible.</span>
                  </div>
                ) : (
                  <SearchableSelect
                    options={industryOptions}
                    value={selectedIndustry}
                    onValueChange={handleIndustryChange}
                    placeholder="Industria"
                    searchPlaceholder="Buscar industria…"
                    emptyMessage="No se encontraron industrias."
                    disabled={!catalogData || catalogLoading}
                  />
                )}
                <p className="text-[10px] text-muted-foreground">
                  Se usará únicamente en filas que no incluyan industria.
                </p>
              </div>

              {/* Subindustria por defecto */}
              <div className="space-y-1.5 col-span-2">
                <label className="text-xs font-medium text-foreground">
                  Subindustria por defecto{' '}
                  <span className="font-normal text-muted-foreground">(opcional)</span>
                </label>
                {subindustryCountryWarning && (
                  <p className="text-[10px] text-amber-500">
                    La subindustria seleccionada no está disponible para el nuevo país y fue eliminada.
                  </p>
                )}
                <SearchableSelect
                  options={subindustryOptions}
                  value={selectedSubindustryId}
                  onValueChange={(v) => {
                    setSelectedSubindustryId(v ?? '');
                    setSubindustryCountryWarning(false);
                  }}
                  placeholder="Sin subindustria por defecto"
                  searchPlaceholder="Buscar subindustria…"
                  emptyMessage="Selecciona un país e industria primero."
                  disabled={
                    !catalogData ||
                    !selectedIndustry ||
                    !selectedCountryCode ||
                    catalogLoading ||
                    !!catalogError
                  }
                />
                <p className="text-[10px] text-muted-foreground">
                  Opcional. Se usará únicamente en filas que no incluyan subindustria.
                </p>
              </div>
            </div>
          </SurfaceCard>

          {/* Selector de método */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFileMethod('paste')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-colors ${
                fileMethod === 'paste'
                  ? 'border-su-brand bg-su-brand-soft text-su-brand'
                  : 'border-border/40 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60'
              }`}
            >
              <ClipboardPaste className="h-4 w-4" />
              Pegar tabla
            </button>
            <button
              type="button"
              onClick={() => setFileMethod('file')}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-colors ${
                fileMethod === 'file'
                  ? 'border-su-brand bg-su-brand-soft text-su-brand'
                  : 'border-border/40 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60'
              }`}
            >
              <FileText className="h-4 w-4" />
              Subir archivo
            </button>
          </div>

          {/* Input: pegar tabla */}
          {fileMethod === 'paste' && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">
                Pega el contenido copiado desde Google Sheets o Excel
              </p>
              <Textarea
                placeholder={`Empresa\tPaís\tSector\tSitio web\nAcme Learning Chile\tChile\tEducación\thttps://acme.cl`}
                className="min-h-[180px] font-mono text-xs resize-none"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Acepta separadores tab, coma, punto y coma o tablas Markdown (incluso si vienen con texto explicativo alrededor). La primera fila válida será interpretada como encabezados.
                Si el archivo no trae país o industria, SellUp usará los valores seleccionados arriba.
              </p>
            </div>
          )}

          {/* Input: subir archivo */}
          {fileMethod === 'file' && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-foreground">
                Sube un archivo CSV o Excel (.xlsx)
              </p>
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/40 bg-muted/20 px-6 py-10 text-center cursor-pointer hover:border-border hover:bg-muted/40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="rounded-full bg-su-brand-soft p-2.5">
                  <Upload className="h-5 w-5 text-su-brand" />
                </div>
                {fileName ? (
                  <>
                    <p className="text-sm font-semibold text-foreground">{fileName}</p>
                    <p className="text-xs text-muted-foreground">Clic para cambiar archivo</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-foreground">Clic para seleccionar</p>
                    <p className="text-xs text-muted-foreground">
                      Archivos .csv o .xlsx · máx. 2 MB · 500 filas
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="text-[10px] text-muted-foreground">
                La primera fila debe contener los encabezados. Los archivos .xlsm no son soportados.
              </p>
            </div>
          )}

          <Accordion value={showGuide ? ['guide'] : []} onValueChange={(v) => setShowGuide(v.includes('guide'))}>
            <AccordionItem value="guide">
              <AccordionTrigger className="text-xs font-semibold text-foreground px-0 py-2">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-su-brand" />
                  Ver guía del contrato oficial de importación
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pt-1">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  SellUp tiene un <strong>contrato oficial de columnas</strong> en español. Puedes copiar tablas desde Excel, Google Sheets, o directamente desde los chats con <strong>Claude, Gemini o ChatGPT</strong>. El parser resolverá automáticamente los siguientes campos:
                </p>

                <div className="max-h-[220px] overflow-y-auto rounded-lg border border-border/30 bg-card">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="border-b border-border/30 bg-muted/30 text-muted-foreground font-semibold">
                        <th className="px-2 py-1.5 text-left">Columna oficial</th>
                        <th className="px-2 py-1.5 text-center">Estado</th>
                        <th className="px-2 py-1.5 text-left">Descripción</th>
                        <th className="px-2 py-1.5 text-left">Ejemplo / Aliases</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {EXTERNAL_IMPORT_CONTRACT.map((col) => (
                        <tr key={col.field} className="hover:bg-muted/10">
                          <td className="px-2 py-1.5 font-bold text-foreground whitespace-nowrap">
                            {col.officialHeader}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {col.required ? (
                              <span className="text-[9px] font-semibold text-destructive uppercase">Requerido</span>
                            ) : col.recommended ? (
                              <span className="text-[9px] font-semibold text-su-brand uppercase">Recomendado</span>
                            ) : (
                              <span className="text-[9px] text-muted-foreground">Opcional</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground leading-normal">
                            {col.description}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground leading-normal">
                            <span className="italic block text-foreground/80 mb-0.5">Ej: {col.example}</span>
                            <span className="text-[9px] text-muted-foreground/60 block truncate max-w-[150px]" title={col.aliases.join(', ')}>
                              Aliases: {col.aliases.join(', ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 rounded-lg border border-su-brand/20 bg-su-brand-soft/20 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-su-brand">
                      Ejemplo de tabla copiable
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const headers = EXTERNAL_IMPORT_CONTRACT.map(c => c.officialHeader).join('\t');
                        const values = EXTERNAL_IMPORT_CONTRACT.map(c => c.example).join('\t');
                        const exampleText = `${headers}\n${values}`;
                        navigator.clipboard.writeText(exampleText);
                        toast.success('Ejemplo copiado en formato TSV al portapapeles');
                      }}
                      className="h-6 gap-1 px-2 text-[10px] text-su-brand hover:text-su-brand hover:bg-su-brand-soft"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar ejemplo
                    </Button>
                  </div>
                  <pre className="overflow-x-auto text-[9px] font-mono bg-card p-2 rounded border border-border/30 text-muted-foreground">
                    {EXTERNAL_IMPORT_CONTRACT.map(c => c.officialHeader).join('\t')}{'\n'}
                    {EXTERNAL_IMPORT_CONTRACT.map(c => c.example).join('\t')}
                  </pre>
                  <p className="text-[9px] text-muted-foreground/80 leading-normal">
                    Tip: Puedes copiar este ejemplo, pegarlo en Google Sheets o Excel, rellenar tus datos y luego copiar la tabla para pegarla en el campo superior. También puedes pegar directamente una tabla generada por Claude, Gemini o GPT. SellUp intentará reconocer las columnas e ignorar las filas separadoras o el texto introductorio, incluso si viene como tabla Markdown con pipes.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Alert variant="info">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Puedes copiar desde Google Sheets/Excel o subir un archivo CSV/XLSX.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* ── Step: classification — loading skeleton ────────── */}
      {step === 'classification' && loadingClassification && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          <div className="animate-pulse space-y-3">
            {/* Banner skeleton */}
            <div className="h-14 rounded-xl bg-muted/60" />
            {/* Stat cards skeleton */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-muted/40" />
              ))}
            </div>
            {/* Filter tabs skeleton */}
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-7 w-20 rounded-lg bg-muted/40" />
              ))}
            </div>
            {/* Table skeleton */}
            <div className="h-64 rounded-xl bg-muted/40" />
          </div>
          <p className="text-center text-xs text-muted-foreground animate-pulse">
            Clasificando industrias y subindustrias…
          </p>
        </div>
      )}

      {/* ── Step: classification — mapeo ambiguo (bloque compacto) ── */}
      {step === 'classification' && needsMappingResolution && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              SellUp detectó columnas con mapeo ambiguo. Revisa y corrige los campos conflictivos antes de clasificar.
              {computeHasMappingConflict(columnMappings) && (
                <span className="block mt-1 font-semibold">
                  Dos columnas están asignadas al mismo campo — resuelve el conflicto para continuar.
                </span>
              )}
            </AlertDescription>
          </Alert>
          <ImportColumnMappingTable
            columnMappings={columnMappings}
            onMappingChange={handleMappingChange}
          />
        </div>
      )}

      {/* ── Step: classification — full UI ────────────────── */}
      {step === 'classification' && !loadingClassification && !needsMappingResolution && classificationSummary && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          {/* Catalog version changed banner */}
          {catalogVersionChanged && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                El catálogo de industrias fue actualizado mientras revisabas las correcciones.
                La importación está bloqueada. Haz clic en{' '}
                <button
                  type="button"
                  className="underline font-semibold"
                  onClick={() => {
                    setCatalogVersionChanged(false);
                    void handleBuildClassification();
                  }}
                >
                  Revalidar archivo
                </button>{' '}
                para volver a clasificar con la nueva versión.
              </AlertDescription>
            </Alert>
          )}

          {/* Classification error banner */}
          {classificationError && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{classificationError}</AlertDescription>
            </Alert>
          )}

          {/* Summary stat cards */}
          {catalogVersion && (
            <ImportClassificationSummary
              stats={classificationSummary}
              catalogVersion={catalogVersion.version}
            />
          )}

          {/* ── Filter tabs + selection counter — fuera de la tabla ── */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {classificationFilterOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilterStatus(opt.value)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-[10px] font-medium transition-colors',
                  filterStatus === opt.value
                    ? 'bg-su-brand text-white'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                )}
              >
                {opt.label}
                <span className="ml-1 tabular-nums opacity-70">({opt.count})</span>
              </button>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">
              Seleccionadas: <strong className="text-foreground">{classificationSelectedIds.size}</strong> de {classificationRows.length}
            </span>
          </div>

          {/* Classification table — full width, inline editing, no side panel */}
          <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-border/40 bg-card">
            <ImportClassificationTable
              rows={classificationRows}
              filterStatus={filterStatus}
              selectedRowIds={classificationSelectedIds}
              onSelectionChange={setClassificationSelectedIds}
              catalog={catalogData ?? undefined}
              catalogVersion={catalogVersion ?? undefined}
              onSaveCorrection={handleSaveCorrection}
              onBulkCorrection={handleBulkCorrection}
            />
          </div>
        </div>
      )}

      {/* ── Step: preview ─────────────────────────────────── */}
      {step === 'preview' && preview && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          <button
            type="button"
            onClick={() => setStep('input')}
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver a la configuración
          </button>

          {/* Defaults del lote */}
          {(selectedCountryCode || selectedIndustry || selectedSubindustryId) && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-su-brand/20 bg-su-brand-soft/30 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-su-brand/70 mr-1">
                Criterios de importación:
              </p>
              {selectedCountryCode && (
                <Badge variant="secondary" className="text-[10px] font-normal bg-su-brand-soft text-su-brand border-0">
                  🌍 {selectedCountry?.name ?? selectedCountryCode}
                </Badge>
              )}
              {selectedIndustry && (
                <Badge variant="secondary" className="text-[10px] font-normal bg-su-brand-soft text-su-brand border-0">
                  🏭 {selectedIndustryName ?? selectedIndustry}
                </Badge>
              )}
              {selectedSubindustryId && selectedSubindustryId !== '__none__' && selectedSubindustryName && (
                <Badge variant="secondary" className="text-[10px] font-normal bg-su-brand-soft text-su-brand border-0">
                  🏷️ {selectedSubindustryName}
                </Badge>
              )}
            </div>
          )}

          {/* Resumen estadístico */}
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Filas detectadas', value: preview.total, color: 'text-foreground', bg: 'bg-muted/60' },
              { label: 'Importables', value: preview.valid + preview.warnings_only, color: 'text-su-brand font-bold', bg: 'bg-su-brand-soft' },
              { label: 'Sin observaciones', value: preview.valid, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
              { label: 'Con advertencias', value: preview.warnings_only, color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { label: 'Con errores', value: preview.errors, color: 'text-destructive', bg: 'bg-destructive/10' },
            ].map((card) => (
              <div key={card.label} className={`rounded-xl ${card.bg} px-3 py-2.5 flex-1 min-w-[100px] sm:min-w-[120px]`}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {card.label}
                </p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${card.color}`}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {(exactDuplicateCount > 0 || possibleDuplicateCount > 0) && (
            <Alert variant="warning">
              <GitMerge className="h-4 w-4" />
              <AlertDescription className="text-xs space-y-0.5">
                {exactDuplicateCount > 0 && (
                  <p>
                    <span className="font-semibold text-orange-600 dark:text-orange-400">
                      {exactDuplicateCount} duplicado{exactDuplicateCount !== 1 ? 's' : ''} exacto{exactDuplicateCount !== 1 ? 's' : ''}
                    </span>{' '}
                    encontrado{exactDuplicateCount !== 1 ? 's' : ''} en SellUp — se importarán igualmente para revisión.
                  </p>
                )}
                {possibleDuplicateCount > 0 && (
                  <p>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {possibleDuplicateCount} posible{possibleDuplicateCount !== 1 ? 's' : ''} duplicado{possibleDuplicateCount !== 1 ? 's' : ''}
                    </span>{' '}
                    — verifica manualmente antes de aprobar.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {(preview.recognized_columns.length > 0 || preview.unrecognized_columns.length > 0) && (
            <SurfaceCard>
              {preview.recognized_columns.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Columnas reconocidas
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {preview.recognized_columns.map((col) => (
                      <Badge key={col} variant="secondary" className="text-[10px] font-normal">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {preview.unrecognized_columns.length > 0 && (
                <div className={cn("space-y-1.5", preview.recognized_columns.length > 0 && "pt-3 border-t border-border/30")}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Columnas no reconocidas (se ignorarán)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {preview.unrecognized_columns.map((col) => (
                      <Badge key={col} variant="outline" className="text-[10px] font-normal text-muted-foreground">
                        {col}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </SurfaceCard>
          )}

          {/* Tabla de filas */}
          <div className="flex-1 min-h-0 overflow-hidden rounded-xl border border-border/40 bg-card">
            <ImportPreviewDataTable
              rows={preview.rows}
              duplicateMap={duplicateMap}
              onSelectionChange={setSelectedRows}
            />
          </div>

          {preview.errors === preview.total && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Todas las filas tienen errores bloqueantes. Corrige los datos y vuelve a intentarlo.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </DrawerShell>
  );
}
