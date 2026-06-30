'use client';

import { useState } from 'react';
import { Check, Users } from 'lucide-react';
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
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'border-su-brand/40 bg-su-brand-soft/20'
                      : 'border-border/50 hover:border-border/80 hover:bg-muted/30'
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      isSelected ? 'border-su-brand bg-su-brand' : 'border-border'
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-su-brand-soft text-su-brand text-[10px]">
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
                    <Badge
                      variant="outline"
                      className="shrink-0 text-[10px] text-muted-foreground border-border/60"
                    >
                      {formatGroupLabel(user.group_id, allGroups)}
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
          <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
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
