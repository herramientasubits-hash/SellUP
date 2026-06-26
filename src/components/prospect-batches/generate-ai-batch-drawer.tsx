'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  TriangleAlert,
  XCircle,
  Info,
  Settings2,
} from 'lucide-react';
import { ExploratorySearchFormV2 } from '@/components/prospect-batches/exploratory-search-form-v2';
import { ProspectChatWizard } from '@/components/prospect-batches/chat-wizard';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { GenerateProspectsExperience } from '@/components/prospect-batches/generate-ai-batch-experience';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { AIButton } from '@/components/ai/ai-button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
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
import { Field, Row, getFlagEmoji } from '@/components/accounts/account-form-helpers';
import { type SourceDiscoveryPreflightResult } from '@/server/agents/prospecting-toolkit/source-discovery-preflight';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const MVP_MAX_CANDIDATES = 25;

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

const WARNING_LABELS: Record<string, string> = {
  all_pages_scanned: 'SellUp revisó las páginas disponibles de la fuente oficial.',
  all_candidates_already_in_db: 'Los registros encontrados ya existían o no eran nuevos para revisión.',
  nothing_to_write: 'No hubo registros nuevos para crear.',
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

// ── Progressive thinking steps ────────────────────────────────────────────────

type ProgressStep = { label: string; delay: number };

const PROGRESS_STEPS: ProgressStep[] = [
  { label: 'Iniciando agente…', delay: 400 },
  { label: 'Consultando fuentes y descubriendo empresas…', delay: 600 },
  { label: 'Analizando registros encontrados…', delay: 500 },
  { label: 'Filtrando candidatas elegibles…', delay: 500 },
  { label: 'Generando resumen…', delay: 400 },
];

function ThinkingStepsDisplay({ steps, isTyping }: { steps: string[]; isTyping: boolean }) {
  return (
    <div className="space-y-2 animate-su-fade-in">
      {steps.map((msg, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground/80 animate-su-fade-in">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-su-brand" />
          <span className="leading-relaxed">{msg}</span>
        </div>
      ))}
      {isTyping && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground/60 animate-su-fade-in">
          <Loader2 className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-spin text-su-brand/60" />
          <span className="leading-relaxed flex items-center gap-0.5">
            Pensando
            <span className="animate-pulse">…</span>
          </span>
        </div>
      )}
    </div>
  );
}

const EMPTY_FORM = {
  countryCode: '',
  industry: '',
  targetCount: String(MVP_MAX_CANDIDATES),
  searchDepth: 'standard' as BatchSearchDepth,
  advStructuredSourcePreflight: false,
  advCreateStructuredSourceBatch: false,
  advStructuredSourcePage: 1,
  advSearchDepth: 'standard' as BatchSearchDepth,
};

type DrawerState = {
  open: boolean;
  generating: boolean;
  advancedOpen: boolean;
  progressMsg: string;
};

const EMPTY_DRAWER: DrawerState = {
  open: false,
  generating: false,
  advancedOpen: false,
  progressMsg: '',
};

type ResultState = {
  preflightResult: SourceDiscoveryPreflightResult | null;
  generatedBatchId: string | null;
  structuredBatchResult: StructuredBatchResult | null;
  sourceStrategy: string | null;
  usefulCandidatesCount: number;
  omittedCandidatesCount: number;
  generationAttempted: boolean;
};

