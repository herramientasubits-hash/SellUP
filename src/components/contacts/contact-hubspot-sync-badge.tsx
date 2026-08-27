// Badge del estado DURABLE de sincronización con HubSpot.
//
// AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX: vivía DENTRO de `contact-detail-sheet.tsx`, así que la
// página de detalle legada —que es un componente de servidor y no podía importarlo— tenía su
// propio badge HARDCODEADO «Sincronización no activa», ignorando el estado durable y
// contradiciendo al drawer sobre el mismo contacto. Extraerlo es lo que permite que las dos
// superficies digan lo mismo sin que ninguna vuelva a deducir nada.
//
// Deliberadamente SIN `'use client'`: no tiene estado ni handlers, así que lo renderizan igual
// el drawer (cliente) y la página de detalle (servidor).
//
// NO hace red: el badge nunca dispara una llamada al proveedor. Sólo lee `metadata.hubspot_sync`.

import { Badge } from '@/components/ui/badge';
import {
  readHubSpotSyncBaselineSource,
  readHubSpotSyncState,
  resolveHubSpotSyncPresentation,
  type HubSpotSyncPresentationTone,
} from '@/modules/contacts/contact-hubspot-sync-state';

/** Tono → clases. La autoridad devuelve tono y no colores, así que Tailwind vive sólo aquí. */
export const HUBSPOT_SYNC_TONE_CLASSES: Readonly<Record<HubSpotSyncPresentationTone, string>> = {
  synced: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  neutral: 'bg-muted/40 text-muted-foreground',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  error: 'bg-destructive/10 text-destructive',
};

export function ContactHubSpotSyncBadge({
  contact,
}: {
  contact: { hubspot_contact_id: string | null; metadata: Record<string, unknown> | null };
}) {
  const metadata = contact.metadata ?? null;
  const { label, tone } = resolveHubSpotSyncPresentation({
    state: readHubSpotSyncState(metadata),
    baselineSource: readHubSpotSyncBaselineSource(metadata),
    hubspotContactId: contact.hubspot_contact_id,
  });
  return (
    <Badge
      variant="outline"
      className={`text-[10px] border-transparent ${HUBSPOT_SYNC_TONE_CLASSES[tone]}`}
    >
      {label}
    </Badge>
  );
}
