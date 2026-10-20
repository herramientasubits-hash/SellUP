'use client';

/**
 * Lo que la investigación no encontró, con un campo por cada cosa para responder si el
 * vendedor la sabe, y UN botón para todo el bloque (dueña 18-10: «si me sé 4 cosas, un
 * solo agregar a la investigación, y que rehaga los textos con la información nueva»).
 * Sirve para la empresa y para el decisor.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Check, Search } from '@/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addFirstCallSellerAnswers, type SellerAnswerInput } from '@/modules/speech/actions';
import type { ResearchFact } from '@/server/agents/first-call/types';

export interface SellerQuestion {
  question: string;
  gapIndex: number | null;
  contactId: string | null;
}

export function SellerAnswersForm({
  questions,
  answered = [],
  briefId,
  onSaved,
}: {
  questions: readonly SellerQuestion[];
  /** Lo que el vendedor ya agregó (se muestra arriba, con su pregunta). */
  answered?: readonly ResearchFact[];
  /** Sin id (agente apagado o sin permiso): sólo se muestran las preguntas. */
  briefId: string | null;
  /** Se guardó: quien lo monta rehace los textos con lo nuevo. */
  onSaved?: (added: number) => void;
}) {
  const [values, setValues] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState(false);
  const filled = questions.map((q, i) => ({ ...q, text: (values[i] ?? '').trim() })).filter((a) => a.text.length > 0);

  const save = async () => {
    if (!briefId || filled.length === 0) return;
    setBusy(true);
    try {
      const answers: SellerAnswerInput[] = filled.map(({ question, text, gapIndex, contactId }) => ({ question, text, gapIndex, contactId }));
      const result = await addFirstCallSellerAnswers(briefId, answers);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setValues({});
      onSaved?.(result.added);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {answered.length > 0 && (
        <ul className="space-y-2" aria-label="Lo que agregaste">
          {answered.map((fact) => (
            <li key={fact.id} className="flex gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span>
                {fact.quote && <span className="block text-xs text-muted-foreground">{fact.quote}</span>}
                {fact.statement}
              </span>
            </li>
          ))}
        </ul>
      )}
      {questions.length > 0 && (
        <ul className="space-y-3">
          {questions.map((q, i) => (
            <li key={`${i}-${q.question}`} className="space-y-1.5 text-sm">
              <p className="flex gap-2">
                <Search className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{q.question}</span>
              </p>
              {briefId && (
                <Textarea
                  aria-label={`Lo que sabes: ${q.question}`}
                  placeholder="Si lo sabes, escríbelo aquí (opcional)"
                  rows={1}
                  maxLength={400}
                  className="ml-6 w-[calc(100%-1.5rem)] min-h-9"
                  value={values[i] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [i]: e.target.value }))}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {briefId && questions.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
          <span className="text-xs text-muted-foreground">
            {filled.length === 0 ? 'Responde lo que sepas y agrégalo todo junto.' : filled.length === 1 ? '1 respuesta lista.' : `${filled.length} respuestas listas.`}
          </span>
          <Button type="button" size="sm" onClick={save} disabled={busy || filled.length === 0}>
            Agregar a la investigación y rehacer los textos
          </Button>
        </div>
      )}
    </div>
  );
}
