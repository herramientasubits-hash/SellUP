'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Check, UserPlus } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Spinner } from '@/components/feedback/spinner';
import { DrawerShell } from '@/components/shared/drawer-shell';
import type { AssignableUser } from '@/components/assignment/assign-owner-drawer';
import { cn } from '@/lib/utils';
import { splitEvenly } from '@/modules/assignment/assignment-core';
import { assignCandidatesToUser } from '@/modules/prospect-review/assign-actions';
import {
  getBulkSearchPendingCandidatesAction,
  type BulkSearchPendingCandidate,
} from '@/modules/prospect-batches/bulk-search/bulk-search-assign-actions';

const displayName = (user: AssignableUser) => user.full_name?.trim() || user.email;
const initials = (user: AssignableUser) => {
  const parts = displayName(user).split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0]?.slice(0, 2) ?? '?')).toUpperCase();
};

/**
 * «Asignar a…» desde una búsqueda masiva (GROWTH-BULK-SEARCH-1 · PR 4): las
 * empresas que la búsqueda trajo y siguen por asignar pasan a UNA persona o se reparten
 * en partes iguales entre varias (100 entre 3 → 34, 33, 33). Sin responsable no
 * se aprueban (#804), y así cada BD ve las suyas en «Por revisar».
 *
 * La asignación es la de siempre (`assignCandidatesToUser`): mismo alcance
 * comercial y mismo aviso en la campanita.
 */
export function BulkSearchAssignDrawer({
  open,
  onOpenChange,
  bulkSearchId,
  loadCandidates,
  label,
  users,
  onAssigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Una búsqueda masiva. */
  bulkSearchId?: string;
  /** Cualquier otra búsqueda (Empresas › Búsquedas): de dónde salen las empresas por repartir. */
  loadCandidates?: () => Promise<
    { ok: true; candidates: BulkSearchPendingCandidate[] } | { ok: false; message: string }
  >;
  label: string;
  users: AssignableUser[];
  onAssigned?: () => void;
}) {
  const [candidates, setCandidates] = React.useState<BulkSearchPendingCandidate[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // Se monta una vez por búsqueda (quien lo abre lo desmonta al cerrar), así
    // que el estado ya arranca vacío: sólo hay que leer.
    let alive = true;
    const load = loadCandidates ?? (() => getBulkSearchPendingCandidatesAction(bulkSearchId ?? ''));
    void load().then((result) => {
      if (!alive) return;
      if (result.ok) setCandidates(result.candidates);
      else setLoadError(result.message);
    });
    return () => {
      alive = false;
    };
    // `loadCandidates` se lee al abrir; no se vuelve a pedir si cambia entre aperturas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bulkSearchId]);

  const close = () => {
    setSelected([]);
    onOpenChange(false);
  };

  const ids = (candidates ?? []).map((candidate) => candidate.id);
  const shares = splitEvenly(ids, selected);
  const nameOf = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    return user ? displayName(user) : 'Persona';
  };
  const preview =
    shares.length === 0
      ? null
      : shares.length === 1
        ? `Las ${ids.length} empresas pasan a ${nameOf(shares[0].userId)}.`
        : `Se reparten ${ids.length} empresas entre ${shares.length} personas: ${shares.map((share) => share.ids.length).join(' · ')}.`;

  const toggle = (userId: string) =>
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));

  async function confirm() {
    if (shares.length === 0 || pending) return;
    setPending(true);
    let assigned = 0;
    const errors: string[] = [];
    for (const share of shares) {
      const result = await assignCandidatesToUser(share.ids, share.userId).catch(() => null);
      if (result?.success) assigned += result.assigned + result.alreadyOwned;
      else errors.push(`${nameOf(share.userId)}: ${result && !result.success ? result.error : 'no se pudo asignar'}`);
    }
    setPending(false);
    if (errors.length === 0) {
      toast.success(`Asignadas ${assigned} empresas`, { description: label });
      onAssigned?.();
      close();
    } else {
      toast.error('Algunas no se pudieron asignar', { description: errors.join(' · ') });
    }
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={(next) => !next && !pending && close()}
      title={`Asignar las empresas de «${label}»`}
      description="Pasan a quien elijas: las ve como suyas en «Por revisar» y, al aprobarlas, quedan a su nombre. Elige varias personas para repartirlas en partes iguales."
      icon={<UserPlus className="h-4 w-4" />}
      size="md"
      scrollable={false}
      actions={
        <>
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={shares.length === 0 || pending}>
            {pending && <Spinner size="sm" tone="inverse" decorative />}
            {shares.length > 1 ? `Repartir entre ${shares.length}` : 'Asignar'}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 bg-background px-6 py-5">
        {loadError && (
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {candidates === null && !loadError && <Spinner size="sm" label="Leyendo las empresas de la búsqueda…" />}
        {candidates !== null && candidates.length === 0 && (
          <Alert variant="info">
            <AlertDescription>No quedan empresas por asignar en esta búsqueda.</AlertDescription>
          </Alert>
        )}
        {preview && (
          <p className="text-sm text-foreground" role="status">
            {preview}
          </p>
        )}
        <Command className="min-h-0 flex-1 rounded-xl border border-border/60 bg-card">
          <CommandInput placeholder="Buscar persona por nombre o correo…" />
          <CommandList className="max-h-none flex-1 p-1">
            <CommandEmpty>Nadie coincide con esa búsqueda.</CommandEmpty>
            <CommandGroup>
              {users.map((user) => {
                const isSelected = selected.includes(user.id);
                return (
                  <CommandItem
                    key={user.id}
                    value={`${displayName(user)} ${user.email} ${user.id}`}
                    onSelect={() => toggle(user.id)}
                    aria-selected={isSelected}
                    className={cn('gap-3 py-2', isSelected && 'bg-primary/10 text-foreground')}
                  >
                    <Avatar size="sm">
                      <AvatarFallback className={cn(isSelected && 'bg-primary text-primary-foreground')}>
                        {initials(user)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{displayName(user)}</span>
                      <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                    </span>
                    <Check aria-hidden="true" className={cn('size-4 shrink-0 text-primary', !isSelected && 'invisible')} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </DrawerShell>
  );
}
