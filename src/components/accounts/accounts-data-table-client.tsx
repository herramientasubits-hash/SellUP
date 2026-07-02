'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import {
  Eye,
  Pencil,
  Tag,
  Archive,
  Building2,
  ExternalLink,
  Loader2,
  UserSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
} from '@/components/data-table';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_LABELS,
  INDUSTRIES,
  LATAM_COUNTRIES,
  type AccountListItem,
  type AccountSource,
  type InternalUserOption,
  type PipelineStatus,
} from '@/modules/accounts/types';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import {
  ScopeFilterDrawerSection,
  type ScopeFilterState,
} from '@/components/shared/scope-filters-client';
import { updateAccount, archiveAccount } from '@/modules/accounts/actions';
import { AccountEditDrawer } from './account-edit-drawer';
import { AccountDetailSheet } from './account-detail-sheet';
import { ContactEnrichmentDrawer } from '@/components/contact-enrichment/contact-enrichment-drawer';

// ── Styles ─────────────────────────────────────────────────────

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

// ── Filter options ─────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const SOURCE_FILTER_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const INDUSTRY_FILTER_OPTIONS = INDUSTRIES.map((i) => ({ value: i, label: i }));

const COUNTRY_FILTER_OPTIONS = LATAM_COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
}));

// ── Helpers ────────────────────────────────────────────────────

function getFlagEmoji(countryCode: string): string {
  const offset = 0x1f1e6 - 'A'.charCodeAt(0);
  return [...countryCode.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + offset))
    .join('');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Types ──────────────────────────────────────────────────────

type Row = AccountListItem;

// ── Main Component ─────────────────────────────────────────────

interface AccountsDataTableClientProps {
  accounts: AccountListItem[];
  users: InternalUserOption[];
  scopeFilterOptions?: ScopeFilterOptions;
}

