'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAgentRuns } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import { AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';
import { AGENT_RUNS_PAGE_PATH } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray-copy';
import { registerAgentRunOpener, takeAgentRunFromUrl } from '@/components/prospect-batches/agent-runs-tray/agent-run-opener';
import { AgentRunDrawerView } from '@/components/prospect-batches/chat-wizard/agent-run-drawer-view';
import {
  AlertCircle,
  X,
  Check,
  CheckCircle2,
  ChevronRight,
  TriangleAlert,
  XCircle,
  Info,
  Settings2,
  Globe,
  Hash,
  Database,
  Building2,
} from "@/icons";
import { ExploratorySearchFormV2 } from '@/components/prospect-batches/exploratory-search-form-v2';
import { ProspectChatWizard } from '@/components/prospect-batches/chat-wizard';
import type { ProspectChatWizardHandle } from '@/components/prospect-batches/chat-wizard/prospect-chat-wizard';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type {
  GenerateProspectsExperience,
  GenerateProspectsUnavailableKind,
} from '@/components/prospect-batches/generate-ai-batch-experience';
// Sólo el tipo: se borra al compilar, así que este componente cliente no arrastra
// el resolutor (que lee env) ni puede resolver el proveedor por su cuenta.
import type { WizardDiscoveryProviderKey } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-resolver';
import type { WizardProviderOverrideCapability } from '@/modules/prospect-batches/chat-wizard-execution/wizard-run-provider-capability';
import type { ApolloRunModeLimits } from '@/components/prospect-batches/chat-wizard/wizard-run-provider-copy';
import type { WizardBudgetPreflight } from '@/modules/prospect-batches/chat-wizard-execution/wizard-budget-preflight';
import { ChatPanel, ChatThinking } from '@/components/chat';
import { DrawerSection } from '@/components/shared/drawer-section';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Timeline, TimelineItem } from '@/components/data-display/timeline';
import { Button } from '@/components/ui/button';
import { AIButton } from '@/components/ai/ai-button';
import { AiAnalyzingState } from '@/components/ai/ai-analyzing-state';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldLabel } from '@/components/forms/field';
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

/** El cuerpo desplazable del panel del agente, con el aire de `ChatPanel`. */
/** Cuánto se queda el aviso de «sigue en segundo plano». */
const BACKGROUND_NOTICE_MS = 8_000;

const PANEL_BODY = 'min-h-0 flex-1 overflow-y-auto px-4 py-5';

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
  success: <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  warning: <TriangleAlert className="h-3.5 w-3.5 text-warning" />,
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

