'use client';

import * as React from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Star, Mail, Phone, ExternalLink, Info } from 'lucide-react';

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
  CONTACT_SOURCE_LABELS,
  SENIORITY_LABELS,
  DEPARTMENTS,
  type ContactStatus,
  type ContactRole,
} from '@/modules/contacts/types';
import type { ContactListItem } from '@/modules/contacts/actions';
import { ContactRowActions } from './contact-row-actions';
import { ContactDetailSheet } from './contact-detail-sheet';

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

const SOURCE_FILTER_OPTIONS = Object.entries(CONTACT_SOURCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const SENIORITY_FILTER_OPTIONS = Object.entries(SENIORITY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const DEPARTMENT_FILTER_OPTIONS = DEPARTMENTS.map((d) => ({ value: d, label: d }));

// ── Types ──────────────────────────────────────────────────────

type Row = ContactListItem;

// ── Main Component ─────────────────────────────────────────────

interface ContactsDataTableClientProps {
  contacts: ContactListItem[];
}

export function ContactsDataTableClient({ contacts }: ContactsDataTableClientProps) {
  const [detailContactId, setDetailContactId] = React.useState<string | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const openDetail = React.useCallback((contactId: string) => {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }, []);

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
        id: 'is_primary',
        accessorKey: 'is_primary',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Primario" />
        ),
        cell: ({ row }) =>
          row.original.is_primary ? (
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          ),
        size: 80,
        minSize: 60,
        filterFn: 'equals',
        meta: {
          label: 'Primario',
          popoverTitle: 'Primario',
          filterOptions: [
            { value: 'true', label: 'Sí' },
            { value: 'false', label: 'No' },
          ],
        },
      },
      {
        id: 'source',
        accessorKey: 'source',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Fuente" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate block max-w-[120px]">
            {CONTACT_SOURCE_LABELS[row.original.source] ?? row.original.source}
          </span>
        ),
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
      {
        id: 'department',
        accessorKey: 'department',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Departamento" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate block max-w-[140px]">
            {row.original.department ?? '—'}
          </span>
        ),
        size: 140,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Departamento',
          popoverTitle: 'Departamento',
          filterOptions: DEPARTMENT_FILTER_OPTIONS,
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <ContactRowActions
            contact={row.original}
            onActionComplete={() => openDetail(row.original.id)}
          />
        ),
        size: 48,
        minSize: 48,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
        meta: { label: 'Acciones', disableFilter: true, disableSort: true },
      },
    ],
    [openDetail],
  );

  // ── Context menu ──────────────────────────────────────────────
  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => [
        {
          id: 'view',
          label: 'Ver detalle',
          icon: Info,
          onClick: () => openDetail(row.id),
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
      ],
    }),
    [openDetail],
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
        id: 'go-accounts',
        label: 'Ir a cuentas',
        icon: ExternalLink,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => {
          window.location.href = `/accounts/${rows[0].account_id}`;
        },
      },
    ],
    [openDetail],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={contacts}
        getRowId={(row) => row.id}
        title="Listado de contactos"
        description="Contactos vinculados a cuentas, roles, estado y fuente."
        count={contacts.length}
        enableRowSelection
        contextMenu={contextMenu}
        bulkActions={bulkActions}
        enableColumnReorder
        initialPageSize={20}
        fillHeight
        onRowClick={(row) => openDetail(row.id)}
        rowClickable
        emptyState={
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 rounded-full bg-muted/60 p-3">
              <Star className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground">Sin contactos todavía</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
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
    </>
  );
}
