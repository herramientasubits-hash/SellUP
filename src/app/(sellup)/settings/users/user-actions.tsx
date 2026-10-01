'use client';

import { useState } from 'react';
import { MoreHorizontal, Check, X, Pause, UserCog, Archive, RotateCcw, Users, Loader2 } from "@/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/shared/modal-shell';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FieldLabel } from '@/components/forms/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  approveUser,
  rejectUser,
  suspendUser,
  reactivateUser,
  changeUserRole,
  changeUserManager,
  changeUserGroup,
  archiveUser,
  activateFromRejected,
} from '@/modules/access/actions';
import type { InternalUser, Role, OrganizationGroup } from '@/modules/access/types';
import { formatGroupDisplayName, formatGroupLabel } from '@/modules/access/display-helpers';

const SELF_MANAGER_VALUE = '__self__';

const NO_GROUP_VALUE = '__no_group__';

interface UserActionsProps {
  user: InternalUser;
  roles: Role[];
  activeUsers: InternalUser[];
  groups: OrganizationGroup[];
  triggerMode?: 'dropdown' | 'inline';
}

export function UserActions({ user, roles, activeUsers, groups, triggerMode = 'dropdown' }: UserActionsProps) {
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [showManagerDialog, setShowManagerDialog] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showActivateRejectedDialog, setShowActivateRejectedDialog] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedManager, setSelectedManager] = useState<string>('');
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Possible managers: active users excluding the user being edited
  const possibleManagers = activeUsers.filter((u) => u.id !== user.id);

  const resolveManagerId = (val: string): string | null =>
    val === SELF_MANAGER_VALUE || val === '' ? null : val;

  const handleApprove = async () => {
    if (!selectedRole) return;
    setLoading(true);
    await approveUser(user.id, selectedRole, resolveManagerId(selectedManager));
    setLoading(false);
    setShowApproveDialog(false);
    window.location.reload();
  };

  const handleReject = async () => {
    setLoading(true);
    await rejectUser(user.id);
    setLoading(false);
    setShowRejectDialog(false);
    window.location.reload();
  };

  const handleSuspend = async () => {
    setLoading(true);
    await suspendUser(user.id);
    setLoading(false);
    setShowSuspendDialog(false);
    window.location.reload();
  };

  const handleReactivate = async () => {
    setLoading(true);
    await reactivateUser(user.id);
    setLoading(false);
    setShowReactivateDialog(false);
    window.location.reload();
  };

  const handleRoleChange = async () => {
    if (!selectedRole) return;
    setLoading(true);
    await changeUserRole(user.id, selectedRole);
    setLoading(false);
    setShowRoleDialog(false);
    window.location.reload();
  };

  const handleManagerChange = async () => {
    if (!selectedManager) return;
    setLoading(true);
    await changeUserManager(user.id, resolveManagerId(selectedManager));
    setLoading(false);
    setShowManagerDialog(false);
    window.location.reload();
  };

  const handleGroupChange = async () => {
    setLoading(true);
    const newGroupId = selectedGroup === NO_GROUP_VALUE || selectedGroup === '' ? null : selectedGroup;
    await changeUserGroup(user.id, newGroupId);
    setLoading(false);
    setShowGroupDialog(false);
    window.location.reload();
  };

  const handleArchive = async () => {
    setLoading(true);
    await archiveUser(user.id);
    setLoading(false);
    setShowArchiveDialog(false);
    window.location.reload();
  };

  const handleActivateFromRejected = async () => {
    if (!selectedRole) return;
    setLoading(true);
    await activateFromRejected(user.id, selectedRole, resolveManagerId(selectedManager));
    setLoading(false);
    setShowActivateRejectedDialog(false);
    window.location.reload();
  };

  return (
    <>
      {triggerMode === 'dropdown' ? (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Acciones del usuario">
            <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {user.access_status === 'pending_approval' && (
              <>
                <DropdownMenuItem onClick={() => setShowApproveDialog(true)}>
                  <Check className="mr-2 h-4 w-4" />
                  Aprobar y asignar rol
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowRejectDialog(true)}>
                  <X className="mr-2 h-4 w-4" />
                  Rechazar
                </DropdownMenuItem>
              </>
            )}
            {user.access_status === 'active' && (
              <>
                <DropdownMenuItem onClick={() => {
                  setSelectedRole(user.role_id ?? '');
                  setShowRoleDialog(true);
                }}>
                  Cambiar rol
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  setSelectedManager(user.manager_id ?? SELF_MANAGER_VALUE);
                  setShowManagerDialog(true);
                }}>
                  <UserCog className="mr-2 h-4 w-4" />
                  Cambiar jefe directo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  setSelectedGroup(user.group_id ?? NO_GROUP_VALUE);
                  setShowGroupDialog(true);
                }}>
                  <Users className="mr-2 h-4 w-4" />
                  Asignar grupo
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowSuspendDialog(true)}>
                  <Pause className="mr-2 h-4 w-4" />
                  Suspender acceso
                </DropdownMenuItem>
              </>
            )}
            {user.access_status === 'suspended' && (
              <>
                <DropdownMenuItem onClick={() => setShowReactivateDialog(true)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reactivar acceso
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowArchiveDialog(true)} className="text-muted-foreground">
                  <Archive className="mr-2 h-4 w-4" />
                  Archivar usuario
                </DropdownMenuItem>
              </>
            )}
            {user.access_status === 'rejected' && (
              <>
                <DropdownMenuItem onClick={() => {
                  setSelectedRole('');
                  setSelectedManager('');
                  setShowActivateRejectedDialog(true);
                }}>
                  <Check className="mr-2 h-4 w-4" />
                  Activar (asignar rol)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowSuspendDialog(true)}>
                  <Pause className="mr-2 h-4 w-4" />
                  Suspender acceso
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowArchiveDialog(true)} className="text-muted-foreground">
                  <Archive className="mr-2 h-4 w-4" />
                  Archivar usuario
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        /* Inline mode: action buttons for the floating selection bar (single user) */
        <div className="flex flex-wrap items-center gap-1.5">
          {user.access_status === 'pending_approval' && (
            <>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => setShowApproveDialog(true)}>
                <Check className="h-3.5 w-3.5" />
                Aprobar y asignar rol
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-destructive hover:text-destructive" onClick={() => setShowRejectDialog(true)}>
                <X className="h-3.5 w-3.5" />
                Rechazar
              </Button>
            </>
          )}
          {user.access_status === 'active' && (
            <>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => { setSelectedRole(user.role_id ?? ''); setShowRoleDialog(true); }}>
                Cambiar rol
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => { setSelectedManager(user.manager_id ?? SELF_MANAGER_VALUE); setShowManagerDialog(true); }}>
                <UserCog className="h-3.5 w-3.5" />
                Jefe directo
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => { setSelectedGroup(user.group_id ?? NO_GROUP_VALUE); setShowGroupDialog(true); }}>
                <Users className="h-3.5 w-3.5" />
                Asignar grupo
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-destructive hover:text-destructive" onClick={() => setShowSuspendDialog(true)}>
                <Pause className="h-3.5 w-3.5" />
                Suspender
              </Button>
            </>
          )}
          {user.access_status === 'suspended' && (
            <>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => setShowReactivateDialog(true)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reactivar
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-destructive hover:text-destructive" onClick={() => setShowArchiveDialog(true)}>
                <Archive className="h-3.5 w-3.5" />
                Archivar
              </Button>
            </>
          )}
          {user.access_status === 'rejected' && (
            <>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => { setSelectedRole(''); setSelectedManager(''); setShowActivateRejectedDialog(true); }}>
                <Check className="h-3.5 w-3.5" />
                Activar (rol)
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-destructive hover:text-destructive" onClick={() => setShowSuspendDialog(true)}>
                <Pause className="h-3.5 w-3.5" />
                Suspender
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 hover:bg-white/10 text-nav-foreground hover:text-nav-foreground" onClick={() => setShowArchiveDialog(true)}>
                <Archive className="h-3.5 w-3.5" />
                Archivar
              </Button>
            </>
          )}
        </div>
      )}

      {/* Approve Dialog */}
      <ModalShell
        open={showApproveDialog}
        onOpenChange={setShowApproveDialog}
        title="Aprobar solicitud"
        description={<>Asigna un rol y jefe directo a {user.full_name ?? user.email}.</>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleApprove}
              disabled={!selectedRole || !selectedManager || loading}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Aprobar acceso
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Rol</FieldLabel>
            <Select
              value={selectedRole || undefined}
              onValueChange={(v) => setSelectedRole(v || '')}
            >
              <SelectTrigger className="w-full" aria-label="Rol">
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Jefe directo</FieldLabel>
            <Select
              value={selectedManager || undefined}
              onValueChange={(v) => setSelectedManager(v || '')}
            >
              <SelectTrigger className="w-full" aria-label="Jefe directo">
                <SelectValue placeholder="Seleccionar jefe directo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELF_MANAGER_VALUE}>
                  👤 Soy mi propio jefe
                </SelectItem>
                {possibleManagers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name ?? u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </ModalShell>

      {/* Change Manager Dialog */}
      <ModalShell
        open={showManagerDialog}
        onOpenChange={setShowManagerDialog}
        title="Cambiar jefe directo"
        description={<>Actualiza el jefe directo de {user.full_name ?? user.email} en el organigrama.</>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setShowManagerDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleManagerChange} disabled={!selectedManager || loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </>
        }
      >
        <Select
          value={selectedManager || undefined}
          onValueChange={(v) => setSelectedManager(v || '')}
        >
          <SelectTrigger className="w-full" aria-label="Jefe directo">
            <SelectValue placeholder="Seleccionar jefe directo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SELF_MANAGER_VALUE}>
              👤 Soy mi propio jefe
            </SelectItem>
            {possibleManagers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ModalShell>

      {/* Reject Dialog */}
      <ConfirmDialog
        open={showRejectDialog}
        onOpenChange={setShowRejectDialog}
        variant="destructive"
        icon={X}
        title="Rechazar solicitud"
        description={`¿Estás seguro de que deseas rechazar la solicitud de ${user.full_name ?? user.email}?`}
        confirmLabel="Rechazar"
        loading={loading}
        onConfirm={handleReject}
      />

      {/* Suspend Dialog */}
      <ConfirmDialog
        open={showSuspendDialog}
        onOpenChange={setShowSuspendDialog}
        variant="destructive"
        icon={Pause}
        title="Suspender acceso"
        description={`¿Estás seguro de que deseas suspender el acceso de ${user.full_name ?? user.email}? El usuario no podrá acceder a SellUp hasta que su acceso sea reactivado.`}
        confirmLabel="Suspender"
        loading={loading}
        onConfirm={handleSuspend}
      />

      {/* Reactivate Dialog */}
      <ConfirmDialog
        open={showReactivateDialog}
        onOpenChange={setShowReactivateDialog}
        icon={RotateCcw}
        title="Reactivar acceso"
        description={`¿Estás seguro de que deseas reactivar el acceso de ${user.full_name ?? user.email}?`}
        confirmLabel="Reactivar"
        loading={loading}
        onConfirm={handleReactivate}
      />

      {/* Change Role Dialog */}
      <ModalShell
        open={showRoleDialog}
        onOpenChange={setShowRoleDialog}
        title="Cambiar rol"
        description={<>Asigna un nuevo rol a {user.full_name ?? user.email}.</>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setShowRoleDialog(false)}>Cancelar</Button>
            <Button type="button" onClick={handleRoleChange} disabled={!selectedRole || loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </>
        }
      >
        <Select
          value={selectedRole || undefined}
          onValueChange={(v) => setSelectedRole(v || '')}
        >
          <SelectTrigger className="w-full" aria-label="Rol">
            <SelectValue placeholder="Seleccionar rol" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ModalShell>

      {/* Archive Dialog */}
      <ConfirmDialog
        open={showArchiveDialog}
        onOpenChange={setShowArchiveDialog}
        variant="destructive"
        icon={Archive}
        title="Archivar usuario"
        description={`${user.full_name ?? user.email} quedará archivado y no podrá acceder a SellUp. Esta acción es reversible solo por un administrador.`}
        confirmLabel="Archivar"
        loading={loading}
        onConfirm={handleArchive}
      />

      {/* Assign Group Dialog */}
      <ModalShell
        open={showGroupDialog}
        onOpenChange={setShowGroupDialog}
        title="Asignar grupo"
        description={<>Asigna {user.full_name ?? user.email} a un grupo o equipo.</>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setShowGroupDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleGroupChange} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </>
        }
      >
        <Select
          value={selectedGroup || NO_GROUP_VALUE}
          onValueChange={(v) => setSelectedGroup(v ?? NO_GROUP_VALUE)}
        >
          <SelectTrigger className="w-full" aria-label="Grupo">
            {/* Provide children to avoid Radix showing raw UUID before SelectItem text registers */}
            <SelectValue>
              {!selectedGroup || selectedGroup === NO_GROUP_VALUE
                ? 'Sin grupo'
                : formatGroupLabel(selectedGroup, groups)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GROUP_VALUE}>Sin grupo</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {formatGroupDisplayName(g)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ModalShell>

      {/* Activate from Rejected Dialog */}
      <ModalShell
        open={showActivateRejectedDialog}
        onOpenChange={setShowActivateRejectedDialog}
        title="Activar usuario rechazado"
        description={<>Asigna un rol a {user.full_name ?? user.email} para activar su acceso.</>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setShowActivateRejectedDialog(false)}>Cancelar</Button>
            <Button type="button" onClick={handleActivateFromRejected} disabled={!selectedRole || loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Activar acceso
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Rol <span className="text-destructive">*</span></FieldLabel>
            <Select value={selectedRole || undefined} onValueChange={(v) => setSelectedRole(v || '')}>
              <SelectTrigger className="w-full" aria-label="Rol">
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <FieldLabel className="block leading-none">Jefe directo <span className="text-xs text-muted-foreground">(opcional)</span></FieldLabel>
            <Select value={selectedManager || undefined} onValueChange={(v) => setSelectedManager(v || '')}>
              <SelectTrigger className="w-full" aria-label="Jefe directo">
                <SelectValue placeholder="Sin jefe directo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELF_MANAGER_VALUE}>Sin jefe directo</SelectItem>
                {possibleManagers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </ModalShell>
    </>
  );
}
