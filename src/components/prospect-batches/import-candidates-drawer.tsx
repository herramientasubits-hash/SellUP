'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload,
  ClipboardPaste,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText,
  ArrowLeft,
  GitMerge,
  ExternalLink,
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
import { LATAM_COUNTRIES, INDUSTRIES } from '@/modules/accounts/types';

// ── Tipos locales ─────────────────────────────────────────────

type Step = 'input' | 'preview' | 'success';
type FileMethod = 'paste' | 'file';

interface ImportDuplicateResult {
  index: number;
  duplicate_status: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
  reason?: string;
}

interface ImportCandidatesDrawerProps {
  children: React.ReactNode;
}

// ── Helpers ───────────────────────────────────────────────────


function DuplicateBadge({ status }: { status?: ImportDuplicateResult['duplicate_status'] }) {
  if (!status || status === 'no_match') return null;
  if (status === 'exact_duplicate') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">
        <GitMerge className="h-2.5 w-2.5" />
        Duplicado exacto
      </span>
    );
  }
  if (status === 'possible_duplicate') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        <GitMerge className="h-2.5 w-2.5" />
        Posible duplicado
      </span>
    );
  }
  return null;
}

function DefaultBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-su-brand-soft px-2 py-0.5 text-[10px] font-medium text-su-brand">
      {label}
    </span>
  );
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
    const validRows = getValidRows(preview);
    if (validRows.length === 0) {
      toast.error('No hay filas válidas para importar.');
      return;
    }
    setConfirming(true);
    try {
      const candidates = validRows.map((r) => ({
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
      setStep('success');
      // Refresh manual en background: el estado del drawer se preserva
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
          ? "sm:!max-w-[80vw] sm:w-[80vw] w-full"
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
                      (preview.valid + preview.warnings_only === 0)
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
                      `Importar y validar ${preview.valid + preview.warnings_only} candidatos`
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      }
    >
      {/* ── Step: input ───────────────────────────────────── */}
      {step === 'input' && (
        <div className="space-y-5">
          <SurfaceCard>
            <SurfaceCardHeader title="Configuración de importación" />
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  País de referencia <span className="text-destructive">*</span>
                </label>
                <Select value={selectedCountryCode} onValueChange={(v) => setSelectedCountryCode(v ?? '')}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecciona el país de estos candidatos" />
                  </SelectTrigger>
                  <SelectContent>
                    {LATAM_COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code} className="text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Se usará para las filas que no tengan país en el archivo.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">
                  Industria / criterio
                </label>
                <Select value={selectedIndustry} onValueChange={(v) => setSelectedIndustry(v ?? '')}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecciona o escribe una industria" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind} value={ind} className="text-xs">
                        {ind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Se usará para las filas que no tengan sector o industria.
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
        <div className="space-y-4">
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
          <div className="rounded-xl border border-border/40 overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="min-w-[1000px] w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30">
                    <th className="px-3 py-2 text-center font-semibold text-muted-foreground w-12">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[180px]">Empresa</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-24">País</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[120px]">Sector</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[140px]">Website</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[140px]">LinkedIn</th>
                    <th className="px-3 py-2 text-center font-semibold text-muted-foreground w-28">Confianza</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-40">Estado</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground min-w-[200px] max-w-[300px]">Notas / advertencias</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const dup = duplicateMap.get(row.index);
                    
                    const displayUrl = row.raw.website ? row.raw.website.replace(/^(https?:\/\/)?(www\.)?/, '') : '';
                    const hrefUrl = row.raw.website ? (row.raw.website.startsWith('http') ? row.raw.website : `https://${row.raw.website}`) : '';
                    
                    return (
                      <tr key={row.index} className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                          {row.index + 1}
                        </td>
                        
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <p className="font-semibold text-foreground truncate max-w-[200px]" title={row.raw.company_name}>
                              {row.raw.company_name || <span className="text-muted-foreground/60 italic">Sin nombre</span>}
                            </p>
                            {row.raw.description && (
                              <p className="text-[10px] text-muted-foreground/80 truncate max-w-[200px]" title={row.raw.description}>
                                {row.raw.description}
                              </p>
                            )}
                          </div>
                        </td>
                        
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <p className="text-foreground font-medium">
                              {row.resolved_country_code ?? row.raw.country_code ?? row.raw.country ?? (
                                <span className="text-muted-foreground/60 italic">—</span>
                              )}
                            </p>
                            {row.country_from_default && (
                              <DefaultBadge label="por defecto" />
                            )}
                          </div>
                        </td>
                        
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <p className="text-foreground truncate max-w-[120px]" title={row.raw.industry}>
                              {row.raw.industry ?? <span className="text-muted-foreground/60 italic">—</span>}
                            </p>
                            {row.industry_from_default && (
                              <DefaultBadge label="por defecto" />
                            )}
                          </div>
                        </td>
                        
                        <td className="px-3 py-2.5">
                          {row.raw.website ? (
                            <a
                              href={hrefUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-su-brand hover:underline truncate max-w-[130px] font-medium"
                              title={row.raw.website}
                            >
                              {displayUrl}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground/60 italic">—</span>
                          )}
                        </td>
                        
                        <td className="px-3 py-2.5">
                          {row.raw.linkedin_url && row.raw.linkedin_url.toLowerCase() !== 'no encontrado' ? (
                            <a
                              href={row.raw.linkedin_url.startsWith('http') ? row.raw.linkedin_url : `https://${row.raw.linkedin_url}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-su-brand hover:underline truncate max-w-[130px] font-medium"
                              title={row.raw.linkedin_url}
                            >
                              {row.raw.linkedin_url.replace(/^(https?:\/\/)?(www\.)?linkedin\.com\//, '')}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground/60 italic">No encontrado</span>
                          )}
                        </td>
                        
                        <td className="px-3 py-2.5 text-center">
                          {row.raw.confidence ? (
                            <span className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              row.raw.confidence.toLowerCase() === 'alta' && "bg-emerald-500/10 text-emerald-500",
                              row.raw.confidence.toLowerCase() === 'media' && "bg-amber-500/10 text-amber-500",
                              row.raw.confidence.toLowerCase() === 'baja' && "bg-destructive/10 text-destructive",
                              !['alta', 'media', 'baja'].includes(row.raw.confidence.toLowerCase()) && "bg-muted text-muted-foreground"
                            )}>
                              {row.raw.confidence}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60 italic">—</span>
                          )}
                        </td>
                        
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col gap-1 items-start">
                            {row.status === 'error' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                                <XCircle className="h-2.5 w-2.5" />
                                Error
                              </span>
                            )}
                            {row.status === 'warning' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Importable con advertencias
                              </span>
                            )}
                            {row.status === 'valid' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Importable
                              </span>
                            )}
                            {dup && dup.duplicate_status !== 'no_match' && (
                              <DuplicateBadge status={dup.duplicate_status} />
                            )}
                          </div>
                        </td>
                        
                        <td className="px-3 py-2.5 max-w-[300px]">
                          <div className="space-y-1 text-[11px] leading-relaxed">
                            {row.errors.map((e) => (
                              <div key={e} className="flex items-start gap-1 text-destructive font-medium">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive" />
                                <span>{e}</span>
                              </div>
                            ))}
                            {row.warnings.map((w) => (
                              <div key={w} className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                                <span className="truncate max-w-[240px]" title={w}>{w}</span>
                              </div>
                            ))}
                            {row.raw.notes && (
                              <div className="text-muted-foreground/80 truncate max-w-[260px]" title={row.raw.notes}>
                                <span className="font-semibold">Notas:</span> {row.raw.notes}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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

      {/* ── Step: success ─────────────────────────────────── */}
      {step === 'success' && (
        <div className="flex flex-col items-center justify-center gap-5 py-4 text-center">
          <div className="rounded-full bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              ¡Importación completada!
            </p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Se han cargado y validado los prospectos en el lote. Ninguno se enviará a HubSpot hasta que sea aprobado.
            </p>
          </div>

          {importStats && (
            <SurfaceCard>
              <SurfaceCardHeader title="Resumen de Lote" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-card border border-border/30 p-2">
                  <span className="text-[10px] text-muted-foreground block">Filas procesadas</span>
                  <span className="font-semibold text-foreground text-sm tabular-nums">{importStats.totalProcessed}</span>
                </div>
                
                <div className="rounded-lg bg-card border border-border/30 p-2">
                  <span className="text-[10px] text-muted-foreground block">Guardados con éxito</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 text-sm tabular-nums">{importStats.importedCount}</span>
                </div>

                <div className="rounded-lg bg-card border border-border/30 p-2 col-span-2 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Enriquecimiento automático</span>
                    <span className="text-[11px] font-medium text-su-brand">Incremental (Campos vacíos)</span>
                  </div>
                  <Badge className="bg-su-brand-soft text-su-brand font-semibold hover:bg-su-brand-soft/80 border-0">
                    {importStats.autoEnrichPendingCount} pendiente{importStats.autoEnrichPendingCount !== 1 ? 's' : ''}
                  </Badge>
                </div>

                {importStats.alreadyCompleteCount > 0 && (
                  <div className="rounded-lg bg-card border border-border/30 p-2 col-span-2 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Listos para revisión (Completos)</span>
                    <span className="font-semibold text-foreground tabular-nums">{importStats.alreadyCompleteCount}</span>
                  </div>
                )}

                {importStats.duplicateCount > 0 && (
                  <div className="rounded-lg bg-card border border-border/30 p-2 flex flex-col justify-between">
                    <span className="text-[10px] text-muted-foreground block">Duplicados exactos</span>
                    <span className="font-semibold text-orange-600 dark:text-orange-400 text-sm tabular-nums">{importStats.duplicateCount}</span>
                  </div>
                )}

                {importStats.possibleDuplicateCount > 0 && (
                  <div className="rounded-lg bg-card border border-border/30 p-2 flex flex-col justify-between">
                    <span className="text-[10px] text-muted-foreground block">Posibles duplicados</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 text-sm tabular-nums">{importStats.possibleDuplicateCount}</span>
                  </div>
                )}

                {importStats.errorsCount > 0 && (
                  <div className="rounded-lg bg-card border border-border/30 p-2 flex flex-col justify-between border-destructive/20 bg-destructive/5">
                    <span className="text-[10px] text-destructive block">Omitidos con error</span>
                    <span className="font-semibold text-destructive text-sm tabular-nums">{importStats.errorsCount}</span>
                  </div>
                )}
              </div>
            </SurfaceCard>
          )}

          <div className="flex flex-col gap-2 w-full max-w-xs">
            <Button
              type="button"
              onClick={() => {
                handleClose();
                if (resultBatchId) router.push(`/prospects?sourceId=${resultBatchId}`);
              }}
              className="w-full gap-2 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver prospectos importados
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={resetState}
              className="w-full text-xs"
            >
              Importar otro archivo
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="w-full text-xs text-muted-foreground"
            >
              Cerrar
            </Button>
          </div>
        </div>
      )}
    </DrawerShell>
  );
}
