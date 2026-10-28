'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { RotateCcw, SlidersHorizontal, X } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DrawerShell } from '@/components/shared/drawer-shell';
import type { FilterOptions } from '@/modules/ai-usage/queries';
import { agentLabel, countryLabel, industryLabel, providerLabel, statusLabel } from './usage-labels';
import { agentStepLabel, searchModeLabel } from '@/modules/usage-tracking/usage-dimensions';
import {
  ALL_VALUE,
  FILTER_NAMES,
  PERIOD_OPTIONS,
  applyFilterChange,
  clearedFilters,
  countSecondaryFilters,
  describeActiveFilters,
  toQueryString,
  userLabel,
  visibleUsers,
  type UsageFilterKey,
  type UsageFilterValues,
} from './usage-filters-core';

// Sangría por nivel del desplegable de grupos, para que la jerarquía se lea
// igual que en «Usuarios y grupos» (raíz = 0).
const GROUP_INDENT_STEP_PX = 16;

const SELECT_WIDTH = 'w-full sm:w-44';

interface SelectOption {
  value: string;
  label: string;
  indent?: number;
}

interface UsageSelectProps {
  filterKey: UsageFilterKey;
  value: string;
  /** Texto de «sin filtrar»: «Todos los proveedores». */
  allLabel: string;
  options: readonly SelectOption[];
  /** El valor puesto ya no existe (enlace viejo): qué decir en su lugar. */
  missingLabel: string;
  onChange: (key: UsageFilterKey, value: string | null) => void;
  /** En el panel de filtros: con su nombre encima y a todo el ancho. */
  labeled?: boolean;
}

