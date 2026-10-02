'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { formatInAppZone } from '@/lib/format-date';
import { Pause, RotateCcw, Archive, UserX, Layers, Loader2, Users } from "@/icons";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ModalShell } from '@/components/shared/modal-shell';
import { FieldLabel } from '@/components/forms/field';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableBulkAction,
} from '@/components/data-table';
import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  bulkSuspend,
  bulkReactivate,
  bulkArchive,
  bulkReject,
  bulkAssignGroup,
} from '@/modules/access/actions';
import { UserActions } from './user-actions';
import { UserAvatar } from './user-avatar';
import type { AccessStatus, InternalUser, Role, OrganizationGroup } from '@/modules/access/types';
import { formatGroupDisplayName, formatGroupLabel } from '@/modules/access/display-helpers';

const NO_GROUP = '__none__';
const NO_VALUE = '—';

function getRoleLabel(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return NO_VALUE;
  return formatInAppZone(dateStr, {
    day: 'numeric', month: 'short', year: 'numeric',
  }, 'es-CO');
}

const STATUS_PRESENTATION: Record<AccessStatus, { label: string; status: StatusType; dateLabel: string }> = {
  pending_approval: { label: 'Pendiente',  status: 'pending',  dateLabel: 'Solicitado' },
  active:           { label: 'Activo',     status: 'active',   dateLabel: 'Aprobado' },
  rejected:         { label: 'Rechazado',  status: 'error',    dateLabel: 'Rechazado' },
  suspended:        { label: 'Suspendido', status: 'warning',  dateLabel: 'Suspendido' },
  archived:         { label: 'Archivado',  status: 'inactive', dateLabel: 'Archivado' },
};

/** La fecha que cuenta para el estado en el que está la persona. */
function getStatusDate(user: InternalUser): string | null {
  switch (user.access_status) {
    case 'pending_approval': return user.requested_at;
    case 'active':           return user.approved_at;
    case 'rejected':         return user.rejected_at;
    case 'suspended':        return user.suspended_at;
    case 'archived':         return user.archived_at;
    default:                 return null;
  }
}

function getManagerLabel(managerId: string | null, users: InternalUser[]): string {
  if (!managerId) return NO_VALUE;
  const m = users.find(u => u.id === managerId);
  return m ? (m.full_name ?? m.email) : NO_VALUE;
}

// ─── Bulk action definitions per tab mode ─────────────────────────────────────

type BulkActionId = 'suspend' | 'reactivate' | 'archive' | 'reject' | 'assign_group';

interface BulkActionDef {
  id: BulkActionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  variant: 'default' | 'destructive';
  confirmTitle: (n: number) => string;
  confirmDesc: (n: number) => string;
  requiresGroup?: boolean;
}

const plural = (n: number) => (n > 1 ? 's' : '');

const ASSIGN_GROUP: BulkActionDef = {
  id: 'assign_group',
  label: 'Asignar grupo',
  icon: Layers,
  variant: 'default',
  confirmTitle: n => `Asignar grupo a ${n} usuario${plural(n)}`,
  confirmDesc: () => 'Selecciona el grupo organizacional para estos usuarios.',
  requiresGroup: true,
};

const SUSPEND: BulkActionDef = {
  id: 'suspend',
  label: 'Suspender',
  icon: Pause,
  variant: 'destructive',
  confirmTitle: n => `Suspender ${n} usuario${plural(n)}`,
  confirmDesc: n => `${n} usuario${plural(n)} perderá acceso a SellUp hasta ser reactivado.`,
};

const ARCHIVE: BulkActionDef = {
  id: 'archive',
  label: 'Archivar',
  icon: Archive,
  variant: 'destructive',
  confirmTitle: n => `Archivar ${n} usuario${plural(n)}`,
  confirmDesc: () => 'Los usuarios archivados no podrán acceder. Esta acción es reversible.',
};

const REACTIVATE: BulkActionDef = {
  id: 'reactivate',
  label: 'Reactivar',
  icon: RotateCcw,
  variant: 'default',
  confirmTitle: n => `Reactivar ${n} usuario${plural(n)}`,
  confirmDesc: n => `${n} usuario${plural(n)} recuperará acceso a SellUp.`,
};

const REJECT: BulkActionDef = {
  id: 'reject',
  label: 'Rechazar',
  icon: UserX,
  variant: 'destructive',
  confirmTitle: n => `Rechazar ${n} solicitud${n > 1 ? 'es' : ''}`,
  confirmDesc: n => `Se rechazarán ${n} solicitud${n > 1 ? 'es' : ''} de acceso.`,
};

