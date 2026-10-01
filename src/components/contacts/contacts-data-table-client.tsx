'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Mail, Phone, Building2, Info, Pencil, Star, RefreshCw, Archive, Crown, Target, Users } from "@/icons";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyCell, RowTitleButton } from '@/components/shared/table-cells';
import {
  ROLE_LABELS,
  CONTACT_STATUS_LABELS,
  SENIORITY_LABELS,
  type ContactStatus,
  type ContactRole,
} from '@/modules/contacts/types';
import type { ContactListItem } from '@/modules/contacts/actions';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import {
  ScopeFilterDrawerSection,
  type ScopeFilterState,
} from '@/components/shared/scope-filters-client';
import { ContactDetailSheet } from './contact-detail-sheet';
import { EditContactDrawer } from './edit-contact-drawer';
import { setPrimaryContact, changeContactStatus, archiveContact } from '@/modules/contacts/actions';

// ── Badge styles ───────────────────────────────────────────────

type ContactBadgeVariant = 'positive' | 'neutral' | 'warning' | 'negative' | 'brand';

const STATUS_VARIANT: Record<ContactStatus, ContactBadgeVariant> = {
  active: 'positive',
  inactive: 'neutral',
  left_company: 'warning',
  do_not_contact: 'negative',
  archived: 'neutral',
};

// ── Indicadores que filtran ────────────────────────────────────
// Eran tarjetas de métricas en la cabecera. Ahora son botones: pulsar uno deja
// en la tabla solo esos contactos, y el número es exactamente lo que se ve.
const CONTACT_QUICK_FILTERS: readonly QuickFilterDefinition<ContactListItem>[] = [
  {
    id: 'decision_makers',
    label: 'Decisores',
    icon: Crown,
    tone: 'brand',
    predicate: (contact) => contact.role_in_account === 'decision_maker',
  },
  {
    id: 'champions',
    label: 'Champions',
    icon: Target,
    tone: 'positive',
    predicate: (contact) => contact.role_in_account === 'champion',
  },
  {
    id: 'primary',
    label: 'Primarios',
    icon: Star,
    tone: 'warning',
    predicate: (contact) => contact.is_primary,
  },
];

const EMPTY_SCOPE_FILTER: ScopeFilterState = { userId: '', groupId: '', roleKey: '' };

/** Los estados a los que se puede pasar un contacto desde su menú. */
const SELECTABLE_STATUSES: ContactStatus[] = ['active', 'inactive', 'left_company', 'do_not_contact'];

const INTERNAL_LINK =
  'rounded-sm text-xs text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40';

// ── Filter option arrays ───────────────────────────────────────

