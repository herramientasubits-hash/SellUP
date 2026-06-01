'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Loader2,
  Globe,
  Target,
  Zap,
  AlertCircle,
  CheckCircle2,
  Database,
  ChevronRight,
  TriangleAlert,
  XCircle,
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { generateAIProspectBatch, runProspectPreflight } from '@/modules/prospect-batches/actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  BATCH_SEARCH_DEPTH_LABELS,
  type BatchSearchDepth,
} from '@/modules/prospect-batches/types';
import { Section, Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { type SourceDiscoveryPreflightResult } from '@/server/agents/prospecting-toolkit/source-discovery-preflight';

const MVP_MAX_CANDIDATES = 25;

// Mapa país → fuente estructurada sugerida (espeja COUNTRY_SOURCE_MAP del backend)
// cl_chilecompra excluido intencionalmente hasta tener ticket.
const STRUCTURED_SOURCE_MAP: Record<string, string> = {
  CO: 'co_rues',
  MX: 'mx_denue',
  CL: 'cl_res',
};

const STRUCTURED_SOURCE_LABELS: Record<string, string> = {
  co_rues: 'RUES · Registro Único Empresarial (Colombia)',
  mx_denue: 'DENUE · Directorio Nacional de Empresas (México)',
  cl_res: 'Registro de Empresas y Sociedades (Chile)',
};

const PREFLIGHT_STATUS_ICONS = {
  success: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
  warning: <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />,
  error: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  skipped: <Info className="h-3.5 w-3.5 text-muted-foreground" />,
};

const PREFLIGHT_STATUS_LABELS: Record<string, string> = {
  success: 'Éxito',
  warning: 'Con advertencias',
  error: 'Error',
  skipped: 'Omitido',
};

const EMPTY = {
  countryCode: '',
  industry: '',
  targetCount: String(MVP_MAX_CANDIDATES),
  searchDepth: 'standard' as BatchSearchDepth,
  structuredSourcePreflight: false,
  createStructuredSourceBatch: false,
};

export function GenerateAIBatchDrawer() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });
  const [generating, setGenerating] = React.useState(false);
  const [progressMsg, setProgressMsg] = React.useState('');
  const [preflightResult, setPreflightResult] =
    React.useState<SourceDiscoveryPreflightResult | null>(null);
  const [generatedBatchId, setGeneratedBatchId] = React.useState<string | null>(null);

  const [runningPreflight, setRunningPreflight] = React.useState(false);
  const [dynamicPreflight, setDynamicPreflight] =
    React.useState<SourceDiscoveryPreflightResult | null>(null);
  const [preflightError, setPreflightError] = React.useState<string | null>(null);
  const [structuredBatchResult, setStructuredBatchResult] =
    React.useState<any | null>(null);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const suggestedSource = form.countryCode ? STRUCTURED_SOURCE_MAP[form.countryCode] ?? null : null;

  // Run preflight dynamically when preflight is checked, country is selected, and industry is selected
  React.useEffect(() => {
    let active = true;
    if (form.structuredSourcePreflight && form.countryCode && form.industry) {
      const runPreflight = async () => {
        setRunningPreflight(true);
        setPreflightError(null);
        setDynamicPreflight(null);
        try {
          const countryObj = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);
          const res = await runProspectPreflight({
            country: countryObj?.name ?? form.countryCode,
            countryCode: form.countryCode,
            industry: form.industry,
            targetCount: parseInt(form.targetCount) || MVP_MAX_CANDIDATES,
            searchDepth: form.searchDepth as 'basic' | 'standard',
          });
          if (active) {
            setDynamicPreflight(res);
            if (form.countryCode !== 'CO') {
              set('createStructuredSourceBatch', false);
            }
          }
        } catch (err) {
          if (active) {
            setPreflightError(err instanceof Error ? err.message : 'Error al ejecutar preflight');
          }
        } finally {
          if (active) {
            setRunningPreflight(false);
          }
        }
      };
      runPreflight();
    } else {
      setDynamicPreflight(null);
      setPreflightError(null);
      set('createStructuredSourceBatch', false);
    }
    return () => {
      active = false;
    };
  }, [form.structuredSourcePreflight, form.countryCode, form.industry, form.targetCount, form.searchDepth]);

  function handleClose() {
    if (generating) return;
    setOpen(false);
    setForm({ ...EMPTY });
    setProgressMsg('');
    setPreflightResult(null);
    setDynamicPreflight(null);
    setPreflightError(null);
    setGeneratedBatchId(null);
    setStructuredBatchResult(null);
  }

  function handleGoToBatch() {
    if (!generatedBatchId) return;
    setOpen(false);
    setForm({ ...EMPTY });
    setProgressMsg('');
    setPreflightResult(null);
    setDynamicPreflight(null);
    setPreflightError(null);
    setGeneratedBatchId(null);
    setStructuredBatchResult(null);
    router.push(`/prospect-batches/${generatedBatchId}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.countryCode) {
      toast.error('Selecciona un país');
      return;
    }
    if (!form.industry) {
      toast.error('Selecciona una industria');
      return;
    }

    const count = parseInt(form.targetCount) || MVP_MAX_CANDIDATES;

    setGenerating(true);
    setPreflightResult(null);
    setStructuredBatchResult(null);
    setGeneratedBatchId(null);
    setProgressMsg('Iniciando agente…');

    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);

      if (form.structuredSourcePreflight) {
        setProgressMsg('Ejecutando preflight de fuente estructurada…');
      } else {
        setProgressMsg('Consultando Apollo para descubrir empresas…');
      }

      const result = await generateAIProspectBatch({
        country: country?.name ?? form.countryCode,
        countryCode: form.countryCode,
        industry: form.industry,
        targetCount: count,
        searchDepth: form.searchDepth as 'basic' | 'standard',
        structuredSourcePreflight: form.structuredSourcePreflight,
        structuredSourceKey: null,
        createStructuredSourceBatch: form.createStructuredSourceBatch,
      });

      toast.success(
        `Lote generado con ${result.candidatesCreated} empresa${result.candidatesCreated !== 1 ? 's' : ''} candidata${result.candidatesCreated !== 1 ? 's' : ''}`,
        { description: 'Listo para revisión humana.' }
      );

      if (result.structuredSourcePreflight || result.structuredSourceBatch) {
        setStructuredBatchResult(result.structuredSourceBatch ?? null);
        setPreflightResult(result.structuredSourcePreflight ?? dynamicPreflight);
        setGeneratedBatchId(result.batchId);
        setProgressMsg('');
      } else {
        setOpen(false);
        setForm({ ...EMPTY });
        setProgressMsg('');
        router.push(`/prospect-batches/${result.batchId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el lote');
      setProgressMsg('');
    } finally {
      setGenerating(false);
    }
  }

  const canSubmit = !!form.countryCode && !!form.industry && !generating;
  const showPreflightResult = (!!preflightResult || !!structuredBatchResult) && !!generatedBatchId;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generar con IA
      </Button>

      <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
        <SheetContent className="flex flex-col gap-0 overflow-hidden sm:w-[40vw] sm:min-w-[520px] sm:max-w-none">
          {/* Header */}
          <SheetHeader className="shrink-0 border-b border-border/50 px-7 pb-5 pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-su-ai-from to-su-ai-to">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div className="space-y-0.5">
                <SheetTitle className="text-base font-semibold">
                  Generar empresas candidatas con IA
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground/70">
                  El agente consulta Apollo para descubrir empresas y usa HubSpot para detectar duplicados.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {showPreflightResult ? (
              /* ── Resultado del preflight ── */
              <PreflightResultPanel
                result={preflightResult}
                structuredBatch={structuredBatchResult}
                apolloBatchId={generatedBatchId}
              />
            ) : (
              /* ── Formulario principal ── */
              <form
                id="generate-ai-batch-form"
                onSubmit={handleSubmit}
                className="space-y-8 px-7 py-6"
              >
                {/* Segmentación */}
                <Section icon={Globe} label="Segmentación">
                  <Row>
                    <Field label="País" required>
                      <Select
                        value={form.countryCode}
                        onValueChange={(v) => set('countryCode', v ?? '')}
                        disabled={generating}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Seleccionar país" />
                        </SelectTrigger>
                        <SelectContent>
                          {LATAM_COUNTRIES.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {getFlagEmoji(c.code)} {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Industria" required>
                      <Select
                        value={form.industry}
                        onValueChange={(v) => set('industry', v ?? '')}
                        disabled={generating}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Seleccionar industria" />
                        </SelectTrigger>
                        <SelectContent>
                          {INDUSTRIES.map((ind) => (
                            <SelectItem key={ind} value={ind}>
                              {ind}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </Row>
                </Section>

                {/* Parámetros */}
                <Section icon={Target} label="Parámetros">
                  <Row>
                    <Field label="Cantidad objetivo">
                      <Select
                        value={form.targetCount}
                        onValueChange={(v) => set('targetCount', v ?? String(MVP_MAX_CANDIDATES))}
                        disabled={generating}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[5, 10, 15, 20, 25].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} empresas
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Profundidad">
                      <Select
                        value={form.searchDepth}
                        onValueChange={(v) => set('searchDepth', (v ?? 'standard') as BatchSearchDepth)}
                        disabled={generating}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['basic', 'standard'] as BatchSearchDepth[]).map((key) => (
                            <SelectItem key={key} value={key}>
                              {BATCH_SEARCH_DEPTH_LABELS[key]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </Row>
                </Section>

                {/* Preflight de fuentes estructuradas */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Preflight de fuentes estructuradas
                    </span>
                  </div>

                  <div className="rounded-xl border border-border/40 bg-card px-4 py-3 space-y-3">
                    {/* Toggle */}
                    <div className="flex items-start gap-3">
                      <input
                        id="structured-source-preflight"
                        type="checkbox"
                        checked={form.structuredSourcePreflight}
                        onChange={(e) => set('structuredSourcePreflight', e.target.checked)}
                        disabled={generating}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand"
                      />
                      <Label
                        htmlFor="structured-source-preflight"
                        className="cursor-pointer space-y-0.5"
                      >
                        <span className="text-xs font-medium text-foreground">
                          Ejecutar preflight estructurado
                        </span>
                        <p className="text-xs text-muted-foreground">
                          Ejecuta una consulta previa de la fuente estructurada sugerida para el país.
                          No crea candidatos desde esa fuente ni reemplaza el flujo actual.
                        </p>
                      </Label>
                    </div>

                    {/* Fuente sugerida por país */}
                    {form.structuredSourcePreflight && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
                          {suggestedSource ? (
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                              <div>
                                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                                  Fuente sugerida
                                </span>
                                <p className="text-xs font-medium text-foreground">
                                  {STRUCTURED_SOURCE_LABELS[suggestedSource] ?? suggestedSource}
                                </p>
                              </div>
                            </div>
                          ) : form.countryCode ? (
                            <div className="flex items-center gap-2">
                              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">
                                Sin fuente estructurada para este país. El preflight se omitirá.
                              </p>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <p className="text-xs text-muted-foreground">
                                Selecciona un país para ver la fuente sugerida.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Dynamic preflight status and candidate option */}
                        {runningPreflight && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
                            <Loader2 className="h-3 w-3 animate-spin text-su-brand" />
                            <span>Ejecutando consulta de preflight...</span>
                          </div>
                        )}

                        {preflightError && (
                          <div className="flex items-center gap-2 text-xs text-destructive pl-1">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span>Error en preflight: {preflightError}</span>
                          </div>
                        )}

                        {dynamicPreflight && (
                          <div className="space-y-3">
                            <div className="rounded-lg border border-border/30 bg-card px-3 py-2 text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Estado preflight:</span>
                                <span className="font-medium text-foreground capitalize">
                                  {PREFLIGHT_STATUS_LABELS[dynamicPreflight.status] ?? dynamicPreflight.status}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Candidatos potenciales:</span>
                                <span className="font-semibold text-foreground">{dynamicPreflight.candidatesCount}</span>
                              </div>
                            </div>

                            {/* Checkbox visible ONLY for Colombia / co_rues when success/warning and candidates > 0 */}
                            {form.countryCode === 'CO' &&
                              suggestedSource === 'co_rues' &&
                              (dynamicPreflight.status === 'success' || dynamicPreflight.status === 'warning') &&
                              dynamicPreflight.candidatesCount > 0 && (
                                <div className="flex items-start gap-3 rounded-lg border border-su-brand/20 bg-su-brand-soft/10 p-3">
                                  <input
                                    id="create-structured-source-batch"
                                    type="checkbox"
                                    checked={form.createStructuredSourceBatch}
                                    onChange={(e) => set('createStructuredSourceBatch', e.target.checked)}
                                    disabled={generating}
                                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand"
                                  />
                                  <Label
                                    htmlFor="create-structured-source-batch"
                                    className="cursor-pointer space-y-0.5"
                                  >
                                    <span className="text-xs font-semibold text-foreground">
                                      Crear también lote desde fuente oficial
                                    </span>
                                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                                      Se creará un lote separado con candidatos de RUES/co_rues. Quedarán en revisión humana. No se enviarán a HubSpot.
                                    </p>
                                  </Label>
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                {/* Info note */}
                <div className="rounded-xl border border-border/40 bg-muted/40 px-4 py-3">
                  <div className="flex gap-2.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <p className="text-xs text-muted-foreground">
                      El MVP permite máximo {MVP_MAX_CANDIDATES} empresas candidatas por lote para controlar calidad y costos.
                      Ninguna empresa se crea automáticamente — toda candidata requiere revisión humana.
                    </p>
                  </div>
                </div>

                {/* Cascada visible */}
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Fuentes que usará el agente
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {[
                      { label: 'Apollo', desc: 'Discovery de empresas por país e industria', active: true },
                      { label: 'HubSpot', desc: 'Detección de duplicados (solo lectura)', active: true },
                    ].map((src) => (
                      <div
                        key={src.label}
                        className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card px-3 py-2"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span className="text-xs font-medium text-foreground">{src.label}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{src.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Footer */}
          <SheetFooter className="shrink-0 border-t border-border/50 px-7 py-4">
            {showPreflightResult ? (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                >
                  Cerrar
                </Button>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {structuredBatchResult?.ok && structuredBatchResult.batchId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const sId = structuredBatchResult.batchId;
                        handleClose();
                        if (sId) router.push(`/prospect-batches/${sId}`);
                      }}
                      className="gap-1.5 border-su-brand/30 text-su-brand hover:bg-su-brand/5"
                    >
                      Ver lote fuente oficial
                      <ChevronRight className="h-3.5 w-3.5 text-su-brand" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleGoToBatch}
                    className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
                  >
                    Ver lote Apollo
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {generating && progressMsg && (
                  <p className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {progressMsg}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClose}
                    disabled={generating}
                  >
                    Cancelar
                  </Button>
                  <Button
                    form="generate-ai-batch-form"
                    type="submit"
                    size="sm"
                    disabled={!canSubmit}
                    className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent disabled:opacity-40"
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    {generating ? 'Generando…' : 'Generar empresas candidatas'}
                  </Button>
                </div>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ── Panel de resultado del preflight ─────────────────────────────────────────

interface PreflightResultPanelProps {
  result: SourceDiscoveryPreflightResult | null;
  structuredBatch: {
    ok: boolean;
    batchId?: string | null;
    sourceKey?: string;
    candidatesWritten?: number;
    candidatesSkipped?: number;
    warnings?: string[];
    errors?: string[];
  } | null | undefined;
  apolloBatchId: string | null;
}

function PreflightResultPanel({
  result,
  structuredBatch,
  apolloBatchId,
}: PreflightResultPanelProps) {
  const statusIcon = result ? PREFLIGHT_STATUS_ICONS[result.status] ?? PREFLIGHT_STATUS_ICONS.skipped : null;
  const statusLabel = result ? PREFLIGHT_STATUS_LABELS[result.status] ?? result.status : '';

  return (
    <div className="space-y-6 px-7 py-6">
      {/* Título */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground">
            Resumen de Generación
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Los lotes se han procesado correctamente y están listos para revisión humana.
        </p>
      </div>

      {/* Lote Apollo */}
      <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
          <div className="h-2 w-2 rounded-full bg-su-brand" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
            Lote Apollo (Principal)
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Estado:</span>
          <span className="font-medium text-emerald-500 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Creado
          </span>
        </div>
        {apolloBatchId && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Batch ID:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground">
              {apolloBatchId.slice(0, 8)}...
            </code>
          </div>
        )}
      </div>

      {/* Lote fuente oficial (si se generó) */}
      {structuredBatch && (
        <div className={`rounded-xl border p-4 space-y-3 bg-card ${structuredBatch.ok ? 'border-su-brand/20' : 'border-destructive/20'}`}>
          <div className="flex items-center gap-2 border-b border-border/40 pb-2">
            <div className={`h-2 w-2 rounded-full ${structuredBatch.ok ? 'bg-su-brand' : 'bg-destructive'}`} />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Lote Fuente Oficial (RUES/co_rues)
            </span>
          </div>

          {structuredBatch.ok ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Estado:</span>
                <span className="font-medium text-emerald-500 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Creado (Revisión humana)
                </span>
              </div>
              {structuredBatch.batchId && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Batch ID:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                    {structuredBatch.batchId.slice(0, 8)}...
                  </code>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Escritos:</span>
                  <span className="font-semibold text-foreground">{structuredBatch.candidatesWritten}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Omitidos:</span>
                  <span className="font-semibold text-foreground">{structuredBatch.candidatesSkipped}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <span className="text-xs font-medium text-destructive">Error en la creación del lote estructurado</span>
              {structuredBatch.errors && structuredBatch.errors.map((err, i) => (
                <p key={i} className="text-[11px] text-destructive/80 pl-2">
                  · {err}
                </p>
              ))}
            </div>
          )}

          {/* Warnings del lote estructurado */}
          {structuredBatch.warnings && structuredBatch.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-500/5 p-2 border border-amber-500/10 text-[11px] text-amber-600 dark:text-amber-400 space-y-1">
              <div className="flex items-center gap-1 font-semibold">
                <TriangleAlert className="h-3 w-3" />
                <span>Advertencias</span>
              </div>
              {structuredBatch.warnings.map((w, i) => (
                <p key={i} className="pl-4">· {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Resultado del preflight (solo informativo si no se seleccionó el lote estructurado) */}
      {!structuredBatch && result && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              Preflight Fuente Oficial
            </span>
            <div className="flex items-center gap-1 text-[11px]">
              {statusIcon}
              <span className="font-medium text-foreground">{statusLabel}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Candidatos leídos:</span>
              <span className="font-medium text-foreground">{result.recordsRead}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Potenciales:</span>
              <span className="font-medium text-foreground">{result.candidatesCount}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
