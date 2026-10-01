'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Building2, MoreHorizontal, Eye, Pencil, Tag, Archive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ComponentProps } from 'react';
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

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const STATUS_VARIANT: Record<PipelineStatus, BadgeVariant> = {
  new: 'neutral',
  ready_for_research: 'brand',
  research_in_progress: 'warning',
  ready_for_outreach: 'positive',
  archived: 'neutral',
};

const SOURCE_STYLES: Record<AccountSource, string> = {
  manual: 'border-border text-muted-foreground',
  agent_1: 'bg-primary/10 text-primary border-transparent',
  hubspot: 'bg-warning/10 text-warning border-transparent',
  apollo: 'bg-info/10 text-info border-transparent',
  imported: 'border-border text-muted-foreground',
  other: 'border-border text-muted-foreground',
};

const ACTIVE_STATUSES: { value: PipelineStatus; label: string }[] = [
  { value: 'new', label: PIPELINE_STATUS_LABELS.new },
  { value: 'ready_for_research', label: PIPELINE_STATUS_LABELS.ready_for_research },
  { value: 'research_in_progress', label: PIPELINE_STATUS_LABELS.research_in_progress },
  { value: 'ready_for_outreach', label: PIPELINE_STATUS_LABELS.ready_for_outreach },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-muted">
          <Building2 className="h-5 w-5 text-text-muted" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Sin cuentas todavía</p>
          <p className="max-w-xs text-xs text-muted-foreground mx-auto">
            Todavía no hay cuentas registradas. Crea una cuenta manualmente o, más adelante,
            genera prospectos con IA.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border/50">
              {['Empresa', 'País', 'Industria', 'Dominio', 'Estado', 'Owner', 'Fuente', 'Creación', ''].map(
                (col) => (
                  <th
                    key={col}
                    className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground last:w-12 last:px-3"
                  >
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account, i) => (
              <tr
                key={account.id}
                className="group border-b border-border/50 transition-colors hover:bg-surface-muted last:border-0 animate-su-slide-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* Nombre — abre el drawer */}
                <td className="px-5 py-3.5">
                  <button
                    type="button"
                    onClick={() => openSheet(account.id)}
                    className="font-medium text-foreground hover:text-primary transition-colors text-left rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    {account.name}
                  </button>
                </td>

                <td className="px-5 py-3.5 text-muted-foreground">
                  {account.country_code ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-base leading-none">{getFlagEmoji(account.country_code)}</span>
                      <span className="text-xs">{account.country_code}</span>
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>

                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {account.industry ?? <span className="text-text-muted">—</span>}
                </td>

                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {account.domain ? (
                    <span className="font-mono">{account.domain}</span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>

                <td className="px-5 py-3.5">
                  <Badge variant={STATUS_VARIANT[account.pipeline_status]}>
                    {PIPELINE_STATUS_LABELS[account.pipeline_status]}
                  </Badge>
                </td>

                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {account.owner_name ?? <span className="text-text-muted">—</span>}
                </td>

                <td className="px-5 py-3.5">
                  <Badge
                    variant="outline"
                    className={SOURCE_STYLES[account.source as AccountSource]}
                  >
                    {SOURCE_LABELS[account.source as AccountSource]}
                  </Badge>
                </td>

                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {formatDate(account.created_at)}
                </td>

                <td className="px-3 py-3.5">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
