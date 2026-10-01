'use client';

import * as React from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { 
  Building2, 
  Search, 
  Upload, 
  Filter, 
  ChevronLeft, 
  ChevronRight,
  Sparkles,
  X,
  Info,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

import { CandidatesTableClient } from '@/components/prospect-batches/candidates-table-client';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { LATAM_COUNTRIES, INDUSTRIES } from '@/modules/prospect-batches/types';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';
import { createClient } from '@/lib/supabase/client';

// Origin options corresponding to BatchSource
const ORIGIN_OPTIONS = [
  { value: 'manual', label: 'Creación manual' },
  { value: 'external_import', label: 'Importación externa' },
  { value: 'agent_1', label: 'Generado por IA' },
  { value: 'socrata_colombia', label: 'RUES Colombia' },
  { value: 'datos_gob_cl', label: 'Oficial Chile' },
  { value: 'denue_mexico', label: 'DENUE México' },
  { value: 'apollo', label: 'Apollo' },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendientes de revisión' },
  { value: 'approved', label: 'Aprobados' },
  { value: 'discarded', label: 'Descartados' },
  { value: 'duplicate', label: 'Duplicados' },
  { value: 'converted_to_account', label: 'Convertidos' },
];

// Etiqueta semántica según el source del batch de origen
function getSourceBanner(sourceBatchType: string | undefined): string {
  if (!sourceBatchType) return 'Mostrando prospectos de la operación reciente';
  if (sourceBatchType === 'external_import') return 'Mostrando prospectos de la importación reciente';
  if (sourceBatchType === 'agent_1' || sourceBatchType === 'apollo') return 'Mostrando prospectos generados con IA';
  if (sourceBatchType === 'socrata_colombia') return 'Mostrando prospectos encontrados en RUES Colombia';
  if (sourceBatchType === 'datos_gob_cl') return 'Mostrando prospectos encontrados en fuente oficial Chile';
  if (sourceBatchType === 'denue_mexico') return 'Mostrando prospectos encontrados en DENUE México';
  if (sourceBatchType === 'manual') return 'Mostrando prospectos creados recientemente';
  return 'Mostrando prospectos de la operación reciente';
}

interface ProspectsTrayClientProps {
  candidates: ProspectCandidateWithReviewer[];
  total: number;
  limit: number;
  page: number;
  sourceId?: string;
  sourceBatchType?: string;
}

export function ProspectsTrayClient({
  candidates,
  total,
  limit,
  page,
  sourceId,
  sourceBatchType,
}: ProspectsTrayClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filter states
  const [search, setSearch] = React.useState<string>(searchParams.get('search') ?? '');
  const activeStatus: string = searchParams.get('status') ?? 'pending';
  const activeCountry: string = searchParams.get('country') ?? 'all';
  const activeIndustry: string = searchParams.get('industry') ?? 'all';
  const activeOrigin: string = searchParams.get('source') ?? 'all';

  const isSourceFiltered = !!sourceId;
  const isFilteredOnly = 
    search.trim() !== '' ||
    activeStatus !== 'pending' ||
    activeCountry !== 'all' ||
    activeIndustry !== 'all' ||
    activeOrigin !== 'all';

  // Orchestrator state
  const [batchStats, setBatchStats] = React.useState<{
    total: number;
    pending: number;
    enriching: number;
    completed: number;
    failed: number;
    skipped: number;
    possibleDuplicates: number;
  } | null>(null);
  
  const syncBatchStatus = React.useCallback(async () => {
    if (!sourceId) return;
    const supabase = createClient();
    const { data: batchCandidates, error } = await supabase
      .from('prospect_candidates')
      .select('id, metadata, duplicate_status, status')
      .eq('batch_id', sourceId);

    if (error || !batchCandidates) return;

    let pendingCount = 0;
    let enrichingCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let possibleDuplicateCount = 0;

    const pendingIds: string[] = [];

    for (const cand of batchCandidates) {
      const enrichment = cand.metadata?.enrichment || {};
      const estatus = enrichment.status;
      
      if (estatus === 'pending') {
        pendingCount++;
        pendingIds.push(cand.id);
      } else if (estatus === 'enriching' || estatus === 'processing') {
        enrichingCount++;
      } else if (estatus === 'completed') {
        completedCount++;
      } else if (estatus === 'failed') {
        failedCount++;
      } else if (
        estatus === 'skipped' ||
        estatus === 'skipped_duplicate' || 
        estatus === 'skipped_already_complete' || 
        estatus === 'no_required'
      ) {
        skippedCount++;
      }

      if (cand.duplicate_status === 'possible_duplicate') {
        possibleDuplicateCount++;
      }
    }

    setBatchStats({
      total: batchCandidates.length,
      pending: pendingCount,
      enriching: enrichingCount,
      completed: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      possibleDuplicates: possibleDuplicateCount,
    });

    return { pendingIds, enrichingCount };
  }, [sourceId]);

  // Intervalo de sincronización de solo lectura y refresco visual
  React.useEffect(() => {
    if (!sourceId) return;

    // Diferir la primera sincronización un tick para evitar setState síncrono dentro del efecto
    const initialTimer = setTimeout(() => {
      syncBatchStatus();
    }, 0);

    // Configurar polling de lectura cada 5 segundos
    const interval = setInterval(async () => {
      const stats = await syncBatchStatus();
      if (!stats) return;

      // Actualizar la lista en el servidor para refrescar las filas de la tabla
      router.refresh();

      // Si ya no hay trabajos activos (pending o enriching/processing), detener el polling
      if (stats.pendingIds.length === 0 && stats.enrichingCount === 0) {
        clearInterval(interval);
      }
    }, 5000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [sourceId, syncBatchStatus, router]);

  // Debounce search input to avoid re-rendering RSC on every keystroke
  React.useEffect(() => {
    const timer = setTimeout(() => {
      const current = new URLSearchParams(Array.from(searchParams.entries()));
      if (search.trim()) {
        current.set('search', search.trim());
      } else {
        current.delete('search');
      }
      current.delete('page'); // Reset page when query changes
      router.push(`${pathname}?${current.toString()}`);
    }, 450);

    return () => clearTimeout(timer);
  }, [search, pathname, searchParams, router]);

  const updateFilter = (key: string, value: string | null) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    if (value && value !== 'all') {
      current.set(key, value);
    } else {
      current.delete(key);
    }
    current.delete('page'); // Reset page on filter change
    router.push(`${pathname}?${current.toString()}`);
  };

  const clearAllFilters = () => {
    setSearch('');
    // Clear filters and sourceId, but keep the module tab so we stay inside the
    // Prospectos tab of Empresas (`/accounts?tab=prospectos`). On the legacy
    // `/prospects` route there is no `tab` param, so this lands on `/prospects`.
    const tab = searchParams.get('tab');
    router.push(tab ? `${pathname}?tab=${tab}` : pathname);
  };

  const totalPages = Math.ceil(total / limit);
  const startRow = (page - 1) * limit + 1;
  const endRow = Math.min(page * limit, total);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.set('page', String(newPage));
    router.push(`${pathname}?${current.toString()}`);
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-6">
      {/* Banner de operación reciente (sourceId activo) */}
      {isSourceFiltered && (
        <div
          className="flex shrink-0 flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              )}
              <p className="min-w-0 text-sm font-medium text-primary">
                {batchStats ? (
                  (batchStats.pending > 0 || batchStats.enriching > 0) ? (
                    `Importación completada. Estamos completando la información de ${batchStats.pending + batchStats.enriching} prospecto${batchStats.pending + batchStats.enriching !== 1 ? 's' : ''}...`
                  ) : (
                    `Importación completada. Se enriquecieron ${batchStats.completed} prospecto${batchStats.completed !== 1 ? 's' : ''} y ${batchStats.failed + batchStats.possibleDuplicates} requiere${batchStats.failed + batchStats.possibleDuplicates !== 1 ? 'n' : ''} revisión.`
                  )
                ) : (
                  getSourceBanner(sourceBatchType)
                )}
              </p>
            </div>
            <Button type="button" variant="link" size="xs" onClick={clearAllFilters} className="shrink-0">
              <X aria-hidden="true" />
              Ver todos los prospectos
            </Button>
          </div>
          {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) && (
            <div className="space-y-1.5">
              <Progress
                value={batchStats.total > 0 ? ((batchStats.completed + batchStats.failed) / batchStats.total) * 100 : 0}
                className="h-1.5"
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {batchStats.completed + batchStats.failed} de {batchStats.total} procesados
                </span>
                <span className="tabular-nums font-medium text-primary">
                  {batchStats.total > 0 ? Math.round(((batchStats.completed + batchStats.failed) / batchStats.total) * 100) : 0}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Barra de filtros */}
      <SurfaceCard className="flex shrink-0 flex-col gap-3 p-4 lg:flex-row lg:items-center">
        {/* Input de búsqueda */}
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre de empresa..."
            aria-label="Buscar por nombre de empresa"
            className="pl-9"
          />
        </div>

        {/* Contenedor de selects */}
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
          {/* Select de Estado */}
          <Select value={activeStatus} onValueChange={(val) => updateFilter('status', val)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Estado">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Select de País */}
          <Select value={activeCountry} onValueChange={(val) => updateFilter('country', val)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="País">
              <SelectValue placeholder="Todos los países" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los países</SelectItem>
              {LATAM_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Select de Sector */}
          <Select value={activeIndustry} onValueChange={(val) => updateFilter('industry', val)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Sector">
              <SelectValue placeholder="Todos los sectores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los sectores</SelectItem>
              {INDUSTRIES.map((ind) => (
                <SelectItem key={ind} value={ind}>
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Select de Origen */}
          <Select value={activeOrigin} onValueChange={(val) => updateFilter('source', val)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Origen">
              <SelectValue placeholder="Todos los orígenes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los orígenes</SelectItem>
              {ORIGIN_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Limpiar filtros */}
        {(isFilteredOnly || isSourceFiltered) && (
          <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters} className="shrink-0">
            <X aria-hidden="true" />
            Limpiar filtros
          </Button>
        )}
      </SurfaceCard>

      {/* Tabla y estado vacío */}
      {candidates.length === 0 ? (
        isFilteredOnly || isSourceFiltered ? (
          /* Estado vacío por filtros */
          <EmptyState
            icon={Filter}
            title="No se encontraron prospectos"
            description={
              isSourceFiltered
                ? 'No se encontraron prospectos nuevos en esta operación. Puede que todos fueran omitidos por duplicidad, calidad o datos insuficientes.'
                : 'Intenta ajustando los filtros o el término de búsqueda para ver más resultados.'
            }
            action={
              <Button type="button" variant="outline" size="sm" onClick={clearAllFilters}>
                Ver todos los prospectos
              </Button>
            }
          />
        ) : (
          /* Estado vacío total — sin prospectos en el sistema */
          <EmptyState
            icon={Building2}
            title="Todavía no hay prospectos para revisar"
            description="Genera empresas con IA, importa una lista o crea un prospecto manualmente."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <ImportCandidatesDrawer>
                  <Button type="button" variant="outline" size="sm">
                    <Upload aria-hidden="true" />
                    Importar prospectos
                  </Button>
                </ImportCandidatesDrawer>
                <CreateCandidateDrawer />
              </div>
            }
          />
        )
      ) : (
        /* Listado de prospectos */
        <SurfaceCard noPadding className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-surface-subtle px-5 py-3">
            <p className="text-sm font-semibold tabular-nums text-foreground">
              Mostrando {startRow} - {endRow} de {total} prospectos
            </p>
            <div className="flex items-center gap-3">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button type="button" variant="ghost" size="xs" aria-label="Guía de revisión">
                      <Info aria-hidden="true" />
                      <span className="hidden sm:inline">Guía de revisión</span>
                    </Button>
                  }
                />
                <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-4" align="end">
                  <div className="space-y-2 text-xs text-foreground">
                    <p className="mb-2 border-b border-border/50 pb-2 text-sm font-semibold tracking-tight">Antes de aprobar revisa:</p>
                    <ul className="list-disc pl-4 space-y-1.5 leading-relaxed text-muted-foreground">
                      <li>Identidad y actividad de la empresa</li>
                      <li>Identificador fiscal, cuando esté disponible</li>
                      <li>Evidencia y nivel de confianza</li>
                      <li>Posibles coincidencias en SellUp y HubSpot</li>
                    </ul>
                  </div>
                </PopoverContent>
              </Popover>

              <div className="flex items-center border-l border-border/50 pl-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  Página {page} de {totalPages || 1}
                </span>
              </div>
            </div>
          </div>

          <CandidatesTableClient candidates={candidates} />

          {/* Paginación */}
          {totalPages > 1 && (
            <nav
              aria-label="Paginación de prospectos"
              className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-surface-subtle px-5 py-3"
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                >
                  <ChevronLeft aria-hidden="true" />
                  Anterior
                </Button>
                
                {/* Lista de páginas simplificada */}
                <div className="hidden sm:flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum = i + 1;
                    if (page > 3 && totalPages > 5) {
                      pageNum = page - 3 + i;
                      if (pageNum + (4 - i) > totalPages) {
                        pageNum = totalPages - 4 + i;
                      }
                    }
                    return (
                      <Button
                        key={pageNum}
                        type="button"
                        variant={page === pageNum ? 'default' : 'outline'}
                        size="icon-sm"
                        aria-label={`Página ${pageNum}`}
                        aria-current={page === pageNum ? 'page' : undefined}
                        onClick={() => handlePageChange(pageNum)}
                        className="tabular-nums"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                  {totalPages > 5 && page + 2 < totalPages && (
                    <span className="select-none px-1 text-xs text-muted-foreground" aria-hidden="true">…</span>
                  )}
                  {totalPages > 5 && page + 2 < totalPages && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Página ${totalPages}`}
                      onClick={() => handlePageChange(totalPages)}
                      className="tabular-nums"
                    >
                      {totalPages}
                    </Button>
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                >
                  Siguiente
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}

