"use client";

// TABLEROS-1 — Los filtros de /dashboards. Filtran TODA la página (cifras,
// gráficos y pestañas), así que van en la cabecera: el periodo y el agrupado a
// la vista y «Filtros», que abre un panel con equipos, personas, fuentes y
// países (el caso «Filtros» de los paneles de UBITS). Viven en la URL.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { RotateCcw, SlidersHorizontal, X } from "@/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DrawerShell } from "@/components/shared/drawer-shell";
import { CheckboxFilterList } from "@/components/filters/checkbox-filter-button";
import { DateRangePicker } from "@/components/date";
import {
  DASHBOARDS_LAUNCH_DAY,
  DEFAULT_DASHBOARD_FILTERS,
  GRANULARITIES,
  GRANULARITY_LABELS,
  PERIOD_PRESETS,
  PERIOD_PRESET_LABELS,
  toDashboardQuery,
  type DashboardFilters,
  type Granularity,
  type PeriodPreset,
} from "@/modules/dashboards/dashboard-filters";
import type { DashboardScopeKind, DirectoryGroup, DirectoryUser } from "@/modules/dashboards/dashboard-scope";

export interface FilterOption {
  value: string;
  label: string;
}

export interface DashboardFilterOptions {
  scopeKind: DashboardScopeKind;
  users: readonly DirectoryUser[];
  groups: readonly DirectoryGroup[];
  sources: readonly FilterOption[];
  countries: readonly FilterOption[];
}

interface FilterProps {
  options: DashboardFilterOptions;
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
}

