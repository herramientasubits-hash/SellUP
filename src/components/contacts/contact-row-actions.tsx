'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, Pencil, Star, RefreshCw, Archive, Eye, CheckCircle2, Cloud, Link2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  setPrimaryContact,
  changeContactStatus,
  archiveContact,
  syncContactToHubSpot,
} from '@/modules/contacts/actions';
import {
  CONTACT_STATUS_LABELS,
  type Contact,
  type ContactStatus,
} from '@/modules/contacts/types';
import {
  readHubSpotSyncBaselineSource,
  readHubSpotSyncState,
  resolveHubSpotSyncAction,
} from '@/modules/contacts/contact-hubspot-sync-state';
import { EditContactDrawer } from './edit-contact-drawer';

interface ContactRowActionsProps {
  contact: Contact;
  /** Called after any successful mutation so parent sheets can reload their data. */
  onActionComplete?: () => void;
}

const STATUS_OPTIONS: ContactStatus[] = ['active', 'inactive', 'left_company', 'do_not_contact'];

export function ContactRowActions({ contact, onActionComplete }: ContactRowActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — la MISMA autoridad que el drawer y el badge.
  // Antes este menú deducía `if (contact.hubspot_contact_id) return;` y pintaba un ítem
  // deshabilitado «Sincronizado» con check verde: en una fila de línea base eso afirmaba una
  // paridad de campos que el backfill se niega a afirmar, y contradecía al badge de la ficha.
  const hubspotMetadata = contact.metadata as Record<string, unknown> | null;
  const hubspotAction = resolveHubSpotSyncAction({
    state: readHubSpotSyncState(hubspotMetadata),
    baselineSource: readHubSpotSyncBaselineSource(hubspotMetadata),
    hubspotContactId: contact.hubspot_contact_id,
    hasEmail: !!contact.email,
  });

  async function handleSetPrimary() {
    if (contact.is_primary) return;
    setPending(true);
    try {
      const result = await setPrimaryContact(contact.account_id, contact.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      onActionComplete?.();
      toast.success(`${contact.full_name} marcado como contacto primario`);
    } finally {
      setPending(false);
    }
  }

  async function handleChangeStatus(status: ContactStatus) {
    if (status === contact.contact_status) return;
    setPending(true);
    try {
      const result = await changeContactStatus(contact.id, status);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      onActionComplete?.();
      toast.success(`Estado actualizado: ${CONTACT_STATUS_LABELS[status]}`);
    } finally {
      setPending(false);
    }
  }

  async function handleSyncHubSpot() {
    // La guarda la decide la autoridad, no un campo: `triggersNetwork` es el único permiso.
    if (!hubspotAction.triggersNetwork) return;
    if (!contact.email) {
      toast.error('No se puede sincronizar: el contacto no tiene email.');
      return;
    }
    setPending(true);
    try {
      const result = await syncContactToHubSpot(contact.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (result.status === 'created') {
        toast.success('Contacto creado en HubSpot y vinculado a SellUp.');
      } else if (result.status === 'linked_existing') {
        toast.success('Contacto existente en HubSpot vinculado a SellUp.');
      } else {
        toast.info('Este contacto ya estaba sincronizado con HubSpot.');
      }
      router.refresh();
      onActionComplete?.();
    } finally {
      setPending(false);
    }
  }

  async function handleArchive() {
    if (!confirm(`¿Archivar a "${contact.full_name}"? Esta acción requiere rol admin.`)) return;
    setPending(true);
    try {
      const result = await archiveContact(contact.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      onActionComplete?.();
      toast.success(`${contact.full_name} archivado`);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger disabled={pending}>
          <div className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="sr-only">Acciones</span>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => router.push(`/contacts/${contact.id}`)}>
            <Eye className="mr-2 h-3.5 w-3.5" />
            Ver detalle
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Editar
          </DropdownMenuItem>

          {!contact.is_primary && contact.contact_status === 'active' && (
            <DropdownMenuItem onClick={handleSetPrimary}>
              <Star className="mr-2 h-3.5 w-3.5" />
              Marcar primario
            </DropdownMenuItem>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Cambiar estado
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {STATUS_OPTIONS.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => handleChangeStatus(s)}
                  className={contact.contact_status === s ? 'font-medium text-su-brand' : ''}
                >
                  {CONTACT_STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          {hubspotAction.kind === 'observed_synced' ? (
            <DropdownMenuItem disabled>
              <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
              {hubspotAction.label}
            </DropdownMenuItem>
          ) : hubspotAction.triggersNetwork ? (
            <DropdownMenuItem onClick={handleSyncHubSpot}>
              <Cloud className="mr-2 h-3.5 w-3.5" />
              {hubspotAction.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              {hubspotAction.kind === 'linked_no_parity' ? (
                <Link2 className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Cloud className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              )}
              {hubspotAction.label}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={handleArchive}
            className="text-destructive focus:text-destructive"
          >
            <Archive className="mr-2 h-3.5 w-3.5" />
            Archivar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditContactDrawer
        key={contact.id}
        contact={contact}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </>
  );
}