function UsageSelect({ filterKey, value, allLabel, options, missingLabel, onChange, labeled = false }: UsageSelectProps) {
  // Base UI pinta el valor crudo si no encuentra etiqueta; se resuelve aquí para
  // que nunca asome un identificador.
  const triggerLabel = (current: string) => {
    if (!current || current === ALL_VALUE) return allLabel;
    return options.find((option) => option.value === current)?.label ?? missingLabel;
  };

  const select = (
    <Select value={value || ALL_VALUE} onValueChange={(next) => onChange(filterKey, next as string | null)}>
      <SelectTrigger size={labeled ? 'default' : 'sm'} className={labeled ? 'w-full' : SELECT_WIDTH} aria-label={FILTER_NAMES[filterKey]}>
        <SelectValue placeholder={FILTER_NAMES[filterKey]}>{triggerLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.indent ? (
              <span style={{ paddingLeft: `${option.indent * GROUP_INDENT_STEP_PX}px` }}>{option.label}</span>
            ) : (
              option.label
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (!labeled) return select;
  return (
    <div className="grid gap-1.5">
      <span aria-hidden="true" className="text-sm font-medium text-foreground">
        {FILTER_NAMES[filterKey]}
      </span>
      {select}
    </div>
  );
}

interface UsageFilterBarProps {
  options: FilterOptions;
  values: UsageFilterValues;
  /** Recibe los filtros ya resueltos (con las combinaciones imposibles quitadas). */
  onChange: (next: UsageFilterValues) => void;
}

/**
 * Los filtros de /ai-usage filtran TODA la página (cifras, gráficos y las ocho
 * pestañas), así que van en la cabecera: el periodo a la vista y «Filtros», que
 * abre un panel lateral con el resto (el caso «Filtros» de los paneles de UBITS).
 * Cada tabla conserva su propio buscador en su franja gris, sólo para ella.
 *
 * No toca la URL: pinta `values` y avisa con `onChange`.
 */
export function UsageFilterControls({ options, values, onChange }: UsageFilterBarProps) {
  const secondaryCount = countSecondaryFilters(values);
  const [isOpen, setIsOpen] = useState(false);

  const change = useCallback(
    (key: UsageFilterKey, value: string | null) => {
      onChange(applyFilterChange(values, key, value, options));
    },
    [onChange, values, options],
  );

  const users = useMemo(() => visibleUsers(values, options), [values, options]);
  const periodOptions = PERIOD_OPTIONS.filter((option) => option.value !== ALL_VALUE);

  return (
    <>
      <UsageSelect
        filterKey="period"
        value={values.period}
        allLabel={PERIOD_OPTIONS[0].label}
        options={periodOptions}
        missingLabel="Periodo no válido"
        onChange={change}
      />
      <Button type="button" variant="outline" size="sm" aria-expanded={isOpen} onClick={() => setIsOpen(true)}>
        <SlidersHorizontal aria-hidden="true" />
        Filtros
        {secondaryCount > 0 && (
          <Badge
            variant="brand"
            aria-label={`${secondaryCount} aplicado${secondaryCount !== 1 ? 's' : ''}`}
            className="tabular-nums"
          >
            {secondaryCount}
          </Badge>
        )}
      </Button>

      <DrawerShell
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Filtros"
        description="Cambian las cifras, los gráficos y todas las pestañas."
        icon={<SlidersHorizontal className="size-5" aria-hidden="true" />}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={secondaryCount === 0}
              onClick={() => onChange({ ...clearedFilters(), period: values.period })}
            >
              Limpiar filtros
            </Button>
            <Button type="button" onClick={() => setIsOpen(false)}>
              Listo
            </Button>
          </>
        }
      >
        <div role="group" aria-label="Filtros de la página" className="grid gap-4">
          {options.providers.length > 0 && (
            <UsageSelect
              filterKey="provider"
              value={values.provider}
              allLabel="Todos los proveedores"
              options={options.providers.map((key) => ({ value: key, label: providerLabel(key) }))}
              missingLabel="Proveedor no encontrado"
              onChange={change}
              labeled
            />
          )}
          {options.agents.length > 0 && (
            <UsageSelect
              filterKey="agent"
              value={values.agent}
              allLabel="Todos los agentes"
              options={options.agents.map((agent) => ({ value: agent.key, label: agentLabel(agent.key, agent.name) }))}
              missingLabel="Agente no encontrado"
              onChange={change}
              labeled
            />
          )}
          {options.statuses.length > 0 && (
            <UsageSelect
              filterKey="status"
              value={values.status}
              allLabel="Todos los estados"
              options={options.statuses.map((status) => ({ value: status, label: statusLabel(status) }))}
              missingLabel="Estado no encontrado"
              onChange={change}
              labeled
            />
          )}
          {options.roles.length > 0 && (
            <UsageSelect
              filterKey="role"
              value={values.role}
              allLabel="Todos los roles"
              options={options.roles.map((role) => ({ value: role.key, label: role.label }))}
              missingLabel="Rol no encontrado"
              onChange={change}
              labeled
            />
          )}
          {options.groups.length > 0 && (
            <UsageSelect
              filterKey="groupId"
              value={values.groupId}
              allLabel="Todos los grupos"
              options={options.groups.map((group) => ({ value: group.id, label: group.name, indent: group.depth }))}
              missingLabel="Grupo no encontrado"
              onChange={change}
              labeled
            />
          )}
          {options.users.length > 0 && (
            <UsageSelect
              filterKey="user"
              value={values.user}
              allLabel="Todas las personas"
              options={users.map((user) => ({ value: user.id, label: userLabel(user) }))}
              missingLabel="Persona no encontrada"
              onChange={change}
              labeled
            />
          )}
          {(options.countries?.length ?? 0) > 0 && (
            <UsageSelect
              filterKey="country"
              value={values.country}
              allLabel="Todos los países"
              options={(options.countries ?? []).map((code) => ({ value: code, label: countryLabel(code) }))}
              missingLabel="País no encontrado"
              onChange={change}
              labeled
            />
          )}
          {(options.industries?.length ?? 0) > 0 && (
            <UsageSelect
              filterKey="industry"
              value={values.industry}
              allLabel="Todas las industrias"
              options={(options.industries ?? []).map((key) => ({ value: key, label: industryLabel(key) }))}
              missingLabel="Industria no encontrada"
              onChange={change}
              labeled
            />
          )}
          {(options.steps?.length ?? 0) > 0 && (
            <UsageSelect
              filterKey="step"
              value={values.step}
              allLabel="Todos los pasos"
              options={(options.steps ?? []).map((step) => ({ value: step, label: agentStepLabel(step) }))}
              missingLabel="Paso no encontrado"
              onChange={change}
              labeled
            />
          )}
          {(options.modes?.length ?? 0) > 0 && (
            <UsageSelect
              filterKey="mode"
              value={values.mode}
              allLabel="Todas las formas"
              options={(options.modes ?? []).map((mode) => ({ value: mode, label: searchModeLabel(mode) }))}
              missingLabel="Forma no encontrada"
              onChange={change}
              labeled
            />
          )}
        </div>
      </DrawerShell>
    </>
  );
}

/**
 * Los filtros puestos, como etiquetas bajo la cabecera: así siempre se ve con qué
 * datos se está mirando la página. Se quitan de uno en uno o todos; «Limpiar
 * filtros» respeta el periodo, que tiene su propio control en la cabecera.
 */
export function UsageActiveFilters({ options, values, onChange }: UsageFilterBarProps) {
  const active = useMemo(
    () => describeActiveFilters(values, options).filter((filter) => filter.key !== 'period'),
    [values, options],
  );
  if (active.length === 0) return null;

  return (
    <div role="group" aria-label="Filtros aplicados" className="flex flex-wrap items-center gap-2">
      {active.map((filter) => (
        <Badge key={filter.key} variant="secondary" className="h-7 gap-1 pr-1 pl-2">
          <span className="mr-1 text-muted-foreground">{filter.label}:</span>
          <span className="font-medium">{filter.value}</span>
          <button
            type="button"
            aria-label={`Remover filtro ${filter.label}`}
            title={`Remover filtro ${filter.label}`}
            onClick={() => onChange(applyFilterChange(values, filter.key, null, options))}
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
        onClick={() => onChange({ ...clearedFilters(), period: values.period })}
        className="text-primary hover:text-primary"
      >
        <RotateCcw className="size-3" />
        Limpiar filtros
      </Button>
    </div>
  );
}

/** Los dos juntos (la cabecera y sus etiquetas), para probarlos como una pieza. */
export function UsageFilterBar(props: UsageFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <UsageFilterControls {...props} />
      </div>
      <UsageActiveFilters {...props} />
    </div>
  );
}

interface FiltersClientProps {
  options: FilterOptions;
  values: UsageFilterValues;
  /** `controls`: el periodo y «Filtros», en la cabecera. `chips`: los puestos, debajo. */
  part: 'controls' | 'chips';
}

/** Conecta los filtros con la URL: siguen viviendo en los query params. */
export function FiltersClient({ options, values, part }: FiltersClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (next: UsageFilterValues) => {
      const query = toQueryString(searchParams.toString(), next);
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [router, pathname, searchParams],
  );

  return part === 'controls' ? (
    <UsageFilterControls options={options} values={values} onChange={handleChange} />
  ) : (
    <UsageActiveFilters options={options} values={values} onChange={handleChange} />
  );
}
