'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, MoreHorizontal, Eye, Pencil, Tag, Archive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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

const STATUS_STYLES: Record<PipelineStatus, string> = {
  new: 'bg-muted text-muted-foreground',
  ready_for_research: 'bg-su-brand-soft text-su-brand',
  research_in_progress: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ready_for_outreach: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  archived: 'bg-muted/60 text-muted-foreground/60',
};

const SOURCE_STYLES: Record<AccountSource, string> = {
  manual: 'border-border text-muted-foreground',
  agent_1: 'bg-su-brand-soft text-su-brand border-transparent',
  hubspot: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-transparent',
  apollo: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-transparent',
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
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
          <Building2 className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Sin cuentas todavía</p>
          <p className="max-w-xs text-xs text-muted-foreground">
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
            <tr className="border-b border-border/30">
              {[
                'Empresa',
                'País',
                'Industria',
                'Dominio',
                'Estado',
                'Owner',
                'Fuente',
                'Creación',
                '',
              ].map((col) => (
                <th
                  key={col}
                  className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 last:w-12 last:px-3"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((account, i) => (
              <tr
                key={account.id}
                className="group border-b border-border/20 transition-colors hover:bg-accent/30 last:border-0 animate-su-slide-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <td className="px-5 py-3.5">
                  <Link
                    href={`/accounts/${account.id}`}
                    className="font-medium text-foreground hover:text-su-brand transition-colors"
                  >
                    {account.name}
                  </Link>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground">
                  {account.country_code ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-base leading-none">
                        {getFlagEmoji(account.country_code)}
                      </span>
                      <span className="text-xs">{account.country_code}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {account.industry ?? <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {account.domain ? (
                    <span className="font-mono">{account.domain}</span>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      STATUS_STYLES[account.pipeline_status]
                    }`}
                  >
                    {PIPELINE_STATUS_LABELS[account.pipeline_status]}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {account.owner_name ?? <span className="text-muted-foreground/40">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${SOURCE_STYLES[account.source as AccountSource]}`}
                  >
                    {SOURCE_LABELS[account.source as AccountSource]}
                  </Badge>
                </td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground">
                  {formatDate(account.created_at)}
                </td>
                <td className="px-3 py-3.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <div className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent">
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        <span className="sr-only">Acciones</span>
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => router.push(`/accounts/${account.id}`)}>
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
                              className={
                                account.pipeline_status === s.value
                                  ? 'font-medium text-su-brand'
                                  : ''
                              }
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

      {/* Edit drawer — single instance, controlled by editingId */}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchivingId(null)}
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
