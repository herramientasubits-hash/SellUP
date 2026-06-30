'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Mail, Phone, ExternalLink, Info, Pencil, Star, RefreshCw, Archive } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
} from '@/components/data-table';
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

const STATUS_STYLES: Record<ContactStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  inactive: 'bg-muted text-muted-foreground border-transparent',
  left_company: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
  do_not_contact: 'bg-destructive/10 text-destructive border-transparent',
  archived: 'bg-muted/60 text-muted-foreground/60 border-transparent',
};

const ROLE_STYLES: Record<string, string> = {
  decision_maker: 'bg-su-brand-soft text-su-brand border-transparent',
  economic_buyer: 'bg-su-brand-soft text-su-brand border-transparent',
  champion: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  influencer: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
};

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
}

export function ContactsDataTableClient({
  contacts,
  accountOwners,
  scopeFilterOptions,
}: ContactsDataTableClientProps) {
  const router = useRouter();
  const [detailContactId, setDetailContactId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<ContactListItem | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);

  const [scopeFilter, setScopeFilter] = React.useState<ScopeFilterState>({
    userId: '',
    groupId: '',
    roleKey: '',
  });

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

  async function handleArchive(contact: ContactListItem) {
    if (!confirm(`¿Archivar a "${contact.full_name}"? Esta acción requiere rol admin.`)) return;
    const result = await archiveContact(contact.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
    toast.success(`${contact.full_name} archivado`);
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
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground/70">
                {c.full_name.charAt(0).toUpperCase()}
              </div>
              <button
                type="button"
                onClick={() => openDetail(c.id)}
                className="text-xs font-medium text-foreground hover:text-su-brand hover:underline text-left truncate"
              >
                {c.full_name}
              </button>
            </div>
          );
        },
        size: 200,
        minSize: 160,
        enableHiding: false,
        meta: { label: 'Nombre', popoverTitle: 'Nombre' },
      },
      {
        id: 'account_name',
        accessorKey: 'account_name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Cuenta" />
        ),
        cell: ({ row }) => {
          const c = row.original;
          return c.account_name ? (
            <Link
              href={`/accounts/${c.account_id}`}
              className="text-xs text-su-brand hover:underline truncate block max-w-[180px]"
            >
              {c.account_name}
            </Link>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          );
        },
        size: 180,
        minSize: 140,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Cuenta',
          popoverTitle: 'Cuenta',
          disablePopoverSearch: false,
        },
      },
      {
        id: 'job_title',
        accessorKey: 'job_title',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Cargo" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-foreground/80 truncate block max-w-[160px]">
            {row.original.job_title ?? <span className="text-muted-foreground/40">—</span>}
          </span>
        ),
        size: 160,
        minSize: 120,
        meta: { label: 'Cargo', popoverTitle: 'Cargo' },
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
              className="flex items-center gap-1 text-xs text-su-brand hover:underline"
            >
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[140px]">{email}</span>
            </a>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          );
        },
        size: 180,
        minSize: 140,
        meta: { label: 'Email', popoverTitle: 'Email' },
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
              className="flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
            >
              <Phone className="h-3 w-3 shrink-0" />
              {phone}
            </a>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          );
        },
        size: 140,
        minSize: 110,
        meta: { label: 'Teléfono', popoverTitle: 'Teléfono' },
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
            <Badge
              variant="outline"
              className={`text-[10px] ${STATUS_STYLES[status]}`}
            >
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
          return role ? (
            <Badge
              variant="outline"
              className={`text-[10px] ${ROLE_STYLES[role] ?? 'bg-muted text-muted-foreground border-transparent'}`}
            >
              {ROLE_LABELS[role as ContactRole]}
            </Badge>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
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
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate block max-w-[130px]">
            {row.original.seniority ? (SENIORITY_LABELS[row.original.seniority] ?? '—') : '—'}
          </span>
        ),
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
            label: 'Ir a la cuenta',
            icon: ExternalLink,
            separator: true,
            onClick: () => {
              window.location.href = `/accounts/${row.account_id}`;
            },
          },
        ];

        if (!row.is_primary && row.contact_status === 'active') {
          items.push({
            id: 'set-primary',
            label: 'Marcar primario',
            icon: Star,
            onClick: () => handleSetPrimary(row),
          });
        }

        items.push({
          id: 'change-status',
          label: 'Cambiar estado',
          icon: RefreshCw,
          separator: true,
          onClick: () => {
            const statuses: ContactStatus[] = ['active', 'inactive', 'left_company', 'do_not_contact'];
            const currentIdx = statuses.indexOf(row.contact_status);
            const nextIdx = (currentIdx + 1) % statuses.length;
            handleChangeStatus(row, statuses[nextIdx]);
          },
        });

        items.push({
          id: 'archive',
          label: 'Archivar',
          icon: Archive,
          variant: 'destructive' as const,
          onClick: () => handleArchive(row),
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
        label: 'Ver detalle',
        icon: Info,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openDetail(rows[0].id),
      },
      {
        id: 'edit-contact',
        label: 'Editar contacto',
        icon: Pencil,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openEdit(rows[0]),
      },
      {
        id: 'go-accounts',
        label: 'Ir a cuentas',
        icon: ExternalLink,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => {
          window.location.href = `/accounts/${rows[0].account_id}`;
        },
      },
      {
        id: 'set-primary',
        label: 'Marcar primario',
        icon: Star,
        disabled: (rows) => rows.length !== 1 || rows[0].is_primary || rows[0].contact_status !== 'active',
        onClick: (rows) => handleSetPrimary(rows[0]),
      },
      {
        id: 'archive',
        label: 'Archivar',
        icon: Archive,
        variant: 'destructive',
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => handleArchive(rows[0]),
      },
    ],
    [openDetail, openEdit],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filteredContacts}
        getRowId={(row) => row.id}
        title="Listado de contactos"
        description="Contactos vinculados a cuentas, roles, estado y fuente."
        count={filteredContacts.length}
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
              <Info className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground">Sin contactos todavía</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Crea contactos manualmente desde una cuenta o agrégales aquí vinculándolos a una cuenta.
            </p>
          </div>
        }
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
