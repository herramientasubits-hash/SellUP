'use client';

import * as React from 'react';
import { Building2, Check, Globe, MapPin, PenLine, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AgentChatTimeline,
  AgentChatComposer,
  AgentChatOptionCard,
  useProgressiveReveal,
  type AgentChatComposerMode,
} from '@/components/agent-chat';
import {
  resolveContactEnrichmentCompanyAction,
  startContactEnrichmentRunAction,
  runContactEnrichmentApolloAction,
} from '@/modules/contact-enrichment/actions';
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
import { SourceBadge, CompanyChip, RunResultSnapshot } from './contact-enrichment-chat-result';

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
    case 'searching_apollo':
      return 'Buscando en Apollo…';
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
  if (step === 'searching_apollo') return 'Buscando perfiles relevantes en Apollo…';
  return 'escribiendo';
}

// ── Main wizard ─────────────────────────────────────────────────────────────────

interface ContactEnrichmentChatWizardProps {
  initialCompany?: ContactEnrichmentInitialCompany;
}

export function ContactEnrichmentChatWizard({
  initialCompany,
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
    state.step === 'searching_apollo';
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

    const result = await resolveContactEnrichmentCompanyAction(buildResolveInput(query));
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

    const result = await startContactEnrichmentRunAction({
      companyName: candidate.name,
      companyDomain: candidate.domain ?? undefined,
      hubspotCompanyId: candidate.hubspotCompanyId ?? undefined,
      sellupAccountId: candidate.sellupAccountId ?? undefined,
      confirmedCompany: candidate,
    });

    if (!result.success || !result.data) {
      dispatch({ type: 'RUN_FAILED', message: result.error ?? 'Error creando run' });
      return;
    }
    dispatch({ type: 'RUN_SUCCEEDED', result: result.data });
  }

  async function handleSearchApollo() {
    const runId = state.runResult?.runId;
    if (!runId || state.step !== 'done') return;
    dispatch({ type: 'APOLLO_START' });

    const result = await runContactEnrichmentApolloAction(runId);

    const uiResult = {
      status: result.status ?? 'error',
      candidatesCreated: result.candidatesCreated ?? 0,
      duplicatesSkipped: result.duplicatesSkipped ?? 0,
      possibleDuplicates: result.possibleDuplicates ?? 0,
      totalCandidates: result.totalCandidates ?? 0,
      rawResultsCount: result.rawResultsCount ?? 0,
      rejectedByRelevance: result.rejectedByRelevance ?? 0,
      noReviewableContactsFound: result.noReviewableContactsFound ?? false,
      completionAttempted: result.completionAttempted ?? 0,
      actionableContactsCount: result.actionableContactsCount ?? 0,
      noActionableContactsFound: result.noActionableContactsFound ?? false,
      providerStatus: result.providerStatus ?? 'error',
      estimatedCostUsd: result.estimatedCostUsd ?? 0,
      error: result.error,
    } as const;

    if (!result.success || result.providerStatus !== 'success') {
      dispatch({ type: 'APOLLO_FAILED', result: uiResult });
      return;
    }
    dispatch({ type: 'APOLLO_SUCCEEDED', result: uiResult });
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
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-su-brand-soft">
                        <Building2 className="h-4 w-4 text-su-brand" aria-hidden />
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

            {state.step === 'done' && state.runResult && (
              <div className="space-y-3">
                <RunResultSnapshot
                  runResult={state.runResult}
                  candidate={state.selectedCandidate}
                  apolloResult={state.apolloResult}
                />
                {!state.apolloResult && (
                  <Button onClick={handleSearchApollo} className="w-full">
                    <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                    Buscar contactos ahora
                  </Button>
                )}
                <SecondaryReset onReset={handleReset} label="Enriquecer otra empresa" />
              </div>
            )}

            {state.step === 'error' && (
              <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-destructive" aria-hidden />
                  <p className="text-sm font-medium text-destructive">No se pudo continuar</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {state.errorMessage ?? 'Error desconocido'}
                </p>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Intentar de nuevo
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto border-t border-border/30 bg-background pb-2 pt-3">
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
        <span className="font-mono text-[10px] text-muted-foreground">
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
    <div className="space-y-4 rounded-2xl border border-border/50 bg-card p-5">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="h-3 w-3" aria-hidden />
            Dominio de la empresa
          </label>
          <Input
            placeholder="ejemplo.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" aria-hidden />
            País
          </label>
          <Input
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
    </div>
  );
}
