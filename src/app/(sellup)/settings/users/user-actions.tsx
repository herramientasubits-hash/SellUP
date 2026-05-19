'use client';

import { useState } from 'react';
import { MoreHorizontal, Check, X, Pause } from 'lucide-react';
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
import { approveUser, rejectUser, suspendUser, reactivateUser, changeUserRole } from '@/modules/access/actions';
import type { InternalUser, Role } from '@/modules/access/types';

interface UserActionsProps {
  user: InternalUser;
  roles: Role[];
}

export function UserActions({ user, roles }: UserActionsProps) {
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showSuspendDialog, setShowSuspendDialog] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [showRoleDialog, setShowRoleDialog] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    if (!selectedRole) return;
    setLoading(true);
    await approveUser(user.id, selectedRole);
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

  const handleRoleSelect = (value: string | null) => {
    if (value) setSelectedRole(value);
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowSuspendDialog(true)}>
                <Pause className="mr-2 h-4 w-4" />
                Suspender acceso
              </DropdownMenuItem>
            </>
          )}
          {user.access_status === 'suspended' && (
            <DropdownMenuItem onClick={() => setShowReactivateDialog(true)}>
              Reactivar acceso
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar solicitud</DialogTitle>
            <DialogDescription>
              Asigna un rol a {user.full_name ?? user.email} para aprobar su acceso a SellUp.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select 
              value={selectedRole || undefined} 
              onValueChange={(value) => setSelectedRole(value || '')}
            >
              <SelectTrigger className="w-full justify-between">
                {selectedRole ? (
                  <span className="truncate">{roles.find(r => r.id === selectedRole)?.name}</span>
                ) : (
                  <SelectValue placeholder="Seleccionar rol" />
                )}
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
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleApprove} disabled={!selectedRole || loading}>
              Aprobar acceso
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
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={loading}>
              Rechazar
            </Button>
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
            <Button variant="outline" onClick={() => setShowSuspendDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleSuspend} disabled={loading}>
              Suspender
            </Button>
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
            <Button variant="outline" onClick={() => setShowReactivateDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleReactivate} disabled={loading}>
              Reactivar
            </Button>
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
              onValueChange={(value) => setSelectedRole(value || '')}
            >
              <SelectTrigger className="w-full justify-between">
                {selectedRole ? (
                  <span className="truncate">{roles.find(r => r.id === selectedRole)?.name}</span>
                ) : (
                  <SelectValue placeholder="Seleccionar rol" />
                )}
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
            <Button variant="outline" onClick={() => setShowRoleDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRoleChange} disabled={!selectedRole || loading}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}