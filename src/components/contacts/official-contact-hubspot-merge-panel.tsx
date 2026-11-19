'use client';

/**
 * «Fusionar en HubSpot» en la ficha del contacto OFICIAL
 * (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
 *
 * Aparece sólo cuando «Verificar correo» dejó el correo correcto como principal en SellUp pero en
 * HubSpot ya lo tenía OTRO contacto (409). La fusión no se puede deshacer: siempre con confirmación.
 * Qué se ofrece y qué se escribe lo decide el servidor.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { GitMerge, Loader2 } from '@/icons';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import {
  getOfficialContactHubSpotMergeOfferAction,
  mergeOfficialContactInHubSpotAction,
} from '@/modules/contact-enrichment/official-contact-hubspot-merge-actions';
import type { HubSpotMergeOffer } from '@/modules/contact-enrichment/contact-hubspot-merge-core';

export function OfficialContactHubSpotMergePanel({
  contactId,
  refreshKey,
  onChanged,
}: {
  contactId: string;
  /** Cambia cuando la ficha se relee (p. ej. tras «Verificar correo»): se vuelve a preguntar. */
  refreshKey: unknown;
  onChanged: () => void;
}) {
  const [offer, setOffer] = React.useState<{ contactId: string; offer: HubSpotMergeOffer } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [note, setNote] = React.useState<{ contactId: string; tone: 'success' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getOfficialContactHubSpotMergeOfferAction({ contactId })
      .then((next) => {
        if (!cancelled) setOffer({ contactId, offer: next });
      })
      .catch(() => {
        if (!cancelled) setOffer({ contactId, offer: { status: 'none' } });
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, refreshKey]);

  const current = offer?.contactId === contactId ? offer.offer : null;
  const shownNote = note?.contactId === contactId ? note : null;

  const merge = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await mergeOfficialContactInHubSpotAction({ contactId });
      setConfirmOpen(false);
      const pending =
        result.ok && result.otherSellupContacts > 0
          ? ` Hay ${result.otherSellupContacts === 1 ? 'otro contacto' : `${result.otherSellupContacts} contactos más`} en SellUp con este mismo contacto de HubSpot: quedó vinculado al registro fusionado (unificarlos en SellUp queda pendiente).`
          : '';
      setNote({ contactId, tone: result.ok ? 'success' : 'error', text: `${result.message}${pending}` });
      if (result.ok) toast.success(result.message);
      const next = await getOfficialContactHubSpotMergeOfferAction({ contactId }).catch(() => ({ status: 'none' }) as const);
      setOffer({ contactId, offer: next });
      onChanged();
    } catch {
      setNote({ contactId, tone: 'error', text: 'No pudimos completar la fusión. Vuelve a abrir la ficha.' });
    } finally {
      setBusy(false);
    }
  };

  if ((!current || current.status === 'none') && !shownNote) return null;

  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="official-contact-hubspot-merge">
      {current?.status === 'available' && (
        <Alert variant="warning">
          <AlertTitle>Este correo ya lo tiene otro contacto en HubSpot</AlertTitle>
          <AlertDescription>
            <p>
              {current.other.name ?? 'Un contacto'}
              {current.other.jobTitle ? ` (${current.other.jobTitle})` : ''} ya usa {current.foundEmail}. Si es la misma persona,
              fusiónalos: ese contacto queda como principal y el que está vinculado a SellUp se une a él.
            </p>
            <div className="mt-2">
              <Button type="button" size="xs" className="gap-1.5" disabled={busy} onClick={() => setConfirmOpen(true)}>
                <GitMerge className="h-3.5 w-3.5" />
                Fusionar en HubSpot
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {current?.status === 'retry' && (
        <Alert variant="warning">
          <AlertTitle>El correo no se cambió en HubSpot</AlertTitle>
          <AlertDescription>
            <p>Ya ningún otro contacto de HubSpot tiene {current.foundEmail}. Puedes volver a intentarlo.</p>
            <div className="mt-2">
              <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void merge()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Reintentar en HubSpot
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {current?.status === 'hubspot_unavailable' && (
        <p className="text-xs text-muted-foreground">
          En HubSpot otro contacto tenía este correo, pero ahora no pudimos consultar HubSpot para ofrecer la fusión.
        </p>
      )}

      {shownNote && (
        <span className={shownNote.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {shownNote.text}
        </span>
      )}

      {current?.status === 'available' && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(next) => {
            if (!next && !busy) setConfirmOpen(false);
          }}
          variant="warning"
          icon={GitMerge}
          title="Fusionar contactos en HubSpot"
          description="Esto es lo que va a pasar (no se puede deshacer):"
          confirmLabel={busy ? 'Fusionando…' : 'Fusionar'}
          loading={busy}
          onConfirm={() => void merge()}
        >
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Queda como principal el contacto de HubSpot que ya tiene {current.foundEmail}
              {current.other.name ? ` (${current.other.name})` : ''}. El que está vinculado a SellUp se fusiona dentro de él.
            </li>
            <li>El correo anterior queda como correo adicional. Se suman empresas, negocios y actividades de los dos.</li>
            <li>Con lo que sabe SellUp: el LinkedIn y el cargo reemplazan los de HubSpot, y los teléfonos van al primer campo vacío sin repetir.</li>
            <li>La empresa de la cuenta queda como «Principal» y tú quedas como propietario del contacto (el de la empresa no cambia).</li>
            <li>HubSpot le da un ID nuevo al contacto fusionado: SellUp se vincula a ése.</li>
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}
