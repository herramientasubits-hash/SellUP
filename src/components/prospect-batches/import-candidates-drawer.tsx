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
} from 'lucide-react';
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
} from '@/modules/prospect-batches/import-candidates-parser';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
} from '@/modules/accounts/types';
import { getFlagEmoji } from '@/components/accounts/account-form-helpers';

// ── Tipos locales ─────────────────────────────────────────────

type Step = 'input' | 'preview' | 'success';
type FileMethod = 'paste' | 'file';

export interface ImportDuplicateResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

import type { ImportRow } from '@/modules/prospect-batches/import-candidates-parser';
export type { ImportRow } from '@/modules/prospect-batches/import-candidates-parser';

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

  function resetState() {
    setStep('input');
    setFileMethod('paste');
    setShowGuide(false);
    setSelectedCountryCode('');
    setSelectedIndustry('');
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
  }

  function handleClose() {
    setOpen(false);
    setTimeout(resetState, 300);
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

  const defaults: ImportDefaults = {
    country: selectedCountry?.name,
    countryCode: selectedCountryCode || undefined,
    industry: selectedIndustry || undefined,
  };

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

      setStep('preview');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al procesar los datos');
    } finally {
      setLoadingPreview(false);
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
            industry: selectedIndustry || undefined,
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
          : step === 'preview'
          ? "Vista previa de importación"
          : "Candidatos importados para revisión"
      }
      description={
        step === 'input'
          ? "Carga empresas encontradas en Gemini, hojas de cálculo, eventos o investigación externa. SellUp validará duplicidad y las dejará listas para revisión antes de crear cuentas."
          : step === 'preview'
          ? "Revisa los datos antes de importar. Solo se importarán filas válidas y con advertencias."
          : `SellUp importó ${resultCount} prospecto${resultCount !== 1 ? 's' : ''} externo${resultCount !== 1 ? 's' : ''}. Revísalos antes de aprobarlos como cuentas.`
      }
      icon={
        step === 'success'
          ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          : step === 'preview'
          ? <FileText className="h-4 w-4 text-su-brand" />
          : <Upload className="h-4 w-4 text-su-brand" />
      }
      className={cn(
        "transition-all duration-300",
        step === 'preview'
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
                    'Previsualizar'
                  )}
                </Button>
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  País de referencia <span className="text-destructive">*</span>
                </label>
                <Select value={selectedCountryCode} onValueChange={(v) => setSelectedCountryCode(v ?? '')}>
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
                  Valor por defecto para filas sin país.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Industria / criterio
                </label>
                <Select value={selectedIndustry} onValueChange={(v) => setSelectedIndustry(v ?? '')}>
                  <SelectTrigger className="!w-full !h-11 !rounded-xl">
                    <SelectValue placeholder="Industria" />
                  </SelectTrigger>
                  <SelectContent className="!w-auto !min-w-[200px]">
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind} value={ind}>
                        {ind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Valor por defecto para filas sin industria.
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
          {(selectedCountryCode || selectedIndustry) && (
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
                  🏭 {selectedIndustry}
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
