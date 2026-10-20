'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { discardContactCandidate } from '@/modules/contact-enrichment/actions';
import { REJECTION_REASONS } from './contact-candidate-detail-format';

/**
 * Los motivos que se pueden elegir desde la barra de la tabla: los del panel menos
 * «Otro», que pide escribir un comentario (eso queda en la ficha del candidato).
 */
export const BAR_REJECTION_REASONS = REJECTION_REASONS.filter((reason) => reason !== 'Otro');

/**
 * Rechaza uno o varios candidatos «por revisar» con un motivo, desde la barra de la
 * tabla (dueña 20-10: «en la barra salen las acciones masivas o individuales de esa
 * tabla, como en empresas»). Rechazar se deshace con «Enviar a revisar» en
 * «Contactos rechazados». Avisa con un toast y refresca la lista.
 */
export function useRejectCandidates(onDone?: () => void) {
  const router = useRouter();
  const [rejecting, setRejecting] = React.useState(false);

  const reject = React.useCallback(
    async (candidateIds: string[], reason: string) => {
      if (rejecting || candidateIds.length === 0) return;
      setRejecting(true);
      let rejected = 0;
      let lastError: string | null = null;
      try {
        // Uno tras otro: cada rechazo queda auditado con su motivo, igual que desde la ficha.
        for (const id of candidateIds) {
          const result = await discardContactCandidate(id, reason).catch(() => ({ ok: false, error: undefined }));
          if (result.ok) rejected += 1;
          else lastError = result.error ?? lastError;
        }
        const failed = candidateIds.length - rejected;
        if (failed === 0) {
          toast.success(rejected === 1 ? 'Candidato rechazado' : `${rejected} candidatos rechazados`, { description: `Motivo: ${reason}.` });
          onDone?.();
        } else if (rejected > 0) {
          toast.warning(`${rejected} rechazados; ${failed} no se pudieron rechazar.`, lastError ? { description: lastError } : undefined);
          onDone?.();
        } else {
          toast.error('No pudimos rechazar el candidato', lastError ? { description: lastError } : undefined);
        }
        router.refresh();
      } finally {
        setRejecting(false);
      }
    },
    [rejecting, onDone, router],
  );

  return { reject, rejecting };
}
