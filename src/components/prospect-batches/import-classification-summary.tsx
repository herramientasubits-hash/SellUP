'use client';

// ── Import Classification Summary — Hito 16AB.40 ──────────────────────────────
// El resumen de la clasificación: si se puede importar ya, y cómo se reparten
// las filas entre los estados.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SurfaceCard } from '@/components/shared/surface-card';
import { DistributionBar, type DistributionSegment } from '@/components/charts/DistributionBar';
import { cn } from '@/lib/utils';
import type { ClassificationSummaryStats } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

type ClassificationSummaryProps = {
  stats: ClassificationSummaryStats;
  catalogVersion: string;
  className?: string;
};

export function ImportClassificationSummary({
  stats,
  catalogVersion,
  className,
}: ClassificationSummaryProps) {
  const readyCount = stats.valid + stats.normalized;
  const readyPercentage = stats.total > 0 ? Math.round((readyCount / stats.total) * 100) : 0;
  const canProceed = stats.requiresReview === 0 && stats.invalid === 0;

  const segments: DistributionSegment[] = [
    { id: 'valid', label: 'Listas', value: stats.valid, tone: 'positive' },
    { id: 'normalized', label: 'Normalizadas', value: stats.normalized, tone: 'info' },
    { id: 'warning', label: 'Advertencias', value: stats.warning, tone: 'warning' },
    { id: 'requires_review', label: 'Requieren revisión', value: stats.requiresReview, tone: 'negative' },
    // Las no válidas solo ocupan sitio cuando las hay.
    ...(stats.invalid > 0
      ? [{ id: 'invalid', label: 'No válidas', value: stats.invalid, tone: 'neutral' as const }]
      : []),
  ];

  return (
    <div className={cn('space-y-3', className)}>
      <Alert variant={canProceed ? 'success' : 'warning'}>
        <AlertTitle className="text-xs">
          {canProceed
            ? `${readyCount} de ${stats.total} filas listas para importar (${readyPercentage}%)`
            : `${stats.requiresReview + stats.invalid} de ${stats.total} filas requieren corrección antes de importar`}
        </AlertTitle>
        <AlertDescription className="text-xs">Catálogo: v{catalogVersion}</AlertDescription>
      </Alert>

      <SurfaceCard className="p-4">
        <DistributionBar
          ariaLabel="Reparto de las filas por estado de clasificación"
          unit="filas"
          segments={segments}
          emptyLabel="No hay filas clasificadas."
          // La leyenda va en una fila para no quitarle alto a la tabla.
          className="[&_ul]:flex-row [&_ul]:flex-wrap [&_ul]:gap-x-6"
        />
      </SurfaceCard>
    </div>
  );
}
