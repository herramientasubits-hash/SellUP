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
import { generateAIProspectBatch } from '@/modules/prospect-batches/actions';
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

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const suggestedSource = form.countryCode ? STRUCTURED_SOURCE_MAP[form.countryCode] ?? null : null;

  function handleClose() {
    if (generating) return;
    setOpen(false);
    setForm({ ...EMPTY });
    setProgressMsg('');
    setPreflightResult(null);
    setGeneratedBatchId(null);
  }

  function handleGoToBatch() {
    if (!generatedBatchId) return;
    setOpen(false);
    setForm({ ...EMPTY });
    setProgressMsg('');
    setPreflightResult(null);
    setGeneratedBatchId(null);
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
      });

      toast.success(
        `Lote generado con ${result.candidatesCreated} empresa${result.candidatesCreated !== 1 ? 's' : ''} candidata${result.candidatesCreated !== 1 ? 's' : ''}`,
        { description: 'Listo para revisión humana.' }
      );

      if (result.structuredSourcePreflight) {
        setPreflightResult(result.structuredSourcePreflight);
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
  const showPreflightResult = !!preflightResult && !!generatedBatchId;

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
                onGoToBatch={handleGoToBatch}
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
              <div className="flex w-full items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                >
                  Cerrar
                </Button>
                <Button
                  size="sm"
                  onClick={handleGoToBatch}
                  className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
                >
                  Ver lote generado
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
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

function PreflightResultPanel({
  result,
  onGoToBatch,
}: {
  result: SourceDiscoveryPreflightResult;
  onGoToBatch: () => void;
}) {
  const statusIcon = PREFLIGHT_STATUS_ICONS[result.status] ?? PREFLIGHT_STATUS_ICONS.skipped;
  const statusLabel = PREFLIGHT_STATUS_LABELS[result.status] ?? result.status;
  const sourceLabel = result.selectedSourceKey
    ? (STRUCTURED_SOURCE_LABELS[result.selectedSourceKey] ?? result.selectedSourceKey)
    : '—';

  return (
    <div className="space-y-6 px-7 py-6">
      {/* Título */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground">
            Resultado preflight estructurado
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Consulta previa de la fuente estructurada. Solo lectura.
        </p>
      </div>

      {/* Estado y fuente */}
      <div className="rounded-xl border border-border/40 bg-card px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Fuente seleccionada</span>
          <span className="text-xs font-medium text-foreground">{sourceLabel}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Estado</span>
          <div className="flex items-center gap-1.5">
            {statusIcon}
            <span className="text-xs font-medium text-foreground">{statusLabel}</span>
          </div>
        </div>
      </div>

      {/* Conteos */}
      <div className="rounded-xl border border-border/40 bg-card px-4 py-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Resumen de registros
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {[
            { label: 'Registros leídos', value: result.recordsRead },
            { label: 'Candidatos potenciales', value: result.candidatesCount },
            { label: 'Aceptados', value: result.acceptedCount },
            { label: 'Baja prioridad', value: result.lowPriorityCount },
            { label: 'Filtrados', value: result.filteredOutCount },
            { label: 'Con tax ID', value: result.qualitySummary.withTaxId },
            { label: 'Con sector', value: result.qualitySummary.withSector },
            { label: 'Sector desconocido', value: result.qualitySummary.sectorUnknown },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-xs font-medium tabular-nums text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Muestras */}
      {result.samples.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Muestras ({result.samples.length} de máx. 5)
          </p>
          <div className="flex flex-col gap-1.5">
            {result.samples.map((s, i) => (
              <div
                key={i}
                className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 space-y-0.5"
              >
                <p className="text-xs font-medium text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[s.city, s.region, s.countryCode].filter(Boolean).join(' · ')}
                  {s.taxId ? ` · ${s.taxId}` : ''}
                </p>
                {s.sectorDescription && (
                  <p className="text-xs text-muted-foreground">{s.sectorDescription}</p>
                )}
                {s.qualityDecision && (
                  <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {s.qualityDecision}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              Advertencias
            </span>
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="text-xs text-muted-foreground pl-5">{w}</p>
          ))}
        </div>
      )}

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs font-semibold text-destructive">
              Errores sanitizados
            </span>
          </div>
          {result.errors.map((err, i) => (
            <p key={i} className="text-xs text-muted-foreground pl-5">{err}</p>
          ))}
        </div>
      )}

      {/* Disclaimer solo lectura */}
      <div className="rounded-xl border border-border/40 bg-muted/40 px-4 py-3">
        <div className="flex gap-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Este resultado es solo lectura. No creó candidatos ni lotes desde fuentes estructuradas.
            El lote generado usa exclusivamente el flujo Apollo actual.
          </p>
        </div>
      </div>

      {/* CTA redundante visible en panel */}
      <Button
        size="sm"
        onClick={onGoToBatch}
        className="w-full gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
      >
        Ver lote generado
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
