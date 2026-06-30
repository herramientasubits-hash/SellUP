'use client';

import { useState } from 'react';
import { MoreHorizontal, Check, X, Pause, UserCog, Archive, RotateCcw, Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
}

export function UserActions({ user, roles, activeUsers, groups }: UserActionsProps) {
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
      <DropdownMenu>
        <DropdownMenuTrigger>
          <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
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

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar solicitud</DialogTitle>
            <DialogDescription>
              Asigna un rol y jefe directo a {user.full_name ?? user.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Rol</p>
              <Select
                value={selectedRole || undefined}
                onValueChange={(v) => setSelectedRole(v || '')}
              >
                <SelectTrigger className="w-full">
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
              <p className="text-sm font-medium text-foreground">Jefe directo</p>
              <Select
                value={selectedManager || undefined}
                onValueChange={(v) => setSelectedManager(v || '')}
              >
                <SelectTrigger className="w-full">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleApprove}
              disabled={!selectedRole || !selectedManager || loading}
            >
              Aprobar acceso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Manager Dialog */}
      <Dialog open={showManagerDialog} onOpenChange={setShowManagerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar jefe directo</DialogTitle>
            <DialogDescription>
              Actualiza el jefe directo de {user.full_name ?? user.email} en el organigrama.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select
              value={selectedManager || undefined}
              onValueChange={(v) => setSelectedManager(v || '')}
            >
              <SelectTrigger className="w-full">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowManagerDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleManagerChange} disabled={!selectedManager || loading}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar solicitud</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas rechazar la solicitud de {user.full_name ?? user.email}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReject} disabled={loading}>Rechazar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog open={showSuspendDialog} onOpenChange={setShowSuspendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspender acceso</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas suspender el acceso de {user.full_name ?? user.email}?
              El usuario no podrá acceder a SellUp hasta que su acceso sea reactivado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSuspendDialog(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleSuspend} disabled={loading}>Suspender</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate Dialog */}
      <Dialog open={showReactivateDialog} onOpenChange={setShowReactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reactivar acceso</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas reactivar el acceso de {user.full_name ?? user.email}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReactivateDialog(false)}>Cancelar</Button>
            <Button onClick={handleReactivate} disabled={loading}>Reactivar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Role Dialog */}
      <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar rol</DialogTitle>
            <DialogDescription>
              Asigna un nuevo rol a {user.full_name ?? user.email}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select
              value={selectedRole || undefined}
              onValueChange={(v) => setSelectedRole(v || '')}
            >
              <SelectTrigger className="w-full">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleDialog(false)}>Cancelar</Button>
            <Button onClick={handleRoleChange} disabled={!selectedRole || loading}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Dialog */}
      <Dialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archivar usuario</DialogTitle>
            <DialogDescription>
              {user.full_name ?? user.email} quedará archivado y no podrá acceder a SellUp.
              Esta acción es reversible solo por un administrador.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveDialog(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleArchive} disabled={loading}>
              <Archive className="mr-2 h-4 w-4" />
              Archivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Group Dialog */}
      <Dialog open={showGroupDialog} onOpenChange={setShowGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar grupo</DialogTitle>
            <DialogDescription>
              Asigna {user.full_name ?? user.email} a un grupo o equipo.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select
              value={selectedGroup || NO_GROUP_VALUE}
              onValueChange={(v) => setSelectedGroup(v ?? NO_GROUP_VALUE)}
            >
              <SelectTrigger className="w-full">
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGroupDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleGroupChange} disabled={loading}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate from Rejected Dialog */}
      <Dialog open={showActivateRejectedDialog} onOpenChange={setShowActivateRejectedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activar usuario rechazado</DialogTitle>
            <DialogDescription>
              Asigna un rol a {user.full_name ?? user.email} para activar su acceso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Rol <span className="text-destructive">*</span></p>
              <Select value={selectedRole || undefined} onValueChange={(v) => setSelectedRole(v || '')}>
                <SelectTrigger className="w-full">
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
              <p className="text-sm font-medium text-foreground">Jefe directo <span className="text-xs text-muted-foreground">(opcional)</span></p>
              <Select value={selectedManager || undefined} onValueChange={(v) => setSelectedManager(v || '')}>
                <SelectTrigger className="w-full">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowActivateRejectedDialog(false)}>Cancelar</Button>
            <Button onClick={handleActivateFromRejected} disabled={!selectedRole || loading}>
              <Check className="mr-2 h-4 w-4" />
              Activar acceso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