const EMPTY_RESULT: ResultState = {
  preflightResult: null,
  generatedBatchId: null,
  structuredBatchResult: null,
  sourceStrategy: null,
  usefulCandidatesCount: 0,
  omittedCandidatesCount: 0,
  generationAttempted: false,
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
      { label: 'Registro de Empresas y Sociedades', desc: 'Fuente oficial Chile · sin sector/giro disponible' },
      { label: 'Enriquecimiento externo', desc: 'Solo si está configurado · no inventa sector' },
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

// ── Main Component ────────────────────────────────────────────────────────────

type GenerateAIBatchDrawerProps = {
  /** Resolved server-side experience key. Defaults to 'legacy'. */
  experience?: GenerateProspectsExperience;
  /** Required when experience is 'exploratory_form_v2' or 'chat_wizard'. */
  catalog?: ActiveIndustryCatalog | null;
  /** When true, the chat wizard will show the real generation CTA. Default false. */
  executionEnabled?: boolean;
};

export function GenerateAIBatchDrawer({ experience = 'legacy', catalog = null, executionEnabled = false }: GenerateAIBatchDrawerProps = {}) {
  const router = useRouter();
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [drawer, setDrawer] = React.useState(EMPTY_DRAWER);
  const [result, setResult] = React.useState(EMPTY_RESULT);
  const [progressSteps, setProgressSteps] = React.useState<string[]>([]);
  const typingStepIndex = React.useRef(0);
  const showTyping = React.useRef(false);

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateDrawer = <K extends keyof DrawerState>(key: K, value: DrawerState[K]) =>
    setDrawer((prev) => ({ ...prev, [key]: value }));

  // Derived state
  const isColombiaAuto = form.countryCode === 'CO';
  const isChilePreview = form.countryCode === 'CL';
  const autoSources = getAutoSources(form.countryCode);
  const suggestedSource = form.countryCode ? STRUCTURED_SOURCE_MAP[form.countryCode] ?? null : null;

  function handleClose() {
    if (drawer.generating) return;
    setDrawer(EMPTY_DRAWER);
    setForm(EMPTY_FORM);
    setResult(EMPTY_RESULT);
    setProgressSteps([]);
  }

  function handleGoToBatch() {
    if (!result.generatedBatchId) return;
    const id = result.generatedBatchId;
    handleClose();
    router.push(`${PROSPECTOS_TAB_ROUTE}&sourceId=${id}`);
  }

  // Run progressive thinking steps during generation
  async function runProgressiveSteps() {
    typingStepIndex.current = 0;
    showTyping.current = false;
    setProgressSteps([]);

    for (let i = 0; i < PROGRESS_STEPS.length; i++) {
      typingStepIndex.current = i;
      showTyping.current = true;
      setProgressSteps((prev) => [...prev.slice(0, i)]);

      await new Promise((r) => setTimeout(r, PROGRESS_STEPS[i].delay));

      showTyping.current = false;
      setProgressSteps((prev) => [...prev, PROGRESS_STEPS[i].label]);
    }
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

    const count = ((form.countryCode === 'CO' || form.countryCode === 'CL') && !drawer.advancedOpen) ? 5 : (parseInt(form.targetCount) || 10);

    setDrawer({ open: true, generating: true, advancedOpen: drawer.advancedOpen, progressMsg: '' });
    setResult(EMPTY_RESULT);
    setProgressSteps([]);

    // Start progressive steps in parallel with the API call
    const stepsDone = runProgressiveSteps();

    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);

      // For CO/CL: auto-activate structured source. Advanced overrides take effect only if advanced is open.
      const effectivePreflight = (isColombiaAuto || isChilePreview)
        ? true
        : drawer.advancedOpen && form.advStructuredSourcePreflight;
      const effectiveCreateBatch = (isColombiaAuto || isChilePreview)
        ? true
        : drawer.advancedOpen && form.advCreateStructuredSourceBatch;
      const effectiveSourceKey = isColombiaAuto ? 'co_rues' : isChilePreview ? 'cl_res' : null;
      const effectivePage = form.advStructuredSourcePage;
      const effectiveDepth = (drawer.advancedOpen ? form.advSearchDepth : form.searchDepth) as 'basic' | 'standard';
      // Auto-paginate when user is in vendor mode (advanced not opened for Colombia)
      const effectivePageAuto = isColombiaAuto && !drawer.advancedOpen;

      const batchResult = await generateAIProspectBatch({
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

      // Wait for all progressive steps to finish displaying
      await stepsDone;

      const uCount = batchResult.usefulCandidatesCount ?? batchResult.candidatesCreated ?? 0;
      const oCount = batchResult.omittedCandidatesCount ?? 0;

      setResult({
        preflightResult: batchResult.structuredSourcePreflight ?? null,
        generatedBatchId: batchResult.batchId,
        structuredBatchResult: batchResult.structuredSourceBatch ?? null,
        sourceStrategy: batchResult.sourceStrategy ?? null,
        usefulCandidatesCount: uCount,
        omittedCandidatesCount: oCount,
        generationAttempted: true,
      });

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

      if (batchResult.structuredSourcePreflight || batchResult.structuredSourceBatch || uCount === 0) {
        // Keep drawer open to show result — clear progress steps
        setProgressSteps([]);
      } else {
        setDrawer(EMPTY_DRAWER);
        setForm(EMPTY_FORM);
        setResult(EMPTY_RESULT);
        setProgressSteps([]);
        if (batchResult.batchId) {
          router.push(`${PROSPECTOS_TAB_ROUTE}&sourceId=${batchResult.batchId}`);
        }
      }
    } catch (err) {
      await stepsDone;
      toast.error(err instanceof Error ? err.message : 'Error al generar prospectos');
      setProgressSteps([]);
    } finally {
      updateDrawer('generating', false);
    }
  }

  const canSubmit = !!form.countryCode && !!form.industry && !drawer.generating;
  const showPreflightResult = result.generationAttempted && (!!result.preflightResult || !!result.structuredBatchResult || result.usefulCandidatesCount === 0);

  // Auto-scroll to bottom when result appears or steps update
  const resultPanelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (showPreflightResult || (drawer.generating && progressSteps.length > 0)) {
      requestAnimationFrame(() => {
        if (resultPanelRef.current) {
          resultPanelRef.current.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      });
    }
  }, [showPreflightResult, drawer.generating, progressSteps.length]);

  // Chat wizard experience
  if (experience === 'chat_wizard' && catalog) {
    return (
      <DrawerShell
        open={drawer.open}
        onOpenChange={(v) => !v && handleClose()}
        trigger={
          <AIButton size="sm" onClick={() => updateDrawer('open', true)}>
            Generar con IA
          </AIButton>
        }
        title="Generar empresas candidatas con IA"
        description="Responde unas preguntas y te ayudaré a configurar la búsqueda."
        icon={<Sparkles className="h-4 w-4 text-su-brand" />}
        size="xl"
      >
        <ProspectChatWizard catalog={catalog} onClose={handleClose} executionEnabled={executionEnabled} />
      </DrawerShell>
    );
  }

  // V2: catalog-driven exploratory form
  if (experience === 'exploratory_form_v2' && catalog) {
    return (
      <DrawerShell
        open={drawer.open}
        onOpenChange={(v) => !v && handleClose()}
        trigger={
          <AIButton size="sm" onClick={() => updateDrawer('open', true)}>
            Generar con IA
          </AIButton>
        }
        title="Generar empresas candidatas con IA"
        description="Configura los criterios de búsqueda para explorar el catálogo de industrias."
        icon={<Sparkles className="h-4 w-4 text-su-brand" />}
        size="xl"
      >
        <ExploratorySearchFormV2 catalog={catalog} onClose={handleClose} />
      </DrawerShell>
    );
  }

  return (
    <DrawerShell
      open={drawer.open}
      onOpenChange={(v) => !v && handleClose()}
      trigger={
        <AIButton size="sm" onClick={() => updateDrawer('open', true)}>
          Generar con IA
        </AIButton>
      }
      title="Generar empresas candidatas con IA"
      description="El agente consulta las fuentes configuradas para el país y usa HubSpot para detectar duplicados."
      icon={<Sparkles className="h-4 w-4 text-su-brand" />}
      size="xl"
      footer={
        <DrawerFooter
          showPreflightResult={showPreflightResult}
          generating={drawer.generating}
          progressMsg={drawer.progressMsg}
          canSubmit={canSubmit}
          usefulCandidatesCount={result.usefulCandidatesCount}
          sourceStrategy={result.sourceStrategy}
          structuredBatchResult={result.structuredBatchResult}
          generatedBatchId={result.generatedBatchId}
          onClose={handleClose}
          onGoToBatch={handleGoToBatch}
          onNavigate={(id) => { handleClose(); router.push(`${PROSPECTOS_TAB_ROUTE}&sourceId=${id}`); }}
        />
      }
    >
      {showPreflightResult ? (
        /* ── Resultado de generación ── */
        <div ref={resultPanelRef}>
          {progressSteps.length > 0 && (
            <div className="mb-4 pb-4 border-b border-border/30">
              <ThinkingStepsDisplay steps={progressSteps} isTyping={false} />
            </div>
          )}
          <GenerationResultPanel
            result={result.preflightResult}
            structuredBatch={result.structuredBatchResult}
            apolloBatchId={result.generatedBatchId}
            structuredSourcePage={form.advStructuredSourcePage}
            sourceStrategy={result.sourceStrategy}
            advancedOpen={drawer.advancedOpen}
            usefulCandidatesCount={result.usefulCandidatesCount}
            omittedCandidatesCount={result.omittedCandidatesCount}
            countryCode={form.countryCode}
          />
        </div>
      ) : drawer.generating ? (
        /* ── Thinking steps progresivos ── */
        <div ref={resultPanelRef} className="flex flex-col items-start py-6 px-2">
          <ThinkingStepsDisplay steps={progressSteps} isTyping={true} />
        </div>
      ) : (
        /* ── Formulario principal ── */
        <form
          id="generate-ai-batch-form"
          onSubmit={handleSubmit}
          className="space-y-8"
        >
          {/* Segmentación */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Segmentación"
              description="Define el país y la industria para la búsqueda."
            />
            <Row>
              <Field label="País" required>
                <Select
                  value={form.countryCode}
                  onValueChange={(v) => set('countryCode', v ?? '')}
                  disabled={drawer.generating}
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
                  disabled={drawer.generating}
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
          </SurfaceCard>

          {/* Cantidad */}
          {drawer.advancedOpen ? (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Cantidad"
                description="Control cuántas empresas se intentan encontrar."
              />
              <Field label="Cantidad de empresas">
                <Select
                  value={form.targetCount}
                  onValueChange={(v) => set('targetCount', v ?? '10')}
                  disabled={drawer.generating}
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
                <p className="text-xs text-muted-foreground leading-relaxed">
                  La cantidad debe estar entre 10 y 25. SellUp intentará encontrar hasta esta cantidad. La cantidad final puede variar según calidad y duplicados.
                </p>
              </Field>
            </SurfaceCard>
          ) : (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Cantidad"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {form.countryCode === 'CO' ? (
                  "SellUp buscará hasta 5 empresas útiles para revisión. Si encuentra registros duplicados, liquidados, inactivos o sin datos mínimos, los omitirá automáticamente."
                ) : form.countryCode === 'CL' ? (
                  "SellUp buscará hasta 5 empresas registradas en fuente oficial chilena. El sector no viene disponible en la fuente oficial, por lo que puede requerir enriquecimiento externo o revisión humana."
                ) : (
                  "SellUp buscará hasta 10 empresas útiles para revisión. Si encuentra duplicadas, liquidadas o no viables, las omitirá automáticamente y podrá hacer hasta 2 intentos de búsqueda."
                )}
              </p>
            </SurfaceCard>
          )}

          {/* Fuentes automáticas */}
          <SourcesInfo sources={autoSources} hasCountry={!!form.countryCode} />

          {/* Nota MVP */}
          <Alert variant="warning">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Ninguna empresa se crea automáticamente — toda candidata requiere revisión humana para validar su información comercial y legal.
            </AlertDescription>
          </Alert>

          {/* Opciones avanzadas */}
          <AdvancedOptionsSection
            isOpen={drawer.advancedOpen}
            onToggle={() => updateDrawer('advancedOpen', !drawer.advancedOpen)}
            generating={drawer.generating}
            isColombiaAuto={isColombiaAuto}
            isChilePreview={isChilePreview}
            suggestedSource={suggestedSource}
            form={form}
            onFormChange={set}
          />
        </form>
      )}
    </DrawerShell>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStructuredSourceNothingToWrite(batch: StructuredBatchResult | null | undefined): boolean {
  if (!batch) return false;
  if (batch.ok || batch.batchId) return false;
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

// ── Sub-components ────────────────────────────────────────────────────────────

type DrawerFooterProps = {
  showPreflightResult: boolean;
  generating: boolean;
  progressMsg: string;
  canSubmit: boolean;
  usefulCandidatesCount: number;
  sourceStrategy: string | null;
  structuredBatchResult: StructuredBatchResult | null;
  generatedBatchId: string | null;
  onClose: () => void;
  onGoToBatch: () => void;
  onNavigate: (id: string) => void;
};

function DrawerFooter({
  showPreflightResult,
  generating,
  progressMsg,
  canSubmit,
  usefulCandidatesCount,
  sourceStrategy,
  structuredBatchResult,
  generatedBatchId,
  onClose,
  onGoToBatch,
  onNavigate,
}: DrawerFooterProps) {
  if (showPreflightResult) {
    return (
      <div className="shrink-0 border-t border-border/50 px-7 py-4">
        <div className="flex w-full flex-col gap-3">
          <ResultFooterMessage
            usefulCandidatesCount={usefulCandidatesCount}
            sourceStrategy={sourceStrategy}
            structuredBatchResult={structuredBatchResult}
          />
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cerrar
            </Button>
            <ResultFooterActions
              usefulCandidatesCount={usefulCandidatesCount}
              sourceStrategy={sourceStrategy}
              structuredBatchResult={structuredBatchResult}
              generatedBatchId={generatedBatchId}
              onGoToBatch={onGoToBatch}
              onNavigate={onNavigate}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border/50 px-7 py-4">
      <div className="flex w-full items-center justify-between gap-3">
        {generating && progressMsg ? (
          <p className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin animate-su-pulse" />
            {progressMsg}
          </p>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={generating}
          >
            Cancelar
          </Button>
          <AIButton
            form="generate-ai-batch-form"
            type="submit"
            size="sm"
            disabled={!canSubmit}
            loading={generating}
          >
            {generating ? 'Generando…' : 'Generar con IA'}
          </AIButton>
        </div>
      </div>
    </div>
  );
}

// ── Result Footer Sub-components ──────────────────────────────────────────────

type ResultFooterMessageProps = {
  usefulCandidatesCount: number;
  sourceStrategy: string | null;
  structuredBatchResult: StructuredBatchResult | null;
};

function ResultFooterMessage({
  usefulCandidatesCount,
  sourceStrategy,
  structuredBatchResult,
}: ResultFooterMessageProps) {
  if (usefulCandidatesCount === 0) {
    return (
      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium leading-relaxed">
        No se encontraron empresas útiles para revisión. SellUp omitió registros por liquidación, inactividad, duplicidad o datos mínimos insuficientes.
      </p>
    );
  }

  if (sourceStrategy === 'official_source_satisfied') {
    return (
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        SellUp encontró {structuredBatchResult?.candidatesWritten ?? 10} empresas útiles en fuente oficial. Se omitieron {structuredBatchResult?.candidatesSkipped ?? 0} registros no viables.
      </p>
    );
  }

  if (sourceStrategy === 'official_plus_commercial') {
    return (
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        SellUp encontró {structuredBatchResult?.candidatesWritten ?? 0} empresas útiles en fuente oficial y completó con fuente comercial.
      </p>
    );
  }

  if (sourceStrategy === 'commercial_fallback') {
    return (
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        No se encontraron empresas útiles con los criterios actuales. Intenta otra industria o país.
      </p>
    );
  }

  if (structuredBatchResult && !structuredBatchResult.ok && isAutoModeAllPagesScanned(structuredBatchResult)) {
    return (
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        SellUp encontró {structuredBatchResult?.candidatesWritten ?? 0} empresas útiles. Se detuvo después de 2 intentos para controlar costos.
      </p>
    );
  }

  if (structuredBatchResult?.ok && structuredBatchResult.batchId) {
    return (
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        SellUp creó candidatas desde fuente oficial y Apollo. Puedes revisarlas por separado.
      </p>
    );
  }

  return null;
}

type ResultFooterActionsProps = {
  usefulCandidatesCount: number;
  sourceStrategy: string | null;
  structuredBatchResult: StructuredBatchResult | null;
  generatedBatchId: string | null;
  onGoToBatch: () => void;
  onNavigate: (id: string) => void;
};

function ResultFooterActions({
  usefulCandidatesCount,
  sourceStrategy,
  structuredBatchResult,
  generatedBatchId,
  onGoToBatch,
  onNavigate,
}: ResultFooterActionsProps) {
  if (usefulCandidatesCount === 0) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {generatedBatchId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate(generatedBatchId)}
            className="gap-1.5 text-muted-foreground"
          >
            Ver prospectos para auditoría
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
        {structuredBatchResult?.batchId && structuredBatchResult.batchId !== generatedBatchId && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate(structuredBatchResult.batchId!)}
            className="gap-1.5 text-muted-foreground"
          >
            Ver prospectos oficiales
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  if (sourceStrategy === 'official_source_satisfied' && structuredBatchResult?.batchId) {
    return (
      <Button
        size="sm"
        onClick={() => onNavigate(structuredBatchResult.batchId!)}
        className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient font-bold text-white border-0 shadow-none ring-0 hover:opacity-90 active:scale-95 transition-all duration-300"
      >
        Ver prospectos generados
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    );
  }

  if (sourceStrategy === 'official_plus_commercial' && structuredBatchResult?.ok && structuredBatchResult.batchId) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="sm"
          variant="outline"
          onClick={onGoToBatch}
          className="gap-1.5 text-muted-foreground"
        >
          Ver complemento comercial
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          onClick={() => onNavigate(structuredBatchResult.batchId!)}
          className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient font-bold text-white border-0 shadow-none ring-0 hover:opacity-90 active:scale-95 transition-all duration-300"
        >
          Ver prospectos generados
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  if (structuredBatchResult?.ok && structuredBatchResult.batchId) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="sm"
          variant="outline"
          onClick={onGoToBatch}
          className="gap-1.5 text-muted-foreground"
        >
          Ver también desde Apollo
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          onClick={() => onNavigate(structuredBatchResult.batchId!)}
          className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient font-bold text-white border-0 shadow-none ring-0 hover:opacity-90 active:scale-95 transition-all duration-300"
        >
          Ver prospectos generados
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      onClick={onGoToBatch}
      className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient font-bold text-white border-0 shadow-none ring-0 hover:opacity-90 active:scale-95 transition-all duration-300"
    >
      Ver prospectos generados
      <ChevronRight className="h-3.5 w-3.5" />
    </Button>
  );
}

// ── Sources Info Section ──────────────────────────────────────────────────────

type SourcesInfoProps = {
  sources: Array<{ label: string; desc: string }>;
  hasCountry: boolean;
};

function SourcesInfo({ sources, hasCountry }: SourcesInfoProps) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Fuentes que usará el agente"
        description={hasCountry ? undefined : "Las fuentes se configuran automáticamente al seleccionar el país."}
      />
      <div className="flex flex-wrap gap-2">
        {sources.map((src) => (
          <Badge key={src.label} variant="secondary" className="rounded-full px-3 py-1 text-xs">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="font-medium">{src.label}</span>
            <span className="text-muted-foreground">· {src.desc}</span>
          </Badge>
        ))}
      </div>
    </SurfaceCard>
  );
}

// ── Advanced Options Section ──────────────────────────────────────────────────

type AdvancedOptionsSectionProps = {
  isOpen: boolean;
  onToggle: () => void;
  generating: boolean;
  isColombiaAuto: boolean;
  isChilePreview: boolean;
  suggestedSource: string | null;
  form: typeof EMPTY_FORM;
  onFormChange: <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => void;
};

function AdvancedOptionsSection({
  isOpen,
  onToggle,
  generating,
  isColombiaAuto,
  isChilePreview,
  suggestedSource,
  form,
  onFormChange,
}: AdvancedOptionsSectionProps) {
  return (
    <Accordion
      value={isOpen ? ['advanced'] : []}
      onValueChange={() => onToggle()}
    >
      <AccordionItem value="advanced" className="border-none">
        <AccordionTrigger className="py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 hover:no-underline hover:text-muted-foreground/80">
          <div className="flex items-center gap-2">
            <Settings2 className="h-3.5 w-3.5" />
            Opciones avanzadas
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <SurfaceCard elevated className="mt-2">
            <Alert variant="warning" className="mb-4">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Estas opciones son para diagnóstico y QA. En uso normal SellUp selecciona las fuentes automáticamente.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              {/* Cantidad override */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Cantidad (Override QA)
                </Label>
                <Select
                  value={form.targetCount}
                  onValueChange={(v) => onFormChange('targetCount', v ?? '10')}
                  disabled={generating}
                >
                  <SelectTrigger className="w-full h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 15, 20, 25].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-sm">
                        {n} empresas
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Profundidad de búsqueda */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Profundidad de búsqueda
                </Label>
                <Select
                  value={form.advSearchDepth}
                  onValueChange={(v) => onFormChange('advSearchDepth', (v ?? 'standard') as BatchSearchDepth)}
                  disabled={generating}
                >
                  <SelectTrigger className="w-full h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['basic', 'standard'] as BatchSearchDepth[]).map((key) => (
                      <SelectItem key={key} value={key} className="text-sm">
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
                  checked={isColombiaAuto || isChilePreview || form.advStructuredSourcePreflight}
                  onChange={(e) => {
                    if (!isColombiaAuto && !isChilePreview) onFormChange('advStructuredSourcePreflight', e.target.checked);
                  }}
                  disabled={generating || isColombiaAuto || isChilePreview}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand disabled:cursor-not-allowed"
                />
                <Label htmlFor="adv-structured-source-preflight" className="cursor-pointer space-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    Ejecutar preflight estructurado
                  </span>
                  {(isColombiaAuto || isChilePreview) && (
                    <p className="text-xs text-muted-foreground">
                      Activado automáticamente para {isColombiaAuto ? 'Colombia' : 'Chile'}.
                    </p>
                  )}
                  {!isColombiaAuto && !isChilePreview && suggestedSource && (
                    <p className="text-xs text-muted-foreground">
                      Fuente: {STRUCTURED_SOURCE_LABELS[suggestedSource] ?? suggestedSource}
                    </p>
                  )}
                  {!isColombiaAuto && !suggestedSource && form.countryCode && (
                    <p className="text-xs text-muted-foreground">
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
                  checked={isColombiaAuto || isChilePreview || form.advCreateStructuredSourceBatch}
                  onChange={(e) => {
                    if (!isColombiaAuto && !isChilePreview) onFormChange('advCreateStructuredSourceBatch', e.target.checked);
                  }}
                  disabled={generating || isColombiaAuto || isChilePreview}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand disabled:cursor-not-allowed"
                />
                <Label htmlFor="adv-create-structured-source-batch" className="cursor-pointer space-y-0.5">
                  <span className="text-sm font-medium text-foreground">
                    Incluir también prospectos desde fuente oficial
                  </span>
                  {(isColombiaAuto || isChilePreview) && (
                    <p className="text-xs text-muted-foreground">
                      Activado automáticamente para {isColombiaAuto ? 'Colombia (RUES/co_rues)' : 'Chile (RES/cl_res)'}.
                    </p>
                  )}
                  {!isColombiaAuto && !isChilePreview && (
                    <p className="text-xs text-muted-foreground">
                      Crea lote separado con candidatos de la fuente oficial. Requieren revisión humana.
                    </p>
                  )}
                </Label>
              </div>

              {/* Página RUES — solo diagnóstico/QA */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Usar página específica de fuente oficial
                </Label>
                <Select
                  value={String(form.advStructuredSourcePage)}
                  onValueChange={(v) =>
                    onFormChange('advStructuredSourcePage', Math.max(1, Math.min(STRUCTURED_PAGE_MAX, parseInt(v ?? '1') || 1)))
                  }
                  disabled={generating}
                >
                  <SelectTrigger className="w-full h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: STRUCTURED_PAGE_MAX }, (_, i) => i + 1).map((p) => (
                      <SelectItem key={p} value={String(p)} className="text-sm">
                        Página {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Solo diagnóstico / QA. En uso normal SellUp selecciona la página automáticamente.
                </p>
              </div>
            </div>
          </SurfaceCard>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
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
    <div className="space-y-4 animate-su-fade-in">
      {/* Título */}
      <SurfaceCard elevated>
        <div className="flex items-center gap-3">
          {usefulCandidatesCount > 0 ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10">
              <TriangleAlert className="h-4 w-4 text-amber-500" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {usefulCandidatesCount > 0 ? 'Generación completada' : 'Generación finalizada'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {countryCode === 'CO' ? (
                usefulCandidatesCount > 0 ? (
                  `SellUp encontró ${usefulCandidatesCount} empresa${usefulCandidatesCount !== 1 ? 's' : ''} útil${usefulCandidatesCount !== 1 ? 'es' : ''} en fuente oficial.`
                ) : (
                  'La fuente oficial no entregó empresas revisables.'
                )
              ) : countryCode === 'CL' ? (
                usefulCandidatesCount > 0 ? (
                  `SellUp encontró ${usefulCandidatesCount} empresa${usefulCandidatesCount !== 1 ? 's' : ''} con RUT válido en la fuente oficial.`
                ) : (
                  'La fuente oficial chilena no entregó empresas revisables.'
                )
              ) : (
                usefulCandidatesCount > 0 ? (
                  'Empresas candidatas listas para revisión.'
                ) : (
                  'No se encontraron empresas con los criterios actuales.'
                )
              )}
            </p>
          </div>
        </div>
      </SurfaceCard>

      {/* Lote Apollo — oculto si fuente oficial satisfizo completamente, Colombia o Chile */}
      {sourceStrategy !== 'official_source_satisfied' && countryCode !== 'CO' && countryCode !== 'CL' && (
        <SurfaceCard>
          <SurfaceCardHeader
            title={sourceStrategy === 'official_plus_commercial'
              ? 'Complemento comercial (Apollo)'
              : sourceStrategy === 'commercial_fallback'
              ? 'Fuente alternativa (Apollo)'
              : 'Empresas generadas (Apollo)'}
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Estado:</span>
              {usefulCandidatesCount > 0 ? (
                <Badge variant="secondary" className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Creado
                </Badge>
              ) : (
                <Badge variant="secondary" className="rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <TriangleAlert className="h-3 w-3" />
                  Sin candidatas útiles
                </Badge>
              )}
            </div>
            {apolloBatchId && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Batch ID:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                  {apolloBatchId.slice(0, 8)}…
                </code>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
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
        </SurfaceCard>
      )}

      {/* Lote fuente oficial (si se intentó) */}
      {structuredBatch && (() => {
        const nothingToWrite = isStructuredSourceNothingToWrite(structuredBatch);
        const isSocrataTimeout = isSocrataTimeoutError(structuredBatch);
        const dotClass = structuredBatch.ok || structuredBatch.status === 'official_source_success'
          ? 'bg-emerald-500'
          : structuredBatch.status === 'official_source_error'
            ? 'bg-destructive'
            : 'bg-amber-500';

        return (
          <SurfaceCard>
            <div className="flex items-center gap-2 mb-3">
              <div className={`h-2 w-2 rounded-full ${dotClass}`} />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">
                Fuente oficial procesada
              </span>
            </div>

            {structuredBatch.ok || structuredBatch.status === 'official_source_success' ? (
              <>
                {structuredBatch.autoMode && (
                  <Alert variant="success" className="mb-3">
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      {sourceStrategy === 'official_source_satisfied' ? (
                        `SellUp encontró ${structuredBatch.candidatesWritten} empresas útiles en fuente oficial. Se omitieron ${structuredBatch.candidatesSkipped} registros no viables.`
                      ) : (
                        `Se encontraron ${structuredBatch.candidatesWritten} empresas nuevas para revisión.`
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {advancedOpen && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Estado:</span>
                      <Badge variant="secondary" className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Creado · Revisión humana pendiente
                      </Badge>
                    </div>
                    {!structuredBatch.autoMode && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Página usada:</span>
                        <span className="font-semibold text-foreground">{structuredSourcePage}</span>
                      </div>
                    )}
                    {structuredBatch.batchId && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Batch ID:</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                          {structuredBatch.batchId.slice(0, 8)}…
                        </code>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Candidatos escritos:</span>
                        <span className="font-semibold text-foreground">{structuredBatch.candidatesWritten}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Omitidos:</span>
                        <span className="font-semibold text-foreground">{structuredBatch.candidatesSkipped}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : structuredBatch.status === 'official_source_error' ? (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">La fuente oficial no pudo completarse.</span>
                  {structuredBatch.errorDetails ? (
                    <span className="mt-1 block">Detalle: {structuredBatch.errorDetails}</span>
                  ) : (
                    <span className="mt-1 block">Ocurrió un error inesperado al conectar o procesar la fuente oficial.</span>
                  )}
                </AlertDescription>
              </Alert>
            ) : structuredBatch.status === 'official_source_empty' ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">La fuente oficial no encontró registros nuevos.</span>
                  <span className="mt-1 block">La consulta a la fuente oficial no devolvió registros nuevos para los criterios seleccionados. Todos los candidatos ya existen en SellUp.</span>
                </AlertDescription>
              </Alert>
            ) : structuredBatch.status === 'official_source_no_useful_candidates' ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">La fuente oficial no entregó empresas revisables.</span>
                  <span className="mt-1 block">SellUp revisó la fuente oficial disponible, pero los registros encontrados fueron omitidos por duplicidad, liquidación, inactividad o datos mínimos insuficientes.</span>
                </AlertDescription>
              </Alert>
            ) : isAutoModeAllPagesScanned(structuredBatch) ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">Sin empresas nuevas en la fuente oficial.</span>
                  <span className="mt-1 block">SellUp revisó las páginas disponibles y no encontró registros nuevos para esta búsqueda. Todos los candidatos ya existen en SellUp.</span>
                </AlertDescription>
              </Alert>
            ) : nothingToWrite ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">Sin candidatos nuevos en esta página.</span>
                  <span className="mt-1 block">Todos los registros encontrados ya existen en SellUp. No se escribieron duplicados.</span>
                  <span className="mt-2 block text-muted-foreground">Página usada: {structuredSourcePage} · Omitidos: {structuredBatch.candidatesSkipped ?? 0}</span>
                  <span className="mt-1 block font-medium">Intenta con una página diferente en Opciones avanzadas.</span>
                </AlertDescription>
              </Alert>
            ) : isSocrataTimeout ? (
              <Alert variant="warning">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">Fuente oficial no respondió a tiempo.</span>
                  <span className="mt-1 block">La API pública de datos.gov.co no respondió. El lote Apollo sí fue creado. Intenta nuevamente en unos minutos.</span>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <span className="font-medium">Error en la fuente oficial.</span>
                  {structuredBatch.errors && structuredBatch.errors.map((err, i) => (
                    <span key={i} className="mt-1 block">· {err}</span>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {!nothingToWrite && structuredBatch.warnings && structuredBatch.warnings.length > 0 && (() => {
              const visible = structuredBatch.warnings!.filter(w => w in WARNING_LABELS);
              if (visible.length === 0) return null;
              return (
                <Alert variant="warning" className="mt-3">
                  <TriangleAlert className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    <span className="font-medium">Advertencias:</span>
                    {visible.map((w, i) => (
                      <span key={i} className="mt-1 block">· {WARNING_LABELS[w]}</span>
                    ))}
                  </AlertDescription>
                </Alert>
              );
            })()}
          </SurfaceCard>
        );
      })()}

      {/* Preflight informativo (solo si no hubo lote estructurado) */}
      {!structuredBatch && result && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Preflight Fuente Oficial"
            actions={
              <div className="flex items-center gap-1.5 text-xs">
                {statusIcon}
                <span className="font-medium text-foreground">{statusLabel}</span>
              </div>
            }
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Candidatos leídos:</span>
              <span className="font-medium text-foreground">{result.recordsRead}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Potenciales:</span>
              <span className="font-medium text-foreground">{result.candidatesCount}</span>
            </div>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
