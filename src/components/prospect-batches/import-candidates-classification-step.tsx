'use client';

// ── Importar candidatos — paso 2/3: columnas y clasificación ──────────────────
// Solo pantalla: el estado y las llamadas viven en el drawer.

import { FilterChips } from '@/components/filters/filter-chips';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ImportClassificationTable } from '@/components/prospect-batches/import-classification-table';
import { ImportClassificationSummary } from '@/components/prospect-batches/import-classification-summary';
import { ImportColumnMappingTable } from '@/components/prospect-batches/import-column-mapping-table';
import type {
  ImportColumnMapping,
  ImportColumnTarget,
  ImportClassificationPreviewRow,
  ClassificationFilterStatus,
  ClassificationSummaryStats,
  ManualClassificationCorrection,
  CatalogVersionState,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';
import { computeHasMappingConflict, type ImportCatalogData } from './import-candidates-helpers';

/** Esqueleto mientras se clasifican las filas contra el catálogo. */
export function ImportClassificationLoading() {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-36 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <p role="status" className="text-center text-xs text-muted-foreground">
        Clasificando industrias y subindustrias…
      </p>
    </div>
  );
}

interface ImportMappingResolutionProps {
  columnMappings: ImportColumnMapping[];
  onMappingChange: (sourceColumn: string, newTarget: ImportColumnTarget) => void;
}

/** Bloque para resolver un mapeo de columnas ambiguo antes de clasificar. */
export function ImportMappingResolution({ columnMappings, onMappingChange }: ImportMappingResolutionProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <Alert variant="warning">
        <AlertDescription className="text-xs">
          SellUp detectó columnas con mapeo ambiguo. Revisa y corrige los campos conflictivos antes de clasificar.
          {computeHasMappingConflict(columnMappings) && (
            <span className="block mt-1 font-semibold">
              Dos columnas están asignadas al mismo campo — resuelve el conflicto para continuar.
            </span>
          )}
        </AlertDescription>
      </Alert>
      <ImportColumnMappingTable columnMappings={columnMappings} onMappingChange={onMappingChange} />
    </div>
  );
}

interface ImportClassificationReviewProps {
  rows: ImportClassificationPreviewRow[];
  summary: ClassificationSummaryStats;
  catalog: ImportCatalogData | null;
  catalogVersion: CatalogVersionState | null;
  catalogVersionChanged: boolean;
  onRevalidate: () => void;
  classificationError: string | null;
  filterStatus: ClassificationFilterStatus;
  onFilterStatusChange: (status: ClassificationFilterStatus) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  showSubindustry: boolean;
  onSaveCorrection: (
    correction: ManualClassificationCorrection,
    contextRow: ImportClassificationPreviewRow,
  ) => Promise<void>;
  onBulkCorrection: (
    group: ImportClassificationPreviewRow[],
    industryId: string,
    subindustryId: string | null,
  ) => Promise<void>;
}

/** Resumen, filtros por estado y tabla de clasificación con edición en línea. */
export function ImportClassificationReview({
  rows,
  summary,
  catalog,
  catalogVersion,
  catalogVersionChanged,
  onRevalidate,
  classificationError,
  filterStatus,
  onFilterStatusChange,
  selectedIds,
  onSelectionChange,
  showSubindustry,
  onSaveCorrection,
  onBulkCorrection,
}: ImportClassificationReviewProps) {
  // Los contadores salen del total, no de lo filtrado.
  const filterOptions: Array<{ value: ClassificationFilterStatus; label: string; count: number }> = [
    { value: 'all', label: 'Todas', count: summary.total },
    { value: 'valid', label: 'Listas', count: summary.valid },
    { value: 'normalized', label: 'Normalizadas', count: summary.normalized },
    { value: 'warning', label: 'Con advertencias', count: summary.warning },
    { value: 'requires_review', label: 'Requieren revisión', count: summary.requiresReview },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {catalogVersionChanged && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            <p>
              El catálogo de industrias fue actualizado mientras revisabas las correcciones. La
              importación está bloqueada hasta que vuelvas a clasificar con la nueva versión.
            </p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-2 w-fit"
              onClick={onRevalidate}
            >
              Revalidar archivo
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {classificationError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{classificationError}</AlertDescription>
        </Alert>
      )}

      {catalogVersion && (
        <ImportClassificationSummary stats={summary} catalogVersion={catalogVersion.version} />
      )}

      {/* Filtro por estado + contador de selección — fuera de la tabla */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <FilterChips
          ariaLabel="Filtrar filas por estado de clasificación"
          options={filterOptions}
          value={filterStatus}
          onChange={(value) => onFilterStatusChange(value as ClassificationFilterStatus)}
          wrap
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          Seleccionadas: <strong className="text-foreground">{selectedIds.size}</strong> de {rows.length}
        </span>
      </div>

      {/* Tabla de clasificación — ancho completo, edición en línea */}
      <SurfaceCard noPadding className="flex-1 min-h-0 overflow-hidden">
        <ImportClassificationTable
          rows={rows}
          filterStatus={filterStatus}
          selectedRowIds={selectedIds}
          onSelectionChange={onSelectionChange}
          catalog={catalog ?? undefined}
          catalogVersion={catalogVersion ?? undefined}
          showSubindustry={showSubindustry}
          onSaveCorrection={onSaveCorrection}
          onBulkCorrection={onBulkCorrection}
        />
      </SurfaceCard>
    </div>
  );
}
