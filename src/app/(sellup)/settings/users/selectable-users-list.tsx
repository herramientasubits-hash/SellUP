'use client';

import { useState } from 'react';
import { X, Pause, RotateCcw, Archive, UserX, Layers } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { InternalUser, Role, OrganizationGroup } from '@/modules/access/types';
import { formatGroupDisplayName, formatGroupLabel } from '@/modules/access/display-helpers';

const NO_GROUP = '__none__';

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function getRoleLabel(roleKey: string | null, roles: Role[]): string {
  if (!roleKey) return 'Sin rol';
  return roles.find(r => r.key === roleKey)?.name ?? roleKey;
}

function getGroupLabel(groupId: string | null, groups: OrganizationGroup[]): string {
  return formatGroupLabel(groupId, groups);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function getStatusBadge(status: string) {
  const cfg: Record<string, { label: string; className: string }> = {
    pending_approval: { label: 'Pendiente',   className: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
    active:           { label: 'Activo',       className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' },
    rejected:         { label: 'Rechazado',    className: 'bg-destructive/10 text-destructive border-destructive/30' },
    suspended:        { label: 'Suspendido',   className: 'bg-orange-500/10 text-orange-500 border-orange-500/30' },
    archived:         { label: 'Archivado',    className: 'bg-slate-500/10 text-slate-500 border-slate-500/30' },
  };
  return cfg[status] ?? { label: status, className: '' };
}

function getDateLabel(user: InternalUser): string {
  switch (user.access_status) {
    case 'pending_approval': return `Solicitado: ${formatDate(user.requested_at)}`;
    case 'active':           return `Aprobado: ${formatDate(user.approved_at)}`;
    case 'rejected':         return `Rechazado: ${formatDate(user.rejected_at)}`;
    case 'suspended':        return `Suspendido: ${formatDate(user.suspended_at)}`;
    case 'archived':         return `Archivado: ${formatDate(user.archived_at)}`;
    default: return '';
  }
}

function getManagerLabel(managerId: string | null, users: InternalUser[]): string {
  if (!managerId) return '—';
  const m = users.find(u => u.id === managerId);
  return m ? (m.full_name ?? m.email) : '—';
}

// ─── Bulk action definitions per tab mode ─────────────────────────────────────

type BulkActionId = 'suspend' | 'reactivate' | 'archive' | 'reject' | 'assign_group';

interface BulkActionDef {
  id: BulkActionId;
  label: string;
  icon: React.ReactNode;
  variant: 'default' | 'destructive' | 'outline';
  confirmTitle: (n: number) => string;
  confirmDesc: (n: number) => string;
  requiresGroup?: boolean;
}

const BULK_ACTIONS: Record<string, BulkActionDef[]> = {
  all: [
    {
      id: 'assign_group',
      label: 'Asignar grupo',
      icon: <Layers className="h-3.5 w-3.5" />,
      variant: 'outline',
      confirmTitle: n => `Asignar grupo a ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: () => 'Selecciona el grupo organizacional para estos usuarios.',
      requiresGroup: true,
    },
    {
      id: 'suspend',
      label: 'Suspender',
      icon: <Pause className="h-3.5 w-3.5" />,
      variant: 'destructive',
      confirmTitle: n => `Suspender ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: n => `${n} usuario${n > 1 ? 's' : ''} perderá acceso a SellUp hasta ser reactivado.`,
    },
  ],
  active: [
    {
      id: 'assign_group',
      label: 'Asignar grupo',
      icon: <Layers className="h-3.5 w-3.5" />,
      variant: 'outline',
      confirmTitle: n => `Asignar grupo a ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: () => 'Selecciona el grupo organizacional para estos usuarios.',
      requiresGroup: true,
    },
    {
      id: 'suspend',
      label: 'Suspender',
      icon: <Pause className="h-3.5 w-3.5" />,
      variant: 'destructive',
      confirmTitle: n => `Suspender ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: n => `${n} usuario${n > 1 ? 's' : ''} perderá acceso a SellUp hasta ser reactivado.`,
    },
  ],
  suspended: [
    {
      id: 'reactivate',
      label: 'Reactivar',
      icon: <RotateCcw className="h-3.5 w-3.5" />,
      variant: 'default',
      confirmTitle: n => `Reactivar ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: n => `${n} usuario${n > 1 ? 's' : ''} recuperará acceso a SellUp.`,
    },
    {
      id: 'archive',
      label: 'Archivar',
      icon: <Archive className="h-3.5 w-3.5" />,
      variant: 'destructive',
      confirmTitle: n => `Archivar ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: () => 'Los usuarios archivados no podrán acceder. Esta acción es reversible.',
    },
  ],
  rejected: [
    {
      id: 'suspend',
      label: 'Suspender',
      icon: <Pause className="h-3.5 w-3.5" />,
      variant: 'destructive',
      confirmTitle: n => `Suspender ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: n => `${n} usuario${n > 1 ? 's' : ''} perderá acceso a SellUp hasta ser reactivado.`,
    },
    {
      id: 'archive',
      label: 'Archivar',
      icon: <Archive className="h-3.5 w-3.5" />,
      variant: 'destructive',
      confirmTitle: n => `Archivar ${n} usuario${n > 1 ? 's' : ''}`,
      confirmDesc: () => 'Los usuarios archivados no podrán acceder. Esta acción es reversible.',
    },
  ],
  pending: [
    {
      id: 'reject',
      label: 'Rechazar',
      icon: <UserX className="h-3.5 w-3.5" />,
      variant: 'destructive',
      confirmTitle: n => `Rechazar ${n} solicitud${n > 1 ? 'es' : ''}`,
      confirmDesc: n => `Se rechazarán ${n} solicitud${n > 1 ? 'es' : ''} de acceso.`,
    },
  ],
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
}

export function SelectableUsersList({
  users, roles, allUsers, activeUsers, groups, mode, isAdmin,
}: SelectableUsersListProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeAction, setActiveAction] = useState<BulkActionDef | null>(null);
  const [groupId, setGroupId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bulkActions = BULK_ACTIONS[mode] ?? [];
  const allSelected = users.length > 0 && selectedIds.length === users.length;

  const toggleAll = () => setSelectedIds(allSelected ? [] : users.map(u => u.id));
  const toggleOne = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const closeDialog = () => {
    setActiveAction(null);
    setGroupId('');
    setError(null);
  };

  const executeBulkAction = async () => {
    if (!activeAction) return;
    setLoading(true);
    setError(null);

    let result: { success: boolean; error?: string };

    switch (activeAction.id) {
      case 'suspend':        result = await bulkSuspend(selectedIds); break;
      case 'reactivate':     result = await bulkReactivate(selectedIds); break;
      case 'archive':        result = await bulkArchive(selectedIds); break;
      case 'reject':         result = await bulkReject(selectedIds); break;
      case 'assign_group':   result = await bulkAssignGroup(selectedIds, groupId && groupId !== NO_GROUP ? groupId : null); break;
      default:               result = { success: false, error: 'Acción desconocida' };
    }

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }

    closeDialog();
    window.location.reload();
  };

  if (users.length === 0) {
    return <div className="py-12 text-center text-muted-foreground text-sm">No hay usuarios en esta categoría.</div>;
  }

  return (
    <div className="space-y-2">
      {/* Select-all header */}
      {isAdmin && bulkActions.length > 0 && (
        <div className="flex items-center gap-3 px-1 pb-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-border accent-su-brand cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">
              {selectedIds.length > 0
                ? `${selectedIds.length} de ${users.length} seleccionados`
                : `Seleccionar todos (${users.length})`}
            </span>
          </label>
        </div>
      )}

      {/* User rows */}
      <div className="space-y-2">
        {users.map(user => {
          const statusBadge = getStatusBadge(user.access_status);
          const isSelected = selectedIds.includes(user.id);

          return (
            <div
              key={user.id}
              className={`flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors ${
                isSelected ? 'border-su-brand/40 bg-su-brand-soft/20' : 'border-border/50 hover:border-border/80'
              }`}
            >
            {isAdmin && bulkActions.length > 0 && (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleOne(user.id)}
                className="h-4 w-4 shrink-0 rounded border-border accent-su-brand cursor-pointer"
              />
            )}

            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className="bg-su-brand-soft text-su-brand text-xs">
                {getInitials(user.full_name, user.email)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {user.full_name ?? 'Sin nombre'}
                </span>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${statusBadge.className}`}>
                  {statusBadge.label}
                </Badge>
              </div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>

            <div className="hidden min-w-[100px] text-sm text-muted-foreground md:block">
              {getRoleLabel(user.role_key, roles)}
            </div>

            <div className="hidden min-w-[120px] text-xs text-muted-foreground md:block">
              {user.access_status === 'active' ? getGroupLabel(user.group_id, groups) : null}
            </div>

            <div className="hidden min-w-[120px] text-xs text-muted-foreground md:block">
              {user.access_status === 'active' ? getManagerLabel(user.manager_id, allUsers) : null}
            </div>

            <div className="hidden min-w-[140px] text-xs text-muted-foreground md:block">
              {getDateLabel(user)}
            </div>

            {isAdmin && (
              <UserActions user={user} roles={roles} activeUsers={activeUsers} groups={groups} />
            )}
          </div>
        );
      })}
      </div>

      {/* Floating bulk toolbar */}
      {selectedIds.length > 0 && isAdmin && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-su-slide-in">
          <div className="flex items-center gap-2 rounded-2xl border border-border/80 bg-card px-4 py-2.5 shadow-lg">
            <span className="text-sm font-medium text-foreground pr-1">
              {selectedIds.length} seleccionado{selectedIds.length > 1 ? 's' : ''}
            </span>
            <div className="h-4 w-px bg-border" />
            {bulkActions.map(action => (
              <Button
                key={action.id}
                size="sm"
                variant={action.variant}
                className="gap-1.5 h-8 text-xs"
                onClick={() => setActiveAction(action)}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
            <div className="h-4 w-px bg-border" />
            <button
              onClick={() => setSelectedIds([])}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bulk action confirmation dialog */}
      {activeAction && (
        <Dialog open onOpenChange={closeDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{activeAction.confirmTitle(selectedIds.length)}</DialogTitle>
              <DialogDescription>{activeAction.confirmDesc(selectedIds.length)}</DialogDescription>
            </DialogHeader>

            {activeAction.requiresGroup && (
              <div className="space-y-1.5 py-2">
                <p className="text-sm font-medium text-foreground">Grupo organizacional</p>
                <Select value={groupId || undefined} onValueChange={v => setGroupId(v ?? '')}>
                  <SelectTrigger className="w-full">
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
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive border border-destructive/20">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={closeDialog} disabled={loading}>Cancelar</Button>
              <Button
                variant={activeAction.variant === 'destructive' ? 'destructive' : 'default'}
                onClick={executeBulkAction}
                disabled={loading}
              >
                {loading ? 'Procesando...' : activeAction.label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
