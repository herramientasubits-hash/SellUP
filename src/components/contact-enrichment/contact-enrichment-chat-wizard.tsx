'use client';

import * as React from 'react';
import { Building2, Check, Globe, MapPin, PenLine, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AgentChatTimeline,
  AgentChatComposer,
  AgentChatOptionCard,
  useProgressiveReveal,
  type AgentChatComposerMode,
} from '@/components/agent-chat';
import {
  resolveContactEnrichmentCompanyAction,
  createContactEnrichmentRequestAction,
} from '@/modules/contact-enrichment/actions';
// AGENT2-ROUTING-WIRE-1: the wizard CTA runs the automatic Apollo→Lusha router.
// It no longer imports the manual per-provider request actions — the user never
// picks a provider; routing is decided by the orchestrator behind
// ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING.
import { runAutomaticContactEnrichmentForRequestAction } from '@/modules/contact-enrichment/automatic-routing-actions';
import type { CompanyCandidate } from '@/modules/contact-enrichment/types';
import {
  contactEnrichmentChatReducer,
  createInitialContactEnrichmentChatState,
  buildResolveInput,
  classifyCompanyQuery,
  planResolution,
} from './contact-enrichment-chat-reducer';
import type {
  ContactEnrichmentChatStep,
  ContactEnrichmentInitialCompany,
} from './contact-enrichment-chat-types';
import {
  CONTACT_ENRICHMENT_COMPANY_SEARCH_UNEXPECTED_ERROR_COPY,
  CONTACT_ENRICHMENT_REQUEST_UNEXPECTED_ERROR_COPY,
  CONTACT_ENRICHMENT_SEARCH_CONTACTS_UNEXPECTED_ERROR_COPY,
} from './contact-enrichment-chat-error-copy';
import { SurfaceCard } from '@/components/shared/surface-card';
import { SourceBadge, CompanyChip, RunResultSnapshot } from './contact-enrichment-chat-result';
import type { ManualContactContext } from './contact-enrichment-chat-types';

// ── Composer copy by step ──────────────────────────────────────────────────────

function composerPlaceholder(step: ContactEnrichmentChatStep): string {
  switch (step) {
    case 'await_company':
      return 'Escribe el nombre, dominio o HubSpot ID…';
    case 'resolving':
      return 'Buscando empresa…';
    case 'selecting_company':
      return 'Elige una empresa para continuar';
    case 'needs_extra_data':
      return 'Completa el dato adicional abajo';
    case 'confirming':
      return 'Confirma la empresa para continuar';
    case 'creating_run':
      return 'Creando run…';
    case 'searching_contacts':
      return 'Buscando contactos…';
    case 'searching_apollo':
      return 'Buscando en Apollo…';
    case 'searching_lusha':
      return 'Buscando en Lusha…';
    case 'done':
      return 'Enriquecimiento preparado';
    case 'error':
      return 'Corrige el problema para continuar';
    default:
      return '';
  }
}

function typingLabelForStep(step: ContactEnrichmentChatStep): string {
  if (step === 'resolving') return 'Buscando en SellUp y HubSpot…';
  if (step === 'creating_run') return 'Creando run y revisando contactos existentes…';
  if (step === 'searching_contacts') return 'Buscando contactos con el proveedor configurado…';
  if (step === 'searching_apollo') return 'Buscando perfiles relevantes en Apollo…';
  if (step === 'searching_lusha') return 'Buscando perfiles en Lusha…';
  return 'escribiendo';
}

// ── Main wizard ─────────────────────────────────────────────────────────────────

interface ContactEnrichmentChatWizardProps {
  initialCompany?: ContactEnrichmentInitialCompany;
  onCreateManualContact?: (ctx: ManualContactContext) => void;
}