function parseIsoDay(value: string | null): Date | undefined {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIsoDay(date: Date | undefined): string | null {
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Las personas que se pueden elegir con los equipos puestos (un equipo abarca sus subequipos). */
export function peopleForTeams(
  users: readonly DirectoryUser[],
  groups: readonly DirectoryGroup[],
  teams: readonly string[],
): DirectoryUser[] {
  if (teams.length === 0) return [...users];
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (!group.parentGroupId) continue;
    children.set(group.parentGroupId, [...(children.get(group.parentGroupId) ?? []), group.id]);
  }
  const inScope = new Set<string>();
  const pending = [...teams];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (inScope.has(id)) continue;
    inScope.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return users.filter((user) => user.groupId !== null && inScope.has(user.groupId));
}

function countSecondary(filters: DashboardFilters): number {
  return (
    filters.teams.length +
    filters.people.length +
    filters.sources.length +
    filters.countries.length +
    (filters.sourceView === "grouped" ? 1 : 0)
  );
}

function FilterSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function DashboardFilterControls({ options, filters, onChange }: FilterProps) {
  const [open, setOpen] = React.useState(false);
  const secondary = countSecondary(filters);
  const canPickPeople = options.scopeKind !== "self";
  const people = React.useMemo(
    () => peopleForTeams(options.users, options.groups, filters.teams),
    [options.users, options.groups, filters.teams],
  );

  const setPeriod = (value: string | null) => {
    const period = (PERIOD_PRESETS as readonly string[]).includes(value ?? "")
      ? (value as PeriodPreset)
      : DEFAULT_DASHBOARD_FILTERS.period;
    onChange({ ...filters, period, customFrom: null, customTo: null });
  };

  return (
    <>
      <Select value={filters.period} onValueChange={(value) => setPeriod(value as string | null)}>
        <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Periodo">
          <SelectValue placeholder="Periodo">
            {(value: string) => PERIOD_PRESET_LABELS[value as PeriodPreset] ?? "Periodo"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PERIOD_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {PERIOD_PRESET_LABELS[preset]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filters.period === "custom" && (
        <DateRangePicker
          className="w-full sm:w-64"
          placeholder="Elige el rango"
          value={{ from: parseIsoDay(filters.customFrom), to: parseIsoDay(filters.customTo) }}
          minDate={parseIsoDay(DASHBOARDS_LAUNCH_DAY)}
          maxDate={new Date()}
          onChange={(range) =>
            onChange({ ...filters, customFrom: toIsoDay(range?.from), customTo: toIsoDay(range?.to ?? range?.from) })
          }
        />
      )}

      <Select
        value={filters.granularity}
        onValueChange={(value) =>
          onChange({
            ...filters,
            granularity: (GRANULARITIES as readonly string[]).includes(value as string)
              ? (value as Granularity)
              : DEFAULT_DASHBOARD_FILTERS.granularity,
          })
        }
      >
        <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Agrupar el tiempo">
          <SelectValue placeholder="Agrupar">
            {(value: string) => GRANULARITY_LABELS[value as Granularity] ?? "Agrupar"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {GRANULARITIES.map((granularity) => (
            <SelectItem key={granularity} value={granularity}>
              {GRANULARITY_LABELS[granularity]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" />
        Filtros
        {secondary > 0 && (
          <Badge variant="brand" className="tabular-nums" aria-label={`${secondary} aplicado${secondary !== 1 ? "s" : ""}`}>
            {secondary}
          </Badge>
        )}
      </Button>

      <DrawerShell
        open={open}
        onOpenChange={setOpen}
        title="Filtros"
        description="Cambian las cifras, los gráficos y todas las pestañas."
        icon={<SlidersHorizontal className="size-5" aria-hidden="true" />}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={secondary === 0}
              onClick={() => onChange({ ...filters, teams: [], people: [], sources: [], countries: [], sourceView: "split" })}
            >
              Limpiar filtros
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Listo
            </Button>
          </>
        }
      >
        <div role="group" aria-label="Filtros de los tableros" className="grid gap-5">
          {canPickPeople && options.groups.length > 0 && (
            <FilterSection title="Equipos" hint="Un equipo incluye sus subequipos">
              <CheckboxFilterList
                ariaLabel="Filtrar por equipo"
                className="max-h-56 overflow-y-auto rounded-md border border-border/60 p-1"
                // La sangría del organigrama («Usuarios y grupos») se lee con rayas: «— Ventas Colombia».
                options={options.groups.map((group) => ({ value: group.id, label: `${"— ".repeat(group.depth)}${group.name}` }))}
                selected={filters.teams}
                onToggle={(value) => {
                  const teams = toggle(filters.teams, value);
                  const allowed = new Set(peopleForTeams(options.users, options.groups, teams).map((user) => user.id));
                  onChange({ ...filters, teams, people: filters.people.filter((id) => allowed.has(id)) });
                }}
              />
            </FilterSection>
          )}

          {canPickPeople && people.length > 0 && (
            <FilterSection title="Personas" hint={filters.people.length > 1 ? "Con 2 a 8 se comparan" : undefined}>
              <CheckboxFilterList
                ariaLabel="Filtrar por persona"
                className="max-h-64 overflow-y-auto rounded-md border border-border/60 p-1"
                options={people.map((user) => ({ value: user.id, label: user.name }))}
                selected={filters.people}
                onToggle={(value) => onChange({ ...filters, people: toggle(filters.people, value) })}
              />
            </FilterSection>
          )}

          <FilterSection title="Fuentes" hint="Sin marcar, cuentan todas">
            <CheckboxFilterList
              ariaLabel="Filtrar por fuente"
              className="max-h-56 overflow-y-auto rounded-md border border-border/60 p-1"
              options={options.sources}
              selected={filters.sources}
              onToggle={(value) => onChange({ ...filters, sources: toggle(filters.sources, value) })}
            />
            <div className="grid gap-1.5 pt-1">
              <span className="text-sm text-foreground">Cómo se ven las fuentes</span>
              <Select
                value={filters.sourceView}
                onValueChange={(value) => onChange({ ...filters, sourceView: value === "grouped" ? "grouped" : "split" })}
              >
                <SelectTrigger className="w-full" aria-label="Cómo se ven las fuentes">
                  <SelectValue>
                    {(value: string) => (value === "grouped" ? "Agrupadas, como una sola" : "Una a una")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="split">Una a una</SelectItem>
                  <SelectItem value="grouped">Agrupadas, como una sola</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </FilterSection>

          {options.countries.length > 0 && (
            <FilterSection title="Países">
              <CheckboxFilterList
                ariaLabel="Filtrar por país"
                className="max-h-56 overflow-y-auto rounded-md border border-border/60 p-1"
                options={options.countries}
                selected={filters.countries}
                onToggle={(value) => onChange({ ...filters, countries: toggle(filters.countries, value) })}
              />
            </FilterSection>
          )}
        </div>
      </DrawerShell>
    </>
  );
}

interface ActiveChip {
  id: string;
  label: string;
  value: string;
  remove: (filters: DashboardFilters) => DashboardFilters;
}

function activeChips(options: DashboardFilterOptions, filters: DashboardFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const userName = (id: string) => options.users.find((user) => user.id === id)?.name ?? "Persona fuera de tu alcance";
  const groupName = (id: string) => options.groups.find((group) => group.id === id)?.name ?? "Equipo fuera de tu alcance";
  const label = (list: readonly FilterOption[], value: string) => list.find((option) => option.value === value)?.label ?? value;

  for (const id of filters.teams) {
    chips.push({ id: `team:${id}`, label: "Equipo", value: groupName(id), remove: (f) => ({ ...f, teams: f.teams.filter((v) => v !== id) }) });
  }
  for (const id of filters.people) {
    chips.push({ id: `person:${id}`, label: "Persona", value: userName(id), remove: (f) => ({ ...f, people: f.people.filter((v) => v !== id) }) });
  }
  for (const key of filters.sources) {
    chips.push({
      id: `source:${key}`,
      label: "Fuente",
      value: label(options.sources, key),
      remove: (f) => ({ ...f, sources: f.sources.filter((v) => v !== key) }),
    });
  }
  for (const code of filters.countries) {
    chips.push({
      id: `country:${code}`,
      label: "País",
      value: label(options.countries, code),
      remove: (f) => ({ ...f, countries: f.countries.filter((v) => v !== code) }),
    });
  }
  if (filters.sourceView === "grouped") {
    chips.push({ id: "source-view", label: "Fuentes", value: "Agrupadas", remove: (f) => ({ ...f, sourceView: "split" }) });
  }
  return chips;
}

export function DashboardActiveFilters({ options, filters, onChange }: FilterProps) {
  const chips = activeChips(options, filters);
  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label="Filtros aplicados" className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Badge key={chip.id} variant="secondary" className="h-7 gap-1 pr-1 pl-2">
          <span className="mr-1 text-muted-foreground">{chip.label}:</span>
          <span className="font-medium">{chip.value}</span>
          <button
            type="button"
            aria-label={`Quitar filtro ${chip.label} ${chip.value}`}
            title={`Quitar filtro ${chip.label}`}
            onClick={() => onChange(chip.remove(filters))}
            className="ml-1 rounded-xs p-0.5 outline-none hover:bg-surface-muted focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onChange({ ...filters, teams: [], people: [], sources: [], countries: [], sourceView: "split" })}
        className="text-primary hover:text-primary"
      >
        <RotateCcw className="size-3" />
        Limpiar filtros
      </Button>
    </div>
  );
}

/** Conecta los filtros con la URL. `controls`: en la cabecera. `chips`: los puestos, debajo. */
export function DashboardFiltersClient({
  options,
  filters,
  part,
}: {
  options: DashboardFilterOptions;
  filters: DashboardFilters;
  part: "controls" | "chips";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handleChange = React.useCallback(
    (next: DashboardFilters) => {
      const query = toDashboardQuery(searchParams.toString(), next);
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return part === "controls" ? (
    <DashboardFilterControls options={options} filters={filters} onChange={handleChange} />
  ) : (
    <DashboardActiveFilters options={options} filters={filters} onChange={handleChange} />
  );
}
