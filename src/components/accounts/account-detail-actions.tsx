'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Archive } from "@/icons";
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { InternalUserOption } from '@/modules/accounts/types';
import { AccountEditDrawer } from './account-edit-drawer';
import { ArchiveAccountDialog } from './archive-account-dialog';

interface AccountDetailActionsProps {
  accountId: string;
  users: InternalUserOption[];
  /**
   * Avisa de que la empresa cambió (al cerrar el editor). Quien muestra la empresa con datos cargados
   * en el cliente (el panel lateral) la usa para volver a leerlos; la página de
   * detalle no la necesita porque `router.refresh()` ya la repinta.
   */
  onChanged?: () => void;
  /**
   * Avisa de que la empresa se archivó. Con ella el menú NO navega a la lista:
   * quien lo aloja decide (el panel lateral se cierra).
   */
  onArchived?: () => void;
}

/**
 * El menú «Más acciones» de la empresa: editar y archivar. El estado ya no se cambia
 * a mano: avanza con lo que hacen los agentes (Agente 3: «Investigación en curso» y
 * «Lista para contacto»).
 */
export function AccountDetailActions({
  accountId,
  users,
  onChanged,
  onArchived,
}: AccountDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  function handleArchived() {
    if (onArchived) {
      router.refresh();
      onArchived();
    } else {
      router.push('/accounts');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="icon-sm">
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              <span className="sr-only">Más acciones de la empresa</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Editar empresa
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setArchiveOpen(true)}>
            <Archive className="h-3.5 w-3.5" />
            Archivar empresa
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AccountEditDrawer
        accountId={accountId}
        users={users}
        open={editOpen}
        onOpenChange={(nextOpen) => {
          setEditOpen(nextOpen);
          // Al cerrar el editor, quien aloja el menú vuelve a leer la empresa.
          if (!nextOpen) onChanged?.();
        }}
      />

      <ArchiveAccountDialog
        accountId={archiveOpen ? accountId : null}
        onClose={() => setArchiveOpen(false)}
        onArchived={handleArchived}
      />
    </>
  );
}
