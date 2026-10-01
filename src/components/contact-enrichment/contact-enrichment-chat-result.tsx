'use client';

import * as React from 'react';
import { AlertCircle, Building2, Check, Globe, Info, Lightbulb, MapPin, ShieldCheck, UserPlus, XCircle } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SurfaceCard } from '@/components/shared/surface-card';
import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '@/lib/apollo-guardrails';
import type {
  CompanyCandidate,
  ContactEnrichmentRunResult,
} from '@/modules/contact-enrichment/types';
import type {
  ApolloEnrichmentUiResult,
  ContactEnrichmentProvider,
  LushaEnrichmentUiResult,
} from './contact-enrichment-chat-types';
import {
  getContactEnrichmentEmptyStateCopy,
  getLushaEmptyStateCopy,
} from './contact-enrichment-empty-state-copy';

// ── Source badge ────────────────────────────────────────────────────────────

export function SourceBadge({ source }: { source: 'sellup' | 'hubspot' | 'manual' }) {
  if (source === 'manual') {
    return (
      <Badge variant="neutral">
        Manual
      </Badge>
    );
  }
  return (
    <Badge variant={source === 'sellup' ? 'brand' : 'warning'}>
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
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-subtle p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Building2 className="h-4 w-4 text-primary" aria-hidden />
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
  lushaResult,
  provider,
  onCreateManualContact,
}: {
  runResult: ContactEnrichmentRunResult;
  candidate: CompanyCandidate | null;
  apolloResult?: ApolloEnrichmentUiResult | null;
  lushaResult?: LushaEnrichmentUiResult | null;
  provider?: ContactEnrichmentProvider;
  onCreateManualContact?: () => void;
}) {
  const accountId = candidate?.sellupAccountId ?? null;
  const snapshot = runResult.existingContactsSnapshot;
  const combined = snapshot?.combined;
  const sellup = snapshot?.sellup;
  const hubspot = snapshot?.hubspot;

  const lushaCredentialsMissing =
    provider === 'lusha' &&
    (lushaResult?.status === 'missing_api_key' || lushaResult?.status === 'disabled');

  const lushaCompanyContextError =
    provider === 'lusha' &&
    (lushaResult?.status === 'invalid_account' || lushaResult?.status === 'not_found');

  const lushaProviderError = provider === 'lusha' && lushaResult?.status === 'provider_error';

  const lushaTerminalError = lushaCredentialsMissing || lushaCompanyContextError || lushaProviderError;

  return (
    <SurfaceCard className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        {lushaTerminalError ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-warning/15">
            <XCircle className="h-4 w-4 text-warning" aria-hidden />
          </div>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-success/10">
            <Check className="h-4 w-4 text-success" aria-hidden />
          </div>
        )}
        <p className="text-sm font-semibold text-foreground">
          {lushaTerminalError ? 'Run no ejecutado' : 'Run creado'}
        </p>
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Estado</dt>
          <dd>
            {provider === 'lusha' && lushaResult?.status === 'missing_api_key' ? (
              <Badge variant="warning">
                Sin credenciales
              </Badge>
            ) : provider === 'lusha' && lushaResult?.status === 'disabled' ? (
              <Badge variant="neutral">
                Desactivado
              </Badge>
            ) : provider === 'lusha' && lushaCompanyContextError ? (
              <Badge variant="warning">
                Sin contexto de empresa
              </Badge>
            ) : provider === 'lusha' && lushaResult?.status === 'provider_error' ? (
              <Badge variant="negative">
                Error del proveedor
              </Badge>
            ) : (
              <Badge variant="positive">
                {apolloResult?.status === 'ready_for_review' || lushaResult?.status === 'ready_for_review' || lushaResult?.providerStatus === 'success'
                  ? 'Listo para revisión'
                  : apolloResult?.status === 'completed' || lushaResult?.status === 'completed'
                    ? 'Completado'
                    : 'Listo para enriquecer'}
              </Badge>
            )}
          </dd>
        </div>
        {candidate && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Empresa</dt>
            <dd className="text-right font-medium tabular-nums text-foreground">{candidate.name}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Candidatos</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">
            {lushaResult
              ? lushaResult.candidatesCreated
              : apolloResult
                ? apolloResult.totalCandidates
                : runResult.candidatesCount}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Run ID</dt>
          <dd className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
            {runResult.runId}
          </dd>
        </div>
      </dl>

      {snapshot && (
        <div className="space-y-3 border-t border-border/50 pt-3">
          <p className="text-xs font-medium text-foreground">Contactos existentes detectados</p>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">SellUp</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
                {sellup?.status === 'skipped' ? (
                  <span className="text-muted-foreground">omitido — {sellup.reason}</span>
                ) : sellup?.status === 'error' ? (
                  <span className="text-destructive">error al leer</span>
                ) : (
                  (sellup?.count ?? 0)
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">HubSpot</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
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
            <div className="flex justify-between gap-3 border-t border-border/50 pt-1.5">
              <dt className="text-muted-foreground">Total para deduplicación</dt>
              <dd className="text-right font-semibold tabular-nums text-foreground">
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
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Sin email</dt>
                      <dd className="text-right tabular-nums text-warning">{combined.incompleteContacts.missingEmail}</dd>
                    </div>
                  )}
                  {combined.incompleteContacts.missingPhone > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Sin teléfono</dt>
                      <dd className="text-right tabular-nums text-warning">{combined.incompleteContacts.missingPhone}</dd>
                    </div>
                  )}
                  {combined.incompleteContacts.missingLinkedin > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Sin LinkedIn</dt>
                      <dd className="text-right tabular-nums text-warning">
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
        <ApolloResultSummary
          result={apolloResult}
          runId={runResult.runId}
          accountId={accountId}
          companyName={candidate?.name ?? null}
          companyDomain={candidate?.domain ?? null}
          onCreateManualContact={onCreateManualContact}
        />
      ) : lushaCredentialsMissing ? (
        <p className="border-t border-border/50 pt-3 text-xs text-warning">
          {lushaResult?.status === 'missing_api_key'
            ? 'Lusha no pudo acceder a la credencial configurada en Supabase Vault desde este runtime. No se ejecutó el proveedor y no se crearon candidatos.'
            : 'Lusha está desactivado en este entorno. No se ejecutó el proveedor y no se crearon candidatos.'}
        </p>
      ) : lushaCompanyContextError ? (
        <p className="border-t border-border/50 pt-3 text-xs text-warning">
          No se pudo resolver suficiente contexto de la empresa para ejecutar Lusha. No se crearon candidatos.
        </p>
      ) : lushaProviderError ? (
        <p className="border-t border-border/50 pt-3 text-xs text-destructive">
          {lushaResult?.error ??
            'No fue posible completar la búsqueda con Lusha. El proveedor devolvió un error durante la búsqueda. Intenta nuevamente más tarde o revisa el estado de la integración.'}
        </p>
      ) : lushaResult && lushaResult.candidatesCreated === 0 ? (
        <LushaEmptyState result={lushaResult} />
      ) : lushaResult ? (
        <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
          Los candidatos quedaron pendientes de revisión. No se crearon contactos finales.
        </p>
      ) : (
        <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {provider === 'lusha'
            ? 'Lusha buscará o enriquecerá perfiles para crear candidatos revisables con email corporativo cuando esté disponible. Teléfono deshabilitado en esta fase. No se crean contactos finales ni se escribe en HubSpot.'
            : 'Apollo buscará perfiles de RR. HH. para crear candidatos revisables. No se crean contactos finales ni se escribe en HubSpot.'}
        </p>
      )}
    </SurfaceCard>
  );
}

