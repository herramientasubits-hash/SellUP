'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { verifyCandidateEmploymentWithAiAction } from '@/modules/contact-enrichment/current-employment-ai-actions';
import {
  addToEmploymentAiTally,
  EMPTY_EMPLOYMENT_AI_TALLY,
  employmentAiBulkSummary,
  employmentAiResultMessage,
  employmentAiStopsBulk,
  EMPLOYMENT_AI_MAX_CONTACTS,
} from './candidate-employment-ai-copy';

/**
 * «Verificar cargo con IA» desde la barra de la tabla (CONTACT-CURRENT-EMPLOYMENT-AI-1): uno tras
 * otro, con el avance en un toast, hasta {@link EMPLOYMENT_AI_MAX_CONTACTS} por tanda. Si la IA
 * no está configurada o se acabó el presupuesto, se detiene (los siguientes fallarían igual).
 */
export function useVerifyEmploymentWithAi(onDone?: () => void) {
  const router = useRouter();
  const [verifying, setVerifying] = React.useState(false);

  const verify = React.useCallback(
    async (candidateIds: string[]) => {
      if (verifying || candidateIds.length === 0) return;
      setVerifying(true);
      const ids = candidateIds.slice(0, EMPLOYMENT_AI_MAX_CONTACTS);
      const toastId = toast.loading(`Verificando con IA 1 de ${ids.length}…`);
      let tally = EMPTY_EMPLOYMENT_AI_TALLY;
      let stopMessage: string | null = null;
      try {
        for (const [index, id] of ids.entries()) {
          toast.loading(`Verificando con IA ${index + 1} de ${ids.length}…`, { id: toastId });
          const result = await verifyCandidateEmploymentWithAiAction({ candidateId: id }).catch(() => null);
          const status = result?.status ?? 'provider_error';
          if (employmentAiStopsBulk(status)) {
            stopMessage = employmentAiResultMessage(status).text;
            break;
          }
          tally = addToEmploymentAiTally(tally, status);
        }
        const skipped = candidateIds.length - ids.length;
        const description = [
          stopMessage,
          skipped > 0 ? `Se verificaron los primeros ${ids.length}; vuelve a marcar los otros ${skipped}.` : null,
        ]
          .filter(Boolean)
          .join(' ');
        const summary = employmentAiBulkSummary(tally);
        if (stopMessage && tally === EMPTY_EMPLOYMENT_AI_TALLY) {
          toast.error(stopMessage, { id: toastId });
        } else {
          toast.success(summary, { id: toastId, ...(description ? { description } : {}) });
        }
        onDone?.();
        router.refresh();
      } finally {
        setVerifying(false);
      }
    },
    [verifying, onDone, router],
  );

  return { verify, verifying };
}