/** Qué se puede hacer en lote depende de la vista: no se reactiva a quien ya está activo. */
const BULK_ACTIONS: Record<SelectableListMode, BulkActionDef[]> = {
  all: [ASSIGN_GROUP, SUSPEND],
  active: [ASSIGN_GROUP, SUSPEND],
  suspended: [REACTIVATE, ARCHIVE],
  rejected: [SUSPEND, ARCHIVE],
  pending: [REJECT],
};

const NO_BULK_ACTIONS: BulkActionDef[] = [];

const EMPTY_COPY: Record<SelectableListMode, { title: string; description: string }> = {
  all: {
    title: 'Todavía no hay usuarios',
    description: 'Agrega a la primera persona con «Agregar usuario» o espera a que alguien solicite acceso.',
  },
  active: {
    title: 'Nadie tiene acceso activo',
    description: 'Aprueba una solicitud pendiente o agrega a una persona para que pueda entrar.',
  },
  pending: {
    title: 'No hay solicitudes por revisar',
    description: 'Cuando alguien pida acceso a SellUp, su solicitud aparecerá aquí para que la apruebes o la rechaces.',
  },
  suspended: {
    title: 'No hay accesos suspendidos',
    description: 'Aquí verás a quienes se les pausó el acceso, para reactivarlos o archivarlos.',
  },
  rejected: {
    title: 'No hay solicitudes rechazadas',
    description: 'Las solicitudes que rechaces quedan aquí por si necesitas activarlas después.',
  },
};

// ─── Main component ───────────────────────────────────────────────────────────

export type SelectableListMode = 'active' | 'suspended' | 'rejected' | 'pending' | 'all';

interface SelectableUsersListProps {
  users: InternalUser[];
  roles: Role[];
  allUsers: InternalUser[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
  mode: SelectableListMode;
  isAdmin: boolean;
  /** Cómo se titula la lista: «Activos», «Pendientes»… */
  title?: string;
}

interface PendingBulkAction {
  action: BulkActionDef;
  ids: string[];
}

export function SelectableUsersList({
  users, roles, allUsers, activeUsers, groups, mode, isAdmin, title = 'Usuarios',
}: SelectableUsersListProps) {
  // La barra de acciones de la pantalla se aparta mientras haya selección.
  const [pending, setPending] = useState<PendingBulkAction | null>(null);
  const [groupId, setGroupId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Solo un administrador marca filas y actúa sobre ellas.
  const bulkDefs = isAdmin ? BULK_ACTIONS[mode] ?? NO_BULK_ACTIONS : NO_BULK_ACTIONS;
  const canSelect = bulkDefs.length > 0;

  const closeDialog = () => {
    setPending(null);
    setGroupId('');
    setError(null);
  };

  const executeBulkAction = async () => {
    if (!pending) return;
    const { action, ids } = pending;
    setLoading(true);
    setError(null);

    let result: { success: boolean; error?: string };

    switch (action.id) {
      case 'suspend':        result = await bulkSuspend(ids); break;
      case 'reactivate':     result = await bulkReactivate(ids); break;
      case 'archive':        result = await bulkArchive(ids); break;
      case 'reject':         result = await bulkReject(ids); break;
      case 'assign_group':   result = await bulkAssignGroup(ids, groupId && groupId !== NO_GROUP ? groupId : null); break;
      default:               result = { success: false, error: 'Acción desconocida' };
    }

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'No se pudo completar la acción. Inténtalo de nuevo.');
      return;
    }

    closeDialog();
    window.location.reload();
  };

  const bulkActions: DataTableBulkAction<InternalUser>[] = useMemo(
    () =>
      bulkDefs.map((action) => ({
        id: action.id,
        label: action.label,
        icon: action.icon,
        variant: action.variant,
        onClick: (rows: InternalUser[]) => {
          if (rows.length === 0) return;
          setPending({ action, ids: rows.map((row) => row.id) });
        },
      })),
    [bulkDefs],
  );