// ── Lusha empty-after-filtering state (Hito 17B.4X.7C.3D) ───────────────────
//
// Lusha executed correctly and consumed credits, but every raw profile was
// filtered out by relevance/company-consistency checks. This is a business
// outcome, not a provider error — must never be confused with
// missing_api_key/disabled/provider_error (those render above, before this
// branch is reached).

function LushaEmptyState({ result }: { result: LushaEnrichmentUiResult }) {
  const copy = getLushaEmptyStateCopy({
    rawResultsCount: result.rawResultsCount,
    creditsUsed: result.creditsUsed,
  });

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-surface-subtle p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{copy.headline}</p>
          <p className="text-xs text-muted-foreground">{copy.detail}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 bg-card px-3 py-2">
        <p className="text-xs text-muted-foreground">{copy.notAnError}</p>
      </div>

      <dl className="space-y-1.5 border-t border-border/50 pt-3 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Resultados brutos</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{result.rawResultsCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Créditos usados</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{result.creditsUsed ?? 0}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Reveal de teléfono</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">no ejecutado</dd>
        </div>
      </dl>
    </div>
  );
}

// ── Apollo pre-flight card (Hito 17A.6B) ─────────────────────────────────────

export function ApolloPreflightCard({ provider }: { provider?: ContactEnrichmentProvider }) {
  const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
  const isLusha = provider === 'lusha';
  return (
    <SurfaceCard className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-foreground">
          {isLusha ? 'Control de enriquecimiento Lusha' : 'Control de créditos Apollo'}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {isLusha
          ? 'SellUp buscará o enriquecerá perfiles con Lusha. Solo se busca email corporativo; teléfono deshabilitado en esta fase.'
          : 'SellUp buscará contactos con email, teléfono o LinkedIn. Solo intentará completar los perfiles con mayor probabilidad de ser útiles. Para controlar costos, no realizará reveal automático de teléfonos sin confirmación.'}
      </p>
      {isLusha ? (
        <>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground font-medium">Búsqueda / enriquecimiento Lusha</dt>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Máximo de intentos</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">3</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Máximo de resultados a evaluar</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">15</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Email corporativo</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">habilitado si está disponible</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">deshabilitado en esta fase</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Reveal automático de teléfono</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">no disponible</dd>
            </div>
          </dl>
          <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
            Lusha puede consumir créditos según disponibilidad del proveedor. SellUp limita
            resultados e intentos para evitar corridas amplias. Los candidatos quedan en revisión
            humana; no se crean contactos finales ni se escribe en HubSpot.
          </p>
        </>
      ) : (
        <>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground font-medium">Búsqueda Apollo</dt>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Máximo de intentos</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">{g.maxSearchAttempts}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Máximo de resultados a evaluar</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">{g.maxSearchResultsPerRun}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Créditos máximos de búsqueda</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
                {g.maxEstimatedSearchCreditsPerRun === 0
                  ? 'sin costo'
                  : `${g.maxEstimatedSearchCreditsPerRun} créditos`}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border/50 pt-1.5 mt-1">
              <dt className="text-muted-foreground font-medium">Completion de perfiles</dt>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Máximo de perfiles a completar</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">{g.maxCompletionCandidates}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Créditos máximos estimados de completion</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">{g.maxCompletionCreditsPerRun}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Teléfono (de búsqueda)</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">se conserva si Apollo lo entrega</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Reveal automático de teléfono</dt>
              <dd className="text-muted-foreground">
                ~{g.phoneRevealCredits} créditos —{' '}
                {g.automaticPhoneRevealEnabled ? 'activado' : 'requiere confirmación'}
              </dd>
            </div>
          </dl>
          <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
            La búsqueda puede consumir créditos según el plan. SellUp limita resultados e intentos
            para evitar corridas amplias. Solo se completarán perfiles de alta relevancia (RR. HH.,
            Talento, Aprendizaje, Cultura).
            <br />
            <span className="mt-1 inline-block">
              Nota: para sincronizar con HubSpot, el contacto aprobado deberá tener email.
            </span>
          </p>
        </>
      )}
    </SurfaceCard>
  );
}

