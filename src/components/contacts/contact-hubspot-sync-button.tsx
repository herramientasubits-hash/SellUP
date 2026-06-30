'use client';

// Acción manual de sincronización contacto → HubSpot (Hito 17A.4C).
// Solo para contactos aprobados/oficiales. Estados y toasts según el resultado
// del server action. No expone tokens ni llama a HubSpot desde el browser.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { syncContactToHubSpot } from '@/modules/contacts/actions';

interface ContactHubSpotSyncButtonProps {
  contactId: string;
  /** Si ya está vinculado, la acción queda deshabilitada con copy "Sincronizado". */
  alreadySynced: boolean;
  /** Sin email no se puede sincronizar: se deshabilita con copy claro. */
  hasEmail: boolean;
  /** Notifica al panel para recargar datos tras una sync exitosa. */
  onSynced?: () => void;
}

export function ContactHubSpotSyncButton({
  contactId,
  alreadySynced,
  hasEmail,
  onSynced,
}: ContactHubSpotSyncButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleSync() {
    setPending(true);
    try {
      const result = await syncContactToHubSpot(contactId);
      if (result.ok) {
        if (result.status === 'created') {
          toast.success('Contacto creado en HubSpot y vinculado a SellUp.');
        } else if (result.status === 'linked_existing') {
          toast.success('Contacto existente en HubSpot vinculado a SellUp.');
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

  if (alreadySynced) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        Sincronizado
      </Button>
    );
  }

  if (!hasEmail) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        title="No se puede sincronizar: el contacto no tiene email."
        className="gap-1.5"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        No se puede sincronizar
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
          Sincronizar con HubSpot
        </>
      )}
    </Button>
  );
}
