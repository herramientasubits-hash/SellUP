'use client';

import { useMemo, useState } from 'react';
import { Users, Loader2 } from "@/icons";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ListItem, ListItemGroup } from '@/components/data-display';
import { ModalShell } from '@/components/shared/modal-shell';
import { EmptyState } from '@/components/ui/empty-state';
import { assignUsersToGroup } from '@/modules/access/actions';
import { formatGroupLabel } from '@/modules/access/display-helpers';
import type { InternalUser, OrganizationGroup } from '@/modules/access/types';
import { UserAvatar } from './user-avatar';

/** A partir de cuántas personas compensa mostrar el buscador. */
const SEARCH_MIN_USERS = 7;

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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleUser = (id: string) =>
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const handleClose = () => {
    setSelectedIds([]);
    setQuery('');
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
  const usersNotInGroup = useMemo(
    () => activeUsers.filter(u => u.group_id !== group.id),
    [activeUsers, group.id],
  );
  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return usersNotInGroup;
    return usersNotInGroup.filter(u =>
      u.email.toLowerCase().includes(needle) || (u.full_name?.toLowerCase().includes(needle) ?? false),
    );
  }, [usersNotInGroup, query]);
  const showSearch = usersNotInGroup.length >= SEARCH_MIN_USERS;

  return (
    <ModalShell
      open={open}
      onOpenChange={v => { if (!v) handleClose(); }}
      size="lg"
      title={<>Agregar usuarios a {groupName}</>}
      description={
        <>
          Selecciona uno o varios usuarios activos para asignarlos a este grupo.
          {usersAlreadyInGroup.length > 0 && (
            <> {usersAlreadyInGroup.length} usuario{usersAlreadyInGroup.length > 1 ? 's' : ''} ya {usersAlreadyInGroup.length > 1 ? 'están' : 'está'} en este grupo.</>
          )}
        </>
      }
      actions={
        <>
          <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={!selectedIds.length || loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            {loading ? 'Asignando...' : `Asignar${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {showSearch && (
          <Input
            inputSize="sm"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre o correo…"
            aria-label="Buscar usuario por nombre o correo"
          />
        )}

        <div className="max-h-72 overflow-y-auto p-1">
          {usersNotInGroup.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={Users}
              title="Todos los usuarios activos ya están en este grupo."
            />
          ) : visibleUsers.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={Users}
              title="Nadie coincide con tu búsqueda"
              description="Prueba con otro nombre o correo."
            />
          ) : (
            <ListItemGroup aria-label="Usuarios que puedes agregar">
              {visibleUsers.map(user => {
                const isSelected = selectedIds.includes(user.id);
                return (
                  <ListItem
                    key={user.id}
                    size="sm"
                    selected={isSelected}
                    onClick={() => toggleUser(user.id)}
                    leading={<UserAvatar name={user.full_name} email={user.email} size="sm" />}
                    title={user.full_name ?? user.email.split('@')[0]}
                    description={user.email}
                    meta={
                      user.group_id ? (
                        <Badge variant="neutral" className="max-w-40">
                          <span className="truncate">{formatGroupLabel(user.group_id, allGroups)}</span>
                        </Badge>
                      ) : undefined
                    }
                    actions={
                      // Fuera del área pulsable de la fila: un control dentro de otro no vale.
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleUser(user.id)}
                        aria-label={`Seleccionar a ${user.full_name ?? user.email}`}
                      />
                    }
                  />
                );
              })}
            </ListItemGroup>
          )}
        </div>

        {selectedIds.length > 0 && (
          <p className="text-center text-xs tabular-nums text-muted-foreground">
            {selectedIds.length} usuario{selectedIds.length > 1 ? 's' : ''} seleccionado{selectedIds.length > 1 ? 's' : ''}
          </p>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

      </div>
    </ModalShell>
  );
}
