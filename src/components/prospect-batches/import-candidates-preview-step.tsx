'use client';

// ── Importar candidatos — vista previa de importación ─────────────────────────
// Solo pantalla. OJO: hoy el drawer nunca entra en el paso `preview` (ningún
// flujo lo activa); se conserva tal cual estaba, en su propio archivo.

import { ArrowLeft } from '@/icons';
import { cn } from '@/lib/utils';
import { SurfaceCard } from '@/components/shared/surface-card';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { DistributionBar } from '@/components/charts/DistributionBar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImportPreviewDataTable } from '@/components/prospect-batches/import-preview-data-table';
import type { ImportPreview, ImportRow } from '@/modules/prospect-batches/import-candidates-parser';
import type { ImportDuplicateResult } from './import-candidates-helpers';

interface ImportCandidatesPreviewStepProps {
  preview: ImportPreview;
  duplicateMap: Map<number, ImportDuplicateResult>;
  exactDuplicateCount: number;
  possibleDuplicateCount: number;
  countryLabel?: string;
  industryLabel?: string;
  subindustryLabel?: string;
  onBack: () => void;
  onSelectionChange: (rows: ImportRow[]) => void;
}

export function ImportCandidatesPreviewStep({
  preview,
  duplicateMap,
  exactDuplicateCount,
  possibleDuplicateCount,
  countryLabel,
  industryLabel,
  subindustryLabel,
  onBack,
  onSelectionChange,
}: ImportCandidatesPreviewStepProps) {
  const hasCriteria = Boolean(countryLabel || industryLabel || subindustryLabel);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <Button type="button" variant="ghost" size="xs" className="self-start" onClick={onBack}>
        <ArrowLeft className="h-3 w-3" />
        Volver a la configuración
      </Button>

      {/* Valores por defecto del lote */}
      {hasCriteria && (
        <Alert variant="info">
          <AlertTitle className="text-xs">Criterios de importación</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {countryLabel && <Badge variant="brand">{countryLabel}</Badge>}
            {industryLabel && <Badge variant="brand">{industryLabel}</Badge>}
            {subindustryLabel && <Badge variant="brand">{subindustryLabel}</Badge>}
          </AlertDescription>
        </Alert>
      )}

      {/* Resumen: cuántas filas hay y cómo se reparten */}
      <SurfaceCard className="space-y-4 p-4">
        <DetailList columns={2}>
          <DetailItem label="Filas detectadas">{String(preview.total)}</DetailItem>
          <DetailItem label="Importables">{String(preview.valid + preview.warnings_only)}</DetailItem>
        </DetailList>
        <DistributionBar
          ariaLabel="Reparto de las filas detectadas"
          unit="filas"
          segments={[
            { id: 'valid', label: 'Sin observaciones', value: preview.valid, tone: 'positive' },
            { id: 'warning', label: 'Con advertencias', value: preview.warnings_only, tone: 'warning' },
            { id: 'error', label: 'Con errores', value: preview.errors, tone: 'negative' },
          ]}
          emptyLabel="No se detectaron filas."
        />
      </SurfaceCard>

      {(exactDuplicateCount > 0 || possibleDuplicateCount > 0) && (
        <Alert variant="warning">
          <AlertDescription className="text-xs space-y-0.5">
            {exactDuplicateCount > 0 && (
              <p>
                <span className="font-semibold text-warning">
                  {exactDuplicateCount} duplicado{exactDuplicateCount !== 1 ? 's' : ''} exacto{exactDuplicateCount !== 1 ? 's' : ''}
                </span>{' '}
                encontrado{exactDuplicateCount !== 1 ? 's' : ''} en SellUp — se importarán igualmente para revisión.
              </p>
            )}
            {possibleDuplicateCount > 0 && (
              <p>
                <span className="font-semibold text-warning">
                  {possibleDuplicateCount} posible{possibleDuplicateCount !== 1 ? 's' : ''} duplicado{possibleDuplicateCount !== 1 ? 's' : ''}
                </span>{' '}
                — verifica manualmente antes de aprobar.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {(preview.recognized_columns.length > 0 || preview.unrecognized_columns.length > 0) && (
        <SurfaceCard>
          {preview.recognized_columns.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Columnas reconocidas</p>
              <div className="flex flex-wrap gap-1">
                {preview.recognized_columns.map((col) => (
                  <Badge key={col} variant="secondary">
                    {col}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {preview.unrecognized_columns.length > 0 && (
            <div className={cn('space-y-1.5', preview.recognized_columns.length > 0 && 'pt-3 border-t border-border/50')}>
              <p className="text-xs font-semibold text-muted-foreground">
                Columnas no reconocidas (se ignorarán)
              </p>
              <div className="flex flex-wrap gap-1">
                {preview.unrecognized_columns.map((col) => (
                  <Badge key={col} variant="outline" className="text-muted-foreground">
                    {col}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </SurfaceCard>
      )}

      {/* Tabla de filas */}
      <div className="flex-1 min-h-0">
        <ImportPreviewDataTable
          rows={preview.rows}
          duplicateMap={duplicateMap}
          onSelectionChange={onSelectionChange}
        />
      </div>

      {preview.errors === preview.total && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            Todas las filas tienen errores bloqueantes. Corrige los datos y vuelve a intentarlo.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
