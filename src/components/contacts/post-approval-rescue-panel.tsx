'use client';

// Agente 2A — Las tres salidas de rescate, en la ficha del contacto OFICIAL
// (AGENT2A-POST-APPROVAL-RESCUE-PARITY)
//
// La ficha del CANDIDATO tenía cuatro superficies para conseguir un teléfono; la del contacto
// oficial sólo tenía la primera, y la primera es asíncrona. Cuando el webhook de Apollo tardaba,
// se perdía o volvía sin número, esta pantalla no tenía NADA que ofrecer: por eso «se queda
// cargando y no encuentra teléfono». Este componente trae las otras tres.
//
// Ninguna de ellas es nueva. Las tres son server actions que ya existen y ya están probadas,
// keyed por candidato; aquí sólo se pintan y se les manda el id del CONTACTO — el del candidato
// no viaja al navegador, así que esta pantalla no puede apuntar un gasto a un candidato elegido
// por el cliente.
//
// ── EL PRIMER CLIC DE LAS DE PAGO ES GRATIS ────────────────────
//
// «Revisar resultado ahora» ejecuta al primer clic: no cuesta. Las dos que gastan Lusha piden
// confirmación INLINE antes de llamar a nada, que es el mismo reparto que el modal del candidato
// y existe para que un clic accidental sobre una fila de botones no reserve créditos. Que el
// botón esté deshabilitado no es la protección: las tres acciones revalidan rol, vínculo durable
// y estado en el servidor.

import * as React from 'react';
import { Loader2, PhoneCall, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  continueOfficialContactPhoneRevealWithLushaAction,
  getOfficialContactPhoneRescueOptionsAction,
  recoverOfficialContactPhoneRevealAction,
  searchMoreOfficialContactPhonesAction,
} from '@/modules/contact-enrichment/post-approval-reveal-actions';
import type { OfficialContactRescueView } from '@/modules/contact-enrichment/post-approval-rescue-core';
import {
  RESCUE_CANCEL_LABEL,
  RESCUE_CONFIRM_LABEL,
  RESCUE_ERROR_COPY,
  RESCUE_LUSHA_BUSY_LABEL,
  RESCUE_LUSHA_LABEL,
  RESCUE_RECOVERY_BUSY_LABEL,
  RESCUE_RECOVERY_HELPER,
  RESCUE_RECOVERY_LABEL,
  RESCUE_SEARCH_MORE_BUSY_LABEL,
  RESCUE_SEARCH_MORE_LABEL,
  rescueLushaHelperText,
  rescueOutcomeText,
  rescueSearchMoreHelperText,
} from './post-approval-rescue-copy';

interface OfficialContactRescuePanelProps {
  readonly contactId: string;
  /**
   * Cambia cuando cambia el estado del reveal. Es la señal de RELECTURA: las salidas disponibles
   * dependen de ese estado, así que la ficha vuelve a preguntar en cuanto se mueve —al llegar el
   * teléfono, al cerrar sin número— sin montar aquí un segundo sondeo.
   */
  readonly revealStateKey: string;
  /** El número quedó guardado: el drawer RELEE el contacto por su vía normal. */
  readonly onPhoneProjected: () => void;
}

type PendingAction = 'recovery' | 'lusha' | 'searchMore' | null;

