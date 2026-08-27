'use client';

// Acción manual de sincronización contacto → HubSpot (Hito 17A.4C + CUT-2).
// Solo para contactos aprobados/oficiales. Estados y toasts según el resultado
// del server action. No expone tokens ni llama a HubSpot desde el browser.
//
// El copy del botón lo decide el ESTADO DURABLE, no la mera existencia del vínculo: un
// contacto vinculado cuyo teléfono cambió después ofrece «Actualizar en HubSpot», y uno cuyo
// último intento falló ofrece «Reintentar actualización». Deshabilitar por `hubspot_contact_id`
// —lo que hacía CUT-1— dejaría al humano sin forma de enviar un cambio que sí tiene pendiente.
//
// AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX: y decidirlo ya NO es trabajo de este componente. Recibe
// `contact` y le pregunta a `resolveHubSpotSyncAction`, que es la MISMA autoridad que el badge
// consulta para el copy. Antes recibía un `alreadySynced` que cada superficie deducía a mano
// como `!!contact.hubspot_contact_id`, y en una fila de línea base eso pintaba un «Sincronizado»
// verde al lado de un badge neutro «Vinculado a HubSpot» — la misma tarjeta contando dos
// historias, y la verde afirmando una paridad de campos que nunca se observó.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, CheckCircle2, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncContactToHubSpot } from '@/modules/contacts/actions';
import {
  readHubSpotSyncBaselineSource,
  readHubSpotSyncState,
  resolveHubSpotSyncAction,
} from '@/modules/contacts/contact-hubspot-sync-state';

interface ContactHubSpotSyncButtonProps {
  /** El contacto entero: la elegibilidad se DERIVA, no se pasa ya deducida. */
  contact: {
    id: string;
    email: string | null;
    hubspot_contact_id: string | null;
    metadata: Record<string, unknown> | null;
  };
  /** Notifica al panel para recargar datos tras una sync exitosa. */
  onSynced?: () => void;
}

export function ContactHubSpotSyncButton({ contact, onSynced }: ContactHubSpotSyncButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const metadata = contact.metadata ?? null;
  const action = resolveHubSpotSyncAction({
    state: readHubSpotSyncState(metadata),
    baselineSource: readHubSpotSyncBaselineSource(metadata),
    hubspotContactId: contact.hubspot_contact_id,
    hasEmail: !!contact.email,
  });

  async function handleSync() {
    setPending(true);
    try {
      const result = await syncContactToHubSpot(contact.id);
      if (result.ok) {
        if (result.status === 'created') {
          toast.success('Contacto creado en HubSpot y vinculado a SellUp.');
        } else if (result.status === 'linked_existing') {
          toast.success('Contacto existente en HubSpot vinculado a SellUp.');
        } else if (result.status === 'updated') {
          toast.success('Teléfono actualizado en HubSpot.');
        } else {
          toast.info('Este contacto ya estaba sincronizado con HubSpot.');
        }
        router.refresh();
        onSynced?.();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('No fue posible sincronizar el contacto con HubSpot.');
    } finally {
      setPending(false);
    }
  }

  // Las dos ramas que SÍ pueden salir a la red sobre un vínculo existente.
  if (action.kind === 'update' || action.kind === 'retry_update') {
    return (
      <Button variant="outline" size="sm" onClick={handleSync} disabled={pending} className="gap-1.5">
        {pending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Actualizando...
          </>
        ) : (
          <>
            <RefreshCw className="h-3.5 w-3.5" />
            {action.label}
          </>
        )}
      </Button>
    );
  }

  // El ÚNICO estado que puede lucir el check verde: paridad OBSERVADA.
  if (action.kind === 'observed_synced') {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        {action.label}
      </Button>
    );
  }

  // Vínculo sin paridad observada: NEUTRO, sin check verde y sin acción. El label lo dicta la
  // autoridad de presentación, así que aquí dice literalmente lo mismo que el badge de al lado.
  if (action.kind === 'linked_no_parity') {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title={action.detail ?? undefined}
        className="gap-1.5"
      >
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        {action.label}
      </Button>
    );
  }

  if (action.kind === 'no_email') {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title={action.detail ?? undefined}
        className="gap-1.5"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {action.label}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={pending} className="gap-1.5">
      {pending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Sincronizando...
        </>
      ) : (
        <>
          <RefreshCw className="h-3.5 w-3.5" />
          {action.label}
        </>
      )}
    </Button>
  );
}
