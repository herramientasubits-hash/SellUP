'use client';

import * as React from 'react';
import { Star, Mail, Phone, Users, Crown, Target, Archive } from "@/icons";
import { TableShell } from '@/components/data-display';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      {/* Summary mini-cards: primero cuántos hay y de qué tipo; la lista viene debajo. */}
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

      {/* La lista en UN solo marco (`TableShell`): título con su total, la acción
          de agregar a la derecha, la tabla a sangre y, sin contactos, el vacío
          dentro del mismo marco. Antes eran un encabezado suelto y una tarjeta. */}
      <TableShell
        title={
          <>
            Contactos
            {contacts.length > 0 && <Badge variant="neutral">{contacts.length}</Badge>}
          </>
        }
        description="Decisores, sponsors y personas clave vinculadas a esta cuenta."
        actions={<CreateContactDrawer accountId={accountId} />}
        empty={contacts.length === 0}
        emptyState={
          <EmptyState
            variant="plain"
            icon={Users}
            title="Sin contactos todavía"
            description="Todavía no hay contactos asociados a esta cuenta. Agrega un contacto manualmente o, más adelante, enriquécelo con Apollo o Lusha."
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Nombre</TableHead>
              <TableHead className="text-xs">Cargo</TableHead>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs">Teléfono</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs">Fuente</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Acciones</span>
              </TableHead>
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
      </TableShell>
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
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {contact.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {onViewContact ? (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => onViewContact(contact.id)}
                  className="h-auto min-w-0 justify-start truncate p-0 text-xs font-medium text-foreground hover:text-primary"
                >
                  {contact.full_name}
                </Button>
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
