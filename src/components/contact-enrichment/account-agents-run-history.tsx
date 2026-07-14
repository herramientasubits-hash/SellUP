'use client';

// Agente 2A — Account Agents Tab: Contact Enrichment Run History (Hito 17B.4X.7C.3E.3)
// Inline expandable detail (Hito 17B.4X.7C.3E.4)
//
// Read-only history of contact_enrichment_runs for a single account, shown
// on the account's "Agentes" tab. No provider selector, no approve/discard
// controls, no HubSpot sync trigger, no "Enriquecer" button — every value
// here comes from props resolved server-side or from the read-only
// getContactEnrichmentRunProviderUsage SELECT (see run-viewer-actions.ts).
// Candidate phone numbers are never rendered here (this view only shows
// counts). "Ver detalle" expands additional read-only context inline
// instead of navigating — the /contact-enrichment/runs/[runId] route still
// exists for direct access/debugging, it is just no longer the primary
// action from this tab.

import * as React from 'react';
import { Bot, Calendar, ChevronDown, ChevronUp, Info, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getContactEnrichmentRunProviderUsage } from '@/modules/contact-enrichment/run-viewer-actions';
import type { ContactEnrichmentRunProviderUsage } from '@/modules/contact-enrichment/run-viewer-types';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import { resolveAccountRunInlineDetailContent } from './account-run-inline-detail-content';

export const ACCOUNT_RUN_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pendiente', className: 'text-muted-foreground border-border bg-muted/30' },
  resolving: { label: 'Resolviendo', className: 'text-muted-foreground border-border bg-muted/30' },
  ready_to_enrich: { label: 'Listo para enriquecer', className: 'text-su-brand border-su-brand/30 bg-su-brand-soft' },
  enriching: { label: 'Enriqueciendo', className: 'text-su-brand border-su-brand/30 bg-su-brand-soft' },
  ready_for_review: { label: 'Listo para revisión', className: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' },
  completed: { label: 'Completado', className: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/10' },
  failed: { label: 'Fallido', className: 'text-destructive border-destructive/30 bg-destructive/10' },
  superseded: { label: 'Reemplazado', className: 'text-muted-foreground border-border bg-muted/30' },
};

export const ACCOUNT_RUN_PROVIDER_LABELS: Record<string, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
};

/** Pure — exported for unit tests (see account-agents-run-history.test.ts). */
export function formatContactEnrichmentRunDateTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Pure — prefers providersUsed[0] (what actually ran) over intendedProvider
 *  (what was planned), falling back to a neutral label when neither is set. */
export function resolveAccountRunProviderLabel(run: AccountContactEnrichmentRun): string {
  const used = run.providersUsed[0] ?? run.intendedProvider ?? null;
  if (!used) return 'Sin proveedor';
  return ACCOUNT_RUN_PROVIDER_LABELS[used] ?? used;
}

/** Pure — falls back to the 'pending' badge for an unrecognized status
 *  rather than rendering nothing. */
export function resolveAccountRunStatusBadge(status: string): { label: string; className: string } {
  return ACCOUNT_RUN_STATUS_BADGE[status] ?? ACCOUNT_RUN_STATUS_BADGE.pending;
}

/** Pure — kept as the single source of truth for the read-only run viewer
 *  route path. Not rendered as a navigation control from this tab anymore
 *  (see Hito 17B.4X.7C.3E.4) — the route stays available for direct
 *  access/debugging outside the Agentes tab. */
export function buildContactEnrichmentRunDetailHref(runId: string): string {
  return `/contact-enrichment/runs/${runId}`;
}

/** Fetches provider_usage_logs for this run's agent_run_id on first expand
 *  only (cached in state after), then renders the inline detail content
 *  resolved by resolveAccountRunInlineDetailContent. Read-only — no
 *  provider call, no mutation, no HubSpot sync, no phone numbers. */
