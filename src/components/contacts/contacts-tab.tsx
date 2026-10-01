'use client';

import * as React from 'react';
import { Star, Mail, Phone, Users, Crown, Target, Archive } from "@/icons";
import { SurfaceCard } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CONTACT_STATUS_LABELS,
  CONTACT_SOURCE_LABELS,
  type Contact,
  type ContactsSummary,
} from '@/modules/contacts/types';
import { CreateContactDrawer } from './create-contact-drawer';
import { ContactRowActions } from './contact-row-actions';

interface ContactsTabProps {
  accountId: string;
  contacts: Contact[];
  summary: ContactsSummary;
  /** When provided, contact names become clickable and open the detail sheet. */
  onViewContact?: (contactId: string) => void;
  /** Called after any mutation so a parent sheet can reload its data. */
  onContactsChanged?: () => void;
}

// ── Estilos de estado ─────────────────────────────────────────

const STATUS_VARIANT: Record<string, 'positive' | 'neutral' | 'warning' | 'negative'> = {
  active: 'positive',
  inactive: 'neutral',
  left_company: 'warning',
  do_not_contact: 'negative',
  archived: 'neutral',
};

// ── Componente principal ──────────────────────────────────────

export function ContactsTab({
  accountId,
  contacts,
  summary,
  onViewContact,
  onContactsChanged,
}: ContactsTabProps) {
  return (
    <div className="space-y-4">
      {/* Header interno + botón */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Contactos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Decisores, sponsors y personas clave vinculadas a esta cuenta.
          </p>
        </div>
        <CreateContactDrawer accountId={accountId} />
      </div>

      {/* Summary mini-cards */}
      {/* La pestaña vive tanto en la página como en el drawer de la cuenta: la
          rejilla responde al ancho de su contenedor, no al de la ventana. */}
      <div className="@container">
        <div className="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
          <MetricCard compact title="Total" value={summary.total} tone="neutral" icon={<Users />} />
          <MetricCard compact title="Decisores" value={summary.decision_makers} tone="brand" icon={<Crown />} />
          <MetricCard compact title="Champions" value={summary.champions} tone="positive" icon={<Target />} />
          <MetricCard compact title="Inactivos" value={summary.inactive_or_archived} tone="neutral" icon={<Archive />} />
        </div>
      </div>

      {/* Tabla de contactos */}
      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin contactos todavía"
          description="Todavía no hay contactos asociados a esta cuenta. Agrega un contacto manualmente o, más adelante, enriquécelo con Apollo o Lusha."
        />
      ) : (
        <SurfaceCard className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs">Nombre</TableHead>
                <TableHead className="text-xs">Cargo</TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Teléfono</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs">Fuente</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onViewContact={onViewContact}
                  onActionComplete={onContactsChanged}
                />
              ))}
            </TableBody>
          </Table>
        </SurfaceCard>
      )}
    </div>
  );
}

// ── Fila de contacto ──────────────────────────────────────────

function ContactRow({
  contact,
  onViewContact,
  onActionComplete,
}: {
  contact: Contact;
  onViewContact?: (id: string) => void;
  onActionComplete?: () => void;
}) {
  return (
    <TableRow className="group">
      <TableCell className="pl-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {contact.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {onViewContact ? (
                <button
                  type="button"
                  onClick={() => onViewContact(contact.id)}
                  className="text-xs font-medium text-foreground hover:text-primary hover:underline truncate text-left rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {contact.full_name}
                </button>
              ) : (
                <span className="text-xs font-medium text-foreground truncate">
                  {contact.full_name}
                </span>
              )}
              {contact.is_primary && (
                <Star className="h-3 w-3 shrink-0 fill-warning text-warning" />
              )}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <span className="text-xs text-foreground truncate max-w-[120px] block">
          {contact.job_title ?? <span className="text-text-muted">—</span>}
        </span>
      </TableCell>

      <TableCell>
        {contact.email ? (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[140px]">{contact.email}</span>
          </a>
        ) : (
          <span className="text-text-muted text-xs">—</span>
        )}
      </TableCell>

      <TableCell>
        {contact.phone ?? contact.mobile_phone ? (
          <a
            href={`tel:${contact.mobile_phone ?? contact.phone}`}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Phone className="h-3 w-3 shrink-0" />
            {contact.mobile_phone ?? contact.phone}
          </a>
        ) : (
          <span className="text-text-muted text-xs">—</span>
        )}
      </TableCell>

      <TableCell>
        <Badge variant={STATUS_VARIANT[contact.contact_status] ?? 'neutral'}>
          {CONTACT_STATUS_LABELS[contact.contact_status]}
        </Badge>
      </TableCell>

      <TableCell>
        <Badge variant="neutral">
          {CONTACT_SOURCE_LABELS[contact.source]}
        </Badge>
      </TableCell>

      <TableCell>
        <ContactRowActions contact={contact} onActionComplete={onActionComplete} />
      </TableCell>
    </TableRow>
  );
}
