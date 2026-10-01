import Link from 'next/link';
import { Database, XCircle, CheckCircle2, FlaskConical, Layers, Lock } from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { TableShell } from '@/components/data-display';
import { getSocrataPreviewBatches } from '@/modules/source-catalog/socrata-batches-queries';
import {
  BATCH_STATUS_LABELS,
  batchStatusBadgeClass,
  formatDatasetLabel,
  formatShortDate,
} from '@/modules/source-catalog/socrata-batches-labels';
import { CreateSocrataBatchButton } from './create-socrata-batch-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              { label: 'Catálogo de fuentes', href: '/settings/source-catalog' },
              'Lotes Socrata',
            ]}
          />
        }
        title="Lotes Socrata"
        description="Vista de revisión interna para lotes creados desde fuentes estructuradas. No aprueba, no asigna y no sincroniza con HubSpot."
        backHref="/settings/source-catalog"
      />

      {/* Read-only warning */}
      <div className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
        <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Solo lectura para candidatos.</span>{' '}
          No permite editar, aprobar, descartar ni sincronizar candidatos existentes.
        </p>
      </div>

      {/* Create batch — admin only */}
      <SurfaceCard>
        <SurfaceCardHeader title="Crear lote de prueba" className="mb-3" />
        <CreateSocrataBatchButton />
      </SurfaceCard>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Total lotes"
          description="Lotes creados en el sistema"
          value={totalCount}
          icon={<Layers className="text-primary" aria-hidden="true" />}
        />
        <MetricCard
          title="Listos para revisión"
          description="Esperando aprobación"
          value={readyForReview}
          icon={<CheckCircle2 className="text-warning" aria-hidden="true" />}
        />
        <MetricCard
          title="Cancelados"
          description="Lotes descartados"
          value={cancelled}
          icon={<XCircle className="text-muted-foreground" aria-hidden="true" />}
        />
        <MetricCard
          title="Smoke tests"
          description="Pruebas automáticas ejecutadas"
          value={smokeTests}
          icon={<FlaskConical className="text-info" aria-hidden="true" />}
        />
      </div>

      {/* Batches table */}
      <TableShell
        title={
          <>
            Lotes Socrata
            <Badge variant="neutral" className="tabular-nums">
              {batches.length} lote{batches.length !== 1 ? 's' : ''}
            </Badge>
          </>
        }
        empty={batches.length === 0}
        emptyState={
          <EmptyState variant="plain" icon={Database} title="Aún no hay lotes Socrata creados." />
        }
      >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    Nombre
                  </TableHead>
                  <TableHead scope="col">
                    Estado
                  </TableHead>
                  <TableHead scope="col">
                    Dataset
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    Candidatos
                  </TableHead>
                  <TableHead scope="col">
                    Preview
                  </TableHead>
                  <TableHead scope="col">
                    Smoke / Rollback
                  </TableHead>
                  <TableHead scope="col">
                    Fecha
                  </TableHead>
                  <TableHead scope="col">
                    &nbsp;
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow
                    key={batch.id}
                  >
                    <TableCell>
                      <span className="font-medium text-foreground">{batch.name}</span>
                      {batch.countryCode && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {batch.countryCode}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={batchStatusBadgeClass(batch.status)}>
                        {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatDatasetLabel(batch.dataset)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {batch.candidatesCount}
                      {batch.targetCount ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          / {batch.targetCount}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {batch.previewMode ? (
                        <Badge variant="brand">
                          Preview
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatShortDate(batch.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="xs">
                        <Link href={`/settings/source-catalog/socrata-batches/${batch.id}`}>
                          Ver detalle
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
      </TableShell>
    </div>
  );
}