// Registro de lo que el agente ya hizo: un evento por paso sobre la línea del
// `Timeline` de Thema. Mientras corre, debajo va el «pensando» del chat
// (`ChatThinking`): la marca que gira y los segundos que lleva.
function ThinkingStepsDisplay({ steps, isTyping }: { steps: string[]; isTyping: boolean }) {
  return (
    <div className="flex w-full flex-col gap-3 animate-su-fade-in">
      {steps.length > 0 && (
        <Timeline className="w-full">
          {steps.map((msg, i) => (
            <TimelineItem
              key={i}
              tone="primary"
              icon={<Check aria-hidden />}
              title={<span className="leading-relaxed">{msg}</span>}
              className="pb-3 animate-su-fade-in"
            />
          ))}
        </Timeline>
      )}
      {isTyping && <ChatThinking label="Pensando…" />}
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

/**
 * A1-LEGACY-PATH-FENCE-1 (P0): `legacy` is no longer part of
 * `GenerateProspectsExperience`, so no resolver output can select the legacy
 * Apollo form. It survives here as an explicit opt-in value — nothing in the
 * normal degradation path passes it, and the default is `unavailable`, not
 * `legacy`. Keeping the form body reachable only through a deliberate prop lets
 * the existing legacy tests and the admin-gated capability keep compiling while
 * the implicit route stays closed.
 */
export type GenerateAIBatchDrawerExperience =
  | GenerateProspectsExperience
  | 'legacy';

type GenerateAIBatchDrawerProps = {
  /**
   * Resolved server-side experience key. Defaults to 'unavailable' (fail-closed):
   * a caller that forgets to pass an experience gets the safe explanatory state,
   * never a billable legacy CTA.
   */
  experience?: GenerateAIBatchDrawerExperience;
  /** Which explanatory state to render when experience is 'unavailable'. */
  unavailableKind?: GenerateProspectsUnavailableKind | null;
  /** Required when experience is 'exploratory_form_v2' or 'chat_wizard'. */
  catalog?: ActiveIndustryCatalog | null;
  /** When true, the chat wizard will show the real generation CTA. Default false. */
  executionEnabled?: boolean;
  /**
   * Q3F-5BB.3E — When true, the CONVERSATIONAL wizard's FINAL search step uses
   * Lusha as a HIDDEN discovery provider (read-only) if the collected criteria
   * are compatible (país soportado + sector mapeado). The wizard body stays the
   * conversational chat; there are no source tabs and no provider choice. Gated
   * by ENABLE_LUSHA_PREVIEW upstream. Default false → existing IA flow, no Lusha.
   */
  lushaPreviewEnabled?: boolean;
  /**
   * AGENT1-AUTO-PROVIDER-CASCADE-1 — el proveedor lo decide el sistema (Apollo y,
   * si no alcanza, Lusha). Resuelto en el servidor; ausente ⇒ `false`, el
   * comportamiento previo.
   */
  autoProviderCascade?: boolean;
  /**
   * A1-APOLLO-WIZARD-1 — proveedor de descubrimiento ya resuelto en el servidor.
   * Sólo se transporta hasta el wizard para que la UI pueda nombrarlo; este
   * componente no lo interpreta ni lo deduce. `null` = sin resolución conocida.
   */
  discoveryProvider?: WizardDiscoveryProviderKey | null;
  /**
   * A1-APOLLO-QA-CONTROL-SURFACE-1 § 2 — capacidad sanitizada de elegir proveedor
   * por corrida, resuelta en el servidor. Sólo se transporta; este componente no
   * la interpreta. Ausente ⇒ sin capacidad.
   */
  providerOverrideCapability?: WizardProviderOverrideCapability;
  /** § 5 — topes efectivos de la modalidad de dos rondas. Sólo se transportan. */
  apolloRunModeLimits?: ApolloRunModeLimits | null;
  /**
   * AGENT1-MACRO-V2-BUDGET-GATE-PREFLIGHT-1 — saldo del período y coste del peor
   * caso por proveedor, ya resueltos en el servidor. Sólo se transportan; este
   * componente no compara nada. `null`/ausente ⇒ sin instantánea, y la pantalla
   * no bloquea por presupuesto.
   */
  budgetPreflight?: WizardBudgetPreflight | null;
  /**
   * Modo controlado: quien lo monta decide cuándo está abierto (la barra de
   * acciones de la pantalla) y el drawer no pinta su propio botón. Sólo cambia
   * QUIÉN lo abre: la experiencia que se muestra dentro es la misma.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function GenerateAIBatchDrawer({ experience = 'unavailable', unavailableKind = null, catalog = null, executionEnabled = false, lushaPreviewEnabled = false, autoProviderCascade = false, discoveryProvider = null, providerOverrideCapability, apolloRunModeLimits = null, budgetPreflight = null, open: controlledOpen, onOpenChange }: GenerateAIBatchDrawerProps = {}) {
  const router = useRouter();
  const agentRuns = useAgentRuns();
  const runsInProgress = agentRuns.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [drawer, setDrawer] = React.useState(EMPTY_DRAWER);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : drawer.open;
  const [result, setResult] = React.useState(EMPTY_RESULT);
  const [progressSteps, setProgressSteps] = React.useState<string[]>([]);
  const typingStepIndex = React.useRef(0);
  const showTyping = React.useRef(false);
  // La cabecera del panel puede pedirle al asistente que empiece de nuevo.
  const wizardRef = React.useRef<ProspectChatWizardHandle>(null);
  const [wizardCanRestart, setWizardCanRestart] = React.useState(false);
  // Centro de procesos ↔ drawer. `wizardKey` monta una conversación nueva sin
  // tocar la corrida en vuelo (vive en el almacén del shell); `wizardRunId` es la
  // que ESTE chat tiene en vuelo; `viewRunId`, la que se abrió desde el centro.
  const [wizardKey, setWizardKey] = React.useState(0);
  const [wizardRunId, setWizardRunId] = React.useState<string | null>(null);
  const [viewRunId, setViewRunId] = React.useState<string | null>(null);
  // La búsqueda que quedó en segundo plano al pulsar «+»: se avisa arriba del chat nuevo.
  const [backgroundRunTitle, setBackgroundRunTitle] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!backgroundRunTitle) return undefined;
    const timer = setTimeout(() => setBackgroundRunTitle(null), BACKGROUND_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [backgroundRunTitle]);
  const canOpenRuns = experience === 'chat_wizard' && Boolean(catalog);
  const openRunRef = React.useRef<(clientRequestId: string) => void>(() => {});
  React.useEffect(() => {
    openRunRef.current = (clientRequestId) => {
      // La corrida que este chat tiene en vuelo ya se ve en su conversación.
      setViewRunId(clientRequestId === wizardRunId ? null : clientRequestId);
      if (!isOpen) {
        if (isControlled) onOpenChange?.(true);
        else setDrawer((prev) => ({ ...prev, open: true }));
      }
    };
  });
  React.useEffect(() => {
    if (!canOpenRuns) return undefined;
    const pending = takeAgentRunFromUrl();
    if (pending) openRunRef.current(pending);
    return registerAgentRunOpener((clientRequestId) => openRunRef.current(clientRequestId));
  }, [canOpenRuns]);

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
    onOpenChange?.(false);
    setViewRunId(null);
    setWizardRunId(null);
    setBackgroundRunTitle(null);
    setDrawer(EMPTY_DRAWER);
    setForm(EMPTY_FORM);
    setResult(EMPTY_RESULT);
    setProgressSteps([]);
  }

  /** Una conversación nueva; lo que estuviera en vuelo sigue en el Centro de procesos. */
  function startNewSearch() {
    const leftRunning = agentRuns.find(
      (run) =>
        (run.clientRequestId === wizardRunId || run.clientRequestId === viewRunId) &&
        (run.status === 'running' || run.status === 'queued'),
    );
    setBackgroundRunTitle(leftRunning?.title ?? null);
    setViewRunId(null);
    setWizardRunId(null);
    setWizardKey((key) => key + 1);
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
        onOpenChange?.(false);
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

  // ── Unavailable experience (A1-LEGACY-PATH-FENCE-1, P0) ─────────────────────
  // Fail-closed UI. Previously each of these conditions rendered the legacy
  // Apollo form with the same "Generar con IA" CTA, so a user could not tell a
  // working search from a broken one — and clicking it spent up to 25 Apollo
  // credits. There is deliberately NO execution CTA on this branch: no legacy
  // form, no call to generateAIProspectBatch, no provider, no batch, no credits.
  //
  // It also covers the defensive case below: an experience that needs a catalog
  // but was handed a null one renders THIS state rather than falling through to
  // the legacy form, so "catalog missing" can never reach a billable CTA by any
  // route.
  function renderUnavailable(kind: GenerateProspectsUnavailableKind) {
    const message =
      kind === 'wizard_disabled'
        ? 'La búsqueda de empresas no está disponible temporalmente.'
        : kind === 'catalog_needs_admin'
          ? 'La configuración de industrias no está disponible. Contacta a un administrador.'
          : 'No pudimos cargar la configuración de búsqueda. Intenta nuevamente.';

    return (
      <>
        {!isControlled && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => updateDrawer('open', true)}
          >
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
            Búsqueda no disponible
          </Button>
        )}
        <ChatPanel
          open={isOpen}
          onOpenChange={(v) => !v && handleClose()}
          subtitle="Búsqueda de empresas no disponible"
          markMotion="still"
        >
          <div className={PANEL_BODY}>
            <Alert variant="warning">
              <AlertTitle className="text-sm">
                La generación de empresas candidatas no puede ejecutarse en este momento.
              </AlertTitle>
              <AlertDescription className="text-xs">{message}</AlertDescription>
            </Alert>

            {/* Retry is offered ONLY for a transient catalog read failure. It reloads
                the server component so the catalog query runs again — it does not
                execute discovery, call any provider, create a batch or reserve
                credits. */}
            {kind === 'catalog_retryable' ? (
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => router.refresh()}
                >
                  Intentar de nuevo
                </Button>
              </div>
            ) : null}
          </div>
        </ChatPanel>
      </>
    );
  }

  if (experience === 'unavailable') {
    return renderUnavailable(unavailableKind ?? 'wizard_disabled');
  }

  // Chat wizard experience
  if (experience === 'chat_wizard' && catalog) {
    return (
      <>
        {!isControlled && (
          <AIButton size="sm" onClick={() => updateDrawer('open', true)}>
            Generar con IA
          </AIButton>
        )}
        {/* El asistente vive en el panel del agente de Thema: se acopla al lado
            de la página y la estrecha, sin velo, así que el listado de
            prospectos sigue a la vista y se puede consultar mientras se responde. */}
        <ChatPanel
          open={isOpen}
          onOpenChange={(v) => !v && handleClose()}
          subtitle="Generar empresas candidatas"
          onNewConversation={() => {
            // Con una corrida en vuelo (o abierta desde el Centro de procesos) el
            // «+» no la cancela: sigue en el centro y aquí empieza otra búsqueda.
            if (wizardRunId || viewRunId) startNewSearch();
            else wizardRef.current?.requestRestart();
          }}
          newConversationLabel={
            wizardRunId ? 'Nueva búsqueda (esta sigue en el Centro de procesos)' : viewRunId ? 'Nueva búsqueda' : 'Comenzar de nuevo'
          }
          newConversationDisabled={!(wizardRunId || viewRunId || wizardCanRestart)}
          // AGENT1-PARALLEL-RUNS-PHASE2-1 — las búsquedas viven en el shell: el
          // panel puede irse (minimizar) y la página de búsquedas las muestra todas.
          runsInProgress={runsInProgress}
          onRuns={() => {
            handleClose();
            router.push(AGENT_RUNS_PAGE_PATH);
          }}
          onMinimize={() => {
            handleClose();
            window.dispatchEvent(new Event(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT));
          }}
        >
          {backgroundRunTitle && !viewRunId && (
            <div className="shrink-0 px-4 pt-3" data-testid="agent-run-background-notice">
              <Alert variant="info" className="relative pr-10">
                <AlertDescription className="text-xs text-foreground">
                  La búsqueda «{backgroundRunTitle}» sigue en segundo plano en el Centro de procesos.
                </AlertDescription>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-2 top-2"
                  aria-label="Cerrar aviso"
                  onClick={() => setBackgroundRunTitle(null)}
                >
                  <X aria-hidden />
                </Button>
              </Alert>
            </div>
          )}
          {viewRunId && (
            <AgentRunDrawerView
              key={viewRunId}
              clientRequestId={viewRunId}
              onNewSearch={startNewSearch}
              onClose={handleClose}
            />
          )}
          {/* Con una corrida abierta desde el centro, la conversación se oculta
              pero no se desmonta: lo que se estaba respondiendo no se pierde. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', viewRunId && 'hidden')}>
            <ProspectChatWizard
              key={wizardKey}
              ref={wizardRef}
              onRestartAvailabilityChange={setWizardCanRestart}
              onRunningChange={setWizardRunId}
              catalog={catalog}
              onClose={handleClose}
              executionEnabled={executionEnabled}
              lushaPreviewEnabled={lushaPreviewEnabled}
              autoProviderCascade={autoProviderCascade}
              discoveryProvider={discoveryProvider}
              providerOverrideCapability={providerOverrideCapability}
              apolloRunModeLimits={apolloRunModeLimits}
              budgetPreflight={budgetPreflight}
            />
          </div>
        </ChatPanel>
      </>
    );
  }

  // V2: catalog-driven exploratory form
  if (experience === 'exploratory_form_v2' && catalog) {
    return (
      <>
        {!isControlled && (
          <AIButton size="sm" onClick={() => updateDrawer('open', true)}>
            Generar con IA
          </AIButton>
        )}
        <ChatPanel
          open={isOpen}
          onOpenChange={(v) => !v && handleClose()}
          subtitle="Explorar el catálogo de industrias"
        >
          <div className={PANEL_BODY}>
            <ExploratorySearchFormV2 catalog={catalog} onClose={handleClose} />
          </div>
        </ChatPanel>
      </>
    );
  }

  // A1-LEGACY-PATH-FENCE-1 (P0): everything below renders the legacy Apollo form,
  // which is now reachable ONLY when a caller opts in explicitly with
  // experience='legacy'. A catalog-dependent experience that arrived without a
  // catalog used to fall through to here — the last implicit route to a billable
  // CTA. It now renders the same fail-closed state as any other missing catalog.
  if (experience !== 'legacy') {
    return renderUnavailable('catalog_needs_admin');
  }

  return (
    <>
      {!isControlled && (
        <AIButton size="sm" onClick={() => updateDrawer('open', true)}>
          Generar con IA
        </AIButton>
      )}
      <ChatPanel
        open={isOpen}
        onOpenChange={(v) => !v && handleClose()}
        subtitle="Generar empresas candidatas"
        markMotion={drawer.generating ? 'thinking' : 'breathing'}
        closeDisabled={drawer.generating}
      >
      <div className={PANEL_BODY}>
      {showPreflightResult ? (
        /* ── Resultado de generación ── */
        <div ref={resultPanelRef}>
          {progressSteps.length > 0 && (
            <div className="mb-4 border-b border-border/50 pb-4">
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
        <div ref={resultPanelRef} className="flex flex-col items-start px-2 py-6">
          <ThinkingStepsDisplay steps={progressSteps} isTyping={true} />
        </div>
      ) : (
        /* ── Formulario principal ── */
        <form
          id="generate-ai-batch-form"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {/* Segmentación */}
          <DrawerSection
            title="Segmentación"
            icon={Globe}
            hint="Define el país y la industria para la búsqueda."
          >
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
          </DrawerSection>

          {/* Cantidad */}
          {drawer.advancedOpen ? (
            <DrawerSection
              title="Cantidad"
              icon={Hash}
              hint="Control cuántas empresas se intentan encontrar."
            >
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
            </DrawerSection>
          ) : (
            <DrawerSection title="Cantidad" icon={Hash}>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {form.countryCode === 'CO' ? (
                  "SellUp buscará hasta 5 empresas útiles para revisión. Si encuentra registros duplicados, liquidados, inactivos o sin datos mínimos, los omitirá automáticamente."
                ) : form.countryCode === 'CL' ? (
                  "SellUp buscará hasta 5 empresas registradas en fuente oficial chilena. El sector no viene disponible en la fuente oficial, por lo que puede requerir enriquecimiento externo o revisión humana."
                ) : (
                  "SellUp buscará hasta 10 empresas útiles para revisión. Si encuentra duplicadas, liquidadas o no viables, las omitirá automáticamente y podrá hacer hasta 2 intentos de búsqueda."
                )}
              </p>
            </DrawerSection>
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
      </div>
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
      </ChatPanel>
    </>
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
      <div className="shrink-0 border-t border-border/60 bg-card px-6 py-4">
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
    <div className="shrink-0 border-t border-border/60 bg-card px-6 py-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={generating}
          >
            Cancelar
          </Button>
          {generating && progressMsg && (
            <AiAnalyzingState variant="inline" title={progressMsg} />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
      <p className="text-xs text-warning font-medium leading-relaxed">
        No se encontraron empresas útiles para revisión. SellUp omitió registros por liquidación, inactividad, duplicidad o datos mínimos insuficientes.
      </p>
    );
  }

  if (sourceStrategy === 'official_source_satisfied') {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        SellUp encontró {structuredBatchResult?.candidatesWritten ?? 10} empresas útiles en fuente oficial. Se omitieron {structuredBatchResult?.candidatesSkipped ?? 0} registros no viables.
      </p>
    );
  }

  if (sourceStrategy === 'official_plus_commercial') {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        SellUp encontró {structuredBatchResult?.candidatesWritten ?? 0} empresas útiles en fuente oficial y completó con fuente comercial.
      </p>
    );
  }

  if (sourceStrategy === 'commercial_fallback') {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        No se encontraron empresas útiles con los criterios actuales. Intenta otra industria o país.
      </p>
    );
  }

  if (structuredBatchResult && !structuredBatchResult.ok && isAutoModeAllPagesScanned(structuredBatchResult)) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        SellUp encontró {structuredBatchResult?.candidatesWritten ?? 0} empresas útiles. Se detuvo después de 2 intentos para controlar costos.
      </p>
    );
  }

  if (structuredBatchResult?.ok && structuredBatchResult.batchId) {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
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
      <AIButton size="sm" onClick={() => onNavigate(structuredBatchResult.batchId!)} rightIcon={ChevronRight}>
        Ver prospectos generados
      </AIButton>
    );
  }

  if (sourceStrategy === 'official_plus_commercial' && structuredBatchResult?.ok && structuredBatchResult.batchId) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="sm"
          variant="outline"
          onClick={onGoToBatch}
        >
          Ver complemento comercial
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <AIButton size="sm" onClick={() => onNavigate(structuredBatchResult.batchId!)} rightIcon={ChevronRight}>
          Ver prospectos generados
        </AIButton>
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
        >
          Ver también desde Apollo
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <AIButton size="sm" onClick={() => onNavigate(structuredBatchResult.batchId!)} rightIcon={ChevronRight}>
          Ver prospectos generados
        </AIButton>
      </div>
    );
  }

  return (
    <AIButton size="sm" onClick={onGoToBatch} rightIcon={ChevronRight}>
      Ver prospectos generados
    </AIButton>
  );
}

