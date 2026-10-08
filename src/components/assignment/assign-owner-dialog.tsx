'use client';

// BULK-COMPANY-ASSIGNMENT-1 — «Asignar a…» para una o varias empresas.
//
// Lo usan Empresas (cambia el responsable) y Por revisar (el prospecto pasa a
// ser de la persona elegida). La pantalla decide qué acción de servidor llama;
// este diálogo solo elige a la persona, confirma y avisa del resultado.

import * as React from 'react';
import { toast } from 'sonner';
import { Check } from '@/icons';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Spinner } from '@/components/feedback/spinner';
import { ModalShell } from '@/components/shared/modal-shell';
import { cn } from '@/lib/utils';
import {
  assignmentNoun,
  describeAssignmentResult,
  type AssignmentActionResult,
  type AssignmentKind,
} from '@/modules/assignment/assignment-core';

export interface AssignableItem {
  id: string;
  name: string;
  /** Responsable actual (para marcar «ya es suya» y no repetir). */
  currentOwnerId: string | null;
}

export interface AssignableUser {
  id: string;
  full_name: string | null;
  email: string;
}

interface AssignOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: AssignmentKind;
  items: AssignableItem[];
  users: AssignableUser[];
  currentUserId?: string;
  onAssign: (ids: string[], userId: string) => Promise<AssignmentActionResult>;
  /** Tras asignar con éxito (limpiar selección, refrescar). */
  onAssigned?: () => void;
}

function displayName(user: AssignableUser): string {
  return user.full_name?.trim() || user.email;
}

function initials(user: AssignableUser): string {
  const parts = displayName(user).split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) ?? '?';
  return letters.toUpperCase();
}

const DESCRIPTIONS: Record<AssignmentKind, string> = {
  accounts: 'La persona elegida queda como responsable y recibe un aviso en la campanita.',
  candidates:
    'Pasan a ser de la persona elegida: las ve como suyas en «Por revisar» y, al aprobarlas, quedan a su nombre. Recibe un aviso en la campanita.',
};

export function AssignOwnerDialog({
  open,
  onOpenChange,
  kind,
  items,
  users,
  currentUserId,
  onAssign,
  onAssigned,
}: AssignOwnerDialogProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  // Al cerrar se olvida la persona elegida: la próxima apertura empieza limpia.
  function close() {
    setSelectedId(null);
    onOpenChange(false);
  }

  const ownedCount = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.currentOwnerId) counts.set(item.currentOwnerId, (counts.get(item.currentOwnerId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  // Primero quien asigna, luego por nombre.
  const sortedUsers = React.useMemo(
    () =>
      [...users].sort((a, b) => {
        if (a.id === currentUserId) return -1;
        if (b.id === currentUserId) return 1;
        return displayName(a).localeCompare(displayName(b), 'es');
      }),
    [users, currentUserId],
  );

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;
  const count = items.length;
  const title =
    count === 1 ? `Asignar «${items[0]?.name ?? ''}»` : `Asignar ${count} ${assignmentNoun(kind, count)}`;

  const allAlreadyOwned = selectedId !== null && (ownedCount.get(selectedId) ?? 0) === count;

  async function handleConfirm() {
    if (!selectedUser || pending) return;
    setPending(true);
    try {
      const result = await onAssign(
        items.map((item) => item.id),
        selectedUser.id,
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const summary = describeAssignmentResult({ kind, ...result });
      if (result.assigned > 0) toast.success(summary);
      else toast.info(summary);
      close();
      onAssigned?.();
    } catch {
      toast.error('No se pudo asignar. Inténtalo de nuevo.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => !next && !pending && close()}
      title={title}
      description={DESCRIPTIONS[kind]}
      size="md"
      actions={
        <>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedUser || pending || allAlreadyOwned}>
            {pending && <Spinner size="sm" tone="inverse" decorative />}
            {selectedUser ? `Asignar a ${displayName(selectedUser)}` : 'Asignar'}
          </Button>
        </>
      }
    >
      <Command className="rounded-xl border border-border/60 bg-card">
        <CommandInput placeholder="Buscar persona por nombre o correo…" autoFocus />
        <CommandList className="max-h-72 p-1">
          <CommandEmpty>Nadie coincide con esa búsqueda.</CommandEmpty>
          <CommandGroup>
            {sortedUsers.map((user) => {
              const isSelected = user.id === selectedId;
              const owned = ownedCount.get(user.id) ?? 0;
              return (
                <CommandItem
                  key={user.id}
                  value={`${displayName(user)} ${user.email} ${user.id}`}
                  onSelect={() => setSelectedId(user.id)}
                  aria-selected={isSelected}
                  className={cn('gap-3 py-2', isSelected && 'bg-primary/10 text-foreground')}
                >
                  <Avatar size="sm">
                    <AvatarFallback
                      className={cn(isSelected && 'bg-primary text-primary-foreground')}
                    >
                      {initials(user)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      {displayName(user)}
                      {user.id === currentUserId && (
                        <span className="font-normal text-muted-foreground"> · tú</span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </span>
                  {owned > 0 && (
                    <Badge variant="neutral" className="shrink-0">
                      {owned === count
                        ? count === 1
                          ? 'Ya es suya'
                          : 'Ya son suyas'
                        : `Ya tiene ${owned}`}
                    </Badge>
                  )}
                  <Check
                    aria-hidden="true"
                    className={cn('size-4 shrink-0 text-primary', !isSelected && 'invisible')}
                  />
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </ModalShell>
  );
}
