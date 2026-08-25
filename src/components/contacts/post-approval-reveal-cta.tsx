'use client';

// Agente 2A — «Revelar teléfono» en la ficha del contacto OFICIAL
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// UN clic y nada más: no hay modal, no hay segundo paso y no hay selector de base de tratamiento
// —la base es única en el producto y vive en `phone-reveal-processing-basis.ts`—. El botón sólo se
// pinta cuando el SERVIDOR dice que hay algo que ofrecer; que no se pinte NO es la protección: las
// tres acciones revalidan rol, vínculo durable y estado del contacto por su cuenta.
//
// El tope de créditos que se lee bajo el botón lo calcula la vista previa del servidor, que es la
// MISMA función que resuelve la modalidad al reservar. Este componente no lo deriva ni lo
// completa con un suelo: si no llega, el copy lo dice en vez de inventar una cifra.
//
// Ningún teléfono viaja hasta aquí. Cuando el número queda guardado, este componente avisa al
// drawer (`onPhoneProjected`) y el drawer RELEE el contacto por su vía normal: es la ficha, y no
// esta respuesta, la autoridad de lo que se muestra.

import * as React from 'react';
import { Loader2, PhoneCall } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getOfficialContactPhoneRevealOfferAction,
  reconcileOfficialContactPhoneFromCandidateAction,
  revealOfficialContactPhoneAction,
} from '@/modules/contact-enrichment/post-approval-reveal-actions';
import { PHONE_REVEAL_PROCESSING_BASIS } from '@/modules/contact-enrichment/phone-reveal-processing-basis';
import type { OfficialContactPhoneRevealOfferView } from '@/modules/contact-enrichment/post-approval-reveal-core';
// EL refresco acotado del subsistema, no una segunda política de polling. El hook toma una clave
// de identidad opaca (aquí el id del CONTACTO) y una función de recarga; su presupuesto de tiempo
// y su condición de parada son las que ya están probadas.
import { usePhoneRevealLiveRefresh } from '@/components/contact-enrichment/use-phone-reveal-live-refresh';
import {
  OFFICIAL_REVEAL_BUSY_LABEL,
  OFFICIAL_REVEAL_BUY_LABEL,
  OFFICIAL_REVEAL_ERROR_COPY,
  OFFICIAL_REVEAL_PROJECTED_COPY,
  OFFICIAL_REVEAL_REUSE_LABEL,
  officialRevealHelperText,
  officialRevealOutcomeText,
  officialRevealUnavailableText,
} from './post-approval-reveal-copy';

interface OfficialContactPhoneRevealCtaProps {
  readonly contactId: string;
  /** Se invoca cuando el número quedó guardado en el contacto. El drawer relee la ficha. */
  readonly onPhoneProjected: () => void;
}

export function OfficialContactPhoneRevealCta({
  contactId,
  onPhoneProjected,
}: OfficialContactPhoneRevealCtaProps) {
  const [offer, setOffer] = React.useState<OfficialContactPhoneRevealOfferView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [inFlight, setInFlight] = React.useState(false);
  // Corta un segundo clic ANTES de que el botón se deshabilite por re-render, que es la ventana
  // por la que un doble clic autorizaría dos veces.
  const clickLatch = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await getOfficialContactPhoneRevealOfferAction({ contactId });
        if (!cancelled) setOffer(view);
      } catch {
        // Fail-closed hacia «no ofrecer»: se pierde un botón, nunca la ficha. El rastro lo deja
        // el servidor — este drawer tiene prohibido `console.*` (AGENT2A-PROD-INCIDENT #279).
        if (!cancelled) setOffer(null);
      }
    })();
    // El reseteo vive en el CLEANUP y no en el cuerpo del efecto, que es el patrón que el
    // subsistema ya usa (`use-phone-reveal-live-refresh`): llamar a setState en el cuerpo
    // provoca renders en cascada. Al cambiar de contacto el ciclo anterior limpia su estado y
    // el nuevo arranca sin heredar la oferta, el aviso ni el «en vuelo» del anterior.
    return () => {
      cancelled = true;
      setOffer(null);
      setNotice(null);
      setInFlight(false);
    };
  }, [contactId]);

  /**
   * Relectura de la reconciliación. NO compra nada: sólo proyecta lo que el candidato ya tenga.
   * Es lo que cierra el camino ASÍNCRONO (Apollo contesta por webhook y Lusha continúa desde ahí).
   */
  const reload = React.useCallback(async () => {
    const result = await reconcileOfficialContactPhoneFromCandidateAction({ contactId });
    if (result.phoneProjected) {
      setInFlight(false);
      setNotice(OFFICIAL_REVEAL_PROJECTED_COPY);
      onPhoneProjected();
    }
  }, [contactId, onPhoneProjected]);

  usePhoneRevealLiveRefresh({
    enabled: inFlight && !busy,
    candidateId: inFlight ? contactId : null,
    reload,
  });

  async function handleClick() {
    if (!offer?.actionable || clickLatch.current) return;
    clickLatch.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await revealOfficialContactPhoneAction({
        contactId,
        confirmCost: true,
        phoneProcessingBasis: PHONE_REVEAL_PROCESSING_BASIS,
        phoneProcessingBasisNote: undefined,
        // El tope que el operador ACABA de leer. El servidor lo trata como límite superior duro:
        // si no cubre lo que la modalidad exige, no reserva nada y vuelve a preguntar.
        expectedMaxCredits: offer.maxCredits ?? undefined,
      });
      setNotice(officialRevealOutcomeText(result));
      if (result.phoneProjected) {
        onPhoneProjected();
      } else if (result.ok) {
        setInFlight(true);
      }
    } catch {
      setNotice(OFFICIAL_REVEAL_ERROR_COPY);
    } finally {
      clickLatch.current = false;
      setBusy(false);
    }
  }

  if (!offer) return null;

  if (!offer.actionable) {
    const text = officialRevealUnavailableText(offer.status);
    if (!text) return null;
    return <p className="text-xs text-muted-foreground">{text}</p>;
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant={offer.free ? 'outline' : 'default'}
        disabled={busy || inFlight}
        onClick={handleClick}
      >
        {busy || inFlight ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <PhoneCall className="mr-2 h-4 w-4" aria-hidden />
        )}
        {busy
          ? OFFICIAL_REVEAL_BUSY_LABEL
          : offer.free
            ? OFFICIAL_REVEAL_REUSE_LABEL
            : OFFICIAL_REVEAL_BUY_LABEL}
      </Button>
      <p className="text-xs text-muted-foreground">{officialRevealHelperText(offer)}</p>
      {notice && <p className="text-xs text-foreground">{notice}</p>}
    </div>
  );
}
