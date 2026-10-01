'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Tag, Archive, Loader2 } from "@/icons";
import { toast } from 'sonner';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { updateAccount, archiveAccount } from '@/modules/accounts/actions';
import {
  PIPELINE_STATUS_LABELS,
  type InternalUserOption,
  type PipelineStatus,
} from '@/modules/accounts/types';
import { AccountEditDrawer } from './account-edit-drawer';

const ACTIVE_STATUSES: { value: PipelineStatus; label: string }[] = [
  { value: 'new', label: PIPELINE_STATUS_LABELS.new },
  { value: 'ready_for_research', label: PIPELINE_STATUS_LABELS.ready_for_research },
  { value: 'research_in_progress', label: PIPELINE_STATUS_LABELS.research_in_progress },
  { value: 'ready_for_outreach', label: PIPELINE_STATUS_LABELS.ready_for_outreach },
];

interface AccountDetailActionsProps {
  accountId: string;
  currentStatus: PipelineStatus;
  users: InternalUserOption[];
  /**
   * Avisa de que el estado cambió. Quien muestra la empresa con datos cargados
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

export function AccountDetailActions({
  accountId,
  currentStatus,
  users,
  onChanged,
  onArchived,
}: AccountDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);

  async function handleStatusChange(status: PipelineStatus) {
    const result = await updateAccount(accountId, { pipeline_status: status });
    if (result.success) {
      router.refresh();
      onChanged?.();
      toast.success(`Estado cambiado a «${PIPELINE_STATUS_LABELS[status]}»`);
    } else {
      toast.error(result.error);
    }
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      const result = await archiveAccount(accountId);
      if (result.success) {
        setArchiveOpen(false);
        toast.success('Empresa archivada');
        if (onArchived) {
          router.refresh();
          onArchived();
        } else {
          router.push('/accounts');
        }
      } else {
        toast.error(result.error);
      }
    } finally {
      setArchiving(false);
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag className="h-3.5 w-3.5" />
              Cambiar estado
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {ACTIVE_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s.value}
                  onClick={() => handleStatusChange(s.value)}
                  className={currentStatus === s.value ? 'font-medium text-primary' : ''}
                >
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archivar empresa</DialogTitle>
            <DialogDescription>
              Esta acción retira la empresa del pipeline activo. Solo un administrador puede
              realizarla y queda registrada en auditoría. ¿Confirmas?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveOpen(false)}
              disabled={archiving}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleArchive}
              disabled={archiving}
            >
              {archiving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Archivando…
                </>
              ) : (
                'Archivar empresa'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