  const columns: ColumnDef<InternalUser, unknown>[] = useMemo(() => {
    const roleOptions = Array.from(new Set(users.map((u) => getRoleLabel(u.role_key, roles))))
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((label) => ({ label, value: label }));
    const groupOptions = Array.from(new Set(users.map((u) => formatGroupLabel(u.group_id, groups))))
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((label) => ({ label, value: label }));
    const statusOptions = Array.from(new Set(users.map((u) => u.access_status))).map((status) => ({
      label: STATUS_PRESENTATION[status]?.label ?? status,
      value: status,
    }));

    const base: ColumnDef<InternalUser, unknown>[] = [
      {
        id: 'person',
        // Nombre y correo juntos: el buscador de la tabla encuentra por los dos.
        accessorFn: (user) => `${user.full_name ?? ''} ${user.email}`.trim(),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Persona" />,
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <UserAvatar name={user.full_name} email={user.email} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground" title={user.full_name ?? undefined}>
                  {user.full_name ?? 'Sin nombre'}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={user.email}>{user.email}</p>
              </div>
            </div>
          );
        },
        size: 280,
        minSize: 220,
        enableHiding: false,
        meta: { label: 'Persona', disableFilter: true },
      },
      {
        id: 'role',
        accessorFn: (user) => getRoleLabel(user.role_key, roles),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Rol" />,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{getValue<string>()}</span>
        ),
        size: 150,
        meta: { label: 'Rol', filterOptions: roleOptions },
      },
      {
        id: 'group',
        accessorFn: (user) => formatGroupLabel(user.group_id, groups),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Grupo" />,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{getValue<string>()}</span>
        ),
        size: 160,
        meta: { label: 'Grupo', filterOptions: groupOptions },
      },
      {
        id: 'manager',
        accessorFn: (user) => getManagerLabel(user.manager_id, allUsers),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Jefe directo" />,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">{getValue<string>()}</span>
        ),
        size: 170,
        meta: { label: 'Jefe directo', disableFilter: true },
      },
      {
        id: 'status',
        accessorKey: 'access_status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => {
          const presentation = STATUS_PRESENTATION[row.original.access_status];
          return presentation ? (
            <StatusBadge status={presentation.status} label={presentation.label} />
          ) : (
            <StatusBadge status="neutral" label={row.original.access_status} />
          );
        },
        size: 130,
        meta: { label: 'Estado', filterOptions: statusOptions },
      },
      {
        id: 'date',
        accessorFn: (user) => getStatusDate(user) ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => {
          const presentation = STATUS_PRESENTATION[row.original.access_status];
          return (
            <div className="whitespace-nowrap">
              <p className="text-sm tabular-nums text-foreground">{formatDate(getStatusDate(row.original))}</p>
              {presentation && <p className="text-xs text-muted-foreground">{presentation.dateLabel}</p>}
            </div>
          );
        },
        size: 140,
        meta: { label: 'Fecha', disableFilter: true },
      },
    ];

    if (!isAdmin) return base;

    return [
      ...base,
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          // El menú y sus diálogos viven dentro de la fila: sin esto, un clic
          // en ellos marcaría la fila.
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <UserActions
              user={row.original}
              roles={roles}
              activeUsers={activeUsers}
              groups={groups}
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
  }, [users, roles, groups, allUsers, activeUsers, isAdmin]);

  const emptyCopy = EMPTY_COPY[mode];
  const selectedCount = pending?.ids.length ?? 0;

  return (
    <>
      <DataTable
        tableId="settings-users"
        noun="usuarios"
        nounGender="m"
        title={title}
        count={users.length}
        columns={columns}
        data={users}
        getRowId={(user) => user.id}
        getRowLabel={(user) => user.full_name ?? user.email}
        enableRowSelection={canSelect}
        bulkActions={bulkActions}
        emptyState={
          <EmptyState
            variant="plain"
            icon={Users}
            title={emptyCopy.title}
            description={emptyCopy.description}
          />
        }
      />

      {/* Confirmación de la acción en lote */}
      {pending && (
        <ModalShell
          open
          onOpenChange={closeDialog}
          title={pending.action.confirmTitle(selectedCount)}
          description={pending.action.confirmDesc(selectedCount)}
          actions={
            <>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={loading}>Cancelar</Button>
              <Button
                type="button"
                variant={pending.action.variant === 'destructive' ? 'destructive' : 'default'}
                onClick={executeBulkAction}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? 'Procesando...' : pending.action.label}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {pending.action.requiresGroup && (
              <div className="space-y-1.5">
                <FieldLabel className="block leading-none">Grupo organizacional</FieldLabel>
                <Select value={groupId || undefined} onValueChange={v => setGroupId(v ?? '')}>
                  <SelectTrigger className="w-full" aria-label="Grupo organizacional">
                    <SelectValue placeholder="Sin grupo (desasignar)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GROUP}>Sin grupo (desasignar)</SelectItem>
                    {groups.map(g => (
                      <SelectItem key={g.id} value={g.id}>
                        {'  '.repeat(g.depth)}{g.depth > 0 ? '· ' : ''}{formatGroupDisplayName(g)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );
}
