'use client';

import { formatInAppZone } from '@/lib/format-date';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, MoreHorizontal, Eye, Pencil, Tag, Archive, Loader2 } from "@/icons";
import { toast } from 'sonner';
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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
  SOURCE_LABELS,
  type AccountListItem,
  type AccountSource,
  type InternalUserOption,
  type PipelineStatus,
} from '@/modules/accounts/types';
import { AccountEditDrawer } from './account-edit-drawer';
import { AccountDetailSheet } from './account-detail-sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const STATUS_VARIANT: Record<PipelineStatus, BadgeVariant> = {
  new: 'neutral',
  ready_for_research: 'brand',
  research_in_progress: 'warning',
  ready_for_outreach: 'positive',
  archived: 'neutral',
};

const SOURCE_VARIANT: Record<AccountSource, BadgeVariant> = {
  manual: 'neutral',
  agent_1: 'brand',
  hubspot: 'warning',
  apollo: 'info',
  imported: 'neutral',
  other: 'neutral',
};

const ACTIVE_STATUSES: { value: PipelineStatus; label: string }[] = [
  { value: 'new', label: PIPELINE_STATUS_LABELS.new },
  { value: 'ready_for_research', label: PIPELINE_STATUS_LABELS.ready_for_research },
  { value: 'research_in_progress', label: PIPELINE_STATUS_LABELS.research_in_progress },
  { value: 'ready_for_outreach', label: PIPELINE_STATUS_LABELS.ready_for_outreach },
];

function formatDate(iso: string): string {
  return formatInAppZone(iso, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }, 'es-CO');
}

function getFlagEmoji(countryCode: string): string {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...countryCode.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + offset))
    .join('');
}

interface AccountsTableProps {
  accounts: AccountListItem[];
  users: InternalUserOption[];
}

export function AccountsTable({ accounts, users }: AccountsTableProps) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [archivingId, setArchivingId] = React.useState<string | null>(null);
  const [archiving, setArchiving] = React.useState(false);
  const [sheetId, setSheetId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  function openSheet(id: string) {
    setSheetId(id);
    setSheetOpen(true);
  }

  async function handleStatusChange(accountId: string, status: PipelineStatus) {
    const result = await updateAccount(accountId, { pipeline_status: status });
    if (result.success) {
      router.refresh();
      toast.success(`Estado cambiado a "${PIPELINE_STATUS_LABELS[status]}"`);
    } else {
      toast.error(result.error);
    }
  }

  async function handleArchive() {
    if (!archivingId) return;
    setArchiving(true);
    try {
      const result = await archiveAccount(archivingId);
      if (result.success) {
        setArchivingId(null);
        router.refresh();
        toast.success('Cuenta archivada');
      } else {
        toast.error(result.error);
      }
    } finally {
      setArchiving(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="Sin cuentas todavía"
        description="Todavía no hay cuentas registradas. Crea una cuenta manualmente o, más adelante, genera prospectos con IA."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              {['Empresa', 'País', 'Industria', 'Dominio', 'Estado', 'Owner', 'Fuente', 'Creación', ''].map(
                (col) => (
                  <TableHead
                    key={col}
                    className="last:w-12"
                  >
                    {col}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account, i) => (
              <TableRow
                key={account.id}
                className="group animate-su-slide-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* Nombre — abre el drawer */}
                <TableCell className="whitespace-normal">
                  <button
                    type="button"
                    onClick={() => openSheet(account.id)}
                    className="font-medium text-foreground hover:text-primary transition-colors text-left rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    {account.name}
                  </button>
                </TableCell>

                <TableCell className="text-muted-foreground">
                  {account.country_code ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{getFlagEmoji(account.country_code)}</span>
                      <span className="text-xs">{account.country_code}</span>
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </TableCell>

                <TableCell className="text-xs whitespace-normal text-muted-foreground">
                  {account.industry ?? <span className="text-text-muted">—</span>}
                </TableCell>

                <TableCell className="text-xs text-muted-foreground">
                  {account.domain ? (
                    <span className="font-mono">{account.domain}</span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <Badge variant={STATUS_VARIANT[account.pipeline_status]}>
                    {PIPELINE_STATUS_LABELS[account.pipeline_status]}
                  </Badge>
                </TableCell>

                <TableCell className="text-xs text-muted-foreground">
                  {account.owner_name ?? <span className="text-text-muted">—</span>}
                </TableCell>

                <TableCell>
                  <Badge variant={SOURCE_VARIANT[account.source as AccountSource]}>
                    {SOURCE_LABELS[account.source as AccountSource]}
                  </Badge>
                </TableCell>

                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(account.created_at)}
                </TableCell>

                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                        >
                          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                          <span className="sr-only">Acciones</span>
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openSheet(account.id)}>
                        <Eye className="h-3.5 w-3.5" />
                        Ver detalle
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setEditingId(account.id)}>
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
                              onClick={() => handleStatusChange(account.id, s.value)}
                              className={account.pipeline_status === s.value ? 'font-medium text-primary' : ''}
                            >
                              {s.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setArchivingId(account.id)}
                      >
                        <Archive className="h-3.5 w-3.5" />
                        Archivar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit drawer */}
      {editingId && (
        <AccountEditDrawer
          accountId={editingId}
          users={users}
          open={!!editingId}
          onOpenChange={(v) => !v && setEditingId(null)}
        />
      )}

      {/* Archive confirmation dialog */}
      <Dialog open={!!archivingId} onOpenChange={(v) => !v && setArchivingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archivar cuenta</DialogTitle>
            <DialogDescription>
              Esta acción retira la cuenta del pipeline activo. Solo un administrador puede
              realizarla y queda registrada en auditoría. ¿Confirmas?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setArchivingId(null)} disabled={archiving}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" onClick={handleArchive} disabled={archiving}>
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

      {/* Account detail sheet — 70 % */}
      <AccountDetailSheet
        accountId={sheetId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
