'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { getFirstContactLaunchData } from '@/modules/speech/actions';
import type { FirstContactSelection } from '@/modules/speech/first-contact-wizard';
import type { FirstContactLaunchRequest } from './first-call-launcher';
import { FirstContactAgentPanel } from './first-contact-agent-panel';

/** Qué abrir: los datos completos (desde el panel de la empresa) o sólo la empresa (se cargan). */
export type FirstContactTarget =
  | { kind: 'request'; request: FirstContactLaunchRequest }
  | { kind: 'account'; accountId: string; initialSelection?: Partial<FirstContactSelection> };

interface FirstContactPanelHostProps {
  target: FirstContactTarget | null;
  onClose: () => void;
  onDone?: () => void;
  /** «Ver el primer contacto» de esa empresa. */
  onViewResult?: (accountId: string) => void;
  /**
   * El panel tiene sus datos y se abre en este render. Quien venía mostrando otro
   * panel (el buscador de empresa) lo cierra AHORA: así no hay un hueco en el que no
   * se ve ninguno (dueña 19-10: «se cierra por un momento el drawer y vuelve a salir»).
   */
  onReady?: () => void;
}

/**
 * Monta el Agente 3 para una empresa elegida en una lista (menú de la fila, barra de
 * selección, Contactos, Pipeline). Si sólo llega el id, carga lo necesario primero.
 */
export function FirstContactPanelHost({ target, onClose, onDone, onViewResult, onReady }: FirstContactPanelHostProps) {
  // Lo cargado para una empresa (cuando sólo llega su id), recordando para cuál.
  const [loaded, setLoaded] = React.useState<{ target: FirstContactTarget; request: FirstContactLaunchRequest } | null>(null);
  const request =
    target?.kind === 'request' ? target.request : target && loaded?.target === target ? loaded.request : null;

  React.useEffect(() => {
    if (!target || target.kind !== 'account') return;
    let cancelled = false;
    void getFirstContactLaunchData(target.accountId)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          toast.error('No se puede preparar el primer contacto de esta empresa.');
          onClose();
          return;
        }
        setLoaded({ target, request: { ...data, initialSelection: target.initialSelection } });
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('No pudimos abrir el agente. Vuelve a intentarlo.');
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [target, onClose]);

  const readyFor = React.useRef<FirstContactLaunchRequest | null>(null);
  React.useEffect(() => {
    if (!request || readyFor.current === request) return;
    readyFor.current = request;
    onReady?.();
  }, [request, onReady]);

  if (!request) return null;
  return (
    <FirstContactAgentPanel
      // Otra empresa u otra versión: el asistente empieza de cero (sin decisores de la anterior).
      key={`${request.accountId}:${request.regenerate?.packId ?? ''}`}
      open={!!target}
      onOpenChange={(open) => !open && onClose()}
      accountId={request.accountId}
      accountName={request.accountName}
      contacts={request.contacts}
      hasFreshBrief={request.hasFreshBrief}
      initialSelection={request.initialSelection}
      regenerate={request.regenerate}
      onDone={onDone}
      onViewResult={onViewResult ? () => onViewResult(request.accountId) : undefined}
    />
  );
}
