'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Loader2,
  Globe,
  Target,
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
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Button } from '@/components/ui/button';
import { AIButton } from '@/components/ai/ai-button';
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

export function GenerateAIBatchDrawer() {
  const router = useRouter();
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [drawer, setDrawer] = React.useState(EMPTY_DRAWER);
  const [result, setResult] = React.useState(EMPTY_RESULT);

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
  }

  function handleGoToBatch() {
    if (!result.generatedBatchId) return;
    const id = result.generatedBatchId;
    handleClose();
    router.push(`/prospects?sourceId=${id}`);
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

    setDrawer({ open: true, generating: true, advancedOpen: drawer.advancedOpen, progressMsg: 'Iniciando agente…' });
    setResult(EMPTY_RESULT);

    try {
      const country = LATAM_COUNTRIES.find((c) => c.code === form.countryCode);

      updateDrawer('progressMsg', 'Consultando fuentes y descubriendo empresas…');

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
        updateDrawer('progressMsg', '');
      } else {
        setDrawer(EMPTY_DRAWER);
        setForm(EMPTY_FORM);
        setResult(EMPTY_RESULT);
        if (batchResult.batchId) {
          router.push(`/prospects?sourceId=${batchResult.batchId}`);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar prospectos');
      updateDrawer('progressMsg', '');
    } finally {
      updateDrawer('generating', false);
    }
  }

  const canSubmit = !!form.countryCode && !!form.industry && !drawer.generating;
  const showPreflightResult = result.generationAttempted && (!!result.preflightResult || !!result.structuredBatchResult || result.usefulCandidatesCount === 0);

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
          onNavigate={(id) => { handleClose(); router.push(`/prospects?sourceId=${id}`); }}
        />
      }
    >
      {showPreflightResult ? (
        /* ── Resultado de generación ── */
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
      ) : (
        /* ── Formulario principal ── */
        <form
          id="generate-ai-batch-form"
          onSubmit={handleSubmit}
          className="space-y-8"
        >
          {/* Segmentación */}
          <Section icon={Globe} label="Segmentación">
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
          </Section>

          {/* Cantidad */}
          {drawer.advancedOpen ? (
            <Section icon={Target} label="Cantidad">
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
                ) : form.countryCode === 'CL' ? (
                  "SellUp buscará hasta 5 empresas registradas en fuente oficial chilena. El sector no viene disponible en la fuente oficial, por lo que puede requerir enriquecimiento externo o revisión humana."
                ) : (
                  "SellUp buscará hasta 10 empresas útiles para revisión. Si encuentra duplicadas, liquidadas o no viables, las omitirá automáticamente y podrá hacer hasta 2 intentos de búsqueda."
                )}
              </p>
            </Section>
          )}

          {/* Fuentes automáticas */}
          <SourcesInfo sources={autoSources} hasCountry={!!form.countryCode} />

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
            <Loader2 className="h-3 w-3 animate-spin" />
            {progressMsg}
          </p>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
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
        className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient su-ai-glow font-bold text-white border-transparent hover:opacity-90 active:scale-95 transition-all duration-300"
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
          className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient su-ai-glow font-bold text-white border-transparent hover:opacity-90 active:scale-95 transition-all duration-300"
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
          className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient su-ai-glow font-bold text-white border-transparent hover:opacity-90 active:scale-95 transition-all duration-300"
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
      className="relative overflow-hidden gap-1.5 rounded-full px-4 su-ai-gradient su-ai-glow font-bold text-white border-transparent hover:opacity-90 active:scale-95 transition-all duration-300"
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
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Database className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          Fuentes que usará el agente
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {sources.map((src) => (
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
      {!hasCountry && (
        <p className="text-[11px] text-muted-foreground/70 pl-1">
          Las fuentes se configuran automáticamente al seleccionar el país.
        </p>
      )}
    </section>
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
    <section className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
        disabled={generating}
      >
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Opciones avanzadas
        </span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
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
              onValueChange={(v) => onFormChange('targetCount', v ?? '10')}
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
              onValueChange={(v) => onFormChange('advSearchDepth', (v ?? 'standard') as BatchSearchDepth)}
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
              checked={isColombiaAuto || isChilePreview || form.advStructuredSourcePreflight}
              onChange={(e) => {
                if (!isColombiaAuto && !isChilePreview) onFormChange('advStructuredSourcePreflight', e.target.checked);
              }}
              disabled={generating || isColombiaAuto || isChilePreview}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand disabled:cursor-not-allowed"
            />
            <Label htmlFor="adv-structured-source-preflight" className="cursor-pointer space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                Ejecutar preflight estructurado
              </span>
              {(isColombiaAuto || isChilePreview) && (
                <p className="text-[10px] text-muted-foreground">
                  Activado automáticamente para {isColombiaAuto ? 'Colombia' : 'Chile'}.
                </p>
              )}
              {!isColombiaAuto && !isChilePreview && suggestedSource && (
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
              checked={isColombiaAuto || isChilePreview || form.advCreateStructuredSourceBatch}
              onChange={(e) => {
                if (!isColombiaAuto && !isChilePreview) onFormChange('advCreateStructuredSourceBatch', e.target.checked);
              }}
              disabled={generating || isColombiaAuto || isChilePreview}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-border accent-su-brand disabled:cursor-not-allowed"
            />
            <Label htmlFor="adv-create-structured-source-batch" className="cursor-pointer space-y-0.5">
              <span className="text-xs font-medium text-foreground">
                Incluir también prospectos desde fuente oficial
              </span>
              {(isColombiaAuto || isChilePreview) && (
                <p className="text-[10px] text-muted-foreground">
                  Activado automáticamente para {isColombiaAuto ? 'Colombia (RUES/co_rues)' : 'Chile (RES/cl_res)'}.
                </p>
              )}
              {!isColombiaAuto && !isChilePreview && (
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
                onFormChange('advStructuredSourcePage', Math.max(1, Math.min(STRUCTURED_PAGE_MAX, parseInt(v ?? '1') || 1)))
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
    <div className="space-y-6">
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
                <p>La fuente oficial no entregó empresas revisables.</p>
                {structuredBatch?.status === 'official_source_error' ? (
                  <p className="text-[11px] text-destructive dark:text-red-400 font-medium">
                    La fuente oficial no pudo completarse. Intenta nuevamente más tarde.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                      SellUp revisó la fuente oficial disponible, pero los registros encontrados fueron omitidos por duplicidad, liquidación, inactividad o datos mínimos insuficientes.
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      No se usó fuente comercial porque para Colombia los registros deben tener NIT válido.
                    </p>
                  </>
                )}
              </div>
            )
          ) : countryCode === 'CL' ? (
            usefulCandidatesCount > 0 ? (
              <div className="space-y-1">
                <p>Empresas chilenas listas para revisión.</p>
                <p className="text-[11px] text-muted-foreground/75 font-medium">
                  SellUp encontró {usefulCandidatesCount} empresa{usefulCandidatesCount !== 1 ? 's' : ''} con RUT válido en la fuente oficial.
                </p>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Sector no disponible en fuente oficial — puede requerir enriquecimiento externo o revisión humana.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p>La fuente oficial chilena no entregó empresas revisables.</p>
                {structuredBatch?.status === 'official_source_error' ? (
                  <p className="text-[11px] text-destructive dark:text-red-400 font-medium">
                    La fuente oficial no pudo completarse. Intenta nuevamente más tarde.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    SellUp revisó la fuente oficial disponible, pero los registros encontrados fueron omitidos por duplicidad, datos mínimos insuficientes o filtros de capital/fecha.
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

      {/* Lote Apollo — oculto si fuente oficial satisfizo completamente, Colombia o Chile */}
      {sourceStrategy !== 'official_source_satisfied' && countryCode !== 'CO' && countryCode !== 'CL' && (
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
                    La fuente oficial no entregó empresas revisables
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">
                  SellUp revisó la fuente oficial disponible, pero los registros encontrados fueron omitidos por duplicidad, liquidación, inactividad o datos mínimos insuficientes.
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

            {!nothingToWrite && structuredBatch.warnings && structuredBatch.warnings.length > 0 && (() => {
              const visible = structuredBatch.warnings!.filter(w => w in WARNING_LABELS);
              if (visible.length === 0) return null;
              return (
                <div className="rounded-lg bg-amber-500/5 p-2 border border-amber-500/10 text-[11px] text-amber-600 dark:text-amber-400 space-y-1">
                  <div className="flex items-center gap-1 font-semibold">
                    <TriangleAlert className="h-3 w-3" />
                    <span>Advertencias</span>
                  </div>
                  {visible.map((w, i) => (
                    <p key={i} className="pl-4">· {WARNING_LABELS[w]}</p>
                  ))}
                </div>
              );
            })()}
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