export function OfficialContactRescuePanel({
  contactId,
  revealStateKey,
  onPhoneProjected,
}: OfficialContactRescuePanelProps) {
  const [view, setView] = React.useState<OfficialContactRescueView | null>(null);
  const [busy, setBusy] = React.useState<PendingAction>(null);
  const [confirming, setConfirming] = React.useState<PendingAction>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  // Corta un segundo clic ANTES de que el re-render deshabilite el botón, que es la ventana real
  // del doble clic.
  const latch = React.useRef(false);

  const refresh = React.useCallback(async () => {
    try {
      setView(await getOfficialContactPhoneRescueOptionsAction({ contactId }));
    } catch {
      // Fail-closed hacia «no ofrecer»: se pierden unos botones, nunca la ficha. El rastro lo
      // deja el servidor — este drawer tiene prohibido `console.*` (AGENT2A-PROD-INCIDENT #279).
      setView(null);
    }
  }, [contactId]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await getOfficialContactPhoneRescueOptionsAction({ contactId });
        if (!cancelled) setView(next);
      } catch {
        if (!cancelled) setView(null);
      }
    })();
    return () => {
      cancelled = true;
      setView(null);
      setNotice(null);
      setConfirming(null);
    };
    // `revealStateKey` entra como dependencia a propósito: es lo que hace que las salidas se
    // recalculen cuando el reveal se mueve, sin un temporizador propio.
  }, [contactId, revealStateKey]);

  async function run(action: Exclude<PendingAction, null>) {
    if (latch.current) return;
    latch.current = true;
    setBusy(action);
    setConfirming(null);
    setNotice(null);
    try {
      const result =
        action === 'recovery'
          ? await recoverOfficialContactPhoneRevealAction({ contactId })
          : action === 'searchMore'
            ? await searchMoreOfficialContactPhonesAction({ contactId })
            : await continueOfficialContactPhoneRevealWithLushaAction({
                contactId,
                // El tope que el operador ACABA de leer. El servidor lo trata como límite
                // superior duro: si la modalidad real subió entre el render y el clic, corta sin
                // reservar nada en vez de cobrar de más.
                acceptedMaxCredits: view?.lushaContinuation.maxCredits ?? 0,
              });
      setNotice(rescueOutcomeText(result));
      if (result.phoneProjected) onPhoneProjected();
    } catch {
      setNotice(RESCUE_ERROR_COPY);
    } finally {
      latch.current = false;
      setBusy(null);
    }
    // Se relee SIEMPRE, también tras un fallo: quién sabe qué salidas quedan es el servidor.
    await refresh();
  }

  if (!view) return null;
  const { recovery, lushaContinuation, searchMore } = view;
  if (!recovery.available && !lushaContinuation.available && !searchMore.available) {
    return notice ? <p className="text-xs text-foreground">{notice}</p> : null;
  }

  const anyBusy = busy !== null;

  return (
    <div className="space-y-2.5">
      {recovery.available && (
        <div className="space-y-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            disabled={anyBusy}
            onClick={() => void run('recovery')}
          >
            {busy === 'recovery' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy === 'recovery' ? RESCUE_RECOVERY_BUSY_LABEL : RESCUE_RECOVERY_LABEL}
          </Button>
          <p className="text-[11px] text-muted-foreground/70">{RESCUE_RECOVERY_HELPER}</p>
        </div>
      )}

      {lushaContinuation.available && (
        <PaidRescueAction
          label={RESCUE_LUSHA_LABEL}
          busyLabel={RESCUE_LUSHA_BUSY_LABEL}
          helper={rescueLushaHelperText(
            lushaContinuation.maxCredits,
            lushaContinuation.requiresIdentitySearch,
          )}
          icon={<PhoneCall className="h-3.5 w-3.5" aria-hidden />}
          busy={busy === 'lusha'}
          anyBusy={anyBusy}
          armed={confirming === 'lusha'}
          onArm={() => setConfirming('lusha')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void run('lusha')}
        />
      )}

      {searchMore.available && (
        <PaidRescueAction
          label={RESCUE_SEARCH_MORE_LABEL}
          busyLabel={RESCUE_SEARCH_MORE_BUSY_LABEL}
          helper={rescueSearchMoreHelperText(searchMore.maxCredits)}
          icon={<Search className="h-3.5 w-3.5" aria-hidden />}
          busy={busy === 'searchMore'}
          anyBusy={anyBusy}
          armed={confirming === 'searchMore'}
          onArm={() => setConfirming('searchMore')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void run('searchMore')}
        />
      )}

      {notice && <p className="text-xs text-foreground">{notice}</p>}
    </div>
  );
}

/**
 * Una acción de PAGO, con su confirmación inline. Es un componente propio y no un helper llamado
 * durante el render por una razón concreta: el pestillo anti-doble-clic vive en un `ref` del padre,
 * y pasar ese cierre a través de una función de render hace que React lo lea en fase de render.
 * Con un componente, el manejador cruza como prop y sólo se ejecuta en el evento.
 */
function PaidRescueAction({
  label,
  busyLabel,
  helper,
  icon,
  busy,
  anyBusy,
  armed,
  onArm,
  onCancel,
  onConfirm,
}: {
  readonly label: string;
  readonly busyLabel: string;
  readonly helper: string;
  readonly icon: React.ReactNode;
  readonly busy: boolean;
  readonly anyBusy: boolean;
  /** El primer clic ya ocurrió: se está pidiendo la confirmación. Nada se ha gastado todavía. */
  readonly armed: boolean;
  readonly onArm: () => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="space-y-1.5">
      {armed ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={anyBusy}
            onClick={onConfirm}
          >
            {RESCUE_CONFIRM_LABEL}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={anyBusy}
            onClick={onCancel}
          >
            {RESCUE_CANCEL_LABEL}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={anyBusy}
          onClick={onArm}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
          {busy ? busyLabel : label}
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground/70">{helper}</p>
    </div>
  );
}
