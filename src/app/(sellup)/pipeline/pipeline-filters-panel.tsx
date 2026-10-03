"use client";

import * as React from "react";
import { ChevronDown, ListFilter, Search } from "@/icons";
import { cn } from "@/lib/utils";
import { formatAppDate } from "@/lib/format-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Text } from "@/components/typography";
import { DateRangePicker } from "@/components/date/date-range-picker";
import { ActiveFilterChips, type ActiveFilterChip } from "@/components/filters/active-filter-chips";
import { CheckboxFilterList, type CheckboxFilterOption } from "@/components/filters/checkbox-filter-button";
import { countryFlag, countryName } from "@/components/shared/table-cells";
import {
  DATE_PRESETS,
  EMPTY_PIPELINE_FILTERS,
  NONE_VALUE,
  countActiveFilters,
  countFilterOptions,
  hasDateFilter,
  type PipelineDateField,
  type PipelineDatePreset,
  type PipelineFilters,
  type PipelineInactivity,
} from "@/modules/pipeline/pipeline-filters";
import { PIPELINE_STAGE_IDS } from "@/modules/pipeline/stages";
import type { PipelineOverviewAccount, PipelineSignalId, PipelineStageId } from "@/modules/pipeline/types";
import { SIGNAL_FILTER_LABELS, STAGE_SHORT_LABELS } from "./pipeline-copy";

// ── Rótulos ─────────────────────────────────────────────────────

/** Con más opciones que estas, el grupo trae su buscador. */
const GROUP_SEARCH_THRESHOLD = 8;

const DATE_FIELD_LABELS: Record<PipelineDateField, string> = {
  mov: "Último movimiento",
  entrada: "Entrada al pipeline",
};

const DATE_FIELD_CHIP: Record<PipelineDateField, string> = { mov: "Último movimiento", entrada: "Entrada" };

const DATE_PRESET_LABELS: Record<PipelineDatePreset, string> = {
  hoy: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
};

const INACTIVITY_LABELS: Record<string, string> = {
  "7": "7 días o más",
  "14": "14 días o más",
  "21": "21 días o más",
  none: "Sin riesgo",
};

/** Cómo se dice cada fallo de IA como filtro. Uno por agente que exista. */
const AI_FAILURE_LABELS: Partial<Record<PipelineSignalId, string>> = {
  corrida_fallida: "Última búsqueda de contactos fallida",
};

export function countryFilterLabel(code: string): string {
  if (code === NONE_VALUE) return "Sin país";
  return `${countryFlag(code)} ${countryName(code) ?? code}`.trim();
}

export function industryFilterLabel(value: string): string {
  return value === NONE_VALUE ? "Sin industria" : value;
}

function inactivityChip(value: PipelineInactivity): string {
  return value === "none" ? "Inactividad: sin riesgo" : `Inactividad: ${value}+ días`;
}

