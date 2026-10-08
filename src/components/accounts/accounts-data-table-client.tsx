'use client';

import { formatInAppZone } from '@/lib/format-date';
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
  UserSearch,
  Globe,
  Search,
  Sparkles,
  SendHorizonal,
  UserPlus,
} from "@/icons";
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ArchiveAccountDialog } from './archive-account-dialog';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
  type DataTableHandle,
  type DataTableListRowState,
} from '@/components/data-table';
import { ListItem } from '@/components/data-display/list-item';
import {
  QuickFilterChips,
  QuickFilterEmptyState,
  QuickFilterStrip,
  useQuickFilter,
  useWideViewport,
  type QuickFilterDefinition,
} from '@/components/filters/quick-filter-strip';
import {
  CountryCell,
  EmptyCell,
  ExternalLinkCell,
  RowTitleButton,
  countryName,
} from '@/components/shared/table-cells';
import {
  PIPELINE_STATUS_LABELS,
  INDUSTRIES,
  LATAM_COUNTRIES,
  type AccountListItem,
  type InternalUserOption,
  type PipelineStatus,
} from '@/modules/accounts/types';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import { archiveAccounts, assignAccountsToUser, updateAccount } from '@/modules/accounts/actions';
import { AssignOwnerDialog } from '@/components/assignment/assign-owner-dialog';
import { AccountEditDrawer } from './account-edit-drawer';
import { AccountDetailSheet } from './account-detail-sheet';
import { ContactEnrichmentDrawer } from '@/components/contact-enrichment/contact-enrichment-drawer';
import type { ContactEnrichmentInitialCompany } from '@/components/contact-enrichment/contact-enrichment-drawer';
import { BulkContactEnrichmentDrawer } from '@/components/contact-enrichment/bulk-contact-enrichment-drawer';

// ── Styles ─────────────────────────────────────────────────────

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const STATUS_VARIANT: Record<PipelineStatus, BadgeVariant> = {
  new: 'neutral',
  ready_for_research: 'brand',
  research_in_progress: 'warning',
  ready_for_outreach: 'positive',
  archived: 'neutral',
};

// ── Indicadores que filtran ────────────────────────────────────
// Los mismos tres estados que antes eran tarjetas de métricas: ahora son
// botones de la franja y pulsarlos deja en la tabla solo esas empresas.

const ACCOUNT_QUICK_FILTERS: readonly QuickFilterDefinition<AccountListItem>[] = [
  {
    id: 'new',
    label: 'Nuevas',
    icon: Sparkles,
    tone: 'neutral',
    predicate: (account) => account.pipeline_status === 'new',
  },
  {
    id: 'ready_for_research',
    label: 'Listas para investigar',
    icon: Search,
    tone: 'brand',
    predicate: (account) => account.pipeline_status === 'ready_for_research',
  },
  {
    id: 'ready_for_outreach',
    label: 'Listas para contacto',
    icon: SendHorizonal,
    tone: 'positive',
    predicate: (account) => account.pipeline_status === 'ready_for_outreach',
  },
];

/** Los estados a los que se puede pasar una empresa desde su menú. */
const ACTIVE_PIPELINE_STATUSES: PipelineStatus[] = [
  'new',
  'ready_for_research',
  'research_in_progress',
  'ready_for_outreach',
];

// ── Filter options ─────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = Object.entries(PIPELINE_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const INDUSTRY_FILTER_OPTIONS = INDUSTRIES.map((i) => ({ value: i, label: i }));

const COUNTRY_FILTER_OPTIONS = LATAM_COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
}));

// ── Helpers ────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return formatInAppZone(iso, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }, 'es-CO');
}

// ── Types ──────────────────────────────────────────────────────

type Row = AccountListItem;

// ── Main Component ─────────────────────────────────────────────

interface AccountsDataTableClientProps {
  accounts: AccountListItem[];
  users: InternalUserOption[];
  scopeFilterOptions?: ScopeFilterOptions;
  /**
   * Lo que se ofrece cuando todavía no hay ninguna empresa (crear una, ir a
   * revisar prospectos). Lo arma la página, que es la que tiene los drawers.
   */
  emptyActions?: React.ReactNode;
}