export function ContactEnrichmentChatWizard({
  initialCompany,
  onCreateManualContact,
}: ContactEnrichmentChatWizardProps = {}) {
  const [state, dispatch] = React.useReducer(
    contactEnrichmentChatReducer,
    initialCompany,
    createInitialContactEnrichmentChatState,
  );

  const [composerText, setComposerText] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { visibleCount, isRevealing } = useProgressiveReveal(state.messages.length);
  const isLoadingStep =
    state.step === 'resolving' ||
    state.step === 'creating_run' ||
    state.step === 'searching_contacts' ||
    state.step === 'searching_apollo' ||
    state.step === 'searching_lusha';
  const isTyping = isRevealing || isLoadingStep;
  const showActiveRegion = !isTyping;

  // ── Autoscroll to bottom as messages reveal / step changes ──────────────────
  React.useEffect(() => {
    requestAnimationFrame(() => {
      const scrollEl =
        (scrollRef.current?.closest('.overflow-y-auto') as HTMLElement | null) ??
        (scrollRef.current?.parentElement as HTMLElement | null);
      if (scrollEl) {
        const prefersReduced =
          typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        scrollEl.scrollTo({
          top: scrollEl.scrollHeight,
          behavior: prefersReduced ? 'auto' : 'smooth',
        });
      }
    });
  }, [visibleCount, state.step, isTyping]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleSubmitCompany() {
    if (state.step !== 'await_company') return;
    const query = composerText.trim();
    if (!query) return;
    setComposerText('');
    dispatch({ type: 'SUBMIT_QUERY', query });

    // AGENT2A-PROD-INCIDENT: el `catch` es lo que garantiza que el paso de carga
    // SIEMPRE se cierre. Sin él, una llamada que rechaza (invocación cortada,
    // red caída, función matada por la plataforma tras esperar a HubSpot) dejaba
    // el wizard en `resolving` para siempre: el spinner infinito del incidente.
    let result: Awaited<ReturnType<typeof resolveContactEnrichmentCompanyAction>>;
    try {
      result = await resolveContactEnrichmentCompanyAction(buildResolveInput(query));
    } catch {
      dispatch({
        type: 'RESOLVE_FAILED',
        message: CONTACT_ENRICHMENT_COMPANY_SEARCH_UNEXPECTED_ERROR_COPY,
      });
      return;
    }
    if (!result.success || !result.data) {
      dispatch({ type: 'RESOLVE_FAILED', message: result.error ?? 'Error buscando empresa' });
      return;
    }
    dispatch(planResolution(query, result.data));
  }

  function handleSelectCandidate(candidate: CompanyCandidate) {
    dispatch({ type: 'SELECT_CANDIDATE', candidate });
  }

  function handleContinueAsManual() {
    const kind = classifyCompanyQuery(state.query);
    const manual: CompanyCandidate = {
      source: 'manual',
      name: state.query.trim(),
      domain: kind === 'domain' ? state.query.trim() : undefined,
      matchConfidence: 0.5,
    };
    dispatch({ type: 'SELECT_CANDIDATE', candidate: manual });
  }

  function handleExtraData(domain: string, country: string) {
    dispatch({ type: 'SUBMIT_EXTRA_DATA', domain, country });
  }

  async function handleConfirm() {
    const candidate = state.selectedCandidate;
    if (!candidate) return;
    dispatch({ type: 'CONFIRM' });

    // Mismo contrato que `handleSubmitCompany`: el paso de carga se cierra
    // incluso si la llamada rechaza (AGENT2A-PROD-INCIDENT).
    let result: Awaited<ReturnType<typeof createContactEnrichmentRequestAction>>;
    try {
      result = await createContactEnrichmentRequestAction(candidate);
    } catch {
      dispatch({
        type: 'RUN_FAILED',
        message: CONTACT_ENRICHMENT_REQUEST_UNEXPECTED_ERROR_COPY,
      });
      return;
    }

    if (!result.success || !result.requestId) {
      dispatch({ type: 'RUN_FAILED', message: result.error ?? 'Error creando la request de enriquecimiento' });
      return;
    }
    dispatch({ type: 'REQUEST_CREATED', requestId: result.requestId });
  }

  /**
   * AGENT2-ROUTING-WIRE-1 — single automatic search entry point.
   *
   * Runs the Apollo→Lusha automatic router via the existing
   * runAutomaticContactEnrichmentForRequestAction. The user picks nothing: the
   * primary provider (Apollo) and the fallback provider (Lusha) are decided by
   * the orchestrator, gated by ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING.
   *
   * The action always leaves candidates in pending_review — it never approves
   * or creates official contacts and never writes to HubSpot. With the flag off
   * (the production default) it is a safe no-op and the UI shows a "routing
   * disabled" notice for QA.
   */
  async function handleSearchContacts() {
    const requestId = state.requestId;
    if (!requestId || state.step !== 'done') return;
    dispatch({ type: 'AUTOMATIC_ROUTING_START' });

    // Mismo contrato que los otros dos pasos (AGENT2A-PROD-INCIDENT).
    let result: Awaited<ReturnType<typeof runAutomaticContactEnrichmentForRequestAction>>;
    try {
      result = await runAutomaticContactEnrichmentForRequestAction(requestId);
    } catch {
      dispatch({
        type: 'RUN_FAILED',
        message: CONTACT_ENRICHMENT_SEARCH_CONTACTS_UNEXPECTED_ERROR_COPY,
      });
      return;
    }

    if (!result.success) {
      dispatch({
        type: 'RUN_FAILED',
        message: result.blockedReason ?? 'No se pudo iniciar la búsqueda de contactos',
      });
      return;
    }
    dispatch({ type: 'AUTOMATIC_ROUTING_SETTLED', result });
  }

  function handleReset() {
    setComposerText('');
    dispatch({ type: 'RESET' });
  }

  const composerMode: AgentChatComposerMode =
    state.step === 'await_company' ? 'text' : 'locked';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-0">
      <div ref={scrollRef} className="flex flex-col gap-4 pb-4">
        <AgentChatTimeline
          messages={state.messages}
          visibleCount={visibleCount}
          isTyping={isTyping}
          typingLabel={typingLabelForStep(state.step)}
        />

        {showActiveRegion && (
          <div className="space-y-3">
            {state.step === 'selecting_company' && (
              <>
                {state.candidates.map((candidate, i) => (
                  <AgentChatOptionCard
                    key={`${candidate.source}-${candidate.sellupAccountId ?? candidate.hubspotCompanyId ?? candidate.domain ?? i}`}
                    icon={
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Building2 className="h-4 w-4 text-primary" aria-hidden />
                      </div>
                    }
                    title={candidate.name}
                    ariaLabel={`Usar ${candidate.name}`}
                    meta={<CandidateMeta candidate={candidate} />}
                    trailing={<SourceBadge source={candidate.source} />}
                    onClick={() => handleSelectCandidate(candidate)}
                  />
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleContinueAsManual}
                  className="w-full"
                >
                  <PenLine className="mr-2 h-4 w-4" aria-hidden />
                  Continuar como empresa manual
                </Button>
                <SecondaryReset onReset={handleReset} label="Buscar otra empresa" />
              </>
            )}

            {state.step === 'needs_extra_data' && (
              <ExtraDataCard onConfirm={handleExtraData} onReset={handleReset} />
            )}

            {state.step === 'confirming' && state.selectedCandidate && (
              <div className="space-y-3">
                <CompanyChip candidate={state.selectedCandidate} />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleReset} className="flex-1">
                    Cambiar empresa
                  </Button>
                  <Button onClick={handleConfirm} className="flex-1">
                    <Check className="mr-2 h-4 w-4" aria-hidden />
                    Confirmar empresa
                  </Button>
                </div>
              </div>
            )}

            {state.step === 'done' && (
              <div className="space-y-3">
                {state.runResult && (
                  <RunResultSnapshot
                    runResult={state.runResult}
                    candidate={state.selectedCandidate}
                    apolloResult={state.apolloResult}
                    lushaResult={state.lushaResult}
                    provider={state.selectedProvider}
                    onCreateManualContact={
                      onCreateManualContact && state.selectedCandidate?.sellupAccountId
                        ? () =>
                            onCreateManualContact({
                              accountId: state.selectedCandidate!.sellupAccountId!,
                              runId: state.runResult!.runId,
                              companyName: state.selectedCandidate?.name ?? null,
                              companyDomain: state.selectedCandidate?.domain ?? null,
                            })
                        : undefined
                    }
                  />
                )}
                {!state.automaticResult && (
                  <>
                    <AutomaticEnrichmentInfoCard />
                    <Button onClick={handleSearchContacts} className="w-full">
                      <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                      Buscar contactos con IA
                    </Button>
                  </>
                )}
                <SecondaryReset onReset={handleReset} label="Enriquecer otra empresa" />
              </div>
            )}

            {state.step === 'error' && (
              <Alert variant="destructive" className="p-5">
                <AlertTitle>No se pudo continuar</AlertTitle>
                <AlertDescription>
                  <p>{state.errorMessage ?? 'Error desconocido'}</p>
                  <Button variant="outline" size="sm" onClick={handleReset} className="mt-3">
                    Intentar de nuevo
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto border-t border-border/50 bg-background pb-2 pt-3">
        <AgentChatComposer
          mode={composerMode}
          value={composerText}
          placeholder={composerPlaceholder(state.step)}
          maxLength={120}
          onChange={setComposerText}
          onSubmit={handleSubmitCompany}
        />
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────────

function CandidateMeta({ candidate }: { candidate: CompanyCandidate }) {
  return (
    <>
      {candidate.domain && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Globe className="h-3 w-3" aria-hidden />
          {candidate.domain}
        </span>
      )}
      {candidate.country && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" aria-hidden />
          {candidate.country}
        </span>
      )}
      {candidate.hubspotCompanyId && (
        <span className="font-mono text-xs text-muted-foreground">
          HS: {candidate.hubspotCompanyId}
        </span>
      )}
    </>
  );
}

function SecondaryReset({ onReset, label }: { onReset: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
      {label}
    </Button>
  );
}

// ── Automatic enrichment info (AGENT2-ROUTING-WIRE-1) ─────────────────────────
//
// Replaces the former ProviderSelector. The user no longer chooses a provider:
// this is a neutral notice describing that routing (primary + optional fallback)
// happens automatically. Deliberately names no provider as a user decision.

function AutomaticEnrichmentInfoCard() {
  return (
    <SurfaceCard className="space-y-2 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-foreground">Búsqueda automática de contactos</p>
      </div>
      <p className="text-xs text-muted-foreground">
        SellUp buscará contactos automáticamente usando el proveedor configurado.
      </p>
      <p className="text-xs text-muted-foreground">
        Si el proveedor principal no encuentra resultados suficientes, SellUp podrá intentar un
        proveedor alternativo según configuración.
      </p>
      <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
        Los candidatos quedan en revisión humana; no se crean contactos finales ni se escribe en
        HubSpot sin tu aprobación. El teléfono personal queda fuera de alcance.
      </p>
    </SurfaceCard>
  );
}

function ExtraDataCard({
  onConfirm,
  onReset,
}: {
  onConfirm: (domain: string, country: string) => void;
  onReset: () => void;
}) {
  const [domain, setDomain] = React.useState('');
  const [country, setCountry] = React.useState('');
  const hasEnough = domain.trim().length > 0 || country.trim().length > 0;

  return (
    <SurfaceCard className="space-y-4 p-5">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="extra-data-domain" className="text-muted-foreground">
            <Globe className="h-3 w-3" aria-hidden />
            Dominio de la empresa
          </Label>
          <Input
            id="extra-data-domain"
            placeholder="ejemplo.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="extra-data-country" className="text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden />
            País
          </Label>
          <Input
            id="extra-data-country"
            placeholder="Colombia"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Puedes completar solo uno de los dos campos.</p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
          Buscar otra empresa
        </Button>
        <Button
          disabled={!hasEnough}
          onClick={() => onConfirm(domain.trim(), country.trim())}
          className="flex-1"
        >
          <PenLine className="mr-2 h-4 w-4" aria-hidden />
          Continuar con empresa manual
        </Button>
      </div>
    </SurfaceCard>
  );
}
