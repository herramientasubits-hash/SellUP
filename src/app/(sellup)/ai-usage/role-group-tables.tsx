'use client';

// «Por rol y grupo» — totales por rol y por grupo de la organización (con la
// foto del rol y del grupo del momento de la consulta cuando existe) y, debajo,
// las personas. «Ver personas» pone el filtro de rol o grupo en la URL.

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Network, Users } from '@/icons';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import {
  NO_GROUP_KEY,
  NO_ROLE_KEY,
  type PersonUsageRow,
  type RoleGroupRow,
} from '@/modules/ai-usage/usage-breakdowns';
import { countColumn, filterOptions, moneyColumn } from './breakdown-cells';
import { formatCount } from './usage-labels';

interface RoleGroupTablesProps {
  roles: RoleGroupRow[];
  groups: RoleGroupRow[];
  people: PersonUsageRow[];
  roleLabels: Record<string, string>;
  groupNames: Record<string, string>;
  personNames: Record<string, string>;
  moneyVisible: boolean;
  /** La query de la página ahora (filtros puestos), para que «Ver personas» la conserve. */
  currentQuery: string;
}

/** La pestaña de esta vista en la URL. */
export const ROLE_GROUP_TAB_ID = 'por-rol-grupo';
const PAGE_PATH = '/ai-usage';

function roleName(key: string, labels: Record<string, string>): string {
  if (key === NO_ROLE_KEY) return 'Sin rol';
  return labels[key] ?? key;
}

function groupName(id: string, names: Record<string, string>): string {
  if (id === NO_GROUP_KEY) return 'Sin grupo';
  return names[id] ?? 'Grupo no encontrado';
}

/** «Ver personas»: el mismo filtro de rol o grupo de la barra, en esta pestaña. */
export function drillHref(currentQuery: string, param: 'role' | 'groupId', value: string): string {
  const params = new URLSearchParams(currentQuery);
  params.set(param, value);
  params.delete('user');
  params.set('tab', ROLE_GROUP_TAB_ID);
  return `${PAGE_PATH}?${params.toString()}`;
}

function summaryColumns(moneyVisible: boolean): ColumnDef<RoleGroupRow, unknown>[] {
  const base: ColumnDef<RoleGroupRow, unknown>[] = [
    countColumn('people', 'Personas', (row) => row.people, 110),
    countColumn('calls', 'Consultas', (row) => row.calls),
    countColumn('credits', 'Créditos', (row) => row.credits),
    countColumn('approved', 'Empresas aprobadas', (row) => row.approved, 160),
  ];
  if (!moneyVisible) return base;
  return [
    ...base,
    moneyColumn('cost', 'Costo estimado', (row) => row.costUsd, (row) => row.hasUnknownCost),
    moneyColumn('costPerApproved', 'Costo por aprobada', (row) => row.costPerApprovedUsd, () => false, 2, 160),
  ];
}

function nameColumn(
  title: string,
  label: (id: string) => string,
  href: ((id: string) => string) | null,
  canDrill: (id: string) => boolean,
): ColumnDef<RoleGroupRow, unknown> {
  return {
    id: 'name',
    accessorFn: (row) => label(row.id),
    header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label(row.original.id)}</span>
        {href && canDrill(row.original.id) && (
          <Link
            href={href(row.original.id)}
            className="w-fit text-xs text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
          >
            Ver personas
          </Link>
        )}
      </div>
    ),
    size: 220,
    enableHiding: false,
    meta: { label: title, disableFilter: true },
  };
}

