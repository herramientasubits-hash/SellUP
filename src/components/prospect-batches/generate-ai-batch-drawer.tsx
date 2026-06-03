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
  ChevronDown,
  Settings2,
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

type StructuredBatchResult = {
  ok: boolean;
  batchId?: string | null;
  sourceKey?: string;
  candidatesWritten?: number;
  candidatesSkipped?: number;
  warnings?: string[];
  errors?: string[];
  pageUsed?: number;
  pagesScanned?: number[];
  autoMode?: boolean;
  status?: 'official_source_error' | 'official_source_empty' | 'official_source_no_useful_candidates' | 'official_source_success';
  errorDetails?: string;
};

const MVP_MAX_CANDIDATES = 25;

// Mapa país → fuente estructurada oficial. cl_chilecompra excluido hasta tener ticket.
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

const STRUCTURED_PAGE_MAX = 5;

const EMPTY = {
  countryCode: '',
  industry: '',
  targetCount: String(MVP_MAX_CANDIDATES),
  searchDepth: 'standard' as BatchSearchDepth,
  // Advanced / QA controls — not shown in main vendor view
  advStructuredSourcePreflight: false,
  advCreateStructuredSourceBatch: false,
  advStructuredSourcePage: 1,
  advSearchDepth: 'standard' as BatchSearchDepth,
};

// Sources shown per country in the informational block
function getAutoSources(countryCode: string) {
  if (countryCode === 'CO') {
    return [
      { label: 'RUES Colombia', desc: 'Registro oficial · validación legal y tributaria' },
      { label: 'Apollo', desc: 'Enriquecimiento comercial' },
      { label: 'HubSpot', desc: 'Detección de duplicados (solo lectura)' },
    ];
  }
  if (countryCode === 'CL') {
    return [
      { label: 'Fuente oficial de Chile', desc: 'Registro de Empresas y Sociedades' },
      { label: 'Apollo', desc: 'Discovery comercial' },
      { label: 'HubSpot', desc: 'Detección de duplicados (solo lectura)' },
    ];
  }
  if (countryCode) {
    return [
      { label: 'Apollo', desc: 'Discovery de empresas por país e industria' },
      { label: 'HubSpot', desc: 'Detección de duplicados (solo lectura)' },
    ];
  }
  return [
    { label: 'Apollo', desc: 'Discovery comercial' },
    { label: 'HubSpot', desc: 'Detección de duplicados (solo lectura)' },
  ];
}

