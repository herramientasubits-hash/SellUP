'use client';

import { Plus, Pencil, Power, ShieldAlert, Trash2 } from '@/icons';
import type { ColumnDef } from '@tanstack/react-table';
import {
  DataTable,
  DataTableColumnHeader,
  DataTableRowActions,
  type DataTableBulkAction,
  type DataTableContextMenuItem,
} from '@/components/data-table';
import { StatusBadge } from '@/components/data-display/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import {
  ON_EXCEED_LABELS,
  PERIOD_LABELS,
  SCOPE_LABELS,
  formatLimit,
  formatRuleDate,
} from './budget-rule-display';

// ─── Rules table ──────────────────────────────────────────────────────────────

export interface RulesDataTableProps {
  rules: BudgetRuleRow[];
  onCreate: () => void;
  onEdit: (rule: BudgetRuleRow) => void;
  onToggle: (rule: BudgetRuleRow) => Promise<void>;
  /** Pide confirmación antes de eliminar: no borra por sí sola. */
  onArchive: (rule: BudgetRuleRow) => void;
  busyId: string | null;
  /** Dónde va «Crear regla»: como acción de la lista o en la cabecera de la pantalla. */
  showCreateAction?: boolean;
}

/** El tope que manda para ordenar: dólares si los hay, si no créditos. */
function limitSortValue(rule: BudgetRuleRow): number {
  if (rule.limit_usd != null && rule.limit_usd > 0) return rule.limit_usd;
  return rule.limit_credits ?? 0;
}

/**
 * Las reglas de presupuesto en una sola lista: se filtra por proveedor, alcance,
 * período, acción y estado desde el embudo de cada columna, y se ordena por
 * límite o fecha. Sustituye a las cuatro pestañas por alcance.
 */