const STATUS_FILTER_OPTIONS = Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const ROLE_FILTER_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const SENIORITY_FILTER_OPTIONS = Object.entries(SENIORITY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// ── Types ──────────────────────────────────────────────────────

type Row = ContactListItem;

// ── Main Component ─────────────────────────────────────────────

interface ContactsDataTableClientProps {
  contacts: ContactListItem[];
  /** owner_id keyed by account_id — used for scope pre-filtering (contact → account → owner). */
  accountOwners?: Map<string, string>;
  scopeFilterOptions?: ScopeFilterOptions;
  /**
   * Lo que se ofrece cuando todavía no hay ningún contacto (buscarlos con IA,
   * crear uno). Lo arma la página, que es la que tiene los drawers.
   */
  emptyActions?: React.ReactNode;
}

export function ContactsDataTableClient({
  contacts,
  accountOwners,
  scopeFilterOptions,
  emptyActions,
}: ContactsDataTableClientProps) {
  const router = useRouter();
  const [detailContactId, setDetailContactId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<ContactListItem | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  const [archiving, setArchiving] = React.useState<ContactListItem | null>(null);
  const [archivePending, setArchivePending] = React.useState(false);
  const dataTableRef = React.useRef<DataTableHandle>(null);

  const [scopeFilter, setScopeFilter] = React.useState<ScopeFilterState>(EMPTY_SCOPE_FILTER);

  const filteredContacts = React.useMemo(() => {
    if (!scopeFilterOptions?.showScopeFilters || !accountOwners) return contacts;
    const { userId, groupId, roleKey } = scopeFilter;
    if (!userId && !groupId && !roleKey) return contacts;
    const allowedUserIds = new Set(
      scopeFilterOptions.users
        .filter((u) => {
          if (roleKey && u.role_key !== roleKey) return false;
          if (groupId) {
            if (!u.group_id) return false;
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
    return contacts.filter((c) => {
      const ownerId = c.account_id ? accountOwners.get(c.account_id) : undefined;
      if (!ownerId) return false;
      if (userId) return ownerId === userId;
      return allowedUserIds.has(ownerId);
    });
  }, [contacts, scopeFilter, scopeFilterOptions, accountOwners]);

  const quick = useQuickFilter(filteredContacts, CONTACT_QUICK_FILTERS);
  const toggleQuickFilter = React.useCallback(
    (id: string) => {
      // Cambiar de indicador cambia la lista: lo marcado deja de tener sentido.
      dataTableRef.current?.clearSelection();
      quick.toggle(id);
    },
    [quick],
  );
  // En pantalla ancha los indicadores van dentro de la barra de la tabla (no
  // gastan un renglón); en estrecha, en su franja encima.
  const isWide = useWideViewport();
  const quickFilterGroup = {
    label: 'Indicadores de contactos',
    options: quick.options,
    value: quick.activeId,
    onToggle: toggleQuickFilter,
  };

  const openDetail = React.useCallback((contactId: string) => {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }, []);

  const openEdit = React.useCallback((contact: ContactListItem) => {
    setEditingContact(contact);
    setEditOpen(true);
  }, []);

  async function handleSetPrimary(contact: ContactListItem) {
    if (contact.is_primary) return;
    const result = await setPrimaryContact(contact.account_id, contact.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
    toast.success(`${contact.full_name} marcado como contacto primario`);
  }

  async function handleChangeStatus(contact: ContactListItem, status: ContactStatus) {
    if (status === contact.contact_status) return;
    const result = await changeContactStatus(contact.id, status);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
    toast.success(`Estado actualizado: ${CONTACT_STATUS_LABELS[status]}`);
  }

  // Archivar pide confirmación en un diálogo del sistema (antes, un `confirm()`
  // del navegador): dice a quién y qué pasa, y espera a que termine.
  async function confirmArchive() {
    if (!archiving) return;
    setArchivePending(true);
    try {
      const result = await archiveContact(archiving.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${archiving.full_name} archivado`);
      setArchiving(null);
      router.refresh();
    } finally {
      setArchivePending(false);
    }
  }

  // ── Column definitions ────────────────────────────────────────
  const columns: ColumnDef<Row, unknown>[] = React.useMemo(
    () => [
      {
        id: 'full_name',
        accessorKey: 'full_name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Nombre" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted-foreground"
              >
                {c.full_name.charAt(0).toUpperCase()}
              </span>
              <RowTitleButton onClick={() => openDetail(c.id)}>{c.full_name}</RowTitleButton>
              {c.is_primary && (
                <span role="img" aria-label="Contacto primario" title="Contacto primario" className="shrink-0 text-warning">
                  <Star aria-hidden className="size-3.5" />
                </span>
              )}
            </div>
          );
        },
        size: 200,
        minSize: 160,
        enableHiding: false,
        // Texto libre: se ordena y se busca, no se filtra por valores.
        meta: { label: 'Nombre', popoverTitle: 'Nombre', disableFilter: true },
      },
      {
        id: 'account_name',
        accessorKey: 'account_name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Empresa" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          return c.account_name ? (
            <Link
              href={`/accounts/${c.account_id}`}
              title={c.account_name}
              onClick={(event) => event.stopPropagation()}
              className={`block truncate ${INTERNAL_LINK}`}
            >
              {c.account_name}
            </Link>
          ) : (
            <EmptyCell label="Sin empresa" />
          );
        },
        size: 180,
        minSize: 140,
        filterFn: 'arrIncludesSome',
        meta: {
          // Enumerable: el embudo ofrece las empresas que aparecen en la lista.
          label: 'Empresa',
          popoverTitle: 'Empresa',
        },
      },
      {
        id: 'job_title',
        accessorKey: 'job_title',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Cargo" />
        ),
        cell: ({ row }) =>
          row.original.job_title ? (
            <span className="block truncate text-xs text-foreground" title={row.original.job_title}>
              {row.original.job_title}
            </span>
          ) : (
            <EmptyCell label="Sin cargo" />
          ),
        size: 160,
        minSize: 120,
        meta: { label: 'Cargo', popoverTitle: 'Cargo', disableFilter: true },
      },
      {
        id: 'email',
        accessorKey: 'email',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Email" />
        ),
        cell: ({ row }) => {
          const email = row.original.email;
          return email ? (
            <a
              href={`mailto:${email}`}
              title={email}
              onClick={(event) => event.stopPropagation()}
              className={`flex min-w-0 items-center gap-1 ${INTERNAL_LINK}`}
            >
              <Mail aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate">{email}</span>
            </a>
          ) : (
            <EmptyCell label="Sin email" />
          );
        },
        size: 180,
        minSize: 140,
        meta: { label: 'Email', popoverTitle: 'Email', disableFilter: true },
      },
      {
        id: 'phone_display',
        accessorFn: (row) => row.mobile_phone ?? row.phone ?? null,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Teléfono" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          const phone = c.mobile_phone ?? c.phone;
          return phone ? (
            <a
              href={`tel:${phone}`}
              onClick={(event) => event.stopPropagation()}
              className="flex min-w-0 items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <Phone aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate tabular-nums">{phone}</span>
            </a>
          ) : (
            <EmptyCell label="Sin teléfono" />
          );
        },
        size: 140,
        minSize: 110,
        meta: { label: 'Teléfono', popoverTitle: 'Teléfono', disableFilter: true },
      },
      {
        id: 'contact_status',
        accessorKey: 'contact_status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => {
          const status = row.original.contact_status;
          return (
            <Badge variant={STATUS_VARIANT[status]}>
              {CONTACT_STATUS_LABELS[status]}
            </Badge>
          );
        },
        size: 130,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Estado',
          popoverTitle: 'Estado',
          filterOptions: STATUS_FILTER_OPTIONS,
        },
      },
      {
        id: 'role_in_account',
        accessorKey: 'role_in_account',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Rol" />
        ),
        cell: ({ row }) => {
          const role = row.original.role_in_account;
          // Un solo chip de color por fila (el estado): el rol va en texto.
          return role ? (
            <span className="block truncate text-xs text-foreground">
              {ROLE_LABELS[role as ContactRole] ?? role}
            </span>
          ) : (
            <EmptyCell label="Sin rol" />
          );
        },
        size: 140,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Rol',
          popoverTitle: 'Rol',
          filterOptions: ROLE_FILTER_OPTIONS,
        },
      },
      {
        id: 'seniority',
        accessorKey: 'seniority',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Seniority" />
        ),
        cell: ({ row }) => {
          const seniority = row.original.seniority ? SENIORITY_LABELS[row.original.seniority] : null;
          return seniority ? (
            <span className="block truncate text-xs text-muted-foreground" title={seniority}>
              {seniority}
            </span>
          ) : (
            <EmptyCell label="Sin seniority" />
          );
        },
        size: 130,
        minSize: 100,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Seniority',
          popoverTitle: 'Seniority',
          filterOptions: SENIORITY_FILTER_OPTIONS,
        },
      },
    ],
    [openDetail],
  );

  // ── Context menu ──────────────────────────────────────────────
  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => {
        const items: DataTableContextMenuItem[] = [
          {
            id: 'view',
            label: 'Ver detalle',
            icon: Info,
            onClick: () => openDetail(row.id),
          },
          {
            id: 'edit',
            label: 'Editar contacto',
            icon: Pencil,
            onClick: () => openEdit(row),
          },
          {
            id: 'go-account',
            label: 'Abrir la empresa',
            icon: Building2,
            separator: true,
            onClick: () => {
              window.location.href = `/accounts/${row.account_id}`;
            },
          },
        ];

        if (!row.is_primary && row.contact_status === 'active') {
          items.push({
            id: 'set-primary',
            label: 'Marcar como primario',
            icon: Star,
            onClick: () => handleSetPrimary(row),
          });
        }

        // Antes había un único «Cambiar estado» que saltaba al siguiente sin
        // decir a cuál. Ahora cada estado posible es su propia entrada.
        SELECTABLE_STATUSES.filter((status) => status !== row.contact_status).forEach((status, index) => {
          items.push({
            id: `status-${status}`,
            label: `Marcar como «${CONTACT_STATUS_LABELS[status]}»`,
            icon: RefreshCw,
            separator: index === 0,
            onClick: () => handleChangeStatus(row, status),
          });
        });

        items.push({
          id: 'archive',
          label: 'Archivar contacto',
          icon: Archive,
          variant: 'destructive' as const,
          separator: true,
          onClick: () => setArchiving(row),
        });

        return items;
      },
    }),
    [openDetail, openEdit],
  );

  // ── Bulk actions ──────────────────────────────────────────────
  const bulkActions = React.useMemo<DataTableBulkAction<Row>[]>(
    () => [
      {
        id: 'view-detail',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Ver detalle',
        icon: Info,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openDetail(rows[0].id),
      },
      {
        id: 'edit-contact',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Editar contacto',
        icon: Pencil,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openEdit(rows[0]),
      },
      {
        id: 'go-accounts',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Abrir la empresa',
        icon: Building2,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => {
          window.location.href = `/accounts/${rows[0].account_id}`;
        },
      },
      {
        id: 'set-primary',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Marcar como primario',
        icon: Star,
        disabled: (rows) => rows.length !== 1 || rows[0].is_primary || rows[0].contact_status !== 'active',
        onClick: (rows) => handleSetPrimary(rows[0]),
      },
      {
        id: 'archive',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Archivar contacto',
        icon: Archive,
        variant: 'destructive',
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => setArchiving(rows[0]),
      },
    ],
    [openDetail, openEdit],
  );

  // ── Vista de lista ────────────────────────────────────────────
  const renderListItem = React.useCallback(
    (row: Row, state: DataTableListRowState) => (
      <ListItem
        selected={state.selected}
        leading={state.checkbox}
        title={<RowTitleButton onClick={() => openDetail(row.id)}>{row.full_name}</RowTitleButton>}
        description={
          [row.job_title, row.account_name, row.email ?? row.mobile_phone ?? row.phone]
            .filter(Boolean)
            .join(' · ') || 'Sin cargo, empresa ni datos de contacto'
        }
        meta={
          <Badge variant={STATUS_VARIANT[row.contact_status]}>
            {CONTACT_STATUS_LABELS[row.contact_status]}
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
  if (contacts.length === 0) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Users}
        title="Todavía no hay contactos"
        description="Busca contactos con IA para tus empresas o crea uno a mano. Los que apruebes en «Por revisar» también llegan aquí."
        action={emptyActions}
      />
    );
  } else if (filteredContacts.length === 0) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Users}
        title="Ningún contacto en este alcance"
        description="El usuario, grupo o rol elegido no tiene contactos en sus empresas."
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setScopeFilter(EMPTY_SCOPE_FILTER)}>
            Quitar filtros de alcance
          </Button>
        }
      />
    );
  } else if (quick.rows.length === 0 && quick.activeLabel) {
    emptyState = (
      <QuickFilterEmptyState
        icon={Users}
        filterLabel={quick.activeLabel}
        noun="contactos"
        onClear={quick.clear}
      />
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {contacts.length > 0 && !isWide && (
          <QuickFilterStrip
            {...quickFilterGroup}
            icon={Users}
            total={quick.total}
            noun={['contacto', 'contactos']}
            className="shrink-0"
          />
        )}

        <DataTable
          ref={dataTableRef}
          tableId="contacts"
          noun="contactos"
          getRowLabel={(row) => row.full_name}
          columns={columns}
          data={quick.rows}
          getRowId={(row) => row.id}
          title={quick.activeLabel ? `Contactos · ${quick.activeLabel}` : 'Listado de contactos'}
          count={quick.rows.length}
          actions={contacts.length > 0 && isWide ? <QuickFilterChips {...quickFilterGroup} /> : undefined}
          enableRowSelection
          contextMenu={contextMenu}
          bulkActions={bulkActions}
          enableColumnReorder
          initialPageSize={20}
          fillHeight
          onRowClick={(row) => openDetail(row.id)}
          rowClickable
          renderListItem={renderListItem}
          settingsExtraSections={
            scopeFilterOptions?.showScopeFilters ? (
              <ScopeFilterDrawerSection
                scopeFilterOptions={scopeFilterOptions}
                value={scopeFilter}
                onChange={setScopeFilter}
              />
            ) : undefined
          }
          emptyState={emptyState}
        />
      </div>

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open && !archivePending) setArchiving(null);
        }}
        variant="destructive"
        icon={Archive}
        title="Archivar contacto"
        description={
          archiving
            ? `${archiving.full_name} dejará de aparecer en la lista. Solo un administrador puede archivar y queda registrado en auditoría.`
            : undefined
        }
        confirmLabel="Archivar contacto"
        loading={archivePending}
        onConfirm={() => void confirmArchive()}
      />

      <ContactDetailSheet
        contactId={detailContactId}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailContactId(null);
        }}
      />

      {editingContact && (
        <EditContactDrawer
          key={editingContact.id}
          contact={editingContact}
          open={editOpen}
          onClose={() => {
            setEditOpen(false);
            setEditingContact(null);
          }}
        />
      )}
    </>
  );
}
