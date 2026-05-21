'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Tag, Archive, Loader2 } from 'lucide-react';
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
}

export function AccountDetailActions({
  accountId,
  currentStatus,
  users,
}: AccountDetailActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);

  async function handleStatusChange(status: PipelineStatus) {
    const result = await updateAccount(accountId, { pipeline_status: status });
    if (result.success) {
      router.refresh();
      toast.success(`Estado cambiado a "${PIPELINE_STATUS_LABELS[status]}"`);
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
        toast.success('Cuenta archivada');
        router.push('/accounts');
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
        <DropdownMenuTrigger>
          <div className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border/60 bg-card hover:bg-accent transition-colors">
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            <span className="sr-only">Acciones de cuenta</span>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Editar cuenta
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
                  className={currentStatus === s.value ? 'font-medium text-su-brand' : ''}
                >
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setArchiveOpen(true)}>
            <Archive className="h-3.5 w-3.5" />
            Archivar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AccountEditDrawer
        accountId={accountId}
        users={users}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archivar cuenta</DialogTitle>
            <DialogDescription>
              Esta acción retira la cuenta del pipeline activo. Solo un administrador puede
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
                'Archivar cuenta'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
