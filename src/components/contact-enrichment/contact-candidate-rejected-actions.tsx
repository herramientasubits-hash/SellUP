'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw } from '@/icons';

import { Button } from '@/components/ui/button';
import { sendRejectedCandidatesToReview } from '@/modules/contact-enrichment/actions';

/** Rótulo único de la acción: lo comparten la barra del panel y la barra de la tabla. */
export const SEND_TO_REVIEW_LABEL = 'Enviar a revisar';

/**
 * Envía uno o varios candidatos RECHAZADOS de vuelta a «Por revisar»
 * (AGENT2A-CONTACTOS-RECHAZADOS). Avisa con un toast y refresca la lista para que
 * desaparezcan de «Contactos rechazados».
 */
export function useSendRejectedToReview(onDone?: () => void) {
  const router = useRouter();
  const [sending, setSending] = React.useState(false);

  const send = React.useCallback(
    async (candidateIds: string[]) => {
      if (sending || candidateIds.length === 0) return;
      setSending(true);
      try {
        const result = await sendRejectedCandidatesToReview(candidateIds);
        if (result.ok) {
          toast.success(result.message);
          onDone?.();
        } else if (result.restored > 0) {
          toast.warning(`${result.restored} enviados a revisar; ${result.failed} no se pudieron enviar.`);
          onDone?.();
        } else {
          toast.error(result.message);
        }
        router.refresh();
      } finally {
        setSending(false);
      }
    },
    [sending, onDone, router],
  );

  return { send, sending };
}

/**
 * La barra inferior del panel de un candidato rechazado: UNA sola acción, «Enviar a revisar».
 * No ofrece aprobar ni rechazar: el candidato tiene que volver a «Por revisar» primero.
 */
export function RejectedCandidateActions({
  candidateId,
  onClose,
}: {
  candidateId: string;
  onClose: () => void;
}) {
  const { send, sending } = useSendRejectedToReview(onClose);
  return (
    <div className="flex w-full items-center justify-end gap-2">
      <Button type="button" size="sm" disabled={sending} onClick={() => void send([candidateId])}>
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Enviando…
          </>
        ) : (
          <>
            <RotateCcw className="h-4 w-4" />
            {SEND_TO_REVIEW_LABEL}
          </>
        )}
      </Button>
    </div>
  );
}