function AccountRunInlineDetail({ run }: { run: AccountContactEnrichmentRun }) {
  const [providerUsage, setProviderUsage] = React.useState<ContactEnrichmentRunProviderUsage[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    if (!run.agentRunId) {
      setProviderUsage([]);
      return;
    }

    getContactEnrichmentRunProviderUsage(run.agentRunId)
      .then((rows) => {
        if (!cancelled) setProviderUsage(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [run.agentRunId]);

  if (loadFailed) {
    return (
      <p className="border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
        No se pudo cargar el detalle adicional de este run.
      </p>
    );
  }

  if (providerUsage === null) {
    return (
      <p className="border-t border-border/50 pt-3 text-[11px] text-muted-foreground">Cargando detalle…</p>
    );
  }

  const lushaUsageRows = providerUsage.filter((usage) => usage.providerKey === 'lusha');
  const content = resolveAccountRunInlineDetailContent({
    run: { intendedProvider: run.intendedProvider, status: run.status, summaryError: run.summaryError },
    lushaUsageRows,
    candidatesCount: run.candidateCount,
  });

  const isNegative =
    content.kind === 'lusha_provider_error' ||
    content.kind === 'lusha_credentials_missing' ||
    content.kind === 'lusha_company_context_error' ||
    content.kind === 'generic_failed';

  return (
    <div className="space-y-3 border-t border-border/50 pt-3">
      <div className="flex items-start gap-2">
        <div
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            isNegative ? 'bg-destructive/10' : 'bg-muted'
          }`}
        >
          {isNegative ? (
            <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
          ) : (
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-foreground">{content.headline}</p>
          <p className="text-[11px] text-muted-foreground">{content.detail}</p>
        </div>
      </div>

      {content.kind === 'lusha_empty_after_filtering' && (
        <dl className="ml-8 space-y-1 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Resultados brutos</dt>
            <dd className="font-medium text-foreground">{content.rawResultsCount ?? 0}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Reveal de teléfono</dt>
            <dd className="font-medium text-foreground">
              {content.phoneRevealEnabled ? 'ejecutado' : 'no ejecutado'}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function RunCard({ run }: { run: AccountContactEnrichmentRun }) {
  const [expanded, setExpanded] = React.useState(false);
  const statusBadge = resolveAccountRunStatusBadge(run.status);

  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] border-border bg-muted/30 text-muted-foreground">
              {resolveAccountRunProviderLabel(run)}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${statusBadge.className}`}>
              {statusBadge.label}
            </Badge>
            {run.attemptOrder != null && (
              <span className="text-[11px] text-muted-foreground">Intento {run.attemptOrder}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" aria-hidden />
            {formatContactEnrichmentRunDateTime(run.createdAt)}
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            <div className="flex gap-1">
              <dt>Candidatos:</dt>
              <dd className="font-medium text-foreground">{run.candidateCount}</dd>
            </div>
            {run.totalCreditsUsed != null && (
              <div className="flex gap-1">
                <dt>Créditos:</dt>
                <dd className="font-medium text-foreground">{run.totalCreditsUsed}</dd>
              </div>
            )}
            <div className="flex gap-1">
              <dt>Costo estimado:</dt>
              <dd className="font-medium text-foreground">US$ {run.estimatedCostUsd.toFixed(4)}</dd>
            </div>
            {run.realCostUsd != null && (
              <div className="flex gap-1">
                <dt>Costo real:</dt>
                <dd className="font-medium text-foreground">US$ {run.realCostUsd.toFixed(4)}</dd>
              </div>
            )}
          </dl>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="h-7 shrink-0 gap-1 px-2 text-xs font-medium text-su-brand hover:text-su-brand"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          {expanded ? 'Ocultar detalle' : 'Ver detalle'}
        </Button>
      </div>
      {expanded && <AccountRunInlineDetail run={run} />}
    </div>
  );
}

export function AccountAgentsRunHistory({ runs }: { runs: AccountContactEnrichmentRun[] }) {
  return (
    <SurfaceCard className="space-y-4">
      <SurfaceCardHeader
        title="Runs de enriquecimiento de contactos"
        description="Historial de búsquedas y enriquecimientos ejecutados para esta cuenta. Esta vista es de solo lectura."
      />
      {runs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Bot className="h-8 w-8 text-muted-foreground/30" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Todavía no hay runs de enriquecimiento para esta cuenta.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
