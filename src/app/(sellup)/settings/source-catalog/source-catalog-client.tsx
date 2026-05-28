'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, Copy, Check, ExternalLink, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SurfaceCard } from '@/components/shared/surface-card';
import type { SourceCatalogViewModel, SourceViewModel } from '@/modules/source-catalog/queries';
import {
  OPERATIONAL_STATUS_LABELS,
  AUTOMATION_LEVEL_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  COUNTRY_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
} from '@/modules/source-catalog/labels';

type Props = {
  viewModel: SourceCatalogViewModel;
};

function StatusBadge({ status }: { status: SourceViewModel['operationalStatus'] }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${operationalStatusBadgeClass(status)}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${operationalStatusDotClass(status)}`} />
      {OPERATIONAL_STATUS_LABELS[status]}
    </span>
  );
}

function CopyKeyCell({ sourceKey }: { sourceKey: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(sourceKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  };

  return (
    <Button variant="ghost" size="icon-xs" onClick={handleCopy} title="Copiar key">
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </Button>
  );
}

const ALL = '__all__';

export function SourceCatalogClient({ viewModel }: Props) {
  const { sources, filters } = viewModel;

  const [search, setSearch] = useState('');
  const [filterCountry, setFilterCountry] = useState(ALL);
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [filterPriority, setFilterPriority] = useState(ALL);
  const [filterType, setFilterType] = useState(ALL);
  const [filterAutomation, setFilterAutomation] = useState(ALL);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return sources.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.key.toLowerCase().includes(q) &&
        !s.url?.toLowerCase().includes(q) &&
        !s.sectors.some((sec) => sec.toLowerCase().includes(q))
      ) {
        return false;
      }
      if (filterCountry !== ALL && !s.countryCodes.includes(filterCountry)) return false;
      if (filterStatus !== ALL && s.operationalStatus !== filterStatus) return false;
      if (filterPriority !== ALL && s.priority !== filterPriority) return false;
      if (filterType !== ALL && s.type !== filterType) return false;
      if (filterAutomation !== ALL && s.automationLevel !== filterAutomation) return false;
      return true;
    });
  }, [sources, search, filterCountry, filterStatus, filterPriority, filterType, filterAutomation]);

  const selectClass =
    'h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <SurfaceCard>
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Buscar por nombre, key, sector..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <select
            className={selectClass}
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            aria-label="Filtrar por país"
          >
            <option value={ALL}>Todos los países</option>
            {filters.countries.map((c) => (
              <option key={c} value={c}>
                {COUNTRY_LABELS[c] ?? c}
              </option>
            ))}
          </select>

          <select
            className={selectClass}
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filtrar por estado operativo"
          >
            <option value={ALL}>Todos los estados</option>
            {filters.operationalStatuses.map((s) => (
              <option key={s} value={s}>
                {OPERATIONAL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <select
            className={selectClass}
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            aria-label="Filtrar por prioridad"
          >
            <option value={ALL}>Todas las prioridades</option>
            {filters.priorities.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>

          <select
            className={selectClass}
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filtrar por tipo"
          >
            <option value={ALL}>Todos los tipos</option>
            {filters.types.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          <select
            className={selectClass}
            value={filterAutomation}
            onChange={(e) => setFilterAutomation(e.target.value)}
            aria-label="Filtrar por automatización"
          >
            <option value={ALL}>Toda automatización</option>
            {filters.automationLevels.map((a) => (
              <option key={a} value={a}>
                {AUTOMATION_LEVEL_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
      </SurfaceCard>

      {/* Results summary */}
      <p className="text-xs text-muted-foreground">
        {filtered.length === sources.length
          ? `${sources.length} fuentes`
          : `${filtered.length} de ${sources.length} fuentes`}
      </p>

      {/* Table */}
      <SurfaceCard noPadding>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-foreground">Sin resultados</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ajusta los filtros para ver fuentes.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Fuente</TableHead>
                <TableHead>País</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Automatización</TableHead>
                <TableHead>Sectores</TableHead>
                <TableHead className="pr-5">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((source) => (
                <TableRow key={source.key}>
                  <TableCell className="pl-5 min-w-[180px]">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{source.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{source.key}</p>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {source.countryCodes.length > 0
                        ? source.countryCodes.map((c) => COUNTRY_LABELS[c] ?? c).join(', ')
                        : 'Global'}
                    </span>
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={source.operationalStatus} />
                  </TableCell>

                  <TableCell>
                    <span className="text-sm font-medium text-foreground">
                      {PRIORITY_LABELS[source.priority]}
                    </span>
                  </TableCell>

                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {TYPE_LABELS[source.type]}
                    </span>
                  </TableCell>

                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {AUTOMATION_LEVEL_LABELS[source.automationLevel]}
                    </span>
                  </TableCell>

                  <TableCell className="max-w-[140px]">
                    <span className="text-xs text-muted-foreground line-clamp-2 whitespace-normal">
                      {source.sectors.length > 0 ? source.sectors.slice(0, 3).join(', ') : '—'}
                    </span>
                  </TableCell>

                  <TableCell className="pr-5">
                    <div className="flex items-center gap-1">
                      <Link href={`/settings/source-catalog/${source.key}`}>
                        <Button variant="ghost" size="icon-xs" title="Ver detalle">
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </Link>
                      <CopyKeyCell sourceKey={source.key} />
                      {source.url && (
                        <Link href={source.url} target="_blank" rel="noopener noreferrer">
                          <Button variant="ghost" size="icon-xs" title="Abrir URL">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SurfaceCard>
    </div>
  );
}
