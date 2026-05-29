import Link from 'next/link';
import { Database, XCircle, CheckCircle2, FlaskConical, Layers, Lock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import {
  BATCH_STATUS_LABELS,
  batchStatusBadgeClass,
  formatShortDate,
} from '@/modules/source-catalog/socrata-batches-labels';

export const metadata = {
  title: 'Lotes Socrata — Catálogo de fuentes',
};

export default async function SocrataBatchesPage() {
  const { batches, totalCount, readyForReview, cancelled, smokeTests } =
    await getSocrataPreviewBatches();

  const metricCards = [
    {
      label: 'Total lotes',
      value: totalCount,
      icon: Layers,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Listos para revisión',
      value: readyForReview,
      icon: CheckCircle2,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Cancelados',
      value: cancelled,
      icon: XCircle,
      color: 'text-muted-foreground',
      bg: 'bg-muted/60',
    },
    {
      label: 'Smoke tests',
      value: smokeTests,
      icon: FlaskConical,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10',
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Lotes Socrata"
        description="Vista de revisión interna para lotes creados desde fuentes estructuradas. No aprueba, no asigna y no sincroniza con HubSpot."
        backHref="/settings/source-catalog"
      />

      {/* Read-only warning */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border/40 bg-muted/40 px-5 py-3.5">
        <Lock className="h-4 w-4 shrink-0 text-muted-foreground/60" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">Solo lectura.</span>{' '}
          Esta pantalla no permite crear, editar, aprobar, descartar ni sincronizar candidatos.
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metricCards.map((card) => (
          <SurfaceCard key={card.label} className="py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {card.label}
                </p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
                  {card.value}
                </p>
              </div>
              <div className={`rounded-lg p-1.5 ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Batches table */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/40 px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground">
            {batches.length === 0
              ? 'Aún no hay lotes Socrata creados.'
              : `Lotes Socrata · ${batches.length} lote${batches.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Database className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aún no hay lotes Socrata creados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-left">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Nombre
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Dataset
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Candidatos
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Preview
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Smoke / Rollback
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    &nbsp;
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {batches.map((batch) => (
                  <tr
                    key={batch.id}
                    className="transition-colors hover:bg-muted/20"
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-foreground">{batch.name}</span>
                      {batch.countryCode && (
                        <span className="ml-2 text-[11px] text-muted-foreground/60">
                          {batch.countryCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${batchStatusBadgeClass(batch.status)}`}
                      >
                        {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        {batch.dataset ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-muted-foreground">
                      {batch.candidatesCount}
                      {batch.targetCount ? (
                        <span className="ml-1 text-[11px] text-muted-foreground/50">
                          / {batch.targetCount}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">
                      {batch.previewMode ? (
                        <Badge className="border-su-brand/30 bg-su-brand-soft text-su-brand border text-[10px]">
                          Preview
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {batch.smokeTest && (
                          <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 border text-[10px]">
                            Smoke test
                          </Badge>
                        )}
                        {batch.rollbackLogical && (
                          <Badge className="border-border/40 bg-muted/60 text-muted-foreground/60 border text-[10px]">
                            Rollback lógico
                          </Badge>
                        )}
                        {!batch.smokeTest && !batch.rollbackLogical && (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {formatShortDate(batch.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/settings/source-catalog/socrata-batches/${batch.id}`}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-su-brand hover:bg-su-brand-soft transition-colors"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
