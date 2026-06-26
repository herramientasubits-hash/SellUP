'use client';

import * as React from 'react';
import { Building2, Check, Globe, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { SurfaceCard } from '@/components/shared/surface-card';
import type {
  CompanyCandidate,
  ContactEnrichmentRunResult,
} from '@/modules/contact-enrichment/types';
import type { ApolloEnrichmentUiResult } from './contact-enrichment-chat-types';

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

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <p className="text-xs font-medium text-foreground">Resultado de Apollo</p>
      <dl className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Candidatos creados</dt>
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
      </dl>
      <p className="text-xs text-muted-foreground">
        {result.candidatesCreated > 0
          ? 'Los candidatos quedaron pendientes de revisión. No se crearon contactos finales.'
          : 'No encontré contactos con los criterios actuales. Puedes intentar con otra empresa o revisar la configuración de Apollo.'}
      </p>
    </div>
  );
}
