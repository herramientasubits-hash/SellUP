'use client';

import * as React from 'react';
import { Building2, Search, Check, AlertCircle, Loader2, Globe, MapPin, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard } from '@/components/shared/surface-card';
import { resolveContactEnrichmentCompanyAction, startContactEnrichmentRunAction } from '@/modules/contact-enrichment/actions';
import type { CompanyCandidate } from '@/modules/contact-enrichment/types';
import type { WizardState } from './contact-enrichment-wizard-types';

// ── Estado inicial ────────────────────────────────────────────

function initialState(): WizardState {
  return {
    step: 'search',
    query: '',
    candidates: [],
    selectedCandidate: null,
    skippedHubSpot: false,
    runResult: null,
    errorMessage: null,
  };
}

// ── Componente principal ──────────────────────────────────────

export function ContactEnrichmentWizard() {
  const [state, setState] = React.useState<WizardState>(initialState);

  // Búsqueda de empresa
  const handleSearch = async () => {
    if (!state.query.trim()) return;

    setState((s) => ({ ...s, step: 'resolving', errorMessage: null }));

    // Detecta si es dominio, HubSpot ID numérico, o nombre
    const query = state.query.trim();
    const isDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(query) && !query.includes(' ');
    const isHubSpotId = /^\d{6,}$/.test(query);

    const input: Record<string, string> = {};
    if (isHubSpotId) {
      input.hubspotCompanyId = query;
    } else if (isDomain) {
      input.companyDomain = query;
    } else {
      input.companyName = query;
    }

    const result = await resolveContactEnrichmentCompanyAction(input);

    if (!result.success || !result.data) {
      setState((s) => ({
        ...s,
        step: 'error',
        errorMessage: result.error ?? 'Error buscando empresa',
      }));
      return;
    }

    const { candidates, singleMatch, selected, skippedHubSpot } = result.data;

    if (candidates.length === 0) {
      // Cero resultados — permitir confirmar la empresa manualmente
      const manualCandidate: CompanyCandidate = {
        source: 'sellup',
        name: query,
        domain: isDomain ? query : undefined,
        matchConfidence: 0.5,
      };
      setState((s) => ({
        ...s,
        step: 'confirm',
        candidates: [],
        selectedCandidate: manualCandidate,
        skippedHubSpot,
      }));
      return;
    }

    if (singleMatch && selected) {
      setState((s) => ({
        ...s,
        step: 'confirm',
        candidates: [selected],
        selectedCandidate: selected,
        skippedHubSpot,
      }));
    } else {
      setState((s) => ({
        ...s,
        step: 'candidates',
        candidates,
        selectedCandidate: null,
        skippedHubSpot,
      }));
    }
  };

  // Seleccionar candidato y avanzar a confirmación
  const handleSelectCandidate = (candidate: CompanyCandidate) => {
    setState((s) => ({
      ...s,
      step: 'confirm',
      selectedCandidate: candidate,
    }));
  };

  // Confirmar y crear run
  const handleConfirm = async () => {
    if (!state.selectedCandidate) return;

    setState((s) => ({ ...s, step: 'starting', errorMessage: null }));

    const input = {
      companyName: state.selectedCandidate.name,
      companyDomain: state.selectedCandidate.domain ?? undefined,
      hubspotCompanyId: state.selectedCandidate.hubspotCompanyId ?? undefined,
      sellupAccountId: state.selectedCandidate.sellupAccountId ?? undefined,
      confirmedCompany: state.selectedCandidate,
    };

    const result = await startContactEnrichmentRunAction(input);

    if (!result.success || !result.data) {
      setState((s) => ({
        ...s,
        step: 'error',
        errorMessage: result.error ?? 'Error creando run',
      }));
      return;
    }

    setState((s) => ({ ...s, step: 'done', runResult: result.data ?? null }));
  };

  // Reiniciar
  const handleReset = () => setState(initialState());

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      {/* Search step */}
      {state.step === 'search' && (
        <SearchStep
          query={state.query}
          onQueryChange={(q) => setState((s) => ({ ...s, query: q }))}
          onSearch={handleSearch}
        />
      )}

      {/* Resolving */}
      {state.step === 'resolving' && (
        <StatusCard icon={<Loader2 className="h-5 w-5 animate-spin text-su-brand" />} message="Buscando empresa..." />
      )}

      {/* Multiple candidates */}
      {state.step === 'candidates' && (
        <CandidatesStep
          candidates={state.candidates}
          skippedHubSpot={state.skippedHubSpot}
          onSelect={handleSelectCandidate}
          onReset={handleReset}
        />
      )}

      {/* Confirm */}
      {state.step === 'confirm' && state.selectedCandidate && (
        <ConfirmStep
          candidate={state.selectedCandidate}
          onConfirm={handleConfirm}
          onBack={() => setState((s) => ({
            ...s,
            step: s.candidates.length > 1 ? 'candidates' : 'search',
          }))}
        />
      )}

      {/* Starting run */}
      {state.step === 'starting' && (
        <StatusCard icon={<Loader2 className="h-5 w-5 animate-spin text-su-brand" />} message="Creando run de enriquecimiento..." />
      )}

      {/* Done */}
      {state.step === 'done' && state.runResult && (
        <DoneStep runResult={state.runResult} candidate={state.selectedCandidate} onReset={handleReset} />
      )}

      {/* Error */}
      {state.step === 'error' && (
        <ErrorStep message={state.errorMessage ?? 'Error desconocido'} onReset={handleReset} />
      )}
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────

function SearchStep({
  query,
  onQueryChange,
  onSearch,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSearch();
  };

  return (
    <SurfaceCard className="p-6 space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Escribe el nombre, dominio o HubSpot Company ID de la empresa.
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          className="flex-1"
          placeholder="Ej: Bancolombia, bancolombia.com o HubSpot ID"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <Button onClick={onSearch} disabled={!query.trim()}>
          <Search className="mr-2 h-4 w-4" />
          Buscar empresa
        </Button>
      </div>
    </SurfaceCard>
  );
}

function CandidatesStep({
  candidates,
  skippedHubSpot,
  onSelect,
  onReset,
}: {
  candidates: CompanyCandidate[];
  skippedHubSpot: boolean;
  onSelect: (c: CompanyCandidate) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Se encontraron {candidates.length} coincidencias. Selecciona la empresa correcta.
      </p>
      {skippedHubSpot && (
        <p className="text-xs text-amber-500">HubSpot no disponible — resultados solo desde SellUp.</p>
      )}
      {candidates.map((c, i) => (
        <CandidateCard key={i} candidate={c} onSelect={() => onSelect(c)} />
      ))}
      <Button variant="ghost" size="sm" onClick={onReset} className="text-muted-foreground">
        Buscar otra empresa
      </Button>
    </div>
  );
}

function CandidateCard({ candidate, onSelect }: { candidate: CompanyCandidate; onSelect: () => void }) {
  return (
    <SurfaceCard
      className="p-4 cursor-pointer hover:border-su-brand/40 transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-su-brand-soft">
            <Building2 className="h-4 w-4 text-su-brand" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{candidate.name}</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {candidate.domain && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  {candidate.domain}
                </span>
              )}
              {candidate.country && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {candidate.country}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SourceBadge source={candidate.source} />
          {candidate.hubspotCompanyId && (
            <span className="text-[10px] text-muted-foreground font-mono">HS: {candidate.hubspotCompanyId}</span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </SurfaceCard>
  );
}

function ConfirmStep({
  candidate,
  onConfirm,
  onBack,
}: {
  candidate: CompanyCandidate;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <SurfaceCard className="p-6 space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Empresa seleccionada</p>
        <p className="text-sm text-muted-foreground">
          ¿Confirmas que quieres preparar el enriquecimiento de contactos para esta empresa?
        </p>
      </div>
      <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-su-brand-soft shrink-0">
          <Building2 className="h-4 w-4 text-su-brand" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{candidate.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {candidate.domain && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                {candidate.domain}
              </span>
            )}
            <SourceBadge source={candidate.source} />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Cambiar empresa
        </Button>
        <Button onClick={onConfirm} className="flex-1">
          <Check className="mr-2 h-4 w-4" />
          Confirmar empresa
        </Button>
      </div>
    </SurfaceCard>
  );
}

function DoneStep({
  runResult,
  candidate,
  onReset,
}: {
  runResult: { runId: string; agentRunId: string; status: string; candidatesCount: number };
  candidate: CompanyCandidate | null;
  onReset: () => void;
}) {
  return (
    <SurfaceCard className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10">
          <Check className="h-4 w-4 text-emerald-500" />
        </div>
        <p className="text-sm font-semibold text-foreground">Run creado</p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Estado</dt>
          <dd>
            <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-500/30 bg-emerald-500/10">
              Listo para enriquecer
            </Badge>
          </dd>
        </div>
        {candidate && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Empresa</dt>
            <dd className="font-medium text-foreground">{candidate.name}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Candidatos</dt>
          <dd className="font-medium text-foreground">{runResult.candidatesCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Run ID</dt>
          <dd className="font-mono text-xs text-muted-foreground truncate max-w-[180px]">{runResult.runId}</dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground border-t border-border pt-3">
        En el siguiente hito conectaremos Apollo / Lusha para poblar los candidatos.
      </p>

      <Button variant="outline" size="sm" onClick={onReset}>
        Enriquecer otra empresa
      </Button>
    </SurfaceCard>
  );
}

function StatusCard({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3">
        {icon}
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </SurfaceCard>
  );
}

function ErrorStep({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <SurfaceCard className="p-6 space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm font-medium text-destructive">Error</p>
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onReset}>
        Intentar de nuevo
      </Button>
    </SurfaceCard>
  );
}

function SourceBadge({ source }: { source: 'sellup' | 'hubspot' }) {
  return (
    <Badge
      variant="outline"
      className={
        source === 'sellup'
          ? 'text-[10px] border-su-brand/30 text-su-brand bg-su-brand-soft'
          : 'text-[10px] border-amber-500/30 text-amber-600 bg-amber-500/10'
      }
    >
      {source === 'sellup' ? 'SellUp' : 'HubSpot'}
    </Badge>
  );
}
