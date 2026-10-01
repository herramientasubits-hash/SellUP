// Agente 2A — Read-only Contact Enrichment Run Viewer (Hito 17B.4X.7C.3E.2)
//
// Pure presentation for a single historical contact_enrichment_runs row.
// No provider selector, no "Enriquecer" / approve / discard controls, no
// server action wired to a click — every value here comes from props
// resolved server-side by the /contact-enrichment/runs/[runId] route.
// Phone numbers are never rendered (see the hito's "no revelar teléfonos"
// constraint) even when a candidate row carries one.

import { Building2, Calendar, Globe, Info, MapPin, Users, XCircle } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getLushaEmptyStateCopy } from './contact-enrichment-empty-state-copy';
import { classifyLushaRunViewerBranch } from '@/modules/contact-enrichment/run-viewer-branch-classifier';
import type {
  ContactEnrichmentRunCandidate,
  ContactEnrichmentRunDetail,
  ContactEnrichmentRunProviderUsage,
} from '@/modules/contact-enrichment/run-viewer-types';

type StatusVariant = 'neutral' | 'brand' | 'positive' | 'negative' | 'warning';

const RUN_STATUS_BADGE: Record<ContactEnrichmentRunDetail['status'], { label: string; variant: StatusVariant }> = {
  pending: { label: 'Pendiente', variant: 'neutral' },
  resolving: { label: 'Resolviendo', variant: 'neutral' },
  ready_to_enrich: { label: 'Listo para enriquecer', variant: 'brand' },
  enriching: { label: 'Enriqueciendo', variant: 'brand' },
  ready_for_review: { label: 'Listo para revisión', variant: 'positive' },
  completed: { label: 'Completado', variant: 'positive' },
  failed: { label: 'Fallido', variant: 'negative' },
  superseded: { label: 'Reemplazado', variant: 'neutral' },
};

const CANDIDATE_STATUS_BADGE: Record<ContactEnrichmentRunCandidate['status'], { label: string; variant: StatusVariant }> = {
  pending_review: { label: 'Por revisar', variant: 'warning' },
  approved: { label: 'Aprobado', variant: 'positive' },
  discarded: { label: 'Descartado', variant: 'neutral' },
  duplicate: { label: 'Duplicado', variant: 'neutral' },
};

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Run header ────────────────────────────────────────────────────────────

