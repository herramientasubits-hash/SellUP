'use client';

/**
 * «Verificar con IA» en la ficha del candidato (CONTACT-CURRENT-EMPLOYMENT-AI-1): Claude busca a
 * la persona en la web y confirma si sigue en la empresa y con qué cargo. ~US$0,02–0,05 por
 * contacto, que queda en «Uso de IA». El resultado vuelve en la recarga del candidato.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/feedback/spinner';
import { ExternalLink, Sparkles } from '@/icons';
import { verifyCandidateEmploymentWithAiAction } from '@/modules/contact-enrichment/current-employment-ai-actions';
import {
  EMPLOYMENT_AI_KEPT_PREVIOUS_MESSAGE,
  employmentAiResultMessage,
  type EmploymentAiMessageTone,
} from './candidate-employment-ai-copy';

const TONE_CLASS: Record<EmploymentAiMessageTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-muted-foreground',
  error: 'text-destructive',
};

export function CandidateEmploymentAiVerifyButton({
  candidateId,
  checkedWithAi,
  evidenceUrl,
  disabled = false,
  onVerified,
}: {
  candidateId: string;
  checkedWithAi: boolean;
  evidenceUrl: string | null;
  disabled?: boolean;
  onVerified: () => void | Promise<void>;
}) {
  const [running, setRunning] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: EmploymentAiMessageTone; text: string } | null>(null);
  const inFlight = React.useRef(false);

  async function handleVerify() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setMessage(null);
    try {
      const result = await verifyCandidateEmploymentWithAiAction({ candidateId });
      const next = result.keptPrevious ? EMPLOYMENT_AI_KEPT_PREVIOUS_MESSAGE : employmentAiResultMessage(result.status);
      setMessage(next);
      if (next.tone === 'success') toast.success(next.text);
      if (result.ok) await onVerified();
    } catch {
      setMessage(employmentAiResultMessage('provider_error'));
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  return (
    <span className="flex flex-col items-start gap-1 pt-1">
      <span className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="xs" onClick={handleVerify} disabled={disabled || running}>
          {running ? <Spinner decorative size="xs" className="text-current" /> : <Sparkles aria-hidden="true" />}
          {running ? 'Buscando en la web…' : checkedWithAi ? 'Verificar de nuevo' : 'Verificar con IA'}
        </Button>
        {evidenceUrl && (
          <a
            href={evidenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            Ver fuente
          </a>
        )}
      </span>
      {message && (
        <span role="status" className={`text-xs ${TONE_CLASS[message.tone]}`}>
          {message.text}
        </span>
      )}
    </span>
  );
}