export function RoleGroupTables(props: RoleGroupTablesProps) {
  const { roles, groups, people, roleLabels, groupNames, personNames, moneyVisible, currentQuery } = props;

  const roleColumns = React.useMemo(
    () => [
      nameColumn(
        'Rol',
        (id) => roleName(id, roleLabels),
        (id) => drillHref(currentQuery, 'role', id),
        (id) => id !== NO_ROLE_KEY,
      ),
      ...summaryColumns(moneyVisible),
    ],
    [roleLabels, currentQuery, moneyVisible],
  );
  const groupColumns = React.useMemo(
    () => [
      nameColumn(
        'Grupo',
        (id) => groupName(id, groupNames),
        (id) => drillHref(currentQuery, 'groupId', id),
        (id) => id !== NO_GROUP_KEY,
      ),
      ...summaryColumns(moneyVisible),
    ],
    [groupNames, currentQuery, moneyVisible],
  );

  const peopleColumns: ColumnDef<PersonUsageRow, unknown>[] = React.useMemo(() => {
    const base: ColumnDef<PersonUsageRow, unknown>[] = [
      {
        id: 'person',
        accessorFn: (row) => personNames[row.userId] ?? row.name ?? row.email ?? row.userId,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Persona" />,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              {personNames[row.original.userId] ?? row.original.name ?? row.original.userId.slice(0, 8)}
            </span>
            {row.original.email && <span className="text-xs text-muted-foreground">{row.original.email}</span>}
          </div>
        ),
        size: 240,
        enableHiding: false,
        meta: { label: 'Persona', disableFilter: true },
      },
      {
        id: 'role',
        accessorFn: (row) => row.roleKey,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rol" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{roleName(row.original.roleKey, roleLabels)}</span>,
        size: 160,
        meta: { label: 'Rol', filterOptions: filterOptions(people.map((p) => p.roleKey), (v) => roleName(v, roleLabels)) },
      },
      {
        id: 'group',
        accessorFn: (row) => row.groupId,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Grupo" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{groupName(row.original.groupId, groupNames)}</span>,
        size: 180,
        meta: { label: 'Grupo', filterOptions: filterOptions(people.map((p) => p.groupId), (v) => groupName(v, groupNames)) },
      },
      countColumn('calls', 'Consultas', (row) => row.calls),
      countColumn('credits', 'Créditos', (row) => row.credits),
      countColumn('approved', 'Empresas aprobadas', (row) => row.approved, 160),
    ];
    if (!moneyVisible) return base;
    return [
      ...base,
      moneyColumn('cost', 'Costo estimado', (row) => row.costUsd, (row) => row.hasUnknownCost),
      moneyColumn('costPerApproved', 'Costo por aprobada', (row) => row.costPerApprovedUsd, () => false, 2, 160),
    ];
  }, [people, personNames, roleLabels, groupNames, moneyVisible]);

  const emptyRows = (
    <EmptyState
      variant="plain"
      icon={Network}
      title="Nada que mostrar con estos filtros"
      description="Cambia el periodo o quita algún filtro."
    />
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
        <DataTable
          tableId="ai-usage-by-role"
          noun="roles"
          title="Por rol"
          description="El rol de quien hizo cada consulta en ese momento; las aprobadas, por quien lanzó la búsqueda."
          count={roles.length}
          columns={roleColumns}
          data={roles}
          getRowId={(row) => row.id}
          defaultRowsMode="paged"
          initialPageSize={10}
          emptyState={emptyRows}
        />
        <DataTable
          tableId="ai-usage-by-group"
          noun="grupos"
          title="Por grupo"
          description="Los grupos de la organización, con la misma regla."
          count={groups.length}
          columns={groupColumns}
          data={groups}
          getRowId={(row) => row.id}
          defaultRowsMode="paged"
          initialPageSize={10}
          emptyState={emptyRows}
        />
      </div>
      <DataTable
        tableId="ai-usage-by-person"
        noun="personas"
        nounGender="f"
        title="Personas"
        description={`${formatCount(people.length)} personas con consultas o empresas aprobadas en el periodo.`}
        count={people.length}
        columns={peopleColumns}
        data={people}
        getRowId={(row) => row.userId}
        defaultRowsMode="paged"
        initialPageSize={20}
        emptyState={
          <EmptyState
            variant="plain"
            icon={Users}
            title="Nadie coincide con estos filtros"
            description="Cambia el rol, el grupo o el periodo."
          />
        }
      />
    </div>
  );
}
