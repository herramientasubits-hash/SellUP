'use client';

import * as React from 'react';
import Link from 'next/link';
import { Star, Mail, Phone } from 'lucide-react';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ROLE_LABELS,
  CONTACT_STATUS_LABELS,
  CONTACT_SOURCE_LABELS,
  type ContactStatus,
  type ContactRole,
} from '@/modules/contacts/types';
import type { ContactListItem } from '@/modules/contacts/actions';
import { ContactRowActions } from './contact-row-actions';
import { ContactDetailSheet } from './contact-detail-sheet';

const STATUS_STYLES: Record<ContactStatus, string> = {
  active: 'bg-success/10 text-success border-transparent',
  inactive: 'bg-muted text-muted-foreground border-transparent',
  left_company: 'bg-warning/10 text-warning border-transparent',
  do_not_contact: 'bg-destructive/10 text-destructive border-transparent',
  archived: 'bg-surface-muted text-muted-foreground border-transparent',
};

const ROLE_STYLES: Record<string, string> = {
  decision_maker: 'bg-su-brand-soft text-su-brand border-transparent',
  economic_buyer: 'bg-su-brand-soft text-su-brand border-transparent',
  champion: 'bg-success/10 text-success border-transparent',
  influencer: 'bg-warning/10 text-warning border-transparent',
};

interface ContactsTableClientProps {
  contacts: ContactListItem[];
}

export function ContactsTableClient({ contacts }: ContactsTableClientProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  function openSheet(id: string) {
    setSelectedId(id);
    setSheetOpen(true);
  }

  if (contacts.length === 0) {
    return (
      <SurfaceCard>
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-muted">
            <Star className="h-5 w-5 text-text-muted" />
          </div>
          <div className="max-w-xs space-y-1 mx-auto">
            <p className="text-sm font-semibold text-foreground">Sin contactos todavía</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Todavía no hay contactos registrados. Crea contactos manualmente desde una cuenta
              o agrégalos aquí vinculándolos a una cuenta.
            </p>
          </div>
        </div>
      </SurfaceCard>
    );
  }

  return (
    <>
      <SurfaceCard className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4 text-xs">Nombre</TableHead>
              <TableHead className="text-xs">Cuenta</TableHead>
              <TableHead className="text-xs">Cargo</TableHead>
              <TableHead className="text-xs">Email</TableHead>
              <TableHead className="text-xs">Teléfono</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs">Rol</TableHead>
              <TableHead className="text-xs">Primario</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id} className="group">
                {/* Nombre — clickable */}
                <TableCell className="pl-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground/70">
                      {contact.full_name.charAt(0).toUpperCase()}
                    </div>
                    <button
                      type="button"
                      onClick={() => openSheet(contact.id)}
                      className="text-xs font-medium text-foreground hover:text-su-brand hover:underline text-left"
                    >
                      {contact.full_name}
                    </button>
                  </div>
                </TableCell>

                {/* Cuenta */}
                <TableCell>
                  {contact.account_name ? (
                    <Link
                      href={`/accounts/${contact.account_id}`}
                      className="text-xs text-su-brand hover:underline"
                    >
                      {contact.account_name}
                    </Link>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </TableCell>

                {/* Cargo */}
                <TableCell>
                  <span className="text-xs text-foreground/80">
                    {contact.job_title ?? <span className="text-text-muted">—</span>}
                  </span>
                </TableCell>

                {/* Email */}
                <TableCell>
                  {contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-1 text-xs text-su-brand hover:underline"
                    >
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[140px]">{contact.email}</span>
                    </a>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </TableCell>

                {/* Teléfono */}
                <TableCell>
                  {contact.phone ?? contact.mobile_phone ? (
                    <a
                      href={`tel:${contact.mobile_phone ?? contact.phone}`}
                      className="flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
                    >
                      <Phone className="h-3 w-3 shrink-0" />
                      {contact.mobile_phone ?? contact.phone}
                    </a>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </TableCell>

                {/* Estado */}
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-xs ${STATUS_STYLES[contact.contact_status]}`}
                  >
                    {CONTACT_STATUS_LABELS[contact.contact_status]}
                  </Badge>
                </TableCell>

                {/* Rol */}
                <TableCell>
                  {contact.role_in_account ? (
                    <Badge
                      variant="outline"
                      className={`text-xs ${ROLE_STYLES[contact.role_in_account] ?? 'bg-muted text-muted-foreground border-transparent'}`}
                    >
                      {ROLE_LABELS[contact.role_in_account as ContactRole]}
                    </Badge>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </TableCell>

                {/* Primario */}
                <TableCell>
                  {contact.is_primary ? (
                    <Star className="h-3.5 w-3.5 fill-warning text-warning" />
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </TableCell>

                {/* Acciones */}
                <TableCell>
                  <ContactRowActions
                    contact={contact}
                    onActionComplete={() => openSheet(contact.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SurfaceCard>

      <ContactDetailSheet
        contactId={selectedId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