export function RulesDataTable({
  rules,
  onCreate,
  onEdit,
  onToggle,
  onArchive,
  busyId,
  showCreateAction = false,
}: RulesDataTableProps) {
  const rowMenuItems = (rule: BudgetRuleRow): DataTableContextMenuItem[] => [
    { id: 'edit', label: 'Editar', icon: Pencil, onClick: () => onEdit(rule) },
    {
      id: 'toggle',
      label: rule.is_active ? 'Desactivar' : 'Activar',
      icon: Power,
      disabled: busyId === rule.id,
      onClick: () => onToggle(rule),
    },
    {
      id: 'delete',
      label: 'Eliminar',
      icon: Trash2,
      variant: 'destructive',
      separator: true,
      disabled: busyId === rule.id,
      onClick: () => onArchive(rule),
    },
  ];

  const bulkActions: DataTableBulkAction<BudgetRuleRow>[] = [
    {
      id: 'editar',
      label: 'Editar',
      icon: Pencil,
      disabled: (rows) => rows.length !== 1,
      disabledLabel: (rows) => (rows.length !== 1 ? 'Marca una sola regla' : undefined),
      onClick: (rows) => { if (rows.length === 1) onEdit(rows[0]); },
    },
    {
      id: 'activar',
      label: 'Activar',
      icon: Power,
      disabled: (rows) => rows.every((r) => r.is_active),
      disabledLabel: (rows) => (rows.every((r) => r.is_active) ? 'Ya están activas' : undefined),
      onClick: async (rows) => {
        for (const r of rows.filter((r) => !r.is_active)) {
          await onToggle(r);
        }
      },
    },
    {
      id: 'desactivar',
      label: 'Desactivar',
      disabled: (rows) => rows.every((r) => !r.is_active),
      disabledLabel: (rows) => (rows.every((r) => !r.is_active) ? 'Ya están inactivas' : undefined),
      onClick: async (rows) => {
        for (const r of rows.filter((r) => r.is_active)) {
          await onToggle(r);
        }
      },
    },
    {
      id: 'eliminar',
      label: 'Eliminar',
      icon: Trash2,
      variant: 'destructive',
      disabled: (rows) => rows.length !== 1,
      disabledLabel: (rows) => (rows.length !== 1 ? 'Las reglas se eliminan de una en una' : undefined),
      // La confirmación la pide `onArchive` (un solo diálogo, no dos).
      onClick: (rows) => { if (rows.length === 1) onArchive(rows[0]); },
    },
  ];

  const unique = <T extends string>(values: T[]) => Array.from(new Set(values));

  const columns: ColumnDef<BudgetRuleRow, unknown>[] = [
    {
      id: 'provider',
      accessorKey: 'providerDisplayName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm font-medium text-foreground">
          {row.original.providerDisplayName}
        </span>
      ),
      size: 180,
      enableHiding: false,
      meta: {
        label: 'Proveedor',
        filterOptions: unique(rules.map((r) => r.providerDisplayName))
          .sort((a, b) => a.localeCompare(b, 'es'))
          .map((name) => ({ label: name, value: name })),
      },
    },
    {
      id: 'scope',
      accessorKey: 'scope_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Alcance" />,
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="neutral">{SCOPE_LABELS[row.original.scope_type]}</Badge>
          {row.original.scope_type !== 'global' && (
            <span className="truncate text-sm text-muted-foreground" title={row.original.scopeLabel}>
              {row.original.scopeLabel}
            </span>
          )}
        </div>
      ),
      size: 220,
      meta: {
        label: 'Alcance',
        filterOptions: unique(rules.map((r) => r.scope_type)).map((scope) => ({
          label: SCOPE_LABELS[scope],
          value: scope,
        })),
      },
    },
    {
      id: 'limit',
      accessorFn: limitSortValue,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Límite" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm tabular-nums text-foreground">
          {formatLimit(row.original.limit_credits, row.original.limit_usd)}
        </span>
      ),
      sortDescFirst: true,
      size: 150,
      meta: { label: 'Límite', disableFilter: true },
    },
    {
      id: 'period',
      accessorKey: 'period_type',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Período" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {PERIOD_LABELS[row.original.period_type]}
        </span>
      ),
      size: 130,
      meta: {
        label: 'Período',
        filterOptions: unique(rules.map((r) => r.period_type)).map((period) => ({
          label: PERIOD_LABELS[period],
          value: period,
        })),
      },
    },
    {
      id: 'onExceed',
      accessorKey: 'on_exceed',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Al superar el límite" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {ON_EXCEED_LABELS[row.original.on_exceed]}
        </span>
      ),
      size: 180,
      meta: {
        label: 'Al superar el límite',
        filterOptions: unique(rules.map((r) => r.on_exceed)).map((action) => ({
          label: ON_EXCEED_LABELS[action],
          value: action,
        })),
      },
    },
    {
      id: 'status',
      accessorFn: (rule) => (rule.is_active ? 'active' : 'inactive'),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.is_active ? 'active' : 'inactive'}
          label={row.original.is_active ? 'Activa' : 'Inactiva'}
        />
      ),
      size: 120,
      meta: {
        label: 'Estado',
        filterOptions: [
          { label: 'Activa', value: 'active' },
          { label: 'Inactiva', value: 'inactive' },
        ],
      },
    },
    {
      id: 'updatedAt',
      accessorKey: 'updated_at',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Actualizada" />,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {formatRuleDate(row.original.updated_at)}
        </span>
      ),
      sortDescFirst: true,
      size: 130,
      meta: { label: 'Actualizada', disableFilter: true },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => (
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <DataTableRowActions
            items={rowMenuItems(row.original)}
            rowLabel={`la regla de ${row.original.providerDisplayName}`}
          />
        </div>
      ),
      size: 56,
      enableSorting: false,
      enableHiding: false,
      enableColumnFilter: false,
      meta: { label: 'Acciones', disableFilter: true, disableSort: true },
    },
  ];

  return (
    <DataTable
      tableId="settings-budget-rules"
      noun="reglas"
      nounGender="f"
      title="Reglas de presupuesto"
      description="Por ahora las reglas solo avisan: no detienen ninguna operación."
      count={rules.length}
      columns={columns}
      data={rules}
      getRowId={(rule) => rule.id}
      getRowLabel={(rule) => `la regla de ${rule.providerDisplayName}`}
      enableRowSelection
      bulkActions={bulkActions}
      contextMenu={{ items: rowMenuItems }}
      actions={
        showCreateAction ? (
          <Button size="sm" variant="outline" onClick={onCreate}>
            <Plus />
            Crear regla
          </Button>
        ) : undefined
      }
      emptyState={
        <EmptyState
          variant="plain"
          icon={ShieldAlert}
          title="Todavía no hay reglas de presupuesto"
          description="Crea una regla para recibir un aviso cuando un proveedor, un grupo o una persona se acerque a su tope de gasto."
          action={
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus />
              Crear regla
            </Button>
          }
        />
      }
    />
  );
}
