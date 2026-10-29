'use client';

// «Mapa de uso»: el mapa de calor de Clima de UBITS (playground › Encuestas ›
// Resultados) llevado al uso de SellUp. Filas = métricas agrupadas por sección
// (plegables); columnas = el grupo elegido en «Ver por» + «Total». Cada fila se
// colorea con su propia escala: comparada con el grupo que más tiene.

import * as React from 'react';
import { ChevronDown, Info, Layers, Maximize2, SlidersHorizontal, Target, RotateCcw } from '@/icons';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Frame, FrameHeader, FramePanel } from '@/components/shared/frame';
import {
  USAGE_MAP_BANDS,
  USAGE_MAP_DIMENSIONS,
  USAGE_MAP_SECTIONS,
  usageMapTone,
  type UsageMapData,
  type UsageMapDimension,
  type UsageMapRow,
  type UsageMapSection,
} from '@/modules/ai-usage/usage-map';
import {
  USAGE_MAP_DIMENSION_LABELS,
  USAGE_MAP_TONE_CLASS,
  formatUsageMapValue,
  usageMapColumnLabel,
  type UsageMapNames,
} from './usage-map-format';

interface UsageHeatmapProps {
  data: UsageMapData;
  names: UsageMapNames;
}

interface ViewState {
  dimension: UsageMapDimension;
  open: ReadonlySet<UsageMapSection>;
  hidden: ReadonlySet<UsageMapSection>;
  highlighted: string | null;
  hideEmpty: boolean;
}

const STICKY = 'sticky left-0 z-10 bg-card transition-colors group-hover/fila:bg-surface-muted';