// ── Apollo empty state (Hito 17A.7A + 17A.7C) ───────────────────────────────

interface ApolloEmptyStateProps {
  result: ApolloEnrichmentUiResult;
  runId?: string | null;
  accountId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  onCreateManualContact?: () => void;
}

function ApolloEmptyState({ result, runId, accountId, onCreateManualContact }: ApolloEmptyStateProps) {
  const copy = getContactEnrichmentEmptyStateCopy({
    rawResultsCount: result.rawResultsCount,
    rejectedByRelevance: result.rejectedByRelevance,
    candidatesCreated: result.candidatesCreated,
    noActionableContactsFound: result.noActionableContactsFound,
    noReviewableContactsFound: result.noReviewableContactsFound,
    searchGuardrail: result.searchGuardrail,
    completionAttempted: result.completionAttempted,
    actualCreditsTotal: result.costGuardrail?.actual_credits_total,
  });

  const canCreateManual = !!(runId && accountId && onCreateManualContact);

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-surface-subtle p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning/15">
          <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
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
          <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden />
          <p className="text-xs font-medium text-foreground">Qué puedes hacer</p>
        </div>
        <ul className="space-y-1.5">
          {copy.tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </div>

      {canCreateManual && (
        <div className="border-t border-border/50 pt-3">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2"
            onClick={onCreateManualContact}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Crear contacto manualmente
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Apollo result summary (Hito 17A.3A) ───────────────────────────────────────

interface ApolloResultSummaryProps {
  result: ApolloEnrichmentUiResult;
  runId?: string | null;
  accountId?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
  onCreateManualContact?: () => void;
}

function ApolloResultSummary({ result, runId, accountId, companyName, companyDomain, onCreateManualContact }: ApolloResultSummaryProps) {
  if (result.providerStatus === 'error' || result.providerStatus === 'skipped') {
    return (
      <div className="border-t border-border/50 pt-3">
        <p className="text-xs text-warning">
          {result.error ?? 'Apollo no pudo ejecutarse. No se crearon candidatos.'}
        </p>
      </div>
    );
  }

  const hasNoReviewableCandidates = result.candidatesCreated === 0;

  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      <p className="text-xs font-medium text-foreground">Resultado de Apollo</p>
      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Perfiles encontrados</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{result.rawResultsCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Filtrados por relevancia/calidad</dt>
          <dd className={result.rejectedByRelevance > 0 ? 'text-warning' : 'text-foreground'}>
            {result.rejectedByRelevance}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Intentos de completar datos</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{result.completionAttempted}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Candidatos con datos accionables</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{result.actionableContactsCount}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Candidatos listos para revisión</dt>
          <dd className="text-right font-semibold tabular-nums text-foreground">{result.candidatesCreated}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Duplicados omitidos</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">{result.duplicatesSkipped}</dd>
        </div>
        {result.possibleDuplicates > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Posibles duplicados</dt>
            <dd className="text-right tabular-nums text-warning">{result.possibleDuplicates}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-border/50 pt-1.5">
          <dt className="text-muted-foreground">Estado final</dt>
          <dd className="text-right font-medium tabular-nums text-foreground">
            {result.status === 'ready_for_review' ? 'Listo para revisión' : 'Completado'}
          </dd>
        </div>
      </dl>

      {hasNoReviewableCandidates ? (
        <ApolloEmptyState
          result={result}
          runId={runId}
          accountId={accountId}
          companyName={companyName}
          companyDomain={companyDomain}
          onCreateManualContact={onCreateManualContact}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Los candidatos quedaron pendientes de revisión. No se crearon contactos finales.
        </p>
      )}

      {result.costGuardrail && (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <p className="text-xs font-medium text-muted-foreground">Créditos de completion</p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Email/básico</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
                {result.costGuardrail.actual_credits_email}
              </dd>
            </div>
            {result.costGuardrail.phone_completion_enabled && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Teléfono</dt>
                <dd className="text-right font-medium tabular-nums text-foreground">
                  {result.costGuardrail.actual_credits_phone}
                </dd>
              </div>
            )}
            {!result.costGuardrail.phone_completion_enabled && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Reveal automático de teléfono</dt>
                <dd className="text-muted-foreground">no ejecutado</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-border/50 pt-1">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-right font-semibold tabular-nums text-foreground">
                {result.costGuardrail.actual_credits_total === 0 && result.completionAttempted === 0
                  ? 'sin créditos de completion'
                  : `${result.costGuardrail.actual_credits_total} créditos`}
              </dd>
            </div>
          </dl>
          {result.costGuardrail.guardrail_blocked && (
            <p className="text-xs text-warning">
              Guardrail activado — algunos perfiles no se completaron para no superar el límite de{' '}
              {result.costGuardrail.max_credits_per_run} créditos.
            </p>
          )}
          {result.completionAttempted > 0 && result.actionableContactsCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Se intentó completar datos en {result.completionAttempted} perfil
              {result.completionAttempted !== 1 ? 'es' : ''}, pero Apollo no devolvió canales
              accionables.
            </p>
          )}
        </div>
      )}

      {result.searchGuardrail && (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <p className="text-xs font-medium text-muted-foreground">Búsqueda Apollo</p>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Resultados evaluados</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">{result.rawResultsCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Créditos de búsqueda</dt>
              <dd className="text-right font-medium tabular-nums text-foreground">
                {result.searchGuardrail.estimated_search_credits === 0
                  ? 'sin costo'
                  : `${result.searchGuardrail.estimated_search_credits} créditos`}
              </dd>
            </div>
            {result.searchGuardrail.stopped_early_reason && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Motivo de corte</dt>
                <dd className="text-muted-foreground">
                  {result.searchGuardrail.stopped_early_reason === 'target_reviewable_reached'
                    ? 'objetivo alcanzado'
                    : result.searchGuardrail.stopped_early_reason === 'search_budget_reached'
                      ? 'límite de resultados alcanzado'
                      : 'intentos agotados'}
                </dd>
              </div>
            )}
          </dl>
          {result.searchGuardrail.blocked_by_search_budget && (
            <p className="text-xs text-warning">
              Búsqueda detenida al alcanzar el límite de{' '}
              {result.searchGuardrail.max_results_per_run} resultados.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