/** El día `AAAA-MM-DD` de una fecha elegida en el calendario (el día que la persona ve). */
function toDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDayKey(key: string | null): Date | undefined {
  if (!key) return undefined;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Un día `AAAA-MM-DD` como fecha legible, sin que la zona lo mueva de día. */
function dayLabel(key: string): string {
  return formatAppDate(`${key}T12:00:00Z`);
}

function dateChip(filters: PipelineFilters): string {
  const field = DATE_FIELD_CHIP[filters.dateField];
  if (filters.datePreset) return `${field}: ${DATE_PRESET_LABELS[filters.datePreset].toLowerCase()}`;
  if (filters.from && filters.to) return `${field}: ${dayLabel(filters.from)} – ${dayLabel(filters.to)}`;
  if (filters.from) return `${field}: desde ${dayLabel(filters.from)}`;
  return `${field}: hasta ${dayLabel(filters.to as string)}`;
}

/** Los filtros puestos como chips quitables, en el orden de los grupos. */
export function describeActiveFilters(
  filters: PipelineFilters,
  onChange: (next: PipelineFilters) => void,
): ActiveFilterChip[] {
  const without = <T,>(list: readonly T[], value: T) => list.filter((item) => item !== value);
  const chips: ActiveFilterChip[] = [];

  for (const stage of filters.stages) {
    chips.push({
      key: `etapa:${stage}`,
      label: `Etapa: ${STAGE_SHORT_LABELS[stage]}`,
      onRemove: () => onChange({ ...filters, stages: without(filters.stages, stage) }),
    });
  }
  for (const country of filters.countries) {
    chips.push({
      key: `pais:${country}`,
      label: country === NONE_VALUE ? "País: sin país" : `País: ${countryName(country) ?? country}`,
      onRemove: () => onChange({ ...filters, countries: without(filters.countries, country) }),
    });
  }
  for (const industry of filters.industries) {
    chips.push({
      key: `industria:${industry}`,
      label: industry === NONE_VALUE ? "Industria: sin industria" : `Industria: ${industry}`,
      onRemove: () => onChange({ ...filters, industries: without(filters.industries, industry) }),
    });
  }
  if (hasDateFilter(filters)) {
    chips.push({
      key: "fecha",
      label: dateChip(filters),
      onRemove: () => onChange({ ...filters, datePreset: null, from: null, to: null }),
    });
  }
  if (filters.inactivity !== null) {
    chips.push({
      key: "inactividad",
      label: inactivityChip(filters.inactivity),
      onRemove: () => onChange({ ...filters, inactivity: null }),
    });
  }
  for (const failure of filters.aiFailures) {
    chips.push({
      key: `fallo:${failure}`,
      label: "Fallo de IA",
      onRemove: () => onChange({ ...filters, aiFailures: without(filters.aiFailures, failure) }),
    });
  }
  for (const signal of filters.signals) {
    chips.push({
      key: `senal:${signal}`,
      label: `Señal: ${SIGNAL_FILTER_LABELS[signal]}`,
      onRemove: () => onChange({ ...filters, signals: without(filters.signals, signal) }),
    });
  }
  return chips;
}

// ── Panel ───────────────────────────────────────────────────────

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} data-slot="filter-group" className="flex flex-col gap-1 px-1.5 py-2.5">
      <h3 className="px-2.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Marca o desmarca un valor conservando el orden de las opciones. */
function toggleIn<T extends string>(selected: readonly T[], value: T, order: readonly T[]): T[] {
  const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
  return order.filter((item) => next.includes(item));
}

interface FiltersPanelProps {
  accounts: readonly PipelineOverviewAccount[];
  filters: PipelineFilters;
  onChange: (next: PipelineFilters) => void;
}