export function GenerateAIBatchDrawer() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });
  const [generating, setGenerating] = React.useState(false);
  const [progressMsg, setProgressMsg] = React.useState('');
  const [preflightResult, setPreflightResult] =
    React.useState<SourceDiscoveryPreflightResult | null>(null);
  const [generatedBatchId, setGeneratedBatchId] = React.useState<string | null>(null);
  const [structuredBatchResult, setStructuredBatchResult] = React.useState<StructuredBatchResult | null>(null);
  const [sourceStrategy, setSourceStrategy] = React.useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [usefulCandidatesCount, setUsefulCandidatesCount] = React.useState<number>(0);
  const [omittedCandidatesCount, setOmittedCandidatesCount] = React.useState<number>(0);
  const [generationAttempted, setGenerationAttempted] = React.useState(false);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // For Colombia, structured source activates automatically
  const isColombiaAuto = form.countryCode === 'CO';
  const autoSources = getAutoSources(form.countryCode);
  const suggestedSource = form.countryCode ? STRUCTURED_SOURCE_MAP[form.countryCode] ?? null : null;

  function handleClose() {
    if (generating) return;
    setOpen(false);
    setForm({ ...EMPTY });
    setProgressMsg('');
    setPreflightResult(null);
    setGeneratedBatchId(null);
    setStructuredBatchResult(null);
    setSourceStrategy(null);
    setAdvancedOpen(false);
    setUsefulCandidatesCount(0);
    setOmittedCandidatesCount(0);
    setGenerationAttempted(false);
  }

  function handleGoToBatch() {
    if (!generatedBatchId) return;
    const id = generatedBatchId;
    handleClose();
    router.push(`/prospect-batches/${id}`);
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

    const count = (form.countryCode === 'CO' && !advancedOpen) ? 5 : (parseInt(form.targetCount) || 10);

    setGenerating(true);
    setPreflightResult(null);
    setStructuredBatchResult(null);
    setGeneratedBatchId(null);
    setProgressMsg('Iniciando agente…');

    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);

      setProgressMsg('Consultando fuentes y descubriendo empresas…');

      // For CO: auto-activate structured source. Advanced overrides take effect only if advanced is open.
      const effectivePreflight = isColombiaAuto
        ? true
        : advancedOpen && form.advStructuredSourcePreflight;
      const effectiveCreateBatch = isColombiaAuto
        ? true
        : advancedOpen && form.advCreateStructuredSourceBatch;
      const effectiveSourceKey = isColombiaAuto ? 'co_rues' : null;
      const effectivePage = form.advStructuredSourcePage;
      const effectiveDepth = (advancedOpen ? form.advSearchDepth : form.searchDepth) as 'basic' | 'standard';
      // Auto-paginate when user is in vendor mode (advanced not opened for Colombia)
      const effectivePageAuto = isColombiaAuto && !advancedOpen;

      const result = await generateAIProspectBatch({
        country: country?.name ?? form.countryCode,
        countryCode: form.countryCode,
        industry: form.industry,
        targetCount: count,
        searchDepth: effectiveDepth,
        structuredSourcePreflight: effectivePreflight,
        structuredSourceKey: effectiveSourceKey,
        createStructuredSourceBatch: effectiveCreateBatch,
        structuredSourcePage: effectivePage,
        structuredSourcePageAuto: effectivePageAuto,
      });

      const uCount = result.usefulCandidatesCount ?? result.candidatesCreated ?? 0;
      const oCount = result.omittedCandidatesCount ?? 0;
      setUsefulCandidatesCount(uCount);
      setOmittedCandidatesCount(oCount);

      if (uCount > 0) {
        toast.success(
          `${uCount} empresa${uCount !== 1 ? 's' : ''} candidata${uCount !== 1 ? 's' : ''} lista${uCount !== 1 ? 's' : ''} para revisión`,
          { description: 'Ninguna empresa se crea automáticamente — toda candidata requiere revisión humana.' }
        );
      } else {
        toast.warning(
          'No se encontraron empresas útiles para revisión',
          { description: 'SellUp omitió registros por liquidación, inactividad, duplicidad o datos mínimos insuficientes.' }
        );
      }

      if (result.structuredSourcePreflight || result.structuredSourceBatch || uCount === 0) {
        setStructuredBatchResult(result.structuredSourceBatch ?? null);
        setPreflightResult(result.structuredSourcePreflight ?? null);
        setGeneratedBatchId(result.batchId);
        setSourceStrategy(result.sourceStrategy ?? null);
        setGenerationAttempted(true);
        setProgressMsg('');
      } else {
        setOpen(false);
        setForm({ ...EMPTY });
        setProgressMsg('');
        if (result.batchId) {
          router.push(`/prospect-batches/${result.batchId}`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el lote');
      setProgressMsg('');
    } finally {
      setGenerating(false);
    }
  }

  const canSubmit = !!form.countryCode && !!form.industry && !generating;
  const showPreflightResult = generationAttempted && (!!preflightResult || !!structuredBatchResult || usefulCandidatesCount === 0);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generar empresas candidatas
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
                  El agente consulta las fuentes configuradas para el país y usa HubSpot para detectar duplicados.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {showPreflightResult ? (
              /* ── Resultado de generación ── */
              <GenerationResultPanel
                result={preflightResult}
                structuredBatch={structuredBatchResult}
                apolloBatchId={generatedBatchId}
                structuredSourcePage={form.advStructuredSourcePage}
                sourceStrategy={sourceStrategy}
                advancedOpen={advancedOpen}
                usefulCandidatesCount={usefulCandidatesCount}
                omittedCandidatesCount={omittedCandidatesCount}
                countryCode={form.countryCode}
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

                {/* Cantidad */}
                {advancedOpen ? (
                  <Section icon={Target} label="Cantidad">
                    <Field label="Cantidad de empresas">
                      <Select
                        value={form.targetCount}
                        onValueChange={(v) => set('targetCount', v ?? '10')}
                        disabled={generating}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[10, 15, 20, 25].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} empresas
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                        La cantidad debe estar entre 10 y 25. SellUp intentará encontrar hasta esta cantidad. La cantidad final puede variar según calidad y duplicados.
                      </p>
                    </Field>
                  </Section>
                ) : (
                  <Section icon={Target} label="Cantidad">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {form.countryCode === 'CO' ? (
                        "SellUp buscará hasta 5 empresas útiles para revisión. Si encuentra registros duplicados, liquidados, inactivos o sin datos mínimos, los omitirá automáticamente."
                      ) : (
                        "SellUp buscará hasta 10 empresas útiles para revisión. Si encuentra duplicadas, liquidadas o no viables, las omitirá automáticamente y podrá hacer hasta 2 intentos de búsqueda."
                      )}
                    </p>
                  </Section>
                )}

                {/* Fuentes automáticas */}
                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Fuentes que usará el agente
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {autoSources.map((src) => (
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
                  {!form.countryCode && (
                    <p className="text-[11px] text-muted-foreground/70 pl-1">
                      Las fuentes se configuran automáticamente al seleccionar el país.
                    </p>
                  )}
                </section>

                {/* Nota MVP */}
                <div className="rounded-xl border border-border/40 bg-muted/40 px-4 py-3">
                  <div className="flex gap-2.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <p className="text-xs text-muted-foreground">
                      Ninguna empresa se crea automáticamente — toda candidata requiere revisión humana para validar su información comercial y legal.
                    </p>
                  </div>
                </div>

                {/* Opciones avanzadas */}
                <section className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex w-full items-center gap-2 text-left"
                    disabled={generating}
                  >
                    <Settings2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                      Opciones avanzadas
                    </span>
                    <ChevronDown
                      className={`ml-auto h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {advancedOpen && (
                    <div className="rounded-xl border border-border/40 bg-muted/20 px-4 py-4 space-y-4">
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500/80" />
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Estas opciones son para diagnóstico y QA. En uso normal SellUp selecciona las fuentes automáticamente.
                        </p>
                      </div>

                      {/* Cantidad override */}
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Cantidad (Override QA)
                        </Label>
                        <Select
                          value={form.targetCount}
                          onValueChange={(v) => set('targetCount', v ?? '10')}
                          disabled={generating}
                        >
                          <SelectTrigger className="w-full h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[10, 15, 20, 25].map((n) => (
                              <SelectItem key={n} value={String(n)} className="text-xs">
                                {n} empresas
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Profundidad de búsqueda */}
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Profundidad de búsqueda
                        </Label>
                        <Select
                          value={form.advSearchDepth}
                          onValueChange={(v) => set('advSearchDepth', (v ?? 'standard') as BatchSearchDepth)}
                          disabled={generating}
                        >
                          <SelectTrigger className="w-full h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(['basic', 'standard'] as BatchSearchDepth[]).map((key) => (
                              <SelectItem key={key} value={key} className="text-xs">
                                {BATCH_SEARCH_DEPTH_LABELS[key]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Preflight estructurado */}
                      <div className="flex items-start gap-3">
                        <input
                          id="adv-structured-source-preflight"
                          type="checkbox"
                          checked={isColombiaAuto || form.advStructuredSourcePreflight}
                          onChange={(e) => {
                            if (!isColombiaAuto) set('advStructuredSourcePreflight', e.target.checked);
                          }}
                          disabled={generating || isColombiaAuto}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand disabled:cursor-not-allowed"
                        />
                        <Label htmlFor="adv-structured-source-preflight" className="cursor-pointer space-y-0.5">
                          <span className="text-xs font-medium text-foreground">
                            Ejecutar preflight estructurado
                          </span>
                          {isColombiaAuto && (
                            <p className="text-[10px] text-muted-foreground">
                              Activado automáticamente para Colombia.
                            </p>
                          )}
                          {!isColombiaAuto && suggestedSource && (
                            <p className="text-[11px] text-muted-foreground">
                              Fuente: {STRUCTURED_SOURCE_LABELS[suggestedSource] ?? suggestedSource}
                            </p>
                          )}
                          {!isColombiaAuto && !suggestedSource && form.countryCode && (
                            <p className="text-[11px] text-muted-foreground">
                              Sin fuente estructurada para este país.
                            </p>
                          )}
                        </Label>
                      </div>

                      {/* Crear lote fuente oficial */}
                      <div className="flex items-start gap-3">
                        <input
                          id="adv-create-structured-source-batch"
                          type="checkbox"
                          checked={isColombiaAuto || form.advCreateStructuredSourceBatch}
                          onChange={(e) => {
                            if (!isColombiaAuto) set('advCreateStructuredSourceBatch', e.target.checked);
                          }}
                          disabled={generating || isColombiaAuto}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand disabled:cursor-not-allowed"
                        />
                        <Label htmlFor="adv-create-structured-source-batch" className="cursor-pointer space-y-0.5">
                          <span className="text-xs font-medium text-foreground">
                            Crear también lote desde fuente oficial
                          </span>
                          {isColombiaAuto && (
                            <p className="text-[10px] text-muted-foreground">
                              Activado automáticamente para Colombia (RUES/co_rues).
                            </p>
                          )}
                          {!isColombiaAuto && (
                            <p className="text-[11px] text-muted-foreground">
                              Crea lote separado con candidatos de la fuente oficial. Requieren revisión humana.
                            </p>
                          )}
                        </Label>
                      </div>

                      {/* Página RUES — solo diagnóstico/QA */}
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          Usar página específica de fuente oficial
                        </Label>
                        <Select
                          value={String(form.advStructuredSourcePage)}
                          onValueChange={(v) =>
                            set('advStructuredSourcePage', Math.max(1, Math.min(STRUCTURED_PAGE_MAX, parseInt(v ?? '1') || 1)))
                          }
                          disabled={generating}
                        >
                          <SelectTrigger className="w-full h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: STRUCTURED_PAGE_MAX }, (_, i) => i + 1).map((p) => (
                              <SelectItem key={p} value={String(p)} className="text-xs">
                                Página {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Solo diagnóstico / QA. En uso normal SellUp selecciona la página automáticamente.
                        </p>
                      </div>
                    </div>
                  )}
                </section>
              </form>
            )}
          </div>

          {/* Footer */}
          <SheetFooter className="shrink-0 border-t border-border/50 px-7 py-4">
            {showPreflightResult ? (
              <div className="flex w-full flex-col gap-3">
                {/* Mensaje contextual según estrategia de fuentes */}
                {usefulCandidatesCount === 0 ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium leading-relaxed">
                    No se encontraron empresas útiles para revisión. SellUp omitió registros por liquidación, inactividad, duplicidad o datos mínimos insuficientes.
                  </p>
                ) : sourceStrategy === 'official_source_satisfied' ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    SellUp encontró {structuredBatchResult?.candidatesWritten ?? 10} empresas útiles en fuente oficial. Se omitieron {structuredBatchResult?.candidatesSkipped ?? 0} registros no viables.
                  </p>
                ) : sourceStrategy === 'official_plus_commercial' ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    SellUp encontró {structuredBatchResult?.candidatesWritten ?? 0} empresas útiles en fuente oficial y completó con fuente comercial.
                  </p>
                ) : sourceStrategy === 'commercial_fallback' ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    No se encontraron empresas útiles con los criterios actuales. Intenta otra industria o país.
                  </p>
                ) : structuredBatchResult && !structuredBatchResult.ok && isAutoModeAllPagesScanned(structuredBatchResult) ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    SellUp encontró {structuredBatchResult?.candidatesWritten ?? 0} empresas útiles. Se detuvo después de 2 intentos para controlar costos.
                  </p>
                ) : structuredBatchResult?.ok && structuredBatchResult.batchId ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    SellUp creó candidatas desde fuente oficial y Apollo. Puedes revisarlas por separado.
                  </p>
                ) : null}

                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                    Cerrar
                  </Button>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {usefulCandidatesCount === 0 ? (
                      <>
                        {generatedBatchId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              handleClose();
                              router.push(`/prospect-batches/${generatedBatchId}`);
                            }}
                            className="gap-1.5 text-muted-foreground"
                          >
                            Ver lote para auditoría
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {structuredBatchResult?.batchId && structuredBatchResult.batchId !== generatedBatchId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              handleClose();
                              router.push(`/prospect-batches/${structuredBatchResult.batchId}`);
                            }}
                            className="gap-1.5 text-muted-foreground"
                          >
                            Ver lote oficial para auditoría
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    ) : sourceStrategy === 'official_source_satisfied' ? (
                      /* Solo fuente oficial — sin botón Apollo */
                      <Button
                        size="sm"
                        onClick={() => {
                          const sId = structuredBatchResult?.batchId;
                          handleClose();
                          if (sId) router.push(`/prospect-batches/${sId}`);
                        }}
                        className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
                      >
                        Revisar empresas candidatas
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : sourceStrategy === 'official_plus_commercial' && structuredBatchResult?.ok && structuredBatchResult.batchId ? (
                      /* RUES como principal, Apollo como complemento */
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleGoToBatch}
                          className="gap-1.5 text-muted-foreground"
                        >
                          Ver complemento comercial
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const sId = structuredBatchResult.batchId;
                            handleClose();
                            if (sId) router.push(`/prospect-batches/${sId}`);
                          }}
                          className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
                        >
                          Revisar empresas candidatas
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : structuredBatchResult?.ok && structuredBatchResult.batchId ? (
                      /* Legacy: dos botones (modo manual / QA) */
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleGoToBatch}
                          className="gap-1.5 text-muted-foreground"
                        >
                          Ver también desde Apollo
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const sId = structuredBatchResult.batchId;
                            handleClose();
                            if (sId) router.push(`/prospect-batches/${sId}`);
                          }}
                          className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
                        >
                          Revisar empresas candidatas
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      /* Solo Apollo (fallback o non-CO) */
                      <Button
                        size="sm"
                        onClick={handleGoToBatch}
                        className="gap-1.5 bg-gradient-to-br from-su-ai-from to-su-ai-to text-white hover:opacity-90 shadow-[0_4px_16px_var(--su-ai-glow)] border-transparent"
                      >
                        Revisar empresas candidatas
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStructuredSourceNothingToWrite(batch: StructuredBatchResult | null | undefined): boolean {
  if (!batch) return false;
  if (batch.ok || batch.batchId) return false;
  // Auto mode exhausted handled separately
  if (batch.autoMode && batch.warnings?.includes('all_pages_scanned')) return false;
  const hasRealErrors = batch.errors && batch.errors.length > 0;
  if (hasRealErrors) return false;
  return !!(batch.warnings?.includes('all_candidates_already_in_db'));
}

function isAutoModeAllPagesScanned(batch: StructuredBatchResult | null | undefined): boolean {
  if (!batch || batch.ok) return false;
  return !!(batch.autoMode && batch.warnings?.includes('all_pages_scanned'));
}

function isSocrataTimeoutError(batch: StructuredBatchResult | null | undefined): boolean {
  if (!batch || batch.ok) return false;
  return batch.errors?.length === 1 && batch.errors[0] === 'socrata_timeout';
}

// ── Panel de resultado de generación ─────────────────────────────────────────

interface GenerationResultPanelProps {
  result: SourceDiscoveryPreflightResult | null;
  structuredBatch: StructuredBatchResult | null | undefined;
  apolloBatchId: string | null;
  structuredSourcePage?: number;
  sourceStrategy?: string | null;
  advancedOpen?: boolean;
  usefulCandidatesCount: number;
  omittedCandidatesCount: number;
  countryCode?: string;
}

function GenerationResultPanel({
  result,
  structuredBatch,
  apolloBatchId,
  structuredSourcePage = 1,
  sourceStrategy,
  advancedOpen = false,
  usefulCandidatesCount,
  omittedCandidatesCount,
  countryCode,
}: GenerationResultPanelProps) {
  const statusIcon = result ? PREFLIGHT_STATUS_ICONS[result.status] ?? PREFLIGHT_STATUS_ICONS.skipped : null;
  const statusLabel = result ? PREFLIGHT_STATUS_LABELS[result.status] ?? result.status : '';

  return (
    <div className="space-y-6 px-7 py-6">
      {/* Título */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {usefulCandidatesCount > 0 ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <TriangleAlert className="h-4 w-4 text-amber-500" />
          )}
          <h3 className="text-sm font-semibold text-foreground">
            {usefulCandidatesCount > 0 ? 'Generación completada' : 'Generación finalizada'}
          </h3>
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          {countryCode === 'CO' ? (
            usefulCandidatesCount > 0 ? (
              <div className="space-y-1">
                <p>Empresas candidatas listas para revisión.</p>
                <p className="text-[11px] text-muted-foreground/75 font-medium">
                  SellUp encontró {usefulCandidatesCount} empresa{usefulCandidatesCount !== 1 ? 's' : ''} útil{usefulCandidatesCount !== 1 ? 'es' : ''} en fuente oficial.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p>No se encontraron empresas útiles para revisión.</p>
                {structuredBatch?.status === 'official_source_error' ? (
                  <p className="text-[11px] text-destructive dark:text-red-400 font-medium">
                    La fuente oficial no pudo completarse. Intenta nuevamente más tarde.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    La fuente oficial no entregó registros revisables con los criterios actuales. SellUp no usó fuente comercial porque para Colombia los registros deben tener NIT válido.
                  </p>
                )}
              </div>
            )
          ) : (
            usefulCandidatesCount > 0 ? (
              <p>Empresas candidatas listas para revisión.</p>
            ) : omittedCandidatesCount > 0 ? (
              <span>
                No se encontraron empresas útiles para revisión. SellUp omitió {omittedCandidatesCount} registro{omittedCandidatesCount !== 1 ? 's' : ''} por liquidación, inactividad, duplicidad o datos mínimos insuficientes.
              </span>
            ) : (
              <p>No se encontraron empresas con los criterios actuales.</p>
            )
          )}
        </div>
      </div>

      {/* Lote Apollo — oculto si fuente oficial satisfizo completamente o si es Colombia */}
      {sourceStrategy !== 'official_source_satisfied' && countryCode !== 'CO' && (
        <div className="rounded-xl border border-border/40 bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 border-b border-border/40 pb-2">
            <div className="h-2 w-2 rounded-full bg-su-brand" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              {sourceStrategy === 'official_plus_commercial'
                ? 'Complemento comercial (Apollo)'
                : sourceStrategy === 'commercial_fallback'
                ? 'Fuente alternativa (Apollo)'
                : 'Empresas generadas (Apollo)'}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Estado:</span>
            {usefulCandidatesCount > 0 ? (
              <span className="font-medium text-emerald-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Creado
              </span>
            ) : (
              <span className="font-medium text-amber-500 flex items-center gap-1">
                <TriangleAlert className="h-3 w-3" /> Sin candidatas útiles
              </span>
            )}
          </div>
          {apolloBatchId && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Batch ID:</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                {apolloBatchId.slice(0, 8)}…
              </code>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Candidatos útiles:</span>
              <span className="font-semibold text-foreground">{usefulCandidatesCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Omitidos:</span>
              <span className="font-semibold text-foreground">{omittedCandidatesCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Lote fuente oficial (si se intentó) */}
      {structuredBatch && (() => {
        const nothingToWrite = isStructuredSourceNothingToWrite(structuredBatch);
        const isSocrataTimeout = isSocrataTimeoutError(structuredBatch);
        const borderClass = structuredBatch.ok || structuredBatch.status === 'official_source_success'
          ? 'border-su-brand/20'
          : structuredBatch.status === 'official_source_error'
            ? 'border-destructive/20'
            : 'border-amber-500/20';
        const dotClass = structuredBatch.ok || structuredBatch.status === 'official_source_success'
          ? 'bg-su-brand'
          : structuredBatch.status === 'official_source_error'
            ? 'bg-destructive'
            : 'bg-amber-500';

        return (
          <div className={`rounded-xl border p-4 space-y-3 bg-card ${borderClass}`}>
            <div className="flex items-center gap-2 border-b border-border/40 pb-2">
              <div className={`h-2 w-2 rounded-full ${dotClass}`} />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                Fuente oficial procesada
              </span>
              {structuredBatch.sourceKey && (
                <span className="ml-auto text-[10px] text-muted-foreground/50 font-mono">
                  {structuredBatch.sourceKey}
                </span>
              )}
            </div>

            {structuredBatch.ok || structuredBatch.status === 'official_source_success' ? (
              <>
                {structuredBatch.autoMode && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    {sourceStrategy === 'official_source_satisfied' ? (
                      <span>SellUp encontró {structuredBatch.candidatesWritten} empresas útiles en fuente oficial. Se omitieron {structuredBatch.candidatesSkipped} registros no viables.</span>
                    ) : (
                      <span>Se encontraron {structuredBatch.candidatesWritten} empresas nuevas para revisión.</span>
                    )}
                  </div>
                )}
                {advancedOpen && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Estado:</span>
                      <span className="font-medium text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Creado · Revisión humana pendiente
                      </span>
                    </div>
                    {!structuredBatch.autoMode && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Página usada:</span>
                        <span className="font-semibold text-foreground">{structuredSourcePage}</span>
                      </div>
                    )}
                    {structuredBatch.batchId && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Batch ID:</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-foreground">
                          {structuredBatch.batchId.slice(0, 8)}…
                        </code>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Candidatos escritos:</span>
                        <span className="font-semibold text-foreground">{structuredBatch.candidatesWritten}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Omitidos:</span>
                        <span className="font-semibold text-foreground">{structuredBatch.candidatesSkipped}</span>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : structuredBatch.status === 'official_source_error' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span className="text-xs font-medium text-destructive">
                    La fuente oficial no pudo completarse
                  </span>
                </div>
                {structuredBatch.errorDetails ? (
                  <p className="text-[11px] text-destructive/80 pl-5 leading-relaxed">
                    Detalle: {structuredBatch.errorDetails}
                  </p>
                ) : (
                  <p className="text-[11px] text-destructive/80 pl-5 leading-relaxed">
                    Ocurrió un error inesperado al conectar o procesar la fuente oficial.
                  </p>
                )}
              </div>
            ) : structuredBatch.status === 'official_source_empty' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    La fuente oficial no encontró registros nuevos
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">
                  La consulta a la fuente oficial no devolvió registros nuevos para los criterios seleccionados. Todos los candidatos ya existen en SellUp.
                </p>
              </div>
            ) : structuredBatch.status === 'official_source_no_useful_candidates' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    La fuente oficial devolvió registros, pero ninguno fue útil
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">
                  Se recibieron registros de la fuente oficial, pero todos fueron omitidos por duplicidad, liquidación o inactividad.
                </p>
              </div>
            ) : isAutoModeAllPagesScanned(structuredBatch) ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Sin empresas nuevas en la fuente oficial
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">
                  SellUp revisó las páginas disponibles y no encontró registros nuevos para esta búsqueda. Todos los candidatos ya existen en SellUp.
                </p>
              </div>
            ) : nothingToWrite ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Sin candidatos nuevos en esta página
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">
                  Todos los registros encontrados ya existen en SellUp. No se escribieron duplicados.
                </p>
                <div className="flex items-center justify-between text-xs pl-5">
                  <span className="text-muted-foreground">Página usada:</span>
                  <span className="font-semibold text-foreground">{structuredSourcePage}</span>
                </div>
                <div className="flex items-center justify-between text-xs pl-5">
                  <span className="text-muted-foreground">Omitidos (ya existían):</span>
                  <span className="font-semibold text-foreground">{structuredBatch.candidatesSkipped ?? 0}</span>
                </div>
                <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 pl-5">
                  Intenta con una página diferente en Opciones avanzadas.
                </p>
              </div>
            ) : isSocrataTimeout ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Fuente oficial no respondió a tiempo
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">
                  La API pública de datos.gov.co no respondió. El lote Apollo sí fue creado. Intenta nuevamente en unos minutos.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-xs font-medium text-destructive">Error en la fuente oficial</span>
                {structuredBatch.errors && structuredBatch.errors.map((err, i) => (
                  <p key={i} className="text-[11px] text-destructive/80 pl-2">· {err}</p>
                ))}
              </div>
            )}

            {!nothingToWrite && structuredBatch.warnings && structuredBatch.warnings.length > 0 && (
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
        );
      })()}

      {/* Preflight informativo (solo si no hubo lote estructurado) */}
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
