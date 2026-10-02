'use client';

import * as React from 'react';
import Link from 'next/link';
import { Star, Mail, Phone } from "@/icons";
import { EmptyState } from '@/components/ui/empty-state';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

type ContactBadgeVariant = 'positive' | 'neutral' | 'warning' | 'negative' | 'brand';

const STATUS_VARIANT: Record<ContactStatus, ContactBadgeVariant> = {
  active: 'positive',
  inactive: 'neutral',
  left_company: 'warning',
  do_not_contact: 'negative',
  archived: 'neutral',
};

const ROLE_VARIANT: Record<string, ContactBadgeVariant> = {
  decision_maker: 'brand',
  economic_buyer: 'brand',
  champion: 'positive',
  influencer: 'warning',
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
      <EmptyState
        icon={Star}
        title="Sin contactos todavía"
        description="Todavía no hay contactos registrados. Crea contactos manualmente desde una cuenta o agrégalos aquí vinculándolos a una cuenta."
      />
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
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {contact.full_name.charAt(0).toUpperCase()}
                    </div>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => openSheet(contact.id)}
                      className="h-auto min-w-0 justify-start p-0 text-xs font-medium text-foreground hover:text-primary"
                    >
                      {contact.full_name}
                    </Button>
                  </div>
                </TableCell>

                {/* Cuenta */}
                <TableCell>
                  {contact.account_name ? (
                    <Link
                      href={`/accounts/${contact.account_id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      {contact.account_name}
                    </Link>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </TableCell>

                {/* Cargo */}
                <TableCell>
                  <span className="text-xs text-foreground">
                    {contact.job_title ?? <span className="text-text-muted">—</span>}
                  </span>
                </TableCell>

                {/* Email */}
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

                {/* Teléfono */}
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

                {/* Estado */}
                <TableCell>
                  <Badge variant={STATUS_VARIANT[contact.contact_status]}>
                    {CONTACT_STATUS_LABELS[contact.contact_status]}
                  </Badge>
                </TableCell>

                {/* Rol */}
                <TableCell>
                  {contact.role_in_account ? (
                    <Badge variant={ROLE_VARIANT[contact.role_in_account] ?? 'neutral'}>
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