function RunHeaderCard({ run }: { run: ContactEnrichmentRunDetail }) {
  const statusBadge = RUN_STATUS_BADGE[run.status] ?? RUN_STATUS_BADGE.pending;

  return (
    <SurfaceCard className="space-y-4">
      <SurfaceCardHeader
        title="Contexto del run"
        actions={
          <Badge variant={statusBadge.variant}>
            {statusBadge.label}
          </Badge>
        }
      />
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Empresa</dt>
          <dd className="min-w-0 truncate font-medium text-foreground">{run.companyName || '—'}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Dominio</dt>
          <dd className="min-w-0 truncate text-foreground">{run.companyDomain ?? 'Sin dominio'}</dd>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">País</dt>
          <dd className="text-foreground">{run.companyCountryCode ?? '—'}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Ejecutado</dt>
          <dd className="tabular-nums text-foreground">{formatDateTime(run.createdAt)}</dd>
        </div>
      </dl>

      <dl className="grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs sm:grid-cols-4">
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Proveedor previsto</dt>
          <dd className="font-medium text-foreground">{run.intendedProvider ?? '—'}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Intento</dt>
          <dd className="font-medium tabular-nums text-foreground">{run.attemptOrder ?? '—'}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Costo estimado</dt>
          <dd className="font-medium tabular-nums text-foreground">US$ {run.estimatedCostUsd.toFixed(4)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Costo real</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {run.realCostUsd != null ? `US$ ${run.realCostUsd.toFixed(4)}` : 'No disponible'}
          </dd>
        </div>
      </dl>

      <p className="break-all border-t border-border/50 pt-3 font-mono text-xs text-muted-foreground">
        run_id: {run.id}
      </p>
    </SurfaceCard>
  );
}

// ── Lusha outcome (Hito 17B.4X.7C.3D message, reused as-is) ───────────────

function LushaOutcomeCard({
  run,
  lushaUsageRows,
  candidatesCount,
}: {
  run: ContactEnrichmentRunDetail;
  lushaUsageRows: ContactEnrichmentRunProviderUsage[];
  candidatesCount: number;
}) {
  const branch = classifyLushaRunViewerBranch({ run, lushaUsageRows, candidatesCount });
  const latestUsage = lushaUsageRows.at(-1) ?? null;

  if (branch === 'not_lusha') return null;

  if (branch === 'credentials_missing') {
    return (
      <SurfaceCard className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning/15">
            <XCircle className="h-4 w-4 text-warning" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-foreground">Lusha no está disponible o no tiene credenciales configuradas</p>
        </div>
        <p className="text-xs text-muted-foreground">No se ejecutó el proveedor y no se crearon candidatos.</p>
      </SurfaceCard>
    );
  }

  if (branch === 'company_context_error') {
    return (
      <SurfaceCard className="space-y-2">
        <p className="text-sm font-semibold text-foreground">Sin contexto de empresa suficiente</p>
        <p className="text-xs text-muted-foreground">
          No se pudo resolver suficiente contexto de la empresa para ejecutar Lusha. No se crearon candidatos.
        </p>
      </SurfaceCard>
    );
  }

  if (branch === 'provider_error') {
    return (
      <SurfaceCard className="space-y-2">
        <p className="text-sm font-semibold text-destructive">Error del proveedor</p>
        <p className="text-xs text-muted-foreground">
          {latestUsage?.errorMessage ??
            'No fue posible completar la búsqueda con Lusha. El proveedor devolvió un error durante la búsqueda.'}
        </p>
      </SurfaceCard>
    );
  }

  if (branch === 'empty_after_filtering') {
    const copy = getLushaEmptyStateCopy({
      rawResultsCount: latestUsage?.rawResultsCount ?? 0,
      creditsUsed: latestUsage?.creditsUsed ?? null,
    });

    return (
      <SurfaceCard className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted">
            <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">{copy.headline}</p>
            <p className="text-xs text-muted-foreground">{copy.detail}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-surface-subtle px-3 py-2">
          <p className="text-xs text-muted-foreground">{copy.notAnError}</p>
        </div>

        <dl className="space-y-1.5 border-t border-border/50 pt-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Resultados brutos</dt>
            <dd className="font-medium tabular-nums text-foreground">{latestUsage?.rawResultsCount ?? 0}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Créditos usados</dt>
            <dd className="font-medium tabular-nums text-foreground">{latestUsage?.creditsUsed ?? 0}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Reveal de teléfono</dt>
            <dd className="font-medium text-foreground">
              {latestUsage?.phoneRevealEnabled ? 'ejecutado' : 'no ejecutado'}
            </dd>
          </div>
        </dl>
      </SurfaceCard>
    );
  }

  if (branch === 'has_candidates') {
    return (
      <SurfaceCard className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Candidatos listos para revisión</p>
        <p className="text-xs text-muted-foreground">
          Lusha encontró candidato(s) con email corporativo. No se crearon contactos finales: requieren aprobación humana.
        </p>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard className="space-y-1">
      <p className="text-sm font-semibold text-foreground">Intento no ejecutado todavía</p>
      <p className="text-xs text-muted-foreground">Este intento no llegó a ejecutar Lusha.</p>
    </SurfaceCard>
  );
}

// ── Candidates (read-only — no approve/discard, no phone values) ─────────

function CandidatesList({ candidates }: { candidates: ContactEnrichmentRunCandidate[] }) {
  return (
    <SurfaceCard className="space-y-3" noPadding>
      <div className="p-5 pb-0">
        <SurfaceCardHeader title={`Candidatos (${candidates.length})`} />
      </div>
      {candidates.length === 0 ? (
        <EmptyState variant="plain" icon={Users} title="Este run no tiene candidatos asociados." />
      ) : (
        <div className="divide-y divide-border/50 overflow-x-auto">
          {candidates.map((candidate) => {
            const statusBadge = CANDIDATE_STATUS_BADGE[candidate.status] ?? CANDIDATE_STATUS_BADGE.pending_review;
            return (
              <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium text-foreground">{candidate.full_name || 'Sin nombre'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {candidate.title ?? 'Sin cargo'} · {candidate.email ?? 'Sin email'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="neutral">
                    {candidate.source}
                  </Badge>
                  <Badge variant={statusBadge.variant}>
                    {statusBadge.label}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SurfaceCard>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────

export function ContactEnrichmentRunViewer({
  run,
  candidates,
  providerUsage,
}: {
  run: ContactEnrichmentRunDetail;
  candidates: ContactEnrichmentRunCandidate[];
  providerUsage: ContactEnrichmentRunProviderUsage[];
}) {
  const lushaUsageRows = providerUsage.filter((usage) => usage.providerKey === 'lusha');

  return (
    <div className="flex flex-col gap-6">
      <RunHeaderCard run={run} />
      <LushaOutcomeCard run={run} lushaUsageRows={lushaUsageRows} candidatesCount={candidates.length} />
      <CandidatesList candidates={candidates} />
    </div>
  );
}