function FiltersPanel({ accounts, filters, onChange }: FiltersPanelProps) {
  const options = React.useMemo(() => countFilterOptions(accounts), [accounts]);
  const [industrySearch, setIndustrySearch] = React.useState("");

  const stageOptions: CheckboxFilterOption[] = options.stages.map((option) => ({
    value: option.value,
    label: STAGE_SHORT_LABELS[option.value],
    count: option.count,
  }));
  const countryOptions: CheckboxFilterOption[] = options.countries.map((option) => ({
    value: option.value,
    label: countryFilterLabel(option.value),
    count: option.count,
  }));
  const needle = industrySearch.trim().toLowerCase();
  const industryOptions: CheckboxFilterOption[] = options.industries
    .map((option) => ({ value: option.value, label: industryFilterLabel(option.value), count: option.count }))
    .filter((option) => !needle || option.label.toLowerCase().includes(needle));
  const inactivityOptions: CheckboxFilterOption[] = options.inactivity.map((option) => ({
    value: String(option.value),
    label: INACTIVITY_LABELS[String(option.value)],
    count: option.count,
  }));
  const signalOptions: CheckboxFilterOption[] = options.signals.map((option) => ({
    value: option.value,
    label: SIGNAL_FILTER_LABELS[option.value],
    count: option.count,
  }));
  // Los fallos de IA van por etapa (por agente): hoy solo existe el del Agente 2A.
  const failureStages = [...new Set(options.aiFailures.map((option) => option.stageId))];

  return (
    <div className="flex max-h-[min(50dvh,30rem)] flex-col divide-y divide-border/60 overflow-y-auto">
      <FilterGroup title="Etapa">
        <CheckboxFilterList
          ariaLabel="Filtrar por etapa"
          options={stageOptions}
          selected={filters.stages}
          onToggle={(value) =>
            onChange({ ...filters, stages: toggleIn(filters.stages, value as PipelineStageId, PIPELINE_STAGE_IDS) })
          }
        />
      </FilterGroup>

      <FilterGroup title="País">
        <CheckboxFilterList
          ariaLabel="Filtrar por país"
          options={countryOptions}
          selected={filters.countries}
          onToggle={(value) =>
            onChange({
              ...filters,
              countries: toggleIn(filters.countries, value, options.countries.map((option) => option.value)),
            })
          }
        />
      </FilterGroup>

      <FilterGroup title="Industria">
        {options.industries.length > GROUP_SEARCH_THRESHOLD && (
          <div className="relative px-2.5 pb-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={industrySearch}
              onChange={(event) => setIndustrySearch(event.target.value)}
              placeholder="Buscar industria"
              aria-label="Buscar industria"
              inputSize="sm"
              className="pl-7"
            />
          </div>
        )}
        {industryOptions.length === 0 ? (
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Ninguna industria coincide.</p>
        ) : (
          <CheckboxFilterList
            ariaLabel="Filtrar por industria"
            options={industryOptions}
            selected={filters.industries}
            onToggle={(value) =>
              onChange({
                ...filters,
                industries: toggleIn(filters.industries, value, options.industries.map((option) => option.value)),
              })
            }
          />
        )}
      </FilterGroup>

      <FilterGroup title="Fecha">
        <div className="flex flex-col gap-2 px-2.5 pt-1">
          <div role="radiogroup" aria-label="Sobre qué fecha se filtra" className="flex flex-wrap gap-1.5">
            {(Object.keys(DATE_FIELD_LABELS) as PipelineDateField[]).map((field) => (
              <Button
                key={field}
                type="button"
                role="radio"
                aria-checked={filters.dateField === field}
                variant={filters.dateField === field ? "secondary" : "ghost"}
                size="xs"
                onClick={() => onChange({ ...filters, dateField: field })}
              >
                {DATE_FIELD_LABELS[field]}
              </Button>
            ))}
          </div>
          <div role="group" aria-label="Periodo" className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((preset) => {
              const isActive = filters.datePreset === preset;
              return (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-pressed={isActive}
                  className={cn(isActive && "border-primary/30 bg-primary/10 text-primary")}
                  onClick={() => onChange({ ...filters, datePreset: isActive ? null : preset, from: null, to: null })}
                >
                  {DATE_PRESET_LABELS[preset]}
                </Button>
              );
            })}
          </div>
          <DateRangePicker
            placeholder="Rango de fechas"
            value={
              filters.from || filters.to ? { from: fromDayKey(filters.from), to: fromDayKey(filters.to) } : null
            }
            onChange={(range) =>
              onChange({
                ...filters,
                datePreset: null,
                from: range?.from ? toDayKey(range.from) : null,
                to: range?.to ? toDayKey(range.to) : null,
              })
            }
          />
        </div>
      </FilterGroup>

      <FilterGroup title="Riesgo por inactividad">
        {/* Excluyentes: marcar uno sustituye al anterior; volver a pulsarlo lo quita. */}
        <CheckboxFilterList
          ariaLabel="Filtrar por inactividad"
          options={inactivityOptions}
          selected={filters.inactivity === null ? [] : [String(filters.inactivity)]}
          onToggle={(value) => {
            const next: PipelineInactivity = value === "none" ? "none" : (Number(value) as 7 | 14 | 21);
            onChange({ ...filters, inactivity: filters.inactivity === next ? null : next });
          }}
        />
      </FilterGroup>

      <FilterGroup title="Fallos de IA">
        {failureStages.map((stageId) => (
          <div key={stageId} className="flex flex-col">
            <p className="px-2.5 pt-1 text-xs text-text-muted">{STAGE_SHORT_LABELS[stageId]}</p>
            <CheckboxFilterList
              ariaLabel={`Fallos de IA en ${STAGE_SHORT_LABELS[stageId]}`}
              options={options.aiFailures
                .filter((option) => option.stageId === stageId)
                .map((option) => ({
                  value: option.value,
                  label: AI_FAILURE_LABELS[option.value] ?? SIGNAL_FILTER_LABELS[option.value],
                  count: option.count,
                }))}
              selected={filters.aiFailures}
              onToggle={(value) =>
                onChange({
                  ...filters,
                  aiFailures: toggleIn(
                    filters.aiFailures,
                    value as PipelineSignalId,
                    options.aiFailures.map((option) => option.value),
                  ),
                })
              }
            />
          </div>
        ))}
      </FilterGroup>

      <FilterGroup title="Otras señales">
        <CheckboxFilterList
          ariaLabel="Filtrar por señal"
          options={signalOptions}
          selected={filters.signals}
          onToggle={(value) =>
            onChange({
              ...filters,
              signals: toggleIn(
                filters.signals,
                value as PipelineSignalId,
                options.signals.map((option) => option.value),
              ),
            })
          }
        />
      </FilterGroup>
    </div>
  );
}