export function UsageHeatmap({ data, names }: UsageHeatmapProps) {
  const [view, setView] = React.useState<ViewState>({
    dimension: 'rol',
    open: new Set(USAGE_MAP_SECTIONS.map((s) => s.key)),
    hidden: new Set(),
    highlighted: null,
    hideEmpty: true,
  });
  const [fullscreen, setFullscreen] = React.useState(false);

  const controls = (
    <HeatmapControls view={view} setView={setView} onExpand={fullscreen ? undefined : () => setFullscreen(true)} />
  );
  const matrix = data.matrices[view.dimension];
  const label = USAGE_MAP_DIMENSION_LABELS[view.dimension];

  return (
    <>
      <Frame>
        <FrameHeader
          title={`Mapa de uso ${label.title}`}
          description={`${matrix.columns.length} ${label.plural} · cada fila se compara con quien más tiene`}
          actions={controls}
        />
        <FramePanel noPadding>
          <HeatmapTable data={data} names={names} view={view} setView={setView} />
        </FramePanel>
      </Frame>
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-[calc(100vw-2rem)]">
          <DialogHeader className="flex-row flex-wrap items-start justify-between gap-3 pr-10">
            <div>
              <DialogTitle>Mapa de uso</DialogTitle>
              <DialogDescription>
                {label.menu} · {matrix.columns.length} {label.plural}
              </DialogDescription>
            </div>
            {fullscreen && <HeatmapControls view={view} setView={setView} />}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
            <HeatmapTable data={data} names={names} view={view} setView={setView} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Controles ───────────────────────────────────────────────────────────────

function HeatmapControls({
  view,
  setView,
  onExpand,
}: {
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
  onExpand?: () => void;
}) {
  const customized = view.hidden.size > 0 || !view.hideEmpty || view.highlighted !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
          <Layers aria-hidden="true" />
          {USAGE_MAP_DIMENSION_LABELS[view.dimension].menu}
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Ver por</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={view.dimension}
              onValueChange={(value) => setView((v) => ({ ...v, dimension: value as UsageMapDimension }))}
            >
              {USAGE_MAP_DIMENSIONS.map((dim) => (
                <DropdownMenuRadioItem key={dim} value={dim}>
                  {USAGE_MAP_DIMENSION_LABELS[dim].menu}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(customized && 'border-primary/30 bg-primary/10 text-primary')}
            />
          }
        >
          <SlidersHorizontal aria-hidden="true" />
          Personalizar
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-4 p-4">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Secciones visibles</legend>
            {USAGE_MAP_SECTIONS.map((section) => (
              <CheckRow
                key={section.key}
                label={section.label}
                checked={!view.hidden.has(section.key)}
                onChange={(checked) =>
                  setView((v) => {
                    const hidden = new Set(v.hidden);
                    if (checked) hidden.delete(section.key);
                    else hidden.add(section.key);
                    return { ...v, hidden };
                  })
                }
              />
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Columnas</legend>
            <CheckRow
              label="Ocultar grupos sin consultas ni búsquedas"
              checked={view.hideEmpty}
              onChange={(checked) => setView((v) => ({ ...v, hideEmpty: checked }))}
            />
          </fieldset>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!customized}
            onClick={() => setView((v) => ({ ...v, hidden: new Set(), hideEmpty: true, highlighted: null }))}
          >
            <RotateCcw aria-hidden="true" />
            Restablecer vista
          </Button>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger
          render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Cómo leer los colores" />}
        >
          <Info aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-3 p-4">
          <p className="text-sm font-medium text-foreground">Cómo leer los colores</p>
          <p className="text-xs text-muted-foreground">
            Cada fila tiene su propia escala: la celda se compara con el grupo que más tiene en esa métrica. En
            «Costo por aprobada» gana el más barato. El gasto va en azul, sin semáforo.
          </p>
          <ul className="space-y-1.5">
            {USAGE_MAP_BANDS.map((band) => (
              <li key={band.tone} className="flex items-center gap-2 text-xs">
                <span className={cn('h-4 w-8 rounded-sm', USAGE_MAP_TONE_CLASS[band.tone])} aria-hidden="true" />
                <span className="font-medium text-foreground">{band.label}</span>
                <span className="text-muted-foreground">{band.range}</span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      {onExpand && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Ver en pantalla completa" onClick={onExpand}>
          <Maximize2 aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <label htmlFor={id} className="text-sm text-foreground">
        {label}
      </label>
    </div>
  );
}

// ─── Tabla ───────────────────────────────────────────────────────────────────

function isEmptyColumn(rows: readonly UsageMapRow[], index: number): boolean {
  const pick = (key: string) => rows.find((r) => r.metric.key === key)?.cells[index]?.value ?? 0;
  return pick('consultas') === 0 && pick('busquedas') === 0 && pick('revision') === 0;
}

function HeatmapTable({
  data,
  names,
  view,
  setView,
}: {
  data: UsageMapData;
  names: UsageMapNames;
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
}) {
  const matrix = data.matrices[view.dimension];
  const visibleIdx = matrix.columns
    .map((_, i) => i)
    .filter((i) => !view.hideEmpty || !isEmptyColumn(matrix.rows, i));
  const sections = USAGE_MAP_SECTIONS.filter(
    (s) => !view.hidden.has(s.key) && matrix.rows.some((r) => r.metric.section === s.key),
  );

  if (visibleIdx.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">No hay uso para mostrar con estos filtros.</p>;
  }

  const toggleSection = (key: UsageMapSection) =>
    setView((v) => {
      const open = new Set(v.open);
      if (open.has(key)) open.delete(key);
      else open.add(key);
      return { ...v, open };
    });

  return (
    <Table containerClassName="overflow-x-auto" className="border-separate border-spacing-0">
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent text-xs font-medium text-muted-foreground">
            <TableHead scope="col" className={cn(STICKY, 'w-72 min-w-72 border-b border-border px-3 py-2.5 text-left font-medium')}>
              Métrica
            </TableHead>
            <TableHead scope="col" className="w-24 border-b border-r border-border px-3 py-2.5 text-right font-medium">
              Total
            </TableHead>
            {visibleIdx.map((i) => {
              const text = usageMapColumnLabel(view.dimension, matrix.columns[i], names);
              return (
                <TableHead key={matrix.columns[i]} scope="col" title={text} className="min-w-24 max-w-36 border-b border-border px-2 py-2.5 text-center font-medium">
                  <span className="block truncate">{text}</span>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => {
            const open = view.open.has(section.key);
            // Por persona, «Personas activas» siempre vale 1: no dice nada.
            const rows = matrix.rows.filter(
              (r) => r.metric.section === section.key && !(view.dimension === 'persona' && r.metric.key === 'personas'),
            );
            return (
              <React.Fragment key={section.key}>
                <TableRow className="border-0 hover:bg-transparent has-aria-expanded:bg-transparent group/fila">
                  <TableHead scope="rowgroup" className={cn(STICKY, 'h-auto px-2 pt-3 pb-1.5 text-left')}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.key)}
                      aria-expanded={open}
                      className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-semibold text-foreground hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      <ChevronDown aria-hidden="true" className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
                      {section.label}
                      <span className="text-xs font-normal text-muted-foreground">{rows.length}</span>
                    </button>
                  </TableHead>
                  <TableCell className="border-r border-border p-0" />
                  <TableCell colSpan={visibleIdx.length} className="p-0" />
                </TableRow>
                {open &&
                  rows.map((row) => (
                    <MetricRow
                      key={row.metric.key}
                      row={row}
                      visibleIdx={visibleIdx}
                      columnLabel={(i) => usageMapColumnLabel(view.dimension, matrix.columns[i], names)}
                      dimmed={view.highlighted !== null && view.highlighted !== row.metric.key}
                      highlighted={view.highlighted === row.metric.key}
                      onHighlight={() =>
                        setView((v) => ({ ...v, highlighted: v.highlighted === row.metric.key ? null : row.metric.key }))
                      }
                    />
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
  );
}

function MetricRow({
  row,
  visibleIdx,
  columnLabel,
  dimmed,
  highlighted,
  onHighlight,
}: {
  row: UsageMapRow;
  visibleIdx: readonly number[];
  columnLabel: (index: number) => string;
  dimmed: boolean;
  highlighted: boolean;
  onHighlight: () => void;
}) {
  const values = visibleIdx.map((i) => row.cells[i].value);
  return (
    <TableRow className="border-0 hover:bg-transparent group/fila">
      <TableHead scope="row" className={cn(STICKY, 'h-auto py-0.5 pr-2 pl-9 text-left font-normal whitespace-normal')}>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-xs text-foreground" title={row.metric.hint}>
            {row.metric.label}
          </span>
          <button
            type="button"
            onClick={onHighlight}
            aria-pressed={highlighted}
            aria-label={highlighted ? `Quitar resaltado de ${row.metric.label}` : `Resaltar ${row.metric.label}`}
            className={cn(
              'rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-muted group-hover/fila:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
              highlighted && 'text-primary opacity-100',
            )}
          >
            <Target aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </TableHead>
      <TableCell className="border-r border-border px-3 py-0.5 text-right text-sm font-semibold tabular-nums text-foreground">
        {formatUsageMapValue(row.total, row.metric.format)}
      </TableCell>
      {visibleIdx.map((i) => {
        const value = row.cells[i].value;
        const tone = dimmed ? 'none' : usageMapTone(value, values, row.metric.direction);
        const text = formatUsageMapValue(value, row.metric.format);
        return (
          <TableCell key={i} className="h-9 p-0.5">
            <div
              title={`${row.metric.label} · ${columnLabel(i)}: ${text}`}
              aria-label={`${row.metric.label} · ${columnLabel(i)}: ${text}`}
              className={cn(
                'flex h-full min-h-8 items-center justify-center rounded-md text-xs font-medium tabular-nums transition-colors',
                USAGE_MAP_TONE_CLASS[tone],
                dimmed && 'opacity-60',
              )}
            >
              {text}
            </div>
          </TableCell>
        );
      })}
    </TableRow>
  );
}
