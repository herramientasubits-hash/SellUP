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
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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

  function resetState() {
    setStep('input');
    setFileMethod('paste');
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

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? 'Error al crear el lote');
      }

      const result = await res.json() as { batchId: string; candidatesCreated: number };
      setResultBatchId(result.batchId);
      setResultCount(result.candidatesCreated);
      setStep('success');
      // Refresh manual en background: el estado del drawer se preserva
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear el lote');
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
    <>
      <span onClick={() => setOpen(true)}>{children}</span>

      <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
        <SheetContent
          className={cn(
            "flex w-full flex-col gap-0 overflow-hidden p-0 transition-all duration-300",
            step === 'preview'
              ? "data-[side=right]:sm:max-w-[80vw] sm:w-[80vw] w-full"
              : "data-[side=right]:sm:max-w-[500px] sm:w-[500px] w-full"
          )}
        >

          {/* ── Step: input ───────────────────────────────────── */}
          {step === 'input' && (
            <>
              <SheetHeader className="border-b border-border/40 px-6 py-5">
                <SheetTitle className="text-base font-semibold">
                  Importar candidatos externos
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Carga empresas encontradas en Gemini, hojas de cálculo, eventos o investigación
                  externa. SellUp validará duplicidad y las dejará listas para revisión antes de
                  crear cuentas.
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                {/* ── Configuración del lote ─────────────────── */}
                <div className="space-y-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Configuración del lote
                  </p>

                  {/* País del lote */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      País del lote <span className="text-destructive">*</span>
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

                  {/* Industria del lote */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-foreground">
                      Industria / criterio del lote
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

                {/* ── Selector de método ─────────────────────── */}
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
                      Acepta separadores tab, coma o punto y coma. La primera fila debe ser encabezados.
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

                {/* Columnas reconocidas */}
                <div className="rounded-xl border border-border/30 bg-muted/20 px-4 py-3.5 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Columnas reconocidas automáticamente
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    empresa · nombre empresa · razón social · país · sitio web · sector · industria ·
                    ciudad · región · NIT · RUT · RFC · LinkedIn · tamaño · descripción · notas ·
                    fuente · contacto · email
                  </p>
                </div>

                {/* Nota inferior */}
                <div className="flex items-start gap-2.5 rounded-xl border border-border/30 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Puedes copiar desde Google Sheets/Excel o subir un archivo CSV/XLSX.
                  </span>
                </div>
              </div>

              <SheetFooter className="border-t border-border/40 px-6 py-4">
                <Button type="button" variant="ghost" onClick={handleClose} className="text-xs">
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={handleBuildPreview}
                  disabled={!hasInput || loadingPreview}
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
              </SheetFooter>
            </>
          )}

          {/* ── Step: preview ─────────────────────────────────── */}
          {step === 'preview' && preview && (
            <>
              <SheetHeader className="border-b border-border/40 px-6 py-5">
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Volver
                </button>
                <SheetTitle className="text-base font-semibold">
                  Vista previa de importación
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Revisa los datos antes de crear el lote. Solo se importarán filas válidas y con advertencias.
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

                {/* Defaults del lote */}
                {(selectedCountryCode || selectedIndustry) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-su-brand/20 bg-su-brand-soft/30 px-4 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-su-brand/70 mr-1">
                      Defaults del lote:
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

                {/* Duplicados encontrados */}
                {(exactDuplicateCount > 0 || possibleDuplicateCount > 0) && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2.5">
                    <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="text-xs text-muted-foreground space-y-0.5">
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
                    </div>
                  </div>
                )}

                {/* Columnas reconocidas / no reconocidas */}
                {(preview.recognized_columns.length > 0 || preview.unrecognized_columns.length > 0) && (
                  <div className="rounded-xl border border-border/30 bg-muted/20 px-4 py-3 space-y-2">
                    {preview.recognized_columns.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">
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
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">
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
                  </div>
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
                          
                          // Display Url
                          const displayUrl = row.raw.website ? row.raw.website.replace(/^(https?:\/\/)?(www\.)?/, '') : '';
                          const hrefUrl = row.raw.website ? (row.raw.website.startsWith('http') ? row.raw.website : `https://${row.raw.website}`) : '';
                          
                          return (
                            <tr key={row.index} className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
                              {/* 1. Index */}
                              <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                                {row.index + 1}
                              </td>
                              
                              {/* 2. Empresa */}
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
                              
                              {/* 3. País */}
                              <td className="px-3 py-2.5">
                                <div className="flex flex-col gap-0.5">
                                  <p className="text-foreground font-medium">
                                    {row.resolved_country_code ?? row.raw.country_code ?? row.raw.country ?? (
                                      <span className="text-muted-foreground/60 italic">—</span>
                                    )}
                                  </p>
                                  {row.country_from_default && (
                                    <DefaultBadge label="desde lote" />
                                  )}
                                </div>
                              </td>
                              
                              {/* 4. Sector */}
                              <td className="px-3 py-2.5">
                                <div className="flex flex-col gap-0.5">
                                  <p className="text-foreground truncate max-w-[120px]" title={row.raw.industry}>
                                    {row.raw.industry ?? <span className="text-muted-foreground/60 italic">—</span>}
                                  </p>
                                  {row.industry_from_default && (
                                    <DefaultBadge label="lote" />
                                  )}
                                </div>
                              </td>
                              
                              {/* 5. Website */}
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
                              
                              {/* 6. LinkedIn */}
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
                              
                              {/* 7. Confianza */}
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
                              
                              {/* 8. Estado */}
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
                              
                              {/* 9. Notas / advertencias */}
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
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
                    Todas las filas tienen errores bloqueantes. Corrige los datos y vuelve a intentarlo.
                  </div>
                )}
              </div>

              <SheetFooter className="border-t border-border/40 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-left flex-1 space-y-1">
                  {preview.errors > 0 && (
                    <p className="text-[11px] text-destructive font-medium">
                      ⚠️ {preview.errors} {preview.errors === 1 ? 'fila' : 'filas'} con errores no {preview.errors === 1 ? 'será importada' : 'serán importadas'}.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    SellUp validará duplicidad y calidad básica. No creará cuentas ni sincronizará con HubSpot hasta que apruebes candidatos.
                  </p>
                </div>
                <div className="flex items-center gap-2 justify-end shrink-0">
                  <Button type="button" variant="ghost" onClick={() => setStep('input')} className="text-xs">
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
                    className="gap-2 text-xs font-semibold"
                  >
                    {confirming ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Importando y validando…
                      </>
                    ) : (
                      preview.errors > 0
                        ? `Importar y validar ${preview.valid + preview.warnings_only} candidato${preview.valid + preview.warnings_only !== 1 ? 's' : ''} válido${preview.valid + preview.warnings_only !== 1 ? 's' : ''}`
                        : `Importar y validar ${preview.valid + preview.warnings_only} candidato${preview.valid + preview.warnings_only !== 1 ? 's' : ''}`
                    )}
                  </Button>
                </div>
              </SheetFooter>
            </>
          )}

          {/* ── Step: success ─────────────────────────────────── */}
          {step === 'success' && (
            <>
              <SheetHeader className="border-b border-border/40 px-6 py-5">
                <SheetTitle className="text-base font-semibold">
                  Candidatos importados para revisión
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  SellUp creó un lote con {resultCount} candidato{resultCount !== 1 ? 's' : ''} externos.
                  Revísalos antes de aprobarlos como cuentas.
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-10">
                <div className="rounded-full bg-emerald-500/10 p-5">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">
                    {resultCount} candidato{resultCount !== 1 ? 's' : ''} importado{resultCount !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    El lote quedó listo para revisión. Ningún candidato será convertido en cuenta ni
                    sincronizado con HubSpot hasta que lo apruebes manualmente.
                  </p>
                </div>

                <div className="flex flex-col gap-2 w-full max-w-xs">
                  {/* Revisar lote: cierre explícito por el usuario */}
                  <Button
                    type="button"
                    onClick={() => {
                      handleClose();
                      if (resultBatchId) router.push(`/prospect-batches/${resultBatchId}`);
                    }}
                    className="w-full gap-2 text-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Revisar lote
                  </Button>
                  {/* Importar otro: resetea sin cerrar */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetState}
                    className="w-full text-xs"
                  >
                    Importar otro archivo
                  </Button>
                  {/* Cerrar manual */}
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
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