export function AccountsDataTableClient({ accounts, users, scopeFilterOptions }: AccountsDataTableClientProps) {
  const router = useRouter();

  const [detailAccountId, setDetailAccountId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [archivingId, setArchivingId] = React.useState<string | null>(null);
  const [archiving, setArchiving] = React.useState(false);
  const [enrichAccount, setEnrichAccount] = React.useState<Row | null>(null);

  const [scopeFilter, setScopeFilter] = React.useState<ScopeFilterState>({
    userId: '',
    groupId: '',
    roleKey: '',
  });

  const filteredAccounts = React.useMemo(() => {
    if (!scopeFilterOptions?.showScopeFilters) return accounts;
    const { userId, groupId, roleKey } = scopeFilter;
    if (!userId && !groupId && !roleKey) return accounts;
    const allowedUserIds = new Set(
      scopeFilterOptions.users
        .filter((u) => {
          if (roleKey && u.role_key !== roleKey) return false;
          if (groupId) {
            // simple descendant check: include if user group equals or starts with groupId hierarchy
            if (!u.group_id) return false;
            const group = scopeFilterOptions.groups.find((g) => g.id === groupId);
            if (!group) return false;
            // allow user if their group_id is in subtree — using the path/parent pattern
            const inSubtree = (gid: string): boolean => {
              if (gid === groupId) return true;
              const g = scopeFilterOptions.groups.find((x) => x.id === gid);
              return g?.parent_group_id ? inSubtree(g.parent_group_id) : false;
            };
            if (!inSubtree(u.group_id)) return false;
          }
          return true;
        })
        .map((u) => u.id),
    );
    return accounts.filter((a) => {
      if (userId) return a.owner_id === userId;
      return a.owner_id != null && allowedUserIds.has(a.owner_id);
    });
  }, [accounts, scopeFilter, scopeFilterOptions]);

  const openDetail = React.useCallback((id: string) => {
    setDetailAccountId(id);
    setDetailOpen(true);
  }, []);

  const handleStatusChange = React.useCallback(async (accountId: string, status: PipelineStatus) => {
    const result = await updateAccount(accountId, { pipeline_status: status });
    if (result.success) {
      router.refresh();
      toast.success(`Estado cambiado a "${PIPELINE_STATUS_LABELS[status]}"`);
    } else {
      toast.error(result.error);
    }
  }, [router]);

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

  // ── Column definitions ────────────────────────────────────────
  const columns: ColumnDef<Row, unknown>[] = React.useMemo(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Empresa" />
        ),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => openDetail(row.original.id)}
            className="font-medium text-foreground hover:text-su-brand transition-colors text-left text-sm"
          >
            {row.original.name}
          </button>
        ),
        size: 220,
        minSize: 180,
        enableHiding: false,
        meta: { label: 'Empresa', popoverTitle: 'Empresa' },
      },
      {
        id: 'country_code',
        accessorKey: 'country_code',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="País" />
        ),
        cell: ({ row }) => {
          const code = row.original.country_code;
          return code ? (
            <span className="flex items-center gap-1.5">
              <span className="text-base leading-none">{getFlagEmoji(code)}</span>
              <span className="text-xs text-muted-foreground">{code}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          );
        },
        size: 100,
        minSize: 80,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'País',
          popoverTitle: 'País',
          filterOptions: COUNTRY_FILTER_OPTIONS,
        },
      },
      {
        id: 'industry',
        accessorKey: 'industry',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Industria" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate block max-w-[160px]">
            {row.original.industry ?? <span className="text-muted-foreground/40">—</span>}
          </span>
        ),
        size: 160,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Industria',
          popoverTitle: 'Industria',
          filterOptions: INDUSTRY_FILTER_OPTIONS,
        },
      },
      {
        id: 'domain',
        accessorKey: 'domain',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Dominio" />
        ),
        cell: ({ row }) => {
          const domain = row.original.domain;
          return domain ? (
            <span className="text-xs text-muted-foreground font-mono truncate block max-w-[160px]">
              {domain}
            </span>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          );
        },
        size: 160,
        minSize: 120,
        meta: { label: 'Dominio', popoverTitle: 'Dominio' },
      },
      {
        id: 'pipeline_status',
        accessorKey: 'pipeline_status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => {
          const status = row.original.pipeline_status;
          return (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status]}`}
            >
              {PIPELINE_STATUS_LABELS[status]}
            </span>
          );
        },
        size: 140,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Estado',
          popoverTitle: 'Estado',
          filterOptions: STATUS_FILTER_OPTIONS,
        },
      },
      {
        id: 'owner_id',
        accessorKey: 'owner_id',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Responsable" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.owner_name ?? <span className="text-muted-foreground/40">—</span>}
          </span>
        ),
        size: 140,
        minSize: 100,
        filterFn: (row, _columnId, filterValue: string[]) => {
          if (!filterValue || filterValue.length === 0) return true;
          const val = row.original.owner_id;
          if (!val) return false;
          return filterValue.includes(val);
        },
        meta: {
          label: 'Responsable',
          popoverTitle: 'Responsable',
          ...(scopeFilterOptions?.showScopeFilters && scopeFilterOptions.users.length > 0
            ? {
                filterOptions: scopeFilterOptions.users.map((u) => ({
                  value: u.id,
                  label:
                    u.full_name && u.email
                      ? `${u.full_name} (${u.email})`
                      : (u.full_name ?? u.email ?? u.id.slice(0, 8)),
                })),
              }
            : {}),
        },
      },
      {
        id: 'source',
        accessorKey: 'source',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Fuente" />
        ),
        cell: ({ row }) => {
          const source = row.original.source as AccountSource;
          return (
            <Badge
              variant="outline"
              className={`text-[10px] ${SOURCE_STYLES[source]}`}
            >
              {SOURCE_LABELS[source]}
            </Badge>
          );
        },
        size: 110,
        minSize: 90,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Fuente',
          popoverTitle: 'Fuente',
          filterOptions: SOURCE_FILTER_OPTIONS,
        },
      },
      {
        id: 'created_at',
        accessorKey: 'created_at',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Creación" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDate(row.original.created_at)}
          </span>
        ),
        size: 110,
        minSize: 90,
        enableColumnFilter: false,
        meta: { label: 'Creación', popoverTitle: 'Creación', disableFilter: true },
      },
    ],
    [openDetail, scopeFilterOptions],
  );

  // ── Context menu ──────────────────────────────────────────────
  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => {
        const items: DataTableContextMenuItem[] = [
          {
            id: 'view',
            label: 'Ver detalle',
            icon: Eye,
            onClick: () => openDetail(row.id),
          },
          {
            id: 'edit',
            label: 'Editar cuenta',
            icon: Pencil,
            onClick: () => setEditingId(row.id),
          },
          {
            id: 'enrich-contacts',
            label: 'Enriquecer contactos',
            icon: UserSearch,
            onClick: () => setEnrichAccount(row),
          },
        ];

        // Status change submenu items
        const activeStatuses: { value: PipelineStatus; label: string }[] = [
          { value: 'new', label: PIPELINE_STATUS_LABELS.new },
          { value: 'ready_for_research', label: PIPELINE_STATUS_LABELS.ready_for_research },
          { value: 'research_in_progress', label: PIPELINE_STATUS_LABELS.research_in_progress },
          { value: 'ready_for_outreach', label: PIPELINE_STATUS_LABELS.ready_for_outreach },
        ];

        items.push({
          id: 'status',
          label: 'Cambiar estado',
          icon: Tag,
          separator: true,
          onClick: () => {
            const currentIdx = activeStatuses.findIndex((s) => s.value === row.pipeline_status);
            const nextIdx = (currentIdx + 1) % activeStatuses.length;
            handleStatusChange(row.id, activeStatuses[nextIdx].value);
          },
        });

        items.push({
          id: 'archive',
          label: 'Archivar',
          icon: Archive,
          variant: 'destructive' as const,
          onClick: () => setArchivingId(row.id),
        });

        if (row.domain) {
          items.push({
            id: 'open-website',
            label: 'Abrir sitio web',
            icon: ExternalLink,
            separator: true,
            onClick: () => {
              window.open(
                `https://${row.domain}`,
                '_blank',
                'noopener,noreferrer',
              );
            },
          });
        }

        return items;
      },
    }),
    [openDetail, handleStatusChange],
  );

  // ── Bulk actions ──────────────────────────────────────────────
  const bulkActions = React.useMemo<DataTableBulkAction<Row>[]>(
    () => [
      {
        id: 'view-detail',
        label: 'Ver detalle',
        icon: Eye,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openDetail(rows[0].id),
      },
      {
        id: 'edit-account',
        label: 'Editar cuenta',
        icon: Pencil,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => setEditingId(rows[0].id),
      },
      {
        id: 'open-websites',
        label: 'Abrir sitios web',
        icon: ExternalLink,
        disabled: (rows) => !rows.some((r) => r.domain),
        onClick: (rows) => {
          rows.forEach((r) => {
            if (r.domain) {
              window.open(`https://${r.domain}`, '_blank', 'noopener,noreferrer');
            }
          });
        },
      },
    ],
    [openDetail],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filteredAccounts}
        getRowId={(row) => row.id}
        title="Listado de empresas"
        description="Empresas, pipeline, fuente y estado."
        count={filteredAccounts.length}
        enableRowSelection
        contextMenu={contextMenu}
        bulkActions={bulkActions}
        enableColumnReorder
        initialPageSize={20}
        fillHeight
        onRowClick={(row) => openDetail(row.id)}
        rowClickable
        settingsExtraSections={
          scopeFilterOptions?.showScopeFilters ? (
            <ScopeFilterDrawerSection
              scopeFilterOptions={scopeFilterOptions}
              value={scopeFilter}
              onChange={setScopeFilter}
            />
          ) : undefined
        }
        emptyState={
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 rounded-full bg-muted/60 p-3">
              <Building2 className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground">Sin cuentas todavía</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Crea una cuenta manualmente o, más adelante, genera prospectos con IA.
            </p>
          </div>
        }
      />

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

      {/* Account detail sheet */}
      <AccountDetailSheet
        accountId={detailAccountId}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailAccountId(null);
        }}
      />

      {/* Contact enrichment sidepanel (Agente 2A) */}
      <ContactEnrichmentDrawer
        open={!!enrichAccount}
        onOpenChange={(v) => !v && setEnrichAccount(null)}
        preloadedCompany={enrichAccount ? {
          name: enrichAccount.name,
          domain: enrichAccount.domain,
          country: enrichAccount.country,
          countryCode: enrichAccount.country_code,
          sellupAccountId: enrichAccount.id,
        } : null}
      />
    </>
  );
}
