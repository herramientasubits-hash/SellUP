'use client';

/**
 * Contactos de la empresa en HubSpot, en la ficha de SellUp (consulta o empresa ya
 * traída). Cada uno dice si ya está en SellUp; los que no, se pueden traer.
 */

import * as React from 'react';
import { ExternalLink, Mail, Phone, RefreshCw, UserPlus, Users } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/feedback/spinner';
import { DrawerSection } from '@/components/shared/drawer-section';
import { ListItem, ListItemGroup } from '@/components/data-display';
import { hubspotContactUrl } from '@/components/contact-enrichment/hubspot-company-url';
import { fetchHubSpotAccountContacts } from '@/modules/hubspot-lookup/client';
import type { HubSpotContactHit, HubSpotLookupUnavailable } from '@/modules/hubspot-lookup/types';

/**
 * Contactos de HubSpot de una empresa de SellUp. Se piden sólo cuando `enabled` (al abrir
 * la pestaña «Contactos»): abrir la ficha no cuesta una lectura de HubSpot de más.
 */
export function useHubSpotAccountContacts(accountId: string | null, enabled: boolean) {
  const [attempt, setAttempt] = React.useState(0);
  const key = accountId && enabled ? `${accountId}:${attempt}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; state: HubSpotContactsState } | null>(null);

  React.useEffect(() => {
    if (!key || !accountId) return;
    const controller = new AbortController();
    fetchHubSpotAccountContacts(accountId, controller.signal)
      .then((result) =>
        setLoaded({
          key,
          state:
            result.status === 'ok'
              ? { status: 'ok', contacts: result.contacts, portalId: result.portalId }
              : result,
        }),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [key, accountId]);

  const state: HubSpotContactsState | null = !key ? null : loaded?.key === key ? loaded.state : { status: 'loading' };
  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  /** ¿La empresa está vinculada a HubSpot? (Sin vínculo no hay nada que mostrar.) */
  return { state, reload };
}

export type HubSpotContactsState =
  | { status: 'loading' }
  | { status: 'ok'; contacts: HubSpotContactHit[]; portalId: string | null }
  | { status: 'not_found' }
  | HubSpotLookupUnavailable;

interface HubSpotContactsSectionProps {
  state: HubSpotContactsState;
  onRetry?: () => void;
  /** Abre el contacto de SellUp (cuando ya está y quien mira lo puede abrir). */
  onOpenSellUpContact?: (contactId: string) => void;
  /** Trae el contacto a SellUp. Sin esto, no se ofrece. */
  onImport?: (contact: HubSpotContactHit) => void;
  /** El que se está trayendo ahora (se deshabilitan los demás). */
  importingId?: string | null;
  /** Mostrar sólo los que no están en SellUp (en la ficha de una empresa ya traída). */
  onlyMissing?: boolean;
  title?: string;
}

function presenceBadge(contact: HubSpotContactHit) {
  if (contact.sellup.status === 'visible') return <Badge variant="positive">En SellUp</Badge>;
  if (contact.sellup.status === 'other_owner') {
    return <Badge variant="neutral">{contact.sellup.ownerName ? `En SellUp · ${contact.sellup.ownerName}` : 'En SellUp · otra persona'}</Badge>;
  }
  return <Badge variant="outline">Sólo en HubSpot</Badge>;
}

export function HubSpotContactsSection({
  state,
  onRetry,
  onOpenSellUpContact,
  onImport,
  importingId = null,
  onlyMissing = false,
  title = 'Contactos en HubSpot',
}: HubSpotContactsSectionProps) {
  const contacts =
    state.status === 'ok' ? (onlyMissing ? state.contacts.filter((c) => c.sellup.status !== 'visible') : state.contacts) : [];
  return (
    <DrawerSection
      title={title}
      icon={Users}
      badge={state.status === 'ok' ? <span className="text-xs tabular-nums text-muted-foreground">{contacts.length}</span> : undefined}
      hint={onlyMissing ? 'Los que están en HubSpot y todavía no en SellUp.' : 'Asociados a la empresa en HubSpot.'}
    >
      {state.status === 'loading' ? (
        <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner size="xs" decorative />
          Leyendo los contactos en HubSpot…
        </div>
      ) : state.status === 'unavailable' ? (
        <EmptyState
          variant="plain"
          icon={Users}
          title={state.reason === 'not_connected' ? 'HubSpot no está conectado' : 'HubSpot no respondió'}
          description="No pudimos leer los contactos de HubSpot."
          action={
            onRetry && state.reason === 'unavailable' ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" /> Reintentar
              </Button>
            ) : undefined
          }
        />
      ) : state.status === 'not_found' ? null : contacts.length === 0 ? (
        <EmptyState
          variant="compact"
          className="px-0"
          icon={Users}
          title={onlyMissing ? 'Todos están en SellUp' : 'Sin contactos en HubSpot'}
          description={
            onlyMissing
              ? 'Los contactos que tiene esta empresa en HubSpot ya están en SellUp.'
              : 'Esta empresa no tiene contactos asociados en HubSpot.'
          }
        />
      ) : (
        <ListItemGroup>
          {contacts.map((contact) => (
            <ListItem
              key={contact.id}
              size="sm"
              title={contact.fullName}
              description={
                <span className="flex flex-col gap-0.5">
                  {contact.jobTitle && <span>{contact.jobTitle}</span>}
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {contact.email && (
                      <span className="inline-flex items-center gap-1 break-all">
                        <Mail className="h-3 w-3 shrink-0" /> {contact.email}
                      </span>
                    )}
                    {(contact.phone ?? contact.mobilePhone) && (
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Phone className="h-3 w-3 shrink-0" /> {contact.phone ?? contact.mobilePhone}
                      </span>
                    )}
                  </span>
                </span>
              }
              meta={presenceBadge(contact)}
              onClick={
                contact.sellup.status === 'visible' && onOpenSellUpContact
                  ? () => onOpenSellUpContact((contact.sellup as { id: string }).id)
                  : undefined
              }
              actions={
                <span className="flex items-center gap-1">
                  {onImport && contact.sellup.status === 'none' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={importingId !== null}
                      onClick={() => onImport(contact)}
                    >
                      {importingId === contact.id ? <Spinner size="xs" decorative /> : <UserPlus className="h-3.5 w-3.5" />}
                      Traer
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="icon-sm" asChild>
                    <a
                      href={hubspotContactUrl(contact.id, state.status === 'ok' ? state.portalId : null)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="sr-only">Abrir {contact.fullName} en HubSpot</span>
                    </a>
                  </Button>
                </span>
              }
            />
          ))}
        </ListItemGroup>
      )}
    </DrawerSection>
  );
}
