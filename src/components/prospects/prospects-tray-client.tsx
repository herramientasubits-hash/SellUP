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
import { Input } from '@/components/ui/input';
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
  
  const inFlightRef = React.useRef<Set<string>>(new Set());

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
      } else if (estatus === 'enriching') {
        enrichingCount++;
      } else if (estatus === 'completed') {
        completedCount++;
      } else if (estatus === 'failed') {
        failedCount++;
      } else if (
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

  const processEnrichmentQueue = React.useCallback(async () => {
    if (!sourceId) return;

    // Sincronizar estado actual
    const syncRes = await syncBatchStatus();
    if (!syncRes) return;

    const { pendingIds, enrichingCount } = syncRes;

    // Límite de concurrencia de 2
    const maxConcurrency = 2;
    // Peticiones activas totales = peticiones del cliente en vuelo + peticiones registradas como enriching en BD
    const currentActive = inFlightRef.current.size + enrichingCount;
    const spotsAvailable = maxConcurrency - currentActive;

    if (spotsAvailable > 0 && pendingIds.length > 0) {
      // Tomar los primeros candidatos elegibles que no estén ya en vuelo
      const toStart = pendingIds
        .filter(id => !inFlightRef.current.has(id))
        .slice(0, spotsAvailable);

      for (const candidateId of toStart) {
        inFlightRef.current.add(candidateId);

        // Lanzar llamada al endpoint de enriquecimiento asíncronamente
        fetch('/api/prospect-candidates/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateId,
            executionType: 'automatic_post_import_enrichment',
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              console.warn(`Error enriqueciendo candidato ${candidateId}:`, errData.error);
            }
          })
          .catch((err) => {
            console.error(`Error de red enriqueciendo candidato ${candidateId}:`, err);
          })
          .finally(() => {
            inFlightRef.current.delete(candidateId);
            router.refresh();
            syncBatchStatus();
          });
      }
    }
  }, [sourceId, syncBatchStatus, router]);

  // Intervalo de sincronización y procesamiento de la cola
  React.useEffect(() => {
    if (!sourceId) return;

    // Diferir la primera ejecución un tick para evitar setState síncrono dentro del efecto
    const initialTimer = setTimeout(() => {
      processEnrichmentQueue();
    }, 0);

    const interval = setInterval(() => {
      processEnrichmentQueue();
    }, 4000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [sourceId, processEnrichmentQueue]);

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
    router.push(pathname); // Navigate to /prospects without params (also removes sourceId)
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
        <div className="shrink-0 flex items-center justify-between gap-3 rounded-xl border border-su-brand/20 bg-su-brand-soft/30 px-4 py-3">
          <div className="flex items-center gap-2.5">
            {batchStats && (batchStats.pending > 0 || batchStats.enriching > 0) ? (
              <Loader2 className="h-4 w-4 shrink-0 text-su-brand animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 shrink-0 text-su-brand" />
            )}
            <p className="text-xs font-medium text-su-brand">
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
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-7 shrink-0 gap-1.5 px-2.5 text-xs text-su-brand hover:bg-su-brand-soft hover:text-su-brand"
          >
            <X className="h-3 w-3" />
            Ver todos los prospectos
          </Button>
        </div>
      )}

      {/* Barra de filtros */}
      <div className="shrink-0 flex flex-col gap-4 rounded-xl border border-border/40 bg-card p-4 sm:flex-row sm:items-center">
        {/* Input de búsqueda */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre de empresa..."
            className="pl-9 text-xs h-9 bg-muted/40 border-border/50 focus-visible:ring-1 focus-visible:ring-su-brand/50"
          />
        </div>

        {/* Contenedor de selects */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
          {/* Select de Estado */}
          <Select value={activeStatus} onValueChange={(val) => updateFilter('status', val)}>
            <SelectTrigger className="h-9 w-full sm:w-[155px] text-xs bg-muted/40 border-border/50">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Select de País */}
          <Select value={activeCountry} onValueChange={(val) => updateFilter('country', val)}>
            <SelectTrigger className="h-9 w-full sm:w-[130px] text-xs bg-muted/40 border-border/50">
              <SelectValue placeholder="Todos los países" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los países</SelectItem>
              {LATAM_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Select de Sector */}
          <Select value={activeIndustry} onValueChange={(val) => updateFilter('industry', val)}>
            <SelectTrigger className="h-9 w-full sm:w-[150px] text-xs bg-muted/40 border-border/50">
              <SelectValue placeholder="Todos los sectores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los sectores</SelectItem>
              {INDUSTRIES.map((ind) => (
                <SelectItem key={ind} value={ind} className="text-xs">
                  {ind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Select de Origen */}
          <Select value={activeOrigin} onValueChange={(val) => updateFilter('source', val)}>
            <SelectTrigger className="h-9 w-full sm:w-[145px] text-xs bg-muted/40 border-border/50">
              <SelectValue placeholder="Todos los orígenes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los orígenes</SelectItem>
              {ORIGIN_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Limpiar filtros */}
        {(isFilteredOnly || isSourceFiltered) && (
          <Button
            variant="ghost"
            onClick={clearAllFilters}
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground shrink-0 border border-border/30 sm:border-0 hover:bg-muted/40"
          >
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Tabla y estado vacío */}
      {candidates.length === 0 ? (
        isFilteredOnly || isSourceFiltered ? (
          /* Estado vacío por filtros */
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl bg-card border-border/40">
            <div className="mb-3 rounded-full bg-muted/60 p-3">
              <Filter className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-semibold text-foreground">No se encontraron prospectos</p>
            <p className="mt-1 text-xs text-muted-foreground/60 max-w-xs">
              {isSourceFiltered
                ? 'No se encontraron prospectos nuevos en esta operación. Puede que todos fueran omitidos por duplicidad, calidad o datos insuficientes.'
                : 'Intenta ajustando los filtros o el término de búsqueda para ver más resultados.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              className="mt-4 gap-1.5 text-xs"
            >
              Ver todos los prospectos
            </Button>
          </div>
        ) : (
          /* Estado vacío total — sin prospectos en el sistema */
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl bg-card border-border/40">
            <div className="mb-4 rounded-full bg-muted/60 p-3">
              <Building2 className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Todavía no hay prospectos para revisar</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-sm">
              Genera empresas con IA, importa una lista o crea un prospecto manualmente.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <ImportCandidatesDrawer>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Importar prospectos
                </Button>
              </ImportCandidatesDrawer>
              <CreateCandidateDrawer />
            </div>
          </div>
        )
      ) : (
        /* Listado de prospectos */
        <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="shrink-0 flex items-center justify-between border-b border-border/40 px-5 py-3.5 bg-muted/[0.08]">
            <p className="text-xs font-semibold text-foreground/80">
              Mostrando {startRow} - {endRow} de {total} prospectos
            </p>
            <div className="flex items-center gap-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Guía de revisión"
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Guía de revisión</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-4" align="end">
                  <div className="space-y-2 text-xs text-foreground/90">
                    <p className="font-semibold text-sm border-b pb-1.5 mb-1.5">Antes de aprobar revisa:</p>
                    <ul className="list-disc pl-4 space-y-1.5 leading-relaxed text-muted-foreground">
                      <li>Identidad y actividad de la empresa</li>
                      <li>Identificador fiscal, cuando esté disponible</li>
                      <li>Evidencia y nivel de confianza</li>
                      <li>Posibles coincidencias en SellUp y HubSpot</li>
                    </ul>
                  </div>
                </PopoverContent>
              </Popover>

              <div className="flex items-center gap-1 border-l pl-3 border-border/40">
                <Search className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/60 font-mono uppercase">
                  Página {page} de {totalPages || 1}
                </span>
              </div>
            </div>
          </div>

          <CandidatesTableClient candidates={candidates} />

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-between border-t border-border/40 px-5 py-3.5 bg-muted/[0.04]">
              <span className="text-xs text-muted-foreground/75">
                Página {page} de {totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                  className="h-8 gap-1 text-xs px-2.5 hover:bg-muted/40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
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
                        variant={page === pageNum ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handlePageChange(pageNum)}
                        className={`h-8 w-8 text-xs p-0 ${
                          page === pageNum 
                            ? 'bg-foreground text-background font-semibold hover:bg-foreground/90' 
                            : 'hover:bg-muted/40'
                        }`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                  {totalPages > 5 && page + 2 < totalPages && (
                    <span className="text-xs text-muted-foreground px-1 select-none">…</span>
                  )}
                  {totalPages > 5 && page + 2 < totalPages && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(totalPages)}
                      className="h-8 w-8 text-xs p-0 hover:bg-muted/40"
                    >
                      {totalPages}
                    </Button>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                  className="h-8 gap-1 text-xs px-2.5 hover:bg-muted/40"
                >
                  Siguiente
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

