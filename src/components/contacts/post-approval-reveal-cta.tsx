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
//
// ── DURABLE RESUME ─────────────────────────────────────────────
// (AGENT2A-POST-APPROVAL-REVEAL-DURABLE-RESUME)
//
// Este componente YA NO es el dueño de «hay un reveal en curso». Antes lo era —un `useState` que
// el cleanup del efecto ponía a `false`—, y por eso cerrar la ficha BORRABA una operación que
// seguía viva en el servidor: al reabrirla volvía a aparecer «Revelar teléfono» sobre una
// solicitud ya pagada. El navegador estaba haciendo de base de datos.
//
// Ahora la autoridad es el SERVIDOR: `phone_reveal_status` del candidato fuente, leído en cada
// oferta. El estado local sobrevive sólo como PESTILLO OPTIMISTA para el hueco entre el clic y la
// primera relectura; en cuanto la oferta llega, manda ella. Consecuencias, todas verificables:
//
//   * cerrar y reabrir la ficha REANUDA la espera y el sondeo, sin recordar nada;
//   * recargar el navegador hace exactamente lo mismo, porque no hay nada que recordar;
//   * el sondeo se APAGA solo cuando el servidor declara un estado terminal, no cuando React
//     olvida el suyo;
//   * agotado el presupuesto del sondeo, el estado NO vuelve a «Revelar teléfono»: se dice que la
//     solicitud sigue en proceso y que reabrir la ficha la retoma.
//
// Que el botón se deshabilite sigue siendo UX y no la protección: la segunda compra la impide el
// servidor —el pipeline responde `already_pending` y, desde este corte, la oferta ni siquiera es
// accionable—.

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
  OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY,
  OFFICIAL_REVEAL_PROJECTED_COPY,
  OFFICIAL_REVEAL_REUSE_LABEL,
  officialContactMayHaveRescueOptions,
  officialRevealHelperText,
  officialRevealOutcomeText,
  officialRevealUnavailableText,
} from './post-approval-reveal-copy';
// PARIDAD DE RESCATE — las otras tres salidas (revisar ahora, continuar a Lusha, buscar más
// números). Se pintan JUNTO a cualquier estado, no sólo junto al botón de compra: su razón de ser
// es precisamente el caso en el que ya no hay botón de compra.
import { OfficialContactRescuePanel } from './post-approval-rescue-panel';

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
  /**
   * PESTILLO OPTIMISTA, no memoria de la operación. Cubre EXCLUSIVAMENTE el hueco entre «el
   * servidor aceptó el clic» y «la oferta releída ya lo refleja»: sin él, ese instante volvería a
   * pintar un botón de compra. No sobrevive al desmontaje a propósito, y no hace falta que
   * sobreviva — el hecho durable está en la base.
   */
  const [submissionLatch, setSubmissionLatch] = React.useState(false);
  // Corta un segundo clic ANTES de que el botón se deshabilite por re-render, que es la ventana
  // por la que un doble clic autorizaría dos veces.
  const clickLatch = React.useRef(false);

  /**
   * Relee la oferta. Es la ÚNICA vía por la que el estado del reveal entra en este componente, y
   * es de sólo lectura: no compra, no reserva y no llama a ningún proveedor.
   */
  const refreshOffer = React.useCallback(async () => {
    try {
      const view = await getOfficialContactPhoneRevealOfferAction({ contactId });
      setOffer(view);
      return view;
    } catch {
      // Fail-closed hacia «no ofrecer»: se pierde un botón, nunca la ficha. El rastro lo deja
      // el servidor — este drawer tiene prohibido `console.*` (AGENT2A-PROD-INCIDENT #279).
      setOffer(null);
      return null;
    }
  }, [contactId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await getOfficialContactPhoneRevealOfferAction({ contactId });
        if (!cancelled) setOffer(view);
      } catch {
        if (!cancelled) setOffer(null);
      }
    })();
    // El reseteo vive en el CLEANUP y no en el cuerpo del efecto, que es el patrón que el
    // subsistema ya usa (`use-phone-reveal-live-refresh`): llamar a setState en el cuerpo
    // provoca renders en cascada. Al cambiar de contacto el ciclo anterior limpia su estado y
    // el nuevo arranca sin heredar la oferta, el aviso ni el pestillo del anterior.
    //
    // DURABLE RESUME — limpiar el pestillo aquí ya NO pierde nada: lo que se olvida es una
    // suposición optimista, y la primera lectura de la nueva oferta trae el hecho durable.
    return () => {
      cancelled = true;
      setOffer(null);
      setNotice(null);
      setSubmissionLatch(false);
    };
  }, [contactId]);

  /**
   * DURABLE RESUME — LA pregunta «¿hay un reveal en curso?», respondida por el SERVIDOR.
   *
   * Se deriva de la oferta releída, así que es verdadera al montar, al reabrir la ficha y tras
   * recargar el navegador, sin que nadie tenga que recordarla. El pestillo local sólo puede
   * ADELANTARLA, nunca contradecirla: en cuanto el servidor declara un estado terminal, la oferta
   * deja de ser `reveal_in_flight` y todo se apaga.
   */
  const serverInFlight = offer?.status === 'reveal_in_flight';
  const inFlight = serverInFlight || submissionLatch;

  /**
   * Relectura de la reconciliación. NO compra nada: sólo proyecta lo que el candidato ya tenga.
   * Es lo que cierra el camino ASÍNCRONO (Apollo contesta por webhook y Lusha continúa desde ahí).
   *
   * DURABLE RESUME — releer la OFERTA después es lo que da la condición de parada honesta: quien
   * decide si esto sigue en vuelo, si cerró sin número o si falló es el servidor, no el hecho de
   * que la proyección de este tick no haya movido nada.
   */
  const reload = React.useCallback(async () => {
    const result = await reconcileOfficialContactPhoneFromCandidateAction({ contactId });
    if (result.phoneProjected) {
      setNotice(OFFICIAL_REVEAL_PROJECTED_COPY);
      onPhoneProjected();
    }
    setSubmissionLatch(false);
    await refreshOffer();
  }, [contactId, onPhoneProjected, refreshOffer]);

  const liveRefresh = usePhoneRevealLiveRefresh({
    enabled: inFlight && !busy,
    candidateId: inFlight ? contactId : null,
    reload,
  });

  /**
   * Un rescate consiguió el número. Se avisa a la ficha —que RELEE el contacto por su vía
   * normal— y se relee la oferta, que es quien decide si todavía queda algo que ofrecer.
   */
  const handleRescueProjected = React.useCallback(() => {
    onPhoneProjected();
    void refreshOffer();
  }, [onPhoneProjected, refreshOffer]);

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
        setSubmissionLatch(true);
      }
    } catch {
      setNotice(OFFICIAL_REVEAL_ERROR_COPY);
    } finally {
      clickLatch.current = false;
      setBusy(false);
    }
    // DURABLE RESUME — se relee la oferta SIEMPRE, también cuando el clic falló: es el servidor
    // quien sabe en qué estado quedó el candidato, y el pestillo optimista sólo tenía que cubrir
    // el viaje de ida. A partir de aquí manda el hecho durable.
    await refreshOffer();
  }

  if (!offer) return null;

  if (!offer.actionable) {
    // DURABLE RESUME (§7) — el presupuesto del sondeo se agotó y el SERVIDOR sigue diciendo que la
    // solicitud está viva. No se vuelve a «Revelar teléfono» —eso sería ofrecer una segunda compra
    // porque el navegador se cansó de mirar— y tampoco se sigue prometiendo que el número
    // «aparecerá aquí»: se dice la verdad, que el estado vive en el servidor y se retoma al volver.
    const text =
      offer.status === 'reveal_in_flight' && liveRefresh.budgetExhausted
        ? OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY
        : officialRevealUnavailableText(offer.status);
    const mayRescue = officialContactMayHaveRescueOptions(offer.status);
    if (!text && !mayRescue) return null;
    return (
      <div className="space-y-2">
        {text && <p className="text-xs text-muted-foreground">{text}</p>}
        {mayRescue && (
          <OfficialContactRescuePanel
            contactId={contactId}
            revealStateKey={offer.status}
            onPhoneProjected={handleRescueProjected}
          />
        )}
      </div>
    );
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
      <OfficialContactRescuePanel
        contactId={contactId}
        revealStateKey={offer.status}
        onPhoneProjected={handleRescueProjected}
      />
    </div>
  );
}