export function AccountsDataTableClient({
  accounts,
  users,
  scopeFilterOptions,
  emptyActions,
}: AccountsDataTableClientProps) {
  const router = useRouter();

  const [detailAccountId, setDetailAccountId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [archivingId, setArchivingId] = React.useState<string | null>(null);
  const [enrichCompany, setEnrichCompany] = React.useState<ContactEnrichmentInitialCompany | null>(null);
  const [bulkEnrichOpen, setBulkEnrichOpen] = React.useState(false);
  const [bulkEnrichAccounts, setBulkEnrichAccounts] = React.useState<Row[]>([]);
  // «Asignar a…»: las empresas a las que se les cambia el responsable.
  const [assignRows, setAssignRows] = React.useState<Row[]>([]);

  const dataTableRef = React.useRef<DataTableHandle>(null);

  const quick = useQuickFilter(accounts, ACCOUNT_QUICK_FILTERS);
  // Cambiar de indicador cambia la lista: lo marcado deja de tener sentido.
  const toggleQuickFilter = React.useCallback(
    (id: string) => {
      dataTableRef.current?.clearSelection();
      quick.toggle(id);
    },
    [quick],
  );

  // En pantalla ancha los indicadores van dentro de la barra de la tabla (no
  // gastan un renglón); en estrecha, en su franja encima.
  const isWide = useWideViewport();
  const quickFilterGroup = {
    label: 'Indicadores de empresas',
    options: quick.options,
    value: quick.activeId,
    onToggle: toggleQuickFilter,
  };

  const openDetail = React.useCallback((id: string) => {
    setDetailAccountId(id);
    setDetailOpen(true);
  }, []);

  const handleStatusChange = React.useCallback(async (accountId: string, status: PipelineStatus) => {
    const result = await updateAccount(accountId, { pipeline_status: status });
    if (result.success) {
      router.refresh();
      toast.success(`Estado cambiado a «${PIPELINE_STATUS_LABELS[status]}»`);
    } else {
      toast.error(result.error);
    }
  }, [router]);

  // Los responsables que aparecen en la lista, para el embudo de la columna
  // cuando no hay opciones de equipo (si no, saldrían identificadores). La
  // columna «Responsable» es el filtro por persona de Empresas: por eso esta
  // tabla no lleva además el botón «Equipo».
  const ownerFilterOptions = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const account of accounts) {
      if (account.owner_id && !names.has(account.owner_id)) {
        names.set(account.owner_id, account.owner_name ?? 'Sin nombre');
      }
    }
    return Array.from(names, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, 'es'),
    );
  }, [accounts]);

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
          <RowTitleButton onClick={() => openDetail(row.original.id)}>
            {row.original.name}
          </RowTitleButton>
        ),
        size: 220,
        minSize: 180,
        enableHiding: false,
        // Texto libre: se ordena y se busca, no se filtra por valores.
        meta: { label: 'Empresa', popoverTitle: 'Empresa', disableFilter: true },
      },
      {
        id: 'country_code',
        accessorKey: 'country_code',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="País" />
        ),
        cell: ({ row }) => <CountryCell code={row.original.country_code} />,
        size: 130,
        minSize: 110,
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
        cell: ({ row }) =>
          row.original.industry ? (
            <span
              className="block truncate text-xs text-muted-foreground"
              title={row.original.industry}
            >
              {row.original.industry}
            </span>
          ) : (
            <EmptyCell label="Sin industria" />
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
            <ExternalLinkCell
              href={domain}
              icon={Globe}
              label={`Abrir el sitio web de ${row.original.name}`}
            >
              {domain}
            </ExternalLinkCell>
          ) : (
            <EmptyCell label="Sin dominio" />
          );
        },
        size: 160,
        minSize: 120,
        meta: { label: 'Dominio', popoverTitle: 'Dominio', disableFilter: true },
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
            <Badge variant={STATUS_VARIANT[status]}>
              {PIPELINE_STATUS_LABELS[status]}
            </Badge>
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
        cell: ({ row }) =>
          row.original.owner_name ? (
            <span className="block truncate text-xs text-muted-foreground" title={row.original.owner_name}>
              {row.original.owner_name}
            </span>
          ) : (
            <EmptyCell label="Sin responsable" />
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
          filterOptions:
            scopeFilterOptions?.showScopeFilters && scopeFilterOptions.users.length > 0
              ? scopeFilterOptions.users.map((u) => ({
                  value: u.id,
                  label:
                    u.full_name && u.email
                      ? `${u.full_name} (${u.email})`
                      : (u.full_name ?? u.email ?? u.id.slice(0, 8)),
                }))
              : ownerFilterOptions,
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
    [openDetail, scopeFilterOptions, ownerFilterOptions],
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
            label: 'Editar empresa',
            icon: Pencil,
            onClick: () => setEditingId(row.id),
          },
          {
            id: 'assign',
            label: 'Asignar a…',
            icon: UserPlus,
            onClick: () => setAssignRows([row]),
          },
          {
            id: 'enrich-contacts',
            label: 'Buscar contactos de esta empresa',
            icon: UserSearch,
            onClick: () => setEnrichCompany({
              name: row.name,
              domain: row.domain,
              country: row.country,
              countryCode: row.country_code,
              sellupAccountId: row.id,
            }),
          },
        ];

        // Antes había un único «Cambiar estado» que saltaba al siguiente sin
        // decir a cuál. Ahora cada estado posible es su propia entrada.
        ACTIVE_PIPELINE_STATUSES.filter((status) => status !== row.pipeline_status).forEach(
          (status, index) => {
            items.push({
              id: `status-${status}`,
              label: `Marcar como «${PIPELINE_STATUS_LABELS[status]}»`,
              icon: Tag,
              separator: index === 0,
              onClick: () => handleStatusChange(row.id, status),
            });
          },
        );

        items.push({
          id: 'archive',
          label: 'Archivar empresa',
          icon: Archive,
          variant: 'destructive' as const,
          separator: true,
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
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Ver detalle',
        icon: Eye,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openDetail(rows[0].id),
      },
      {
        id: 'edit-account',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Editar empresa',
        icon: Pencil,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => setEditingId(rows[0].id),
      },
      {
        id: 'assign',
        label: 'Asignar a…',
        icon: UserPlus,
        disabled: (rows) => rows.length === 0,
        onClick: (rows) => setAssignRows(rows),
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
      {
        id: 'archive-accounts',
        label: 'Archivar',
        icon: Archive,
        variant: 'destructive',
        countInLabel: true,
        disabled: (rows) => rows.length === 0,
        confirm: {
          title: 'Archivar empresas',
          description: (rows) =>
            rows.length === 1
              ? `«${rows[0].name}» sale del listado y del pipeline activo. Solo un administrador puede hacerlo y queda registrado en auditoría.`
              : `${rows.length} empresas salen del listado y del pipeline activo. Solo un administrador puede hacerlo y queda registrado en auditoría.`,
          confirmLabel: 'Archivar',
        },
        onClick: async (rows) => {
          const result = await archiveAccounts(rows.map((r) => r.id));
          if (!result.success) {
            toast.error(result.error);
            return;
          }
          toast.success(
            result.archived === 1 ? 'Empresa archivada' : `${result.archived} empresas archivadas`,
          );
          dataTableRef.current?.clearSelection();
          router.refresh();
        },
      },
      {
        id: 'bulk-enrich-contacts',
        label: 'Buscar contactos en lote',
        icon: UserSearch,
        disabled: (rows) => rows.length === 0,
        onClick: (rows) => {
          if (rows.length === 1) {
            // Single selection: open individual enrichment drawer
            const row = rows[0];
            setEnrichCompany({
              name: row.name,
              domain: row.domain,
              country: row.country,
              countryCode: row.country_code,
              sellupAccountId: row.id,
            });
            return;
          }
          // Multiple selection: open bulk drawer
          setBulkEnrichAccounts(rows);
          setBulkEnrichOpen(true);
        },
      },
    ],
    [openDetail, router],
  );

  // ── Vista de lista ────────────────────────────────────────────
  const renderListItem = React.useCallback(
    (row: Row, state: DataTableListRowState) => (
      <ListItem
        selected={state.selected}
        leading={state.checkbox}
        title={<RowTitleButton onClick={() => openDetail(row.id)}>{row.name}</RowTitleButton>}
        description={
          [countryName(row.country_code), row.industry, row.domain].filter(Boolean).join(' · ') ||
          'Sin país, industria ni dominio'
        }
        meta={
          <Badge variant={STATUS_VARIANT[row.pipeline_status]}>
            {PIPELINE_STATUS_LABELS[row.pipeline_status]}
          </Badge>
        }
        actions={state.menu}
      />
    ),
    [openDetail],
  );

  // ── Vacíos: cada uno dice por qué no hay filas y qué hacer ────
  // Sin `emptyState`, la tabla pone su propio aviso de «nada coincide con
  // estos filtros» junto a los chips, que ya traen «Limpiar todo».
  let emptyState: React.ReactNode;
  if (accounts.length === 0) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="Todavía no hay empresas"
        description="Las empresas llegan aquí cuando apruebas un prospecto. También puedes crear una a mano."
        action={emptyActions}
      />
    );
  } else if (quick.rows.length === 0 && quick.activeLabel) {
    emptyState = (
      <QuickFilterEmptyState
        icon={Building2}
        filterLabel={quick.activeLabel}
        noun="empresas"
        onClear={quick.clear}
      />
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {accounts.length > 0 && !isWide && (
          <QuickFilterStrip
            {...quickFilterGroup}
            icon={Building2}
            total={quick.total}
            noun={['empresa', 'empresas']}
            className="shrink-0"
          />
        )}

        <DataTable
          ref={dataTableRef}
          tableId="accounts"
          noun="empresas"
          nounGender="f"
          getRowLabel={(row) => row.name}
          columns={columns}
          data={quick.rows}
          getRowId={(row) => row.id}
          title={quick.activeLabel ? `Empresas · ${quick.activeLabel}` : 'Listado de empresas'}
          count={quick.rows.length}
          actions={accounts.length > 0 && isWide ? <QuickFilterChips {...quickFilterGroup} /> : undefined}
          enableRowSelection
          contextMenu={contextMenu}
          bulkActions={bulkActions}
          enableColumnReorder
          initialPageSize={20}
          fillHeight
          onRowClick={(row) => openDetail(row.id)}
          rowClickable
          renderListItem={renderListItem}
          emptyState={emptyState}
        />
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

      <ArchiveAccountDialog
        accountId={archivingId}
        onClose={() => setArchivingId(null)}
        onArchived={() => router.refresh()}
      />

      {/* Account detail sheet */}
      <AccountDetailSheet
        accountId={detailAccountId}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailAccountId(null);
        }}
        onRequestEnrich={(company) => {
          setDetailOpen(false);
          setDetailAccountId(null);
          setEnrichCompany(company);
        }}
      />

      {/* Contact enrichment sidepanel (Agente 2A) */}
      <ContactEnrichmentDrawer
        open={!!enrichCompany}
        onOpenChange={(v) => !v && setEnrichCompany(null)}
        preloadedCompany={enrichCompany}
      />

      <AssignOwnerDialog
        open={assignRows.length > 0}
        onOpenChange={(open) => !open && setAssignRows([])}
        kind="accounts"
        items={assignRows.map((r) => ({ id: r.id, name: r.name, currentOwnerId: r.owner_id }))}
        users={users}
        currentUserId={scopeFilterOptions?.currentUserId}
        onAssign={assignAccountsToUser}
        onAssigned={() => {
          dataTableRef.current?.clearSelection();
          router.refresh();
        }}
      />

      {/* Bulk enrichment drawer (Agente 2A · 17A.10G) */}
      <BulkContactEnrichmentDrawer
        open={bulkEnrichOpen}
        onOpenChange={setBulkEnrichOpen}
        selectedAccounts={bulkEnrichAccounts.map((r) => ({
          id: r.id,
          name: r.name,
          domain: r.domain,
          country_code: r.country_code,
        }))}
        onCompleted={() => setBulkEnrichAccounts([])}
      />
    </>
  );
}
