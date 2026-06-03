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
  Globe,
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
import { toast } from 'sonner';
import {
  parsePastedCandidates,
  parseCsvCandidates,
  buildImportPreview,
  getValidRows,
  type ImportPreview,
  type ImportRow,
  type ImportMethod,
} from '@/modules/prospect-batches/import-candidates-parser';
import {
  checkImportDuplicates,
  createExternalCandidatesBatch,
  type ImportDuplicateResult,
} from '@/modules/prospect-batches/actions';

// ── Tipos locales ─────────────────────────────────────────────

type Step = 'input' | 'preview' | 'success';

interface ImportCandidatesDrawerProps {
  children: React.ReactNode;
}

// ── Helpers ───────────────────────────────────────────────────

function RowStatusBadge({ row }: { row: ImportRow }) {
  if (row.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
        <XCircle className="h-2.5 w-2.5" />
        Error
      </span>
    );
  }
  if (row.status === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-2.5 w-2.5" />
        Advertencia
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-2.5 w-2.5" />
      Válida
    </span>
  );
}

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

// ── Componente principal ──────────────────────────────────────

export function ImportCandidatesDrawer({ children }: ImportCandidatesDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>('input');
  const [method, setMethod] = React.useState<ImportMethod>('paste');

  // Input state
  const [pasteText, setPasteText] = React.useState('');
  const [csvFileName, setCsvFileName] = React.useState<string | null>(null);
  const [csvText, setCsvText] = React.useState('');
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
    setMethod('paste');
    setPasteText('');
    setCsvFileName(null);
    setCsvText('');
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
    if (file.size > 2 * 1024 * 1024) {
      toast.error('El archivo supera 2 MB. Usa un archivo más pequeño o pega el contenido.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '');
      setCsvFileName(file.name);
    };
    reader.readAsText(file, 'UTF-8');
  }

  async function handleBuildPreview() {
    const rawText = method === 'paste' ? pasteText : csvText;
    if (!rawText.trim()) {
      toast.error('Ingresa o carga datos primero.');
      return;
    }
    setLoadingPreview(true);
    try {
      const parsed = method === 'paste'
        ? parsePastedCandidates(rawText)
        : parseCsvCandidates(rawText);
      const built = buildImportPreview(parsed);
      setPreview(built);

      // Check duplicates server-side for valid rows only
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
        const dupResults = await checkImportDuplicates(validForCheck);
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
      }));

      const result = await createExternalCandidatesBatch({
        import_type: method,
        candidates,
        recognized_columns: preview.recognized_columns,
        unrecognized_columns: preview.unrecognized_columns,
        total_rows: preview.total,
        valid_rows: preview.valid,
        invalid_rows: preview.errors,
        warning_rows: preview.warnings_only,
      });

      setResultBatchId(result.batchId);
      setResultCount(result.candidatesCreated);
      setStep('success');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear el lote');
    } finally {
      setConfirming(false);
    }
  }

  const hasInput = method === 'paste' ? pasteText.trim().length > 2 : csvText.length > 0;

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
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">

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
                {/* Selector de método */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setMethod('paste')}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-colors ${
                      method === 'paste'
                        ? 'border-su-brand bg-su-brand-soft text-su-brand'
                        : 'border-border/40 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60'
                    }`}
                  >
                    <ClipboardPaste className="h-4 w-4" />
                    Pegar tabla
                  </button>
                  <button
                    onClick={() => setMethod('csv')}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-colors ${
                      method === 'csv'
                        ? 'border-su-brand bg-su-brand-soft text-su-brand'
                        : 'border-border/40 bg-muted/30 text-muted-foreground hover:border-border hover:bg-muted/60'
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                    Subir CSV
                  </button>
                  <button
                    disabled
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-border/20 bg-muted/10 px-3 py-3 text-xs font-medium text-muted-foreground/40 cursor-not-allowed"
                    title="Próximamente"
                  >
                    <Globe className="h-4 w-4" />
                    Google Sheet
                    <span className="text-[9px] font-normal">Próximamente</span>
                  </button>
                </div>

                {/* Input: pegar tabla */}
                {method === 'paste' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">
                        Pega el contenido copiado desde Google Sheets o Excel
                      </p>
                    </div>
                    <Textarea
                      placeholder={`Empresa\tPaís\tSector\tSitio web\nAcme Learning Chile\tChile\tEducación\thttps://acme.cl`}
                      className="min-h-[220px] font-mono text-xs resize-none"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Acepta separadores tab, coma o punto y coma. La primera fila debe ser encabezados.
                    </p>
                  </div>
                )}

                {/* Input: CSV */}
                {method === 'csv' && (
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-foreground">
                      Sube un archivo CSV (máx. 2 MB · 200 filas)
                    </p>
                    <div
                      className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/40 bg-muted/20 px-6 py-10 text-center cursor-pointer hover:border-border hover:bg-muted/40 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="rounded-full bg-su-brand-soft p-2.5">
                        <Upload className="h-5 w-5 text-su-brand" />
                      </div>
                      {csvFileName ? (
                        <>
                          <p className="text-sm font-semibold text-foreground">{csvFileName}</p>
                          <p className="text-xs text-muted-foreground">Clic para cambiar archivo</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-foreground">Clic para seleccionar</p>
                          <p className="text-xs text-muted-foreground">Archivos .csv · UTF-8 recomendado</p>
                        </>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Acepta separadores tab, coma o punto y coma. Primera fila: encabezados.
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

                {/* XLSX próximamente */}
                <div className="flex items-start gap-2.5 rounded-xl border border-border/30 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Archivos Excel (.xlsx) y link de Google Sheet estarán disponibles próximamente.
                    Por ahora, descarga el archivo como CSV desde Sheets o Excel.
                  </span>
                </div>
              </div>

              <SheetFooter className="border-t border-border/40 px-6 py-4">
                <Button variant="ghost" onClick={handleClose} className="text-xs">
                  Cancelar
                </Button>
                <Button
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
                {/* Resumen estadístico */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Filas detectadas', value: preview.total, color: 'text-foreground', bg: 'bg-muted/60' },
                    { label: 'Válidas', value: preview.valid, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
                    { label: 'Con advertencias', value: preview.warnings_only, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
                    { label: 'Con errores', value: preview.errors, color: 'text-destructive', bg: 'bg-destructive/10' },
                  ].map((card) => (
                    <div key={card.label} className={`rounded-xl ${card.bg} px-3 py-2.5`}>
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
                <div className="rounded-xl border border-border/40 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/30">
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">#</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Empresa</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">País</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => {
                        const dup = duplicateMap.get(row.index);
                        return (
                          <tr key={row.index} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {row.index + 1}
                            </td>
                            <td className="px-3 py-2 max-w-[180px]">
                              <p className="font-medium text-foreground truncate">
                                {row.raw.company_name || <span className="text-muted-foreground/60 italic">Sin nombre</span>}
                              </p>
                              {row.raw.industry && (
                                <p className="text-[10px] text-muted-foreground truncate">{row.raw.industry}</p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <p className="text-foreground">
                                {row.resolved_country_code ?? row.raw.country_code ?? row.raw.country ?? (
                                  <span className="text-muted-foreground/60 italic">—</span>
                                )}
                              </p>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <RowStatusBadge row={row} />
                                {dup && <DuplicateBadge status={dup.duplicate_status} />}
                                {row.errors.map((e) => (
                                  <p key={e} className="text-[10px] text-destructive">{e}</p>
                                ))}
                                {row.warnings.map((w) => (
                                  <p key={w} className="text-[10px] text-muted-foreground">{w}</p>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {preview.errors === preview.total && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
                    Todas las filas tienen errores bloqueantes. Corrige los datos y vuelve a intentarlo.
                  </div>
                )}
              </div>

              <SheetFooter className="border-t border-border/40 px-6 py-4">
                <Button variant="ghost" onClick={() => setStep('input')} className="text-xs">
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Volver
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={
                    confirming ||
                    (preview.valid + preview.warnings_only === 0)
                  }
                  className="gap-2 text-xs"
                >
                  {confirming ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Importando…
                    </>
                  ) : (
                    `Importar ${preview.valid + preview.warnings_only} candidato${preview.valid + preview.warnings_only !== 1 ? 's' : ''}`
                  )}
                </Button>
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
                  <Button
                    onClick={() => {
                      handleClose();
                      if (resultBatchId) router.push(`/prospect-batches/${resultBatchId}`);
                    }}
                    className="w-full gap-2 text-xs"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Revisar lote
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetState}
                    className="w-full text-xs"
                  >
                    Importar otro archivo
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
