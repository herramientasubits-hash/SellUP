'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';
import { SlidersHorizontal } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterBar, type ActiveFilter } from '@/components/filters/filter-bar';
import type { FilterOptions } from '@/modules/ai-usage/queries';
import { agentLabel, providerLabel, statusLabel } from './usage-labels';
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
}

function UsageSelect({ filterKey, value, allLabel, options, missingLabel, onChange }: UsageSelectProps) {
  // Base UI pinta el valor crudo si no encuentra etiqueta; se resuelve aquí para
  // que nunca asome un identificador.
  const triggerLabel = (current: string) => {
    if (!current || current === ALL_VALUE) return allLabel;
    return options.find((option) => option.value === current)?.label ?? missingLabel;
  };

  return (
    <Select value={value || ALL_VALUE} onValueChange={(next) => onChange(filterKey, next as string | null)}>
      <SelectTrigger size="sm" className={SELECT_WIDTH} aria-label={FILTER_NAMES[filterKey]}>
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
}

interface UsageFilterBarProps {
  options: FilterOptions;
  values: UsageFilterValues;
  /** Recibe los filtros ya resueltos (con las combinaciones imposibles quitadas). */
  onChange: (next: UsageFilterValues) => void;
}

/**
 * La barra de filtros de /ai-usage (FilterBar de Thema): el periodo siempre a
 * la vista, el resto detrás de «Más filtros» con su contador, y debajo esos
 * filtros como etiquetas que se quitan de una en una. «Limpiar filtros» quita
 * las etiquetas y respeta el periodo, que tiene su propio control.
 *
 * No toca la URL: pinta `values` y avisa con `onChange`.
 */
export function UsageFilterBar({ options, values, onChange }: UsageFilterBarProps) {
  const secondaryCount = countSecondaryFilters(values);
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();

  const change = useCallback(
    (key: UsageFilterKey, value: string | null) => {
      onChange(applyFilterChange(values, key, value, options));
    },
    [onChange, values, options],
  );

  const activeFilters: ActiveFilter[] = useMemo(
    () =>
      // El periodo ya se lee en su propio control: las etiquetas son para lo
      // que queda escondido tras «Más filtros».
      describeActiveFilters(values, options)
        .filter((filter) => filter.key !== 'period')
        .map((filter) => ({
          id: filter.key,
          label: filter.label,
          value: filter.value,
          onRemove: () => change(filter.key, null),
        })),
    [values, options, change],
  );

  const users = useMemo(() => visibleUsers(values, options), [values, options]);

  const periodOptions = PERIOD_OPTIONS.filter((option) => option.value !== ALL_VALUE);

  return (
    <FilterBar
      activeFilters={activeFilters}
      onClearFilters={() => onChange({ ...clearedFilters(), period: values.period })}
      filters={
        <>
          <UsageSelect
            filterKey="period"
            value={values.period}
            allLabel={PERIOD_OPTIONS[0].label}
            options={periodOptions}
            missingLabel="Periodo no válido"
            onChange={change}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={isExpanded}
            aria-controls={panelId}
            onClick={() => setIsExpanded((current) => !current)}
          >
            <SlidersHorizontal aria-hidden="true" />
            Más filtros
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

          {isExpanded && (
            <div id={panelId} role="group" aria-label="Más filtros" className="contents">
              {options.providers.length > 0 && (
                <UsageSelect
                  filterKey="provider"
                  value={values.provider}
                  allLabel="Todos los proveedores"
                  options={options.providers.map((key) => ({ value: key, label: providerLabel(key) }))}
                  missingLabel="Proveedor no encontrado"
                  onChange={change}
                />
              )}
              {options.agents.length > 0 && (
                <UsageSelect
                  filterKey="agent"
                  value={values.agent}
                  allLabel="Todos los agentes"
                  options={options.agents.map((agent) => ({
                    value: agent.key,
                    label: agentLabel(agent.key, agent.name),
                  }))}
                  missingLabel="Agente no encontrado"
                  onChange={change}
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
                />
              )}
              {options.groups.length > 0 && (
                <UsageSelect
                  filterKey="groupId"
                  value={values.groupId}
                  allLabel="Todos los grupos"
                  options={options.groups.map((group) => ({
                    value: group.id,
                    label: group.name,
                    indent: group.depth,
                  }))}
                  missingLabel="Grupo no encontrado"
                  onChange={change}
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
                />
              )}
            </div>
          )}
        </>
      }
    />
  );
}

interface FiltersClientProps {
  options: FilterOptions;
  values: UsageFilterValues;
}

/** Conecta la barra con la URL: los filtros siguen viviendo en los query params. */
export function FiltersClient({ options, values }: FiltersClientProps) {
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

  return <UsageFilterBar options={options} values={values} onChange={handleChange} />;
}
