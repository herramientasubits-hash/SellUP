'use client';

import * as React from 'react';
import { AlertCircle, Building2, Check, Globe, Lightbulb, MapPin, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard } from '@/components/shared/surface-card';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import type {
  CompanyCandidate,
  ContactEnrichmentRunResult,
} from '@/modules/contact-enrichment/types';
import type { ApolloEnrichmentUiResult } from './contact-enrichment-chat-types';
import { getContactEnrichmentEmptyStateCopy } from './contact-enrichment-empty-state-copy';

// ── Source badge ────────────────────────────────────────────────────────────

export function SourceBadge({ source }: { source: 'sellup' | 'hubspot' | 'manual' }) {
  if (source === 'manual') {
    return (
      <Badge
        variant="outline"
        className="text-[10px] border-muted-foreground/30 text-muted-foreground bg-muted/40"
      >
        Manual
      </Badge>
    );
  }
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

function sourceLabel(source: 'sellup' | 'hubspot' | 'manual'): string {
  if (source === 'manual') return 'Manual';
  if (source === 'hubspot') return 'HubSpot';
  return 'SellUp';
}

// ── Company chip (reused in confirm + result) ─────────────────────────────────

export function CompanyChip({ candidate }: { candidate: CompanyCandidate }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-su-brand-soft">
        <Building2 className="h-4 w-4 text-su-brand" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{candidate.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
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
          <SourceBadge source={candidate.source} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Fuente: {sourceLabel(candidate.source)}</p>
      </div>
    </div>
  );
}

// ── Run result snapshot ───────────────────────────────────────────────────────

export function RunResultSnapshot({
  runResult,
  candidate,
  apolloResult,
}: {
  runResult: ContactEnrichmentRunResult;
  candidate: CompanyCandidate | null;
  apolloResult?: ApolloEnrichmentUiResult | null;
}) {
  const snapshot = runResult.existingContactsSnapshot;
  const combined = snapshot?.combined;
  const sellup = snapshot?.sellup;
  const hubspot = snapshot?.hubspot;

  return (
    <SurfaceCard className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
          <Check className="h-4 w-4 text-emerald-500" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-foreground">Run creado</p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Estado</dt>
          <dd>
            <Badge
              variant="outline"
              className="text-xs text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
            >
              {apolloResult?.status === 'ready_for_review'
                ? 'Listo para revisión'
                : apolloResult?.status === 'completed'
                  ? 'Completado'
                  : 'Listo para enriquecer'}
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
          <dd className="font-medium text-foreground">
            {apolloResult ? apolloResult.totalCandidates : runResult.candidatesCount}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Run ID</dt>
          <dd className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
            {runResult.runId}
          </dd>
        </div>
      </dl>

      {snapshot && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground">Contactos existentes detectados</p>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">SellUp</dt>
              <dd className="font-medium text-foreground">
                {sellup?.status === 'skipped' ? (
                  <span className="text-muted-foreground">omitido — {sellup.reason}</span>
                ) : sellup?.status === 'error' ? (
                  <span className="text-destructive">error al leer</span>
                ) : (
                  (sellup?.count ?? 0)
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">HubSpot</dt>
              <dd className="font-medium text-foreground">
                {hubspot?.status === 'skipped' ? (
                  <span className="text-muted-foreground">
                    omitido{hubspot.reason ? ` — ${hubspot.reason}` : ''}
                  </span>
                ) : hubspot?.status === 'error' ? (
                  <span className="text-destructive">error al leer</span>
                ) : (
                  (hubspot?.count ?? 0)
                )}
              </dd>
            </div>
            {/* Total para deduplicación — siempre visible, incluido 0 (Hito 17A.2B) */}
            <div className="flex justify-between border-t border-border/50 pt-1.5">
              <dt className="text-muted-foreground">Total para deduplicación</dt>
              <dd className="font-semibold text-foreground">
                {combined?.totalExistingContacts ?? 0}
              </dd>
            </div>
          </dl>

          {combined &&
            (combined.incompleteContacts.missingEmail > 0 ||
              combined.incompleteContacts.missingPhone > 0 ||
              combined.incompleteContacts.missingLinkedin > 0) && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Contactos incompletos</p>
                <dl className="space-y-1 text-xs">
                  {combined.incompleteContacts.missingEmail > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Sin email</dt>
                      <dd className="text-amber-600">{combined.incompleteContacts.missingEmail}</dd>
                    </div>
                  )}
                  {combined.incompleteContacts.missingPhone > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Sin teléfono</dt>
                      <dd className="text-amber-600">{combined.incompleteContacts.missingPhone}</dd>
                    </div>
                  )}
                  {combined.incompleteContacts.missingLinkedin > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Sin LinkedIn</dt>
                      <dd className="text-amber-600">
                        {combined.incompleteContacts.missingLinkedin}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}
        </div>
      )}

      {apolloResult ? (
        <ApolloResultSummary result={apolloResult} />
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Apollo buscará perfiles de RR. HH. para crear candidatos revisables. No se crean
          contactos finales ni se escribe en HubSpot.
        </p>
      )}
    </SurfaceCard>
  );
}

// ── Apollo pre-flight card (Hito 17A.6B) ─────────────────────────────────────

export function ApolloPreflightCard() {
  const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
  return (
    <SurfaceCard className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-su-brand-soft">
          <ShieldCheck className="h-3.5 w-3.5 text-su-brand" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-foreground">Control de créditos Apollo</p>
      </div>
      <p className="text-xs text-muted-foreground">
        SellUp buscará contactos con email, teléfono o LinkedIn. Solo intentará completar los
        perfiles con mayor probabilidad de ser útiles. Para controlar costos, no realizará reveal
        automático de teléfonos sin confirmación.
      </p>
      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground font-medium">Búsqueda Apollo</dt>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Máximo de intentos</dt>
          <dd className="font-medium text-foreground">{g.maxSearchAttempts}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Máximo de resultados a evaluar</dt>
          <dd className="font-medium text-foreground">{g.maxSearchResultsPerRun}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Créditos estimados máximos de búsqueda</dt>
          <dd className="font-medium text-foreground">{g.maxEstimatedSearchCreditsPerRun}</dd>
        </div>
        <div className="flex justify-between border-t border-border/30 pt-1.5 mt-1">
          <dt className="text-muted-foreground font-medium">Completion de perfiles</dt>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Máximo de perfiles a completar</dt>
          <dd className="font-medium text-foreground">{g.maxCompletionCandidates}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Créditos máximos estimados de completion</dt>
          <dd className="font-medium text-foreground">{g.maxCompletionCreditsPerRun}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Teléfono (de búsqueda)</dt>
          <dd className="font-medium text-foreground">se conserva si Apollo lo entrega</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Reveal automático de teléfono</dt>
          <dd className="text-muted-foreground">
            ~{g.phoneRevealCredits} créditos —{' '}
            {g.automaticPhoneRevealEnabled ? 'activado' : 'requiere confirmación'}
          </dd>
        </div>
      </dl>
      <p className="border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
        La búsqueda puede consumir créditos según el plan. SellUp limita resultados e intentos para
        evitar corridas amplias. Solo se completarán perfiles de alta relevancia (RR. HH., Talento,
        Aprendizaje, Cultura).
        <br />
        <span className="mt-1 inline-block">
          Nota: para sincronizar con HubSpot, el contacto aprobado deberá tener email.
        </span>
      </p>
    </SurfaceCard>
  );
}

// ── Apollo empty state (Hito 17A.7A) ─────────────────────────────────────────

function ApolloEmptyState({ result }: { result: ApolloEnrichmentUiResult }) {
  const copy = getContactEnrichmentEmptyStateCopy({
    rawResultsCount: result.rawResultsCount,
    rejectedByRelevance: result.rejectedByRelevance,
    candidatesCreated: result.candidatesCreated,
    noActionableContactsFound: result.noActionableContactsFound,
    noReviewableContactsFound: result.noReviewableContactsFound,
    searchGuardrail: result.searchGuardrail,
  });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{copy.headline}</p>
          <p className="text-xs text-muted-foreground">{copy.detail}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card px-3 py-2">
        <p className="text-xs text-muted-foreground">{copy.notAnError}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="h-3.5 w-3.5 text-su-brand" aria-hidden />
          <p className="text-xs font-medium text-foreground">Qué puedes hacer</p>
        </div>
        <ul className="space-y-1.5">
          {copy.tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Apollo result summary (Hito 17A.3A) ───────────────────────────────────────

function ApolloResultSummary({ result }: { result: ApolloEnrichmentUiResult }) {
  if (result.providerStatus === 'error' || result.providerStatus === 'skipped') {
    return (
      <div className="border-t border-border pt-3">
        <p className="text-xs text-amber-600">
          {result.error ?? 'Apollo no pudo ejecutarse. No se crearon candidatos.'}
        </p>
      </div>
    );
  }

  const hasNoReviewableCandidates = result.candidatesCreated === 0;

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs font-medium text-foreground">Resultado de Apollo</p>
      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Perfiles encontrados</dt>
          <dd className="font-medium text-foreground">{result.rawResultsCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Filtrados por relevancia/calidad</dt>
          <dd className={result.rejectedByRelevance > 0 ? 'text-amber-600' : 'text-foreground'}>
            {result.rejectedByRelevance}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Intentos de completar datos</dt>
          <dd className="font-medium text-foreground">{result.completionAttempted}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Candidatos con datos accionables</dt>
          <dd className="font-medium text-foreground">{result.actionableContactsCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Candidatos listos para revisión</dt>
          <dd className="font-semibold text-foreground">{result.candidatesCreated}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Duplicados omitidos</dt>
          <dd className="font-medium text-foreground">{result.duplicatesSkipped}</dd>
        </div>
        {result.possibleDuplicates > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Posibles duplicados</dt>
            <dd className="text-amber-600">{result.possibleDuplicates}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-border/50 pt-1.5">
          <dt className="text-muted-foreground">Estado final</dt>
          <dd className="font-medium text-foreground">
            {result.status === 'ready_for_review' ? 'Listo para revisión' : 'Completado'}
          </dd>
        </div>
      </dl>

      {hasNoReviewableCandidates ? (
        <ApolloEmptyState result={result} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Los candidatos quedaron pendientes de revisión. No se crearon contactos finales.
        </p>
      )}

      {result.costGuardrail && (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <p className="text-[11px] font-medium text-muted-foreground">Créditos de completion</p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium text-foreground">
                {result.costGuardrail.actual_credits_email}
              </dd>
            </div>
            {result.costGuardrail.phone_completion_enabled && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Teléfono</dt>
                <dd className="font-medium text-foreground">
                  {result.costGuardrail.actual_credits_phone}
                </dd>
              </div>
            )}
            {!result.costGuardrail.phone_completion_enabled && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reveal automático de teléfono</dt>
                <dd className="text-muted-foreground">no ejecutado</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border/50 pt-1">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="font-semibold text-foreground">
                {result.costGuardrail.actual_credits_total === 0
                  ? 'sin créditos de completion'
                  : `${result.costGuardrail.actual_credits_total} créditos`}
              </dd>
            </div>
          </dl>
          {result.costGuardrail.guardrail_blocked && (
            <p className="text-[11px] text-amber-600">
              Guardrail activado — algunos perfiles no se completaron para no superar el límite de{' '}
              {result.costGuardrail.max_credits_per_run} créditos.
            </p>
          )}
        </div>
      )}

      {result.searchGuardrail && (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <p className="text-[11px] font-medium text-muted-foreground">Búsqueda Apollo</p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Resultados evaluados</dt>
              <dd className="font-medium text-foreground">
                {result.searchGuardrail.estimated_search_credits}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Créditos estimados de búsqueda</dt>
              <dd className="font-medium text-foreground">
                {result.searchGuardrail.estimated_search_credits}
              </dd>
            </div>
            {result.searchGuardrail.stopped_early_reason && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Motivo de corte</dt>
                <dd className="text-muted-foreground">
                  {result.searchGuardrail.stopped_early_reason === 'target_reviewable_reached'
                    ? 'objetivo alcanzado'
                    : result.searchGuardrail.stopped_early_reason === 'search_budget_reached'
                      ? 'presupuesto agotado'
                      : 'intentos agotados'}
                </dd>
              </div>
            )}
          </dl>
          {result.searchGuardrail.blocked_by_search_budget && (
            <p className="text-[11px] text-amber-600">
              Búsqueda cortada por presupuesto — se superó el máximo de{' '}
              {result.searchGuardrail.max_results_per_run} resultados.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