// ── Barra de filtros ────────────────────────────────────────────

export interface PipelineFilterBarProps {
  /** TODAS las empresas: las opciones y sus conteos se calculan sobre el total. */
  accounts: readonly PipelineOverviewAccount[];
  filters: PipelineFilters;
  onChange: (next: PipelineFilters) => void;
  /** Cuántas quedan a la vista tras filtrar (y buscar). */
  visibleCount: number;
  className?: string;
}

/**
 * La barra de filtros del Pipeline: UN botón «Filtros · n» que abre el panel
 * con todos los grupos (etapa, país, industria, fecha, inactividad, fallos de
 * IA, otras señales), el contador «N de M empresas» y, debajo, los filtros
 * puestos como chips quitables. La usan el panel de empresas y el tablero, con
 * el mismo estado.
 */
export function PipelineFilterBar({ accounts, filters, onChange, visibleCount, className }: PipelineFilterBarProps) {
  const activeCount = countActiveFilters(filters);
  const chips = describeActiveFilters(filters, onChange);
  const clearAll = () => onChange({ ...EMPTY_PIPELINE_FILTERS, dateField: filters.dateField });

  return (
    <div data-slot="pipeline-filter-bar" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                data-active={activeCount > 0 || undefined}
                className={cn(activeCount > 0 && "border-primary/30 bg-primary/10 text-primary")}
              />
            }
          >
            <ListFilter aria-hidden />
            {activeCount > 0 ? `Filtros · ${activeCount}` : "Filtros"}
            <ChevronDown aria-hidden className="text-text-muted" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-80 max-w-[calc(100vw-2rem)] p-0">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
              <p className="text-sm font-semibold text-foreground">Filtros</p>
              {activeCount > 0 && (
                <Button type="button" variant="ghost" size="xs" className="text-primary" onClick={clearAll}>
                  Limpiar todo
                </Button>
              )}
            </div>
            <FiltersPanel accounts={accounts} filters={filters} onChange={onChange} />
          </PopoverContent>
        </Popover>
        <Text size="xs" tone="muted" aria-live="polite" data-slot="pipeline-filter-count">
          {visibleCount === accounts.length
            ? accounts.length === 1
              ? "1 empresa"
              : `${accounts.length} empresas`
            : `${visibleCount} de ${accounts.length} empresas`}
        </Text>
      </div>

      <ActiveFilterChips chips={chips} onClearAll={clearAll} />
    </div>
  );
}
