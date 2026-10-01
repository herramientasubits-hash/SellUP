import Link from 'next/link';
import { Database, XCircle, CheckCircle2, FlaskConical, Layers, Lock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import {
  BATCH_STATUS_LABELS,
  batchStatusBadgeClass,
  formatDatasetLabel,
  formatShortDate,
} from '@/modules/source-catalog/socrata-batches-labels';
import { CreateSocrataBatchButton } from './create-socrata-batch-button';

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
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Listos para revisión',
      value: readyForReview,
      icon: CheckCircle2,
      color: 'text-warning',
      bg: 'bg-warning/10',
    },
    {
      label: 'Cancelados',
      value: cancelled,
      icon: XCircle,
      color: 'text-muted-foreground',
      bg: 'bg-surface-muted',
    },
    {
      label: 'Smoke tests',
      value: smokeTests,
      icon: FlaskConical,
      color: 'text-info',
      bg: 'bg-info/10',
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
      <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-surface-subtle px-5 py-3.5">
        <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Solo lectura para candidatos.</span>{' '}
          No permite editar, aprobar, descartar ni sincronizar candidatos existentes.
        </p>
      </div>

      {/* Create batch — admin only */}
      <div className="rounded-2xl border border-border/60 bg-card px-5 py-4">
        <p className="mb-3 text-sm font-semibold text-foreground">
          Crear lote de prueba
        </p>
        <CreateSocrataBatchButton />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          title="Total lotes"
          description="Lotes creados en el sistema"
          value={totalCount}
          icon={
            <div className="rounded-lg p-1.5 bg-primary/10">
              <Layers className="h-4 w-4 text-primary" />
            </div>
          }
        />
        <MetricCard
          title="Listos para revisión"
          description="Esperando aprobación"
          value={readyForReview}
          icon={
            <div className="rounded-lg p-1.5 bg-warning/10">
              <CheckCircle2 className="h-4 w-4 text-warning" />
            </div>
          }
        />
        <MetricCard
          title="Cancelados"
          description="Lotes descartados"
          value={cancelled}
          icon={
            <div className="rounded-lg p-1.5 bg-surface-muted">
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </div>
          }
        />
        <MetricCard
          title="Smoke tests"
          description="Pruebas automáticas ejecutadas"
          value={smokeTests}
          icon={
            <div className="rounded-lg p-1.5 bg-info/10">
              <FlaskConical className="h-4 w-4 text-info" />
            </div>
          }
        />
      </div>

      {/* Batches table */}
      <SurfaceCard noPadding>
        <div className="border-b border-border/60 px-5 py-3.5">
          <p className="text-sm font-semibold text-foreground">
            {batches.length === 0
              ? 'Aún no hay lotes Socrata creados.'
              : `Lotes Socrata · ${batches.length} lote${batches.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {batches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Database className="h-8 w-8 text-text-muted" />
            <p className="text-sm text-muted-foreground">Aún no hay lotes Socrata creados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-muted-foreground">
                    Nombre
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Dataset
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Candidatos
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Preview
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Smoke / Rollback
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    Fecha
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted-foreground">
                    &nbsp;
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {batches.map((batch) => (
                  <tr
                    key={batch.id}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-foreground">{batch.name}</span>
                      {batch.countryCode && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {batch.countryCode}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${batchStatusBadgeClass(batch.status)}`}
                      >
                        {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatDatasetLabel(batch.dataset)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-muted-foreground">
                      {batch.candidatesCount}
                      {batch.targetCount ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          / {batch.targetCount}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">
                      {batch.previewMode ? (
                        <Badge variant="brand">
                          Preview
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {batch.smokeTest && (
                          <Badge variant="info">
                            Smoke test
                          </Badge>
                        )}
                        {batch.rollbackLogical && (
                          <Badge variant="neutral">
                            Rollback lógico
                          </Badge>
                        )}
                        {!batch.smokeTest && !batch.rollbackLogical && (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      {formatShortDate(batch.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/settings/source-catalog/socrata-batches/${batch.id}`}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
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