// ── Sources Info Section ──────────────────────────────────────────────────────

type SourcesInfoProps = {
  sources: Array<{ label: string; desc: string }>;
  hasCountry: boolean;
};

function SourcesInfo({ sources, hasCountry }: SourcesInfoProps) {
  return (
    <DrawerSection
      title="Fuentes que usará el agente"
      icon={Database}
      hint={hasCountry ? undefined : "Las fuentes se configuran automáticamente al seleccionar el país."}
    >
      <div className="flex flex-wrap gap-2">
        {sources.map((src) => (
          <Badge key={src.label} variant="secondary" className="h-auto whitespace-normal py-1">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />
            <span className="font-medium">{src.label}</span>
            <span className="text-muted-foreground">· {src.desc}</span>
          </Badge>
        ))}
      </div>
    </DrawerSection>
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
        <AccordionTrigger className="py-2 text-xs font-semibold text-muted-foreground hover:no-underline hover:text-muted-foreground">
          <div className="flex items-center gap-2">
            <Settings2 className="h-3.5 w-3.5" />
            Opciones avanzadas
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="mt-2 rounded-xl border border-border/60 bg-surface-subtle p-4">
            <Alert variant="warning" className="mb-4">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Estas opciones son para diagnóstico y QA. En uso normal SellUp selecciona las fuentes automáticamente.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              {/* Cantidad override */}
              <div className="space-y-1.5">
                <FieldLabel className="block text-xs text-muted-foreground">
                  Cantidad (Override QA)
                </FieldLabel>
                <Select
                  value={form.targetCount}
                  onValueChange={(v) => onFormChange('targetCount', v ?? '10')}
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
              </div>

              {/* Profundidad de búsqueda */}
              <div className="space-y-1.5">
                <FieldLabel className="block text-xs text-muted-foreground">
                  Profundidad de búsqueda
                </FieldLabel>
                <Select
                  value={form.advSearchDepth}
                  onValueChange={(v) => onFormChange('advSearchDepth', (v ?? 'standard') as BatchSearchDepth)}
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
              </div>

              {/* Preflight estructurado */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="adv-structured-source-preflight"
                  checked={isColombiaAuto || isChilePreview || form.advStructuredSourcePreflight}
                  onCheckedChange={(value) => {
                    if (!isColombiaAuto && !isChilePreview) onFormChange('advStructuredSourcePreflight', value === true);
                  }}
                  disabled={generating || isColombiaAuto || isChilePreview}
                  className="mt-0.5"
                />
                <FieldLabel htmlFor="adv-structured-source-preflight" className="cursor-pointer space-y-0.5">
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
                </FieldLabel>
              </div>

              {/* Crear lote fuente oficial */}
              <div className="flex items-start gap-3">
                <Checkbox
                  id="adv-create-structured-source-batch"
                  checked={isColombiaAuto || isChilePreview || form.advCreateStructuredSourceBatch}
                  onCheckedChange={(value) => {
                    if (!isColombiaAuto && !isChilePreview) onFormChange('advCreateStructuredSourceBatch', value === true);
                  }}
                  disabled={generating || isColombiaAuto || isChilePreview}
                  className="mt-0.5"
                />
                <FieldLabel htmlFor="adv-create-structured-source-batch" className="cursor-pointer space-y-0.5">
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
                </FieldLabel>
              </div>

              {/* Página RUES — solo diagnóstico/QA */}
              <div className="space-y-1.5">
                <FieldLabel className="block text-xs text-muted-foreground">
                  Usar página específica de fuente oficial
                </FieldLabel>
                <Select
                  value={String(form.advStructuredSourcePage)}
                  onValueChange={(v) =>
                    onFormChange('advStructuredSourcePage', Math.max(1, Math.min(STRUCTURED_PAGE_MAX, parseInt(v ?? '1') || 1)))
                  }
                  disabled={generating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: STRUCTURED_PAGE_MAX }, (_, i) => i + 1).map((p) => (
                      <SelectItem key={p} value={String(p)}>
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
          </div>
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
      <SurfaceCard className="p-4">
        <div className="flex items-center gap-3">
          {usefulCandidatesCount > 0 ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-success/10">
              <CheckCircle2 className="h-4 w-4 text-success" />
            </div>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15">
              <TriangleAlert className="h-4 w-4 text-warning" />
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-foreground">
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
        <DrawerSection
          title={sourceStrategy === 'official_plus_commercial'
            ? 'Complemento comercial (Apollo)'
            : sourceStrategy === 'commercial_fallback'
            ? 'Fuente alternativa (Apollo)'
            : 'Empresas generadas (Apollo)'}
          icon={Building2}
        >
          <dl className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-muted-foreground">Estado:</dt>
              <dd>
                {usefulCandidatesCount > 0 ? (
                  <Badge variant="positive">
                    <CheckCircle2 className="h-3 w-3" />
                    Creado
                  </Badge>
                ) : (
                  <Badge variant="warning">
                    <TriangleAlert className="h-3 w-3" />
                    Sin candidatas útiles
                  </Badge>
                )}
              </dd>
            </div>
            {apolloBatchId && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Batch ID:</dt>
                <dd>
                  <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                    {apolloBatchId.slice(0, 8)}…
                  </code>
                </dd>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-x-6">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Candidatos útiles:</dt>
                <dd className="font-semibold tabular-nums text-foreground">{usefulCandidatesCount}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Omitidos:</dt>
                <dd className="font-semibold tabular-nums text-foreground">{omittedCandidatesCount}</dd>
              </div>
            </div>
          </dl>
        </DrawerSection>
      )}

      {/* Lote fuente oficial (si se intentó) */}
      {structuredBatch && (() => {
        const nothingToWrite = isStructuredSourceNothingToWrite(structuredBatch);
        const isSocrataTimeout = isSocrataTimeoutError(structuredBatch);
        const dotClass = structuredBatch.ok || structuredBatch.status === 'official_source_success'
          ? 'bg-success'
          : structuredBatch.status === 'official_source_error'
            ? 'bg-destructive'
            : 'bg-warning';

        return (
          <SurfaceCard className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
              <span className="text-xs font-semibold text-muted-foreground">
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
                  <dl className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-muted-foreground">Estado:</dt>
                      <dd>
                        <Badge variant="positive">
                          <CheckCircle2 className="h-3 w-3" />
                          Creado · Revisión humana pendiente
                        </Badge>
                      </dd>
                    </div>
                    {!structuredBatch.autoMode && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Página usada:</dt>
                        <dd className="font-semibold tabular-nums text-foreground">{structuredSourcePage}</dd>
                      </div>
                    )}
                    {structuredBatch.batchId && (
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Batch ID:</dt>
                        <dd>
                          <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                            {structuredBatch.batchId.slice(0, 8)}…
                          </code>
                        </dd>
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-x-6">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Candidatos escritos:</dt>
                        <dd className="font-semibold tabular-nums text-foreground">{structuredBatch.candidatesWritten}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Omitidos:</dt>
                        <dd className="font-semibold tabular-nums text-foreground">{structuredBatch.candidatesSkipped}</dd>
                      </div>
                    </div>
                  </dl>
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
        <SurfaceCard className="p-4">
          <SurfaceCardHeader
            title="Preflight Fuente Oficial"
            actions={
              <div className="flex items-center gap-1.5 text-xs">
                {statusIcon}
                <span className="font-medium text-foreground">{statusLabel}</span>
              </div>
            }
          />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Candidatos leídos:</dt>
              <dd className="font-medium tabular-nums text-foreground">{result.recordsRead}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Potenciales:</dt>
              <dd className="font-medium tabular-nums text-foreground">{result.candidatesCount}</dd>
            </div>
          </dl>
        </SurfaceCard>
      )}
    </div>
  );
}
