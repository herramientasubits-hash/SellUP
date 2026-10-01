'use client';

import { useState } from 'react';
import { Check, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { assignUsersToGroup } from '@/modules/access/actions';
import { formatGroupLabel } from '@/modules/access/display-helpers';
import type { InternalUser, OrganizationGroup } from '@/modules/access/types';

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

interface AssignUsersToGroupDialogProps {
  group: OrganizationGroup;
  allGroups: OrganizationGroup[];
  activeUsers: InternalUser[];
  open: boolean;
  onClose: () => void;
}

export function AssignUsersToGroupDialog({
  group,
  allGroups,
  activeUsers,
  open,
  onClose,
}: AssignUsersToGroupDialogProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleUser = (id: string) =>
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const handleClose = () => {
    setSelectedIds([]);
    setError(null);
    onClose();
  };

  const handleSave = async () => {
    if (!selectedIds.length) return;
    setLoading(true);
    setError(null);
    const result = await assignUsersToGroup(group.id, selectedIds);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? 'Error desconocido');
      return;
    }
    handleClose();
    window.location.reload();
  };

  const groupName = group.name?.trim() || 'Grupo sin nombre';
  const usersAlreadyInGroup = activeUsers.filter(u => u.group_id === group.id);
  const usersNotInGroup = activeUsers.filter(u => u.group_id !== group.id);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar usuarios a {groupName}</DialogTitle>
          <DialogDescription>
            Selecciona uno o varios usuarios activos para asignarlos a este grupo.
            {usersAlreadyInGroup.length > 0 && (
              <> {usersAlreadyInGroup.length} usuario{usersAlreadyInGroup.length > 1 ? 's' : ''} ya {usersAlreadyInGroup.length > 1 ? 'están' : 'está'} en este grupo.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-1.5 overflow-y-auto py-1">
          {usersNotInGroup.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Todos los usuarios activos ya están en este grupo.
            </p>
          ) : (
            usersNotInGroup.map(user => {
              const isSelected = selectedIds.includes(user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggleUser(user.id)}
                  aria-pressed={isSelected}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 ${
                    isSelected
                      ? 'border-primary/40 bg-primary/10'
                      : 'border-border/50 hover:bg-surface-muted'
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-xs border-2 transition-colors ${
                      isSelected ? 'border-primary bg-primary' : 'border-border'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                  </div>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(user.full_name, user.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {user.full_name ?? user.email.split('@')[0]}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  {user.group_id && (
                    <Badge variant="neutral" className="max-w-[10rem] shrink-0">
                      <span className="truncate">
                      {formatGroupLabel(user.group_id, allGroups)}</span>
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>

        {selectedIds.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            {selectedIds.length} usuario{selectedIds.length > 1 ? 's' : ''} seleccionado{selectedIds.length > 1 ? 's' : ''}
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!selectedIds.length || loading}>
            <Users className="mr-2 h-4 w-4" />
            {loading ? 'Asignando...' : `Asignar${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
